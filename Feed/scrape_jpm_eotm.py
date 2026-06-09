#!/usr/bin/env python3
"""
J.P. Morgan Eye on the Market scraper — Supabase edition.

Parses the Podbean RSS feed (stdlib XML), pushes to macro_feed.
"""

from __future__ import annotations

import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from email.utils import parsedate_to_datetime

from supabase_writer import FeedItem, insert_items, log_summary, dry_run


# ---- Configuration ---------------------------------------------------------

SOURCE = "jpm_eotm"
FEED_URL = "https://feed.podbean.com/eyeonthemarket/feed.xml"
CUTOFF_DATE = date(2026, 1, 1)
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_JPM_LINK_RE = re.compile(
    r"href=['\"](https?://am\.jpmorgan\.com/[^'\"]+eye-on-the-market[^'\"]+)['\"]",
    re.IGNORECASE,
)


# ---- Fetching --------------------------------------------------------------

def fetch_feed() -> bytes:
    req = urllib.request.Request(FEED_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def extract_jpm_link(description: str | None, fallback: str) -> str:
    if not description:
        return fallback
    m = _JPM_LINK_RE.search(description)
    return m.group(1) if m else fallback


def parse_items(xml_bytes: bytes) -> list[FeedItem]:
    root = ET.fromstring(xml_bytes)
    channel = root.find("channel")
    if channel is None:
        return []

    out: list[FeedItem] = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        podbean_url = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or podbean_url).strip()
        pub_raw = (item.findtext("pubDate") or "").strip()
        desc = item.findtext("description") or ""

        if not (title and podbean_url and pub_raw):
            continue
        try:
            pub = parsedate_to_datetime(pub_raw).date()
        except (TypeError, ValueError):
            continue

        jpm_url = extract_jpm_link(desc, podbean_url)
        out.append(FeedItem(
            source=SOURCE,
            url=jpm_url,
            title=title,
            published_date=pub,
            metadata={"podbean_url": podbean_url, "guid": guid},
        ))

    # Dedupe by URL — distinct podcast episodes occasionally reference the
    # same JPM paper in their description, so `extract_jpm_link` resolves
    # them to identical canonical URLs. Postgres raises 23505 if a single
    # INSERT batch contains two rows with the same (source, url) key, even
    # with Prefer: resolution=ignore-duplicates. Keep the newest item per
    # URL so the most recent mention wins.
    by_url: dict[str, FeedItem] = {}
    for it in out:
        prev = by_url.get(it.url)
        if prev is None or it.published_date > prev.published_date:
            by_url[it.url] = it
    return list(by_url.values())


# ---- Main ------------------------------------------------------------------

def main() -> int:
    print(f"[{SOURCE}] cutoff={CUTOFF_DATE} {'(DRY RUN)' if dry_run() else ''}")

    try:
        xml = fetch_feed()
    except Exception as e:
        print(f"  ! fetch failed: {e}", file=sys.stderr)
        return 1

    items = [it for it in parse_items(xml) if it.published_date >= CUTOFF_DATE]
    print(f"  parsed {len(items)} item(s) since cutoff")

    try:
        inserted = insert_items(items)
    except Exception as e:
        print(f"  ! insert failed: {e}", file=sys.stderr)
        return 1

    log_summary(SOURCE, found=len(items), inserted=inserted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
