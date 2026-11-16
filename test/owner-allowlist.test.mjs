// Owner read allow-list (Nov 16 2026, access fix 1 of 3).
// Drives the REAL worker.js default export (router and all) over a fake Google Sheets with real signed session tokens.
// What it proves: for EVERY read route an owner session can reach, the answer holds only the allow-listed fields and none of the
// internal ones (vendor prices, vendor bills, markup, internal notes, lock codes, QuickBooks ids, messages to the vendor / to Brett).
// Every internal value in the fixtures contains the marker LEAK, so one check ("the answer never contains LEAK") covers them all,
// and a second check compares the keys of every returned object with the allow-list in worker.js.
// The admin secret is unchanged (it still gets whole rows), and the fields owner.html draws are all still there.
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

const LEAK = 'LEAK';
const INTERNAL_WO = { Admin_Notes: 'LEAK admin note', Vendor_Admin_Notes: 'LEAK vendor admin note', Entry_Notes: 'LEAK entry note', Hold_Reason: 'LEAK hold reason', Owner_Notes: 'LEAK owner notes col',
  Estimate_Revised: 'LEAK v3 $450.00', Addon_Amount: 'LEAK 125.00', Addon_Items_JSON: '[{"desc":"LEAK item","amount":125}]', Customer_Charge: 'LEAK 999.00', Max_Price: 'LEAK 700',
  Deposit_Amount: 'LEAK 300', Deposit_Vendor_ID: 'LEAK-V', Deposit_Notes: 'LEAK deposit note', Deposit_Fee: 'LEAK 9', Deposit_QB_Bill_Number: 'LEAK-QB-1', Vendor_Paid_Date: 'LEAK-2026-11-01',
  QBO_Bill_Number: 'LEAK-BILL-7', Invoice_Status: 'LEAK inv status', Invoice_ID: 'LEAK-INV', Approval_Note: 'LEAK approval note', Approval_Stage: 'LEAK-Proposed', Scope_ID: 'LEAK-SCOPE',
  Drive_Folder_ID: 'LEAK-FOLDER', Share_Rev: 'LEAK-REV', Checklist: '[{"t":"LEAK checklist"}]', Void_Reason_Detail: 'LEAK void detail', WO_Contact_Phone: 'LEAK-4105550000', Brand_New_Internal_Column: 'LEAK future column' };
const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Tenant_ID', 'Status', 'Voided', 'Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Type', 'Created_Date', 'Trade', 'Description', 'Priority',
  'Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Created_By', 'Notes', 'Owner_WO_Ref', 'Managed_By', 'Parent_WO_ID', 'Duplicated_From', 'Bid_Group_ID', 'Bid_Winner', 'Addon_Status', 'Vendor_Needs_Access'].concat(Object.keys(INTERNAL_WO));
tab('Work_Orders', WOH, [
  Object.assign({ ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Tenant_ID: 'T1', Status: 'Pending Invoice', Created_Date: '2026-10-01', Trade: 'Plumbing', Description: 'leak under sink', Priority: 'normal',
    Scheduled_Date: '2026-10-05', Notes: 'shared note', Owner_WO_Ref: 'REF-9', Managed_By: 'RidgeCo', Tenant_Visible: 'TRUE', Vendor_Needs_Access: 'TRUE' }, INTERNAL_WO),
  Object.assign({ ID: 'WO-2', Property_ID: 'P2', Unit_ID: 'U2', Vendor_ID: 'V2', Status: 'Assigned', Created_Date: '2026-10-02', Trade: 'HVAC', Description: 'other owner job' }, INTERNAL_WO),
]);
tab('Properties', ['ID', 'Owner_ID', 'Address', 'City', 'Market', 'Type', 'Unit_Count', 'Active', 'Lockbox_Code', 'Lock_Code', 'Access_Notes', 'Master_Key_ID', 'QBO_Customer_ID', 'Known_Issues', 'Parking_Notes', 'Water_Shutoff'], [
  { ID: 'P1', Owner_ID: 'O1', Address: '1 Main St', City: 'Baltimore', Market: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE', Lockbox_Code: 'LEAK-1234', Lock_Code: 'LEAK-5678', Access_Notes: 'LEAK access notes', Master_Key_ID: 'LEAK-MK', QBO_Customer_ID: 'LEAK-58', Known_Issues: 'LEAK known issues', Parking_Notes: 'LEAK parking', Water_Shutoff: 'LEAK shutoff' },
  { ID: 'P2', Owner_ID: 'O2', Address: '2 Oak Ave', Active: 'TRUE', Lockbox_Code: 'LEAK-0000' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Tenant_ID', 'Active', 'Lock_Code', 'Notes', 'QBO_Customer_ID', 'Known_Issues'], [
  { ID: 'U1', Property_ID: 'P1', Unit_Label: '1A', Tenant_ID: 'T1', Active: 'TRUE', Lock_Code: 'LEAK-UNIT-CODE', Notes: 'LEAK unit note', QBO_Customer_ID: 'LEAK-59', Known_Issues: 'LEAK unit issue' },
  { ID: 'U2', Property_ID: 'P2', Unit_Label: '2A', Tenant_ID: 'T2', Active: 'TRUE' }]);
tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'Email', 'Move_In_Date', 'PIN'], [
  { ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE', First_Name: 'Tam', Last_Name: 'Renter', Phone: '4105551111', Move_In_Date: '2025-01-01', PIN: 'LEAK-PIN' },
  { ID: 'T2', Property_ID: 'P2', Unit_ID: 'U2', Active: 'TRUE', First_Name: 'Tia', Move_In_Date: '2025-01-01', PIN: 'LEAK-PIN2' }]);
tab('Keys', ['ID', 'Property_ID', 'Unit_ID', 'Code', 'Active', 'Visibility'], [{ ID: 'K1', Property_ID: 'P1', Unit_ID: '', Code: 'LEAK-KEYCODE', Active: 'TRUE' }]);
tab('Vendors', ['ID', 'Name', 'Phone', 'Email', 'Company', 'Active', 'Trade', 'Rate', 'PIN'], [
  { ID: 'V1', Name: 'Vee One', Phone: 'LEAK-4105550001', Email: 'LEAK@vendor.test', Active: 'TRUE', Trade: 'Plumbing', Rate: 'LEAK-85', PIN: 'LEAK-VPIN' }, { ID: 'V2', Name: 'Vee Two', Phone: '4105550002', Active: 'TRUE' }]);
tab('Owners', ['ID', 'First_Name', 'Last_Name', 'Company', 'Phone', 'Notify_Method', 'Notify_Urgent', 'Billing_Name', 'PIN', 'Hourly_Rate', 'Markup_Pct', 'Internal_Notes', 'Active'], [
  { ID: 'O1', First_Name: 'Olly', Last_Name: 'Owner', Notify_Method: 'sms', Billing_Name: 'Olly LLC', PIN: 'LEAK-OPIN', Hourly_Rate: 'LEAK-95', Markup_Pct: 'LEAK-20', Internal_Notes: 'LEAK owner internal', Active: 'TRUE' },
  { ID: 'O2', First_Name: 'Ola', Notify_Method: 'sms', Active: 'TRUE' }]);
tab('Master_Keys', ['ID'], []); tab('Master_Key_Holders', ['ID'], []);
tab('Attachments', ['WO_ID', 'File_Type', 'File_Name', 'Drive_File_ID', 'Drive_URL', 'Active', 'Mime_Type', 'Created_Date', 'Invoice_ID', 'Addon_Item', 'Internal_Flag'], [
  { WO_ID: 'WO-1', File_Type: 'before', File_Name: 'before.jpg', Drive_File_ID: 'F1', Drive_URL: 'https://d/F1', Active: 'TRUE', Mime_Type: 'image/jpeg', Invoice_ID: 'LEAK-INV', Internal_Flag: 'LEAK flag' },
  { WO_ID: 'WO-1', File_Type: 'receipt', File_Name: 'receipt.jpg', Drive_File_ID: 'F2', Active: 'TRUE', Mime_Type: 'image/jpeg' },
  { WO_ID: 'WO-1', File_Type: 'bill', File_Name: 'LEAK vendor bill $1300.pdf', Drive_File_ID: 'LEAK-F3', Active: 'TRUE' },
  { WO_ID: 'WO-1', File_Type: 'invoice', File_Name: 'LEAK vendor invoice.pdf', Drive_File_ID: 'LEAK-F4', Active: 'TRUE' },
  { WO_ID: 'WO-1', File_Type: 'some_new_internal_type', File_Name: 'LEAK new type.pdf', Drive_File_ID: 'LEAK-F5', Active: 'TRUE' }]);
const AH = ['ID', 'WO_ID', 'Changed_By', 'Changed_By_Role', 'Field', 'Old_Value', 'New_Value', 'Timestamp', 'Notes', 'Channel', 'Recipient_Name', 'Recipient_Type', 'Message_Type', 'Message_Body', 'Outcome', 'Original_Body', 'Translated_To'];
tab('WO_Audit', AH, [
  { ID: '1', WO_ID: 'WO-1', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Status', Old_Value: 'New', New_Value: 'Assigned', Timestamp: '2026-10-01T10:00:00Z', Notes: 'assigned' },
  { ID: '2', WO_ID: 'WO-1', Changed_By: 'Olly', Changed_By_Role: 'owner', Field: 'Priority', Old_Value: 'low', New_Value: 'normal', Timestamp: '2026-10-01T11:00:00Z', Notes: 'Owner updated via portal' },
  { ID: '3', WO_ID: 'WO-1', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Admin_Notes', Old_Value: '', New_Value: 'LEAK admin note text', Timestamp: '2026-10-01T12:00:00Z', Notes: 'Admin updated via portal' },
  { ID: '4', WO_ID: 'WO-1', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Vendor_Admin_Notes', Old_Value: '', New_Value: 'LEAK vendor admin', Timestamp: '2026-10-01T12:01:00Z' },
  { ID: '5', WO_ID: 'WO-1', Changed_By: 'admin', Changed_By_Role: 'admin', Field: 'Max_Price', Old_Value: '', New_Value: 'LEAK 700', Timestamp: '2026-10-01T12:02:00Z' },
  { ID: '6', WO_ID: 'WO-1', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Vendor_Bill_Receipts', Old_Value: 'LEAK 40', New_Value: 'LEAK 55', Timestamp: '2026-10-01T12:03:00Z', Notes: 'LEAK bill edit' },
  { ID: '7', WO_ID: 'WO-1', Changed_By: 'System', Changed_By_Role: 'system', Field: 'SMS', Timestamp: '2026-10-01T12:04:00Z', Notes: 'LEAK gate note', Channel: 'sms', Recipient_Name: 'Brett', Recipient_Type: 'admin', Message_Type: 'admin_estimate_new', Message_Body: 'LEAK Revised estimate on WO-1 from Vee One: $1,300.00', Outcome: 'sent' },
  { ID: '8', WO_ID: 'WO-1', Changed_By: 'System', Changed_By_Role: 'system', Field: 'SMS', Timestamp: '2026-10-01T12:05:00Z', Channel: 'sms', Recipient_Name: 'Vee One', Recipient_Type: 'vendor', Message_Type: 'vendor_job_assigned', Message_Body: 'LEAK New job. Max price: $700 — send a new estimate', Original_Body: 'LEAK original', Outcome: 'sent' },
  { ID: '9', WO_ID: 'WO-1', Changed_By: 'System', Changed_By_Role: 'system', Field: 'SMS', Timestamp: '2026-10-01T12:06:00Z', Channel: 'sms', Recipient_Name: 'Tam', Recipient_Type: 'tenant', Message_Type: 'tenant_job_assigned', Message_Body: 'LEAK assigned to Vee One (410) 555-0001', Outcome: 'sent' },
  { ID: '10', WO_ID: 'WO-1', Changed_By: 'System', Changed_By_Role: 'system', Field: 'SMS', Timestamp: '2026-10-01T12:07:00Z', Channel: 'sms', Recipient_Name: 'Olly', Recipient_Type: 'owner', Message_Type: 'owner_received', Message_Body: 'LEAK-BODY Hi Olly, we got it', Outcome: 'sent' },
  { ID: '11', WO_ID: 'WO-1', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Some_Future_Internal_Field', Old_Value: '', New_Value: 'LEAK future', Timestamp: '2026-10-01T12:08:00Z' },
  { ID: '12', WO_ID: 'WO-1', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Bid_Group_Cancel', Old_Value: 'Assigned', New_Value: 'Cancelled', Timestamp: '2026-10-01T12:09:00Z', Notes: 'LEAK Vendor text: sent' },
  { ID: '13', WO_ID: 'WO-2', Changed_By: 'Brett', Changed_By_Role: 'admin', Field: 'Status', Old_Value: 'New', New_Value: 'Assigned', Timestamp: '2026-10-02T10:00:00Z' }]);
tab('Config', ['Key', 'Value'], []);

const OWN1 = mint('owner', 'O1');
const grabConst = (name) => { const m = new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);').exec(wsrc); if (!m) throw new Error('missing ' + name); return eval(m[1]); };
const A = Object.fromEntries(['OWNER_WO_VIEW_FIELDS', 'OWNER_PROPERTY_FIELDS', 'OWNER_UNIT_FIELDS', 'OWNER_ATTACHMENT_FIELDS', 'OWNER_ATTACHMENT_TYPES', 'OWNER_AUDIT_ROW_FIELDS', 'OWNER_AUDIT_MESSAGE_FIELDS', 'OWNER_AUDIT_FIELDS'].map(n => [n, grabConst(n)]));
const extraKeys = (obj, allowed) => Object.keys(obj).filter(k => !allowed.includes(k));
// The internal field NAMES the brief lists (vendor cost, vendor bill amounts, markup, internal notes ...) can never be in an allow-list.
const FORBIDDEN_NAME = /cost|bill|markup|margin|admin_notes|entry_notes|internal|deposit|max_price|estimate|addon|customer_charge|invoice|qbo|lock|access|pin$|phone|rate$|paid|approval|drive_folder|hold_reason|checklist|bid_|scope_id|share_rev/i;

// ── 0. the allow-lists themselves ────────────────────────────────────────────────────────────────
{
  for (const [name, list] of Object.entries(A)) {
    if (name === 'OWNER_ATTACHMENT_TYPES' || name === 'OWNER_AUDIT_FIELDS') continue;
    const bad = list.filter(k => FORBIDDEN_NAME.test(k));
    t(`${name} names no internal field`, bad.length === 0, bad);
  }
  t('owners may see photos and receipts, never vendor bill / invoice files', !A.OWNER_ATTACHMENT_TYPES.some(x => ['bill', 'invoice', 'tax_id_doc', 'estimate'].includes(x)) && A.OWNER_ATTACHMENT_TYPES.includes('receipt'), A.OWNER_ATTACHMENT_TYPES);
  t('owner history fields name no internal field', A.OWNER_AUDIT_FIELDS.filter(k => FORBIDDEN_NAME.test(k)).length === 0, A.OWNER_AUDIT_FIELDS);
  t('every internal work-order fixture field is outside the allow-list (the fixture really tests something)', Object.keys(INTERNAL_WO).every(k => !A.OWNER_WO_VIEW_FIELDS.includes(k)));
}

// ── 1. /owner-workorders ─────────────────────────────────────────────────────────────────────────
{
  const r = await call('GET', '/owner-workorders?include_closed=true', OWN1);
  t('owner work orders: 200, own job only', r.status === 200 && Array.isArray(r.json) && r.json.length === 1 && r.json[0].ID === 'WO-1', r);
  t('owner work orders: NO internal value leaves the server', !r.text.includes(LEAK), r.text.slice(0, 400));
  const wo = (r.json || [])[0] || {};
  t('owner work orders: only allow-listed keys', extraKeys(wo, A.OWNER_WO_VIEW_FIELDS).length === 0, extraKeys(wo, A.OWNER_WO_VIEW_FIELDS));
  for (const k of ['Admin_Notes', 'Vendor_Admin_Notes', 'Estimate_Revised', 'Addon_Amount', 'Addon_Items_JSON', 'Max_Price', 'Deposit_Amount', 'Customer_Charge', 'QBO_Bill_Number', 'Invoice_ID', 'Vendor_ID', 'vendor_phone', 'tenant_phone', 'lockboxes', 'legacy_lockbox', 'access_notes', 'Brand_New_Internal_Column'])
    t(`owner work orders: no "${k}" key at all`, !(k in wo), wo[k]);
  // nothing the owner page draws went missing
  t('owner work orders: the fields owner.html draws are all still there', wo.ID === 'WO-1' && wo.Property_ID === 'P1' && wo.Trade === 'Plumbing' && wo.Description === 'leak under sink' && wo.Priority === 'normal' && wo.Status === 'Pending Invoice'
    && wo.Display_Status === 'Complete' && wo.Scheduled_Date === '2026-10-05' && wo.Created_Date === '2026-10-01' && wo.Notes === 'shared note' && wo.Owner_WO_Ref === 'REF-9' && wo.Managed_By === 'RidgeCo' && wo.Tenant_Visible === 'TRUE'
    && wo.property_address === '1 Main St' && wo.unit_label === '1A' && wo.vendor_name === 'Vee One', wo);
  // every field owner.html reads off a work order is in the allow-list (so a page change cannot silently read a stripped field)
  const page = fs.readFileSync(root + 'owner.html', 'utf8');
  const used = [...new Set([...page.matchAll(/\b(?:wo|w)\.([A-Za-z_][A-Za-z_0-9]*)/g)].map(m => m[1]))].filter(k => /^[A-Z]/.test(k) || /_/.test(k)).filter(k => k !== 'Address');   // wo.Address is only an "||" fallback that never existed on the row
  t('every work-order field owner.html reads is allow-listed', used.every(k => A.OWNER_WO_VIEW_FIELDS.includes(k)), used.filter(k => !A.OWNER_WO_VIEW_FIELDS.includes(k)));
  const admin = await call('GET', '/owner-workorders?owner_id=O1&include_closed=true', SECRET);
  t('admin secret: unchanged, still the whole row', admin.status === 200 && admin.json[0].Admin_Notes === 'LEAK admin note' && 'lockboxes' in admin.json[0], admin.json && Object.keys(admin.json[0] || {}).length);
}

// ── 2. /owner-properties ─────────────────────────────────────────────────────────────────────────
{
  const r = await call('GET', '/owner-properties', OWN1);
  t('owner properties: 200, own property only', r.status === 200 && r.json.length === 1 && r.json[0].ID === 'P1', r);
  t('owner properties: NO internal value (lock codes, access notes, QuickBooks ids) leaves the server', !r.text.includes(LEAK), r.text.slice(0, 400));
  const p = r.json[0] || {};
  t('owner properties: only allow-listed keys', extraKeys(p, A.OWNER_PROPERTY_FIELDS.concat(['units'])).length === 0, extraKeys(p, A.OWNER_PROPERTY_FIELDS.concat(['units'])));
  t('owner properties: units only allow-listed keys', Array.isArray(p.units) && p.units.length === 1 && extraKeys(p.units[0], A.OWNER_UNIT_FIELDS).length === 0, p.units);
  t('owner properties: what the page draws is still there', p.Address === '1 Main St' && p.City === 'Baltimore' && p.units[0].ID === 'U1' && p.units[0].Unit_Label === '1A', p);
  const admin = await call('GET', '/owner-properties?owner_id=O1', SECRET);
  t('admin secret: unchanged, whole property row', admin.status === 200 && admin.json[0].Lockbox_Code === 'LEAK-1234', admin);
}

// ── 3. /wo-audit ─────────────────────────────────────────────────────────────────────────────────
{
  const r = await call('GET', '/wo-audit?wo_id=WO-1', OWN1);
  t('owner history: 200', r.status === 200 && Array.isArray(r.json), r);
  t('owner history: NO internal value leaves the server (no vendor price, no internal note, no message text)', !r.text.includes(LEAK), r.text.slice(0, 600));
  t('owner history: exactly the owner-visible lines (status, priority, the text sent to the owner)', (r.json || []).map(a => a.ID).join() === '1,2,10', (r.json || []).map(a => a.ID + ':' + a.Field));
  t('owner history: only allow-listed columns', (r.json || []).every(a => extraKeys(a, A.OWNER_AUDIT_ROW_FIELDS.concat(A.OWNER_AUDIT_MESSAGE_FIELDS)).length === 0), r.json);
  t('owner history: no message body, ever', (r.json || []).every(a => !('Message_Body' in a) && !('Original_Body' in a) && !('Recipient_Name' in a)), r.json);
  t('owner history: a normal line keeps who / when / what changed', r.json[0].Changed_By === 'Brett' && r.json[0].Field === 'Status' && r.json[0].Old_Value === 'New' && r.json[0].New_Value === 'Assigned' && r.json[0].Timestamp === '2026-10-01T10:00:00Z' && r.json[0].Notes === 'assigned', r.json[0]);
  const admin = await call('GET', '/wo-audit?wo_id=WO-1', SECRET);
  t('admin secret: unchanged, every history row with its message text', admin.status === 200 && admin.json.length === 12 && admin.json.some(a => /\$1,300\.00/.test(a.Message_Body || '')), admin.json && admin.json.length);
  // a failed read is no longer an empty list
  const saved = store.tabs.get('WO_Audit'); store.tabs.delete('WO_Audit');
  const broken = await call('GET', '/wo-audit?wo_id=WO-1', OWN1);
  store.tabs.set('WO_Audit', saved);
  t('owner history: a failed read is an error the page can show, not an empty list', broken.status === 500 && broken.json && typeof broken.json.error === 'string' && !Array.isArray(broken.json), broken);
  const teleH = (store.tabs.get('Ops_Telemetry') || [[]])[0];
  t('owner history: the failed read is recorded (Ops_Telemetry, Success FALSE)', (store.tabs.get('Ops_Telemetry') || []).slice(1).some(row => row[teleH.indexOf('Job_Type')] === 'wo_audit_read_failed' && row[teleH.indexOf('Success')] === 'FALSE'));
}

// ── 4. /attachments ──────────────────────────────────────────────────────────────────────────────
{
  const r = await call('GET', '/attachments?wo_id=WO-1', OWN1);
  t('owner attachments: 200', r.status === 200 && Array.isArray(r.json), r);
  t('owner attachments: NO vendor bill / invoice / unknown-type row and no internal column', !r.text.includes(LEAK), r.text.slice(0, 400));
  t('owner attachments: photos and receipts are still listed', (r.json || []).map(a => a.File_Type).sort().join() === 'before,receipt', r.json);
  t('owner attachments: only allow-listed columns', (r.json || []).every(a => extraKeys(a, A.OWNER_ATTACHMENT_FIELDS).length === 0), r.json);
  t('owner attachments: the receipt row still carries what /owner-file/view needs', (r.json || []).some(a => a.File_Type === 'receipt' && a.Drive_File_ID === 'F2' && a.File_Name === 'receipt.jpg'), r.json);
  const admin = await call('GET', '/attachments?wo_id=WO-1', SECRET);
  t('admin secret: unchanged, all five rows', admin.status === 200 && admin.json.length === 5, admin.json && admin.json.length);
}

// ── 5. the other owner read routes carry nothing internal either ─────────────────────────────────
const COVERED_GET = ['/owner-workorders', '/owner-properties', '/wo-audit', '/attachments', '/owner-notifications', '/owner/tenant-roster', '/owner-file/view', '/demo/test-status', '/push/vapid-key', '/push/devices', '/owner-by-pin'];
{
  const n = await call('GET', '/owner-notifications', OWN1);
  t('owner notifications: only the four settings', n.status === 200 && Object.keys(n.json).sort().join() === 'low,method,normal,urgent' && !n.text.includes(LEAK), n);
  const b = await call('POST', '/owner/get-billing?owner_id=O1', OWN1, {});   // a read that happens to be a POST route
  t('owner billing: only the owner\'s own billing fields, nothing internal', b.status === 200 && !b.text.includes(LEAK) && Object.keys(b.json).every(k => /^(owner_id|name|company|billing_(name|address|city|state|zip|phone|email)|qbo_customer_id)$/.test(k)), b);
  const ro = await call('GET', '/owner/tenant-roster', OWN1);
  t('owner tenant roster: no PIN and nothing internal', ro.status === 200 && !ro.text.includes(LEAK) && Object.keys(ro.json).sort().join() === 'max_rows,owner_id,properties,tenants', ro);
  const d = await call('GET', '/demo/test-status', OWN1);
  t('demo test status (not a demo owner): refused, nothing internal', d.status >= 400 && !d.text.includes(LEAK), d);
  for (const p of ['/push/vapid-key', '/push/devices']) { const r = await call('GET', p, OWN1); t(`${p}: nothing internal`, !r.text.includes(LEAK), r); }
  const f = await call('GET', '/owner-file/view?wo_id=WO-1&file_id=LEAK-F3', OWN1);
  t('owner file view: a vendor bill file is still refused', f.status === 404, f);
}

// ── 6. owner WRITE routes answer with nothing internal ───────────────────────────────────────────
{
  const posts = [
    ['/wo/owner-update', { wo_id: 'WO-1', owner_name: 'Olly', fields: { Owner_WO_Ref: 'REF-10' } }],
    ['/wo/add-note', { wo_id: 'WO-1', note: 'TEST note', author: 'Olly', author_role: 'owner' }],
    ['/wo/append-description', { wo_id: 'WO-1', text: 'TEST more detail', author: 'Olly', author_role: 'owner' }],
    ['/wo/set-tenant-visibility', { wo_id: 'WO-1', fields: { Tenant_Visible: 'FALSE' }, changed_by: 'Olly', changed_by_role: 'owner' }],
    ['/owner/notifications', { method: 'sms' }],
  ];
  for (const [p, body] of posts) { const r = await call('POST', p, OWN1, body); t(`POST ${p}: the answer carries nothing internal`, r.status < 500 && !r.text.includes(LEAK), r); }
  const again = await call('GET', '/owner-workorders?include_closed=true', OWN1);
  t('after the owner\'s own edits the list is still clean and shows the edit', again.status === 200 && !again.text.includes(LEAK) && again.json[0].Owner_WO_Ref === 'REF-10', again.text.slice(0, 300));
  const h = await call('GET', '/wo-audit?wo_id=WO-1', OWN1);
  t('after the owner\'s own edits the history is still clean and shows them', h.status === 200 && !h.text.includes(LEAK) && h.json.some(a => a.Field === 'Owner_WO_Ref' && a.New_Value === 'REF-10'), h.text.slice(0, 300));
}

// ── 7. tripwire: a NEW owner read route must be added to this test ───────────────────────────────
{
  const scope = /owner:\s*\[([^\]]*)\]/.exec(/const ROLE_SCOPES = \{[\s\S]*?\n\};/.exec(wsrc)[0])[1].match(/'[^']+'/g).map(x => x.slice(1, -1));
  const getBlock = wsrc.slice(wsrc.indexOf("if (request.method === 'GET') {"), wsrc.indexOf("if (request.method === 'POST') {"));
  const isGet = (p) => getBlock.includes(`path === '${p}'`);
  const uncovered = scope.filter(isGet).filter(p => !COVERED_GET.includes(p));
  t('every GET route an owner session can reach is covered above (add a check here when you add one)', uncovered.length === 0, uncovered);
  t('the owner scope still lists the read routes this test covers', ['/owner-workorders', '/owner-properties', '/wo-audit', '/attachments'].every(p => scope.includes(p)), scope);
  t('an owner session never reaches the raw sheet-backed lists', ['/workorders', '/vendor-bills', '/estimates', '/receipts', '/time-entries', '/vendors', '/properties', '/invoices', '/invoice-review'].every(p => !scope.includes(p)), scope);
}

console.log(`owner-allowlist: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
