// UI plan Phase 0, PR A (Nov 16 2026): the shared parts rc-ui.css / rc-ui.js hold to DESIGN.md.
// 1) the version is one number in three places  2) tokens equal the DESIGN.md table  3) the stylesheet uses only the scales
// 4) the ONE chip map covers every status in wo-status.js, hides billing words from tenants, and every chip is 4.5:1 or better
// 5) the date helper  6) the promise helpers always settle exactly once  7) brand / logo / Worker come from one config object
// 8) nothing fails silently in the script
import fs from 'node:fs';
import assert from 'node:assert';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const js = read('rc-ui.js'), css = read('rc-ui.css'), design = read('DESIGN.md'), demo = read('rc-ui-demo.html');
function load(config) {
  const g = globalThis, had = Object.prototype.hasOwnProperty.call(g, 'RC_CONFIG'), old = g.RC_CONFIG;
  if (config) g.RC_CONFIG = config; else delete g.RC_CONFIG;
  try { const mod = { exports: {} }; new Function('module', js)(mod); return mod.exports; }
  finally { if (had) g.RC_CONFIG = old; else delete g.RC_CONFIG; }
}
const RC = load();
const quiet = fn => { const e = console.error; const calls = []; console.error = (...a) => calls.push(a.join(' ')); try { return fn(calls); } finally { console.error = e; } };
const quietAsync = async fn => { const e = console.error; const calls = []; console.error = (...a) => calls.push(a.join(' ')); try { return await fn(calls); } finally { console.error = e; } };

// ---- 1. one version, three places (a stale cached copy of one file next to a new page is caught by the tag's ?v=)
const V = /var RC_UI_VERSION = '([^']+)'/.exec(js)[1];
ok(RC.version === V, 'RC.version is RC_UI_VERSION');
ok(new RegExp('--rc-ui-version:\\s*"' + V + '"').test(css), 'rc-ui.css declares the same --rc-ui-version as RC_UI_VERSION in rc-ui.js (' + V + ')');
const pages = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html'));
for (const f of pages) {
  const s = read(f);
  for (const m of s.matchAll(/(?:src|href)="rc-ui\.(css|js)([^"]*)"/g)) ok(m[2] === '?v=' + V, f + ': rc-ui.' + m[1] + ' is loaded with ?v=' + V + ' (found "' + m[0] + '")');
}
ok(/<link rel="stylesheet" href="rc-ui\.css\?v=/.test(demo) && /<script src="rc-ui\.js\?v=/.test(demo), 'the demo page loads both files with a version');
ok(/data-rc-css-failed/.test(demo) && /data-rc-ui-guard/.test(demo), 'the demo page has the load-failure guards (visible warning if a shared file fails)');

// ---- 2. tokens equal DESIGN.md section 2, value for value
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)[1];
const tok = {}; for (const m of rootBlock.matchAll(/--rc-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tok['--rc-' + m[1]] = m[2].toLowerCase();
const doc = {}; for (const m of design.matchAll(/^\| `(--[\w-]+)` \| `(#[0-9a-fA-F]{6})`/gm)) doc[m[1]] = m[2].toLowerCase();
ok(Object.keys(doc).length >= 17, 'read the colour table from DESIGN.md (' + Object.keys(doc).length + ' tokens)');
for (const [name, hex] of Object.entries(doc)) ok(tok['--rc-' + name.slice(2)] === hex, name + ' = ' + hex + ' in rc-ui.css (--rc-' + name.slice(2) + ' is ' + tok['--rc-' + name.slice(2)] + ')');
ok(/--rc-radius:\s*8px/.test(css) && /--rc-shadow:\s*0 1px 2px rgba\(16, 23, 32, \.08\), 0 1px 8px rgba\(16, 23, 32, \.04\)/.test(css), 'one radius (8px) and the one shadow from DESIGN.md section 4');
for (const [k, v] of [['sm', 13], ['body', 15], ['md', 17], ['lg', 20], ['xl', 24], ['input', 16]]) ok(new RegExp('--rc-fs-' + k + ':\\s*' + v + 'px').test(css), 'type token ' + k + ' = ' + v + 'px');
for (const [k, v] of [[1, 4], [2, 8], [3, 12], [4, 16], [5, 24], [6, 32]]) ok(new RegExp('--rc-s' + k + ':\\s*' + v + 'px').test(css), 'spacing token s' + k + ' = ' + v + 'px');
ok(/--rc-font:\s*-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif/.test(css), 'the one font family');

// ---- 3. below the token block the stylesheet writes no colour, size, radius or spacing of its own
const below = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[\s\S]*?\n\}/, '');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(below), 'no raw hex colour outside the token block');
ok(!/rgba?\(/.test(below), 'no raw rgb()/rgba() colour outside the token block');
const SCALE_FS = new Set([13, 15, 16, 17, 20, 24]);
for (const m of below.matchAll(/font-size:\s*(\d+)px/g)) ok(SCALE_FS.has(+m[1]), 'font-size ' + m[1] + 'px is on the 13/15/16/17/20/24 scale');
for (const m of below.matchAll(/font:\s*[^;]*?(\d+)px/g)) ok(SCALE_FS.has(+m[1]), 'font shorthand size ' + m[1] + 'px is on the scale');
const SP = new Set([0, 1, 4, 8, 12, 16, 24, 32]);   // 1 is only the visually-hidden trick (.rc-sr)
for (const m of below.matchAll(/(?:padding|margin|gap|inset|left|right|top|bottom)[\w-]*:\s*([^;{}]+);/g)) {
  if (/rc-sr|clip/.test(m[0])) continue;
  for (const px of m[1].matchAll(/(-?\d+)px/g)) ok(SP.has(Math.abs(+px[1])), 'spacing ' + px[1] + 'px in "' + m[0].trim() + '" is on the 4/8/12/16/24/32 scale');
}
for (const m of below.matchAll(/border-radius:\s*([^;]+);/g)) ok(/^(var\(--rc-radius\)( var\(--rc-radius\) 0 0)?|50%)$/.test(m[1].trim()), 'radius "' + m[1].trim() + '" is the one radius (or round for the spinner)');
ok(!/outline:\s*none/.test(below.replace(/\.rc-sheet__title:focus\s*\{[^}]*\}/, '')), 'focus is never removed (only the sheet title, which is not a control)');
ok(/@media \(min-width: 700px\)/.test(css) && /@media \(min-width: 1100px\)/.test(css), 'layout helpers use the DESIGN.md breakpoints 700 and 1100');
ok(/\.rc-btn--big\s*\{[^}]*min-height:\s*52px/.test(css) && /\.rc-btn\s*\{[^}]*min-height:\s*44px/.test(css), 'buttons are 44px tall, big is 52px');
ok(/\.rc-input,[\s\S]*?font:\s*400 var\(--rc-fs-input\)/.test(css), 'inputs are 16px (Android does not zoom the page)');
ok(/\.rc-chip\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/.test(css), 'a chip wraps, it never runs off the card');
ok(!/\.rc-[\w-]*\s*\{[^}]*text-transform:\s*uppercase/.test(css) && !/letter-spacing/.test(css), 'no all-caps labels, no wide tracking');
const zs = [...css.matchAll(/--rc-z-(\w+):\s*(\d+)/g)].map(m => +m[2]); eq(zs, [...zs].sort((a, b) => a - b), 'one z-index scale, in order');
ok(!/z-index:\s*\d/.test(below), 'no raw z-index outside the scale');

// ---- 4. the chip map
const W = new Function(read('wo-status.js') + '\nreturn WOStatus;')();
for (const s of W.statuses) ok(Object.prototype.hasOwnProperty.call(RC.chip.map, s), 'the chip map has "' + s + '" (a status in wo-status.js)');
for (const s of Object.keys(RC.chip.map)) ok(W.isKnown(s), 'the chip map only lists real statuses: ' + s);
const cssKind = {}; for (const m of css.matchAll(/\.rc-chip--([\w-]+)\s*\{([^}]*)\}/g)) { const c = /(?<![-\w])color:\s*var\((--rc-[\w-]+)\)/.exec(m[2]), b = /background:\s*var\((--rc-[\w-]+)\)/.exec(m[2]); if (c && b) cssKind[m[1]] = { fg: c[1], bg: b[1] }; }
let worst = 99;
for (const [kind, t] of Object.entries(RC.chip.kinds)) {
  ok(cssKind[kind] && cssKind[kind].fg === t.fg && cssKind[kind].bg === t.bg, 'rc-ui.css class .rc-chip--' + kind + ' uses the tokens the JS map names (' + t.fg + ' on ' + t.bg + ')');
  const c = RC.contrast(tok[t.fg], tok[t.bg]); worst = Math.min(worst, c);
  ok(c >= 4.5, 'chip kind ' + kind + ' is ' + c.toFixed(2) + ':1 (needs 4.5:1)');
}
for (const k of Object.keys(cssKind)) ok(RC.chip.kinds[k], 'every chip class in the CSS is in the JS map: ' + k);
console.log('  lowest chip contrast: ' + worst.toFixed(2) + ':1');
// every status for every role resolves to a kind that exists; compare with the DESIGN.md table
const T = (s, role) => RC.chip.info(s, role);
for (const s of Object.keys(RC.chip.map)) for (const r of RC.chip.roles) { const i = T(s, r); ok(i.hidden || RC.chip.kinds[i.kind], s + ' / ' + r + ' has a real kind'); }
const expect = {   // DESIGN.md section 7: [vendor/admin label, kind, tenant label, owner label]
  'New': ['New', 'info', 'Request received', 'Request received'], 'Estimate Requested': ['Estimate requested', 'info', 'Request received', 'Request received'],
  'Assigned': ['Assigned', 'assigned', 'Technician assigned', 'Technician assigned'], 'Accepted': ['Accepted', 'accepted', 'Technician confirmed', 'Technician confirmed'],
  'In Progress': ['In progress', 'active', 'Work in progress', 'Work in progress'], 'On Hold': ['On hold', 'hold', 'On hold', 'On hold'],
  'Complete': ['Complete', 'done', 'Complete', 'Complete'], 'Pending Invoice': ['Pending invoice', 'billing', 'Complete', 'Complete'],
  'Invoiced': ['Invoiced', 'invoiced', 'Complete', 'Invoice sent'], 'Paid': ['Paid', 'paid', 'Complete', 'Paid'],
  'Cancelled': ['Cancelled', 'cancelled', 'Cancelled', 'Cancelled']
};
for (const [s, [vl, vk, tl, ol]] of Object.entries(expect)) {
  eq([T(s, 'vendor').label, T(s, 'vendor').kind, T(s, 'admin').label], [vl, vk, vl], s + ' for vendor and admin');
  eq(T(s, 'tenant').label, tl, s + ' reads "' + tl + '" to a tenant'); eq(T(s, 'owner').label, ol, s + ' reads "' + ol + '" to an owner');
}
ok(T('Declined', 'tenant').hidden && T('Declined', 'owner').hidden && !T('Declined', 'vendor').hidden && !T('Declined', 'admin').hidden, 'Declined is not shown to a tenant or owner');
// a tenant never sees money or billing words, in label or colour; an owner never sees the billing word "Pending invoice"
for (const s of Object.keys(RC.chip.map)) {
  const i = T(s, 'tenant'); if (i.hidden) continue;
  ok(!/invoice|paid|bill|pending/i.test(i.label), 'tenant label for ' + s + ' has no billing word: ' + i.label);
  ok(!['billing', 'invoiced', 'paid'].includes(i.kind), 'tenant chip colour for ' + s + ' is not a billing colour');
  ok(!/pending/i.test(T(s, 'owner').label), 'owner label for ' + s + ' has no "pending invoice"');
}
ok(T('Canceled', 'vendor').label === 'Cancelled', 'the old spelling "Canceled" maps to Cancelled');
// unknown values are loud, and a tenant or owner never gets a raw status word
quiet(calls => {
  const before = RC.problems.length;
  const v = T('Pending Payment', 'vendor'); ok(v.unknown && v.label === 'Pending Payment' && v.kind === 'cancelled' && !v.hidden, 'an unknown status is shown plainly to a vendor');
  ok(T('Pending Payment', 'tenant').hidden && T('Whatever', 'owner').hidden, 'an unknown status is hidden from a tenant or owner (it could be a billing word)');
  ok(RC.problems.length >= before + 3 && calls.length >= 3, 'every unknown status is reported (console and RC.problems), not swallowed');
  ok(T('New', 'janitor').label === 'Request received', 'an unknown role gets the most restricted view');
  ok(/rc-chip--cancelled/.test(RC.chip.html('Pending Payment', 'admin')) && RC.chip.html('Pending Payment', 'tenant') === '', 'html(): plain chip for admin, nothing for a tenant');
});
quiet(() => ok(RC.chip.html('<img src=x onerror=1>', 'vendor').indexOf('<img') < 0, 'a status string cannot inject markup'));
ok(RC.chip.html('Assigned', 'vendor') === '<span class="rc-chip rc-chip--assigned">Assigned</span>', 'chip html shape');
eq([RC.chip.priority('urgent').kind, RC.chip.priority('High').kind, RC.chip.priority('NORMAL').kind, RC.chip.priority('low').kind], ['p-urgent', 'p-high', 'p-normal', 'p-low'], 'priority chips use the same tints');
ok(Object.isFrozen(RC.chip.map) && Object.isFrozen(RC.chip.kinds), 'the map is frozen (a page cannot change it by accident)');
// the DESIGN.md pairs, computed independently of the map
for (const [fg, bg, label] of [['--rc-accent', '--rc-surface', 'accent on surface'], ['--rc-surface', '--rc-accent', 'white on accent'], ['--rc-surface', '--rc-success', 'white on success'], ['--rc-surface', '--rc-warn', 'white on warn'],
  ['--rc-surface', '--rc-danger', 'white on danger'], ['--rc-surface', '--rc-purple', 'white on purple'], ['--rc-muted', '--rc-surface2', 'muted on surface2'], ['--rc-muted', '--rc-bg', 'muted on page']])
  ok(RC.contrast(tok[fg], tok[bg]) >= 4.5, label + ' is at least 4.5:1');
ok(Math.abs(RC.contrast('#000000', '#ffffff') - 21) < 0.01 && Math.abs(RC.contrast('#fff', '#fff') - 1) < 0.001, 'the contrast function is right (21:1 and 1:1)');
ok(RC.contrast('#86efac', '#eaf6ee') < 2, 'the banned pale green on pale green really is unreadable (about 1.3:1) and would be caught');

// ---- 5. dates
eq([RC.date('2026-11-12'), RC.date('2026-11-16'), RC.date('2026-01-01'), RC.date('2028-02-29')], ['Thu, Nov 12', 'Mon, Nov 16', 'Thu, Jan 1', 'Tue, Feb 29'], 'a plain date prints like "Thu, Nov 12"');
eq(RC.date('2026-11-12T15:30:00'), 'Thu, Nov 12', 'a date-time prints as a date');
eq(RC.date('11/12/2026'), 'Thu, Nov 12', 'a spreadsheet date prints the same way');
eq(RC.date(new Date(2026, 10, 12, 23, 59)), 'Thu, Nov 12', 'a Date late in the evening stays on its day (no UTC shift)');
eq(RC.date(new Date(2026, 10, 12).getTime()), 'Thu, Nov 12', 'epoch milliseconds');
for (const bad of ['', '  ', null, undefined, NaN, 'garbage', '2026-02-30', '2026-13-01', '2026-02-29', '13/40/2026', {}, [], new Date('x')]) eq(RC.date(bad), '', 'a bad value prints nothing, not "Invalid Date": ' + JSON.stringify(bad));
eq(RC.date('', { fallback: 'No date' }), 'No date', 'a fallback can be given');
eq(RC.date('2026-11-12', { year: true }), 'Thu, Nov 12, 2026', 'year on request');
eq(RC.date('2026-11-12', { lang: 'es' }), 'jue, 12 nov', 'Spanish');
eq(RC.dateTime('2026-11-12T15:30:00'), 'Thu, Nov 12, 3:30 PM', 'date and time');
eq([RC.dateTime('2026-11-12T00:05:00'), RC.dateTime('2026-11-12T12:00:00'), RC.dateTime('2026-11-12T09:07:00')], ['Thu, Nov 12, 12:05 AM', 'Thu, Nov 12, 12:00 PM', 'Thu, Nov 12, 9:07 AM'], '12 AM, noon, a single-digit minute');
eq(RC.dateTime('2026-11-12T15:30:00', { lang: 'es' }), 'jue, 12 nov, 15:30', 'Spanish time is 24-hour');
ok(!/\b(toLocale\w*|Intl\.)/.test(js), 'no locale-dependent formatting: the same text on every phone');

// ---- 6. promise helpers
const tick = () => new Promise(r => setImmediate(r));
{ // prompter
  const opened = [], settles = [];
  const P = RC._makePrompter({ open(spec, settle) { opened.push(spec.name); settles.push(settle); return { close() { this.closed = (this.closed || 0) + 1; } }; } });
  const a = P({ name: 'a', cancelValue: 'ca' }), b = P({ name: 'b', cancelValue: 'cb' });
  await tick(); eq(opened, ['a'], 'only one sheet is open at a time; the second waits (never a sheet on top of a sheet)');
  settles[0]('A1'); settles[0]('A2'); eq(await a, 'A1', 'a prompt settles once; the second call is ignored');
  await tick(); eq(opened, ['a', 'b'], 'the next one opens when the first is answered');
  settles[1]('B'); eq(await b, 'B', 'second answer'); n++;
  const sync = RC._makePrompter({ open(spec, settle) { settle('now'); return { close() { sync.closed = true; } }; } });
  eq(await sync({ cancelValue: 'x' }), 'now', 'a driver that answers immediately still works'); ok(sync.closed === true, '...and its sheet is closed');
  const boom = RC._makePrompter({ open() { throw new Error('no page'); } });
  await quietAsync(async calls => { eq(await boom({ cancelValue: false }), false, 'a driver that cannot open resolves with the cancel value instead of hanging'); ok(calls.length === 1 && /no page/.test(calls[0]), '...and says why, out loud'); });
  const seq = RC._makePrompter({ open(spec, settle) { setTimeout(() => settle(spec.v), 0); return { close() {} }; } });
  eq(await Promise.all([seq({ v: 1 }), seq({ v: 2 }), seq({ v: 3 })]), [1, 2, 3], 'three queued prompts answer in order');
}
{ // toaster with fake timers
  const timers = []; const T = { set(fn, ms) { timers.push({ fn, ms, live: true }); return timers.length - 1; }, clear(id) { timers[id].live = false; } };
  const shown = []; const toast = RC._makeToaster({ show(spec, settle) { shown.push({ spec, settle, removed: false }); const rec = shown[shown.length - 1]; return { remove() { rec.removed = true; } }; } }, T);
  const p1 = toast('Saved'); eq([shown[0].spec.message, shown[0].spec.kind, timers[0].ms], ['Saved', 'info', 4000], 'a plain toast lasts 4 seconds');
  timers[0].fn(); eq(await p1, 'timeout', 'it settles "timeout"'); ok(shown[0].removed, '...and is taken off the screen');
  const p2 = toast('Approved', { actionLabel: 'Undo' }); eq(timers[1].ms, 8000, 'a toast with an action lasts 8 seconds (time to tap Undo)');
  shown[1].settle('action'); eq(await p2, 'action', 'tapping the action settles "action"'); ok(timers[1].live === false, '...and cancels the timer');
  const p3 = toast('Not saved', { kind: 'error' }); eq(timers[2].ms, 8000, 'an error toast lasts 8 seconds');
  p3.dismiss(); eq(await p3, 'dismissed', 'dismiss() settles "dismissed"'); p3.dismiss(); n++;
  toast('stays', { duration: 0 }); eq(timers.length, 3, 'duration 0 never times out (no timer)');
  const bad = RC._makeToaster({ show() { throw new Error('no page'); } }, T);
  await quietAsync(async calls => { eq(await bad('x'), 'dismissed', 'a toast that cannot show still settles'); ok(calls.length === 1, '...and says why'); });
}
// with no page at all (this test), the real helpers settle with the safe answer and report, instead of hanging
await quietAsync(async calls => {
  eq(await RC.confirm('Delete it?'), false, 'rcConfirm with no page answers false (nothing is confirmed by accident)');
  eq(await RC.ask({ title: 'Name?' }), null, 'rcAsk with no page answers null');
  eq(await RC.toast('hi'), 'dismissed', 'rcToast with no page settles');
  ok(calls.length === 3, 'each of the three reported the problem');
});
await quietAsync(async () => { ok(RC.confirm('x') instanceof Promise && RC.ask('x') instanceof Promise && RC.toast('x') instanceof Promise, 'rcConfirm, rcAsk and rcToast all return promises'); });
{ // answers
  eq(RC._checkAnswer({}, '  Ann  '), { ok: true, value: 'Ann', error: '' }, 'an answer is trimmed');
  eq(RC._checkAnswer({}, '   ').ok, false, 'a blank answer is refused by default'); eq(RC._checkAnswer({}, '   ').error, 'Please enter a value.', '...with a message that says what to do');
  eq(RC._checkAnswer({ required: false }, '').ok, true, 'a blank answer is fine when the field is optional');
  eq(RC._checkAnswer({ validate: v => v.length < 3 ? 'Enter at least 3 letters.' : '' }, 'ab'), { ok: false, value: 'ab', error: 'Enter at least 3 letters.' }, 'the caller\'s validation message is shown');
  eq(RC._checkAnswer({ validate: v => '' }, 'abc').ok, true, 'a passing validate accepts');
  eq(RC._checkAnswer({ trim: false }, ' a ').value, ' a ', 'trim can be turned off');
  quiet(calls => { const r = RC._checkAnswer({ validate() { throw new Error('boom'); } }, 'x'); ok(r.ok === false && calls.length === 1, 'a validate that throws refuses the answer and is reported'); });
}

// ---- 7. brand, logo and Worker address come from one config object
ok(RC.brand() === 'Ridge Co' && RC.logo() === 'icon.svg' && RC.worker() === 'https://maintenance-hub.brett-2f8.workers.dev', 'defaults');
eq(RC.worker('/version'), 'https://maintenance-hub.brett-2f8.workers.dev/version', 'worker(path) joins cleanly');
const RB = load({ brand: 'Acme Repairs', logo: 'acme.svg', worker: 'https://acme.example.workers.dev/' });
eq([RB.brand(), RB.logo(), RB.worker('version')], ['Acme Repairs', 'acme.svg', 'https://acme.example.workers.dev/version'], 'a re-brand is one config object');
eq(js.split('workers.dev').length - 1, 1, 'the Worker address is typed once in rc-ui.js (the config object)');
eq(js.split("'Ridge Co'").length - 1, 1, 'the brand name is typed once in rc-ui.js (the config object)');
for (const [name, src] of [['rc-ui.css', css], ['rc-ui-demo.html', demo]]) ok(!/Ridge ?Co|workers\.dev|icon\.svg/.test(src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')), name + ' has no brand name, logo path or Worker address in it');
ok(/data-rc-brand/.test(demo) && /data-rc-logo/.test(demo) && /data-rc-worker/.test(demo), 'the demo page reads all three from the config');
{ const mk = () => ({ textContent: '', src: '', setAttribute(k, v) { this[k] = v; } }); const els = { b: [mk()], l: [mk()], w: [mk()] };
  const scope = { querySelectorAll: s => ({ forEach: f => els[s === '[data-rc-brand]' ? 'b' : s === '[data-rc-logo]' ? 'l' : 'w'].forEach(f) }) };
  eq(RB.applyBrand(scope), 3, 'applyBrand fills the three places'); eq([els.b[0].textContent, els.l[0].src, els.w[0].textContent], ['Acme Repairs', 'acme.svg', 'https://acme.example.workers.dev'], '...with the config values'); }

// ---- 8. strings, shared-file health, no silent failure
const lang = load({ lang: () => 'es' }); eq([lang.t('Cancel'), lang.t('Retry'), lang.t('Something not in the table')], ['Cancelar', 'Reintentar', 'Something not in the table'], 'built-in Spanish for rc-ui\'s own words; anything else passes through');
const own = load({ t: s => (s === 'Cancel' ? 'Annuler' : '') }); eq([own.t('Cancel'), own.t('Retry')], ['Annuler', 'Retry'], 'a page\'s own translate function wins when it has an answer');
for (const s of Object.values(RC.chip.map).flatMap(e => [e.label, ...['tenant', 'owner'].map(r => e[r] && e[r].label)]).filter(Boolean)) ok(RC._es[s], 'Spanish exists for the chip label "' + s + '"');
for (const s of ['Urgent', 'High', 'Normal', 'Low', 'Cancel', 'Confirm', 'Close', 'Retry', 'Loading…', 'Something went wrong']) ok(RC._es[s], 'Spanish exists for "' + s + '"');
const AP = RC._assetProblem;
eq([AP({ cssVersion: '1', jsVersion: '1', cssFailed: false }), AP({ cssVersion: '', jsVersion: '1' }) !== '', AP({ cssVersion: '1', jsVersion: '1', cssFailed: true }) !== '', /two different versions/.test(AP({ cssVersion: '2', jsVersion: '1' }))], ['', true, true, true], 'the health check: ok, css missing, css failed, css and js out of step');
ok(!/catch\s*\(\w*\)\s*\{\s*\}/.test(js) && !/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(js), 'no empty catch in rc-ui.js (CLAUDE.md: nothing fails silently)');
ok(!/(?<![\w$.])(alert|confirm|prompt)\s*\(/.test(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'rc-ui.js makes no browser alert/confirm/prompt call');
ok(!/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|capture=/.test(js), 'rc-ui.js reads no token, stores nothing and calls no server (interface only)');
ok(!/maximum-scale|user-scalable/.test(js + css + demo), 'nothing blocks zoom');
ok(/RC\.report\('sheet'/.test(js) && /RC\.report\('toast'/.test(js) && /RC\.report\('prompt'/.test(js), 'caught problems in sheet, toast and prompt are reported');
console.log('rc-ui: ' + n + ' checks passed');
