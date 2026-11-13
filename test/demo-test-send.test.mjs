// DEMO "SEND ME A TEST" (Nov 12 2026, Phase 3b): a demo owner / demo tenant taps a button and gets ONE real-wording text on their OWN phone.
// Brett's rules, asserted here against the REAL worker.js over a fake Google Sheets, fake Twilio, fake Gmail: texts only; owner events = new request, scheduled, complete;
// tenant events = received, assigned, scheduled, completed; SMS cap 2 per test (owner and tenant counted separately); the text can only ever reach the prospect's own number
// (never Brett, never a real tenant / owner / vendor, never another slot's prospect); a real or admin session cannot use the route; a cleared slot's old login is dead.
import fs from 'fs';
import { root, wsrc, store, outbound, worker, call, mint, tab, adminCall, rows, rowOf, telem, twilioPosts, login, PH1, PH1N, PH2, PH2N, realWo, realWoBefore, grab, grabConst } from './_demo-world.mjs';
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const toOf = (p) => decodeURIComponent((/(?:^|&)To=([^&]*)/.exec(p.body) || [])[1] || '').replace(/\+/g, '+');
const bodyOf = (p) => decodeURIComponent(((/(?:^|&)Body=([^&]*)/.exec(p.body) || [])[1] || '').replace(/\+/g, ' '));
const BRETT = '14439617927';

// ===== 1. The shared wordings equal the old inline templates, character for character =====
const pure = new Function(grabConst('TENANT_STOP_NOTE') + '\n' + ['smsShort', 'woJobLabel'].map(grab).join('\n') + '\n' + wsrc.slice(wsrc.indexOf('const SMS_MSG = {'), wsrc.indexOf('function smsShort(s, n)')) + '\nreturn { SMS_MSG, TENANT_STOP_NOTE };')();
const M = pure.SMS_MSG, STOP = pure.TENANT_STOP_NOTE;
const long = 'x'.repeat(100);
t('wording: owner request received (with and without description / trade)',
  M.ownerJobReceived({ first: 'Ann', trade: 'Plumbing', where: 'W', description: 'Leaky tap\nsecond line', woId: 'WO-1' }) === `Hi Ann, new Plumbing request from your tenant at W: Leaky tap. We'll update you once it's scheduled. Ref: WO-1.`
  && M.ownerJobReceived({ first: 'Ann', trade: '', where: 'W', description: '', woId: 'WO-1' }) === `Hi Ann, new General request from your tenant at W: (no description). We'll update you once it's scheduled. Ref: WO-1.`
  && M.ownerJobReceived({ first: 'A', where: 'W', description: long, woId: 'R' }).includes('x'.repeat(80) + '...'));
t('wording: tenant request received carries the STOP note', M.tenantJobReceived({ first: 'Ann', trade: 'HVAC', address: 'A 1', woId: 'WO-2' }) === `Hi Ann, we've received your HVAC request at A 1 and it's pending assignment and scheduling. We'll be in touch. Ref: WO-2. ${STOP}`);
t('wording: tenant assigned with a vendor name and phone (the phone arrives already formatted, exactly as the real handler formats it)', M.tenantJobAssigned({ first: 'Ann', label: 'L', vendorName: 'V Co', vendorPhone: '(410) 555-0142', woId: 'WO-3' }) === 'Hi Ann, your L has been assigned to V Co ((410) 555-0142). They will contact you to schedule. Ref: WO-3.');
t('wording: tenant assigned without vendor details', M.tenantJobAssigned({ first: 'Ann', label: 'L', woId: 'WO-3' }) === 'Hi Ann, your L has been assigned to a technician. They will contact you to schedule. Ref: WO-3.');
t('wording: tenant scheduled (dated and within-the-hour)', M.tenantJobScheduled({ first: 'Ann', label: 'L', address: 'A 1', dateStr: 'Friday, Nov 13', window: '9am - 12pm', woId: 'WO-4', withinHour: false }) === 'Hi Ann, your L at A 1 is scheduled for Friday, Nov 13, 9am - 12pm. Ref: WO-4.'
  && M.tenantJobScheduled({ first: 'Ann', label: 'L', address: 'A 1', woId: 'WO-4', withinHour: true }) === 'Hi Ann, your technician is on the way and will arrive within 1 hour for your L at A 1. Ref: WO-4.');
t('wording: tenant completed', M.tenantJobCompleted({ first: 'Ann', label: 'L', address: 'A 1', woId: 'WO-5' }) === 'Hi Ann, your L at A 1 is complete. Thank you! Ref: WO-5.');
t('wording: owner scheduled', M.ownerJobScheduled({ first: 'Ann', woId: 'WO-6', label: 'L', where: 'W', dateStr: 'Fri, Nov 13', window: '9am - 12pm' }) === 'Hi Ann, WO-6 (L) at W is scheduled for Fri, Nov 13, 9am - 12pm, subject to change.');
t('wording: owner complete', M.ownerJobComplete({ first: 'Ann', woId: 'WO-7', label: 'L', address: 'A 1' }) === 'Hi Ann, WO-7 (L) at A 1 is complete.');
t('real handlers: every old inline wording is gone and the real code calls the shared builders (so test and real copy cannot drift)',
  ['ownerJobReceived', 'tenantJobReceived', 'tenantJobAssigned', 'tenantJobScheduled', 'tenantJobCompleted', 'ownerJobScheduled', 'ownerJobComplete'].every(n => (wsrc.match(new RegExp('SMS_MSG\\.' + n + '\\(', 'g')) || []).length >= 2)
  && !/request from your tenant at \$\{propUnitText/.test(wsrc) && !/has been assigned to \$\{vendor\.Name/.test(wsrc) && !/is complete\. Thank you! Ref: \$\{body\.wo_id\}\.`;/.test(wsrc.replace(/tenantJobCompleted: \(o\)[^\n]*/, ''))
  && !/subject to change\.`;/.test(wsrc.replace(/ownerJobScheduled: \(o\)[^\n]*/, '')));

// ===== 2. Set up two demo prospects and log them in =====
let r = await adminCall('POST', '/demo/add', { name: 'Ann Prospect', phone: PH1, email: 'ann@prospect.example' });
const PIN1 = r.json && r.json.pin;
r = await adminCall('POST', '/demo/add', { name: 'Bo Second', phone: PH2, email: 'bo@prospect.example' });
const PIN2 = r.json && r.json.pin;
const tokO1 = (await login('owner', 'Ann', PIN1)).json.token, tokT1 = (await login('tenant', 'Ann', PIN1)).json.token;
const tokO2 = (await login('owner', 'Bo', PIN2)).json.token, tokT2 = (await login('tenant', 'Bo', PIN2)).json.token;
t('setup: four demo sessions', [tokO1, tokT1, tokO2, tokT2].every(x => !!x));
const sinceSetup = outbound.length;
const setCount = (tabName, id, n) => { const rr = store.tabs.get(tabName), h = rr[0], row = rr.find(x => x[0] === id); row[h.indexOf('Demo_SMS_Count')] = String(n); };

// ===== 3. Status route =====
r = await call('GET', '/demo/test-status', tokO1);
t('status: owner sees its three events, 0 of 2 used, not at the limit', r.status === 200 && r.json.ok && r.json.texts_used === 0 && r.json.texts_cap === 2 && r.json.limit_reached === false && r.json.events.map(e => e.key).join() === 'received,scheduled,complete', r.json);
r = await call('GET', '/demo/test-status', tokT1);
t('status: tenant sees its four events', r.status === 200 && r.json.events.map(e => e.key).join() === 'received,assigned,scheduled,completed', r.json);

// ===== 4. Owner test: 2 texts, then the limit =====
r = await call('POST', '/demo/test-send', tokO1, { event: 'received' });
t('owner test 1: sent, 1 of 2', r.status === 200 && r.json.ok === true && r.json.code === 'sent' && r.json.texts_used === 1, r.json);
r = await call('POST', '/demo/test-send', tokO1, { event: 'scheduled' });
t('owner test 2: sent, 2 of 2', r.status === 200 && r.json.ok === true && r.json.texts_used === 2, r.json);
r = await call('POST', '/demo/test-send', tokO1, { event: 'complete' });
t('owner test 3: refused with "Test limit reached", nothing sent', r.status === 200 && r.json.ok === false && r.json.code === 'limit_reached' && /Test limit reached/.test(r.json.message), r.json);
const ownerPosts = twilioPosts();
t('owner test: exactly two texts left the building, both to Ann\'s own phone', ownerPosts.length === 2 && ownerPosts.every(p => toOf(p) === PH1N), ownerPosts.map(toOf));
t('owner test: real wording, labelled DEMO, with a STOP line', /^DEMO: Hi Ann, new Plumbing request from your tenant at 1200 Fakeview Lane/.test(bodyOf(ownerPosts[0])) && /Ref: WO-D101\./.test(bodyOf(ownerPosts[0])) && /^DEMO: Hi Ann, WO-D103 \(Electrical job \(Replace two cracked outlets/.test(bodyOf(ownerPosts[1])) && ownerPosts.every(p => /\bSTOP\b/.test(bodyOf(p))), ownerPosts.map(bodyOf));
t('owner test: counters - owner row 2, tenant row 0 (separate tests)', rowOf('Owners', 'DO1').Demo_SMS_Count === '2' && (rowOf('Tenants', 'DT1').Demo_SMS_Count || '0') === '0');
r = await call('GET', '/demo/test-status', tokO1);
t('status after: 2 of 2 and limit reached', r.json.texts_used === 2 && r.json.limit_reached === true, r.json);

// ===== 5. Tenant test counted separately =====
r = await call('POST', '/demo/test-send', tokT1, { event: 'received' });
t('tenant test 1: sent even though the owner test is used up', r.status === 200 && r.json.ok === true && r.json.texts_used === 1, r.json);
r = await call('POST', '/demo/test-send', tokT1, { event: 'assigned' });
t('tenant test 2: sent', r.json.ok === true && r.json.texts_used === 2, r.json);
r = await call('POST', '/demo/test-send', tokT1, { event: 'scheduled' });
t('tenant test 3: limit reached, nothing sent', r.json.ok === false && r.json.code === 'limit_reached', r.json);
const tenPosts = twilioPosts().slice(2);
t('tenant test: two texts, both to Ann\'s phone, real wording with the demo vendor and the tenant STOP note', tenPosts.length === 2 && tenPosts.every(p => toOf(p) === PH1N) && /^DEMO: Hi Ann, we've received your Plumbing request at 1200 Fakeview Lane/.test(bodyOf(tenPosts[0])) && /Reply STOP to opt out/.test(bodyOf(tenPosts[0])) && /assigned to Sample Home Services \(\(410\) 555-0142\)\. They will contact you/.test(bodyOf(tenPosts[1])), tenPosts.map(bodyOf));
t('tenant test: counters - tenant row 2, owner row still 2', rowOf('Tenants', 'DT1').Demo_SMS_Count === '2' && rowOf('Owners', 'DO1').Demo_SMS_Count === '2');

// ===== 6. Every one of the seven events works (counters reset between, so each wording is exercised) =====
const seen = {};
for (const [role, tokX, tabName, id, evs] of [['owner', tokO2, 'Owners', 'DO2', ['received', 'scheduled', 'complete']], ['tenant', tokT2, 'Tenants', 'DT2', ['received', 'assigned', 'scheduled', 'completed']]]) {
  for (const ev of evs) {
    setCount(tabName, id, 0);
    const before = twilioPosts().length;
    r = await call('POST', '/demo/test-send', tokX, { event: ev });
    const posts = twilioPosts().slice(before);
    seen[role + ':' + ev] = posts.length === 1 ? bodyOf(posts[0]) : '';
    t(`every event: ${role} "${ev}" sends exactly one text to Bo's own phone`, r.json.ok === true && posts.length === 1 && toOf(posts[0]) === PH2N && /^DEMO: Hi Bo, /.test(seen[role + ':' + ev]), { j: r.json, n: posts.length });
  }
}
t('every event: scheduled texts carry the sample job\'s date and window; the completed ones say complete', /scheduled for \w+, \w{3} \d+, 9am - 12pm/.test(seen['owner:scheduled'] + seen['tenant:scheduled']) && / is complete\./.test(seen['owner:complete']) && /is complete\. Thank you!/.test(seen['tenant:completed']), seen);

// ===== 7. Nothing else was ever contacted =====
const allPosts = twilioPosts();
t('safety: every text of the whole run went to Ann\'s or Bo\'s own phone (never Brett, admin, a real owner/tenant/vendor)', allPosts.length > 0 && allPosts.every(p => [PH1N, PH2N].includes(toOf(p))), allPosts.map(toOf));
t('safety: Brett\'s number never appears in anything sent', !outbound.slice(sinceSetup).some(o => o.body.includes(BRETT)));
t('safety: no email was sent (the test button is texts only)', !outbound.slice(sinceSetup).some(o => /gmail/i.test(o.url)));
t('safety: slot 2\'s tests never touched slot 1\'s counters and vice versa', rowOf('Owners', 'DO1').Demo_SMS_Count === '2' && rowOf('Tenants', 'DT1').Demo_SMS_Count === '2');
t('safety: the real work order and attachment are untouched', realWo() === realWoBefore);
const mq = store.tabs.has('Message_Queue') ? rows('Message_Queue') : [];
t('safety: every queued test text is tied to a sample work order and went to a prospect phone', mq.length === allPosts.length && mq.every(m => /^WO-D\d/.test(m.WO_ID) && [PH1N, PH2N].includes(m.Delivered_To || m.Recipient_Phone)), mq.map(m => [m.WO_ID, m.Recipient_Phone]));
t('ledger: each test is logged, the log carries no phone number', telem('demo_test_send').length >= 10 && !telem('demo_test_send').some(x => /\d{10}/.test(x.Notes)), telem('demo_test_send').map(x => x.Notes).slice(0, 3));

// ===== 8. Who may use the route =====
let before = twilioPosts().length;
r = await call('POST', '/demo/test-send', mint('owner', '12'), { event: 'received' });
t('real owner session: refused, nothing sent', r.status === 403 && twilioPosts().length === before, r.status);
r = await call('GET', '/demo/test-status', mint('tenant', '40'));
t('real tenant session: status refused', r.status === 403, r.status);
r = await call('POST', '/demo/test-send', mint('tenant', '40'), { event: 'received' });
t('real tenant session: send refused, nothing sent', r.status === 403 && twilioPosts().length === before, r.status);
r = await call('POST', '/demo/test-send', mint('vendor', '3'), { event: 'received' });
t('vendor session: not in its scope, refused', r.status === 401 && twilioPosts().length === before, r.status);
r = await adminCall('POST', '/demo/test-send', { event: 'received' });
t('admin (no demo session): refused, nothing sent', r.status === 403 && twilioPosts().length === before, r.status);
r = await call('POST', '/demo/test-send', undefined, { event: 'received' });
t('no token: refused', r.status === 401 && twilioPosts().length === before, r.status);
setCount('Owners', 'DO1', 0);
r = await call('POST', '/demo/test-send', tokO1, { event: 'not-a-real-event' });
t('unknown event name: 400, nothing sent', r.status === 400 && twilioPosts().length === before, r.status);
r = await call('POST', '/demo/test-send', tokO1, { event: 'received', owner_id: 'DO2', to: PH2N, phone: '+14105550123', tenant_id: '40', slot: 2 });
const smuggled = twilioPosts().slice(before);
t('smuggling ids / numbers / slot in the body cannot aim the text: it is refused or goes to Ann only', (r.status >= 400 && smuggled.length === 0) || (smuggled.length === 1 && toOf(smuggled[0]) === PH1N), { s: r.status, to: smuggled.map(toOf) });
setCount('Owners', 'DO1', 0);
before = twilioPosts().length;
r = await call('POST', '/demo/test-send', tokT1, { event: 'received', tenant_id: '40', property_id: '7' });
const smug2 = twilioPosts().slice(before);
t('a demo tenant naming a REAL tenant / property in the body cannot reach them', smug2.every(p => toOf(p) === PH1N) && !outbound.some(o => /4105550123|4105550122|4105550177/.test(o.body)), { s: r.status, to: smug2.map(toOf) });
r = await call('POST', '/workorder', tokT1, { property_id: '7', unit_id: '9', tenant_id: 'DT1', trade: 'Plumbing', description: 'cross-property attempt', type: 'tenant' });
t('demo tenant writing to a REAL property is still refused', r.status === 403, r.status);

// ===== 9. When things go wrong, the person is told in plain words =====
const wasFetch = globalThis.fetch;
const twilioMode = { mode: 'ok' };
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (/api\.twilio\.com\/.*Messages\.json$/.test(url) && ((init && init.method) || 'GET') === 'POST' && twilioMode.mode !== 'ok') {
    if (twilioMode.mode === 'stop') return new Response(JSON.stringify({ code: 21610, message: 'Attempt to send to unsubscribed recipient', status: 400 }), { status: 400 });
    return new Response(JSON.stringify({ message: 'server error (test)', status: 500 }), { status: 500 });
  }
  return wasFetch(input, init);
};
setCount('Owners', 'DO2', 0);
twilioMode.mode = 'stop';
r = await call('POST', '/demo/test-send', tokO2, { event: 'received' });
t('Twilio says the person replied STOP: "You replied STOP", no crash', r.status === 200 && r.json.ok === false && r.json.code === 'opted_out' && /replied STOP/.test(r.json.message), r.json);
setCount('Owners', 'DO2', 0);
twilioMode.mode = 'down';
r = await call('POST', '/demo/test-send', tokO2, { event: 'received' });
t('Twilio is down: a plain "did not go through" message that is honest about the count', r.status === 200 && r.json.ok === false && r.json.code === 'failed' && /did not go through/.test(r.json.message) && /may still count/.test(r.json.message), r.json);
t('Twilio is down: the count was still taken BEFORE the send (never an uncounted send)', rowOf('Owners', 'DO2').Demo_SMS_Count === '1', rowOf('Owners', 'DO2').Demo_SMS_Count);
twilioMode.mode = 'ok';
globalThis.fetch = wasFetch;

// ===== 10. A cleared slot's login is dead; the next prospect gets a fresh 2 texts and only their own phone =====
r = await adminCall('POST', '/demo/reset', { slot: 1 });
t('reset slot 1', r.status === 200 && r.json.reset === true, r.json);
before = twilioPosts().length;
r = await call('POST', '/demo/test-send', tokO1, { event: 'received' });
t('after reset: Ann\'s old owner login is dead (401, demo ended) and nothing is sent', r.status === 401 && twilioPosts().length === before, { s: r.status, j: r.json });
r = await call('POST', '/demo/test-send', tokT1, { event: 'received' });
t('after reset: Ann\'s old tenant login is dead too', r.status === 401 && twilioPosts().length === before, r.status);
r = await adminCall('POST', '/demo/add', { name: 'Cy Third', phone: '4105550166', email: 'cy@prospect.example', slot: 1 });
const tokO3 = (await login('owner', 'Cy', r.json && r.json.pin)).json.token;
r = await call('POST', '/demo/test-send', tokO3, { event: 'complete' });
const cyPosts = twilioPosts().slice(before);
t('next prospect in the same slot: counters start at 0, text goes to Cy only, never to Ann', r.json.ok === true && r.json.texts_used === 1 && cyPosts.length === 1 && toOf(cyPosts[0]) === '+14105550166' && !outbound.slice(before).some(o => o.body.includes('4105550133')), { j: r.json, to: cyPosts.map(toOf) });

// ===== 11. The pages =====
for (const [f, role] of [['owner.html', 'owner'], ['tenant.html', 'tenant']]) {
  const h = fs.readFileSync(root + f, 'utf8');
  t(`${f}: the panel is built only from demoBanner (so only demo logins ever see it)`, h.includes(`demoTestPanel('${role}');`) && (h.match(/demoTestPanel\(/g) || []).length === 2 && /function demoBanner\(on\) \{[\s\S]*?if \(!on\) return;[\s\S]*?demoTestPanel\('/.test(h));
  t(`${f}: consent line mentions STOP and rates, shows "Texts used: n of cap" and the limit message`, /Reply STOP to stop\. Message and data rates may apply/.test(h) && /'Texts used: ' \+ d\.texts_used \+ ' of ' \+ d\.texts_cap/.test(h) && /Test limit reached/.test(h));
  t(`${f}: the browser sends only the event name`, /api\('POST', '\/demo\/test-send', \{ event: sel\.value \}\)/.test(h));
  const m = /function demoTestPanel\(role\) \{[\s\S]*?\n\}\nfunction onLoginSuccess/.exec(h);
  let compiles = false; try { new Function('api', m[0].replace(/function onLoginSuccess$/, '')); compiles = true; } catch (e) { compiles = String(e); }
  t(`${f}: the panel script compiles`, compiles === true, compiles);
}

console.log(`demo-test-send: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
