// fetchTabs cross-request fallback (Nov 17 2026). Loads the REAL fetchTabs source from worker.js and drives it with a fake sheetsRequest.
// Bug locked out: a joiner of a shared batchGet got "promise created by a request that has since ended" and the page 500ed
// (/hub-bootstrap, /vendor-workorders on Nov 16). Expected: the joiner redoes its own read; other errors still throw.
import fs from 'fs';
const w = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const s = src.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig);
  const o = src.indexOf('{', s); let d = 0, i = o;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } }
  return src.slice(s, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const fsrc = grab(w, 'async function fetchTabs(');
if (!fsrc.includes('__readOwn')) throw new Error('fetchTabs lost its own-read fallback');
function build(st) {
  const src = [
    'const __tabCache = new Map(); const __batchInflight = new Map();',
    'const TAB_CACHE_MS = 6000;',
    'function __cacheFresh(env, h) { return !!h && h.exp > Date.now(); }',
    'function __meterSaved() {} function __staleTab() { return null; }',
    'async function sheetsRequest(env, m, p) { st.calls++; const e = st.script.shift(); if (e) throw new Error(e);',
    '  return { valueRanges: [{ values: [["A"],["1"]] }] }; }',
    fsrc, 'return { fetchTabs };'].join('\n');
  return new Function('st', src)(st);
}
{ // leader's request ended: shared read fails with the cross-request error, caller redoes its own read
  const st = { calls: 0, script: ['This promise was created by a request that has since ended, so it can never settle.'] };
  const { fetchTabs } = build(st);
  const r = await fetchTabs({}, ['Tab1']);
  t('cross-request error: returns rows instead of throwing', r[0].length === 1 && r[0][0].A === '1');
  t('cross-request error: exactly one retry read', st.calls === 2);
}
{ // other errors still fail loudly
  const st = { calls: 0, script: ['Read requests per minute exceeded'] };
  const { fetchTabs } = build(st);
  let e = null; try { await fetchTabs({}, ['Tab1']); } catch (x) { e = x.message; }
  t('other error: still thrown', e === 'Read requests per minute exceeded');
  t('other error: not retried', st.calls === 1);
}
{ // a failure on the own read is not swallowed
  const st = { calls: 0, script: ['promise was created by a request that has since ended', 'Sheets down'] };
  const { fetchTabs } = build(st);
  let e = null; try { await fetchTabs({}, ['Tab1']); } catch (x) { e = x.message; }
  t('own read failing too: error surfaces', e === 'Sheets down');
}
console.log(`fetchtabs cross-request: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
