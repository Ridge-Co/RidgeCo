// Start Build / ops-queue-status (Sep 19 2026) — Brett's "fire it" button (proposals.html,
// built separately) fires ONE real Claude Code cloud session (Anthropic Routines API) that
// builds one or more SAFE-class greenlit/prepared/held Ops_Build_Queue items in a single
// session, then each item reports its own outcome back to POST /ops-queue-status as its own
// last step — so one failing item never blocks the rest of the batch. These pin the three pure
// helpers extracted straight from worker.js (no I/O), same style as
// test/receipt-duplicate-checker.test.mjs and test/failure-alert-dead-man-switch.test.mjs:
//   - validateQueueStatusReport — the hard structural boundary behind POST /ops-queue-status,
//     reachable by the narrow OPS_QUEUE_TOKEN: can only ever report building/done/held, never
//     greenlit/prepared/dropped.
//   - isEligibleForStartBuild — which rows POST /ops-queue/start-build (WORKER_SECRET only) may
//     actually fire on: SAFE Risk_Class + greenlit/prepared/held Status.
//   - buildStartBuildRoutineText — the routine-fire request's `text` field: one section per
//     eligible item plus the fixed instructions block, with the real OPS_QUEUE_TOKEN substituted.
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

const { validateQueueStatusReport, isEligibleForStartBuild, buildStartBuildRoutineText } = new Function(
  grab('validateQueueStatusReport') + '\n' +
  grab('isEligibleForStartBuild') + '\n' +
  grab('buildStartBuildRoutineText') +
  '\nreturn { validateQueueStatusReport, isEligibleForStartBuild, buildStartBuildRoutineText };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── validateQueueStatusReport ───────────────────────────────────────────────────────────────
const rowGreenlit = { ID: '1', Status: 'greenlit' };
const rowPrepared  = { ID: '2', Status: 'prepared' };
const rowBuilding  = { ID: '3', Status: 'building' };
const rowDone       = { ID: '4', Status: 'done' };
const rowDropped   = { ID: '5', Status: 'dropped' };
const rowHeld        = { ID: '6', Status: 'held' };

// invalid requestedStatus is rejected outright — this is the hard boundary that keeps the
// narrow OPS_QUEUE_TOKEN from ever reaching greenlit/prepared/dropped.
{
  ok(validateQueueStatusReport(rowGreenlit, 'greenlit', '').error === 'invalid_status', "'greenlit' is never an acceptable report");
  ok(validateQueueStatusReport(rowGreenlit, 'prepared', '').error === 'invalid_status', "'prepared' is never an acceptable report");
  ok(validateQueueStatusReport(rowGreenlit, 'dropped', '').error === 'invalid_status', "'dropped' is never an acceptable report");
  ok(validateQueueStatusReport(rowGreenlit, 'garbage', '').error === 'invalid_status', 'garbage input is rejected, not silently coerced');
  ok(validateQueueStatusReport(rowGreenlit, '', '').error === 'invalid_status', 'blank status is rejected');
}

// wrong current status — this endpoint reports on an in-flight or about-to-start item; it must
// never silently overwrite an item that's already done/dropped/held.
{
  ok(validateQueueStatusReport(rowDone, 'done', '').error === 'wrong_current_status', 'an already-done row refuses a duplicate done report');
  ok(validateQueueStatusReport(rowDropped, 'done', '').error === 'wrong_current_status', 'a dropped row can never be reported on');
  ok(validateQueueStatusReport(rowHeld, 'held', 'still stuck').error === 'wrong_current_status', 'an already-held row refuses a second held report (must be re-fired via Start Build first)');
}

// held requires a real note
{
  ok(validateQueueStatusReport(rowGreenlit, 'held', '').error === 'held_requires_note', 'held with no note is rejected');
  ok(validateQueueStatusReport(rowGreenlit, 'held', '   ').error === 'held_requires_note', 'held with a whitespace-only note is rejected');
  ok(validateQueueStatusReport(rowGreenlit, 'held', undefined).error === 'held_requires_note', 'held with note omitted entirely is rejected');
  ok(validateQueueStatusReport(rowGreenlit, 'held', 'hit a real blocker, needs Brett to decide X').ok === true, 'held WITH a real note is accepted');
}

// valid building/done reports from each of the three allowed current statuses
{
  for (const row of [rowGreenlit, rowPrepared, rowBuilding]) {
    ok(validateQueueStatusReport(row, 'building', '').ok === true, `'building' accepted from current status '${row.Status}'`);
    ok(validateQueueStatusReport(row, 'done', '').ok === true, `'done' accepted from current status '${row.Status}'`);
  }
}

// ── isEligibleForStartBuild ─────────────────────────────────────────────────────────────────
{
  ok(isEligibleForStartBuild(null).reason === 'not_found', 'a missing row is not_found');
  ok(isEligibleForStartBuild(undefined).reason === 'not_found', 'undefined row is not_found');
}
{
  for (const status of ['greenlit', 'prepared', 'held']) {
    const v = isEligibleForStartBuild({ ID: '1', Risk_Class: 'SAFE', Status: status });
    ok(v.eligible === true, `SAFE + ${status} is eligible`);
  }
}
{
  // fail-closed Risk_Class — only the exact string 'SAFE' counts, mirroring opsApprove.
  for (const risk of ['GATED', '', 'safe', 'Safe', undefined, 'unknown']) {
    const v = isEligibleForStartBuild({ ID: '1', Risk_Class: risk, Status: 'greenlit' });
    ok(v.eligible === false && v.reason === 'gated', `Risk_Class ${JSON.stringify(risk)} is rejected as gated, never defaulted to eligible`);
  }
}
{
  for (const status of ['building', 'done', 'dropped']) {
    const v = isEligibleForStartBuild({ ID: '1', Risk_Class: 'SAFE', Status: status });
    ok(v.eligible === false && v.reason === 'wrong_status:' + status, `SAFE + ${status} is rejected with reason 'wrong_status:${status}'`);
  }
}

// ── buildStartBuildRoutineText ──────────────────────────────────────────────────────────────
const withBrief = { ID: '101', Title: 'Fix the thing', Tag: 'reliability', Risk_Class: 'SAFE',
  Problem: 'The thing is broken', First_Step: 'Read the code', Effort: 'S', Build_Brief: 'Do exactly this: patch X, test Y.' };
const withoutBrief = { ID: '102', Title: 'Untouched item', Tag: 'ux', Risk_Class: 'SAFE',
  Problem: 'Nobody looked yet', First_Step: 'Investigate', Effort: 'M', Build_Brief: '' };

const text = buildStartBuildRoutineText([withBrief, withoutBrief], 'FAKE_OPS_QUEUE_TOKEN_xyz');

{
  ok(text.includes('ID: 101') && text.includes('Title: Fix the thing'), "item 101's ID and Title appear");
  ok(text.includes('ID: 102') && text.includes('Title: Untouched item'), "item 102's ID and Title appear");
  ok(text.includes('Do exactly this: patch X, test Y.'), 'a present Build_Brief is included VERBATIM');
  ok(text.includes('No Build_Brief yet'), 'a missing/blank Build_Brief gets the "research from scratch" line instead');
  ok(text.indexOf('No Build_Brief yet') > text.indexOf('ID: 102'), 'the no-brief line is scoped to the item that actually has no brief (102), not item 101 which has one');
  ok(!/Do exactly this: patch X, test Y\.[\s\S]*No Build_Brief yet/.test(text) || text.indexOf('Do exactly this') < text.indexOf('ID: 102'),
    "item 101's real brief is not swallowed by item 102's fallback line");
}
{
  ok(text.includes('INSTRUCTIONS FOR THIS BUILD SESSION'), 'the fixed instructions header is present');
  ok(text.includes('X-Auth-Token: FAKE_OPS_QUEUE_TOKEN_xyz'), 'the real OPS_QUEUE_TOKEN value is substituted into the instructions block');
  ok(text.includes('POST https://maintenance-hub.brett-2f8.workers.dev/ops-queue-status'), 'the callback URL is the real production ops-queue-status endpoint');
  ok(/"status":\s*"done"/.test(text) && /"status":\s*"held"/.test(text), 'both the success (done) and failure (held) report bodies are shown');
  ok(/do NOT let it block the others/i.test(text), 'instructs the fired session not to let one failing item block the rest of the batch');
  ok(/report it back immediately/i.test(text), 'instructs the fired session to report each item back as it finishes, not batch it all to the end');
}
{
  // a single-item batch still gets both the item section and the instructions block.
  const single = buildStartBuildRoutineText([withBrief], 'TOKEN2');
  ok(single.includes('ID: 101') && single.includes('INSTRUCTIONS FOR THIS BUILD SESSION') && single.includes('TOKEN2'),
    'a one-item batch still produces a complete section + instructions block');
}

console.log(`ops-queue-build-trigger: ${n}/${n} passing`);
