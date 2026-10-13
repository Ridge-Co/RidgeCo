// Headless Playwright pass for Duplicate Work Order + bid groups (Oct 12 2026).
// Loads the REAL index.html, intercepts ONLY the Worker endpoints, drives the real Duplicate button, vendor
// picker, SMS-status panel, bid-group panel, unlink, and the cancel preview -> confirm flow at 412px and 1280px.
//   node test/manual-verify-wo-duplicate-ui.mjs [path-to-index.html] [shots-dir]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const targetHtml = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : join(here, '..', 'index.html');
const shots = process.argv[3] ? resolve(process.argv[3]) : join(process.env.TMPDIR || '/tmp', 'wo-dup-shots');
mkdirSync(shots, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const WO = { ID: 'WO-1238', Property_ID: 'P1', Unit_ID: '', Trade: 'Painting', Status: 'Assigned', Priority: 'normal', Type: 'manual',
  Description: 'Paint the common hallway', Notes: '', Vendor_ID: '2', Voided: 'FALSE' };
const VENDORS = [
  { ID: '2', Name: 'Alex Busey', Trade: 'Painting', Phone: '+15555550102', Language: 'en', Active: 'TRUE' },
  { ID: '3', Name: 'Cesar Diaz', Trade: 'Painting', Phone: '+15555550103', Language: 'es', Active: 'TRUE' },
  { ID: '9', Name: 'No Phone Pete', Trade: 'Painting', Phone: '', Language: 'en', Active: 'TRUE' },
];
const GROUP = (cancelled) => ({ group_id: 'BG-7', original_wo_id: 'WO-1238', members: [
  { id: 'WO-1238', is_original: true, status: 'Assigned', vendor_name: 'Alex Busey', voided: false, latest_estimate: { version: 2, subtotal: '1800.00', status: 'Pending' } },
  { id: 'WO-1250', is_original: false, status: cancelled ? 'Cancelled' : 'Assigned', vendor_name: 'Cesar Diaz', voided: false },
  { id: 'WO-1251', is_original: false, status: 'New', vendor_name: '', voided: false, is_winner: !!cancelled, tenant_visible: !!cancelled } ] });

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ name: 'phone-412', width: 412, height: 915 }, { name: 'desktop-1280', width: 1280, height: 900 }]) {
    console.log('\n=== ' + vp.name + ' ===');
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errs = [], dupPosts = [], cancelPosts = [], unlinkPosts = [];
    let smsMode = 'sent', cancelled = false, dupDelay = 600;
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const unmatched = [];
    await page.route((u) => u.protocol.startsWith('http'), (r) => { unmatched.push(r.request().method() + ' ' + new URL(r.request().url()).pathname); json(r, []); }); // catch-all FIRST: nothing reaches a real Worker
    await page.route('**/config', (r) => json(r, {}));
    await page.route('**/hub-bootstrap', (r) => json(r, { properties: [{ ID: 'P1', Address: '931 Saint Paul St', Active: 'TRUE' }], units: [], tenants: [], vendors: VENDORS, workorders: [WO], invoices: [], owners: [], keys: [] }));
    await page.route('**/pricing-config', (r) => json(r, { configured: false }));
    await page.route('**/notifications/pending', (r) => json(r, []));
    await page.route('**/wishlist', (r) => json(r, []));
    await page.route('**/wo/bid-group?*', (r) => json(r, GROUP(cancelled)));
    await page.route('**/wo/duplicate', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); dupPosts.push(b);
      await new Promise((res) => setTimeout(res, dupDelay));
      if (smsMode === 'refuse') return json(r, { ok: false, created: false, error: 'Source WO-1238 is Complete and cannot be duplicated', errors: [] }, 409);
      const base = { ok: true, created: true, source_wo_id: 'WO-1238', new_wo_id: 'WO-1250', bid_group_id: 'BG-7', vendor_id: b.vendor_id || '', vendor_name: b.vendor_id === '3' ? 'Cesar Diaz' : (b.vendor_id ? 'Alex Busey' : ''),
        copied: { attachments: 3, tenants: 1, checklist: true, checklist_items: 4 }, warnings: [], errors: [] };
      if (!b.vendor_id) return json(r, base);
      if (smsMode === 'sent') return json(r, { ...base, vendor_sms: { status: 'sent', reason: 'Text sent to Cesar Diaz (+1555…0103) in Spanish at 9:41 PM (quiet hours bypassed for this copy).', message_body: 'Nuevo trabajo WO-1250 en 931 Saint Paul St: Painting' } });
      if (smsMode === 'held') return json(r, { ...base, vendor_sms: { status: 'held', reason: 'Held: vendor SMS is switched off for this property.' } });
      return json(r, { ...base, errors: ['Vendor text FAILED: Twilio rejected the number'], vendor_sms: { status: 'failed', reason: 'Twilio rejected the number (21211)' } });
    });
    await page.route('**/wo/bid-group/unlink', (r) => { unlinkPosts.push(JSON.parse(r.request().postData() || '{}')); json(r, { ok: true, cleared: ['WO-1251'], warnings: [], errors: [] }); });
    await page.route('**/wo/bid-group/cancel', (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); cancelPosts.push(b);
      const rows = [
        { wo_id: 'WO-1238', is_original: true, status_before: 'Assigned', vendor_name: 'Alex Busey', result: 'kept', reasons: [] },
        { wo_id: 'WO-1250', is_original: false, status_before: 'Assigned', vendor_name: 'Cesar Diaz', result: b.confirm ? 'cancelled' : 'would_cancel', reasons: [] },
        { wo_id: 'WO-1251', is_original: false, status_before: 'New', vendor_name: '', result: 'would_skip', reasons: ['Has a vendor bill ($120.00)'] } ];
      // keep_one on a COPY: the original stays kept, the winner is reported (Oct 13 2026 follow-up)
      const winner = b.mode === 'keep_one' ? (b.keep_wo_id === 'WO-1238'
        ? { wo_id: 'WO-1238', is_original: true, will_become_tenant_visible: false, became_tenant_visible: false, already_visible: false }
        : { wo_id: b.keep_wo_id, is_original: false, will_become_tenant_visible: !b.confirm, became_tenant_visible: !!b.confirm, already_visible: false }) : null;
      json(r, { ok: true, group_id: 'BG-7', dry_run: !b.confirm, results: rows, winner, errors: [], warnings: [], summary: { would_cancel: 1, would_skip: 1, kept: 1, already_cancelled: 0, cancelled: b.confirm ? 1 : 0, skipped: 1, failed: 0 } });
    });

    await page.goto('file://' + targetHtml, { waitUntil: 'load' });
    await page.waitForSelector('#app', { state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    ok(errs.length === 0, 'no JS errors loading the Hub (' + errs.slice(0, 2).join(' | ') + ')');

    const noOverflow = async (sel, label) => {
      const o = await page.evaluate((s) => { const ov = document.querySelector(s), m = ov.querySelector('.modal'); const mr = m.getBoundingClientRect(); let spill = 0; m.querySelectorAll('button,input,select,div').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.right > mr.right + 1) spill = Math.max(spill, r.right - mr.right); }); return { ov: ov.scrollWidth - ov.clientWidth, spill, pg: document.documentElement.scrollWidth - window.innerWidth }; }, sel);
      ok(o.ov <= 0 && o.spill <= 0 && o.pg <= 0, label + ': no horizontal overflow (overlay +' + o.ov + ', spill +' + Math.round(o.spill) + ', page +' + o.pg + ')');
    };
    const smallTargets = async (sel, label) => {
      const bad = await page.evaluate((s) => [...document.querySelectorAll(s + ' button:not(.modal-close)')].filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 43.5).map((b) => (b.textContent || '').trim().slice(0, 30) + ':' + Math.round(b.getBoundingClientRect().height)), sel);
      ok(bad.length === 0, label + ': every button is >= 44px tall' + (bad.length ? ' (small: ' + bad.join(', ') + ')' : ''));
    };

    // ── WO detail: Duplicate button + Bid group panel ─────────────────────────────────────
    await page.evaluate(() => window.openWODetail('WO-1238'));
    await page.waitForSelector('#modal-wo-detail.open');
    await page.waitForSelector('[data-bg-member]', { timeout: 4000 }).catch(() => {});
    const dupBtn = page.locator('#modal-wo-detail button', { hasText: '⧉ Duplicate' });
    ok(await dupBtn.count() === 1, 'WO detail shows the Duplicate button on an open WO');
    const dbH = await dupBtn.evaluate((b) => b.getBoundingClientRect().height);
    ok(dbH >= 36, 'Duplicate button is as tall as its neighbours (' + Math.round(dbH) + 'px)');
    ok(await page.locator('[data-bg-member]').count() === 3, 'Bid group panel lists all 3 members');
    ok(await page.locator('text=/ORIGINAL/').count() >= 1 && await page.locator('text=/COPY/').count() >= 2, 'panel marks the ORIGINAL and the COPIES');
    ok(await page.locator('text=/Bid group BG-7/i').count() >= 1, 'panel names the group BG-7');
    await smallTargets('#bidgroup-WO-1238', 'Bid group panel');
    await page.locator('#bidgroup-WO-1238').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, vp.name + '-1-bidgroup-panel.png') });

    // ── Duplicate modal ────────────────────────────────────────────────────────────
    await dupBtn.click();
    await page.waitForSelector('#modal-dup-wo.open');
    ok((await page.textContent('#dup-title')).includes('WO-1238'), 'Duplicate modal title names the source WO');
    ok(await page.locator('#dup-vendor-select option').count() === 4, 'vendor picker lists the active vendors');
    await page.fill('#dup-vendor-search', 'cesar');
    ok(await page.locator('#dup-vendor-select option').count() === 2, 'vendor search filters the list');
    await page.selectOption('#dup-vendor-select', '3');
    const pv = await page.textContent('#dup-preview');
    ok(/Cesar Diaz/.test(pv) && /Spanish/.test(pv) && /even if it is after 7pm/.test(pv) && /no text/i.test(pv), 'preview says Cesar gets the text in Spanish, even after 7pm, and tenant/owner get none');
    await noOverflow('#modal-dup-wo', 'Duplicate modal');
    await smallTargets('#modal-dup-wo', 'Duplicate modal');
    await page.screenshot({ path: join(shots, vp.name + '-2-duplicate-picker.png') });
    // rapid double tap -> exactly ONE request; button latched
    await page.evaluate(() => { const b = document.getElementById('dup-submit-btn'); b.click(); b.click(); window.submitDuplicate(); });
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.getElementById('dup-submit-btn').disabled), 'submit button is disabled while the request is in flight');
    ok((await page.textContent('#dup-submit-btn')).includes('Creating'), 'submit button says Creating…');
    await page.waitForSelector('#dup-sms-status', { timeout: 5000 });
    ok(dupPosts.length === 1, 'triple tap sent exactly ONE /wo/duplicate request (' + dupPosts.length + ')');
    ok(dupPosts[0] && dupPosts[0].source_wo_id === 'WO-1238' && dupPosts[0].vendor_id === '3', 'request carried source WO-1238 and vendor 3');
    const st = await page.textContent('#dup-sms-status');
    ok(/SENT/.test(st) && /Cesar Diaz/.test(st), 'SMS status is shown prominently: ' + st.trim());
    ok(/WO-1250 created/.test(await page.textContent('#dup-result')) && /BG-7/.test(await page.textContent('#dup-result')), 'result shows the new WO number and group');
    ok(/Spanish/.test(await page.textContent('#dup-result')), 'result reason mentions Spanish');
    const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('dup-sms-status')).fontSize));
    ok(fs >= 15, 'SMS status text is large (' + fs + 'px)');
    ok(/Tenant and owner were\s+not\s+texted/.test((await page.textContent('#dup-result')).replace(/\s+/g, ' ')), 'result states tenant and owner were not texted');
    await noOverflow('#modal-dup-wo', 'Result panel');
    await smallTargets('#modal-dup-wo', 'Result panel');
    await page.screenshot({ path: join(shots, vp.name + '-3-duplicate-sent.png') });

    // held
    smsMode = 'held'; dupDelay = 50;
    await page.click('text=/again for another vendor/'); await page.selectOption('#dup-vendor-select', '3'); await page.click('#dup-submit-btn');
    await page.waitForSelector('#dup-sms-status');
    ok(/HELD/.test(await page.textContent('#dup-sms-status')) && /switched off/.test(await page.textContent('#dup-result')), 'held SMS is shown as HELD with the reason');
    await page.screenshot({ path: join(shots, vp.name + '-4-duplicate-held.png') });
    // failed
    smsMode = 'failed';
    await page.click('text=/again for another vendor/'); await page.selectOption('#dup-vendor-select', '2'); await page.click('#dup-submit-btn');
    await page.waitForSelector('#dup-sms-status');
    ok(/NOT SENT/.test(await page.textContent('#dup-sms-status')) && /Twilio rejected/.test(await page.textContent('#dup-result')) && /Problems/.test(await page.textContent('#dup-result')), 'failed SMS is shown as NOT SENT with the reason under Problems');
    await page.screenshot({ path: join(shots, vp.name + '-5-duplicate-failed.png') });
    // no vendor
    smsMode = 'sent';
    await page.click('text=/again for another vendor/');
    await page.click('#dup-novendor-btn');
    ok(await page.evaluate(() => document.getElementById('dup-vendor-select').disabled), 'no-vendor toggle disables the vendor picker');
    ok(/unassigned/.test(await page.textContent('#dup-preview')), 'preview says unassigned / nobody is texted');
    await page.click('#dup-submit-btn'); await page.waitForSelector('#dup-result', { state: 'visible' }); await page.waitForTimeout(200);
    ok(dupPosts[dupPosts.length - 1].vendor_id === '' && /nobody was texted/.test(await page.textContent('#dup-result')), 'copy without vendor sends no vendor_id and says nobody was texted');
    // nothing picked -> blocked client-side, no request
    await page.click('text=/again for another vendor/');
    const before = dupPosts.length;
    await page.click('#dup-submit-btn'); await page.waitForTimeout(150);
    ok(dupPosts.length === before, 'submitting with no vendor and no toggle sends nothing');
    // server refusal surfaces the reason
    smsMode = 'refuse';
    await page.selectOption('#dup-vendor-select', '3'); await page.click('#dup-submit-btn'); await page.waitForTimeout(400);
    const rt = await page.textContent('#dup-result');
    ok(/NO COPY WAS CREATED/.test(rt) && /cannot be duplicated/.test(rt), 'a refusal shows NO COPY WAS CREATED plus the server reason');
    await page.screenshot({ path: join(shots, vp.name + '-6-duplicate-refused.png') });
    await page.evaluate(() => { _dupBusy = false; closeModal('modal-dup-wo'); });

    // ── Unlink ───────────────────────────────────────────────────────────────────────
    await page.evaluate(() => window.openWODetail('WO-1238'));
    await page.waitForSelector('[data-bg-member]');
    page.once('dialog', (d) => d.accept());
    await page.click('[data-bg-unlink="WO-1251"]');
    await page.waitForTimeout(300);
    ok(unlinkPosts.length === 1 && unlinkPosts[0].wo_id === 'WO-1251', 'Unlink posts the chosen member');
    ok(/Unlinked: WO-1251/.test(await page.textContent('#bg-banner')), 'banner confirms the unlink');
    let dialogSeen = false; page.once('dialog', (d) => { dialogSeen = true; d.dismiss(); });
    await page.click('[data-bg-unlink="WO-1250"]'); await page.waitForTimeout(150);
    ok(dialogSeen && unlinkPosts.length === 1, 'dismissing the unlink confirm sends nothing');

    // ── Cancel: preview -> tick -> confirm ────────────────────────────────────────────────────
    await page.click('[data-bg-act="duplicates"]');
    await page.waitForSelector('#modal-bidcancel.open'); await page.waitForSelector('#bgc-confirm');
    ok(cancelPosts.length === 1 && cancelPosts[0].dry_run === true && !cancelPosts[0].confirm && cancelPosts[0].mode === 'duplicates', 'first request is a DRY RUN (no confirm)');
    const pt = await page.textContent('#bidcancel-body');
    ok(/WO-1238/.test(pt) && /WO-1250/.test(pt) && /WO-1251/.test(pt) && /Cesar Diaz/.test(pt) && /Alex Busey/.test(pt), 'preview lists each member with its vendor');
    ok(/WILL CANCEL/.test(pt) && /SKIPPED/.test(pt) && /KEPT/.test(pt) && /Has a vendor bill/.test(pt), 'preview shows will-cancel, skipped (with reason) and kept');
    ok(await page.evaluate(() => document.getElementById('bgc-confirm').disabled), 'Confirm is disabled until the box is ticked');
    await page.evaluate(() => document.getElementById('bgc-confirm').click());
    await page.waitForTimeout(150);
    ok(cancelPosts.length === 1, 'clicking the disabled confirm sends nothing');
    await noOverflow('#modal-bidcancel', 'Cancel preview');
    await smallTargets('#modal-bidcancel', 'Cancel preview');
    await page.screenshot({ path: join(shots, vp.name + '-7-cancel-preview.png') });
    await page.click('#bgc-ack');
    ok(await page.evaluate(() => !document.getElementById('bgc-confirm').disabled), 'ticking the box enables Confirm');
    await page.click('#bgc-confirm'); await page.waitForTimeout(400);
    ok(cancelPosts.length === 2 && cancelPosts[1].confirm === true && !cancelPosts[1].dry_run, 'second request carries confirm:true');
    ok(/Done — 1 cancelled/.test(await page.textContent('#bidcancel-body')) && /CANCELLED/.test(await page.textContent('#bidcancel-body')), 'result shows Done — 1 cancelled');
    await page.screenshot({ path: join(shots, vp.name + '-8-cancel-done.png') });
    cancelled = true;
    await page.click('#modal-bidcancel button:has-text("Close")'); await page.waitForSelector('[data-bg-member]'); await page.waitForTimeout(300);
    ok(await page.locator('[data-bg-keep="WO-1250"]').count() === 0, 'a cancelled member no longer offers "Keep this, cancel others"');

    // keep-one path
    await page.click('[data-bg-keep="WO-1238"]'); await page.waitForSelector('#bgc-confirm');
    const last = cancelPosts[cancelPosts.length - 1];
    ok(last.mode === 'keep_one' && last.keep_wo_id === 'WO-1238' && last.dry_run === true, '"Keep this, cancel others" previews with keep_wo_id');
    console.log('  (stubbed-by-catch-all, ignored: ' + [...new Set(unmatched)].join(', ') + ')');
    ok(errs.length === 0, 'no JS errors during the whole run (' + errs.slice(0, 2).join(' | ') + ')');
    await ctx.close();
  }
  await browser.close();
  console.log(`\nwo-duplicate UI: ${pass} passed, ${fail} failed  (screenshots: ${shots})`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
