# capycoins
### capycoins is a website where you play various minigames to earn currency called capycoins!
Minigames:
* Capybara Clicker
* Capybara Catch
* Capybara Dash
* Capybara Fisher
* Capybara Stack
* Daily Spin
* Whack-A-Capy

### saving progress
Signing in saves the whole player profile to Supabase: balance, per-day earnings (the Dashboard's 7-day chart), per-game earnings, clicks, best clicks per second, best scores, Whack-A-Capy stats, the fishing bag and the daily spin. Other devices load it back automatically.

Database setup (one time): run `security_hardening.sql` in the Supabase SQL editor **before** deploying the matching `account.js`. It makes the database authoritative, enables strict row-level security, rate-limits awards, records an audit trail and disables the old arbitrary-increment functions.

### security
The browser and `localStorage` are untrusted. Signed-in balances may only change through `secure_sync_progress`; direct profile balance updates and the legacy `add_cents`/`sync_progress` functions are unavailable to browser roles. Claims use persistent UUIDs so retries cannot pay twice, per-game token buckets limit automation damage, and accounts have a 500-capcoin daily ceiling. See `SECURITY.md` before changing rewards or database policies.

### issues
If you find any issues please report them here in GitHub! Or, contact me in Discord (username is imperialcapybara). Make sure to tell me that you are reporting an issue in the text of the DM request
