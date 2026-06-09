#!/usr/bin/env python3
"""
UBS CIO House View — Daily commentary scraper.

UBS publishes a "Daily" piece at predictable URLs:
    https://www.ubs.com/global/en/wealthmanagement/insights/chief-investment-office/
      house-view/daily/{YYYY}/latest-{DDMMYYYY}.html

So we don't need a listing page or a feed — we generate URLs by date,
fetch each, and skip 404s (they don't publish every weekday).

Architecture vs RBC/JPM:
    RBC  →  JS-rendered listing → Playwright
    JPM  →  RSS feed             → stdlib urllib
    UBS  →  date-based URLs      → stdlib urllib + polite throttle

All three converge on the same FeedItem schema and push to the shared
macro_feed table.

Coverage note: UBS publishes Daily, Weekly Key Messages, and Monthly
pieces. This scraper covers Daily, which is high-frequency (4-5/week)
but also the highest-signal-per-effort for a personal feed. For Weekly
or Monthly, see the README; they need different patterns (Weekly is a
single URL that gets overwritten, Monthly is a PDF).

Run:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 scrape_ubs_daily.py
    # or, for local testing without DB:
    python3 scrape_ubs_daily.py
"""

from __future__ import annotations

import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

from supabase_writer import FeedItem, insert_items, log_summary, dry_run


# ---- Configuration ---------------------------------------------------------

SOURCE = "ubs_daily"
CUTOFF_DATE = date(2026, 1, 1)
# Start a bit before today to account for time zones / late publishing.
END_DATE = date.today()
URL_TEMPLATE = (
    "https://www.ubs.com/global/en/wealthmanagement/insights/"
    "chief-investment-office/house-view/daily/{year}/latest-{ddmmyyyy}.html"
)
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
# Be polite. UBS isn't aggressive but we're hitting ~100 URLs on first run.
SLEEP_BETWEEN_REQUESTS_S = 1.5
HTTP_TIMEOUT_S = 20


# ---- Parsing ---------------------------------------------------------------

# Title is in <title>Daily: ... | UBS Global</title>. We strip the suffix.
_TITLE_RE = re.compile(r"<title>\s*(.*?)\s*\|\s*UBS\b.*?</title>", re.IGNORECASE | re.DOTALL)
# Fallback: og:title or h1.
_OG_TITLE_RE = re.compile(r'<meta\s+property=["\']og:title["\']\s+content=["\'](.*?)["\']', re.IGNORECASE)
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


def extract_title(html: str) -> str | None:
    for pat in (_TITLE_RE, _OG_TITLE_RE, _H1_RE):
        m = pat.search(html)
        if m:
            raw = _TAG_RE.sub("", m.group(1)).strip()
            if raw and raw.lower() != "house view":
                return raw
    return None


# ---- URL enumeration -------------------------------------------------------

def daterange(start: date, end_inclusive: date):
    """Yield each date from start through end_inclusive, weekdays only.
    UBS doesn't publish on weekends so we skip them; saves ~30% of fetches."""
    d = start
    one_day = timedelta(days=1)
    while d <= end_inclusive:
        if d.weekday() < 5:  # Mon-Fri
            yield d
        d += one_day


def url_for(d: date) -> str:
    return URL_TEMPLATE.format(
        year=d.year,
        ddmmyyyy=f"{d.day:02d}{d.month:02d}{d.year}",
    )


# ---- Fetching --------------------------------------------------------------

def fetch_html(url: str) -> str | None:
    """Return HTML or None on 404. Raise on other errors."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        # Other HTTP errors: log and skip rather than abort whole run
        print(f"    ! HTTP {e.code} on {url}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"    ! network error on {url}: {e.reason}", file=sys.stderr)
        return None


# ---- Main ------------------------------------------------------------------

def main() -> int:
    print(f"[{SOURCE}] cutoff={CUTOFF_DATE} end={END_DATE}"
          f" {'(DRY RUN)' if dry_run() else ''}")

    dates = list(daterange(CUTOFF_DATE, END_DATE))
    print(f"  enumerating {len(dates)} weekday URL(s)...")

    items: list[FeedItem] = []
    found = skipped_404 = 0

    for d in dates:
        url = url_for(d)
        html = fetch_html(url)
        time.sleep(SLEEP_BETWEEN_REQUESTS_S)
        if html is None:
            skipped_404 += 1
            continue
        title = extract_title(html)
        if not title:
            print(f"    ! no title found for {url}", file=sys.stderr)
            continue
        found += 1
        items.append(FeedItem(
            source=SOURCE,
            url=url,
            title=title,
            published_date=d,
            metadata={"discovered_via": "date-enumeration"},
        ))

    print(f"  fetch summary: {found} found, {skipped_404} non-publish days (404)")

    try:
        inserted = insert_items(items)
    except Exception as e:
        print(f"  ! insert failed: {e}", file=sys.stderr)
        return 1

    log_summary(SOURCE, found=len(items), inserted=inserted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
