// Optimizer Scout & Reuse-Radar → POST /ops-queue/scout-submit (Sep 20 2026). Pins the two pure
// helpers extracted straight from worker.js (no I/O), same style as
// test/ops-queue-build-trigger.test.mjs:
//   - validateScoutSubmitItems — the 1–20 items shape/cap check opsQueueScoutSubmit runs before
//     any I/O, same cap/message as opsApprove.
//   - buildScoutQueueRow — shapes ONE finding into the exact Ops_Build_Queue row fields written
//     via addRow. Status/Approved_By/Risk_Class are hardcoded there, never read from the item —
//     this is the hard structural boundary that keeps the narrow SCOUT_QUEUE_TOKEN from ever
//     reaching greenlit/prepared/building/done/dropped/held.
// Also pins OPS_QUEUE_STATUSES/OPS_QUEUE_COLS so the new 'proposed' status and the four new
// Lens/Requires_Spend/Spend_Note/Workaround columns don't silently regress.
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
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' = [');
  if (i < 0) throw new Error('missing const ' + name);
  const j = src.indexOf(';', i);
  return src.slice(i, j + 1);
}

const { validateScoutSubmitItems, buildScoutQueueRow } = new Function(
  grab('validateScoutSubmitItems') + '\n' +
  grab('buildScoutQueueRow') +
  '\nreturn { validateScoutSubmitItems, buildScoutQueueRow };'
)();

// OPS_QUEUE_STATUSES/OPS_QUEUE_COLS are read straight out of the source text (not re-executed —
// they don't need the rest of worker.js's module scope) so a future edit that quietly drops
// 'proposed' or one of the four new columns fails this test immediately.
const statusesSrc = grabConst('OPS_QUEUE_STATUSES');
const colsSrc = grabConst('OPS_QUEUE_COLS');
const OPS_QUEUE_STATUSES = new Function('return ' + statusesSrc.replace(/^const OPS_QUEUE_STATUSES = /, '').replace(/;$/, ''))();
const OPS_QUEUE_COLS = new Function('return ' + colsSrc.replace(/^const OPS_QUEUE_COLS = /, '').replace(/;$/, ''))();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── OPS_QUEUE_STATUSES / OPS_QUEUE_COLS ─────────────────────────────────────────────────────
{
  ok(OPS_QUEUE_STATUSES[0] === 'proposed', "'proposed' is first in OPS_QUEUE_STATUSES — earliest lifecycle stage");
  ok(OPS_QUEUE_STATUSES.includes('greenlit') && OPS_QUEUE_STATUSES.includes('prepared') &&
     OPS_QUEUE_STATUSES.includes('building') && OPS_QUEUE_STATUSES.includes('done') &&
     OPS_QUEUE_STATUSES.includes('dropped') && OPS_QUEUE_STATUSES.includes('held'),
     'every pre-existing status survives the addition');
  for (const col of ['Lens', 'Requires_Spend', 'Spend_Note', 'Workaround']) {
    ok(OPS_QUEUE_COLS.includes(col), `OPS_QUEUE_COLS gained ${col} (additive schema move)`);
  }
  for (const col of ['ID', 'Timestamp', 'Title', 'Rank', 'Problem', 'Impact', 'Effort', 'Tag',
    'First_Step', 'Review_TS', 'Status', 'Approved_By', 'Drop_Reason', 'Superseded_By',
    'Risk_Class', 'Build_Brief', 'Held_Note']) {
    ok(OPS_QUEUE_COLS.includes(col), `pre-existing column ${col} was not dropped (additive-only)`);
  }
}

// ── validateScoutSubmitItems ─────────────────────────────────────────────────────────────────
{
  ok(validateScoutSubmitItems([]).error === 'items required', 'empty array is rejected');
  ok(validateScoutSubmitItems(undefined).error === 'items required', 'undefined is rejected the same as empty');
  ok(validateScoutSubmitItems(null).error === 'items required', 'null is rejected the same as empty');
  ok(validateScoutSubmitItems('not-an-array').error === 'items required', 'a non-array is rejected, not coerced');
}
{
  const twentyOne = Array.from({ length: 21 }, (_, i) => ({ title: 'item ' + i }));
  ok(validateScoutSubmitItems(twentyOne).error === 'too many at once (max 20)', '21 items is rejected with the exact opsApprove wording');
  const twenty = Array.from({ length: 20 }, (_, i) => ({ title: 'item ' + i }));
  ok(validateScoutSubmitItems(twenty).ok === true, 'exactly 20 items is accepted (the cap, not one under it)');
  ok(validateScoutSubmitItems([{ title: 'one' }]).ok === true, 'a single item is accepted');
}

// ── buildScoutQueueRow ───────────────────────────────────────────────────────────────────────
const NOW = '2026-09-20T12:00:00.000Z';
const REVIEW_TS = '2026-09-19T00:00:00.000Z';

{
  // full item — every field maps, slices applied, action wins over first_step.
  const it = {
    rank: 1, title: 'x'.repeat(250), lens: 'Outward', tag: 'reuse', effort: 'S',
    problem: 'p'.repeat(700), impact: 'i'.repeat(400), action: 'do the thing',
    first_step: 'should not be used', requires_spend: true, spend_note: 's'.repeat(400),
    workaround: 'w'.repeat(400),
  };
  const row = buildScoutQueueRow(it, NOW, REVIEW_TS);
  ok(row.Timestamp === NOW, 'Timestamp is the passed-in now');
  ok(row.Title.length === 200 && row.Title === 'x'.repeat(200), 'Title is sliced to 200 chars');
  ok(row.Rank === '1', 'Rank is stringified');
  ok(row.Problem.length === 600, 'Problem is sliced to 600 chars');
  ok(row.Impact.length === 300, 'Impact is sliced to 300 chars');
  ok(row.Effort === 'S', 'Effort passes through');
  ok(row.Tag === 'reuse', 'Tag passes through');
  ok(row.First_Step === 'do the thing', "action wins over first_step, same fallback order as opsApprove");
  ok(row.Review_TS === REVIEW_TS, 'Review_TS is the passed-in reviewTs');
  ok(row.Lens === 'Outward', 'Lens passes through');
  ok(row.Requires_Spend === 'TRUE', 'requires_spend:true becomes the string TRUE');
  ok(row.Spend_Note.length === 300, 'Spend_Note is sliced to 300 chars');
  ok(row.Workaround.length === 300, 'Workaround is sliced to 300 chars');
}
{
  // action missing -> falls back to first_step
  const row = buildScoutQueueRow({ title: 't', first_step: 'fallback step' }, NOW, REVIEW_TS);
  ok(row.First_Step === 'fallback step', 'first_step is used when action is absent');
}
{
  // boolean-to-string conversion — only a truthy requires_spend becomes 'TRUE'.
  for (const v of [false, undefined, null, '', 0]) {
    ok(buildScoutQueueRow({ requires_spend: v }, NOW, REVIEW_TS).Requires_Spend === 'FALSE',
      `requires_spend ${JSON.stringify(v)} becomes the string FALSE, never defaulted to TRUE`);
  }
  for (const v of [true, 'yes', 1]) {
    ok(buildScoutQueueRow({ requires_spend: v }, NOW, REVIEW_TS).Requires_Spend === 'TRUE',
      `truthy requires_spend ${JSON.stringify(v)} becomes the string TRUE`);
  }
}
{
  // missing/blank item -> every field defaults to a safe blank/'' string, never throws.
  const row = buildScoutQueueRow({}, NOW, REVIEW_TS);
  ok(row.Title === '' && row.Rank === '' && row.Problem === '' && row.Impact === '' &&
     row.Effort === '' && row.Tag === '' && row.First_Step === '' && row.Lens === '' &&
     row.Spend_Note === '' && row.Workaround === '', 'a bare {} item produces blank strings, not throws/undefined');
  ok(buildScoutQueueRow(null, NOW, REVIEW_TS).Title === '', 'a null item is treated the same as {}');
}
{
  // the hard structural boundary: Status/Approved_By/Risk_Class are ALWAYS these exact values,
  // even if the item itself tries to smuggle a different one in — this is what makes the narrow
  // SCOUT_QUEUE_TOKEN structurally incapable of ever producing a greenlit row.
  const hostile = { Status: 'greenlit', status: 'greenlit', Approved_By: 'brett', approved_by: 'brett',
    Risk_Class: 'SAFE', risk_class: 'SAFE', title: 'looks innocent' };
  const row = buildScoutQueueRow(hostile, NOW, REVIEW_TS);
  ok(row.Status === 'proposed', "Status is always 'proposed', regardless of what the item contains");
  ok(row.Approved_By === 'scout-reuse-radar', "Approved_By is always 'scout-reuse-radar'");
  ok(row.Risk_Class === '', "Risk_Class is always '' — nothing this endpoint writes is ever pre-approved as SAFE");
}

console.log(`ops-queue-scout-submit: ${n}/${n} passing`);
