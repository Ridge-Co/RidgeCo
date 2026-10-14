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
// Allowed leftovers: the Log Invoice button line, which PR #256 deletes (remove this entry when it merges).
const ALLOW = [{ file: 'index.html', text: "['Complete','Pending Invoice'].includes(wo.Status)) addBtn('Log Invoice'" }];
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
  ACTIVE: ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice'],
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
  DASH_OPEN_LEGACY: ['New', 'Assigned', 'Accepted', 'Scheduled', 'In Progress', 'On Hold'],
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
// Behaviour pin: WOs sitting in Estimate Requested are in NO open group today (they do not show on portals or open counts).
// That is the pre-existing behaviour, kept on purpose and reported to Brett; change it as its own decision.
ok(Object.entries(W.sets).every(([k, v]) => !v.includes('Estimate Requested')), 'Estimate Requested is in no group, exactly as before (reported, not silently changed)');

// ---- 5. pages load the module before they use it --------------------------------------------
for (const f of ['index.html', 'owner.html', 'tenant.html', 'wo.html', 'receipt-reconciler.html']) {
  const s = read(f);
  const tag = s.indexOf('<script src="wo-status.js"></script>'), use = s.indexOf('WOStatus.sets.');
  ok(tag >= 0 && use >= 0 && tag < use, `${f} loads wo-status.js before its first use`);
  ok(/typeof WOStatus === 'undefined'/.test(s), `${f} shows a visible banner if wo-status.js fails to load (no silent blank lists)`);
}
console.log(`wo-status-ssot: ${n}/${n} passing`);
