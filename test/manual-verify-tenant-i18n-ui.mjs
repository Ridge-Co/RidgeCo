// Queue #105 — browser check of the tenant EN/ES toggle, mocked API (no staging/prod calls). Run from repo root: node test/manual-verify-tenant-i18n-ui.mjs
import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs'; import path from 'path'; import assert from 'assert';
const ROOT = process.cwd(); const W = 'https://maintenance-hub.brett-2f8.workers.dev';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(0, r)); const BASE = `http://localhost:${server.address().port}/`;
let passes = 0, fails = 0; const t = async (n, f) => { try { await f(); passes++; console.log('PASS', n); } catch (e) { fails++; console.log('FAIL', n, '-', String(e.message).slice(0, 300)); } };
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const sess = { token: 'T', tenant_id: 'TEN1', tenant_name: 'Maria Test', property_address: '1 Test St', unit_label: '2', can_submit_wo: true };
const wos = [{ ID: 'WO-1', Status: 'In Progress', Trade: 'Plumbing', Description: 'Leaky faucet', Created_Date: '2026-10-01', Priority: 'normal' }];
const browser = await chromium.launch(); const net = [];
async function mk(opts, { session, lang } = {}) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  await page.addInitScript(([s, l]) => { try { if (s) localStorage.setItem('mh_tenant_sess', JSON.stringify(s)); if (l) localStorage.setItem('ridgeco_tenant_lang', l); } catch (e) {} }, [session, lang]);
  await page.route(W + '/**', async route => { net.push(route.request().url()); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    await route.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(new URL(route.request().url()).pathname.startsWith('/tenant-workorders') ? wos : []) }); });
  await page.goto(BASE + 'tenant.html'); return page;
}
await t('login screen: default English, ES toggle translates, choice survives reload, EN restores', async () => {
  const p = await mk(phone); assert.ok((await p.innerText('#loginBtn')).includes('SIGN IN'));
  await p.click('#screenLogin .tenant-lang-toggle button[aria-label="Español"]');
  await p.waitForFunction(() => document.getElementById('loginBtn').textContent.includes('INICIAR'));
  assert.equal(await p.getAttribute('html', 'lang'), 'es'); assert.equal(await p.getAttribute('#nameInput', 'placeholder'), 'Su primer nombre');
  await p.screenshot({ path: '/tmp/shot-tenant-es-login-412.png' });
  await p.reload(); await p.waitForFunction(() => document.getElementById('loginBtn').textContent.includes('INICIAR'));
  await p.click('#screenLogin .tenant-lang-toggle button[aria-label="English"]'); await p.waitForFunction(() => document.getElementById('loginBtn').textContent.includes('SIGN IN'));
  assert.equal(await p.evaluate(() => localStorage.getItem('ridgeco_tenant_lang')), 'en');
});
await t('dashboard in Spanish: labels translate, work-order text, name and address are NOT altered', async () => {
  const p = await mk(phone, { session: sess, lang: 'es' }); await p.waitForSelector('.wo-card');
  const txt = await p.innerText('#screenDash');
  assert.ok(txt.includes('Abiertas') && txt.includes('CERRAR SESIÓN') && txt.includes('ENVIAR UNA NUEVA SOLICITUD'), txt.slice(0, 200));
  assert.ok(txt.includes('Leaky faucet') && txt.includes('Maria Test') && txt.includes('1 Test St') && txt.includes('WO-1'));
  await p.screenshot({ path: '/tmp/shot-tenant-es-dash-412.png' });
});
await t('dashboard in English: nothing changes for a tenant who never chose Spanish', async () => {
  const p = await mk(phone, { session: sess }); await p.waitForSelector('.wo-card'); const txt = await p.innerText('#screenDash');
  assert.ok(txt.includes('Open') && txt.includes('LOG OUT') && !txt.includes('CERRAR'));
});
await t('storage blocked: page still works in English', async () => {
  const ctx = await browser.newContext(phone); const page = await ctx.newPage(); await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); await page.goto(BASE + 'tenant.html'); await page.waitForSelector('#loginBtn');
  assert.ok((await page.innerText('#loginBtn')).includes('SIGN IN'));
});
await t('the language layer adds no network call', async () => { assert.ok(!net.some(u => /i18n|lang/i.test(u))); });
await browser.close(); server.close(); console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
