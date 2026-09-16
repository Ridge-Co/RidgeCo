// Message_Templates (Sep 16 2026) — renderTemplate is the one substitution function every
// template-driven send (PIN intro, welcome, property notice) runs through, so it's worth
// pinning down directly rather than only indirectly through a full send. Same eval-extraction
// pattern as test/message-queue.test.mjs.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { renderTemplate } = new Function(grab('renderTemplate') + '\nreturn { renderTemplate };')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(renderTemplate('Hi {FirstName}!', { FirstName: 'Jennifer' }) === 'Hi Jennifer!', 'single token substitutes');
ok(renderTemplate('{A} and {B} and {A}', { A: 'x', B: 'y' }) === 'x and y and x', 'repeated token substitutes every occurrence');
ok(renderTemplate('Owner: {Owner}', {}) === 'Owner: ', 'a token with no matching key renders blank, not the literal {Owner}');
ok(renderTemplate('Owner: {Owner}', { Owner: null }) === 'Owner: ', 'an explicit null value renders blank, not the literal "null"');
ok(renderTemplate('', { A: 'x' }) === '', 'empty body returns empty string');
ok(renderTemplate(null, { A: 'x' }) === '', 'null body never throws — returns empty string');
ok(renderTemplate('no tokens here', { A: 'x' }) === 'no tokens here', 'text with no tokens passes through unchanged');
ok(renderTemplate('{Only}', { Only: '' }) === '', 'an empty-string token value renders as empty (not left as the placeholder)');

console.log(`message-templates: ${n}/${n} passing`);
