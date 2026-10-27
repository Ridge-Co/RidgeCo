// Headless Playwright pass for the delivery RSVP screens (Oct 23 2026, delivery watcher addendum 1, section D):
//   1. rsvp.html           the tenant page behind the "can you be there" text: ask, answer, confirm, change, and every way it can go wrong
//   2. deliveries.html     RSVP badge (Confirmed / Declined / Unsure / No answer yet), time, note
//   3. command-center.html same badge on the Today's deliveries card
// Loads the REAL shipped pages from disk and intercepts ONLY the Worker calls (no real network, no texts, no writes).
// Phone width (375px) is the main target; the tenant page is also checked at 320px and 768px.
//   node test/manual-verify-delivery-rsvp-ui.mjs [--shots=/some/dir]
// Needs the `playwright` package resolvable from the repo (node_modules/ is gitignored; CI does not run this file,
// same convention as the other test/manual-verify-*.mjs scripts).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const url = (f, q) => 'file://' + join(root, f) + (q || '');
const WORKER = 'https://maintenance-hub.brett-2f8.workers.dev';
const SHOTS = (process.argv.find((a) => a.startsWith('--shots=')) || '').slice(8);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const XSS = '"><img src=x onerror="window.__xss=1">';
const jres = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// ───────────────── a tiny stateful stand-in for GET/POST /delivery/rsvp ─────────────────
function newServer(over) {
  return Object.assign({
    first_name: 'Dana', item_type: 'Refrigerator', date_text: 'Friday, Oct 24', window_text: 'between 9am and 1pm', street: '1109 Battery Ave',
    current: '', note: '',
    // things the page must NEVER show even if a buggy Worker sent them
    phone: '+14105550199', tenant_id: 'T-77', sheet_id: '1KggRJBeJg6WDElisEQmAEsmB0hXtoNBIYWbOMFCd4S4', other_tenant: 'Zed Other',
    getMode: 'ok', postMode: 'ok', delay: 0, gets: [], posts: [],
  }, over || {});
}
async function mount(page, srv) {
  const hosts = [];
  page.on('request', (r) => { try { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.push(u.origin); } catch (e) { /* ignore */ } });
  await page.route(WORKER + '/**', async (route) => {
    const u = new URL(route.request().url()); const m = route.request().method();
    if (u.pathname !== '/delivery/rsvp') return jres(route, {});
    if (m === 'GET') {
      srv.gets.push({ t: u.searchParams.get('t'), referer: route.request().headers()['referer'] || '' });
      if (srv.delay) await new Promise((r) => setTimeout(r, srv.delay));
      if (srv.getMode === 'abort') return route.abort('failed');
      if (srv.getMode === '500') return jres(route, { error: 'sheets exploded: TypeError at line 4412' }, 500);
      if (srv.getMode === 'expired') return jres(route, { ok: false, expired: true }, 410);
      if (srv.getMode === 'invalid') return jres(route, { ok: false, error: 'bad token' }, 404);
      if (srv.getMode === 'delivered') return jres(route, { ok: false, error: 'already_delivered', delivered: true }, 200);
      if (srv.getMode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<html>Bad gateway</html>' });
      return jres(route, { ok: true, first_name: srv.first_name, item_type: srv.item_type, date_text: srv.date_text, window_text: srv.window_text, street: srv.street, current: srv.current, note: srv.note,
        phone: srv.phone, tenant_id: srv.tenant_id, sheet_id: srv.sheet_id, other_tenant: srv.other_tenant });
    }
    const body = JSON.parse(route.request().postData() || '{}');
    srv.posts.push(body);
    if (srv.delay) await new Promise((r) => setTimeout(r, srv.delay));
    if (srv.postMode === 'abort') return route.abort('failed');
    if (srv.postMode === '500') return jres(route, { ok: false, error: 'TypeError: cannot read properties of undefined', message: 'RAW ERROR DUMP' }, 500);
    if (srv.postMode === '429') return jres(route, { ok: false, error: 'rate_limited' }, 429);
    if (srv.postMode === 'delivered') return jres(route, { ok: false, error: 'already_delivered', message: 'RAW SERVER WORDS' }, 409);
    if (srv.postMode === 'noanswer') return jres(route, { ok: true });
    srv.current = body.answer; srv.note = body.note || '';
    return jres(route, { ok: true, current: srv.current, message: 'RAW SERVER WORDS' });
  });
  return hosts;
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const text = (page) => page.locator('main').innerText();
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const parseRgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

(async () => {
  const browser = await chromium.launch();

  for (const vp of [{ n: 'phone 375px', w: 375, h: 760 }, { n: 'small phone 320px', w: 320, h: 640 }, { n: 'tablet 768px', w: 768, h: 900 }]) {
    console.log('\n=== rsvp.html, ' + vp.n + ' ===');
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });

    // ── 1. happy path: ask -> "can't be there" + note -> confirmation -> change to yes ──
    {
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      const srv = newServer(); const hosts = await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=' + encodeURIComponent('abc.DEF-123_xyz')), { waitUntil: 'load' });
      await page.waitForSelector('#ans-yes');
      ok(errs.length === 0, 'no JS errors (' + errs.slice(0, 2).join(' | ') + ')');
      const t0 = await text(page);
      ok(/Hi Dana/.test(t0) && /Refrigerator/.test(t0) && /1109 Battery Ave/.test(t0) && /Friday, Oct 24/.test(t0) && /between 9am and 1pm/.test(t0), 'shows first name, item, street, date and window');
      ok(!/\+1410|T-77|1KggRJ|Zed Other|abc\.DEF/.test(t0), 'shows nothing else even if the Worker sent more (phone, ids, other tenant, the token)');
      ok(srv.gets.length === 1 && srv.gets[0].t === 'abc.DEF-123_xyz', 'exactly one GET carrying the token');
      const btn = await page.locator('.ans').evaluateAll((els) => els.map((e) => ({ id: e.id, h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width), label: e.innerText.replace(/\s+/g, ' ').trim() })));
      ok(btn.length === 3 && btn[0].label.includes('I’ll be there') && btn[1].label.includes('I can’t be there') && btn[2].label.includes('Not sure yet'), 'three buttons, in the right order (' + btn.map((b) => b.label).join(' | ') + ')');
      ok(btn.every((b) => b.h >= 44 && b.w >= 200), 'every button is at least 44px tall and wide (' + btn.map((b) => b.h + 'px').join(',') + ')');
      ok(await noHScroll(page), 'no horizontal scroll');
      ok(/is scheduled to be delivered to you/.test(t0) && /What we are hoping for/.test(t0), 'ask screen: says what is coming and what we are hoping for');
      ok(/open the door and let the delivery team in/.test(t0) && /old appliance taken away/.test(t0) && /new one left in place/.test(t0), 'ask screen: door, delivery team, old one taken away, new one left');
      ok(/do not need to install anything/.test(t0) && /really helps/.test(t0), 'ask screen: tenant does not install; being there really helps');
      ok(t0.includes('If you can’t make it, that’s completely okay. We’ll do our best to be there instead, though the delivery may need to be rescheduled.'), 'ask screen: the gentle "can\'t make it" line, before any answer');
      ok((t0.match(/reschedul/gi) || []).length === 1, 'ask screen: rescheduling mentioned once');
      const order = await page.evaluate(() => { const g = document.querySelector('.gentle').getBoundingClientRect().bottom; const y = document.getElementById('ans-yes').getBoundingClientRect().top; const f = document.querySelector('.facts').getBoundingClientRect().bottom; const h = document.querySelector('.intro h2').getBoundingClientRect().top; return { gentleAboveButtons: g <= y, factsAboveHope: f <= h }; });
      ok(order.gentleAboveButtons && order.factsAboveHope, 'ask screen: details, then what we hope for, then the gentle line, then the three buttons');
      const gc = await page.evaluate(() => { const g = getComputedStyle(document.querySelector('.gentle')); return { fg: g.color, bg: g.backgroundColor }; });
      ok(contrast(parseRgb(gc.fg), parseRgb(gc.bg)) >= 4.5, 'ask screen: gentle block contrast >= 4.5:1 (' + contrast(parseRgb(gc.fg), parseRgb(gc.bg)).toFixed(1) + ')');
      ok(await page.locator('label[for=note]').count() === 1 && /optional/i.test(await page.locator('label[for=note]').innerText()), 'note box has a visible label that says optional');
      ok(await page.locator('meta[name=referrer]').getAttribute('content') === 'no-referrer', 'no-referrer policy is set');
      const c1 = await page.evaluate(() => { const b = getComputedStyle(document.querySelector('.ans.yes')); const m = getComputedStyle(document.querySelector('.count')); return { fg: b.color, bg: b.backgroundColor, mfg: m.color, mbg: getComputedStyle(document.body).backgroundColor }; });
      ok(contrast(parseRgb(c1.fg), parseRgb(c1.bg)) >= 4.5, 'green button text contrast >= 4.5:1 (' + contrast(parseRgb(c1.fg), parseRgb(c1.bg)).toFixed(1) + ')');
      ok(contrast(parseRgb(c1.mfg), parseRgb(c1.mbg)) >= 4.5, 'muted text contrast >= 4.5:1 (' + contrast(parseRgb(c1.mfg), parseRgb(c1.mbg)).toFixed(1) + ')');
      if (SHOTS && vp.w === 375) await page.screenshot({ path: join(SHOTS, 'rsvp-1-ask.png'), fullPage: true });

      await page.fill('#note', 'Out of town until Saturday. Gate code is 4417.');
      ok(/46 \/ 300/.test(await page.locator('#count').innerText()), 'character counter follows the note');
      await page.click('#ans-no');
      await page.waitForSelector('#change');
      ok(srv.posts.length === 1 && srv.posts[0].t === 'abc.DEF-123_xyz' && srv.posts[0].answer === 'no' && srv.posts[0].note === 'Out of town until Saturday. Gate code is 4417.', 'POST carries {t, answer:"no", note}');
      const t1 = await text(page);
      ok(/No problem at all, thank you for letting us know\./.test(t1) && /do our best to be there instead/.test(t1), 'confirmation uses the warm "no" wording');
      ok((t1.match(/reschedul/gi) || []).length === 1, 'the possible reschedule is mentioned once');
      ok(!/RAW SERVER WORDS/.test(t1), 'the server\'s own message text is not shown');
      ok(/Out of town until Saturday/.test(t1), 'the saved note is shown back');
      ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'h'), 'focus moved to the new heading (screen readers announce it)');
      await page.waitForFunction(() => document.getElementById('live').textContent === 'Your answer has been saved.', null, { timeout: 2000 }).catch(() => {});
      ok(await page.evaluate(() => document.getElementById('live').textContent) === 'Your answer has been saved.', 'live region announces the save');
      ok(await noHScroll(page), 'confirmation: no horizontal scroll');
      if (SHOTS && vp.w === 375) await page.screenshot({ path: join(SHOTS, 'rsvp-2-no-confirmed.png'), fullPage: true });

      await page.click('#change');
      ok(await page.locator('#ans-no').getAttribute('aria-pressed') === 'true' && await page.locator('#ans-yes').getAttribute('aria-pressed') === 'false', 'change answer: the current answer is marked');
      ok(await page.inputValue('#note') === 'Out of town until Saturday. Gate code is 4417.', 'change answer: the note is pre-filled, not lost');
      ok(await page.locator('#back').count() === 1, 'change answer: there is a way back without changing anything');
      ok(!/What we are hoping for/.test(await text(page)), 'change answer: the long explanation is not repeated');
      await page.click('#back');
      ok(await page.locator('#change').count() === 1 && srv.posts.length === 1, '"never mind" returns to the confirmation and sends nothing');
      await page.click('#change');
      await page.click('#ans-yes');
      await page.waitForSelector('#change');
      ok(srv.posts.length === 2 && srv.posts[1].answer === 'yes' && srv.posts[1].note === 'Out of town until Saturday. Gate code is 4417.', 'changing to "I\'ll be there" overwrites the answer (note kept)');
      ok(/Wonderful, thank you, Dana!/.test(await text(page)) && !/reschedul/i.test(await text(page)), '"yes" confirmation is warm and does not mention rescheduling');
      ok(hosts.every((h) => h === WORKER || h === 'null'), 'the page talked to nobody but the Worker (' + [...new Set(hosts)].join(', ') + ')');
      ok(srv.gets.every((g) => !g.referer), 'no Referer header on the Worker call');

      // reload shows the saved answer, not the question again
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#change');
      ok(/Wonderful/.test(await text(page)), 'reopening the link later shows their saved answer');
      await page.close();
    }

    // ── 1b. arriving through the short-link redirect ──
    {
      for (const [q, h, want, label] of [['?utm_source=sms&t=redir-tok', '', 'redir-tok', 'extra params added by a redirect'], ['', '#t=hash-tok', 'hash-tok', 'a #t= fragment']]) {
        const page = await ctx.newPage(); const srv = newServer(); await mount(page, srv);
        await page.goto(url('rsvp.html', q) + h, { waitUntil: 'load' });
        await page.waitForSelector('#ans-yes');
        ok(srv.gets.length === 1 && srv.gets[0].t === want, 'token found with ' + label + ' (' + (srv.gets[0] && srv.gets[0].t) + ')');
        await page.close();
      }
    }

    // ── 2. not sure + keyboard ──
    {
      const page = await ctx.newPage(); const srv = newServer(); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k1'), { waitUntil: 'load' });
      await page.waitForSelector('#ans-yes');
      await page.keyboard.press('Tab');
      ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'ans-yes', 'keyboard: Tab reaches the first answer button');
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth);
      ok(/solid 3px/.test(ring), 'keyboard: visible focus ring (' + ring + ')');
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#change');
      ok(srv.posts.length === 1 && srv.posts[0].answer === 'unsure' && srv.posts[0].note === '', 'keyboard: Enter on "Not sure yet" sends {answer:"unsure", note:""}');
      ok(/perfectly fine/.test(await text(page)) && !/reschedul/i.test(await text(page)), '"not sure" confirmation is kind and brief');
      await page.close();
    }

    // ── 3. double tap ──
    {
      const page = await ctx.newPage(); const srv = newServer({ delay: 600 }); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k2'), { waitUntil: 'load' });
      await page.waitForSelector('#ans-yes');
      srv.delay = 0; srv.gets.length = 0; srv.delay = 600;
      await page.dblclick('#ans-yes');
      await page.click('#ans-no', { force: true }).catch(() => {});
      await page.waitForSelector('#change', { timeout: 5000 });
      ok(srv.posts.length === 1 && srv.posts[0].answer === 'yes', 'double-tap and a stray second tap while saving send exactly ONE answer (' + srv.posts.map((p) => p.answer).join(',') + ')');
      await page.close();
    }

    // ── 4. a failed save is honest and keeps the note ──
    for (const [mode, expect] of [['500', /not saved/], ['abort', /could not reach Ridge Co/], ['429', /wait a minute/], ['noanswer', /could not confirm/]]) {
      const page = await ctx.newPage(); const srv = newServer({ postMode: mode }); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k3'), { waitUntil: 'load' });
      await page.waitForSelector('#ans-yes');
      await page.fill('#note', 'please knock loudly');
      await page.click('#ans-yes');
      await page.waitForSelector('#err');
      const t = await text(page);
      ok(expect.test(t), 'save failure (' + mode + ') says so in plain words');
      ok(!/RAW|TypeError|rate_limited|undefined|HTTP|500|exception/i.test(t), 'save failure (' + mode + ') shows no raw error text');
      ok(await page.inputValue('#note') === 'please knock loudly', 'save failure (' + mode + ') keeps the typed note');
      ok(await page.locator('#change').count() === 0, 'save failure (' + mode + ') never shows the "saved" screen');
      ok(await page.evaluate(() => document.getElementById('ans-yes').getAttribute('aria-disabled') !== 'true'), 'save failure (' + mode + ') buttons are usable again');
      srv.postMode = 'ok';
      await page.click('#ans-yes');
      await page.waitForSelector('#change');
      ok(srv.posts.length === 2 && srv.posts[1].note === 'please knock loudly', 'retry after (' + mode + ') succeeds with the same note');
      await page.close();
    }

    // ── 5. link states: nothing is ever blank or raw ──
    for (const [mode, expect, label] of [['expired', /This link is not working/, 'expired'], ['invalid', /This link is not working/, 'bad token'], ['delivered', /already arrived/, 'delivered'],
      ['500', /could not load this just now/, 'server error'], ['abort', /could not load this just now/, 'network failure'], ['html', /could not load this just now|This link is not working/, 'gateway page']]) {
      const page = await ctx.newPage(); const srv = newServer({ getMode: mode }); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=zzz'), { waitUntil: 'load' });
      await page.waitForSelector('#h');
      const t = await text(page);
      ok(expect.test(t), label + ': friendly page (' + t.replace(/\s+/g, ' ').slice(0, 70) + ')');
      ok(!/TypeError|sheets exploded|line 4412|undefined|\{|\}|HTTP \d|Bad gateway/i.test(t), label + ': no raw error text');
      ok(t.trim().length > 40 && await page.locator('#ans-yes').count() === 0, label + ': never blank, and no answer buttons on a dead link');
      ok(!/scold|fail|must|late/i.test(t), label + ': tone stays gentle');
      if (mode === '500') {
        ok(await page.locator('#retry').count() === 1, label + ': has a Try again button');
        srv.getMode = 'ok'; await page.click('#retry'); await page.waitForSelector('#ans-yes');
        ok(/Hi Dana/.test(await text(page)), label + ': Try again recovers');
      }
      if (SHOTS && vp.w === 375 && mode === 'expired') await page.screenshot({ path: join(SHOTS, 'rsvp-3-expired.png'), fullPage: true });
      await page.close();
    }
    {
      // no token in the URL at all: no network call, friendly page
      const page = await ctx.newPage(); const srv = newServer(); await mount(page, srv);
      await page.goto(url('rsvp.html'), { waitUntil: 'load' });
      await page.waitForSelector('#h');
      ok(/This link is not working/.test(await text(page)) && srv.gets.length === 0, 'missing token: friendly page and no request made');
      await page.close();
    }
    {
      // the Worker refuses mid-way (delivered / expired between load and tap)
      const page = await ctx.newPage(); const srv = newServer(); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k4'), { waitUntil: 'load' }); await page.waitForSelector('#ans-yes');
      srv.postMode = 'delivered'; await page.click('#ans-no'); await page.waitForSelector('#h');
      ok(/already arrived/.test(await text(page)) && !/RAW SERVER WORDS/.test(await text(page)), 'delivered while the page was open: polite page, server words not shown');
      await page.close();
    }
    {
      // offline at load, then back online (Playwright's setOffline does not stop mocked routes, so the Worker call is aborted and onLine is forced false)
      const page = await ctx.newPage(); const srv = newServer({ getMode: 'abort' }); await mount(page, srv);
      await page.addInitScript(() => { window.__online = false; Object.defineProperty(navigator, 'onLine', { get: () => window.__online }); });
      await page.goto(url('rsvp.html', '?t=k5'), { waitUntil: 'load' });
      await page.waitForSelector('#retry');
      ok(/offline/i.test(await text(page)) && /not affected/i.test(await text(page)), 'offline at load: says so kindly');
      srv.getMode = 'ok';
      await page.evaluate(() => { window.__online = true; window.dispatchEvent(new Event('online')); });
      await page.waitForSelector('#ans-yes', { timeout: 5000 });
      ok(true, 'coming back online reloads the page by itself');
      await page.close();
    }

    // ── 6. hostile text from the Worker ──
    {
      const page = await ctx.newPage(); const srv = newServer({ first_name: XSS, item_type: XSS, street: XSS, date_text: XSS, window_text: XSS, note: XSS, current: 'no' }); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k6'), { waitUntil: 'load' }); await page.waitForSelector('#change');
      ok(await page.evaluate(() => !window.__xss), 'hostile first name / item / street / date / window / note did not execute');
      ok((await text(page)).includes('<img src=x onerror='), 'the hostile text is shown as plain text');
      await page.click('#change');
      ok(await page.evaluate(() => !window.__xss) && await page.inputValue('#note') === XSS.slice(0, 300), 'hostile note in the edit box stays inert and round-trips');
      await page.close();
    }

    // ── 7. stale page: back button / returning to the tab after a reschedule ──
    {
      const page = await ctx.newPage(); const srv = newServer({ current: 'yes' }); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k7'), { waitUntil: 'load' }); await page.waitForSelector('#change');
      ok(/Wonderful/.test(await text(page)), 'stale: starts on the confirmed screen');
      // the Hub reschedules: new date, answer reset
      srv.date_text = 'Monday, Oct 27'; srv.current = ''; srv.note = '';
      const before = srv.gets.length;
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));   // what Back / bfcache restore does
      await page.waitForSelector('#ans-yes', { timeout: 5000 });
      const t = await text(page);
      ok(srv.gets.length === before + 1, 'stale: coming back from the back button re-reads the delivery');
      ok(/Monday, Oct 27/.test(t) && !/Friday, Oct 24/.test(t), 'stale: the new date is shown');
      ok(/details have been updated/i.test(t), 'stale: a gentle note says the details changed');
      ok(await page.locator('#ans-yes').getAttribute('aria-pressed') === 'false', 'stale: the old answer is not shown as still valid after the reset');
      // visibility change right away is throttled (no hammering)
      const g2 = srv.gets.length;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(150);
      ok(srv.gets.length === g2, 'stale: a tab switch right after a load does not re-request');
      await page.close();
    }
    {
      // refresh while the person is typing must not wipe their note
      const page = await ctx.newPage(); const srv = newServer({ current: 'no', note: 'saved note' }); await mount(page, srv);
      await page.goto(url('rsvp.html', '?t=k8'), { waitUntil: 'load' }); await page.waitForSelector('#change');
      await page.click('#change'); await page.fill('#note', 'half-typed thought');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.waitForTimeout(400);
      ok(await page.inputValue('#note') === 'half-typed thought', 'a background refresh does not erase a half-typed note');
      await page.close();
    }
    {
      // staging override only; a crafted ?api= is ignored
      const page = await ctx.newPage(); const srv = newServer(); const hosts = await mount(page, srv);
      let evil = 0; await page.route('https://evil.example.com/**', (r) => { evil++; return jres(r, { ok: true }); });
      await page.goto(url('rsvp.html', '?t=k9&api=' + encodeURIComponent('https://evil.example.com')), { waitUntil: 'load' }); await page.waitForSelector('#ans-yes');
      ok(evil === 0 && srv.gets.length === 1, 'a crafted ?api= can not redirect the answer to another server');
      await page.close();
    }
    ok(true, '(' + vp.n + ' done)');
    await ctx.close();
  }

  // ───────────────── staff screens: badges ─────────────────
  const TODAY = '2026-10-23';
  const D = (o) => Object.assign({
    id: '', order_number: '', store: 'Home Depot', item_type: '', make_model: '', dims: '', property_id: '', unit_id: '', tenant_id: '',
    property_address: '', unit_label: '', tenant_name: 'Dana Smith', tenant_phone: '', delivery_address: '', expected_date: '', expected_window: '',
    onsite_contact: 'tenant', onsite_contact_phone: '', backup_contact: '', backup_phone: '', notes: '', linked_wo_ids: '',
    status: 'Scheduled', source: 'email-watcher', tenant_rsvp: '', tenant_rsvp_at: '', tenant_rsvp_note: '',
  }, o);
  const R1 = D({ id: 'R1', order_number: 'H1111-000001', item_type: 'Refrigerator', delivery_address: '1109 Battery Ave Apt 2', expected_date: TODAY, expected_window: '9a-1p', tenant_rsvp: 'Declined', tenant_rsvp_at: '2026-10-23T20:12:00.000Z', tenant_rsvp_note: 'Out of town until Saturday, so sorry! Gate code is 4417. ' + 'x'.repeat(250), onsite_contact: 'brett', notes: 'Tenant can\'t be present. Driver calls Brett.' });
  const R2 = D({ id: 'R2', order_number: 'H1111-000002', item_type: 'Washer', delivery_address: '20 E Eager St', expected_date: TODAY, expected_window: '11a-3p', tenant_rsvp: 'Confirmed', tenant_rsvp_at: '2026-10-23T14:05:00.000Z', tenant_name: 'Pat Lee' });
  const R3 = D({ id: 'R3', order_number: 'H1111-000003', item_type: 'Dryer', delivery_address: '5 Some St', expected_date: TODAY, expected_window: '1p-5p', tenant_rsvp: 'Unsure', tenant_name: 'Sam Cho' });
  const R4 = D({ id: 'R4', order_number: 'H1111-000004', item_type: 'Range', delivery_address: '8 Quiet St', expected_date: TODAY, expected_window: '8a-12p', tenant_name: 'Lee Wu' });
  const R5 = D({ id: 'R5', order_number: 'H1111-000005', item_type: 'Dishwasher', delivery_address: '3 Done Dr', expected_date: TODAY, status: 'Delivered', tenant_rsvp: 'Declined', tenant_rsvp_note: 'earlier note' });
  const R6 = D({ id: 'R6', order_number: XSS, item_type: 'Microwave', delivery_address: XSS, expected_date: '2026-10-25', tenant_rsvp: 'Declined', tenant_rsvp_at: XSS, tenant_rsvp_note: XSS });
  const R7 = D({ id: 'R7', order_number: 'H1111-000007', item_type: 'Freezer', delivery_address: '9 Hold Ct', expected_date: '2026-10-26', status: 'Cancelled' });
  const ROWS = [R1, R2, R3, R4, R5, R6, R7];
  const mockHub = async (page, rows) => {
    await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) { /* ignore */ } });
    await page.route(WORKER + '/**', async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/deliveries') return jres(route, { today: TODAY, count: rows.length, deliveries: rows });
      if (p === '/version') return jres(route, { version: 'test' });
      if (['/properties', '/units', '/tenants', '/workorders', '/invoices', '/vendors', '/vendor-bills'].includes(p)) return jres(route, []);
      if (p === '/stale-wos') return jres(route, { ok: true, count: 0, stale: [], threshold_days: 4 });
      return jres(route, { ok: false });
    });
  };
  for (const vp of [{ n: 'phone 375px', w: 375, h: 800 }, { n: 'desktop 1280px', w: 1280, h: 900 }]) {
    console.log('\n=== badges, ' + vp.n + ' ===');
    {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } }); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      await mockHub(page, ROWS);
      await page.goto(url('deliveries.html'), { waitUntil: 'load' });
      await page.waitForSelector('#lists .dcard');
      ok(errs.length === 0, 'deliveries: no JS errors (' + errs.slice(0, 2).join(' | ') + ')');
      const st = (id) => page.locator('#lists .dcard[data-id="' + id + '"] .rsvp').first().getAttribute('data-rsvp').catch(() => null);
      ok(await st('R1') === 'no' && await st('R2') === 'yes' && await st('R3') === 'unsure' && await st('R4') === 'none', 'deliveries: Declined / Confirmed / Unsure / No answer yet badges on the right rows');
      ok(await page.locator('#lists .dcard[data-id="R5"] .rsvp[data-rsvp="none"]').count() === 0, 'deliveries: a delivered row does not say "No answer yet"');
      ok(await page.locator('#lists .dcard[data-id="R5"] .rsvp.no.past').count() === 1, 'deliveries: a declined answer on a delivered row stays visible but quiet');
      ok(await page.locator('#lists .dcard[data-id="R7"] .rsvp').count() === 0, 'deliveries: a cancelled row has no RSVP badge');
      const d1 = await page.locator('#lists .dcard[data-id="R1"]').innerText();
      ok(/Tenant: Declined/.test(d1) && /Oct 23, 4:12 PM/.test(d1), 'deliveries: Declined row shows who/what and the time (ET)');
      ok(/Out of town until Saturday/.test(d1), 'deliveries: the tenant\'s note is shown');
      const noteH = await page.locator('#lists .dcard[data-id="R1"] [data-rsvp-note]').evaluate((e) => e.getBoundingClientRect().height);
      ok(noteH < 140, 'deliveries: a long note is clamped, not a wall of text (' + Math.round(noteH) + 'px)');
      const style = await page.evaluate(() => { const b = getComputedStyle(document.querySelector('.dcard[data-id="R1"] .rsvp.no')); const c = getComputedStyle(document.querySelector('.dcard[data-id="R1"]')); const o = getComputedStyle(document.querySelector('.dcard[data-id="R2"] .rsvp.yes')); return { bg: b.backgroundColor, fg: b.color, border: c.borderLeftWidth, fs: parseFloat(b.fontSize), ofs: parseFloat(o.fontSize) }; });
      ok(contrast(parseRgb(style.fg), parseRgb(style.bg)) >= 4.5, 'deliveries: Declined badge contrast >= 4.5:1 (' + contrast(parseRgb(style.fg), parseRgb(style.bg)).toFixed(1) + ')');
      ok(parseFloat(style.border) >= 4 && style.fs > style.ofs, 'deliveries: Declined stands out (solid red pill, bigger than the others, 5px red edge on the card)');
      ok(await page.locator('#lists .dcard.rsvp-declined').count() === 2, 'deliveries: only open declined rows get the red edge (R1, R6); the delivered one does not');
      ok(await page.evaluate(() => !window.__xss), 'deliveries: hostile order / address / stamp / note did not execute');
      ok(await noHScroll(page), 'deliveries: no horizontal scroll');
      const spill = await page.evaluate(() => [...document.querySelectorAll('#lists *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
      ok(spill === 0, 'deliveries: nothing spills past the screen edge (' + spill + ')');
      const short = await page.evaluate(() => [...document.querySelectorAll('#lists .actions .btn')].filter((b) => b.getBoundingClientRect().height < 36).length);
      ok(short === 0, 'deliveries: action buttons still >= 36px');
      if (SHOTS && vp.w === 375) await page.screenshot({ path: join(SHOTS, 'badges-deliveries.png'), fullPage: true });
      await page.close();
    }
    {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } }); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      await mockHub(page, ROWS);
      await page.goto(url('command-center.html'), { waitUntil: 'load' });
      await page.waitForSelector('#deliv-card');
      ok(errs.length === 0, 'command-center: no JS errors (' + errs.slice(0, 2).join(' | ') + ')');
      const st = (id) => page.locator('#deliv-card .deliv-row[data-id="' + id + '"] .rsvp').first().getAttribute('data-rsvp').catch(() => null);
      ok(await st('R1') === 'no' && await st('R2') === 'yes' && await st('R3') === 'unsure' && await st('R4') === 'none', 'command-center: same four badges on today\'s rows');
      ok(await page.locator('#deliv-card .deliv-row[data-id="R5"] .rsvp[data-rsvp="none"]').count() === 0, 'command-center: delivered row does not nag');
      const r1 = await page.locator('#deliv-card .deliv-row[data-id="R1"]').innerText();
      ok(/Tenant: Declined/.test(r1) && /Oct 23, 4:12 PM/.test(r1) && /Out of town until Saturday/.test(r1), 'command-center: Declined shows the time and the note');
      ok(await page.locator('#deliv-card .deliv-row.rsvp-declined').count() === 1, 'command-center: the declined row has the red edge');
      const bg = await page.evaluate(() => { const b = getComputedStyle(document.querySelector('#deliv-card .rsvp.no')); return { bg: b.backgroundColor, fg: b.color }; });
      ok(contrast(parseRgb(bg.fg), parseRgb(bg.bg)) >= 4.5, 'command-center: Declined badge contrast >= 4.5:1 (' + contrast(parseRgb(bg.fg), parseRgb(bg.bg)).toFixed(1) + ')');
      ok(await page.evaluate(() => !window.__xss), 'command-center: nothing hostile executed');
      ok(await noHScroll(page), 'command-center: no horizontal scroll');
      if (SHOTS && vp.w === 375) await page.screenshot({ path: join(SHOTS, 'badges-command-center.png') });
      await page.close();
    }
    {
      // Worker has not shipped the new fields yet (older Worker): pages must behave exactly as before
      const old = ROWS.map((r) => { const c = Object.assign({}, r); delete c.tenant_rsvp; delete c.tenant_rsvp_at; delete c.tenant_rsvp_note; return c; });
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } }); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      await mockHub(page, old);
      await page.goto(url('deliveries.html'), { waitUntil: 'load' }); await page.waitForSelector('#lists .dcard');
      ok(errs.length === 0 && await page.locator('#lists .rsvp[data-rsvp="no"], #lists .rsvp[data-rsvp="yes"]').count() === 0, 'older Worker without the RSVP fields: no errors, no false Confirmed/Declined');
      await page.close();
    }
  }

  await browser.close();
  console.log('\ndelivery RSVP UI: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
