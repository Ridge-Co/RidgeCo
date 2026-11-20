// Queue #131 Phase 1: one-tap "On my way" (POST /wo/en-route). Runs the REAL handler from worker.js against stubbed sheets.
// Nothing touches the network, a real sheet or Twilio.
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const vendor = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../vendor-i18n.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  const start = src.slice(i - 6, i) === 'async ' ? i - 6 : i;
  return src.slice(start, j + 1);
}
const wsrc = src.slice(src.indexOf('function __makeWOStatus'), src.indexOf('const WOStatus = __makeWOStatus();') + 'const WOStatus = __makeWOStatus();'.length);

function build(state) {
  const factory = new Function('state', `
    const json = (b, s) => ({ status: s || 200, json: async () => b });
    ${wsrc}
    const EN_ROUTE_REPEAT_MIN = 60, EN_ROUTE_COLS = ['En_Route_Sent_At'];
    ${grab('enRouteStatusOk')}
    ${grab('enRouteMinutesSince')}
    const ensureColumns = async () => { if (state.colsFail) throw new Error('sheet down'); };
    const fetchTab = async () => { state.reads++; return state.wos; };
    const fetchTabs = async () => [state.units, state.tenants, state.properties];
    const tenantsForDispatch = (t) => t;
    const isTenantNotifiable = (t) => !!t.Phone;
    const formatUnitLabel = (l) => '#' + l;
    const woJobLabel = () => 'plumbing';
    const SMS_MSG = { tenantJobScheduled: (o) => 'Hi ' + o.first + ', your technician is on the way and will arrive within 1 hour for your ' + o.label + ' at ' + o.address + '. Ref: ' + o.woId + '.' };
    const updateWOFields = async (env, id, f) => { if (state.writeFails) return; const w = state.wos.find(x => x.ID === id); Object.assign(w, f); };
    const reportFailure = async (env, f) => { state.failures.push(f); };
    const scheduleWO = async (env, b) => { state.scheduleCalls.push(b); return json(state.scheduleAnswer); };
    ${grab('woEnRoute')}
    return woEnRoute;`);
  return factory(state);
}
const mk = (over) => Object.assign({
  colsFail: false, writeFails: false, reads: 0, failures: [], scheduleCalls: [],
  scheduleAnswer: { success: true, tenant_sms: true, tenant_results: [{ first: 'Ana', sent: true, why: '' }], new_status: 'In Progress' },
  wos: [{ ID: '7', Status: 'Accepted', Unit_ID: 'u1', Property_ID: 'p1', Tenant_Notify_Updates: '', En_Route_Sent_At: '' }],
  units: [{ ID: 'u1', Unit_Label: '2B' }], properties: [{ ID: 'p1', Address: '10 Main St' }],
  tenants: [{ ID: 't1', First_Name: 'Ana', Phone: '+14105550101' }]
}, over || {});
const call = async (st, body) => { const r = await build(st)({}, body); return { status: r.status, body: await r.json() }; };

test('dry run shows the exact text and who gets it, sends and writes nothing', async () => {
  const st = mk(); const r = await call(st, { wo_id: '7', dry_run: true });
  assert.equal(r.status, 200); assert.deepEqual(r.body.recipients, ['Ana']);
  assert.match(r.body.text, /on the way and will arrive within 1 hour for your plumbing at 10 Main St #2B\. Ref: 7\./);
  assert.equal(st.scheduleCalls.length, 0); assert.equal(st.wos[0].En_Route_Sent_At, '');
});
test('send goes through scheduleWO (within 1 hour, notify, no owner text) after stamping', async () => {
  const st = mk(); const r = await call(st, { wo_id: '7', updated_by_role: 'vendor', vendor_id: '3' });
  assert.equal(r.status, 200); assert.equal(r.body.sent, true);
  assert.equal(st.scheduleCalls.length, 1);
  const c = st.scheduleCalls[0];
  assert.equal(c.window, 'Within 1 hour'); assert.equal(c.notify_tenant, true); assert.equal(c.skip_owner, true); assert.equal(c.vendor_id, '3');
  assert.ok(st.wos[0].En_Route_Sent_At, 'stamp saved before the send');
});
test('second tap inside 60 minutes sends nothing and says when', async () => {
  const st = mk(); st.wos[0].En_Route_Sent_At = new Date(Date.now() - 14 * 60000).toISOString();
  const r = await call(st, { wo_id: '7' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'en_route_repeat'); assert.match(r.body.error, /14 minutes ago/);
  assert.equal(st.scheduleCalls.length, 0);
});
test('after 60 minutes a new text is allowed', async () => {
  const st = mk(); st.wos[0].En_Route_Sent_At = new Date(Date.now() - 61 * 60000).toISOString();
  const r = await call(st, { wo_id: '7' }); assert.equal(r.status, 200); assert.equal(st.scheduleCalls.length, 1);
});
test('closed, paid, cancelled and void jobs are refused', async () => {
  for (const s of ['Complete', 'Paid', 'Cancelled', 'Void', 'Invoiced']) {
    const st = mk(); st.wos[0].Status = s; const r = await call(st, { wo_id: '7' });
    assert.equal(r.status, 409, s); assert.equal(r.body.code, 'en_route_closed'); assert.equal(st.scheduleCalls.length, 0);
  }
});
test('failed stamp write sends nothing and reports the failure', async () => {
  const st = mk({ writeFails: true }); const r = await call(st, { wo_id: '7' });
  assert.equal(r.status, 500); assert.equal(r.body.code, 'en_route_claim');
  assert.equal(st.scheduleCalls.length, 0); assert.equal(st.failures.length, 1);
});
test('column setup failure is loud and sends nothing', async () => {
  const st = mk({ colsFail: true }); const r = await call(st, { wo_id: '7' });
  assert.equal(r.status, 500); assert.equal(r.body.code, 'en_route_columns'); assert.equal(st.scheduleCalls.length, 0);
});
test('text step failure is reported, not hidden', async () => {
  const st = mk({ scheduleAnswer: { error: 'boom' } }); const r = await call(st, { wo_id: '7' });
  assert.equal(r.status, 500); assert.equal(r.body.code, 'en_route_send'); assert.equal(st.failures.length, 1);
});
test('texts off for the job or nobody to text: says so, sends nothing, no stamp', async () => {
  const a = mk(); a.wos[0].Tenant_Notify_Updates = 'FALSE';
  const ra = await call(a, { wo_id: '7' }); assert.equal(ra.body.sent, false); assert.match(ra.body.note, /turned off/); assert.equal(a.scheduleCalls.length, 0); assert.equal(a.wos[0].En_Route_Sent_At, '');
  const b = mk({ tenants: [{ ID: 't2', First_Name: 'Bo', Phone: '' }] });
  const rb = await call(b, { wo_id: '7' }); assert.equal(rb.body.sent, false); assert.match(rb.body.note, /No tenant/);
});
test('missing wo_id 400, unknown WO 404', async () => {
  assert.equal((await call(mk(), {})).status, 400); assert.equal((await call(mk(), { wo_id: '999' })).status, 404);
});
test('held text is reported with the reason', async () => {
  const st = mk({ scheduleAnswer: { success: true, tenant_sms: false, tenant_results: [{ first: 'Ana', sent: false, why: 'quiet hours' }] } });
  const r = await call(st, { wo_id: '7' }); assert.equal(r.body.sent, false); assert.equal(r.body.tenant_results[0].why, 'quiet hours');
});

test('wiring: route, vendor scope, role scope, staging gate, no second sender', () => {
  assert.match(src, /path === '\/wo\/en-route'\)\s+return await woEnRoute\(env, body\)/);
  assert.match(src, /const VENDOR_WO_WRITE_PATHS = \[[^\]]*'\/wo\/en-route'/);
  assert.match(src, /path === '\/schedule' \|\| path === '\/wo\/en-route'\) b\.vendor_id = sid|path === '\/schedule' \|\| path === '\/wo\/en-route'\) b\.vendor_id/);
  assert.match(src, /'\/wishlist\/add','\/schedule','\/wo\/en-route'/);
  assert.match(src, /if \(path === '\/schedule' \|\| path === '\/wo\/en-route'\) \{/);
  const h = grab('woEnRoute');
  assert.ok(!/smsGatedSend|sendSMS|twilio/i.test(h), 'must reuse scheduleWO, never a second sender');
  assert.match(h, /scheduleWO\(env,/);
  assert.match(grab('scheduleWO'), /!body\.skip_owner/);
});
test('vendor session: another vendor cannot trigger it (real vendorWriteScopeDenied)', async () => {
  const f = new Function('fetchTab', 'logTelemetry', 'findWO', 'json', `
    const VENDOR_WO_WRITE_PATHS = ['/estimate', '/status', '/wo/checklist', '/schedule', '/wo/en-route'];
    const VENDOR_WO_OPTIONAL_PATHS = []; const VENDOR_OWN_ROW_DELETE_PATHS = {}; const VENDOR_NOT_YOURS_MSG = 'nope';
    ${grab('vendorOwnsWO')} ${grab('vendorWriteDeny')} ${grab('vendorWriteScopeDenied')}
    return vendorWriteScopeDenied;`);
  const wos = [{ ID: '7', Vendor_ID: '3' }];
  const fn = f(async () => wos, async () => {}, (l, id) => l.find(w => w.ID === id), (b, s) => ({ status: s || 200, body: b }));
  const bad = await fn({}, '/wo/en-route', { wo_id: '7' }, '4'); assert.equal(bad.status, 403);
  const body = { wo_id: '7' }; const good = await fn({}, '/wo/en-route', body, '3');
  assert.equal(good, null); assert.equal(body.vendor_id, '3'); assert.equal(body.updated_by_role, 'vendor');
});
test('screens: both buttons confirm first, guard double taps, show the real result; Spanish strings exist', () => {
  assert.match(vendor, /🚗 On my way/); assert.match(vendor, /claimSubmit\('enroute-'/); assert.match(vendor, /dry_run: !!dry/); assert.ok(!/confirm\('Send this text/.test(vendor), 'no browser pop-up in the vendor portal'); assert.match(vendor, /'Send this text to:'/); assert.match(vendor, /claimSubmit\('enroute-send-'/);
  assert.match(vendor, /Could not send\. Try again\./);
  assert.match(hub, /hubEnRoute\(woId,ev\.currentTarget\)/); assert.match(hub, /dry_run: true/); assert.match(hub, /confirm\('Send this text to /);
  for (const k of ['🚗 On my way', 'Tenant texted', 'Could not send. Try again.']) assert.ok(i18n.includes('"' + k + '":'), k);
});
