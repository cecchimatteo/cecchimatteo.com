# TickTick integration — setup

Daybook's **Home** page reads + writes TickTick tasks via the official
[TickTick Open API](https://developer.ticktick.com/docs/index.html). Setup is
a one-time, ~5 minute job. You only need to do this once for your account.

## What this gives you

- Open tasks across every project (Inbox is excluded by the Open API).
- Full CRUD: create, edit, complete, delete, reschedule, set priority.
- Optimistic UI — actions feel instant; failures roll back.
- OAuth tokens are stored in your own Supabase (`ticktick_tokens` table,
  RLS-locked, refresh handled server-side).

## What this does NOT give you

The Open API is intentionally narrow:

- No completed-task **history** — you can mark things complete, but completed
  items disappear from the API soon after.
- No **habits** or **calendar events**.
- No **subtask editing** (read-only here; edit in TickTick).
- No **Inbox** in the project list — it isn't returned by the API.

If you need any of those later, we'd have to layer in the unofficial private
API, which requires storing your TickTick email/password — out of scope
unless you ask.

## Setup steps

### 1. Apply the Supabase migration

Run `supabase/ticktick_tokens.sql` in your Supabase SQL editor. It creates a
single table:

```sql
ticktick_tokens (
  user_id, access_token, refresh_token, token_type,
  scope, expires_at, created_at, updated_at
)
```

with RLS enforcing `auth.uid() = user_id`.

### 2. Register a TickTick developer app

1. Go to <https://developer.ticktick.com/manage>.
2. Click **+ App Name** and create a new app.
3. Once created, open it and click **Edit**.
4. Set the **Redirect URI** to:
   - Local dev: `http://localhost:3000/api/ticktick/callback`
   - Production: `https://your-domain.com/api/ticktick/callback`
   - You can register **multiple** redirect URIs (one per line). Add both.
5. Copy the **Client ID** and **Client Secret**.

### 3. Add env vars

Append to `.env.local` (create the file if needed — it's already gitignored):

```bash
TICKTICK_CLIENT_ID=your-client-id
TICKTICK_CLIENT_SECRET=your-client-secret

# Optional: pin the redirect URI explicitly. If unset, Daybook derives it
# from the incoming request origin, which works fine for local dev. In
# production behind a proxy, set this to the exact URL you registered.
# TICKTICK_REDIRECT_URI=https://your-domain.com/api/ticktick/callback
```

Restart the dev server (`npm run dev`).

### 4. Connect your account

1. Open <http://localhost:3000/home>.
2. Click **Connect TickTick**.
3. Authorize Daybook on the TickTick consent screen.
4. You'll bounce back to `/home?ticktick=connected` and tasks will load.

## Troubleshooting

| Error                              | Likely cause                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `invalid_state`                    | The OAuth state cookie expired (>10 min) or was blocked. Re-click Connect.    |
| `redirect_uri_mismatch`            | The URI you registered doesn't *exactly* match what Daybook sent. Check both. |
| `ticktick_not_connected` after a while | Refresh token may have been revoked. Click Disconnect, then Connect again. |
| `TickTick API 429`                 | Rate limited. Wait a minute. Daybook caches projects on the page.             |

## Architecture (one-paragraph version)

OAuth flow is split across three Next.js route handlers:
`/api/ticktick/authorize` (sets a CSRF cookie + redirects to TickTick),
`/api/ticktick/callback` (exchanges the code for tokens, upserts into
`ticktick_tokens`), and `/api/ticktick/status` (boolean for the UI).
All CRUD endpoints (`/projects`, `/tasks`, `/tasks/[id]`,
`/tasks/[id]/complete`) call `getValidAccessToken(userId)` which transparently
refreshes expired tokens. The browser never sees the `Client Secret` and never
sees the access token directly — every TickTick call is server-side.
