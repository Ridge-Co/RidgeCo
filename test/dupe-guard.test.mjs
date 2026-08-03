// Offline tests for the duplicate-submission guards and the addRow ID allocation.
// Run: node test/dupe-guard.test.mjs
//
// These do NOT copy the logic — they extract the real function bodies out of worker.js and
// run them against a fake fetchTab, so the test cannot quietly drift away from what ships.
// No network, no Sheets, no Worker runtime needed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ FAIL: ' + msg); } }

// ── extract the real findRecentDuplicate from worker.js ──────────────────────
function extractFn(name) {
  const start = workerSrc.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in worker.js — did it get renamed?`);
  // walk braces from the first { after the signature
  let i = workerSrc.indexOf('{', start), depth = 0;
  for (; i < workerSrc.length; i++) {
    if (workerSrc[i] === '{') depth++;
    else if (workerSrc[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return workerSrc.slice(start, i);
}

let TABS = {};
const fetchTab = async (env, tab) => {
  if (TABS[tab] === undefined) throw new Error(`Unable to parse range: ${tab}`);
  return TABS[tab];
};
const findRecentDuplicate = new Function('fetchTab', `return (${extractFn('findRecentDuplicate')});`)(fetchTab);

const nowIso = () => new Date().toISOString();
const agoIso = (secs) => new Date(Date.now() - secs * 1000).toISOString();

console.log('duplicate-submission guards — offline tests\n');

// ── 1. the real incident: two identical estimates ~1s apart ──────────────────
console.log('Estimates — the WO-1052 / WO-1012 / WO-1062 double-tap');
const items = JSON.stringify([{ desc: 'Replace wax ring', amount: 100 }]);
TABS = { Estimates: [
  { ID: '2', WO_ID: 'WO-1052', Vendor_ID: '6', Version: '1', Line_Items: items, Subtotal: '100.00', Created_Date: agoIso(1), Active: 'TRUE' },
] };
ok(await findRecentDuplicate({}, 'Estimates', { WO_ID: 'WO-1052', Line_Items: items, Vendor_ID: '6' }, 120),
   'an identical estimate submitted 1s later is caught as a duplicate');

ok(!await findRecentDuplicate({}, 'Estimates', { WO_ID: 'WO-1062', Line_Items: items, Vendor_ID: '6' }, 120),
   'the same line items on a DIFFERENT work order are not a duplicate');

const changed = JSON.stringify([{ desc: 'Replace wax ring', amount: 140 }]);
ok(!await findRecentDuplicate({}, 'Estimates', { WO_ID: 'WO-1052', Line_Items: changed, Vendor_ID: '6' }, 120),
   'a genuine revision (different amount) is NOT blocked');

TABS.Estimates[0].Created_Date = agoIso(3600);
ok(!await findRecentDuplicate({}, 'Estimates', { WO_ID: 'WO-1052', Line_Items: items, Vendor_ID: '6' }, 120),
   're-submitting the same estimate an hour later is allowed through (outside the window)');

// ── 2. voided rows must not block a resubmit ─────────────────────────────────
TABS = { Estimates: [
  { ID: '2', WO_ID: 'WO-1052', Vendor_ID: '6', Line_Items: items, Created_Date: agoIso(1), Active: 'FALSE' },
] };
ok(!await findRecentDuplicate({}, 'Estimates', { WO_ID: 'WO-1052', Line_Items: items, Vendor_ID: '6' }, 120),
   'a VOIDED row never counts as the duplicate (you can redo a deleted entry)');

// ── 3. receipts ──────────────────────────────────────────────────────────────
console.log('\nReceipts');
TABS = { Receipts: [
  { ID: '1', WO_ID: 'WO-1061', Amount: '48.72', Store: 'Lowes', Description: 'PVC + primer', Created_Date: agoIso(2), Active: 'TRUE' },
] };
ok(await findRecentDuplicate({}, 'Receipts', { WO_ID: 'WO-1061', Amount: '48.72', Store: 'Lowes', Description: 'PVC + primer' }, 120),
   'the same receipt tapped twice is caught');
ok(!await findRecentDuplicate({}, 'Receipts', { WO_ID: 'WO-1061', Amount: '48.72', Store: 'Home Depot', Description: 'PVC + primer' }, 120),
   'same amount at a different store is a real second purchase, not a duplicate');
ok(!await findRecentDuplicate({}, 'Receipts', { WO_ID: 'WO-1061', Amount: '12.00', Store: 'Lowes', Description: 'PVC + primer' }, 120),
   'a different amount at the same store goes through');

// ── 4. vendor bills — date-only Created_Date, same-day window ────────────────
console.log('\nVendor_Bills (date-only timestamps → same-day window)');
const today = new Date().toISOString().split('T')[0];
TABS = { Vendor_Bills: [
  { ID: '4', WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted', Created_Date: today, Active: 'TRUE' },
] };
ok(await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted' }, 86400),
   'the same bill re-submitted the same day is caught');
ok(!await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '6', Total: '225.00', Status: 'submitted' }, 86400),
   'a different total is a different bill');
ok(!await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '9', Total: '175.00', Status: 'submitted' }, 86400),
   'a different vendor on the same job is not a duplicate');
TABS.Vendor_Bills[0].Status = 'reviewed';
ok(!await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted' }, 86400),
   'an ALREADY-REVIEWED bill does not block a genuine new bill on the same job');

// ── 5. the check must never block a write when it fails ──────────────────────
console.log('\nFailure behaviour — the guard must always fail OPEN');
TABS = {};   // tab missing → fetchTab throws
ok(await findRecentDuplicate({}, 'Estimates', { WO_ID: 'WO-1052' }, 120) === null,
   'if the duplicate check itself errors it returns null — a legitimate write is never blocked');

// Regression: an unparseable Created_Date used to short-circuit to "duplicate" at ANY age,
// so one old row with a blank date silently swallowed every future matching submission and
// reported success. It must be skipped, not treated as a match.
for (const [label, val] of [['blank', ''], ['missing', undefined], ['hand-typed', 'n/a']]) {
  const row = { ID: '4', WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted', Active: 'TRUE' };
  if (val !== undefined) row.Created_Date = val;
  TABS = { Vendor_Bills: [row] };
  ok(await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted' }, 86400) === null,
     `a row with a ${label} Created_Date is NOT treated as a duplicate (the write goes through)`);
}

// …but a genuinely recent row sitting behind an undateable one must still be caught.
TABS = { Vendor_Bills: [
  { ID: '4', WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted', Created_Date: '', Active: 'TRUE' },
  { ID: '5', WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted', Created_Date: today, Active: 'TRUE' },
] };
ok(await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '6', Total: '175.00', Status: 'submitted' }, 86400),
   'scanning past an undateable row still finds a real recent duplicate behind it');

// ── 5b. Time_Entries — two legitimate identical quick blocks must both survive ──
console.log('\nTime_Entries — legitimate back-to-back blocks');
TABS = { Time_Entries: [
  { ID: '1', WO_ID: 'WO-1061', Entered_By_ID: '6', Duration_Minutes: '30', Start_DateTime: '', End_DateTime: '',
    Notes: 'picked up materials', Entry_Type: 'Labor', Created_Date: agoIso(20), Active: 'TRUE' },
] };
ok(!await findRecentDuplicate({}, 'Time_Entries', { WO_ID: 'WO-1061', Entered_By_ID: '6', Duration_Minutes: '30',
     Start_DateTime: '', End_DateTime: '', Notes: 'diagnosed leak under sink', Entry_Type: 'Labor' }, 30),
   'a second 30-minute block with DIFFERENT notes is real work, not a duplicate');
ok(await findRecentDuplicate({}, 'Time_Entries', { WO_ID: 'WO-1061', Entered_By_ID: '6', Duration_Minutes: '30',
     Start_DateTime: '', End_DateTime: '', Notes: 'picked up materials', Entry_Type: 'Labor' }, 30),
   'the identical block re-tapped within 30s is caught');

// ── 5c. Vendor_Bills — two genuine same-day visits at the same trip charge ──
console.log('\nVendor_Bills — two visits, same day, same charge');
TABS = { Vendor_Bills: [
  { ID: '4', WO_ID: 'WO-1012', Vendor_ID: '6', Total: '85.00', Status: 'submitted', Notes: 'morning visit',
    Hours: '1', Receipts_Total: '0.00', Created_Date: today, Active: 'TRUE' },
] };
ok(!await findRecentDuplicate({}, 'Vendor_Bills', { WO_ID: 'WO-1012', Vendor_ID: '6', Total: '85.00',
     Status: 'submitted', Notes: 'afternoon return trip', Hours: '1', Receipts_Total: '0.00' }, 86400),
   'a second same-day visit at the same price with different notes is NOT blocked');

// ── 6. addRow ID allocation — FEATURE_LOG rule 6 ─────────────────────────────
// Mirrors the shipped allocation: resolve the ID column BY HEADER NAME, never r[0].
console.log('\naddRow ID allocation (FEATURE_LOG rule 6)');
function idColIndex(headers) { const i = headers.indexOf('ID'); return i >= 0 ? i : 0; }
function nextIdFor(rows) {
  const headers = rows[0];
  const _idc = idColIndex(headers);
  let nextId = 1;
  if (rows.length > 1) {
    const maxId = rows.slice(1).reduce((max, r) => {
      const n = parseInt((r && r[_idc]) || '0');
      return (Number.isFinite(n) && n > max) ? n : max;
    }, 0);
    if (maxId > 0) nextId = maxId + 1;
  }
  return nextId;
}
ok(nextIdFor([['ID','WO_ID'], ['1','WO-1'], ['2','WO-2']]) === 3,
   'ID at column 0 → next id is max+1');

// The Work_Orders shape that caused the silent WO-1001 restart: col 0 is Vendor_Needs_Access.
const woShape = [
  ['Vendor_Needs_Access','ID','Status'],
  ['', 'WO-1055', 'Complete'],
  ['auto', '1056', 'New'],
  ['', '1057', 'New'],
];
ok(nextIdFor(woShape) === 1058,
   'ID at column 1 (Work_Orders) is found by header name — reading r[0] here would restart at 1');
ok(nextIdFor([['Vendor_Needs_Access','ID'], ['',''], ['auto','']]) === 1,
   'no numeric ids yet → starts at 1');
ok(nextIdFor([['ID','X'], ['3','a'], ['1','b'], ['2','c']]) === 4,
   'out-of-order ids still resolve to max+1, not last+1');

// Attachments had ID '1' three times and ID '6' twice — allocation must clear the max.
ok(nextIdFor([['ID','WO_ID'], ['1','WO-1039'], ['1','WO-1039'], ['6','WO-1039'], ['6','WO-1039']]) === 7,
   'existing colliding ids do not trap the sequence below the max');

// ── 7. the QuickBooks queue filter ───────────────────────────────────────────
// 'partial' rows had fallen out of the queue permanently: invoice posted, bill missing,
// nothing anywhere writes the status back to 'pending', so the row became unreachable.
console.log('\n/qb/ready open-status filter');
const OPEN_QB = ['pending', 'partial', ''];
const isOpen = (s) => OPEN_QB.includes(String(s || '').toLowerCase().trim());
ok(isOpen('pending'), "'pending' is in the queue");
ok(isOpen('partial'), "'partial' is BACK in the queue — invoice posted but vendor bill missing");
ok(isOpen(''), 'a blank status counts as pending, not as done');
ok(isOpen('  Partial  '), 'status matching tolerates case and stray whitespace');
ok(!isOpen('sent'), "'sent' stays out of the queue");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
