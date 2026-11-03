// Second Sheets identity (Nov 2 2026, ops queue #227). Real functions pulled out of worker.js:
//  - sa2Parse tolerates the ways the secret gets pasted (whole key file, key only + email) and says in plain words what is wrong with a bad paste;
//  - Sheets READS alternate between the main and second account, a 429 retry switches account, WRITES never use the second account;
//  - every way the second account can be broken (bad paste, token refused, Sheet not shared) falls back to the main account, is REPORTED once, and
//    never breaks the read; with the secret unset nothing changes;
//  - GET /sheets-identities never shows a secret.
import fs from 'fs';
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
function grabRange(src, startSig, endSig) {
  const start = src.indexOf(startSig); if (start < 0) throw new Error('not found: ' + startSig);
  const end = src.indexOf(endSig, start); if (end < 0) throw new Error('end not found: ' + endSig);
  return src.slice(start, end);
}
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

const cacheSrc = grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads');
const sa2Src = grabRange(wsrc, '// ── Second Sheets identity', 'async function importPrivateKey(pem) {');
const gatSrc = grab(wsrc, 'async function getAccessToken(');
const srSrc = grab(wsrc, 'async function sheetsRequest(');

const MAIN = 'main@proj.iam.gserviceaccount.com', SECOND = 'second@proj.iam.gserviceaccount.com';
const PEM = '-----BEGIN PRIVATE KEY-----\nQUJD\nREVG\n-----END PRIVATE KEY-----\n';
const FILE = JSON.stringify({ type: 'service_account', client_email: SECOND, private_key: PEM, project_id: 'p' }, null, 2);
const b64url = s => Buffer.from(s).toString('base64url');

function world(extraEnv, behave) {
  const W = { calls: [], reports: [], tokenMints: [] };
  const fetchImpl = async (url, opts) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      const jwt = decodeURIComponent(String(opts.body).split('assertion=')[1]);
      const claim = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      W.tokenMints.push({ iss: claim.iss, scope: claim.scope });
      if (behave && behave.mintFails && claim.iss === SECOND) return { ok: true, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT signature.' }) };
      return { ok: true, json: async () => ({ access_token: 'TOK-' + claim.iss }) };
    }
    const who = String(opts.headers.Authorization).replace('Bearer TOK-', '');
    W.calls.push({ who, method: opts.method, url: String(url) });
    if (behave && behave.respond) { const r = behave.respond(who, opts.method, String(url)); if (r) return { ok: !r.error, status: r.error ? r.error.code : 200, json: async () => r }; }
    return { ok: true, status: 200, json: async () => ({ values: [['ID'], ['1']], spreadsheetId: 'S' }) };
  };
  const reportFailure = async (env, f) => { W.reports.push(f); };
  const mk = new Function('fetch', 'setTimeout', 'b64url', 'importPrivateKey', 'signRS256', 'reportFailure', 'json',
    'let __sheetsToken = { key: "", token: "", exp: 0 };\n' + cacheSrc + '\n' + sa2Src + '\n' + gatSrc + '\n' + srSrc + '\nreturn { sheetsRequest, getAccessToken, sa2Parse, sa2PickSecond, sheetsIdentitiesReport };');
  const api = mk(fetchImpl, fn => fn(), b64url, async () => 'k', async () => 'sig', reportFailure, o => ({ _json: o }));
  const env = Object.assign({ SHEET_ID: 'S', GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA_KEY: PEM }, extraEnv || {});
  return { W, api, env };
}
const reads = (W) => W.calls.filter(c => c.method === 'GET');

// ── sa2Parse ──
{
  const { api } = world();
  const P = e => api.sa2Parse(e);
  t('unset -> absent', P({}).absent === true && P({ GOOGLE_SA2_JSON: '   ' }).absent === true);
  const ok = P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: FILE });
  t('whole key file -> ok, email and key read out of it', ok.ok && ok.email === SECOND && ok.pem.includes('BEGIN PRIVATE KEY') && ok.format === 'whole key file', ok);
  t('whole key file with surrounding blank lines -> ok', P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: '\n\n' + FILE + '\n  ' }).ok === true);
  const lit = JSON.stringify({ client_email: SECOND, private_key: '-----BEGIN PRIVATE KEY-----\\nQUJD\\n-----END PRIVATE KEY-----\\n' });   // "\n" typed as text inside the key
  const l = P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: lit.replace(/\\\\n/g, '\\\\n') });
  t('key with "\\n" typed as text is repaired to real newlines', l.ok && !l.pem.includes('\\n') && l.pem.includes('\n'), l.pem);
  t('key only + GOOGLE_SA2_EMAIL -> ok', P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: PEM, GOOGLE_SA2_EMAIL: SECOND }).ok === true);
  const noMail = P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: PEM });
  t('key only without email -> not ok, says to set GOOGLE_SA2_EMAIL or paste the whole file', noMail.ok === false && /GOOGLE_SA2_EMAIL/.test(noMail.reason) && /whole key file/.test(noMail.reason), noMail);
  t('cut-off JSON -> not ok, says paste the whole key file again', (r => r.ok === false && /not valid JSON/.test(r.reason) && /whole key file/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: FILE.slice(0, 120) })));
  t('key cut off (no END line) -> not ok', (r => r.ok === false && /BEGIN\/END/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: JSON.stringify({ client_email: SECOND, private_key: '-----BEGIN PRIVATE KEY-----\nQUJD' }) })));
  t('JSON without private_key -> not ok', (r => r.ok === false && /private_key/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: JSON.stringify({ client_email: SECOND }) })));
  t('JSON without client_email -> not ok', (r => r.ok === false && /client_email/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: JSON.stringify({ private_key: PEM }) })));
  t('random text -> not ok', (r => r.ok === false && /neither/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: 'hello' })));
  t('a non-service-account email -> not ok', (r => r.ok === false && /does not look like a service account/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: JSON.stringify({ client_email: 'brett@gmail.com', private_key: PEM }) })));
  t('the SAME account as the main one -> not ok (it would not add quota)', (r => r.ok === false && /SAME service account/.test(r.reason))(P({ GOOGLE_SA_EMAIL: MAIN, GOOGLE_SA2_JSON: JSON.stringify({ client_email: MAIN.toUpperCase(), private_key: PEM }) })));
  t('first read attempt alternates', api.sa2PickSecond(0, undefined) === false && api.sa2PickSecond(1, undefined) === true && api.sa2PickSecond(2, undefined) === false);
  t('a retry always switches account', api.sa2PickSecond(7, true) === false && api.sa2PickSecond(7, false) === true);
}

// ── secret unset: nothing changes ──
{
  const { W, api, env } = world({});
  for (let i = 0; i < 6; i++) await api.sheetsRequest(env, 'GET', '/values/Unset' + i);
  t('unset: every read uses the main account', reads(W).length === 6 && reads(W).every(c => c.who === MAIN));
  t('unset: the second account is never signed in', W.tokenMints.every(m => m.iss === MAIN));
  t('unset: nothing reported', W.reports.length === 0);
}

// ── set and working: reads alternate, writes stay on main ──
{
  const { W, api, env } = world({ GOOGLE_SA2_JSON: FILE });
  for (let i = 0; i < 10; i++) await api.sheetsRequest(env, 'GET', '/values/Work' + i);
  const by = { [MAIN]: 0, [SECOND]: 0 }; reads(W).forEach(c => by[c.who]++);
  t('working: 10 reads split 5/5 between the two accounts', by[MAIN] === 5 && by[SECOND] === 5, by);
  const second = W.tokenMints.find(m => m.iss === SECOND);
  t('second account signs in with the READ-ONLY scope', second && second.scope === 'https://www.googleapis.com/auth/spreadsheets.readonly', second);
  await api.sheetsRequest(env, 'POST', '/values/Work0:append', { values: [['x']] });
  await api.sheetsRequest(env, 'PUT', '/values/Work1!A1', { values: [['y']] });
  const writes = W.calls.filter(c => c.method !== 'GET');
  t('working: writes ALWAYS use the main account', writes.length === 2 && writes.every(c => c.who === MAIN), writes);
  t('working: nothing reported', W.reports.length === 0);
}

// ── a 429 on one account: the retry goes to the OTHER account and succeeds ──
{
  const { W, api, env } = world({ GOOGLE_SA2_JSON: FILE }, { respond: (who) => { if (who === MAIN) return { error: { code: 429, message: 'Quota exceeded' } }; return null; } });
  const rs = [];
  for (let i = 0; i < 4; i++) rs.push(await api.sheetsRequest(env, 'GET', '/values/Quota' + i));
  t('429 on main: all four reads still succeed', rs.every(r => r && r.values));
  const failedMain = reads(W).filter(c => c.who === MAIN).length;
  t('429 on main: the retry went to the second account (no read needed more than 2 attempts)', reads(W).length <= 4 + failedMain && reads(W).filter(c => c.who === SECOND).length >= 4, { total: reads(W).length, failedMain });
}

// ── second account refused (Sheet not shared yet): reads succeed on main, reported ONCE ──
{
  const { W, api, env } = world({ GOOGLE_SA2_JSON: FILE }, { respond: (who) => who === SECOND ? { error: { code: 403, message: 'The caller does not have permission' } } : null });
  const rs = [];
  for (let i = 0; i < 8; i++) rs.push(await api.sheetsRequest(env, 'GET', '/values/Refused' + i));
  t('refused: every read still succeeded (fell back to main)', rs.every(r => r && r.values));
  t('refused: reported exactly once, in plain words', W.reports.length === 1 && W.reports[0].where === 'sheets_second_account' && W.reports[0].severity === 'P2' && /not shared/i.test(W.reports[0].message) && /GOOGLE_SA2_JSON/.test(W.reports[0].message), W.reports);
  const afterSecond = reads(W).filter(c => c.who === SECOND).length;
  t('refused: after the first refusal the second account is left alone for a while', afterSecond === 1, afterSecond);
}

// ── second account token refused by Google ──
{
  const { W, api, env } = world({ GOOGLE_SA2_JSON: FILE }, { mintFails: true });
  const rs = [];
  for (let i = 0; i < 6; i++) rs.push(await api.sheetsRequest(env, 'GET', '/values/Mint' + i));
  t('token refused: every read succeeded on main', rs.every(r => r && r.values) && reads(W).every(c => c.who === MAIN));
  t('token refused: reported once with Google\'s reason', W.reports.length === 1 && /Invalid JWT signature/.test(W.reports[0].message), W.reports);
}

// ── badly pasted secret ──
{
  const { W, api, env } = world({ GOOGLE_SA2_JSON: FILE.slice(0, 90) });
  const rs = [];
  for (let i = 0; i < 5; i++) rs.push(await api.sheetsRequest(env, 'GET', '/values/Bad' + i));
  t('bad paste: reads succeed on main', rs.every(r => r && r.values) && reads(W).every(c => c.who === MAIN));
  t('bad paste: reported once, says to paste the whole key file again', W.reports.length === 1 && /whole key file/.test(W.reports[0].message), W.reports);
}

// ── /sheets-identities ──
{
  const a = world({ GOOGLE_SA2_JSON: FILE });
  const r = (await a.api.sheetsIdentitiesReport(a.env))._json;
  t('report: both accounts sign in and read the Sheet', r.main.sign_in === 'ok' && r.main.read_sheet === 'ok' && r.second.ok === true && r.in_use === true, r);
  t('report: shows the second account email and the key format', r.second.email === SECOND && r.second.key_format === 'whole key file');
  const text = JSON.stringify(r);
  t('report never contains a secret', !text.includes('QUJD') && !text.includes('PRIVATE KEY') && !text.includes('TOK-'), text.slice(0, 300));
  const b = world({});
  const rb = (await b.api.sheetsIdentitiesReport(b.env))._json;
  t('report with the secret unset says so in plain words', rb.second.configured === false && /not set/.test(rb.second.note) && rb.in_use === false, rb);
  const c = world({ GOOGLE_SA2_JSON: PEM });
  const rc = (await c.api.sheetsIdentitiesReport(c.env))._json;
  t('report with a key-only paste says exactly what to do', rc.second.ok === false && /GOOGLE_SA2_EMAIL/.test(rc.second.problem), rc);
  const d = world({ GOOGLE_SA2_JSON: FILE }, { respond: (who) => who === SECOND ? { error: { code: 403, message: 'The caller does not have permission' } } : null });
  const rd = (await d.api.sheetsIdentitiesReport(d.env))._json;
  t('report when the Sheet is not shared with the second account says so', rd.second.ok === false && rd.second.read_sheet === 'FAILED' && /not shared/.test(rd.second.problem), rd);
}

console.log(`\nsecond-sheets-identity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
