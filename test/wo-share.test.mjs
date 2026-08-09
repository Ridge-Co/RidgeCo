// Shareable Work Order (B-117) — security core. These pin the parts a leaked or forged
// link must never get past, using the REAL functions pulled out of worker.js:
//   (1) a genuine 24h view token verifies and resolves to its WO;
//   (2) a token minted for WO A is rejected for WO B (cross-WO scoping — the whole point);
//   (3) a tampered signature, a wrong secret, and an expired token all fail closed;
//   (4) a link-scope token can't be used as a view-scope token (scope confusion);
//   (5) the last-4-of-phone gate extracts exactly 4 digits, or refuses.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name){
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;   // keep the async prefix
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

const M = new Function(`
  const _tenc = new TextEncoder(), _tdec = new TextDecoder();
  ${grab('_b64urlBytes')}
  ${grab('_b64urlToBytes')}
  ${grab('_hmac')}
  ${grab('makeSessionToken')}
  ${grab('verifySessionToken')}
  ${grab('_last4')}
  ${grab('woShareAuth')}
  return { makeSessionToken, verifySessionToken, _last4, woShareAuth };
`)();

const SECRET = 'test-worker-secret-abc123';
const env = { WORKER_SECRET: SECRET };

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

(async () => {
  // ── 1. genuine view token round-trips and resolves to its WO ──
  const good = await M.makeSessionToken({ scope:'wo-share', wo:'1042', vid:'7' }, SECRET, 60);
  const p = await M.verifySessionToken(good, SECRET);
  t('valid token verifies', !!p, p);
  t('payload carries the WO', p && p.wo === '1042', p && p.wo);
  const a = await M.woShareAuth(env, good, '1042');
  t('woShareAuth accepts matching WO', !!a && a.vid === '7', a);

  // ── 2. cross-WO: a token for 1042 must not open 1043 ──
  const cross = await M.woShareAuth(env, good, '1043');
  t('woShareAuth REJECTS a different WO (cross-WO)', cross === null, cross);

  // ── 3. fail-closed: tamper, wrong secret, expiry ──
  const tampered = good.slice(0, -3) + (good.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  t('tampered signature rejected', (await M.verifySessionToken(tampered, SECRET)) === null);
  t('wrong secret rejected', (await M.verifySessionToken(good, 'other-secret')) === null);
  const expired = await M.makeSessionToken({ scope:'wo-share', wo:'1042', vid:'7' }, SECRET, -10);
  t('expired token rejected', (await M.verifySessionToken(expired, SECRET)) === null);
  t('woShareAuth rejects expired', (await M.woShareAuth(env, expired, '1042')) === null);
  t('garbage string rejected', (await M.verifySessionToken('not.a.token', SECRET)) === null);
  t('empty token rejected', (await M.woShareAuth(env, '', '1042')) === null);

  // ── 4. scope confusion: the long-lived LINK token is not a view token ──
  const linkTok = await M.makeSessionToken({ scope:'wo-share-link', wo:'1042', rev:'0' }, SECRET, 999);
  t('link-scope token cannot be used as a view token', (await M.woShareAuth(env, linkTok, '1042')) === null);
  // an admin/vendor session token also must not pass the shared gate
  const vendorTok = await M.makeSessionToken({ role:'vendor', id:'7' }, SECRET, 999);
  t('vendor role token rejected by share gate', (await M.woShareAuth(env, vendorTok, '1042')) === null);

  // ── 5. last-4 gate ──
  t('_last4 of +1 number', M._last4('+14105551234') === '1234', M._last4('+14105551234'));
  t('_last4 of formatted number', M._last4('(410) 555-1234') === '1234', M._last4('(410) 555-1234'));
  t('_last4 of short number is empty', M._last4('123') === '', JSON.stringify(M._last4('123')));
  t('_last4 of blank is empty', M._last4('') === '', JSON.stringify(M._last4('')));
  t('_last4 ignores letters', M._last4('ext-9999') === '9999', M._last4('ext-9999'));

  console.log(`\nwo-share: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
