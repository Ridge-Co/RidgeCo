// Phase 7c (gate reads) of the silent-failure burn-down (Nov 18 2026): reads that DECIDE something now report when they fail,
// and a corrupt checklist is reported instead of reading as "nothing unresolved". Behaviour (fallback values, fail-closed / fail-open
// direction) is unchanged. Source checks plus runs of the real checklist helpers.
// Run: node test/json-cells-gate-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);

console.log('Gate reads report when they fail');
has(/catch \(e\) \{ await softFail\(env, 'woBulkVoid:Vendor_Bills', e, \{ severity: 'P1'/, 'bulk void: an unreadable Vendor_Bills tab is reported P1 (the vendor-bill leg of the money check could not run)');
has(/catch \(e\) \{ await softFail\(env, 'findLockedVendorBillForWOs:Invoice_Review', e, \{ severity: 'P1'/, 'locked-bill check: an unreadable Invoice_Review tab is reported P1');
has(/softFail\(env, 'maxPriceGateResponse:Estimates', e, \{ severity: 'P1', ref: String\(\(wo && wo\.ID\) \|\| ''\), source: 'read' \}\); ceiling = max;/, 'max price gate: a failed Estimates read is reported P1 and the ceiling is still the max price');
has(/softFail\(env, 'setWoMaxPrice:audit', e, \{ severity: 'P1', ref: woId, source: 'write' \}\)/, 'max price change: a failed audit row is reported P1');
has(/if \(!\/unable to parse range\|not found\|does not exist\/i\.test\(String\(\(e && e\.message\) \|\| e\)\)\) await softFail\(env, 'getVendorLoanBalance:Loan_Ledger', e, \{ severity: 'P1'[^\n]*return 0;/, 'loan balance: a real read failure is reported P1 (a missing tab is still just "no loans"), balance still 0');
has(/softFail\(env, 'checklistGateResponse:Vendors', e, \{ severity: 'P2'/, 'checklist gate: a failed vendor-language read is reported P2');
has(/softFail\(env, 'maxPriceGateResponse:Vendors', e, \{ severity: 'P2'/, 'max price gate: a failed vendor-language read is reported P2');
has(/softFail\(env, 'saveChecklist:audit', e, \{ severity: 'P2'/, 'checklist save: a failed audit row is reported P2');
has(/softFail\(env, 'depositApprove:Properties', e, \{ severity: 'P2'[^\n]*\.then\(\(\) => \[\]\)/, 'deposit approve: a failed Properties read is reported P2 and still falls back to []');
has(/softFail\(env, 'depositApprove:Units', e, \{ severity: 'P2'[^\n]*\.then\(\(\) => \[\]\)/, 'deposit approve: a failed Units read is reported P2 and still falls back to []');
has(/softFail\(env, 'vendorBillReconcileReceipts:Receipts', e, \{ severity: 'P2'/, 'receipt reconcile: an unreadable Receipts tab is reported P2');

console.log('Test-write guard reads fail closed, with a reason');
const guardLines = src.split('\n').filter(l => /\.catch\(\(\) => \[\]\)\)\.find\(/.test(l) && /silent-ok: a failed read makes the test-write guard refuse/.test(l));
ok(guardLines.length === 5, 'all 5 hubTestWriteAllowed reads carry a real silent-ok reason (' + guardLines.length + ')');

console.log('Checklist parsing reports a corrupt checklist');
has(/function parseChecklistItems\(raw, env, ref\) \{\n  let arr = raw;\n  if \(typeof raw === 'string'\) arr = parseJsonCell\(raw, \[\], \{ env, where: 'parseChecklistItems', ref: String\(ref \|\| ''\), severity: 'P1' \}\);\n  if \(!Array\.isArray\(arr\)\) return \[\];/, 'parseChecklistItems goes through parseJsonCell at P1 and still returns [] for anything that is not a list');
has(/checklistUnresolvedItems\(wo && wo\.Checklist, env, wo && wo\.ID\)/, 'the checklist gate passes env and the WO id');
has(/mergeVendorChecklist\(wo\.Checklist, body && body\.checklist, env, wo\.ID\)/, 'the share-link checklist save passes env and the WO id');

console.log('Runs of the real checklist helpers');
const notes = [];
const parseJsonCell = (c, fb, o) => { o = o || {}; if (c === undefined || c === null || String(c).trim() === '') return fb; try { return JSON.parse(c); } catch (e) { notes.push(o.where + '|' + o.severity + '|' + o.ref); return fb; } };
const grab = (name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const f = new Function('parseJsonCell', ['parseChecklistItems', 'checklistUnresolvedItems'].map(grab).join('\n') + '\nreturn { parseChecklistItems, checklistUnresolvedItems };')(parseJsonCell);
const env = {};
ok(f.checklistUnresolvedItems('[{"t":"Fix sink","done":false},{"t":"Paint","done":true}]', env, 'WO-1').length === 1 && notes.length === 0, 'a good checklist: one open item, nothing reported');
ok(f.checklistUnresolvedItems('', env, 'WO-1').length === 0 && notes.length === 0, 'a blank checklist: nothing open, nothing reported');
ok(f.checklistUnresolvedItems('{"t":"x"}', env, 'WO-1').length === 0, 'a checklist that is not a list: nothing open (as before)');
ok(f.checklistUnresolvedItems('[oops', env, 'WO-7').length === 0 && notes.length === 1 && notes[0] === 'parseChecklistItems|P1|WO-7', 'a corrupt checklist: still nothing open (as before) but reported once at P1 with the WO id');
ok(Array.isArray(f.parseChecklistItems([{ t: 'A', done: 'true' }])) && f.parseChecklistItems([{ t: 'A', done: 'true' }])[0].done === true, 'an already-parsed list passes through untouched');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
