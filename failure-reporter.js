/* failure-reporter.js - no-silent-failures phase A2 (Oct 16 2026). Included by every Hub page.
 *
 * 1. Reports page errors to the Hub failure ledger (POST /failure/report): uncaught errors, unhandled promise rejections,
 *    and Hub API calls that fail (network error or HTTP 5xx). Users see a short friendly notice, never a blank failure.
 * 2. For the admin (a Hub access token is saved on this device): shows a red "N problems" badge that links to
 *    failures.html (Needs Attention). Hidden when there are no open problems or the token is not an admin token.
 * 3. Exposes window.hubReportFailure(where, message, extra) for use inside catch blocks (replaces empty catches).
 *
 * Rules this file follows itself: it never throws into the page, it never reports its own reporting calls (no loops),
 * it caps reports per page load, it never sends a URL query string or any token, and when it cannot report it says so in
 * the console (it cannot do better than that).
 */
(function () {
  'use strict';
  if (window.__hubFailureReporter) return;
  window.__hubFailureReporter = true;

  var params = new URLSearchParams(location.search);
  var STAGING = params.has('staging') || params.get('env') === 'staging';
  var WORKER = STAGING ? 'https://maintenance-hub-staging.brett-2f8.workers.dev' : 'https://maintenance-hub.brett-2f8.workers.dev';
  var AUTH_KEY = STAGING ? 'mh_auth_staging' : 'mh_auth';
  var MAX_REPORTS = 8, sent = 0, seen = {}, unloading = false, lastToast = 0;
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var page = (location.pathname.split('/').pop() || 'index.html').slice(0, 60);
  var es = /^es\b/i.test((navigator.language || '') + '');

  window.addEventListener('beforeunload', function () { unloading = true; });
  window.addEventListener('pagehide', function () { unloading = true; });

  function consoleErr() { try { console.error.apply(console, arguments); } catch (e) { /* silent-ok: console unavailable, nothing else exists to tell */ } }
  function clip(s, n) { s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // Friendly, non-blocking notice (one per 20 s). Text only, no HTML from the error is ever inserted.
  function toast() {
    try {
      var now = Date.now(); if (now - lastToast < 20000) return; lastToast = now;
      if (!document.body) return;
      var t = document.createElement('div');
      t.setAttribute('role', 'status');
      t.textContent = es ? 'Algo no funcionó. Ya nos avisaron y lo vamos a arreglar.' : "Something didn't work. We've been notified and will fix it.";
      t.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:92vw;background:#0e1621;color:#fff;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.35);z-index:2147483000';
      document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (e) { /* silent-ok: element already gone, nothing to remove */ } }, 7000);
    } catch (e) { consoleErr('[failure-reporter] toast failed', e); }
  }

  function report(where, message, extra) {
    try {
      if (unloading || !realFetch) return false;
      message = clip(message, 280); where = clip(where, 70);
      if (!message) message = '(no details)';
      var key = where + '|' + message;
      if (seen[key]) return false;
      seen[key] = 1;
      if (sent >= MAX_REPORTS) { consoleErr('[failure-reporter] report cap reached on this page; dropped:', where, message); return false; }
      sent++;
      var body = { system: 'hub', source: 'browser', where: 'page:' + page + (where ? ' ' + where : ''), ref: clip(extra && extra.ref || '', 70), message: message };
      realFetch(WORKER + '/failure/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
        .then(function (r) { if (!r.ok) consoleErr('[failure-reporter] the Hub did not accept the report (HTTP ' + r.status + '):', where, message); })
        .catch(function (e) { consoleErr('[failure-reporter] could not send report:', where, message, e); });
      return true;
    } catch (e) { consoleErr('[failure-reporter] report failed', e); return false; }
  }

  // 1a. uncaught errors
  window.addEventListener('error', function (ev) {
    try {
      if (ev && ev.target && ev.target !== window && ev.target.tagName) {            // resource failed to load (script/css/img)
        var src = ev.target.src || ev.target.href || '';
        if (/failure\/report/.test(src)) return;
        if (ev.target.tagName === 'IMG') return;                                      // broken images are not worth a report
        report('resource', 'failed to load ' + ev.target.tagName.toLowerCase() + ' ' + String(src).split('?')[0].slice(-80));
        return;
      }
      var msg = ev && ev.message || '';
      if (!msg || /^Script error\.?$/i.test(msg) || /ResizeObserver loop/i.test(msg)) return;   // cross-origin noise carries no information
      var where = (ev.filename ? String(ev.filename).split('?')[0].split('/').pop() : '') + (ev.lineno ? ':' + ev.lineno : '');
      if (report('js-error ' + where, msg)) toast();
    } catch (e) { consoleErr('[failure-reporter] error handler failed', e); }
  }, true);

  // 1b. unhandled promise rejections
  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev && ev.reason, msg = r && r.message ? r.message : (r == null ? '' : String(r));
      if (r && (r.name === 'AbortError' || r.name === 'TimeoutError')) return;
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg) && navigator.onLine === false) return;   // simply offline
      if (report('unhandled-rejection', msg || 'a promise was rejected with no message')) toast();
    } catch (e) { consoleErr('[failure-reporter] rejection handler failed', e); }
  });

  // 1b. "Saved, but ..." warnings. Since Oct 20 2026 the Hub adds `failure_warning` (string) / `failure_warnings` (array of strings) to a success response when a
  // side step FAILED (it is already in the failure ledger). The plain `warning` / `warnings` keys are informational notes (fee notes, deposit cap, previews) and are
  // deliberately ignored here. Shown persistently until dismissed: the admin sees the text; tenants / vendors / owners only a friendly line (never raw server text).
  var warnIsAdmin = false;
  try { warnIsAdmin = !!localStorage.getItem(AUTH_KEY); } catch (e) { warnIsAdmin = false; /* silent-ok: storage blocked, show the friendly line instead */ }
  var WARN_MAX = 5, warnShown = {}, warnCount = 0, warnPending = [], warnRetryHooked = false;
  function warnBar(items) {
    try {
      var fresh = [];
      items.forEach(function (t) { if (t && !warnShown[t] && fresh.indexOf(t) < 0) fresh.push(t); });
      if (!fresh.length) return;
      if (!document.body) {                                                     // page still parsing: keep the lines and show them once the body exists
        warnPending = warnPending.concat(fresh);
        if (!warnRetryHooked && document.addEventListener) {
          warnRetryHooked = true;
          document.addEventListener('DOMContentLoaded', function () { warnRetryHooked = false; var p = warnPending; warnPending = []; warnBar(p); });
        }
        return;
      }
      var bar = document.getElementById('hub-warn-bar');
      if (!bar) {
        warnShown = {}; warnCount = 0;
        bar = document.createElement('div'); bar.id = 'hub-warn-bar'; bar.setAttribute('role', 'alert');
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#7a4b00;color:#fff;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:10px 40px 10px 14px;max-height:25vh;overflow:auto';
        var x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', es ? 'Cerrar' : 'Dismiss');
        x.style.cssText = 'position:absolute;right:8px;top:4px;background:none;border:0;color:#fff;font-size:22px;cursor:pointer';
        x.onclick = function () { try { bar.remove(); warnShown = {}; warnCount = 0; } catch (e) { consoleErr('[failure-reporter] could not dismiss the warning bar', e); } };
        bar.appendChild(x); document.body.appendChild(bar);
      }
      fresh.forEach(function (t) {
        warnShown[t] = 1;
        if (warnCount >= WARN_MAX) return;                                      // total lines cap (the problem is in the failure ledger either way)
        warnCount++;
        var d = document.createElement('div'); d.textContent = t; bar.appendChild(d);
      });
    } catch (e) { consoleErr('[failure-reporter] warning bar failed', e); }
  }
  function watchWarnings(r, path) {
    try {
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (ct.indexOf('json') < 0) return;
      r.clone().json().then(function (b) {
        if (!b || b.preview || b.preview_only) return;                          // dry-run / preview responses never nag
        var items = [];
        if (typeof b.failure_warning === 'string' && b.failure_warning) items.push(b.failure_warning);
        if (Array.isArray(b.failure_warnings)) b.failure_warnings.forEach(function (w) { if (w) items.push(String(w)); });
        if (!items.length) return;
        warnBar(warnIsAdmin ? items.map(function (t) { return (es ? 'Guardado, pero: ' : 'Saved, but: ') + clip(t, 300); })
          : [es ? 'Se guardó, pero una parte necesita seguimiento. Ya nos avisaron.' : 'Saved, but one part needs a follow-up. We\'ve been notified.']);
      }).catch(function (e) { consoleErr('[failure-reporter] warning parse failed for ' + path, e); });
    } catch (e) { consoleErr('[failure-reporter] warning check failed', e); }
  }

  // 1c. Hub API calls that fail. Wrap fetch; never alter the response or the caller's error handling.
  if (realFetch) {
    window.fetch = function (input, init) {
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { url = ''; }
      var isHub = url.indexOf('maintenance-hub') >= 0 && url.indexOf('.workers.dev') >= 0;
      var p = realFetch(input, init);
      if (!isHub || url.indexOf('/failure/report') >= 0) return p;
      var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 60);
      var isWrite = !!(init && init.method && String(init.method).toUpperCase() !== 'GET');
      p.then(function (r) {
        try { if (r && r.status >= 500) { if (report('api ' + path, 'HTTP ' + r.status + ' from ' + path)) toast(); } } catch (e) { consoleErr('[failure-reporter] status check failed', e); }
        if (isWrite && r && r.ok) watchWarnings(r, path);
      }, function (e) {
        try {
          if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
          if (navigator.onLine === false) return;
          if (report('api ' + path, 'network error calling ' + path + ': ' + (e && e.message || e))) toast();
        } catch (x) { consoleErr('[failure-reporter] network check failed', x); }
      });
      return p;
    };
  }

  // 3. manual reporting from catch blocks
  window.hubReportFailure = function (where, message, extra) {
    // ordinary network conditions (offline, aborted, timed out) are not Hub failures: no report, no toast
    if (navigator.onLine === false || (message && (message.name === 'AbortError' || message.name === 'TimeoutError'))) return false;
    var did = report(where || 'caught', message && message.message ? message.message : message, extra);
    if (did) toast();
    return did;
  };

  // 2. admin badge
  var token = '';
  try { token = localStorage.getItem(AUTH_KEY) || ''; } catch (e) { token = ''; /* storage blocked: no admin badge, reporting still works */ }
  if (!token || !realFetch || /failures\.html$/.test(location.pathname)) return;
  var CACHE_KEY = 'hub_fail_badge_v1';

  function paint(n, worst) {
    try {
      var old = document.getElementById('hub-fail-badge'); if (old) old.remove();
      if (!n) return;
      var a = document.createElement('a');
      a.id = 'hub-fail-badge'; a.href = 'failures.html' + (STAGING ? '?staging=1' : '');
      a.textContent = n < 0 ? '⚠ problem list unavailable' : '⚠ ' + n + (n === 1 ? ' problem' : ' problems');
      a.title = 'Open failures in the Hub (Needs Attention)';
      var bg = (n < 0 || worst === 'P0') ? '#c0242b' : (worst === 'P1' ? '#b26a00' : '#5b6672');
      var nav = document.getElementById('rc-navbar');
      if (nav) {
        a.style.cssText = 'flex:none;background:' + bg + ';color:#fff;text-decoration:none;border-radius:12px;padding:3px 9px;font:800 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;white-space:nowrap';
        var sel = document.getElementById('rc-nav-jump');
        if (sel && sel.parentNode === nav) nav.insertBefore(a, sel); else nav.appendChild(a);
      } else {
        a.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147482000;background:' + bg + ';color:#fff;text-decoration:none;border-radius:16px;padding:7px 12px;font:800 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)';
        if (document.body) document.body.appendChild(a);
      }
    } catch (e) { consoleErr('[failure-reporter] badge paint failed', e); }
  }

  function badge() {
    try {
      var cached = null;
      try { cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { cached = null; /* silent-ok: private mode, so just fetch fresh */ }
      if (cached && Date.now() - cached.t < 60000) { paint(cached.n, cached.w); return; }
      realFetch(WORKER + '/failures/open', { headers: { 'X-Auth-Token': token } })
        .then(function (r) {
          if (r.status === 401 || r.status === 403) return null;                       // not an admin token on this device: no badge
          if (!r.ok) { consoleErr('[failure-reporter] could not read the open-failures list (HTTP ' + r.status + ')'); paint(-1, 'P0'); return null; }
          return r.json();
        })
        .then(function (d) {
          if (!d) return;
          var c = d.counts || {}, n = Math.max(0, (c.open || 0) - (c.acknowledged || 0)), w = c.P0 ? 'P0' : (c.P1 ? 'P1' : 'P2');
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), n: n, w: w })); } catch (e) { /* cache is optional */ }
          paint(n, w);
        })
        .catch(function (e) { consoleErr('[failure-reporter] badge refresh failed', e); });
    } catch (e) { consoleErr('[failure-reporter] badge failed', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', badge); else badge();
  setInterval(badge, 120000);
})();
