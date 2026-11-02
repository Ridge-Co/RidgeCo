// Urgent items to the requester (Oct 28 2026) — real-browser check of field-inspect.html at phone size against the REAL Worker code
// (test/_fi-world.mjs fakes Sheets/Drive/Gmail/SMS). Run:  PW=/opt/npm-tools/node_modules/playwright/index.mjs node test/manual-verify-fi-urgent-ui.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { world } from './_fi-world.mjs';
const { chromium } = await import(process.env.PW || 'playwright');
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).split('\n').slice(0, 10).join(' | ')); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
const OPEN = '2026-10-28T14:00:00Z', NIGHT = '2026-10-29T02:00:00Z';
const realNow = Date.now.bind(Date); let off = Date.parse(OPEN) - realNow();
const setServerTime = (iso) => { off = Date.parse(iso) - realNow(); };
// the Worker code sees the pretend time ONLY while it runs (the fake world is all promises, so nothing else interleaves); Playwright keeps the real clock
const atServerTime = async (fn) => { Date.now = () => realNow() + off; try { return await fn(); } finally { Date.now = realNow; } };

const w = world(); w.h.staged = false;
await w.fiList(w.env);
const ID = 'fi_urgentui001';
const doc0 = { v: 1, date: '2026-10-28', type: 'periodic', property: { address: '3572 Dudley Ave, Baltimore, MD 21213' }, owner: { name: 'Premier Property Management' }, overall: { condition: 'fair' },
  booking: { id: '4', customer_name: 'Premier Property Management', contact: { name: 'Josiah Speed', phone: '+16674158226', email: 'josiah@example.test' }, scheduled: 'Wed, Oct 28' },
  areas: [{ id: 'a_kit', name: 'Kitchen', condition: 'fair', issues: [] }, { id: 'a_roof', name: 'Roof & Gutters', condition: 'not_inspected', issues: [] }] };
const first = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: doc0 }); assert.ok(first.body.ok);
const J = (b) => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
const reqOf = (route, u) => ({ headers: { get: k => route.request().headers()[String(k).toLowerCase()] || '' }, arrayBuffer: async () => { const b = route.request().postDataBuffer(); return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : new ArrayBuffer(0); } });
const calls = [];
async function handle(route) {
  const rq = route.request(), u = new URL(rq.url()), p = u.pathname, m = rq.method(); const CORS = J();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (w.h.netDown) return route.abort('failed');
  let body = {}; if (m === 'POST' && p !== '/fi/photo') { try { body = JSON.parse(rq.postData() || '{}'); } catch (e) { body = {}; } }
  const env = w.env, q = reqOf(route, u); calls.push(m + ' ' + p); let r;
  const R = r0 => r0;
  if (p === '/fi/urgent-send') r = await atServerTime(() => w.fiRoute(env, 'urgent-send', () => w.fiUrgentSend(env, body)));
  else if (p === '/fi/list') r = await w.fiList(env);
  else if (p === '/fi/inspection') r = await w.fiGetInspection(env, u);
  else if (p === '/fi/save') r = await w.fiRoute(env, 'save', () => w.fiSave(env, body));
  else if (p === '/fi/photo') { if (w.h.photoDelay) await new Promise(r0 => setTimeout(r0, w.h.photoDelay)); r = await w.fiPhotoUpload(env, q, u); }
  else if (p === '/fi/photo/view') return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/png' }, body: PNG });
  else if (p === '/fi/issue-types') r = await w.fiTypesList(env);
  else if (p === '/fi/issue-types/touch') r = await w.fiTypesTouch(env, body);
  else if (p === '/fi/bookings') r = { status: 200, body: { ok: true, bookings: [] } };
  else if (p === '/fi/directory') r = await w.fiDirectory(env);
  else return route.fulfill({ status: 404, headers: CORS, body: '{"error":"nf"}' });
  return route.fulfill({ status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) });
}
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function openPage(clockIso) {
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'sek'); } catch (e) {} });
  await ctx.route(W + '/**', handle);
  if (clockIso) await ctx.clock.install({ time: new Date(clockIso) });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(9000); const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|failure-reporter/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.goto(BASE + 'field-inspect.html'); await pg.waitForSelector('text=Dudley');
  await pg.click('text=3572 Dudley'); await pg.waitForSelector('text=areas done');
  return { ctx, pg, errs };
}
const shot = async (pg, n) => { if (process.env.FI_SHOTS) await pg.screenshot({ path: process.env.FI_SHOTS + '/' + n + '.png' }); };
const noH = async (pg, l) => { const [a, b] = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert.ok(a <= b + 1, `${l}: horizontal scroll ${a} > ${b}`); };
const saved = (pg) => pg.waitForFunction(() => /Saved to server/.test(document.getElementById('sync-st').textContent) && !/waiting/.test(document.getElementById('sync-st').textContent), null, { timeout: 15000 });
const serverDoc = async () => (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID))).body.doc;
const issuesOf = (d) => d.areas.flatMap(a => (a.issues || []).map(i => Object.assign({ area: a.name }, i)));

let A;
await t('inspection page shows the urgent card and no banner yet', async () => {
  A = await openPage(OPEN);
  assert.ok(await A.pg.locator('#urg-new').count(), 'send button'); assert.equal(await A.pg.locator('#urg-banner').count(), 0);
  assert.ok((await A.pg.locator('#view').innerText()).includes('emailed to Josiah'));
  await noH(A.pg, 'inspection');
});
await t('typed list + photo: items are created in the report, photo linked to item 2 only', async () => {
  const pg = A.pg;
  await pg.click('#urg-new'); await pg.waitForSelector('#ug-text');
  assert.equal(await pg.inputValue('#ug-area'), 'a_kit');
  await pg.selectOption('#ug-area', 'a_roof'); await pg.selectOption('#ug-area', 'a_kit');
  await pg.fill('#ug-text', 'Gas smell near the stove\nExposed wiring in the attic\n\n');
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#ug-photo')]);
  await fc.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await pg.waitForSelector('#sheet .thumb img');
  assert.equal(await pg.locator('#sheet button[aria-label^="photo belongs to item"]').count(), 2, 'two chips for two lines (blank lines ignored)');
  await pg.fill('#ug-text', 'Gas smell near the stove\nExposed wiring in the attic\nBroken window latch');   // typing after the photo was added updates the chips, and does not rebuild the sheet under the finger
  assert.equal(await pg.locator('#sheet button[aria-label^="photo belongs to item"]').count(), 3, 'chips follow the typed lines');
  await pg.fill('#ug-text', 'Gas smell near the stove\nExposed wiring in the attic\n\n');
  assert.equal(await pg.locator('#sheet button[aria-label^="photo belongs to item"]').count(), 2);
  await pg.click('#sheet button[aria-label="photo belongs to item 2"]');
  await shot(pg, 'urg-1-compose'); await noH(pg, 'compose sheet');
  await pg.click('#ug-go'); await pg.waitForSelector('#ug-prev');
  const txt = await pg.locator('#sheet').innerText();
  assert.ok(txt.includes('Gas smell near the stove') && txt.includes('Exposed wiring in the attic'), 'both items listed');
  assert.equal(await pg.locator('#sheet input[type=checkbox]:checked').count(), 2, 'both items pre-ticked');
  assert.ok(/To: Josiah Speed/.test(txt) && txt.includes('josiah@example.test'), 'goes to the booking contact');
  assert.equal(await pg.locator('#ug-to').count(), 0, 'no address box when the booking has an email');
  await shot(pg, 'urg-2-review'); await noH(pg, 'review sheet');
});
await t('preview then send: one email, photo attached, text OFF by default, items marked sent, nothing doubled', async () => {
  const pg = A.pg;
  assert.equal(await pg.locator('#ug-text-on').isChecked(), false, 'text is off by default');
  await pg.fill('#ug-note', 'Please call me today.');
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-send');
  const pv = await pg.locator('#sheet').innerText();
  assert.ok(pv.includes('2 items at 3572 Dudley Ave') && pv.includes('Please call me today.') && pv.includes('1 photo attached'), pv.slice(0, 400));
  assert.equal(w.h.multi.length, 0, 'preview sends nothing'); assert.equal(await pg.locator('#ug-textinfo').count(), 0, 'no text mentioned when not chosen');
  await shot(pg, 'urg-3-preview'); await noH(pg, 'preview sheet');
  await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah'); await shot(pg, 'urg-4-sent');
  assert.equal(w.h.multi.length, 1); assert.equal(w.h.sms.length, 0, 'no text unless asked');
  assert.equal(w.h.multi[0].attachments.length, 1); assert.equal(w.h.multi[0].cc, 'brett@bmoremanagement.com');
  await pg.click('#sheet button:has-text("Done")'); await saved(pg);
  const iss = issuesOf(await serverDoc());
  assert.equal(iss.length, 2); const g = iss.find(i => /Gas smell/.test(i.title)), e = iss.find(i => /wiring/.test(i.title));
  assert.ok(g && e && g.severity === 'urgent' && g.trade === 'safety' && e.trade === 'electrical', JSON.stringify(iss.map(i => [i.title, i.trade, i.severity])));
  assert.equal((g.photo_ids || []).length, 0, 'photo not on item 1'); assert.equal((e.photo_ids || []).length, 1, 'photo on item 2');
  assert.ok(g.sent && e.sent && g.sent.to === 'josiah@example.test', 'sent marks saved to the server copy');
  const v = await pg.locator('#view').innerText(); assert.equal(await pg.locator('#urg-banner').count(), 0, 'no banner after sending');
  assert.ok((await pg.locator('.area-row:has-text("Kitchen")').innerText()).length > 0);
});
await t('items show "sent" in the area; the public report has no flag/sent fields', async () => {
  const pg = A.pg; await pg.click('.area-row:has-text("Kitchen")'); await pg.waitForSelector('.issue');
  assert.equal(await pg.locator('.issue').count(), 2); assert.ok((await pg.locator('.issue').first().innerText()).includes('sent'));
  const rep = await w.fiReport(w.env, { headers: { get: k => (String(k).toLowerCase() === 'x-auth-token' ? 'sek' : '') } }, new URL('https://x/fi/report?r=' + (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID))).body.inspection.report_token));
  assert.ok(!JSON.stringify(rep.body.doc).includes('flag_send') && !JSON.stringify(rep.body.doc).includes('"sent"'), 'report is clean');
  await pg.click('button:has-text("Areas")');
});
await t('tick "Send to Josiah" on a hand-made item -> banner -> review -> send (with text inside 9am-4pm)', async () => {
  const pg = A.pg; if (process.env.DBG) console.log('DBG', await pg.evaluate(() => [new Date().toISOString(), etHourNow(), textWindowOpen()])); await pg.click('.area-row:has-text("Roof")'); await pg.waitForSelector('#pending');
  await pg.click('button:has-text("＋ Add an issue by hand")'); await pg.waitForSelector('#ie-title');
  await pg.fill('#ie-title', 'Missing shingles above bedroom');
  assert.ok((await pg.locator('.sheet').innerText()).includes('Nothing is sent yet'));
  await pg.locator('.toggle:has-text("Send to Josiah") input').check();
  await pg.click('.sheet .btn.primary:has-text("Save")'); await pg.waitForSelector('.issue');
  assert.ok((await pg.locator('.issue').innerText()).includes('to send'));
  await pg.click('button:has-text("Areas")'); await pg.waitForSelector('#urg-banner');
  assert.ok((await pg.locator('#urg-banner').innerText()).includes('1 item waiting to send to Josiah'));
  await shot(pg, 'urg-5-banner'); await pg.click('#urg-banner button'); await pg.waitForSelector('#ug-prev');
  assert.equal(await pg.locator('#sheet input[type=checkbox]').count(), 2, 'one item + the text toggle');
  await pg.locator('#sheet .toggle:has-text("Missing shingles") input').uncheck();
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-err'); assert.ok((await pg.locator('#ug-err').innerText()).includes('Tick at least one'));
  assert.equal(w.h.multi.length, 1, 'nothing sent');
  await pg.locator('#sheet .toggle:has-text("Missing shingles") input').check();
  await pg.locator('#ug-text-on').check();
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-send');
  assert.ok((await pg.locator('#ug-textinfo').innerText()).includes('Also texting Josiah'));
  await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah');
  assert.equal(w.h.multi.length, 2); assert.equal(w.h.sms.length, 1); assert.equal(w.h.sms[0].to, '+16674158226');
  assert.ok((await pg.locator('#sheet').innerText()).includes('Text sent to Josiah'));
  assert.ok(/^Ridge Co: urgent inspection item at 3572 Dudley Ave: Missing shingles above bedroom/.test(w.h.sms[0].msg), w.h.sms[0].msg);
  await pg.click('#sheet button:has-text("Done")'); await saved(pg); assert.equal(await pg.locator('#urg-banner').count(), 0);
});
await t('a failed email is reported plainly, nothing is marked sent, and the retry works once', async () => {
  const pg = A.pg;
  await pg.click('#urg-new'); await pg.waitForSelector('#ug-text'); await pg.fill('#ug-text', 'Water running down basement wall');
  await pg.click('#ug-go'); await pg.waitForSelector('#ug-prev'); await pg.click('#ug-prev'); await pg.waitForSelector('#ug-send');
  w.h.multiFail = 'Gmail 401'; const before = w.h.multi.length;
  await pg.click('#ug-send'); await pg.waitForSelector('#ug-err');
  assert.ok((await pg.locator('#ug-err').innerText()).includes('NOT sent'), 'says not sent'); assert.equal(w.h.multi.length, before);
  await saved(pg); assert.ok(issuesOf(await serverDoc()).find(i => /Water running/.test(i.title)).sent === undefined, 'not marked sent');
  w.h.multiFail = null;
  await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah'); assert.equal(w.h.multi.length, before + 1);
  assert.equal(w.h.tabs.FI_Email_Log.rows.filter(r => r && /^ug_/.test(r[0])).length, 3, 'one log row per send');
  await pg.click('#sheet button:has-text("Done")'); await saved(pg);
});
await t('no horizontal scroll, no page errors so far', async () => { await noH(A.pg, 'inspection'); assert.deepEqual(A.errs, []); await A.ctx.close(); });
await t('slow photo upload: the send waits for it ("Saving and uploading photos…") and the photo is attached', async () => {
  const D = await openPage(OPEN), pg = D.pg; w.h.photoDelay = 3000;
  await pg.click('#urg-new'); await pg.waitForSelector('#ug-text'); await pg.fill('#ug-text', 'Handrail loose on front steps');
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#ug-photo')]); await fc.setFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG });
  await pg.waitForSelector('#sheet .thumb img'); await pg.click('#ug-go'); await pg.waitForSelector('#ug-prev'); const mail0 = w.h.multi.length;
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-busy'); assert.ok((await pg.locator('#ug-busy').innerText()).includes('uploading'));
  await pg.waitForSelector('#ug-send', { timeout: 20000 }); assert.equal(w.h.multi.length, mail0, 'nothing sent while uploading');
  await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah'); assert.equal(w.h.multi[mail0].attachments.length, 1, 'the photo made it into the email');
  w.h.photoDelay = 0; await saved(pg); await D.ctx.close();
});
await t('no signal: told plainly, items stay flagged on the list, works once signal is back', async () => {
  const E = await openPage(OPEN), pg = E.pg;
  await pg.click('#urg-new'); await pg.waitForSelector('#ug-text'); await pg.fill('#ug-text', 'Carbon monoxide detector missing');
  await pg.click('#ug-go'); await pg.waitForSelector('#ug-prev'); const mail0 = w.h.multi.length;
  await E.ctx.setOffline(true); await pg.click('#ug-prev'); await pg.waitForSelector('#ug-err');
  assert.ok((await pg.locator('#ug-err').innerText()).includes('No signal')); assert.equal(w.h.multi.length, mail0);
  await pg.click('#sheet button:has-text("Close")'); await pg.waitForSelector('#urg-banner'); assert.ok((await pg.locator('#urg-banner').innerText()).includes('1 item waiting'));
  await E.ctx.setOffline(false); await pg.click('#urg-banner button'); await pg.waitForSelector('#ug-prev'); await pg.click('#ug-prev'); await pg.waitForSelector('#ug-send');
  await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah'); assert.equal(w.h.multi.length, mail0 + 1); await E.ctx.close();
});
await t('outside 9am-4pm ET the text switch is disabled with the reason; email still goes', async () => {
  setServerTime(NIGHT);
  const B = await openPage(NIGHT); const pg = B.pg;
  await pg.click('#urg-new'); await pg.waitForSelector('#ug-text'); await pg.fill('#ug-text', 'Sparking outlet in bedroom');
  await pg.click('#ug-go'); await pg.waitForSelector('#ug-prev');
  assert.equal(await pg.locator('#ug-text-on').isDisabled(), true); assert.ok((await pg.locator('#sheet').innerText()).includes('9am–4pm ET'));
  const sms0 = w.h.sms.length, mail0 = w.h.multi.length;
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-send'); await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah');
  assert.equal(w.h.multi.length, mail0 + 1); assert.equal(w.h.sms.length, sms0, 'no text at night'); await B.ctx.close();
});
await t('a booking with no email asks who to send to', async () => {
  setServerTime(OPEN);
  const d = await serverDoc(); d.booking.contact.email = ''; const cur = await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID));
  const sv = await w.fiSave(w.env, { id: ID, base_rev: cur.body.inspection.rev, doc: d }); assert.ok(sv.body.ok);
  const C = await openPage(OPEN); const pg = C.pg;
  await pg.click('#urg-new'); await pg.waitForSelector('#ug-text'); await pg.fill('#ug-text', 'Broken stair rail');
  await pg.click('#ug-go'); await pg.waitForSelector('#ug-to');
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-err'); assert.ok((await pg.locator('#ug-err').innerText()).includes('Type an email'));
  await pg.fill('#ug-to', 'owner@example.test'); const mail0 = w.h.multi.length;
  await pg.click('#ug-prev'); await pg.waitForSelector('#ug-send'); assert.ok((await pg.locator('#sheet').innerText()).includes('owner@example.test'));
  await pg.click('#ug-send'); await pg.waitForSelector('text=Sent to Josiah'); assert.equal(w.h.multi[mail0].to, 'owner@example.test'); await C.ctx.close();
});
await browser.close(); server.close();
console.log(`manual-verify-fi-urgent-ui: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
