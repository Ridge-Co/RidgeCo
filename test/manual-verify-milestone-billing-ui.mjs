// Headless verification (Sep 14 2026) for the new milestone-billing UI in
// signed-proposals.html — checklist rendering, checkbox selection state, and the actual payload
// sent to /scope-proposal/bill-milestones on confirm. Same mocked-fetch-in-a-real-browser
// approach as test/manual-verify-duplicate-checker.mjs and manual-verify-payment-schedule.mjs.
import { chromium } from 'playwright';
import path from 'path';
import assert from 'node:assert';

const FILE = 'file://' + path.resolve('signed-proposals.html');

const SIGNED_ROW = {
  id: '42', scope_id: '99', wo_id: 'WO-1305', property: '1305 N Calvert St', title: 'Flooring replacement',
  signer: 'Jamuna Yalamanchili', signed_date: '2026-09-14', signed_ts: '2026-09-14T12:00:00Z',
  subtotal: 10000, deposit: 5000, vendor_cost_total: 6000, vendor_bill_amount: 3000, selections: {},
  status: 'Signed', qb_invoice_id: '', qb_invoice_number: '', qb_bill_id: '', qb_bill_number: '',
  qb_final_invoice_id: '', qb_final_invoice_number: '', qb_final_bill_id: '', qb_final_bill_number: '',
  bill_gap: '', bill_skip_reason: '',
  milestones: [
    { id: '1', label: 'Deposit', percent: 50, trigger: 'upfront', customer_amount: 5000, vendor_amount: 3000, status: 'billed', qb_invoice_id: '9001', qb_invoice_number: 'INV-9001', qb_bill_id: '8001', qb_bill_number: 'BILL-8001', billed_date: '2026-09-01' },
    { id: '2', label: 'Progress', percent: 25, trigger: 'manual', customer_amount: 2500, vendor_amount: 1500, status: 'pending' },
    { id: '3', label: 'Final', percent: 25, trigger: 'completion', customer_amount: 2500, vendor_amount: 1500, status: 'pending' },
  ],
};

const PREVIEW_RESPONSE = {
  ok: true, preview: {
    signature_id: '42', scope_id: '99', property: '1305 N Calvert St', signer: 'Jamuna Yalamanchili',
    milestones: [{ id: '2', label: 'Progress', percent: 25, customer_amount: 2500, vendor_amount: 1500 }],
    invoice: { customer: 'Jamuna Yalamanchili', level: 'owner', amount: 2500, item: 'Flooring', desc: 'Flooring — Flooring replacement — Progress (1305 N Calvert St)' },
    bill: { vendor: 'Cesar Gomez', amount: 1500, trade: 'Flooring' },
    warnings: [],
  },
};
const COMMIT_RESPONSE = { ok: true, invoice_id: '9002', invoice_number: 'INV-9002', bill_id: '8002', bill_number: 'BILL-8002', milestone_ids: ['2'], warnings: [] };

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); };
let lastBillMilestonesCall = null;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
page.on('dialog', d => d.accept()); // window.confirm() calls elsewhere in this file, if any fire

await page.route('**/proposal/signatures', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
await page.route('**/scope-proposal/signed', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([SIGNED_ROW]) }));
await page.route('**/scope-proposal/bill-milestones', async route => {
  const body = route.request().postDataJSON();
  lastBillMilestonesCall = body;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.preview_only ? PREVIEW_RESPONSE : COMMIT_RESPONSE) });
});

await page.goto(FILE);
await page.fill('#login-input', 'anything');
await page.click('#login button, button.btn.primary');
await page.waitForSelector('.card', { timeout: 5000 });

// ---- Milestone list renders correctly: labels, %, $, and per-row status ----
const rows = page.locator('.card').first();
const cardText = await rows.textContent();
ok(/Deposit/.test(cardText) && /Progress/.test(cardText) && /Final/.test(cardText), 'all 3 milestone labels render on the card');
ok(/billed/.test(cardText) && (cardText.match(/pending/g) || []).length === 2, 'Deposit shows billed, the other two show pending');
ok(/1\/3 billed/.test(cardText), 'header chip shows partial progress (1/3 billed)');

// The already-billed Deposit checkbox must be disabled — re-billing a milestone that's already
// invoiced would double-bill the customer and the vendor.
const checkboxes = page.locator('.card').first().locator('input[type=checkbox]');
ok(await checkboxes.count() === 3, 'one checkbox per milestone (3 total)');
ok(await checkboxes.nth(0).isDisabled(), 'the already-billed Deposit checkbox is disabled (cannot re-bill it)');
ok(!(await checkboxes.nth(1).isDisabled()), 'the pending Progress checkbox is enabled');

// ---- Bill button starts disabled, enables on selection, shows correct count ----
const billBtn = page.locator('#msbtn-42');
ok(await billBtn.isDisabled(), '"Bill selected" button starts disabled with nothing checked');
await checkboxes.nth(1).check(); // Progress
ok(!(await billBtn.isDisabled()), 'button enables once a pending milestone is checked');
ok((await billBtn.textContent()).includes('(1)'), 'button label shows the correct selected count (1)');

// ---- Preview shows the right computed lines, confirm sends the right payload ----
await billBtn.click();
await page.waitForSelector('#m-body .line', { timeout: 5000 });
const previewText = (await page.locator('#m-body').textContent()).replace(/,/g, '');
ok(/Progress/.test(previewText) && /2500/.test(previewText), 'preview modal shows the Progress milestone amount');
ok(/1500/.test(previewText), 'preview modal shows the vendor bill amount (1500), separate from the customer amount (2500) — markup stays visible as the gap between them');

await page.locator('#m-confirm').click();
await page.waitForFunction(() => document.getElementById('m-body') && /INV-9002/.test(document.getElementById('m-body').textContent), { timeout: 5000 });
ok(lastBillMilestonesCall && lastBillMilestonesCall.signature_id === '42' && JSON.stringify(lastBillMilestonesCall.milestone_ids) === '["2"]', 'confirm sent exactly signature_id=42, milestone_ids=["2"] — only the checked pending milestone, nothing else');
ok(!lastBillMilestonesCall.preview_only, 'the confirm call omits preview_only (a real commit, not another preview)');

await browser.close();
console.log(`\nsigned-proposals.html milestone-UI headless verification: ${n} checks run.`);
if (n === 0) { console.error('NO CHECKS RAN — test is broken, not passing'); process.exit(1); }
