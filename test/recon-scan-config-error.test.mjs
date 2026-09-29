import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' not found');
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return new Function(src.slice(i, k + 1) + '; return ' + name + ';')(); } }
}
const isCfg = grab('receiptReconIsConfigError');
test('missing/rotated key errors are config errors', () => {
  for (const m of ['ANTHROPIC_API_KEY not configured', 'invalid x-api-key', 'authentication_error', 'Missing API key', 'Unauthorized'])
    assert.equal(isCfg(m), true, m);
});
test('per-file problems are NOT config errors', () => {
  for (const m of ['Could not process image', 'Unsupported mime type', 'JSON parse error', '', null, undefined])
    assert.equal(isCfg(m), false, String(m));
});
test('scan loop breaks on config error before recording a per-file failure', () => {
  const s = src.indexOf('async function receiptReconScan');
  const body = src.slice(s, s + 9000);
  const iBreak = body.indexOf('receiptReconIsConfigError(e && e.message)');
  const iRecord = body.indexOf('failures[f.id] = {');
  assert.ok(iBreak > 0 && iRecord > iBreak, 'config check must precede failure recording');
  assert.match(body, /configError = String\(e\.message\)[\s\S]{0,40}break;/);
});
test('stale config-error tracker entries self-heal on load', () => {
  const s = src.indexOf('async function receiptReconScan');
  assert.match(src.slice(s, s + 4000), /receiptReconIsConfigError\(failures\[id\] && failures\[id\]\.error\)\) \{ delete failures\[id\]/);
});
