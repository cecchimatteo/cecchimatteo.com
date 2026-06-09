#!/usr/bin/env python3
"""
RBC GAM MacroMemo scraper — Supabase edition.

Drives the JS-rendered MacroMemo listing with Playwright, extracts
publication dates from individual article pages, pushes to the
macro_feed table. Idempotency is handled by Supabase's unique
(source, url) index — rerun as often as you like.
"""

from __future__ import annotations

import re
import sys
from datetime import date, datetime

from playwright.sync_api import sync_playwright, Page, TimeoutError as PWTimeout

from supabase_writer import FeedItem, insert_items, log_summary, dry_run


# ---- Configuration ---------------------------------------------------------

SOURCE = "rbc_macromemo"
LISTING_URL = "https://www.rbcgam.com/en/ca/insights/macromemo"
CUTOFF_DATE = date(2026, 1, 1)
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
MAX_LOAD_MORE_CLICKS = 30
PER_PAGE_TIMEOUT_MS = 30_000


# ---- Date extraction (unchanged from previous version) ---------------------

_DATE_RE_DISCLOSURE = re.compile(
    r"Date of publication:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})",
    re.IGNORECASE,
)
_DATE_RE_BYLINE = re.compile(r"\b([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})\b")


def parse_pub_date(text: str) -> date | None:
    for pat in (_DATE_RE_DISCLOSURE, _DATE_RE_BYLINE):
        m = pat.search(text)
        if not m:
            continue
        raw = " ".join(m.group(1).replace(",", " ").split())
        for fmt in ("%b %d %Y", "%B %d %Y"):
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
    return None


# ---- Listing scrape --------------------------------------------------------

def collect_listing(page: Page) -> list[dict]:
    page.goto(LISTING_URL, wait_until="networkidle", timeout=60_000)
    page.wait_for_selector("a[href*='/article/']", timeout=PER_PAGE_TIMEOUT_MS)

    for _ in range(MAX_LOAD_MORE_CLICKS):
        btn = page.locator(
            "button:has-text('Load more'), "
            "a:has-text('Load more'), "
            "[class*='load-more']"
        )
        if btn.count() == 0:
            break
        try:
            first = btn.first
            if not first.is_visible():
                break
            first.scroll_into_view_if_needed()
            first.click()
            page.wait_for_timeout(1500)
        except (PWTimeout, Exception):
            break

    items = page.eval_on_selector_all(
        "a[href*='/article/']",
        """els => els.map(el => ({
            url:   el.href,
            title: (el.innerText || el.getAttribute('aria-label') || '').trim()
        }))"""
    )
    by_url: dict[str, dict] = {}
    for it in items:
        u = it["url"]
        if "/article/" not in u or "/detail" not in u:
            continue
        if u not in by_url or (it["title"] and not by_url[u]["title"]):
            by_url[u] = it
    return list(by_url.values())


def fetch_article(page: Page, url: str) -> tuple[str, date | None]:
    page.goto(url, wait_until="domcontentloaded", timeout=PER_PAGE_TIMEOUT_MS)
    title = ""
    try:
        title = page.locator("h1").first.inner_text(timeout=5_000).strip()
    except PWTimeout:
        title = page.title().strip()
    body = page.inner_text("body")
    return title, parse_pub_date(body)


# ---- Main ------------------------------------------------------------------

def main() -> int:
    print(f"[{SOURCE}] cutoff={CUTOFF_DATE} {'(DRY RUN)' if dry_run() else ''}")
    feed_items: list[FeedItem] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=USER_AGENT,
                                  viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        listing = collect_listing(page)
        print(f"  listing: {len(listing)} unique article links")

        for card in listing:
            url = card["url"]
            try:
                title, pub = fetch_article(page, url)
            except Exception as e:
                print(f"  ! error on {url}: {e}", file=sys.stderr)
                continue
            if pub is None:
                print(f"  ! no date on {url}", file=sys.stderr)
                continue
            if pub < CUTOFF_DATE:
                continue
            feed_items.append(FeedItem(
                source=SOURCE,
                url=url,
                title=title or card["title"],
                published_date=pub,
            ))
        browser.close()

    try:
        inserted = insert_items(feed_items)
    except Exception as e:
        print(f"  ! insert failed: {e}", file=sys.stderr)
        return 1

    log_summary(SOURCE, found=len(feed_items), inserted=inserted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
