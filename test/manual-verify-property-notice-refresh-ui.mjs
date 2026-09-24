// Headless Playwright pass for CAP-036 #9 (Sep 24 2026): Property Notice modal — owner/property
// info gets stuck on whichever property was first loaded ("opened on 20 East Eager Street,
// switching properties didn't update"). Loads the REAL index.html, intercepts the Worker fetch
// calls with a SLOW response for the first property and a FAST response for the second (the
// exact shape of the real bug: two chained/overlapping requests + no stale-response guard,
// not a missing onchange handler), and asserts the on-screen info always matches the CURRENTLY
// selected property, never a slower response for a property the user has since left.
//
// This is a real network-timing race — same convention as the other manual-verify-*-ui.mjs
// files (real browser, real shipped JS, page.route interception), just with deliberately
// staggered route delays instead of instant fixed responses.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'index.html');
const HTML_ARG = process.argv[2]; // optional override so this can be run against a pre-fix copy too
const targetHtml = HTML_ARG || htmlPath;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const PROPS = [
  { ID: 'P1', Address: '20 East Eager Street', Active: 'TRUE' },
  { ID: 'P2', Address: '115 West 29th Street', Active: 'TRUE' },
];

const noticeCalls = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // Auto-login: seed the saved access code before the page's own script runs.
  await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });

  await page.route('**/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/hub-bootstrap', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ properties: PROPS, units: [], tenants: [], vendors: [], workorders: [], invoices: [], owners: [], keys: [] }),
  }));
  await page.route('**/pricing-config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.route('**/notifications/pending', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/wishlist', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // P1 (the property the modal opens on) answers SLOWLY. P2 (what the user switches to)
  // answers FAST. A stale-response bug shows up as P1's late info landing on top of P2's.
  await page.route('**/property/notice', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    noticeCalls.push(body);
    const isP1 = body.property_id === 'P1';
    const prop = PROPS.find((p) => p.ID === body.property_id);
    if (isP1) await new Promise((r) => setTimeout(r, 700));
    else await new Promise((r) => setTimeout(r, 20));
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        property_address: prop.Address, owner: 'Test Owner ' + body.property_id,
        sms_message: '', email_subject: '', email_body: '',
        total_active_tenants: isP1 ? 3 : 5,
        sms_recipient_count: isP1 ? 3 : 5, sms_skipped_opted_out: 0,
        email_recipient_count: 0,
      }),
    });
  });

  await page.goto('file://' + targetHtml, { waitUntil: 'load' });
  await page.waitForSelector('#app', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(consoleErrors.length === 0, 'no JS errors loading + logging into the Hub (got: ' + consoleErrors.slice(0, 3).join(' | ') + ')');

  // Open the modal pre-selected on P1 (20 East Eager Street) — same as the real incident.
  await page.evaluate(() => window.openPropertyNoticeModal('P1'));
  await page.fill('#pn-message', 'Test notice message so the auto-fill branch never triggers.');
  ok((await page.locator('#pn-property').inputValue()) === 'P1', 'modal opens pre-selected on P1 (20 East Eager Street)');

  // Let P1's request actually get dispatched (past the 350ms debounce) before switching, so this
  // reproduces a REQUEST ALREADY IN FLIGHT when the user switches — not just a cancelled timer.
  await page.evaluate(() => window.propertyNoticeRecalc());
  await page.waitForTimeout(400);
  ok(noticeCalls.some((c) => c.property_id === 'P1'), 'the P1 preview request was actually dispatched before switching (' + JSON.stringify(noticeCalls) + ')');

  // Switch to P2 (115 West 29th Street) while P1's slow response is still in flight.
  await page.selectOption('#pn-property', 'P2');
  await page.waitForTimeout(500); // P2's own 350ms debounce + its fast response

  const recipientsAfterSwitch = await page.locator('#pn-recipients').textContent();
  ok(/115 West 29th Street/.test(recipientsAfterSwitch || ''), 'immediately after switching, the info shown is for P2, 115 West 29th Street (got: ' + JSON.stringify(recipientsAfterSwitch) + ')');
  ok(!/20 East Eager Street/.test(recipientsAfterSwitch || ''), 'the info shown right after switching is NOT still 20 East Eager Street');

  // Now let P1's slow (700ms-delayed) response actually land — this is the exact moment the old
  // code broke: a late response for the property the user left painting over the current one.
  await page.waitForTimeout(500);
  const recipientsFinal = await page.locator('#pn-recipients').textContent();
  ok(/115 West 29th Street/.test(recipientsFinal || ''), 'after P1\'s late response finally arrives, the screen STILL shows P2 (115 West 29th Street) — the stale P1 response was discarded (got: ' + JSON.stringify(recipientsFinal) + ')');
  ok(!/20 East Eager Street/.test(recipientsFinal || ''), 'the stale P1 response never overwrote the screen with 20 East Eager Street');
  ok((await page.locator('#pn-property').inputValue()) === 'P2', 'the property picker itself still reads P2 (the selection was never silently reverted)');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
