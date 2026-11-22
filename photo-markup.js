// Ridge Co photo markup (queue #163, Nov 22 2026). A small pen / arrow / circle / text tool on a canvas.
// No library, no external request. Shared by the portals: <script src="photo-markup.js"></script>
//   rcMarkup.open(fileOrBlob, { lang: 'en'|'es', onDone(blob) -> optional Promise, onCancel(), onError(message) })
// The picture you pass in is never changed: the result is a NEW JPEG blob (long side capped at 2560 px, quality 0.9).
// Failures (cannot open the photo, cannot save the drawing, onDone rejects) show on screen and call onError; nothing is dropped quietly.
(function (root) {
  'use strict';
  var MAX_SIDE = 2560;
  var STR = {
    en: { markup: 'Mark up', draw: 'Draw', arrow: 'Arrow', circle: 'Circle', text: 'Text', undo: 'Undo', clear: 'Clear', cancel: 'Cancel', done: 'Done', note: 'Type a short note', add: 'Add', marked: 'marked', color: 'Colour', loading: 'Loading photo…', saving: 'Saving…', openFail: 'Could not open this photo. Try again.', retry: 'Retry', saveFail: 'Could not save the marked photo. Your drawing is still here. Try again.' },
    es: { markup: 'Marcar foto', draw: 'Dibujar', arrow: 'Flecha', circle: 'Círculo', text: 'Texto', undo: 'Deshacer', clear: 'Borrar todo', cancel: 'Cancelar', done: 'Listo', note: 'Escriba una nota corta', add: 'Agregar', marked: 'marcada', color: 'Color', loading: 'Cargando foto…', saving: 'Guardando…', openFail: 'No se pudo abrir la foto. Intente de nuevo.', retry: 'Reintentar', saveFail: 'No se pudo guardar la foto marcada. Su dibujo sigue aquí. Intente de nuevo.' }
  };

  // Pure: size to draw and export at. Never upscales; long side capped at max.
  function fitSize(w, h, max) {
    max = max || MAX_SIDE;
    w = Number(w) || 0; h = Number(h) || 0;
    if (w <= 0 || h <= 0) return { w: 0, h: 0, scale: 1 };
    var long = Math.max(w, h);
    var scale = long > max ? max / long : 1;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale: scale };
  }

  function markedName(name) {
    var base = String(name || 'photo').replace(/\.[^.\/\\]+$/, '').replace(/^marked-/, '');
    return 'marked-' + base + '.jpg';
  }

  function drawShape(ctx, s, k) {
    // k scales line widths with the picture so marks stay readable on a 2560 px photo.
    var w = Math.max(6, Math.round(10 * k));
    function stroke(draw) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = s.edge; ctx.lineWidth = w + Math.max(3, Math.round(5 * k)); draw();
      ctx.strokeStyle = s.color; ctx.lineWidth = w; draw();
    }
    if (s.type === 'draw') {
      stroke(function () { ctx.beginPath(); s.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]); ctx.stroke(); });
    } else if (s.type === 'circle') {
      stroke(function () { ctx.beginPath(); ctx.ellipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.max(2, Math.abs(s.x1 - s.x0) / 2), Math.max(2, Math.abs(s.y1 - s.y0) / 2), 0, 0, Math.PI * 2); ctx.stroke(); });
    } else if (s.type === 'arrow') {
      var a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), h = Math.max(18, 30 * k);
      stroke(function () {
        ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1);
        ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x1 - h * Math.cos(a - 0.5), s.y1 - h * Math.sin(a - 0.5));
        ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x1 - h * Math.cos(a + 0.5), s.y1 - h * Math.sin(a + 0.5));
        ctx.stroke();
      });
    } else if (s.type === 'text') {
      var fs = Math.max(28, Math.round(46 * k));
      ctx.font = '700 ' + fs + 'px sans-serif'; ctx.textBaseline = 'top';
      ctx.lineJoin = 'round'; ctx.strokeStyle = s.edge; ctx.lineWidth = Math.max(4, Math.round(8 * k)); ctx.strokeText(s.text, s.x0, s.y0);
      ctx.fillStyle = s.color; ctx.fillText(s.text, s.x0, s.y0);
    }
  }

  // Every handled failure is reported to the page's failure reporter when it has one (failure-reporter.js), and always to the console.
  function report(what, e) {
    var msg = 'rcMarkup: ' + what + ': ' + String((e && e.message) || e);
    if (typeof window !== 'undefined' && typeof window.hubReportFailure === 'function') window.hubReportFailure('photo-markup', msg);
    else console.error(msg);
  }

  function open(src, opts) {
    opts = opts || {};
    var L = STR[opts.lang === 'es' ? 'es' : 'en'];
    var fail = function (msg) { try { if (typeof opts.onError === 'function') opts.onError(msg); } catch (e) { report('onError handler failed', e); } };
    var url = null, img = new Image(), shapes = [], tool = 'draw', color = 0, cur = null, pendingText = null, saving = false;
    var COLORS = [{ c: '#e5251b', e: '#ffffff' }, { c: '#ffd400', e: '#222222' }];
    var ov = document.createElement('div');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', L.markup);
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#111;display:flex;flex-direction:column;touch-action:none;color:#fff;font:16px sans-serif';
    var btn = 'min-height:44px;min-width:44px;padding:0 12px;border-radius:8px;border:1px solid #555;background:#2a2a2a;color:#fff;font:600 15px sans-serif;cursor:pointer';
    ov.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px">' +
        '<button type="button" data-a="cancel" style="' + btn + '">' + L.cancel + '</button>' +
        '<span data-s="status" role="status" style="flex:1;text-align:center;font-size:14px"></span>' +
        '<button type="button" data-a="done" style="' + btn + ';background:#1a73e8;border-color:#1a73e8">' + L.done + '</button>' +
      '</div>' +
      '<div data-s="stage" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 8px"></div>' +
      '<div data-s="noteRow" style="display:none;gap:8px;padding:8px 12px"><input data-s="noteIn" type="text" maxlength="60" placeholder="' + L.note + '" style="flex:1;min-height:44px;font-size:16px;padding:0 10px;border-radius:8px;border:1px solid #555;background:#fff;color:#111"><button type="button" data-a="addText" style="' + btn + '">' + L.add + '</button></div>' +
      '<div data-s="tools" style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom))">' +
        ['draw', 'arrow', 'circle', 'text'].map(function (t) { return '<button type="button" data-tool="' + t + '" style="' + btn + '">' + L[t] + '</button>'; }).join('') +
        '<button type="button" data-a="color" aria-label="' + L.color + '" style="' + btn + '"><span data-s="swatch" style="display:inline-block;width:20px;height:20px;border-radius:50%;border:2px solid #fff;vertical-align:middle"></span></button>' +
        '<button type="button" data-a="undo" style="' + btn + '">' + L.undo + '</button>' +
        '<button type="button" data-a="clear" style="' + btn + '">' + L.clear + '</button>' +
      '</div>';
    document.body.appendChild(ov);
    var q = function (s) { return ov.querySelector('[data-s="' + s + '"]'); };
    var status = q('status'), stage = q('stage'), canvas = null, ctx = null, k = 1;
    function say(msg, bad, retry) {
      status.style.color = bad ? '#ff8a80' : '#fff';
      status.textContent = msg || '';
      if (retry) { var b = document.createElement('button'); b.type = 'button'; b.textContent = L.retry; b.style.cssText = btn + ';margin-left:8px'; b.onclick = retry; status.appendChild(b); }
    }
    function close() { if (url) { try { URL.revokeObjectURL(url); } catch (e) { report('revokeObjectURL failed', e); } url = null; } if (ov.parentNode) ov.parentNode.removeChild(ov); }
    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      shapes.forEach(function (s) { drawShape(ctx, s, k); }); if (cur) drawShape(ctx, cur, k);
    }
    function setTool(t) {
      tool = t; pendingText = null; q('noteRow').style.display = 'none';
      [].forEach.call(ov.querySelectorAll('[data-tool]'), function (b) { b.style.outline = b.getAttribute('data-tool') === t ? '3px solid #1a73e8' : 'none'; });
    }
    function setColor() { q('swatch').style.background = COLORS[color].c; }
    function pt(ev) { var r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * canvas.width / r.width, (ev.clientY - r.top) * canvas.height / r.height]; }

    function ready() {
      var f = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_SIDE);
      if (!f.w) { say(L.openFail, true, load); return; }
      canvas = document.createElement('canvas'); canvas.width = f.w; canvas.height = f.h; k = Math.max(f.w, f.h) / 1000;
      canvas.style.cssText = 'max-width:100%;max-height:100%;touch-action:none;background:#000;border-radius:4px';
      ctx = canvas.getContext('2d');
      if (!ctx) { say(L.openFail, true, load); return; }
      stage.innerHTML = ''; stage.appendChild(canvas); say(''); redraw();
      canvas.addEventListener('pointerdown', function (ev) {
        if (saving) return; ev.preventDefault(); var p = pt(ev), c = COLORS[color];
        if (tool === 'text') { pendingText = p; q('noteRow').style.display = 'flex'; q('noteIn').focus(); return; }
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { report('setPointerCapture failed (drawing continues)', e); }
        cur = tool === 'draw' ? { type: 'draw', pts: [p], color: c.c, edge: c.e } : { type: tool, x0: p[0], y0: p[1], x1: p[0], y1: p[1], color: c.c, edge: c.e };
      });
      canvas.addEventListener('pointermove', function (ev) {
        if (!cur) return; ev.preventDefault(); var p = pt(ev);
        if (cur.type === 'draw') cur.pts.push(p); else { cur.x1 = p[0]; cur.y1 = p[1]; }
        redraw();
      });
      var end = function () { if (!cur) return; shapes.push(cur); cur = null; redraw(); };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    }
    function load() {
      say(L.loading);
      try {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(src);
      } catch (e) { say(L.openFail, true, load); fail(L.openFail + ' ' + String((e && e.message) || e)); return; }
      img = new Image();
      img.onload = ready;
      img.onerror = function () { say(L.openFail, true, load); fail(L.openFail); };
      img.src = url;
    }

    ov.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-tool],[data-a]'); if (!t || saving && t.getAttribute('data-a') !== 'cancel') return;
      var tl = t.getAttribute('data-tool'), a = t.getAttribute('data-a');
      if (tl) { setTool(tl); return; }
      if (a === 'cancel') { close(); try { if (typeof opts.onCancel === 'function') opts.onCancel(); } catch (e) { report('onCancel handler failed', e); } }
      else if (a === 'undo') { shapes.pop(); if (ctx) redraw(); }
      else if (a === 'clear') { shapes = []; if (ctx) redraw(); }
      else if (a === 'color') { color = (color + 1) % COLORS.length; setColor(); }
      else if (a === 'addText') {
        var v = q('noteIn').value.trim();
        if (v && pendingText) { var c = COLORS[color]; shapes.push({ type: 'text', text: v, x0: pendingText[0], y0: pendingText[1], color: c.c, edge: c.e }); redraw(); }
        q('noteIn').value = ''; pendingText = null; q('noteRow').style.display = 'none';
      }
      else if (a === 'done') {
        if (!canvas || saving) return; saving = true; t.disabled = true; say(L.saving);
        var reset = function (msg) { saving = false; t.disabled = false; say(msg, true, function () { t.click(); }); };
        canvas.toBlob(function (blob) {
          if (!blob) { reset(L.saveFail); fail(L.saveFail + ' (no image was produced)'); return; }
          var r;
          try { r = typeof opts.onDone === 'function' ? opts.onDone(blob) : null; } catch (e) { reset(L.saveFail); fail(L.saveFail + ' ' + String((e && e.message) || e)); return; }
          Promise.resolve(r).then(function () { close(); }, function (e) { reset(L.saveFail); fail(L.saveFail + ' ' + String((e && e.message) || e)); });
        }, 'image/jpeg', 0.9);
      }
    });
    ov.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target === q('noteIn')) { ev.preventDefault(); ov.querySelector('[data-a="addText"]').click(); } });
    setTool('draw'); setColor(); load();
    return { close: close };
  }

  var api = { open: open, fitSize: fitSize, markedName: markedName, strings: STR, MAX_SIDE: MAX_SIDE };
  root.rcMarkup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
