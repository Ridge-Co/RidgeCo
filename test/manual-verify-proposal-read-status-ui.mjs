// Scope Creator (Oct 14 2026): read status + owner-text status under "Send estimate to owner", the quiet-hours
// override checkbox, and the send call carrying override_quiet_hours. Real scope-creator.html, mocked Worker.
// Usage: node test/manual-verify-proposal-read-status-ui.mjs [path/to/scope-creator.html]
import { chromium } from 'playwright'; import { fileURLToPath } from 'node:url'; import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)); const target = process.argv[2] || join(here, '..', 'scope-creator.html');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} window.confirm = () => true; });
let sendBody = null, sendReply = { success: true, sent_to: 'pat@x.com', sent_at: new Date().toISOString(), url: 'https://x/y', sms: { status: 'held', note: 'Held for quiet hours; sends at 8:00am ET unless the owner opens the estimate first.' } };
let fresh = {};
const json = (route, d) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(d) });
await page.route('**/*', async route => { const r = route.request(); const u = new URL(r.url()); if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (u.pathname === '/scope/proposal/send') { sendBody = JSON.parse(r.postData() || '{}'); return json(route, sendReply); }
  if (u.pathname === '/scope') return json(route, Object.assign({ ID: '7' }, fresh));
  return json(route, r.method() === 'GET' ? [] : { success: true }); });
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForFunction(() => typeof renderSendStatus === 'function' && typeof sendEstimateEmail === 'function', null, { timeout: 8000 });
ok(await page.locator('#send-override-quiet').count() === 1, 'override checkbox is on the page');
// not sent yet -> nothing
await page.evaluate(() => { state.current = { ID: '7', Proposal_Text: 'x' }; renderSendStatus(); });
ok((await page.textContent('#send-sent-note')).trim() === '', 'unsent proposal: no status block');
// sent, never opened
await page.evaluate(() => { state.current = { ID: '7', Sent_Date: '2026-10-14T15:00:00Z', Sent_To: 'pat@x.com', Send_Count: '1', Owner_SMS_Status: 'held', Owner_SMS_Time: '2026-10-14T15:00:05Z' }; renderSendStatus(); });
let t = await page.textContent('#send-sent-note');
ok(/Not opened yet/.test(t) && /Text held/.test(t) && /8:00am/.test(t), 'sent+held: "Not opened yet" and the held-text line');
// opened both ways
await page.evaluate(() => { state.current = { ID: '7', Sent_Date: '2026-10-14T15:00:00Z', Sent_To: 'pat@x.com', Send_Count: '2', Owner_SMS_Status: 'skipped_seen', Page_View_Count: '3', Page_First_Viewed: '2026-10-14T16:00:00Z', Page_Last_Viewed: '2026-10-14T18:00:00Z', Email_Open_Count: '1', Email_First_Opened: '2026-10-14T15:30:00Z' }; renderSendStatus(); });
t = await page.textContent('#send-sent-note');
ok(/viewed 3x/.test(t) && /Email opened/.test(t) && /Text skipped/.test(t) && !/Not opened yet/.test(t), 'opened: page views, email open and skipped-text lines show');
for (const [st, re] of [['blocked', /Text blocked/], ['failed', /Text failed/], ['no_phone', /No owner phone/], ['sent', /Owner texted/]]) {
  await page.evaluate(x => { state.current.Owner_SMS_Status = x; renderSendStatus(); }, st); ok(re.test(await page.textContent('#send-sent-note')), 'text status "' + st + '" is shown');
}
// refresh button pulls fresh counters
fresh = { Page_View_Count: '9', Page_First_Viewed: '2026-10-14T16:00:00Z', Page_Last_Viewed: '2026-10-14T19:00:00Z' };
await page.evaluate(() => document.querySelector('#send-sent-note button').click()); await page.waitForFunction(() => /viewed 9x/.test(document.getElementById('send-sent-note').textContent), null, { timeout: 5000 }).catch(() => {});
ok(/viewed 9x/.test(await page.textContent('#send-sent-note')), 'Refresh read status updates the counts');
// send with / without override
await page.evaluate(() => { state.current = { ID: '7', Proposal_Text: 'x' }; window.ownerBillingStatus = () => ({ complete: true, owner: { Email: 'pat@x.com' } }); });
await page.evaluate(() => { document.getElementById('send-override-quiet').checked = true; }); await page.evaluate(() => sendEstimateEmail()); await page.waitForFunction(() => /emailed/.test(document.getElementById('send-status').textContent), null, { timeout: 5000 }).catch(() => {});
ok(sendBody && sendBody.override_quiet_hours === true && sendBody.scope_id === '7', 'checked box sends override_quiet_hours:true');
ok(/emailed pat@x.com/.test(await page.textContent('#send-status')) && /Held for quiet hours/.test(await page.textContent('#send-status')), 'status line shows email sent + the text outcome');
ok(/Text held/.test(await page.textContent('#send-sent-note')), 'sent-note shows the held text');
await page.evaluate(() => { document.getElementById('send-override-quiet').checked = false; state.current = { ID: '7', Proposal_Text: 'x' }; }); sendBody = null;
sendReply = Object.assign({}, sendReply, { sms: { status: 'blocked', note: 'SMS gates blocked it: Global OFF' } });
await page.evaluate(() => sendEstimateEmail()); await page.waitForFunction(() => /Global OFF/.test(document.getElementById('send-status').textContent), null, { timeout: 5000 }).catch(() => {});
ok(sendBody && sendBody.override_quiet_hours === false, 'unchecked box sends override_quiet_hours:false');
ok(/⚠/.test(await page.textContent('#send-status')) && await page.locator('#send-status.err').count() === 1, 'a blocked text is shown as a warning, never hidden');
ok(errors.length === 0, 'no page errors ' + errors.join('|'));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
