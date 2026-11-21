/* account.js - usernames + saving your capycoin balance to your Supabase account.
   Load it AFTER supabaseClient.js (and auth.js, if the page has one):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="supabaseClient.js"></script>
     <script src="auth.js"></script>
     <script src="account.js"></script>
   On game pages use data-prompt="false" so a game never pops up the username window. */
(function () {
  'use strict';
  var KEY = 'capycoins_wallet_v1', OLD = 'capycoins_clicker_v1', META = 'capycoins_sync_v1';
  var CHUNK = 200000, NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  var script = document.currentScript, ASK = !(script && script.dataset.prompt === 'false');

  var client = null;
  try { client = supabaseClient; } catch (e) {}      // stays null if the library or keys did not load

  var listeners = [], syncing = false;
  var A = window.CapyAccount = {
    supported: !!(client && client.auth && client.from && client.rpc),
    user: null, profile: null, ready: false, status: 'signed-out',
    onChange: function (cb) { listeners.push(cb); },
    syncNow: syncNow, promptUsername: promptUsername
  };
  function emit() {
    listeners.forEach(function (f) { try { f(A); } catch (e) {} });
    window.dispatchEvent(new CustomEvent('capy-account'));
  }
  function walletChanged() { window.dispatchEvent(new CustomEvent('capy-wallet-changed')); }

  /* ---------- the wallet kept in this browser (games write here) ---------- */
  function readW() {
    var w = { total: 0, clicks: 0, best: 0, days: {}, games: {} };
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s.total === 'number') { w.total = s.total | 0; w.clicks = s.clicks | 0; w.best = s.best | 0; w.days = s.days || {}; w.games = s.games || {}; }
      else { var o = JSON.parse(localStorage.getItem(OLD) || 'null'); if (o) { w.total = o.cents | 0; w.clicks = o.clicks | 0; w.best = o.best | 0; w.games.clicker = w.total; } }
    } catch (e) {}
    return w;
  }
  function setLocalTotal(n) {
    var w = readW(); w.total = n;
    try { localStorage.setItem(KEY, JSON.stringify(w)); } catch (e) {}
    walletChanged();
  }
  function getMeta() { try { return JSON.parse(localStorage.getItem(META) || 'null') || {}; } catch (e) { return {}; } }
  function setMeta(m) { try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) {} }

  /* ---------- saving the balance ----------
     meta.base = the part of this browser's balance the server already knows about.
     Anything above it is new, and gets ADDED to the server total (never overwrites it). */
  async function syncNow() {
    if (!A.supported || !A.user || syncing) return;
    syncing = true; A.status = 'syncing';
    try {
      var uid = A.user.id, meta = getMeta();
      if (meta.uid && meta.uid !== uid) { setLocalTotal(0); meta = { uid: uid, base: 0 }; }   // leftovers from another account never carry over
      else if (!meta.uid) { meta = { uid: uid, base: 0 }; }                                      // first time here: claim coins earned before signing in
      var L0 = readW().total, left = Math.max(0, L0 - (meta.base | 0)), S = null;
      do {
        var c = Math.min(left, CHUNK);
        var r = await client.rpc('add_cents', { delta: c });
        if (r.error) throw r.error;
        S = Number(r.data); left -= c;
      } while (left > 0);
      var extra = Math.max(0, readW().total - L0);        // coins earned while we were talking to the server
      setLocalTotal(S + extra); setMeta({ uid: uid, base: S });
      if (A.profile) A.profile.total_cents = S;
      A.status = 'saved';
    } catch (e) { A.status = 'error'; if (window.console) console.warn('capycoins: could not save balance', e); }
    finally { syncing = false; emit(); }
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
    setInterval(function () {                                  // save new coins within ~5 seconds, and refresh every 30
      if (!A.user || document.hidden) return;
      tick++;
      var pending = readW().total - (getMeta().base | 0);
      if (pending > 0 || tick % 6 === 0) syncNow();
    }, 5000);
    document.addEventListener('visibilitychange', function () { if (document.hidden) syncNow(); });
    window.addEventListener('pagehide', function () { syncNow(); });
    // signing out: save first, then clear this browser's copy so the next person on this device starts fresh
    if (typeof window.handleSignOut === 'function') {
      var orig = window.handleSignOut;
      window.handleSignOut = async function () {
        try { await syncNow(); } catch (e) {}
        try { localStorage.removeItem(KEY); localStorage.removeItem(META); } catch (e) {}
        return orig.apply(this, arguments);
      };
    }
  } else { A.ready = true; }
})();