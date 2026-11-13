// DEMO HUB SCREEN + HIDING + BANNER (Nov 11 2026, Phase 2b of Brett's demo owner/tenant portal).
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
tab('Invoices', ['ID', 'Status'], []);
tab('Keys', ['ID', 'Property_ID'], []);
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


const grab = (name) => { const i = wsrc.indexOf('function ' + name + '('); let j = wsrc.indexOf('{', i), d = 0, k = j; for (; k < wsrc.length; k++) { const c = wsrc[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } } return wsrc.slice(i, k + 1); };
const grabConst = (n) => { const m = new RegExp('^const ' + n + ' = [^\\n]*;$', 'm').exec(wsrc); if (!m) throw new Error('const not found ' + n); return m[0]; };

// ===== 1. Static: the screen exists, the pages wired, no personal contact baked into the public repo =====
const idx = fs.readFileSync(root + 'index.html', 'utf8'), ownerHtml = fs.readFileSync(root + 'owner.html', 'utf8'), tenantHtml = fs.readFileSync(root + 'tenant.html', 'utf8');
t('hub: Owners page has the Demo Prospects button and the modal', /openDemoProspectsModal\(\)/.test(idx) && /id="modal-demo-prospects"/.test(idx) && /id="dp-name"/.test(idx) && /id="dp-phone"/.test(idx) && /id="dp-email"/.test(idx));
t('hub: add / clear / convert / list call the admin demo routes', /api\('GET','\/demo\/slots'\)/.test(idx) && /api\('POST','\/demo\/add'/.test(idx) && /api\('POST','\/demo\/reset'/.test(idx) && /api\('POST','\/demo\/convert'/.test(idx));
t('hub: clear and convert ask before acting', /function clearDemoSlot[\s\S]{0,200}confirm\(/.test(idx) && /function convertDemoSlot[\s\S]{0,200}confirm\(/.test(idx));
t('hub: no swallowing catch in the demo screen code', (() => { const a = idx.indexOf('// ── DEMO PROSPECTS'), b = idx.indexOf('function openOwnerInviteModal'); const seg = idx.slice(a, b); return !/catch\s*\(\w*\)\s*\{\s*\}/.test(seg) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(seg); })());
t('public repo: Brett\'s own phone is not written into the Hub page, the owner/tenant pages or this test (the worker already holds his admin number for a different job)', (() => { const re = new RegExp(['443', '961', '7927'].join('[-. )]*')); return ![idx, ownerHtml, tenantHtml, fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')].some(x => re.test(x)); })());
t('hub: the demo section does not prefill any contact', !/id="dp-(phone|email|name)"[^>]*value=/.test(idx));

// ===== 2. The slot card (pure) =====
const cardSrc = (() => { const i = idx.indexOf('function demoSlotCardHtml('); let j = idx.indexOf('{', i), d = 0, k = j; for (; k < idx.length; k++) { const c = idx[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } } return idx.slice(i, k + 1); })();
const card = new Function('esc', cardSrc + '\nreturn demoSlotCardHtml;')((s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
const open1 = card({ slot: 2, state: 'free', prospect: null });
t('card: an open slot says open and has no Clear/Convert button', /open/i.test(open1) && !/Clear/.test(open1) && !/Convert/.test(open1));
const act = card({ slot: 1, state: 'active', prospect: { first_name: 'Ann', last_name: '', phone: '+14105550133', email: 'ann@x.co', pin: 'ABC12345' }, added: '2026-11-11T12:00:00Z', first_login: '2026-11-11T13:00:00Z', expires: '2026-11-21T13:00:00Z' });
t('card: an active slot shows login name, PIN, phone, email, and both buttons wired to slot 1', /ABC12345/.test(act) && /\+14105550133/.test(act) && /ann@x\.co/.test(act) && /clearDemoSlot\(1\)/.test(act) && /convertDemoSlot\(1\)/.test(act) && /active/i.test(act));
const wait = card({ slot: 3, state: 'waiting for first login', prospect: { first_name: 'Bo', last_name: 'Lee', phone: '+14105550144', email: 'bo@x.co', pin: 'XYZ99999' }, added: '2026-11-11T12:00:00Z', first_login: '', expires: '' });
t('card: a waiting slot says the clock has not started', /not yet/.test(wait) && /10 days after first login/.test(wait));
const evil = card({ slot: 1, state: 'active', prospect: { first_name: '<img src=x onerror=alert(1)>', last_name: '', phone: '"><script>x()</script>', email: 'e@x.co', pin: 'P' }, added: 'not a date <b>', first_login: '', expires: '' });
t('card: sheet text is escaped (no live tags) and an unreadable date is shown as text, not hidden', !/<img|<script/.test(evil) && !/not a date <b>/.test(evil) && /not a date &lt;b&gt;/.test(evil) && /&lt;img/.test(evil));
t('card: an expired slot is flagged expired and can be cleared', /expired/i.test(card({ slot: 1, state: 'expired', prospect: { first_name: 'C', last_name: '', phone: '+1', email: 'c@x.co', pin: 'Q' }, added: '', first_login: '', expires: '' })) );

// ===== 3. Banner (owner + tenant pages) =====
for (const [nm, html] of [['owner', ownerHtml], ['tenant', tenantHtml]]) {
  const bi = html.indexOf('function demoBanner('); let j = html.indexOf('{', bi), d = 0, k = j; for (; k < html.length; k++) { const c = html[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } }
  const src = html.slice(bi, k + 1);
  const made = []; const fakeBody = { firstChild: null, insertBefore(el) { made.push(el); } };
  const fakeDoc = { body: fakeBody, getElementById: (id) => made.find(m => m.id === id && !m.gone) || null, createElement: () => ({ id: '', style: {}, textContent: '', parentNode: { removeChild(el) { el.gone = true; } } }) };
  const fn = new Function('document', src + '\nreturn demoBanner;')(fakeDoc);
  fn(true); const shown = made.find(m => m.id === 'demoBanner' && !m.gone);
  t(nm + ' page: demoBanner(true) adds a visible DEMO strip', !!shown && /^DEMO/.test(shown.textContent) && /sample data/i.test(shown.textContent));
  fn(false);
  t(nm + ' page: demoBanner(false) removes it', !made.find(m => m.id === 'demoBanner' && !m.gone));
  t(nm + ' page: login success shows it only for demo logins and logout removes it', /demoBanner\(!!data\.demo\)/.test(html) && /function doLogout\(\) \{[\s\S]{0,120}demoBanner\(false\)/.test(html));
}
t('owner page: header company line is tagged DEMO for demo logins', /if \(data\.demo\) displayCo = 'DEMO/.test(ownerHtml));
t('tenant page: header address line is tagged DEMO for demo logins', /data\.demo \? 'DEMO/.test(tenantHtml));

// ===== 4. Server: login says demo, demo rows stay out of Hub lists, digest and portal-access list =====
const PIN_ANN = (await adminCall('POST', '/demo/add', { name: 'Ann Prospect', phone: PH1, email: 'ann@prospect.example' })).json.pin;
const PIN_BO = (await adminCall('POST', '/demo/add', { name: 'Bo Second', phone: PH2, email: 'bo@prospect.example' })).json.pin;
let r = await login('owner', 'Ann', PIN_ANN);
t('login: a demo owner login response says demo:true', r.status === 200 && r.json.demo === true, r.json);
const tokOwnerAnn = r.json.token;
r = await login('tenant', 'Ann', PIN_ANN);
t('login: a demo tenant login response says demo:true', r.status === 200 && r.json.demo === true, r.json);
const tokTenAnn = r.json.token;
r = await login('owner', 'Rita', 'RIT12345');
t('login: a REAL owner login response has no demo flag', r.status === 200 && !('demo' in r.json));
r = await login('tenant', 'Tess', 'TES12345');
t('login: a REAL tenant login response has no demo flag', r.status === 200 && !('demo' in r.json), r.json);
// the demo tenant makes a request so a demo work order exists
r = await call('POST', '/workorder', tokTenAnn, { property_id: 'DP1A', unit_id: 'DU1A1', description: 'Kitchen faucet drips', trade: 'Plumbing' });
const demoWO = rows('Work_Orders').find(w => w.Property_ID === 'DP1A');
t('setup: a demo work order exists on a demo property', r.status === 200 && !!demoWO, { s: r.status, t: r.text.slice(0, 160) });
r = await adminCall('GET', '/hub-bootstrap');
const bs = r.json || {};
const ids = (a) => (a || []).map(x => String(x.ID));
t('hub-bootstrap: answers 200 with every list', r.status === 200 && ['properties', 'units', 'tenants', 'workorders', 'owners'].every(k => Array.isArray(bs[k])), r.text.slice(0, 200));
t('hub-bootstrap: no demo owner, tenant, property, unit or work order is listed', !ids(bs.owners).some(i => /^DO/.test(i)) && !ids(bs.tenants).some(i => /^DT/.test(i)) && !ids(bs.properties).some(i => /^DP/.test(i)) && !ids(bs.units).some(i => /^DU/.test(i)) && !(bs.workorders || []).some(w => w.Property_ID === 'DP1A'));
t('hub-bootstrap: real owner 12, tenant 40, property 7, unit 9 and work order 100 are all still listed', ids(bs.owners).includes('12') && ids(bs.tenants).includes('40') && ids(bs.properties).includes('7') && ids(bs.units).includes('9') && ids(bs.workorders).includes('100'));
r = await adminCall('GET', '/workorders');
t('admin work order list: the demo work order is not listed; the real one is', r.status === 200 && Array.isArray(r.json) && !r.json.some(w => w.Property_ID === 'DP1A') && r.json.some(w => String(w.ID) === '100'), { s: r.status, ids: (r.json || []).map && (r.json || []).map(w => w.ID) });
r = await adminCall('GET', '/portal-access');
const people = (r.json && r.json.people) || [];
t('portal-access list: demo owner and tenant are not on the follow-up list; real ones are', r.status === 200 && !people.some(p => /^D[OT]\d/.test(p.id)) && people.some(p => p.type === 'owner' && p.id === '12') && people.some(p => p.type === 'tenant' && p.id === '40'), people.map(p => p.type + p.id));
r = await adminCall('GET', '/daily-digest');
const digestText = (r.json && r.json.text) || '', digestJson = JSON.stringify((r.json && r.json.digest) || {});
t('daily digest: the pulse counts only the real property, tenant and open work order (3 demo properties, a demo tenant and a demo work order are present and not counted)', r.status === 200 && /1 properties · 1 tenants · 1 vendors · 1 open WOs/.test(digestText) && !/DP1A|DU1A1|Kitchen faucet drips/.test(digestText + digestJson), { s: r.status, t: (digestText || r.text).slice(0, 300) });
r = await adminCall('GET', '/demo/slots');
t('the demo slot list still shows the demo rows (the screen reads them from /demo/slots, not the hidden lists)', r.status === 200 && r.json.slots.filter(s => s.prospect).length === 2 && r.json.slots[0].prospect.pin === PIN_ANN);

// the hide helper itself
const hideSrc = new Function(grab('demoTrue') + '\n' + grab('demoIsDemoRow') + '\n' + grab('demoHide') + '\nreturn { demoIsDemoRow, demoHide };')();
t('hide helper: flags Is_Demo rows, fixed demo IDs and work orders on demo properties; leaves numeric real rows alone', hideSrc.demoIsDemoRow({ ID: '5', Is_Demo: 'TRUE' }) && hideSrc.demoIsDemoRow({ ID: 'DO2' }) && hideSrc.demoIsDemoRow({ ID: 'DT1' }) && hideSrc.demoIsDemoRow({ ID: 'DP3C' }) && hideSrc.demoIsDemoRow({ ID: 'DU2B1' }) && hideSrc.demoIsDemoRow({ ID: '88', Property_ID: 'DP1A' }) && !hideSrc.demoIsDemoRow({ ID: '12' }) && !hideSrc.demoIsDemoRow({ ID: '100', Property_ID: '7' }) && !hideSrc.demoIsDemoRow({ ID: 'DOG' }) && !hideSrc.demoIsDemoRow(null));
t('hide helper: non-arrays come back unchanged (never throws)', hideSrc.demoHide(undefined) === undefined);
// the message sweep is deliberately NOT filtered (a hidden recipient would read as "recipient not found" and alarm Brett)
t('message sweep: still reads recipients unfiltered (demo messages are skipped by the guard, not hidden)', (() => { const i = wsrc.indexOf("[tenants,owners,properties,vendors] = await fetchTabs(env, ['Tenants','Owners','Properties','Vendors'])"); return i > 0 && !/demoHide/.test(wsrc.slice(i - 200, i + 200)); })());

// nothing in this file's activity texted or emailed anyone but the prospects
t('nothing left the building except to the prospects themselves', outbound.filter(o => /twilio|gmail/.test(o.url)).every(o => { const b = decodeURIComponent(o.body || ''); return !/\+14105550(111|122|123|177)/.test(b); }), outbound.filter(o => /twilio|gmail/.test(o.url)).map(o => o.url));
t('real rows are byte-identical to the start', realSnap() === realBefore);
console.log(`demo-hub-screen: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
