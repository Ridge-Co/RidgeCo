// Oct 21 2026 - Needs Attention cleanup: Sheets read-quota errors and the AI-credit flag read.
//  1. A request that meets Google's shared per-minute READ quota gets a typed 429 "busy, retry" (not a generic 500), and leaves ONE calm P2 row
//     (sheets_quota_busy) in the failure ledger instead of an unhandled_500 P1 per page.
//  2. aiCreditCheck retries the flag read once, keeps honouring the last flag it read, and only a REAL read failure is the urgent P0 row.
// Each case forces the failure and checks the row the failure ledger would hold. Run: node test/quota-busy-and-flag-retry.test.mjs
import fs from 'fs';
import { aiCreditGuardPrelude } from './_ai-credit-guard.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
function grab(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
// the real ledger classifier (same slice failure-ledger.test.mjs uses)
const ledger = new Function(
  grab('function failSevRank(') + '\n' + src.slice(src.indexOf('const FAIL_SEVERITY_BY_WHERE'), src.indexOf('// ── pure helpers (unit-tested)')) + '\n' + grab('function failSeverity(') +
  '\nreturn { failSeverity };')();
const QUOTA = "Sheets API error on GET /values/Estimates: Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com'";

console.log('quota busy');
const busy = new Function(grab('function sheetsQuotaBusyError(') + '\nreturn sheetsQuotaBusyError;')();
t('the exact error from F-1792451685502 is recognised as "busy"', busy(new Error(QUOTA)));
t('a batchGet quota error is recognised too', busy(new Error(QUOTA.replace('/values/Estimates', '/values:batchGet?ranges=Work_Orders'))));
t('a real bug is NOT swallowed as busy', !busy(new Error('Cannot read properties of undefined')) && !busy(new Error('Sheets API error on GET /values/Tenants: Unable to parse range')));
t('a write that hit quota is not treated as a harmless read-busy', !busy(new Error(QUOTA.replace('on GET', 'on POST'))));
t('the busy row is a calm P2 in the ledger (not a P1 unhandled_500)', ledger.failSeverity('sheets_quota_busy', 'role=none ' + QUOTA) === 'P2');
t('the OLD name for the same failure was P1 (this is what changed)', ledger.failSeverity('unhandled_500', 'ref=913a0b63 role=none ' + QUOTA) === 'P1');
// the top-level handler: busy check comes before the generic 500 and answers 429 with text the portals already retry on
const handler = src.slice(src.indexOf('if (sheetsQuotaBusyError(err))'), src.indexOf("const _ref = crypto.randomUUID()"));
t('handler answers 429 with Retry-After and busy:true', /status: 429/.test(handler) && /'Retry-After': '8'/.test(handler) && /busy: true/.test(handler));
t('handler writes the sheets_quota_busy telemetry row (mirrored into the ledger)', /Job_Type: 'sheets_quota_busy'/.test(handler) && /Success: 'FALSE'/.test(handler));
t('the busy message contains "quota" so the portals\' sheetsBusy() retry recognises it', /quota/i.test(handler.match(/error: '([^']+)'/)[1]) && /quota|rate.?limit|read requests/i.test('Google Sheets read quota'));
const vendor = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
t('vendor.html retries on a reply whose error text says quota', /function sheetsBusy\(data\)[^\n]*quota/.test(vendor));

console.log('AI-credit flag read');
{
  const tel = [];
  const mk = (reads, cache) => new Function('READS', 'CACHE', 'logTelemetry', 'console',
    aiCreditGuardPrelude({}).replace(/async function schedReadConfigRows\(\) \{[^\n]*\n/, '') +
    '\nlet __calls = 0; async function schedReadConfigRows() { __calls++; const r = READS[Math.min(__calls - 1, READS.length - 1)]; if (r instanceof Error) throw r; return r; }\n' +
    (cache ? '_aiCreditCache = { at: 0, state: CACHE };\n' : '') +
    'return { check: (o) => aiCreditCheck({}, o), calls: () => __calls };')(reads, cache, async (_e, row) => { tel.push(row); }, { error() {}, warn() {}, log() {} });
  // 1. one blip then success: no row at all
  let w = mk([new Error(QUOTA), []]); let s = await w.check({ fresh: true, retryDelayMs: 1 });
  t('a one-off quota blip is retried once and succeeds with no ledger row', s.paused === false && !s.read_error && w.calls() === 2 && tel.length === 0);
  // 2. both reads busy, nothing known: allowed through, calm P2 row
  w = mk([new Error(QUOTA)]); s = await w.check({ fresh: true, retryDelayMs: 1 });
  const row1 = tel[0] || {};
  t('busy twice with nothing known: AI allowed through, flagged as read_error', s.paused === false && !!s.read_error && w.calls() === 2);
  t('... recorded as ai_credit_flag_read_busy (P2), not the urgent P0 row', row1.Job_Type === 'ai_credit_flag_read_busy' && row1.Success === 'FALSE' && ledger.failSeverity(row1.Job_Type, row1.Notes) === 'P2');
  // 3. both reads busy but the flag was last read as PAUSED: stay paused
  tel.length = 0;
  w = mk([new Error(QUOTA)], { paused: true, kind: 'credit', at: '2026-10-21T10:00:00Z' }); s = await w.check({ fresh: true, retryDelayMs: 1 });
  t('busy twice while AI was paused: stays paused (does not quietly un-pause)', s.paused === true && !!s.read_error);
  // 4. a REAL failure (not quota) is still the urgent row
  tel.length = 0;
  w = mk([new Error('Sheets API error on GET /values/Config: The caller does not have permission')]); s = await w.check({ fresh: true, retryDelayMs: 1 });
  const row2 = tel[0] || {};
  t('a genuine read failure still files ai_credit_flag_read_failed as P0', row2.Job_Type === 'ai_credit_flag_read_failed' && ledger.failSeverity(row2.Job_Type, row2.Notes, undefined) === 'P0');
}
console.log(`quota-busy-and-flag-retry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
