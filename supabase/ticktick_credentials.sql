-- ============================================================
-- TickTick credentials (unofficial / private API)
--
-- Stores the user's TickTick email + password (AES-256-GCM encrypted)
-- and the most recent session cookie. Daybook signs in on the user's
-- behalf and re-signs in transparently when the cookie expires.
--
-- One row per Daybook user. RLS-locked so a user can only see their
-- own row. The encryption key (TICKTICK_ENC_KEY) lives only in the
-- server env, so even a database leak does not expose passwords.
-- ============================================================

-- Drop the old OAuth-based table if you ran the previous migration.
DROP TABLE IF EXISTS ticktick_tokens;

CREATE TABLE IF NOT EXISTS ticktick_credentials (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                TEXT NOT NULL,
  -- AES-256-GCM, base64-encoded:
  password_ciphertext  TEXT NOT NULL,
  password_iv          TEXT NOT NULL,
  password_tag         TEXT NOT NULL,
  region               TEXT NOT NULL DEFAULT 'global'
                         CHECK (region IN ('global', 'china')),
  -- Most recent session cookie value (the `t` cookie). NULL means
  -- "sign in next request". Cookie is short-ish-lived; on 401 we
  -- re-sign-on with the stored credentials.
  cookie_t             TEXT,
  cookie_expires_at    TIMESTAMPTZ,
  -- TickTick assigns each device a UUID; we generate one on first
  -- sign-on and reuse it so the server doesn't think every request
  -- is from a new device.
  device_id            TEXT NOT NULL,
  inbox_id             TEXT,
  ticktick_user_id     TEXT,
  last_signed_in_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticktick_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their ticktick credentials"
  ON ticktick_credentials FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_ticktick_credentials_updated_at
  BEFORE UPDATE ON ticktick_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
