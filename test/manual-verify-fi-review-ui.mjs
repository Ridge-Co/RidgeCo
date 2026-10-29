// Oct 29 2026 - real-browser check (phone size) of the inspection REVIEW fixes against the REAL Worker code (fake Sheets via test/_fi-world.mjs):
//   owner picker finds Premier from the inspection screen, leftover dictation can be marked handled, publish needs a preview first.
// Run:  PW=/opt/npm-tools/node_modules/playwright/index.mjs node test/manual-verify-fi-review-ui.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { world } from './_fi-world.mjs';
const { chromium } = await import(process.env.PW || 'playwright');
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).split('\n').slice(0, 8).join(' | ')); } };

const w = world(); w.h.staged = false;
const tb = (n, headers, rows) => { w.h.tabs[n] = { headers, rows }; };
tb('Owners', ['ID', 'Company', 'First_Name', 'Last_Name', 'Phone', 'Email', 'Active'], [['25', 'Premier Property Management', '', '', '', '', 'TRUE'], ['1', 'Phoenix Estates', '', '', '', '', 'TRUE']]);
tb('Properties', ['ID', 'Address', 'City', 'Type', 'Unit_Count', 'Owner_ID', 'Active'], [['97', '3572 Dudley Ave', 'Baltimore', 'rowhome', '1', '', 'TRUE']]);
tb('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], []);
await w.fiList(w.env);
const ID = 'fi_reviewui001';
const A = (id, name, extra) => Object.assign({ id, name, condition: 'fair', issues: [{ id: 'is_' + id, title: 'Rear door closer damaged', trade: 'windows_doors', severity: 'medium', detail: '', likely_cause: '', recommended_fix: 'Replace the closer', fix_source: 'inspector', wo: false, photo_ids: [] }], photo_ids: [], pending_text: '' }, extra || {});
const doc0 = { v: 1, date: '2026-10-29', type: 'periodic', property: { address: '3572 Dudley Ave, Baltimore, MD 21213', street: '3572 Dudley Ave' }, overall: { condition: 'fair', notes: '' },
  booking: { id: '4', customer_name: 'Premiere Property Management', contact: { name: 'Josiah Speed', phone: '', email: 'josiah@example.test' }, scheduled: 'Thu, Oct 29' },
  areas: [A('a_front', 'Exterior Front', { pending_text: '   \n ' }), A('a_rear', 'Exterior Rear', { pending_text: 'Rear door closer damaged and door missing wind stop' })] };
const first = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: doc0 }); assert.ok(first.body.ok, JSON.stringify(first.body));

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const calls = []; let dirDown = false;
async function handle(route) {
  const rq = route.request(), u = new URL(rq.url()), p = u.pathname, m = rq.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  let body = {}; if (m === 'POST') { try { body = JSON.parse(rq.postData() || '{}'); } catch (e) { body = {}; } }
  const env = w.env; calls.push(m + ' ' + p); let r;
  if (p === '/fi/list') r = await w.fiList(env);
  else if (p === '/fi/inspection') r = await w.fiGetInspection(env, u);
  else if (p === '/fi/save') r = await w.fiRoute(env, 'save', () => w.fiSave(env, body));
  else if (p === '/fi/issue-types') r = await w.fiTypesList(env);
  else if (p === '/fi/bookings') r = { status: 200, body: { ok: true, bookings: [] } };
  else if (p === '/fi/directory') { if (dirDown) return route.abort('failed'); r = await w.fiDirectory(env); }
  else if (p === '/fi/publish') r = await w.fiRoute(env, 'publish', () => w.fiPublish(env, body));
  else return route.fulfill({ status: 404, headers: CORS, body: '{"error":"nf"}' });
  return route.fulfill({ status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) });
}
const browser = await chromium.launch();
async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mh_auth', 'sek'); sessionStorage.setItem('seeded', '1'); } } catch (e) {} });
  await ctx.route(W + '/**', handle);
  const pg = await ctx.newPage(); pg.setDefaultTimeout(9000); const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|failure-reporter/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.goto(BASE + 'field-inspect.html'); await pg.waitForSelector('text=Dudley');
  await pg.click('text=3572 Dudley'); await pg.waitForSelector('text=areas done');
  return { ctx, pg, errs };
}
const saved = (pg) => pg.waitForFunction(() => /Saved to server/.test(document.getElementById('sync-st').textContent) && !/waiting/.test(document.getElementById('sync-st').textContent), null, { timeout: 15000 });
const serverDoc = async () => (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID))).body.doc;

let P;
await t('area list flags only the area with REAL leftover dictation (whitespace-only is not flagged)', async () => {
  P = await openPage(); const txt = await P.pg.locator('#view').innerText();
  assert.equal((txt.match(/dictation not processed/g) || []).length, 1, txt);
});
await t('review shows the owner step and the leftover dictation with its text; publish is locked', async () => {
  const pg = P.pg; await pg.click('text=Review & report'); await pg.waitForSelector('text=Before you publish');
  const txt = await pg.locator('#view').innerText();
  assert.ok(/Owner needed/.test(txt) && /Exterior Rear — leftover dictation/.test(txt) && /wind stop/.test(txt), txt);
  assert.ok(await pg.locator('#pub-btn').isDisabled());
});
await t('owner picker opened straight from the inspection screen LOADS the list and suggests Premier (booking spelled "Premiere")', async () => {
  const pg = P.pg; await pg.click('text=Choose the owner…'); await pg.waitForSelector('#olist2-extra');
  await pg.waitForSelector('text=Suggested: Premier Property Management');
  assert.ok(calls.includes('GET /fi/directory'), 'directory was fetched by the picker');
});
await t('typing the brand spelling "Premiere" also finds the owner', async () => {
  const pg = P.pg; await pg.fill('#oq2', 'Premiere Property'); assert.ok(await pg.locator('#olist2 .propitem', { hasText: 'Premier Property Management' }).count());
  await pg.fill('#oq2', '');
});
await t('one tap sets the owner; the owner block disappears', async () => {
  const pg = P.pg; await pg.click('text=Use Premier Property Management'); await saved(pg);
  assert.equal((await serverDoc()).owner.name, 'Premier Property Management');
  const txt = await pg.locator('#view').innerText(); assert.ok(!/Owner needed/.test(txt));
});
await t('"Already added — mark handled" clears the box but keeps the text in the log', async () => {
  const pg = P.pg; await pg.click('text=Already added — mark handled'); await saved(pg);
  const d = await serverDoc(); const rear = d.areas.find(a => a.id === 'a_rear');
  assert.equal(rear.pending_text, ''); assert.ok(rear.dictation.length === 1 && /wind stop/.test(rear.dictation[0].text), JSON.stringify(rear.dictation));
  assert.ok(!/leftover dictation/.test(await pg.locator('#view').innerText()));
});
await t('publish is STILL locked until the report has been previewed', async () => {
  const pg = P.pg; assert.ok(await pg.locator('#pub-btn').isDisabled()); assert.ok(/Step 1/.test(await pg.locator('#view').innerText()));
});
await t('Preview opens the saved draft in a new tab and unlocks publish', async () => {
  const pg = P.pg; const [pop] = await Promise.all([pg.context().waitForEvent('page'), pg.click('#prev-btn')]);
  assert.ok(/inspection-report\.html\?r=/.test(pop.url()), pop.url());
  await pop.close(); await pg.waitForSelector('text=You previewed this version');
  assert.ok(!(await pg.locator('#pub-btn').isDisabled()));
});
await t('changing anything after the preview locks publish again', async () => {
  const pg = P.pg; await pg.click('text=‹ Areas'); await pg.click('text=Exterior Rear'); await pg.fill('#anotes', 'extra note'); await saved(pg);
  await pg.click('text=‹ Areas'); await pg.click('text=Review & report'); await pg.waitForSelector('text=Before you publish');
  assert.ok(await pg.locator('#pub-btn').isDisabled(), 'locked after an edit');
});
await t('preview again, then publish succeeds on the server', async () => {
  const pg = P.pg; const [pop] = await Promise.all([pg.context().waitForEvent('page'), pg.click('#prev-btn')]); await pop.close();
  await pg.waitForSelector('text=You previewed this version'); await pg.click('#pub-btn');
  await pg.waitForSelector('text=Published'); const d = (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID))).body;
  assert.equal(d.inspection.status, 'published');
});
await t('no page errors', async () => { assert.deepEqual(P.errs, []); });

// owner list cannot load -> it SAYS so (no silent empty list)
await t('directory down + nothing cached -> the picker shows a clear error', async () => {
  await P.ctx.close(); dirDown = true;
  const doc = await serverDoc(); const u = await w.fiSave(w.env, { id: ID, base_rev: (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID))).body.inspection.rev, doc: Object.assign({}, doc, { owner: undefined }) }); assert.ok(u.body.ok, JSON.stringify(u.body));
  const Q = await openPage(); await Q.pg.click('text=Review & report'); await Q.pg.waitForSelector('text=Owner needed'); await Q.pg.click('text=Choose the owner…');
  await Q.pg.waitForSelector('text=Could not load the owner list'); await Q.ctx.close();
});
await browser.close(); server.close();
console.log(`fi-review-ui: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
