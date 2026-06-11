-- Per-hour satisfaction rating (1 = poor, 5 = great).
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS diary_hour_ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date       DATE NOT NULL,
  hour       SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 24),
  rating     SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date, hour)
);

ALTER TABLE diary_hour_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their diary hour ratings" ON diary_hour_ratings;
CREATE POLICY "Users own their diary hour ratings"
  ON diary_hour_ratings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_diary_hour_ratings_updated_at ON diary_hour_ratings;
CREATE TRIGGER trg_diary_hour_ratings_updated_at
  BEFORE UPDATE ON diary_hour_ratings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS diary_hour_ratings_user_date_idx
  ON diary_hour_ratings (user_id, date);
