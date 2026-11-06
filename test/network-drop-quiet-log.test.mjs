// Nov 6 2026 (Brett): plain phone network drops ("Failed to fetch" when signal is weak / Chrome wakes) must not fill the Error log.
// Pins: network-type failures are counted not logged when the per-tab fallback recovers; real errors still log; a total outage logs ONE entry.
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 300) : ''); } };
const fn = (name) => { const m = new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n').exec(html); return m ? m[0] : ''; };
const ctx = { logged: [], store: {}, localStorage: { getItem: k => ctx.store[k] ?? null, setItem: (k, v) => { ctx.store[k] = v; } } };
ctx.logError = (c, m) => ctx.logged.push([c, m]);
vm.createContext(ctx);
vm.runInContext(fn('_isNetworkDrop') + fn('_countNetworkDrop'), ctx);
for (const m of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'Request timed out after 20s — check network or retry'])
  t('network drop: ' + m, ctx._isNetworkDrop(m) === true);
for (const m of ['HTTP 500', 'bad /hub-bootstrap response', 'Unauthorized', '', undefined])
  t('NOT a drop: ' + m, ctx._isNetworkDrop(m) === false);
ctx._countNetworkDrop(); ctx._countNetworkDrop();
t('drops are counted, not hidden', JSON.parse(ctx.store.mh_net_drops).count === 2, ctx.store);
t('loadAll skips logError for network drops', /if \(!_isNetworkDrop\(msg\)\) logError\('hub-bootstrap', msg\);/.test(html));
t('fallback skips per-tab logError for drops', /if \(!_isNetworkDrop\(rmsg\)\) logError\('Load '\+_names8\[i\], rmsg\);/.test(html));
t('total outage still logs once', /No connection: all data loads failed/.test(html));
console.log(fail ? 'FAILED' : 'ok', pass, 'pass', fail, 'fail'); process.exit(fail ? 1 : 0);
