// Headless Playwright pass over the REAL scope-creator.html for the Oct 24 2026 silent-failure fix (FEATURE_LOG rule 231):
// before the estimate is sent, the screen says whether the owner's heads-up text will go out (GET /sms/gate-preview, read-only), links to the
// property's Settings tab when a property switch is the reason, and after the send shows the REAL outcome. Only the Worker's fetch endpoints are
// intercepted. Not part of `node --test` (needs a browser).  Usage: node test/manual-verify-proposal-sms-hold-ui.mjs [path/to/scope-creator.html]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', 'scope-creator.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
let previewMode = 'blocked'; const previewCalls = []; let sendBody = null, sendResult = null;
const PREVIEWS = {
  blocked: { ok: true, kind: 'owner', outcome: 'blocked', will_send: false, will_send_later: false, gate_snapshot: 'Property OFF', gates_open: false, headline: 'The text will NOT send: Texts are OFF for this property (its master switch).', reasons: [{ token: 'Property OFF', code: 'property_off', text: 'Texts are OFF for this property (its master switch).', fix: { target: 'property', toggle: 'sms_master' } }], notes: [], test_mode: false, settings_link: 'https://portal.test/index.html?property=50&tab=settings' },
  customer: { ok: true, kind: 'owner', outcome: 'blocked', will_send: false, will_send_later: false, gate_snapshot: 'Customer OFF', gates_open: false, headline: 'The text will NOT send: Texts are OFF for this property\'s customer (the owner account).', reasons: [{ token: 'Customer OFF', code: 'customer_off', text: 'x', fix: { target: 'customer' } }], notes: [], settings_link: 'https://portal.test/index.html?property=50&tab=settings' },
  open: { ok: true, kind: 'owner', outcome: 'send', will_send: true, will_send_later: false, gate_snapshot: 'all gates open', gates_open: true, headline: 'The text will send.', reasons: [], notes: [], test_mode: false },
  held: { ok: true, kind: 'owner', outcome: 'held_quiet_hours', will_send: false, will_send_later: true, gate_snapshot: 'all gates open', gates_open: true, headline: 'The text will be HELD for quiet hours and sent later.', reasons: [], notes: ['It is inside quiet hours, so the text is held and goes out at 2026-10-25T12:00:00.000Z.'], send_after: '2026-10-25T12:00:00.000Z' },
};
await page.route('**/*', async route => {
  const req = route.request(); const u = new URL(req.url());
  if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  const p = u.pathname;
  if (p === '/sms/gate-preview') { previewCalls.push(u.search); if (previewMode === 'error') return json(route, { error: 'Sheets read failed (503)' }, 500); return json(route, PREVIEWS[previewMode]); }
  if (p === '/scope/proposal/send') { sendBody = JSON.parse(req.postData() || '{}'); return json(route, sendResult); }
  if (p === '/config') return json(route, {});
  return json(route, req.method() === 'GET' ? [] : { success: true });
});
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.refreshSendSmsPreview === 'function');
const setScope = (sendCount) => page.evaluate((n) => { window.state.current = { ID: 'S1', Property_ID: '50', Proposal_Text: 'Scope of work', Send_Count: String(n), Sent_Date: n ? '2026-10-20T10:00:00Z' : '' }; window.ownerBillingStatus = () => ({ complete: true, owner: { Email: 'owner@example.com' } }); }, sendCount);
const banner = async () => (await page.innerText('#send-sms-preview')).replace(/\s+/g, ' ');

console.log('(1) before sending: the banner says what will happen');
await setScope(0); previewMode = 'blocked'; await page.evaluate(() => refreshSendSmsPreview());
await page.waitForFunction(() => /NOT send/.test(document.getElementById('send-sms-preview').innerText));
ok(/The text will NOT send: Texts are OFF for this property/.test(await banner()), 'property master OFF: "The text will NOT send: Texts are OFF for this property"');
ok(/The email will still go/.test(await banner()), 'and says the email still goes');
const href = await page.getAttribute('#send-sms-preview a', 'href');
ok(/property=50&tab=settings/.test(href || ''), 'links to the property Settings tab: ' + href);
ok(await page.locator('#send-sms-preview .owner-note.err').count() === 1, 'shown as an error-coloured box');
ok(previewCalls.some(c => /recipient_type=owner/.test(c) && /window=proposal/.test(c) && /property_id=50/.test(c)), 'asks for the owner text on the proposal quiet window for this property');
previewMode = 'customer'; await page.evaluate(() => refreshSendSmsPreview());
await page.waitForFunction(() => /owner account has texts switched OFF/.test(document.getElementById('send-sms-preview').innerText));
ok(await page.locator('#send-sms-preview a').count() === 0, 'a customer-level reason has no property link (the switch is on the owner account) and says so');
previewMode = 'open'; await page.evaluate(() => refreshSendSmsPreview());
await page.waitForFunction(() => /will send/.test(document.getElementById('send-sms-preview').innerText));
ok(await page.locator('#send-sms-preview .owner-note.ok').count() === 1, 'open gates: green "The text will send."');
previewMode = 'held'; await page.evaluate(() => refreshSendSmsPreview());
await page.waitForFunction(() => /HELD/.test(document.getElementById('send-sms-preview').innerText));
ok(await page.locator('#send-sms-preview .owner-note.warn').count() === 1, 'quiet hours: amber "HELD" box');
previewMode = 'error'; await page.evaluate(() => refreshSendSmsPreview());
await page.waitForFunction(() => /Could not check/.test(document.getElementById('send-sms-preview').innerText));
ok(/Sheets read failed/.test(await banner()), 'FAULT: if the check itself fails it says so, with the reason (never a blank)');
const before = previewCalls.length; await setScope(1); await page.evaluate(() => refreshSendSmsPreview());
await page.waitForFunction(() => /Resend/.test(document.getElementById('send-sms-preview').innerText));
ok(previewCalls.length === before, 'a resend makes no gate call (only the first send texts the owner)');

console.log('(2) sending with a blocked text: warned in the confirm, real outcome after');
await setScope(0); previewMode = 'blocked'; dialogs.length = 0;
sendResult = { success: true, sent_to: 'owner@example.com', sent_at: new Date().toISOString(), url: 'https://x.test/p', sms: { status: 'blocked', note: 'SMS gates blocked it: Property OFF' } };
await page.evaluate(() => sendEstimateEmail());
await page.waitForFunction(() => /emailed/.test(document.getElementById('send-status').innerText));
ok(dialogs.length === 1 && /The text will NOT send/.test(dialogs[0]) && /email will still go/.test(dialogs[0]), 'the confirm box warns the text will NOT send: ' + JSON.stringify(dialogs[0]).slice(0, 160));
ok(!/also gets a short text/.test(dialogs[0]), 'and no longer promises the owner a text');
ok(sendBody && sendBody.scope_id === 'S1', 'the email send itself is unchanged');
ok(/Text NOT sent: blocked by an SMS switch/.test(await banner()) && /Property OFF/.test(await banner()), 'after: real outcome with the real reason (Property OFF)');
ok(/property=50&tab=settings/.test(await page.getAttribute('#send-sms-preview a', 'href') || ''), 'after: link to the property Settings tab');
ok(await page.locator('#send-status.err').count() === 1, 'the status line is red, not a green all-clear');

console.log('(3) sending with an open gate');
await setScope(0); previewMode = 'open'; dialogs.length = 0; await page.evaluate(() => { document.getElementById('send-status').textContent = ''; });
sendResult = { success: true, sent_to: 'owner@example.com', sent_at: new Date().toISOString(), url: 'https://x.test/p', sms: { status: 'sent', note: 'Texted the owner.' } };
await page.evaluate(() => sendEstimateEmail());
await page.waitForFunction(() => /Owner texted/.test(document.getElementById('send-sms-preview').innerText));
ok(/also gets a short text/.test(dialogs[0]), 'open gate: the confirm still says the owner also gets a text');
ok(await page.locator('#send-sms-preview .owner-note.ok').count() === 1, 'real outcome: green "Owner texted"');
ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
