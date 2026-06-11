-- ============================================================
-- TickTick OAuth tokens
-- One row per user. Holds the access + refresh tokens we got from
-- TickTick during the OAuth flow. RLS-locked so a user can only
-- see/modify their own row.
-- ============================================================

CREATE TABLE IF NOT EXISTS ticktick_tokens (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  scope         TEXT NOT NULL DEFAULT '',
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticktick_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their ticktick tokens"
  ON ticktick_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_ticktick_tokens_updated_at
  BEFORE UPDATE ON ticktick_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
