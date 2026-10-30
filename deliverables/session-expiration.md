# Login session expiration

Migration `0106_session_expiration.sql` requires migration 0105 and the current
Supabase Auth `sessions` schema. It adds no subscription requirement or new key.

- A login expires after 30 minutes without reported user activity, or 12 hours
  from its original Auth session creation, whichever comes first.
- The warning appears one minute before expiration. **Stay signed in** extends
  inactivity only while that login is still valid. The absolute limit cannot be
  extended without authenticating again.
- The maximum-duration warning allows **Continue working** to save work during
  the remaining minute. This dismisses the warning, not the deadline.
- Reloads, tab focus, status polling, background requests, notifications, and
  automatic access-token refresh never extend the inactivity deadline.
- Trusted keyboard, pointer, wheel and touch activity is batched at most once
  per 15 seconds. Other tabs sharing that login read the same server deadlines.
- Timestamps and session ownership are checked in PostgreSQL, not localStorage
  or a browser-supplied timestamp. Expired sessions cannot be renewed by calling
  the activity RPC. They require another password login or valid email link.

`app_user_sessions` is private. Restrictive policies add session validity to
existing table/Storage policies without granting new permissions. The Data API
pre-request hook also protects security-definer RPCs. It must not be replaced
without retaining the session check. New public tables must include this
restrictive policy; the migration covers tables present at installation time.

Supabase Auth's own refresh endpoint is unchanged. A still-valid JWT cannot read
or change protected database records after the application deadline. Already
downloaded content and previously issued signed file URLs cannot be recalled by
logging out; their existing expiry remains applicable.

After installing the migration, restart Next.js and the backup worker, then
sign in again. Existing logins older than the inactivity window expire when
checked. Keep normal Supabase JWT expiration/rotation enabled.

Create a fresh backup after this schema change. As with other migrations, older
packages have a different schema fingerprint and cannot be used for automatic
same-schema restoration. Recovery invalidates Auth sessions and their timeout
rows; it preserves accounts, roles and business records.

The Settings backup worker uses privileged server credentials and is not a
browser login, so it is not subject to this inactivity timer. Database/application
failures are handled without granting an unlimited session.

Validation:

```powershell
node --test lib/auth/session-monitor.test.mjs lib/auth/session-server.test.mjs
# PostgreSQL policy tests use the existing isolated PGlite validation install:
$env:NODE_PATH=Join-Path $env:TEMP 'idrmm-sql-validation/node_modules'
node --test scripts/session-expiration.test.mjs
Remove-Item Env:NODE_PATH
```
