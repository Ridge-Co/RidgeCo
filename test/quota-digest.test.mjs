// Queue #233 (Nov 22 2026): yesterday's Sheets read-quota spenders in the morning digest.
// The REAL ReadMeterStore class and digest helpers are sliced out of worker.js and run against a fake Durable Object storage.
import fs from 'fs';
import assert from 'node:assert';
const W = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
function grab(src, sig) {
  const st = src.indexOf(sig); if (st < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', st); let d = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } }
  return src.slice(st, i + 1);
}
const consts = 'const METER_STORE_TTL_S = 2 * 60 * 60; const METER_DAILY_KEEP_DAYS = 8; const METER_DAILY_BUSY_READS = 40;';
const api = new Function('console', 'Response', 'URL', 'reportFailure', consts + '\n' + grab(W, 'export class ReadMeterStore').replace('export class', 'class') + '\n' + grab(W, 'function __digestSrcLabel') + '\n' + grab(W, 'function quotaDigestLine') + '\nreturn { ReadMeterStore, __digestSrcLabel, quotaDigestLine };')(console, Response, URL, async () => ({ ok: true }));
function fakeStorage() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined), put: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); }, list: async ({ prefix }) => new Map(Array.from(m.entries()).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])) };
}
const realNow = Date.now; let clock = Date.UTC(2026, 10, 20, 15, 0, 30); Date.now = () => clock;
const stor = fakeStorage(); const store = new api.ReadMeterStore({ storage: stor }, {});
const put = async (id, mins, tag = 'prd') => (await store.fetch(new Request('https://x/put', { method: 'POST', body: JSON.stringify({ id, tag, build: 'b', payload: { v: 1, mins } }) }))).text();
const daily = async (date, tag = 'prd') => (await (await store.fetch(new Request('https://x/daily?tag=' + tag + '&date=' + date))).json()).record;
const M = (t, r, x, src, tab) => ({ t, r, x: x || 0, s: src || [['admin|GET /workorders', r, 0, 0, 1]], a: tab || [['Work_Orders', r, 0, 0, 0]] });
const min = (h, m) => Date.UTC(2026, 10, 20, h, m, 0);

// overlapping 60-minute payloads from two instances: totals equal ground truth, nothing counted twice
await put('A', [M(min(14, 10), 10), M(min(14, 11), 20)]);
await put('B', [M(min(14, 10), 5), M(min(14, 12), 7)]);
await put('A', [M(min(14, 10), 10), M(min(14, 11), 20), M(min(14, 13), 3)]);   // same minutes again plus a new one
await put('B', [M(min(14, 10), 5), M(min(14, 12), 7)]);
let day = await daily('2026-11-20');
ok(day.reads === 10 + 20 + 5 + 7 + 3, 'two instances, overlapping payloads: day total equals the true total, minutes not double counted', day.reads);
ok(day.mins[String(min(14, 10) / 60000)][0] === 15, 'the same minute from two instances adds');
// minute still in progress is skipped, then counted once it is over
const cur = Math.floor(clock / 60000) * 60000;
await put('C', [M(cur, 99)]);
ok((await daily('2026-11-20')).reads === 45, 'the minute still in progress is not counted');
clock += 120000; await put('C', [M(cur, 99)]);
ok((await daily('2026-11-20')).reads === 45 + 99, 'counted once the minute is over, and only once', (await daily('2026-11-20')).reads);
await put('C', [M(cur, 99)]); ok((await daily('2026-11-20')).reads === 144, 'saving it again adds nothing');
// staging and production are separate
await put('S', [M(min(14, 20), 50)], 'stg');
ok((await daily('2026-11-20', 'stg')).reads === 50 && (await daily('2026-11-20')).reads === 144, 'staging tally is separate from production');
// Eastern day roll-over around the Nov 1 2026 clock change (EDT -> EST at 06:00 UTC)
clock = Date.UTC(2026, 10, 3, 12, 0, 0);
await put('D', [M(Date.UTC(2026, 10, 2, 3, 30), 4), M(Date.UTC(2026, 10, 2, 4, 30), 6), M(Date.UTC(2026, 10, 2, 5, 30), 8)]);
ok((await daily('2026-11-01')).reads === 4 + 6 && (await daily('2026-11-02')).reads === 8, 'ET date: 03:30Z and 04:30Z are still Nov 1 (EST), 05:30Z is Nov 2? check', [(await daily('2026-11-01')), (await daily('2026-11-02'))]);
// refusals counted; 8-day pruning
await put('E', [M(Date.UTC(2026, 10, 2, 8, 0), 3, 2)]);
ok((await daily('2026-11-02')).x === 2, 'refusals (429) are tallied');
clock = Date.UTC(2026, 10, 25, 12, 0, 0); store.lastPrune = 0; await put('F', [M(Date.UTC(2026, 10, 25, 11, 0), 1)]);
ok((await daily('2026-11-01')) === null && (await daily('2026-11-20')) !== null && (await daily('2026-11-25')) !== null, 'days older than 8 days are dropped, newer ones kept');
clock = Date.UTC(2026, 10, 30, 12, 0, 0); store.lastPrune = 0; await put('G', [M(Date.UTC(2026, 10, 30, 11, 0), 1)]);
ok(!Array.from(stor.m.keys()).some(k => k.startsWith('f:prd:A')), 'the "already counted" markers expire too');
// bad date
ok((await store.fetch(new Request('https://x/daily?tag=prd&date=nope'))).status === 400, 'a bad date is refused');
// a fold problem is reported, not hidden: the put answer says so
{ const bad = fakeStorage(); const origGet = bad.get; bad.get = async (k) => { if (k.startsWith('f:')) throw new Error('disk gone'); return origGet(k); };
  const s2 = new api.ReadMeterStore({ storage: bad }, {}); const r = await (await s2.fetch(new Request('https://x/put', { method: 'POST', body: JSON.stringify({ id: 'Z', tag: 'prd', payload: { v: 1, mins: [M(min(14, 30), 1)] } }) }))).text();
  ok(/fold error: disk gone/.test(r) && bad.m.has('i:prd:Z'), 'if the tally cannot be written, the answer says so and the instance record is still saved'); }
// digest line
const line = api.quotaDigestLine;
ok(line({ ok: true, refusals: 0, busy_minutes: 2, top_sources: [], no_data: false }, 5) === '', 'calm day adds nothing');
ok(line({ ok: true, refusals: 0, busy_minutes: 0, top_sources: [], no_data: true }, 5) === '', 'no data adds nothing');
const busy = { ok: true, refusals: 3, busy_minutes: 12, top_sources: [['job sweep_work', 410], ['vendor /portal', 220], ['admin GET /workorders', 180], ['x y', 5]], no_data: false };
ok(line(busy, 5) === 'Sheets quota: 12 busy minutes, 3 refusals yesterday. Top: job sweep_work 410, vendor /portal 220, admin GET /workorders 180.' && line(busy, 5).length <= 130, 'busy day: exactly one line, top three, under 130 characters');
ok(line({ ok: true, refusals: 0, busy_minutes: 5, top_sources: [['a b', 1]], no_data: false }, 5) !== '' && line({ ok: true, refusals: 0, busy_minutes: 5, top_sources: [], no_data: false }, 6) === '', 'threshold setting: 5 busy minutes at the default, higher when Config says so');
ok(line({ ok: false, error: 'x' }, 5) === 'Sheets quota: could not read yesterday\'s meter', 'unreadable store: says so, never "no problems"');
ok(line({ ok: true, refusals: 1, busy_minutes: 0, top_sources: [], no_data: false }, 5).startsWith('Sheets quota: 0 busy minutes, 1 refusals'), 'any refusal adds the line');
// labels carry no personal data
const L = api.__digestSrcLabel;
ok(L('vendor:4105551234|GET /vendor-wos/WO-1192') === 'vendor GET /vendor-wos/:id', 'vendor session id and work order number are not in the label', L('vendor:4105551234|GET /vendor-wos/WO-1192'));
ok(L('tenant:Jane Smith 5|POST /tenant-note') === 'tenant POST /tenant-note' && !/Jane|\d{5}/.test(L('tenant:Jane Smith 5|POST /tenant-note')), 'a name in the caller label is dropped');
ok(L('cron|job:sweep_work') === 'job sweep_work' && L('admin|GET /workorders?phone=4105551234') === 'admin GET /workorders', 'job names stay; query strings are dropped');
// digest wiring: zero extra Sheets reads
{
  const bd = grab(W, 'async function buildDigest');
  ok(/__meterDaily\(env, null\)/.test(bd) && /quota_digest_read/.test(bd), 'buildDigest reads the tally from the store and files one failure row when it cannot');
  const md = grab(W, 'async function __meterDaily');
  ok(!/fetchTab|sheetsRequest|fetchConfig/.test(md), 'the daily tally reads the Durable Object only: zero Sheets reads');
  ok(/parseInt\(cfg\.quota_digest_min_busy_minutes, 10\)/.test(grab(W, 'async function deliverDigest')), 'the busy-minutes threshold comes from Config quota_digest_min_busy_minutes');
}
Date.now = realNow;
console.log('quota-digest: ' + n + ' checks passed');
