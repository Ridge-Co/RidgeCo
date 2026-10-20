// Needs Attention page + header badge + page failure reporter (no-silent-failures phase A2, Oct 16 2026).
// Real headless Chromium at phone width against the shipped pages; every Worker call is intercepted (no network, nothing real is written or texted).
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = (f, q = '') => 'file://' + path.join(__dirname, '..', f) + q;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS — ' + m); };
const WORKER = 'https://maintenance-hub.brett-2f8.workers.dev/**';

const F = (o) => Object.assign({ ID: 'F-1', Fingerprint: 'x', Severity: 'P0', System: 'hub', Where: 'scheduler_job', Message: 'deposit_paid: ok:false []', Source: 'worker', First_Seen: new Date(Date.now() - 3 * 3600e3).toISOString(), Last_Seen: new Date(Date.now() - 600e3).toISOString(), Count: '12', Status: 'open', Notified_At: '', Notified_Count: '0', Last_Event_ID: '1', Fixed_In: '', Notes: '' }, o);
const LIST = () => [
  F({}),
  F({ ID: 'F-2', Severity: 'P1', Where: 'wo_status', Message: "<img src=x onerror=window.__xss=1> Quota exceeded", Count: '3' }),
  F({ ID: 'F-3', Severity: 'P2', Where: 'page:vendor.html js-error', Message: 'x is not defined', Count: '1', Status: 'acknowledged' }),
];
const counts = (l) => ({ open: l.length, P0: l.filter(x => x.Severity === 'P0').length, P1: l.filter(x => x.Severity === 'P1').length, P2: l.filter(x => x.Severity === 'P2').length, acknowledged: l.filter(x => x.Status === 'acknowledged').length });

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Needs Attention page (admin) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'adm'); } catch (e) {} });
    const page = await ctx.newPage();
    let list = LIST(), updates = [], alertsOn = false, failList = false;
    await page.route(WORKER, async route => {
      const u = route.request().url(), m = route.request().method();
      const fulfil = (d, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) });
      if (u.includes('/failures/open')) {
        if (failList) return fulfil({ ok: false, error: 'could not read the failure ledger: 503' }, 503);
        const open = list.filter(x => x.Status === 'open' || x.Status === 'acknowledged');
        return fulfil({ ok: true, as_of: new Date().toISOString(), alerts_on: alertsOn, counts: counts(open), failures: open });
      }
      if (u.includes('/failure/update')) { const b = JSON.parse(route.request().postData() || '{}'); updates.push(b); list = list.map(x => x.ID === b.ID || x.ID === b.id ? Object.assign({}, x, { Status: b.status, Fixed_In: b.fixed_in || x.Fixed_In }) : x); return fulfil({ ok: true }); }
      if (u.includes('/failure/report')) return fulfil({ ok: true });
      return fulfil({});
    });
    await page.goto(url('failures.html'));
    await page.waitForSelector('.card');
    ok((await page.locator('.card').count()) === 3, 'lists all three open problems');
    ok((await page.locator('h2.sec').allTextContents()).join('|').match(/Urgent.*Important.*Minor/), 'grouped urgent, important, minor in that order');
    ok(/3 open problems/.test(await page.locator('#sTitle').textContent()) && /2 not yet acknowledged/.test(await page.locator('#sTitle').textContent()), 'headline says 3 open, 2 not yet acknowledged');
    ok(await page.locator('.banner.red').count() === 1 && /OFF/.test(await page.locator('.banner.red').textContent()), 'shows a red banner when text alerts are OFF');
    ok(await page.evaluate(() => window.__xss) === undefined && (await page.locator('.msg').nth(1).textContent()).includes('<img src=x'), 'error text with HTML is shown as text, not run');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 412px');
    await page.locator('#c-F-1 button', { hasText: 'Acknowledge' }).click();
    await page.waitForFunction(() => document.querySelector('#c-F-1 .chip'));
    ok(updates.length === 1 && updates[0].id === 'F-1' && updates[0].status === 'acknowledged', 'Acknowledge posts the right id and status, then the card refreshes');
    await page.locator('#c-F-2 button', { hasText: 'Fixed…' }).click();
    await page.fill('#ni-F-2', 'PR 340');
    await page.locator('#n-F-2 button', { hasText: 'Save as fixed' }).click();
    await page.waitForFunction(() => !document.querySelector('#c-F-2'));
    ok(updates[1].status === 'fixed' && updates[1].fixed_in === 'PR 340', 'Fixed… saves with the PR note and the card leaves the open list');
    await page.locator('#c-F-1 button', { hasText: 'Copy for Claude' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ok(/Hub problem to fix/.test(clip) && /ID: F-1/.test(clip) && /scheduler_job/.test(clip) && /add a test that forces this exact failure/.test(clip), 'Copy for Claude puts a ready-to-paste brief on the clipboard');
    await page.click('#copyAll');
    const all = await page.evaluate(() => navigator.clipboard.readText());
    ok(/open Hub problems/.test(all) && /F-1/.test(all) && /F-3/.test(all), 'Copy all open includes every open problem');
    await page.locator('#c-F-1 button', { hasText: 'Won' }).click();
    await page.waitForFunction(() => !document.querySelector('#c-F-1'));
    ok(updates[2].status === 'wontfix', "Won't fix closes it");
    // list read failure is loud, not blank
    failList = true; await page.click('text=Refresh');
    await page.waitForSelector('.errbox');
    ok(/could not read/.test(await page.locator('.errbox').textContent()) && /Could not load/.test(await page.locator('#sTitle').textContent()), 'if the list cannot load the page says so in red (never an empty "all clear")');
    await ctx.close();
  }

  // ---------- 2. Badge on another admin page ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'adm'); } catch (e) {} });
    const page = await ctx.newPage();
    let status = 200;
    await page.route(WORKER, async route => {
      const u = route.request().url();
      const fulfil = (d, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) });
      if (u.includes('/failures/open')) { if (status !== 200) return fulfil({ ok: false }, status); return fulfil({ ok: true, counts: { open: 3, P0: 1, P1: 1, P2: 1, acknowledged: 1 }, failures: [] }); }
      return fulfil({ ok: true, rows: [] });
    });
    await page.goto(url('action-center.html'));
    await page.waitForSelector('#hub-fail-badge');
    const t = await page.locator('#hub-fail-badge').textContent();
    ok(/2 problems/.test(t), 'badge counts unacknowledged problems (3 open, 1 acknowledged -> 2)');
    ok(await page.evaluate(() => document.getElementById('hub-fail-badge').parentElement.id === 'rc-navbar'), 'badge sits in the shared top bar');
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('hub-fail-badge')).backgroundColor) === 'rgb(192, 36, 43)', 'badge is red when an urgent problem is open');
    ok(await page.evaluate(() => document.getElementById('hub-fail-badge').getAttribute('href').startsWith('failures.html')), 'badge opens the Needs Attention page');
    ok((await page.locator('#rc-nav-jump option[value="failures.html"]').count()) === 1, 'Needs Attention is in the Jump-to menu');
    await ctx.close();
    // list unreadable -> loud badge
    const c2 = await browser.newContext({ viewport: { width: 412, height: 860 } });
    await c2.addInitScript(() => { try { localStorage.setItem('mh_auth', 'adm'); } catch (e) {} });
    const p2 = await c2.newPage(); status = 503;
    await p2.route(WORKER, async route => { const u = route.request().url(); if (u.includes('/failures/open')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"rows":[]}' }); });
    await p2.goto(url('action-center.html'));
    await p2.waitForSelector('#hub-fail-badge');
    ok(/unavailable/.test(await p2.locator('#hub-fail-badge').textContent()), 'if the failure list cannot be read, the badge says so instead of disappearing');
    await c2.close();
    // non-admin token -> no badge
    const c3 = await browser.newContext({ viewport: { width: 412, height: 860 } });
    await c3.addInitScript(() => { try { localStorage.setItem('mh_auth', 'role-token'); } catch (e) {} });
    const p3 = await c3.newPage();
    await p3.route(WORKER, async route => { const u = route.request().url(); if (u.includes('/failures/open')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"rows":[]}' }); });
    await p3.goto(url('action-center.html')); await p3.waitForTimeout(600);
    ok((await p3.locator('#hub-fail-badge').count()) === 0, 'a token that is not allowed to see failures gets no badge');
    await c3.close();
  }

  // ---------- 3. Reporter on a portal page (no token) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    const page = await ctx.newPage();
    const reports = []; let mode = 'ok';
    await page.route(WORKER, async route => {
      const u = route.request().url(), m = route.request().method();
      const fulfil = (d, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) });
      if (u.includes('/failure/report')) { reports.push({ body: JSON.parse(route.request().postData() || '{}'), headers: route.request().headers() }); return fulfil({ ok: true }); }
      if (u.includes('/probe500')) return fulfil({ ok: false }, 500);
      if (u.includes('/probe400')) return fulfil({ ok: false, error: 'bad input' }, 400);
      if (u.includes('/probenet')) return route.abort('failed');
      return fulfil({ ok: true, rows: [] });
    });
    await page.goto(url('tenant.html', '?token=SECRET123&x=1'));
    await page.waitForTimeout(500);
    const base = reports.length;
    await page.evaluate(() => { setTimeout(() => { throw new Error('boom from a click handler'); }, 0); });
    await page.waitForFunction(() => document.body.innerText.includes("We've been notified") || document.body.innerText.includes('Ya nos avisaron'));
    ok(reports.length === base + 1 && /boom from a click handler/.test(reports[base].body.message), 'an uncaught error is reported to the Hub');
    ok(/^page:tenant\.html/.test(reports[base].body.where) && reports[base].body.system === 'hub' && reports[base].body.source === 'browser', 'the report names the page and says it came from a browser');
    ok(!JSON.stringify(reports[base]).includes('SECRET123') && !JSON.stringify(reports[base]).includes('?token'), 'no URL query string or token is ever sent');
    ok(!reports[base].headers['x-auth-token'], 'a page report carries no auth token');
    ok(await page.locator('text=/notified/').count() >= 1, 'the user sees a plain notice, not a blank or technical error');
    await page.evaluate(() => { Promise.reject(new Error('rejected promise nobody caught')); });
    await page.waitForFunction(() => true); await page.waitForTimeout(300);
    ok(reports.some(r => /rejected promise nobody caught/.test(r.body.message)), 'an unhandled promise rejection is reported');
    await page.evaluate(() => fetch('https://maintenance-hub.brett-2f8.workers.dev/probe500').catch(() => {}));
    await page.waitForTimeout(300);
    ok(reports.some(r => /HTTP 500/.test(r.body.message) && /probe500/.test(r.body.message)), 'a Hub call that returns HTTP 500 is reported');
    const c400 = reports.length;
    await page.evaluate(() => fetch('https://maintenance-hub.brett-2f8.workers.dev/probe400').catch(() => {}));
    await page.waitForTimeout(300);
    ok(reports.length === c400, 'a normal 400 (bad input) is not a failure report');
    await page.evaluate(() => fetch('https://maintenance-hub.brett-2f8.workers.dev/probenet').catch(() => {}));
    await page.waitForTimeout(300);
    ok(reports.some(r => /network error calling \/probenet/.test(r.body.message)), 'a network failure calling the Hub is reported');
    const dup = reports.length;
    await page.evaluate(() => fetch('https://maintenance-hub.brett-2f8.workers.dev/probe500').catch(() => {}));
    await page.waitForTimeout(300);
    ok(reports.length === dup, 'the same failure is reported once per page load');
    await page.evaluate(() => { for (let i = 0; i < 30; i++) window.hubReportFailure('loop' + i, 'distinct ' + i); });
    await page.waitForTimeout(300);
    ok(reports.length <= 8, 'a page can send at most 8 reports (runaway loops cannot flood)');
    ok(await page.evaluate(() => typeof window.hubReportFailure === 'function'), 'catch blocks can call window.hubReportFailure');
    await ctx.close();
  }

  // ---------- 4. If the report endpoint itself is down, nothing loops and the console says so ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    const page = await ctx.newPage(); let reportCalls = 0; const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
    await page.route(WORKER, async route => { if (route.request().url().includes('/failure/report')) { reportCalls++; return route.fulfill({ status: 500, body: 'down' }); } return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"rows":[]}' }); });
    await page.goto(url('tenant.html'));
    await page.evaluate(() => window.hubReportFailure('t', 'something broke'));
    await page.waitForTimeout(600);
    ok(reportCalls === 1, 'a failing report endpoint is not retried in a loop');
    ok(logs.some(l => /did not accept the report/.test(l)), 'and the failure to report is written to the console (never silent)');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error('FAILED:', e && e.message || e); process.exit(1); });
