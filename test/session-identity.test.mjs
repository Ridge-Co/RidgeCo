// Session identity binding + file/500 hardening (Oct 14 2026, Brett: "fix them").
// Drives the REAL worker.js default export (router and all) over a fake Google Sheets, with real signed
// session tokens, so this proves the behaviour a tenant/owner/vendor would actually get - not a copy.
//   1. A role session may only name ITS OWN id (?tenant_id= / ?owner_id= / ?vendor_id= / body.*_id);
//      anything else is a 403 and a failed Ops_Telemetry row.
//   2. On GET the session id is forced into the query, so omitting the param can't widen the result.
//   3. GETs naming a wo_id (/estimates /time-entries /receipts /vendor-bills /nearby-wos /wo-audit) need a
//      job this session may see (same attachmentScopeAllows as /attachments); generic 404 + telemetry.
//   4. /vendor-file/view needs the same access to the WO as /attachments.
//   5. A 500 is logged with a ref; only the admin secret / staging test token get message+stack back.
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const tick = (ms) => new Promise(r => setTimeout(r, ms));

function makeStore() {
  const tabs = new Map();           // name -> array of row arrays
  const calls = [];
  const st = { tabs, calls, latency: () => 0, failNext: null, failWhen: null };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {   // path relative to /spreadsheets/{id}
    calls.push(method + ' ' + path);
    const lat = st.latency(); if (lat) await tick(lat);
    if (st.failWhen && st.failWhen(method, path, body)) return { error: { code: 500, message: 'injected sheets failure' } };
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) {
      const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name);
      return { range: name, values: tabs.get(name).map(r => r.slice()) };
    }
    if (method === 'GET' && (m = /^\/values:batchGet\?(.*)$/.exec(path))) {
      const names = m[1].split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, '')));
      const valueRanges = [];
      for (const name of names) { if (!tabs.has(name)) return missing(name); valueRanges.push({ range: name, values: tabs.get(name).map(r => r.slice()) }); }
      return { valueRanges };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 60, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) {
      const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name);
      for (const r of body.values) tabs.get(name).push(r.slice());
      return { updates: { updatedRows: body.values.length } };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
        const col = mm[1].split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]);
        while (rows[row].length <= col) rows[row].push('');
        rows[row][col] = d.values[0][0];
      }
      return { totalUpdatedCells: body.data.length };
    }
    if (method === 'POST' && path === ':batchUpdate') {
      for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []);
      return {};
    }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  st.cfg = () => Object.fromEntries((tabs.get('Config') || []).filter(r => r[0]).map(r => [r[0], r[1] || '']));
  st.setCfg = (k, v) => { const rows = tabs.get('Config'); const i = rows.findIndex(r => r[0] === k); if (i >= 0) rows[i][1] = v; else rows.push([k, v]); };
  tabs.set('Config', [['Key', 'Value']]);
  return st;
}

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
const outbound = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) {
    const b = init && init.body ? JSON.parse(init.body) : undefined;
    const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b);
    return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 });
  }
  outbound.push(method + ' ' + url);
  if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) return new Response('FILE-BYTES', { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET };
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;   // defeat the 6s tab cache between calls
const call = async (method, path, token, body) => {
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) {}
  return { status: res.status, json: j, text };
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mint = (role, id) => { const now = Math.floor(Date.now() / 1000); const body = b64u(JSON.stringify({ role, id, iat: now, exp: now + 3600 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);

const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Tenant_ID', 'Status', 'Voided', 'Tenant_Visible', 'Type', 'Created_Date', 'Trade', 'Description', 'Parent_WO_ID', 'Duplicated_From', 'Bid_Group_ID'];
tab('Work_Orders', WOH, [
  { ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Status: 'Assigned', Created_Date: '2026-10-01', Trade: 'Plumbing', Description: 'leak one' },
  { ID: 'WO-2', Property_ID: 'P2', Unit_ID: 'U2', Vendor_ID: 'V2', Status: 'Assigned', Created_Date: '2026-10-02', Trade: 'HVAC', Description: 'unit two' },
]);
tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: 'P1', Owner_ID: 'O1', Address: '1 Main', Active: 'TRUE' }, { ID: 'P2', Owner_ID: 'O2', Address: '2 Oak', Active: 'TRUE' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Tenant_ID'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '1A', Tenant_ID: 'T1' }, { ID: 'U2', Property_ID: 'P2', Unit_Label: '2A', Tenant_ID: 'T2' }]);
tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'Move_In_Date'], [
  { ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE', First_Name: 'Tam', Move_In_Date: '2025-01-01' },
  { ID: 'T2', Property_ID: 'P2', Unit_ID: 'U2', Active: 'TRUE', First_Name: 'Tia', Move_In_Date: '2025-01-01' }]);
tab('Keys', ['ID', 'Property_ID', 'Unit_ID'], []);
tab('Vendors', ['ID', 'Name', 'Phone', 'Email', 'Company', 'Active'], [{ ID: 'V1', Name: 'Vee One', Phone: '4105550001', Active: 'TRUE' }, { ID: 'V2', Name: 'Vee Two', Phone: '4105550002', Active: 'TRUE' }]);
tab('Owners', ['ID', 'First_Name', 'Last_Name', 'Notify_Method', 'Notify_Urgent', 'Billing_Name'], [{ ID: 'O1', First_Name: 'Olly', Notify_Method: 'sms' }, { ID: 'O2', First_Name: 'Ola', Notify_Method: 'sms' }]);
tab('Master_Keys', ['ID'], []); tab('Master_Key_Holders', ['ID'], []);
tab('Attachments', ['WO_ID', 'File_Type', 'File_Name', 'Drive_File_ID', 'Drive_URL', 'Active', 'Mime_Type'], [
  { WO_ID: 'WO-1', File_Type: 'receipt', File_Name: 'r1.jpg', Drive_File_ID: 'F1', Active: 'TRUE', Mime_Type: 'image/jpeg' },
  { WO_ID: 'WO-2', File_Type: 'receipt', File_Name: 'r2.jpg', Drive_File_ID: 'F2', Active: 'TRUE', Mime_Type: 'image/jpeg' }]);
tab('Vendor_Bills', ['ID', 'WO_ID', 'Vendor_ID', 'Active', 'Status'], [
  { ID: 'B1', WO_ID: 'WO-1', Vendor_ID: 'V1', Active: 'TRUE', Status: 'submitted' }, { ID: 'B2', WO_ID: 'WO-2', Vendor_ID: 'V2', Active: 'TRUE', Status: 'submitted' }]);
tab('Receipts', ['ID', 'WO_ID', 'Role', 'Added_By_ID', 'Active', 'Amount', 'Created_Date'], [
  { ID: 'R1', WO_ID: 'WO-1', Role: 'vendor', Added_By_ID: 'V1', Active: 'TRUE', Amount: '5' }, { ID: 'R2', WO_ID: 'WO-2', Role: 'vendor', Added_By_ID: 'V2', Active: 'TRUE', Amount: '9' }]);
tab('Time_Entries', ['ID', 'WO_ID', 'Role', 'Entered_By_ID', 'Active', 'Hours'], [
  { ID: 'TE1', WO_ID: 'WO-1', Role: 'vendor', Entered_By_ID: 'V1', Active: 'TRUE', Hours: '1' }, { ID: 'TE9', WO_ID: 'WO-1', Role: 'admin', Entered_By_ID: 'ADMIN', Active: 'TRUE', Hours: '2' }]);
tab('Estimates', ['ID', 'WO_ID', 'Version', 'Active', 'Line_Items'], [{ ID: 'E1', WO_ID: 'WO-1', Version: '1', Active: 'TRUE', Line_Items: '[]' }, { ID: 'E2', WO_ID: 'WO-2', Version: '1', Active: 'TRUE', Line_Items: '[]' }]);
tab('WO_Audit', ['WO_ID', 'Timestamp', 'Action'], [{ WO_ID: 'WO-1', Timestamp: '2026-10-01T00:00:00Z', Action: 'created' }, { WO_ID: 'WO-2', Timestamp: '2026-10-02T00:00:00Z', Action: 'created' }]);
tab('Config', ['Key', 'Value'], []);

const tele = (job) => (store.tabs.get('Ops_Telemetry') || []).slice(1).filter(r => (store.tabs.get('Ops_Telemetry')[0] || []).indexOf('Job_Type') >= 0 && r[store.tabs.get('Ops_Telemetry')[0].indexOf('Job_Type')] === job);
const teleLast = (job) => { const rows = tele(job), h = store.tabs.get('Ops_Telemetry')[0]; const r = rows[rows.length - 1]; return r ? Object.fromEntries(h.map((k, i) => [k, r[i]])) : null; };
const ids = (j) => (Array.isArray(j) ? j : []).map(x => x.ID || x.WO_ID);

const TEN1 = mint('tenant', 'T1'), OWN1 = mint('owner', 'O1'), VEN1 = mint('vendor', 'V1');

// ── 0. the admin secret is unchanged ────────────────────────────────────────────────────────────
{
  const a = await call('GET', '/tenant-workorders?tenant_id=T2&include_closed=true', SECRET);
  t('admin: /tenant-workorders for ANY tenant still works', a.status === 200 && ids(a.json).join() === 'WO-2', a);
  const b = await call('GET', '/vendor-workorders?vendor_id=V2&include_closed=true', SECRET);
  t('admin: /vendor-workorders for ANY vendor still works', b.status === 200 && ids(b.json).join() === 'WO-2', b.json && b.json.length);
  const c = await call('GET', '/vendor-bills?status=submitted', SECRET);
  t('admin: /vendor-bills?status= still returns every vendor\'s bills', c.status === 200 && c.json.length === 2, c);
  const d = await call('GET', '/estimates?wo_id=WO-2', SECRET);
  t('admin: wo_id reads are not scoped', d.status === 200 && d.json.length === 1);
}

// ── 1. tenant ──────────────────────────────────────────────────────────────────────────────────
{
  const own = await call('GET', '/tenant-workorders?tenant_id=T1&include_closed=true', TEN1);
  t('tenant: own id -> own jobs only', own.status === 200 && ids(own.json).join() === 'WO-1', own);
  const other = await call('GET', '/tenant-workorders?tenant_id=T2&include_closed=true', TEN1);
  t('tenant: someone else\'s id -> 403, no data', other.status === 403 && other.json.error === 'Forbidden' && !/WO-2|unit two/.test(other.text), other);
  const r = teleLast('session_identity_mismatch');
  t('tenant: the attempt is a FAILED Ops_Telemetry row naming role, session, param and value', r && r.Success === 'FALSE' && r.Skill_Or_Endpoint === '/tenant-workorders' && /role=tenant session=T1 sent tenant_id=T2/.test(r.Notes), r);
  const none = await call('GET', '/tenant-workorders?include_closed=true', TEN1);
  t('tenant: omitting the id returns OWN jobs (forced from the token), not a 400 and not everything', none.status === 200 && ids(none.json).join() === 'WO-1', none);
}

// ── 2. owner ───────────────────────────────────────────────────────────────────────────────────
{
  const own = await call('GET', '/owner-workorders?owner_id=O1&include_closed=true', OWN1);
  t('owner: own id -> own jobs only', own.status === 200 && ids(own.json).join() === 'WO-1', own);
  for (const p of ['/owner-workorders?owner_id=O2', '/owner-properties?owner_id=O2', '/owner-notifications?owner_id=O2', '/owner/get-billing?owner_id=O2']) {
    const r = await call('GET', p, OWN1);
    t(`owner: ${p} -> 403`, r.status === 403 && r.json.error === 'Forbidden', r);
  }
  const props = await call('GET', '/owner-properties', OWN1);
  t('owner: omitting owner_id on /owner-properties returns OWN properties only', props.status === 200 && props.json.length === 1 && props.json[0].ID === 'P1', props);
  const before = JSON.stringify(store.tabs.get('Owners'));
  const post = await call('POST', '/owner/notifications', OWN1, { owner_id: 'O2', method: 'email' });
  t('owner: POST body owner_id of another owner -> 403 and nothing written', post.status === 403 && JSON.stringify(store.tabs.get('Owners')) === before, post);
  const audit2 = await call('GET', '/wo-audit?wo_id=WO-2', OWN1);
  t('owner: /wo-audit of another owner\'s job -> generic 404', audit2.status === 404 && audit2.json.error === 'Not found', audit2);
  const audit1 = await call('GET', '/wo-audit?wo_id=WO-1', OWN1);
  t('owner: /wo-audit of own job still works', audit1.status === 200 && audit1.json.length === 1, audit1);
}

// ── 3. vendor ──────────────────────────────────────────────────────────────────────────────────
{
  const own = await call('GET', '/vendor-workorders?vendor_id=V1&include_closed=true', VEN1);
  t('vendor: own id -> own jobs only', own.status === 200 && ids(own.json).join() === 'WO-1', own.json && own.json.length);
  const other = await call('GET', '/vendor-workorders?vendor_id=V2&include_closed=true', VEN1);
  t('vendor: another vendor\'s id -> 403', other.status === 403, other.status);
  const nobills = await call('GET', '/vendor-bills?status=submitted', VEN1);
  t('vendor: /vendor-bills?status= with NO vendor_id returns only own bills (used to return everyone\'s)', nobills.status === 200 && nobills.json.length === 1 && nobills.json[0].ID === 'B1', nobills);
  t('vendor: /vendor-bills?vendor_id=V2 -> 403', (await call('GET', '/vendor-bills?vendor_id=V2', VEN1)).status === 403);
  const rcOther = await call('GET', '/receipts?wo_id=WO-2&vendor_id=V1', VEN1);
  t('vendor: another vendor\'s job receipts -> 404 even with own vendor_id', rcOther.status === 404, rcOther);
  const rcOwn = await call('GET', '/receipts?wo_id=WO-1', VEN1);
  t('vendor: own job receipts (no vendor_id sent) -> own rows', rcOwn.status === 200 && rcOwn.json.length === 1 && rcOwn.json[0].ID === 'R1', rcOwn);
  t('vendor: another vendor\'s estimates -> 404', (await call('GET', '/estimates?wo_id=WO-2', VEN1)).status === 404);
  const estOwn = await call('GET', '/estimates?wo_id=WO-1', VEN1);
  t('vendor: own job estimates still work', estOwn.status === 200 && estOwn.json.length === 1, estOwn);
  const te = await call('GET', '/time-entries?wo_id=WO-1', VEN1);
  t('vendor: time entries on own job without vendor_id are still only the vendor\'s own', te.status === 200 && Array.isArray(te.json) && te.json.length === 1 && te.json[0].ID === 'TE1', te);
  t('vendor: /nearby-wos for another vendor\'s job -> 404', (await call('GET', '/nearby-wos?wo_id=WO-2', VEN1)).status === 404);
  const before = JSON.stringify(store.tabs.get('Vendors'));
  const post = await call('POST', '/vendor/update-contact', VEN1, { vendor_id: 'V2', phone: '4105559999' });
  t('vendor: POST body vendor_id of another vendor -> 403 and nothing written', post.status === 403 && JSON.stringify(store.tabs.get('Vendors')) === before, post);
}

// ── 4. /vendor-file/view per-record check ──────────────────────────────────────────────────────
{
  const mine = await call('GET', '/vendor-file/view?wo_id=WO-1&file_id=F1&t=' + VEN1, null);
  t('file view: vendor streams a file on its OWN job', mine.status === 200 && mine.text === 'FILE-BYTES', { status: mine.status, text: mine.text.slice(0, 80) });
  const driveCallsBefore = outbound.filter(x => x.includes('drive/v3')).length;
  const theirs = await call('GET', '/vendor-file/view?wo_id=WO-2&file_id=F2&t=' + VEN1, null);
  t('file view: vendor asking for another vendor\'s file -> generic 404, no bytes', theirs.status === 404 && theirs.json.error === 'File not found for this work order' && !theirs.text.includes('FILE-BYTES'), theirs);
  t('file view: and Drive was never even called for it', outbound.filter(x => x.includes('drive/v3')).length === driveCallsBefore);
  const r = teleLast('vendor_file_scope_denied');
  t('file view: the denial is a FAILED telemetry row with wo and file', r && r.Success === 'FALSE' && /role=vendor session=V1 wo=WO-2 file=F2/.test(r.Notes), r);
  const adm = await call('GET', '/vendor-file/view?wo_id=WO-2&file_id=F2&t=' + SECRET, null);
  t('file view: admin secret still streams any file', adm.status === 200 && adm.text === 'FILE-BYTES', adm.status);
  const ten = await call('GET', '/vendor-file/view?wo_id=WO-1&file_id=F1&t=' + TEN1, null);
  t('file view: a tenant token is not in scope for the route at all (401)', ten.status === 401, ten.status);
}

// ── 5. the 500 handler ────────────────────────────────────────────────────────────────────────
{
  store.failWhen = (m, p) => m === 'GET' && /batchGet/.test(p) && /Work_Orders/.test(p);
  const ten = await call('GET', '/tenant-workorders?tenant_id=T1', TEN1);
  store.failWhen = null;
  t('500: a tenant gets a generic message + ref, status 500', ten.status === 500 && /Something went wrong/.test(ten.json.error) && /^[0-9a-f]{8}$/.test(ten.json.ref), ten);
  t('500: and NOT the error text, the stack or the error class', !/stack|Sheets API|batchGet|Error/.test(ten.text) && !('stack' in ten.json) && !('type' in ten.json), ten.text.slice(0, 200));
  const row = teleLast('unhandled_500');
  t('500: logged to Ops_Telemetry as a failure with the same ref and the real message', row && row.Success === 'FALSE' && row.Notes.includes('ref=' + ten.json.ref) && /Sheets API/i.test(row.Notes), row);
  store.failWhen = (m, p) => m === 'GET' && /batchGet/.test(p) && /Work_Orders/.test(p);
  const adm = await call('GET', '/tenant-workorders?tenant_id=T1', SECRET);
  store.failWhen = null;
  t('500: the admin secret still gets message, stack and type (plus the ref)', adm.status === 500 && adm.json.error && adm.json.stack && adm.json.type && adm.json.ref, adm.json);
  // a failing telemetry write is reported, not swallowed
  store.failWhen = (m, p) => /Work_Orders/.test(p) && /batchGet/.test(p) || /Ops_Telemetry/.test(p);
  const admT = await call('GET', '/tenant-workorders?tenant_id=T1', SECRET);
  const tenT = await call('GET', '/tenant-workorders?tenant_id=T1', TEN1);
  store.failWhen = null;
  t('500: if telemetry is down the admin response says so (telemetry_error)', admT.status === 500 && !!admT.json.telemetry_error, admT.json);
  t('500: and a tenant still gets only the generic message', tenT.status === 500 && /Something went wrong/.test(tenT.json.error) && !('telemetry_error' in tenT.json), tenT.json);
}

// ── 6. wiring / fail-closed ───────────────────────────────────────────────────────────────────
t('unknown role fails closed in the helper', new Function(wsrc.slice(wsrc.indexOf('const SESSION_IDENTITY_PARAM'), wsrc.indexOf('async function denySessionIdentity')) + '\nreturn sessionIdentityMismatch;')()('mystery', 'X1', new URL('https://x/y'), null) !== null);
t('a role session with an empty id fails closed when it names an id', new Function(wsrc.slice(wsrc.indexOf('const SESSION_IDENTITY_PARAM'), wsrc.indexOf('async function denySessionIdentity')) + '\nreturn sessionIdentityMismatch;')()('vendor', '', new URL('https://x/y?vendor_id=V1'), null) !== null);
t('no new swallowing catch in the new helpers', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(wsrc.slice(wsrc.indexOf('const SESSION_IDENTITY_PARAM'), wsrc.indexOf('async function getAttachments'))));
t('the list handlers prefer the session id over the query string', /callerRole === 'tenant' \? String\(callerSessionId/.test(wsrc) && /callerRole === 'owner' \? String\(callerSessionId/.test(wsrc) && /callerRole === 'vendor' \? String\(callerSessionId/.test(wsrc));

console.log(`\nsession-identity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
