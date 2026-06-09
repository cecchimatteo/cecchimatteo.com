-- ============================================================
-- Daybook schema
-- Run this in Supabase: SQL Editor → New query → paste → Run
-- ============================================================

-- ── diary_entries ──────────────────────────────────────────
CREATE TABLE diary_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date       DATE NOT NULL,
  hour       SMALLINT NOT NULL CHECK (hour >= 6 AND hour <= 24),
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date, hour)
);
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their diary entries"
  ON diary_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── vocab_words ────────────────────────────────────────────
CREATE TABLE vocab_words (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  word       TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  tags       TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vocab_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their vocab words"
  ON vocab_words FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── reading_items ──────────────────────────────────────────
CREATE TABLE reading_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('url', 'pdf')),
  title        TEXT NOT NULL,
  url          TEXT,
  source       TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  page_count   INTEGER,
  storage_path TEXT,        -- object storage path for PDFs
  file_name    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE reading_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their reading items"
  ON reading_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── note_sections ──────────────────────────────────────────
CREATE TABLE note_sections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE note_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their note sections"
  ON note_sections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── notes ──────────────────────────────────────────────────
CREATE TABLE notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  section_id UUID REFERENCES note_sections(id) ON DELETE CASCADE NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  html       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their notes"
  ON notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── updated_at trigger (reusable) ─────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_diary_entries_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_vocab_words_updated_at
  BEFORE UPDATE ON vocab_words
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reading_items_updated_at
  BEFORE UPDATE ON reading_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── PDF storage bucket ─────────────────────────────────────
-- Run this separately in Supabase Storage UI or via API:
-- Create a private bucket named "pdfs"
-- Policy: authenticated users can upload/read their own files (prefix: {user_id}/)
