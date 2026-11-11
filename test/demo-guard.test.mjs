// DEMO SAFETY GUARD (Nov 11 2026, Brett's demo owner/tenant portal).
// Brett's rule: nothing in the demo may ever text or email a real tenant, vendor, Brett or a random number. The only real contact is the prospect's own phone/email,
// and only SMS 2 / email 5 PER TEST (owner test and tenant test counted separately). The guard sits in the transport (sendSMSRaw, every Gmail send, pushSendOne).
// This file drives the REAL worker.js over a fake Google Sheets with a fake Twilio and fake Gmail and asserts what actually leaves the building.
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
  const bodyText = init && init.body ? String(init.body) : '';
  outbound.push({ method, url, body: bodyText });
  if (/api\.twilio\.com\/.*Messages\.json$/.test(url) && method === 'POST') return new Response(JSON.stringify({ sid: 'SMTEST' + outbound.length, num_segments: '1', status: 'queued' }), { status: 201 });
  if (/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/.test(url)) return new Response(JSON.stringify({ id: 'GMAIL' + outbound.length }), { status: 200 });
  return new Response(JSON.stringify({ ok: true, id: 'DRIVEFILE', webViewLink: 'x' }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET, TWILIO_SID: 'ACtest', TWILIO_API_SID: 'SKtest', TWILIO_API_KEY: 'secret', TWILIO_FROM: '+14105550100', GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x' };
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
const SRC = wsrc;
// ---- pull pure functions out of worker.js source (brace matched) so the decision table is tested directly ----
function grab(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  let j = SRC.indexOf('{', i), depth = 0, k = j;
  for (; k < SRC.length; k++) { const c = SRC[k]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  return SRC.slice(i, k + 1);
}
const pure = new Function('normalizePhone', 'DEMO_SMS_CAP', 'DEMO_EMAIL_CAP', ['demoTrue', 'demoEmailKey', 'demoEmailList', 'demoBuildRegistry', 'demoRefersToDemo', 'demoGuardDecide'].map(grab).join('\n') + '\nreturn { demoTrue, demoEmailList, demoBuildRegistry, demoRefersToDemo, demoGuardDecide };');
const normalizePhone = new Function(grab('normalizePhone') + '\nreturn normalizePhone;')();
const P = pure(normalizePhone, 2, 5);

const PHONE_A = '+14105550133', PHONE_B = '+14105550144', BRETT = '+14105550111', REALTEN = '+14105550122', FAKE = '+12025550148';
const OH = ['ID', 'First_Name', 'Phone', 'Email', 'PIN', 'Active', 'Is_Demo', 'Demo_Prospect', 'Demo_Slot', 'Demo_Expires', 'Demo_SMS_Count', 'Demo_Email_Count', 'Welcome_Sent', 'Welcome_Sent_Date', 'Welcome_Send_Result', 'PIN_Sent_Date', 'PIN_Sent_Count'];
const TH = ['ID', 'First_Name', 'Phone', 'Email', 'PIN', 'Active', 'Property_ID', 'Unit_ID', 'Is_Demo', 'Demo_Prospect', 'Demo_Slot', 'Demo_Expires', 'Demo_SMS_Count', 'Demo_Email_Count', 'PIN_Sent_Date', 'PIN_Sent_Count', 'Move_Out_Date'];
const owners = [
  { ID: 'O-REAL', First_Name: 'Rita', Phone: REALTEN, Email: 'rita@real.example', PIN: 'RIT12345', Active: 'TRUE' },
  { ID: 'DEMO-O1', Demo_Prospect: 'TRUE', First_Name: 'Pat', Phone: PHONE_A, Email: 'pat@prospect.example', PIN: 'PAT12345', Active: 'TRUE', Is_Demo: 'TRUE', Demo_Slot: '1', Demo_SMS_Count: '0', Demo_Email_Count: '0' },
  { ID: 'DEMO-O2', Demo_Prospect: 'TRUE', First_Name: 'Bo', Phone: PHONE_B, Email: 'bo@prospect.example', PIN: 'BOB12345', Active: 'TRUE', Is_Demo: 'TRUE', Demo_Slot: '2', Demo_SMS_Count: '0', Demo_Email_Count: '0' },
];
const tenants = [
  { ID: 'T-REAL', First_Name: 'Tess', Phone: REALTEN, Email: 'tess@real.example', PIN: 'TES12345', Active: 'TRUE', Property_ID: 'P-REAL', Unit_ID: 'U-REAL' },
  { ID: 'DEMO-T1', Demo_Prospect: 'TRUE', First_Name: 'Pat', Phone: PHONE_A, Email: 'pat@prospect.example', PIN: 'PAT12345', Active: 'TRUE', Property_ID: 'DEMO-P1', Unit_ID: 'DEMO-U1', Is_Demo: 'TRUE', Demo_Slot: '1', Demo_SMS_Count: '0', Demo_Email_Count: '0' },
  { ID: 'DEMO-T2', First_Name: 'Fiona', Phone: FAKE, Email: '', PIN: 'FIO12345', Active: 'TRUE', Property_ID: 'DEMO-P1', Unit_ID: 'DEMO-U2', Is_Demo: 'TRUE', Demo_Slot: '1', Demo_SMS_Count: '0', Demo_Email_Count: '0' },
  { ID: 'DEMO-T3', Demo_Prospect: 'TRUE', First_Name: 'Bo', Phone: PHONE_B, Email: 'bo@prospect.example', PIN: 'BOB12345', Active: 'TRUE', Property_ID: 'DEMO-P2', Unit_ID: 'DEMO-U3', Is_Demo: 'TRUE', Demo_Slot: '2', Demo_SMS_Count: '0', Demo_Email_Count: '0' },
];
const properties = [
  { ID: 'P-REAL', Owner_ID: 'O-REAL', Address: '500 Real Street', Active: 'TRUE' },
  { ID: 'DEMO-P1', Owner_ID: 'DEMO-O1', Demo_Prospect: 'TRUE', Address: '12 Fictional Lane', Active: 'TRUE', Is_Demo: 'TRUE' },
  { ID: 'DEMO-P2', Owner_ID: 'DEMO-O2', Demo_Prospect: 'TRUE', Address: '34 Imaginary Court', Active: 'TRUE', Is_Demo: 'TRUE' },
];
const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Tenant_ID', 'Status', 'Voided', 'Type', 'Description', 'Is_Demo'];
tab('Owners', OH, owners); tab('Tenants', TH, tenants); tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active', 'Is_Demo'], properties);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [{ ID: 'U-REAL', Property_ID: 'P-REAL', Unit_Label: '1', Active: 'TRUE' }, { ID: 'DEMO-U1', Property_ID: 'DEMO-P1', Unit_Label: '1', Active: 'TRUE' }, { ID: 'DEMO-U2', Property_ID: 'DEMO-P1', Unit_Label: '2', Active: 'TRUE' }, { ID: 'DEMO-U3', Property_ID: 'DEMO-P2', Unit_Label: '1', Active: 'TRUE' }]);
tab('Work_Orders', WOH, [
  { ID: 'WO-100', Property_ID: 'P-REAL', Unit_ID: 'U-REAL', Status: 'Assigned', Description: 'real leak' },
  { ID: 'WO-5001', Property_ID: 'DEMO-P1', Unit_ID: 'DEMO-U1', Status: 'Assigned', Description: 'demo leak', Is_Demo: 'TRUE' },
  { ID: 'WO-5002', Property_ID: 'DEMO-P1', Unit_ID: 'DEMO-U2', Status: 'New', Description: 'request the prospect typed in (not flagged, but on a demo property)' },
]);
store.tabs.set('Config', [['TWILIO_ENABLED', 'TRUE'], ['admin_phone', BRETT], ['SMS_TEST_MODE', 'FALSE']]);
const cfgRows = () => store.tabs.get('Config');
tab('Ops_Telemetry', ['ID', 'Timestamp', 'Source', 'Job_Type', 'Skill_Or_Endpoint', 'Success', 'Latency_ms', 'Notes', 'Model', 'Tokens_In', 'Tokens_Out', 'Cost_USD'], []);
const _h = store.handle;
store.handle = async (method, path, body) => { const m = /^\/values\/([^!:?]+)!1:1$/.exec(path); if (method === 'GET' && m) { const n = decodeURIComponent(m[1]); if (!store.tabs.has(n)) return { error: { code: 400, message: 'Unable to parse range: ' + n } }; return { range: n, values: [store.tabs.get(n)[0].slice()] }; } return _h(method, path, body); };
tab('Message_Templates', ['ID', 'Type', 'Channel', 'Subject', 'Body', 'Active'], []);
const adminCall = (method, path, body) => call(method, path, SECRET, body);
const rowOf = (tabName, id) => { const rows = store.tabs.get(tabName), h = rows[0], r = rows.find((x, i) => i > 0 && x[h.indexOf('ID')] === id); const o = {}; h.forEach((c, i) => o[c] = r ? r[i] : undefined); return o; };
const twilioPosts = () => outbound.filter(o => /api\.twilio\.com\/.*Messages\.json$/.test(o.url) && o.method === 'POST');
const gmailPosts = () => outbound.filter(o => /gmail\.googleapis\.com.*messages\/send/.test(o.url));
const twilioTo = (o) => decodeURIComponent((/To=([^&]+)/.exec(o.body) || [])[1] || '');
const telem = () => { const rows = store.tabs.get('Ops_Telemetry'), h = rows[0]; return rows.slice(1).map(r => { const o = {}; h.forEach((c, i) => o[c] = r[i]); return o; }); };

// ===== 1. The decision table (pure) =====
const nowMs = Date.parse('2026-11-11T15:00:00Z');
const reg = P.demoBuildRegistry(owners, tenants, [{ ID: 'WO-100', Property_ID: 'P-REAL' }, { ID: 'WO-5001', Property_ID: 'DEMO-P1', Is_Demo: 'TRUE' }, { ID: 'WO-5002', Property_ID: 'DEMO-P1' }], properties, nowMs);
t('registry is null on a sheet with no demo rows', P.demoBuildRegistry([{ ID: 'a', Phone: '4105550000' }], [], [], [{ ID: 'p' }], nowMs) === null);
t('registry knows demo WOs, including an unflagged one on a demo property', reg.woIds.has('WO-5001') && reg.woIds.has('WO-5002') && !reg.woIds.has('WO-100'));
t('plain real contact passes', P.demoGuardDecide(reg, { channel: 'sms', to: [REALTEN], text: 'WO-100 scheduled' }).action === 'pass');
t('demo WO number in a text to Brett is blocked', P.demoGuardDecide(reg, { channel: 'sms', to: [BRETT], text: 'Tenant note on WO-5001: leak' }).action === 'block');
t('demo WO written WO 5002 / WO#5002 is still caught', P.demoGuardDecide(reg, { channel: 'sms', to: [BRETT], text: 'new request WO#5002' }).action === 'block' && P.demoGuardDecide(reg, { channel: 'sms', to: [BRETT], text: 'new request WO 5002' }).action === 'block');
t('demo property address in a text to a vendor is blocked', P.demoGuardDecide(reg, { channel: 'sms', to: [FAKE.replace('48', '99')], text: 'Please quote 12 fictional lane, unit 2' }).action === 'block');
t('ctx.wo_id alone is enough to block', P.demoGuardDecide(reg, { channel: 'sms', to: [BRETT], text: 'alert', woId: 'WO-5001' }).action === 'block');
t('text to the demo tenant with a fake number naming a demo WO is blocked (fake numbers are never texted)', P.demoGuardDecide(reg, { channel: 'sms', to: [FAKE], text: 'Your visit for WO-5001' }).action === 'block');
t('prospect phone within the cap is counted', P.demoGuardDecide(reg, { channel: 'sms', to: [PHONE_A], text: 'WO-5001 done' }).action === 'count');
t('owner test: role chosen from the context', P.demoGuardDecide(reg, { channel: 'sms', to: [PHONE_A], text: 'x', recipientType: 'owner' }).entry.role === 'owner' && P.demoGuardDecide(reg, { channel: 'sms', to: [PHONE_A], text: 'x', recipientType: 'tenant' }).entry.role === 'tenant');
t('prospect mixed with a stranger in one email is blocked whole', P.demoGuardDecide(reg, { channel: 'email', to: ['pat@prospect.example', 'real@real.example'], text: 'x' }).action === 'block');
t('email address with a display name matches', P.demoEmailList('Pat <Pat@Prospect.example>')[0] === 'pat@prospect.example');
const regCap = P.demoBuildRegistry(owners.map(o => o.ID === 'DEMO-O1' ? Object.assign({}, o, { Demo_SMS_Count: '2', Demo_Email_Count: '5' }) : o), tenants, [], properties, nowMs);
t('SMS at the cap (2) is blocked as a test limit', (() => { const d = P.demoGuardDecide(regCap, { channel: 'sms', to: [PHONE_A], text: 'x', recipientType: 'owner' }); return d.action === 'block' && d.limit === true; })());
t('email at the cap (5) is blocked; 4 is still allowed', P.demoGuardDecide(regCap, { channel: 'email', to: ['pat@prospect.example'], text: 'x', recipientType: 'owner' }).action === 'block' && P.demoGuardDecide(P.demoBuildRegistry(owners.map(o => o.ID === 'DEMO-O1' ? Object.assign({}, o, { Demo_Email_Count: '4' }) : o), tenants, [], properties, nowMs), { channel: 'email', to: ['pat@prospect.example'], text: 'x', recipientType: 'owner' }).action === 'count');
t('owner test at its cap does NOT use up the tenant test (counted separately)', P.demoGuardDecide(regCap, { channel: 'sms', to: [PHONE_A], text: 'x', recipientType: 'tenant' }).action === 'count');
const regExp = P.demoBuildRegistry(owners.map(o => o.ID === 'DEMO-O1' ? Object.assign({}, o, { Demo_Expires: '2026-11-10T00:00:00Z' }) : o), tenants, [], properties, nowMs);
t('expired slot blocks the prospect contact', P.demoGuardDecide(regExp, { channel: 'sms', to: [PHONE_A], text: 'x', recipientType: 'owner' }).action === 'block');
const regBad = P.demoBuildRegistry(owners.map(o => o.ID === 'DEMO-O1' ? Object.assign({}, o, { Demo_Expires: 'garbage' }) : o), tenants, [], properties, nowMs);
t('an unreadable expiry counts as expired (fails closed)', P.demoGuardDecide(regBad, { channel: 'sms', to: [PHONE_A], text: 'x', recipientType: 'owner' }).action === 'block');
const regBlank = P.demoBuildRegistry(owners.map(o => o.ID === 'DEMO-O1' ? Object.assign({}, o, { Phone: '', Email: '' }) : o), tenants.map(x => x.ID === 'DEMO-T1' ? Object.assign({}, x, { Phone: '', Email: '' }) : x), [{ ID: 'WO-5001', Property_ID: 'DEMO-P1', Is_Demo: 'TRUE' }], properties, nowMs);
t('after a reset (slot contact blank) the old prospect phone is just an unknown number, and demo texts to it are blocked', P.demoGuardDecide(regBlank, { channel: 'sms', to: [PHONE_A], text: 'WO-5001 update' }).action === 'block');

// ===== 2. Through the real worker: what actually leaves =====
// 2a. A real, unrelated owner is untouched by the guard.
let before = twilioPosts().length;
let r = await adminCall('POST', '/welcome/send', { type: 'owner', id: 'O-REAL', message: 'Hi {FirstName}, real owner welcome one.' });
t('real owner text still goes out', r.status === 200 && twilioPosts().length === before + 1 && twilioTo(twilioPosts().at(-1)) === REALTEN, { status: r.status, body: r.text.slice(0, 200) });

// 2b. Owner test: 2 texts to the prospect, the 3rd is refused, Twilio sees exactly 2.
before = twilioPosts().length;
const o1 = await adminCall('POST', '/welcome/send', { type: 'owner', id: 'DEMO-O1', message: 'Owner test text one for Pat.' });
const o2 = await adminCall('POST', '/welcome/send', { type: 'owner', id: 'DEMO-O1', message: 'Owner test text two for Pat.' });
const o3 = await adminCall('POST', '/welcome/send', { type: 'owner', id: 'DEMO-O1', message: 'Owner test text three for Pat.' });
t('owner test: first two texts reach the prospect only', o1.status === 200 && o2.status === 200 && twilioPosts().slice(before).length === 2 && twilioPosts().slice(before).every(p => twilioTo(p) === PHONE_A), { o1: o1.text.slice(0, 120), o2: o2.text.slice(0, 120) });
t('owner test: the third text is refused as a test limit and Twilio is NOT called', o3.status === 502 && /test limit/i.test(o3.text) && twilioPosts().length === before + 2, { s: o3.status, b: o3.text.slice(0, 200) });
t('owner test counter reads 2 on the sheet', rowOf('Owners', 'DEMO-O1').Demo_SMS_Count === '2');
t('the other slot and real owner counters are untouched', rowOf('Owners', 'DEMO-O2').Demo_SMS_Count === '0' && rowOf('Owners', 'O-REAL').Demo_SMS_Count === undefined || rowOf('Owners', 'O-REAL').Demo_SMS_Count === '');

// 2c. Tenant test is counted separately from the owner test (same prospect phone).
before = twilioPosts().length;
const sendPin = async (pin) => { const rows = store.tabs.get('Tenants'), h = rows[0], i = rows.findIndex((x, k) => k > 0 && x[h.indexOf('ID')] === 'DEMO-T1'); rows[i][h.indexOf('PIN')] = pin; return adminCall('POST', '/send-pin', { type: 'tenant', id: 'DEMO-T1' }); };
const p1 = await sendPin('PAT23456'), p2 = await sendPin('PAT34567'), p3 = await sendPin('PAT45678');
t('tenant test: two texts reach the prospect even though the owner test is used up', p1.status === 200 && p2.status === 200 && twilioPosts().slice(before).length === 2 && twilioPosts().slice(before).every(p => twilioTo(p) === PHONE_A), { p1: p1.text.slice(0, 160), p2: p2.text.slice(0, 160) });
t('tenant test: third text refused, Twilio not called', p3.status === 502 && /test limit/i.test(p3.text) && twilioPosts().length === before + 2, { s: p3.status, b: p3.text.slice(0, 200) });
t('tenant counter is its own (2) and owner counter stays 2', rowOf('Tenants', 'DEMO-T1').Demo_SMS_Count === '2' && rowOf('Owners', 'DEMO-O1').Demo_SMS_Count === '2');

// 2d. A demo tenant with a fake number never reaches Twilio.
before = twilioPosts().length;
const f1 = await (async () => { const rows = store.tabs.get('Tenants'), h = rows[0], i = rows.findIndex((x, k) => k > 0 && x[h.indexOf('ID')] === 'DEMO-T2'); rows[i][h.indexOf('PIN')] = 'FIO23456'; return adminCall('POST', '/send-pin', { type: 'tenant', id: 'DEMO-T2' }); })();
t('fake-number demo tenant: PIN text is not sent (the PIN text names the demo property address)', twilioPosts().length === before, { s: f1.status, b: f1.text.slice(0, 200) });

// 2e. A text to Brett about a demo work order is blocked at the transport; one about a real WO is not.
before = twilioPosts().length;
store.tabs.set('Config', [['TWILIO_ENABLED', 'TRUE'], ['admin_phone', BRETT], ['SMS_TEST_MODE', 'FALSE']]);
const ALERT = 'alert-token-for-tests-0123456789';
env.ALERT_PUSH_TOKEN = ALERT;
const adminNote = async (text) => { skew += 10000; const res = await worker.fetch(new Request(BASE + '/admin-notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': ALERT }, body: JSON.stringify({ text, source: 'test' }) }), env); return { status: res.status, text: await res.text() }; };
const a1 = await adminNote('Tenant note on WO-5001: the sink is leaking');
t('text to Brett naming a demo WO is NOT sent', twilioPosts().length === before, { s: a1.status, b: a1.text.slice(0, 200) });
const a2 = await adminNote('Tenant note on WO-100: the sink is leaking');
t('text to Brett naming a real WO IS still sent (guard does not disturb normal alerts)', twilioPosts().length === before + 1 && twilioTo(twilioPosts().at(-1)) === BRETT, { s: a2.status, b: a2.text.slice(0, 200) });

// 2f. Email: property notice to demo tenants. Prospect gets at most 5 (owner-role entry is not used: this is a tenant email), fake/blank-email tenants get nothing.
before = gmailPosts().length;
const emails = [];
for (let n = 1; n <= 6; n++) emails.push(await adminCall('POST', '/property/notice', { property_id: 'DEMO-P1', channels: ['email'], email_subject: 'Maintenance update ' + n + ' - 12 Fictional Lane', email_body: '<p>Notice ' + n + '</p>' }));
const sentMail = gmailPosts().slice(before);
t('tenant test email: exactly 5 emails leave, all to the prospect', sentMail.length === 5 && sentMail.every(m => /pat@prospect\.example/i.test(Buffer.from((JSON.parse(m.body).raw || ''), 'base64url').toString('utf8').split('\r\n').find(l => /^To:/i.test(l)) || '')), { n: sentMail.length });
t('tenant email counter reads 5; owner email counter untouched', rowOf('Tenants', 'DEMO-T1').Demo_Email_Count === '5' && rowOf('Owners', 'DEMO-O1').Demo_Email_Count === '0');
t('the sixth notice was refused, not sent', emails.length === 6 && sentMail.length === 5);

// 2g. Slots are isolated: prospect B still has a full allowance and prospect A's events never reach B.
before = twilioPosts().length;
const b1 = await adminCall('POST', '/welcome/send', { type: 'owner', id: 'DEMO-O2', message: 'Owner test text one for Bo.' });
t('second prospect keeps their own full allowance', b1.status === 200 && twilioPosts().length === before + 1 && twilioTo(twilioPosts().at(-1)) === PHONE_B && rowOf('Owners', 'DEMO-O2').Demo_SMS_Count === '1');

// 2h. Expired slot: the prospect phone is refused.
{
  const rows = store.tabs.get('Owners'), h = rows[0], i = rows.findIndex((x, k) => k > 0 && x[h.indexOf('ID')] === 'DEMO-O2');
  rows[i][h.indexOf('Demo_Expires')] = '2026-01-01T00:00:00Z';
  before = twilioPosts().length;
  const e1 = await adminCall('POST', '/welcome/send', { type: 'owner', id: 'DEMO-O2', message: 'Owner test text two for Bo.' });
  t('expired demo login: text refused, Twilio not called', e1.status === 502 && twilioPosts().length === before, { s: e1.status, b: e1.text.slice(0, 160) });
}

// 2i. Every block is on the record (Ops_Telemetry demo_send_blocked rows).
const blocks = telem().filter(x => x.Job_Type === 'demo_send_blocked');
t('blocked sends each left an Ops_Telemetry row (demo_send_blocked)', blocks.length >= 5, { n: blocks.length });
t('no telemetry row carries a full phone number', !telem().some(x => /\+?1?4105550\d{3}|2025550\d{3}/.test(String(x.Notes || ''))));


// A demo block is a calm, honest "skipped" in the queue and never a P0 failure alert.
{
  const outcome = new Function(grab('smsSendOutcome') + '\nreturn smsSendOutcome;')();
  // smsSendOutcome calls smsErrorInfo/smsMaskPhones only on the generic path; the demo branch must answer before that.
  const o = outcome({ skipped: true, demo_blocked: true, reason: 'text not sent: test limit reached (2 texts for the owner test)' });
  t('queue outcome for a demo block is skipped + blocked_demo, not failed', o.status === 'skipped' && o.errorCode === 'blocked_demo' && o.demoBlocked === true && o.sent === false && /test limit/.test(o.reason), o);
  t('a demo block can never be mistaken for a permanent Twilio refusal (no P2/P0 report)', !o.permanent);
}

// ===== 3. Static tripwires =====
t('every Gmail send path calls the demo guard', (() => {
  const fns = ['gmailSendEmail', 'gmailSendEmailWithAttachment', 'gmailSendEmailMulti', 'inspSendPartnerEmail', 'insbSendMail'];
  return fns.every(n => { const i = SRC.indexOf('async function ' + n + '('); return i > 0 && SRC.slice(i, i + 1400).includes('demoGuardEmail('); });
})());
t('there is no unguarded fetch to the Gmail send endpoint (every one sits inside a guarded function)', (() => {
  let idx = -1, ok = true; const needle = "gmail.googleapis.com/gmail/v1/users/me/messages/send";
  while ((idx = SRC.indexOf(needle, idx + 1)) >= 0) { const fnStart = SRC.lastIndexOf('\nasync function ', idx); const slice = SRC.slice(fnStart, idx); if (!slice.includes('demoGuardEmail(')) ok = false; }
  return ok;
})());
t('sendSMSRaw calls the demo guard before the Twilio fetch', (() => { const i = SRC.indexOf('async function sendSMSRaw('), g = SRC.indexOf('demoGuardSend(env', i), f = SRC.indexOf('api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json', i); return i > 0 && g > i && f > g; })());
t('there is exactly one Twilio Messages POST in the worker (no second path around the guard)', (SRC.match(/Messages\.json`, \{\s*method: 'POST'/g) || []).length === 1);
t('pushSendOne refuses demo recipients', (() => { const i = SRC.indexOf('async function pushSendOne('); return SRC.slice(i, i + 1500).includes('push is not used in the demo'); })());
t('the guard fails closed when the registry cannot be read', SRC.includes('demo guard unavailable (could not read the sheet): message held back'));
t('no swallowing catch in the demo guard block', (() => { const a = SRC.indexOf('// ── DEMO SAFETY GUARD'), b = SRC.indexOf('const PORTAL_TAB_BY_TYPE = '); const blk = SRC.slice(a, b); return !/catch\s*\([^)]*\)\s*\{\s*\}/.test(blk); })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
