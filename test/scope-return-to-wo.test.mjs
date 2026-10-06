// Return a pushed Scope Proposal to its Work Order (Oct 5 2026, worker.js: scopeReturnBlockers, scopeReturnToWO,
// POST /scope/return-to-wo) + hardening (woPushToScope ignores an archived scope link; approveEstimate 409s on a
// Converted estimate) + UI wiring (index.html estimate panel, scope-creator.html header). Extracts the REAL functions
// verbatim out of worker.js and runs them against an in-memory fake Sheets backend, same convention as
// test/wo-push-to-scope.test.mjs and test/push-approve-first.test.mjs — this proves the shipped logic, not a copy.
// Brett's case: Scope #9 / WO-1222 (unsigned, Status draft, Approval_Stage Proposed, estimate pushed with approve_first).
import fs from 'fs';
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const idxHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scHtml = fs.readFileSync(new URL('../scope-creator.html', import.meta.url), 'utf8');

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

const cacheSrc = grabRange('const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc = grab('async function sheetsRequest(');
const ensureColumnsSrc = grab('async function ensureColumns(');
const ensureColumnsInnerSrc = grab('async function ensureColumnsInner(');
const ensureTabSrc = grab('async function ensureTab(');
const idcSrc = grab('function idColIndex(');
const colSrc = grab('function col(index)') || grab('function col(index');
const jsonSrc = grab('function json(data');
const isMissingTabErrorSrc = grab('function isMissingTabError(');
const missingTabResponseSrc = grab('function missingTabResponse(');
const fetchTabSrc = grab('async function fetchTab(');
const fetchTabsSrc = grab('async function fetchTabs(');
const findWOSrc = grab('function findWO(');
const addRowSrc = grab('async function addRow(');
const updateRowSrc = grab('async function updateRow(');
const updateWOFieldsSrc = grab('async function updateWOFields(');
const scopesHeadersSrc = grabConst('const SCOPES_HEADERS');
const scopeSigHeadersSrc = grabConst('const SCOPE_SIG_HEADERS');
const msHeadersSrc = grabConst('const PAYMENT_MILESTONES_HEADERS');
const scopeParseItemsSrc = grab('function scopeParseItems(');
const scopesTabSrc = grab('async function scopesTab(');
const scopeSigTabSrc = grab('async function scopeSigTab(');
const msTabSrc = grab('async function paymentMilestonesTab(');
const returnBlockSrc = grabRange('const SCOPE_RETURN_BLOCKED_STATUSES', '// POST /scope/estimate');
const scopeReturnToWOSrc = grab('async function scopeReturnToWO(');
const approveEstimateSrc = grab('async function approveEstimate(');
const addonBlockSrc = grab('function addonEstimateActionBlock(');
const woPushToScopeSrc = grab('async function woPushToScope(');

const SCOPES_HEADERS_ARR = new Function(scopesHeadersSrc + '\nreturn SCOPES_HEADERS;')().concat(['Approval_Stage', 'Link_Rev', 'Proposal_Items_JSON', 'Sent_Date', 'Sent_To', 'Send_Count']);
const SIG_HEADERS_ARR = new Function(scopeSigHeadersSrc + '\nreturn SCOPE_SIG_HEADERS;')();
const MS_HEADERS_ARR = new Function(msHeadersSrc + '\nreturn PAYMENT_MILESTONES_HEADERS;')();
const WO_HEADERS = ['ID', 'Property_ID', 'Unit_ID', 'Room', 'Trade', 'Description', 'Vendor_ID', 'Status', 'Voided', 'Scope_ID', 'Notes', 'Customer_Charge', 'Approval_Stage', 'Estimate_Revised'];
const EST_HEADERS = ['ID', 'WO_ID', 'Vendor_ID', 'Version', 'Line_Items', 'Subtotal', 'Change_Reason', 'Created_By', 'Created_Date', 'Status', 'Approved_By', 'Approved_Date', 'Approval_Note', 'Needs_Info_Date', 'Converted_Scope_ID', 'Converted_Date', 'Active'];

function tab(headers, rows) { return { headers: headers.slice(), rows: (rows || []).map(r => headers.map(h => r[h] ?? '')) }; }
function makeDb(o) {
  return {
    Work_Orders: tab(WO_HEADERS, o.wos), Estimates: tab(EST_HEADERS, o.ests), Scopes: tab(SCOPES_HEADERS_ARR, o.scopes),
    Scope_Signatures: tab(SIG_HEADERS_ARR, o.sigs), Payment_Milestones: tab(MS_HEADERS_ARR, o.ms),
  };
}
function makeFetch(db) {
  return async (url, opts) => {
    if (String(url).includes('api.anthropic.com') && globalThis.__anthropicStub) return globalThis.__anthropicStub(url, opts);
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0];
    const method = opts.method;
    if (method === 'GET' && path === '/values:batchGet') {
      const names = (full.split('?')[1] || '').split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, '')));
      return { json: async () => ({ valueRanges: names.map(n => ({ values: db[n] ? [db[n].headers.slice(), ...db[n].rows.map(r => r.slice())] : [] })) }) };
    }
    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tb = db[m[1]];
      if (!tb) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tb.headers.slice(), ...tb.rows.map(r => r.slice())] }) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      const body = JSON.parse(opts.body);
      if (db.__failOnce && body.data.some(d => d.range.startsWith(db.__failOnce + '!'))) { db.__failOnce = null; return { json: async () => ({ error: { code: 500, message: 'boom (injected)' } }) }; }
      for (const d of body.data) {
        const [tabName, cellRef] = d.range.split('!');
        const colLetter = cellRef.match(/[A-Z]+/)[0];
        const rowNum = parseInt(cellRef.match(/\d+/)[0], 10);
        let ci = 0; for (let k = 0; k < colLetter.length; k++) ci = ci * 26 + (colLetter.charCodeAt(k) - 64); ci -= 1;
        const tb = db[tabName];
        if (!tb) continue;
        if (rowNum === 1) { tb.headers[ci] = d.values[0][0]; continue; }
        const r = tb.rows[rowNum - 2];
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
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}
// calls = recorded side effects: notify (vendor SMS helper), telemetry rows, audit entries.
function build(db, calls, notifyImpl) {
  const src = [
    'const CORS = {};',
    cacheSrc, srSrc, ensureColumnsSrc, ensureColumnsInnerSrc, ensureTabSrc, idcSrc, colSrc, jsonSrc,
    isMissingTabErrorSrc, missingTabResponseSrc, fetchTabSrc, fetchTabsSrc, findWOSrc, addRowSrc, updateRowSrc, updateWOFieldsSrc,
    scopesHeadersSrc, scopeSigHeadersSrc, msHeadersSrc, scopeParseItemsSrc, scopesTabSrc, scopeSigTabSrc, msTabSrc,
    grab('function englishOnly('), grab('function estimateLinesEnglish('), grab('function plausiblyNonEnglish('), grab('async function translateBatchToEnglish('), grab('function scopeItemsFromEstimate('),
    "const APPROVAL_STAGES = ['Estimated', 'Proposed', 'Pre-approved', 'Approved'];",
    grabRange('async function setApprovalStage(', '// POST /admin/backfill-approval-stage'),
    returnBlockSrc, scopeReturnToWOSrc, addonBlockSrc, approveEstimateSrc, woPushToScopeSrc,
    'return { scopeReturnToWO, scopeReturnBlockers, approveEstimate, woPushToScope };',
  ].join('\n');
  const notifyVendorTemplated = async (env, type, woId, vendorId) => {
    calls.notify.push({ type, woId, vendorId });
    return notifyImpl ? notifyImpl(type, woId, vendorId) : { sent: true };
  };
  const logTelemetry = async (env, rec) => { calls.telemetry.push(rec); };
  const logWOAuditMany = async (env, entries) => { calls.audit.push(...entries); };
  return new Function('getAccessToken', 'fetch', 'setTimeout', 'notifyVendorTemplated', 'logTelemetry', 'logWOAuditMany', src)(
    async () => 'tok', makeFetch(db), (fn) => fn(), notifyVendorTemplated, logTelemetry, logWOAuditMany);
}
const newCalls = () => ({ notify: [], telemetry: [], audit: [] });

const wo = (db, id) => db.Work_Orders.rows.find(r => r[WO_HEADERS.indexOf('ID')] === id);
const woF = (db, id, f) => { const r = wo(db, id); return r ? r[WO_HEADERS.indexOf(f)] : undefined; };
const est = (db, id) => db.Estimates.rows.find(r => r[0] === id);
const estF = (db, id, f) => { const r = est(db, id); return r ? r[EST_HEADERS.indexOf(f)] : undefined; };
const sc = (db, id) => db.Scopes.rows.find(r => r[0] === id);
const scF = (db, id, f) => { const r = sc(db, id); return r ? r[SCOPES_HEADERS_ARR.indexOf(f)] : undefined; };
const snap = db => JSON.stringify(db);

const ITEM = [{ id: 'li1', area: '', trade: '', description: 'Replace rotted wood', qty: '', note: '', variants: [{ key: 'v1', label: '', vendor_cost: 650, price_override: null }], selected_key: 'v1' }];
// Brett's real shape: WO-1222, Scope 9 unsigned/draft/Proposed, 1 line item, estimate Converted via approve_first.
function world(over) {
  over = over || {};
  return makeDb({
    wos: [{ ID: 'WO-1222', Property_ID: '58', Vendor_ID: '7', Status: 'Assigned', Scope_ID: '9', Notes: 'old note', Approval_Stage: 'Proposed', Estimate_Revised: 'TRUE', Trade: 'Carpentry' }].concat(over.extraWos || []),
    ests: [{ ID: 'E1', WO_ID: 'WO-1222', Vendor_ID: '7', Version: '1', Line_Items: JSON.stringify([{ desc: 'Replace rotted wood', amount: 650 }]), Subtotal: '650', Status: 'Converted', Approved_By: 'admin', Approved_Date: '2026-10-04T10:00:00.000Z', Approval_Note: 'Approved for proposal — vendor not texted until the owner signs', Converted_Scope_ID: '9', Converted_Date: '2026-10-04T10:00:00.000Z', Active: 'TRUE' }].concat(over.extraEsts || []),
    scopes: [Object.assign({ ID: '9', Property_ID: '58', Title: 'WO WO-1222 — Rotted wood', Status: 'draft', Approval_Stage: 'Proposed', WO_ID: 'WO-1222', Vendor_ID: '7', Line_Items: JSON.stringify(ITEM), Source_Refs: JSON.stringify([{ type: 'estimate', estimate_id: 'E1', version: '1', wo_id: 'WO-1222' }]), Active: 'TRUE' }, over.scope || {})].concat(over.extraScopes || []),
    sigs: over.sigs || [], ms: over.ms || [],
  });
}
const env = { SHEET_ID: 'S' };
const run = async (db, body, notifyImpl) => { const calls = newCalls(); const fns = build(db, calls, notifyImpl); const res = await fns.scopeReturnToWO(env, body); return { res, body: await res.json(), calls, fns }; };

console.log('POST /scope/return-to-wo — blockers (pure)\n');
{
  const { scopeReturnBlockers } = build(world(), newCalls());
  const base = { ID: '9', WO_ID: 'WO-1222', Status: 'draft', Approval_Stage: 'Proposed' };
  const conv = [{ ID: 'E1' }];
  t('a clean unsigned proposal has no blockers', scopeReturnBlockers(base, [], [], conv).length === 0);
  t('blank WO_ID blocks', scopeReturnBlockers(Object.assign({}, base, { WO_ID: '' }), [], [], conv).some(m => /not linked to a work order/.test(m)));
  for (const st of ['signed', 'invoiced', 'ready-to-bill', 'fully-invoiced']) t(`Status ${st} blocks`, scopeReturnBlockers(Object.assign({}, base, { Status: st }), [], [], conv).length >= 1);
  for (const sg of ['Pre-approved', 'Approved']) t(`Approval_Stage ${sg} blocks`, scopeReturnBlockers(Object.assign({}, base, { Approval_Stage: sg }), [], [], conv).some(m => m.includes(sg)));
  t('a live signature row blocks', scopeReturnBlockers(base, [{ Scope_ID: '9', Active: 'TRUE' }], [], conv).some(m => /signature/.test(m)));
  t('a signature row for ANOTHER scope does not block', scopeReturnBlockers(base, [{ Scope_ID: '10', Active: 'TRUE' }], [], conv).length === 0);
  t('an Active=FALSE signature row does not block', scopeReturnBlockers(base, [{ Scope_ID: '9', Active: 'FALSE' }], [], conv).length === 0);
  t('a live milestone row blocks', scopeReturnBlockers(base, [], [{ Scope_ID: '9', Active: 'TRUE' }], conv).some(m => /milestone/i.test(m)));
  t('no converted estimate blocks', scopeReturnBlockers(base, [], [], []).some(m => /no estimate|No work order estimate/.test(m)));
  t('every reason is a plain-English sentence (no raw field names)', ['signed', 'invoiced'].every(st => !/Scope_ID|Approval_Stage_|undefined/.test(scopeReturnBlockers(Object.assign({}, base, { Status: st }), [], [], conv).join(' '))));
}

console.log('\nPOST /scope/return-to-wo — endpoint (fake Sheets)\n');
{
  const r = await run(world(), {});
  t('scope_id required', r.res.status === 400 && /scope_id required/.test(r.body.error));
  const r2 = await run(world(), { scope_id: '999' });
  t('404 on an unknown scope', r2.res.status === 404);
}
// every blocker is a 409 with the reasons AND writes nothing — for preview and apply alike
for (const [label, over] of [
  ['status signed', { scope: { Status: 'signed' } }], ['status invoiced', { scope: { Status: 'invoiced' } }], ['status fully-invoiced', { scope: { Status: 'fully-invoiced' } }],
  ['stage Pre-approved', { scope: { Approval_Stage: 'Pre-approved' } }], ['stage Approved', { scope: { Approval_Stage: 'Approved' } }],
  ['live signature row', { sigs: [{ ID: '1', Scope_ID: '9', Active: 'TRUE', Status: 'signed' }] }],
  ['live milestone row', { ms: [{ ID: '1', Scope_ID: '9', Active: 'TRUE', Status: 'pending' }] }],
  ['blank WO_ID', { scope: { WO_ID: '' } }],
]) {
  for (const apply of [false, true]) {
    const db = world(over); const before = snap(db);
    const r = await run(db, { scope_id: '9', apply, request_info: true });
    t(`blocked (${label}, apply=${apply}) -> 409 + reasons`, r.res.status === 409 && r.body.blocked === true && Array.isArray(r.body.blockers) && r.body.blockers.length >= 1 && typeof r.body.error === 'string' && r.body.error.length > 10);
    t(`blocked (${label}, apply=${apply}) wrote nothing and texted nobody`, snap(db) === before && r.calls.notify.length === 0);
  }
}
{
  const db = world({ scope: { Status: 'returned-to-wo', Active: 'FALSE', WO_ID: '' } }); const before = snap(db);
  const r = await run(db, { scope_id: '9', apply: true });
  t('an already-returned scope -> 409 already_returned, no writes', r.res.status === 409 && r.body.already_returned === true && snap(db) === before);
}
{
  const db = world({ scope: { Active: 'FALSE' } });
  const r = await run(db, { scope_id: '9', apply: true });
  t('an inactive scope is refused too', r.res.status === 409 && r.body.already_returned === true);
}
{
  const db = world({ ests: [] }); db.Estimates.rows[0][EST_HEADERS.indexOf('Converted_Scope_ID')] = '';
  const r = await run(db, { scope_id: '9' });
  t('a scope with no converted estimate is refused (nothing to send back)', r.res.status === 409 && r.body.blockers.some(m => /estimate/i.test(m)));
}
// preview
{
  const db = world(); const before = snap(db);
  const r = await run(db, { scope_id: '9' });
  t('preview (apply omitted) succeeds and says applied:false', r.res.status === 200 && r.body.success === true && r.body.applied === false);
  t('preview writes NOTHING', snap(db) === before);
  t('preview lists the estimate, its current and resulting status', r.body.estimates.length === 1 && r.body.estimates[0].status_now === 'Converted' && r.body.estimates[0].status_after === 'Pending');
  t('preview carries plain-English bullets and the wo_url', Array.isArray(r.body.will) && r.body.will.length >= 4 && r.body.wo_url === 'index.html?wo=WO-1222');
  t('preview with request_info:true shows Needs Info + vendor text bullet', (await run(world(), { scope_id: '9', request_info: true })).body.estimates[0].status_after === 'Needs Info');
  t('preview texts nobody', r.calls.notify.length === 0);
}
// apply, request_info false (the default)
{
  const db = world(); const woBefore = wo(db, 'WO-1222').slice();
  const r = await run(db, { scope_id: '9', apply: true });
  t('apply succeeds', r.res.status === 200 && r.body.success === true && r.body.applied === true);
  t('scope archived: Status returned-to-wo, Active FALSE', scF(db, '9', 'Status') === 'returned-to-wo' && scF(db, '9', 'Active') === 'FALSE');
  t('scope Approval_Stage and WO_ID are cleared', scF(db, '9', 'Approval_Stage') === '' && scF(db, '9', 'WO_ID') === '');
  t('scope history kept: Line_Items and Source_Refs untouched', scF(db, '9', 'Line_Items') === JSON.stringify(ITEM) && /estimate_id/.test(scF(db, '9', 'Source_Refs')));
  t('a note records the return (and which WO) on the archived scope', /Returned to WO-1222/.test(scF(db, '9', 'Notes')));
  t('estimate goes back to Pending', estF(db, 'E1', 'Status') === 'Pending');
  t('estimate Converted_Scope_ID / Converted_Date / Approved_By / Approved_Date / Approval_Note cleared', ['Converted_Scope_ID', 'Converted_Date', 'Approved_By', 'Approved_Date', 'Approval_Note', 'Needs_Info_Date'].every(f => estF(db, 'E1', f) === ''));
  t('WO Scope_ID cleared (so the next push makes a fresh scope)', woF(db, 'WO-1222', 'Scope_ID') === '');
  t('WO Approval_Stage back to Estimated, Estimate_Revised cleared', woF(db, 'WO-1222', 'Approval_Stage') === 'Estimated' && woF(db, 'WO-1222', 'Estimate_Revised') === '');
  t('WO Status and vendor are NEVER changed', woF(db, 'WO-1222', 'Status') === 'Assigned' && woF(db, 'WO-1222', 'Vendor_ID') === '7');
  t('WO Notes keeps the old note and gets a timestamped line appended', /^old note\n\[.* — admin \(admin\)\] Scope Proposal #9 was returned to this work order\.$/.test(woF(db, 'WO-1222', 'Notes')));
  t('no vendor text when request_info is false (helper never called)', r.calls.notify.length === 0);
  t('response: ids, vendor_text, wo_url, no warnings', r.body.scope_id === '9' && r.body.wo_id === 'WO-1222' && r.body.estimate_ids[0] === 'E1' && r.body.vendor_text.requested === false && r.body.vendor_text.sent === false && r.body.wo_url === 'index.html?wo=WO-1222' && r.body.warnings.length === 0);
  t('Link_Rev not bumped when no proposal was ever generated or sent', scF(db, '9', 'Link_Rev') === '' && r.body.link_rev_bumped === false);
  t('WO_Audit entries written (Scope_ID and Approval_Stage)', r.calls.audit.some(a => a.field === 'Scope_ID' && a.oldValue === '9') && r.calls.audit.some(a => a.field === 'Approval_Stage' && a.newValue === 'Estimated'));
  t('telemetry row logged: Job_Type scope_return_to_wo, Success TRUE', r.calls.telemetry.some(x => x.Job_Type === 'scope_return_to_wo' && x.Success === 'TRUE' && /scope=9/.test(x.Notes)));
  void woBefore;
}
// apply, request_info true
{
  const db = world();
  const r = await run(db, { scope_id: '9', apply: true, request_info: true });
  t('request_info:true -> estimate is Needs Info with Needs_Info_Date set', r.body.success && estF(db, 'E1', 'Status') === 'Needs Info' && !!estF(db, 'E1', 'Needs_Info_Date') && r.body.estimates_returned_to === 'Needs Info');
  t('the vendor needs-info template is sent once, for this WO and vendor', r.calls.notify.length === 1 && r.calls.notify[0].type === 'vendor_estimate_needs_info' && r.calls.notify[0].woId === 'WO-1222' && r.calls.notify[0].vendorId === '7');
  t('vendor_text.sent is true and the note says the vendor was asked', r.body.vendor_text.sent === true && /vendor was asked for more info/.test(woF(db, 'WO-1222', 'Notes')));
  t('Converted_Scope_ID cleared here too', estF(db, 'E1', 'Converted_Scope_ID') === '');
}
// SMS not sent / throws: the return STANDS, and the failure is reported + logged (never silent)
for (const [label, impl] of [['gate says not sent', async () => ({ sent: false, gate_snapshot: 'global off' })], ['helper throws', async () => { throw new Error('Twilio down'); }], ['no vendor phone', async () => ({ sent: false, reason: 'no vendor phone' })]]) {
  const db = world();
  const r = await run(db, { scope_id: '9', apply: true, request_info: true }, impl);
  t(`SMS failure (${label}) does NOT roll back the return`, r.res.status === 200 && r.body.success === true && scF(db, '9', 'Status') === 'returned-to-wo' && estF(db, 'E1', 'Status') === 'Needs Info');
  t(`SMS failure (${label}) is reported: vendor_text.sent false + a warning`, r.body.vendor_text.sent === false && r.body.warnings.some(w => /NOT texted/.test(w)) && !!(r.body.vendor_text.error || r.body.vendor_text.status));
  t(`SMS failure (${label}) is logged to telemetry with Success FALSE`, r.calls.telemetry.some(x => x.Job_Type === 'scope_return_to_wo' && x.Success === 'FALSE' && /vendor text not sent/.test(x.Notes)));
}
{
  const r = await run(world(), { scope_id: '9', apply: true, request_info: true }, async () => ({ sent: false, held_for_quiet_hours: true, send_after: '2026-10-06T13:00:00.000Z', gate_snapshot: 'quiet hours' }));
  t('a quiet-hours HOLD is not a failure: held:true, no warning, no FALSE telemetry', r.body.vendor_text.held === true && r.body.vendor_text.sent === false && r.body.warnings.length === 0 && !r.calls.telemetry.some(x => x.Success === 'FALSE'));
}
// Link_Rev bump when a proposal was generated/sent (the emailed link must die)
for (const [label, over] of [['Proposal_Text generated', { Proposal_Text: 'Proposal…' }], ['Send_Count > 0', { Send_Count: '1' }], ['Sent_Date set', { Sent_Date: '2026-10-04' }]]) {
  const db = world({ scope: Object.assign({ Link_Rev: '2' }, over) });
  const r = await run(db, { scope_id: '9', apply: true });
  t(`Link_Rev bumped (${label})`, r.body.success && scF(db, '9', 'Link_Rev') === '3' && r.body.link_rev_bumped === true);
}
// idempotence: second call is a clear 409 and writes/texts nothing
{
  const db = world(); const calls = newCalls(); const fns = build(db, calls);
  const first = await (await fns.scopeReturnToWO(env, { scope_id: '9', apply: true, request_info: true })).json();
  const after1 = snap(db); const notifyAfter1 = calls.notify.length; const telAfter1 = calls.telemetry.length;
  const res2 = await fns.scopeReturnToWO(env, { scope_id: '9', apply: true, request_info: true });
  const b2 = await res2.json();
  t('first apply worked', first.success === true);
  t('second apply -> 409 already_returned', res2.status === 409 && b2.already_returned === true);
  t('second apply wrote nothing, texted nobody, logged nothing', snap(db) === after1 && calls.notify.length === notifyAfter1 && calls.telemetry.length === telAfter1);
}
// multiple converted versions: all return; only the latest becomes Needs Info
{
  const db = world({ extraEsts: [{ ID: 'E2', WO_ID: 'WO-1222', Vendor_ID: '7', Version: '2', Line_Items: '[{"desc":"x","amount":1}]', Subtotal: '1', Status: 'Converted', Converted_Scope_ID: '9', Active: 'TRUE' }] });
  const r = await run(db, { scope_id: '9', apply: true, request_info: true });
  t('both converted versions are returned; v2 (latest) Needs Info, v1 Pending', r.body.success && estF(db, 'E1', 'Status') === 'Pending' && estF(db, 'E2', 'Status') === 'Needs Info' && r.body.estimate_ids.length === 2);
}
{
  const db = world({ extraEsts: [{ ID: 'E9', WO_ID: 'WO-5', Version: '1', Status: 'Converted', Converted_Scope_ID: '5', Active: 'TRUE' }] });
  const r = await run(db, { scope_id: '9', apply: true });
  t('other scopes\' converted estimates are untouched', r.body.success && estF(db, 'E9', 'Status') === 'Converted' && estF(db, 'E9', 'Converted_Scope_ID') === '5');
}
// failure -> rollback, nothing silently half-done
{
  const db = world(); const before = snap(db); db.__failOnce = 'Scopes';
  const r = await run(db, { scope_id: '9', apply: true, request_info: true });
  const dbNoFlag = JSON.parse(snap(db)); delete dbNoFlag.__failOnce;
  t('a failing scope write -> 500 with a plain error and rolled_back:true', r.res.status === 500 && r.body.success === false && r.body.rolled_back === true && /Could not return Scope Proposal #9/.test(r.body.error));
  t('everything earlier (estimate, WO) was put back exactly as it was', JSON.stringify(dbNoFlag) === JSON.stringify(JSON.parse(before)));
  t('no vendor text after a failed return', r.calls.notify.length === 0);
  t('the failure is logged to telemetry (Success FALSE)', r.calls.telemetry.some(x => x.Job_Type === 'scope_return_to_wo' && x.Success === 'FALSE'));
  const again = await run(db, { scope_id: '9', apply: true });
  t('after a rolled-back failure a retry succeeds', again.body.success === true && scF(db, '9', 'Status') === 'returned-to-wo');
}
{
  const db = world(); db.__failOnce = 'Estimates';
  const r = await run(db, { scope_id: '9', apply: true });
  t('a failing FIRST write also reports and leaves the scope untouched', r.res.status === 500 && scF(db, '9', 'Status') === 'draft' && wo(db, 'WO-1222') && woF(db, 'WO-1222', 'Scope_ID') === '9');
}

console.log('\nHardening — push after return, stale link, approve guard\n');
// push-after-return creates a FRESH scope; no duplicate line items; the archived scope is untouched
{
  const db = world(); const calls = newCalls(); const fns = build(db, calls);
  const ret = await (await fns.scopeReturnToWO(env, { scope_id: '9', apply: true })).json();
  t('(setup) returned', ret.success === true);
  const push = await (await fns.woPushToScope(env, { wo_id: 'WO-1222', approve_first: true, apply: true })).json();
  t('push after return succeeds and creates a NEW scope (not scope 9)', push.success === true && push.created_new_scope === true && push.scope_id && push.scope_id !== '9');
  t('the new scope holds exactly the one estimate line (no duplicate items)', JSON.parse(scF(db, push.scope_id, 'Line_Items')).length === 1);
  t('WO.Scope_ID now points at the new scope; estimate Converted to it', woF(db, 'WO-1222', 'Scope_ID') === push.scope_id && estF(db, 'E1', 'Converted_Scope_ID') === push.scope_id && estF(db, 'E1', 'Status') === 'Converted');
  t('the archived scope 9 is untouched by the new push', scF(db, '9', 'Status') === 'returned-to-wo' && scF(db, '9', 'Active') === 'FALSE' && JSON.parse(scF(db, '9', 'Line_Items')).length === 1);
  t('the new scope is linked to the WO and the WO is Proposed again', scF(db, push.scope_id, 'WO_ID') === 'WO-1222' && woF(db, 'WO-1222', 'Approval_Stage') === 'Proposed');
}
// stale link: WO.Scope_ID still points at an archived scope (e.g. someone re-linked by hand) -> never append into it
for (const archived of [{ Status: 'returned-to-wo', Active: 'FALSE' }, { Active: 'FALSE' }]) {
  const db = makeDb({
    wos: [{ ID: 'WO-3', Property_ID: '58', Vendor_ID: '7', Scope_ID: '9' }],
    ests: [{ ID: 'E3', WO_ID: 'WO-3', Version: '1', Line_Items: JSON.stringify([{ desc: 'Fix door', amount: 100 }]), Subtotal: '100', Status: 'Approved', Active: 'TRUE' }],
    scopes: [Object.assign({ ID: '9', Property_ID: '58', WO_ID: '', Line_Items: JSON.stringify(ITEM), Source_Refs: '[]' }, archived)],
  });
  const fns = build(db, newCalls());
  const prev = await (await fns.woPushToScope(env, { wo_id: 'WO-3', estimate_id: 'E3' })).json();
  t('preview over a stale archived link says will_create (not "append")', prev.target.will_create === true && prev.target.stale_scope_link === '9');
  const push = await (await fns.woPushToScope(env, { wo_id: 'WO-3', estimate_id: 'E3', apply: true })).json();
  t('apply over a stale archived link creates a new scope and never touches the archived one', push.success && push.created_new_scope === true && push.scope_id !== '9' && JSON.parse(scF(db, '9', 'Line_Items')).length === 1 && JSON.parse(scF(db, push.scope_id, 'Line_Items')).length === 1);
}
// an ACTIVE linked scope still gets the append (existing behavior unchanged)
{
  const db = makeDb({
    wos: [{ ID: 'WO-4', Property_ID: '58', Vendor_ID: '7', Scope_ID: '9' }],
    ests: [{ ID: 'E4', WO_ID: 'WO-4', Version: '1', Line_Items: JSON.stringify([{ desc: 'Fix door', amount: 100 }]), Subtotal: '100', Status: 'Approved', Active: 'TRUE' }],
    scopes: [{ ID: '9', Property_ID: '58', WO_ID: 'WO-4', Line_Items: JSON.stringify(ITEM), Source_Refs: '[]', Active: 'TRUE' }],
  });
  const push = await (await build(db, newCalls()).woPushToScope(env, { wo_id: 'WO-4', estimate_id: 'E4', apply: true })).json();
  t('an active linked scope is still appended to', push.success && push.created_new_scope === false && push.scope_id === '9' && JSON.parse(scF(db, '9', 'Line_Items')).length === 2);
}
// approveEstimate must 409 on a Converted latest estimate (the "Approve (no proposal)" path)
{
  const db = world(); const calls = newCalls(); const fns = build(db, calls);
  const res = await fns.approveEstimate(env, { wo_id: 'WO-1222', approved_by: 'admin' });
  const b = await res.json();
  t('approve on a Converted estimate -> 409 naming the scope', res.status === 409 && /Scope Proposal #9/.test(b.error) && b.converted_scope_id === '9');
  t('it stays Converted (not flipped back to Approved) and nobody is texted', estF(db, 'E1', 'Status') === 'Converted' && calls.notify.length === 0);
  const db2 = world(); db2.Estimates.rows[0][EST_HEADERS.indexOf('Status')] = 'Pending'; db2.Estimates.rows[0][EST_HEADERS.indexOf('Converted_Scope_ID')] = '';
  const res2 = await build(db2, newCalls()).approveEstimate(env, { wo_id: 'WO-1222', approved_by: 'admin' });
  t('approve on a Pending estimate still works', res2.status === 200 && estF(db2, 'E1', 'Status') === 'Approved');
}
// the existing already_converted idempotent no-op is unchanged
{
  const db = world();
  const b = await (await build(db, newCalls()).woPushToScope(env, { wo_id: 'WO-1222', estimate_id: 'E1', apply: true })).json();
  t('a second push of an already-Converted estimate is still the idempotent no-op', b.success === true && b.already_converted === true && b.scope_id === '9');
}

console.log('\nStructure / wiring\n');
{
  const fn = scopeReturnToWOSrc.replace(/\/\/.*$/gm, '');
  t('exactly one vendor-SMS call, and only AFTER the verification step', (fn.match(/notifyVendorTemplated\(/g) || []).length === 1 && fn.indexOf('notifyVendorTemplated(') > fn.indexOf('Verification failed'));
  t('the SMS call is guarded by request_info', /if \(requestInfo\) \{\s*try \{\s*const r = await notifyVendorTemplated/.test(fn));
  t('uses the same template flagEstimate uses', fn.includes("'vendor_estimate_needs_info'") && grab('async function flagEstimate(').includes("'vendor_estimate_needs_info'"));
  t('no swallowing catch (empty catch / .catch(()=>{}))', !/catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/.test(fn) && !/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(fn));
  t('Work Order Status and Vendor_ID are never written', !/Status:\s*'(Cancelled|Declined)'/.test(fn) && !/updateWOFields\(env, woId, \{[^}]*Vendor_ID/.test(fn));
  t('logs with Job_Type scope_return_to_wo', fn.includes("Job_Type: 'scope_return_to_wo'"));
  const prod = wsrc.match(/const HUB_PROD_WRITE_PATHS = \[[^\]]*\]/)[0];
  t('route is NOT in HUB_PROD_WRITE_PATHS', !prod.includes('/scope/return-to-wo'));
  t('route is dispatched to scopeReturnToWO', /path === '\/scope\/return-to-wo'\)\s*return await scopeReturnToWO\(env, body\)/.test(wsrc));
  const rs = wsrc.slice(wsrc.indexOf('const ROLE_SCOPES = {'), wsrc.indexOf('const ROLE_SCOPES = {') + 6000);
  t('admin-only: no ROLE_SCOPES entry mentions the route', !/return-to-wo/.test(wsrc.slice(wsrc.indexOf('const ROLE_SCOPES = {'), wsrc.indexOf('\n};', wsrc.indexOf('const ROLE_SCOPES = {')))));
  void rs;
  t('BUILD_VERSION bumped for this feature', /const BUILD_VERSION = '2026-10-05\.\d+-scope-return-to-wo'/.test(wsrc));
}
// hubTestWriteAllowed branch (staging TEST- records only)
{
  const hubSrc = grab('async function hubTestWriteAllowed(');
  const markerSrc = grabRange('const TEST_MARKER_FIELD = {', '\n};') + '\n};';
  const isTestRecordSrc = grab('async function isTestRecord(');
  const mk = (props, vendors, scopes, wos) => {
    const db = {
      Properties: tab(['ID', 'Access_Notes'], props), Vendors: tab(['ID', 'Name'], vendors), Scopes: tab(SCOPES_HEADERS_ARR, scopes), Work_Orders: tab(WO_HEADERS, wos),
    };
    const src = ['const CORS = {};', cacheSrc, srSrc, ensureColumnsSrc, ensureColumnsInnerSrc, ensureTabSrc, idcSrc, colSrc, jsonSrc, isMissingTabErrorSrc, missingTabResponseSrc, fetchTabSrc, findWOSrc, markerSrc, isTestRecordSrc, hubSrc, 'return hubTestWriteAllowed;'].join('\n');
    return new Function('getAccessToken', 'fetch', 'setTimeout', src)(async () => 'tok', makeFetch(db), fn => fn());
  };
  const okP = [{ ID: '1', Access_Notes: 'TEST-PROPERTY-001' }], realP = [{ ID: '2', Access_Notes: 'gate code 1234' }];
  const okV = [{ ID: '5', Name: 'TEST-Vendor' }], realV = [{ ID: '6', Name: 'Real Vendor' }];
  t('staging token may exercise a scope on a TEST- property (no SMS)', await mk(okP, okV, [{ ID: '9', Property_ID: '1', WO_ID: 'WO-1' }], [{ ID: 'WO-1', Vendor_ID: '6' }])(env, '/scope/return-to-wo', { scope_id: '9' }) === true);
  t('...but never a scope on a real property', await mk(realP, okV, [{ ID: '9', Property_ID: '2', WO_ID: 'WO-1' }], [{ ID: 'WO-1', Vendor_ID: '5' }])(env, '/scope/return-to-wo', { scope_id: '9' }) === false);
  t('...never an unknown scope', await mk(okP, okV, [], [])(env, '/scope/return-to-wo', { scope_id: '9' }) === false);
  t('request_info:true needs a TEST- vendor on the WO', await mk(okP, okV, [{ ID: '9', Property_ID: '1', WO_ID: 'WO-1' }], [{ ID: 'WO-1', Vendor_ID: '6' }])(env, '/scope/return-to-wo', { scope_id: '9', request_info: true }) === false);
  t('request_info:true with a TEST- vendor is allowed', await mk(okP, okV, [{ ID: '9', Property_ID: '1', WO_ID: 'WO-1' }], [{ ID: 'WO-1', Vendor_ID: '5' }])(env, '/scope/return-to-wo', { scope_id: '9', request_info: true }) === true);
}

console.log('\nUI wiring (index.html / scope-creator.html)\n');
{
  const rv = idxHtml.slice(idxHtml.indexOf('function renderHubEstimateView('), idxHtml.indexOf('function retranslateEstimateUI('));
  t('estimate panel shows "Sent to Scope Proposal #N" for a Converted estimate', rv.includes("var isConverted = current.Status === 'Converted'") && rv.includes('Sent to Scope Proposal #'));
  t('Approve / Needs more info / Decline sit ONLY in the non-Converted branch', rv.indexOf('var approvalBlock = isConverted') >= 0 && rv.indexOf('var approvalBlock = isConverted') < rv.indexOf('approveEstimateUI(') && rv.indexOf('var approvalBlock = isConverted') < rv.indexOf('estimateNeedsInfoUI(') && rv.indexOf('var approvalBlock = isConverted') < rv.indexOf('estimateDeclineUI('));
  t('the Converted branch itself contains none of those buttons', (() => { const a = rv.indexOf('var approvalBlock = isConverted'); const b = rv.indexOf(': isApproved', a); const seg = rv.slice(a, b); return !/approveEstimateUI|estimateNeedsInfoUI|estimateDeclineUI|openPushToScopeUI/.test(seg); })());
  t('"Return to work order" button next to "Open Scope #N", wired to openReturnToWOUI(woId, scopeId)', rv.includes('↩ Return to work order') && /openReturnToWOUI\(\\'' \+ woId \+ '\\', \\'' \+ esc\(/.test(rv) && rv.indexOf('Open Scope #') < rv.indexOf('↩ Return to work order'));
  t('tap target >= 44px on the new button', /min-height:44px[^"]*"[^>]*onclick="openReturnToWOUI/.test(rv));
  const fnSrc = idxHtml.slice(idxHtml.indexOf('function openReturnToWOUI('), idxHtml.indexOf('// Approve flow — hub-only action'));
  t('preview call first (apply:false), then apply:true', fnSrc.indexOf("apply: false") >= 0 && fnSrc.indexOf('apply: true') > fnSrc.indexOf('apply: false') && (fnSrc.match(/'\/scope\/return-to-wo'/g) || []).length === 2);
  t('blockers are shown instead of the confirm (button hidden)', /res\.blockers/.test(fnSrc) && fnSrc.includes("btn.style.display = 'none'"));
  t('checkbox "Also text the vendor asking for more info" is UNCHECKED by default', fnSrc.includes('Also text the vendor asking for more info') && /<input type="checkbox" id="rtw-info"[^>]*>/.test(fnSrc) && !/id="rtw-info"[^>]*checked/.test(fnSrc));
  t('request_info comes from the checkbox', fnSrc.includes('request_info: ask') && fnSrc.includes("document.getElementById('rtw-info')"));
  t('a vendor-text failure is surfaced (toast error), never silent', fnSrc.includes('vendor NOT texted') && fnSrc.includes("bad ? 'error' : 'success'"));
  t('reloads the WO after success (loadAll then openWODetail)', fnSrc.includes('loadAll()') && fnSrc.includes('openWODetail(woId)'));
  t('modal exists with 44px buttons', idxHtml.includes('id="modal-return-to-wo"') && /id="rtw-confirm" style="min-height:44px"/.test(idxHtml));
  t('index.html still supports ?wo= deep links', idxHtml.includes("qs.get('wo')") && idxHtml.includes('openWODetail(wid)'));

  t('scope-creator: pill label "Returned to WO"', scHtml.includes("'returned-to-wo':'Returned to WO'"));
  t('scope-creator: header button next to the status pill, 44px, hidden by default', /id="ed-status-pill"><\/span> <button[^>]*id="ed-return-btn"[^>]*hide[^>]*min-height:44px|id="ed-return-btn"[^>]*min-height:44px/.test(scHtml) && scHtml.includes('onclick="openReturnToWO()"'));
  const sfn = scHtml.slice(scHtml.indexOf('function renderReturnBtn('), scHtml.indexOf('// Editable at any time'));
  t('scope-creator: button shown only for non-signed scopes with a WO_ID', sfn.includes("String(s.WO_ID||'').trim()") && ["signed", "invoiced", "ready-to-bill", "fully-invoiced", "returned-to-wo"].every(x => sfn.includes("'" + x + "'")));
  t('scope-creator: uses the existing post() helper, preview then apply', (sfn.match(/post\('\/scope\/return-to-wo'/g) || []).length === 2 && sfn.indexOf('apply:false') < sfn.indexOf('apply:true'));
  t('scope-creator: vendor checkbox unchecked by default, request_info from it', /<input type="checkbox" id="rtw-info"[^>]*>/.test(sfn) && !/id="rtw-info"[^>]*checked/.test(sfn) && sfn.includes('request_info:ask'));
  t('scope-creator: lands on index.html?wo=<WO id> and alerts on a vendor-text failure', sfn.includes("location.href = r.wo_url") && sfn.includes("index.html?wo=") && sfn.includes('alert('));
  t('scope-creator: renderEditor calls renderReturnBtn', /statusPill\(s\.Status\);\s*renderReturnBtn\(\);/.test(scHtml));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
