"""
Shared Supabase writer used by every scraper.

No third-party deps — uses urllib from the standard library. Supabase's
PostgREST endpoint speaks plain HTTP, so this is just a POST with the
service-role key as the Authorization header.

Env vars expected:
    SUPABASE_URL              e.g. https://abcdef123456.supabase.co
    SUPABASE_SERVICE_KEY      service_role key from Project Settings → API

Why service_role: this script runs on a trusted VPS, not in a browser.
It needs to bypass row-level security to insert. Don't bake this key
into git; load it from /etc/macro-scrapers.env via systemd or set it
in your shell on the VPS.

Idempotency: we POST with the `Prefer: resolution=ignore-duplicates`
header so Postgres silently drops rows that collide on (source, url).
The response body contains only the rows that were actually inserted,
which we return so the caller can log "what was new this run".
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import date
from typing import Iterable


@dataclass
class FeedItem:
    """One row destined for the macro_feed table."""
    source: str
    url: str
    title: str
    published_date: date
    metadata: dict | None = None

    def to_payload(self) -> dict:
        return {
            "source": self.source,
            "url": self.url,
            "title": self.title,
            "published_date": self.published_date.isoformat(),
            "metadata": self.metadata or {},
        }


class SupabaseError(RuntimeError):
    """Raised when the Supabase API call fails."""


def _env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise SupabaseError(
            f"environment variable {name} is not set. "
            f"Source /etc/macro-scrapers.env or export it manually."
        )
    return val


def dry_run() -> bool:
    """Returns True if SUPABASE_URL is unset — useful for local testing
    without hitting the database."""
    return not os.environ.get("SUPABASE_URL")


def insert_items(items: Iterable[FeedItem]) -> list[dict]:
    """Insert items into macro_feed; return only the rows actually inserted
    (i.e. truly new — the ones not already there)."""
    items = list(items)
    if not items:
        return []

    if dry_run():
        # Local-dev convenience: pretend everything is new, print nothing
        # extra. The caller logs what's "new" from its own perspective.
        return [it.to_payload() for it in items]

    base = _env("SUPABASE_URL").rstrip("/")
    key = _env("SUPABASE_SERVICE_KEY")
    url = f"{base}/rest/v1/macro_feed"

    body = json.dumps([it.to_payload() for it in items]).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # Return the inserted rows; ignore-duplicates means rows
            # colliding on the unique index are silently skipped.
            "Prefer": "return=representation,resolution=ignore-duplicates",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SupabaseError(
            f"Supabase returned {e.code}: {detail}"
        ) from e
    except urllib.error.URLError as e:
        raise SupabaseError(f"network error contacting Supabase: {e.reason}") from e


def log_summary(source: str, found: int, inserted: list[dict]) -> None:
    """Standard output line all scrapers can use for consistent logs."""
    new_count = len(inserted)
    mode = "[DRY RUN] " if dry_run() else ""
    print(f"  {mode}{source}: found {found} item(s), {new_count} new")
    for row in sorted(inserted, key=lambda r: r["published_date"], reverse=True):
        print(f"    {row['published_date']}  {row['title']}")
        print(f"        {row['url']}")
