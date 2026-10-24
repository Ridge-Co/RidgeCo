// Headless Playwright pass over the REAL message-queue.html for the Oct 24 2026 build (FEATURE_LOG rule 231): a pending text held by a PROPERTY switch
// shows the reason with a link to that property's Settings tab; a customer-level hold is explained; Manual Send is untouched. Only the Worker is mocked.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + path.join(__dirname, '..', 'message-queue.html');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const base = { Message_Type: 'owner_proposal_ready', Recipient_Type: 'owner', Recipient_Name: 'Amanda', Recipient_Phone: '+14105551111', Status: 'pending', Created_Date: '2026-10-24T10:00:00Z', Message_Body: 'Your estimate is ready' };
const ROWS = [
  { ...base, ID: '1', Property_ID: '50', Property_Address: '9 Elm St', Gate_Snapshot: 'Property owner texts OFF' },
  { ...base, ID: '2', Property_ID: '51', Property_Address: '100 Market St', Gate_Snapshot: 'Customer OFF' },
  { ...base, ID: '3', Property_ID: '52', Property_Address: '1 Oak St', Gate_Snapshot: 'Global OFF' },
  { ...base, ID: '4', Property_ID: '', Property_Address: '', Gate_Snapshot: 'Property OFF' },
];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.route('https://maintenance-hub.brett-2f8.workers.dev/**', async route => {
  const url = route.request().url(); const j = d => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
  if (url.includes('/health')) return j({ ok: true, twilio: {} });
  if (url.includes('/version')) return j({ version: 'test' });
  if (url.includes('/message-queue')) return j(ROWS);
  return route.fulfill({ status: 404, body: '{}' });
});
await page.goto(fileUrl); await page.evaluate(() => localStorage.setItem('mh_auth', 'test-secret')); await page.reload();
await page.waitForSelector('.row-card', { timeout: 5000 });
const gates = await page.$$eval('.row-gate', els => els.map(e => ({ text: e.innerText.replace(/\s+/g, ' '), href: (e.querySelector('a') || {}).getAttribute ? (e.querySelector('a') || { getAttribute: () => null }).getAttribute('href') : null, h: e.querySelector('a') ? Math.round(e.querySelector('a').getBoundingClientRect().height) : 0 })));
ok(gates.length === 4, 'all four held rows show their reason');
const g1 = gates.find(g => /owner texts OFF/.test(g.text));
ok(g1 && g1.href === 'index.html?property=50&tab=settings', 'property switch: links to that property\'s Settings tab: ' + (g1 && g1.href));
ok(g1 && g1.h >= 44, 'the link is a 44px tap target');
const g2 = gates.find(g => /Customer OFF/.test(g.text));
ok(g2 && g2.href === null && /owner account has texts switched OFF/.test(g2.text), 'customer hold: explained, no property link (the switch is not on the property)');
const g3 = gates.find(g => /Global OFF/.test(g.text));
ok(g3 && g3.href === null && /Hub-wide/.test(g3.text), 'global hold: explained, no link');
const g4 = gates.find(g => /^Not sent — Property OFF/.test(g.text));
ok(g4 && g4.href === null, 'a row with no Property_ID gets no broken link');
ok(await page.locator('.row-actions .btn.go').count() === 4, 'the Send button is still on every pending row (Manual Send unchanged)');
ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
