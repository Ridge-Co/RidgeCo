// The weekly Open Item Report rolls open invoices up from sub-customer (property) to their
// top-level parent (Owner) and flags who's actually due a report: $75+ open, OR the oldest
// invoice in the group has been open more than 10 days — whichever trips first. These pin
// buildArReportGroups against QuickBooks' ParentRef/Level customer shape, without QuickBooks.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const consts = 'const AR_REPORT_FLOOR = 75; const AR_REPORT_AGE_DAYS = 10;';
const buildArReportGroups = new Function(consts + '\n' + grab('buildArReportGroups') + '\nreturn buildArReportGroups;')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const now = Date.parse('2026-08-18T12:00:00Z');

// (1) A single small, fresh invoice — below the $75 floor, not yet 10 days open ⇒ not eligible.
let custById = { '100': { id: '100', name: 'Smith', parent_id: '', level: 0 } };
let invs = [{ Id: '1', DocNumber: 'INV-1', TxnDate: '2026-08-15', DueDate: '2026-08-15', TotalAmt: 40, Balance: 40, CustomerRef: { value: '100', name: 'Smith' } }];
let groups = buildArReportGroups(invs, custById, now);
ok(groups.length === 1, 'one group for one customer');
ok(groups[0].eligible === false, '$40 open, 3 days old ⇒ not eligible');
ok(groups[0].reason === 'below threshold', 'reason reflects neither rule tripped');

// (2) Same small balance, but old enough (>10 days) ⇒ eligible on the age rule alone.
invs = [{ Id: '2', DocNumber: 'INV-2', TxnDate: '2026-08-01', DueDate: '2026-08-01', TotalAmt: 40, Balance: 40, CustomerRef: { value: '100', name: 'Smith' } }];
groups = buildArReportGroups(invs, custById, now);
ok(groups[0].eligible === true, '17 days open ⇒ eligible even under $75');
ok(groups[0].reason === 'aged', 'reason is aged, not floor');

// (3) A fresh invoice over the $75 floor ⇒ eligible on the dollar rule alone.
invs = [{ Id: '3', DocNumber: 'INV-3', TxnDate: '2026-08-17', DueDate: '2026-08-17', TotalAmt: 80, Balance: 80, CustomerRef: { value: '100', name: 'Smith' } }];
groups = buildArReportGroups(invs, custById, now);
ok(groups[0].eligible === true, '$80 open, 1 day old ⇒ eligible on floor');
ok(groups[0].reason === 'floor', 'reason is floor, not aged');

// (4) Sub-customer rollup: two invoices on two different sub-customers (properties) under the
// SAME parent (Owner) must combine into ONE group under the parent, not stay split.
custById = {
  '200': { id: '200', name: 'Goldszmidt', parent_id: '', level: 0 },
  '201': { id: '201', name: 'Goldszmidt:153 W Lanvale', parent_id: '200', level: 1 },
  '202': { id: '202', name: 'Goldszmidt:151 W Lanvale', parent_id: '200', level: 1 },
};
invs = [
  { Id: '10', DocNumber: 'INV-10', TxnDate: '2026-08-10', DueDate: '2026-08-10', TotalAmt: 50, Balance: 50, CustomerRef: { value: '201', name: 'Goldszmidt:153 W Lanvale' } },
  { Id: '11', DocNumber: 'INV-11', TxnDate: '2026-08-12', DueDate: '2026-08-12', TotalAmt: 30, Balance: 30, CustomerRef: { value: '202', name: 'Goldszmidt:151 W Lanvale' } },
];
groups = buildArReportGroups(invs, custById, now);
ok(groups.length === 1, 'both sub-customer invoices roll up into one group');
ok(groups[0].root_qb_id === '200', 'group keyed by the top-level parent id');
ok(groups[0].total_open === 80, 'totals combine across sub-customers: 50 + 30 = 80');
ok(groups[0].eligible === true && groups[0].reason === 'floor', '$80 combined ⇒ eligible on floor even though no single invoice alone crosses it');
ok(groups[0].invoices.length === 2, 'both invoices carried through for display');

// (5) Multi-level hierarchy (Owner → Property → Unit, 3 levels) still resolves to the root.
custById = {
  '300': { id: '300', name: 'Owner Root', parent_id: '', level: 0 },
  '301': { id: '301', name: 'Owner Root:Property', parent_id: '300', level: 1 },
  '302': { id: '302', name: 'Owner Root:Property:Unit 2', parent_id: '301', level: 2 },
};
invs = [{ Id: '20', DocNumber: 'INV-20', TxnDate: '2026-08-01', DueDate: '2026-08-01', TotalAmt: 20, Balance: 20, CustomerRef: { value: '302', name: 'Owner Root:Property:Unit 2' } }];
groups = buildArReportGroups(invs, custById, now);
ok(groups[0].root_qb_id === '300', 'three-level chain still resolves to the top-level Owner');

// (6) A paid invoice (balance ≈ 0) contributes nothing to the group.
custById = { '400': { id: '400', name: 'PaidUp', parent_id: '', level: 0 } };
invs = [{ Id: '30', DocNumber: 'INV-30', TxnDate: '2026-08-01', DueDate: '2026-08-01', TotalAmt: 500, Balance: 0, CustomerRef: { value: '400', name: 'PaidUp' } }];
groups = buildArReportGroups(invs, custById, now);
ok(groups.length === 0, 'a fully paid invoice produces no group at all');

console.log(`ar-report-core: ${n} assertions passed`);
