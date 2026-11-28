// Queue #140 slice (Nov 27 2026): WOStatus.label / color / isOpen / isActive / isClosed / canTransition.
// Golden tables are copied from the OLD hand-written literals (tenant.html STATUS_LABELS, wo.html STATUS_COLORS)
// so the move into the module cannot change what anyone sees.
import fs from 'fs';
import assert from 'node:assert';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const W = new Function(read('wo-status.js') + '\nreturn WOStatus;')();

const OLD_LABELS = {'New':'Request received','Assigned':'Technician assigned','Accepted':'Technician confirmed','In Progress':'Work in progress','On Hold':'On hold','Complete':'Completed','Pending Invoice':'Completed','Invoiced':'Completed','Paid':'Completed','Declined':'Request declined','Cancelled':'Cancelled'};
const OLD_COLORS = {'New':'#6b7280','Assigned':'#1d4ed8','Accepted':'#1d4ed8','In Progress':'#b45309','On Hold':'#b42318','Complete':'#1d4ed8','Pending Invoice':'#1d4ed8','Invoiced':'#1d4ed8','Paid':'#1d4ed8','Cancelled':'#6b7280','Declined':'#b42318'};
const ALL = [...W.statuses, ...W.legacy, ...W.reserved, 'Estimate Requested'];

for (const s of ALL) {
  ok(W.label(s, 'tenant') === (OLD_LABELS[s] || s), 'tenant label matches the old map (or unchanged input): ' + s);
  ok(W.color(s) === (OLD_COLORS[s] || '#6b7280'), 'colour matches the old map (or grey fallback): ' + s);
  ok(W.label(s) === s && W.label(s, 'admin') === s && W.label(s, 'vendor') === s, 'admin/vendor/no role: unchanged: ' + s);
  ok(W.label(s, 'owner') === (s === 'Pending Invoice' ? 'Complete' : s), 'owner: only Pending Invoice is masked: ' + s);
}
for (const s of W.statuses) ok(!/invoice|paid/i.test(W.label(s, 'tenant')), 'tenant never sees billing words: ' + s);
ok(W.label('Nonsense', 'tenant') === 'Nonsense' && W.label(undefined, 'tenant') === undefined && W.label('', 'tenant') === '', 'unknown / empty input is returned unchanged');
ok(W.color('Nonsense') === '#6b7280' && W.color(undefined) === '#6b7280', 'unknown colour is the old grey');
for (const s of ALL) {
  ok(W.isOpen(s) === W.sets.FIELD_OPEN.includes(s), 'isOpen = FIELD_OPEN: ' + s);
  ok(W.isActive(s) === W.sets.ACTIVE.includes(s), 'isActive = ACTIVE: ' + s);
  ok(W.isClosed(s) === W.sets.CLOSED_TERMINAL.includes(s), 'isClosed = CLOSED_TERMINAL: ' + s);
}
ok(!W.isOpen('Estimate Requested') && W.sets.OPEN_WORK.includes('Estimate Requested'), 'Estimate Requested stays out of FIELD_OPEN, in OPEN_WORK (#175)');
ok(W.canTransition('New', 'Assigned') && W.canTransition('In Progress', 'Complete') && W.canTransition('Invoiced', 'Paid'), 'normal forward moves are allowed');
ok(!W.canTransition('Paid', 'New') && !W.canTransition('Complete', 'New') && !W.canTransition('Nonsense', 'New') && !W.canTransition('New', 'Nonsense') && !W.canTransition(undefined, undefined), 'backward / unknown moves are not');
// advisory only: nothing in worker.js calls it
ok(!/WOStatus\.canTransition\(/.test(read('worker.js').replace(/\/\* WO_STATUS_SSOT:BEGIN \*\/[\s\S]*?\/\* WO_STATUS_SSOT:END \*\//, '')), 'canTransition is advisory: no worker.js call site');
// pages use the module, and the old literals are gone
ok(/WOStatus\.label\(s, 'tenant'\)/.test(read('tenant.html')) && !/STATUS_LABELS/.test(read('tenant.html')), 'tenant.html uses WOStatus.label');
ok(/WOStatus\.color\(wo\.Status\)/.test(read('wo.html')) && !/STATUS_COLORS/.test(read('wo.html')), 'wo.html uses WOStatus.color');
console.log('wo-status-helpers: ' + n + ' checks passed');
