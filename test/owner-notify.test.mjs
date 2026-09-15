// Owner message rebuild (Sep 14 2026): NOTIFY_TIERS content (Assigned/Invoiced retired,
// Received/On_Hold added) and the On-Hold reason requirement in updateStatus. The reason check
// matters structurally, not just functionally — it exists specifically to guarantee a WO is
// NEVER left On Hold with no reason on record, so this test also locks in that the check
// happens before any Sheets read/write in updateStatus, not just that it eventually 400s.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grabConst(name) {
  const i = src.indexOf('const ' + name + '=');
  if (i < 0) throw new Error('missing ' + name);
  const j = src.indexOf('};', i);
  return src.slice(i, j + 2);
}
function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  const i2 = i < 0 ? src.indexOf('function ' + name + '(') : i;
  if (i2 < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i2));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i2, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const { NOTIFY_TIERS } = new Function(grabConst('NOTIFY_TIERS') + '\nreturn { NOTIFY_TIERS };')();

// ---- NOTIFY_TIERS content ----
{
  ok(!NOTIFY_TIERS.always.includes('Assigned'), 'Assigned is retired from owner messages entirely — owners no longer get an assignment text');
  ok(!NOTIFY_TIERS.always.includes('Invoiced'), 'Invoiced is retired — the invoice email already covers this, no separate SMS');
  ok(!NOTIFY_TIERS.always.includes('Accepted') && !NOTIFY_TIERS.always.includes('In Progress') && !NOTIFY_TIERS.always.includes('Pending Invoice'), 'no stale event names survive from the pre-rebuild tier list');
}
{
  ok(NOTIFY_TIERS.always.includes('Received'), 'always tier includes the new Received event');
  ok(NOTIFY_TIERS.always.includes('Scheduled') && NOTIFY_TIERS.always.includes('Complete'), 'always tier keeps Scheduled and Complete');
  ok(NOTIFY_TIERS.always.includes('On_Hold'), 'always tier includes the new On_Hold event');
}
{
  ok(NOTIFY_TIERS.completion.includes('On_Hold'), 'On_Hold is included even in the completion-only tier — a delay is worth knowing regardless of tier');
  ok(NOTIFY_TIERS.completion.includes('Complete'), 'completion tier still includes Complete itself');
  ok(!NOTIFY_TIERS.completion.includes('Received') && !NOTIFY_TIERS.completion.includes('Scheduled'), 'completion tier correctly excludes the earlier-stage events');
}
{
  ok(Array.isArray(NOTIFY_TIERS.off) && NOTIFY_TIERS.off.length === 0, 'off tier is genuinely empty — a real opt-out, not accidentally inheriting events');
}

// ---- updateStatus: the On-Hold reason check happens BEFORE any Sheets I/O ----
// Structural, not behavioral: confirms the validation is positioned before the first fetchTab
// call in the function body, so a request with status='On Hold' and no reason can never
// partially write anything (Status flips but Hold_Reason stays blank) — it 400s clean, first.
{
  const fnBody = grab('updateStatus');
  const reasonCheckIdx = fnBody.indexOf("body.status === 'On Hold'");
  const firstFetchIdx = fnBody.indexOf('fetchTab(env');
  ok(reasonCheckIdx >= 0, 'updateStatus contains an On Hold check at all');
  ok(firstFetchIdx >= 0, 'updateStatus contains at least one fetchTab call (sanity check the extraction worked)');
  ok(reasonCheckIdx < firstFetchIdx, 'the On-Hold reason check is positioned before the first Sheets read — so an unreasoned On-Hold request 400s before touching anything, never as a partial write');
}
{
  const fnBody = grab('updateStatus');
  ok(fnBody.includes("A reason is required to put a work order On Hold"), 'a real 400 error message exists for the missing-reason case, not a silent fallback');
  ok(fnBody.includes('hold_reason || body.notes'), 'accepts hold_reason as the primary field, body.notes as a fallback — not hold_reason only, which would break a caller that only ever sent notes');
}

console.log(`owner-notify: ${n}/${n} passing`);
