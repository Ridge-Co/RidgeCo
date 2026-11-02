/* rc-related.js — "related tools" links in the blue top bar (Oct 30 2026).
 *
 * Tools that belong together link to each other directly, so nobody has to go back to the Hub in between (Field Inspection <-> Inspection Scheduler).
 * HOW TO USE: put   <script src="rc-related.js" data-group="inspections"></script>   right after the #rc-navbar element on the page.
 * HOW TO ADD A NEW RELATED TOOL: add its page to the right group in RC_RELATED below (or start a new group), then add the script tag to that page.
 * Every page in a group shows a chip for every OTHER page in the group; the current page is not linked to itself.
 * CLAUDE.md has the standing rule: any new page that is directly related to existing ones joins their group by default. test/rc-related.test.mjs enforces it.
 */
(function () {
  var RC_RELATED = {
    inspections: [
      { href: 'inspect.html', label: '📅 Scheduler' },
      { href: 'field-inspect.html', label: '📋 Field Inspection' }
    ]
  };
  try {
    var me = document.currentScript, group = me && me.getAttribute('data-group');
    var items = group && RC_RELATED[group];
    if (!items) { console.error('rc-related.js: unknown or missing data-group "' + group + '"'); return; }
    var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var bar = document.getElementById('rc-navbar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'rc-navbar';
      bar.style.cssText = 'background:#1d4ed8;color:#fff;display:flex;align-items:center;gap:8px;padding:6px 10px;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
      var hub = document.createElement('a'); hub.href = 'index.html'; hub.textContent = '← Hub'; hub.style.cssText = 'color:#fff;text-decoration:none';
      bar.appendChild(hub);
      document.body.insertBefore(bar, document.body.firstChild);
    }
    var wrap = document.createElement('span');
    wrap.id = 'rc-related'; wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:none;margin-left:4px;padding-left:10px;border-left:1px solid rgba(255,255,255,.35)';
    items.forEach(function (it) {
      if (it.href.toLowerCase() === here) return;
      var a = document.createElement('a'); a.href = it.href; a.textContent = it.label;
      a.style.cssText = 'color:#1d4ed8;background:#fff;text-decoration:none;border-radius:999px;padding:3px 10px;font:700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;white-space:nowrap';
      wrap.appendChild(a);
    });
    if (!wrap.childNodes.length) return;
    var first = bar.querySelector('a');
    if (first && first.nextSibling) bar.insertBefore(wrap, first.nextSibling); else bar.appendChild(wrap);
  } catch (e) {
    console.error('rc-related.js failed', e);
    try { if (window.hubReportFailure) window.hubReportFailure('rc-related.js', String((e && e.message) || e), {}); } catch (e2) { console.error('failure report failed', e2); }
  }
})();
