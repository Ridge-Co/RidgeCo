// Shared test helper (Oct 20 2026): loads the REAL "AI credit pause" block out of worker.js so that harnesses which slice
// functions into a fake world (new Function(...)) see the same aiCreditIsPausedError / aiCreditCheck / anthropicMessages /
// AI_CREDIT_CODE / AI_PAUSED_USER_MSG / ... the Worker has, and can never drift from it. Prepend `aiCreditGuardPrelude()` to
// the source you hand to new Function(): the block's top-level consts/classes/functions then become locals of that function.
//
// What the block needs from the rest of worker.js:
//   - pure helpers schedCell / schedFindRow / schedErrText: taken from worker.js too (real code);
//   - schedReadConfigRows (a Google Sheets read): the ONE stub - it answers "no Config rows" = the AI-credit pause flag is OFF,
//     so every guarded call goes through exactly as it did before the feature. A test that wants the paused state passes
//     { configRows: [['AI_CREDIT_PAUSED','TRUE'], ...] }.
//   - logTelemetry / sheetsRequest / gmail etc. are only reached on a trip / resume / read-failure path; the harness that
//     exercises those supplies them (none of the harnesses that use this helper do).
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const a = src.indexOf('// ═══ AI-CREDIT-GUARD-BEGIN'), b = src.indexOf('// ═══ AI-CREDIT-GUARD-END');
if (a < 0 || b < 0 || b < a) throw new Error('AI-CREDIT-GUARD markers missing from worker.js');
export const aiCreditGuardSrc = src.slice(a, b);
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name + ' in worker.js');
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const helperFns = ['schedFindRow', 'schedCell', 'schedErrText'].map(grabFn).join('\n');
export function aiCreditGuardPrelude(opts) {
  const rows = JSON.stringify((opts && opts.configRows) || []);
  return helperFns + '\nasync function schedReadConfigRows() { return ' + rows + '; }\n' + aiCreditGuardSrc + '\n';
}
