// Paying vendor bills from the Hub is a money-write, gated by a SECOND factor: a passphrase
// verified server-side against the Cloudflare secret PAY_AUTH_CODE, plus a lock-out after too many
// wrong tries. These pin the two pure pieces that guard the money:
//   payAuthOk — case-insensitive, trimmed; a blank secret OR blank submission NEVER matches (so a
//     not-configured Worker can't be unlocked with an empty code), and a wrong code is refused;
//   payRecentBadCount — counts only 'bad_code' rows inside the lock window, ignoring old failures
//     and other result types, so the lock-out triggers on genuine recent brute-forcing.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const payAuthOk = new Function(grab('payAuthOk') + '\nreturn payAuthOk;')();
const payRecentBadCount = new Function(grab('payRecentBadCount') + '\nreturn payRecentBadCount;')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// payAuthOk
ok(payAuthOk('SecretCode123', 'secretcode123') === true, 'case-insensitive match passes');
ok(payAuthOk('  secretcode123  ', 'secretcode123') === true, 'surrounding whitespace is trimmed');
ok(payAuthOk('wrong', 'secretcode123') === false, 'wrong code is refused');
ok(payAuthOk('', 'secretcode123') === false, 'blank submission never matches');
ok(payAuthOk('anything', '') === false, 'blank secret (not configured) never matches');
ok(payAuthOk('', '') === false, 'blank/blank never matches');
ok(payAuthOk(null, undefined) === false, 'null/undefined never matches');

// payRecentBadCount — window is 15 min in the handler; test with an explicit window here.
const now = Date.parse('2026-08-12T12:00:00Z');
const W = 15 * 60 * 1000;
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const rows = [
  { Result: 'bad_code', Timestamp: iso(1 * 60 * 1000) },   // 1 min ago — counts
  { Result: 'bad_code', Timestamp: iso(5 * 60 * 1000) },   // 5 min ago — counts
  { Result: 'bad_code', Timestamp: iso(20 * 60 * 1000) },  // 20 min ago — too old
  { Result: 'paid',     Timestamp: iso(2 * 60 * 1000) },   // wrong type
  { Result: 'locked',   Timestamp: iso(2 * 60 * 1000) },   // wrong type
  { Result: 'bad_code', Timestamp: '' },                    // unparseable — ignored
];
ok(payRecentBadCount(rows, now, W) === 2, 'counts only recent bad_code rows (2)');
ok(payRecentBadCount([], now, W) === 0, 'empty log ⇒ 0');
ok(payRecentBadCount(null, now, W) === 0, 'null log ⇒ 0 (no crash)');

console.log('pay-bills-auth: ' + n + ' assertions passed');
