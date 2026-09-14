// Headless verification (Sep 14 2026) for the new payment-schedule rendering on the
// customer-facing e-sign page — mirrors test/manual-verify-duplicate-checker.mjs's approach
// (mocked worker responses via page.route, real browser, real DOM). Money math on a page a
// customer actually signs is exactly the kind of thing that needs to be seen working, not just
// read.
import { chromium } from 'playwright';
import path from 'path';
import assert from 'node:assert';

const FILE = 'file://' + path.resolve('scope-proposal.html') + '?t=faketoken';

const UNSIGNED_PAYLOAD = {
  ok: true, address: '1305 N Calvert St', title: 'Flooring replacement', status: 'proposed',
  items: [
    { id: 'i1', area: 'Living room', trade: 'Flooring', description: 'Replace flooring',
      variants: [{ key: 'v1', label: '', price: 10000 }], selected_key: 'v1' },
  ],
  subtotal: 10000, deposit: 5000,
  schedule: [
    { label: 'Deposit', percent: 50, trigger: 'upfront' },
    { label: 'Progress', percent: 25, trigger: 'manual' },
    { label: 'Final', percent: 25, trigger: 'completion' },
  ],
  proposal_text: '', signed: null, photos: [],
};

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

await page.route('**/scope-proposal/view**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNSIGNED_PAYLOAD) }));
await page.goto(FILE);
await page.waitForSelector('#live-schedule .total-line', { timeout: 5000 });

// ---- Unsigned view: schedule renders with correct labels/percents/dollar amounts ----
const lines = await page.locator('#live-schedule .total-line').allTextContents();
ok(lines.length === 3, 'renders all 3 schedule milestones (' + lines.length + ' found)');
ok(lines[0].includes('Deposit') && lines[0].includes('50%') && lines[0].includes('$5000.00'), 'Deposit line shows 50% / $5,000 — got: ' + lines[0]);
ok(lines[1].includes('Progress') && lines[1].includes('25%') && lines[1].includes('$2500.00'), 'Progress line shows 25% / $2,500 — got: ' + lines[1]);
ok(lines[2].includes('Final') && lines[2].includes('25%') && lines[2].includes('$2500.00'), 'Final line shows 25% / $2,500 — got: ' + lines[2]);

const grandTotal = await page.locator('#live-total').textContent();
ok(grandTotal.trim() === '$10000.00', 'grand total shows $10,000 — got: ' + grandTotal);

// The hardcoded "50% deposit" language must be gone from what actually RENDERS — check #content
// specifically, not body.textContent() (which would also match the dead legacy-text-mode regex
// literal `/^Required 50% Deposit:/` sitting inert in the <script> source itself).
const contentText = await page.locator('#content').textContent();
ok(!/Required 50% deposit/i.test(contentText), 'old hardcoded "Required 50% deposit" text is gone from rendered output');
ok(/50%.*now.*remainder/i.test(contentText.replace(/\s+/g, ' ')) || /authorize Ridge Co to charge the payment schedule/i.test(contentText), 'agree-checkbox text references the real schedule, not a fixed 50%');

// ---- Multi-variant recalculation: picking a pricier option live-updates all 3 milestone $ amounts ----
const VARIANT_PAYLOAD = JSON.parse(JSON.stringify(UNSIGNED_PAYLOAD));
VARIANT_PAYLOAD.items[0].variants = [
  { key: 'repair', label: 'Repair', price: 4000 },
  { key: 'replace', label: 'Replace', price: 10000 },
];
VARIANT_PAYLOAD.items[0].selected_key = 'repair';
VARIANT_PAYLOAD.subtotal = 4000;

await page.route('**/scope-proposal/view**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VARIANT_PAYLOAD) }), { times: 1 });
await page.reload();
await page.waitForSelector('#live-schedule .total-line');
let repairLines = await page.locator('#live-schedule .total-line').allTextContents();
ok(repairLines[0].includes('$2000.00'), '4000-subtotal "Repair" selection: Deposit milestone recomputes to $2,000 (50%) — got: ' + repairLines[0]);

await page.locator('input[name="item-i1"][value="replace"]').check();
let replaceLines = await page.locator('#live-schedule .total-line').allTextContents();
ok(replaceLines[0].includes('$5000.00'), 'switching to "Replace" ($10,000) live-recalculates Deposit milestone to $5,000 — got: ' + replaceLines[0]);
ok(replaceLines[2].includes('$2500.00'), 'switching variants also recalculates the Final milestone (25% of 10000 = 2500) — got: ' + replaceLines[2]);

// ---- Signed view: renders the LOCKED milestone amounts from Payment_Milestones, not live math ----
const SIGNED_PAYLOAD = JSON.parse(JSON.stringify(UNSIGNED_PAYLOAD));
SIGNED_PAYLOAD.signed = {
  signer_name: 'Jamuna Yalamanchili', signed_date: '2026-09-14', subtotal: 10000, deposit: 5000,
  selections: { i1: 'v1' },
  schedule: [
    { label: 'Deposit', percent: 50, trigger: 'upfront', customer_amount: 5000, status: 'billed' },
    { label: 'Progress', percent: 25, trigger: 'manual', customer_amount: 2500, status: 'pending' },
    { label: 'Final', percent: 25, trigger: 'completion', customer_amount: 2500, status: 'pending' },
  ],
};
await page.route('**/scope-proposal/view**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIGNED_PAYLOAD) }));
await page.reload();
await page.waitForSelector('.signed-banner');
const signedLines = await page.locator('#live-schedule .total-line').allTextContents();
ok(signedLines.length === 3 && signedLines[0].includes('$5000.00'), 'signed view renders the locked schedule from the signature, 3 milestones with correct $');
ok(await page.locator('.signed-banner').textContent().then(t => /Jamuna Yalamanchili/.test(t)), 'signed banner shows the actual signer name');
ok(!(await page.locator('#submit-btn').count()), 'no sign/submit button shown once already signed');

await browser.close();
console.log(`\nscope-proposal.html headless verification: ${n} checks run.`);
if (n === 0) { console.error('NO CHECKS RAN — test is broken, not passing'); process.exit(1); }
