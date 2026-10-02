// Fewer Sheets reads without changing behavior (Oct 2 2026): ensureColumns memo,
// /notifications/pending throttle, and vendorWorkorders' single batched read.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

// ensureColumns memo: real wrapper with a fake inner
{
  const memoSrc = wsrc.slice(wsrc.indexOf('const COLS_OK_MS'), wsrc.indexOf('async function ensureColumns('));
  const wrapper = grab(wsrc, 'async function ensureColumns(');
  let inner = 0, innerFail = false, now = 1e6;
  const mod = new Function('ensureColumnsInner', 'logTelemetry', 'TELEMETRY_TAB', 'Date',
    memoSrc + '\n' + wrapper + '\nreturn ensureColumns;'
  )(async () => { inner++; if (innerFail) throw new Error('boom'); }, async () => {}, 'Ops_Telemetry', { now: () => now });
  await mod({}, 'Work_Orders', ['A', 'B']);
  await mod({}, 'Work_Orders', ['A', 'B']);
  t('2nd identical call skips the tab read', inner === 1);
  await mod({}, 'Work_Orders', ['A', 'B', 'C']);
  t('different column set is verified separately', inner === 2);
  await mod({}, 'Vendors', ['A', 'B']);
  t('different tab is verified separately', inner === 3);
  now += 11 * 60 * 1000;
  await mod({}, 'Work_Orders', ['A', 'B']);
  t('re-verified after 10 minutes', inner === 4);
  innerFail = true; now += 11 * 60 * 1000;
  let threw = false; try { await mod({}, 'Work_Orders', ['A', 'B']); } catch { threw = true; }
  t('a failure still throws', threw && inner === 5);
  innerFail = false;
  await mod({}, 'Work_Orders', ['A', 'B']);
  t('a failure is never memoized', inner === 6);
}
// vendorWorkorders batched path: config + holders come from the single fetchTabs call
{
  const vw = grab(wsrc, 'async function vendorWorkorders(');
  const cfgSrc = grab(wsrc, 'function configFromValues(');
  const seen = [];
  const fetchTabs = async (env, tabs) => { seen.push(tabs.slice()); return tabs.map(tn => tn === 'Work_Orders' ? [{ ID: 'WO-1', Vendor_ID: 'V1', Status: 'Open', Priority: 'normal' }] : tn === 'Master_Key_Holders' ? [{ H: 1 }] : []); };
  const __tabCache = new Map([['Config', { data: { values: [['Access_Trade_Defaults', '{"x":1}'], ['Other', 'y']] } }]]);
  let sawCfg = null, sawHolders = null;
  const enrichWO = (wo, p, u, tn, k, opts, mk, holders) => { sawCfg = opts.tradeAccessDefaults; sawHolders = holders; return { ID: wo.ID, Priority: wo.Priority }; };
  const json = (x) => x;
  const fn = new Function('fetchTabs', 'fetchConfig', 'fetchMasterKeyHolders', '__tabCache', 'isMissingTabError', 'enrichWO', 'json', 'PRIORITY_ORDER', 'OPEN_WO_STATUSES', 'CLOSED_WO_STATUSES',
    cfgSrc + '\n' + vw + '\nreturn vendorWorkorders;')(fetchTabs, async () => { throw new Error('fetchConfig must not be called'); }, async () => { throw new Error('holders must not be called'); }, __tabCache, () => false, enrichWO, json, {}, ['Open'], ['Complete']);
  let out; let err = null;
  try { out = await fn({}, new URL('https://x/vendor-workorders?vendor_id=V1&include_closed=true')); } catch (e) { err = e; }
  t('vendorWorkorders batched path runs without extra reads (' + (err && err.message) + ')', !err);
  t('exactly one fetchTabs call, includes Master_Key_Holders + Config', seen.length === 1 && seen[0].includes('Master_Key_Holders') && seen[0].includes('Config'));
  t('config parsed from the batch', sawCfg && sawCfg.x === 1);
  t('holders passed through', Array.isArray(sawHolders) && sawHolders.length === 1);
}
// wiring
{
  const vw = grab(wsrc, 'async function vendorWorkorders(');
  t('vendorWorkorders reads Master_Key_Holders + Config in the one batch', /'Master_Key_Holders','Config'\], \{ stale: true \}/.test(vw));
  t('vendorWorkorders falls back on a missing tab', /isMissingTabError\(e\)/.test(vw) && /fetchMasterKeyHolders\(env, \{ stale: true \}\)/.test(vw));
  t('notifications/pending throttled to once a minute', /__pendingNotifAt < 60 \* 1000/.test(wsrc));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
