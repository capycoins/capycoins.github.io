# Capycoins security

## Deployment order

1. Back up the Supabase project.
2. Run `security_hardening.sql` in the Supabase SQL editor.
3. Confirm that authenticated users cannot call `add_cents` or `sync_progress`.
4. Deploy this branch's `account.js` and HTML files together.
5. Test sign-up, sign-in, username changes, every game, cross-device sync and the leaderboard with a non-admin account.

Do not deploy the client first. It intentionally has no insecure fallback and cannot save signed-in progress until the migration exists.

## Security model

- The Supabase publishable key is public by design. Never put a service-role key in this repository.
- The browser, game JavaScript, event `isTrusted` flags and `localStorage` are not security boundaries.
- `profiles.total_cents`, progress and game statistics are database-owned. Browser roles can select their own profile, insert an empty profile and update only `username`.
- `secure_sync_progress` is a `security definer` RPC with a fixed `search_path`. It accepts known games only, caps request sizes, deduplicates claim UUIDs, serializes concurrent claims, applies per-game token buckets and enforces a daily award ceiling.
- `capycoin_claims` is the audit trail. Rows with a non-empty `rejected` object indicate claims that exceeded an allowed rate or contained invalid amounts.
- Every page has a restrictive Content Security Policy and no-referrer policy. Inline scripts are still allowed because the existing games are inline; moving them to separate files would allow that exception to be removed later.

## Important limitation

No static browser game can prove that a human played it. A bookmarklet can still automate gameplay. The server controls the maximum value that automation can extract, prevents direct unlimited balance edits and leaves evidence for review. Stronger bot resistance would require server-issued game sessions or replay verification, not more JavaScript checks.

## Operations

Review suspicious activity periodically:

```sql
select user_id, created_at, requested, awarded, rejected
from public.capycoin_claims
where rejected <> '{}'::jsonb
order by created_at desc
limit 100;
```

The rate values are in `security_hardening.sql`. Tune them from real legitimate-play data; do not increase them solely because a client asks for more. The current global ceiling is 50,000 cents (500 capycoins) per UTC day.

If abuse is confirmed, disable or remove the account through Supabase Auth. Do not expose the claim tables to `anon` or `authenticated` roles.

## Reporting

Security reports should include the affected game, reproduction steps, impact and whether the issue works against a signed-in account. Do not post working balance-inflation payloads publicly before a fix is deployed.
