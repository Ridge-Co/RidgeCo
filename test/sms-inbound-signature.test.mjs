// Incoming-text (Twilio) signature check on /sms-inbound (Nov 16 2026, access fix 3 of 3).
// Drives the REAL worker.js default export over a fake Google Sheets. The signatures in this file are made by an INDEPENDENT
// copy of Twilio's documented recipe (node:crypto below), not by the Worker's own function, so a mistake in the Worker cannot
// agree with itself. The recipe and the first test vector are from twilio.com/docs/usage/security (read Nov 16 2026).
// What it proves:
//   - the Worker computes the documented example signature exactly;
//   - a correctly signed text from a vendor is handled (real replies keep working) in both modes, and writes no ledger row;
//   - LOG-ONLY (the default): unsigned / tampered / wrong-key texts are still handled, and each leaves a low-severity row
//     saying what would have been refused;
//   - ENFORCE: the same texts get 403, change nothing, and leave a row; with no secret everything is refused, loudly (P1);
//   - the ledger rows are rate limited and never hold a phone number, the message text or the secret.
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

const AUTH = 'test-auth-token-0123456789abcdef';
// Independent implementation of the documented recipe: URL + sorted(name+value), HMAC-SHA1 with the Auth Token, base64.
const twilioSign = (token, url, params) => crypto.createHmac('sha1', token).update(url + Object.keys(params).sort().map(k => k + params[k]).join(''), 'utf8').digest('base64');
const grab = (kind, name) => { const i = wsrc.indexOf(kind + ' ' + name + '('); if (i < 0) throw new Error('missing ' + name); let d = 0, j = wsrc.indexOf('{', wsrc.indexOf(')', i)); for (; j < wsrc.length; j++) { if (wsrc[j] === '{') d++; else if (wsrc[j] === '}') { d--; if (!d) break; } } return wsrc.slice(i, j + 1); };
const pure = new Function(`${grab('function', 'bytesToB64')}\n${grab('function', 'twilioSignatureBase')}\n${grab('async function', 'twilioSignatureCompute')}\n${grab('function', 'smsSigSame')}\nreturn { twilioSignatureBase, twilioSignatureCompute, smsSigSame };`)();

const WOH = ['ID', 'Property_ID', 'Unit_ID', 'Vendor_ID', 'Tenant_ID', 'Status', 'Voided', 'Tenant_Visible', 'Tenant_Notify_Updates', 'Type', 'Created_Date', 'Trade', 'Description', 'Notes', 'Priority', 'Parent_WO_ID', 'Completed_Date', 'Hold_Reason', 'Scheduled_Date'];
const seedWOs = () => tab('Work_Orders', WOH, [
  { ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Status: 'Assigned', Created_Date: '2026-10-01', Trade: 'Plumbing', Description: 'TEST job', Tenant_Notify_Updates: 'FALSE' },
  { ID: 'WO-2', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V2', Status: 'Assigned', Created_Date: '2026-10-02', Trade: 'HVAC', Description: 'TEST other job', Tenant_Notify_Updates: 'FALSE' }]);
seedWOs();
tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: 'P1', Owner_ID: 'O1', Address: '1 Main', Active: 'TRUE' }]);
tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Tenant_ID'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '1A', Tenant_ID: '' }]);
tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'Move_In_Date'], []);
tab('Keys', ['ID', 'Property_ID', 'Unit_ID'], []);
tab('Vendors', ['ID', 'Name', 'Phone', 'Email', 'Company', 'Active', 'Language'], [{ ID: 'V1', Name: 'Vee One', Phone: '4105550001', Active: 'TRUE' }, { ID: 'V2', Name: 'Vee Two', Phone: '4105550002', Active: 'TRUE' }]);
tab('Owners', ['ID', 'First_Name', 'Last_Name', 'Notify_Method', 'Phone'], [{ ID: 'O1', First_Name: 'Olly', Notify_Method: 'none' }]);
tab('WO_Audit', ['ID', 'WO_ID', 'Changed_By', 'Changed_By_Role', 'Field', 'Old_Value', 'New_Value', 'Timestamp', 'Notes'], []);
tab('SMS_Logs', ['ID', 'WO_ID', 'Recipient_Type', 'Phone', 'Message', 'Status', 'Created_Date'], []);
tab('Failure_Events', ['ID', 'Timestamp', 'System', 'Source', 'Where', 'Ref', 'Severity', 'Message', 'Context'], []);
tab('Config', ['Key', 'Value'], []);

const rowsOf = (name) => { const all = store.tabs.get(name) || [[]]; const h = all[0]; return all.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); };
const woRow = (id) => rowsOf('Work_Orders').find(w => w.ID === id);
const sigRows = () => rowsOf('Failure_Events').filter(r => r.Where === 'inbound_text_signature');
const URL_ = BASE + '/sms-inbound';
// What Twilio really posts for an incoming text (names in the order Twilio sends them, i.e. NOT sorted).
const twilioParams = (from, text) => ({ ToCountry: 'US', ToState: 'MD', SmsMessageSid: 'SM0123456789abcdef0123456789abcdef', NumMedia: '0', ToCity: 'BALTIMORE', FromZip: '21201', SmsSid: 'SM0123456789abcdef0123456789abcdef',
  FromState: 'MD', SmsStatus: 'received', FromCity: 'BALTIMORE', Body: text, FromCountry: 'US', To: '+14105559999', ToZip: '21202', NumSegments: '1', MessageSid: 'SM0123456789abcdef0123456789abcdef', AccountSid: 'AC0123456789abcdef0123456789abcdef', From: from, ApiVersion: '2010-04-01' });
// opts: { sign: token | null, signature: literal header, bodyParams: what is actually sent (default = the signed params), url }
const sms = async (params, opts) => {
  opts = opts || {};
  skew += 10000;
  const url = opts.url || URL_;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (opts.signature !== undefined) headers['X-Twilio-Signature'] = opts.signature;
  else if (opts.sign) headers['X-Twilio-Signature'] = twilioSign(opts.sign, url, params);
  const res = await worker.fetch(new Request(url, { method: 'POST', headers, body: new URLSearchParams(opts.bodyParams || params).toString() }), env, { waitUntil() {} });
  return { status: res.status, text: await res.text(), type: res.headers.get('Content-Type') || '' };
};
const nextWindow = () => { skew += 11 * 60000; };          // past the 10-minute ledger window AND the 1-minute switch cache
const setMode = (v) => { store.setCfg('SMS_INBOUND_SIGNATURE_MODE', v); nextWindow(); };
const handled = (r) => r.status === 200 && /text\/xml/.test(r.type) && /<Response><Message>/.test(r.text);
const V1 = '+14105550001';

// ── 1. the documented recipe ─────────────────────────────────────────────────────────────────────────────────────────
{
  const docUrl = 'https://example.com/myapp.php?foo=1&bar=2';
  const docParams = [['CallSid', 'CA1234567890ABCDE'], ['Caller', '+14158675310'], ['Digits', '1234'], ['From', '+14158675310'], ['To', '+18005551212']];
  t('Twilio\'s documented example: the signed string is built exactly as documented', pure.twilioSignatureBase(docUrl, docParams) === 'https://example.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212');
  t('Twilio\'s documented example: signature matches the documented value', await pure.twilioSignatureCompute('12345', docUrl, docParams) === 'L/OH5YylLD5NRKLltdqwSvS0BnU=', await pure.twilioSignatureCompute('12345', docUrl, docParams));
  t('the order the parameters arrive in does not matter', await pure.twilioSignatureCompute('12345', docUrl, docParams.slice().reverse()) === 'L/OH5YylLD5NRKLltdqwSvS0BnU=');
  t('sorting is case-sensitive (Unix order: capitals before lower case)', pure.twilioSignatureBase('u', [['b', '1'], ['B', '2'], ['a', '3'], ['A', '4']]) === 'uA4B2a3b1');
  t('an empty value still contributes its name', pure.twilioSignatureBase('u', [['Body', ''], ['A', 'x']]) === 'uAxBody');
  const p = twilioParams(V1, 'Sí, mañana + 2 más & ok = ✔');
  t('the Worker agrees with the independent implementation on a real incoming-text parameter set (accents, +, &, =)', await pure.twilioSignatureCompute(AUTH, URL_, Object.entries(p)) === twilioSign(AUTH, URL_, p));
  t('compare: same strings match, different or empty ones do not', pure.smsSigSame('abc=', 'abc=') && !pure.smsSigSame('abc=', 'abd=') && !pure.smsSigSame('abc=', 'abc') && !pure.smsSigSame('', '') && !pure.smsSigSame('abc', ''));
}

// ── 2. LOG-ONLY is the default: nothing is refused, what would have been refused is recorded ─────────────────────────
env.TWILIO_AUTH = AUTH;
{
  t('the switch is not set in Config (so this is the default behaviour)', !('SMS_INBOUND_SIGNATURE_MODE' in store.cfg()));
  const unsigned = await sms(twilioParams(V1, 'NO'));
  t('log-only: an UNSIGNED text is still handled exactly as before', handled(unsigned) && woRow('WO-1').Status === 'Declined' && woRow('WO-1').Vendor_ID === '', { unsigned, wo: woRow('WO-1') });
  let rows = sigRows();
  t('log-only: it leaves ONE low-severity row saying it would have been refused, and why', rows.length === 1 && rows[0].Severity === 'P2' && /WOULD HAVE BEEN REFUSED/.test(rows[0].Message) && /no X-Twilio-Signature header/.test(rows[0].Message) && /log-only/.test(rows[0].Message), rows);
  seedWOs(); nextWindow();
  const p = twilioParams(V1, 'YES');
  const tampered = await sms(p, { sign: AUTH, bodyParams: Object.assign({}, p, { From: '+14105550002' }) });   // signed as V1, altered to look like V2
  t('log-only: a TAMPERED text is still handled as before', handled(tampered) && woRow('WO-2').Status === 'Accepted', { tampered, wo: woRow('WO-2') });
  rows = sigRows();
  t('log-only: and it leaves a "would have been refused: does not match" row', rows.length === 2 && rows[1].Severity === 'P2' && /WOULD HAVE BEEN REFUSED/.test(rows[1].Message) && /does not match/.test(rows[1].Message), rows[1]);
  seedWOs(); nextWindow();
  const good = await sms(twilioParams(V1, 'YES'), { sign: AUTH });
  t('log-only: a correctly signed vendor reply is handled', handled(good) && /confirmed for WO-1/.test(good.text) && woRow('WO-1').Status === 'Accepted', { good, wo: woRow('WO-1') });
  t('log-only: a correctly signed text leaves NO ledger row', sigRows().length === 2, sigRows().length);
}

// ── 3. ENFORCE: real replies still work, everything else is refused and changes nothing ──────────────────────────────
{
  seedWOs(); setMode('enforce');
  const nBefore = sigRows().length;
  const good = await sms(twilioParams(V1, 'YES'), { sign: AUTH });
  t('enforce: a correctly signed vendor reply (YES) still works', handled(good) && /confirmed for WO-1/.test(good.text) && woRow('WO-1').Status === 'Accepted', { good, wo: woRow('WO-1') });
  t('enforce: a correctly signed text leaves no ledger row', sigRows().length === nBefore);
  seedWOs(); skew += 61000;
  const goodNo = await sms(twilioParams(V1, 'no'), { sign: AUTH });
  t('enforce: a correctly signed vendor reply (no) still works', handled(goodNo) && woRow('WO-1').Status === 'Declined', { goodNo, wo: woRow('WO-1') });
  seedWOs(); skew += 61000;
  const goodMsg = await sms(twilioParams(V1, 'Running 20 min late + need the gate code & a ladder'), { sign: AUTH });
  t('enforce: a correctly signed free-text reply with + and & in it still works', handled(goodMsg) && /Message received/.test(goodMsg.text), goodMsg);
  const qUrl = URL_ + '?src=studio&n=1';
  const goodQ = await sms(twilioParams(V1, 'hello'), { sign: AUTH, url: qUrl });
  t('enforce: a correctly signed text to a URL with a query string still works (the query is part of what Twilio signs)', handled(goodQ), goodQ);

  const snap = () => JSON.stringify(['Work_Orders', 'WO_Audit', 'SMS_Logs'].map(n => store.tabs.get(n)));
  const cases = [
    ['an UNSIGNED text', () => sms(twilioParams(V1, 'NO')), /no X-Twilio-Signature header/],
    ['a text whose From was altered after signing', () => { const p = twilioParams(V1, 'NO'); return sms(p, { sign: AUTH, bodyParams: Object.assign({}, p, { From: '+14105550002' }) }); }, /does not match/],
    ['a text whose Body was altered after signing', () => { const p = twilioParams(V1, 'YES'); return sms(p, { sign: AUTH, bodyParams: Object.assign({}, p, { Body: 'NO' }) }); }, /does not match/],
    ['a text with an extra parameter added after signing', () => { const p = twilioParams(V1, 'NO'); return sms(p, { sign: AUTH, bodyParams: Object.assign({}, p, { Extra: '1' }) }); }, /does not match/],
    ['a text signed with the wrong key', () => sms(twilioParams(V1, 'NO'), { sign: 'not-the-auth-token' }), /does not match/],
    ['a text signed for a different URL', () => sms(twilioParams(V1, 'NO'), { signature: twilioSign(AUTH, 'https://example.com/sms-inbound', twilioParams(V1, 'NO')) }), /does not match/],
    ['a text with a made-up signature', () => sms(twilioParams(V1, 'NO'), { signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }), /does not match/],
  ];
  for (const [name, send, why] of cases) {
    nextWindow();
    const before = snap(), n0 = sigRows().length;
    const r = await send();
    t(`enforce: ${name} is refused with 403 and no reply text`, r.status === 403 && !/<Response>/.test(r.text), r);
    t(`enforce: ${name} changes nothing (no status change, no history line, no text log)`, snap() === before);
    const rows = sigRows();
    t(`enforce: ${name} leaves one low-severity "refused" row with the reason`, rows.length === n0 + 1 && rows[rows.length - 1].Severity === 'P2' && /REFUSED/.test(rows[rows.length - 1].Message) && !/WOULD/.test(rows[rows.length - 1].Message) && why.test(rows[rows.length - 1].Message), rows[rows.length - 1]);
  }
}

// ── 4. the rate limit: a flood cannot fill the ledger ────────────────────────────────────────────────────────────────
{
  nextWindow();
  const n0 = sigRows().length, skew0 = skew;
  const cfgReads0 = store.calls.filter(c => c === 'GET /values/Config').length;
  let refused = 0;
  for (let i = 0; i < 25; i++) { skew = skew0 + i * 1000; const r = await worker.fetch(new Request(URL_, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(twilioParams(V1, 'NO')).toString() }), env, { waitUntil() {} }); if (r.status === 403) refused++; }
  t('flood: all 25 unsigned texts inside one minute are refused', refused === 25, refused);
  t('flood: only 3 ledger rows are written for them', sigRows().length === n0 + 3, sigRows().length - n0);
  t('flood: the switch is read from the sheet at most once for the whole burst', store.calls.filter(c => c === 'GET /values/Config').length - cfgReads0 <= 1, store.calls.filter(c => c === 'GET /values/Config').length - cfgReads0);
  skew = skew0 + 11 * 60000;
  await sms(twilioParams(V1, 'NO'));
  const last = sigRows().pop();
  t('flood: the next row (a new 10-minute window) says how many were not filed', /"not_filed_since_last_row":22/.test(last.Context), last);
}

// ── 5. no secret ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  seedWOs(); delete env.TWILIO_AUTH; nextWindow();
  const n0 = sigRows().length;
  const r = await sms(twilioParams(V1, 'YES'), { sign: AUTH });
  const row = sigRows().pop();
  t('enforce + NO secret: every text is refused (a check that is on and cannot run does not let everything through)', r.status === 403 && woRow('WO-1').Status === 'Assigned', r);
  t('enforce + NO secret: the row is P1 and names exactly what is missing and how to get out', sigRows().length === n0 + 1 && row.Severity === 'P1' && /Every incoming text is being REFUSED/.test(row.Message) && /TWILIO_AUTH/.test(row.Message) && /set the switch back to "log"/.test(row.Message), row);
  setMode('log');
  const n1 = sigRows().length;
  const r2 = await sms(twilioParams(V1, 'YES'), { sign: AUTH });
  const row2 = sigRows().pop();
  t('log-only + NO secret: the text is handled as before', handled(r2) && woRow('WO-1').Status === 'Accepted', r2);
  t('log-only + NO secret: a low-severity row says the check could not run and names the missing secret', sigRows().length === n1 + 1 && row2.Severity === 'P2' && /NOT CHECKED/.test(row2.Message) && /TWILIO_AUTH/.test(row2.Message) && /not set/.test(row2.Message), row2);
  env.TWILIO_AUTH = AUTH;
}

// ── 6. the switch: only the exact word turns enforcement on; an unreadable switch never lets a bad text through ──────
{
  for (const v of ['', 'log', 'LOG ONLY', 'true', 'on', 'yes', 'enforced']) {
    seedWOs(); setMode(v);
    const r = await sms(twilioParams(V1, 'NO'));
    t(`switch "${v}": log-only (nothing refused)`, handled(r), r);
  }
  for (const v of ['enforce', 'ENFORCE', ' Enforce ']) {
    seedWOs(); setMode(v);
    const r = await sms(twilioParams(V1, 'NO'));
    t(`switch "${v}": enforcing`, r.status === 403, r);
  }
  seedWOs(); setMode('log');
  store.failWhen = (m, p) => m === 'GET' && p === '/values/Config';
  const r = await sms(twilioParams(V1, 'NO'));
  store.failWhen = null;
  t('switch cannot be read: an unsigned text is NOT handled (503) and nothing changes', r.status === 503 && woRow('WO-1').Status === 'Assigned', r);
  nextWindow();
}

// ── 7. what the ledger rows hold ─────────────────────────────────────────────────────────────────────────────────────
{
  const all = JSON.stringify(sigRows());
  t('ledger rows never hold the secret', !all.includes(AUTH));
  t('ledger rows never hold a full phone number (last 4 only)', !/4105550001|4105550002/.test(all) && /"from_last4\\?":\\?"0001/.test(all), all.slice(0, 300));
  t('ledger rows never hold the message text', !/Running 20 min late/.test(all));
  t('every row is filed under one place so the ledger groups them', sigRows().every(r => r.Where === 'inbound_text_signature' && r.System === 'hub' && r.Ref === '/sms-inbound'));
  t('/sms-inbound is still public at the gate (Twilio sends no Hub token) and the handler checks the signature first', /PUBLIC_PATHS = \[[^\]]*'\/sms-inbound'/.test(wsrc) && /async function handleInboundSMS\(env, request\) \{\s*const params=new URLSearchParams\(await request\.text\(\)\);\s*\{ const _sigDenied = await smsInboundSignatureGate\(env, request, params\); if \(_sigDenied\) return _sigDenied; \}/.test(wsrc));
  t('no secret value is written into worker.js (the token is only ever read from env.TWILIO_AUTH)', /env\.TWILIO_AUTH\)/.test(wsrc) && !/TWILIO_AUTH\s*=\s*['"]/.test(wsrc));
}

console.log(`sms-inbound-signature: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
