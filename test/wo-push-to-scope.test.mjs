// WO -> Scope Proposal conversion (Sep 18 2026, worker.js: scopeItemsFromEstimate, woPushToScope,
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

// ── Pure mapping helper, tested in isolation first (no Sheets involved) ─────────────────────
const scopeItemsFromEstimate = new Function(grab('function scopeItemsFromEstimate(') + '\nreturn scopeItemsFromEstimate;')();

console.log('scopeItemsFromEstimate — pure mapping tests\n');
{
  const items = scopeItemsFromEstimate([{ desc: 'Dirt and trash removal', amount: 300 }, { desc: 'Sod installation', amount: 200 }], []);
  t('maps every estimate line to a scope item', items.length === 2);
  t('description carried through verbatim', items[0].description === 'Dirt and trash removal');
  t('amount becomes the single variant\'s vendor_cost', items[0].variants.length === 1 && items[0].variants[0].vendor_cost === 300);
  t('fresh ids start at li1 on an empty scope', items[0].id === 'li1' && items[1].id === 'li2');
  t('price_override starts null (never invented)', items[0].variants[0].price_override === null);
  t('selected_key auto-set to the single variant', items[0].selected_key === 'v1');
}
{
  // Appending onto a scope that already has li1/li2 must never collide with those ids.
  const existing = [{ id: 'li1', description: 'existing item' }, { id: 'li2', description: 'another' }];
  const items = scopeItemsFromEstimate([{ desc: 'New estimate line', amount: 100 }], existing);
  t('new items continue the id sequence past what already exists', items[0].id === 'li3');
}
{
  // A blank/whitespace-only description is dropped, mirroring scopeCleanItems' own rule.
  const items = scopeItemsFromEstimate([{ desc: '  ', amount: 50 }, { desc: 'Real item', amount: 75 }], []);
  t('blank-description lines are dropped, not turned into empty items', items.length === 1 && items[0].description === 'Real item');
}
{
  const items = scopeItemsFromEstimate([{ desc: 'Negative typo', amount: -40 }], []);
  t('a negative amount never produces a negative vendor_cost', items[0].variants[0].vendor_cost === 0);
}
{
  t('no line items at all maps to an empty array, not a crash', scopeItemsFromEstimate([], []).length === 0);
  t('a non-array input maps to an empty array', scopeItemsFromEstimate(null, []).length === 0);
}

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
const EST_HEADERS = ['ID', 'WO_ID', 'Vendor_ID', 'Version', 'Line_Items', 'Subtotal', 'Change_Reason', 'Created_By', 'Created_Date', 'Status', 'Approved_By', 'Approved_Date', 'Converted_Scope_ID', 'Converted_Date', 'Active'];

function makeDb(woRows, estRows, scopeRows) {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: (woRows || []).map(r => WO_HEADERS.map(h => r[h] ?? '')) },
    Estimates: { headers: EST_HEADERS.slice(), rows: (estRows || []).map(r => EST_HEADERS.map(h => r[h] ?? '')) },
    Scopes: { headers: SCOPES_HEADERS_ARR.slice(), rows: (scopeRows || []).map(r => SCOPES_HEADERS_ARR.map(h => r[h] ?? '')) },
  };
}

function makeFetch(db) {
  return async (url, opts) => {
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
    updateWOFieldsSrc, scopesHeadersSrc, scopeParseItemsSrc, scopeItemsFromEstimateSrc, scopesTabSrc,
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

console.log('\nPOST /wo/push-to-scope — offline endpoint tests\n');
const env = { SHEET_ID: 'S' };

// ── gating ───────────────────────────────────────────────────────────────────────────────────
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58' }], [], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, {});
  const body = await res.json();
  t('wo_id required', res.status === 400 && /wo_id required/.test(body.error));
}
{
  const db = makeDb([], [], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-9999' });
  t('404s on an unknown WO', res.status === 404);
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58', Voided: 'TRUE' }], [], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1' });
  const body = await res.json();
  t('refuses a voided WO', res.status === 409 && /voided/i.test(body.error));
}
{
  const db = makeDb([{ ID: 'WO-1', Property_ID: '58' }], [], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1' });
  const body = await res.json();
  t('a WO with zero estimates at all is refused', res.status === 400 && /no estimates yet/i.test(body.error));
}
{
  // WO-1186's real live shape: two PENDING (unapproved) estimate versions, zero approved.
  const db = makeDb(
    [{ ID: 'WO-1186', Property_ID: '58', Vendor_ID: '6' }],
    [
      { ID: '1', WO_ID: 'WO-1186', Vendor_ID: '6', Version: '1', Line_Items: JSON.stringify([{ desc: 'Dirt and trash removal sod installation', amount: 500 }]), Subtotal: '500', Status: 'Pending', Active: 'TRUE' },
      { ID: '2', WO_ID: 'WO-1186', Vendor_ID: '6', Version: '2', Line_Items: JSON.stringify([{ desc: 'Dirt and trash removal sod & soil installation', amount: 500 }]), Subtotal: '500', Status: 'Pending', Active: 'TRUE' },
    ], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1186' });
  const body = await res.json();
  t('zero approved estimates -> a clear 400, never a guess', res.status === 400 && /no APPROVED estimate/.test(body.error));
}
{
  // Two approved versions (a real possible data state — approveEstimate only ever touches the
  // LATEST version, so an older approved row can survive a later approval) is also refused.
  const db = makeDb(
    [{ ID: 'WO-2', Property_ID: '58' }],
    [
      { ID: '10', WO_ID: 'WO-2', Version: '1', Line_Items: '[{"desc":"a","amount":100}]', Subtotal: '100', Status: 'Approved', Active: 'TRUE' },
      { ID: '11', WO_ID: 'WO-2', Version: '2', Line_Items: '[{"desc":"b","amount":150}]', Subtotal: '150', Status: 'Approved', Active: 'TRUE' },
    ], []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-2' });
  const body = await res.json();
  t('two approved versions -> refused, not a guess at which one', res.status === 400 && /2 estimate versions marked Approved/.test(body.error));
}

// ── preview: creates a NEW scope (no Work_Orders.Scope_ID yet) ──────────────────────────────
{
  const db = makeDb(
    [{ ID: 'WO-3', Property_ID: '58', Unit_ID: '', Vendor_ID: '6' }],
    [{ ID: '20', WO_ID: 'WO-3', Vendor_ID: '6', Version: '1', Line_Items: JSON.stringify([{ desc: 'Dirt removal', amount: 300 }, { desc: 'Sod install', amount: 200 }]), Subtotal: '500', Status: 'Approved', Active: 'TRUE' }],
    []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-3', estimate_id: '20' });
  const body = await res.json();
  t('preview (apply omitted) never writes', body.applied === false);
  t('preview says a new scope will be created', body.target.will_create === true);
  t('preview maps both line items', body.mapped_items.length === 2 && body.mapped_items[0].description === 'Dirt removal');
  t('nothing was actually written to Estimates on preview', estField('Status', estRow(db, '20')) === 'Approved');
  t('nothing was actually written to Scopes on preview', db.Scopes.rows.length === 0);
}

// ── apply: creates a new scope, links it back onto the WO, converts the estimate ────────────
{
  const db = makeDb(
    [{ ID: 'WO-1186', Property_ID: '58', Unit_ID: '', Room: '', Vendor_ID: '6', Description: 'Yard cleanup' }],
    [{ ID: '30', WO_ID: 'WO-1186', Vendor_ID: '6', Version: '2', Line_Items: JSON.stringify([{ desc: 'Dirt and trash removal sod & soil installation', amount: 500 }]), Subtotal: '500', Status: 'Approved', Active: 'TRUE' }],
    []);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1186', estimate_id: '30', apply: true });
  const body = await res.json();
  t('apply reports success', body.success === true && body.applied === true);
  t('a brand-new scope was created', body.created_new_scope === true && !!body.scope_id);
  const wo = woRow(db, 'WO-1186');
  t('Work_Orders.Scope_ID is set to the new scope', woField('Scope_ID', wo) === body.scope_id);
  const sc = scopeRow(db, body.scope_id);
  t('the new Scope carries the WO_ID back-link', scopeField('WO_ID', sc) === 'WO-1186');
  t('Property_ID/Vendor_ID copied from the WO', scopeField('Property_ID', sc) === '58' && scopeField('Vendor_ID', sc) === '6');
  const items = JSON.parse(scopeField('Line_Items', sc));
  t('the estimate\'s line item landed on the new scope', items.length === 1 && items[0].description === 'Dirt and trash removal sod & soil installation' && items[0].variants[0].vendor_cost === 500);
  const est = estRow(db, '30');
  t('the estimate flips to Converted', estField('Status', est) === 'Converted');
  t('the estimate records which scope it became', estField('Converted_Scope_ID', est) === body.scope_id);
  t('the estimate records a Converted_Date', !!estField('Converted_Date', est));
}

// ── apply: WO already has a Scope_ID -> APPEND, never clobber/duplicate ─────────────────────
{
  const existingItems = [{ id: 'li1', area: 'Kitchen', trade: 'Plumbing', description: 'Hand-added item Brett typed himself', qty: '', note: '', variants: [{ key: 'v1', label: '', vendor_cost: 999, price_override: null }], selected_key: 'v1' }];
  const db = makeDb(
    [{ ID: 'WO-1186', Property_ID: '58', Vendor_ID: '6', Scope_ID: '7' }],
    [{ ID: '31', WO_ID: 'WO-1186', Vendor_ID: '6', Version: '1', Line_Items: JSON.stringify([{ desc: 'New estimate line', amount: 250 }]), Subtotal: '250', Status: 'Approved', Active: 'TRUE' }],
    [{ ID: '7', Property_ID: '58', WO_ID: 'WO-1186', Title: 'Scope #7', Line_Items: JSON.stringify(existingItems), Source_Refs: '[]', Active: 'TRUE' }]);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-1186', estimate_id: '31', apply: true });
  const body = await res.json();
  t('reuses the existing scope rather than creating a new one', body.created_new_scope === false && body.scope_id === '7');
  const sc = scopeRow(db, '7');
  const items = JSON.parse(scopeField('Line_Items', sc));
  t('the hand-added item is still there, untouched', items.some(i => i.description === 'Hand-added item Brett typed himself'));
  t('the estimate item was APPENDED, not a replace', items.length === 2 && items.some(i => i.description === 'New estimate line'));
  const srcs = JSON.parse(scopeField('Source_Refs', sc));
  t('Source_Refs records which estimate id/version was converted (the idempotency key)', srcs.some(r => r.type === 'estimate' && r.estimate_id === '31' && r.version === '1'));
}

// ── idempotency: pushing the SAME already-converted estimate again is a no-op, not a duplicate ──
{
  const db = makeDb(
    [{ ID: 'WO-9', Property_ID: '58' }],
    [{ ID: '40', WO_ID: 'WO-9', Version: '1', Line_Items: '[{"desc":"x","amount":100}]', Subtotal: '100', Status: 'Converted', Converted_Scope_ID: '99', Converted_Date: '2026-09-18T00:00:00.000Z', Active: 'TRUE' }],
    [{ ID: '99', Property_ID: '58', WO_ID: 'WO-9', Line_Items: '[{"id":"li1","description":"x","variants":[{"key":"v1","vendor_cost":100}],"selected_key":"v1"}]', Source_Refs: JSON.stringify([{ type: 'estimate', estimate_id: '40', version: '1' }]), Active: 'TRUE' }]);
  const { woPushToScope } = build(db);
  const res = await woPushToScope(env, { wo_id: 'WO-9', estimate_id: '40', apply: true });
  const body = await res.json();
  t('a second push of an already-converted estimate reports success', body.success === true && body.already_converted === true);
  t('it reports the scope it was already converted to', body.scope_id === '99');
  const sc = scopeRow(db, '99');
  const items = JSON.parse(scopeField('Line_Items', sc));
  t('nothing was appended a second time — item count unchanged', items.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
