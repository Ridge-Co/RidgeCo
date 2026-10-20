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
//@@APPEND@@