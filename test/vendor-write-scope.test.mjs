// Vendor write scope (Nov 16 2026, access fix 2 of 3).
// Drives the REAL worker.js default export (router and all) over a fake Google Sheets with real signed session tokens.
// What it proves: a signed-in vendor can write (estimate, status, checklist, schedule, photos / files, bill, hours, receipt) ONLY to a
// work order assigned to them, can delete only their own hours / receipts, and always acts as themselves. A refusal is a clear 4xx,
// writes nothing, and leaves a FAILED Ops_Telemetry row. Assigned work (including a bid-group copy and an additional-work draft)
// still goes through, and the admin secret is unchanged.
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

const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Tenant_ID', 'Status', 'Voided', 'Tenant_Visible', 'Tenant_Notify_Updates', 'Type', 'Created_Date', 'Trade', 'Description', 'Notes', 'Priority', 'Parent_WO_ID', 'Duplicated_From', 'Bid_Group_ID', 'Bid_Winner', 'Addon_Status',
  'Checklist', 'Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Hold_Reason', 'Approval_Stage', 'Estimate_Revised', 'Drive_Folder_URL', 'Drive_Folder_ID', 'Max_Price', 'Vendor_Nudge_Clock', 'Managed_By'];
tab('Work_Orders', WOH, [
  { ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Status: 'Assigned', Created_Date: '2026-10-01', Trade: 'Plumbing', Description: 'mine', Tenant_Notify_Updates: 'FALSE' },
  { ID: 'WO-2', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V2', Status: 'Assigned', Created_Date: '2026-10-02', Trade: 'HVAC', Description: 'someone else\'s', Tenant_Notify_Updates: 'FALSE' },
  { ID: 'WO-3', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: '', Status: 'New', Created_Date: '2026-10-03', Trade: 'General', Description: 'nobody\'s yet', Tenant_Notify_Updates: 'FALSE' },
  { ID: 'WO-4', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Status: 'Assigned', Voided: 'TRUE', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Draft', Created_Date: '2026-10-04', Trade: 'Plumbing', Description: 'my additional-work draft' },
  { ID: 'WO-5', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Status: 'Estimate Requested', Bid_Group_ID: 'BG-1', Duplicated_From: 'WO-9', Created_Date: '2026-10-05', Trade: 'Painting', Description: 'my bid-group copy', Tenant_Notify_Updates: 'FALSE' },
  { ID: 'WO-6', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V2', Status: 'Estimate Requested', Bid_Group_ID: 'BG-1', Duplicated_From: 'WO-9', Created_Date: '2026-10-05', Trade: 'Painting', Description: 'the other vendor\'s bid-group copy', Tenant_Notify_Updates: 'FALSE' },
]);
tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: 'P1', Owner_ID: 'O1', Address: '1 Main', Active: 'TRUE' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Tenant_ID'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '1A', Tenant_ID: '' }]);
tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'Move_In_Date'], []);
tab('Keys', ['ID', 'Property_ID', 'Unit_ID'], []);
tab('Vendors', ['ID', 'Name', 'Phone', 'Email', 'Company', 'Active', 'Language', 'Rate'], [{ ID: 'V1', Name: 'Vee One', Phone: '4105550001', Active: 'TRUE' }, { ID: 'V2', Name: 'Vee Two', Phone: '4105550002', Active: 'TRUE' }]);
tab('Owners', ['ID', 'First_Name', 'Last_Name', 'Notify_Method', 'Phone'], [{ ID: 'O1', First_Name: 'Olly', Notify_Method: 'none' }]);
tab('Master_Keys', ['ID'], []); tab('Master_Key_Holders', ['ID'], []);
tab('Attachments', ['ID', 'WO_ID', 'File_Type', 'File_Name', 'Drive_File_ID', 'Drive_URL', 'Active', 'Mime_Type', 'Created_Date', 'Addon_Item'], []);
tab('Vendor_Bills', ['ID', 'WO_ID', 'Vendor_ID', 'Vendor_Name', 'Bill_Type', 'Hours', 'Rate', 'Labor_Total', 'Receipts_JSON', 'Receipts_Total', 'Flat_Rate', 'Total', 'Status', 'Created_Date', 'Notes', 'Active', 'Entered_By'], []);
tab('Receipts', ['ID', 'WO_ID', 'Property_ID', 'Role', 'Added_By', 'Added_By_ID', 'Active', 'Amount', 'Description', 'Store', 'Date', 'Created_Date', 'Payment_Source', 'Category'], [
  { ID: 'R1', WO_ID: 'WO-1', Role: 'vendor', Added_By_ID: 'V1', Active: 'TRUE', Amount: '5' }, { ID: 'R2', WO_ID: 'WO-2', Role: 'vendor', Added_By_ID: 'V2', Active: 'TRUE', Amount: '9' }, { ID: 'R3', WO_ID: 'WO-1', Role: 'hub', Added_By_ID: 'V1', Active: 'TRUE', Amount: '7' }]);
tab('Time_Entries', ['ID', 'WO_ID', 'Entered_By', 'Entered_By_ID', 'Role', 'Entry_Type', 'Start_DateTime', 'End_DateTime', 'Duration_Minutes', 'Notes', 'Invoice_Description', 'Billable', 'Hourly_Rate', 'Billable_Amount', 'Created_Date', 'Active'], [
  { ID: 'TE1', WO_ID: 'WO-1', Role: 'vendor', Entered_By_ID: 'V1', Active: 'TRUE', Duration_Minutes: '60' }, { ID: 'TE2', WO_ID: 'WO-2', Role: 'vendor', Entered_By_ID: 'V2', Active: 'TRUE', Duration_Minutes: '60' }, { ID: 'TE9', WO_ID: 'WO-1', Role: 'hub', Entered_By_ID: 'ADMIN', Active: 'TRUE', Duration_Minutes: '30' }]);
tab('Estimates', ['ID', 'WO_ID', 'Version', 'Line_Items', 'Subtotal', 'Status', 'Change_Reason', 'Created_By', 'Created_Date', 'Active', 'Vendor_ID', 'Over_Max_Reason', 'Line_Items_ES'], []);
tab('WO_Audit', ['ID', 'WO_ID', 'Changed_By', 'Changed_By_Role', 'Field', 'Old_Value', 'New_Value', 'Timestamp', 'Notes'], []);
tab('SMS_Logs', ['ID', 'WO_ID', 'Recipient_Type', 'Phone', 'Message', 'Status', 'Created_Date'], []);
tab('Config', ['Key', 'Value'], []);

const teleRows = (job) => { const all = store.tabs.get('Ops_Telemetry') || [[]]; const h = all[0]; return all.slice(1).filter(r => r[h.indexOf('Job_Type')] === job).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const snap = (names) => JSON.stringify(names.map(n => store.tabs.get(n)));
const DATA = ['Work_Orders', 'Estimates', 'Vendor_Bills', 'Receipts', 'Time_Entries', 'Attachments', 'WO_Audit'];
const rowsOf = (name) => { const all = store.tabs.get(name); const h = all[0]; return all.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); };
const woRow = (id) => rowsOf('Work_Orders').find(w => w.ID === id);
const VEN1 = mint('vendor', 'V1');
const EST = (wo, extra) => Object.assign({ wo_id: wo, line_items: [{ desc: 'TEST labor', amount: 120 }], change_reason: 'TEST', created_by: 'Vee One', lang: 'en' }, extra || {});
const isDenied = (r) => r.status === 403 && r.json && r.json.code === 'vendor_write_scope_denied';

// The body each vendor write route gets from vendor.html, for a given work order.
const BODIES = {
  '/estimate': (wo) => EST(wo),
  '/status': (wo) => ({ wo_id: wo, status: 'Accepted', notes: '', updated_by: 'Vee One', updated_by_role: 'vendor', lang: 'en' }),
  '/wo/checklist': (wo) => ({ wo_id: wo, checklist: [{ text: 'TEST item', done: true }], updated_by: 'Vee One', updated_by_role: 'vendor' }),
  '/schedule': (wo) => ({ wo_id: wo, date: '2026-12-01', window: '8am-12pm', notify_tenant: false, updated_by: 'Vee One', updated_by_role: 'vendor' }),
  '/time-entry/add': (wo) => ({ wo_id: wo, entered_by: 'Vee One', entered_by_id: 'V1', role: 'vendor', entry_type: 'Labor', duration_minutes_raw: '45', notes: 'TEST', billable: 'TRUE', hourly_rate: '50' }),
  '/receipt/add': (wo) => ({ wo_id: wo, amount: 12.5, description: 'TEST part', store: 'TEST store', date: '2026-11-16', added_by: 'Vee One', added_by_id: 'V1', role: 'vendor', payment_source: 'company_card' }),
  '/vendor-bill/add': (wo) => ({ WO_ID: wo, Vendor_ID: 'V1', Vendor_Name: 'Vee One', Bill_Type: 'flat', Hours: '0', Rate: '0', Labor_Total: '0.00', Receipts_JSON: '[]', Receipts_Total: '0.00', Flat_Rate: '200.00', Total: '200.00', Status: 'submitted', Created_Date: '2026-11-16', Notes: 'TEST', Active: 'TRUE', lang: 'en' }),
  '/create-upload-session': (wo) => ({ wo_id: wo, property: '1 Main', file_name: 'TEST.jpg', file_type: 'before', mime_type: 'image/jpeg' }),
  '/log-attachment': (wo) => ({ wo_id: wo, file_id: 'F-TEST', file_url: 'https://d/F-TEST', file_name: 'TEST.jpg', file_type: 'before', mime_type: 'image/jpeg' }),
  '/vendor-bill/reconcile-receipts': (wo) => ({ wo_id: wo, image_b64: 'AAAA', mime: 'image/jpeg' }),
};
const REQUIRED = ['/estimate', '/status', '/wo/checklist', '/schedule', '/time-entry/add', '/receipt/add', '/vendor-bill/add'];
const OPTIONAL = ['/create-upload-session', '/log-attachment', '/vendor-bill/reconcile-receipts'];
const upload = async (token, woId) => {
  skew += 10000;
  const fd = new FormData(); fd.append('file', new Blob(['x'], { type: 'image/jpeg' }), 'TEST.jpg'); if (woId !== null) fd.append('wo_id', woId);
  const res = await worker.fetch(new Request(BASE + '/upload-photo', { method: 'POST', headers: { 'X-Auth-Token': token }, body: fd }), env, { waitUntil() {} });
  let j = null; try { j = await res.clone().json(); } catch (_) {}
  return { status: res.status, json: j };
};

// ── 1. REFUSED: every vendor write route, against someone else's job, an unassigned job, and a job that does not exist ──
for (const [target, why] of [['WO-2', 'assigned to another vendor'], ['WO-3', 'assigned to nobody'], ['WO-6', 'the other vendor\'s bid-group copy'], ['WO-NOPE', 'does not exist']]) {
  for (const p of REQUIRED.concat(OPTIONAL)) {
    const before = snap(DATA), nTele = teleRows('vendor_write_scope_denied').length, nOut = outbound.length;
    const r = await call('POST', p, VEN1, BODIES[p](target));
    t(`refused: ${p} on ${target} (${why}) -> 403 with a plain reason`, isDenied(r) && /not assigned to you/.test(r.json.error) && /no está asignada/.test(r.json.error), r);
    t(`refused: ${p} on ${target} wrote nothing`, snap(DATA) === before);
    t(`refused: ${p} on ${target} called nothing outside (no Drive, no text, no AI)`, outbound.length === nOut, outbound.slice(nOut));
    const tele = teleRows('vendor_write_scope_denied');
    t(`refused: ${p} on ${target} left a FAILED Ops_Telemetry row naming the vendor and the job`, tele.length === nTele + 1 && tele[tele.length - 1].Success === 'FALSE' && tele[tele.length - 1].Skill_Or_Endpoint === p && tele[tele.length - 1].Notes.includes('vendor=V1') && tele[tele.length - 1].Notes.includes('wo=' + target), tele[tele.length - 1]);
  }
  const before = snap(DATA), nOut = outbound.length;
  const up = await upload(VEN1, target);
  t(`refused: /upload-photo (multipart) on ${target} -> 403, nothing written, nothing sent to Drive`, isDenied(up) && snap(DATA) === before && outbound.length === nOut, up);
}
{
  // The reported case, spelled out: an estimate on a job that is not theirs.
  const r = await call('POST', '/estimate', VEN1, EST('WO-2', { vendor_id: 'V1' }));
  t('reported bug: a vendor cannot post an estimate on another vendor\'s work order', isDenied(r) && rowsOf('Estimates').length === 0, r);
  // a required route with no work order at all
  for (const p of REQUIRED) {
    const b = BODIES[p]('X'); delete b.wo_id; delete b.WO_ID;
    const before = snap(DATA);
    const r2 = await call('POST', p, VEN1, b);
    t(`refused: ${p} with no work order -> 400, nothing written`, r2.status === 400 && r2.json.code === 'vendor_write_scope_denied' && snap(DATA) === before, r2);
  }
  // onboarding id of ANOTHER vendor
  const o = await call('POST', '/create-upload-session', VEN1, { wo_id: 'VENDOR-V2', property: 'Vendor Onboarding', file_name: 'w9.pdf', file_type: 'tax_id_doc' });
  t('refused: another vendor\'s onboarding folder', isDenied(o), o);
}

// ── 2. REFUSED: deleting hours / receipts that are not the vendor's own ─────────────────────────────────────────────
{
  for (const [p, id, why] of [['/time-entry/delete', 'TE2', 'another vendor\'s'], ['/time-entry/delete', 'TE9', 'the Hub\'s own'], ['/time-entry/delete', 'NOPE', 'missing'], ['/receipt/delete', 'R2', 'another vendor\'s'], ['/receipt/delete', 'R3', 'a Hub receipt'], ['/receipt/delete', 'NOPE', 'missing']]) {
    const before = snap(DATA);
    const r = await call('POST', p, VEN1, { id });
    t(`refused: ${p} ${id} (${why}) -> 403, row untouched`, isDenied(r) && /not yours/.test(r.json.error) && snap(DATA) === before, r);
  }
  const noId = await call('POST', '/time-entry/delete', VEN1, {});
  t('refused: delete with no id -> 400', noId.status === 400 && noId.json.code === 'vendor_write_scope_denied', noId);
}

// ── 3. REFUSED: acting as someone else ───────────────────────────────────────────────────────────────────────────────
{
  const b = BODIES['/vendor-bill/add']('WO-1'); b.Vendor_ID = 'V2';
  const before = snap(DATA);
  const r = await call('POST', '/vendor-bill/add', VEN1, b);
  t('refused: a bill on my own job but "from" another vendor (Vendor_ID in the body) -> 403, nothing written', r.status === 403 && snap(DATA) === before, r);
}

// ── 4. ALLOWED: the same routes on the vendor's own job really work ──────────────────────────────────────────────────
{
  const e = await call('POST', '/estimate', VEN1, EST('WO-1'));
  t('allowed: estimate on my own job is saved', e.status === 200 && e.json.success === true && rowsOf('Estimates').some(x => x.WO_ID === 'WO-1' && x.Version === '1'), e);
  const eb = await call('POST', '/estimate', VEN1, EST('WO-5'));
  t('allowed: estimate on my own bid-group copy is saved', eb.status === 200 && eb.json.success === true && rowsOf('Estimates').some(x => x.WO_ID === 'WO-5'), eb);
  const c = await call('POST', '/wo/checklist', VEN1, BODIES['/wo/checklist']('WO-1'));
  t('allowed: checklist on my own job is saved', c.status === 200 && c.json.success === true && /TEST item/.test(woRow('WO-1').Checklist), c);
  const s = await call('POST', '/schedule', VEN1, BODIES['/schedule']('WO-1'));
  t('allowed: schedule on my own job is saved', s.status === 200 && s.json.success === true && woRow('WO-1').Scheduled_Date === '2026-12-01', s);
  const te = await call('POST', '/time-entry/add', VEN1, Object.assign(BODIES['/time-entry/add']('WO-1'), { role: 'hub', entered_by_id: 'V2' }));
  const teRow = rowsOf('Time_Entries').find(x => x.WO_ID === 'WO-1' && x.Notes === 'TEST');
  t('allowed: hours on my own job are saved, as ME and as a vendor whatever the body claimed', te.status === 200 && te.json.success === true && teRow && teRow.Role === 'vendor' && teRow.Entered_By_ID === 'V1', { te, teRow });
  const rc = await call('POST', '/receipt/add', VEN1, Object.assign(BODIES['/receipt/add']('WO-1'), { role: 'hub', added_by_id: 'V2' }));
  const rcRow = rowsOf('Receipts').find(x => x.WO_ID === 'WO-1' && x.Description === 'TEST part');
  t('allowed: receipt on my own job is saved, as ME and as a vendor whatever the body claimed', rc.status === 200 && rc.json.success === true && rcRow && rcRow.Role === 'vendor' && rcRow.Added_By_ID === 'V1', { rc, rcRow });
  const bl = await call('POST', '/vendor-bill/add', VEN1, BODIES['/vendor-bill/add']('WO-1'));
  const blRow = rowsOf('Vendor_Bills').find(x => x.WO_ID === 'WO-1');
  t('allowed: bill on my own job is saved under my id', bl.status === 200 && (bl.json.success === true || bl.json.id) && blRow && blRow.Vendor_ID === 'V1', { bl, blRow });
  const la = await call('POST', '/log-attachment', VEN1, BODIES['/log-attachment']('WO-1'));
  t('allowed: photo logged on my own job', la.status === 200 && la.json.success === true && rowsOf('Attachments').some(x => x.WO_ID === 'WO-1' && x.Drive_File_ID === 'F-TEST'), la);
  const ld = await call('POST', '/log-attachment', VEN1, Object.assign(BODIES['/log-attachment']('WO-4'), { file_id: 'F-DRAFT' }));
  t('allowed: photo logged on my own additional-work draft (a voided child assigned to me)', ld.status === 200 && ld.json.success === true && rowsOf('Attachments').some(x => x.WO_ID === 'WO-4' && x.Drive_File_ID === 'F-DRAFT'), ld);
  const st = await call('POST', '/status', VEN1, Object.assign(BODIES['/status']('WO-1'), { updated_by_role: 'admin' }));
  const au = rowsOf('WO_Audit').filter(a => a.WO_ID === 'WO-1' && a.Field === 'Status').pop();
  t('allowed: status on my own job is saved, recorded as a VENDOR change whatever the body claimed', st.status === 200 && st.json.success === true && woRow('WO-1').Status === 'Accepted' && au && au.Changed_By_Role === 'vendor', { st, au });
  for (const p of ['/create-upload-session', '/vendor-bill/reconcile-receipts']) {
    const r = await call('POST', p, VEN1, BODIES[p]('WO-1'));
    t(`allowed: ${p} on my own job gets past the gate`, !(r.json && r.json.code === 'vendor_write_scope_denied'), r);
  }
  const up = await upload(VEN1, 'WO-1');
  t('allowed: /upload-photo on my own job gets past the gate', !(up.json && up.json.code === 'vendor_write_scope_denied'), up);
  const up0 = await upload(VEN1, null);
  t('allowed: /upload-photo with no job (bill-with-no-job photo) gets past the gate', !(up0.json && up0.json.code === 'vendor_write_scope_denied'), up0);
  const ob = await call('POST', '/create-upload-session', VEN1, { wo_id: 'VENDOR-V1', property: 'Vendor Onboarding', file_name: 'w9.pdf', file_type: 'tax_id_doc' });
  t('allowed: my own onboarding folder gets past the gate', !(ob.json && ob.json.code === 'vendor_write_scope_denied'), ob);
  const d1 = await call('POST', '/time-entry/delete', VEN1, { id: 'TE1' });
  t('allowed: deleting my own hours', d1.status === 200 && rowsOf('Time_Entries').find(x => x.ID === 'TE1').Active === 'FALSE', d1);
  const d2 = await call('POST', '/receipt/delete', VEN1, { id: 'R1' });
  t('allowed: deleting my own receipt', d2.status === 200 && rowsOf('Receipts').find(x => x.ID === 'R1').Active === 'FALSE', d2);
}

// ── 5. the admin secret is unchanged (the Hub can still write to any job) ────────────────────────────────────────────
{
  const e = await call('POST', '/estimate', SECRET, EST('WO-2', { vendor_id: 'V2', created_by: 'Brett' }));
  t('admin secret: estimate on any job still saved', e.status === 200 && e.json.success === true && rowsOf('Estimates').some(x => x.WO_ID === 'WO-2'), e);
  const d = await call('POST', '/time-entry/delete', SECRET, { id: 'TE2' });
  t('admin secret: can still remove any time entry', d.status === 200 && rowsOf('Time_Entries').find(x => x.ID === 'TE2').Active === 'FALSE', d);
}

// ── 6. tripwire: a NEW vendor write route has to be classified here ──────────────────────────────────────────────────
{
  const scope = /vendor:\s*\[([\s\S]*?)\],\n\s*tenant:/.exec(wsrc)[1].match(/'\/[^']+'/g).map(x => x.slice(1, -1));
  const postBlock = wsrc.slice(wsrc.indexOf("if (request.method === 'POST') {"));
  const isPost = (p) => postBlock.includes(`path === '${p}'`);
  const GATED = REQUIRED.concat(OPTIONAL, ['/upload-photo', '/time-entry/delete', '/receipt/delete']);
  // Routes that check the vendor inside their own handler, or touch no work order (see the comment above vendorWriteScopeDenied).
  const SELF_CHECKED = ['/wo/additional-work/start', '/wo/additional-work/submit', '/wo/additional-work/withdraw', '/vendor-task-request/mark-done', '/vendor/update-contact',
    '/vendor-bill/add-standalone', '/vendor/request-property-access', '/workorder/self-serve', '/vendor-bill/extract', '/wishlist/add', '/push/vapid-key', '/push/devices', '/push/subscribe', '/push/device', '/push/remove', '/push/test'];   // push: a session manages only its own devices (identity from the session inside pushRoute)
  const unclassified = scope.filter(isPost).filter(p => !GATED.includes(p) && !SELF_CHECKED.includes(p));
  t('every POST route a vendor session can reach is either gated here or listed as self-checked', unclassified.length === 0, unclassified);
  const grabList = (name) => eval(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);').exec(wsrc)[1]);
  t('worker.js gates exactly the routes this test exercises', grabList('VENDOR_WO_WRITE_PATHS').slice().sort().join() === REQUIRED.slice().sort().join() && grabList('VENDOR_WO_OPTIONAL_PATHS').slice().sort().join() === OPTIONAL.concat(['/upload-photo']).sort().join());
}

console.log(`vendor-write-scope: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
