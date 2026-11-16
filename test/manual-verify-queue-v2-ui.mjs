// Queue v2 (Nov 16 2026): the Proposals / build-queue board. Real headless Chromium against the shipped proposals.html with every
// Hub and GitHub call intercepted (mock data only; nothing real is read, written or texted).
// Run: node test/manual-verify-queue-v2-ui.mjs      Screenshots go to $SHOTS (default: <tmp>/queue-v2-shots).
import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = process.env.PAGE_FILE || path.join(__dirname, '..', 'proposals.html');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'queue-v2-shots');
const TAG = process.env.SHOT_TAG || 'after';
const ONLY_SHOTS = process.env.ONLY_SHOTS === '1';          // used to photograph the OLD page with the same mock data
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS — ' + m); };
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const base = (o) => Object.assign({ Timestamp: ago(400), Rank: '', Problem: 'Vendors cannot tell which trade a job is for until they open it.', Impact: 'Fewer wrong-trade declines.', Effort: 'S', Tag: '', First_Step: 'Add the trade under the job title.', Status: 'proposed', Risk_Class: '', Brett_Note: '', Snooze_Until: '', PR_Number: '', Build_State: '', Build_Updated: '', Stage: '', Stage_Updated: '', Stage_Log: '', Blocked_Reason: '', Blocked_On: '', Pinned: '', stuck: false, stage_hours: 5 }, o);
const DATA = () => [
  base({ ID: '101', Title: 'TEST-Show the vendor trade on the job card', Rank: '1', Tag: 'QUICK WIN', stage: 'review', Effort: 'M - about a day of work, touches vendor.html and the card renderer, and needs one new column on the work order list before it can ship' }),
  base({ ID: '102', Title: 'TEST-Fix the invoice total when a deposit was already paid', Rank: '2', stage: 'review', Dup_Of: '101' }),
  base({ ID: '115', Title: '<img src=x onerror=window.__xss=1> TEST-odd title', Rank: '3', stage: 'review' }),
  base({ ID: '114', Title: 'TEST-Looks already built', stage: 'review', Shipped_Match: 'looks already built: [FL-20261013-1130-qu]' }),
  base({ ID: '103', Title: 'TEST-Wider cards on the proposals page', Status: 'greenlit', Risk_Class: 'SAFE', stage: 'approved', Effort: 'L: big' }),
  base({ ID: '104', Title: 'TEST-Remember the last filter', Status: 'greenlit', Risk_Class: 'SAFE', stage: 'queued', Pinned: 'TRUE' }),
  base({ ID: '105', Title: 'TEST-Bulk edit for work order notes', Status: 'building', Build_State: 'building', Risk_Class: 'GATED', stage: 'building', stuck: true, stage_hours: 30, Stage_Updated: ago(30) }),
  base({ ID: '106', Title: 'TEST-Clearer empty state on Deliveries', Status: 'done', Build_State: 'pr_open', Risk_Class: 'GATED', PR_Number: '571', stage: 'pr_open', Stage_Updated: ago(6), Stage_Log: ago(6) + ' | build session | building -> pr_open | PR #571' }),
  base({ ID: '107', Title: 'TEST-Rename the Keys page tabs', Status: 'held', Build_State: 'held', Risk_Class: 'GATED', stage: 'blocked', Blocked_On: 'brett', Blocked_Reason: 'Needs your call: two tab names are possible.' }),
  base({ ID: '108', Title: 'TEST-Faster work order search', Status: 'held', Build_State: 'held', Risk_Class: 'SAFE', stage: 'blocked', Blocked_On: 'build', Blocked_Reason: 'Tests are red on the search index.' }),
  base({ ID: '109', Title: 'TEST-Sentence case on the Hub buttons', Status: 'done', Build_State: 'live', Risk_Class: 'SAFE', PR_Number: '560', stage: 'merged', Stage_Updated: ago(0.2) }),
  base({ ID: '110', Title: 'TEST-Bigger tap targets on Trash', Status: 'done', Build_State: 'live', Risk_Class: 'SAFE', PR_Number: '555', stage: 'live', Stage_Updated: ago(48) }),
  base({ ID: '111', Title: 'TEST-Old item finished by hand', Status: 'done', Risk_Class: 'GATED', stage: 'done', Stage_Updated: ago(72) }),
  base({ ID: '112', Title: 'TEST-Snoozed idea', stage: 'snoozed', Snooze_Until: new Date(Date.now() + 5 * 86400e3).toISOString() }),
  base({ ID: '113', Title: 'TEST-Dropped idea', Status: 'dropped', stage: 'dropped', Drop_Reason: 'not worth it' }),
];
const REVIEW = { ok: true, rows: [{ Timestamp: ago(20), Total_Jobs: '30', Success_Rate: '0.93', Escalation_Rate: '0.05', Stuck_Patterns: '', Proposal_JSON: JSON.stringify([
  { rank: 1, title: 'TEST-Archive finished deliveries after ninety days', problem: 'The deliveries list keeps growing.', action: 'Hide delivered rows older than 90 days behind a toggle.', impact: 'Shorter list.', effort: 'S', tag: 'QUICK WIN' },
  { rank: 2, title: 'TEST-Show the vendor trade on the job card', problem: 'Vendors cannot see the trade', action: 'Add the trade', effort: 'M' }]) }] };

async function open(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: opts.w, height: opts.h || 900 } }, opts.touch ? { hasTouch: true, isMobile: true } : {}));
  await ctx.addInitScript(() => { try { localStorage.setItem('mh_auth', 'adm'); } catch (e) { console.warn(e); } });
  const page = await ctx.newPage();
  const st = { rows: DATA(), posts: [], notes: [], approves: [], failQueue: false, failNext: false, slow: 0, partial: false };
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('https://maintenance-hub.brett-2f8.workers.dev/**', async route => {
    const u = route.request().url(), m = route.request().method();
    const body = m === 'POST' ? JSON.parse(route.request().postData() || '{}') : null;
    const send = (d, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) });
    if (u.includes('/ops-review-log')) return send(REVIEW);
    if (u.includes('/ops-queue?all=1')) return st.failQueue ? send({ error: 'could not read the queue sheet: 503' }, 503) : send({ ok: true, all: true, count: st.rows.length, truncated: false, queue: st.rows });
    if (u.endsWith('/ops-queue/sync')) return send({ ok: true, checked: 0, changed: [], errors: [], stuck: [] });
    if (u.endsWith('/ops-queue-update')) { st.notes.push(body); return send({ success: true }); }
    if (u.endsWith('/ops-approve')) { st.approves.push(body); return send({ ok: true, queued: body.items.length, promoted: 0, already: 0 }); }
    if (u.endsWith('/ops-queue-stage')) {
      st.posts.push(body);
      if (st.slow) await new Promise(r => setTimeout(r, st.slow));
      if (st.failNext) { st.failNext = false; return send({ id: body.id, ok: false, status: 500, error: 'the save did not stick for: Stage' }, 500); }
      const apply = (id) => {
        const r = st.rows.find(x => x.ID === String(id)); if (!r) return { id: String(id), ok: false, status: 404, error: 'not_found: no queue row with that id' };
        if (st.partial && r.ID === '105') return { id: r.ID, ok: false, status: 409, error: 'PR is not merged' };
        let reason = '';
        if (body.risk_class) { const auto = body.risk_class === 'AUTO'; const risky = /invoice|deposit/i.test(r.Title); r.Risk_Class = auto ? (risky ? 'GATED' : 'SAFE') : body.risk_class; if (auto) reason = risky ? 'it mentions "invoice"' : 'nothing in the title or problem looks like money, sign-in, texting or contact details'; }
        if (body.pinned !== undefined) r.Pinned = body.pinned ? 'TRUE' : '';
        if (body.stage) { r.stage = body.stage; r.stuck = false; r.Stage_Updated = new Date().toISOString(); if (body.stage === 'queued') r.Pinned = 'TRUE'; if (body.stage === 'dropped') r.Drop_Reason = body.reason || ''; if (body.stage === 'snoozed') r.Snooze_Until = new Date(Date.now() + (body.snooze_days || 1) * 86400e3).toISOString(); }
        return { id: r.ID, ok: true, stage: r.stage, risk_class: r.Risk_Class || 'GATED', risk_reason: reason, warnings: [], confirmed: true };
      };
      if (Array.isArray(body.ids)) { const results = body.ids.map(apply); const failed = results.filter(x => !x.ok).length; return send({ ok: failed === 0, bulk: true, saved: results.length - failed, failed, results }); }
      const r1 = apply(body.id); return send(r1, r1.ok ? 200 : r1.status);
    }
    if (u.includes('/version')) return send({ version: 'v1' });
    if (u.includes('/failures/open')) return send({ ok: true, counts: { open: 0, P0: 0, P1: 0, P2: 0, acknowledged: 0 }, failures: [] });
    return send({ ok: true });
  });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + PAGE);
  await page.waitForFunction(() => document.querySelectorAll('.card, .qcard').length > 3, null, { timeout: 15000 });
  return { ctx, page, st, errors };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page, w) => { const f = path.join(SHOTS, TAG + '-' + w + '.png'); await page.screenshot({ path: f, fullPage: w === 412 }); console.log('SCREENSHOT ' + f); };
const lastPost = (st) => st.posts[st.posts.length - 1];
const card = (page, id) => page.locator('.card[data-id="' + id + '"]');

(async () => {
  const browser = await chromium.launch();
  if (ONLY_SHOTS) {
    for (const w of [412, 1366, 1920]) { const { ctx, page } = await open(browser, { w, touch: w === 412 }); await shot(page, w); await ctx.close(); }
    await browser.close(); return;
  }

  // ---------- 1. Phone, 412px, touch ----------
  {
    const { ctx, page, st, errors } = await open(browser, { w: 412, h: 915, touch: true });
    const heads = await page.locator('.col h2').allTextContents();
    ok(heads.join('|') === 'Review|Approved and queued|Building|Waiting on you|Live', 'five stage groups in order: ' + heads.join(', '));
    const counts = await page.locator('.col .count').allTextContents();
    ok(counts.join() === '3,2,2,2,3', 'group headers carry counts (review 3, approved+queued 2, building 2, waiting 2, live 3): ' + counts.join());
    const top = (await page.locator('#counts').textContent()).replace(/\s+/g, ' ');
    ok(/3 built this week/.test(top) && /2 waiting on you/.test(top) && /2 blocked/.test(top) && /1 stuck/.test(top), 'header line: built this week, waiting on you, blocked, stuck (' + top.trim() + ')');
    ok(await noSideScroll(page), 'no sideways scroll at 412px');
    ok(await page.evaluate(() => window.__xss) === undefined && (await card(page, '115').locator('.ctitle').textContent()).includes('<img src=x'), 'a title containing HTML is shown as text, not run');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.col[data-g=review] .cards')).gridTemplateColumns.split(' ').length) === 1, 'single column of cards on a phone');
    // chips
    const chipInfo = await page.evaluate(() => { const c = document.querySelector('.card[data-id="101"]'); const cr = c.getBoundingClientRect(); const chips = [...c.querySelectorAll('.chip')]; return { texts: chips.map(x => x.textContent), inside: chips.every(x => x.getBoundingClientRect().right <= cr.right + 0.5), ws: getComputedStyle(chips[0]).whiteSpace }; });
    ok(chipInfo.inside && chipInfo.ws !== 'nowrap', 'chips wrap and stay inside the card');
    ok(chipInfo.texts.includes('Effort M') && !chipInfo.texts.some(t => /about a day/.test(t)), 'the Effort chip is just the size letter (M), never the long text: ' + chipInfo.texts.join(' / '));
    await card(page, '101').locator('.ctitle').tap();
    ok(/about a day of work, touches vendor\.html/.test(await card(page, '101').locator('.detail').textContent()), 'the long Effort text is in the card body');
    ok(await card(page, '101').locator('select.risk').inputValue() === 'AUTO', 'Approve defaults to "Decide for me", not Gated');
    // sizes, tap targets, contrast
    const audit = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const small = [], tiny = [], lowc = [];
      const lum = (c) => { const a = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
      const rgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
      const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const b = rgb(getComputedStyle(x).backgroundColor); if (b && b.a > 0.95) return b.c; } return [255, 255, 255]; };
      for (const e of document.querySelectorAll('body *')) {
        if (!vis(e) || e.closest('#rc-navbar select') || e.tagName === 'OPTION' || e.tagName === 'OPTGROUP' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
        const hasText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (hasText) {
          const cs = getComputedStyle(e);
          if (parseFloat(cs.fontSize) < 13) small.push(e.tagName + '.' + e.className + ' ' + cs.fontSize + ' "' + e.textContent.trim().slice(0, 20) + '"');
          if (!e.disabled && !e.closest(':disabled')) { const f = rgb(cs.color), b = bgOf(e); if (f) { const l1 = lum(f.c), l2 = lum(b); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (ratio < 4.5) lowc.push(e.tagName + '.' + e.className + ' ' + ratio.toFixed(2) + ' "' + e.textContent.trim().slice(0, 20) + '"'); } }
        }
        if (e.matches('button, select, summary, a.back, label.pick')) { const r = e.getBoundingClientRect(); if (r.height < 43.5 || (e.matches('button, label.pick') && r.width < 43.5)) tiny.push(e.tagName + '.' + e.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + e.textContent.trim().slice(0, 16) + '"'); }
      }
      return { small, tiny, lowc, coarse: matchMedia('(hover:none) and (pointer:coarse)').matches, realButtons: [...document.querySelectorAll('[data-act]')].every(e => e.tagName === 'BUTTON') };
    });
    ok(audit.small.length === 0, 'no text under 13px ' + JSON.stringify(audit.small.slice(0, 5)));
    ok(audit.coarse && audit.tiny.length === 0, 'every button, menu and checkbox target is at least 44px on touch ' + JSON.stringify(audit.tiny.slice(0, 5)));
    ok(audit.lowc.length === 0, 'text contrast is at least 4.5:1 everywhere ' + JSON.stringify(audit.lowc.slice(0, 5)));
    ok(audit.realButtons, 'every action is a real <button>');
    await shot(page, 412);

    // filters (before anything is changed)
    await page.locator('#fStuck').tap();
    ok((await page.locator('.card').count()) === 1 && (await card(page, '105').count()) === 1, 'Stuck filter shows only the stuck row');
    await page.locator('#fStuck').tap(); await page.locator('#fMine').tap();
    ok((await page.locator('.card').evaluateAll(els => els.map(e => e.dataset.id).sort().join())) === '106,107', 'Waiting on me shows the open PR and the row blocked on Brett');
    await page.locator('#fMine').tap(); await page.selectOption('#fStage', 'dropped');
    ok((await page.locator('.card').count()) === 1 && (await card(page, '113').count()) === 1 && (await page.locator('.col[data-g=other] h2').textContent()) === 'Other', 'Stage filter reaches dropped rows');
    await page.selectOption('#fStage', ''); await page.selectOption('#fRisk', 'SAFE');
    ok((await page.locator('.card').evaluateAll(els => els.every(e => [...e.querySelectorAll('.chip')].some(c => c.textContent === 'Safe')))), 'Risk filter shows only safe rows');
    await page.selectOption('#fRisk', ''); await page.selectOption('#fTag', 'QUICK WIN');
    ok((await page.locator('.card').count()) === 1 && (await card(page, '101').count()) === 1, 'Tag filter works');
    await page.locator('#fClear').tap(); await page.fill('#qsearch', '112');
    ok((await page.locator('.card').count()) === 1 && (await card(page, '112').count()) === 1, 'search by number finds a snoozed row');
    await page.fill('#qsearch', 'tap targets');
    ok((await card(page, '110').count()) === 1, 'search by title works');
    await page.locator('#fClear').tap();
    ok((await page.locator('.card').count()) === 11, 'Clear filters brings the board back');

    // approve with "Decide for me"
    await card(page, '101').locator('.detail [data-act=approve]').tap();
    await page.waitForFunction(() => document.querySelector('.col[data-g=approved] .card[data-id="101"]'));
    ok(JSON.stringify(lastPost(st)) === JSON.stringify({ id: '101', stage: 'approved', risk_class: 'AUTO' }), 'Approve posts stage approved with risk AUTO to /ops-queue-stage');
    ok(/Approved as safe/.test(await page.locator('#toast').textContent()), 'the result says what was decided (safe)');
    await card(page, '102').locator('.cbtns [data-act=approve]').tap();
    await page.waitForFunction(() => document.querySelector('.col[data-g=approved] .card[data-id="102"]'));
    ok(/Approved as gated \(it mentions "invoice"\)/.test(await page.locator('#toast').textContent()) && (await card(page, '102').locator('.chip.gated').count()) === 1, 'an invoice item is decided as gated, with the reason shown');
    // Build now -> queued
    await card(page, '101').locator('[data-act=buildnow]').first().tap();
    await page.waitForFunction(() => /Queued for the next build run/.test(document.querySelector('.card[data-id="101"]').textContent));
    ok(lastPost(st).stage === 'queued' && lastPost(st).id === '101', 'Build now records stage queued and shows "Queued for the next build run"');
    // change risk at pr_open
    await card(page, '106').locator('.ctitle').tap();
    ok((await card(page, '106').locator('[data-act=openpr]').count()) >= 1, 'a row with an open PR offers Open PR');
    await card(page, '106').locator('.detail [data-act=risk][data-v=SAFE]').tap();
    await page.waitForFunction(() => document.querySelector('.card[data-id="106"] .chip.safe'));
    ok(JSON.stringify(lastPost(st)) === JSON.stringify({ id: '106', risk_class: 'SAFE' }), 'risk can be changed at PR open and saves at once');
    // pull out at building
    await card(page, '105').locator('.ctitle').tap();
    ok((await card(page, '105').locator('[data-act=retry-build]').count()) >= 1 && /No change for 30 hours/.test(await card(page, '105').textContent()), 'a stuck build says so and offers Retry');
    await card(page, '105').locator('.detail [data-act=toreview]').tap();
    await page.waitForFunction(() => document.querySelector('.col[data-g=review] .card[data-id="105"]'));
    ok(JSON.stringify(lastPost(st)) === JSON.stringify({ id: '105', stage: 'review' }), 'pull out at building: back to review');
    // snooze with days
    await card(page, '115').locator('.ctitle').tap();
    await card(page, '115').locator('.detail input.days').fill('7');
    await card(page, '115').locator('.detail [data-act=snooze]').tap();
    await page.waitForFunction(() => !document.querySelector('.card[data-id="115"]'));
    ok(lastPost(st).stage === 'snoozed' && lastPost(st).snooze_days === 7, 'pull out: snooze with days');
    // drop with reason
    await card(page, '108').locator('.ctitle').tap();
    ok((await card(page, '108').locator('[data-act=unblock]').count()) >= 1, 'a blocked row offers Unblock');
    const before = st.posts.length;
    await card(page, '108').locator('.detail [data-act=dropask]').tap();
    await card(page, '108').locator('.detail [data-act=drop]').tap();
    ok(st.posts.length === before && /reason first/.test(await page.locator('#toast').textContent()), 'Drop asks for a reason and sends nothing without one');
    await card(page, '108').locator('.detail input.reason').fill('covered by #103');
    await card(page, '108').locator('.detail [data-act=drop]').tap();
    await page.waitForFunction(() => !document.querySelector('.card[data-id="108"]'));
    ok(lastPost(st).stage === 'dropped' && lastPost(st).reason === 'covered by #103', 'pull out: drop with a reason');
    // pin
    await card(page, '103').locator('.ctitle').tap();
    await card(page, '103').locator('.detail [data-act=pin]').tap();
    await page.waitForFunction(() => document.querySelector('.card[data-id="103"].pinned'));
    ok(lastPost(st).pinned === true, 'Pin to top saves and the card is marked pinned');
    // error + retry
    st.failNext = true;
    await card(page, '109').locator('[data-act=marklive]').first().tap();
    await page.waitForSelector('#toast .banner [data-act=retry]');
    ok(/That did not save\. the save did not stick/.test(await page.locator('#toast').textContent()), 'a failed save is shown in red with the reason');
    ok(await card(page, '109').locator('[data-act=marklive]').first().isEnabled(), 'the button is usable again after a failure');
    await page.locator('#toast [data-act=retry]').tap();
    await page.waitForFunction(() => /Marked live/.test(document.querySelector('#toast').textContent));
    ok(st.rows.find(r => r.ID === '109').stage === 'live', 'Try again repeats the save and it lands');
    // double-tap guard
    st.slow = 400; const c0 = st.posts.length;
    await page.evaluate(() => { const b = document.querySelector('.card[data-id="103"] .cbtns [data-act=buildnow]'); b.click(); b.click(); b.click(); });
    await page.waitForFunction(() => /Queued for the next build run/.test(document.querySelector('.card[data-id="103"]').textContent));
    st.slow = 0;
    ok(st.posts.length === c0 + 1, 'three fast taps make exactly one save');
    // bulk
    await card(page, '106').locator('input.bulk').check(); await card(page, '107').locator('input.bulk').check(); await card(page, '105').locator('input.bulk').check();
    ok(await page.locator('#bulkbar').isVisible() && (await page.locator('#bulkN').textContent()) === '3 selected', 'selecting rows shows the bulk bar');
    st.partial = true;
    await page.locator('#bulkbar [data-act=bgated]').tap();
    await page.waitForFunction(() => /did not save/.test(document.querySelector('#toast').textContent));
    ok(JSON.stringify(lastPost(st).ids.slice().sort()) === '["105","106","107"]' && lastPost(st).risk_class === 'GATED', 'bulk set risk sends one request with every id');
    ok(/2 set to gated, 1 did not save: #105 \(PR is not merged\)/.test(await page.locator('#toast').textContent()) && (await page.locator('#bulkN').textContent()) === '1 selected', 'a partly failed bulk change names the row that failed and keeps it selected');
    st.partial = false;
    await page.locator('#bulkbar [data-act=bpin]').tap();
    await page.waitForFunction(() => /1 item pinned/.test(document.querySelector('#toast').textContent));
    ok(lastPost(st).pinned === true && !(await page.locator('#bulkbar').isVisible()), 'bulk pin works and the bar goes away');
    await card(page, '106').locator('input.bulk').check();
    await page.locator('#bulkbar [data-act=bdropask]').tap(); await page.fill('#bulkReason', 'bulk tidy'); await page.locator('#bulkbar [data-act=bdrop]').tap();
    await page.waitForFunction(() => /1 item dropped/.test(document.querySelector('#toast').textContent));
    ok(lastPost(st).stage === 'dropped' && lastPost(st).reason === 'bulk tidy', 'bulk drop asks for a reason');
    // weekly list
    await page.locator('#sec-week input.wkbox').first().check();
    await page.locator('#wkGo').tap();
    await page.waitForFunction(() => /Approved 1 item/.test(document.querySelector('#toast').textContent));
    ok(st.approves.length === 1 && st.approves[0].items[0].risk_class === 'AUTO' && (await page.locator('#sec-week input.wkbox').count()) === 1, 'weekly review: only the new finding is offered, and it is approved with risk AUTO');
    // queue cannot load
    st.failQueue = true; await page.locator('#refresh').tap();
    await page.waitForSelector('#body .banner');
    ok(/Could not load the queue/.test(await page.locator('#body .banner').textContent()) && (await page.locator('#body [data-act=reload]').count()) === 1, 'if the queue cannot load the page says so with a Try again button (never an empty board)');
    st.failQueue = false; await page.locator('#body [data-act=reload]').tap(); await page.waitForSelector('.card');
    ok(await noSideScroll(page), 'still no sideways scroll after all of that');
    ok(!/start-build|Start Build/.test(await page.content()), 'the Start Build flow is gone from the page');
    ok(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
    await ctx.close();
  }

  // ---------- 2. Tablet, 900px: two columns ----------
  {
    const { ctx, page } = await open(browser, { w: 900, h: 900 });
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.col[data-g=review] .cards')).gridTemplateColumns.split(' ').length) === 2, 'two columns of cards at 900px');
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('pane')).display) === 'none' && await noSideScroll(page), 'no detail pane and no sideways scroll at 900px');
    await ctx.close();
  }

  // ---------- 3. Laptop 1366 and desktop 1920: board + detail pane ----------
  for (const w of [1366, 1920]) {
    const { ctx, page, st, errors } = await open(browser, { w, h: w === 1366 ? 768 : 1080 });
    const geo = await page.evaluate(() => { const cols = [...document.querySelectorAll('.board > .col')].map(c => c.getBoundingClientRect()); const pane = document.getElementById('pane').getBoundingClientRect(); return { n: cols.length, sameRow: cols.every(c => Math.abs(c.top - cols[0].top) < 2), asc: cols.every((c, i) => i === 0 || c.left > cols[i - 1].left), minW: Math.round(Math.min(...cols.map(c => c.width))), paneLeft: pane.left, lastRight: cols[cols.length - 1].right, paneW: Math.round(pane.width), bodyW: document.querySelector('.wrap').getBoundingClientRect().width }; });
    ok(geo.n === 5 && geo.sameRow && geo.asc, w + 'px: a board with one column per stage group, side by side');
    ok(geo.paneW >= 300 && geo.paneLeft >= geo.lastRight, w + 'px: detail pane sits to the right of the board (' + geo.paneW + 'px wide, columns at least ' + geo.minW + 'px)');
    ok(geo.bodyW > w * 0.95, w + 'px: the page uses the full width (no narrow fixed column)');
    ok(await noSideScroll(page), 'no sideways scroll at ' + w + 'px');
    await card(page, '106').locator('.ctitle').click();
    ok(/TEST-Clearer empty state on Deliveries/.test(await page.locator('#pane').textContent()) && /History/.test(await page.locator('#pane').textContent()) && (await page.locator('#pane [data-act=risk]').count()) === 2, w + 'px: clicking a card shows its details, history and controls in the pane');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.card[data-id="106"] .detail')).display) === 'none', w + 'px: the card itself stays compact');
    await page.locator('#pane [data-act=risk][data-v=SAFE]').click();
    await page.waitForFunction(() => document.querySelector('.card[data-id="106"] .chip.safe'));
    ok(lastPost(st).id === '106' && lastPost(st).risk_class === 'SAFE' && /TEST-Clearer empty state/.test(await page.locator('#pane').textContent()), w + 'px: the pane controls save and the row stays selected');
    await shot(page, w);
    ok(errors.length === 0, w + 'px: no page errors ' + JSON.stringify(errors));
    await ctx.close();
  }

  await browser.close();
  console.log('\nqueue-v2 UI: ' + n + '/' + n + ' checks passed. Screenshots in ' + SHOTS);
})().catch(e => { console.error('FAILED — ' + (e && e.stack || e)); process.exit(1); });
