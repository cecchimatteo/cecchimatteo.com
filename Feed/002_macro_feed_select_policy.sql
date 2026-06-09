-- Allow the Notetaker app (authenticated users) to read the macro feed.
--
-- 001_macro_feed.sql enabled RLS with no policies — service role only.
-- This migration adds a SELECT policy for any authenticated user so the
-- Feed page in the Next.js app can render the data via the anon client
-- + user JWT.
--
-- Writes remain locked to the service-role key used by the scrapers
-- on the VPS.
--
-- Run this once in the Supabase SQL editor after 001_macro_feed.sql.

drop policy if exists "Authenticated users can read macro_feed" on public.macro_feed;

create policy "Authenticated users can read macro_feed"
    on public.macro_feed
    for select
    to authenticated
    using (true);
