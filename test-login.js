/* RidgeCo staging TEST MODE shim  (Sep 30 2026)
 * ---------------------------------------------------------------------------------------------
 * Every page (except static legal/proposal pages) loads this FIRST in <head>:
 *     <script src="test-login.js"></script>
 * It does NOTHING unless the tab was opened with ?testmode=1 (remembered per tab in
 * sessionStorage; ?testmode=0 turns it off). Normal use / production is untouched.
 *
 * In test mode it:
 *   1. Rewrites every fetch/XHR aimed at the PRODUCTION Worker to the STAGING Worker.
 *   2. Makes the admin-code storage keys (mh_auth, mh_auth_staging) return the staging test-window
 *      sentinel and never persist anything - the real admin code is never used or stored.
 *      Portal session keys (mh_vendor_sess / mh_owner_sess / mh_tenant_sess / mh_wo_share_*) are
 *      redirected to sessionStorage so a test tab can never leave a session behind for real use.
 *   3. Logs in for you: fills password/token/worker-url inputs on admin tools and mints a TEST-
 *      portal session (vendor/owner/tenant) from POST /staging/ui-test-session. Any PIN typed on a
 *      portal login screen also resolves to the TEST session. ?as=<id> picks a specific TEST entity.
 *   4. Auto-answers confirm()/prompt()/alert() (they block browser automation) and records them in
 *      window.__testDialogs. Set window.__testDialogsOff = true to get the real dialogs back.
 *   5. Shows a "TESTMODE" banner.
 * The sentinel is only honoured by the STAGING Worker while a test window is open
 * (POST /staging/ui-test-window {minutes}), only ever reads/writes TEST- data for writes, and is
 * rejected outright by production. This file holds no secret.
 * RULE: every new non-static *.html page must include this script (test/test-login-coverage.test.mjs
 * fails otherwise).
 */
(function () {
  'use strict';
  var STAGING = 'https://maintenance-hub-staging.brett-2f8.workers.dev';
  var PROD = 'https://maintenance-hub.brett-2f8.workers.dev';
  var SENT = '__staging_ui_test__';
  var on = false;
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('testmode') === '1') sessionStorage.setItem('mh_testmode', '1');
    else if (q.get('testmode') === '0') sessionStorage.removeItem('mh_testmode');
    on = sessionStorage.getItem('mh_testmode') === '1';
  } catch (e) {}
  if (!on) return;
  window.__testmode = true;
  window.__testDialogs = [];

  var qs = new URLSearchParams(location.search);
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // ---- 1. worker rewrite --------------------------------------------------------------------
  function rw(u) {
    if (typeof u === 'string' && u.indexOf(PROD) === 0) return STAGING + u.slice(PROD.length);
    return u;
  }
  var PORTAL_LOGIN = { '/vendor-by-pin': 'vendor', '/owner-by-pin': 'owner', '/tenant-by-pin': 'tenant' };
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  var OrigXHR = window.XMLHttpRequest;

  function mintSync(role) {
    try {
      var x = new OrigXHR();
      x.open('POST', STAGING + '/staging/ui-test-session', false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.setRequestHeader('X-Auth-Token', SENT);
      x.send(JSON.stringify({ role: role, id: qs.get('as') || undefined }));
      var j = JSON.parse(x.responseText || '{}');
      if (x.status === 200 && j && j.token) return j;
      window.__testmodeError = (j && j.error) || ('mint HTTP ' + x.status);
    } catch (e) { window.__testmodeError = String(e); }
    return null;
  }

  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var u = rw(url);
        var m = /^https:\/\/maintenance-hub-staging\.brett-2f8\.workers\.dev(\/(?:vendor|owner|tenant)-by-pin)(?:\?|$)/.exec(u);
        if (m) {
          var minted = mintSync(PORTAL_LOGIN[m[1]]);
          if (minted) return Promise.resolve(new Response(JSON.stringify(minted), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (u !== url) input = typeof input === 'string' ? u : new Request(u, input);
      } catch (e) {}
      return origFetch(input, init);
    };
  }
  if (OrigXHR) {
    var oOpen = OrigXHR.prototype.open;
    OrigXHR.prototype.open = function (method, url) {
      var a = Array.prototype.slice.call(arguments);
      a[1] = rw(String(url));
      return oOpen.apply(this, a);
    };
  }

  // ---- 2. storage shim ----------------------------------------------------------------------
  var ADMIN_KEYS = { mh_auth: 1, mh_auth_staging: 1 };
  var SESSION_REDIRECT = /^(mh_vendor_sess|mh_owner_sess|mh_tenant_sess|mh_api_staging|mh_wo_share_.*)$/;
  var SP = Storage.prototype, gI = SP.getItem, sI = SP.setItem, rI = SP.removeItem;
  function isLS(s) { try { return s === window.localStorage; } catch (e) { return false; } }
  SP.getItem = function (k) {
    if (isLS(this)) {
      if (ADMIN_KEYS[k]) return SENT;
      if (k === 'mh_api_staging') return '1';
      if (SESSION_REDIRECT.test(k)) return gI.call(window.sessionStorage, k);
    }
    return gI.apply(this, arguments);
  };
  SP.setItem = function (k, v) {
    if (isLS(this)) {
      if (ADMIN_KEYS[k]) return;
      if (SESSION_REDIRECT.test(k)) return sI.call(window.sessionStorage, k, v);
    }
    return sI.apply(this, arguments);
  };
  SP.removeItem = function (k) {
    if (isLS(this)) {
      if (ADMIN_KEYS[k]) return;
      if (SESSION_REDIRECT.test(k)) return rI.call(window.sessionStorage, k);
    }
    return rI.apply(this, arguments);
  };

  // ---- 3a. portal session seed --------------------------------------------------------------
  var PORTAL_PAGES = { 'vendor.html': ['vendor', 'mh_vendor_sess'], 'owner.html': ['owner', 'mh_owner_sess'], 'tenant.html': ['tenant', 'mh_tenant_sess'] };
  var pp = PORTAL_PAGES[page];
  if (pp) {
    try {
      var have = gI.call(window.sessionStorage, pp[1]);
      var fresh = false;
      if (have) { var hj = JSON.parse(have); fresh = !!(hj && hj.token && hj._tm_ts && (Date.now() - hj._tm_ts) < 90 * 60 * 1000 && (!qs.get('as') || String(hj._tm_id) === qs.get('as'))); }
      if (!fresh) {
        var s = mintSync(pp[0]);
        if (s) { s._tm_ts = Date.now(); s._tm_id = qs.get('as') || ''; sI.call(window.sessionStorage, pp[1], JSON.stringify(s)); }
      }
    } catch (e) {}
  }

  // ---- 4. dialogs ---------------------------------------------------------------------------
  var oConfirm = window.confirm, oPrompt = window.prompt, oAlert = window.alert;
  window.confirm = function (m) { if (window.__testDialogsOff) return oConfirm.call(window, m); window.__testDialogs.push({ t: 'confirm', m: String(m) }); return true; };
  window.prompt = function (m, d) { if (window.__testDialogsOff) return oPrompt.call(window, m, d); window.__testDialogs.push({ t: 'prompt', m: String(m), d: d }); return (d !== undefined && d !== null && d !== '') ? d : 'TEST'; };
  window.alert = function (m) { if (window.__testDialogsOff) return oAlert.call(window, m); window.__testDialogs.push({ t: 'alert', m: String(m) }); };

  // ---- 3b + 5. DOM: banner, input fill, login click -----------------------------------------
  function setVal(el, v) {
    if (!el || el.value === v) return;
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fillAdminInputs() {
    var inputs = document.querySelectorAll('input');
    var filled = false;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i], id = (el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || '');
      if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') continue;
      if (/worker.?url|api.?url|worker.?base/i.test(id)) { if (!el.value || el.value.indexOf(PROD) === 0) setVal(el, STAGING); continue; }
      if (PORTAL_PAGES[page]) continue; // portals use PIN sessions, not the admin code
      if (el.type === 'password' || /auth.?token|admin.?(code|pw|pass)|access.?code|secret|login.?pw|\btoken\b|passcode/i.test(id)) {
        if (/\bpin\b|name/i.test(el.id || '') && el.type !== 'password') continue;
        if (!el.value || /localStorage/.test(el.value)) { setVal(el, SENT); filled = true; } // owner-setup.html ships JS text as the field value
      }
    }
    return filled;
  }
  function tryLogin(filled) {
    if (!filled) return;
    // Admin tools whose login screen never reads mh_auth: submit the sentinel through their own login.
    if (document.getElementById('login-pw') && typeof window.doLogin === 'function') { try { window.doLogin(); } catch (e) {} return; }
    var pw = document.querySelector('input[type=password]');
    if (pw && pw.offsetParent !== null && typeof window.doLogin === 'function') { try { window.doLogin(); } catch (e) {} }
  }
  function banner() {
    var b = document.createElement('div');
    b.id = 'testmode-banner';
    b.style.cssText = 'position:fixed;bottom:6px;left:6px;z-index:2147483647;background:#0f766e;color:#fff;font:11px/1.3 system-ui,sans-serif;padding:3px 8px;border-radius:10px;opacity:.92;pointer-events:none';
    b.textContent = 'TESTMODE - staging' + (window.__testmodeError ? ' - ' + window.__testmodeError : '');
    if (window.__testmodeError) b.style.background = '#b91c1c';
    (document.body || document.documentElement).appendChild(b);
  }
  function ready() {
    banner();
    var n = 0;
    (function loop() {
      var f = fillAdminInputs();
      if (f) tryLogin(true);
      if (++n < 6) setTimeout(loop, 500);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
