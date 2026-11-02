// Ops_Build_Queue #140 / #87 (Oct 14 2026): ONE definition of work-order status values and groups.
// 1) the worker.js copy of the module is byte-identical to wo-status.js (what the pages load)
// 2) no hand-written status list is left anywhere else (worker.js, every page)
// 3) every group has EXACTLY the members the hand-written list it replaced had (behaviour preserved)
// 4) the module is safe: frozen, no dupes, every member is a known status, unknown group throws
import fs from 'fs';
import assert from 'node:assert';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const mod = read('wo-status.js'), worker = read('worker.js');
const BEGIN = '/* WO_STATUS_SSOT:BEGIN */', END = '/* WO_STATUS_SSOT:END */';
const block = s => { const a = s.indexOf(BEGIN), b = s.indexOf(END); if (a < 0 || b < 0) throw new Error('markers missing'); return s.slice(a, b + END.length); };

// ---- 1. the two copies cannot drift ---------------------------------------------------------
ok(block(mod) === block(worker), 'worker.js module block is byte-identical to wo-status.js (edit both together)');
ok(/const WOStatus = __makeWOStatus\(\);/.test(worker) && /var WOStatus = __makeWOStatus\(\);/.test(mod), 'both files instantiate WOStatus once');
ok(worker.indexOf(BEGIN) < worker.indexOf('const OPEN_WO_STATUSES'), 'the module is defined above its first top-level use in worker.js');

const W = new Function(mod + '\nreturn WOStatus;')();

// ---- 2. no hand-written status list anywhere else -------------------------------------------
const KNOWN = new Set([...W.statuses, ...W.legacy, ...W.reserved]);
const arr = /\[\s*((?:'[^'\n]*'|"[^"\n]*")(?:\s*,\s*(?:'[^'\n]*'|"[^"\n]*"))*)\s*,?\s*\]/g;
// Allowed leftovers: none (the Log Invoice button line was deleted by PR #256).
const ALLOW = [];
const files = ['worker.js', ...fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html'))];
const offenders = [];
for (const f of files) {
  let s = read(f);
  if (f === 'worker.js') s = s.replace(block(s), ' '.repeat(0));       // the module itself is the one place allowed
  let m; arr.lastIndex = 0;
  while ((m = arr.exec(s))) {
    const items = m[1].split(/\s*,\s*/).map(x => x.trim().slice(1, -1));
    if (items.length >= 2 && items.every(i => KNOWN.has(i))) {
      const ctx = s.slice(Math.max(0, m.index - 20), m.index + m[0].length + 60);
      if (ALLOW.some(a => a.file === f && ctx.includes(a.text.slice(0, 20)) && s.includes(a.text))) continue;
      offenders.push(f + ': ' + m[0].slice(0, 90));
    }
  }
}
ok(offenders.length === 0, 'no hand-written status array outside wo-status.js. Use WOStatus.sets.<NAME>, or add a group there. Found:\n  ' + offenders.join('\n  '));

// ---- 3. every group keeps the members of the list it replaced -------------------------------
const LEGACY = {
  FIELD_OPEN: ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold'],
  OPEN_WORK: ['New', 'Estimate Requested', 'Assigned', 'Accepted', 'In Progress', 'On Hold'],
  ACTIVE: ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice'],
  ACTIVE_OWNER: ['New', 'Estimate Requested', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice'],
  VENDOR_SETTABLE: ['Accepted', 'In Progress', 'On Hold', 'Complete'],
  VENDOR_STARTED: ['Accepted', 'In Progress', 'On Hold'],
  PRE_START: ['Assigned', 'Accepted'],
  ADMIN_PICKER: ['Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled'],
  DONE_THROUGH_PAID: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid'],
  COMPLETE_INVOICED_PAID: ['Complete', 'Invoiced', 'Paid'],
  COMPLETE_OR_LATER: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Closed'],
  ACCEPTED_OR_LATER: ['Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice', 'Invoiced', 'Paid'],
  INVOICED_OR_LATER: ['Invoiced', 'Paid'],
  INVOICED_OR_PAYMENT: ['Invoiced', 'Paid', 'Pending Payment'],
  DEAD: ['Cancelled', 'Declined'],
  CLOSED_OUT_FOLD: ['Cancelled', 'Paid', 'Invoiced'],
  CLOSED_TERMINAL: ['Paid', 'Cancelled'],
  CLOSED_FINAL: ['Paid', 'Cancelled', 'Canceled', 'Closed', 'Void'],
  ADDON_PARENT_BLOCKED: ['Cancelled', 'Canceled', 'Paid', 'Invoiced', 'Closed'],
  RECEIPT_CLOSED: ['Paid', 'Cancelled', 'Canceled', 'Closed', 'Void', 'Complete', 'Invoiced'],
  RECUR_CLOSED: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled', 'Canceled', 'Closed', 'Void', 'Declined'],
  DIGEST_CLOSED: ['Paid', 'Invoiced', 'Cancelled', 'Closed', 'Void'],
  TURNOVER_DONE: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled', 'Closed'],
  STALE_ACTIVE: ['New', 'Assigned', 'Accepted', 'In Progress'],
  DASH_NOT_OPEN: ['Complete', 'Paid', 'Pending Invoice', 'Invoiced', 'Pending Payment', 'Paid by Customer', 'Cancelled', 'Canceled', 'Closed', 'Void'],
  DASH_OPEN_LEGACY: ['New', 'Estimate Requested', 'Assigned', 'Accepted', 'Scheduled', 'In Progress', 'On Hold'],
  TENANT_OPEN: ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Pending Invoice'],
  TENANT_TIMELINE: ['New', 'Assigned', 'Accepted', 'In Progress', 'Complete'],
  TENANT_TIMELINE_STEPS: ['New', 'Assigned', 'In Progress', 'Complete'],
  BILLING_STAGE: ['Pending Invoice', 'Invoiced', 'Paid'],
};
ok(Object.keys(LEGACY).sort().join() === Object.keys(W.sets).sort().join(), 'the module has exactly the groups in this table (adding or removing one is a deliberate edit to this test)');
for (const [name, members] of Object.entries(LEGACY)) {
  ok(JSON.stringify([...W.sets[name]]) === JSON.stringify(members), `${name} still has exactly its original members, in its original order`);
}
// order-sensitive groups are rendered or stepped through; the tests above pin the order.

// ---- 4. the module itself -------------------------------------------------------------------
for (const [name, members] of Object.entries(W.sets)) {
  ok(new Set(members).size === members.length, `${name} has no duplicate members`);
  ok(members.every(s => W.isKnown(s)), `${name} only lists known statuses`);
  ok(Object.isFrozen(W.sets[name]), `${name} is frozen (a page cannot change a shared list by accident)`);
}
ok(Object.isFrozen(W.sets) && Object.isFrozen(W), 'the groups object and the module are frozen');
let threw = false; try { 'use strict'; W.inSet('NOPE', 'New'); } catch (e) { threw = /no such status group/.test(e.message); }
ok(threw, 'asking for a group that does not exist throws instead of answering false');
ok(W.inSet('FIELD_OPEN', 'New') && !W.inSet('FIELD_OPEN', 'Complete') && W.inSet('ACTIVE', 'Pending Invoice'), 'inSet answers membership');

// every status a live Work_Orders row can hold today is known (Oct 14 live read: Estimate Requested was missing from every earlier list)
for (const s of ['New', 'Estimate Requested', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled', 'Declined']) ok(W.isKnown(s), `${s} is a known status`);
ok(!W.isKnown('Estimat Requested') && !W.isKnown(''), 'a typo or blank is NOT known');
ok(W.order('New') < W.order('Assigned') && W.order('Complete') < W.order('Invoiced') && W.order('Invoiced') < W.order('Paid') && W.order('Cancelled') === -1, 'order() follows the lifecycle; side exits are -1');
// Oct 23 2026 (Ops_Build_Queue #175): WOs in 'Estimate Requested' (made by /scope/to-wo) used to be in NO group, so they vanished
// from owner lists, the admin Open filter and property open counts. They now belong to EXACTLY these three groups, and to no
// behaviour-driving group (a vendor bill must not auto-complete one, the duplicate guard / stale detector / tenant list /
// vendor portal / receipt matching must not start treating it as field work).
const EXPECT_ER = ['ACTIVE_OWNER', 'DASH_OPEN_LEGACY', 'OPEN_WORK'];
const inGroups = Object.entries(W.sets).filter(([k, v]) => v.includes('Estimate Requested')).map(([k]) => k).sort();
ok(JSON.stringify(inGroups) === JSON.stringify(EXPECT_ER), 'Estimate Requested is in exactly ' + EXPECT_ER.join(', ') + ' (found: ' + inGroups.join(', ') + ')');
for (const g of ['FIELD_OPEN', 'ACTIVE', 'TENANT_OPEN', 'TENANT_TIMELINE', 'STALE_ACTIVE', 'VENDOR_SETTABLE', 'VENDOR_STARTED', 'PRE_START', 'DASH_NOT_OPEN', 'RECEIPT_CLOSED', 'DIGEST_CLOSED'])
  ok(!W.inSet(g, 'Estimate Requested'), g + ' deliberately does NOT contain Estimate Requested');
ok(JSON.stringify([...W.sets.OPEN_WORK].filter(s => s !== 'Estimate Requested')) === JSON.stringify([...W.sets.FIELD_OPEN]), 'OPEN_WORK is FIELD_OPEN plus Estimate Requested and nothing else');
ok(JSON.stringify([...W.sets.ACTIVE_OWNER].filter(s => s !== 'Estimate Requested')) === JSON.stringify([...W.sets.ACTIVE]), 'ACTIVE_OWNER is ACTIVE plus Estimate Requested and nothing else');
// The three live WOs in 'Estimate Requested' (Oct 14 count) now appear in the owner list, admin Open filter, property counts and are
// not dragged into behaviour: simulate each consumer's own filter on sample rows.
const rows = [{ ID: 'WO-A', Status: 'Estimate Requested' }, { ID: 'WO-B', Status: 'Estimate Requested' }, { ID: 'WO-C', Status: 'Estimate Requested' }, { ID: 'WO-D', Status: 'In Progress' }, { ID: 'WO-E', Status: 'Paid' }];
ok(rows.filter(r => W.inSet('ACTIVE_OWNER', r.Status)).length === 4, 'owner open list shows the 3 estimate requests + the in-progress job, not the paid one');
ok(rows.filter(r => W.inSet('DASH_OPEN_LEGACY', r.Status)).length === 4, 'admin Open filter shows the 3 estimate requests + the in-progress job');
ok(rows.filter(r => W.inSet('OPEN_WORK', r.Status)).length === 4, 'property open counts include the 3 estimate requests');
ok(rows.filter(r => W.inSet('FIELD_OPEN', r.Status)).length === 1, 'behaviour group FIELD_OPEN (bill auto-complete, duplicate guard) still sees only the real field job');
ok(rows.filter(r => W.inSet('ACTIVE', r.Status)).length === 1, 'tenant list / vendor portal group ACTIVE still sees only the real field job');

// Source pins: the right consumer uses the right group.
const idx = read('index.html'), own = read('owner.html');
ok(/var OPEN_WO = WOStatus\.sets\.OPEN_WORK;\n\s+var daysOpen/.test(idx), 'admin WO card aging badge uses OPEN_WORK');
ok(/var OPEN_STATUSES = WOStatus\.sets\.OPEN_WORK;\n\n\s+el\.innerHTML = '<div style="color:var\(--muted\);font-size:11px;margin-bottom:8px">'\+props\.length/.test(idx), 'property cards open count uses OPEN_WORK');
ok(/var OPEN_STATUSES = WOStatus\.sets\.ACTIVE_OWNER;/.test(own), 'owner portal open list uses ACTIVE_OWNER');
ok(/ownerPropIds\.has\(w\.Property_ID\)[^\n]*WOStatus\.sets\.ACTIVE_OWNER\.includes\(w\.Status\)/.test(worker), 'server owner WO list uses WOStatus.sets.ACTIVE_OWNER');
ok(/const wos = workorders\.filter\(w => \{ if \(!includeClosed && !OPEN_WO_STATUSES\.includes\(w\.Status\)\) return false; return tenantCanSeeWO\(tenant, w\); \}\);/.test(worker), 'server tenant WO list still uses OPEN_WO_STATUSES (tenants do not see estimate requests)');
ok(/const preComplete = WOStatus\.sets\.FIELD_OPEN;/.test(worker), 'vendor-bill auto-complete still uses FIELD_OPEN (a bill must not complete an estimate request)');
ok(/const WO_DUP_ALLOWED_STATUSES = WOStatus\.sets\.FIELD_OPEN;/.test(worker), 'duplicate-WO guard still uses FIELD_OPEN');
for (const [f, s] of [['index.html', idx], ['owner.html', own]]) ok(/\.badge-estimaterequested/.test(s), f + ' styles the Estimate Requested badge (it rendered unstyled before)');

// ---- 5. pages load the module before they use it --------------------------------------------
for (const f of ['index.html', 'owner.html', 'tenant.html', 'wo.html', 'receipt-reconciler.html']) {
  const s = read(f);
  const tag = s.indexOf('<script src="wo-status.js"></script>'), use = s.indexOf('WOStatus.sets.');
  ok(tag >= 0 && use >= 0 && tag < use, `${f} loads wo-status.js before its first use`);
  ok(/typeof WOStatus === 'undefined'/.test(s), `${f} shows a visible banner if wo-status.js fails to load (no silent blank lists)`);
}
console.log(`wo-status-ssot: ${n}/${n} passing`);
