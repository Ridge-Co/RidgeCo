// New vendor home list (UI overhaul Phase 1a, Nov 18 2026): the pure rules, plus source checks that pin the wiring so a refactor cannot quietly
// drop a guard or turn the new layout on for everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const VH = new Function(read('vendor-home.js') + '\nreturn VendorHome;')();
const vendor = read('vendor.html');

const wo = (o) => Object.assign({ ID: 'WO-1', Status: 'Assigned', Priority: 'normal' }, o);
const bill = (o) => Object.assign({ WO_ID: 'WO-1', Status: 'submitted', Pending_Info: '' }, o);

test('the switch is OFF unless the session, the link or the device says on; the link can force it back off', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
  assert.equal(VH.enabled({}, '', mem()), false, 'default off');
  assert.equal(VH.enabled(null, '', null), false, 'no session, no storage: off');
  assert.equal(VH.enabled({ new_layout: 'TRUE' }, '', mem()), true);
  assert.equal(VH.enabled({ new_layout: true }, '', mem()), true);
  assert.equal(VH.enabled({ new_layout: 'FALSE' }, '', mem()), false);
  const s = mem();
  assert.equal(VH.enabled({}, '?newlayout=1', s), true, 'link turns it on');
  assert.equal(VH.enabled({}, '', s), true, 'and the device remembers');
  assert.equal(VH.enabled({ new_layout: true }, '?x=1&newlayout=0', s), false, 'link turns it off even when the session says on');
  assert.equal(VH.enabled({ new_layout: true }, '', s), false, 'and the device remembers that too');
});

test('where a job is, from the vendor point of view', () => {
  assert.equal(VH.groupOf(wo({ Status: 'Assigned' })), 'new');
  assert.equal(VH.groupOf(wo({ Status: 'New' })), 'new');
  assert.equal(VH.groupOf(wo({ Status: 'Estimate Requested' })), 'new');
  assert.equal(VH.groupOf(wo({ Status: 'Accepted' })), 'accepted');
  assert.equal(VH.groupOf(wo({ Status: 'Accepted', Scheduled_Date: '2026-11-20' })), 'scheduled');
  assert.equal(VH.groupOf(wo({ Status: 'In Progress' })), 'working');
  assert.equal(VH.groupOf(wo({ Status: 'On Hold' })), 'hold');
  assert.equal(VH.groupOf(wo({ Status: 'Complete' })), 'finished');
  assert.equal(VH.groupOf(wo({ Status: 'Pending Invoice' })), 'finished');
  assert.equal(VH.groupOf(wo({ Status: 'Complete' }), [bill()]), 'waiting', 'a bill on file means waiting, not "send invoice"');
  assert.equal(VH.groupOf(wo({ Status: 'Complete' }), [bill({ Pending_Info: 'TRUE' })]), 'needsinfo');
  assert.equal(VH.groupOf(wo({ Status: 'Invoiced' })), 'waiting');
  assert.equal(VH.groupOf(wo({ Status: 'Paid' }), [bill()]), 'paid');
  for (const s of ['Cancelled', 'Declined', 'Void', 'Closed']) assert.equal(VH.groupOf(wo({ Status: s })), 'closed');
});

test('every group has a tab and the right one button; closed jobs have neither', () => {
  const map = { new: ['todo', 'accept'], accepted: ['todo', 'pickday'], scheduled: ['todo', 'start'], working: ['todo', 'complete'], hold: ['todo', 'resume'],
    finished: ['todo', 'invoice'], waiting: ['waiting', null], needsinfo: ['waiting', 'invoice'], paid: ['paid', null], closed: ['', null] };
  for (const [g, [tab, key]] of Object.entries(map)) {
    assert.equal(VH.tabOf(g), tab, g + ' tab');
    const a = VH.nextAction(g);
    assert.equal(a ? a.key : null, key, g + ' button');
  }
});

test('taps that can text someone wait behind Undo; the rest run at once', () => {
  for (const k of ['accept', 'start', 'complete', 'resume']) assert.equal(VH.safeToTap(k), false, k + ' must wait');
  for (const k of ['pickday', 'invoice']) assert.equal(VH.safeToTap(k), true, k);
  assert.equal(VH.UNDO_MS, 5000);
});

test('To do order: new first, then work in hand, then finished; urgent first inside a group; stable otherwise', () => {
  const list = [
    wo({ ID: 'A', Status: 'Complete' }),
    wo({ ID: 'B', Status: 'In Progress', Priority: 'normal' }),
    wo({ ID: 'C', Status: 'Assigned', Priority: 'low' }),
    wo({ ID: 'D', Status: 'In Progress', Priority: 'urgent' }),
    wo({ ID: 'E', Status: 'Assigned', Priority: 'low' }),
  ];
  assert.deepEqual(VH.sortTodo(list, {}).map((w) => w.ID), ['C', 'E', 'D', 'B', 'A']);
  assert.equal(VH.headingFor('new'), 'New: please accept or decline');
  assert.equal(VH.headingFor('hold'), VH.headingFor('working'), 'hold and in progress share one heading');
  assert.equal(VH.headingFor('finished'), 'Finished: send your invoice');
});

test('one load feeds all three tabs and the counts; jobs needing info sort first and turn the count red', () => {
  const wos = [
    wo({ ID: 'N1', Status: 'Assigned' }), wo({ ID: 'W1', Status: 'In Progress' }), wo({ ID: 'F1', Status: 'Complete' }),
    wo({ ID: 'I1', Status: 'Complete' }), wo({ ID: 'I2', Status: 'Complete' }), wo({ ID: 'P1', Status: 'Paid' }), wo({ ID: 'X1', Status: 'Cancelled' }),
  ];
  const bills = [bill({ WO_ID: 'I1' }), bill({ WO_ID: 'I2', Pending_Info: 'TRUE' })];
  const sp = VH.split(wos, bills);
  assert.deepEqual(sp.todo.map((w) => w.ID), ['N1', 'W1', 'F1']);
  assert.deepEqual(sp.waiting.map((w) => w.ID), ['I2', 'I1'], 'needs-info first');
  assert.deepEqual(sp.paid.map((w) => w.ID), ['P1']);
  assert.deepEqual(VH.counts(sp), { todo: 3, waiting: 2, paid: 1, needsinfo: 1 });
});

test('a failed tap is kept 12 hours and then forgotten; nothing is ever re-sent by this code', () => {
  const now = 1_000_000_000;
  const kept = VH.pruneFailed({ 'WO-1': { key: 'start', at: now - 3600e3 }, 'WO-2': { key: 'complete', at: now - 13 * 3600e3 }, 'WO-3': {} }, now);
  assert.deepEqual(Object.keys(kept), ['WO-1']);
  assert.equal(VH.pruneFailed(null, now) && Object.keys(VH.pruneFailed(null, now)).length, 0);
  const src = read('vendor-home.js');
  assert.ok(!/setInterval|retryAll|autoRetry/.test(src), 'no automatic resend');
});

// ── wiring (source checks) ─────────────────────────────────────────────────────────────────────────────
test('vendor.html loads the module and the new layout is gated everywhere it changes the page', () => {
  assert.ok(/<script src="vendor-home\.js"><\/script>/.test(vendor));
  assert.ok(/VendorHome\.init\(data\)/.test(vendor), 'init on login');
  const gated = [
    /if \(window\.VendorHome && VendorHome\.on\(\)\) return VendorHome\.listFor\(currentTab\)/,
    /\(window\.VendorHome && VendorHome\.on\(\)\) \? VendorHome\.actionHtml\(wo, idx\) : ''/,
    /if \(window\.VendorHome && VendorHome\.on\(\)\) VendorHome\.resetLoaded\(\);[^\n]*\n\s*else wos\.forEach\(function\(wo, idx\) \{ loadPortalAttachments/,
    /VendorHome\.ensureLoaded\(idx\)/,
    /VendorHome\.regroup\(filtered\)/,
  ];
  for (const re of gated) assert.ok(re.test(vendor), 'missing gated hook: ' + re);
});

test('the old five tabs, the status picker and the SAVE STATUS button are still in the page (rollback is the switch)', () => {
  for (const id of ['tabOpen', 'tabAll', 'tabDue', 'tabInvoiced', 'tabPaid']) assert.ok(vendor.includes('id="' + id + '"'), id);
  assert.ok(/SAVE STATUS/.test(vendor) && /UPDATE STATUS/.test(vendor));
});

test('every one-tap goes through the page\'s own guarded functions, not a new request', () => {
  const src = read('vendor-home.js');
  assert.ok(/submitStatus\(woId, idx\)/.test(src), 'status goes through submitStatus (checklist gate, hold reason, job order)');
  assert.ok(/acceptWO\(woId, idx\)/.test(src));
  assert.ok(/openBillModal\(woId\)/.test(src), 'invoice opens the existing modal (Complete-before-billing, max price, receipts)');
  assert.ok(/checklistGate\(idx\)/.test(src), 'Mark complete checks the checklist first');
  assert.ok(/claimSubmit\('vh:' \+ woId/.test(src), 'double-tap latch');
  assert.ok(!/api\('\/status'|fetch\(/.test(src), 'this file posts nothing itself');
  assert.ok(!/Ridge Co|workers\.dev/.test(src), 'no brand name or Worker address in new markup (DESIGN.md)');
});

test('submitStatus and acceptWO now answer true or false, and still show the same messages', () => {
  const ss = vendor.slice(vendor.indexOf('function submitStatus'), vendor.indexOf('// ── Accept / Decline gate'));
  assert.ok(/return persistChecklist\(idx\)/.test(ss));
  assert.equal((ss.match(/return true;/g) || []).length, 1);
  assert.ok((ss.match(/return false;/g) || []).length >= 5);
  assert.ok(/'✓ Status updated to '/.test(ss) && /Could not save the checklist/.test(ss) && /Connection error\./.test(ss));
  const aw = vendor.slice(vendor.indexOf('function acceptWO'), vendor.indexOf('function declineWO'));
  assert.ok(/return api\('\/status'/.test(aw) && /return true;/.test(aw) && /return false;/.test(aw));
});

test('Mark complete cannot skip the checklist, and a blocked tap opens the job at the checklist', () => {
  const src = read('vendor-home.js');
  const run = src.slice(src.indexOf('function runStatus'), src.indexOf('function runAccept'));
  assert.ok(run.indexOf("key === 'complete'") < run.indexOf('submitStatus'), 'gate before status');
  const gate = src.slice(src.indexOf('function checklistBlocks'), src.indexOf('function runStatus'));
  assert.ok(/openCard\(idx\)/.test(gate), 'a blocked tap opens the job');
  assert.ok(/checklistBlocks\(woId\)/.test(src.slice(src.indexOf('function tap'))), 'checked before the Undo bar');
});
