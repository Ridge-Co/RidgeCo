// Cross-request promise error on shared BATCH reads (Nov 17 2026). Offline tests that load the REAL fetchTabs and
// __isCrossRequestPromiseError source out of worker.js and drive them with a fake Sheets read.
// Needs Attention rows: F-1794619593801-52rc, F-1794588790624-r8hm, F-1794581637195-ljf6 (cross-request promise, reopened after PR #549)
// and F-1794868510255-gvl8 (/hub-bootstrap 500, which reads through fetchTabs).
// Bug being locked out: a request that JOINS another request's in-flight batchGet got "This promise was created by a request that
// has since ended" thrown at it when the leader's request had ended. PR #549 retried this only for single-tab reads.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n); } };

const fetchTabsSrc = grab(wsrc, 'async function fetchTabs(');
const crossSrc = grab(wsrc, 'function __isCrossRequestPromiseError(');
['sheetsRequest', '__batchInflight', '__tabCache', '__cacheFresh', '__isCrossRequestPromiseError'].forEach(n => {
  if (!fetchTabsSrc.includes(n)) throw new Error('fetchTabs no longer references ' + n + ' — update this test');
});

const CROSS = 'This promise was created by a request that has since ended, so it can never settle here';

function build(st) {
  const src = [
    'const TAB_CACHE_MS = 6000;',
    'const __tabCache = new Map();',
    'const __batchInflight = new Map();',
    'function __cacheFresh(env, hit) { return !!hit && hit.exp > Date.now(); }',
    'function __staleTab() { return null; }',
    'function __meterSaved() {}',
    'async function sheetsRequest(env, method, path) {',
    '  st.reads++;',
    '  if (st.readFails) throw new Error(st.readFails);',
    '  return { valueRanges: [{ values: [["ID","Name"],["1","a"]] }, { values: [["ID"],["9"]] }] };',
    '}',
    crossSrc, fetchTabsSrc,
    'return { fetchTabs, __batchInflight, __tabCache };',
  ].join('\n');
  return new Function('st', src)(st);
}
const mkSt = (o) => Object.assign({ reads: 0, readFails: '' }, o || {});
async function err(p) { try { await p; return null; } catch (e) { return String(e.message); } }

console.log('fetchTabs cross-request promise — offline tests\n');

// 1. THE BUG: a leader from a request that has ended left a rejected shared promise. The joiner must read for itself.
{
  const st = mkSt();
  const m = build(st);
  const dead = Promise.reject(new Error(CROSS)); dead.catch(() => {});
  m.__batchInflight.set('Properties|Units', dead);
  const out = await m.fetchTabs({}, ['Properties', 'Units']);
  t('joiner of an ended leader: still returns rows', Array.isArray(out) && out.length === 2 && out[0].length === 1 && out[0][0].Name === 'a');
  t('joiner of an ended leader: second tab parsed', out[1][0].ID === '9');
  t('joiner of an ended leader: did exactly one read of its own', st.reads === 1);
}

// 2. The error check itself: both Cloudflare wordings count, ordinary errors do not.
{
  const { __isCrossRequestPromiseError: f } = new Function(crossSrc + '\nreturn { __isCrossRequestPromiseError };')();
  t('check: ended-request wording', f(new Error(CROSS)));
  t('check: can-never-settle wording', f(new Error('a promise can never settle')));
  t('check: quota error is NOT treated as cross-request', !f(new Error('Sheets API error: Quota exceeded')));
  t('check: undefined is safe', !f(undefined));
}

// 3. A real read failure by a joiner must still throw (so the caller's 500 is reported to the failure ledger, never swallowed).
{
  const st = mkSt({ readFails: 'Sheets API error on GET /values:batchGet: Quota exceeded' });
  const m = build(st);
  const dead = Promise.reject(new Error(CROSS)); dead.catch(() => {});
  m.__batchInflight.set('Properties|Units', dead);
  const e = await err(m.fetchTabs({}, ['Properties', 'Units']));
  t('joiner whose own retry fails: throws the real error', !!e && /Quota exceeded/.test(e));
  const st2 = mkSt();
  const m2 = build(st2);
  const other = Promise.reject(new Error('Sheets API error: Quota exceeded')); other.catch(() => {});
  m2.__batchInflight.set('Properties|Units', other);
  const e2 = await err(m2.fetchTabs({}, ['Properties', 'Units']));
  t('joiner of a leader that failed for a real reason: throws, no hidden retry', !!e2 && /Quota exceeded/.test(e2) && st2.reads === 0);
}

// 4. Normal path unchanged: no shared leader -> one read, rows returned, and a second call is served from cache.
{
  const st = mkSt();
  const m = build(st);
  const a = await m.fetchTabs({}, ['Properties', 'Units']);
  const b = await m.fetchTabs({}, ['Properties', 'Units']);
  t('normal: rows returned', a[0][0].Name === 'a' && b[0][0].Name === 'a');
  t('normal: one read, second call from cache', st.reads === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
