// Receipt Reconciler search/filter normalizers must treat straight AND curly apostrophes the same
// (Sep 29 2026): phone keyboards type U+2019, so "Lowe’s" used to normalize to "lowe s" and match
// nothing while "Lowe's" / "lowes" matched. Extracts the REAL shipped functions (worker.js _rcNorm,
// receipt-reconciler.html _clientNorm) so this tests the code that ships, not a copy.
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const h = fs.readFileSync(new URL('../receipt-reconciler.html', import.meta.url), 'utf8');
const impls = {
  worker: new Function(grab(w, '_rcNorm') + '\nreturn _rcNorm;')(),
  client: new Function(grab(h, '_clientNorm') + '\nreturn _clientNorm;')(),
};
for (const [label, norm] of Object.entries(impls)) {
  test(label + ': straight, curly, modifier, backtick and acute apostrophes all normalize like no apostrophe', () => {
    for (const q of ["Lowe's", 'Lowe’s', 'Lowe‘s', 'Loweʼs', 'Lowe`s', 'Lowe´s', 'lowes', 'LOWES'])
      assert.strictEqual(norm(q), 'lowes', JSON.stringify(q));
  });
  test(label + ': a curly-apostrophe query is a substring of a straight-apostrophe store (and vice versa)', () => {
    assert.ok(norm("Lowe's Home Improvement").indexOf(norm('Lowe’s')) >= 0);
    assert.ok(norm('Lowe’s Home Improvement').indexOf(norm("Lowe's")) >= 0);
  });
  test(label + ': other punctuation still becomes a word break, empty/null safe', () => {
    assert.strictEqual(norm('The Home-Depot #123'), 'the home depot 123');
    assert.strictEqual(norm(null), '');
    assert.strictEqual(norm(undefined), '');
  });
}
