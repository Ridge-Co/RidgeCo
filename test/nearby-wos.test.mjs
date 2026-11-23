// Queue #166: /nearby-wos same-building jobs, distance fallback, no_location, vendor filter; plus the Schedule/Assign strip in index.html.
// Drives the REAL worker.js over a fake Google Sheets (same harness as session-identity.test.mjs). Run: node test/nearby-wos.test.mjs
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

function makeStore() {
  const tabs = new Map();           // name -> array of row arrays
  const calls = [];
  const st = { tabs, calls };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {   // path relative to /spreadsheets/{id}
    calls.push(method + ' ' + path);
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
  tabs.set('Config', [['Key', 'Value']]);
  return st;
}

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
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

const WOH = ['ID', 'Property_ID', 'Vendor_ID', 'Tenant_ID', 'Status', 'Voided', 'Trade', 'Description', 'Scheduled_Date', 'Scheduled_Window', 'Priority'];
const wo = (ID, Property_ID, o = {}) => Object.assign({ ID, Property_ID, Vendor_ID: 'V1', Status: 'Assigned', Trade: 'Plumbing', Description: 'job ' + ID }, o);
const PH = ['ID', 'Address', 'City', 'Location_Cluster', 'Location_Overlap', 'Lat', 'Lng', 'Active'];
const setup = (props, wos, cfg = []) => {
  tab('Properties', PH, props); tab('Work_Orders', WOH, wos);
  tab('Tenants', ['ID', 'Property_ID', 'Active', 'First_Name', 'Last_Name', 'Phone'], []);
  tab('Vendors', ['ID', 'Name', 'Phone', 'Active'], [{ ID: 'V1', Name: 'Vee One', Active: 'TRUE' }, { ID: 'V2', Name: 'Vee Two', Active: 'TRUE' }]);
  tab('Config', ['Key', 'Value'], cfg.map(([Key, Value]) => ({ Key, Value })));
};
const nearby = async (woId, token = SECRET, vendor = '') => (await call('GET', '/nearby-wos?wo_id=' + woId + (vendor ? '&vendor_id=' + vendor : ''), token));
const idsOf = (r) => ((r.json && r.json.nearby) || []).map(n => n.id);

// 1. same building: two open jobs at one property list each other, marked, first
setup([{ ID: 'P1', Address: '1 Main', Location_Cluster: 'North', Lat: '39.30', Lng: '-76.60' }, { ID: 'P2', Address: '2 Oak', Location_Cluster: 'North', Lat: '39.31', Lng: '-76.61' }],
  [wo('A', 'P1'), wo('B', 'P1', { Scheduled_Date: '2026-12-01', Scheduled_Window: '9-12' }), wo('C', 'P2')]);
{
  const a = await nearby('A'), b = await nearby('B');
  t('same building: A lists B first, then the tag match C', a.status === 200 && idsOf(a).join() === 'B,C', a.json);
  t('same building: B lists A', idsOf(b).includes('A'));
  const row = a.json.nearby[0];
  t('row is marked same_property and carries vendor name and date', row.same_property === true && row.vendor_name === 'Vee One' && row.scheduled_date === '2026-12-01' && row.scheduled_window === '9-12', row);
  t('tag-matched row is not same_property', a.json.nearby[1].same_property === false);
}
// 2. closed, voided and cancelled jobs are excluded
setup([{ ID: 'P1', Address: '1 Main', Location_Cluster: 'North' }, { ID: 'P2', Address: '2 Oak', Location_Cluster: 'North' }],
  [wo('A', 'P1'), wo('B', 'P1', { Status: 'Complete' }), wo('C', 'P1', { Voided: 'TRUE' }), wo('D', 'P2', { Status: 'Cancelled' }), wo('E', 'P2')]);
{ const a = await nearby('A'); t('closed, voided and cancelled jobs are left out', idsOf(a).join() === 'E', a.json); }
// 3. distance fallback: no tag, coordinates, radius setting, nearest first
const geo = [{ ID: 'P1', Address: '1 Main', Lat: '39.3000', Lng: '-76.6000' }, { ID: 'P2', Address: '2 Oak', Lat: '39.3100', Lng: '-76.6000' }, { ID: 'P3', Address: '3 Elm', Lat: '39.3180', Lng: '-76.6000' }, { ID: 'P4', Address: '4 Far', Lat: '39.5000', Lng: '-76.6000' }, { ID: 'P5', Address: '5 NoGeo' }];
setup(geo, [wo('A', 'P1'), wo('B', 'P3'), wo('C', 'P2'), wo('D', 'P4'), wo('E', 'P5')]);
{
  const a = await nearby('A');
  t('distance fallback: within 2.5 km only, nearest first', idsOf(a).join() === 'C,B', a.json);
  t('distance_km is returned and ascending', a.json.nearby[0].distance_km > 1 && a.json.nearby[0].distance_km < a.json.nearby[1].distance_km, a.json.nearby.map(n => n.distance_km));
  t('radius is reported', a.json.radius_km === 2.5);
}
setup(geo, [wo('A', 'P1'), wo('B', 'P3'), wo('C', 'P2'), wo('D', 'P4')], [['nearby_radius_km', '30']]);
{ const a = await nearby('A'); t('nearby_radius_km setting widens the radius', idsOf(a).join() === 'C,B,D', a.json); }
setup(geo, [wo('A', 'P1'), wo('B', 'P3'), wo('C', 'P2')], [['nearby_radius_km', 'junk']]);
{ const a = await nearby('A'); t('a bad radius setting falls back to 2.5', idsOf(a).join() === 'C,B', a.json); }
// 4. no tag and no coordinates -> no_location (same-building jobs still listed)
setup(geo, [wo('E', 'P5'), wo('F', 'P5'), wo('A', 'P1')]);
{
  const e = await nearby('E');
  t('no tag and no coordinates: message no_location', e.json.message === 'no_location', e.json);
  t('no_location still lists the same-building job and nothing from other properties', idsOf(e).join() === 'F', e.json);
  const lone = (setup(geo, [wo('E', 'P5')]), await nearby('E'));
  t('no_location with nothing else: empty list plus message', lone.json.nearby.length === 0 && lone.json.message === 'no_location', lone.json);
}
// 5. nothing nearby is a message, not an error
setup([{ ID: 'P1', Address: '1 Main', Location_Cluster: 'North' }, { ID: 'P2', Address: '2 Oak', Location_Cluster: 'South' }], [wo('A', 'P1'), wo('B', 'P2')]);
{ const a = await nearby('A'); t('tagged, nothing nearby: empty + no_nearby', a.status === 200 && a.json.nearby.length === 0 && a.json.message === 'no_nearby', a.json); }
// 6. vendor filter holds, for same-building rows too, and a vendor session cannot widen it
setup([{ ID: 'P1', Address: '1 Main', Location_Cluster: 'North' }, { ID: 'P2', Address: '2 Oak', Location_Cluster: 'North' }],
  [wo('A', 'P1'), wo('B', 'P1', { Vendor_ID: 'V2' }), wo('C', 'P2', { Vendor_ID: 'V2' }), wo('D', 'P2')]);
{
  const v1 = await nearby('A', mint('vendor', 'V1'));
  t('vendor session sees only its own jobs (never V2\'s same-building or nearby job)', v1.status === 200 && idsOf(v1).join() === 'D', v1.json);
  const widen = await nearby('A', mint('vendor', 'V1'), 'V2');
  t('vendor session cannot ask for another vendor', widen.status === 403 || idsOf(widen).every(i => i === 'D'), widen.json);
  const adm = await nearby('A', SECRET, 'V2');
  t('admin vendor_id filter still works', idsOf(adm).join() === 'B,C', adm.json);
}
// 7. one request reads a handful of sheet calls, not one per job
setup([{ ID: 'P1', Address: '1 Main', Location_Cluster: 'North' }], [wo('A', 'P1'), wo('B', 'P1')]);
{ store.calls.length = 0; await nearby('A'); t('one request reads a handful of sheet calls, not one per job', store.calls.length <= 6, store.calls); }
// 8. clusterSuggestions still works after the distance helper moved to module level
setup([{ ID: 'P1', Address: '1 Main', Location_Cluster: 'North', Lat: '39.30', Lng: '-76.60' }, { ID: 'P2', Address: '2 Oak', Location_Cluster: 'North', Lat: '39.305', Lng: '-76.60' }], []);
{ const c = await call('GET', '/cluster-suggestions?lat=39.30&lng=-76.60', SECRET); t('cluster-suggestions unchanged: nearest tagged property, primary North', c.status === 200 && c.json.suggestions.primary === 'North' && c.json.nearby.length === 2 && c.json.nearby[0].dist_km < 0.01, c.json); }

// ── Hub page: Schedule and Assign windows render the strip, the empty state and the error state ──
{
  const html = fs.readFileSync(root + 'index.html', 'utf8');
  t('Assign window has the strip holder', /id="assign-nearby"/.test(html));
  t('Schedule window has the strip holder', /id="modalSchedAdmin-nearby"/.test(html));
  t('both windows load it once on open', /openModal\('modal-assign'\);\s*\n\s*loadNearbyStrip\('assign-nearby', 'modal-assign', woId\)/.test(html) && /openModal\(modalId\);\s*\n\s*loadNearbyStrip\(modalId\+'-nearby'/.test(html));
  const grab = (name) => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); } };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const strip = new Function('esc', grab('nearbyStripHtml') + '; return nearbyStripHtml;')(esc);
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: 'WO-' + i, address: i + ' Main <b>', trade: 'HVAC', vendor_name: i ? 'Vee' : '', scheduled_date: '', same_property: i === 0, distance_km: i ? 1.2 : null }));
  const full = strip({ nearby: rows }, 'h', 'modal-assign');
  t('strip: count line, 5 rows then "+2 more"', /7 other open jobs nearby/.test(full) && (full.match(/data-woid=/g) || []).length === 5 && /\+2 more/.test(full), full.slice(0, 200));
  t('strip: same building is labelled, addresses are escaped', /Same building/.test(full) && !/<b>\s*<\/span>/.test(full) && /&lt;b&gt;/.test(full));
  t('strip: unscheduled / no vendor wording', /Not scheduled/.test(full) && /No vendor yet/.test(full));
  t('strip: one job reads "1 other open job nearby"', /1 other open job nearby/.test(strip({ nearby: [rows[1]] }, 'h', 'm')));
  t('strip: empty result renders nothing (strip hides)', strip({ nearby: [], message: 'no_nearby' }, 'h', 'm') === '');
  const nl = strip({ nearby: [], message: 'no_location' }, 'h', 'm');
  t('strip: no location shows the grey line with a link to the cluster tool', /No location set for this property/.test(nl) && /cluster-tool\.html/.test(nl));
  const load = grab('loadNearbyStrip');
  t('error state: failed lookup shows "Could not check nearby jobs" with Retry and is logged, never swallowed', /Could not check nearby jobs\./.test(load) && />Retry</.test(load) && /logError\('Nearby jobs'/.test(load) && !/catch\(function\(\)\s*\{\s*\}\)/.test(load));
  t('loading state text is present', /Checking nearby jobs/.test(load));
  t('only one /nearby-wos call per opening', (load.match(/\/nearby-wos/g) || []).length === 1);
}

console.log(`nearby-wos: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
