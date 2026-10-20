// Pending cleaning (Oct 20 2026) — browser verification at 412px, mocked API (no staging/prod calls).
// Needs Playwright (+ Chromium). Run from the repo root:  node test/manual-verify-str-pending-ui.mjs
// Serves the repo root on a random local port, stubs every maintenance-hub Worker call, and checks:
//  str-cleaning.html: Pending (not booked) list with the four at-a-glance statuses, Ask-about-a-date preview/edit/send (incl. "send now even if late",
//    stale preview, failure + not-sure paths), Cancel with and without the opt-in text, Mark as booked now, Ask now; no horizontal scroll; tap targets >= 44px.
//  cleaner.html: NOT BOOKED YET - tentative card (Yes, I'd be available / No), held card + release, availability marks on pending dates, filled -> backup pair,
//    failure shown and buttons re-enabled; never the words "primary"/"rank"/"deadline"/"reply by" on a pending card; no horizontal scroll.
import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true };
const browser = await chromium.launch();
async function mk(opts, handler, init) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errs = []; page.on('pageerror', e => errs.push(e.message)); page._errs = errs; page._calls = [];
  if (init) await page.addInitScript(init);
  await page.route(W + '/**', async route => {
    const u = new URL(route.request().url()); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    let body = null; try { body = route.request().postDataJSON(); } catch (e) {}
    page._calls.push({ m: route.request().method(), p: u.pathname, body });
    const r = await handler(u.pathname, body, route); if (r === undefined) return;
    await route.fulfill({ status: r.status || 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
  });
  return page;
}
const noScroll = async p => assert(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'horizontal scroll at 412px');
const callsTo = (p, path_) => p._calls.filter(c => c.p === path_ && c.m === 'POST');

// ───────────────────────── admin ─────────────────────────
const pendings = () => [
  { key: 'milam-ridge|pending|2026-11-07', date: '2026-11-07', label: 'Sat, Nov 7', days_out: 18, note: 'TEST- family of 6', status: 'pending_held', code: 'held', status_label: 'Held by Gina - tentative', active: true, held_by_id: '1', held_by: 'Gina', next_up: '', waiting_for_window: false,
    asked: [{ id: '11', cleaner: 'Gina', status: 'accepted' }], backups: { can: [{ name: 'Kayla' }], out: [], unknown: [{ name: 'Rachel' }] }, converted_to: '', text_state: '', mail_state: '', cal_state: '', can_convert: true, can_cancel: true, can_send_now: false },
  { key: 'milam-ridge|pending|2026-11-14', date: '2026-11-14', label: 'Sat, Nov 14', days_out: 25, note: '', status: 'offering', code: 'waiting', status_label: 'Waiting on Kayla', active: true, held_by_id: '', held_by: '', next_up: '', waiting_for_window: false,
    asked: [{ id: '12', cleaner: 'Gina', status: 'declined' }, { id: '13', cleaner: 'Kayla', status: 'pending' }], backups: { can: [], out: [{ name: 'Gina' }], unknown: [] }, converted_to: '', text_state: '', mail_state: '', cal_state: '', can_convert: true, can_cancel: true, can_send_now: true },
  { key: 'milam-ridge|pending|2026-11-21', date: '2026-11-21', label: 'Sat, Nov 21', days_out: 32, note: '', status: 'exhausted', code: 'nobody', status_label: 'Nobody available', active: true, held_by_id: '', held_by: '', next_up: '', waiting_for_window: false,
    asked: [{ id: '14', cleaner: 'Gina', status: 'declined' }, { id: '15', cleaner: 'Kayla', status: 'declined' }, { id: '16', cleaner: 'Rachel', status: 'expired' }], backups: { can: [], out: [], unknown: [] }, converted_to: '', text_state: '', mail_state: '', cal_state: '', can_convert: true, can_cancel: true, can_send_now: true },
  { key: 'milam-ridge|pending|2026-10-31', date: '2026-10-31', label: 'Sat, Oct 31', days_out: 11, note: '', status: 'pending_converted', code: 'booked', status_label: 'Booked - confirmed (Gina is on the schedule)', active: false, held_by_id: '1', held_by: 'Gina', next_up: '', waiting_for_window: false,
    asked: [{ id: '9', cleaner: 'Gina', status: 'accepted' }], backups: { can: [], out: [], unknown: [] }, converted_to: 'milam-ridge|checkout|2026-10-31', text_state: 'failed:2', mail_state: '', cal_state: 'done', can_convert: false, can_cancel: false, can_send_now: false },
];
const cleaners = [1, 2, 3].map(i => ({ id: String(i), name: ['Gina Lee', 'Kayla Moss', 'Rachel Poe'][i - 1], nickname: '', active: true, in_pool: true, priority: i, sms_ok: true, phone: '8285550' + i + '00', email: 'x@y.z', language: 'en', digest: false, link: 'https://x/c?k=' + i }));
const plan = (over = {}) => ({ date: '2026-12-05', label: 'Saturday, December 5', note: 'TEST- maybe', key: 'milam-ridge|pending|2026-12-05', first: { id: '1', name: 'Gina Lee', first: 'Gina' },
  text: 'Hi Gina, quick question - we may have a guest checking out Sat, Dec 5 at Milam Ridge, but it isn\'t booked yet. Would you be available to clean it if it does book? An answer as soon as you can helps us decide whether to accept it. Tap here: {Link}',
  queue: [{ id: '1', name: 'Gina', state: 'first', why: '' }, { id: '2', name: 'Kayla', state: 'then', why: '' }, { id: '3', name: 'Rachel', state: 'skip', why: 'marked out that day' }], in_window: true, send_mode: 'now', send_when: 'It is sent right away.', warnings: ['The cleaning calendar already has "Booked (hand)" on Saturday, December 5 (typed by hand). Check you really need this inquiry.'], sig: 'abc123', ...over });
const adminState = (over = {}) => ({ ok: true, build: 'x', today: '2026-10-20', text_max: 800, settings: { engine: true, sms: true, twilio_enabled: true, sms_test_mode: true, bookings_set: true, cleaning_cal_set: true, alert_days: 14, lookahead_days: 60 }, feed_ok: true, pending: pendings(), cleaners, tasks: [], alerts: [{ id: 'a1', kind: 'pending', severity: 'normal', message: 'PENDING DATE: Gina CAN clean Sat, Nov 7 if it books (tentative, not booked yet) - 18 days out\nYou can accept the booking: a cleaner is lined up.', sent: 1, last_sent: new Date().toISOString(), acked: false }], log: [], unfinished_changes: [], parked_texts: [], coming_soon: [], ...over });
const admin = async (handler, state = adminState()) => {
  const p = await mk(phone, async (pth, body, route) => { if (pth === '/str/admin/state') return { body: state }; return handler(pth, body, route); }, () => { try { localStorage.setItem('mh_auth', 'T'); } catch (e) {} });
  await p.goto(BASE + 'str-cleaning.html'); await p.waitForSelector('.tcard.pendc'); return p;
};
const sheetText = p => p.locator('#sheet-box').innerText();

await t('admin: Pending list shows the four at-a-glance statuses, who was asked, backups; pending alert labelled; no horizontal scroll', async () => {
  const p = await admin(() => ({ body: { ok: true } }));
  const txt = await p.locator('#pend-list').innerText();
  for (const s of ['Held by Gina - tentative', 'Waiting on Kayla', 'Nobody available', 'Booked - confirmed']) assert(txt.includes(s), 'missing status ' + s);
  assert(/Backup available:\s*Kayla/.test(txt), 'backup shown'); assert(/Gina: said yes \(tentative\)/.test(txt), 'who said yes'); assert(/Kayla: waiting for a reply/.test(txt), 'who is asked');
  assert(/NOT an assignment/.test(txt), 'held is described as tentative'); assert(/follow-up text to her has not gone out yet/.test(txt), 'failed follow-up text is visible');
  assert(/Pending date \(not booked yet\)/.test(await p.locator('#alerts').innerText()), 'alert label');
  assert(/Pending \(not booked\)/.test(await p.locator('#sec-pend summary').innerText()));
  assert(/3 open inquiries/.test(await p.locator('#m-pend').innerText()));
  assert.strictEqual(await p.locator('#pend-list .tcard').count(), 4);
  await noScroll(p); assert.deepStrictEqual(p._errs, []);
  const small = await p.evaluate(() => [...document.querySelectorAll('#sec-pend button')].filter(b => b.offsetHeight < 44).map(b => b.textContent));
  assert.deepStrictEqual(small, [], 'tap targets under 44px: ' + small);
  await p.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/admin-pending.png' : '/dev/null', fullPage: false }).catch(() => {});
  await p.context().close();
});
await t('admin: closed items have no action buttons; open ones explain each button in plain words', async () => {
  const p = await admin(() => ({ body: { ok: true } }));
  const done = p.locator('#pend-list .tcard.done'); assert.strictEqual(await done.count(), 1); assert.strictEqual(await done.locator('button').count(), 0);
  const first = await p.locator('#pend-list .tcard').first().innerText(); assert(/Mark as booked now:/.test(first) && /Cancel:/.test(first));
  assert(!/Ask now:/.test(first), 'held date has no Ask now'); assert(/Ask now:/.test(await p.locator('#pend-list .tcard').nth(1).innerText()));
  await p.context().close();
});
await t('admin: Ask about a date - preview then edit then send (edited text, sig, note, date are what is posted)', async () => {
  const p = await admin((pth, body) => { if (pth === '/str/admin/pending/preview') return { body: { ok: true, plan: plan({ date: body.date }) } }; if (pth === '/str/admin/pending/create') return { body: { ok: true, key: 'k', message: 'Asked Gina about Saturday, December 5. You will be told as soon as someone says yes (or if nobody can).', warnings: [] } }; return { body: { ok: true } }; });
  await p.click('[data-act=pend-new]'); await p.waitForSelector('#pd-date');
  await p.click('#sh-go'); assert(/Pick the date first/.test(await p.locator('#sh-err').innerText()), 'needs a date'); assert.strictEqual(callsTo(p, '/str/admin/pending/preview').length, 0);
  await p.fill('#pd-date', '2026-12-05'); await p.fill('#pd-note', 'TEST- maybe'); await p.click('#sh-go'); await p.waitForSelector('#pd-text');
  const s = await sheetText(p); assert(/Nothing has been sent or saved yet/.test(s)); assert(/Asked first: Gina/.test(s)); assert(/Rachel \(marked out that day\)/.test(s)); assert(/typed by hand/.test(s));
  assert(!/primary|rank/i.test(await p.locator('#pd-text').inputValue()), 'cleaner text has no primary/rank'); assert(!/deadline|reply by/i.test(await p.locator('#pd-text').inputValue()));
  assert.strictEqual(await p.locator('#pd-now').count(), 0, 'no send-late box inside the window');
  assert.strictEqual(callsTo(p, '/str/admin/pending/create').length, 0, 'nothing created before Send');
  await p.fill('#pd-text', 'Hi Gina - edited text {Link}'); await p.click('#sh-go'); await p.waitForSelector('#sh-done');
  const c = callsTo(p, '/str/admin/pending/create'); assert.strictEqual(c.length, 1);
  assert.deepStrictEqual({ ...c[0].body }, { date: '2026-12-05', note: 'TEST- maybe', sig: 'abc123', text: 'Hi Gina - edited text {Link}', send_now: false });
  assert(/Asked Gina about Saturday, December 5/.test(await sheetText(p))); await noScroll(p); await p.context().close();
});
await t('admin: outside 8-9 the page offers "Send now even if late" (default off) and posts send_now only when ticked', async () => {
  const p = await admin((pth, body) => { if (pth === '/str/admin/pending/preview') return { body: { ok: true, plan: plan({ in_window: false, send_mode: 'after_window', send_when: 'It is outside the 8 AM - 9 PM texting hours, so it will be sent at 8 AM. Tick "Send now even if late" to send it immediately.' }) } }; if (pth === '/str/admin/pending/create') return { body: { ok: true, message: 'Saved. Gina will be asked at 8 AM.', warnings: [] } }; return { body: { ok: true } }; });
  await p.click('[data-act=pend-new]'); await p.fill('#pd-date', '2026-12-05'); await p.click('#sh-go'); await p.waitForSelector('#pd-now');
  assert.strictEqual(await p.locator('#pd-now').isChecked(), false); assert(/sent at 8 AM/.test(await sheetText(p)));
  await p.click('#sh-go'); await p.waitForSelector('#sh-done'); assert.strictEqual(callsTo(p, '/str/admin/pending/create')[0].body.send_now, false); await p.context().close();
  const p2 = await admin((pth, body) => { if (pth === '/str/admin/pending/preview') return { body: { ok: true, plan: plan({ in_window: false, send_mode: 'after_window', send_when: 'x' }) } }; return { body: { ok: true, message: 'Asked Gina.', warnings: [] } }; });
  await p2.click('[data-act=pend-new]'); await p2.fill('#pd-date', '2026-12-05'); await p2.click('#sh-go'); await p2.waitForSelector('#pd-now'); await p2.check('#pd-now'); await p2.click('#sh-go'); await p2.waitForSelector('#sh-done');
  assert.strictEqual(callsTo(p2, '/str/admin/pending/create')[0].body.send_now, true); await p2.context().close();
});
await t('admin: empty text is refused on the page; nobody-to-ask can still be saved with a clear explanation', async () => {
  const p = await admin((pth) => pth === '/str/admin/pending/preview' ? { body: { ok: true, plan: plan() } } : { body: { ok: true, message: 'm', warnings: [] } });
  await p.click('[data-act=pend-new]'); await p.fill('#pd-date', '2026-12-05'); await p.click('#sh-go'); await p.waitForSelector('#pd-text'); await p.fill('#pd-text', '   '); await p.click('#sh-go');
  assert(/text is empty/.test(await p.locator('#sh-err').innerText())); assert.strictEqual(callsTo(p, '/str/admin/pending/create').length, 0); await p.context().close();
  const q = await admin((pth) => pth === '/str/admin/pending/preview' ? { body: { ok: true, plan: plan({ first: null, text: '', send_mode: 'none', send_when: 'Nobody to text.', queue: [{ id: '1', name: 'Gina', state: 'skip', why: 'texts switched off' }] }) } } : { body: { ok: true, message: 'Saved, but nobody in the queue can be asked right now. You have been told.', warnings: [] } });
  await q.click('[data-act=pend-new]'); await q.fill('#pd-date', '2026-12-05'); await q.click('#sh-go'); await q.waitForSelector('.stk #sh-go');
  assert(/Nobody to text/.test(await sheetText(q))); assert.strictEqual(await q.locator('#pd-text').count(), 0); assert(/Save: nobody to ask/.test(await q.locator('#sh-go').innerText()));
  await q.click('#sh-go'); await q.waitForSelector('#sh-done'); assert.strictEqual(callsTo(q, '/str/admin/pending/create')[0].body.text, ''); await q.context().close();
});
await t('admin: server refuses (date already booked) at Preview: message shown, nothing created', async () => {
  const p = await admin((pth) => pth === '/str/admin/pending/preview' ? { status: 409, body: { ok: false, error: 'already_booked', message: 'Saturday, December 5 already has a real turnover on the board.' } } : { body: { ok: true } });
  await p.click('[data-act=pend-new]'); await p.fill('#pd-date', '2026-12-05'); await p.click('#sh-go'); await p.waitForSelector('#sh-err:not(.hide)');
  const e = await p.locator('#sh-err').innerText(); assert(/Nothing was changed/.test(e) && /already has a real turnover/.test(e)); assert.strictEqual(callsTo(p, '/str/admin/pending/create').length, 0);
  assert.strictEqual(await p.locator('#sh-go').isDisabled(), false, 'can fix the date and try again'); await p.context().close();
});
await t('admin: stale preview -> Out of date + Preview again; unsure network failure says it is safe to retry and never double-creates by itself', async () => {
  let n = 0; const p = await admin((pth) => { if (pth === '/str/admin/pending/preview') return { body: { ok: true, plan: plan() } }; if (pth === '/str/admin/pending/create') { n++; return n === 1 ? { status: 409, body: { ok: false, error: 'stale_preview', message: 'Things changed since you pressed Preview.' } } : { status: 502, body: 'bad gateway' }; } return { body: { ok: true } }; });
  await p.click('[data-act=pend-new]'); await p.fill('#pd-date', '2026-12-05'); await p.click('#sh-go'); await p.waitForSelector('#pd-text'); await p.click('#sh-go'); await p.waitForSelector('#pd-again');
  assert(/Out of date/.test(await p.locator('#sh-go').innerText())); assert(/Nothing was sent/.test(await p.locator('#sh-err').innerText()));
  await p.click('#pd-again'); await p.waitForSelector('#pd-text'); await p.click('#sh-go'); await p.waitForSelector('#sh-err:not(.hide)');
  const e = await p.locator('#sh-err').innerText(); assert(/Not sure if that went through/.test(e) && /safe to press Send again/.test(e)); assert.strictEqual(callsTo(p, '/str/admin/pending/create').length, 2, 'exactly the taps made'); await p.context().close();
});
const cancelPrev = (holder, over = {}) => ({ ok: true, preview: { holder, text: 'Hi Gina, thanks for saying you could do Sat, Nov 7 at Milam Ridge. It didn\'t book after all, so you don\'t need to keep that date open. We really appreciate it!', in_window: true, note: 'x', ...over } });
await t('admin: Cancel with a holder - quiet by default; the "no booking after all" text only goes if ticked, and is editable', async () => {
  const p = await admin((pth, body) => { if (pth === '/str/admin/pending/cancel') return body.preview ? { body: cancelPrev({ id: '1', name: 'Gina Lee', first: 'Gina', can_text: true, why_not: '' }) } : { body: { ok: true, message: 'Cancelled. Gina will be told within a few minutes.', warnings: [] } }; return { body: { ok: true } }; });
  await p.locator('#pend-list .tcard').first().locator('[data-act=pend-cancel]').click(); await p.waitForSelector('#pc-notify');
  assert.strictEqual(await p.locator('#pc-notify').isChecked(), false); assert(await p.locator('#pc-txt').evaluate(e => e.classList.contains('hide')), 'text hidden until ticked');
  assert(/Nobody is texted unless you choose it/.test(await sheetText(p)));
  await p.check('#pc-notify'); assert(!(await p.locator('#pc-txt').evaluate(e => e.classList.contains('hide')))); await p.fill('#pc-body', 'Thanks Gina - it did not book.');
  await p.click('#sh-go'); await p.waitForSelector('#sh-done');
  const c = callsTo(p, '/str/admin/pending/cancel').filter(x => !x.body.preview); assert.strictEqual(c.length, 1); assert.deepStrictEqual(c[0].body, { task_key: 'milam-ridge|pending|2026-11-07', notify: true, text: 'Thanks Gina - it did not book.' });
  assert(/Gina will be told/.test(await sheetText(p))); await noScroll(p); await p.context().close();
  const q = await admin((pth, body) => { if (pth === '/str/admin/pending/cancel') return body.preview ? { body: cancelPrev({ id: '1', name: 'Gina Lee', first: 'Gina', can_text: true }) } : { body: { ok: true, message: 'Cancelled. Nobody was texted.', warnings: [] } }; return { body: { ok: true } }; });
  await q.locator('#pend-list .tcard').first().locator('[data-act=pend-cancel]').click(); await q.waitForSelector('#pc-notify'); await q.click('#sh-go'); await q.waitForSelector('#sh-done');
  const d = callsTo(q, '/str/admin/pending/cancel').filter(x => !x.body.preview)[0].body; assert.strictEqual(d.notify, false); assert.strictEqual(d.text, ''); await q.context().close();
});
await t('admin: Cancel with nobody holding / holder cannot be texted / cancel fails (error shown, button comes back)', async () => {
  const p = await admin((pth, body) => { if (pth === '/str/admin/pending/cancel') return body.preview ? { body: cancelPrev(null, { text: '' }) } : { status: 500, body: { ok: false, error: 'boom', message: 'The sheet write did not land.' } }; return { body: { ok: true } }; });
  await p.locator('#pend-list .tcard').nth(1).locator('[data-act=pend-cancel]').click(); await p.waitForSelector('#sh-go');
  assert(/there is nobody to tell/.test(await sheetText(p))); assert.strictEqual(await p.locator('#pc-notify').count(), 0);
  await p.click('#sh-go'); await p.waitForSelector('#sh-err:not(.hide)'); assert(/Not done/.test(await p.locator('#sh-err').innerText()) && /did not land/.test(await p.locator('#sh-err').innerText()));
  assert.strictEqual(await p.locator('#sh-go').isDisabled(), false); assert.strictEqual(await p.locator('#sh-cancel').isDisabled(), false); await p.context().close();
  const q = await admin((pth, body) => pth === '/str/admin/pending/cancel' ? { body: cancelPrev({ id: '1', name: 'Gina Lee', first: 'Gina', can_text: false, why_not: 'Gina Lee has texts switched off' }) } : { body: { ok: true } });
  await q.locator('#pend-list .tcard').first().locator('[data-act=pend-cancel]').click(); await q.waitForSelector('#sh-go'); assert(/Cannot text Gina/.test(await sheetText(q))); assert.strictEqual(await q.locator('#pc-notify').count(), 0); await q.context().close();
});
await t('admin: Mark as booked now - confirm first (explains what happens), then posts the key and shows the server message + warnings', async () => {
  const p = await admin((pth) => pth === '/str/admin/pending/convert' ? { body: { ok: true, message: 'Marked as booked. Gina is now on the schedule (the "now booked" text and calendar invite go out within a few minutes).', warnings: ['The calendar could not be updated just now; it is fixed by the next scheduler run.'] } } : { body: { ok: true } });
  await p.locator('#pend-list .tcard').first().locator('[data-act=pend-convert]').click(); await p.waitForSelector('#sh-go');
  const s = await sheetText(p); assert(/Gina becomes the assigned cleaner/.test(s) && /Cleaners who passed are not texted/.test(s)); assert.strictEqual(callsTo(p, '/str/admin/pending/convert').length, 0, 'confirm first');
  await p.click('#sh-go'); await p.waitForSelector('#sh-done'); const c = callsTo(p, '/str/admin/pending/convert'); assert.strictEqual(c.length, 1); assert.deepStrictEqual(c[0].body, { task_key: 'milam-ridge|pending|2026-11-07' });
  const r = await sheetText(p); assert(/Gina is now on the schedule/.test(r) && /calendar could not be updated/.test(r)); await p.context().close();
  const q = await admin((pth) => pth === '/str/admin/pending/convert' ? { status: 409, body: { ok: false, error: 'past_date', message: 'That date has already passed.' } } : { body: { ok: true } });
  await q.locator('#pend-list .tcard').nth(1).locator('[data-act=pend-convert]').click(); await q.click('#sh-go'); await q.waitForSelector('#sh-err:not(.hide)'); assert(/already passed/.test(await q.locator('#sh-err').innerText())); await q.context().close();
});
await t('admin: Ask now (send now) confirm + result wording, including a failed text', async () => {
  const p = await admin((pth) => pth === '/str/admin/pending/send-now' ? { body: { ok: true, result: { action: 'offer_failed' }, status: { label: 'Waiting on Kayla' }, errors: [{ step: 'offer', error: 'Twilio said no' }], warnings: [] } } : { body: { ok: true } });
  await p.locator('#pend-list .tcard').nth(1).locator('[data-act=pend-send]').click(); await p.waitForSelector('#sh-go'); assert(/even if it is outside 8 AM - 9 PM/.test(await sheetText(p)));
  await p.click('#sh-go'); await p.waitForSelector('#sh-done'); const r = await sheetText(p); assert(/FAILED/.test(r) && /Twilio said no/.test(r)); assert.strictEqual(callsTo(p, '/str/admin/pending/send-now')[0].body.task_key, 'milam-ridge|pending|2026-11-14'); await p.context().close();
});
await t('admin: no pending dates -> helpful empty state; a rejected auth drops to login', async () => {
  const q = await mk(phone, async (pth) => pth === '/str/admin/state' ? { body: { ...adminState(), pending: [] } } : { body: { ok: true } }, () => { try { localStorage.setItem('mh_auth', 'T'); } catch (e) {} });
  await q.goto(BASE + 'str-cleaning.html'); await q.waitForSelector('#pend-list'); await q.waitForFunction(() => /No pending dates/.test(document.getElementById('pend-list').innerText)); assert.strictEqual(await q.locator('#m-pend').innerText(), ''); await q.context().close();
});

// ───────────────────────── cleaner ─────────────────────────
const cpend = (over = {}) => ({ key: 'milam-ridge|pending|2026-11-14', date: '2026-11-14', label: 'Sat, Nov 14', long_label: 'Saturday, November 14', days_out: 25, tentative: true, held_by_me: false, held_by_other: false, offer_id: '13', late: false, my_mark: '', can_release: false, status_label: 'Pending - not booked', ...over });
const cpage = (pending, over = {}) => ({ ok: true, cleaner: { name: 'Kayla Moss', first: 'Kayla', language: 'en' }, property: 'Milam Ridge', today: '2026-10-20', pending, server_time: new Date().toISOString(), tasks: [{ key: 'milam-ridge|checkout|2026-10-24', kind: 'checkout', date: '2026-10-24', label: 'Sat, Oct 24', kind_label: 'Checkout 11 AM', next_arrival: '', next_label: '', days_out: 4, covered: false, covered_by: '', mine: false, can_cancel: false, my_mark: '' }], offers: [], backup_prompt: null, ics_url: 'https://x/ics', coming_soon: [], ...over });
const cleaner = async (handler, page0) => { const p = await mk(phone, async (pth, body, route) => { if (pth === '/str/c/page') return { body: typeof page0 === 'function' ? page0() : page0 }; return handler(pth, body, route); }); await p.goto(BASE + 'cleaner.html?k=TOKEN&offer=13'); await p.waitForSelector('.task'); return p; };
const SEL = '.card.offer.pend';

await t('cleaner: question card says NOT BOOKED YET - tentative, no deadline, no primary/rank; buttons are Yes, I\'d be available / No', async () => {
  const p = await cleaner(() => ({ body: { ok: true } }), cpage([cpend()]));
//@@APPEND@@