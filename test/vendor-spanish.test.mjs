// Spanish completeness check for the vendor portal (Nov 16 2026).
// Why this exists: vendor-i18n.js swaps exact English strings for Spanish, so every new English sentence added to vendor.html showed up in English
// for Spanish-speaking vendors until someone noticed. This test reads vendor.html, pulls out every piece of visible-looking text, runs it through the
// real Spanish translator, and FAILS on any English-looking text that stays English and is not in test/vendor-spanish-allow.json (internal strings
// that vendors never see). To fix a failure: add the Spanish to ES_EXTRA / ES_RULES in vendor-i18n.js. Only add to the allow list for strings that
// are code or internal, never for anything a vendor can read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
// vendor-job-order.js holds vendor-facing text too (Nov 17 2026), so it is scanned exactly like an inline <script>.
const html = read('vendor.html') + '\n<script>\n' + read('vendor-job-order.js') + '\n</script>\n<script>\n' + read('vendor-home.js') + '\n</script>';
const i18n = read('vendor-i18n.js');
const allow = new Set(JSON.parse(read('test/vendor-spanish-allow.json')));

// The page's own ES dictionary (defined inline in vendor.html) plus the shared layer, evaluated exactly as the browser does.
const esBlock = /var ES = (\{[\s\S]*?\n\});/.exec(html);
assert.ok(esBlock, 'could not find the ES dictionary in vendor.html');
const sandbox = { window: { alert() {}, confirm() {}, prompt() {} }, document: {}, console };
vm.createContext(sandbox);
vm.runInContext(`var LANG = 'es'; var ES = ${esBlock[1]};\n${i18n}\nthis.esT = esT;`, sandbox);
const esT = sandbox.esT;

const ENG = new Set(`the your you this that please enter select add save cancel submit upload photo photos receipt receipts invoice estimate create edit delete remove view click tap optional required hours hour rate notes description status loading error failed success saved sent done back next close with from have has will was were been not and for are is to of in on at by or if it an be we our can job jobs work order orders bill price amount time name phone email address property tenant vendor access code key truck stock inventory use used any which what when how did do does new old more less all only just here there then than but so some many each per after before during yes tell us message send sending submitting reply choose pick take picture scan file files page screen help support contact call text update updated updating confirm confirmed review reviewed check checked complete completed incomplete unable could should would may might must need needs needed longer already again try retry later soon now today tomorrow week month day days start end begin finish line item items labor material materials parts part cost costs fee fees tax subtotal balance paid unpaid due overdue pending approved declined rejected cancelled canceled hold progress open closed assigned accepted scheduled schedule date appointment visit arrive arrival window morning afternoon evening reason details detail info information additional extra found something else proposal proposals request requests approve deny approval unit sign accept decline thank notified bill billed flat accepting declining adding logging`.split(/\s+/));
const engWords = (s) => (s.toLowerCase().match(/[a-z']+/g) || []).filter((w) => ENG.has(w));
const codey = (s) => /[{}();=<>\[\]]|\.(js|css|png|html)|https?:|^\.?[a-z]+-[a-z-]+$|^[a-z_]+$|\\|^#|px|^\/|^[a-z]+\.[a-z]+|^[A-Z][a-z]+_[A-Za-z_]+$/.test(s);

export function visibleFragments(src) {
  const out = new Set();
  const add = (t) => { t = t.replace(/\s+/g, ' ').trim(); if (t.length >= 3 && t.length <= 400 && /[A-Za-z]{3}/.test(t)) out.add(t); };
  const scripts = [...src.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  for (const m of scripts.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const lit = (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ');
    for (const frag of lit.split(/<[^>]*>|\$\{[^}]*\}/)) add(frag);
  }
  const markup = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  for (const frag of markup.split(/<[^>]*>/)) add(frag);
  for (const m of markup.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)) add(m[1]);
  return [...out].sort();
}

test('every English-looking piece of vendor.html text has a Spanish translation', () => {
  const leftovers = visibleFragments(html).filter((s) => !codey(s) && engWords(s).length && esT(s) === s && !allow.has(s));
  assert.deepEqual(leftovers, [], 'English text a Spanish-speaking vendor would see. Add Spanish to ES_EXTRA / ES_RULES in vendor-i18n.js:\n' + leftovers.map((s) => '  ' + JSON.stringify(s)).join('\n'));
});

test('the allow list holds no string that is actually translated (keeps the list honest)', () => {
  const stale = [...allow].filter((s) => esT(s) !== s);
  assert.deepEqual(stale, [], 'These are translated now - remove them from test/vendor-spanish-allow.json:\n' + stale.join('\n'));
});

test('translator spot checks: dynamic strings seen in English in a Spanish session', () => {
  const cases = {
    'Account locked. Try again in 5 minutes.': 'Cuenta bloqueada. Intente de nuevo en 5 minutos.',
    'PIN not found. 3 attempts remaining.': 'PIN no encontrado. Le quedan 3 intentos.',
    'Invalid PIN': 'PIN inválido',
    '✓ Bill submitted! Total: $85.00': '✓ ¡Factura enviada! Total: $85.00',
    '✓ Job logged — JOB-12!': '✓ ¡Trabajo registrado — JOB-12!',
    '↻ Retrying… (2/3)': '↻ Reintentando… (2/3)',
    '↑ Uploading… (attempt 2)': '↑ Subiendo… (intento 2)',
    '📋 Flat: $85.00': '📋 Precio fijo: $85.00',
    '⏱ Flat rate = $0.00': '⏱ Precio fijo = $0.00',
    'Property 76': 'Propiedad 76',
    'Error: Not found': 'Error: No encontrado',
    'Unexpected response (HTTP 500)': 'Respuesta inesperada (HTTP 500)',
    'Something went wrong on our side. Please try again; if it keeps happening, tell Ridge Co and quote ref 78de2648.': 'Algo salió mal de nuestra parte. Intente de nuevo; si sigue pasando, avise a Ridge Co e indique la referencia 78de2648.',
    'This work order is not assigned to you, so nothing was saved. Contact Ridge Co if this is a mistake. / Esta orden de trabajo no está asignada a usted, así que no se guardó nada.': 'Esta orden de trabajo no está asignada a usted, así que no se guardó nada.',
    "Something didn't work. We've been notified and will fix it.": 'Algo no funcionó. Ya nos avisaron y lo vamos a arreglar.',
    '+ Line Item': '+ Agregar artículo',
    '+ Create Estimate': '+ Crear estimado',
    'Accepting…': 'Aceptando…',
    'A reason is required to put a work order On Hold.': 'Se requiere un motivo para poner una orden de trabajo en espera.',
    'Could not calculate duration': 'No se pudo calcular la duración',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(esT(en), es);
});
