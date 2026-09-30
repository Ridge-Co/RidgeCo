// Approve & send to proposal (Sep 30 2026) — approve_first on POST /wo/push-to-scope. Same harness as wo-push-to-scope.test.mjs.
// (original header:) WO -> Scope Proposal conversion (Sep 18 2026, worker.js: scopeItemsFromEstimate, woPushToScope,
// POST /wo/push-to-scope). Extracts the REAL functions verbatim out of worker.js and runs the
// endpoint against an in-memory fake Sheets backend, same convention as test/wo-void.test.mjs /
// test/wo-deposit.test.mjs — this proves the actual shipped logic, not a re-implementation.
import fs from 'fs';
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(sig) {
  const start = wsrc.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = wsrc.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < wsrc.length; i++) {
    if (wsrc[i] === '{') depth++;
    else if (wsrc[i] === '}') { depth--; if (!depth) break; }
  }
  return wsrc.slice(start, i + 1);
}
function grabRange(startSig, endSig) {
  const start = wsrc.indexOf(startSig);
  if (start < 0) throw new Error('not found: ' + startSig);
  const end = wsrc.indexOf(endSig, start);
  if (end < 0) throw new Error('end not found: ' + endSig);
  return wsrc.slice(start, end);
}
function grabConst(sig) {
  const start = wsrc.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const end = wsrc.indexOf(';\n', start);
  return wsrc.slice(start, end + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('  ✗ FAIL:', n); } };

// ── Endpoint tests: build against a fake Sheets backend ─────────────────────────────────────
const cacheSrc           = grabRange('const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc              = grab('async function sheetsRequest(');
const ensureColumnsSrc    = grab('async function ensureColumns(');
const ensureColumnsInnerSrc = grab('async function ensureColumnsInner(');
const ensureTabSrc        = grab('async function ensureTab(');
const idcSrc              = grab('function idColIndex(');
const colSrc              = grab('function col(index)') || grab('function col(index');
const jsonSrc             = grab('function json(data');
const isMissingTabErrorSrc = grab('function isMissingTabError(');
const missingTabResponseSrc = grab('function missingTabResponse(');
const fetchTabSrc         = grab('async function fetchTab(');
const findWOSrc           = grab('function findWO(');
const addRowSrc           = grab('async function addRow(');
const updateRowSrc        = grab('async function updateRow(');
const updateWOFieldsSrc   = grab('async function updateWOFields(');
const scopesHeadersSrc    = grabConst('const SCOPES_HEADERS');
const scopeParseItemsSrc  = grab('function scopeParseItems(') || grabConst('function scopeParseItems');
const scopeItemsFromEstimateSrc = grab('function scopeItemsFromEstimate(');
const woPushToScopeSrc    = grab('async function woPushToScope(');
// scopesTab is a one-liner (`async function scopesTab(env) { await ensureTab(...); }`) — grab()
// handles it fine since it still balances on the first `{`.
const scopesTabSrc        = grab('async function scopesTab(');

const WO_HEADERS = ['ID', 'Property_ID', 'Unit_ID', 'Room', 'Trade', 'Description', 'Vendor_ID', 'Status', 'Voided', 'Scope_ID', 'Notes', 'Customer_Charge'];
const EST_HEADERS = ['ID', 'WO_ID', 'Vendor_ID', 'Version', 'Line_Items', 'Subtotal', 'Change_Reason', 'Created_By', 'Created_Date', 'Status', 'Approved_By', 'Approved_Date', 'Approval_Note', 'Converted_Scope_ID', 'Converted_Date', 'Active'];

function makeDb(woRows, estRows, scopeRows) {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: (woRows || []).map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    Estimates: { headers: EST_HEADERS.slice(), rows: (estRows || []).map(r => EST_HEADERS.map(h => r[h] ?? '')) },
    Scopes: { headers: SCOPES_HEADERS_ARR.slice(), rows: (scopeRows || []).map(r => SCOPES_HEADERS_ARR.map(h => r[h] ?? '')) },
  };
}

function makeFetch(db) {
  return async (url, opts) => {
    if (String(url).includes('api.anthropic.com') && globalThis.__anthropicStub) return globalThis.__anthropicStub(url, opts);   // translator calls share the same injected fetch
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0];
    const method = opts.method;
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      const body = JSON.parse(opts.body);
      for (const d of body.data) {
        const [tabName, cellRef] = d.range.split('!');
        const colLetter = cellRef.match(/[A-Z]+/)[0];
        const rowNum = parseInt(cellRef.match(/\d+/)[0], 10);
        let ci = 0; for (let k = 0; k < colLetter.length; k++) ci = ci * 26 + (colLetter.charCodeAt(k) - 64); ci -= 1;
        const tab = db[tabName];
        if (!tab) continue;
        if (rowNum === 1) { tab.headers[ci] = d.values[0][0]; continue; }
        const r = tab.rows[rowNum - 2];
        if (r) r[ci] = d.values[0][0];
      }
      return { json: async () => ({}) };
    }
    let m2 = /^\/values\/([^!:?]+):append/.exec(path);
    if (method === 'POST' && m2) {
      const body = JSON.parse(opts.body);
      if (!db[m2[1]]) db[m2[1]] = { headers: [], rows: [] };
      db[m2[1]].rows.push(...body.values);
      return { json: async () => ({}) };
    }
    // ensureColumnsInner's best-effort grid-metadata GET — never hit by these tests since no new
    // column is ever actually missing on our fake tabs, but throw the same generic "unhandled"
    // shape just in case, which ensureColumnsInner already wraps in its own try/catch.
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

function build(db) {
  const src = [
    'const CORS = {};',
    cacheSrc, srSrc, ensureColumnsSrc, ensureColumnsInnerSrc, ensureTabSrc, idcSrc, colSrc, jsonSrc,
    isMissingTabErrorSrc, missingTabResponseSrc, fetchTabSrc, findWOSrc, addRowSrc, updateRowSrc,
    updateWOFieldsSrc, scopesHeadersSrc, scopeParseItemsSrc, grab('function englishOnly('), grab('function estimateLinesEnglish('), grab('function plausiblyNonEnglish('), grab('async function translateBatchToEnglish('), scopeItemsFromEstimateSrc, scopesTabSrc,
    "const APPROVAL_STAGES = ['Estimated', 'Proposed', 'Pre-approved', 'Approved'];",
    grabRange('async function setApprovalStage(', '// POST /admin/backfill-approval-stage'),
    woPushToScopeSrc,
    'return { woPushToScope };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db), (fn) => fn());
}

// SCOPES_HEADERS as a real array, evaluated from its own grabbed source, so the fake Scopes tab's
// column layout can never quietly drift from the real one.
const SCOPES_HEADERS_ARR = new Function(scopesHeadersSrc + '\nreturn SCOPES_HEADERS;')();

function woRow(db, id) { return db.Work_Orders.rows.find(r => r[0] === id); }
function woField(name, r) { const i = WO_HEADERS.indexOf(name); return r ? r[i] : undefined; }
function estRow(db, id) { return db.Estimates.rows.find(r => r[0] === id); }
function estField(name, r) { const i = EST_HEADERS.indexOf(name); return r ? r[i] : undefined; }
function scopeRow(db, id) { return db.Scopes.rows.find(r => r[0] === id); }
function scopeField(name, r) { const i = SCOPES_HEADERS_ARR.indexOf(name); return r ? r[i] : undefined; }

console.log('\nPOST /wo/push-to-scope approve_first — approve silently, push, never text the vendor\n');
const env = { SHEET_ID: 'S' };
const LI = JSON.stringify([{ desc: 'Replace rotted wood', amount: 650 }]);
const mkEst = (o) => Object.assign({ WO_ID: 'WO-1', Vendor_ID: '7', Line_Items: LI, Subtotal: '650', Active: 'TRUE', Created_By: 'vendor' }, o);

// structural: the push path can never text a vendor or flash an 'Approved' stage
{
  const fn = woPushToScopeSrc.replace(/\/\/.*$/gm, '');
  t('woPushToScope never calls a vendor-SMS helper', !/notifyVendorTemplated|sendTemplatedSms|smsGatedSend|sendSMS/.test(fn));
  t("woPushToScope never sets the 'Approved' stage (only Proposed)", !/stage:\s*'Approved'/.test(fn) && /stage:\s*'Proposed'/.test(fn));
}
// preview with approve_first writes NOTHING
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Vendor_ID: '7' }], [mkEst({ ID: 'E1', Version: '1', Status: 'Pending' })], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1', approve_first: true });
  const body = await res.json();
  t('preview succeeds on a Pending estimate', res.status === 200 && body.success && body.applied === false);
  t('preview flags that it would approve silently', body.will_approve_silently === true && body.estimate_id === 'E1');
  t('preview leaves the estimate Pending', estField('Status', estRow(db, 'E1')) === 'Pending');
  t('preview creates no Scope', db.Scopes.rows.length === 0);
}
// apply: approves, converts, links scope, stage Proposed, no vendor text
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Vendor_ID: '7' }], [mkEst({ ID: 'E1', Version: '1', Status: 'Pending' })], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1', approve_first: true, apply: true, approved_by: 'admin' });
  const body = await res.json();
  t('apply succeeds', res.status === 200 && body.success && body.applied === true);
  t('reports approved_silently and vendor_texted:false', body.approved_silently === true && body.vendor_texted === false);
  t('estimate ends Converted (approved then pushed)', estField('Status', estRow(db, 'E1')) === 'Converted');
  t('approval is recorded (who + note)', estField('Approved_By', estRow(db, 'E1')) === 'admin' && /not texted/.test(estField('Approval_Note', estRow(db, 'E1'))));
  t('a Scope was created and linked to the WO', db.Scopes.rows.length === 1 && woField('Scope_ID', woRow(db, 'WO-1')) === body.scope_id);
}
// latest open version wins; a Declined newer version is ignored
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Vendor_ID: '7' }], [
    mkEst({ ID: 'E1', Version: '1', Status: 'Pending' }),
    mkEst({ ID: 'E2', Version: '2', Status: 'Needs Info' }),
    mkEst({ ID: 'E3', Version: '3', Status: 'Declined' }),
  ], []);
  const { woPushToScope } = build(db);
  const body = await (await woPushToScope(env, { wo_id: 'WO-1', approve_first: true })).json();
  t('picks the latest non-declined version (v2)', body.estimate_id === 'E2');
}
// nothing open -> clear error, nothing written
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Vendor_ID: '7' }], [mkEst({ ID: 'E1', Version: '1', Status: 'Declined' })], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1', approve_first: true, apply: true });
  t('all-declined WO is refused with a 400', res.status === 400);
  t('and nothing is created', db.Scopes.rows.length === 0);
}
// without approve_first the old gate is unchanged
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Vendor_ID: '7' }], [mkEst({ ID: 'E1', Version: '1', Status: 'Pending' })], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1', apply: true });
  const body = await res.json();
  t('plain push of a Pending estimate is still refused', res.status === 400 && /no APPROVED estimate/.test(body.error));
  t('and does not approve it', estField('Status', estRow(db, 'E1')) === 'Pending');
}
// already-Approved (old no-proposal path) still pushes, and is not re-approved
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Vendor_ID: '7' }], [mkEst({ ID: 'E1', Version: '1', Status: 'Approved', Approved_By: 'admin' })], []);
  const { woPushToScope } = build(db);
  const body = await (await woPushToScope(env, { wo_id: 'WO-1', approve_first: true, apply: true })).json();
  t('an already-approved estimate pushes normally, no silent re-approval', body.success && body.approved_silently === false);
}

// ── UI wiring (index.html) ───────────────────────────────────────────────────────────────────
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  t('pending panel has "Approve (no proposal)"', html.includes('✓ Approve (no proposal)'));
  t('pending panel has "Approve & send to proposal" wired to openPushToScopeUI(..., true)', html.includes('Approve &amp; send to proposal') && /openPushToScopeUI\(\\'' \+ woId \+ '\\', true\)/.test(html));
  t('the old standalone "Push estimate to Scope Proposal" button is gone', !html.includes('📋 Push estimate to Scope Proposal'));
  t('approve_first is sent to the server on apply', html.includes('approve_first: !!approveFirst'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
