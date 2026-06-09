# Macro feed scrapers

Three scrapers that watch macro/finance publications and push new items into a
shared Supabase table. Idempotent, scheduled via cron.

```
sources           shared writer         destination
----------        -------------         -----------
rbc_macromemo  ─┐
jpm_eotm       ─┼─►  supabase_writer ─►  Supabase: macro_feed
ubs_daily      ─┘                        (Postgres, one row per item)
```

Each scraper handles its source's quirks:

| Source         | Discovery method   | Frequency    | Dependencies                 | First-run cost |
|----------------|--------------------|--------------|-------------------------------|----------------|
| rbc_macromemo  | Playwright listing | 2–3 weeks    | Playwright + Chromium (~150 MB) | ~30 s          |
| jpm_eotm       | Podbean RSS feed   | ~monthly     | stdlib only                  | <1 s           |
| ubs_daily      | Date-based URLs    | 4–5/week     | stdlib only                  | ~3 min (108 weekdays) |

All converge on a `FeedItem` dataclass and push via `supabase_writer.insert_items()`,
which uses Postgres `INSERT ... ON CONFLICT DO NOTHING` semantics — so reruns are
idempotent and cheap. The DB itself is the dedup state; there's no local SQLite
or JSON state file to manage.

## One-time setup

### 1. Create the table in Supabase

In your Supabase project's SQL editor, paste and run `migrations/001_macro_feed.sql`.
This creates the table, the unique `(source, url)` index that makes upsert work,
and two query indexes. Row-level security is enabled with no public read policy,
so only the service role can read or write it. Add a `select` policy later if you
want your Next.js notes-app frontend to render the feed.

### 2. Set up the VPS

```bash
sudo apt update && sudo apt install -y python3 python3-venv

# clone or copy this directory to /opt/macro-scrapers
cd /opt/macro-scrapers
python3 -m venv .venv
source .venv/bin/activate

# stdlib-only scrapers need nothing more.
# For the RBC scraper (Playwright), install:
pip install playwright
playwright install chromium
sudo playwright install-deps chromium
```

### 3. Credentials

Create `/etc/macro-scrapers.env` (root-owned, 600 perms):

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc... (Project Settings → API → service_role)
```

Then ensure the cron job sources it:

```cron
17 */6 * * * . /etc/macro-scrapers.env && cd /opt/macro-scrapers && .venv/bin/python scrape_rbc_gam.py >> /var/log/macro/rbc.log 2>&1
23 8   * * * . /etc/macro-scrapers.env && cd /opt/macro-scrapers && python3 scrape_jpm_eotm.py     >> /var/log/macro/jpm.log 2>&1
31 7   * * 1-5 . /etc/macro-scrapers.env && cd /opt/macro-scrapers && python3 scrape_ubs_daily.py  >> /var/log/macro/ubs.log 2>&1
```

UBS runs weekdays only (matches their publishing pattern). JPM is daily but
catches the monthly podcast cadence with overhead. RBC every 6 hours catches
new MacroMemos within 6 hours of posting.

## Running locally (dry run)

If `SUPABASE_URL` isn't set, the scrapers run in **dry-run mode**: they fetch
and print, but don't push anywhere. Useful for testing before pointing at
production.

```bash
# Dry run
python3 scrape_jpm_eotm.py

# Real run
. /etc/macro-scrapers.env
python3 scrape_jpm_eotm.py
```

## Querying the data

From SQL editor or any Postgres client:

```sql
-- Everything new in the last 7 days
select published_date, source, title, url
  from macro_feed
  where first_seen_at > now() - interval '7 days'
  order by published_date desc;

-- Just JPM 2026 pieces
select * from macro_feed
  where source = 'jpm_eotm'
    and published_date >= '2026-01-01'
  order by published_date desc;
```

From the Next.js notes app (once you add a select policy):

```js
const { data } = await supabase
  .from('macro_feed')
  .select('*')
  .order('published_date', { ascending: false })
  .limit(50);
```

## Adding a new source

Each scraper is ~100–150 lines and follows the same pattern:

1. Define `SOURCE = "your_slug"` and `CUTOFF_DATE`.
2. Discover items somehow (RSS / API / HTML / URL enumeration).
3. Build `FeedItem(source, url, title, published_date, metadata)` for each.
4. Call `insert_items(items)` and pass the result to `log_summary()`.

Before scraping HTML, **check for an RSS feed, podcast feed, Substack
archive, or sitemap first**. The JPM scraper would have been a Playwright
nightmare if I'd missed the Podbean feed.

## Failure modes

- **Supabase down or wrong creds** → scraper exits 1, error in stderr.
- **Source site redesign** → scraper finds 0 items or 0 dates; check the
  source-specific README. For RBC, the "Load more" selector is most likely
  to break; for JPM, the podbean feed URL is stable; for UBS, the URL
  pattern has been consistent for years.
- **UBS rate limiting** → unlikely given polite 1.5s spacing, but if it
  happens you'll see HTTP errors; increase `SLEEP_BETWEEN_REQUESTS_S`.

## File layout

```
macro_scrapers/
├── README.md                       ← this file
├── migrations/
│   └── 001_macro_feed.sql          ← run once in Supabase SQL editor
├── supabase_writer.py              ← shared helper, stdlib only
├── scrape_rbc_gam.py               ← Playwright; ~30s
├── scrape_jpm_eotm.py              ← RSS; <1s
└── scrape_ubs_daily.py             ← date enumeration; ~3min first run
```
