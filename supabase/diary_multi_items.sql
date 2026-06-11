-- Allow multiple diary entries per (user, date, hour).
-- Run once in Supabase SQL Editor.
--
-- Each row in diary_entries is now a single "item" that the user added.
-- The daily note (hour = 0) is still constrained to one row per day via a
-- partial unique index so we can keep its one-text-per-day semantic.

ALTER TABLE diary_entries
  DROP CONSTRAINT IF EXISTS diary_entries_user_id_date_hour_key;

CREATE UNIQUE INDEX IF NOT EXISTS diary_one_daily_note_per_day
  ON diary_entries (user_id, date)
  WHERE hour = 0;

-- Helpful index for the typical query (load all items for a given day).
CREATE INDEX IF NOT EXISTS diary_entries_user_date_idx
  ON diary_entries (user_id, date);
