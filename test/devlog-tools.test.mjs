// Tools & Log page re-layout (Oct 20 2026). The Hub's "Dev Log" tab was ~35 identical buttons; it is now grouped, searchable,
// has a pinned "Most used" row and a one-line plain-language description on every tool. The rule for this change:
// LAYOUT ONLY. Every tool that existed before must still exist exactly once, with the SAME click handler, and every id other
// code reads (error log, wishlist, vendor requests, tool result panel...) must still be there. Anything that failed visibly
// before must still fail visibly (dlLoadFailed) - no silent failures.
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function pageHtml() {
  const i = html.indexOf('<div class="page" id="page-devlog"'); ok(i > 0, 'Dev Log page exists');
  let d = 0; const re = /<(\/?)div\b/g; re.lastIndex = i; let m;
  while ((m = re.exec(html))) { d += m[1] ? -1 : 1; if (d === 0) return html.slice(i, m.index + 6); }
  throw new Error('page-devlog div never closes');
}
const page = pageHtml();

// The 32 tools: key -> exactly the onclick the button had before the re-layout (do not "tidy" these).
const TOOLS = {
  'scope-creator': "window.open('scope-creator.html','_blank')",
  'inspection-scheduler': "window.open('inspect.html','_blank')",
  'field-inspection': "window.open('field-inspect.html','_blank')",
  'action-center': "window.open('action-center.html','_blank')",
  'command-center': "window.open('command-center.html','_blank')",
  'tasks-manager': "window.open('https://script.google.com/a/macros/bmoremanagement.com/s/AKfycbw9-FjmVfm86mQpzjvTDzrnHOy1HGCGvR4MIVBbEK6yHiYOoIaK1PQ0MWDCzhCEWLpT/exec','_blank')",
  'brettos-tasks-sheet': "window.open('https://docs.google.com/spreadsheets/d/1X2oYjDfnGzJWDI84e1t4p7cbt9iWxq5qbPmNFI9auuA/edit','_blank')",
  'proposals': "window.open('proposals.html','_blank')",
  'deliveries': "window.open('deliveries.html','_blank')",
  'tenant-wo-access': "window.open('tenant-wo-access.html','_blank')",
  'wo-templates': 'openManageTemplatesModal()',
  'message-queue': "window.open('message-queue.html','_blank')",
  'read-meter': "window.open('read-meter.html','_blank')",
  'vendor-reconcile': "window.open('vendor-reconcile.html','_blank')",
  'receipt-reconciler': "window.open('receipt-reconciler.html','_blank')",
  'open-item-report': "window.open('ar-report-admin.html','_blank')",
  'qb-emails': "window.open('qb-email-backfill.html','_blank')",
  'unsent-invoice-emails': "window.open('qb-invoice-email-backfill.html','_blank')",
  'repair-invoices': 'findRepairableInvoices()',
  'signed-proposals': "window.open('signed-proposals.html','_blank')",
  'trash-billing': "window.open('trash.html','_blank')",
  'qb-mapping': 'goToQBMapping()',
  'bulk-import': "window.open('bulk-importer.html','_blank')",
  'fix-pins': "runAdminTool('fix-pins')",
  'stale-tenants': 'checkStaleTenants(false)',
  'migrate-trades': 'migrateTrades(false)',
  'dup-properties': 'checkDuplicateProperties()',
  'dup-owners': 'checkDuplicateOwners()',
  'reformat-sheets': "runAdminTool('reformat-sheets')",
  'share-photos': 'shareAttachments(false)',
  'ops-review': 'runOpsReview()',
  'test-telemetry': 'logTestTelemetry()',
};
// Non-tool controls on the same page that other code / Brett rely on.
const OTHER_HANDLERS = ['saveTradeAccessDefault()', 'saveAlertFlags()', 'clearErrorLog()', 'clearWishlistDone()', 'addWishlistItem()', 'loadCache()'];
// Ids that existing loaders write into (renaming any of these would make a loader fail silently).
const KEEP_IDS = ['admin-tool-result', 'alert-flag-deadman', 'alert-flag-failure', 'alert-flags-status', 'cache-list', 'error-log-list', 'page-devlog',
  'trade-access-list', 'trade-access-trade', 'trade-access-val', 'var-nav-count-inline', 'vendor-access-requests-list', 'vtr-review-list',
  'vtr-review-wrap', 'wishlist-filters', 'wishlist-input', 'wishlist-list'];

// 1) every tool exists exactly once as a tile button, with its original handler, a description and a known kind
const tileRe = /<div class="dl-tool" data-tool="([^"]+)" data-kind="([^"]+)"><button([^>]*)>(.*?)<\/button>.*?<p class="dl-desc">(.*?)<\/p>/gs;
const tiles = {}; let m;
while ((m = tileRe.exec(page))) {
  assert.ok(!tiles[m[1]], 'tool listed twice: ' + m[1]);
  const oc = /onclick="([^"]*)"/.exec(m[3]);
  tiles[m[1]] = { kind: m[2], onclick: oc && oc[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'"), label: m[4].trim(), desc: m[5].replace(/<[^>]+>/g, '').trim() };
}
ok(Object.keys(tiles).length === Object.keys(TOOLS).length, 'tile count ' + Object.keys(tiles).length + ' == ' + Object.keys(TOOLS).length);
for (const [k, handler] of Object.entries(TOOLS)) {
  const t = tiles[k]; ok(t, 'tool present: ' + k);
  ok(t.onclick === handler, 'same handler for ' + k + ': ' + t.onclick);
  ok(t.label.length > 2, 'has a label: ' + k);
  ok(t.desc.length >= 12 && t.desc.length <= 140, 'one-line plain description (12-140 chars) for ' + k + ' (' + t.desc.length + ')');
  ok(['open', 'fix', 'careful'].includes(t.kind), 'known kind for ' + k);
}
// the three kinds: risky tools that change live data with NO preview must be red, and say so
for (const k of ['fix-pins', 'reformat-sheets', 'qb-emails', 'unsent-invoice-emails', 'repair-invoices']) ok(tiles[k].kind === 'careful', k + ' is marked Careful');
for (const k of ['bulk-import', 'stale-tenants', 'migrate-trades', 'share-photos']) ok(tiles[k].kind === 'fix', k + ' is marked Fixes data');
ok(new RegExp('class="dl-kind careful">[^<]*No preview').test(page), 'the no-preview tools say "No preview"');

// 2) the Read Meter button still opens read-meter.html, and that page still ships
ok(tiles['read-meter'].onclick === "window.open('read-meter.html','_blank')", 'Read Meter opens read-meter.html');
ok(fs.existsSync(new URL('../read-meter.html', import.meta.url)), 'read-meter.html exists');

// 3) every page the tools open exists in the repo, and every handler function exists in index.html
for (const [k, h] of Object.entries(TOOLS)) {
  const w = /window\.open\('([^']+)'/.exec(h);
  if (w && !/^https:/.test(w[1])) ok(fs.existsSync(new URL('../' + w[1], import.meta.url)), k + ' opens a real page: ' + w[1]);
  const f = /^([A-Za-z]+)\(/.exec(h);
  if (f) ok(new RegExp('function\\s+' + f[1] + '\\s*\\(').test(html), 'handler function exists: ' + f[1]);
}
for (const h of OTHER_HANDLERS) { ok(page.includes('onclick="' + h + '"'), 'still on the page: ' + h); ok(new RegExp('function\\s+' + h.replace('()', '') + '\\s*\\(').test(html), 'function exists: ' + h); }
for (const id of KEEP_IDS) ok(page.includes('id="' + id + '"'), 'kept id: ' + id);
ok(/function\s+runAdminTool\s*\(/.test(html), 'runAdminTool exists');

// 4) no silent failures: the two loaders that used to fail silently now route to the visible helper, and every catch in the new script surfaces
ok(/function dlLoadFailed\(/.test(html), 'dlLoadFailed helper exists');
ok(/dlLoadFailed\('wishlist-list'/.test(html), 'wishlist load failure is shown on screen');
ok(/dlLoadFailed\('vendor-access-requests-list'/.test(html), 'vendor-access-requests load failure is shown on screen');
// api() resolves with {error:...} on a server-side failure (it only rejects on network errors), so the loaders must treat a non-list answer as a failure too
ok(/if\(!Array\.isArray\(items\)\) throw new Error/.test(html), 'wishlist: an {error} answer is a failure, not an empty list');
ok(/if\(!Array\.isArray\(rows\)\) throw new Error/.test(html), 'vendor access requests: an {error} answer is a failure, not "No pending requests."');
const helper = html.slice(html.indexOf('function dlLoadFailed('), html.indexOf('function dlLoadFailed(') + 1200);
ok(/logError\(/.test(helper) && /\/failure\/report/.test(helper) && /Retry/.test(helper), 'helper logs, reports to the failure ledger, and offers Retry');
const script = html.slice(html.indexOf('// TOOLS & LOG page behaviour'), html.indexOf('</script>', html.indexOf('// TOOLS & LOG page behaviour')));
ok(/id="dl-storage-note"/.test(page) && /storageFailed\(\)/.test(script), 'a browser that refuses storage is told so on the page');
ok(/localStorage\.getItem\(k\)\s*;\s*\}\s*catch/.test(script) && /localStorage\.setItem\(k, v\)\s*;\s*\}\s*catch/.test(script), 'localStorage reads/writes are in try/catch');
for (const c of script.matchAll(/catch \(\w+\) \{([^}]*)\}/g)) ok(/note\(|storageFailed\(|logError\(/.test(c[1]), 'catch surfaces the problem: ' + c[1].trim().slice(0, 60));

// 5) phone layout: nothing forces horizontal scroll, touch targets are big enough
const css = html.slice(html.indexOf('/* ── TOOLS & LOG'), html.indexOf('/* ── TOOLS & LOG') + 9000);
ok(/minmax\(min\(\d+px,\s*100%\),\s*1fr\)/.test(css), 'tool grid uses min(…,100%) so it never overflows a phone');
ok(/\.dl-tool-btn \{[^}]*min-height:\s*44px/.test(css) && /\.dl-star \{[^}]*min-height:\s*44px/.test(css), 'tool buttons and pin stars are 44px tall');

// 6) the tab is renamed everywhere it is named
ok(/TOOLS &amp; LOG/.test(html), 'nav tab reads TOOLS & LOG');
ok(!/DEV LOG<\/button>/.test(html), 'no leftover DEV LOG tab label');
console.log('devlog-tools: ' + n + ' checks passed');
