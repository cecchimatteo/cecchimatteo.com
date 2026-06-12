# TickTick integration — setup

Daybook's **Home** page reads + writes TickTick using the same private API
that the official mobile/web clients use. Setup is just two values in
`.env.local` and one Supabase migration.

## What this gives you

- **Inbox** + every project + tasks (open and completed history).
- **Habits** with a 30-day check-in window (read).
- **Tags**, smart filters, project groups.
- Full task **CRUD**: create, edit, complete, delete, reschedule, set priority.
- Optimistic UI — actions feel instant; failures roll back.
- Credentials encrypted at rest with **AES-256-GCM** in your own Supabase.
  The encryption key lives only in your server env.

## How it works (one paragraph)

We POST your email + password to TickTick's `signon` endpoint, get back a
session cookie, and use that for every subsequent call. When the cookie
expires, Daybook decrypts the stored password and re-signs-on transparently.
The full account state arrives in one call to `/api/v2/batch/check/0`
(projects, tasks, tags, columns, inbox id, project groups). Mutations go
through `/api/v2/batch/task` with `{ add, update, delete }` payloads. None
of this is officially documented or supported, but it's stable enough that
the official clients use it themselves.

## ⚠️ Caveats you must accept

- **Not officially supported.** TickTick can change endpoints in any release.
  Most projects targeting this API have to fix breakage 2–3 times per year.
- **2FA is a hard blocker.** If your TickTick account has 2FA on, the simple
  email/password sign-on can't complete the challenge. Turn 2FA off (or
  switch to the official Open API) before connecting.
- **Captcha challenges happen.** If TickTick demands a captcha for your IP
  (signal: HTTP 403 with `code: 2001`), sign in once at
  [ticktick.com](https://ticktick.com) in your browser, then retry. There's
  no programmatic captcha solve.
- **Treat the password as high-value.** Use a TickTick-only password.
  If `TICKTICK_ENC_KEY` ever leaks, encrypted passwords leak with it.
- **Region matters.** Global accounts use `ticktick.com`; Chinese accounts
  use `dida365.com`. Pick the right one in the sign-in form.

## Setup steps

### 1. Apply the migration

Run `supabase/ticktick_credentials.sql` in your Supabase SQL editor. It
creates a single table:

```sql
ticktick_credentials (
  user_id, email,
  password_ciphertext, password_iv, password_tag,
  region, cookie_t, cookie_expires_at,
  device_id, inbox_id, ticktick_user_id,
  last_signed_in_at, created_at, updated_at
)
```

with RLS enforcing `auth.uid() = user_id`. The migration also drops the old
`ticktick_tokens` table from the previous OAuth-based version.

### 2. Generate an encryption key

```bash
openssl rand -hex 32
```

### 3. Add it to `.env.local`

```bash
# 64 hex characters (32 random bytes). Treat as a secret.
TICKTICK_ENC_KEY=...your-64-hex-string...
```

That's it. No client ID, no client secret, no redirect URIs.

Restart `npm run dev`.

### 4. Sign in

Open <http://localhost:3000/home>, type your TickTick email + password,
choose the right region, click **Sign in**. Tasks will load.

## Disconnecting

The **Disconnect** link in the toolbar deletes your row from
`ticktick_credentials` (and therefore the encrypted password and cookie).
Daybook keeps no other TickTick data on disk.

## Troubleshooting

| Symptom                                               | Likely cause / fix                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Invalid email or password`                           | Self-explanatory. Reset via TickTick if needed.                                                                           |
| "TickTick is asking for a captcha"                    | Sign in at ticktick.com in your browser once, then retry the Daybook sign-in.                                             |
| `TICKTICK_ENC_KEY is not set`                         | Add the key to `.env.local` and restart `npm run dev`. The Home page detects this and shows a setup card.                |
| Tasks load on first sign-in but later requests 401    | Cookie expired. Refresh in the UI — Daybook will silently re-sign-on.                                                    |
| Sign-in works for you but fails on a deployed server  | TickTick is more captcha-aggressive on cloud IPs. Sign in once from a browser on the same IP, or self-host on a home box. |
| "It worked yesterday and broke today"                 | They probably changed something on their side. Open an issue with the failing endpoint + response body.                  |

## Architecture

OAuth is gone. The flow is now:

- `/api/ticktick/signin` (POST) — accepts `{ email, password, region }`,
  signs on, encrypts the password, stores the cookie. Returns `{ ok }` or a
  401/403 with a friendly error code.
- `/api/ticktick/status` (GET) — `{ connected, configured, email }`.
- `/api/ticktick/disconnect` (POST) — wipes the row.
- `/api/ticktick/all-tasks` (GET) — full state via `/batch/check/0`.
- `/api/ticktick/completed` (GET) — recent completed history.
- `/api/ticktick/habits` (GET) — habits + 30-day checkins.
- `/api/ticktick/tasks` (POST) — create.
- `/api/ticktick/tasks/[id]` (POST/DELETE) — update / delete.
- `/api/ticktick/tasks/[id]/complete` (POST) — mark complete.

Every call routes through `getValidAccessToken`-equivalent logic: load the
row, use the cached cookie, retry once with re-sign-on on 401/403/code 4001.
Browser code never sees credentials, the cookie, or the encryption key.
