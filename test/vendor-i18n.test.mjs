// Spanish layer for the vendor portal (Oct 5 2026). Loads the REAL vendor-i18n.js in a vm sandbox and checks
// (1) key strings + rules translate, (2) EVERY visible static string in vendor.html translates, so a new
// English label added to the markup without a Spanish entry fails CI instead of reaching a vendor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('vendor.html', root), 'utf8');
const js = fs.readFileSync(new URL('vendor-i18n.js', root), 'utf8');
// ES (the inline dictionary) lives in vendor.html; pull it so esT sees the same dictionary the page has.
const esSrc = /var ES = \{([\s\S]*?)\n\};/.exec(html)[1];
const ctx = vm.createContext({ window: {}, document: { documentElement: {} }, MutationObserver: undefined });
vm.runInContext('var LANG = "es"; var ES = {' + esSrc + '};\n' + js + '\nthis.esT = esT;', ctx);
const esT = ctx.esT;

test('exact, case-preserving, emoji-peeled and rule-based translations', () => {
  assert.equal(esT('Accept work order'), 'Aceptar orden de trabajo');
  assert.equal(esT('urgent'), 'urgente');
  assert.equal(esT('📅 Schedule'), '📅 Programar');
  assert.equal(esT('💳 Ridge Co card ✓'), '💳 Tarjeta de Ridge Co ✓');
  assert.equal(esT('1 work order'), '1 orden de trabajo');
  assert.equal(esT('5 work orders'), '5 órdenes de trabajo');
  assert.equal(esT('✓ Status updated to In Progress'), '✓ Estado actualizado a En progreso');
  assert.equal(esT('2 hrs × $50/hr = $100.00'), '2 h × $50/h = $100.00');
  assert.equal(esT('Morning (8:00 AM – 12:00 PM)'), 'Mañana (8:00 AM – 12:00 PM)');
});

test('invoice vs purchase receipt stay differentiated in Spanish', () => {
  const all = Object.values(ctx.ES).join('\n');
  assert.ok(/FACTURA/.test(all) && /RECIBO DE COMPRA|recibo de compra/i.test(all));
  assert.ok(!/(^|[^\w])RECIBO(?! DE COMPRA)(?!S DE COMPRA)([^\w]|$)/m.test(Object.values(ctx.ES).join('\n').replace(/recibos? de compra/gi, '')), 'bare "recibo" found in ES');
});

test('user data is never altered (names, addresses, free text, unknown strings)', () => {
  for (const s of ['Cesar Diaz', '123 Main St — Unit 2 · Kitchen', 'Leaking faucet in kitchen', 'WO-1002', '$1,250.00'])
    assert.equal(esT(s), s);
});

test('every visible static string in vendor.html has a Spanish translation (login screen exempt)', () => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const strings = new Set();
  for (const m of body.matchAll(/>([^<>]+)</g)) strings.add(m[1].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim());
  for (const m of body.matchAll(/\b(?:placeholder|title|aria-label)="([^"]+)"/g)) strings.add(m[1]);
  const exempt = new Set(['RIDGE CO', 'YOUR NAME', '(first name, or company login name)', 'e.g. Alex, or Ace Plumbing', 'YOUR ACCESS PIN', 'ABC12345', 'SIGN IN',
    'Ridge Co — Vendor Portal', 'Close', '✕', '×', '&times;', '—',
    'General', 'Normal', 'TOTAL', 'HVAC' /* same word in Spanish */]);
  const bad = [...strings].filter((s) => /[A-Za-z]{3}/.test(s) && !exempt.has(s) && esT(s) === s && !/^(\d{1,2}:\d\d|[\d$.,\s]+$)/.test(s));
  assert.deepEqual(bad, [], 'untranslated static strings — add them to ES_EXTRA in vendor-i18n.js:\n' + bad.join('\n'));
});

test('staging flag is per-tab: vendor.html and wo.html never persist it in localStorage', () => {
  for (const f of ['vendor.html', 'wo.html']) {
    const h = fs.readFileSync(new URL(f, root), 'utf8');
    assert.ok(!/localStorage\.setItem\('mh_api_staging'/.test(h), f + ' still persists the staging flag in localStorage');
    assert.ok(/sessionStorage\.setItem\('mh_api_staging'/.test(h), f + ' should keep the staging flag in sessionStorage');
  }
});
