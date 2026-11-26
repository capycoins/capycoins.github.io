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

Database setup (one time): run `supabase_progress.sql` in the Supabase SQL editor. Until it is run, balances still save through the old `add_cents` function, but the extra stats stay browser-only.

### issues
If you find any issues please report them here in GitHub! Or, contact me in Discord (username is imperialcapybara). Make sure to tell me that you are reporting an issue in the text of the DM request