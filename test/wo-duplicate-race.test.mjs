// Root-cause regression test for WO-1213/WO-1214 (2026-09-23): tenant Lance Serafica submitted
// the identical complaint twice, 30s apart, and both landed as separate work orders even though
// rule 162 wired findRecentDuplicate into createWorkOrder specifically to prevent this class of
// bug. These run the REAL createWorkOrder + claimWOSignature + findRecentDuplicate extracted
// straight from worker.js against an in-memory fake Sheets backend with an INJECTED, controllable
// network delay on every request — so the test can actually reproduce the two conditions that let
// the original pair through:
//   1. A true TOCTOU race — two requests that both read Work_Orders before either has appended.
//   2. Realistic Sheets-API latency shrinking what looked like a "30s apart" gap in wall-clock
//      request time into something narrower by the time each request's own duplicate check runs.
// See the comment in createWorkOrder (worker.js) for the two-part fix this exercises: the
// synchronous same-isolate claim (claimWOSignature) and the widened 60s Work_Orders window.
import fs from 'fs';

const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}
function grabRange(src, startSig, endSig) {
  const start = src.indexOf(startSig);
  if (start < 0) throw new Error('not found: ' + startSig);
  const end = src.indexOf(endSig, start);
  if (end < 0) throw new Error('end not found: ' + endSig);
  return src.slice(start, end);
}
function grabConst(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } };

// A fake, advanceable Date so "30 seconds apart" can be simulated instantly instead of the test
// suite actually sleeping 30s. Both `new Date()` and `Date.now()` inside the extracted worker.js
// function bodies resolve `Date` as a free variable against the global object at call time, so
// swapping globalThis.Date before build() runs affects them too.
const RealDate = Date;
let __offset = 0;
class FakeDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + __offset); else super(...args); }
  static now() { return RealDate.now() + __offset; }
}
globalThis.Date = FakeDate;
function advanceClock(ms) { __offset += ms; }

const cacheSrc       = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const srSrc           = grab(wsrc, 'async function sheetsRequest(');
const jsonSrc         = grab(wsrc, 'function json(data');
const fetchTabSrc     = grab(wsrc, 'async function fetchTab(');
const fetchTabsSrc    = grab(wsrc, 'async function fetchTabs(');
const findRecentDupSrc = grab(wsrc, 'async function findRecentDuplicate(');
const claimCacheSrc   = grabRange(wsrc, 'const __woClaimCache = new Map();', 'async function createWorkOrder(');
const createWOSrc     = grab(wsrc, 'async function createWorkOrder(');

const WO_HEADERS = ['ID','Property_ID','Unit_ID','Tenant_ID','Vendor_ID','Type','Trade','Description',
  'Priority','Status','Scheduled_Date','Scheduled_Window','Completed_Date','Invoice_ID','Owner_WO_Ref',
  'WO_Contact_Name','WO_Contact_Phone','Tenant_Visible','Tenant_Notify_Created','Tenant_Notify_Updates',
  'Vendor_SMS_Sent','Tenant_SMS_Sent','Owner_Notified','Created_By','Created_Date','Notes','Room',
  'Vendor_Needs_Access','Checklist'];

function makeDb() {
  return {
    Work_Orders: { headers: WO_HEADERS.slice(), rows: [] },
    Tenants: { headers: ['ID','Unit_ID','Property_ID','First_Name','Last_Name','Active'], rows: [] },
  };
}

// `delayMs` simulates real Sheets-API round-trip latency on EVERY request (GET or POST) — this
// is what turns a "30s apart" pair of tenant submissions into something that can slip past the
// window once every awaited step ahead of the check (or the check's own fetch) eats real time.
function makeFetch(db, delayMs, callLog) {
  return async (url, opts) => {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, '');
    const path = full.split('?')[0];
    const method = opts.method;
    callLog.push(method + ' ' + path);

    let m = /^\/values\/([^!:?]+)$/.exec(path);
    if (method === 'GET' && m) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    let m2 = /^\/values\/([^!:?]+):append/.exec(path);
    if (method === 'POST' && m2) {
      const body = JSON.parse(opts.body);
      db[m2[1]].rows.push(...body.values);
      return { json: async () => ({}) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') return { json: async () => ({}) };
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}

function build(db, delayMs, callLog) {
  const src = [
    'const CORS = {};',
    cacheSrc, srSrc, jsonSrc, fetchTabSrc, fetchTabsSrc, findRecentDupSrc, claimCacheSrc,
    'async function ensureColumns(){}',
    'async function addRow(){ return { success:true, id:"X" }; }', // WO_Tenants linking side-effect — not under test
    'async function fetchTabs2(){}', // no-op placeholder, real fetchTabs already grabbed above
    createWOSrc,
    'return { createWorkOrder, claimWOSignature, __woClaimCache };',
  ].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout',
    src
  )(async () => 'tok', makeFetch(db, delayMs, callLog), setTimeout);
}

const woSig = () => ({
  property_id: 'P-115W29', unit_id: 'U-APT3', tenant_id: 'T-LSERAFICA',
  trade: 'General', description: "Left towel holder in Lance's bathroom needs to be screwed in", type: 'manual',
});

console.log('WO create — duplicate-submission race (WO-1213/WO-1214 root cause)\n');

// ── 1. The actual incident, reproduced: two requests ~30s apart with realistic Sheets latency ──
// Sequential (not concurrent) — this models a tenant who tapped Submit, saw nothing happen for
// half a minute, and tapped it again. Each request incurs the SAME injected round-trip latency
// rule 162's guard has to absorb on the real tenant `/workorder` path.
{
  const db = makeDb(); const callLog = [];
  const { createWorkOrder } = build(db, 250, callLog); // 250ms per Sheets round trip
  const first = await (await createWorkOrder({ SHEET_ID: 'S' }, woSig())).json();
  advanceClock(30000); // the 2nd tap lands ~30s after the 1st, per the real incident — simulated, not actually slept
  const second = await (await createWorkOrder({ SHEET_ID: 'S' }, woSig())).json();
  t('first submission creates a real WO', first.success === true && !first.duplicate);
  t('second submission 30s later is recognized as the SAME complaint, not a new WO',
    second.success === true && second.duplicate === true && second.id === first.id);
  t('only ONE row exists in Work_Orders — this is the exact WO-1213/WO-1214 scenario, now fixed',
    db.Work_Orders.rows.length === 1);
}

// ── 2. A genuinely different urgent issue close in time must NOT be blocked ────────────────
{
  const db = makeDb(); const callLog = [];
  const { createWorkOrder } = build(db, 100, callLog);
  const first = await (await createWorkOrder({ SHEET_ID: 'S' }, woSig())).json();
  const differentIssue = { ...woSig(), trade: 'Plumbing', description: 'Kitchen sink is leaking under the cabinet, urgent' };
  const second = await (await createWorkOrder({ SHEET_ID: 'S' }, differentIssue)).json();
  t('a different real issue from the same tenant seconds later creates its own WO',
    second.success === true && !second.duplicate && second.id !== first.id);
  t('both rows exist — nothing was wrongly deduped', db.Work_Orders.rows.length === 2);
}

// ── 3. True TOCTOU race — two requests fired concurrently (no gap at all) ──────────────────
// Before the synchronous claim, both requests' findRecentDuplicate reads would both run before
// either's append landed, and both would proceed to create a WO. The claim intercepts this
// within the isolate before any network call happens at all.
{
  const db = makeDb(); const callLog = [];
  const { createWorkOrder } = build(db, 150, callLog);
  const [r1, r2] = await Promise.all([
    createWorkOrder({ SHEET_ID: 'S' }, woSig()),
    createWorkOrder({ SHEET_ID: 'S' }, woSig()),
  ]);
  const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
  t('exactly one of the two truly-concurrent requests created the WO, the other deduped',
    (b1.duplicate === true) !== (b2.duplicate === true)); // exactly one is a dupe response
  t('only ONE row was appended to Work_Orders despite firing at the exact same instant',
    db.Work_Orders.rows.length === 1);
  const winnerId = b1.duplicate ? b2.id : b1.id;
  const loserId = b1.duplicate ? b1.id : b2.id;
  t('the "duplicate" response points at the WO that actually got created', winnerId === loserId);
}

// ── 4. claimWOSignature itself — synchronous check-and-set semantics ───────────────────────
{
  const db = makeDb(); const callLog = [];
  const { claimWOSignature, __woClaimCache } = build(db, 0, callLog);
  const sig = { Property_ID: 'P-1', Unit_ID: 'U-1', Tenant_ID: 'T-1', Trade: 'General', Description: 'x', Type: 'manual' };
  t('first claim on a fresh signature succeeds', claimWOSignature(sig) === true);
  t('an immediate second claim on the SAME signature fails (still live)', claimWOSignature(sig) === false);
  t('a claim on a DIFFERENT signature succeeds independently',
    claimWOSignature({ ...sig, Description: 'y' }) === true);
  __woClaimCache.clear(); // simulate TTL expiry
  t('after the claim expires, the same signature can be claimed again', claimWOSignature(sig) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
