// Delivery RSVP screens (Oct 23 2026, delivery watcher addendum 1, section D):
//   - rsvp.html           the tenant-facing page the "can you be there" text links to (GET/POST /delivery/rsvp)
//   - deliveries.html     RSVP badge per delivery (Declined stands out), time + note
//   - command-center.html same badge on the Today's deliveries card
// Source-structure checks plus the page's pure functions run in a sandbox. The headless-browser pass (real clicks, phone width,
// mocked Worker) is test/manual-verify-delivery-rsvp-ui.mjs, same split as the other UI features.
// Run: node --test test/delivery-rsvp-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const rsvp = read('rsvp.html');
const dl = read('deliveries.html');
const cc = read('command-center.html');
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const pageJs = inlineScripts(rsvp).join('\n');
const head = rsvp.slice(0, rsvp.indexOf('</head>'));
// grab a `function name(` body by brace counting (works for nested functions inside the page's IIFE too)
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const sandbox = (src, names, pre) => { const ctx = {}; vm.createContext(ctx); if (pre) vm.runInContext(pre, ctx); for (const n of names) vm.runInContext(grab(src, n), ctx); return ctx; };
// text a person can see on the page: script tags with a src, comments and the CSS are not copy
const visibleCopy = pageJs + '\n' + rsvp.slice(rsvp.indexOf('<body>'), rsvp.indexOf('<script>'));

// ───────────────────────── hosting / conventions ─────────────────────────
test('rsvp.html follows the repo conventions for public token pages (flat file, test-login + failure reporter first in <head>)', () => {
  assert.ok(fs.existsSync(new URL('../rsvp.html', import.meta.url)), 'rsvp.html lives at the repo root next to the other portal pages (served from PORTAL_BASE)');
  const t = head.indexOf('src="test-login.js"'), f = head.indexOf('src="failure-reporter.js"');
  assert.ok(t > 0 && f > t, 'test-login.js first, then failure-reporter.js');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(head), 'no inline script before the shims');
  assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(head), 'mobile viewport');
  assert.ok(/<meta name="robots" content="noindex,nofollow">/.test(head), 'a private link must not be indexed');
  assert.ok(/<html lang="en">/.test(rsvp));
  assert.ok(/<title>[^<]{3,}<\/title>/.test(head) && !/token|\?t=/i.test(head.match(/<title>[^<]*<\/title>/)[0]), 'title has no secret in it');
});

test('rsvp.html: the token in the URL never leaves the page (no referrer, nothing third-party, nothing stored)', () => {
  assert.ok(/<meta name="referrer" content="no-referrer">/.test(head), 'no Referer header on any request or outbound link');
  assert.ok(/referrerPolicy:'no-referrer'/.test(pageJs), 'fetches also say no-referrer');
  const urls = [...rsvp.matchAll(/(?:src|href|action)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(urls.filter((u) => /^(https?:)?\/\//.test(u)), [], 'no external src/href/action at all');
  assert.ok(!/<link\b|@import|url\(/.test(rsvp), 'no external stylesheet, font or image');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(pageJs), 'token and answers are never written to browser storage');
  assert.ok(!/console\.(log|info|debug|warn|error)/.test(pageJs), 'token is never logged');
  assert.ok(!/document\.referrer|location\.href|history\.(push|replace)State/.test(pageJs), 'token is not copied into other URLs');
  assert.ok(!/<a\b[^>]*target=/.test(rsvp), 'no outbound links at all');
});

test('rsvp.html is domain-neutral (ridgeco.app move): no hardcoded page origin, only the Worker URL and the staging-only override', () => {
  assert.ok(!/ridge-co\.github\.io|ridgeco\.app|github\.io/.test(rsvp), 'the page never names its own host, so GitHub Pages and ridgeco.app both work');
  const m = pageJs.match(/var WORKER=[^;]+;/);
  assert.ok(m, 'WORKER line');
  const run = (api) => { const ctx = { Q: { get: (k) => (k === 'api' ? api : null) } }; vm.createContext(ctx); vm.runInContext(m[0], ctx); return ctx.WORKER; };
  assert.equal(run(null), 'https://maintenance-hub.brett-2f8.workers.dev');
  assert.equal(run('https://maintenance-hub-staging.brett-2f8.workers.dev'), 'https://maintenance-hub-staging.brett-2f8.workers.dev');
  assert.equal(run('https://evil.example.com'), 'https://maintenance-hub.brett-2f8.workers.dev', 'a crafted ?api= can not redirect answers to another server');
  assert.equal(run('https://maintenance-hub-staging.brett-2f8.workers.dev.evil.com'), 'https://maintenance-hub.brett-2f8.workers.dev');
});

test('rsvp.html: every inline script block parses', () => {
  const blocks = inlineScripts(rsvp);
  assert.ok(blocks.length >= 1);
  blocks.forEach((b, i) => assert.doesNotThrow(() => new vm.Script(b, { filename: 'rsvp.html#' + i })));
});

// ───────────────────────── the contract with the Worker ─────────────────────────
test('rsvp.html calls exactly the section-B contract: GET /delivery/rsvp?t= and POST /delivery/rsvp {t, answer, note}', () => {
  assert.ok(/req\('GET','\/delivery\/rsvp\?t='\+encodeURIComponent\(TOKEN\)\)/.test(pageJs), 'GET with the token URL-encoded');
  assert.ok(/req\('POST','\/delivery\/rsvp',\{t:TOKEN,answer:a,note:note\}\)/.test(pageJs), 'POST body is {t, answer, note}');
  assert.deepEqual([...pageJs.matchAll(/\{a:'(\w+)'/g)].map((m) => m[1]), ['yes', 'no', 'unsure'], 'answers are yes | no | unsure, in that order');
  assert.ok(/NOTE_MAX=300/.test(pageJs) && /maxlength="'\+NOTE_MAX\+'"/.test(pageJs), 'note is capped at 300 in the box and again before sending');
  assert.ok((pageJs.match(/\/delivery\//g) || []).length === 2, 'no other endpoint is called');
});

test('rsvp.html shows only the allowed fields: first name, item, date, window, street (+ the tenant\'s own answer and note)', () => {
  const body = grab(pageJs, 'applyDetails');
  const used = [...body.matchAll(/\bj\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(used, ['date_text', 'first_name', 'item_type', 'street', 'window_text']);
  const whole = [...pageJs.matchAll(/\bj\.(\w+)/g)].map((m) => m[1]);
  const allowed = new Set(['first_name', 'item_type', 'date_text', 'window_text', 'street', 'current', 'note', 'ok', 'delivered', 'cancelled', 'expired', 'error', 'reason', 'status']);
  assert.deepEqual([...new Set(whole.filter((x) => !allowed.has(x)))], [], 'the page reads no other response field (phone, email, tenant ids, sheet ids, ...)');
});

test('rsvp.html never prints a server message or error text (friendly copy only)', () => {
  assert.ok(!/\.message\b/.test(pageJs), 'no response .message / error.message reaches the screen');
  assert.ok(!/\.error\b[^|]*\+|textContent\s*=\s*[^;]*\.error/.test(pageJs.replace(/String\(j\.error\|\|j\.reason\|\|''\)/, '')), 'the error code is only used to pick a state');
  assert.ok(!/alert\(|confirm\(|prompt\(/.test(pageJs), 'no browser dialogs');
});

// ───────────────────────── things that can go wrong ─────────────────────────
test('double tap: a second tap while saving is ignored, and the lock is set before the request starts', () => {
  const body = grab(pageJs, 'submit');
  assert.ok(/if\(S\.busy\|\|S\.phase!=='ready'\) return;/.test(body));
  assert.ok(body.indexOf('S.busy=a') > -1 && body.indexOf('S.busy=a') < body.indexOf("req('POST'"), 'lock first, request second');
  assert.ok(/S\.busy=''/.test(body), 'lock is released when the answer comes back (success or failure)');
  assert.ok(/aria-disabled/.test(pageJs) && !/\bdisabled="/.test(pageJs.replace(/aria-disabled/g, '')), 'buttons use aria-disabled so keyboard focus is not lost mid-save');
});

test('a failed save is never reported as saved, and keeps the note the person typed', () => {
  const body = grab(pageJs, 'submit');
  const ok = body.indexOf("c.kind==='ok'"), saved = body.indexOf('S.current=cur');
  assert.ok(ok > -1 && saved > ok, 'S.current is only set inside the ok branch');
  assert.ok(/if\(!cur\)\{S\.err=/.test(body), 'an ok reply without a valid answer is treated as not saved');
  assert.ok(/Your note is still here/.test(body), 'error copy says the note is kept');
  assert.ok(!/S\.draft=''/.test(body.slice(body.indexOf("S.err=c.kind==='slow'"))), 'draft is not cleared on failure');
});

test('stale page: refreshes on back/forward-cache restore, on returning to the tab, and when the connection comes back; timeouts exist', () => {
  assert.ok(/addEventListener\('pageshow'[\s\S]{0,80}persisted/.test(pageJs), 'bfcache restore re-reads the delivery');
  assert.ok(/visibilitychange/.test(pageJs) && /STALE_MS/.test(pageJs));
  assert.ok(/addEventListener\('online'/.test(pageJs));
  assert.ok(/AbortController/.test(pageJs) && /TIMEOUT_MS/.test(pageJs), 'requests time out instead of hanging');
  assert.ok(/The delivery details have been updated/.test(pageJs), 'a reschedule while the page was open is explained');
  assert.ok(/typing=S\.editing&&S\.draft!==S\.note/.test(pageJs), 'a refresh never wipes what the person is typing');
});

test('never a blank screen: every phase renders something, and unexpected replies map to a friendly state', () => {
  const r = grab(pageJs, 'render');
  for (const p of ['loading', 'ready', 'delivered', 'cancelled', 'invalid', 'slow']) assert.ok(r.includes("'" + p + "'"), 'render handles ' + p);
  assert.ok(/else html=viewSimple\(/.test(r), 'the default branch is a message with a Try again button');
  assert.ok(/<noscript>/.test(rsvp), 'no-JavaScript message');
  assert.ok(/Try again/.test(r) || /Try again/.test(grab(pageJs, 'viewSimple')));
  assert.ok(/One moment/.test(rsvp), 'loading text is in the static HTML too, so the page is never empty');
});

// ───────────────────────── pure functions, run in a sandbox ─────────────────────────
test('classify(): every reply becomes a safe state; bad token and expired look identical (no leak)', () => {
  const c = sandbox(pageJs, ['classify']).classify;
  const k = (http, j, net) => c({ http, j, net: !!net }).kind;
  assert.equal(k(0, null, true), 'net');
  assert.equal(k(200, { ok: true, current: '' }), 'ok');
  assert.equal(k(200, { ok: true, current: 'yes', status: 'Out for delivery' }), 'ok', '"delivery" in a status is not "delivered"');
  assert.equal(k(200, { ok: true, status: 'Delivered' }), 'delivered');
  assert.equal(k(200, { ok: true, delivered: true }), 'delivered');
  assert.equal(k(409, { ok: false, error: 'already_delivered' }), 'delivered');
  assert.equal(k(200, { ok: true, cancelled: true }), 'cancelled');
  assert.equal(k(404, { ok: false, error: 'invalid token' }), k(410, { ok: false, expired: true }), 'bad vs expired');
  assert.equal(k(200, { ok: false, expired: true }), 'invalid');
  assert.equal(k(403, null), 'invalid');
  assert.equal(k(404, 'not json'), 'invalid');
  assert.equal(k(429, { ok: false }), 'slow');
  assert.equal(k(200, { ok: false, error: 'rate_limited' }), 'slow');
  assert.equal(k(500, { error: 'boom' }), 'error');
  assert.equal(k(500, { ok: true }), 'error', 'ok:true on a 500 is not trusted');
  assert.equal(k(200, null), 'error', 'a 200 that is not JSON is not a success');
  assert.equal(k(200, 'oops'), 'error');
  assert.equal(k(200, []), 'error');
});

test('esc / str / cleanAnswer', () => {
  const x = sandbox(pageJs, ['esc', 'str', 'cleanAnswer']);
  assert.equal(x.esc('<img src=x onerror="a(1)">\'&'), '&lt;img src=x onerror=&quot;a(1)&quot;&gt;&#39;&amp;');
  assert.equal(x.esc(null), '');
  assert.equal(x.str('  hi' + String.fromCharCode(0) + 'there  ', 50), 'hithere');
  assert.equal(x.str('x'.repeat(500), 300).length, 300);
  assert.equal(x.cleanAnswer('YES'), 'yes');
  assert.equal(x.cleanAnswer('no'), 'no');
  assert.equal(x.cleanAnswer('Confirmed'), '', 'only the three contract values are accepted from the Worker');
  assert.equal(x.cleanAnswer(undefined), '');
});

test('everything server-supplied is escaped before it reaches markup in rsvp.html', () => {
  for (const fn of ['facts', 'hi', 'banner', 'viewForm', 'viewDone']) {
    const body = grab(pageJs, fn).replace(/esc\((?:[^()]|\([^()]*\))*\)/g, 'ESC');
    const left = [...body.matchAll(/\b(?:d\.(?:item|street|date|win|first)|S\.(?:note|draft|err|banner)|\bf)\b(?!\s*[?|&),\]=!;]|\.length|\.toLowerCase)/g)].map((m) => body.slice(Math.max(0, m.index - 12), m.index + 30));
    assert.deepEqual(left, [], fn + ' concatenates a raw field: ' + JSON.stringify(left));
  }
});

// ───────────────────────── tone ─────────────────────────
test('copy: the three buttons, the "no" wording, one gentle mention of rescheduling, nothing scolding', () => {
  for (const label of ['I’ll be there', 'I can’t be there', 'Not sure yet']) assert.ok(pageJs.includes(label), 'button label: ' + label);
  assert.ok(pageJs.includes('No problem at all, thank you for letting us know.'));
  assert.ok(pageJs.includes('We’ll do our best to be there instead.'));
  assert.equal((visibleCopy.match(/reschedul/gi) || []).length, 1, 'the possible reschedule is mentioned exactly once, in the "can\'t be there" confirmation');
  const done = grab(pageJs, 'viewDone');
  assert.ok(/reschedul/i.test(done.slice(done.indexOf("S.current==='no'"), done.indexOf("else{t='Thanks"))), 'and it is in the "no" branch');
  const banned = /\b(must|required|mandatory|unfortunately|penalt|fee|charged?|fined|fines|failure|failed|violation|deadline|last chance|final notice|urgent|immediately|warning|you need to|you have to|you should|no[- ]show|lazy|irresponsible)\b/i;
  const copy = visibleCopy.replace(/failure-reporter/g, '');
  assert.ok(!banned.test(copy), 'scolding / pressuring word found: ' + (copy.match(banned) || [])[0]);
  assert.ok(!/!{2,}|ASAP|\bNOW\b/.test(copy), 'no shouting');
  assert.ok(/no worries/i.test(pageJs), 'the invitation itself says it is fine not to be there');
});

// ───────────────────────── accessibility ─────────────────────────
test('accessibility: labelled note box, focus moves to the new heading, live region, visible focus ring, 44px+ targets, 16px inputs', () => {
  assert.ok(/<label class="nl" for="note">/.test(pageJs) && /<textarea id="note"/.test(pageJs));
  assert.ok(/<fieldset class="answers"><legend>/.test(pageJs), 'the three answers are a labelled group');
  assert.ok(/aria-pressed=/.test(pageJs), 'the current answer is exposed to screen readers');
  assert.ok(/id="h" tabindex="-1"/.test(pageJs) && /focus\(/.test(pageJs), 'heading takes focus after each change');
  assert.ok(/role="status" aria-live="polite"/.test(rsvp) && /role="alert"/.test(pageJs), 'status + error announcements');
  assert.ok(/:focus-visible\{outline:3px solid/.test(rsvp), 'visible keyboard focus');
  const minH = (sel) => { const m = rsvp.match(new RegExp('\\' + sel + '\\{[^}]*min-height:(\\d+)px')); return m ? +m[1] : 0; };
  assert.ok(minH('.ans') >= 44 && minH('.btn') >= 44 && minH('.linkbtn') >= 44, 'buttons are at least 44px tall');
  assert.ok(/textarea\{[^}]*font-size:16px/.test(rsvp), 'inputs are 16px so phones do not zoom on focus');
  assert.ok(/prefers-reduced-motion:no-preference/.test(rsvp), 'animation only when motion is welcome');
  assert.ok(!/maximum-scale|user-scalable=no/.test(head), 'pinch-zoom allowed');
});

// ───────────────────────── staff badges ─────────────────────────
const NOW_ISO = '2026-10-23T20:12:00.000Z';   // 4:12 PM ET
const row = (o) => Object.assign({ id: '1', status: 'Scheduled', tenant_name: 'Dana Smith', expected_date: '2026-10-24', delivery_address: '1 Main St', onsite_contact: 'tenant', notes: '', source: 'manual' }, o);
function dlCtx() {
  return sandbox(dl, ['esc', 'rsvpState', 'rsvpOpen', 'rsvpWhen', 'rsvpBadge', 'whereText', 'statusPill', 'contactLabel', 'srcBadge', 'driverNote', 'relayTarget', 'dcard'], 'var TODAY="2026-10-23";');
}

test('deliveries.html badge: Confirmed / Declined / Unsure / No answer yet, with time and note', () => {
  const c = dlCtx();
  const b = (o) => c.rsvpBadge(row(o));
  assert.match(b({ tenant_rsvp: 'Confirmed', tenant_rsvp_at: NOW_ISO }), /class="rsvp yes"[^>]*>✓ Tenant: Confirmed<\/span><span class="rsvp-when">Oct 23, 4:12 PM</);
  assert.match(b({ tenant_rsvp: 'Declined', tenant_rsvp_at: NOW_ISO }), /class="rsvp no" data-rsvp="no">✕ Tenant: Declined</);
  assert.match(b({ tenant_rsvp: 'Unsure' }), /class="rsvp unsure"[^>]*>\? Tenant: Unsure</);
  assert.match(b({ tenant_rsvp: '' }), /data-rsvp="none">Tenant: No answer yet</);
  assert.equal(b({ tenant_rsvp: '', tenant_name: '' }), '', 'no tenant on the row: no badge');
  assert.match(b({ tenant_rsvp: 'maybe??' }), /No answer yet/, 'unknown value counts as no answer, never a wrong "Confirmed"');
  assert.match(b({ tenant_rsvp: 'Declined', tenant_rsvp_note: 'Out of town' }), /rsvp-note[^>]*>“Out of town”</);
  assert.equal(b({ status: 'Delivered' }), '', 'a delivered row does not nag "no answer yet"');
  assert.equal(b({ status: 'Cancelled', tenant_rsvp: '' }), '');
  assert.match(b({ status: 'Delivered', tenant_rsvp: 'Declined' }), /Declined/, 'history stays visible');
  assert.match(b({ status: 'Delivered', tenant_rsvp: 'Declined' }), /class="rsvp no past"/, 'but on a closed delivery it is a quiet pill, not the loud one');
  assert.doesNotMatch(b({ tenant_rsvp: 'Declined' }), /rsvp no past/);
  assert.match(b({ tenant_rsvp: 'Declined', tenant_rsvp_at: 'not a date' }), /not a date/, 'an unparseable stamp is shown as stored, not hidden or guessed');
});

test('deliveries.html badge: when the Worker tells us whether the tenant was asked, "not asked yet" is never called "no answer"', () => {
  const c = dlCtx();
  const b = (o) => c.rsvpBadge(row(o));
  assert.match(b({ tenant_notice_status: 'draft' }), /not asked yet/);
  assert.match(b({ tenant_notice_status: 'off' }), /not asked yet/);
  assert.match(b({ tenant_notice_status: 'sent' }), /No answer yet/);
  assert.match(b({ tenant_notice_sent_at: NOW_ISO }), /No answer yet/);
});

test('deliveries.html badge: note and stamp are escaped', () => {
  const c = dlCtx();
  const html = c.rsvpBadge(row({ tenant_rsvp: 'Declined', tenant_rsvp_note: '"><img src=x onerror=alert(1)>', tenant_rsvp_at: '<b>x</b>' }));
  assert.ok(!/<img|<b>/.test(html), html);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('deliveries.html: Declined makes the whole card prominent (open deliveries only), others unchanged', () => {
  const c = dlCtx();
  assert.match(c.dcard(row({ tenant_rsvp: 'Declined' }), true), /class="dcard rsvp-declined"/);
  assert.doesNotMatch(c.dcard(row({ tenant_rsvp: 'Confirmed' }), true), /rsvp-declined/);
  assert.doesNotMatch(c.dcard(row({ tenant_rsvp: 'Declined', status: 'Delivered' }), false), /rsvp-declined/);
  assert.doesNotMatch(c.dcard(row({ tenant_rsvp: 'Declined', status: 'Cancelled' }), false), /rsvp-declined/);
  const html = c.dcard(row({ tenant_rsvp: 'Declined' }), true);
  assert.ok(html.indexOf('rsvp no') > html.indexOf('1 Main St') && html.indexOf('rsvp no') < html.indexOf('Tenant: Dana'), 'the badge sits right under the date line, above the contact line');
  assert.ok(/\.rsvp\.no\{background:#b42318;color:#fff/.test(dl), 'Declined is a solid red pill with white text');
  assert.ok(/\.dcard\.rsvp-declined\{border-left:5px solid/.test(dl));
});

test('command-center.html: the Today\'s deliveries card shows the same badges, time and note', () => {
  const ctx = sandbox(cc, ['h', 'deliveriesCard']);
  const card = (rows) => ctx.deliveriesCard({ ok: true, today: '2026-10-23', rows });
  const t = (o) => row(Object.assign({ expected_date: '2026-10-23', expected_window: '9a-1p' }, o));
  const out = card([
    t({ id: 'A', tenant_rsvp: 'Declined', tenant_rsvp_at: NOW_ISO, tenant_rsvp_note: 'Out of town <b>until</b> Sat' }),
    t({ id: 'B', tenant_rsvp: 'Confirmed' }),
    t({ id: 'C', tenant_rsvp: 'Unsure' }),
    t({ id: 'D', tenant_rsvp: '' }),
    t({ id: 'E', tenant_rsvp: '', tenant_name: '' }),
    t({ id: 'F', status: 'Delivered', tenant_rsvp: '' }),
  ]);
  const rowOf = (id) => out.split('<div class="row2').find((s) => s.includes('data-id="' + id + '"')) || '';
  assert.match(rowOf('A'), /deliv-row rsvp-declined/);
  assert.match(rowOf('A'), /class="rsvp no" data-rsvp="no">✕ Tenant: Declined<\/span><small style="display:inline">Oct 23, 4:12 PM<\/small>/);
  assert.match(rowOf('A'), /rsvp-note[^>]*>“Out of town &lt;b&gt;until&lt;\/b&gt; Sat”/, 'note shown, escaped');
  assert.match(rowOf('B'), /class="rsvp yes"/);
  assert.match(rowOf('C'), /class="rsvp unsure"/);
  assert.match(rowOf('D'), /No answer yet/);
  assert.doesNotMatch(rowOf('E'), /class="rsvp/);
  assert.doesNotMatch(rowOf('F'), /No answer yet/);
  assert.doesNotMatch(rowOf('B'), /rsvp-declined/);
  assert.match(card([t({ id: 'G', status: 'Delivered', expected_date: '2026-10-23', tenant_rsvp: 'Declined' })]), /class="rsvp no past"/, 'command center: closed declined row is quiet');
  assert.ok(!/<b>until/.test(out));
});

test('nothing in the staff screens scolds anyone: the new strings are factual', () => {
  const added = [dl, cc].map((s) => [...s.matchAll(/Tenant: [A-Za-z ]+|rsvp-note|not asked yet/g)].map((m) => m[0]).join(' ')).join(' ');
  assert.ok(!/\b(failed|ignored|late|refus|no-show|didn.t)\b/i.test(added), added);
});

test('this change set stays in pages + tests (worker.js and apps-script untouched)', async () => {
  const { execSync } = await import('node:child_process');
  let diff = '';
  try { diff = execSync('git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1', { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }); } catch (e) { return; }
  assert.ok(!/^worker\.js$/m.test(diff) && !/^apps-script\//m.test(diff), 'worker.js / apps-script must not change in this PR: ' + diff);
});
