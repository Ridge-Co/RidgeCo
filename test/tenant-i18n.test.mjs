// Spanish layer for the tenant portal (queue #105, Nov 22 2026). Loads the REAL tenant-i18n.js in a vm sandbox and checks
// (1) exact translations, user data untouched, English stays the default, (2) EVERY visible static string in tenant.html translates
// so a new English label with no Spanish entry fails CI instead of reaching a Spanish-speaking tenant, (3) the toggle is wired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('tenant.html', root), 'utf8');
const js = fs.readFileSync(new URL('tenant-i18n.js', root), 'utf8');
function load(saved) {
  const store = saved ? { ridgeco_tenant_lang: saved } : {};
  const ctx = vm.createContext({ window: {}, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { documentElement: {}, addEventListener() {}, querySelectorAll: () => [] }, MutationObserver: undefined, console });
  ctx.window.alert = () => {}; ctx.window.confirm = () => true; ctx.window.prompt = () => '';
  vm.runInContext(js + '\nthis.api = { tenantT, tenantSetLang, get TLANG() { return TLANG; }, TENANT_ES };', ctx);
  return { api: ctx.api, store };
}
const es = load('es').api;

test('English is the default: no saved choice, a bad value, or blocked storage never switches language', () => {
  assert.equal(load().api.TLANG, 'en');
  assert.equal(load('fr').api.TLANG, 'en');
  assert.equal(load().api.tenantT('SIGN IN'), 'SIGN IN');
  const blocked = vm.createContext({ window: { alert() {}, confirm() {}, prompt() {} }, localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, document: { documentElement: {}, addEventListener() {}, querySelectorAll: () => [] }, MutationObserver: undefined, console: { error() {} } });
  vm.runInContext(js + '\nthis.l = TLANG;', blocked);
  assert.equal(blocked.l, 'en');
});

test('exact, case-preserving, emoji-peeled translations', () => {
  assert.equal(es.tenantT('SIGN IN'), 'INICIAR SESIÓN');
  assert.equal(es.tenantT('Nothing here yet'), 'Aún no hay nada aquí');
  assert.equal(es.tenantT('  TRY AGAIN '), '  REINTENTAR ');
  assert.equal(es.tenantT('✓ Sent — thank you!'), '✓ ¡Enviado — gracias!');
  assert.equal(es.tenantT('In Progress'), 'En progreso');
});

test('user data is never altered (names, addresses, free text, notes, work order numbers)', () => {
  for (const s of ['Cesar Diaz', '123 Main St — Unit 2 · Kitchen', 'Leaking faucet in kitchen', 'WO-1002', 'The sink is leaking again', '$1,250.00', 'Maria'])
    assert.equal(es.tenantT(s), s);
});

test('every Spanish value is non-empty and keeps the tenant-facing wording honest (no vendor words)', () => {
  for (const [k, v] of Object.entries(es.TENANT_ES)) { assert.ok(v && v.trim(), 'empty Spanish for ' + k); assert.ok(!/contratista/i.test(v), 'vendor wording in tenant text: ' + k); }
});

test('every visible static string in tenant.html has a Spanish translation', () => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const strings = new Set();
  for (const m of body.matchAll(/>([^<>]+)</g)) strings.add(m[1].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim());
  for (const m of body.matchAll(/\b(?:placeholder|title|aria-label)="([^"]+)"/g)) strings.add(m[1]);
  const exempt = new Set(['ABC12345', 'RIDGE CO', 'General', 'Ridge Co', '✕', '×', '—']);
  const bad = [...strings].filter((s) => /[A-Za-z]{3}/.test(s) && !exempt.has(s) && es.tenantT(s) === s && !/^(\d{1,2}:\d\d|[\d$.,\s]+$)/.test(s));
  assert.deepEqual(bad, [], 'untranslated static strings — add them to TENANT_ES in tenant-i18n.js:\n' + bad.join('\n'));
});

test('tenant.html loads the layer, has both toggles, and writes no new network call or storage key besides the language choice', () => {
  assert.ok(/<script src="tenant-i18n\.js"><\/script>/.test(html));
  assert.equal((html.match(/class="tenant-lang-toggle"/g) || []).length, 2, 'login card + dashboard header');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(js), 'the language layer makes no network call');
  assert.deepEqual([...new Set([...js.matchAll(/localStorage\.(?:get|set)Item\(([^,)]+)/g)].map(m => m[1]))], ['TENANT_LANG_KEY']);
  assert.ok(/ridgeco_tenant_lang/.test(js));
});

test('storing the choice: a blocked write is logged, not swallowed', () => {
  assert.ok(/catch \(e\) \{ console\.error\('tenant language choice not stored/.test(js));
  assert.ok(!/catch\s*\(\w*\)\s*\{\s*\}/.test(js));
});
