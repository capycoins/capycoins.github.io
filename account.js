/* account.js - usernames + saving your capycoin progress to your Supabase account.
   Load it AFTER supabaseClient.js (and auth.js, if the page has one):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2"></script>
     <script src="supabaseClient.js"></script>
     <script src="auth.js"></script>
     <script src="account.js"></script>
   On game pages use data-prompt="false" so a game never pops up the username window.

   Everything the games keep in localStorage is saved here: the balance, the
   per-day earnings behind the 7-day chart, per-game earnings, clicks, best
   clicks per second, best scores, Whack-A-Capy stats, the fishing bag and the
   daily spin. Supabase needs the one-time security_hardening.sql migration.
   The database, rather than localStorage, is authoritative for signed-in users. */
(function () {
  'use strict';
  var KEY = 'capycoins_wallet_v1', OLD = 'capycoins_clicker_v1', META = 'capycoins_sync_v1';
  var NAME_RE = /^[A-Za-z0-9_]{3,16}$/, MAX_DAYS = 60;
  var GKEYS = {
    spin: 'capycoins_spin_v1',
    stack: 'capy_stack_best',
    dash: 'capycoins_dash_best',
    catch: 'capycoins_catch_best',
    whack: 'capycoins_whack_v1',
    fisher: 'capycoins_fisher_bag_v1'
  };
  /* a running game keeps its own copy in memory and writes the whole object
     back on save, so only pages that are NOT a game replace the per-game cache
     with the server copy; game pages just push what they have. */
  var IS_GAME = /\/games\//.test(location.pathname);
  var script = document.currentScript, ASK = !(script && script.dataset.prompt === 'false');

  var client = null;
  try { client = supabaseClient; } catch (e) {}      // stays null if the library or keys did not load

  var listeners = [], syncing = false, lastSig = '';
  var A = window.CapyAccount = {
    supported: !!(client && client.auth && client.from && client.rpc),
    user: null, profile: null, ready: false, status: 'signed-out', lastSync: null,
    onChange: function (cb) { listeners.push(cb); },
    syncNow: syncNow, promptUsername: promptUsername
  };
  function emit() {
    listeners.forEach(function (f) { try { f(A); } catch (e) {} });
    window.dispatchEvent(new CustomEvent('capy-account'));
  }
  function walletChanged() { window.dispatchEvent(new CustomEvent('capy-wallet-changed')); }

  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function int(v) { return Number(v) | 0; }
  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function readInt(key) { try { return parseInt(localStorage.getItem(key), 10) || 0; } catch (e) { return 0; } }
  function writeInt(key, n) { try { localStorage.setItem(key, String(n)); } catch (e) {} }
  function claimId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 3 | 8);
      return v.toString(16);
    });
  }

  /* ---------- the wallet kept in this browser (games write here) ---------- */
  function readW() {
    var w = { total: 0, clicks: 0, best: 0, days: {}, games: {} };
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s.total === 'number') {
        w.total = num(s.total); w.clicks = int(s.clicks); w.best = int(s.best);
        w.days = s.days || {}; w.games = s.games || {};
      } else {
        var o = JSON.parse(localStorage.getItem(OLD) || 'null');
        if (o) { w.total = num(o.cents); w.clicks = int(o.clicks); w.best = int(o.best); w.games.clicker = w.total; }
      }
    } catch (e) {}
    return w;
  }
  function writeW(w) { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch (e) {} }

  /* ---------- game-specific stats (kept under their own keys) ---------- */
  function readGameStats() {
    var o = {}, s;
    s = readJSON(GKEYS.spin);
    if (s && typeof s.last === 'string' && s.last) o.spin = { last: s.last, prize: int(s.prize) };
    s = readInt(GKEYS.stack); if (s > 0) o.stack = { best: s };
    s = readInt(GKEYS.dash); if (s > 0) o.dash = { best: s };
    s = readInt(GKEYS.catch); if (s > 0) o.catch = { best: s };
    s = readJSON(GKEYS.whack);
    if (s) o.whack = { rounds: int(s.rounds), whacks: int(s.whacks), best: int(s.best), streak: int(s.streak) };
    s = readJSON(GKEYS.fisher);
    if (s) o.fisher = { caught: int(s.caught), inv: (s.inv && typeof s.inv === 'object') ? s.inv : {} };
    return o;
  }
  function hydrateGameStats(st, gamePage) {
    if (!st || typeof st !== 'object') return;
    var cur;
    if (st.spin && st.spin.last) {                            // the spin page reads this live, so it is always safe
      cur = readJSON(GKEYS.spin);
      if (!cur || String(st.spin.last) >= String(cur.last || '')) {
        writeJSON(GKEYS.spin, { last: String(st.spin.last), prize: int(st.spin.prize) });
      }
    }
    if (gamePage) return;                                    // a running game holds its own copy in memory
    if (st.stack && int(st.stack.best) > readInt(GKEYS.stack)) writeInt(GKEYS.stack, int(st.stack.best));
    if (st.dash && int(st.dash.best) > readInt(GKEYS.dash)) writeInt(GKEYS.dash, int(st.dash.best));
    if (st.catch && int(st.catch.best) > readInt(GKEYS.catch)) writeInt(GKEYS.catch, int(st.catch.best));
    if (st.whack) {
      cur = readJSON(GKEYS.whack) || {};
      writeJSON(GKEYS.whack, {
        rounds: Math.max(int(cur.rounds), int(st.whack.rounds)),
        whacks: Math.max(int(cur.whacks), int(st.whack.whacks)),
        best: Math.max(int(cur.best), int(st.whack.best)),
        streak: Math.max(int(cur.streak), int(st.whack.streak))
      });
    }
    if (st.fisher) {
      writeJSON(GKEYS.fisher, {
        inv: (st.fisher.inv && typeof st.fisher.inv === 'object') ? st.fisher.inv : {},
        caught: int(st.fisher.caught)
      });
    }
  }

  /* ---------- what the server already knows (meta) ----------
     meta.base/days/games/clicks = the part of this browser's cache the server
     has. Anything above it is new, and is ADDED to the server (never overwrites). */
  function getMeta() { var m = readJSON(META); return (m && typeof m === 'object') ? m : {}; }
  function setMeta(m) { writeJSON(META, m); }

  function deltas(now, base) {
    var out = {}, k, d;
    Object.keys(now || {}).forEach(function (k) {
      d = num(now[k]) - num((base || {})[k]);
      if (d > 0) out[k] = d;
    });
    return out;
  }
  function pruneDays(map) {
    var keys = Object.keys(map || {}).sort().slice(-MAX_DAYS), out = {};
    keys.forEach(function (k) { out[k] = num(map[k]); });
    return out;
  }
  function pendingProgress(w, gs, meta) {
    var b = meta.stats || {}, p = {
      total: Math.max(0, num(w.total) - num(meta.base)),
      clicks: Math.max(0, int(w.clicks) - int(meta.clicks)),
      best: int(w.best),
      days: deltas(w.days, meta.days),
      games: deltas(w.games, meta.games),
      stats: {}
    };
    ['stack', 'dash', 'catch'].forEach(function (g) {
      if (gs[g] && int(gs[g].best) > 0) p.stats[g] = { best: int(gs[g].best) };
    });
    if (gs.whack) {
      var bw = b.whack || {};
      p.stats.whack = {
        rounds: Math.max(0, int(gs.whack.rounds) - int(bw.rounds)),
        whacks: Math.max(0, int(gs.whack.whacks) - int(bw.whacks)),
        best: int(gs.whack.best),
        streak: int(gs.whack.streak)
      };
    }
    if (gs.fisher) {
      var bf = b.fisher || {}, binv = bf.inv || {}, inv = {}, ik = {};
      Object.keys(gs.fisher.inv || {}).forEach(function (k) { ik[k] = 1; });
      Object.keys(binv).forEach(function (k) { ik[k] = 1; });          // sold items disappear locally, so check both sides
      Object.keys(ik).forEach(function (k) {
        var d = int((gs.fisher.inv || {})[k]) - int(binv[k]);
        if (d !== 0) inv[k] = d;
      });
      p.stats.fisher = { caught: Math.max(0, int(gs.fisher.caught) - int(bf.caught)), inv: inv };
    }
    if (gs.spin && gs.spin.last) p.stats.spin = { last: gs.spin.last, prize: int(gs.spin.prize) };
    return p;
  }
  function localSig() {
    var w = readW(), gs = readGameStats();
    return JSON.stringify([w.total, w.clicks, w.best, w.days, w.games, gs]);
  }
  function resetLocal() {
    writeW({ total: 0, clicks: 0, best: 0, days: {}, games: {} });
    Object.keys(GKEYS).forEach(function (g) { try { localStorage.removeItem(GKEYS[g]); } catch (e) {} });
    walletChanged();
  }

  /* ---------- saving ---------- */
  async function syncNow() {
    if (!A.supported || !A.user || syncing) return;
    syncing = true; A.status = 'syncing';
    try {
      var uid = A.user.id, meta = getMeta();
      if (meta.uid && meta.uid !== uid) { resetLocal(); meta = { uid: uid, base: 0 }; }   // leftovers from another account never carry over
      else if (!meta.uid) {
        /* localStorage is user-controlled. Never import anonymous/local balances
           into an authenticated account; establish them as the local baseline and
           let the server snapshot replace them below. */
        var initialW = readW(), initialG = readGameStats();
        meta = {
          v: 3, uid: uid, base: initialW.total, clicks: initialW.clicks,
          best: initialW.best, days: initialW.days, games: initialW.games,
          stats: initialG
        };
        setMeta(meta);
      }

      /* Keep the exact claim until it is acknowledged. If the response is lost,
         retrying uses the same UUID and the database returns the prior result
         instead of paying the claim twice. */
      var pending = meta.pending;
      if (!pending || !pending.id || !pending.progress || !pending.wallet || !pending.gameStats) {
        var currentW = readW(), currentG = readGameStats();
        pending = {
          id: claimId(),
          progress: pendingProgress(currentW, currentG, meta),
          wallet: currentW,
          gameStats: currentG
        };
        meta.pending = pending;
        setMeta(meta);
      }
      var p = pending.progress, w0 = pending.wallet, g0 = pending.gameStats;
      var r = await client.rpc('secure_sync_progress', {
        p_claim_id: pending.id,
        p_games: p.games,
        p_clicks: p.clicks,
        p_best: p.best,
        p_stats: p.stats
      });

      if (r.error) throw r.error;
      var snap = r.data;
      if (!snap || typeof snap !== 'object' || snap.total_cents == null) throw new Error('sync_progress returned no snapshot');
      applySnapshot(snap, w0, g0, uid);
      A.status = 'saved'; A.lastSync = new Date().toISOString();
      lastSig = localSig();
    } catch (e) {
      A.status = 'error';
      if (window.console) console.warn('capycoins: could not save progress', e);
    } finally {
      syncing = false;
      emit();
    }
  }

  function applySnapshot(snap, w0, g0, uid) {
    var w = readW(), gs = readGameStats();
    var snapDays = snap.days || {}, snapGames = snap.games || {}, st = snap.game_stats || {};
    var newDays = {}, newGames = {}, extra;

    Object.keys(snapDays).forEach(function (d) { newDays[d] = num(snapDays[d]); });
    Object.keys(w.days).forEach(function (d) {
      extra = num(w.days[d]) - num(w0.days[d]);             // earned while the request was in flight
      if (extra > 0) newDays[d] = num(newDays[d]) + extra;
    });
    Object.keys(snapGames).forEach(function (g) { newGames[g] = num(snapGames[g]); });
    Object.keys(w.games).forEach(function (g) {
      extra = num(w.games[g]) - num(w0.games[g]);
      if (extra > 0) newGames[g] = num(newGames[g]) + extra;
    });

    writeW({
      total: num(snap.total_cents) + Math.max(0, num(w.total) - num(w0.total)),
      clicks: int(snap.clicks) + Math.max(0, int(w.clicks) - int(w0.clicks)),
      best: Math.max(int(w.best), int(snap.best_cps)),
      days: pruneDays(newDays),
      games: newGames
    });
    hydrateGameStats(st, IS_GAME);                           // game pages only refresh the daily spin

    setMeta({
      v: 3, uid: uid,
      base: num(snap.total_cents),
      clicks: int(snap.clicks),
      best: int(snap.best_cps),
      days: pruneDays(snapDays),
      games: snapGames,
      /* game pages keep their own in-memory counters, so their base stays what
         this device actually sent; the wallet above was hydrated and is fine. */
      stats: IS_GAME ? g0 : st
    });
    if (A.profile) A.profile.total_cents = num(snap.total_cents);
    walletChanged();
  }

  /* ---------- profile + username ---------- */
  async function loadProfile() {
    var r = await client.from('profiles').select('username,total_cents').eq('id', A.user.id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) {
      var ins = await client.from('profiles').insert({ id: A.user.id });
      if (ins.error && ins.error.code !== '23505') throw ins.error;
      A.profile = { username: null, total_cents: 0 };
    } else A.profile = { username: r.data.username, total_cents: Number(r.data.total_cents) };
  }
  async function onSession(session, force) {
    var u = (session && session.user) || null;
    if (!force && A.ready && (u ? u.id : null) === (A.user ? A.user.id : null)) return;
    A.user = u;
    if (!u) { A.profile = null; A.status = 'signed-out'; A.ready = true; emit(); return; }
    try { await loadProfile(); } catch (e) { if (window.console) console.warn('capycoins: profile', e); A.profile = A.profile || { username: null, total_cents: 0 }; }
    A.ready = true; emit();
    await syncNow();
    if (ASK && A.profile && !A.profile.username) {
      var asked = false; try { asked = sessionStorage.getItem('capy_asked'); } catch (e) {}
      if (!asked) { try { sessionStorage.setItem('capy_asked', '1'); } catch (e) {} promptUsername(true); }
    }
  }

  var dlg, input, msg, title, sub, later;
  function buildDialog() {
    var st = document.createElement('style');
    st.textContent =
      '.capy-dlg{position:fixed;margin:auto;border:3px solid #4a2c1d;border-radius:26px;padding:26px 28px 22px;background:#fff7ee;color:#4a2c1d;max-width:400px;width:calc(100% - 32px);box-shadow:0 8px 0 #4a2c1d;font-family:Fredoka,"Arial Rounded MT Bold","Trebuchet MS",sans-serif;font-size:1.05rem}' +
      '.capy-dlg::backdrop{background:rgba(74,44,29,.5)}' +
      '.capy-dlg h2{font-family:Chewy,"Comic Sans MS",cursive;font-weight:400;font-size:2rem;margin:0 0 4px}' +
      '.capy-dlg p{margin:0 0 10px;color:#7a5240;font-size:1rem}' +
      '.capy-dlg input{width:100%;font:inherit;padding:10px 14px;border:3px solid #4a2c1d;border-radius:16px;background:#fff;color:#4a2c1d}' +
      '.capy-dlg .msg{min-height:1.4em;margin:8px 0 0;color:#c2410c;font-weight:500}' +
      '.capy-dlg .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}' +
      '.capy-dlg .go{font:inherit;font-weight:600;padding:10px 24px;border-radius:999px;border:3px solid #4a2c1d;background:#ffe08a;color:#4a2c1d;box-shadow:0 4px 0 #4a2c1d;cursor:pointer}' +
      '.capy-dlg .go:disabled{opacity:.6}' +
      '.capy-dlg .later{font:inherit;background:none;border:0;color:#7a5240;text-decoration:underline dotted;cursor:pointer}';
    document.head.appendChild(st);
    dlg = document.createElement('dialog'); dlg.className = 'capy-dlg'; dlg.setAttribute('aria-labelledby', 'capyNameTitle');
    dlg.innerHTML = '<h2 id="capyNameTitle"></h2><p class="sub"></p><form novalidate>' +
      '<label for="capyNameInput" style="position:absolute;left:-9999px">Username</label>' +
      '<input id="capyNameInput" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="capy_fan">' +
      '<p class="msg" role="alert"></p><div class="row"><button class="go" type="submit">Save username</button>' +
      '<button class="later" type="button">Maybe later</button></div></form>';
    document.body.appendChild(dlg);
    title = dlg.querySelector('h2'); sub = dlg.querySelector('.sub'); input = dlg.querySelector('input'); msg = dlg.querySelector('.msg'); later = dlg.querySelector('.later');
    later.addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.querySelector('form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = input.value.trim(), go = dlg.querySelector('.go');
      if (!NAME_RE.test(v)) { msg.textContent = 'Use 3 to 16 letters, numbers or underscores.'; return; }
      go.disabled = true; msg.textContent = 'Saving…';
      try {
        var r = await client.from('profiles').update({ username: v }).eq('id', A.user.id).select('username').single();
        if (r.error) {
          msg.textContent = r.error.code === '23505' ? 'Sorry, that username is taken. Try another!' :
                            r.error.code === '23514' ? 'Use 3 to 16 letters, numbers or underscores.' : 'Could not save: ' + r.error.message;
        } else { A.profile.username = r.data.username; dlg.close(); emit(); }
      } catch (err) { msg.textContent = 'Could not save: ' + err.message; }
      go.disabled = false;
    });
  }
  function promptUsername(first) {
    if (!A.supported || !A.user) return;
    if (!dlg) buildDialog();
    var has = A.profile && A.profile.username;
    title.textContent = has ? 'Change username' : 'Pick a username';
    sub.textContent = has ? 'Pick a new name (3 to 16 letters, numbers or underscores).' : 'Choose a name for your capycoins account. 3 to 16 letters, numbers or underscores.';
    later.textContent = first ? 'Maybe later' : 'Cancel';
    input.value = has ? A.profile.username : ''; msg.textContent = '';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    input.focus();
  }

  /* ---------- start ---------- */
  if (A.supported) {
    client.auth.onAuthStateChange(function (ev, session) {
      if (ev === 'TOKEN_REFRESHED') return;
      setTimeout(function () { onSession(session, false); }, 0);
    });
    client.auth.getSession().then(function (r) { if (!A.ready) onSession(r.data && r.data.session, false); }).catch(function () {});
    var tick = 0;
    setInterval(function () {                                  // save new progress within ~5 seconds, refresh from the account every 30
      if (!A.user || document.hidden) return;
      tick++;
      var sig = localSig();
      if (sig !== lastSig || tick % 6 === 0) syncNow();
    }, 5000);
    document.addEventListener('visibilitychange', function () { if (document.hidden) syncNow(); });
    window.addEventListener('pagehide', function () { syncNow(); });
    // signing out: save first, then clear this browser's copy so the next person on this device starts fresh
    if (typeof window.handleSignOut === 'function') {
      var orig = window.handleSignOut;
      window.handleSignOut = async function () {
        try { await syncNow(); } catch (e) {}
        try {
          localStorage.removeItem(KEY); localStorage.removeItem(META);
          Object.keys(GKEYS).forEach(function (g) { localStorage.removeItem(GKEYS[g]); });
        } catch (e) {}
        walletChanged();
        return orig.apply(this, arguments);
      };
    }
  } else { A.ready = true; }
})();
