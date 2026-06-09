-- Run this once in the Supabase SQL Editor
-- Stores the user's market watchlist (symbol + IBKR contract ID)

CREATE TABLE IF NOT EXISTS watchlist_items (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        REFERENCES auth.users NOT NULL,
  symbol     text        NOT NULL,
  conid      integer     NOT NULL,
  added_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, symbol)
);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own watchlist"
  ON watchlist_items FOR ALL
  USING (auth.uid() = user_id);
