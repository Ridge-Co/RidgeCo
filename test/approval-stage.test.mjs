// Approval stage (Sep 28 2026, FEATURE_LOG rule 200): Estimated -> Approved | Proposed -> Pre-approved -> Approved.
// Extracts the REAL setApprovalStage / backfillApprovalStage from worker.js and runs them against an
// in-memory fake sheet; also checks each lifecycle hook is present in the real function that owns it.
import fs from 'fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(sig) {
  const i = w.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = w.indexOf('{', w.indexOf(')', i));
  for (; j < w.length; j++) { if (w[j] === '{') d++; else if (w[j] === '}') { d--; if (!d) break; } }
  return w.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const db = { Work_Orders: [], Scopes: [], Estimates: [] };
const json = (o, s) => ({ body: o, status: s || 200, json: async () => o });
const fetchTab = async (_e, t) => db[t].map(r => ({ ...r }));
const ensureColumns = async () => {};
const findWO = (wos, id) => wos.find(x => x.ID === id);
const updateWOFields = async (_e, id, f) => { Object.assign(db.Work_Orders.find(x => x.ID === id), f); };
const updateRow = async (_e, t, id, f) => { Object.assign(db[t].find(x => x.ID === id), f); };
const src = "const APPROVAL_STAGES = ['Estimated', 'Proposed', 'Pre-approved', 'Approved'];\n" + grab('async function setApprovalStage(') + '\n' + grab('async function backfillApprovalStage(') + '\nreturn { setApprovalStage, backfillApprovalStage };';
const { setApprovalStage, backfillApprovalStage } = new Function('json', 'fetchTab', 'ensureColumns', 'findWO', 'updateWOFields', 'updateRow', src)(json, fetchTab, ensureColumns, findWO, updateWOFields, updateRow);

// --- helper ---
db.Work_Orders = [{ ID: 'WO-1', Approval_Stage: '', Estimate_Revised: 'v2 $10' }];
db.Scopes = [{ ID: '7', WO_ID: 'WO-1', Approval_Stage: '' }];
ok(await setApprovalStage({}, { woId: 'WO-1', stage: 'Bogus' }) === false, 'unknown stage refused');
ok(db.Work_Orders[0].Approval_Stage === '', 'unknown stage writes nothing');
await setApprovalStage({}, { woId: 'WO-1', scopeId: '7', stage: 'Proposed' });
ok(db.Work_Orders[0].Approval_Stage === 'Proposed' && db.Scopes[0].Approval_Stage === 'Proposed', 'writes WO and Scope together');
ok(db.Work_Orders[0].Estimate_Revised === '', 're-staging clears the revised flag (Brett reviewed it)');
ok(await setApprovalStage({}, { woId: 'WO-1', stage: 'Approved', onlyFrom: ['Pre-approved'] }) === false && db.Work_Orders[0].Approval_Stage === 'Proposed', 'onlyFrom blocks a transition from the wrong stage');
await setApprovalStage({}, { woId: 'WO-1', stage: 'Pre-approved' });
ok(await setApprovalStage({}, { woId: 'WO-1', stage: 'Approved', onlyFrom: ['Pre-approved'] }) === true && db.Work_Orders[0].Approval_Stage === 'Approved', 'onlyFrom allows Pre-approved -> Approved');

// --- backfill ---
db.Work_Orders = [
  { ID: 'A', Approval_Stage: '' }, { ID: 'B', Approval_Stage: '' }, { ID: 'C', Approval_Stage: '' },
  { ID: 'D', Approval_Stage: '' }, { ID: 'E', Approval_Stage: 'Approved' }, { ID: 'F', Approval_Stage: '' },
];
db.Estimates = [
  { WO_ID: 'A', Version: '1', Status: 'Pending' }, { WO_ID: 'B', Version: '1', Status: 'Approved' },
  { WO_ID: 'C', Version: '1', Status: 'Converted' }, { WO_ID: 'D', Version: '1', Status: 'Converted' },
  { WO_ID: 'E', Version: '1', Status: 'Pending' },
];
db.Scopes = [{ ID: '1', WO_ID: 'C', Status: 'draft', Approval_Stage: '' }, { ID: '2', WO_ID: 'D', Status: 'signed', Approval_Stage: '' }];
const prev = (await backfillApprovalStage({}, {})).body;
ok(prev.applied === false && prev.written === 0 && db.Work_Orders[0].Approval_Stage === '', 'backfill previews by default and writes nothing');
const res = (await backfillApprovalStage({}, { apply: true })).body;
const st = id => db.Work_Orders.find(x => x.ID === id).Approval_Stage;
ok(st('A') === 'Estimated' && st('B') === 'Approved' && st('C') === 'Proposed' && st('D') === 'Pre-approved', 'backfill derives Estimated / Approved / Proposed / Pre-approved');
ok(st('E') === 'Approved', 'never overwrites a stage already set');
ok(st('F') === '', 'a WO with no estimate is left alone');
ok(db.Scopes[1].Approval_Stage === 'Pre-approved' && db.Scopes[0].Approval_Stage === 'Proposed', 'scopes are backfilled too');
const again = (await backfillApprovalStage({}, { apply: true })).body;
ok(again.planned === 0, 'backfill is idempotent (second run plans nothing)');

// --- lifecycle hooks live in the real owning functions ---
const has = (fn, needle) => grab(fn).includes(needle);
ok(has('async function approveEstimate(', "stage: 'Approved'"), 'approveEstimate -> Approved');
ok(has('async function unapproveEstimate(', "stage: 'Estimated'"), 'unapproveEstimate -> Estimated');
ok(has('async function woPushToScope(', "stage: 'Proposed'"), 'push-to-scope apply -> Proposed');
ok(has('async function scopeProposalSign(', "stage: 'Pre-approved'"), 'owner signs -> Pre-approved');
ok(has('async function qbSyncPayments(', "stage: 'Approved'") && has('async function qbSyncPayments(', "r.phase === 'deposit' && r.customer_paid === true"), 'deposit invoice positively paid -> Approved');
const aev = grab('async function addEstimateVersion(');
ok(aev.includes("stage: 'Estimated'") && aev.includes('Estimate_Revised') && aev.includes("['Approved', 'Proposed', 'Pre-approved'].includes(cur)"), 'a revision after approval flags instead of silently resetting the stage');
ok(grab('async function scopeList(').includes('approval_stage'), '/scopes exposes approval_stage');
console.log(n + ' passed, 0 failed');
