// Nov 6 2026 (Brett): a Spanish vendor's portal showed job descriptions in English. Pins localizeVendorDescriptions():
// translate once + save, reuse the saved copy, re-translate when the English changes, cap per request, and make every miss LOUD.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
function grab(name) {
  let i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('missing ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const cap = (src.match(/const DESC_ES_MAX_PER_CALL = (\d+);/) || [])[1];
ok(cap, 'cap constant exists');
let translateCalls = [], saves = [], telemetry = [], mode = 'ok';
const deps = {
  translateForVendorDetailed: async (env, v, text) => { translateCalls.push(text); return (mode === 'ok' || mode === 'savefail') ? { text: 'ES:' + text, translated: true } : { text, translated: false, skipped_reason: 'error' }; },
  ensureColumns: async () => {}, updateRowVerified: async (e, tab, id, f) => { if (mode === 'savefail') throw new Error('did not keep'); saves.push([id, f]); },
  logTelemetry: async (e, r) => { telemetry.push(r); }, console,
};
const mk = new Function(...Object.keys(deps), 'const DESC_ES_MAX_PER_CALL = ' + cap + ';\n' + grab('descFingerprint') + '\n' + grab('localizeVendorDescriptions') + '\nreturn { descFingerprint, localizeVendorDescriptions };');
const { descFingerprint, localizeVendorDescriptions } = mk(...Object.values(deps));
const reset = (m) => { translateCalls = []; saves = []; telemetry = []; mode = m || 'ok'; };
const V = { ID: '3', Language: 'es' };

reset(); let l = [{ ID: '1', Description: 'Fix sink' }];
await localizeVendorDescriptions({}, V, l);
ok(l[0].Description === 'ES:Fix sink' && l[0].Description_EN === 'Fix sink', 'translated, English kept');
ok(saves.length === 1 && saves[0][1].Description_ES === 'ES:Fix sink' && saves[0][1].Description_ES_Src === descFingerprint('Fix sink'), 'saved with fingerprint');
ok(!telemetry.length, 'no failure logged on success');

reset(); l = [{ ID: '1', Description: 'Fix sink', Description_ES: 'Arreglar fregadero', Description_ES_Src: descFingerprint('Fix sink') }];
await localizeVendorDescriptions({}, V, l);
ok(l[0].Description === 'Arreglar fregadero' && !translateCalls.length && !saves.length, 'saved copy reused: no AI call, no write');

reset(); l = [{ ID: '1', Description: 'Fix sink AND toilet', Description_ES: 'Arreglar fregadero', Description_ES_Src: descFingerprint('Fix sink') }];
await localizeVendorDescriptions({}, V, l);
ok(l[0].Description === 'ES:Fix sink AND toilet' && saves.length === 1, 'edited English is re-translated');

reset(); l = Array.from({ length: 9 }, (_, i) => ({ ID: String(i), Description: 'job ' + i }));
await localizeVendorDescriptions({}, V, l);
ok(translateCalls.length === Number(cap), 'at most ' + cap + ' translations per request');

reset(); l = [{ ID: '1', Description: '' }, { ID: '2' }]; await localizeVendorDescriptions({}, V, l);
ok(!translateCalls.length && !telemetry.length, 'blank descriptions are skipped quietly (nothing to translate)');

reset('fail'); l = [{ ID: '1', WO_ID: 'WO-9', Description: 'Fix sink' }];
await localizeVendorDescriptions({}, V, l);
ok(l[0].Description === 'Fix sink' && telemetry.length === 1 && telemetry[0].Success === 'FALSE' && /WO-9/.test(telemetry[0].Notes), 'translation miss: English shown AND logged as a failure with the WO id');

reset('savefail'); l = [{ ID: '1', Description: 'Fix sink' }];
await localizeVendorDescriptions({}, V, l);
ok(l[0].Description === 'ES:Fix sink' && telemetry.length === 1 && /not saved/.test(telemetry[0].Notes), 'save failure: Spanish still shown, failure logged');

ok(/if \(vendorWantsSpanish\(vendorRow\)\) await localizeVendorDescriptions\(env, vendorRow, enriched\);/.test(src), 'vendorWorkorders calls it only for Spanish vendors');
ok(/Description_EN && wo\.Description_EN !== wo\.Description/.test(html), 'portal shows the English original under the Spanish');
console.log('vendor-description-spanish: ' + n + ' checks passed');
