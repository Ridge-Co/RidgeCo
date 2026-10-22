// Oct 19 2026 READ METER. The whole Hub shares ONE Google Sheets read quota (60/min); this counts every real attempt to Google, tagged with
// WHO caused it (admin / vendor:<id> / cron job / ...) and which route + tab. Proven three ways:
//  1. unit tests on the REAL meter code (extracted from worker.js): labels, alarm, caps, pruning, "never breaks a Sheets call"
//  2. END-TO-END against the REAL worker.js request path + a fake Google that counts what it actually receives: meter == ground truth,
//     two vendors in flight at once keep their own labels (the child-env label must not leak between concurrent requests)
//  3. wiring: /read-meter is admin-only; the quota alarm really reaches the failure ledger.
import fs from 'fs';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
const SRC = fs.readFileSync('worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

// ---------- 1. unit tests on the real meter block ----------
const a = SRC.indexOf('// ── READ METER (Oct 19 2026)'), b = SRC.indexOf('let __sheetsFetchCount = 0;');
t('meter block found in worker.js', a > 0 && b > a);
const block = SRC.slice(a, b);
function build() {
  const st = { clock: Date.UTC(2026, 9, 19, 12, 0, 0), failures: [], logs: [], errors: [], warns: [], reportOk: true };
  class FD extends Date { static now() { return st.clock; } constructor(...x) { super(...(x.length ? x : [st.clock])); } }
  const console2 = { warn: (...x) => st.warns.push(x.join(' ')), error: (...x) => st.errors.push(x.join(' ')), log() {} };
  const reportFailure = async (env, f) => { st.failures.push(f); return st.reportOk ? { ok: true } : { ok: false, error: 'sheet down' }; };
  const tabKey = (path) => { const m = /^\/values\/([^!:?]+)$|^\/values\/([^!:?]+):/.exec(path); return m ? decodeURIComponent(m[1] || m[2]) : null; };
  const api = new Function('Date', 'console', 'reportFailure', '__tabCacheKey', 'BUILD_VERSION', 'URL',
    block + '\nreturn { __meter, __meterReqEnv, __meterIdentify, __meterCronEnv, __meterGoogle, __meterSaved, __meterSnapshot, __meterFlushAlarm, __meterTab, METER_MAX_KEYS };')(
    FD, console2, reportFailure, tabKey, 'test-build', URL);
  return { st, api };
}
{
  const { st, api } = build();
  const env0 = { SHEET_ID: 'S' };
  const e1 = api.__meterReqEnv(env0, { method: 'GET' }, '/estimates');
  api.__meterGoogle(e1, 'GET', '/values/Estimates', 'ok');
  let snap = api.__meterSnapshot(new URL('https://x/read-meter'));
  t('a read before the caller is known is labelled pre-auth, not lost', snap.top_sources.some(x => x.key === 'pre-auth|GET /estimates' && x.reads === 1));
  api.__meterIdentify(e1, 'vendor', '7');
  api.__meterGoogle(e1, 'GET', '/values/Estimates', 'ok');
  api.__meterGoogle(e1, 'POST', '/values/Estimates:append?x=1', 'ok');
  snap = api.__meterSnapshot(new URL('https://x/read-meter'));
  const v = snap.top_sources.find(x => x.key === 'vendor:7|GET /estimates');
  t('after identify: reads, writes and the request itself are counted under who|route', v && v.reads === 1 && v.writes === 1 && v.requests === 1);
  t('totals add up', snap.totals.reads === 2 && snap.totals.writes === 1);
  t('by_kind rolls vendor:7 up to "vendor"', snap.by_kind.some(x => x.key === 'vendor' && x.reads === 1));
  t('tab is reported', snap.top_tabs.some(x => x.key === 'Estimates' && x.reads === 2));
  t('batchGet tabs are named', api.__meterTab('/values:batchGet?ranges=Work_Orders&ranges=Vendors!A1:B2') === 'batchGet(Work_Orders,Vendors)');
  const c = api.__meterCronEnv(env0, 'daily_qb_sync');
  api.__meterGoogle(c, 'GET', '/values/Config', 'ok');
  snap = api.__meterSnapshot(new URL('https://x/read-meter'));
  t('scheduler job reads are labelled cron|job:<name>', snap.top_sources.some(x => x.key === 'cron|job:daily_qb_sync' && x.reads === 1 && x.requests === 1));
  t('relabelling a cron env does not touch the env it was made from', env0.__REQ__ === undefined);
  const cA = api.__meterReqEnv(env0, { method: 'GET' }, '/a'), cB = api.__meterReqEnv(env0, { method: 'GET' }, '/b');
  api.__meterIdentify(cA, 'vendor', '1'); api.__meterIdentify(cB, 'owner', '2');
  api.__meterGoogle(cA, 'GET', '/values/T', 'ok'); api.__meterGoogle(cB, 'GET', '/values/T', 'ok'); api.__meterGoogle(cA, 'GET', '/values/T', 'ok');
  snap = api.__meterSnapshot(new URL('https://x/read-meter'));
  t('two requests in flight keep their own labels', snap.top_sources.find(x => x.key === 'vendor:1|GET /a').reads === 2 && snap.top_sources.find(x => x.key === 'owner:2|GET /b').reads === 1);
  api.__meterSaved(env0, 'hit', 3); api.__meterSaved(env0, 'join');
  snap = api.__meterSnapshot(new URL('https://x/read-meter'));
  t('cache hits and coalesced joins are counted (reads SAVED)', snap.totals.cache_hits === 3 && snap.totals.joined === 1);
}
{ // alarm (Oct 22 2026: a busy-but-not-throttled minute is no longer filed; only a real 429 files the P2 row)
  const { st, api } = build(); const e = api.__meterReqEnv({}, { method: 'GET' }, '/estimates'); api.__meterIdentify(e, 'vendor', '7');
  for (let i = 0; i < 39; i++) api.__meterGoogle(e, 'GET', '/values/Estimates', 'ok');
  t('39 reads in a minute: no alarm yet', api.__meter.pending === null);
  api.__meterGoogle(e, 'GET', '/values/Estimates', 'ok');
  t('40 reads in a minute: alarm raised', api.__meter.pending && api.__meter.pending.why === 'volume');
  const first = api.__meter.pending;
  api.__meterGoogle(e, 'GET', '/values/Estimates', '429');
  t('further pressure while an alarm is pending does not make another', api.__meter.pending === first);
  await api.__meterFlushAlarm({});
  t('flush writes ONE failure-ledger event, severity P2 (never a text), naming the culprit', st.failures.length === 1 && st.failures[0].severity === 'P2' && st.failures[0].where === 'read_meter_quota' && /vendor:7\|GET \/estimates/.test(st.failures[0].message));
  t('pending is cleared after the flush', api.__meter.pending === null);
  api.__meterGoogle(e, 'GET', '/values/Estimates', '429');
  t('within 10 minutes a new 429 does NOT raise another alarm (no ledger flood)', api.__meter.pending === null);
  st.clock += 11 * 60000; api.__meterGoogle(e, 'GET', '/values/Estimates', '429');
  t('after 10 minutes a 429 raises a fresh alarm', api.__meter.pending && api.__meter.pending.why === '429');
  st.reportOk = false; await api.__meterFlushAlarm({});
  t('a ledger write that fails is logged loudly, not swallowed', st.errors.some(x => /could not be saved/.test(x)));
}
{ // writes never alarm; pruning; key cap; never breaks the caller
  const { st, api } = build(); const e = api.__meterReqEnv({}, { method: 'POST' }, '/x'); api.__meterIdentify(e, 'admin/service');
  for (let i = 0; i < 100; i++) api.__meterGoogle(e, 'POST', '/values/Tab:append', 'ok');
  t('writes never trigger the read alarm (so the alarm write cannot loop)', api.__meter.pending === null);
  api.__meterGoogle(e, 'GET', '/values/Tab', 'ok');
  st.clock += 200 * 60000; api.__meterGoogle(e, 'GET', '/values/Tab', 'ok');
  t('minutes older than 180 are dropped (memory is bounded)', api.__meter.mins.size === 1);
  const { api: a2 } = build();
  for (let i = 0; i < 400; i++) { const x = a2.__meterReqEnv({}, { method: 'GET' }, '/r' + i); a2.__meterIdentify(x, 'public'); a2.__meterGoogle(x, 'GET', '/values/Tab', 'ok'); }
  const bk = Array.from(a2.__meter.mins.values())[0];
  t('distinct-source map is capped per minute', bk.bySrc.size <= a2.METER_MAX_KEYS + 1 && bk.bySrc.has('(other)'));
  t('...and the overflow is still counted in the totals', a2.__meterSnapshot(new URL('https://x/r')).totals.reads === 400);
  const { st: st3, api: a3 } = build(); const bad = { get __REQ__() { throw new Error('boom'); } };
  let threw = false; try { a3.__meterGoogle(bad, 'GET', '/values/T', 'ok'); a3.__meterSaved(bad, 'hit'); a3.__meterIdentify(bad, 'x'); } catch (e2) { threw = true; }
  t('a meter fault never throws into a Sheets call, and is logged', !threw && st3.errors.some(x => /read-meter\] FAULT/.test(x)));
}

// ---------- 2. end to end: REAL worker.js vs a fake Google that counts what it receives ----------
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SECRET = 'meter-secret';
const CARDS = 12;
const WOS = [['ID', 'Vendor_ID', 'Property_ID', 'Status', 'Type', 'Voided']];
for (let i = 1; i <= CARDS; i++) WOS.push(['WO-' + i, '7', 'P1', 'Open', '', '']);
for (let i = 1; i <= CARDS; i++) WOS.push(['WO-8' + i, '8', 'P1', 'Open', '', '']);
const TABS = { Work_Orders: WOS, Tenants: [['ID', 'Active']], Properties: [['ID', 'Owner_ID'], ['P1', '1']],
  Estimates: [['ID', 'WO_ID', 'Version', 'Status', 'Active', 'Line_Items'], ['E1', 'WO-1', '1', 'Pending', 'TRUE', '[]']],
  Time_Entries: [['ID', 'WO_ID', 'Vendor_ID']], Receipts: [['ID', 'WO_ID', 'Vendor_ID']], Vendor_Bills: [['ID', 'WO_ID', 'Vendor_ID']] };
let upstreamReads = 0, upstream429 = 0, throttleNext = 0; const writes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
  if (url.includes('sheets.googleapis.com')) {
    const isRead = !opts || !opts.method || opts.method === 'GET';
    if (!isRead) { writes.push({ url, body: opts && opts.body ? String(opts.body) : '' }); return new Response(JSON.stringify({ updates: {}, updatedRange: '' })); }
    await new Promise(r => setTimeout(r, 15));
    upstreamReads++;
    if (throttleNext > 0) { throttleNext--; upstream429++; return new Response(JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'", status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }); }
    const u = new URL(url);
    if (u.pathname.endsWith('/values:batchGet')) return new Response(JSON.stringify({ valueRanges: u.searchParams.getAll('ranges').map(r => ({ range: r, values: TABS[r] || [['ID']] })) }));
    const tab = decodeURIComponent(u.pathname.split('/values/')[1] || '');
    return new Response(JSON.stringify({ range: tab, values: TABS[tab] || [['ID']] }));
  }
  return new Response('{}');
};
const worker = (await import(pathToFileURL(process.cwd() + '/worker.js').href)).default;
const env = { WORKER_SECRET: SECRET, SHEET_ID: 'S', GOOGLE_SA_EMAIL: 'sa@x.iam', GOOGLE_SA_KEY: pem };
const b64 = x => Buffer.from(x).toString('base64url');
const tokenFor = (role, id) => { const body = b64(JSON.stringify({ role, id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const waits = []; const ctx = { waitUntil: p => waits.push(p) };
const call = async (path, tok) => { const r = await worker.fetch(new Request('https://hub.test' + path, { headers: tok ? { 'X-Auth-Token': tok } : {} }), env, ctx); let j = null; try { j = await r.json(); } catch (e) { /* not json */ } return { status: r.status, j }; };
const adminMeter = async (q) => (await call('/read-meter' + (q || ''), SECRET)).j;

const t7 = tokenFor('vendor', '7'), t8 = tokenFor('vendor', '8');
const before = await adminMeter();
t('endpoint answers for the admin and starts empty', before && before.totals && before.totals.reads === 0 && before.meter_faults === 0);
const jobs = [];
for (let n = 1; n <= CARDS; n++) jobs.push(call('/estimates?wo_id=WO-' + n, t7));                       // vendor 7 only ever asks for /estimates
for (let n = 1; n <= CARDS; n++) jobs.push(call('/time-entries?wo_id=WO-8' + n + '&vendor_id=8', t8));  // vendor 8 only ever asks for /time-entries
const res = await Promise.all(jobs);
t('the requests themselves still work (meter did not disturb them)', res.every(r => r.status === 200));
let snap = await adminMeter();
t('GROUND TRUTH: meter reads == reads Google actually received (admin /read-meter call itself costs none)', snap.totals.reads === upstreamReads && upstreamReads > 0);
t('requests are counted per caller and route', (snap.top_sources.find(x => x.key === 'vendor:7|GET /estimates') || {}).requests === CARDS && (snap.top_sources.find(x => x.key === 'vendor:8|GET /time-entries') || {}).requests === CARDS);
t('concurrent vendors never leak labels (7 never on /time-entries, 8 never on /estimates)', !snap.top_sources.some(x => x.key === 'vendor:7|GET /time-entries' || x.key === 'vendor:8|GET /estimates'));
t('every read is attributed to somebody (nothing unlabelled)', !snap.top_sources.some(x => x.key.indexOf('unlabeled') === 0));
t('the coalescing/cache savings show up', snap.totals.cache_hits + snap.totals.joined > 0);
const sumKind = snap.by_kind.reduce((m, x) => m + x.reads, 0);
t('by_kind adds up to the total', sumKind === snap.totals.reads);

// who may read the meter
t('a vendor session cannot read the meter', (await call('/read-meter', t7)).status === 401);
t('an owner session cannot read the meter', (await call('/read-meter', tokenFor('owner', '1'))).status === 401);
t('no token cannot read the meter', (await call('/read-meter', '')).status === 401);

// 429s are counted too, and reach the failure ledger
const r429Before = snap.totals.r429;
throttleNext = 2; const wBefore = writes.length;
const inv = await call('/invoices', SECRET);   // a tab nothing has read yet (the 6s cache would hide it), so it really goes to Google through the throttle
t('a throttled read still succeeds after its retries', inv.status === 200);
await Promise.all(waits.splice(0)); 
snap = await adminMeter();
t('Google throttles are counted exactly (meter r429 == fake Google 429s)', snap.totals.r429 - r429Before === upstream429 && upstream429 === 2);
t('GROUND TRUTH still holds after retries (each retry is a real attempt)', snap.totals.reads === upstreamReads);
const alarmWrites = writes.slice(wBefore).filter(w => /read_meter_quota/.test(w.body));
t('the 429s put a P2 "read_meter_quota" row into the failure ledger, with the culprit named', alarmWrites.length === 1 && /P2/.test(alarmWrites[0].body) && /GET \/invoices/.test(alarmWrites[0].body));
// the meter's own source text
const admin = snap.top_sources.find(x => x.key === 'admin/service|GET /invoices' && x.r429 === 2);
t('admin/service calls are labelled', !!admin);

// ---------- 3. wiring ----------
t('/read-meter is NOT a public path', !/const PUBLIC_PATHS = \[[^\]]*'\/read-meter'/.test(SRC));
t('/read-meter is in no role scope', !/ROLE_SCOPES[\s\S]{0,4000}'\/read-meter'/.test(SRC.slice(SRC.indexOf('const ROLE_SCOPES'), SRC.indexOf('const ROLE_SCOPES') + 4000)));
t('scheduler jobs are labelled with their name', SRC.includes('__meterCronEnv(__cronEnv(env), job.name)'));
t('the Uplisting env-name probe sees inherited keys (per-request child env)', SRC.includes('for (const k in (env || {})) o.push(k)') && !SRC.includes("Object.keys(env || {}).filter(k => /uplist/i.test(k))"));
globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
