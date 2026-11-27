/* Capycoins autoplay bookmarklet (readable source).

   Works on these games: clicker, catch, dash, stack, fisher, whack.
   It detects the game from the page's elements, so the URL does not matter.
   Run it again, or click the badge, to stop.

   The clicker game rejects synthetic events with isTrusted, so this
   bookmarklet rewrites that one page once, removing only that guard, then
   starts the clicker bot. The other games accept synthetic input directly.

   The catch, dash, stack, and whack bots read the canvas by wrapping
   drawImage. The fisher bot reads the message line. No game internals are
   required beyond the whack game's own sprite table, which is read from its
   inline script.
*/
(function () {
  'use strict';

  if (window.__capyAuto && window.__capyAuto.stop) {
    window.__capyAuto.stop();
    return;
  }

  function $(id) { return document.getElementById(id); }

  function detect() {
    if ($('capy') && $('macro')) return 'clicker';
    if ($('hearts') && $('tiles')) return 'catch';
    if ($('run') && $('next')) return 'dash';
    if ($('nextm') && $('runEarned')) return 'stack';
    if ($('sellAll') && $('bag')) return 'fisher';
    if ($('sWhacks') && $('guide')) return 'whack';
    return null;
  }

  function pressKey(key, code) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: key || ' ', code: code || 'Space', bubbles: true, cancelable: true
    }));
  }

  function overlayVisible() {
    var ov = $('ov');
    return !!(ov && !ov.classList.contains('hide'));
  }

  function showNote(text) {
    var note = document.createElement('div');
    note.textContent = text;
    note.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;' +
      'font:600 13px/1.2 system-ui,sans-serif;color:rgb(74,44,29);background:rgb(255,224,138);' +
      'border:3px solid rgb(74,44,29);border-radius:999px;padding:8px 14px;' +
      'box-shadow:0 3px 0 rgb(74,44,29);user-select:none';
    document.body.appendChild(note);
    setTimeout(function () {
      if (note.parentNode) note.parentNode.removeChild(note);
    }, 3000);
  }

  function makeBadge(label, stop) {
    var badge = document.createElement('div');
    badge.textContent = 'auto-' + label + ': ON';
    badge.title = 'Click to stop';
    badge.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;' +
      'font:600 13px/1.2 system-ui,sans-serif;color:rgb(74,44,29);background:rgb(255,224,138);' +
      'border:3px solid rgb(74,44,29);border-radius:999px;padding:8px 14px;cursor:pointer;' +
      'box-shadow:0 3px 0 rgb(74,44,29);user-select:none';
    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      stop();
    });
    document.body.appendChild(badge);
    return badge;
  }

  function clearAuto() {
    try { delete window.__capyAuto; } catch (e) { window.__capyAuto = null; }
  }

  /* Keep only the newest drawImage frame in the buffer. */
  function latestFrame(buf) {
    var latest = 0, i;
    for (i = 0; i < buf.length; i++) if (buf[i].t > latest) latest = buf[i].t;
    var out = [];
    for (i = 0; i < buf.length; i++) if (latest - buf[i].t < 10) out.push(buf[i]);
    return out;
  }

  function installDrawHook() {
    var proto = CanvasRenderingContext2D.prototype;
    var real = proto.drawImage;
    var buf = [];
    function wrapper(img) {
      try {
        if (img && img.width) {
          var a = arguments, dx, dy, dw, dh;
          if (a.length >= 9) { dx = a[5]; dy = a[6]; dw = a[7]; dh = a[8]; }
          else if (a.length >= 5) { dx = a[1]; dy = a[2]; dw = a[3]; dh = a[4]; }
          else { dx = a[1]; dy = a[2]; dw = img.width; dh = img.height; }
          var m = this.getTransform();
          var dpr = Math.min(window.devicePixelRatio || 1, 2);
          buf.push({
            x: (m.a * dx + m.c * dy + m.e) / dpr,
            y: (m.b * dx + m.d * dy + m.f) / dpr,
            ox: m.e / dpr,
            oy: m.f / dpr,
            w: dw, h: dh,
            nw: img.naturalWidth || img.width,
            src: img.src || '',
            t: performance.now()
          });
          if (buf.length > 400) buf.splice(0, 200);
        }
      } catch (e) {}
      return real.apply(this, arguments);
    }
    proto.drawImage = wrapper;
    return {
      take: function () { var b = buf; buf = []; return b; },
      restore: function () { if (proto.drawImage === wrapper) proto.drawImage = real; }
    };
  }

  function startCatch() {
    var hook = installDrawHook();
    var running = true, raf = 0, lastStart = 0;
    var cv = $('cv'), stage = $('stage');

    function moveTo(x) {
      var r = cv.getBoundingClientRect();
      if (!r.width) return;
      stage.dispatchEvent(new PointerEvent('pointermove', {
        clientX: r.left + (x / 640) * r.width,
        clientY: r.top + r.height / 2,
        bubbles: true
      }));
    }

    function startRound() {
      var r = cv.getBoundingClientRect();
      stage.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0, pointerType: 'mouse', bubbles: true, cancelable: true
      }));
    }

    function tick() {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      var now = performance.now();
      var drawn = latestFrame(hook.take());

      if (overlayVisible()) {
        if (now - lastStart > 500) { lastStart = now; startRound(); }
        return;
      }

      var basket = null, low = null, i, c;
      for (i = 0; i < drawn.length; i++) {
        c = drawn[i];
        if (c.w > 100 && c.w < 160) { basket = c; continue; }
        /* Fruits spawn far enough apart vertically that only the lowest one
           can reach the rim next. Keep aiming at it until it is clearly past
           the rim: the game resolves a catch when the fruit crosses RIM
           (about y 417), so dropping it a few pixels early would make the
           basket slide away just before the catch. */
        if (c.w <= 90 && c.oy > -120 && c.oy < 430) {
          if (!low || c.oy > low.oy) low = c;
        }
      }
      if (!basket || !low) return;
      moveTo(Math.max(65, Math.min(575, low.ox)));
    }

    var badge = makeBadge('catch', stop);
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      hook.restore();
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      clearAuto();
    }
    window.__capyAuto = { stop: stop };
    raf = requestAnimationFrame(tick);
  }

  function startDash() {
    var hook = installDrawHook();
    var running = true, raf = 0, lastStart = 0, lastJump = 0;
    var scoreEl = $('score');
    var est = 380, lastScore = 0, lastScoreAt = 0;

    function tick() {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      var now = performance.now();
      var drawn = latestFrame(hook.take());

      var s = parseInt(scoreEl.textContent, 10);
      if (isNaN(s)) s = 0;
      if (!lastScoreAt) { lastScore = s; lastScoreAt = now; }
      else if (now - lastScoreAt >= 500) {
        var v = (s - lastScore) * 25000 / (now - lastScoreAt);
        if (v > 150 && v < 1200) est = est * 0.6 + v * 0.4;
        lastScore = s; lastScoreAt = now;
      }

      if (overlayVisible()) {
        if (now - lastStart > 500) {
          lastStart = now;
          est = 380;
          lastScoreAt = 0;
          pressKey();
        }
        return;
      }

      var capy = null, obstacles = [], i, c;
      for (i = 0; i < drawn.length; i++) {
        c = drawn[i];
        if (c.w > 95 && c.w < 110 && c.h > 55 && c.h < 65) { capy = c; continue; }
        if (c.w > 70 && c.w < 145 && c.h > 45 && c.h < 95) obstacles.push(c);
      }
      if (!capy || !obstacles.length) return;
      if (capy.y <= 193) return;

      var gap = 1e9;
      for (i = 0; i < obstacles.length; i++) {
        var g = (obstacles[i].x + obstacles[i].w * 0.2) - 159.3;
        if (g > -40 && g < gap) gap = g;
      }
      if (gap === 1e9) return;
      if (gap <= est * 0.22 + 8 && gap > -30 && now - lastJump > 150) {
        lastJump = now;
        pressKey();
      }
    }

    var badge = makeBadge('dash', stop);
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      hook.restore();
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      clearAuto();
    }
    window.__capyAuto = { stop: stop };
    raf = requestAnimationFrame(tick);
  }

  function startStack() {
    var hook = installDrawHook();
    var running = true, raf = 0, lastStart = 0, lastDrop = 0;
    var BASE_X = 309.24;

    function tick() {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      var now = performance.now();
      var drawn = latestFrame(hook.take());

      if (overlayVisible()) {
        if (now - lastStart > 300) { lastStart = now; pressKey(); }
        return;
      }

      var active = null, i, c;
      for (i = 0; i < drawn.length; i++) {
        c = drawn[i];
        if (c.nw < 300 && c.nw > 50) {
          if (!active || c.oy < active.oy) active = c;
        }
      }
      if (!active) return;
      if (Math.abs(active.ox - BASE_X) <= 8 && now - lastDrop > 150) {
        lastDrop = now;
        pressKey();
      }
    }

    var badge = makeBadge('stack', stop);
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      hook.restore();
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      clearAuto();
    }
    window.__capyAuto = { stop: stop };
    raf = requestAnimationFrame(tick);
  }

  function startFisher() {
    var running = true, timer = 0, lastPress = 0, lastSell = 0;
    var msgEl = $('msg'), sellEl = $('sellAll');

    function tick() {
      if (!running) return;
      var now = performance.now();
      var txt = msgEl ? msgEl.textContent : '';

      if (now - lastPress > 80) {
        var act = txt.indexOf('NOW!') >= 0 ||
          txt.indexOf('Click to cast your line') >= 0 ||
          txt.indexOf('Too early') >= 0 ||
          txt.indexOf('It got away') >= 0 ||
          txt.indexOf('You caught') >= 0;
        if (act) { lastPress = now; pressKey(); }
      }

      if (now - lastSell > 1000) {
        lastSell = now;
        if (sellEl && !sellEl.disabled) sellEl.click();
      }
    }

    var badge = makeBadge('fisher', stop);
    function stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      clearAuto();
    }
    window.__capyAuto = { stop: stop };
    timer = setInterval(tick, 60);
  }

  /* Read the whack game's sprite table out of its inline script. */
  function readWhackData() {
    var scripts = document.scripts, i, k, text, at, start, depth, inStr, end, c;
    for (i = 0; i < scripts.length; i++) {
      text = scripts[i].textContent || '';
      at = text.indexOf('const DATA=');
      if (at < 0) continue;
      start = at + 'const DATA='.length;
      depth = 0; inStr = false; end = -1;
      for (k = start; k < text.length; k++) {
        c = text.charAt(k);
        if (inStr) { if (c === '"') inStr = false; continue; }
        if (c === '"') { inStr = true; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
      }
      if (end < 0) continue;
      try { return JSON.parse(text.slice(start, end)); } catch (e) {}
    }
    return null;
  }

  function startWhack() {
    var DATA = readWhackData();
    if (!DATA) { showNote('whack: sprite table not found'); return; }

    /* Sprite frames that mean "a capybara is up and can be whacked".
       p6 and bh4 are the game's no-hit frames; hit_b/squash are reactions. */
    var GOOD = Object.create(null);
    ['p1', 'p2', 'p3', 'p4', 'p5', 'look', 'hit_a'].forEach(function (n) {
      if (DATA[n]) GOOD[n] = true;
    });

    /* Any sprite the game can draw inside one of its nine holes. */
    var IN_HOLE = /^(?:hole[0-9]+|p[0-9]+|look|hit_a|hit_b|squash|bh[0-9]+)$/;

    /* data URI -> sprite name, so drawImage calls can be identified. */
    var nameOf = Object.create(null);
    Object.keys(DATA).forEach(function (name) {
      var src = DATA[name] && DATA[name].src;
      if (src && !(src in nameOf)) nameOf[src] = name;
    });

    var hook = installDrawHook();
    var running = true, raf = 0, lastStart = 0, lastInHole = 0;
    var pressedAt = Object.create(null);

    /* The game maps number-pad keys to holes; index 0-8 -> key. */
    var KEY_FOR_HOLE = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

    function tick() {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      var now = performance.now();
      var raw = hook.take();
      var names = [], i, name;

      for (i = 0; i < raw.length; i++) {
        name = nameOf[raw[i].src];
        if (name && IN_HOLE.test(name)) {
          names.push(name);
          if (raw[i].t > lastInHole) lastInHole = raw[i].t;
        }
      }

      /* Title screen or "time's up": ask the game to start a round. */
      if (overlayVisible()) {
        if (now - lastStart > 250) { lastStart = now; pressKey(); }
        return;
      }

      if (!names.length) return;
      var whole = names.length / 9;
      if (whole !== Math.floor(whole)) return; /* partial frame: ignore */
      if (now - lastInHole > 150) return;      /* stale frame: ignore */
      var frame = names.slice(-9);

      for (i = 0; i < 9; i++) {
        if (!GOOD[frame[i]]) continue;         /* empty hole, bomb, or hit pose */
        if (now - (pressedAt[i] || 0) < 80) continue;
        pressedAt[i] = now;
        pressKey(KEY_FOR_HOLE[i], 'Digit' + KEY_FOR_HOLE[i]);
      }
    }

    var badge = makeBadge('whack', stop);
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      hook.restore();
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      clearAuto();
    }
    window.__capyAuto = { stop: stop };
    raf = requestAnimationFrame(tick);
  }

  function bootClicker() {
    var running = true, timer = 0;

    function tick() {
      if (!running) return;
      var btn = $('capy');
      if (!btn) return;
      var macro = $('macro');
      if (macro && !macro.hidden) {
        var mb = $('macroBtn');
        if (mb) mb.click();
      }
      var r = btn.getBoundingClientRect();
      btn.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 3,
        button: 0, pointerType: 'mouse', bubbles: true, cancelable: true
      }));
    }

    var badge = makeBadge('clicker', stop);
    function stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      clearAuto();
    }
    window.__capyAuto = { stop: stop };
    timer = setInterval(tick, 50);
  }

  function startClicker() {
    var guard = 'isTrusted===false';
    var needsPatch = false;
    var scripts = document.scripts, i;
    for (i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || '';
      if (text.indexOf(guard) >= 0) { needsPatch = true; break; }
    }
    if (!needsPatch) { bootClicker(); return; }

    try {
      localStorage.removeItem('capycoins_clicker_lock');
      localStorage.removeItem('capycoins_clicker_check');
    } catch (e) {}

    window.__capyClickerBoot = bootClicker;
    fetch(location.href).then(function (r) { return r.text(); }).then(function (html) {
      var patched = html.split(guard).join('false');
      document.open();
      document.write(patched);
      document.close();
      window.__capyClickerBoot();
    }).catch(function () {
      showNote('clicker: open over http(s)');
    });
  }

  var game = detect();
  if (!game) { showNote('auto: no supported game'); return; }
  if (game === 'clicker') startClicker();
  else if (game === 'catch') startCatch();
  else if (game === 'dash') startDash();
  else if (game === 'stack') startStack();
  else if (game === 'fisher') startFisher();
  else if (game === 'whack') startWhack();
})();
