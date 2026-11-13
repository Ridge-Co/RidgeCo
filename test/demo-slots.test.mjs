// DEMO SLOTS AND ADMIN (Nov 11 2026, Phase 2a of Brett's demo owner/tenant portal).
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

const OH = ['ID', 'First_Name', 'Last_Name', 'Company', 'Phone', 'Email', 'PIN', 'Active', 'QBO_Customer_ID'];
const TH = ['ID', 'First_Name', 'Last_Name', 'Phone', 'Email', 'PIN', 'Active', 'Property_ID', 'Unit_ID', 'Move_Out_Date'];
tab('Owners', OH, [{ ID: '12', First_Name: 'Rita', Last_Name: 'Real', Phone: '+14105550122', Email: 'rita@real.example', PIN: 'RIT12345', Active: 'TRUE' }]);
tab('Tenants', TH, [{ ID: '40', First_Name: 'Tess', Last_Name: 'Real', Phone: '+14105550123', Email: 'tess@real.example', PIN: 'TES12345', Active: 'TRUE', Property_ID: '7', Unit_ID: '9' }]);
tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: '7', Owner_ID: '12', Address: '500 Real Street', Active: 'TRUE' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [{ ID: '9', Property_ID: '7', Unit_Label: '1', Active: 'TRUE' }]);
tab('Work_Orders', ['ID', 'Property_ID', 'Unit_ID', 'Status', 'Description'], [{ ID: '100', Property_ID: '7', Unit_ID: '9', Status: 'Assigned', Description: 'real leak' }]);
tab('Attachments', ['ID', 'WO_ID', 'File_Name', 'File_Type', 'Drive_URL', 'Active'], [{ ID: '1', WO_ID: '100', File_Name: 'real.jpg', Active: 'TRUE' }]);
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
const REALKEYS = { Owners: OH.slice(0, 9), Tenants: TH.slice(0, 10), Properties: ['ID', 'Owner_ID', 'Address', 'Active'], Units: ['ID', 'Property_ID', 'Unit_Label', 'Active'], Work_Orders: ['ID', 'Property_ID', 'Unit_ID', 'Status', 'Description'], Attachments: ['ID', 'WO_ID', 'File_Name', 'Active'] };
const realSnap = () => JSON.stringify([['Owners', '12'], ['Tenants', '40'], ['Properties', '7'], ['Units', '9'], ['Work_Orders', '100'], ['Attachments', '1']].map(([tb, id]) => { const r = rowOf(tb, id); const o = {}; REALKEYS[tb].forEach(k => o[k] = r[k]); return o; }));
const realBefore = realSnap();

// ===== 1. Pure helpers =====
const grab = (name) => { const i = wsrc.indexOf('function ' + name + '('); let j = wsrc.indexOf('{', i), d = 0, k = j; for (; k < wsrc.length; k++) { const c = wsrc[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } } return wsrc.slice(i, k + 1); };
const grabConst = (n) => { const m = new RegExp('^const ' + n + ' = [^\\n]*;$', 'm').exec(wsrc); if (!m) throw new Error('const not found ' + n); return m[0]; };
const pure = new Function('DEMO_LOGIN_DAYS', 'DEMO_NEVER_LOGGED_DAYS', grabConst('DEMO_OWNER_IDLE') + '\n' + grabConst('DEMO_TENANT_IDLE') + '\n' + ['demoTrue', 'demoFixture', 'demoParseName', 'demoSlotState', 'demoSweepReason', 'demoTokenClaim'].map(grab).join('\n') + '\nreturn { demoFixture, demoParseName, demoSlotState, demoSweepReason, demoTokenClaim };')(10, 30);
const fx1 = pure.demoFixture(1), fx2 = pure.demoFixture(2);
t('fixture: 3 properties, 6 units, 1 owner, 1 tenant, all flagged demo', fx1.props.length === 3 && fx1.units.length === 6 && fx1.owner.Is_Demo === 'TRUE' && fx1.tenant.Is_Demo === 'TRUE' && fx1.props.every(p => p.Is_Demo === 'TRUE'));
t('fixture: every ID is unique across slots (no collision between slot 1 and 2)', ![...fx1.props, ...fx1.units, fx1.owner, fx1.tenant].some(a => [...fx2.props, ...fx2.units, fx2.owner, fx2.tenant].some(b => b.ID === a.ID)));
t('fixture: same addresses in every slot (same data for every prospect)', fx1.props.map(p => p.Address).join('|') === fx2.props.map(p => p.Address).join('|'));
t('fixture: idle slot has no contact and cannot log in (Active FALSE, no PIN)', fx1.owner.Phone === '' && fx1.owner.Email === '' && fx1.owner.PIN === '' && fx1.owner.Active === 'FALSE' && fx1.tenant.Active === 'FALSE');
t('name parsing', pure.demoParseName({ name: 'Maria  Lopez Diaz' }).first === 'Maria' && pure.demoParseName({ name: 'Maria' }).last === '' && pure.demoParseName({ name: '' }) === null && pure.demoParseName({ first_name: '<script>' }) === null);
const T0 = Date.parse('2026-11-11T12:00:00Z');
t('slot state: free / waiting / active / expired / unreadable = expired', pure.demoSlotState({ Demo_Prospect: 'FALSE' }, T0) === 'free' && pure.demoSlotState({ Demo_Prospect: 'TRUE' }, T0) === 'waiting for first login' && pure.demoSlotState({ Demo_Prospect: 'TRUE', Demo_Expires: '2026-11-20T00:00:00Z' }, T0) === 'active' && pure.demoSlotState({ Demo_Prospect: 'TRUE', Demo_Expires: '2026-11-01T00:00:00Z' }, T0) === 'expired' && pure.demoSlotState({ Demo_Prospect: 'TRUE', Demo_Expires: 'garbage' }, T0) === 'expired');
const own = (x) => Object.assign({ Is_Demo: 'TRUE', Demo_Prospect: 'TRUE' }, x);
t('sweep reason: expired clears; waiting under 30 days stays; waiting over 30 days clears; unreadable added date clears; active stays; non-prospect never', pure.demoSweepReason(own({ Demo_Expires: '2026-11-01T00:00:00Z' }), T0) !== '' && pure.demoSweepReason(own({ Demo_Added: '2026-11-01T00:00:00Z' }), T0) === '' && pure.demoSweepReason(own({ Demo_Added: '2026-09-01T00:00:00Z' }), T0) !== '' && pure.demoSweepReason(own({ Demo_Added: 'x' }), T0) !== '' && pure.demoSweepReason(own({ Demo_Expires: '2026-12-01T00:00:00Z' }), T0) === '' && pure.demoSweepReason({ Is_Demo: 'TRUE', Demo_Prospect: 'FALSE' }, T0) === '');
t('token claim only on demo rows', pure.demoTokenClaim({ Is_Demo: 'TRUE', Demo_Slot: '2' }).demo === '2' && Object.keys(pure.demoTokenClaim({ ID: '12' })).length === 0);

// ===== 2. Admin gate: only the admin secret may use the demo routes =====
t('owner/tenant/vendor sessions cannot reach the demo admin routes', (await call('GET', '/demo/slots', mint('owner', '12'))).status === 401 && (await call('POST', '/demo/add', mint('tenant', '40'), { name: 'X', phone: PH1, email: 'a@b.co' })).status === 401 && (await call('POST', '/demo/convert', mint('owner', '12'), { slot: 1 })).status === 401 && (await call('POST', '/demo/sweep', mint('vendor', '1'))).status === 401);
t('no demo route without a token', (await call('GET', '/demo/slots')).status === 401);

// ===== 3. Add a prospect =====
let r = await adminCall('GET', '/demo/slots');
t('slots list: 3 slots, all "not set up" on a fresh sheet', r.status === 200 && r.json.slots.length === 3 && r.json.slots.every(s => s.state === 'not set up'), r.json);
t('add: refuses without a phone, a bad email, a bad name (nothing written)', (await adminCall('POST', '/demo/add', { name: 'Ann', email: 'ann@x.co' })).status === 400 && (await adminCall('POST', '/demo/add', { name: 'Ann', phone: PH1 })).status === 400 && (await adminCall('POST', '/demo/add', { name: '', phone: PH1, email: 'ann@x.co' })).status === 400 && !store.tabs.get('Owners')[0].includes('Is_Demo'));
r = await adminCall('POST', '/demo/add', { name: 'Ann Prospect', phone: PH1, email: 'Ann@Prospect.example' });
t('add: succeeds, slot 1, PIN is 3 letters + 5 digits', r.status === 200 && r.json.slot === 1 && /^[A-Za-z]{3}\d{5}$/.test(r.json.pin) && r.json.login_name === 'Ann', r.json);
const PIN1 = r.json && r.json.pin;
const o1 = rowOf('Owners', 'DO1'), t1 = rowOf('Tenants', 'DT1');
t('add: owner and tenant carry the prospect contact, share one PIN, are flagged demo + prospect', o1 && t1 && o1.Phone === PH1N && t1.Phone === PH1N && o1.Email === 'ann@prospect.example' && t1.Email === 'ann@prospect.example' && o1.PIN === PIN1 && t1.PIN === PIN1 && o1.Is_Demo === 'TRUE' && t1.Is_Demo === 'TRUE' && o1.Demo_Prospect === 'TRUE' && t1.Demo_Prospect === 'TRUE' && o1.Active === 'TRUE' && t1.Active === 'TRUE', { o1, t1 });
t('add: clock is NOT started yet (no expiry, no first login)', o1.Demo_Expires === '' && o1.Demo_First_Login === '' && t1.Demo_Expires === '' && o1.Demo_Added !== '');
t('add: 3 fictional properties and 6 units were created for the slot and the owner owns them', rows('Properties').filter(p => p.Demo_Slot === '1').length === 3 && rows('Units').filter(p => p.Demo_Slot === '1').length === 6 && rows('Properties').filter(p => p.Demo_Slot === '1').every(p => p.Owner_ID === 'DO1'));
t('add: the demo tenant lives in a slot unit; counters start at 0', t1.Property_ID === 'DP1A' && t1.Unit_ID === 'DU1A1' && o1.Demo_SMS_Count === '0' && t1.Demo_Email_Count === '0');
t('add: real rows untouched', realSnap() === realBefore, { a: realSnap(), b: realBefore });
t('add: the PIN is not held by any real user', !rows('Owners').concat(rows('Tenants'), rows('Vendors')).some(x => x.PIN === PIN1 && !String(x.ID).startsWith('D')));
t('add: sends nothing (no text, no email)', twilioPosts().length === 0 && outbound.length === 0, outbound.map(o => o.url));
t('add: a second add with the same phone is refused', (await adminCall('POST', '/demo/add', { name: 'Ann Again', phone: PH1, email: 'other@x.co' })).status === 409);
t('add: a second add with the same email is refused', (await adminCall('POST', '/demo/add', { name: 'Ann Again', phone: '4105550166', email: 'ann@prospect.example' })).status === 409);
r = await adminCall('POST', '/demo/add', { name: 'Bo Second', phone: PH2, email: 'bo@prospect.example' });
const PIN2 = r.json && r.json.pin;
t('two prospects: second goes to slot 2 with its own PIN', r.status === 200 && r.json.slot === 2 && PIN2 !== PIN1);
t('two prospects: slots 1 and 2 hold different owners, tenants and properties', rowOf('Owners', 'DO2').Phone === PH2N && rowOf('Tenants', 'DT2').Phone === PH2N && rowOf('Owners', 'DO1').Phone === PH1N && rows('Properties').filter(p => p.Demo_Slot === '2').every(p => p.Owner_ID === 'DO2'));
r = await adminCall('POST', '/demo/add', { name: 'Cy Third', phone: '4105550177', email: 'cy@prospect.example' });
t('third prospect takes slot 3', r.status === 200 && r.json.slot === 3);
r = await adminCall('POST', '/demo/add', { name: 'Di Fourth', phone: '4105550188', email: 'di@prospect.example' });
t('fourth prospect: "all slots in use", nothing changes', r.status === 409 && /All 3 demo slots are in use/.test(r.json.error) && rows('Owners').filter(o => o.Is_Demo === 'TRUE').length === 3);
const PIN3 = rowOf('Owners', 'DO3').PIN;
t('all demo PINs differ from each other', new Set([PIN1, PIN2, PIN3]).size === 3);

// ===== 4. Selftest: the shared owner+tenant PIN is not flagged; real duplicates still are =====
const stSrc = grab('selftestCheckPinFormatAndDedup'); const stFn = new Function(stSrc + '\nreturn selftestCheckPinFormatAndDedup;')();
let st = stFn([], rows('Owners'), [], rows('Tenants'));
t('selftest: demo owner + demo tenant sharing a PIN (same phone) passes', st.ok === true, st);
const dupTen = rows('Tenants').concat([{ ID: '99', PIN: PIN1, Phone: '+14105550999', Active: 'TRUE' }]);
t('selftest: a REAL user colliding with a demo PIN is still caught', stFn([], rows('Owners'), [], dupTen).ok === false);

// ===== 5. Login: names, PINs, the clock =====
t('login before anything: wrong name is refused', (await login('owner', 'Zed', PIN1)).status !== 200);
r = await login('owner', 'ann', PIN1);
t('owner login works with first name + PIN and returns a session', r.status === 200 && r.json.owner_id === 'DO1' && !!r.json.token, r.json);
const tokOwner1 = r.json && r.json.token;
const o1b = rowOf('Owners', 'DO1'), t1b = rowOf('Tenants', 'DT1');
const exp1 = Date.parse(o1b.Demo_Expires);
t('first login starts the clock: expiry is 10 days from now, on BOTH owner and tenant rows, same value', Number.isFinite(exp1) && Math.abs(exp1 - (Date.now() + 10 * 86400000)) < 120000 && t1b.Demo_Expires === o1b.Demo_Expires && o1b.Demo_First_Login !== '', { o1b, t1b });
const expBefore = o1b.Demo_Expires;
skew += 3 * 86400000;
r = await login('tenant', 'Ann', PIN1);
t('tenant login with the same first name + PIN works, and does NOT restart the clock', r.status === 200 && r.json.tenant_id === 'DT1' && rowOf('Tenants', 'DT1').Demo_Expires === expBefore && rowOf('Owners', 'DO1').Demo_Expires === expBefore, r.json);
const tokTen1 = r.json && r.json.token;
t('the clock ran from first login, not from the day she was added (3 days later it still ends 10 days after the first login)', Date.parse(expBefore) - Date.now() > 6.5 * 86400000 && Date.parse(expBefore) - Date.now() < 7.5 * 86400000);
t('login telemetry: one first-login row for the slot (owner only, tenant reused the clock)', telem('demo_first_login').length === 1);
r = await login('tenant', 'Bo', PIN2);
t('slot 2: tenant is the first to log in and starts the slot-2 clock on both rows', r.status === 200 && rowOf('Owners', 'DO2').Demo_Expires !== '' && rowOf('Owners', 'DO2').Demo_Expires === rowOf('Tenants', 'DT2').Demo_Expires);
const tokTen2 = r.json && r.json.token;
r = await login('owner', 'Bo', PIN2); const tokOwner2 = r.json && r.json.token;
const realOwnerLogin = await login('owner', 'Rita', 'RIT12345');
t('real owner login still works and its token carries no demo claim', realOwnerLogin.status === 200 && (() => { const p = JSON.parse(Buffer.from(realOwnerLogin.json.token.split('.')[0], 'base64url').toString()); return !('demo' in p); })());
const demoClaim = JSON.parse(Buffer.from(tokOwner1.split('.')[0], 'base64url').toString());
t('demo owner token carries the demo slot claim', demoClaim.demo === '1' && demoClaim.role === 'owner' && demoClaim.id === 'DO1', demoClaim);

// ===== 6. A demo session only works while its slot is live; isolation between slots =====
r = await call('GET', '/owner-properties?owner_id=DO1', tokOwner1);
t('live demo owner session works (reads its own slot properties)', r.status === 200, r.text.slice(0, 200));
r = await call('GET', '/owner-properties?owner_id=DO2', tokOwner1);
t('slot 1 owner cannot read slot 2 owner data', r.status === 403 || r.status === 401, { s: r.status });
r = await call('POST', '/workorder', tokOwner1, { property_id: 'DP2A', description: 'x', trade: 'Plumbing' });
t('slot 1 owner cannot create a request on a slot 2 property', r.status === 403, { s: r.status, t: r.text.slice(0, 120) });
r = await call('POST', '/workorder', tokOwner1, { property_id: '7', description: 'x', trade: 'Plumbing' });
t('slot 1 owner cannot create a request on a REAL property', r.status === 403);
// demo tenant writes
r = await call('POST', '/workorder', tokTen1, { property_id: 'DP2A', unit_id: 'DU2A1', description: 'x', trade: 'Plumbing' });
t('demo tenant cannot submit a request on another slot property', r.status === 403);
r = await call('POST', '/workorder', tokTen1, { property_id: '7', unit_id: '9', description: 'x' });
t('demo tenant cannot submit a request on a REAL property', r.status === 403);
r = await call('POST', '/wishlist/add', tokTen1, { item: 'x' });
t('demo tenant cannot use paths outside the demo (wishlist)', r.status === 403);
r = await call('POST', '/wo/add-note', tokTen1, { wo_id: '100', note: 'hi' });
t('demo tenant cannot add a note to a REAL work order', r.status === 403);
const denyRows = telem('demo_write_denied');
t('every refused demo tenant write left a telemetry row', denyRows.length >= 4, denyRows.length);
r = await call('POST', '/workorder', tokTen1, { property_id: 'DP1A', unit_id: 'DU1A1', description: 'Kitchen faucet drips', trade: 'Plumbing' });
const wos1 = rows('Work_Orders').filter(w => w.Property_ID === 'DP1A');
t('demo tenant CAN submit a request on its own slot property (saved on the demo property)', r.status === 200 && wos1.length >= 1, { s: r.status, t: r.text.slice(0, 160) });
const demoWoId = wos1[0] && wos1[0].ID;
t('that request sent nothing to any real person', twilioPosts().every(p => { const to = decodeURIComponent((/To=([^&]+)/.exec(p.body) || [])[1] || ''); return to === PH1N; }), twilioPosts().map(p => p.body.slice(0, 80)));
// pretend the prospect attached a photo
store.tabs.get('Attachments').push(['2', demoWoId || '0', 'leak.jpg', 'TRUE']);

// ===== 7. Expiry: the session dies and the sweep clears everything =====
skew += 8 * 86400000;   // now ~11 days after slot 1's first login
r = await call('GET', '/owner-properties?owner_id=DO1', tokOwner1);
t('expired: the demo owner session is refused (401 demo ended)', r.status === 401 && r.json && r.json.demo_ended === true, { s: r.status, j: r.json });
r = await call('GET', '/tenant-workorders?tenant_id=DT1', tokTen1);
t('expired: the demo tenant session is refused too', r.status === 401);
r = await login('owner', 'Ann', PIN1);
t('expired: logging in again is refused with "demo has ended"', r.status === 403 && r.json.demo_ended === true);
r = await login('tenant', 'Ann', PIN1);
t('expired: tenant login refused too', r.status === 403 && r.json.demo_ended === true);
t('slot 2 (its clock started 3 days later) is still live while slot 1 has ended', Date.parse(rowOf('Owners', 'DO2').Demo_Expires) > Date.now());
// slot 3 never logged in: still waiting
const tw = twilioPosts().length;
r = await adminCall('POST', '/demo/sweep');
t('sweep: clears the expired slot 1, leaves live slot 2 and never-logged-in slot 3 (added < 30 days ago)', r.status === 200 && r.json.cleared.length === 1 && r.json.cleared[0].slot === 1, r.json);
const o1c = rowOf('Owners', 'DO1'), t1c = rowOf('Tenants', 'DT1');
t('after expiry slot 1: names, phone, email, PIN, clock and counters are empty; the rows cannot log in', o1c.First_Name === 'Demo' && o1c.Phone === '' && o1c.Email === '' && o1c.PIN === '' && o1c.Active === 'FALSE' && o1c.Demo_Prospect === 'FALSE' && o1c.Demo_Expires === '' && o1c.Demo_SMS_Count === '0' && t1c.Phone === '' && t1c.Email === '' && t1c.PIN === '' && t1c.Active === 'FALSE' && t1c.Demo_Prospect === 'FALSE', { o1c, t1c });
t('after expiry slot 1: the request the prospect created and its photo are gone', !rows('Work_Orders').some(w => w.Property_ID === 'DP1A' && !/^WO-D1\d\d$/.test(w.ID)) && !rows('Attachments').some(a => a.File_Name === 'leak.jpg'));   // the sample work orders (WO-D1nn) are rebuilt; nothing the prospect made is left
t('after expiry slot 1: real work order and real attachment are untouched', rowOf('Work_Orders', '100') && rows('Attachments').some(a => a.File_Name === 'real.jpg'));
t('after expiry slot 1: the 3 properties and 6 units are still there (pristine fake data stays)', rows('Properties').filter(p => p.Demo_Slot === '1').length === 3 && rows('Units').filter(p => p.Demo_Slot === '1').length === 6);
t('slot 2 untouched by the sweep', rowOf('Owners', 'DO2').Phone === PH2N && rowOf('Owners', 'DO2').PIN === PIN2);
t('the old prospect can no longer log in (same name + old PIN)', (await login('owner', 'Ann', PIN1)).status !== 200 && (await login('tenant', 'Ann', PIN1)).status !== 200);
t('sweep sent nothing', twilioPosts().length === tw);
t('a reset row was logged to telemetry', telem('demo_slot_reset').some(x => x.Success === 'TRUE' && /slot 1/.test(x.Notes)));
r = await adminCall('POST', '/demo/sweep');
t('sweep again: nothing more to do (idempotent)', r.status === 200 && r.json.cleared.length === 0);
r = await adminCall('GET', '/demo/slots');
t('slots list after expiry: slot 1 free, slot 2 active, slot 3 waiting for first login', r.json.slots[0].state === 'free' && r.json.slots[1].state === 'active' && r.json.slots[2].state === 'waiting for first login', r.json.slots.map(s => s.state));

// ===== 8. A freed slot is handed to the next prospect clean =====
store.tabs.get('Attachments').push(['3', '0', 'orphan.jpg', '', '', 'TRUE']);
store.tabs.get('Work_Orders').push(['5000', 'DP1B', '', 'New', 'leftover from a failed wipe']);
r = await adminCall('POST', '/demo/add', { name: 'Eve Next', phone: '4105550199', email: 'eve@prospect.example' });
t('next prospect gets slot 1 (the freed one)', r.status === 200 && r.json.slot === 1, r.json);
t('a leftover on a slot property is wiped before the slot is handed out', !rows('Work_Orders').some(w => w.ID === '5000'));
t('the new prospect starts with fresh counters and no clock', rowOf('Owners', 'DO1').Demo_SMS_Count === '0' && rowOf('Owners', 'DO1').Demo_Expires === '' && rowOf('Owners', 'DO1').First_Name === 'Eve');
t('the old prospect\'s phone and email appear nowhere in demo rows', !rows('Owners').concat(rows('Tenants')).some(x => x.Phone === PH1N || x.Email === 'ann@prospect.example'));

// ===== 9. Never-logged-in prospect is cleared after 30 days =====
skew += 31 * 86400000;
r = await adminCall('POST', '/demo/sweep');
t('sweep: a prospect who never logged in is cleared 30 days after being added', r.status === 200 && r.json.cleared.some(c => c.slot === 1) && rowOf('Owners', 'DO1').Phone === '' && /never logged in/.test(r.json.cleared.find(c => c.slot === 1).reason), r.json);

// ===== 10. Convert =====
r = await adminCall('POST', '/demo/add', { name: 'Fay Convert', phone: '4105550155', email: 'fay@prospect.example' });
const slotF = r.json.slot, pinF = r.json.pin;
const ownersBefore = rows('Owners').filter(o => o.Is_Demo !== 'TRUE').length;
qbMode.fail = true;
r = await adminCall('POST', '/demo/convert', { slot: slotF });
t('convert with QuickBooks down: fails loudly, says what happened', r.status >= 400 && /QuickBooks/.test(JSON.stringify(r.json) + r.text), { s: r.status, t: r.text.slice(0, 300) });
t('convert failure: the prospect is STILL in the slot (not cleared), the real owner exists once', rowOf('Owners', 'DO' + slotF).Phone === '+14105550155' && rowOf('Tenants', 'DT' + slotF).Phone === '+14105550155' && rows('Owners').filter(o => o.Is_Demo !== 'TRUE').length === ownersBefore + 1);
const realFay = rows('Owners').find(o => o.First_Name === 'Fay' && o.Is_Demo !== 'TRUE');
t('convert failure: the real owner row has the contact but no QuickBooks id yet; the slot remembers it', realFay && realFay.Phone === '+14105550155' && !realFay.QBO_Customer_ID && rowOf('Owners', 'DO' + slotF).Demo_Converted_Owner_ID === realFay.ID);
t('convert failure left a telemetry row', telem('demo_convert').some(x => x.Success === 'FALSE'));
qbMode.fail = false;
r = await adminCall('POST', '/demo/convert', { slot: slotF });
t('convert retry succeeds and reuses the same real owner (no duplicate)', r.status === 200 && r.json.owner_id === realFay.ID && rows('Owners').filter(o => o.Is_Demo !== 'TRUE').length === ownersBefore + 1, r.json);
const realFay2 = rowOf('Owners', realFay.ID);
t('convert: the real owner has a QuickBooks customer id saved and is NOT a demo row', /^QB7\d\d$/.test(realFay2.QBO_Customer_ID) && realFay2.Is_Demo !== 'TRUE' && r.json.qb_customer_id === realFay2.QBO_Customer_ID);
t('convert: the real owner has its OWN PIN (not the demo PIN) and the same phone/email', realFay2.PIN && realFay2.PIN !== pinF && /^[A-Za-z]{3}\d{5}$/.test(realFay2.PIN) && realFay2.Email === 'fay@prospect.example');
t('convert: the demo slot is cleared (owner, tenant, link) and cannot log in', rowOf('Owners', 'DO' + slotF).Phone === '' && rowOf('Owners', 'DO' + slotF).Demo_Converted_Owner_ID === '' && rowOf('Tenants', 'DT' + slotF).Phone === '' && (await login('owner', 'Fay', pinF)).status !== 200);
t('convert: exactly one QuickBooks customer was created', qbMode.created === 1, qbMode.created);
t('convert: nothing was texted or emailed', twilioPosts().length === tw);
r = await adminCall('POST', '/demo/convert', { slot: slotF });
t('convert on an empty slot is refused', r.status === 409);

// ===== 11. Reset, bad input, fail-loud paths =====
r = await adminCall('POST', '/demo/reset', { slot: 9 });
t('reset: bad slot number refused', r.status === 400);
r = await adminCall('POST', '/demo/reset', { slot: 2 });
t('reset: admin can clear slot 2 (the live one) on demand, and its sessions die', r.status === 200 && rowOf('Owners', 'DO2').Phone === '' && (await call('GET', '/owner-properties?owner_id=DO2', tokOwner2)).status === 401 && (await call('GET', '/tenant-workorders?tenant_id=DT2', tokTen2)).status === 401);
// ===== 11b. Failures are loud and safe =====
const baseHandle = store.handle;
// (a) a formula-backed Address column that does not keep what was written: the slot is never handed out
{
  const pr = store.tabs.get('Properties'); for (let i = pr.length - 1; i > 0; i--) if (String(pr[i][0]).startsWith('DP3')) pr.splice(i, 1);
  const addrIdx = pr[0].indexOf('Address');
  store.handle = async (method, path, body) => { const res = await baseHandle(method, path, body); if (method === 'POST' && /\/values\/Properties:append/.test(path)) for (const rr of store.tabs.get('Properties')) if (String(rr[0]).startsWith('DP3')) rr[addrIdx] = 'GENERIC PLACEHOLDER'; return res; };
  const res = await adminCall('POST', '/demo/add', { name: 'Gus Formula', phone: '4105550201', email: 'gus@prospect.example', slot: 3 });
  store.handle = baseHandle;
  t('add: an Address that does not save as written fails loudly and the slot is NOT handed out', res.status >= 400 && /did not save as written/.test(res.text) && rowOf('Owners', 'DO3').Phone === '', { s: res.status, t: res.text.slice(0, 200) });
}
{ const pr = store.tabs.get('Properties'); for (let i = pr.length - 1; i > 0; i--) if (String(pr[i][0]).startsWith('DP3')) pr.splice(i, 1); }   // drop the bad placeholder rows so slot 3 can be set up again
t('after that test the real property row is intact', rowOf('Properties', '7').Address === '500 Real Street');
// (b) the sheet fails half-way through add: the slot is cleaned, the error is plain
{
  const armed = true;
  store.handle = async (method, path, body) => {
    if (armed && method === 'POST' && path === '/values:batchUpdate' && body.data && body.data.some(d => /^Tenants!/.test(d.range) && /^[A-Za-z]{3}\d{5}$/.test(String(d.values[0][0])))) return { error: { code: 500, message: 'sheet exploded (test)' } };
    return baseHandle(method, path, body);
  };
  const res = await adminCall('POST', '/demo/add', { name: 'Hal Halfway', phone: '4105550202', email: 'hal@prospect.example', slot: 3 });
  store.handle = baseHandle;
  const free3 = (await adminCall('GET', '/demo/slots')).json.slots[2];
  t('add: a failure part-way is reported plainly and the slot is cleared (no contact left on either row)', res.status >= 400 && /Adding the prospect failed/.test(res.text) && rowOf('Owners', 'DO3').Phone === '' && rowOf('Tenants', 'DT3').Phone === '' && free3.state === 'free', { s: res.status, t: res.text.slice(0, 300), st: free3.state });
}
// (c) the demo clock cannot be started: login is refused (503), never let through un-clocked
{
  const ok = await adminCall('POST', '/demo/add', { name: 'Ivy Clock', phone: '4105550203', email: 'ivy@prospect.example', slot: 3 });
  const pinI = ok.json.pin;
  store.handle = async (method, path, body) => { if (method === 'POST' && path === '/values:batchUpdate' && body.data && body.data.some(d => /^(Owners|Tenants)!/.test(d.range) && /^\d{4}-\d\d-\d\dT/.test(String(d.values[0][0])))) return { error: { code: 500, message: 'cannot write the clock (test)' } }; return baseHandle(method, path, body); };
  const res = await login('owner', 'Ivy', pinI);
  store.handle = baseHandle;
  t('login: when the clock cannot be started the login is refused with a retry message (503), not let through', res.status === 503 && res.json.demo_unavailable === true && rowOf('Owners', 'DO3').Demo_Expires === '', { s: res.status, j: res.json });
  t('login: that failure left a telemetry row', telem('demo_login_gate').some(x => x.Success === 'FALSE'));
  const res2 = await login('owner', 'Ivy', pinI);
  t('login: the next attempt works and starts the clock', res2.status === 200 && rowOf('Owners', 'DO3').Demo_Expires !== '');
  // (d) the session check cannot read the sheet: request refused (503), never allowed through
  const tk = res2.json.token;
  store.handle = async (method, path, body) => { if (method === 'GET' && /^\/values\/Owners$/.test(path)) return { error: { code: 500, message: 'read failed (test)' } }; return baseHandle(method, path, body); };
  skew += 20000;
  const res3 = await call('GET', '/owner-properties?owner_id=DO3', tk);
  store.handle = baseHandle;
  t('session check: if the sheet cannot be read the demo request is refused, not allowed', res3.status >= 500 || res3.status === 401, { s: res3.status });
  await adminCall('POST', '/demo/reset', { slot: 3 });
}
// (f) the sweep cannot clear a slot: it says so loudly (never silent) and the next sweep finishes the job
{
  const ok = await adminCall('POST', '/demo/add', { name: 'Jay Sweep', phone: '4105550204', email: 'jay@prospect.example', slot: 3 });
  await login('tenant', 'Jay', ok.json.pin);
  skew += 11 * 86400000;
  store.handle = async (method, path, body) => { if (method === 'POST' && path === '/values:batchUpdate' && body.data && body.data.some(d => /^Owners!/.test(d.range) && d.values[0][0] === 'Demo')) return { error: { code: 500, message: 'cannot write (test)' } }; return baseHandle(method, path, body); };
  const res = await adminCall('POST', '/demo/sweep');
  store.handle = baseHandle;
  t('sweep: when a slot cannot be cleared the sweep fails loudly and names the slot', res.status >= 500 && /could not clear/i.test(res.text) && /slot 3/.test(res.text), { s: res.status, t: res.text.slice(0, 200) });
  t('sweep: that failure left a telemetry row', telem('demo_slot_reset').some(x => x.Success === 'FALSE' && /slot 3/.test(x.Notes)));
  t('sweep: the tenant side WAS cleared even though the owner side failed (no contact left on the tenant row)', rowOf('Tenants', 'DT3').Phone === '');
  const res2 = await adminCall('POST', '/demo/sweep');
  t('sweep: the next run finishes the job', res2.status === 200 && res2.json.cleared.length === 1 && rowOf('Owners', 'DO3').Phone === '' && rowOf('Owners', 'DO3').Demo_Prospect === 'FALSE', { s: res2.status, t: res2.text.slice(0, 200) });
}
// (e) deleting rows is capped
{
  const g = new Function('sheetsRequest', 'isMissingTabError', 'idColIndex', 'invalidateTabCache', 'fetchTab', grab('demoDeleteRows').replace('function demoDeleteRows', 'async function demoDeleteRows').replace('async async', 'async') + '\nreturn demoDeleteRows;');
  const fake = async () => ({ values: [['ID'], ...Array.from({ length: 5 }, (_, i) => [String(i)])] });
  const del = g(fake, () => false, () => 0, () => {}, async () => []);
  let msg = ''; try { await del({}, 'X', () => true, 3); } catch (e) { msg = e.message; }
  t('delete helper: refuses to delete more rows than its cap and says so', /safety cap of 3/.test(msg), msg);
}

t('real rows (owner 12, tenant 40, property 7, unit 9, WO 100, attachment 1) are byte-identical to the start after everything above', realSnap() === realBefore);

// ===== 12. Scheduler: the sweep rides the 14-minute checks job and reports failures =====
t('scheduler: schedRunSweepChecks calls demoSweep as its own named step', /schedStep\('demo_sweep', \(\) => demoSweep\(env\), errors\)/.test(wsrc));
t('scheduler: no new cron and no new job entry was needed (wrangler crons stay empty)', !/crons\s*=\s*\[\s*"/.test(fs.readFileSync(root + 'wrangler.toml', 'utf8')));

console.log(`demo-slots: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
