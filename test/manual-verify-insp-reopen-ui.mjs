// Inspection Scheduler — Close / Reopen / Extend buttons + the confirm sheet (Oct 14 2026).
// Real headless Chromium against the shipped inspect.html at phone width; every Worker call is intercepted (no network, no real text/email).
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + path.join(__dirname, '..', 'inspect.html');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS — ' + m); };

const CUSTOMERS = [
  { ID: '1', Name: 'Brett Lambert', Line: 'rental', Contact_Name: 'BJ', Active: 'TRUE' },
  { ID: '2', Name: 'Premier Property Management', Line: 'rental', Contact_Name: 'Josiah Speed', Active: 'TRUE' },
];
const BLOCKS = [
  { ID: '4', Customer_ID: '', Date: '2099-10-15', Start_Time: '10:00', End_Time: '14:00', Note: '', Active: 'TRUE', Last_Start: '14:00', Closed_By: 'deadline', Is_Closed: true, Closes_Label: 'Tue, Oct 13, 5:00 PM', Reopen_Log: '' },
  { ID: '5', Customer_ID: '2', Date: '2099-10-16', Start_Time: '10:00', End_Time: '14:00', Note: '', Active: 'FALSE', Last_Start: '14:00', Closed_By: 'manual', Is_Closed: false, Closes_Label: 'Wed, Oct 14, 10:00 AM', Reopen_Log: '' },
  { ID: '6', Customer_ID: '2', Date: '2099-10-17', Start_Time: '10:00', End_Time: '14:00', Note: '', Active: 'TRUE', Last_Start: '', Closed_By: '', Is_Closed: false, Closes_Label: 'Wed, Oct 15, 10:00 AM', Reopen_Log: 'Wed, Oct 14, 1:40 PM: reopened until Wed, Oct 15, 7:00 AM; Premier: email ok' },
];
const OPTS = [
  { id: 'tomorrow', label: 'Until tomorrow 7:00 AM', closes_label: 'Thu, Oct 15, 7:00 AM' },
  { id: '3h', label: '3 hours from now', closes_label: 'Wed, Oct 14, 4:43 PM' },
  { id: '6h', label: '6 hours from now', closes_label: 'Wed, Oct 14, 7:43 PM' },
  { id: '12h', label: '12 hours from now', closes_label: 'Thu, Oct 15, 1:43 AM' },
  { id: '24h', label: '24 hours from now', closes_label: 'Thu, Oct 15, 1:43 PM' },
  { id: 'custom', label: 'Pick a date and time' },
];
const REC = [{ id: '1', name: 'Brett Lambert', contact: 'BJ', has_phone: true, has_email: true, selected: false }, { id: '2', name: 'Premier Property Management', contact: 'Josiah Speed', has_phone: true, has_email: true, selected: true }];

function preview(req, mode, extra) {
  const preset = req.preset, c = req.custom;
  let selected = null, sample = null;
  if (preset) {
    if (preset === 'custom' && !c) selected = { ok: false, error: 'bad_custom', message: 'Pick a valid date and time (Eastern).' };
    else {
      const label = preset === 'custom' ? 'Wed, Oct 14, 8:15 PM' : OPTS.find(o => o.id === preset).closes_label;
      selected = { ok: true };
      sample = { sms: 'Ridge Co: Brett ' + (mode === 'extend' ? 'extended booking for' : 'reopened inspection times for') + ' Thu, Oct 15, 10:00 AM–2:00 PM. Book by ' + label + ': [their booking link]', subject: (mode === 'extend' ? 'Inspection booking extended: ' : 'Inspection times reopened: ') + 'Thu, Oct 15', closes_label: label, capped: false, capped_to_label: '' };
    }
  }
  const b = BLOCKS.find(x => x.ID === req.id);
  return Object.assign({ ok: true, mode, block: { id: b.ID, date: b.Date, from: b.Start_Time, to: b.End_Time, last_start: b.Last_Start, customer_id: b.Customer_ID, note: '' }, closed_by: b.Closed_By, closes_label: b.Closes_Label, options: OPTS, selected, sample, recipients: REC, str_closed: false, notify_blocked: '', warnings: [] }, extra || {});
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
  const dialogs = []; page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const reopenCalls = []; let confirmReply = null, blockedMode = false;
  await page.route('https://maintenance-hub.brett-2f8.workers.dev/**', async route => {
    const url = route.request().url(), method = route.request().method();
    const fulfil = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.includes('/insp/open-block/reopen')) {
      const req = JSON.parse(route.request().postData() || '{}'); reopenCalls.push(req);
      const b = BLOCKS.find(x => x.ID === req.id); const mode = b.Closed_By ? 'reopen' : 'extend';
      if (req.preview) return fulfil(preview(req, mode, blockedMode ? { notify_blocked: 'No cleaner is scheduled for the cabin checkout that day, so that day stays closed to booking and nothing can be sent.', str_closed: true } : {}));
      return fulfil(confirmReply || { ok: true, mode, id: req.id, closes_label: 'Thu, Oct 15, 7:00 AM', capped: false, notify: ['Premier Property Management: email ok'], warnings: [] });
    }
    if (url.includes('/insp/open-blocks')) return fulfil(BLOCKS);
    if (url.includes('/insp/customers')) return fulfil(CUSTOMERS);
    if (url.includes('/health') || url.includes('/version')) return fulfil({ ok: true, version: 'test' });
    if (method === 'GET') return fulfil([]);
    return fulfil({ success: true });
  });

  await page.goto(fileUrl);
  await page.evaluate(() => localStorage.setItem('mh_auth', 'test-secret'));
  await page.reload();
  await page.waitForSelector('#app:not(.hide)', { timeout: 5000 });
  await page.click('button[data-tab="blocks"]');
  await page.waitForSelector('.ob-card', { timeout: 5000 });
  ok(await page.locator('.ob-card').count() === 3, 'all three blocks listed, including the manually closed one (so it can be reopened)');

  const row = id => page.locator('.ob-card', { hasText: BLOCKS.find(b => b.ID === id).Date });
  const states = async id => ({ close: await row(id).locator('button:has-text("Close")').isDisabled(), reopen: await row(id).locator('button:has-text("Reopen")').isDisabled(), extend: await row(id).locator('button:has-text("Extend open")').isDisabled() });
  let s = await states('6'); ok(s.close === false && s.reopen === true && s.extend === false, 'open block: Close + Extend usable, Reopen greyed out');
  s = await states('4'); ok(s.close === true && s.reopen === false && s.extend === true, 'block closed by its deadline: Close greyed out, Reopen usable');
  s = await states('5'); ok(s.close === true && s.reopen === false && s.extend === true, 'block closed by hand: Close greyed out, Reopen usable');
  const order = await row('4').locator('.ob-actions button').allTextContents();
  ok(order.join('|') === 'Close|Reopen|Extend open', 'Reopen sits right next to Close, then Extend open');
  ok(/Closed by you/.test(await row('5').innerText()) && /Booking closed/.test(await row('4').innerText()), 'each closed block says WHY it is closed');
  ok(/Last change:.*email ok/.test(await row('6').innerText()), 'the last reopen/extend result is shown on the block');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling on the list at 412px');

  // ── reopen block 4 ──
  await row('4').locator('button:has-text("Reopen")').click();
  await page.waitForSelector('#orm-body:not(.hide)');
  ok((await page.locator('#orm-title').innerText()) === 'Reopen this block', 'sheet is titled Reopen');
  ok(await page.locator('#orm-email').isChecked() && !(await page.locator('#orm-sms').isChecked()), 'reopen: email ticked, text NOT ticked by default');
  ok(await page.locator('#orm-r-2').isChecked() && !(await page.locator('#orm-r-1').isChecked()), 'Premier (booked that day) is pre-ticked; the other partner is not');
  const optText = await page.locator('#orm-opts').innerText();
  ok(['Until tomorrow 7:00 AM', '3 hours from now', '6 hours from now', '12 hours from now', '24 hours from now', 'Pick a date and time'].every(l => optText.includes(l)), 'all six time choices are offered');
  ok(/Closes Thu, Oct 15, 7:00 AM/.test(optText), 'each choice shows the real close time');
  ok(await page.locator('input[name="orm-preset"]').first().isChecked(), '"Until tomorrow 7:00 AM" is the default choice');
  const will = await page.locator('#orm-will').innerText();
  ok(/reopen this block/.test(will) && /Thu, Oct 15, 7:00 AM/.test(will) && /an email/.test(will) && /Premier Property Management/.test(will) && /Nothing is sent until you tap/.test(will), 'plain-words summary of what Confirm will do, before anything is sent');
  ok(/Brett reopened inspection times/.test(await page.locator('#orm-msg').innerText()), 'the message he is about to send is shown');
  ok(await page.locator('#orm-go').isEnabled() && (await page.locator('#orm-go').innerText()) === 'Confirm reopen', 'Confirm reopen is enabled');
  ok(await page.evaluate(() => { const r = document.querySelector('#ob-reopen-modal .sheet').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; }), 'sheet fits at 412px');
  await page.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'insp-reopen-sheet.png') });

  // custom time with nothing chosen yet
  await page.locator('input[name="orm-preset"]').last().check();
  ok(await page.locator('#orm-custom-wrap').isVisible() && await page.locator('#orm-go').isDisabled(), 'Pick a date and time: shows the picker and keeps Confirm off until a time is chosen');
  await page.fill('#orm-custom', '2099-10-14T20:15');
  await page.waitForFunction(() => !document.getElementById('orm-go').disabled);
  ok(reopenCalls[reopenCalls.length - 1].custom === '2099-10-14T20:15' && reopenCalls[reopenCalls.length - 1].preset === 'custom', 'the custom time is sent to be checked');
  ok(/Wed, Oct 14, 8:15 PM/.test(await page.locator('#orm-will').innerText()), 'summary now shows the chosen time');

  // no one ticked while email is on -> blocked, with a visible reason
  await page.locator('#orm-r-2').uncheck();
  ok(await page.locator('#orm-go').isDisabled() && /Tick who to tell/.test(await page.locator('#orm-will').innerText()), 'email ticked but nobody picked: Confirm is off and it says why');
  await page.locator('#orm-r-2').check();

  // choose a preset again and confirm
  await page.locator('input[name="orm-preset"]').first().check();
  await page.waitForFunction(() => /Until tomorrow|7:00 AM/.test(document.getElementById('orm-will').innerText));
  const callsBefore = reopenCalls.length;
  await page.click('#orm-go');
  await page.waitForFunction(() => !document.getElementById('ob-reopen-modal').classList.contains('open'));
  const conf = reopenCalls[callsBefore];
  ok(conf && !conf.preview && conf.id === '4' && conf.preset === 'tomorrow' && conf.notify.email === true && conf.notify.sms === false && conf.recipients.join() === '2', 'Confirm sends the block, the choice, email-only and Premier alone');
  ok(/Reopened until Thu, Oct 15, 7:00 AM — partner notified/.test(await page.locator('#toast').innerText()), 'success toast says what happened');
  ok(dialogs.length === 0, 'no warning dialogs when everything worked');

  // ── failed text is loud ──
  confirmReply = { ok: true, mode: 'reopen', id: '4', closes_label: 'Thu, Oct 15, 7:00 AM', capped: false, notify: ['Premier Property Management: text NOT SENT — skipped (TWILIO_ENABLED not TRUE)', 'Premier Property Management: email ok'], warnings: ['The block was saved, but the telemetry row could not be written: x'] };
  await row('4').locator('button:has-text("Reopen")').click();
  await page.waitForSelector('#orm-body:not(.hide)');
  await page.locator('#orm-sms').check();
  await page.click('#orm-go');
  await page.waitForFunction(() => !document.getElementById('ob-reopen-modal').classList.contains('open'));
  await page.waitForTimeout(100);
  ok(dialogs.length === 1 && /not everyone was told/.test(dialogs[0]) && /NOT SENT — skipped \(TWILIO_ENABLED not TRUE\)/.test(dialogs[0]) && /telemetry row/.test(dialogs[0]), 'a text that could not go out is shown in a dialog with the reason (not just a toast), plus any warnings');
  confirmReply = null;

  // ── extend an open block ──
  await row('6').locator('button:has-text("Extend open")').click();
  await page.waitForSelector('#orm-body:not(.hide)');
  ok((await page.locator('#orm-title').innerText()) === 'Extend this block' && (await page.locator('#orm-go').innerText()) === 'Confirm extend', 'sheet is titled Extend');
  ok(!(await page.locator('#orm-email').isChecked()) && !(await page.locator('#orm-sms').isChecked()), 'extend: neither email nor text ticked by default');
  ok(/Nobody will be told/.test(await page.locator('#orm-will').innerText()), 'summary says nobody will be told');
  await page.locator('#orm-email').check();
  ok(/an email/.test(await page.locator('#orm-will').innerText()) && /extend this block/.test(await page.locator('#orm-will').innerText()), 'ticking email updates the summary');
  await page.click('button:has-text("Cancel")');
  ok(!(await page.locator('#ob-reopen-modal').evaluate(e => e.classList.contains('open'))), 'Cancel closes the sheet without saving');
  ok(reopenCalls.filter(c => !c.preview).length === 2, 'only the two real confirms ever wrote anything');

  // ── cleaning guard blocks notifying ──
  blockedMode = true;
  await row('5').locator('button:has-text("Reopen")').click();
  await page.waitForSelector('#orm-body:not(.hide)');
  ok(await page.locator('#orm-blocked').isVisible() && /No cleaner/.test(await page.locator('#orm-blocked').innerText()), 'when the cleaning guard blocks the day, the reason is shown');
  ok(!(await page.locator('#orm-notify').isVisible()) && await page.locator('#orm-go').isEnabled() && /Nobody will be told/.test(await page.locator('#orm-will').innerText()), 'email/text options are hidden but you can still reopen without telling anyone');
  await page.click('button:has-text("Cancel")');
  blockedMode = false;

  // ── Close still works from the open block, with the reopen hint ──
  await row('6').locator('button:has-text("Close")').click();
  ok(dialogs.some(d => /You can reopen it later/.test(d)), 'Close confirmation mentions you can reopen later');

  await browser.close();
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
