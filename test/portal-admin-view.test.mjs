// Nov 24 2026 — admin "Open as tenant" / "Open as owner" (POST /admin/tenant-view-session, /admin/owner-view-session,
// admin-view.js handoff in tenant.html / owner.html). Same guarantees as the vendor version (test/vendor-admin-view.test.mjs).
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
function grab(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m); };

const TABS = {
  Tenants: [
    { ID: 'T1', First_Name: 'Gus', Last_Name: 'Lee', Unit_ID: 'U1', Active: 'TRUE', PIN: '4321' },
    { ID: 'T2', First_Name: 'Old', Last_Name: 'Gone', Unit_ID: 'U1', Active: 'TRUE', Move_Out_Date: '2020-01-01' },
    { ID: 'T3', First_Name: 'Demo', Unit_ID: 'U1', Active: 'TRUE', Is_Demo: 'TRUE', Demo_Slot: '2' },
  ],
  Properties: [{ ID: 'P1', Address: '1305 N Calvert St', Owner_ID: 'O1' }],
  Units: [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '3F' }],
  Owners: [{ ID: 'O1', First_Name: 'Jamuna', Last_Name: 'Y', Company: '', Phone: '+1', Active: 'TRUE', PIN: '7777' }, { ID: 'O2', First_Name: 'X', Active: 'FALSE' }],
};
const minted = [];
const factory = new Function('fetchTab', 'fetchTabs', 'makeSessionToken', 'json', 'safeJson', 'resolveTenantWOAccess', 'demoTrue', 'demoTokenClaim',
  'const ADMIN_VIEW_TTL_S = 4 * 60 * 60;\n' + grab('async function tenantSessionFields(') + '\n' + grab('function ownerSessionFields(') + '\n' +
  grab('async function adminPortalViewSession(') + '\nreturn adminPortalViewSession;');
const demoTrue = v => String(v == null ? '' : v).trim().toUpperCase() === 'TRUE';
const view = factory(
  async (e, t) => TABS[t], async (e, ts) => ts.map(t => TABS[t]),
  async (p, s, ttl) => { minted.push({ p, ttl }); return 'tok.' + p.role + '.' + p.id; },
  (o, s) => ({ status: s || 200, body: o }),
  async r => { try { return { ok: true, body: await r.json() }; } catch (e) { return { ok: false, body: {} }; } },
  () => false, demoTrue, row => (row && demoTrue(row.Is_Demo)) ? { demo: String(row.Demo_Slot || '1') } : {});
const env = { WORKER_SECRET: 'admin-secret' };
const req = (tok, body) => ({ headers: { get: k => (k === 'X-Auth-Token' ? tok : null) }, json: async () => body });
const last = () => minted[minted.length - 1];

{
  const r = await view(env, req('admin-secret', { tenant_id: 'T1' }), null, false, false, 'tenant');
  ok(r.status === 200 && r.body.tenant_name === 'Gus Lee' && r.body.property_address === '1305 N Calvert St' && r.body.unit_label === '3F', 'tenant view carries the same fields as the tenant login');
  ok(r.body.admin_view && r.body.admin_view_role === 'tenant' && !JSON.stringify(r.body).includes('4321'), 'marked admin view, never returns the PIN');
  ok(last().p.role === 'tenant' && last().p.av === 1 && last().ttl === 14400, 'ordinary tenant-role token, av:1, 4 hours');
  ok((await view(env, req('admin-secret', { tenant_id: 'T2' }), null, false, false, 'tenant')).status === 409, 'moved-out tenant is refused with a reason');
  const d = await view(env, req('admin-secret', { tenant_id: 'T3' }), null, false, false, 'tenant');
  ok(d.body.demo === true && last().p.demo === '2', 'demo tenant keeps its demo sandbox claim (writes stay in the demo)');
}
{
  const r = await view(env, req('admin-secret', { owner_id: 'O1' }), null, false, false, 'owner');
  ok(r.status === 200 && r.body.owner_id === 'O1' && r.body.owner_name === 'Jamuna Y' && r.body.is_sub_user === false, 'owner view carries the owner login fields');
  ok(last().p.role === 'owner' && last().p.av === 1 && !JSON.stringify(r.body).includes('7777'), 'ordinary owner-role token, av:1, no PIN');
  ok((await view(env, req('admin-secret', { owner_id: 'O2' }), null, false, false, 'owner')).status === 409, 'deactivated owner refused');
}
{
  ok((await view(env, req('tok.tenant.T1', { tenant_id: 'T1' }), 'tenant', false, false, 'tenant')).status === 401, 'a portal session cannot mint one');
  ok((await view(env, req('other', { owner_id: 'O1' }), null, false, false, 'owner')).status === 403, 'any token other than the admin secret is refused');
  ok((await view(env, req('hub-test', { owner_id: 'O1' }), null, true, false, 'owner')).status === 403, 'staging test token refused on production');
  ok((await view({ WORKER_SECRET: '' }, req('', { owner_id: 'O1' }), null, false, false, 'owner')).status === 403, 'blank secret never matches');
}
{
  const pub = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf('];', src.indexOf('const PUBLIC_PATHS = [')));
  const scopes = src.slice(src.indexOf('const ROLE_SCOPES = {'), src.indexOf('};', src.indexOf('const ROLE_SCOPES = {')));
  for (const p of ['/admin/tenant-view-session', '/admin/owner-view-session']) { assert.ok(!pub.includes(p) && !scopes.includes(p), p + ' must be admin-only'); }
  ok(true, 'both paths are neither public nor in any portal role scope');
  ok(/\.\.\.\(await tenantSessionFields\(env, tenant\)\),\s*token:\s*await makeSessionToken\(\{ role: 'tenant', id: tenant\.ID, \.\.\.demoTokenClaim\(tenant\) \}/.test(src), 'tenant PIN login still mints with no av flag');
  ok(/\.\.\.ownerSessionFields\(owner\),\s*token: await makeSessionToken\(\{ role: 'owner', id: owner\.ID, \.\.\.demoTokenClaim\(owner\) \}/.test(src), 'owner PIN login still mints with no av flag');
}
{
  const av = read('admin-view.js');
  ok(/sessionStorage\.setItem\(KEY/.test(av) && !/localStorage\.setItem/.test(av), 'admin-view.js keeps the session in this tab only');
  ok(/d\.admin_view_role === role/.test(av), 'a tenant link cannot open the owner page (and the reverse)');
  ok(/history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(av), 'the #av= hash is wiped');
  for (const [f, key] of [['tenant.html', 'mh_tenant_sess'], ['owner.html', 'mh_owner_sess']]) {
    const h = read(f);
    assert.ok(h.indexOf('<script src="admin-view.js"></script>') > 0 && h.indexOf('<script src="admin-view.js"></script>') < h.indexOf("var SESS_KEY = '" + key + "'"), f + ' loads admin-view.js before its own script');
    assert.ok(h.includes('if (window.RC_ADMIN_VIEW) SESS_KEY = window.RCAdminView.shadowKey;'), f + ' never writes the admin view into ' + key);
    assert.ok(/if \(window\.RC_ADMIN_VIEW\) \{ window\.RCAdminView\.bar\(\); try \{ onLoginSuccess\(window\.RC_ADMIN_VIEW, false\);/.test(h), f + ' opens the admin view with the ADMIN VIEW bar');
    assert.ok(h.includes('window.RCAdminView.end()'), f + ' ends the admin view on sign-out / expiry');
  }
  ok(true, 'tenant.html and owner.html are wired');
  const ih = read('index.html');
  ok(/function openPortalAs\(role, id, woId\)/.test(ih) && /openPortalAs\(\\'tenant\\',\\''\+t\.ID\+'\\'\)/.test(ih) && /openPortalAs\(\\'owner\\',\\''\+o\.ID\+'\\'\)/.test(ih), 'Hub Tenants and Owners lists have Open as');
  ok(/openPortalAs\('tenant', wo\.Tenant_ID, woId\)/.test(ih) && /openPortalAs\('owner', _woProp\.Owner_ID, woId\)/.test(ih), 'Hub work order has See as tenant / See as owner');
}
{
  const aud = grab('function ownerAuditView(');
  ok(/field === 'Notes'\) \{ row\.Old_Value = externalSafeNotes\(row\.Old_Value\)/.test(aud), 'owner history: old Notes values lose billing lines too');
}
console.log(`portal-admin-view: ${n}/${n} passing`);
