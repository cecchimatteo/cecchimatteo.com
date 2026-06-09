#!/usr/bin/env python3
"""
Centris.ca property scraper — Montréal & Gatineau
===================================================

What the intercept revealed
---------------------------
Centris uses Knockout.js with server-side pre-rendering.  There is no
public JSON API; the listing cards are present in the initial HTML response
and hydrated client-side.

Approach
--------
  1. Navigate the list-view search page (Playwright handles Cloudflare).
  2. Wait for actual card elements to appear (networkidle + explicit selector).
  3. Extract listing cards from the rendered DOM.
  4. Click "Suivante" to paginate.
  5. Optionally visit each detail page for full specs.

Setup
-----
    pip install playwright
    playwright install chromium

Usage
-----
    python centris.py                    # summaries for Montréal + Gatineau
    python centris.py --area montreal    # one area only
    python centris.py --detail           # visit each listing for full specs
    python centris.py --headed           # show browser window (debug)
    python centris.py --dump             # save page HTML + screenshot on first page

Debug workflow
--------------
Run with --headed --dump first.  The script saves:
  - centris_dump_<area>_page<N>.html
  - centris_dump_<area>_page<N>.png
Open the HTML in your browser or DevTools to find the real class names,
then update CARD_SELECTORS / FIELD_SELECTORS below accordingly.
"""

import argparse
import asyncio
import base64
import csv
import gzip
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from playwright.async_api import Browser, Page, async_playwright

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL  = "https://www.centris.ca"
MAX_PAGES = 2     # safety cap — increase for full runs
DELAY_MS  = 2_000 # ms to wait after each navigation

AREAS = {
    "montreal": {
        "label":  "Montréal (Île)",
        "slug":   "montreal-ile",   # confirmed from Centris nav links
    },
    "gatineau": {
        "label":  "Gatineau",
        "slug":   "gatineau",
    },
}

# ── CSS selector sets ─────────────────────────────────────────────────────────
# These are tried in order; update after inspecting a --dump HTML file.

CARD_SELECTORS = [
    "article.property-thumbnail-item",   # most common Centris format
    ".property-thumbnail-item",
    "div.property-thumbnail",
    "[class*='property-thumbnail']",
    "[data-id]",                         # some versions put centris # here
    # Generic fallback — any article with a link inside
    "article:has(a[href*='a-vendre'])",
    "li:has(a[href*='a-vendre'])",
]

PRICE_SELECTORS   = [".price", ".listing-price", "[class*='price']"]
ADDRESS_SELECTORS = [".address", ".civic-address", "[class*='address']",
                     "[itemprop='streetAddress']"]
CITY_SELECTORS    = [".city", "[class*='city']", "[itemprop='addressLocality']"]
TYPE_SELECTORS    = [".category", ".property-type", "[class*='category']",
                     "[class*='type']"]
SPEC_SELECTORS    = [".spec-list", ".features", "[class*='spec']",
                     "[class*='feature']", "[class*='carac']"]

# Wait for this selector before extracting — proves cards have rendered
READY_SELECTOR    = ", ".join(CARD_SELECTORS[:4])

BROWSER_ARGS = {
    "extra_http_headers": {
        "Accept-Language": "fr-CA,fr;q=0.9,en-CA;q=0.8",
    },
    "viewport": {"width": 1440, "height": 900},
    "locale":   "fr-CA",
}

# Chromium launch flags that reduce automation fingerprint
LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
]

# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class Property:
    centris_no:       str            = ""
    url:              str            = ""
    area:             str            = ""
    address:          str            = ""
    city:             str            = ""
    province:         str            = "QC"
    property_type:    str            = ""
    price:            Optional[int]  = None
    bedrooms:         Optional[int]  = None
    bathrooms:        Optional[int]  = None
    living_area_sqft: Optional[int]  = None
    lot_area_sqft:    Optional[int]  = None
    year_built:       Optional[int]  = None
    parking:          Optional[int]  = None
    latitude:         Optional[float]= None
    longitude:        Optional[float]= None
    description:      str            = ""
    scraped_at:       str            = field(
        default_factory=lambda: datetime.now().isoformat(timespec="seconds")
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_price(text: str) -> Optional[int]:
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def parse_int(text: str) -> Optional[int]:
    digits = re.sub(r"[^\d]", "", (text or "").split()[0])
    return int(digits) if digits else None


def build_search_url(area_key: str) -> str:
    """
    Centris region URL format: /fr/propriete~a-vendre~{region-slug}
    (confirmed from their own navigation links — tilde separator, not slash)
    """
    slug = AREAS[area_key]["slug"]
    return f"{BASE_URL}/fr/propriete~a-vendre~{slug}?view=Thumbnail&sort=None"


# ── Page helpers ──────────────────────────────────────────────────────────────

async def dismiss_banners(page: Page) -> None:
    for sel in [
        "#didomi-notice-agree-button",
        "button[id*='didomi']",
        "button[aria-label='Accepter']",
        "button[aria-label*='accept' i]",
        ".cookie-banner button",
        "#cookie-accept",
    ]:
        try:
            await page.click(sel, timeout=2_000)
            await page.wait_for_timeout(400)
            return
        except Exception:
            pass


async def wait_for_cards(page: Page, timeout: int = 20_000) -> bool:
    """Wait until at least one listing card appears.  Returns False on timeout."""
    for sel in CARD_SELECTORS:
        try:
            await page.wait_for_selector(sel, timeout=timeout)
            return True
        except Exception:
            continue
    return False


async def get_total_count(page: Page) -> int:
    for sel in [
        ".results-info strong",
        ".listing-count",
        ".results-count",
        "[class*='result'] strong",
        "[class*='count']",
        ".total-results",
    ]:
        el = await page.query_selector(sel)
        if el:
            v = parse_int(await el.inner_text())
            if v:
                return v
    return 0


async def find_next_button(page: Page) -> bool:
    """Click the next-page button.  Returns True if found and clicked."""
    selectors = [
        "a[aria-label='Suivante']",
        "a[aria-label='Next']",
        "li.next:not(.disabled) a",
        "li:not(.disabled) a[aria-label*='suivant' i]",
        ".pager a[rel='next']",
        "a.next-results",
        ".pagination a[rel='next']",
        "[class*='pagination'] li:last-child:not(.disabled) a",
        # Text-based fallback
        "//a[normalize-space(.)='Suivante']",
        "//a[normalize-space(.)='Next']",
    ]
    for sel in selectors:
        try:
            if sel.startswith("//"):
                btn = await page.query_selector(f"xpath={sel}")
            else:
                btn = await page.query_selector(sel)
            if not btn:
                continue
            is_disabled = (await btn.get_attribute("aria-disabled") or "").lower()
            cls         = (await btn.get_attribute("class") or "").lower()
            parent      = await btn.evaluate("el => el.closest('li')?.className || ''")
            if "disabled" in is_disabled or "disabled" in cls or "disabled" in parent.lower():
                return False
            await btn.click()
            return True
        except Exception:
            continue
    return False


# ── Dump mode ─────────────────────────────────────────────────────────────────

async def dump_page(page: Page, area_key: str, page_num: int) -> None:
    """Save HTML + screenshot for offline inspection."""
    stem = f"centris_dump_{area_key}_page{page_num}"
    html_path = f"{stem}.html"
    png_path  = f"{stem}.png"

    html = await page.content()
    Path(html_path).write_text(html, encoding="utf-8")
    await page.screenshot(path=png_path, full_page=False)

    # Also log all unique class names to help identify selectors
    classes: list[str] = await page.eval_on_selector_all(
        "[class]",
        "els => [...new Set(els.flatMap(e => [...e.classList]))].sort()"
    )
    # Print those that look listing-related
    relevant = [c for c in classes if any(k in c for k in
                ["property", "listing", "card", "result", "thumb",
                 "price", "address", "spec", "carac", "feature", "pager"])]
    print(f"\n  📄  Dumped → {html_path}  |  {png_path}")
    print(f"  Potentially relevant CSS classes found on page:")
    for c in relevant[:50]:
        print(f"    .{c}")
    if len(relevant) > 50:
        print(f"    … and {len(relevant) - 50} more")


# ── Card extraction ───────────────────────────────────────────────────────────

async def extract_jsonld(page: Page) -> list[dict]:
    """Return Schema.org items from JSON-LD scripts."""
    scripts = await page.eval_on_selector_all(
        "script[type='application/ld+json']",
        "els => els.map(e => e.textContent)"
    )
    results = []
    for s in scripts:
        try:
            data  = json.loads(s)
            items = data if isinstance(data, list) else [data]
            for item in items:
                t = item.get("@type", "")
                if any(k in t for k in ["RealEstate", "Product", "Offer", "House"]):
                    results.append(item)
        except Exception:
            pass
    return results


async def text_of(el, selectors: list[str]) -> str:
    """Return inner text of the first matching child selector."""
    for sel in selectors:
        child = await el.query_selector(sel)
        if child:
            t = (await child.inner_text()).strip()
            if t:
                return t
    return ""


async def extract_cards_dom(page: Page, area_label: str) -> list[Property]:
    """Extract property data from listing cards in the DOM."""
    props: list[Property] = []
    cards = []

    for sel in CARD_SELECTORS:
        cards = await page.query_selector_all(sel)
        if cards:
            print(f"    Matched card selector: {sel!r} → {len(cards)} cards")
            break

    if not cards:
        # Fallback: grab all hrefs that look like detail pages
        hrefs = await page.eval_on_selector_all(
            "a[href]", "els => [...new Set(els.map(e => e.href))]"
        )
        # Listing detail URLs end with a numeric Centris ID, e.g.:
        #   /fr/maison~a-vendre/montreal/plateau/123-rue-exemple/27654321
        # Nav/region links do NOT have a trailing number, so this filters them out.
        detail_re = re.compile(
            r"/fr/[\w%-]+~a-vendre/[\w%-]+(?:/[\w%-]+){2,}/(\d{7,9})(?:\?|$)"
        )
        seen = set()
        for href in hrefs:
            m = detail_re.search(href)
            if m and href not in seen:
                seen.add(href)
                props.append(Property(
                    url=href,
                    area=area_label,
                    centris_no=m.group(1),
                ))
        print(f"    Fallback href scan → {len(props)} URLs")
        return props

    for card in cards:
        p = Property(area=area_label)

        # ── URL + Centris number ──────────────────────────────────────────────
        link = await card.query_selector("a[href]")
        if link:
            href = (await link.get_attribute("href") or "").strip()
            p.url = href if href.startswith("http") else f"{BASE_URL}{href}"
            m = re.search(r"/([A-Z0-9]{6,})(?:[/?#]|$)", p.url)
            if m:
                p.centris_no = m.group(1)

        # ── data-id fallback ──────────────────────────────────────────────────
        if not p.centris_no:
            did = await card.get_attribute("data-id") or ""
            if did:
                p.centris_no = did

        # ── Price ─────────────────────────────────────────────────────────────
        raw_price = await text_of(card, PRICE_SELECTORS)
        p.price = parse_price(raw_price)

        # ── Address + City ────────────────────────────────────────────────────
        # Centris puts both on the card as a two-line string:
        #   "300, Rue Ann, app. 510\nMontréal (Le Sud-Ouest)"
        # We split on the newline: first line(s) = street, last line = city.
        raw_addr = await text_of(card, ADDRESS_SELECTORS)
        if raw_addr:
            lines = [l.strip() for l in raw_addr.splitlines() if l.strip()]
            if len(lines) >= 2:
                p.address = ", ".join(lines[:-1])
                p.city    = lines[-1]
            else:
                p.address = lines[0] if lines else ""

        # City selector fallback (in case address didn't contain it)
        if not p.city:
            p.city = await text_of(card, CITY_SELECTORS)

        # ── Property type ─────────────────────────────────────────────────────
        p.property_type = await text_of(card, TYPE_SELECTORS)

        # ── Bedrooms / bathrooms ──────────────────────────────────────────────
        # Try dedicated spec container first, fall back to full card text.
        spec_text = await text_of(card, SPEC_SELECTORS)
        if not spec_text:
            spec_text = (await card.inner_text()) or ""

        # French: "3 ch." / "3 chambres" | "2 s. de bain" / "2 salles de bain"
        # English fallback: "3 bed" / "2 bath"
        m_bed  = re.search(
            r"(\d+)\s*(?:ch(?:ambres?|\.)?|bedroom|bed\b)", spec_text, re.I
        )
        m_bath = re.search(
            r"(\d+)\s*(?:s(?:alles?\s*de\s*bains?|\.?\s*de\s*bain)?|bathroom|bath\b)",
            spec_text, re.I,
        )
        if m_bed:  p.bedrooms  = int(m_bed.group(1))
        if m_bath: p.bathrooms = int(m_bath.group(1))

        # Only keep cards that have at least a URL
        if p.url:
            props.append(p)

    return props


# ── Phase 1: Collect listing summaries ───────────────────────────────────────

async def scrape_area(
    browser: Browser,
    area_key: str,
    dump: bool = False,
    max_pages: int = MAX_PAGES,
) -> list[Property]:
    area  = AREAS[area_key]
    label = area["label"]
    url   = build_search_url(area_key)

    print(f"\n{'─'*60}")
    print(f"  {label}  →  {url}")
    print(f"{'─'*60}")

    ctx  = await browser.new_context(**BROWSER_ARGS)
    page = await ctx.new_page()

    # Mask navigator.webdriver so Cloudflare doesn't flag us
    await page.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )

    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    await dismiss_banners(page)

    # Wait for cards to actually render (Knockout/React hydration)
    found = await wait_for_cards(page)
    if not found:
        print("  ⚠  No card elements appeared within 20 s — page may be blocked.")
        print("     Try running with --headed to inspect the browser window.")

    await page.wait_for_timeout(DELAY_MS)

    total = await get_total_count(page)
    if total:
        print(f"  Reported: {total} listings")

    all_props: list[Property] = []
    seen_urls: set[str]       = set()
    page_num                  = 1

    while page_num <= max_pages:
        if dump and page_num <= 2:   # dump first two pages
            await dump_page(page, area_key, page_num)

        # DOM extraction
        cards = await extract_cards_dom(page, label)
        new   = [c for c in cards if c.url and c.url not in seen_urls]
        seen_urls.update(c.url for c in new)
        all_props.extend(new)
        print(f"  Page {page_num}: +{len(new)} new  (total: {len(all_props)})")

        if not new and page_num > 1:
            print("  No new listings on this page — stopping.")
            break

        clicked = await find_next_button(page)
        if not clicked:
            print("  No 'Next' button found — end of results.")
            break

        # Wait for the page content to refresh after click
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=15_000)
        except Exception:
            pass
        await wait_for_cards(page, timeout=15_000)
        await page.wait_for_timeout(DELAY_MS)
        page_num += 1

    await ctx.close()
    return all_props


# ── Phase 2: Detail pages ─────────────────────────────────────────────────────

def _parse_fr_int(text: str) -> Optional[int]:
    """
    Parse a French-formatted integer, e.g. "1 100" or "1,100" → 1100.
    Strips all non-digit characters then converts.
    """
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


async def scrape_detail(page: Page, prop: Property) -> Property:
    if not prop.url:
        return prop
    try:
        await page.goto(prop.url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(800)
    except Exception:
        return prop

    # ── Price (if not already captured from the card) ─────────────────────────
    if not prop.price:
        for sel in [".price-container .price", "[itemprop='price']", ".listing-price"]:
            el = await page.query_selector(sel)
            if el:
                prop.price = parse_price(await el.inner_text())
                if prop.price:
                    break

    # ── GPS — data attributes on the map element ───────────────────────────────
    for lat_attr, lng_attr in [
        ("data-lat",      "data-lng"),
        ("data-latitude", "data-longitude"),
    ]:
        lat_el = await page.query_selector(f"[{lat_attr}]")
        lng_el = await page.query_selector(f"[{lng_attr}]")
        if lat_el and lng_el:
            try:
                prop.latitude  = float(await lat_el.get_attribute(lat_attr) or "")
                prop.longitude = float(await lng_el.get_attribute(lng_attr) or "")
                break
            except Exception:
                pass

    # ── Full-text regex extraction ─────────────────────────────────────────────
    # Centris renders specs as a flex grid (not a table), so cell-based parsing
    # misaligns.  Extracting from the raw page text is much more reliable —
    # the data is always present as plain text in the "Caractéristiques" section.
    try:
        body = await page.inner_text("body")
    except Exception:
        body = ""

    # Bedrooms: "2 chambres" / "1 chambre"
    m = re.search(r"(\d+)\s*chambres?", body, re.I)
    if m:
        prop.bedrooms = int(m.group(1))

    # Bathrooms: "2 salles de bain" / "1 salle de bain"
    m = re.search(r"(\d+)\s*salles?\s*de\s*bains?", body, re.I)
    if m:
        prop.bathrooms = int(m.group(1))

    # Living area: "Superficie nette\n848 pc" — handles "1 100 pc" (French spaces)
    m = re.search(
        r"Superficie\s+nette[^0-9]{0,30}([\d][\d\s]*?)\s*(?:pc|pi(?:eds?\s*carr|²))",
        body, re.I,
    )
    if m:
        prop.living_area_sqft = _parse_fr_int(m.group(1))

    # Lot area: "Superficie du terrain\n1 234 pc"
    m = re.search(
        r"Superficie\s+(?:du\s+)?terrain[^0-9]{0,30}([\d][\d\s]*?)\s*(?:pc|pi(?:eds?\s*carr|²))",
        body, re.I,
    )
    if m:
        prop.lot_area_sqft = _parse_fr_int(m.group(1))

    # Year built: "Année de construction\n1924"
    m = re.search(r"Ann[eé]e\s+de\s+construction\D{0,15}(\d{4})", body, re.I)
    if m:
        prop.year_built = int(m.group(1))

    # Parking: "Stationnement total\nGarage (2)" or "Garage (1), Ext (1)" → sum
    m = re.search(r"Stationnement(?:\s+total)?([\s\S]{0,120}?)(?:\n[A-Z]|\Z)", body, re.I)
    if m:
        nums = re.findall(r"\((\d+)\)", m.group(1))
        if nums:
            prop.parking = sum(int(n) for n in nums)
        else:
            # Fallback: first bare number after the label
            n = re.search(r"(\d+)", m.group(1))
            if n:
                prop.parking = int(n.group(1))

    # ── Description ───────────────────────────────────────────────────────────
    # The characteristics section often appears first; skip selectors that
    # return it by checking the text doesn't start with "Caractéristiques".
    for sel in [
        ".description-text",
        "[itemprop='description']",
        ".listing-description",
        ".description",
    ]:
        el = await page.query_selector(sel)
        if el:
            text = (await el.inner_text()).strip()
            if text and not text.lower().startswith("caract"):
                prop.description = text[:600]
                break

    return prop


# ── Output ────────────────────────────────────────────────────────────────────

def area_stats(props: list[Property]) -> dict:
    """Summary statistics for a single area's property list."""
    prices = [p.price for p in props if p.price]
    beds   = [p.bedrooms for p in props if p.bedrooms]
    sqfts  = [p.living_area_sqft for p in props if p.living_area_sqft]

    ppsf_vals = [
        round(p.price / p.living_area_sqft)
        for p in props
        if p.price and p.living_area_sqft
    ]

    by_type: dict[str, int] = {}
    for p in props:
        key = p.property_type or "Unknown"
        by_type[key] = by_type.get(key, 0) + 1

    def avg(lst): return round(sum(lst) / len(lst)) if lst else None
    def med(lst):
        if not lst: return None
        s = sorted(lst)
        m = len(s) // 2
        return s[m] if len(s) % 2 else (s[m - 1] + s[m]) // 2

    return {
        "count":              len(props),
        "avg_price":          avg(prices),
        "median_price":       med(prices),
        "min_price":          min(prices) if prices else None,
        "max_price":          max(prices) if prices else None,
        "avg_bedrooms":       round(sum(beds) / len(beds), 1) if beds else None,
        "avg_living_sqft":    avg(sqfts),
        "avg_price_per_sqft": avg(ppsf_vals),
        "by_type":            dict(sorted(by_type.items(), key=lambda x: -x[1])),
    }


def build_output(area_keys: list[str], props_by_area: dict[str, list[Property]]) -> dict:
    """Build the grouped JSON envelope."""
    areas_out = {}
    for key in area_keys:
        props = props_by_area.get(key, [])
        label = AREAS[key]["label"]
        stats = area_stats(props)
        areas_out[key] = {
            "label":      label,
            **stats,           # count, avg_price, median_price, … inline at top level
            "properties": [asdict(p) for p in props],
        }

    return {
        "scraped_at": datetime.now().isoformat(timespec="seconds"),
        "areas":      areas_out,
    }


def save_json(output: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"✓ JSON → {path}")


def save_csv(props: list[Property], path: str) -> None:
    """Flat CSV — one row per property, all areas combined."""
    if not props:
        return
    rows = [asdict(p) for p in props]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    print(f"✓ CSV  → {path}")


def print_summary(output: dict) -> None:
    """Console summary table after scraping."""
    print()
    for key, area in output["areas"].items():
        print(f"  {'─'*50}")
        print(f"  {area['label']}  ({area['count']} properties)")
        if area["avg_price"]:
            print(f"    Avg price:        ${area['avg_price']:>10,}")
        if area["median_price"]:
            print(f"    Median price:     ${area['median_price']:>10,}")
        if area["avg_price_per_sqft"]:
            print(f"    Avg $/sqft:       ${area['avg_price_per_sqft']:>10,}")
        if area["avg_bedrooms"]:
            print(f"    Avg bedrooms:      {area['avg_bedrooms']:>10}")
        if area["by_type"]:
            print(f"    By type:")
            for t, n in area["by_type"].items():
                print(f"      {t:<30} {n:>4}")
    print(f"  {'─'*50}")


# ── Entry point ───────────────────────────────────────────────────────────────

async def run(areas: list[str], detail: bool, headed: bool, dump: bool, max_pages: int) -> None:
    props_by_area: dict[str, list[Property]] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=not headed,
            args=LAUNCH_ARGS,
        )

        # Phase 1 — summaries
        for area_key in areas:
            props = await scrape_area(browser, area_key, dump=dump, max_pages=max_pages)
            props_by_area[area_key] = props

        # Phase 2 — detail pages (optional)
        if detail:
            all_props = [p for ps in props_by_area.values() for p in ps]
            if all_props:
                print(f"\nScraping {len(all_props)} detail pages…")
                ctx  = await browser.new_context(**BROWSER_ARGS)
                page = await ctx.new_page()
                idx  = 0
                for area_key in areas:
                    for i, prop in enumerate(props_by_area[area_key]):
                        idx += 1
                        suffix = (prop.centris_no or prop.url[-30:]).ljust(30)
                        print(f"  [{idx:>4}/{len(all_props)}] {suffix}", end="\r")
                        props_by_area[area_key][i] = await scrape_detail(page, prop)
                        await asyncio.sleep(1.0)
                await ctx.close()
                print()

        await browser.close()

    total = sum(len(ps) for ps in props_by_area.values())
    print(f"\nTotal: {total} properties")
    if not total:
        print("Nothing to save — check the dump files or run with --headed.")
        return

    output = build_output(areas, props_by_area)
    print_summary(output)

    ts   = datetime.now().strftime("%Y%m%d_%H%M")
    slug = "_".join(areas)
    save_json(output, f"centris_{slug}_{ts}.json")

    # CSV is a flat list (easier to open in Excel)
    all_props = [p for ps in props_by_area.values() for p in ps]
    save_csv(all_props, f"centris_{slug}_{ts}.csv")


def main() -> None:
    ap = argparse.ArgumentParser(description="Centris.ca property scraper")
    ap.add_argument("--area",   choices=list(AREAS), help="One area only (default: all)")
    ap.add_argument("--detail", action="store_true",  help="Scrape each listing detail page")
    ap.add_argument("--headed", action="store_true",  help="Show browser window (debug)")
    ap.add_argument("--dump",   action="store_true",
                    help="Save page HTML + screenshot + class names for selector debugging")
    ap.add_argument("--pages",  type=int, default=MAX_PAGES,
                    help=f"Max pages to scrape per area (default: {MAX_PAGES})")
    args = ap.parse_args()

    asyncio.run(run(
        areas     = [args.area] if args.area else list(AREAS),
        detail    = args.detail,
        headed    = args.headed,
        dump      = args.dump,
        max_pages = args.pages,
    ))


if __name__ == "__main__":
    main()
