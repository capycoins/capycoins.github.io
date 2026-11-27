/* format.js - shows big capycoin amounts the short way: 1.23K, 4.5M, 2B ...
   CapyFormat.cc(cents)    -> "999.99", "1K", "12.3K", "1.23M", "1B", "1T"
   CapyFormat.exact(cents) -> "1,234,567.89" (used for hover tooltips)
   Amounts are in CENTS (100 cents = 1 capycoin). */
(function () {
  var UNITS = [['K', 1e3], ['M', 1e6], ['B', 1e9], ['T', 1e12]];
  function trim(n) { return n < 10 ? Math.round(n * 100) / 100 : (n < 100 ? Math.round(n * 10) / 10 : Math.round(n)); }
  function cc(cents) {
    var x = Number(cents);
    if (!isFinite(x)) return '0.00';
    var neg = x < 0, v = Math.abs(x) / 100, s;
    if (Math.round(v * 100) / 100 < 1000) s = v.toFixed(2);
    else {
      var i = 0;
      while (i < UNITS.length - 1 && v >= UNITS[i + 1][1]) i++;
      var r = trim(v / UNITS[i][1]);
      if (r >= 1000 && i < UNITS.length - 1) { i++; r = trim(v / UNITS[i][1]); }   // 999.96K rounds up to 1M
      s = String(r) + UNITS[i][0];
    }
    return (neg ? '-' : '') + s;
  }
  function exact(cents) { return (Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  window.CapyFormat = { cc: cc, exact: exact };
})();