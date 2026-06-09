-- macro_feed: unified table for all scraper sources (RBC, JPM, UBS, ...).
-- Run this once in the Supabase SQL editor before pointing scrapers at the project.
--
-- Design notes:
--   * `source` is a short slug per scraper ('rbc_macromemo', 'jpm_eotm', 'ubs_daily').
--     Add new sources without touching the schema.
--   * `(source, url)` is the natural key for deduplication. Scrapers upsert
--     with ON CONFLICT DO NOTHING, so reruns are idempotent and cheap.
--   * `metadata` jsonb absorbs source-specific fields (podbean URL, author,
--     reading time, etc.) without forcing schema changes.
--   * `first_seen_at` records when *we* first ingested it, distinct from
--     `published_date` which is when the publisher dated it.

create table if not exists public.macro_feed (
    id              bigserial primary key,
    source          text        not null,
    url             text        not null,
    title           text        not null,
    published_date  date        not null,
    metadata        jsonb       not null default '{}'::jsonb,
    first_seen_at   timestamptz not null default now()
);

-- One row per (source, url). This is what makes idempotent upsert work.
create unique index if not exists macro_feed_source_url_uniq
    on public.macro_feed (source, url);

-- Common query: "give me everything newest first across sources".
create index if not exists macro_feed_pub_date_idx
    on public.macro_feed (published_date desc, first_seen_at desc);

-- Common query: "give me everything from source X newest first".
create index if not exists macro_feed_source_pub_date_idx
    on public.macro_feed (source, published_date desc);

-- Row-level security: enable RLS so anon clients can't read it, then explicitly
-- let the service role bypass (which it does by default — the service role
-- ignores RLS). The frontend on the notes app should NOT touch this table
-- without your explicit policy; if you eventually want to render the feed
-- on your site, add a policy here like:
--
--     create policy "public read" on public.macro_feed
--         for select to anon using (true);
--
-- For now, locked down. Service role only.
alter table public.macro_feed enable row level security;
