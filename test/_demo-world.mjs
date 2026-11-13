// Shared harness for the demo tests that need a richer sheet (sample data, test-send). Drives the REAL worker.js over a fake Google Sheets, fake Twilio, fake Gmail and fake QuickBooks.
// Not a test itself (the leading underscore keeps it out of `node --test test/*.test.mjs`).
// Brett's rule: nothing in the demo may ever text or email a real tenant, vendor, Brett or a random number. The only real contact is the prospect's own phone/email,
// and only SMS 2 / email 5 PER TEST (owner test and tenant test counted separately). The guard sits in the transport (sendSMSRaw, every Gmail send, pushSendOne).
// This file drives the REAL worker.js over a fake Google Sheets with a fake Twilio and fake Gmail and asserts what actually leaves the building.
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');

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
    if (method === 'POST' && path === ':batchUpdate') {
      for (const r of body.requests || []) {
        if (r.addSheet) tabs.set(r.addSheet.properties.title, []);
        if (r.deleteDimension) { const names = [...tabs.keys()], nm = names[r.deleteDimension.range.sheetId - 1]; tabs.get(nm).splice(r.deleteDimension.range.startIndex, 1); }
      }
      return {};
    }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  return st;
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
const outbound = []; const qbMode = { fail: false, created: 0 };
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const b = init && init.body ? JSON.parse(init.body) : undefined; const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  const bodyText = init && init.body ? String(init.body) : '';
  outbound.push({ method, url, body: bodyText });
  if (/api\.twilio\.com\/.*Messages\.json$/.test(url) && method === 'POST') return new Response(JSON.stringify({ sid: 'SMTEST' + outbound.length, num_segments: '1', status: 'queued' }), { status: 201 });
  if (/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/.test(url)) return new Response(JSON.stringify({ id: 'GMAIL' + outbound.length }), { status: 200 });
  if (/oauth\.platform\.intuit\.com/.test(url)) return new Response(JSON.stringify({ access_token: 'qbtok', refresh_token: 'qbrefresh' }), { status: 200 });
  if (/intuit\.com\//.test(url)) {
    if (method === 'GET') return new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 });
    if (qbMode.fail) return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'QB is down (test)' }] } }), { status: 200 });
    qbMode.created++; return new Response(JSON.stringify({ Customer: { Id: 'QB' + (700 + qbMode.created) } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, id: 'DRIVEFILE', webViewLink: 'x' }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET, TWILIO_SID: 'ACtest', TWILIO_API_SID: 'SKtest', TWILIO_API_KEY: 'secret', TWILIO_FROM: '+14105550100', GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x', QB_CLIENT_ID: 'qid', QB_CLIENT_SECRET: 'qsec', QB_REALM_ID: '999', QB_REFRESH_TOKEN: 'qr' };
let skew = 0; const advance = (ms) => { skew += ms; }; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;
const call = async (method, path, token, body) => {
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) {}
  return { status: res.status, json: j, text };
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mint = (role, id) => { const now = Math.floor(Date.now() / 1000); const body = b64u(JSON.stringify({ role, id, iat: now, exp: now + 3600 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);

const OH = ['ID', 'First_Name', 'Last_Name', 'Company', 'Phone', 'Email', 'PIN', 'Active', 'QBO_Customer_ID'];
const TH = ['ID', 'First_Name', 'Last_Name', 'Phone', 'Email', 'PIN', 'Active', 'Property_ID', 'Unit_ID', 'Move_Out_Date'];
tab('Owners', OH, [{ ID: '12', First_Name: 'Rita', Last_Name: 'Real', Phone: '+14105550122', Email: 'rita@real.example', PIN: 'RIT12345', Active: 'TRUE' }]);
tab('Tenants', TH, [{ ID: '40', First_Name: 'Tess', Last_Name: 'Real', Phone: '+14105550123', Email: 'tess@real.example', PIN: 'TES12345', Active: 'TRUE', Property_ID: '7', Unit_ID: '9' }]);
tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: '7', Owner_ID: '12', Address: '500 Real Street', Active: 'TRUE' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [{ ID: '9', Property_ID: '7', Unit_Label: '1', Active: 'TRUE' }]);
tab('Owner_Users', ['ID', 'Owner_ID', 'First_Name', 'Last_Name', 'Phone', 'PIN', 'Active'], []);
tab('Vendors', ['ID', 'Name', 'Phone', 'PIN', 'Active'], [{ ID: '3', Name: 'Real Vendor', Phone: '+14105550177', PIN: 'VEN12345', Active: 'TRUE' }]);
store.tabs.set('Config', [['TWILIO_ENABLED', 'TRUE'], ['admin_phone', '+14105550111'], ['SMS_TEST_MODE', 'FALSE']]);
tab('Ops_Telemetry', ['ID', 'Timestamp', 'Source', 'Job_Type', 'Skill_Or_Endpoint', 'Success', 'Latency_ms', 'Notes', 'Model', 'Tokens_In', 'Tokens_Out', 'Cost_USD'], []);
const adminCall = (method, path, body) => call(method, path, SECRET, body);
const rows = (name) => { const r = store.tabs.get(name), h = r[0]; return r.slice(1).map(x => { const o = {}; h.forEach((c, i) => o[c] = x[i] === undefined ? '' : x[i]); return o; }); };
const rowOf = (name, id) => rows(name).find(r => r.ID === id);
const telem = (type) => rows('Ops_Telemetry').filter(r => !type || r.Job_Type === type);
const twilioPosts = () => outbound.filter(o => /api\.twilio\.com\/.*Messages\.json$/.test(o.url) && o.method === 'POST');
const PH1 = '(410) 555-0133', PH1N = '+14105550133', PH2 = '4105550144', PH2N = '+14105550144';
const login = (kind, name, pin) => call('GET', `/${kind}-by-pin?pin=${encodeURIComponent(pin)}&name=${encodeURIComponent(name)}`);

// Fuller sheet shapes than the slots test: the seed writes more Work_Orders / Attachments columns.
const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Tenant_ID', 'Vendor_ID', 'Type', 'Trade', 'Description', 'Priority', 'Status', 'Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Invoice_ID', 'Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Vendor_SMS_Sent', 'Tenant_SMS_Sent', 'Owner_Notify_Override', 'Owner_Notified', 'Created_By', 'Created_Date', 'Notes'];
const AH = ['ID', 'WO_ID', 'File_Name', 'File_Type', 'Drive_File_ID', 'Drive_URL', 'Mime_Type', 'Created_Date', 'Active', 'Uploaded_By'];
tab('Work_Orders', [...WOH], [{ ID: 'WO-100', Property_ID: '7', Unit_ID: '9', Status: 'Assigned', Description: 'real leak', Vendor_ID: '3' }]);
tab('Attachments', [...AH], [{ ID: '1', WO_ID: 'WO-100', File_Name: 'real.jpg', File_Type: 'before', Drive_URL: 'https://drive.example/real', Active: 'TRUE' }]);
tab('Keys', ['ID', 'Property_ID', 'Unit_ID', 'Active'], []);
const realWo = () => { const w = rowOf('Work_Orders', 'WO-100'), a = rowOf('Attachments', '1'); return JSON.stringify(WOH.map(k => w[k])) + JSON.stringify(AH.map(k => a[k])); };
const realWoBefore = realWo();

const grab = (name) => { const i = wsrc.indexOf('function ' + name + '('); let j = wsrc.indexOf('{', i), d = 0, k = j; for (; k < wsrc.length; k++) { const c = wsrc[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } } return wsrc.slice(i, k + 1); };
const grabConst = (n) => { const m = new RegExp('^const ' + n + ' = [^\\n]*;$', 'm').exec(wsrc); if (!m) throw new Error('const not found ' + n); return m[0]; };
export { root, wsrc, store, outbound, qbMode, worker, env, SECRET, advance, call, mint, tab, adminCall, rows, rowOf, telem, twilioPosts, login, PH1, PH1N, PH2, PH2N, realWo, realWoBefore, WOH, AH, grab, grabConst };
