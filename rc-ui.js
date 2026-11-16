/* rc-ui.js - the shared RidgeCo parts, written from DESIGN.md (v1, Nov 16 2026). UI plan Phase 0. Pair of rc-ui.css.
   Load with the version in the tag:  <script src="rc-ui.js?v=1"></script>   (test/rc-ui.test.mjs keeps ?v= equal to RC_UI_VERSION below).
   Interface only. It never talks to the Worker, never reads a PIN or token, never sends a text. A page that fails to load it keeps working:
   pages call these parts only after checking `typeof RC !== 'undefined'`, and the guard snippet in DESIGN.md shows a visible warning.

   What is in here (all on window.RC, and rcToast / rcConfirm / rcAsk / rcSheet as globals):
     RC.config        brand name, logo path and Worker address: the ONLY place they are written. Override with window.RC_CONFIG before this loads.
     RC.chip          ONE status map keyed by status, with the person's role as an argument (vendor / tenant / owner / admin).
     RC.field         label above, 16px input, hint, error.
     rcSheet          bottom sheet on phones, centred dialog on desktop. Focus moves in and returns. Phone back button closes it.
     rcToast          a message (optionally with an action such as Undo). Returns a promise: 'timeout' | 'action' | 'dismissed'.
     rcConfirm        yes/no. Returns a promise: true | false.
     rcAsk            a typed answer. Returns a promise: the text | null.
     RC.empty / RC.loading / RC.error   the three states; the error one has Retry and never looks like an empty list.
     RC.date / RC.dateTime               "Thu, Nov 12".
   Nothing here fails silently: every caught problem goes to RC.report() (console, RC.problems, and hubReportFailure when the page has it). */
(function (root, factory) {
  var RC = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = RC;
  if (root && root.document) {
    root.RC = RC; root.rcToast = RC.toast; root.rcConfirm = RC.confirm; root.rcAsk = RC.ask; root.rcSheet = RC.sheet;
    RC._boot();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  var RC_UI_VERSION = '1';
  var RC = { version: RC_UI_VERSION, problems: [] };

  // ===================================================================== config: brand, logo, Worker (DESIGN.md section 14)
  var DEFAULT_CONFIG = {
    brand: 'Ridge Co',
    logo: 'icon.svg',
    worker: 'https://maintenance-hub.brett-2f8.workers.dev',
    lang: function () { return root && root.LANG === 'es' ? 'es' : 'en'; },
    t: null   // optional: a page's own translate function (string -> string). Without it, the built-in table below is used.
  };
  RC.config = Object.assign({}, DEFAULT_CONFIG, (root && root.RC_CONFIG) || {});
  RC.brand = function () { return String(RC.config.brand); };
  RC.logo = function () { return String(RC.config.logo); };
  RC.worker = function (path) { return String(RC.config.worker).replace(/\/+$/, '') + (path ? '/' + String(path).replace(/^\/+/, '') : ''); };
  // Fills <... data-rc-brand> with the brand name, <img data-rc-logo> with the logo, <... data-rc-worker> (a link or form) with the address.
  RC.applyBrand = function (scope) {
    var r = scope || (root && root.document);
    if (!r || !r.querySelectorAll) return 0;
    var n = 0;
    r.querySelectorAll('[data-rc-brand]').forEach(function (e) { e.textContent = RC.brand(); n++; });
    r.querySelectorAll('[data-rc-logo]').forEach(function (e) { e.setAttribute('src', RC.logo()); n++; });
    r.querySelectorAll('[data-rc-worker]').forEach(function (e) { e.textContent = RC.worker(); n++; });
    return n;
  };

  // ===================================================================== never silent
  RC.report = function (where, message) {
    var line = '[rc-ui] ' + where + ': ' + message;
    if (RC.problems.length < 50) RC.problems.push(line);
    try { if (typeof console !== 'undefined') console.error(line); } catch (e) { /* console blocked: RC.problems still has it */ }
    try { if (root && typeof root.hubReportFailure === 'function') root.hubReportFailure('rc-ui:' + where, String(message).slice(0, 300)); }
    catch (e) { RC.problems.push('[rc-ui] reporter failed: ' + e); }
  };

  // ===================================================================== strings (built-in English + Spanish for rc-ui's own words)
  var ES = {
    'Cancel': 'Cancelar', 'Confirm': 'Confirmar', 'OK': 'Aceptar', 'Close': 'Cerrar', 'Retry': 'Reintentar', 'Dismiss': 'Descartar',
    'Loading…': 'Cargando…', 'Nothing here yet': 'Aún no hay nada', 'Something went wrong': 'Algo salió mal',
    'Please enter a value.': 'Escriba un valor.', '(optional)': '(opcional)', 'Undo': 'Deshacer', 'Save': 'Guardar',
    'Request received': 'Solicitud recibida', 'Technician assigned': 'Técnico asignado', 'Technician confirmed': 'Técnico confirmado',
    'Work in progress': 'Trabajo en curso', 'On hold': 'En pausa', 'Complete': 'Completo', 'Invoice sent': 'Factura enviada', 'Paid': 'Pagado',
    'Cancelled': 'Cancelado', 'New': 'Nuevo', 'Estimate requested': 'Presupuesto solicitado', 'Assigned': 'Asignado', 'Accepted': 'Aceptado',
    'In progress': 'En progreso', 'Pending invoice': 'Factura pendiente', 'Invoiced': 'Facturado', 'Declined': 'Rechazado',
    'Urgent': 'Urgente', 'High': 'Alta', 'Normal': 'Normal', 'Low': 'Baja',
    'A shared style file (rc-ui.css) did not load, so some parts of this page may look wrong. Reload the page. If this stays, tell Brett.':
      'Un archivo de estilos compartido (rc-ui.css) no cargó, así que algunas partes de esta página pueden verse mal. Recargue la página. Si sigue igual, avise a Brett.',
    'The shared files on this page are from two different versions. Tap Reload to fix it.':
      'Los archivos compartidos de esta página son de dos versiones distintas. Toque Recargar para arreglarlo.',
    'Reload': 'Recargar'
  };
  RC.lang = function () { try { return RC.config.lang() === 'es' ? 'es' : 'en'; } catch (e) { RC.report('lang', e); return 'en'; } };
  RC.t = function (s) {
    s = String(s);
    if (typeof RC.config.t === 'function') { try { var o = RC.config.t(s); if (o) return String(o); } catch (e) { RC.report('t', e); } }
    return RC.lang() === 'es' && Object.prototype.hasOwnProperty.call(ES, s) ? ES[s] : s;
  };
  RC._es = ES;
  RC.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ===================================================================== dates: "Thu, Nov 12" (DESIGN.md section 3)
  var DOW = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] };
  var MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] };
  function localDate(y, m, d) { var dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null; }
  // Accepts a Date, epoch milliseconds, "2026-11-12", an ISO date-time, or "11/12/2026". Anything else: null (never a guess).
  RC.parseDate = function (v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') { var n = new Date(v); return isNaN(n.getTime()) ? null : n; }
    if (typeof v !== 'string') return null;
    var s = v.trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return localDate(+m[1], +m[2], +m[3]);   // a plain date is a calendar day, not UTC midnight
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) { var t = new Date(s.replace(' ', 'T')); return isNaN(t.getTime()) ? null : t; }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return localDate(+m[3], +m[1], +m[2]);
    return null;
  };
  // opts: { lang: 'en'|'es' (default: the page's), year: true (adds ", 2026"), fallback: '' (what to print for a blank or bad value) }
  RC.date = function (v, opts) {
    opts = opts || {};
    var d = RC.parseDate(v);
    if (!d) return opts.fallback == null ? '' : String(opts.fallback);
    var l = opts.lang || RC.lang(); if (!DOW[l]) l = 'en';
    var out = l === 'es' ? DOW[l][d.getDay()] + ', ' + d.getDate() + ' ' + MON[l][d.getMonth()] : DOW[l][d.getDay()] + ', ' + MON[l][d.getMonth()] + ' ' + d.getDate();
    return opts.year ? out + ', ' + d.getFullYear() : out;
  };
  // "Thu, Nov 12, 3:30 PM" (Spanish: 24-hour "15:30").
  RC.dateTime = function (v, opts) {
    opts = opts || {};
    var d = RC.parseDate(v);
    if (!d) return opts.fallback == null ? '' : String(opts.fallback);
    var l = opts.lang || RC.lang(), h = d.getHours(), mi = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var time = l === 'es' ? h + ':' + mi : (h % 12 || 12) + ':' + mi + ' ' + (h < 12 ? 'AM' : 'PM');
    return RC.date(d, opts) + ', ' + time;
  };

  // ===================================================================== contrast (used by the chip test and by RC.chip.check)
  RC.contrast = function (a, b) {
    function lum(hex) {
      var h = String(hex).replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
      var c = [0, 2, 4].map(function (i) { var x = parseInt(h.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    var la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };

  // ===================================================================== status chips: ONE map (DESIGN.md section 7)
  // kind -> the tokens its CSS class uses. test/rc-ui.test.mjs checks these against rc-ui.css and computes every contrast.
  var KINDS = {
    info:      { fg: '--rc-accent',    bg: '--rc-info-bg' },
    assigned:  { fg: '--rc-warn-text', bg: '--rc-warn-bg' },
    accepted:  { fg: '--rc-surface',   bg: '--rc-accent' },
    active:    { fg: '--rc-surface',   bg: '--rc-success' },
    hold:      { fg: '--rc-surface',   bg: '--rc-warn' },
    done:      { fg: '--rc-success',   bg: '--rc-success-bg' },
    billing:   { fg: '--rc-purple',    bg: '--rc-purple-bg' },
    invoiced:  { fg: '--rc-surface',   bg: '--rc-purple' },
    paid:      { fg: '--rc-text',      bg: '--rc-surface2' },
    declined:  { fg: '--rc-danger',    bg: '--rc-danger-bg' },
    cancelled: { fg: '--rc-muted',     bg: '--rc-surface2' },
    'p-urgent': { fg: '--rc-danger',    bg: '--rc-danger-bg' },
    'p-high':   { fg: '--rc-warn-text', bg: '--rc-warn-bg' },
    'p-normal': { fg: '--rc-success',   bg: '--rc-success-bg' },
    'p-low':    { fg: '--rc-accent',    bg: '--rc-info-bg' }
  };
  // status -> { kind, label } for vendor and admin (the real names). tenant / owner: overrides below. `hide` = that person never sees it.
  // The status names are the stored values from wo-status.js (WOStatus); the test fails if a status there has no entry here.
  var STATUS = {
    'New':                { kind: 'info',      label: 'New',                tenant: { label: 'Request received' }, owner: { label: 'Request received' } },
    'Estimate Requested': { kind: 'info',      label: 'Estimate requested', tenant: { label: 'Request received' }, owner: { label: 'Request received' } },
    'Assigned':           { kind: 'assigned',  label: 'Assigned',           tenant: { label: 'Technician assigned' }, owner: { label: 'Technician assigned' } },
    'Accepted':           { kind: 'accepted',  label: 'Accepted',           tenant: { label: 'Technician confirmed' }, owner: { label: 'Technician confirmed' } },
    'In Progress':        { kind: 'active',    label: 'In progress',        tenant: { label: 'Work in progress' }, owner: { label: 'Work in progress' } },
    'On Hold':            { kind: 'hold',      label: 'On hold' },
    'Complete':           { kind: 'done',      label: 'Complete' },
    'Pending Invoice':    { kind: 'billing',   label: 'Pending invoice',    tenant: { kind: 'done', label: 'Complete' }, owner: { kind: 'done', label: 'Complete' } },
    'Invoiced':           { kind: 'invoiced',  label: 'Invoiced',           tenant: { kind: 'done', label: 'Complete' }, owner: { label: 'Invoice sent' } },
    'Paid':               { kind: 'paid',      label: 'Paid',               tenant: { kind: 'done', label: 'Complete' } },
    'Declined':           { kind: 'declined',  label: 'Declined',           tenant: { hide: true }, owner: { hide: true } },
    'Cancelled':          { kind: 'cancelled', label: 'Cancelled' }
  };
  var ALIAS = { 'Canceled': 'Cancelled' };   // old spelling that still sits in a few rows (wo-status.js LEGACY)
  var ROLES = ['vendor', 'tenant', 'owner', 'admin'];
  var PRIORITY = { 'Urgent': 'p-urgent', 'High': 'p-high', 'Normal': 'p-normal', 'Low': 'p-low' };
  function deepFreeze(o) { Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); }); return Object.freeze(o); }
  deepFreeze(KINDS); deepFreeze(STATUS);

  // chip.info(status, role) -> { status, role, kind, label (translated), hidden }
  // The tenant and owner never see money words: a status that is not in the map is hidden from them (and reported), shown plainly to vendor/admin.
  function chipInfo(status, role) {
    var r = String(role || '').toLowerCase();
    if (ROLES.indexOf(r) < 0) { RC.report('chip', 'unknown role "' + role + '", treated as tenant (the most restricted)'); r = 'tenant'; }
    var key = ALIAS[status] || status, e = Object.prototype.hasOwnProperty.call(STATUS, key) ? STATUS[key] : null;
    if (!e) {
      RC.report('chip', 'unknown status "' + status + '" for role ' + r);
      if (r === 'tenant' || r === 'owner') return { status: status, role: r, kind: null, label: '', hidden: true };
      return { status: status, role: r, kind: 'cancelled', label: String(status == null ? '' : status), hidden: false, unknown: true };
    }
    var o = (r === 'tenant' || r === 'owner') && e[r] ? e[r] : {};
    if (o.hide) return { status: key, role: r, kind: null, label: '', hidden: true };
    return { status: key, role: r, kind: o.kind || e.kind, label: RC.t(o.label || e.label), hidden: false };
  }
  function chipEl(status, role) {
    var i = chipInfo(status, role);
    if (i.hidden || !root || !root.document) return null;
    var s = root.document.createElement('span'); s.className = 'rc-chip rc-chip--' + i.kind; s.textContent = i.label;
    if (i.unknown) s.setAttribute('data-rc-unknown', '1');
    return s;
  }
  function chipHtml(status, role) {
    var i = chipInfo(status, role);
    return i.hidden ? '' : '<span class="rc-chip rc-chip--' + i.kind + '"' + (i.unknown ? ' data-rc-unknown="1"' : '') + '>' + RC.esc(i.label) + '</span>';
  }
  function prioInfo(p) {
    var key = String(p == null ? '' : p).trim(); key = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
    var kind = PRIORITY[key];
    if (!kind) { if (key) RC.report('chip', 'unknown priority "' + p + '"'); return { kind: null, label: '', hidden: true }; }
    return { kind: kind, label: RC.t(key), hidden: false };
  }
  RC.chip = {
    kinds: KINDS, map: STATUS, roles: ROLES, priorities: PRIORITY,
    info: chipInfo, el: chipEl, html: chipHtml,
    priority: prioInfo,
    priorityHtml: function (p) { var i = prioInfo(p); return i.hidden ? '' : '<span class="rc-chip rc-chip--' + i.kind + '">' + RC.esc(i.label) + '</span>'; }
  };

  // ===================================================================== dom helper
  function h(tag, attrs, kids) {
    var e = root.document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? root.document.createTextNode(c) : c); });
    return e;
  }
  var uid = 0;
  function nextId(p) { uid += 1; return 'rc-' + p + '-' + uid; }

  // ===================================================================== buttons
  // RC.button({ label, kind: 'primary'|'secondary'|'ghost'|'danger', big, type, onClick }) -> <button class="rc-btn ...">
  // onClick may return a promise: the button disables itself on the first line (before any await) and comes back on success AND failure.
  RC.button = function (o) {
    o = o || {};
    var b = h('button', { type: o.type || 'button', class: 'rc-btn rc-btn--' + (o.kind || 'secondary') + (o.big ? ' rc-btn--big' : ''), text: RC.t(o.label || '') });
    if (typeof o.onClick === 'function') b.addEventListener('click', function (ev) {
      if (b.disabled) return;
      var prev = b.textContent; b.disabled = true; b.setAttribute('aria-busy', 'true'); if (o.busyLabel) b.textContent = RC.t(o.busyLabel);
      function back() { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = prev; }
      var r; try { r = o.onClick(ev, b); } catch (e) { back(); RC.report('button', e); throw e; }
      if (r && typeof r.then === 'function') r.then(back, function (e) { back(); RC.report('button', e); }); else back();
    });
    return b;
  };

  // ===================================================================== fields
  // RC.field({ label, id, name, type, value, placeholder, hint, error, optional, multiline, options:[{value,label}], autocomplete })
  // -> { el, input, setError(msg) }   (an <select> when options is given, a <textarea> when multiline)
  RC.field = function (o) {
    o = o || {};
    var id = o.id || nextId('field'), hintId = id + '-hint', errId = id + '-err';
    var input = o.options ? h('select', { id: id, name: o.name }, o.options.map(function (op) { return h('option', { value: op.value, text: op.label }); }))
      : o.multiline ? h('textarea', { id: id, name: o.name, placeholder: o.placeholder, rows: o.rows || 4 })
      : h('input', { id: id, name: o.name, type: o.type || 'text', placeholder: o.placeholder, autocomplete: o.autocomplete, inputmode: o.inputmode });
    if (o.value != null) input.value = o.value;
    var label = h('label', { class: 'rc-field__label', for: id, text: RC.t(o.label || '') + (o.optional ? ' ' + RC.t('(optional)') : '') });
    var hint = o.hint ? h('p', { class: 'rc-field__hint', id: hintId, text: RC.t(o.hint) }) : null;
    var err = h('p', { class: 'rc-field__error', id: errId, role: 'alert' });
    var el = h('div', { class: 'rc-field' }, [label, input, hint, err]);
    function setError(msg) {
      err.textContent = msg ? RC.t(msg) : '';
      el.classList.toggle('rc-field--error', !!msg);
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', [hint ? hintId : '', msg ? errId : ''].filter(Boolean).join(' '));
    }
    setError(o.error || '');
    return { el: el, input: input, setError: setError };
  };

  // ===================================================================== sheet (DESIGN.md section 9)
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var openSheets = [];
  // rcSheet({ title, body: Node, actions: [{label, kind, onClick(close)}], onClose(), initialFocus: Node|fn }) -> { el, close(), closed: Promise }
  RC.sheet = function (o) {
    o = o || {};
    var doc = root.document, titleId = nextId('title');
    var prior = doc.activeElement, closedFlag = false, resolveClosed, histId = nextId('hist');
    var closed = new Promise(function (r) { resolveClosed = r; });
    var title = h('h2', { class: 'rc-sheet__title', id: titleId, tabindex: '-1', text: RC.t(o.title || '') });
    var closeBtn = h('button', { type: 'button', class: 'rc-btn rc-btn--ghost rc-btn-icon rc-sheet__close', 'aria-label': RC.t('Close'), text: '×' });
    var body = h('div', { class: 'rc-sheet__body' }, o.body ? [o.body] : []);
    var actionsEl = h('div', { class: 'rc-sheet__actions' });
    var sheet = h('div', { class: 'rc-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [h('div', { class: 'rc-sheet__head' }, [title, closeBtn]), body, (o.actions && o.actions.length) ? actionsEl : null]);
    var backdrop = h('div', { class: 'rc-sheet-backdrop' }, [sheet]);
    var handle = { el: sheet, closed: closed, close: close, body: body, actionsEl: actionsEl };

    (o.actions || []).forEach(function (a) {
      actionsEl.appendChild(RC.button({ label: RC.t(a.label), kind: a.kind || 'secondary', onClick: function () { return a.onClick ? a.onClick(close) : close(); } }));
    });
    function close() {
      if (closedFlag) return; closedFlag = true;
      doc.removeEventListener('keydown', onKey, true); root.removeEventListener('popstate', onPop);
      var i = openSheets.indexOf(handle); if (i >= 0) openSheets.splice(i, 1);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (!openSheets.length) doc.body.style.overflow = prevOverflow;
      // take our history entry back off, unless the back button already did
      try { if (root.history && root.history.state && root.history.state.rcSheet === histId) { ignorePop = true; root.history.back(); } } catch (e) { RC.report('sheet', e); }
      try { if (prior && prior.focus && doc.contains(prior)) prior.focus({ preventScroll: true }); } catch (e) { RC.report('sheet', e); }
      try { if (typeof o.onClose === 'function') o.onClose(); } catch (e) { RC.report('sheet', e); }
      resolveClosed();
    }
    function onKey(ev) {
      if (openSheets[openSheets.length - 1] !== handle) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key !== 'Tab') return;
      var f = [].slice.call(sheet.querySelectorAll(FOCUSABLE)).filter(function (x) { return x.offsetParent !== null || x === doc.activeElement; });
      if (!f.length) { ev.preventDefault(); title.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && (doc.activeElement === first || doc.activeElement === title)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && doc.activeElement === last) { ev.preventDefault(); first.focus(); }
      else if (!sheet.contains(doc.activeElement)) { ev.preventDefault(); first.focus(); }
    }
    var ignorePop = false;
    function onPop() { if (ignorePop) { ignorePop = false; return; } if (openSheets[openSheets.length - 1] === handle) close(); }
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('mousedown', function (ev) { if (ev.target === backdrop) close(); });

    var prevOverflow = doc.body.style.overflow;
    openSheets.push(handle); doc.body.style.overflow = 'hidden';
    doc.body.appendChild(backdrop);
    doc.addEventListener('keydown', onKey, true); root.addEventListener('popstate', onPop);
    try { root.history.pushState({ rcSheet: histId }, ''); } catch (e) { RC.report('sheet', e); }
    try {
      var want = typeof o.initialFocus === 'function' ? o.initialFocus(sheet) : o.initialFocus;
      var target = want || sheet.querySelector('input,select,textarea') || title;
      target.focus({ preventScroll: true });
    } catch (e) { RC.report('sheet', e); }
    return handle;
  };

  // ===================================================================== promise cores (pure: tested without a browser)
  // A prompter shows ONE sheet at a time (never a sheet on top of a sheet): the next waits its turn. It always settles, exactly once.
  // driver.open(spec, settle) -> { close() }. If the driver cannot open (no page), the promise resolves with spec.cancelValue and the problem is reported.
  RC._makePrompter = function (driver) {
    var queue = [], busy = false;
    function next() {
      if (busy || !queue.length) return;
      busy = true;
      var job = queue.shift(), done = false, handle = null;
      function settle(v) {
        if (done) return; done = true;
        if (handle) { try { handle.close(); } catch (e) { RC.report('prompt', e); } }
        busy = false; job.resolve(v); next();
      }
      try { handle = driver.open(job.spec, settle); if (done && handle) handle.close(); }
      catch (e) { RC.report('prompt', e); done = true; busy = false; job.resolve(job.spec.cancelValue); next(); }
    }
    return function (spec) { return new Promise(function (resolve) { queue.push({ spec: spec, resolve: resolve }); next(); }); };
  };
  // A toaster shows messages that stack. Each returns a promise ('timeout' | 'action' | 'dismissed') with .dismiss().
  // driver.show(spec, settle) -> { remove() }.
  RC._makeToaster = function (driver, timers) {
    var T = timers || { set: function (f, m) { return setTimeout(f, m); }, clear: function (id) { clearTimeout(id); } };   // wrapped: a bare setTimeout called as T.set() throws Illegal invocation in a browser
    return function (message, opts) {
      opts = opts || {};
      var done = false, handle = null, timer = null, resolveFn, p = new Promise(function (r) { resolveFn = r; });
      var ms = opts.duration != null ? opts.duration : (opts.kind === 'error' || opts.actionLabel ? 8000 : 4000);
      function settle(why) {
        if (done) return; done = true;
        if (timer) T.clear(timer);
        if (handle) { try { handle.remove(); } catch (e) { RC.report('toast', e); } }
        resolveFn(why);
      }
      try { handle = driver.show({ message: String(message), kind: opts.kind || 'info', actionLabel: opts.actionLabel || '' }, settle); if (done && handle) handle.remove(); }
      catch (e) { RC.report('toast', e); done = true; resolveFn('dismissed'); return Object.assign(p, { dismiss: function () {} }); }
      if (ms > 0 && !done) timer = T.set(function () { settle('timeout'); }, ms);
      return Object.assign(p, { dismiss: function () { settle('dismissed'); } });
    };
  };
  // What rcAsk accepts: trims (unless trim:false), required unless required:false, then the caller's validate(value) -> error text or ''.
  RC._checkAnswer = function (spec, raw) {
    var v = spec.trim === false ? String(raw == null ? '' : raw) : String(raw == null ? '' : raw).trim();
    if (!v && spec.required !== false) return { ok: false, value: v, error: 'Please enter a value.' };
    if (typeof spec.validate === 'function') {
      var msg; try { msg = spec.validate(v); } catch (e) { RC.report('ask', e); return { ok: false, value: v, error: 'Something went wrong' }; }
      if (msg) return { ok: false, value: v, error: String(msg) };
    }
    return { ok: true, value: v, error: '' };
  };

  // ===================================================================== dom drivers
  var sheetDriver = {
    open: function (spec, settle) {
      if (!root || !root.document || !root.document.body) throw new Error('no page to show a sheet in');
      var cancelValue = spec.cancelValue;
      if (spec.kind === 'ask') {
        var f = RC.field({ label: spec.label || spec.title, value: spec.value, placeholder: spec.placeholder, hint: spec.hint, multiline: !!spec.multiline, type: spec.type, optional: spec.required === false, autocomplete: 'off' });
        var form = h('form', { novalidate: 'novalidate' }, [spec.message ? h('p', { text: RC.t(spec.message), style: 'margin:0 0 12px' }) : null, f.el]);
        function submit() {
          var r = RC._checkAnswer(spec, f.input.value);
          if (!r.ok) { f.setError(r.error); f.input.focus(); return; }
          settle(r.value);
        }
        form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });
        if (!spec.multiline) f.input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
        return RC.sheet({ title: spec.title, body: form, onClose: function () { settle(cancelValue); }, initialFocus: f.input,
          actions: [{ label: spec.cancelLabel || 'Cancel', kind: 'ghost', onClick: function () { settle(cancelValue); } },
                    { label: spec.okLabel || 'Save', kind: 'primary', onClick: function () { submit(); } }] });
      }
      var msg = h('p', { text: RC.t(spec.message || ''), style: 'margin:0' });
      var okBtn = { label: spec.okLabel || 'Confirm', kind: spec.danger ? 'danger' : 'primary', onClick: function () { settle(true); } };
      var noBtn = { label: spec.cancelLabel || 'Cancel', kind: spec.danger ? 'secondary' : 'ghost', onClick: function () { settle(false); } };
      var s = RC.sheet({ title: spec.title, body: msg, onClose: function () { settle(false); }, actions: [noBtn, okBtn],
        // a destructive question starts on Cancel, so a stray Enter cannot confirm it
        initialFocus: function (el) { var b = el.querySelectorAll('.rc-sheet__actions .rc-btn'); return spec.danger ? b[0] : b[b.length - 1]; } });
      return s;
    }
  };
  var prompter = RC._makePrompter(sheetDriver);
  // rcConfirm({ title, message, okLabel, cancelLabel, danger }) or rcConfirm('Sentence?') -> Promise<boolean>
  RC.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return prompter({ kind: 'confirm', title: o.title || 'Are you sure?', message: o.message, okLabel: o.okLabel, cancelLabel: o.cancelLabel, danger: !!o.danger, cancelValue: false });
  };
  // rcAsk({ title, label, message, value, placeholder, hint, multiline, type, required, trim, validate(v), okLabel, cancelLabel }) -> Promise<string|null>
  RC.ask = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return prompter(Object.assign({}, o, { kind: 'ask', title: o.title || o.label || 'Enter a value', cancelValue: null }));
  };

  var toastHost = null;
  var toaster = RC._makeToaster({
    show: function (spec, settle) {
      if (!root || !root.document || !root.document.body) throw new Error('no page to show a toast in');
      if (!toastHost || !toastHost.parentNode) { toastHost = h('div', { class: 'rc-toasts', role: 'region', 'aria-label': 'Messages' }); root.document.body.appendChild(toastHost); }
      var kids = [h('div', { class: 'rc-toast__msg', text: spec.message })];
      if (spec.actionLabel) kids.push(RC.button({ label: RC.t(spec.actionLabel), kind: 'ghost', onClick: function () { settle('action'); } }));
      kids.push(h('button', { type: 'button', class: 'rc-btn rc-btn--ghost rc-btn-icon', 'aria-label': RC.t('Dismiss'), text: '×', style: 'color:inherit', onclick: function () { settle('dismissed'); } }));
      var t = h('div', { class: 'rc-toast' + (spec.kind === 'error' ? ' rc-toast--error' : spec.kind === 'success' ? ' rc-toast--success' : ''), role: spec.kind === 'error' ? 'alert' : 'status' }, kids);
      toastHost.appendChild(t);
      while (toastHost.children.length > 3) toastHost.removeChild(toastHost.firstChild);
      return { remove: function () { if (t.parentNode) t.parentNode.removeChild(t); } };
    }
  });
  // rcToast('Saved') / rcToast('Sent', { actionLabel: 'Undo', kind: 'success', duration: 6000 }) -> Promise
  RC.toast = function (message, opts) { return toaster(message, opts); };

  // ===================================================================== empty / loading / error (DESIGN.md section 10)
  function mount(container, el) { if (container) { container.textContent = ''; container.appendChild(el); } return el; }
  // RC.empty(container, { title: 'No jobs yet', text, actionLabel: 'Add a property', onAction })
  RC.empty = function (container, o) {
    o = o || {};
    var el = h('div', { class: 'rc-empty' }, [h('p', { class: 'rc-empty__title', text: RC.t(o.title || 'Nothing here yet') }), o.text ? h('p', { text: RC.t(o.text), style: 'margin:0' }) : null,
      o.actionLabel ? RC.button({ label: o.actionLabel, kind: 'primary', onClick: o.onAction }) : null]);
    return mount(container, el);
  };
  // RC.loading(container, 'Loading your jobs…')   always say what is loading
  RC.loading = function (container, text) {
    return mount(container, h('div', { class: 'rc-loading', role: 'status' }, [h('span', { class: 'rc-loading__spin', 'aria-hidden': 'true' }), h('span', { text: RC.t(text || 'Loading…') })]));
  };
  // RC.error(container, { title: 'Could not load your jobs', text: 'Check your signal and try again.', onRetry })  Retry disables itself while it runs.
  RC.error = function (container, o) {
    o = o || {};
    var el = h('div', { class: 'rc-error', role: 'alert' }, [h('p', { class: 'rc-error__title', text: RC.t(o.title || 'Something went wrong') }), o.text ? h('p', { class: 'rc-error__text', text: RC.t(o.text) }) : null,
      RC.button({ label: o.retryLabel || 'Retry', kind: 'primary', busyLabel: o.busyLabel, onClick: o.onRetry || function () { if (root.location) root.location.reload(); } })]);
    return mount(container, el);
  };

  // ===================================================================== shared-file health: a page stays usable, with a visible warning
  // Pure: which warning (if any) applies. cssVersion is the --rc-ui-version the stylesheet declares ('' if it did not load).
  RC._assetProblem = function (s) {
    if (s.cssFailed || !s.cssVersion) return 'A shared style file (rc-ui.css) did not load, so some parts of this page may look wrong. Reload the page. If this stays, tell Brett.';
    if (s.cssVersion !== s.jsVersion) return 'The shared files on this page are from two different versions. Tap Reload to fix it.';
    return '';
  };
  // The banner is styled inline on purpose: it is shown when rc-ui.css itself may be missing.
  RC.warn = function (message, withReload) {
    if (!root || !root.document || !root.document.body || root.document.getElementById('rc-ui-banner')) return null;
    var b = h('div', { id: 'rc-ui-banner', role: 'alert', style: 'position:fixed;left:0;right:0;top:0;z-index:2147483000;box-sizing:border-box;padding:12px 16px;background:#b42318;color:#ffffff;font:600 15px/1.35 sans-serif' }, [h('span', { text: RC.t(message) })]);
    if (withReload) b.appendChild(h('button', { type: 'button', text: ' ' + RC.t('Reload'), style: 'margin-left:12px;min-height:44px;padding:0 16px;border:1px solid #ffffff;border-radius:8px;background:transparent;color:#ffffff;font:600 15px sans-serif;cursor:pointer',
      onclick: function () { try { var u = new URL(root.location.href); u.searchParams.set('_hr', Date.now().toString(36)); root.location.replace(u.toString()); } catch (e) { root.location.reload(); } } }));
    root.document.body.insertBefore(b, root.document.body.firstChild);
    RC.report('assets', message);
    return b;
  };
  RC.checkAssets = function () {
    var d = root.document, v = '';
    try { v = (root.getComputedStyle(d.documentElement).getPropertyValue('--rc-ui-version') || '').replace(/["'\s]/g, ''); } catch (e) { RC.report('assets', e); }
    var msg = RC._assetProblem({ cssFailed: d.documentElement.getAttribute('data-rc-css-failed') === '1', cssVersion: v, jsVersion: RC_UI_VERSION });
    if (msg) RC.warn(msg, /different versions/.test(msg));
    return msg;
  };
  RC._boot = function () {
    var d = root.document;
    function go() { try { RC.checkAssets(); RC.applyBrand(d); } catch (e) { RC.report('boot', e); } }
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', go); else go();
  };

  return RC;
});
