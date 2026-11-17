// Tests the pure date-window-check logic behind Part 5 (Sep 22 2026, Brett 7:57pm): "when I'm
// matching a receipt to a work order I can't see when that WO was opened/closed — I want to
// eyeball whether the receipt date makes sense next to the WO's own dates."
// Extracts the REAL functions straight out of receipt-reconciler.html's inline <script> (not
// reimplemented) so this can't drift from what ships, mirroring receipt-suggest-core.test.mjs's
// convention of grabbing pure functions out of the real source rather than duplicating them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'receipt-reconciler.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('could not find inline <script> in receipt-reconciler.html');
const src = scriptMatch[1];

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const isoConst = 'const ISO_DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;\n';
const { woDatesLabel, woDateWindowWarning } = new Function(
  isoConst + grab('woDatesLabel') + '\n' + grab('woDateWindowWarning') + '\nreturn { woDatesLabel, woDateWindowWarning };'
)();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

// ── woDatesLabel ──────────────────────────────────────────────────────────────────────────────
ok(woDatesLabel({ Created_Date: '2026-08-01', Completed_Date: '' }) === 'opened 2026-08-01', 'open WO (no Completed_Date) shows opened only');
ok(woDatesLabel({ Created_Date: '2026-08-01', Completed_Date: '2026-09-10' }) === 'opened 2026-08-01 · closed 2026-09-10', 'closed WO shows both dates');
ok(woDatesLabel({ Created_Date: '2026-08-01T14:22:00.000Z', Completed_Date: '' }) === 'opened 2026-08-01', 'full ISO timestamp Created_Date is truncated to the date part');
ok(woDatesLabel({ Created_Date: '', Completed_Date: '' }) === '', 'no dates on file -> empty label, never throws');
ok(woDatesLabel({}) === '', 'missing fields entirely -> empty label');
ok(woDatesLabel(null) === '', 'null WO -> empty label, never throws');
ok(woDatesLabel({ Created_Date: 'not-a-date', Completed_Date: 'also-not' }) === '', 'unparseable date strings are dropped, not shown garbled');

// ── woDateWindowWarning ──────────────────────────────────────────────────────────────────────
const wo = { ID: '4021', Created_Date: '2026-08-01', Completed_Date: '2026-09-10' };
ok(woDateWindowWarning('2026-08-15', wo) === null, 'receipt dated inside the open→close window -> no warning');
ok(woDateWindowWarning('2026-08-01', wo) === null, 'receipt dated exactly on the opened date -> no warning (boundary inclusive)');
ok(woDateWindowWarning('2026-09-10', wo) === null, 'receipt dated exactly on the closed date -> no warning (boundary inclusive)');

const before = woDateWindowWarning('2026-07-15', wo);
ok(before && before.type === 'before_open', 'receipt dated before the WO opened -> before_open warning');
ok(/predates this WO/.test(before.message) && /2026-08-01/.test(before.message), 'before_open message names the opened date (' + before.message + ')');

const after = woDateWindowWarning('2026-09-25', wo);
ok(after && after.type === 'after_close', 'receipt dated after the WO closed -> after_close warning');
ok(/dated after this WO closed/.test(after.message) && /2026-09-10/.test(after.message), 'after_close message names the closed date (' + after.message + ')');

// Still-open WO (no Completed_Date) — only the before-open check can ever fire.
const openWo = { ID: '5001', Created_Date: '2026-09-01', Completed_Date: '' };
ok(woDateWindowWarning('2026-09-20', openWo) === null, 'still-open WO, receipt well after opened -> no warning (nothing to compare against for "closed")');
const openBefore = woDateWindowWarning('2026-08-01', openWo);
ok(openBefore && openBefore.type === 'before_open', 'still-open WO but receipt predates its own opened date -> still warns');

// Missing/unparseable data must never warn (never a false positive on incomplete data) and must
// never throw.
ok(woDateWindowWarning('', wo) === null, 'blank receipt date -> no warning');
ok(woDateWindowWarning('not-a-date', wo) === null, 'unparseable receipt date -> no warning');
ok(woDateWindowWarning('2026-07-01', { ID: '9', Created_Date: '', Completed_Date: '' }) === null, 'WO with no dates on file at all -> no warning (nothing to compare against)');
ok(woDateWindowWarning('2026-07-01', null) === null, 'null WO -> no warning, never throws');
ok(woDateWindowWarning(null, wo) === null, 'null receipt date -> no warning, never throws');

// A WO that's Complete-but-still-"open" per OPEN_WO_STATUSES (Complete stays open in this picker
// per worker.js's OPEN_WO_STATUSES) can still have a Completed_Date on file (set at the Complete
// transition) — the date check is purely date-based, independent of Status/open-closed grouping.
const completeButOpen = { ID: '6001', Status: 'Complete', Created_Date: '2026-08-01', Completed_Date: '2026-08-20' };
const lateReceipt = woDateWindowWarning('2026-09-01', completeButOpen);
ok(lateReceipt && lateReceipt.type === 'after_close', 'a receipt dated after Completed_Date still warns even though Status=Complete is grouped as "open" in the picker');

// ── Nov 17 2026: closed/past WOs are offered for a whole YEAR; blank Completed_Date falls back to Created_Date ──────────────────────
// Loads the REAL functions + the REAL woSelectHTML out of the page, with the real WOStatus (wo-status.js) so "closed" really means
// "not in WOStatus.sets.ACTIVE" exactly as it does in the shipped page.
const woStatusSrc = readFileSync(join(here, '..', 'wo-status.js'), 'utf8');
const WOStatus = new Function(woStatusSrc.replace(/console\.log[\s\S]*$/, '') + '\nreturn WOStatus;')();
ok(/const OPEN_WO_STATUSES = WOStatus\.sets\.ACTIVE;/.test(src), 'page still derives open vs closed from WOStatus.sets.ACTIVE (kept in sync with wo-status.js)');
const constMatch = src.match(/const RECENT_CLOSED_DAYS = (\d+);/);
ok(constMatch && Number(constMatch[1]) === 365, 'RECENT_CLOSED_DAYS is 365 (a year)');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const build = (wos) => new Function('allWOs', 'OPEN_WO_STATUSES', 'esc',
  isoConst + constMatch[0] + '\n' + grab('recentClosedLabel') + '\n' + grab('woClosedRefDate') + '\n' + grab('woClosedInWindow') + '\n' + grab('woDatesLabel') + '\n' + grab('woDateWindowWarning') + '\n' + grab('woSelectHTML') + '\nreturn { woSelectHTML, woClosedRefDate, woClosedInWindow, recentClosedLabel };'
)(wos, WOStatus.sets.ACTIVE, esc);
const P = '11';
const wos = [
  { ID: '2001', Property_ID: P, Status: 'In Progress', Description: 'open', Created_Date: day(-5) },
  { ID: '2002', Property_ID: P, Status: 'Paid', Description: 'closed 10d ago', Created_Date: day(-30), Completed_Date: day(-10) },
  { ID: '2003', Property_ID: P, Status: 'Paid', Description: 'closed 200d ago', Created_Date: day(-230), Completed_Date: day(-200) },
  { ID: '2004', Property_ID: P, Status: 'Paid', Description: 'closed 364d ago', Created_Date: day(-380), Completed_Date: day(-364) },
  { ID: '2005', Property_ID: P, Status: 'Paid', Description: 'closed 400d ago', Created_Date: day(-430), Completed_Date: day(-400) },
  { ID: '2006', Property_ID: P, Status: 'Cancelled', Description: 'blank completed, created 40d ago', Created_Date: day(-40), Completed_Date: '' },
  { ID: '2007', Property_ID: P, Status: 'Declined', Description: 'blank completed, created 500d ago', Created_Date: day(-500), Completed_Date: '' },
  { ID: '2008', Property_ID: P, Status: 'Invoiced', Description: 'no dates at all', Created_Date: '', Completed_Date: '' },
  { ID: '2009', Property_ID: P, Status: 'Complete', Description: 'Complete is ACTIVE so it is an open-group WO', Created_Date: day(-900), Completed_Date: day(-800) },
];
const api = build(wos);
const groups = html => [...html.matchAll(/<optgroup label="([^"]*)">([\s\S]*?)<\/optgroup>/g)].map(m => ({ label: m[1], ids: [...m[2].matchAll(/<option value="(\d+)"/g)].map(x => x[1]) }));
const def = groups(api.woSelectHTML(P, '', false, null, '', ''));
const recent = def.find(g => /^Closed in the last/.test(g.label));
ok(!!recent && recent.label === 'Closed in the last year', 'default view has a "Closed in the last year" group, label matches the 365-day window (' + (recent && recent.label) + ')');
ok(api.recentClosedLabel() === 'Closed in the last year', 'label helper follows the window');
ok(recent && ['2002', '2003', '2004'].every(id => recent.ids.includes(id)), 'WOs closed 10, 200 and 364 days ago show by default');
ok(recent && !recent.ids.includes('2005'), 'a WO closed 400 days ago is NOT in the default window');
ok(recent && recent.ids.includes('2006'), 'a Cancelled WO with a BLANK Completed_Date falls back to Created_Date (40d) and shows');
ok(recent && !recent.ids.includes('2007'), 'blank Completed_Date + Created_Date 500 days ago is outside the window (not vanishing by a bug, just old)');
ok(recent && recent.ids.includes('2008'), 'a closed WO with no usable date at all stays listed (cannot be shown to be old, must not vanish)');
ok(!def.some(g => g.label === 'Open at this property' && g.ids.includes('2002')), 'closed WOs never leak into the open group');
const openG = def.find(g => g.label === 'Open at this property');
ok(openG && openG.ids.includes('2001') && openG.ids.includes('2009'), 'open group holds In Progress and Complete (WOStatus.sets.ACTIVE)');
const all = groups(api.woSelectHTML(P, '', true, null, '', ''));
const allClosed = all.find(g => g.label === 'Closed / past at this property');
ok(allClosed && ['2002', '2003', '2004', '2005', '2006', '2007', '2008'].every(id => allClosed.ids.includes(id)), 'the checkbox ("show closed/past") still lists EVERY closed WO, including old and undated ones');
ok(!all.some(g => /^Closed in the last/.test(g.label)), 'with the checkbox on there is just the one full closed group (no duplicates)');
// receipt date window: a receipt dated near an old close pulls that WO into the default view
const rdOld = day(-395);
const withReceipt = groups(api.woSelectHTML(P, '', false, null, '', rdOld)).find(g => /^Closed in the last/.test(g.label));
ok(withReceipt && withReceipt.ids.includes('2005'), 'a receipt dated within a year of the WO close (400d ago) still offers it');
ok(api.woClosedRefDate({ Completed_Date: '2026-03-01', Created_Date: '2026-01-01' }) === '2026-03-01', 'Completed_Date wins when present');
ok(api.woClosedRefDate({ Completed_Date: '', Completed_At: '2026-02-02T10:00:00Z', Created_Date: '2026-01-01' }) === '2026-02-02', 'Completed_At is the second choice');
ok(api.woClosedRefDate({ Completed_Date: 'junk', Created_Date: '2026-01-01' }) === '2026-01-01', 'a garbled Completed_Date falls back to Created_Date');
ok(api.woClosedRefDate({}) === '' && api.woClosedRefDate(null) === '', 'no dates / null -> empty, never throws');
const noDay = api.woSelectHTML('', '', false, null, '', '');
ok(/pick a property first/.test(noDay), 'no property picked still returns the placeholder');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
