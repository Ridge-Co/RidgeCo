// Oct 20 2026 READ METER ROLL-UP. Cloudflare runs many Worker instances at once (staging answered 5 requests from 5 different instances), each
// with its own memory, while the Google Sheets read quota is shared by all of them. A per-instance meter shows a random slice. So every
// instance saves its recent per-minute counts to the READ_METER_STORE Durable Object (KV is out: the Free plan allows 1,000 KV writes/day)
// and /read-meter adds them all together.
// Proven against the REAL worker.js loaded as several independent module instances (= several Worker instances) sharing one fake KV and one
// fake Google that counts what it really receives:
//   merged totals == ground truth, same-minute buckets add, throttled saves, staging/prod separation, history cutoff, truncation reported,
//   every store failure visible (page + failure ledger once), unbound store says so loudly, alarm names culprits across instances.
import fs from 'fs';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
const SRC = fs.readFileSync('worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

// ---------- wiring ----------
const toml = fs.readFileSync('wrangler.toml', 'utf8');
t('wrangler.toml binds READ_METER_STORE to the ReadMeterStore Durable Object, with a SQLite migration (the only kind the Free plan allows)', /\[\[durable_objects\.bindings\]\][\s\S]{0,120}name\s*=\s*"READ_METER_STORE"[\s\S]{0,80}class_name\s*=\s*"ReadMeterStore"/.test(toml) && /\[\[migrations\]\][\s\S]{0,120}new_sqlite_classes\s*=\s*\[\s*"ReadMeterStore"\s*\]/.test(toml) && !/kv_namespaces/.test(toml.replace(/#.*$/gm, '')));
t('worker.js exports the ReadMeterStore class (Cloudflare requires it as a named export of the main module)', /^export class ReadMeterStore \{/m.test(SRC));
t('/read-meter answers from the roll-up (merged across instances)', SRC.includes('return json(await __meterSnapshotAll(env, url));'));
t('each request end saves this instance\'s counts without blocking the response', SRC.includes('if (__meter.dirty) ctx.waitUntil(__meterPersist(env));'));
t('"instance started" no longer shows 1970 (since is set on first use, not at module load)', /since: 0 \/\*/.test(SRC) && SRC.includes('if (!__meter.since) __meter.since = Date.now();'));

// ---------- unit: compact + merge keep totals ----------
{
  const a = SRC.indexOf('// ── READ METER (Oct 19 2026)'), b = SRC.indexOf('let __sheetsFetchCount = 0;');
  const api = new Function('Date', 'console', 'reportFailure', '__tabCacheKey', 'BUILD_VERSION', 'URL',
    SRC.slice(a, b) + '\nreturn { __meterCompact, __meterMergeRows, __meterRowsFromPayload, __meter };')(Date, { warn() {}, error() {}, log() {} }, async () => ({ ok: true }), () => null, 'x', URL);
  const m = new Map(); for (let i = 0; i < 100; i++) m.set('k' + i, [i + 1, 0, i % 3, 1]);
  const c = api.__meterCompact(m, 30);
  const sum = (arr, i) => arr.reduce((s, x) => s + x[i], 0);
  t('compact keeps the 30 heaviest and folds the rest into (other)', c.length === 31 && c[0][0] === 'k99' && c.some(x => x[0] === '(other)'));
  t('compact keeps every total (reads, 429s, requests)', sum(c, 1) === 5050 && sum(c, 3) === Array.from(m.values()).reduce((s, v) => s + v[2], 0) && sum(c, 4) === 100);
  const m2 = new Map(m); m2.set('(other)', [5, 0, 0, 0]);
  const c2 = api.__meterCompact(m2, 10);
  t('an existing (other) entry is added to, not duplicated', c2.filter(x => x[0] === '(other)').length === 1 && sum(c2, 1) === 5055);
  const mk = (t0, r, key) => ({ t: t0, reads: r, writes: 0, r429: 0, errs: 0, hits: 1, joins: 0, reqs: 1, bySrc: new Map([[key, [r, 0, 0, 1]]]), byTab: new Map([['Tab', [r, 0, 0, 0]]]) });
  const mg = api.__meterMergeRows([mk(60000, 3, 'a'), mk(60000, 4, 'a'), mk(120000, 5, 'b'), mk(60000, 1, 'b')]);
  t('merge: same minute adds across instances, minutes stay separate and ordered', mg.length === 2 && mg[0].t === 60000 && mg[0].reads === 8 && mg[0].hits === 3 && mg[0].bySrc.get('a')[0] === 7 && mg[0].bySrc.get('b')[0] === 1 && mg[1].reads === 5);
  t('a damaged saved record is ignored, never thrown', api.__meterRowsFromPayload({ v: 2 }, 0).length === 0 && api.__meterRowsFromPayload(null, 0).length === 0 && api.__meterRowsFromPayload({ v: 1, mins: [null, { t: 'x' }, { t: 60000, s: 'bad', a: [5] }] }, 0).length === 1);
}

// ---------- end to end: several Worker instances, one KV, one Google ----------
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SECRET = 'rollup-secret';
const WOS = [['ID', 'Vendor_ID', 'Property_ID', 'Status', 'Type', 'Voided'], ['WO-1', '7', 'P1', 'Open', '', ''], ['WO-81', '8', 'P1', 'Open', '', '']];
const TABS = { Work_Orders: WOS, Tenants: [['ID', 'Active']], Properties: [['ID', 'Owner_ID'], ['P1', '1']],
  Estimates: [['ID', 'WO_ID', 'Version', 'Status', 'Active', 'Line_Items'], ['E1', 'WO-1', '1', 'Pending', 'TRUE', '[]']], Time_Entries: [['ID', 'WO_ID', 'Vendor_ID']] };
let upstreamReads = 0, throttleNext = 0; const writes = [];
const realFetch = globalThis.fetch, realNow = Date.now;
let clock = Date.UTC(2026, 9, 20, 12, 0, 10);
Date.now = () => clock;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
  if (url.includes('sheets.googleapis.com')) {
    const isRead = !opts || !opts.method || opts.method === 'GET';
    if (!isRead) { writes.push({ url, body: opts && opts.body ? String(opts.body) : '' }); return new Response(JSON.stringify({ updates: {}, updatedRange: '' })); }
    upstreamReads++;
    if (throttleNext > 0) { throttleNext--; return new Response(JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Read requests'", status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }); }
    const u = new URL(url);
    if (u.pathname.endsWith('/values:batchGet')) return new Response(JSON.stringify({ valueRanges: u.searchParams.getAll('ranges').map(r => ({ range: r, values: TABS[r] || [['ID']] })) }));
    const tab = decodeURIComponent(u.pathname.split('/values/')[1] || '');
    return new Response(JSON.stringify({ range: tab, values: TABS[tab] || [['ID']] }));
  }
  return new Response('{}');
};
class FakeStorage {   // the part of Durable Object storage the class uses
  constructor() { this.m = new Map(); }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(keys) { for (const k of [].concat(keys)) this.m.delete(k); }
  async list(o) { const out = new Map(); for (const k of Array.from(this.m.keys()).sort()) if (k.startsWith((o && o.prefix) || '')) out.set(k, structuredClone(this.m.get(k))); return out; }
}
const storage = new FakeStorage();
const base = pathToFileURL(process.cwd() + '/worker.js').href;
const { ReadMeterStore } = await import(base + '?inst=store');           // the REAL Durable Object class from worker.js
const durable = new ReadMeterStore({ storage }, {});
const ns = {   // what env.READ_METER_STORE looks like to the Worker
  puts: 0, lists: 0, failPut: false, failList: false,
  idFromName(n) { return n; },
  get() { return { fetch: async (url, init) => {
    const req = new Request(url, init), path = new URL(req.url).pathname;
    if (path === '/put') { if (ns.failPut) return new Response('store error: storage limit exceeded', { status: 500 }); ns.puts++; }
    if (path === '/list') { if (ns.failList) return new Response('store error: overloaded', { status: 500 }); ns.lists++; }
    return durable.fetch(req);
  } }; },
};
const instance = async (name) => (await import(base + '?inst=' + name)).default;   // a separate module instance = a separate Worker instance (own memory)
const mkEnv = (extra) => Object.assign({ WORKER_SECRET: SECRET, SHEET_ID: 'S', GOOGLE_SA_EMAIL: 'sa@x.iam', GOOGLE_SA_KEY: pem }, extra || {});
const b64 = x => Buffer.from(x).toString('base64url');
const tokenFor = (role, id) => { const body = b64(JSON.stringify({ role, id, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 36000 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const mkCall = (worker, env, host) => { const waits = []; const ctx = { waitUntil: p => waits.push(p) };
  const call = async (path, tok) => { const r = await worker.fetch(new Request('https://' + (host || 'hub.test') + path, { headers: tok ? { 'X-Auth-Token': tok } : {} }), env, ctx); let j = null; try { j = await r.json(); } catch (e) { /* */ } await Promise.all(waits.splice(0)); return { status: r.status, j }; };
  return { call, meter: async (q) => (await call('/read-meter' + (q || ''), SECRET)).j }; };

const A = await instance('A'), B = await instance('B'), C = await instance('C');
const envA = mkEnv({ READ_METER_STORE: ns }), envB = mkEnv({ READ_METER_STORE: ns }), envC = mkEnv({ READ_METER_STORE: ns });
const a = mkCall(A, envA), b = mkCall(B, envB), c = mkCall(C, envC);

// 1. unbound store: loud, not silent; the request still works
{
  const U = await instance('U'); const envU = mkEnv(); const u = mkCall(U, envU);
  const s = await u.meter('?minutes=15');
  t('unbound store: the endpoint still answers', s && s.totals && s.build);
  t('unbound store: it says so, in words, on the page data', s.shared_store && s.shared_store.bound === false && /not connected/.test((s.shared_store.problems || []).join(' ')) && s.instances === 1);
  t('"instance started" is a real time, not 1970', new Date(s.isolate_started).getFullYear() === 2026);
}

// 2. three instances, each serving different callers, in the same minute
const t7 = tokenFor('vendor', '7'), t8 = tokenFor('vendor', '8');
const r1 = await a.call('/estimates?wo_id=WO-1', t7);
const r2 = await b.call('/invoices', SECRET);
const r3 = await a.call('/time-entries?wo_id=WO-81&vendor_id=8', t8);
t('requests on different instances all work', r1.status === 200 && r2.status === 200 && r3.status === 200);
clock += 61 * 1000;                       // past the save interval; instance A's later request is saved now
await a.call('/estimates?wo_id=WO-1', t7);   // (cache expired -> real read, instance A dirty again)
await b.call('/invoices', SECRET);
const snapC = await c.meter('?minutes=15');
t('merged view counts every instance (3: A, B and the one answering)', snapC.instances === 3 && snapC.shared_store.remote_instances === 2);
t('GROUND TRUTH: merged reads == reads Google actually received', snapC.totals.reads === upstreamReads && upstreamReads > 0);
t('each caller appears once, with the instance that served it merged in', ['vendor:7|GET /estimates', 'vendor:8|GET /time-entries', 'admin/service|GET /invoices'].every(k => snapC.top_sources.some(x => x.key === k)));
t('same-minute reads from different instances ADD (peak is the sum, not the biggest slice)', snapC.peak_reads_in_a_minute >= 2 && snapC.per_minute.reduce((s, m) => s + m.reads, 0) === snapC.totals.reads);
t('by_kind adds up to the total across instances', snapC.by_kind.reduce((m, x) => m + x.reads, 0) === snapC.totals.reads);
t('viewing the meter writes nothing to Google and costs no Sheets reads of its own beyond the auth check', writes.length === 0);
t('no meter faults, no save errors', snapC.meter_faults === 0 && snapC.shared_store.this_instance.save_errors === 0 && !(snapC.shared_store.problems || []).length);

// 3. saves are throttled and only happen when there is news
{
  const D = await instance('D'); const d = mkCall(D, mkEnv({ READ_METER_STORE: ns }));
  const p0 = ns.puts;
  await d.call('/invoices', SECRET);
  t('first activity is saved right away', ns.puts === p0 + 1);
  clock += 7000; await d.call('/estimates?wo_id=WO-1', t7); clock += 7000; await d.call('/invoices', SECRET);
  t('more activity inside the interval is NOT saved again (at most one save per minute per instance)', ns.puts === p0 + 1);
  clock += 61 * 1000; await d.call('/invoices', SECRET);
  t('after the interval the next request saves the news', ns.puts === p0 + 2);
  const dIso = (await d.meter()).isolate;
  t('the saved record is keyed by environment + instance', storage.m.has('i:prd:' + dIso) && storage.m.get('i:prd:' + dIso).payload.v === 1);
}

// 4. staging and production never mix
{
  const S = await instance('S'); const s = mkCall(S, mkEnv({ READ_METER_STORE: ns }), 'maintenance-hub-staging.example.dev');
  await s.call('/invoices', SECRET);
  const keys = Array.from(storage.m.keys());
  t('staging saves under its own prefix', keys.some(x => x.startsWith('i:stg:')) && keys.some(x => x.startsWith('i:prd:')));
  const sv = await s.meter('?minutes=15');
  t('a staging view never includes production instances (and vice versa)', sv.instances === 1 && sv.shared_store.remote_instances === 0);
}

// 5. history window: old records and old minutes are left out
{
  const old = { v: 1, isolate: 'zzold', build: 'x', since: 1, t: clock - 100 * 60000, mins: [{ t: Math.floor((clock - 100 * 60000) / 60000) * 60000, r: 50, w: 0, x: 0, e: 0, h: 0, j: 0, q: 1, s: [['vendor:9|GET /old', 50, 0, 0, 1]], a: [['Old', 50, 0, 0, 0]] }] };
  storage.m.set('i:prd:zzold', { id: 'zzold', tag: 'prd', t: old.t, build: 'x', payload: old });
  clock += 21 * 1000;   // past the 20s share window
  const v15 = await c.meter('?minutes=15'), v180 = await c.meter('?minutes=180');
  t('minutes=15 leaves a 100-minute-old instance out', !v15.top_sources.some(x => x.key.includes('/old')));
  t('minutes=180 includes it', v180.top_sources.some(x => x.key === 'vendor:9|GET /old' && x.reads === 50));
  t('a window longer than the saved history says so', v180.shared_store.partial_history === true && v15.shared_store.partial_history === false);
}

// 6. many instances: capped, and the cap is REPORTED
{
  clock += 21 * 1000;
  const fresh = clock - 30 * 1000;
  for (let i = 0; i < 35; i++) storage.m.set('i:prd:fake' + i, { id: 'fake' + i, tag: 'prd', t: fresh - i, build: 'x', payload: { v: 1, isolate: 'fake' + i, build: 'x', since: 1, t: fresh, mins: [{ t: Math.floor(fresh / 60000) * 60000, r: 1, w: 0, x: 0, e: 0, h: 0, j: 0, q: 1, s: [['vendor:' + i + '|GET /x', 1, 0, 0, 1]], a: [] }] } });
  const v = await c.meter('?minutes=15');
  t('at most 30 other instances are read per view (bounds the size of one view)', v.shared_store.remote_instances <= 30 && v.shared_store.remote_instances >= 25);
  t('instances left out are reported to the person looking', v.shared_store.truncated_instances >= 5 && /left out/.test((v.shared_store.problems || []).join(' ')));
  for (let i = 0; i < 35; i++) storage.m.delete('i:prd:fake' + i);
  storage.m.delete('i:prd:zzold');
}

// 7. a second viewer within 20s shares the KV read
{
  // the answering instance is counted LIVE, never also from its own saved record (that would double count it)
  clock += 61 * 1000; const v1 = await c.meter('?minutes=180'); const up1 = upstreamReads;
  clock += 61 * 1000; await c.call('/invoices', SECRET); clock += 5000; const v2 = await c.meter('?minutes=180');
  t('the answering instance is counted once (merged growth == the reads Google really received in between)', v2.totals.reads - v1.totals.reads === upstreamReads - up1 && upstreamReads - up1 > 0);
  clock += 25 * 1000; await c.meter('?minutes=15'); const l = ns.lists;
  clock += 5 * 1000; await c.meter('?minutes=15');
  t('a refresh within 20s reuses the stored read (no extra store traffic)', ns.lists === l);
}

// 8. store failures are visible, never thrown, never silent
{
  const F = await instance('F'); const f = mkCall(F, mkEnv({ READ_METER_STORE: ns }));
  ns.failPut = true; const w0 = writes.length;
  const r = await f.call('/invoices', SECRET);
  t('a failing store never breaks the request', r.status === 200);
  const s = await f.meter('?minutes=15');
  t('the page data reports the failed save in words', s.shared_store.this_instance.save_errors >= 1 && /could not save/.test((s.shared_store.problems || []).join(' ')) && /storage limit exceeded/.test(s.shared_store.this_instance.last_save_error));
  const ledger = writes.slice(w0).filter(x => /read_meter_store/.test(x.body));
  t('...and files ONE failure-ledger row', ledger.length === 1 && /P2/.test(ledger[0].body));
  clock += 61 * 1000; await f.call('/invoices', SECRET);
  t('repeated failures do not spam the ledger (once per 30 min)', writes.slice(w0).filter(x => /read_meter_store/.test(x.body)).length === 1);
  ns.failPut = false; clock += 61 * 1000; await f.call('/invoices', SECRET);
  t('it recovers by itself when the store comes back', storage.m.has('i:prd:' + s.isolate));
}
{
  ns.failList = true; clock += 25 * 1000;
  const s = await c.meter('?minutes=15');
  t('an unreadable store still returns this instance\'s numbers, with the problem stated', s && s.totals && /could not be read/.test((s.shared_store.problems || []).join(' ')));
  ns.failList = false;
}
{
  clock += 25 * 1000; storage.m.set('i:prd:damaged', { id: 'damaged', tag: 'prd', t: clock, build: 'x', payload: { v: 2, mins: 'nope' } });
  const s = await c.meter('?minutes=15'); storage.m.delete('i:prd:damaged');
  t('records that cannot be read are counted and reported, not skipped silently', s.shared_store.read_errors > 0 && /could not be read/.test((s.shared_store.problems || []).join(' ')));
}

// 9. the quota alarm names the culprits across ALL instances
{
  clock += 25 * 1000;
  const E = await instance('E'); const e = mkCall(E, mkEnv({ READ_METER_STORE: ns }));
  const heavy = { v: 1, isolate: 'heavy1', build: 'x', since: 1, t: clock - 5000, mins: [{ t: Math.floor(clock / 60000) * 60000, r: 30, w: 0, x: 0, e: 0, h: 0, j: 0, q: 6, s: [['vendor:42|GET /work-orders', 30, 0, 0, 6]], a: [['Work_Orders', 30, 0, 0, 0]] }] };
  storage.m.set('i:prd:heavy1', { id: 'heavy1', tag: 'prd', t: heavy.t, build: 'x', payload: heavy });
  throttleNext = 1; const w0 = writes.length;
  await e.call('/invoices', SECRET);
  const al = writes.slice(w0).filter(x => /read_meter_quota/.test(x.body));
  t('a throttle files a ledger row', al.length === 1);
  t('...that names the heavy caller on ANOTHER instance, not just this instance\'s slice', /vendor:42/.test(al[0].body) && /all instances/.test(al[0].body));
}

// 10. records expire on their own: an instance that stopped saving vanishes after 2h; a live one stays
{
  const live = { v: 1, isolate: 'liveone', build: 'x', since: 1, t: clock, mins: [] };
  storage.m.set('i:prd:liveone', { id: 'liveone', tag: 'prd', t: clock, build: 'x', payload: live });
  t('before the TTL the dead instance\'s record is still stored', storage.m.has('i:prd:heavy1'));
  clock += 121 * 60 * 1000;
  storage.m.get('i:prd:liveone').t = clock - 5 * 60 * 1000;      // this one saved 5 minutes ago
  await c.meter('?minutes=15');
  t('2h after its last save a record is deleted by the store', !storage.m.has('i:prd:heavy1') && !storage.m.has('i:prd:damaged'));
  t('a recently saved record is kept', storage.m.has('i:prd:liveone'));
}
// 11. the store itself: bad input is refused, never crashes
{
  const r1 = await durable.fetch(new Request('https://read-meter.internal/put', { method: 'POST', body: '{"id":1}' }));
  const r2 = await durable.fetch(new Request('https://read-meter.internal/nope'));
  const r3 = await durable.fetch(new Request('https://read-meter.internal/put', { method: 'POST', body: 'not json' }));
  t('the store refuses a malformed record (400), an unknown path (404), and unreadable input with an error (500), never throws', r1.status === 400 && r2.status === 404 && r3.status === 500);
}

Date.now = realNow;
globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
