/* Admin "Open as ..." view for the tenant and owner portals (Nov 24 2026).
 * Brett opens a tenant's or owner's portal from the Hub to show them exactly where things are. The Hub mints a 4-hour
 * session (POST /admin/tenant-view-session or /admin/owner-view-session, admin secret only) and opens
 *   tenant.html#av=<session>   or   owner.html#av=<session>
 * This script runs BEFORE the page's own script:
 *   - reads the #av= handoff, keeps it in THIS TAB ONLY (sessionStorage), and wipes it from the address bar;
 *   - exposes window.RC_ADMIN_VIEW (the session) so the page logs in with it instead of the person's saved login;
 *   - the page points its saved-login key at a shadow key, so the person's real login on this device is never touched;
 *   - RCAdminView.bar() shows the orange ADMIN VIEW bar with Exit; RCAdminView.end() drops the view when it ends.
 * The Worker treats the session exactly like that person's own login (same allow-list, same money firewall), except it
 * never counts as them using the portal. vendor.html has the same thing inline (built first).
 */
(function () {
  'use strict';
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  var role = page === 'tenant.html' ? 'tenant' : page === 'owner.html' ? 'owner' : '';
  var KEY = 'mh_admin_view_' + role;
  var view = null;
  function report(where, e) { try { if (window.hubReportFailure) window.hubReportFailure(where, String((e && e.message) || e)); } catch (e2) { console.error(where, e, e2); } } // silent-ok: the reporter itself failed; the console keeps the error
  if (role) {
    try {
      var m = /[#&]av=([^&]+)/.exec(location.hash || '');
      if (m) {
        var s = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        var d = JSON.parse(decodeURIComponent(escape(atob(s))));
        if (d && d.token && d.admin_view && d.admin_view_role === role) sessionStorage.setItem(KEY, JSON.stringify(d));
        else report('admin_view_handoff', 'Open-as link was for a different portal or incomplete');
        history.replaceState(null, '', location.pathname + location.search);
      }
      var raw = sessionStorage.getItem(KEY);
      if (raw) { var a = JSON.parse(raw); if (a && a.token && a.admin_view_role === role) view = a; }
    } catch (e) { report('admin_view_handoff', e); }
  }
  window.RC_ADMIN_VIEW = view;
  window.RCAdminView = {
    shadowKey: 'mh_admin_view_shadow_' + role,
    bar: function () {
      if (!view) return;
      function draw() {
        if (document.getElementById('adminViewBar')) return;
        var b = document.createElement('div');
        b.id = 'adminViewBar';
        b.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:99998;background:#b45309;color:#fff;font:600 13px/1.35 system-ui,sans-serif;padding:8px 10px;display:flex;gap:10px;align-items:center;justify-content:space-between';
        var t = document.createElement('span');
        t.textContent = 'ADMIN VIEW: you are seeing ' + (view.admin_view_name || ('this ' + role)) + '’s portal exactly as they do. Anything you save here is saved as them.';
        var x = document.createElement('button');
        x.textContent = 'Exit';
        x.style.cssText = 'background:#fff;color:#b45309;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer';
        x.onclick = function () { window.RCAdminView.exit(); };
        b.appendChild(t); b.appendChild(x);
        document.body.insertBefore(b, document.body.firstChild);
      }
      if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw);
    },
    exit: function () {
      try { sessionStorage.removeItem(KEY); localStorage.removeItem(window.RCAdminView.shadowKey); } catch (e) { report('admin_view_exit', e); }
      window.close();
      setTimeout(function () { location.href = location.pathname; }, 150);
    },
    // Called from the page's logout: returns true when an admin view just ended (the page then shows the message).
    end: function () {
      if (!view) return false;
      view = null; window.RC_ADMIN_VIEW = null;
      try { sessionStorage.removeItem(KEY); } catch (e) { report('admin_view_end', e); }
      var bb = document.getElementById('adminViewBar'); if (bb) bb.remove();
      return true;
    }
  };
})();
