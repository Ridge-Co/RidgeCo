// Headless Playwright pass for the WO checklist quick-entry + wide-description + overlay-drag-close fix
// (Oct 1 2026). Loads the REAL index.html, intercepts ONLY the Worker fetch endpoints, and drives the
// real shipped New WO / Edit WO / WO detail modals at 390px (phone) and 1280px (desktop).
//   node test/manual-verify-wo-checklist-entry-ui.mjs [path-to-index.html] [--bug-only]
// Passing a PRE-FIX index.html (e.g. from main) with --bug-only proves the overlay-drag assertion catches
// the bug (it must FAIL there); without --bug-only the width / quick-add assertions fail on pre-fix too.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const targetHtml = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : join(here, '..', 'index.html');

const BUG_ONLY = process.argv.includes('--bug-only');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const WO = {
  ID: 'WO-9001', Property_ID: 'P1', Unit_ID: '', Trade: 'Plumbing', Status: 'In Progress', Priority: 'normal', Type: 'manual',
  Description: 'Kitchen faucet drips and the shutoff valve under the sink is stuck. '.repeat(12), Notes: '', Vendor_ID: '',
  Checklist: JSON.stringify([
    { t: 'Replace faucet cartridge', done: true, code: '', why: '' },
    { t: 'Re-caulk around sink', done: false, code: 'parts', why: 'need silicone' },
    { t: 'Run water & check for leaks', done: false, code: '', why: '' },
  ]),
};

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ name: 'phone 390px', width: 390, height: 844 }, { name: 'desktop 1280px', width: 1280, height: 900 }]) {
    console.log('\n=== ' + vp.name + ' ===');
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const checklistPosts = [], adminPosts = [];
    await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/config', (r) => json(r, {}));
    await page.route('**/hub-bootstrap', (r) => json(r, {
      properties: [{ ID: 'P1', Address: '1 Test St', Active: 'TRUE' }], units: [], tenants: [], vendors: [],
      workorders: [WO], invoices: [], owners: [], keys: [],
    }));
    await page.route('**/pricing-config', (r) => json(r, { configured: false }));
    await page.route('**/notifications/pending', (r) => json(r, []));
    await page.route('**/wishlist', (r) => json(r, []));
    await page.route('**/wo/admin-update', (r) => { adminPosts.push(JSON.parse(r.request().postData() || '{}')); json(r, { success: true }); });
    await page.route('**/wo/checklist', (r) => { checklistPosts.push(JSON.parse(r.request().postData() || '{}')); json(r, { success: true }); });

    await page.goto('file://' + targetHtml, { waitUntil: 'load' });
    await page.waitForSelector('#app', { state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    ok(errs.length === 0, 'no JS errors loading the Hub (' + errs.slice(0, 2).join(' | ') + ')');

    const overflowCheck = (modalSel) => page.evaluate((sel) => {
      const m = document.querySelector(sel + ' > .modal'), ov = document.querySelector(sel);
      const mr = m.getBoundingClientRect();
      let widest = 0;
      m.querySelectorAll('input,textarea,select,button,.form-group').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.right > mr.right + 1) widest = Math.max(widest, r.right - mr.right); });
      return { ovOverflow: ov.scrollWidth - ov.clientWidth, spill: widest, modalRight: mr.right, vw: window.innerWidth, modalW: mr.width, modalLeft: mr.left };
    }, modalSel);
    const widthChecks = async (label, modalSel, descSel) => {
      const o = await overflowCheck(modalSel);
      const d = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().width, descSel);
      if (vp.width <= 600) ok(o.modalW >= vp.width - 24, label + ': modal spans the phone viewport (modal ' + Math.round(o.modalW) + 'px of ' + vp.width + 'px)');
      else ok(o.modalW >= 900 && o.modalW <= 1000, label + ': modal is wide on desktop (' + Math.round(o.modalW) + 'px, was 580-640)');
      ok(d >= 0.9 * o.modalW, label + ': description box is >= 90% of the modal (' + Math.round(d) + ' / ' + Math.round(o.modalW) + 'px)');
      ok(o.ovOverflow <= 0 && o.spill <= 0, label + ': no horizontal overflow (overlay +' + o.ovOverflow + ', spill +' + Math.round(o.spill) + ')');
    };

    const dragCheck = async () => {
      const dtb = await page.locator('#wo-desc').boundingBox();
      await page.mouse.move(dtb.x + 20, dtb.y + 20);
      await page.mouse.down();
      await page.mouse.move(dtb.x + 60, dtb.y + 40, { steps: 4 });
      await page.mouse.move(2, dtb.y + 40, { steps: 8 });   // out over the dark overlay
      await page.mouse.up();
      await page.waitForTimeout(100);
      ok(await page.evaluate(() => document.getElementById('modal-new-wo').classList.contains('open')), '[BUG] mousedown in the description + drag + mouseup on the overlay does NOT close New WO');
      ok((await page.inputValue('#wo-desc')) === 'Leaky faucet\nsecond line', '[BUG] typed description is still there after the drag-select');
      // a real click on the bare overlay still closes
      await page.mouse.click(2, dtb.y + 40);
      await page.waitForTimeout(100);
      ok(!(await page.evaluate(() => document.getElementById('modal-new-wo').classList.contains('open'))), 'a genuine click on the bare overlay still closes the modal');
    };
    if (BUG_ONLY) { // pre-fix proof mode: only the overlay-drag assertions (the rest needs the new UI)
      await page.evaluate(() => window.openNewWOModal());
      await page.fill('#wo-desc', 'Leaky faucet\nsecond line');
      await dragCheck();
      await page.close(); continue;
    }
    // ── New WO ─────────────────────────────────────────────
    await page.evaluate(() => window.openNewWOModal());
    await page.waitForSelector('#modal-new-wo.open');
    await widthChecks('New WO', '#modal-new-wo', '#wo-desc');
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('#modal-new-wo .form-grid')).gridTemplateColumns.split(' ').length);
    ok(vp.width <= 600 ? cols === 1 : cols === 2, 'New WO: form-grid has ' + cols + ' column(s) (' + (vp.width <= 600 ? '1 on phone' : '2 on desktop') + ')');
    const descH = await page.evaluate(() => document.getElementById('wo-desc').getBoundingClientRect().height);
    ok(descH >= 150, 'New WO: description box is tall enough (' + Math.round(descH) + 'px)');
    const order = await page.evaluate(() => {
      const kids = [...document.querySelectorAll('#modal-new-wo .form-grid > .form-group')];
      const di = kids.findIndex((k) => k.querySelector('#wo-desc')), ci = kids.findIndex((k) => k.querySelector('#wo-checklist'));
      return { di, ci };
    });
    ok(order.ci === order.di + 1 && order.di >= 0, 'New WO: checklist block sits directly below the description');

    // typing a description, then quick-add
    await page.fill('#wo-desc', 'Leaky faucet\nsecond line');
    const q = page.locator('#wo-checklist-quick');
    await q.click(); await page.keyboard.type('Replace cartridge'); await page.keyboard.press('Enter');
    await page.keyboard.type('Re-caulk sink'); await page.keyboard.press('Enter');
    let v = await page.inputValue('#wo-checklist');
    ok(v === 'Replace cartridge\nRe-caulk sink', 'New WO: Enter appends each typed item as a new line at the end (got ' + JSON.stringify(v) + ')');
    ok((await q.inputValue()) === '', 'New WO: quick-add input clears after Enter');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'wo-checklist-quick'), 'New WO: focus stays in quick-add so the next item can be typed straight away');
    await page.keyboard.type('Third by button'); await page.locator('#modal-new-wo .cl-quick button').click();
    v = await page.inputValue('#wo-checklist');
    ok(v.endsWith('\nThird by button') && v.split('\n').length === 3, 'New WO: the Add button appends too');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'wo-checklist-quick'), 'New WO: focus returns to quick-add after the Add button');
    // multi-line paste
    await page.evaluate(() => {
      const el = document.getElementById('wo-checklist-quick'); const dt = new DataTransfer();
      dt.setData('text', '- Patch drywall\r\n2) Prime & paint\r\n\r\n[ ] Final walkthrough\r\n');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    v = await page.inputValue('#wo-checklist');
    ok(v === 'Replace cartridge\nRe-caulk sink\nThird by button\nPatch drywall\nPrime & paint\nFinal walkthrough', 'New WO: multi-line paste APPENDS every line (markers stripped, blanks skipped, nothing replaced) (got ' + JSON.stringify(v) + ')');
    ok(/3 items added/.test((await page.locator('.toast').last().textContent().catch(() => '')) || ''), 'New WO: toast says "3 items added"');
    ok(/6 items/.test((await page.locator('#wo-checklist-count').textContent()) || ''), 'New WO: live count shows 6 items');
    ok((await page.inputValue('#wo-desc')) === 'Leaky faucet\nsecond line', 'New WO: description text untouched by checklist entry');

    await dragCheck();
    // reopen: previous checklist must not leak into the next new WO
    await page.evaluate(() => window.openNewWOModal());
    ok((await page.inputValue('#wo-checklist')) === '', 'New WO: reopening starts with an empty checklist (no leftovers from the last WO)');
    await page.evaluate(() => window.closeModal('modal-new-wo'));

    // ── Edit WO ────────────────────────────────────────────
    await page.evaluate(() => window.openEditWOModal('WO-9001'));
    await page.waitForSelector('#modal-edit-wo.open');
    await page.waitForTimeout(150);
    await widthChecks('Edit WO', '#modal-edit-wo', '#ewo-description');
    const eorder = await page.evaluate(() => {
      const kids = [...document.querySelectorAll('#modal-edit-wo .form-grid > .form-group')];
      return { di: kids.findIndex((k) => k.querySelector('#ewo-description')), ci: kids.findIndex((k) => k.querySelector('#ewo-checklist')) };
    });
    ok(eorder.ci === eorder.di + 1 && eorder.di >= 0, 'Edit WO: checklist block sits directly below the description');
    const grown = await page.evaluate(() => { const t = document.getElementById('ewo-description'); return t.getBoundingClientRect().height >= Math.min(t.scrollHeight, 10000) - 2; });
    ok(grown, 'Edit WO: description auto-grows to show all of its content');
    ok((await page.inputValue('#ewo-checklist')) === 'Replace faucet cartridge\nRe-caulk around sink\nRun water & check for leaks', 'Edit WO: existing checklist loads into the textarea');
    await page.locator('#ewo-checklist-quick').click();
    await page.keyboard.type('Touch up paint'); await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const el = document.getElementById('ewo-checklist-quick'); const dt = new DataTransfer();
      dt.setData('text', '* Haul away debris\n☐ Send photos');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    v = await page.inputValue('#ewo-checklist');
    ok(v.split('\n').length === 6 && v.startsWith('Replace faucet cartridge\nRe-caulk around sink\nRun water & check for leaks\nTouch up paint\nHaul away debris\nSend photos'), 'Edit WO: new items appended after the existing ones (got ' + JSON.stringify(v) + ')');
    await page.evaluate(() => window.submitEditWO());
    await page.waitForTimeout(400);
    ok(checklistPosts.length === 1, 'Edit WO: saved through POST /wo/checklist (' + checklistPosts.length + ' call)');
    const saved = checklistPosts.length ? JSON.parse(checklistPosts[0].checklist) : [];
    ok(saved.length === 6, 'Edit WO: 6 items saved');
    ok(saved[0] && saved[0].t === 'Replace faucet cartridge' && saved[0].done === true, "Edit WO: vendor's ticked item stays done after appending");
    ok(saved[1] && saved[1].code === 'parts' && saved[1].why === 'need silicone' && saved[1].done === false, "Edit WO: vendor's reason code + why survive after appending");
    ok(saved.slice(3).every((i) => i.done === false && i.code === '' && i.why === ''), 'Edit WO: new items start undone with no reason');

    // ── WO detail ──────────────────────────────────────────
    await page.evaluate(() => { window.closeModal('modal-edit-wo'); window.openWODetail('WO-9001'); });
    await page.waitForSelector('#modal-wo-detail.open');
    await page.waitForTimeout(150);
    await widthChecks('WO detail', '#modal-wo-detail', '#detail-body .wo-detail-desc');
    const mh = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#detail-body .wo-detail-desc')).maxHeight));
    ok(mh > 220, 'WO detail: description box max-height raised above the old 220px (' + Math.round(mh) + 'px)');
    await page.close();
  }
  await browser.close();
  console.log(`\nwo-checklist-entry UI: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
