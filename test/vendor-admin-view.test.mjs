// Nov 24 2026 — admin "Open as vendor" (POST /admin/vendor-view-session + vendor.html #av= handoff).
// Brett: open any vendor's portal as them, no PIN, to show them where things go. Locks in:
//   - only the real admin secret can mint it (portal sessions and other tokens are refused)
//   - the minted token is a plain vendor-role session (so the SAME allow-list + money stripping apply) with av:1 and a 4-hour life
//   - av sessions never stamp the vendor's first-login / portal-use evidence
//   - the path is not public and not reachable by any portal role
//   - vendor.html keeps the admin session in this tab only and never writes it to the vendor's real saved login key
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const vhtml = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
const ihtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m); };

const minted = [];
const VENDORS = [
  { ID: '4', First_Name: 'OSCAR', Name: 'Oscar Padilla', Active: 'TRUE', Language: 'es', PIN: '9999', Hourly_Rate: '50' },
  { ID: '9', First_Name: 'Old', Name: 'Old Vendor', Active: 'FALSE' },
];
const factory = new Function('fetchTab', 'makeSessionToken', 'json', 'safeJson',
  'const ADMIN_VIEW_TTL_S = 4 * 60 * 60;\n' + grab('function vendorSessionFields(') + '\n' + grab('async function adminVendorViewSession(') +
  '\nreturn { adminVendorViewSession, vendorSessionFields };');
const json = (o, s) => ({ status: s || 200, body: o });
const { adminVendorViewSession } = factory(
  async () => VENDORS,
  async (payload, secret, ttl) => { minted.push({ payload, ttl }); return 'tok.' + payload.id; },
  json,
  async r => { try { return { ok: true, body: await r.json() }; } catch (e) { return { ok: false, body: {} }; } });
const env = { WORKER_SECRET: 'admin-secret' };
const req = (tok, body) => ({ headers: { get: k => (k === 'X-Auth-Token' ? tok : null) }, json: async () => body });

{
  const r = await adminVendorViewSession(env, req('admin-secret', { vendor_id: '4' }), null, false, false);
  ok(r.status === 200 && r.body.token === 'tok.4', 'admin secret mints a session for vendor 4');
  ok(r.body.admin_view === true && r.body.vendor_name === 'Oscar Padilla' && r.body.language === 'es', 'carries the vendor fields the portal needs (name, language)');
  ok(!('PIN' in r.body) && !JSON.stringify(r.body).includes('9999'), 'the PIN is never returned');
  const m = minted[minted.length - 1];
  ok(m.payload.role === 'vendor' && m.payload.id === '4' && m.payload.av === 1, 'token is an ordinary vendor-role session marked av:1');
  ok(m.ttl === 4 * 60 * 60, 'token lives 4 hours, not 90 days');
}
{
  const r = await adminVendorViewSession(env, req('tok.4', { vendor_id: '4' }), 'vendor', false, false);
  ok(r.status === 401, 'a vendor session cannot mint one');
  const r2 = await adminVendorViewSession(env, req('some-other-token', { vendor_id: '4' }), null, false, false);
  ok(r2.status === 403, 'a narrow service token (not the admin secret) cannot mint one');
  const r3 = await adminVendorViewSession(env, req('hub-test', { vendor_id: '4' }), null, true, false);
  ok(r3.status === 403, 'the staging test token is refused on production');
  const r4 = await adminVendorViewSession(env, req('hub-test', { vendor_id: '4' }), null, true, true);
  ok(r4.status === 200, 'the staging test token works on staging (so this can be smoke-tested without the admin secret)');
  const r5 = await adminVendorViewSession({ WORKER_SECRET: '' }, req('', { vendor_id: '4' }), null, false, false);
  ok(r5.status === 403, 'blank secret never matches a blank header');
}
{
  ok((await adminVendorViewSession(env, req('admin-secret', { vendor_id: '9' }), null, false, false)).status === 409, 'deactivated vendor is refused with a reason');
  ok((await adminVendorViewSession(env, req('admin-secret', { vendor_id: '77' }), null, false, false)).status === 404, 'unknown vendor is a 404');
  ok((await adminVendorViewSession(env, req('admin-secret', {}), null, false, false)).status === 400, 'missing vendor_id is a 400');
}
{
  const pub = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf('];', src.indexOf('const PUBLIC_PATHS = [')));
  ok(!pub.includes('/admin/vendor-view-session'), 'not a public path');
  const roles = src.slice(src.indexOf("  vendor: ['/vendor-by-pin'"), src.indexOf('\n', src.indexOf("  vendor: ['/vendor-by-pin'")));
  ok(roles.length > 0 && !roles.includes('/admin/vendor-view-session'), 'not on the vendor role allow-list');
  ok(/callerAdminView = _session\.av === 1;/.test(src), 'gate reads av from the verified session');
  ok(/if \(!callerAdminView\) \{ const _act = stampPortalActivity\(/.test(src), 'av sessions never stamp portal-use evidence');
  ok(/\.\.\.vendorSessionFields\(vendor\), token: await makeSessionToken\(\{ role: 'vendor', id: vendor\.ID \}/.test(src), 'normal PIN login still mints the same fields with no av flag');
}
{
  ok(/if \(ADMIN_VIEW\) SESS_KEY = 'mh_vendor_admin_view_shadow';/.test(vhtml), 'vendor.html never writes an admin view into the real mh_vendor_sess key');
  ok(/sessionStorage\.setItem\(AV_KEY/.test(vhtml) && !/localStorage\.setItem\(AV_KEY/.test(vhtml), 'admin view session is tab-only (sessionStorage)');
  ok(/history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(vhtml), 'the #av= hash is wiped from the address bar');
  ok(/ADMIN VIEW: you are seeing/.test(vhtml), 'a clear ADMIN VIEW bar says whose portal it is');
  ok(/function openVendorPortalAs\(vendorId, woId\)/.test(ihtml) && /openVendorPortalAs\(\\''\+v\.ID\+'\\'\)/.test(ihtml), 'Hub Vendors list has the Open as button');
  ok(/openVendorPortalAs\(wo\.Vendor_ID, woId\)/.test(ihtml), 'Hub work order has See as vendor for the assigned vendor');
}
console.log(`vendor-admin-view: ${n}/${n} passing`);
