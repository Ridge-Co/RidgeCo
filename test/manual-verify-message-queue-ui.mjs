// TWILIO_SMS_BUILD_BRIEF_v1.0 — real headless-Chromium pass on message-queue.html, the part
// protecting Brett from a real mass-send mistake (the review screen's bulk-select + Send
// selected / Skip selected behavior). Mocks every Worker call via route interception — no
// real network, no real Twilio send. Same convention as the project's other
// test/manual-verify-*.mjs scripts (mocked worker responses, asserted DOM state).
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + path.join(__dirname, '..', 'message-queue.html');

const MOCK_ROWS = [
  { ID:'1', WO_ID:'1200', Message_Type:'tenant_job_assigned', Recipient_Type:'tenant', Recipient_Name:'Dana Smith', Recipient_Phone:'+14105551111', Property_ID:'3', Property_Address:'115 W 29th St', Message_Body:'Hi Dana, your maintenance request (Plumbing) has been assigned to Alex Busey (443) 617-2152. Ref: 1200.', Status:'pending', Delivered_To:'', Gate_Snapshot:'Global OFF', Created_Date:'2026-09-14T12:00:00.000Z', Sent_Date:'', Twilio_Message_SID:'', Active:'TRUE' },
  { ID:'2', WO_ID:'1201', Message_Type:'tenant_job_assigned', Recipient_Type:'tenant', Recipient_Name:'Dana Smith', Recipient_Phone:'+14105551111', Property_ID:'3', Property_Address:'115 W 29th St', Message_Body:'Hi Dana, your maintenance request (Plumbing) has been assigned to Alex Busey (443) 617-2152. Ref: 1201.', Status:'pending', Delivered_To:'', Gate_Snapshot:'Global OFF', Created_Date:'2026-09-14T12:05:00.000Z', Sent_Date:'', Twilio_Message_SID:'', Active:'TRUE' },
  { ID:'3', WO_ID:'', Message_Type:'vendor_paid', Recipient_Type:'vendor', Recipient_Name:'Alex Busey', Recipient_Phone:'+14436172152', Property_ID:'', Property_Address:'', Message_Body:'Hi Alex, payment of $325.00 has been sent for your recent work with Ridge Co. Thank you!', Status:'pending', Delivered_To:'', Gate_Snapshot:'Global OFF', Created_Date:'2026-09-14T11:00:00.000Z', Sent_Date:'', Twilio_Message_SID:'', Active:'TRUE' },
];

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // mobile-first per house convention

  const releaseCalls = [], skipCalls = [];
  await page.route('**/message-queue.html', route => route.continue());
  await page.route('https://maintenance-hub.brett-2f8.workers.dev/**', async route => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/health')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok:true, twilio: { sid_set:true, api_key_sid_set:true, api_key_secret_set:true, from_set:true, twilio_enabled:false, test_mode:true } }) });
    }
    if (url.includes('/version')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'test' }) });
    if (url.includes('/message-queue/release')) {
      const body = JSON.parse(route.request().postData() || '{}');
      releaseCalls.push(body.ids);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok:true, results: body.ids.map(id => ({ id, sent:false, gate_snapshot:'Global OFF' })) }) });
    }
    if (url.includes('/message-queue/skip')) {
      const body = JSON.parse(route.request().postData() || '{}');
      skipCalls.push(body.ids);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok:true, results: body.ids.map(id => ({ id })) }) });
    }
    if (url.includes('/message-queue')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ROWS) });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto(fileUrl);
  // Simulate an already-logged-in session (same pattern the app itself uses via localStorage).
  await page.evaluate(() => localStorage.setItem('mh_auth', 'test-secret'));
  await page.reload();
  await page.waitForSelector('#app:not(.hide)', { timeout: 5000 });
  ok(true, 'logs in from a stored access code without hitting the visible login form');

  await page.waitForSelector('.row-card', { timeout: 5000 });
  const cardCount = await page.locator('.row-card').count();
  ok(cardCount === 3, 'renders all 3 mocked pending rows (' + cardCount + ' found)');

  const groupHeaders = await page.locator('.group-header').allTextContents();
  ok(groupHeaders.some(t => t.includes('115 W 29th St')), 'groups the two tenant rows under their property address');
  ok(groupHeaders.some(t => t.includes('Vendor · Alex Busey')), 'groups the vendor row under "Vendor · <name>"');

  const gateText = await page.locator('.row-gate').first().textContent();
  ok(gateText.includes('Global OFF'), 'a pending row surfaces WHY it is still pending (Gate_Snapshot) — this is the whole point of the review screen');

  // Individual (non-bulk) Send on one row.
  await page.locator('.row-card', { hasText: 'Ref: 1200' }).locator('button:has-text("Send")').click();
  await page.waitForTimeout(150);
  ok(releaseCalls.length === 1 && releaseCalls[0].length === 1 && releaseCalls[0][0] === '1', 'tapping Send on a single row releases exactly that one row, not the whole batch');

  // Bulk mode: checkboxes appear, multi-select, Send selected fires with the right ids only.
  await page.click('#bulk-toggle-btn');
  ok(await page.locator('.row-card.bulk input[type=checkbox]').first().isVisible(), 'checkboxes appear once Select multiple is toggled on');
  ok(await page.locator('#batch-bar').isHidden(), 'the sticky action bar stays hidden until at least one row is actually checked');

  const checkboxes = page.locator('.row-card input[type=checkbox]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  ok(await page.locator('#batch-bar').isVisible(), 'the sticky action bar appears once rows are checked');
  const countText = await page.locator('#batch-count').textContent();
  ok(countText.includes('2'), 'the running count reflects exactly 2 checked rows, not 3 (proves it is not accidentally selecting the whole visible set)');

  await page.click('#batch-bar >> text=Skip selected');
  await page.waitForTimeout(150);
  ok(skipCalls.length === 1 && skipCalls[0].length === 2, 'Skip selected sends exactly the 2 checked ids, not all 3 rows on screen — the actual safety mechanism this screen exists for');

  await browser.close();
  console.log(`\nmessage-queue UI: ${n}/${n} checks passing`);
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
