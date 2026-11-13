// Owner WRITE scope (Nov 10 2026, Brett: "fix the owner ID hole first").
// Drives the REAL worker.js router over a fake Google Sheets with real signed owner session tokens.
// Before this fix an owner session could WRITE to another owner's records even though it could not READ them:
//   - POST /workorder on any property_id (plus extra body fields: tenant ids, parent_wo_id, contact phone, approval_*)
//   - /wo/add-note and /wo/append-description skipped the ownership check unless the client SAID author_role=owner
//     and sent owner_id (and author_role=tenant texts Brett)
//   - /wo/set-tenant-visibility, /log-attachment, /create-upload-session checked nothing
//   - /wishlist/add (Brett's internal dev list) was reachable
// Every denial must be a 4xx, change nothing, and leave a FAILED Ops_Telemetry row (no silent failures).
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

function makeStore() {
  const tabs = new Map(); const calls = [];
  const st = { tabs, calls };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {
    calls.push(method + ' ' + path);
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n); return { range: n, values: tabs.get(n).map(r => r.slice()) }; }
    if (method === 'GET' && (m = /^\/values:batchGet\?(.*)$/.exec(path))) {
      const names = m[1].split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, ''))); const valueRanges = [];
      for (const n of names) { if (!tabs.has(n)) return missing(n); valueRanges.push({ range: n, values: tabs.get(n).map(r => r.slice()) }); }
      return { valueRanges };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 60, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n); for (const r of body.values) tabs.get(n).push(r.slice()); return { updates: { updatedRows: body.values.length } }; }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
        const col = mm[1].split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]); while (rows[row].length <= col) rows[row].push('');
        rows[row][col] = d.values[0][0];
      }
      return { totalUpdatedCells: body.data.length };
    }
    if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  return st;
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
const outbound = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const b = init && init.body ? JSON.parse(init.body) : undefined; const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  outbound.push(method + ' ' + url);
  return new Response(JSON.stringify({ ok: true, id: 'DRIVEFILE', webViewLink: 'x' }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET };
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;
const call = async (method, path, token, body) => {
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) {}
  return { status: res.status, json: j, text };
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mint = (role, id) => { const now = Math.floor(Date.now() / 1000); const body = b64u(JSON.stringify({ role, id, iat: now, exp: now + 3600 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);

const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Tenant_ID', 'Status', 'Voided', 'Tenant_Visible', 'Type', 'Created_Date', 'Trade', 'Description', 'Notes', 'Parent_WO_ID', 'Duplicated_From', 'Bid_Group_ID', 'Priority', 'Created_By'];
tab('Work_Orders', WOH, [
  { ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Status: 'Assigned', Created_Date: '2026-10-01', Trade: 'Plumbing', Description: 'leak one', Notes: '', Tenant_Visible: 'TRUE' },
  { ID: 'WO-2', Property_ID: 'P2', Unit_ID: 'U2', Status: 'Assigned', Created_Date: '2026-10-02', Trade: 'HVAC', Description: 'unit two', Notes: '', Tenant_Visible: 'TRUE' },
]);
tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: 'P1', Owner_ID: 'O1', Address: '1 Main', Active: 'TRUE' }, { ID: 'P2', Owner_ID: 'O2', Address: '2 Oak', Active: 'TRUE' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Tenant_ID'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '1A', Tenant_ID: 'T1' }, { ID: 'U2', Property_ID: 'P2', Unit_Label: '2A', Tenant_ID: 'T2' }]);
tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Phone'], [{ ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE', First_Name: 'Tam' }, { ID: 'T2', Property_ID: 'P2', Unit_ID: 'U2', Active: 'TRUE', First_Name: 'Tia' }]);
tab('Owners', ['ID', 'First_Name', 'Notify_Method'], [{ ID: 'O1', First_Name: 'Olly', Notify_Method: 'sms' }, { ID: 'O2', First_Name: 'Ola', Notify_Method: 'sms' }]);
tab('Vendors', ['ID', 'Name', 'Phone', 'Active'], [{ ID: 'V1', Name: 'Vee', Phone: '4105550001', Active: 'TRUE' }]);
tab('Keys', ['ID', 'Property_ID', 'Unit_ID'], []);
tab('Wishlist', ['ID', 'Text', 'Created', 'Active', 'Status'], []);
tab('Attachments', ['WO_ID', 'File_Type', 'File_Name', 'Drive_File_ID', 'Drive_URL', 'Active', 'Mime_Type'], []);
tab('WO_Audit', ['WO_ID', 'Timestamp', 'Action'], []);
tab('Config', ['Key', 'Value'], []);

const rowsOf = (name) => { const r = store.tabs.get(name) || []; const h = r[0] || []; return r.slice(1).map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const teleAll = (job) => rowsOf('Ops_Telemetry').filter(r => r.Job_Type === job);
const wo = (id) => rowsOf('Work_Orders').find(r => r.ID === id);
const OWN1 = mint('owner', 'O1');
const snapshot = (n) => JSON.stringify(store.tabs.get(n));

// ── notes: owner O1 may write to its OWN job WO-1, never to O2's WO-2 ───────────────────────────
{
  const beforeWO = snapshot('Work_Orders');
  const bad = await call('POST', '/wo/add-note', OWN1, { wo_id: 'WO-2', note: 'hello', author: 'x' });
  t('add-note on another owner\'s job (no author_role/owner_id sent) -> 404, nothing written', bad.status === 404 && snapshot('Work_Orders') === beforeWO, bad);
  const bad2 = await call('POST', '/wo/add-note', OWN1, { wo_id: 'WO-2', note: 'hello', author: 'x', author_role: 'vendor' });
  t('add-note posing as a vendor on another owner\'s job -> 404', bad2.status === 404 && snapshot('Work_Orders') === beforeWO, bad2);
  const bad3 = await call('POST', '/wo/append-description', OWN1, { wo_id: 'WO-2', text: 'hi' });
  t('append-description on another owner\'s job -> 404', bad3.status === 404 && snapshot('Work_Orders') === beforeWO, bad3);
  const bad4 = await call('POST', '/wo/set-tenant-visibility', OWN1, { wo_id: 'WO-2', fields: { Tenant_Visible: 'FALSE' } });
  t('set-tenant-visibility on another owner\'s job -> 404, unchanged', bad4.status === 404 && wo('WO-2').Tenant_Visible === 'TRUE', bad4);
  const bad5 = await call('POST', '/wo/owner-update', OWN1, { wo_id: 'WO-2', fields: { Managed_By: 'Owner' } });
  t('owner-update on another owner\'s job -> not allowed, unchanged', (bad5.status === 404 || bad5.status === 403) && !wo('WO-2').Managed_By, bad5);
  const bad6 = await call('POST', '/log-attachment', OWN1, { wo_id: 'WO-2', file_id: 'F', file_name: 'a.jpg' });
  t('log-attachment on another owner\'s job -> 404, no Attachments row', bad6.status === 404 && rowsOf('Attachments').length === 0, bad6);
  const bad7 = await call('POST', '/create-upload-session', OWN1, { wo_id: 'WO-2', property: '2 Oak', file_name: 'a.jpg' });
  t('create-upload-session on another owner\'s job -> 404', bad7.status === 404, bad7);
  const bad8 = await call('POST', '/wo/add-note', OWN1, { note: 'no wo id' });
  t('add-note with no wo_id -> denied, not a free pass', bad8.status === 404, bad8);
  const tele = teleAll('owner_write_scope_denied');
  t('every denial left a FAILED owner_write_scope_denied telemetry row', tele.length >= 7 && tele.every(r => r.Success === 'FALSE' && /owner=O1/.test(r.Notes)), tele.length);
  t('telemetry names the endpoint and the wo', tele.some(r => r.Skill_Or_Endpoint === '/wo/add-note' && /wo=WO-2/.test(r.Notes)));
}
{
  const ok = await call('POST', '/wo/add-note', OWN1, { wo_id: 'WO-1', note: 'my own note', author: 'Olly', author_role: 'tenant', owner_id: 'O1' });
  t('add-note on OWN job still works', ok.status === 200 && /my own note/.test(wo('WO-1').Notes), ok);
  t('... and the author role is the session\'s (owner), never self-declared "tenant" (which would text Brett)', /\(owner\)/.test(wo('WO-1').Notes) && !/\(tenant\)/.test(wo('WO-1').Notes), wo('WO-1').Notes);
  const smsToBrett = outbound.filter(x => /twilio/i.test(x));
  t('no text was sent for that note', smsToBrett.length === 0, smsToBrett);
  const ok2 = await call('POST', '/wo/append-description', OWN1, { wo_id: 'WO-1', text: 'extra detail', author: 'Olly' });
  t('append-description on OWN job still works (owner_id omitted by the client)', ok2.status === 200 && /extra detail/.test(wo('WO-1').Description), ok2);
  const ok3 = await call('POST', '/wo/set-tenant-visibility', OWN1, { wo_id: 'WO-1', fields: { Tenant_Visible: 'FALSE' } });
  t('set-tenant-visibility on OWN job still works', ok3.status === 200 && wo('WO-1').Tenant_Visible === 'FALSE', ok3);
  const ok4 = await call('POST', '/log-attachment', OWN1, { wo_id: 'WO-1', file_id: 'F1', file_name: 'a.jpg', file_type: 'photo' });
  t('log-attachment on OWN job still works', ok4.status === 200 && rowsOf('Attachments').length === 1, ok4);
}

// ── creating a work order ───────────────────────────────────────────────────────────────────────
{
  const n0 = rowsOf('Work_Orders').length;
  const bad = await call('POST', '/workorder', OWN1, { property_id: 'P2', unit_id: 'U2', trade: 'Plumbing', description: 'sneaky', type: 'owner' });
  t('create a job on ANOTHER owner\'s property -> 403, no row', bad.status === 403 && rowsOf('Work_Orders').length === n0, bad);
  const bad2 = await call('POST', '/workorder', OWN1, { property_id: 'P1', unit_id: 'U2', trade: 'Plumbing', description: 'wrong unit', type: 'owner' });
  t('own property but another property\'s unit -> 403, no row', bad2.status === 403 && rowsOf('Work_Orders').length === n0, bad2);
  const bad3 = await call('POST', '/workorder', OWN1, { description: 'no property' });
  t('no property_id -> 403, no row', bad3.status === 403 && rowsOf('Work_Orders').length === n0, bad3);
  const tele = teleAll('owner_write_scope_denied').filter(r => r.Skill_Or_Endpoint === '/workorder');
  t('each refused create is a FAILED telemetry row', tele.length === 3 && tele.every(r => r.Success === 'FALSE'), tele.length);
  const ok = await call('POST', '/workorder', OWN1, {
    property_id: 'P1', unit_id: 'U1', trade: 'Plumbing', priority: 'Normal', description: 'drip', type: 'tenant',
    tenant_id: 'T2', tenant_ids: ['T2'], parent_wo_id: 'WO-2', wo_contact_phone: '4105559999', wo_contact_name: 'Spam Target',
    approval_source: 'owner', approval_note: 'self approved', max_price: '1', recurring_template_id: 'X', owner_notify_override: 'off' });
  t('create on OWN property + own unit is not refused by the owner gate', ok.status !== 403 && ok.status !== 404, ok);
  const made = rowsOf('Work_Orders').find(r => r.Description === 'drip');
  t('... the job exists', !!made, ok.text.slice(0, 200));
  if (made) {
    t('... it is a type=owner job even though the body said tenant', made.Type === 'owner', made.Type);
    t('... other tenants\' ids were dropped', made.Tenant_ID !== 'T2', made.Tenant_ID);
    t('... a foreign parent_wo_id was dropped', !made.Parent_WO_ID, made.Parent_WO_ID);
  }
  t('... and no text went to the phone number the body tried to inject', !outbound.some(x => /4105559999/.test(x)));
}

// ── wishlist + admin unchanged + other roles untouched ───────────────────────────────────────────
{
  const w = await call('POST', '/wishlist/add', OWN1, { text: 'junk' });
  t('owner can no longer write to Brett\'s dev wishlist -> 403', w.status === 403 && rowsOf('Wishlist').length === 0, w);
  const adm = await call('POST', '/wishlist/add', SECRET, { text: 'real item' });
  t('admin secret can still add to the wishlist', adm.status === 200 && rowsOf('Wishlist').length === 1, adm);
  const admNote = await call('POST', '/wo/add-note', SECRET, { wo_id: 'WO-2', note: 'admin note', author: 'Brett', author_role: 'admin' });
  t('admin secret can still add a note to ANY job', admNote.status === 200 && /admin note/.test(wo('WO-2').Notes), admNote);
  const admWO = await call('POST', '/workorder', SECRET, { property_id: 'P2', unit_id: 'U2', trade: 'HVAC', description: 'admin made', type: 'admin' });
  t('admin secret can still create a job on ANY property', admWO.status !== 403 && !!rowsOf('Work_Orders').find(r => r.Description === 'admin made'), admWO);
}

// ── wiring tripwires ─────────────────────────────────────────────────────────────────────────────
t('router calls ownerWriteScopeDenied for owner sessions on POST', /callerRole === 'owner'\) \{\s*const _owd = await ownerWriteScopeDenied\(env, path, body, callerSessionId\)/.test(wsrc));
t('every owner-reachable write path in ROLE_SCOPES.owner is covered or deliberately read-only/identity-bound', (() => {
  const line = wsrc.split('\n').find(l => /^\s*owner:\s*\['\/owner-by-pin'/.test(l)) || '';
  const paths = [...line.matchAll(/'(\/[^']+)'/g)].map(m => m[1]);
  const covered = new Set(['/wo/add-note', '/wo/append-description', '/wo/owner-update', '/wo/set-tenant-visibility', '/log-attachment', '/create-upload-session', '/workorder', '/wishlist/add']);
  // POST paths that are identity-bound elsewhere (body owner_id forced equal to session) or session-bound by design
  const other = new Set(['/owner-by-pin', '/owner/notifications', '/owner/billing', '/owner/tenant-roster/preview', '/owner/tenant-roster/apply', '/upload-photo', '/push/subscribe', '/push/device', '/push/remove', '/push/test', '/demo/test-send']);   // Nov 12 2026: /demo/test-send takes the person, slot and phone from the session only (demo logins; see demo-test-send.test.mjs)
  const getOnly = new Set(['/owner-workorders', '/owner-properties', '/owner-notifications', '/attachments', '/wo-audit', '/owner/get-billing', '/owner-file/view', '/owner/tenant-roster', '/push/vapid-key', '/push/devices']);
  const unknown = paths.filter(p => !covered.has(p) && !other.has(p) && !getOnly.has(p));
  if (unknown.length) console.log('UNCLASSIFIED owner paths:', unknown);
  return paths.length > 20 && unknown.length === 0;
})());
t('the denial helper never swallows an error silently', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(wsrc.slice(wsrc.indexOf('async function ownerWriteScopeDenied'), wsrc.indexOf('async function getAttachments'))));

console.log(`\nowner-write-scope: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
