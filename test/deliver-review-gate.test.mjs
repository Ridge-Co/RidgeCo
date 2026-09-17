// deliverReview (Sep 17 2026) — Brett asked to turn weekly review delivery on while the daily
// digest stays off. Before this, deliverReview and deliverDigest shared one Config flag
// (digest_enabled), so there was no way to enable one without the other. Also fixes a real
// "success:true, nothing happened" shape (rule 6/19 pattern): delivered used to be
// unconditionally true past the gate check even if neither SMS nor email actually fired.
// Structural/source checks, not a full mocked-fetch test — matches this codebase's own
// established convention for functions doing real Sheets/Twilio I/O (see welcome-send.test.mjs).
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
const fnBody = grab('deliverReview');

{
  ok(fnBody.includes('weekly_review_enabled'), 'deliverReview gates on its own weekly_review_enabled flag');
  ok(!/if \(String\(cfg\.digest_enabled/.test(fnBody), 'deliverReview no longer gates on digest_enabled — that stays the daily digest\'s own separate flag, so one can be on while the other is off');
}
{
  ok(!fnBody.includes('return { delivered: true, out }'), 'delivered is never hardcoded true regardless of what actually sent');
  ok(/delivered:\s*!!\(out\.sms \|\| out\.email\)/.test(fnBody), 'delivered reflects whether an SMS or email actually went out, not just that the top-level gate was open');
}
{
  // deliverDigest (the daily digest) is deliberately untouched by this change — Brett asked
  // for weekly only, daily stays exactly as it was (still dormant, still digest_enabled-gated).
  const digestBody = grab('deliverDigest');
  ok(digestBody.includes("cfg.digest_enabled"), 'deliverDigest still gates on digest_enabled, unchanged — Brett only asked to turn on weekly review delivery, not the daily digest');
}

console.log(`deliver-review-gate: ${n}/${n} passing`);
