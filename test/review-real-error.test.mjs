// llmReviewProposal (Oct 20 2026) — the Command Center Optimizer panel showed "(Model proposal unavailable
// this round: empty LLM response.)" because the function never checked resp.ok, so any non-credit Anthropic
// error (rate limit, overloaded, bad model...) had no content and was reported as "empty". It must now
// report Anthropic's real HTTP status/type/message, and name the stop_reason when a reply has no text.
// Structural/source checks (same convention as deliver-review-gate.test.mjs).
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const body = grab('llmReviewProposal');

ok(/const \{ resp, data \} = await anthropicMessages\(/.test(body), 'llmReviewProposal reads resp as well as data from anthropicMessages');
ok(/if \(!resp\.ok\)/.test(body), 'a non-OK Anthropic reply is checked explicitly');
ok(body.includes("'Anthropic HTTP ' + resp.status"), 'the thrown error carries the real HTTP status');
ok(body.includes('ae.message'), 'the thrown error carries Anthropic\'s own error message');
ok(body.includes('stop_reason'), 'a reply with no text names its stop_reason');
ok(!body.includes("'empty LLM response'"), 'the vague "empty LLM response" message is gone');
ok(body.includes("b.type === 'text'"), 'the first TEXT block is used, not blindly content[0]');

console.log(`review-real-error: ${n}/${n} passing`);
