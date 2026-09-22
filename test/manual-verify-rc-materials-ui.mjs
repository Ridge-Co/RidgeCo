// Headless UI verification (Sep 22 2026) — Ridge Co materials + Gmail reconnect.
// Real Chromium, real pages, mocked Worker responses (page.route) — same approach as
// manual-verify-payment-schedule.mjs. Covers: scope-creator.html materials inputs / save payload /
// pricing-mode choice / materials-only item unlocking the proposal step / Reconnect Gmail;
// scope-proposal.html's customer materials line; signed-proposals.html's budget-vs-actual block.
// Run: node test/manual-verify-rc-materials-ui.mjs  (playwright must resolve — e.g. ln -s "$(npm root -g)/playwright" node_modules/playwright)
import { chromium } from 'playwright';
import path from 'path';
import assert from 'node:assert';

let n = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); assert.ok(c, m); n++; };
const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const browser = await chromium.launch();
const errors = [];

// ════════════════════ scope-creator.html ════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // S23-ish phone width
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('scope-creator: ' + e.message));
  page.on('dialog', d => d.accept());
  await ctx.addInitScript(() => localStorage.setItem('mh_auth', 'TEST'));
  const scope = {
    ID: '5', Title: 'Bath refresh', Status: 'estimated', Property_ID: '1', WO_ID: 'WO-9', Proposal_Text: '',
    line_items: [
      { id: 'li1', area: 'Bath', trade: 'Plumbing', description: 'Install vanity', qty: '', note: '', selected_key: 'v1',
        variants: [{ key: 'v1', label: '', vendor_cost: 400, price_override: null }] },
      { id: 'li2', area: 'Bath', trade: '', description: 'Supply vanity', qty: '', note: '', selected_key: 'v1',
        variants: [{ key: 'v1', label: '', vendor_cost: 0, price_override: null }] },
    ],
  };
  const posts = [];
  let sendMode = 'gmail_dead';
  await page.route(W + '/**', async route => {
    const u = new URL(route.request().url()); const p = u.pathname;
    const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
    if (body) posts.push({ p, body });
    const J = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/properties') return J([{ ID: '1', Address: '1 Main St', Owner_ID: '9' }]);
    if (p === '/owners') return J([{ ID: '9', First_Name: 'Ann', Last_Name: 'Owner', Email: 'ann@example.com' }]);
    if (p === '/units' || p === '/vendors' || p === '/attachments' || p === '/scope-proposal/signed') return J([]);
    if (p === '/config') return J({});
    if (p === '/scopes') return J([{ id: '5', title: 'Bath refresh', status: 'estimated', property_id: '1', item_count: 2 }]);
    if (p === '/scope') return J(scope);
    if (p === '/scope/update') { if (body.line_items) scope.line_items = body.line_items; return J({ success: true }); } // persist like the real Worker
    if (p === '/scope/proposal') return J({ success: true, proposal_text: 'Scope text', final_price: 1234, deposit: 617, schedule: [{ label: 'Deposit', customer_amount: 411.33 }], schedule_warnings: [],
      materials: { mode: 'flat_pct', pct: 20, cost_total: 300, price_total: 370.8, vendor_cost_total: 400 } });
    if (p === '/scope/proposal/send') {
      if (sendMode === 'gmail_dead') return J({ error: 'Send failed: Gmail sign-in for the Ridge Co sender has expired or was revoked — tap "Reconnect Gmail" (Scope Creator, next to Send) to sign it back in. (Gmail token refresh failed: {"error":"invalid_grant"})' }, 500);
      return J({ success: true, sent_to: 'ann@example.com', sent_at: new Date().toISOString(), url: 'https://x/scope-proposal.html?t=1' });
    }
    if (p === '/gmail/connect-url') return J({ success: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?fake=1', sender: 'ridgecomaintenance@gmail.com' });
    return J({});
  });
  await ctx.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }));
  await page.goto('file://' + path.resolve('scope-creator.html'));
  await page.waitForFunction(() => /connected/.test(document.getElementById('conn-status').textContent));
  await page.evaluate(() => openScope('5'));
  await page.waitForSelector('#items-wrap .li');

  ok(await page.locator('#items-wrap .vrow .v-mat-cost').count() === 2, 'every option has a "Ridge Co materials $" input');
  ok(await page.locator('#items-wrap .vrow .v-mat-desc').count() === 2, 'every option has a materials description input');
  ok(await page.evaluate(() => document.getElementById('sec-proposal').classList.contains('disabled')), 'before materials: the $0 "Supply vanity" item keeps the proposal step locked (unchanged gate)');

  // materials-only item: fill materials, vendor cost stays blank → gate unlocks after save
  const li2 = page.locator('#items-wrap .li[data-id="li2"]');
  await li2.locator('.v-mat-cost').fill('300');
  await li2.locator('.v-mat-desc').fill('36" vanity + faucet');
  await page.getByRole('button', { name: /Save edits/ }).click();
  await page.waitForFunction(() => /saved/.test(document.getElementById('items-status').textContent));
  const saved = posts.filter(x => x.p === '/scope/update').pop().body;
  const sv = saved.line_items.find(i => i.id === 'li2').variants[0];
  ok(sv.rc_materials_cost === 300 && sv.rc_materials_desc === '36" vanity + faucet' && sv.vendor_cost === 0, 'Save sends rc_materials_cost/desc with vendor_cost 0 (no fake $1)');
  ok(!('rc_materials_cost' in saved.line_items.find(i => i.id === 'li1').variants[0]), 'an option with no materials sends no materials fields');
  ok(!(await page.evaluate(() => document.getElementById('sec-proposal').classList.contains('disabled'))), 'materials-only item now counts as priced — proposal step unlocks');

  // add an alternate option: new row has materials inputs, remove button stays before them
  await page.locator('#items-wrap .li[data-id="li1"] button', { hasText: 'alternate option' }).click();
  const rows = page.locator('#items-wrap .li[data-id="li1"] .vrow');
  ok(await rows.count() === 2, 'alternate option added');
  ok(await rows.nth(1).locator('.v-mat-cost').count() === 1, 'new option row has its own materials inputs');
  const order0 = await rows.nth(0).evaluate(el => Array.from(el.children).map(c => c.className));
  ok(order0.indexOf('vmat') === order0.length - 1 && order0.some(c => /danger/.test(c)), 'first row gets a remove button placed before its materials line (materials stay on their own line)');
  await rows.nth(1).locator('button.danger').click();
  ok(await rows.count() === 1 && await rows.nth(0).locator('.v-mat-cost').count() === 1, 'removing back to one option keeps the materials inputs intact');

  // phone width: the materials line doesn't overflow the card
  const overflow = await page.evaluate(() => { const r = document.querySelector('.vmat').getBoundingClientRect(); const c = document.querySelector('.variants').getBoundingClientRect(); return r.right - c.right; });
  ok(overflow <= 1, 'at 390px width the materials inputs fit inside the pricing box (overflow ' + overflow.toFixed(1) + 'px)');
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(hscroll <= 0, 'no horizontal page scroll at phone width');

  // pricing mode: default markup checked; flat % without a % blocks generate
  ok(await page.locator('input[name="mat-mode"][value="markup"]').isChecked(), 'materials pricing defaults to "same markup"');
  await page.locator('input[name="mat-mode"][value="flat_pct"]').check();
  const before = posts.length;
  await page.getByRole('button', { name: /Generate proposal/ }).click();
  ok(/flat materials markup %/i.test(await page.locator('#prop-status').textContent()) && posts.length === before, 'flat % with no % entered → clear error, nothing sent');
  await page.locator('#mat-pct').fill('20');
  await page.getByRole('button', { name: /Generate proposal/ }).click();
  await page.waitForFunction(() => /proposal ready/.test(document.getElementById('prop-status').textContent));
  const genSave = posts.filter(x => x.p === '/scope/update').pop().body;
  ok(JSON.stringify(genSave.materials_pricing) === JSON.stringify({ mode: 'flat_pct', pct: 20 }), 'Generate saves the chosen materials pricing {flat_pct, 20} with the items');
  const propMsg = await page.locator('#prop-status').textContent();
  ok(/your cost \$300\.00 → owner pays \$370\.80/.test(propMsg) && /vendor bill basis \$400\.00/.test(propMsg), 'status shows Brett his materials cost → owner price and the vendor-bill basis: ' + propMsg);

  // reopen: saved mode is restored
  scope.Materials_Pricing_JSON = JSON.stringify({ mode: 'at_cost' });
  await page.evaluate(() => openScope('5'));
  await page.waitForSelector('#items-wrap .li');
  ok(await page.locator('input[name="mat-mode"][value="at_cost"]').isChecked(), 'reopening a scope restores its saved materials pricing choice');

  // Gmail reconnect
  scope.Proposal_Text = 'Scope text';
  await page.evaluate(() => openScope('5'));
  await page.waitForSelector('#proposal-out:not(.hide)');
  ok(await page.locator('#gmail-reconnect-btn').isHidden(), 'Reconnect Gmail is hidden until a send actually fails on Gmail sign-in');
  await page.getByRole('button', { name: /Send estimate to owner/ }).click();
  await page.waitForFunction(() => /Send failed/.test(document.getElementById('send-status').textContent));
  ok(await page.locator('#gmail-reconnect-btn').isVisible(), 'a dead-Gmail send failure shows the Reconnect Gmail button');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.locator('#gmail-reconnect-btn').click()]);
  await popup.waitForURL(/accounts\.google\.com/);
  ok(posts.some(x => x.p === '/gmail/connect-url'), 'Reconnect asks the Worker for the signed sign-in URL');
  ok(/accounts\.google\.com/.test(popup.url()), 'Google sign-in opens in a new tab: ' + popup.url());
  await popup.close();
  sendMode = 'ok';
  await page.getByRole('button', { name: /Send estimate to owner/ }).click();
  await page.waitForFunction(() => /sent to/.test(document.getElementById('send-status').textContent));
  ok(await page.locator('#gmail-reconnect-btn').isHidden(), 'after a successful send the Reconnect button hides again');
  await ctx.close();
}

// ════════════════════ scope-proposal.html (customer) ════════════════════
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push('scope-proposal: ' + e.message));
  const payload = {
    ok: true, address: '1 Main St', title: 'Bath', status: 'proposed', subtotal: 1325, deposit: 662.5,
    items: [
      { id: 'i1', area: 'Bath', description: 'Install and supply vanity', selected_key: 'v1', variants: [{ key: 'v1', label: '', price: 1025, materials_price: 370.8, materials_desc: '36" vanity + faucet' }] },
      { id: 'i2', area: 'Bath', description: 'Floor', selected_key: 'a', variants: [
        { key: 'a', label: 'Patch', price: 300 },
        { key: 'b', label: 'Replace', price: 1000, materials_price: 450, materials_desc: 'LVP flooring' } ] },
    ],
    schedule: [{ label: 'Deposit', percent: 33.34, trigger: 'upfront' }, { label: 'Final', percent: 66.66, trigger: 'completion' }],
    proposal_text: '', signed: null, photos: [],
  };
  await page.route('**/scope-proposal/view**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.goto('file://' + path.resolve('scope-proposal.html') + '?t=x');
  await page.waitForSelector('.item');
  const t = (await page.locator('#content').textContent()).replace(/\s+/g, ' ');
  ok(/Includes materials: 36" vanity \+ faucet \(\$370\.80\)/.test(t), 'single-option item shows its own "Includes materials" line with description + price (inline, not a second price)');
  ok(/Includes materials: LVP flooring — \$450\.00/.test(t), 'the Replace option shows its materials line under that option');
  ok(!/markup|cost|Ridge Co materials \$/i.test(t.replace(/Total Estimated Cost/gi, '')), 'no markup/cost wording anywhere on the customer page');
  ok((await page.locator('#live-total').textContent()).trim() === '$1325.00', 'total = option prices (materials inside, not added twice): 1025 + 300');
  await page.locator('input[name="item-i2"][value="b"]').check();
  ok((await page.locator('#live-total').textContent()).trim() === '$2025.00', 'switching to the option with materials recalculates the total correctly');
  await page.close();
}

// ════════════════════ signed-proposals.html (Brett) ════════════════════
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push('signed-proposals: ' + e.message));
  await page.addInitScript(() => localStorage.setItem('mh_auth', 'TEST'));
  const ms = [{ id: 'm1', label: 'Deposit', percent: 40, trigger: 'upfront', customer_amount: 400, status: 'pending' }, { id: 'm2', label: 'Final', percent: 60, trigger: 'completion', customer_amount: 600, status: 'pending' }];
  const row = (id, materials) => ({ id, scope_id: id, wo_id: 'WO-' + id, property: id + ' Main St', title: 'Job ' + id, signer: 'Signer ' + id, signed_date: '2026-09-22', signed_ts: '2026-09-22T1' + id, subtotal: 1000, deposit: 500, vendor_cost_total: 500, vendor_bill_amount: 250, selections: {}, status: 'Signed', milestones: ms, materials });
  const rows = [
    row('1', { budget_cost: 300, budget_price: 370.8, actual: 250.5, receipt_count: 2, variance: 49.5, state: 'within' }),
    row('2', { budget_cost: 200, budget_price: 240, actual: 260, receipt_count: 3, variance: -60, state: 'over' }),
    row('3', { budget_cost: 0, budget_price: 0, actual: 0, receipt_count: 0, variance: 0, state: 'unknown' }),
    row('4', { budget_cost: 0, budget_price: 0, actual: 0, receipt_count: 0, variance: 0, state: 'none' }),
    row('5', { budget_cost: 150, budget_price: 180, actual: null, receipt_count: null, variance: null, state: 'unknown' }),
  ];
  await page.route(W + '/**', r => {
    const p = new URL(r.request().url()).pathname;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === '/scope-proposal/signed' ? rows : []) });
  });
  await page.goto('file://' + path.resolve('signed-proposals.html'));
  await page.evaluate(() => { document.getElementById('login-input').value = 'TEST'; doLogin(); });
  await page.waitForSelector('.card');
  const cards = await page.locator('.card').allTextContents();
  const card = id => cards.find(c => c.includes('Signer ' + id)).replace(/\s+/g, ' ');
  ok(/Budget \$300 \(owner pays \$370\.8, in the milestones\) · Receipts \$250\.5 \(2\)/.test(card('1')) && /\$49\.5 left/.test(card('1')), 'within budget: budget, owner price, receipts and remaining shown');
  ok(/over by \$60/.test(card('2')), 'over budget flagged with the overage');
  ok(/over by \$60/.test(card('2')) && /not billed to the owner/.test(card('2')) && /manually in QuickBooks/.test(card('2')), 'overage explains it is not billed and how to bill it');
  ok(/won't invoice them again/.test(card('1')), 'explains Review Bills won\'t double-bill these receipts');
  ok(!/Ridge Co materials/.test(card('3')), 'no budget + failed receipt read → nothing shown (not a scary $0)');
  ok(!/Ridge Co materials/.test(card('4')), 'a proposal with no materials shows nothing extra');
  ok(/couldn't load receipts/.test(card('5')), 'a failed receipts read says so instead of showing $0');
  await page.close();
}

ok(errors.length === 0, 'zero page errors across all three pages' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`manual-verify-rc-materials-ui: ${n} checks passed`);
