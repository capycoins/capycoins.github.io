/* theme.js - makes every capycoins page follow the day / evening switch from the home page.
   The choice is saved under "capycoins_time". Load it in the <head> so the page never flashes light. */
(function () {
  var K = 'capycoins_time';
  function pref() { try { return localStorage.getItem(K) === 'night' ? 'night' : 'day'; } catch (e) { return 'day'; } }
  function apply() { document.documentElement.setAttribute('data-time', pref()); }
  apply();
  window.addEventListener('storage', function (e) { if (e.key === K) apply(); });   // follows changes made in another tab
  var st = document.createElement('style');
  st.textContent =
    'html[data-time=night]{--cocoa-soft:#f3d9e6}' +
    'html[data-time=night] body{color:#fff4e6;background:radial-gradient(circle at 20% 20%,rgba(255,183,197,.22) 0 2px,transparent 3px) 0 0/46px 46px,linear-gradient(180deg,#2b2350,#6b4a7a);background-attachment:fixed}' +
    /* cards, buttons and badges stay cream with dark text, like the home page */
    'html[data-time=night] :is(.stat,.panel,.tile,.item,.gitem,.card,.g,.step,.plist div,.back,.toast,.beta,.go,.bar,.col,.pill){color:#4a2c1d;--cocoa-soft:#7a5240}' +
    'html[data-time=night] .stage{background:#2b2350}' +
    'html[data-time=night] canvas{filter:brightness(.74) saturate(1.05)}' +
    'html[data-time=night] .overlay{background:rgba(28,20,58,.72)}' +
    'html[data-time=night] .overlay p{color:#fff4e6}';
  document.head.appendChild(st);
})();