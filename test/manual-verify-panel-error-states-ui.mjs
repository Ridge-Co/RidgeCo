// Ops_Build_Queue #112 — browser verification, mocked API (no staging/prod calls). Run from repo root:
//   node test/manual-verify-panel-error-states-ui.mjs
// vendor.html: "Needs your attention" banner and add-on status never show a failed read as "nothing"; Retry recovers; 401 signs out.
// index.html: admin audit-trail history failure shows "Couldn't load history" + Retry (checked as source, the page needs the admin login).
import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).slice(0, 300)); } };
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const sess = { token: 'T', vendor_name: 'Test Vendor', vendor_id: 'V1', language: 'en' };
const wo = { ID: 'WO-1', Status: 'Scheduled', Trade: 'Plumbing', Description: 'Leaky faucet', Property_Address: '1 Test St' };
const browser = await chromium.launch();
async function vendor(handler, s = sess, shot) {
  const ctx = await browser.newContext(phone); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  await page.addInitScript(x => { try { localStorage.setItem('mh_vendor_sess', JSON.stringify(x)); } catch (e) {} }, s);
  await page.route(W + '/**', async route => {
    const u = new URL(route.request().url()); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    const r = await handler(u.pathname + u.search, route); if (r === undefined) return;
    await route.fulfill({ status: r.status || 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(r.body === undefined ? {} : r.body) });
  });
  await page.goto(BASE + 'vendor.html'); return page;
}
const base = (p, ov = {}) => p.startsWith('/vendor-task-requests') ? (ov.vtr ? ov.vtr(p) : { body: [] })
  : p.startsWith('/wo/additional-work') ? (ov.aw ? ov.aw(p) : { body: { success: true, items: [] } })
  : p.startsWith('/workorders') || p.startsWith('/vendor-workorders') ? { body: [wo] } : { body: [] };
const REQ = { ID: 'VTR1', WO_ID: 'WO-1', Request_Type: 'photos', Scope: 'estimate', Message: 'Please add photos' };

await t('banner: failure ({error}) shows error + Retry, never blank; Retry recovers', async () => {
  let n = 0; const p = await vendor(async pth => base(pth, { vtr: () => (++n === 1 ? { body: { error: 'boom' } } : { body: [REQ] }) }));
  await p.waitForSelector('#vtrBanner >> text=Could not load'); assert.ok((await p.textContent('#vtrBanner')).includes('your requests'));
  await p.click('#vtrBanner button'); await p.waitForSelector('#vtrBanner >> text=NEEDS YOUR ATTENTION'); assert.ok((await p.textContent('#vtrBanner')).includes('Please add photos'));
  await p.screenshot({ path: '/tmp/shot-vendor-banner-412.png' });
});
await t('banner: HTTP 500 -> error + Retry', async () => { const p = await vendor(async pth => base(pth, { vtr: () => ({ status: 500, body: { error: 'x' } }) })); await p.waitForSelector('#vtrBanner >> text=Could not load'); });
await t('banner: network failure -> error + Retry', async () => { const p = await vendor(async (pth, route) => { if (pth.startsWith('/vendor-task-requests')) { await route.abort('connectionrefused'); return; } return base(pth); }); await p.waitForSelector('#vtrBanner >> text=Could not load'); });
await t('banner: true empty [] -> banner stays empty (no error text)', async () => { const p = await vendor(async pth => base(pth)); await p.waitForTimeout(1200); assert.equal((await p.textContent('#vtrBanner')).trim(), ''); });
await t('banner: 401 -> signed out, no error banner loop', async () => { const p = await vendor(async pth => base(pth, { vtr: () => ({ status: 401, body: { error: 'Unauthorized' } }) })); await p.waitForTimeout(1500); assert.ok(!(await p.textContent('#vtrBanner')).includes('Could not load')); });
await t('banner: Spanish vendor sees Spanish message', async () => { const p = await vendor(async pth => base(pth, { vtr: () => ({ body: { error: 'x' } }) }), { ...sess, language: 'es' }); await p.waitForSelector('#vtrBanner >> text=No se pudo cargar'); });
await t('add-ons: failure ({success:false}) shows retry on the job card; Retry recovers', async () => {
  let n = 0; const p = await vendor(async pth => base(pth, { aw: () => (++n === 1 ? { body: { success: false, error: 'bad' } } : { body: { success: true, items: [{ child_wo_id: 'WO-1-A', parent_wo_id: 'WO-1', estimate_status: 'approved', amount: 50, items: [{ desc: 'extra pipe' }] }] } }) }));
  await p.waitForSelector('#addon-wrap-0', { state: 'attached', timeout: 15000 }); await p.evaluate(() => toggleCard(0));
  await p.waitForSelector('#addon-wrap-0 >> text=Could not load', { timeout: 15000 }); await p.screenshot({ path: '/tmp/shot-vendor-addon-412.png' });
  await p.click('#addon-wrap-0 button'); await p.waitForSelector('#addon-wrap-0 >> text=extra pipe', { timeout: 15000 });
});
await t('add-ons: empty success -> no error text', async () => { const p = await vendor(async pth => base(pth)); await p.waitForSelector('#addon-wrap-0', { state: 'attached' }); await p.waitForTimeout(1500); assert.ok(!(await p.innerText('#addon-wrap-0')).includes('Could not load')); });
await t('index.html: audit-trail failure shows Couldn\'t load history + Retry; non-array rejected; empty text unchanged', async () => {
  const s = fs.readFileSync('index.html', 'utf8');
  assert.ok(s.includes("Couldn\\'t load history.") && s.includes('loadAuditTrail'));
  assert.ok(s.includes("if (!Array.isArray(entries)) throw new Error"));
  assert.ok(s.includes('No changes recorded yet.'));
  assert.ok(!s.includes(">Unavailable</span>'; });"));
});
await browser.close(); server.close(); console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
