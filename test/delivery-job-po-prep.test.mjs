// Delivery watcher fix (Oct 27 2026, Brett's real Home Depot order WH49670828 for WO-1237 at 115 W 29th St Apt 2).
// Written BEFORE the code, from the two REAL emails (test/fixtures/homedepot-WH49670828.json, text as Gmail shows it):
//   1. the "Job / PO Number: WO 1237 115 W 29th St Apt 2" line names the work order AND the unit (the Prep email's address has no Apt);
//   2. "Prep for Appliance Delivery!" and "Order confirmed" must not read as a "window set" email ("Delivery Window Pending" is not a window);
//   3. the product line "FRIGIDAIRE 30 in. 5 Burner Freestanding Gas Range in Stainless Steel with ..." is the make/model when no model number is printed.
// Run: node test/delivery-job-po-prep.test.mjs
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } };
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };
function grabFn(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const pa = src.indexOf('// ═══ DELIVERY-EMAIL-PURE-START'), pb = src.indexOf('// ═══ DELIVERY-EMAIL-PURE-END');
t('pure block markers exist', pa > 0 && pb > pa);
const P = new Function(grabFn('function nyOffsetMinutes(') + '\n' + grabFn('function etHour(') + '\n' + src.slice(pa, pb) +
  '\nreturn { DEP, deliveryParseEmail, deliveryParseJobRef, deliveryParseMakeModel, deliveryNextStatus, deliveryTenantText };')();

// ════════════════════════════════ PART 2: the real worker over fake Sheets + Twilio ════════════════════════════════
const tick = (ms) => new Promise(r => setTimeout(r, ms));
function makeStore() {
  const tabs = new Map(); const calls = [];
  const st = { tabs, calls, latency: () => 0, failWhen: null };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {
    calls.push(method + ' ' + path); if (process.env.DBG) console.error('  sheets', method, path);
    const lat = st.latency(); if (lat) await tick(lat);
    if (st.failWhen && st.failWhen(method, path, body)) return { error: { code: 500, message: 'injected sheets failure' } };
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); return { range: name, values: tabs.get(name).map(r => r.slice()) }; }
    if (method === 'GET' && (m = /^\/values:batchGet\?(.*)$/.exec(path))) {
      const names = m[1].split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, ''))); const valueRanges = [];
      for (const name of names) { if (!tabs.has(name)) return missing(name); valueRanges.push({ range: name, values: tabs.get(name).map(r => r.slice()) }); }
      return { valueRanges };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 200, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); for (const r of body.values) tabs.get(name).push(r.slice()); return { updates: { updatedRows: body.values.length, updatedRange: name + '!A' + tabs.get(name).length } }; }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
        const c = mm[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]); while (rows[row].length <= c) rows[row].push(''); rows[row][c] = d.values[0][0];
      }
      return { totalUpdatedCells: body.data.length };
    }
    if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  return st;
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
let store = makeStore();
const twilio = [];            // every outbound text the worker tried to send
let twilioMode = 'ok';        // 'ok' | 'fail'
let tokenMode = 'ok', calMode = 'ok', jwksMode = 'ok', jwksFetches = 0, calSeq = 0, jwksKeys = [];   // fake Google: sign-in token endpoint, Calendar API, published sign-in keys
const calEvents = new Map(), calLog = [];
let lastClaim = null;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) { try { const a = /assertion=([^&]+)/.exec(String(init && init.body || '')); lastClaim = JSON.parse(Buffer.from(a[1].split('.')[1], 'base64url').toString()); } catch (_) {} }
  if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenMode === 'ok' ? new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 }) : new Response(JSON.stringify({ error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method' }), { status: 400 });
  if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
    jwksFetches++;
    if (jwksMode !== 'ok') return new Response('boom', { status: 500 });
    return new Response(JSON.stringify({ keys: jwksKeys }), { status: 200, headers: { 'Cache-Control': 'public, max-age=3600' } });
  }
  const cm = /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary(\/events.*)?$/.exec(url);
  if (cm) {
    const sub = cm[1] || '', b = init && init.body ? JSON.parse(init.body) : undefined; calLog.push(method + ' ' + decodeURIComponent(sub).slice(0, 80));
    if (calMode === 'down') return new Response(JSON.stringify({ error: { code: 503, message: 'backend error' } }), { status: 503 });
    if (method === 'GET') { const q = /privateExtendedProperty=([^&]+)/.exec(sub); const [k, v] = q ? decodeURIComponent(q[1]).split('=') : []; return new Response(JSON.stringify({ items: [...calEvents.values()].filter(e => !k || (e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private[k] === v)).map(e => ({ id: e.id, status: e.status })) }), { status: 200 }); }
    if (method === 'POST') { const id = 'ev' + (++calSeq); calEvents.set(id, Object.assign({ id }, b)); return new Response(JSON.stringify({ id }), { status: 200 }); }
    const idm = /^\/events\/([^?]+)/.exec(sub), eid = idm && decodeURIComponent(idm[1]);
    if (method === 'PATCH') { if (!calEvents.has(eid)) return new Response('{"error":{"code":404}}', { status: 404 }); calEvents.set(eid, Object.assign(calEvents.get(eid), b)); return new Response(JSON.stringify({ id: eid }), { status: 200 }); }
    if (method === 'DELETE') { if (!calEvents.has(eid)) return new Response('{"error":{"code":410}}', { status: 410 }); calEvents.delete(eid); return new Response(null, { status: 204 }); }
  }
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const b = init && init.body ? JSON.parse(init.body) : undefined; const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  if (url.startsWith('https://api.twilio.com/')) {
    const p = new URLSearchParams(init.body); twilio.push({ to: p.get('To'), body: p.get('Body') });
    return twilioMode === 'ok' ? new Response(JSON.stringify({ sid: 'SM' + twilio.length, status: 'queued' }), { status: 201 }) : new Response(JSON.stringify({ code: 21608, message: 'forced failure' }), { status: 400 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
// The main Worker is also loaded from a temp copy that exports its 6-second sheet-tab cache, so seed() can empty it: tests that jump the clock FORWARD
// (token expiry, the quiet-hours release) leave cache entries whose expiry is in the "future" of the normal test clock, and the next seed would then be
// served the PREVIOUS seed's Tenants rows (that is how two seeds once produced the identical text "Hi Tamvb..." and tripped the D-16 duplicate guard).
const WK = await (async () => {
  const os = await import('node:os'), path = await import('node:path'), url = await import('node:url');
  const f = path.join(os.tmpdir(), 'worker-wk-' + process.pid + '-' + Date.now() + '.mjs');
  fs.writeFileSync(f, src + '\nexport { __tabCache };\nexport function __resetGoogleAuth() { __gJwks = null; __gJwksTriedAt = 0; __gAuthAlertAt = {}; }\n');
  try { return await import(url.pathToFileURL(f).href); } finally { try { fs.unlinkSync(f); } catch (_) {} }
})();
const worker = WK.default;
// A second copy of worker.js that also exports the (module-private) release sweep, so the test can run exactly that step without the whole cronSweep.
const QH = await (async () => {
  const os = await import('node:os'), path = await import('node:path'), url = await import('node:url');
  const f = path.join(os.tmpdir(), 'worker-qh-' + process.pid + '-' + Date.now() + '.mjs');
  fs.writeFileSync(f, src + '\nexport { processQuietHoursQueue, __smsRecent, __tabCache };\n');
  try { return await import(url.pathToFileURL(f).href); } finally { try { fs.unlinkSync(f); } catch (_) {} }
})();
// Run fn with "now" set to an exact instant (the clock keeps advancing from there).
let clockBump = 0;   // each use starts 10 s later than the last so the release module's 6 s tab cache can never serve a previous store's rows
async function withClock(iso, fn) {
  const D0 = globalThis.Date, n0 = D0.now, start = n0.call(D0), target = Date.parse(iso) + (clockBump += 10000);
  class Fixed extends D0 { constructor(...a) { if (a.length === 0) super(target + (n0.call(D0) - start)); else super(...a); } static now() { return target + (n0.call(D0) - start); } }
  const dn = D0.now; globalThis.Date = Fixed;
  try { return await fn(); } finally { globalThis.Date = D0; D0.now = dn; }
}
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789', INTAKE = 'intake-token-for-tests-9876543210';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET, INTAKE_TOKEN: INTAKE, TWILIO_SID: 'ACtest', TWILIO_API_SID: 'SKtest', TWILIO_API_KEY: 'keytest', TWILIO_FROM: '+14105550999' };
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;   // defeat the 6s tab cache between calls
const call = async (method, path, token, body, e) => {
  if (process.env.DBG) console.error('CALL', method, path);
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), e || env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) {}
  return { status: res.status, json: j, text };
};
const ADMIN = '+14435550000', TENANT_PHONE = '+14105550101';
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);
const rowsOf = (name) => { const t = store.tabs.get(name); if (!t || !t.length) return []; const h = t[0]; return t.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); };
const WOH = ['Vendor_Needs_Access', 'ID', 'Property_ID', 'Unit_ID', 'Tenant_ID', 'Vendor_ID', 'Type', 'Trade', 'Description', 'Priority', 'Status', 'Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Invoice_ID', 'Owner_WO_Ref', 'WO_Contact_Name', 'WO_Contact_Phone', 'Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Vendor_SMS_Sent', 'Tenant_SMS_Sent', 'Owner_Notified', 'Created_By', 'Created_Date', 'Notes', 'Room', 'Checklist', 'Source', 'Intake_Message_ID'];
// The Worker now refuses to send the SAME text to the SAME number twice within 10 minutes (D-16 guard). Every seed is a fresh world, so give its tenant a fresh first name.
let seedNo = 0, SEED_NAME = 'Tam';
function seed(over) {
  over = over || {};
  seedNo++; SEED_NAME = 'Tam' + 'abcdefghijklmnopqrstuvwxyz'[seedNo % 26] + 'abcdefghijklmnopqrstuvwxyz'[Math.floor(seedNo / 26) % 26];
  // The worker memoises ensureColumns for 10 minutes per process, so a brand-new fake store must keep the HEADER rows the previous run created
  // (exactly what the live sheet looks like after the first email): carry headers over, drop the data.
  WK.__tabCache.clear(); QH.__tabCache.clear();   // every seed is a fresh world: no sheet rows may be served from a previous seed's cache. NOTE: the D-16 duplicate-text memory is deliberately NOT cleared.
  const prev = store; store = makeStore(); skew += 60000; twilio.length = 0; twilioMode = 'ok'; tokenMode = 'ok'; calMode = 'ok'; calEvents.clear(); calLog.length = 0;
  for (const [name, rows] of prev.tabs) if (rows.length && rows[0].length) store.tabs.set(name, [rows[0].slice()]);
  tab('Config', ['Key', 'Value'], Object.entries(Object.assign({ admin_phone: ADMIN, TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE', Delivery_Claim_Settle_Ms: '40', Delivery_Cal_Impersonate: 'brett@bmoremanagement.com' }, over.config || {})).map(([Key, Value]) => ({ Key, Value })));
  tab('Owners', ['ID', 'First_Name', 'Company', 'SMS_Enabled', 'Phone'], [{ ID: 'O1', First_Name: 'Olly', Company: 'Phoenix Estate Rentals', SMS_Enabled: 'TRUE' }]);
  tab('Properties', ['ID', 'Owner_ID', 'Address', 'City', 'Type', 'Unit_Count', 'Active', 'Access_Notes', 'SMS_Enabled'], [
    { ID: 'P1', Owner_ID: 'O1', Address: '5425 Belle Vista Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
    { ID: 'P2', Owner_ID: 'O1', Address: '928 N Calvert St', City: 'Baltimore', Type: 'multi', Unit_Count: '2', Active: 'TRUE' },
    { ID: 'P3', Owner_ID: 'O1', Address: '10 Dup Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
    { ID: 'P4', Owner_ID: 'O1', Address: '10 Dup Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
    { ID: 'P5', Owner_ID: 'O1', Address: '3 Test Ct', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE', Access_Notes: 'TEST-PROPERTY' },
  ]);
  tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '1', Active: 'TRUE' }, { ID: 'U2', Property_ID: 'P2', Unit_Label: 'Apt 2', Active: 'TRUE' }, { ID: 'U3', Property_ID: 'P2', Unit_Label: 'Apt 3R', Active: 'TRUE' }]);
  tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'SMS_Enabled', 'SMS_OptOut', 'Move_In_Date', 'Move_Out_Date'], [
    Object.assign({ ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE', First_Name: SEED_NAME, Last_Name: 'One', Phone: TENANT_PHONE, Move_In_Date: '2025-01-01' }, over.t1 || {}),
    { ID: 'T2', Property_ID: 'P2', Unit_ID: 'U2', Active: 'TRUE', First_Name: 'Tia', Last_Name: 'Two', Phone: '+14105550102', Move_In_Date: '2025-01-01' },
    { ID: 'T3', Property_ID: 'P2', Unit_ID: 'U3', Active: 'TRUE', First_Name: 'Tom', Last_Name: 'Three', Phone: '+14105550103', Move_In_Date: '2025-01-01' },
    { ID: 'T4', Property_ID: 'P2', Unit_ID: 'U3', Active: 'TRUE', First_Name: 'Tess', Last_Name: 'Four', Phone: '+14105550104', Move_In_Date: '2025-01-01' },
  ]);
  tab('Work_Orders', WOH, []);
  tab('Vendors', ['ID', 'Name', 'Phone', 'SMS_Enabled'], []);
  tab('WO_Tenants', ['ID', 'WO_ID', 'Tenant_ID', 'Tenant_Name', 'Tenant_Phone', 'Added_By', 'Added_Date', 'Active'], []);
}
// ════════════════════════════════ fixtures ═════════════════════════════════
const FXJ = JSON.parse(fs.readFileSync(root + 'test/fixtures/homedepot-WH49670828.json', 'utf8'));
const HD_FROM = FXJ.from;
const E1 = { subject: FXJ.confirmed.subject, body: FXJ.confirmed.body, received_at: FXJ.confirmed.received_at };
const E2 = { subject: FXJ.prep.subject, body: FXJ.prep.body, received_at: FXJ.prep.received_at };
// An HTML rendering of the same text: every line becomes its own table cell (what the store's template does), labels and values in separate cells.
const toHtml = (txt) => '<html><head><style>td{color:#333}</style></head><body><table>' + txt.split('\n').filter(l => l.trim()).map(l => '<tr><td>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td></tr>').join('') + '</table></body></html>';
const html1 = toHtml(E1.body), html2 = toHtml(E2.body);

// ════════════════════════════════ PART 1: the parser on the REAL emails ═════════════════════════════════
const WANT_MM = 'Frigidaire 30 in. 5 Burner Freestanding Gas Range';
for (const [label, mk] of [['plain text', (e) => ({ subject: e.subject, body: e.body, received_at: e.received_at })], ['html only', (e, h) => ({ subject: e.subject, body: '', html: h, received_at: e.received_at })], ['text + html (what the Apps Script sends)', (e, h) => ({ subject: e.subject, body: e.body, html: h, received_at: e.received_at })]]) {
  const a = P.deliveryParseEmail(mk(E1, html1)), b = P.deliveryParseEmail(mk(E2, html2));
  eq('E1 (' + label + '): "Order confirmed" is an order confirmation, NOT a window-set email', a.kind, 'order_confirmation');
  eq('E2 (' + label + '): "Prep for Appliance Delivery" is a prep notice, NOT a window-set email', b.kind, 'prep');
  for (const [n, p] of [['E1', a], ['E2', b]]) {
    eq(n + ' (' + label + '): order, item, date, no window', [p.order_number, p.item_type, p.expected_date, p.expected_window], ['WH49670828', 'Range', '2026-10-30', '']);
    eq(n + ' (' + label + '): make / model is the product line, not just the brand', p.make_model, WANT_MM);
    eq(n + ' (' + label + '): the Job / PO line names WO-1237 and Apt 2', [p.wo_ref, p.unit_raw], ['WO-1237', 'Apt 2']);
    eq(n + ' (' + label + '): the address carries the unit even when the address block has none', p.address, '115 W 29th St Apt 2, Baltimore, MD 21218');
    eq(n + ' (' + label + '): nothing missing', p.missing, []);
  }
}

// ── job / PO line variants ──
{
  const J = (txt) => P.deliveryParseJobRef(txt);
  eq('Job/PO: the real line', [J('Job / PO Number:\nWO 1237 115 W 29th St Apt 2\nCustomer Phone Number:\n410-259-2314')].map(x => [x.wo_ref, x.unit_raw]), [['WO-1237', 'Apt 2']]);
  eq('Job/PO: label and value on one line', [J('Job / PO Number: WO 1237 115 W 29th St Apt 2 Customer Phone Number: 410-259-2314')].map(x => [x.wo_ref, x.unit_raw]), [['WO-1237', 'Apt 2']]);
  eq('Job/PO: WO-1237 / WO#1237 / wo 1237 spellings', ['Job/PO Number: WO-1237', 'PO Number: WO#1237', 'Job: wo 1237 Apt 3', 'PO: WO1237'].map(s => J(s).wo_ref), ['WO-1237', 'WO-1237', 'WO-1237', 'WO-1237']);
  eq('Job/PO: unit spellings', ['Job / PO Number: WO 1237 Unit 2B', 'Job / PO Number: WO 1237 #4', 'Job / PO Number: WO 1237 115 W 29th St Apt. 3R'].map(s => J(s).unit_raw), ['Unit 2B', 'Unit 4', 'Apt 3R']);
  eq('Job/PO: only the WO, no unit', [J('Job / PO Number: WO 1237\nCustomer Phone Number: 410-259-2314')].map(x => [x.wo_ref, x.unit_raw]), [['WO-1237', '']]);
  eq('Job/PO: a bare number or a name is NOT a work order', [J('Job / PO Number: 1237').wo_ref, J('Job / PO Number: Smith kitchen').wo_ref, J('PO Number: 55-1237').wo_ref], ['', '', '']);
  eq('Job/PO: no such line -> nothing', [J('Order # WH49670828\nDeliver to Brett Lambert:\n115 W 29th St, Baltimore, MD 21218').wo_ref, J('Order # WH49670828').unit_raw], ['', '']);
  eq('Job/PO: a WO word elsewhere in the email is not read (only the labelled line)', J('Your work on this order is amazing. WO 55 is not it. Order # WH49670828').wo_ref, '');
  eq('Job/PO: the unit is never taken from the phone number or the street number', [J('Job / PO Number: WO 1237\nCustomer Phone Number: 410-259-2314').unit_raw, J('Job / PO Number: WO 1237 115 W 29th St').unit_raw], ['', '']);
}

// ── kinds: "Delivery Window Pending" is not a window; real window emails still are ──
{
  const pk = (subject, body) => P.deliveryParseEmail({ subject, body, received_at: '2026-10-27T10:00:00Z' });
  eq('"Delivery Window Pending" (body only, plain subject) is not window_set', pk('Your Home Depot order', 'Order # WH49670828\nEstimated Delivery\nFri, Oct 30\nDelivery Window Pending\nDeliver to Brett Lambert:\n115 W 29th St, Baltimore, MD 21218\nFRIGIDAIRE 30 in. Gas Range').kind !== 'window_set', true);
  eq('a real window email is still window_set', pk('Your delivery window for order WH49670828', 'Order # WH49670828\nYour delivery window is between 9:00 AM and 1:00 PM on Fri, Oct 30.\n115 W 29th St, Baltimore, MD 21218').kind, 'window_set');
  eq('a real "Delivery Scheduled" email is still scheduled', pk('Delivery Scheduled - Order # WH49670828', 'Order # WH49670828\nYour delivery date is Fri, Oct 30.\n115 W 29th St, Baltimore, MD 21218').kind, 'scheduled');
  const w = pk('Delivery Scheduled - Order # WH49670828', 'Order # WH49670828\nDelivery Window\nFri, Oct 30  9 AM - 1 PM\n115 W 29th St, Baltimore, MD 21218');
  eq('"Delivery Window" followed by a real window is window_set with the window', [w.kind, w.expected_window], ['window_set', '9a-1p']);
  eq('prep never overrides a real event named in the subject', [pk('Your order WH49670828 has been cancelled', 'Prep for Appliance Delivery! Order # WH49670828').kind, pk('Your order was delivered - Order # WH49670828', 'Prep for Successful Installation: measure spaces').kind], ['cancel', 'delivered']);
  eq('prep: status never moves a known order backward or forward', ['Ordered', 'Scheduled', 'Window-Set', 'En-Route', 'Delivered', 'Cancelled'].map(s => P.deliveryNextStatus(s, 'prep').status), ['Ordered', 'Scheduled', 'Window-Set', 'En-Route', 'Delivered', 'Cancelled']);
  eq('order_confirmation: "Order confirmed" in the subject', pk('Order confirmed. We\'re processing your order now!', 'Order # WH49670828').kind, 'order_confirmation');
}

// ── make / model ──
{
  const mm = (s, o) => P.deliveryParseMakeModel(s, o || '').make_model;
  eq('make/model: the product title after the brand, cut at "in <finish>"', mm('Order # WH49670828 FRIGIDAIRE 30 in. 5 Burner Freestanding Gas Range in Stainless Steel with Quick Boil and Even Baking Technology SKU #1015322476 Internet #341304656 Qty: 1 $789.00', 'WH49670828'), WANT_MM);
  eq('make/model: a printed model number still wins (existing behaviour)', mm('Whirlpool WRS325SDHZ 25 cu. ft. Side by Side Refrigerator in Stainless Steel Model # WRS325SDHZ'), 'Whirlpool WRS325SDHZ');
  eq('make/model: cut at "with"', mm('SAMSUNG 24 in. Top Control Dishwasher with Stainless Steel Tub SKU #1'), 'Samsung 24 in. Top Control Dishwasher');
  eq('make/model: no brand -> blank (never invented)', mm('30 in. 5 Burner Freestanding Gas Range in Stainless Steel'), '');
  t('make/model: capped in length', mm('GE ' + 'Very '.repeat(60) + 'Long Range').length <= 80);
}

// ════════════════════════════════ PART 2: the real worker ═════════════════════════════════
const send = (e, over, mailbox) => call('POST', '/intake/delivery-email', INTAKE, Object.assign({ from: HD_FROM, message_id: '<' + (++mseq) + '@homedepot.test>', mailbox: mailbox || 'info@bmoremanagement.com' }, e, over || {}));
let mseq = 0;
const snap = () => JSON.stringify([...store.tabs.entries()]);
const dels = () => rowsOf('Deliveries'), wos = () => rowsOf('Work_Orders'), mq = () => rowsOf('Message_Queue');
const noticeRows = () => mq().filter(r => r.Message_Type === 'delivery_tenant_notice');
const TEN80 = '+14105550180';
const toAdmin = () => twilio.filter(x => x.to === ADMIN), toTenant = () => twilio.filter(x => x.to === TEN80);
// The world of the real order: property 3 = 115 W 29th St (Apt 1 / 2 / 3), tenant 80 lives in Apt 2, and WO-1237 already exists for that tenant.
function seedHD(over) {
  over = over || {};
  seed(over);
  tab('Properties', ['ID', 'Owner_ID', 'Address', 'City', 'Type', 'Unit_Count', 'Active', 'Access_Notes', 'SMS_Enabled'], [
    { ID: '3', Owner_ID: 'O1', Address: '115 W 29th St', City: 'Baltimore', Type: 'multi', Unit_Count: '3', Active: 'TRUE' },
    { ID: '4', Owner_ID: 'O1', Address: '928 N Calvert St', City: 'Baltimore', Type: 'multi', Unit_Count: '2', Active: 'TRUE' },
  ]);
  tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [{ ID: '7', Property_ID: '3', Unit_Label: 'Apt 1', Active: 'TRUE' }, { ID: '8', Property_ID: '3', Unit_Label: 'Apt 2', Active: 'TRUE' }, { ID: '9', Property_ID: '3', Unit_Label: 'Apt 3', Active: 'TRUE' }]);
  tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'SMS_Enabled', 'SMS_OptOut', 'Move_In_Date', 'Move_Out_Date'], [
    { ID: '79', Property_ID: '3', Unit_ID: '7', Active: 'TRUE', First_Name: 'Una', Last_Name: 'One', Phone: '+14105550179', Move_In_Date: '2025-01-01' },
    { ID: '80', Property_ID: '3', Unit_ID: '8', Active: 'TRUE', First_Name: SEED_NAME, Last_Name: 'Eighty', Phone: TEN80, Move_In_Date: '2025-01-01' },
    { ID: '81', Property_ID: '3', Unit_ID: '9', Active: 'TRUE', First_Name: 'Uma', Last_Name: 'Nine', Phone: '+14105550181', Move_In_Date: '2025-01-01' },
  ]);
  const wo = Object.assign({ ID: 'WO-1237', Property_ID: '3', Unit_ID: '8', Tenant_ID: '80', Type: 'repair', Trade: 'Appliance', Description: 'Replace gas range', Priority: 'normal', Status: 'New', Created_By: 'admin', Created_Date: '2026-10-20T12:00:00Z', Source: 'admin' }, over.wo || {});
  tab('Work_Orders', WOH, over.noWo ? [] : [wo]);
}
const releaseAt = (iso) => withClock(iso, () => QH.processQuietHoursQueue(env));

// ── S1. the real order, first email first ──
{
  seedHD();
  const r = await send(E1, { html: html1 });
  const j = r.json;
  t('S1: 200, created, order_confirmation (NOT window_set)', r.status === 200 && j.success && j.created && j.kind === 'order_confirmation', j);
  eq('S1: parsed', [j.order_number, j.item_type, j.make_model, j.expected_date, j.expected_window], ['WH49670828', 'Range', WANT_MM, '2026-10-30', '']);
  eq('S1: property 3, unit 8 (Apt 2), tenant 80 resolved, no UNIT UNKNOWN', [j.property_matched, j.property_id, j.unit_id, j.tenant_id, /UNIT UNKNOWN/.test(j.detail || '')], [true, '3', '8', '80', false]);
  eq('S1: linked to the EXISTING WO-1237, no second work order', [j.wo_id, j.wo_created, wos().length], ['WO-1237', false, 1]);
  const d = dels(); eq('S1: one Deliveries row, linked', [d.length, d[0].Linked_WO_IDs, d[0].Property_ID, d[0].Unit_ID, d[0].Tenant_ID, d[0].Status, d[0].Onsite_Contact], [1, 'WO-1237', '3', '8', '80', 'Ordered', 'tenant']);
  eq('S1: the stored address has the unit', d[0].Delivery_Address, '115 W 29th St Apt 2, Baltimore, MD 21218');
  eq('S1: Brett is texted once, naming the order, the item and WO-1237', [toAdmin().length, /WH49670828/.test(toAdmin()[0].body), /Range/.test(toAdmin()[0].body), /WO WO-1237/.test(toAdmin()[0].body), /Delivery order found/.test(toAdmin()[0].body)], [1, true, true, true, true]);
  eq('S1: the WO row was not rewritten', [wos()[0].Source, wos()[0].Unit_ID, wos()[0].Tenant_ID], ['admin', '8', '80']);
  // tenant: default Config (no Delivery_* key) = auto -> queued for today 6pm ET (the clock is pinned to Oct 14 11:00 ET)
  eq('S1: default Config (no Delivery_Tenant_Notice) -> tenant text QUEUED (default is auto)', j.tenant_sms, 'queued');
  const n = noticeRows(); eq('S1: one held row, tenant 80\'s phone, 6pm ET, pending', [n.length, n[0].Recipient_Phone, n[0].Send_After, n[0].Status, n[0].WO_ID], [1, TEN80, '2026-10-14T22:00:00.000Z', 'pending', 'WO-1237']);
  const m = /^New range ordered\. Delivery 10\/30\/26\. Please let us know if you can be there: (https:\/\/\S+\/r\/\d+\.[A-Za-z0-9_-]{8})/.exec(n[0].Message_Body || '');
  t('S1: tenant text = terse request with the date and NO window, short link', !!m, n[0].Message_Body);
  eq('S1: calendar: all-day Oct 30 create', [j.calendar.action, j.calendar.all_day, j.calendar.start_iso, j.calendar.key], ['create', true, '2026-10-30', 'delivery-wh49670828']);
  // the 6pm sweep
  const rel = await releaseAt('2026-10-14T22:05:00Z');
  eq('S1: the existing sweep releases it at 6:05pm ET to tenant 80 (and to nobody else)', [toTenant().length, noticeRows()[0].Status, twilio.filter(x => x.to !== ADMIN && x.to !== TEN80).length], [1, 'sent', 0]);
  t('S1: what the tenant got', /^New range ordered\. Delivery 10\/30\/26\./.test(toTenant()[0].body), toTenant()[0].body);
  // ── S2. then the Prep email, from the OTHER mailbox: no second row, no second WO, no second text, no status change ──
  const nTw = twilio.length, nRows = dels().length, nQ = mq().length;
  const r2 = await send(E2, { html: html2 }, 'brett@bmoremanagement.com');
  const j2 = r2.json;
  t('S2: Prep -> kind prep, handled as a no-change repeat', r2.status === 200 && j2.success && j2.kind === 'prep' && j2.duplicate === true && j2.reason === 'no_change' && !j2.created && !j2.updated, j2);
  eq('S2: no new row, WO, queue row, or text of any kind', [dels().length, wos().length, mq().length, twilio.length], [nRows, 1, nQ, nTw]);
  eq('S2: status still Ordered (not Window-Set), still linked', [dels()[0].Status, dels()[0].Linked_WO_IDs, dels()[0].Expected_Window], ['Ordered', 'WO-1237', '']);
  eq('S2: the repeat is remembered (both message ids)', dels()[0].Seen_Message_IDs.split(',').length, 2);
  eq('S2: no second calendar write needed', j2.calendar.action, 'none');
}

// ── S3. the Prep email arrives FIRST (new row): it creates the order, resolves unit + tenant from the job line, asks the tenant; the confirmation is then a repeat ──
{
  seedHD();
  const r = await send(E2, { html: html2 });
  const j = r.json;
  t('S3: Prep as the first email creates the order (Ordered)', r.status === 200 && j.success && j.created && j.kind === 'prep' && j.status === 'Ordered', j);
  eq('S3: unit 8 + tenant 80 + WO-1237 from the Job/PO line although the address had no Apt', [j.unit_id, j.tenant_id, j.wo_id, j.wo_created, wos().length, dels()[0].Delivery_Address], ['8', '80', 'WO-1237', false, 1, '115 W 29th St Apt 2, Baltimore, MD 21218']);
  eq('S3: Brett told once ("order found"), never "undefined"', [toAdmin().length, /Delivery order found WH49670828/.test(toAdmin()[0].body), /undefined/.test(toAdmin()[0].body)], [1, true, false]);
  eq('S3: the tenant is asked (queued) from the Prep email too', [j.tenant_sms, noticeRows().length, noticeRows()[0].Recipient_Phone], ['queued', 1, TEN80]);
  const r2 = await send(E1, { html: html1 }, 'brett@bmoremanagement.com');
  t('S3: the older confirmation arriving second is stale: changes nothing, no second tenant row, no second Brett text', r2.json.success && r2.json.reason === 'stale_email' && noticeRows().length === 1 && toAdmin().length === 1 && dels().length === 1 && dels()[0].Status === 'Ordered', r2.json);
}

// ── S4. dry run: shows what would happen, writes nothing ──
{
  seedHD(); const before = snap();
  const r = await send(E2, { html: html2, dry_run: true });
  const j = r.json;
  eq('S4: dry run of Prep: would_create, linked to WO-1237, unit + tenant resolved, no UNIT UNKNOWN', [j.reason, j.wo_id, j.unit_id, j.tenant_id, /UNIT UNKNOWN/.test(j.detail || ''), j.make_model], ['would_create', 'WO-1237', '8', '80', false, WANT_MM]);
  t('S4: dry run wrote nothing and sent nothing', snap() === before && twilio.length === 0);
}

// ── S5. the row already exists WITHOUT unit / tenant / WO (made before this fix): the Prep email's job line completes it, and asks the tenant ──
{
  seedHD({ noWo: false });
  // an earlier email with no unit anywhere (no job line)
  const early = { subject: 'Order confirmed. We\'re processing your order now!', received_at: '2026-10-26T16:35:00Z', body: E1.body.replace(/Job \/ PO Number:\nWO 1237 115 W 29th St Apt 2\n\n/, '').replace('115 W 29th St, Apt 2,', '115 W 29th St,') };
  t('S5: setup: the early email really has no unit and no job line', !/Apt 2/.test(early.body) && !/Job/.test(early.body));
  const r1 = await send(early);
  eq('S5: the early email: property found, unit unknown, no tenant, and a NEW work order was made', [r1.json.property_id, r1.json.unit_id, r1.json.tenant_id, /UNIT UNKNOWN/.test(r1.json.detail || ''), r1.json.wo_created], ['3', '', '', true, true]);
  const woBefore = wos().length;
  const r2 = await send(E2, { html: html2 });
  const j = r2.json;
  const d = dels()[0];
  eq('S5: the job line fills the missing unit and tenant on the existing row', [d.Unit_ID, d.Tenant_ID, d.Onsite_Contact], ['8', '80', 'tenant']);
  eq('S5: the delivery keeps the work order it already has (never two)', [d.Linked_WO_IDs === wos()[wos().length - 1].ID || d.Linked_WO_IDs === 'WO-1237', wos().length, woBefore], [true, woBefore, woBefore]);
  eq('S5: the tenant is asked now that one is known', [j.tenant_sms, noticeRows().length, toTenant().length], ['queued', 1, 0]);
}

// ── S6. the Job/PO work order is on a DIFFERENT property: never linked; the delivery still proceeds on the address and says so ──
{
  seedHD({ wo: { Property_ID: '4', Unit_ID: '', Tenant_ID: '' } });
  const r = await send(E1, { html: html1 });
  const j = r.json;
  t('S6: still created on the address match', r.status === 200 && j.success && j.created && j.property_id === '3', j);
  eq('S6: WO-1237 not linked; unit still from the job line text; a normal WO is created', [dels()[0].Linked_WO_IDs !== 'WO-1237', j.unit_id, j.tenant_id, j.wo_created], [true, '8', '80', true]);
  t('S6: Brett is told why (text and detail)', /WO-1237/.test(j.detail || '') && /WO-1237/.test(toAdmin()[0].body), [j.detail, toAdmin()[0] && toAdmin()[0].body]);
  eq('S6: WO-1237 itself untouched', [wos().find(w => w.ID === 'WO-1237').Property_ID, wos().find(w => w.ID === 'WO-1237').Unit_ID], ['4', '']);
}

// ── S7. the Job/PO names a work order that does not exist: flagged, nothing guessed ──
{
  seedHD({ noWo: true });
  const r = await send(E1, { html: html1 });
  const j = r.json;
  t('S7: created; unit from the job line text; not linked to anything missing', r.status === 200 && j.created && j.unit_id === '8' && j.tenant_id === '80', j);
  t('S7: detail + Brett text say WO-1237 was not found', /WO-1237/.test(j.detail || '') && /not found|no such/i.test(j.detail || '') && /WO-1237/.test(toAdmin()[0].body), [j.detail, toAdmin()[0] && toAdmin()[0].body]);
}

// ── S8. a store address with an "Apt 3" in the address block and a job line saying Apt 2: the work order wins and Brett is told ──
{
  seedHD();
  const bad = Object.assign({}, E1, { body: E1.body.replace('115 W 29th St, Apt 2,', '115 W 29th St, Apt 3,') });
  const r = await send(bad);
  const j = r.json;
  eq('S8: the work order\'s unit and tenant win (unit 8 / tenant 80)', [j.unit_id, j.tenant_id, j.wo_id], ['8', '80', 'WO-1237']);
  t('S8: the disagreement is reported', /Apt 3/.test(j.detail || '') && /Apt 2|WO-1237/.test(j.detail || ''), j.detail);
}

// ── S9. multi-unit, NO job line, NO unit in the address: unchanged old behaviour (UNIT UNKNOWN, no tenant guessed, no tenant text) ──
{
  seedHD({ noWo: true });
  const plain = { subject: E1.subject, received_at: E1.received_at, body: E1.body.replace(/Job \/ PO Number:\nWO 1237 115 W 29th St Apt 2\n\n/, '').replace('115 W 29th St, Apt 2,', '115 W 29th St,') };
  const r = await send(plain);
  const j = r.json;
  eq('S9: unit unknown, no tenant, tenant not texted, Brett told', [j.unit_id, j.tenant_id, /UNIT UNKNOWN/.test(j.detail || ''), toTenant().length, noticeRows().length], ['', '', true, 0, 0]);
  t('S9: tenant_sms says why', j.tenant_sms === 'skipped' && /no single tenant/.test(j.tenant_sms_detail), [j.tenant_sms, j.tenant_sms_detail]);
}

// ── S10. Delivery_Tenant_Notice values ──
{
  for (const [val, want] of [['', 'queued'], ['auto', 'queued'], ['AUTO', 'queued'], ['draft', 'draft'], ['off', 'off']]) {
    seedHD({ config: val === '' ? {} : { Delivery_Tenant_Notice: val } });
    const r = await send(E1, { html: html1 });
    eq('S10: Delivery_Tenant_Notice "' + val + '" -> ' + want, r.json.tenant_sms, want);
  }
}

// ── S11. a closed / void work order named on the Job/PO line is never linked ──
for (const st of ['Void', 'Cancelled', 'Paid']) {
  seedHD({ wo: { Status: st } });
  const r = await send(E1, { html: html1 });
  t('S11: WO-1237 is ' + st + ': not linked, says so, a normal WO is created', r.json.success && dels()[0].Linked_WO_IDs !== 'WO-1237' && r.json.wo_created === true && new RegExp(st + '|closed').test(r.json.detail || ''), [r.json.detail, dels()[0] && dels()[0].Linked_WO_IDs]);
}

console.log(`\ndelivery-job-po-prep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
