-- Allow hour = 0 for daily notes (run once in Supabase SQL Editor)
ALTER TABLE diary_entries DROP CONSTRAINT diary_entries_hour_check;
ALTER TABLE diary_entries ADD CONSTRAINT diary_entries_hour_check CHECK (hour >= 0 AND hour <= 24);
