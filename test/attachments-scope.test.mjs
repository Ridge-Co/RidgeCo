// /attachments per-record scope (Oct 14 2026, queue #150). Closes the cross-account leak where any
// signed-in tenant/owner/vendor token could list ANY job's attachments.
// Pulls the REAL functions out of worker.js (no copies) and runs them against stubbed sheets.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(kind, name) {
  const i = src.indexOf(kind + ' ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const constLine = src.split('\n').find(l => l.startsWith('const ATTACHMENT_COST_DOC_TYPES'));
assert.ok(constLine, 'ATTACHMENT_COST_DOC_TYPES constant exists');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- build a sandbox with the real functions + stubbed I/O --------------------------------
const tel = [];
let sheets = {};
let telemetryShouldFail = false;
const json = (body, status = 200) => ({ body, status });
const env = {};
const factory = new Function('json', 'fetchTab', 'fetchTabs', 'logTelemetry', 'findWO', `
  ${constLine}
  ${grab('function', 'isBackgroundWO')}
  ${grab('function', 'isHiddenBidCopy')}
  ${grab('function', 'tenantCanSeeWO')}
  ${grab('function', 'attachmentScopeAllows')}
  ${grab('async function', 'getAttachments')}
  return { getAttachments, attachmentScopeAllows, tenantCanSeeWO };
`);
const fns = factory(
  json,
  async (_e, tab) => sheets[tab] || [],
  async (_e, tabs) => tabs.map(t => sheets[t] || []),
  async (_e, rec) => { if (telemetryShouldFail) throw new Error('telemetry down'); tel.push(rec); },
  (wos, id) => (id ? wos.find(w => w.ID === id) || null : null),
);

const att = (wo, type, extra = {}) => ({ WO_ID: wo, File_Type: type, File_Name: type + '.jpg', Drive_URL: 'https://d/' + wo + type, Active: 'TRUE', ...extra });
function reset() {
  tel.length = 0; telemetryShouldFail = false;
  sheets = {
    Properties: [{ ID: 'P1', Owner_ID: 'O1' }, { ID: 'P2', Owner_ID: 'O2' }],
    Tenants: [
      { ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE' },
      { ID: 'T2', Property_ID: 'P2', Unit_ID: 'U2', Active: 'TRUE' },
      { ID: 'T3', Property_ID: 'P1', Unit_ID: 'U3', Active: 'FALSE' },
    ],
    Work_Orders: [
      { ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1' },
      { ID: 'WO-2', Property_ID: 'P2', Unit_ID: 'U2', Vendor_ID: 'V2' },
      { ID: 'WO-3', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Tenant_Visible: 'FALSE' },
      { ID: 'WO-4', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Voided: 'TRUE', Type: 'addon', Parent_WO_ID: 'WO-1' },
      { ID: 'WO-5', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Duplicated_From: 'WO-1', Bid_Group_ID: 'BG-1001' },
      { ID: 'WO-6', Property_ID: 'P1', Unit_ID: 'U9', Vendor_ID: 'V1' },
      { ID: 'WO-7', Property_ID: 'P1', Unit_ID: '', Vendor_ID: '' },
    ],
    Attachments: [
      att('WO-1', 'before'), att('WO-1', 'receipt'), att('WO-1', 'invoice'), att('WO-1', 'bill'), att('WO-1', 'after', { Active: 'FALSE' }),
      att('WO-2', 'before'), att('WO-3', 'before'), att('WO-4', 'before'), att('WO-5', 'before'), att('WO-6', 'before'), att('WO-7', 'before'),
      { WO_ID: 'WO-1', Invoice_ID: 'INV-1', File_Type: 'report', File_Name: 'r.jpg', Active: 'TRUE' },
      { WO_ID: 'WO-2', Invoice_ID: 'INV-1', File_Type: 'report', File_Name: 'other.jpg', Active: 'TRUE' },
      { WO_ID: '', Invoice_ID: 'INV-1', File_Type: 'report', File_Name: 'orphan.jpg', Active: 'TRUE' },
    ],
  };
}
const call = (q, role, sid) => fns.getAttachments(env, new URL('https://x/attachments?' + q), role, sid);
const types = r => (r.body || []).map(a => a.File_Type).sort().join(',');

// ---- admin (no role) is unchanged ----------------------------------------------------------
reset();
{
  const r = await call('wo_id=WO-2', null, null);
  ok(r.status === 200 && r.body.length === 2, 'admin secret (no role) still lists any WO\'s attachments (both of WO-2\'s rows)');
  const r2 = await call('wo_id=SCOPE-12', null, null);
  ok(r2.status === 200 && Array.isArray(r2.body), 'admin lookups by non-WO key (scope-creator) still work, no 404');
  ok((await call('', null, null)).status === 400, 'missing params is still a 400');
}

// ---- the leak itself: wrong-account sessions get a generic 404 + telemetry -----------------
reset();
for (const [role, sid, wo] of [['tenant', 'T1', 'WO-2'], ['tenant', 'T2', 'WO-1'], ['owner', 'O1', 'WO-2'], ['owner', 'O2', 'WO-1'], ['vendor', 'V1', 'WO-2'], ['vendor', 'V2', 'WO-1']]) {
  tel.length = 0;
  const r = await call('wo_id=' + wo, role, sid);
  ok(r.status === 404 && r.body.error === 'Not found', `${role} ${sid} asking for ${wo} -> 404`);
  ok(tel.length === 1 && tel[0].Job_Type === 'attachments_scope_denied' && tel[0].Success === 'FALSE' && /wo=/.test(tel[0].Notes), `${role} ${sid}/${wo} denial is logged to telemetry as a failure`);
}
{
  const missing = await call('wo_id=WO-NOPE', 'owner', 'O1');
  const wrong = await call('wo_id=WO-2', 'owner', 'O1');
  ok(JSON.stringify(missing) === JSON.stringify(wrong), 'a missing WO and someone else\'s WO look identical (no probing)');
}

// ---- legit access is preserved -------------------------------------------------------------
reset();
{
  const v = await call('wo_id=WO-1', 'vendor', 'V1');
  ok(v.status === 200 && types(v) === 'before,bill,invoice,receipt,report', 'assigned vendor keeps everything on their own WO (incl. their receipts/bills) and inactive rows stay hidden');
  const o = await call('wo_id=WO-1', 'owner', 'O1');
  ok(o.status === 200 && types(o).includes('receipt') && types(o).includes('before'), 'owner keeps photos AND receipts on their own property\'s WO (owner-file/view depends on the receipt row)');
  const t = await call('wo_id=WO-1', 'tenant', 'T1');
  ok(t.status === 200 && types(t) === 'before,report', 'tenant keeps photos on their own unit\'s WO');
  ok(!t.body.some(a => ['receipt', 'bill', 'invoice'].includes(a.File_Type)), 'tenant NEVER receives receipt/bill/invoice rows (vendor cost docs), even on their own job');
}

// ---- visibility rules mirror the portal lists ----------------------------------------------
reset();
{
  ok((await call('wo_id=WO-3', 'tenant', 'T1')).status === 404, 'tenant: Tenant_Visible=FALSE job is not listable');
  ok((await call('wo_id=WO-3', 'owner', 'O1')).status === 200, 'owner: Tenant_Visible=FALSE does not hide it from the owner (owner list ignores that flag)');
  ok((await call('wo_id=WO-4', 'owner', 'O1')).status === 404, 'owner: voided addon draft is not listable');
  ok((await call('wo_id=WO-4', 'vendor', 'V1')).status === 200, 'vendor: voided additional-work DRAFT is still the vendor\'s own (they attach photos before submitting)');
  ok((await call('wo_id=WO-4', 'tenant', 'T1')).status === 404, 'tenant: voided job is not listable');
  ok((await call('wo_id=WO-5', 'owner', 'O1')).status === 404, 'owner: still-linked bid-group copy (internal shotgun) is hidden');
  ok((await call('wo_id=WO-6', 'tenant', 'T1')).status === 404, 'tenant: another unit\'s job in the same building is not listable');
  ok((await call('wo_id=WO-7', 'tenant', 'T1')).status === 404, 'tenant with a unit cannot see a property-level job with no unit');
  ok((await call('wo_id=WO-1', 'tenant', 'T3')).status === 404, 'inactive tenant gets nothing');
}

// ---- invoice_id path is filtered per row, never enumerates across accounts -----------------
reset();
{
  const r = await call('invoice_id=INV-1', 'owner', 'O1');
  ok(r.status === 200 && r.body.length === 1 && r.body[0].File_Name === 'r.jpg', 'invoice_id lookup returns only rows on WOs this session may see (other account + orphan row dropped)');
  const r2 = await call('invoice_id=INV-1', 'vendor', 'V2');
  ok(r2.body.length === 1 && r2.body[0].File_Name === 'other.jpg', 'same for a vendor');
}

// ---- fail closed ---------------------------------------------------------------------------
reset();
{
  ok((await call('wo_id=WO-1', 'mystery', 'X1')).status === 404, 'unknown role fails closed');
  ok((await call('wo_id=WO-1', 'owner', '')).status === 404, 'role with an empty session id fails closed');
  ok(fns.attachmentScopeAllows('vendor', 'V1', { Vendor_ID: '' }, [], []) === false, 'a WO with no vendor never matches a vendor session');
}

// ---- telemetry failure is loud, never swallowed --------------------------------------------
reset();
{
  telemetryShouldFail = true;
  let threw = false;
  try { await call('wo_id=WO-2', 'owner', 'O1'); } catch (e) { threw = /telemetry down/.test(e.message); }
  ok(threw, 'if the denial cannot be logged the request errors loudly (outer handler -> 500) instead of silently swallowing');
}

// ---- wiring --------------------------------------------------------------------------------
ok(src.includes("if (path === '/attachments')            return await getAttachments(env, url, callerRole, callerSessionId);"), 'route passes the verified session role + id');
{
  const tw = grab('async function', 'tenantWorkorders');
  ok(tw.includes('tenantCanSeeWO(tenant, w)'), 'tenantWorkorders uses the SAME visibility predicate as /attachments (one definition)');
  const g = grab('async function', 'getAttachments');
  ok(!/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(g), 'no swallowing catch in getAttachments');
}
console.log(`attachments-scope: ${n}/${n} passing`);
