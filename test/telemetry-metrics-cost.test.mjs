// computeTelemetryMetrics — per-job-type cost_total (greenlit Ops_Build_Queue #21, Sep 2026).
// Before this, Est_Cost was only ever summed globally (est_cost_total); there was no way to
// tell from the weekly_review output whether e.g. items_summarize's 49 cheap-tier calls or
// receipt_parse's 11 expensive-tier calls actually dominate spend. This adds a cost_total to
// each job's entry in byJob, alongside the existing count/fail/success_rate/avg_latency_ms.
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
const { computeTelemetryMetrics } = new Function(grab('computeTelemetryMetrics') + '\nreturn { computeTelemetryMetrics };')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

{
  const rows = [
    { Job_Type: 'receipt_parse', Success: 'TRUE', Est_Cost: '0.0150', Latency_ms: '7000' },
    { Job_Type: 'receipt_parse', Success: 'FALSE', Est_Cost: '0.0000', Latency_ms: '400' },
    { Job_Type: 'items_summarize', Success: 'TRUE', Est_Cost: '0.0005', Latency_ms: '1000' },
    { Job_Type: 'items_summarize', Success: 'TRUE', Est_Cost: '0.0006', Latency_ms: '1200' },
  ];
  const m = computeTelemetryMetrics(rows);
  ok(m.byJob.receipt_parse.cost_total === 0.015, 'receipt_parse cost_total sums only its own rows (0.0150 + 0.0000)');
  ok(m.byJob.items_summarize.cost_total === 0.0011, 'items_summarize cost_total sums only its own rows (0.0005 + 0.0006), never mixed with receipt_parse');
  ok(m.est_cost_total === 0.0161, 'the global est_cost_total is unchanged by this addition — still the sum across every row');
}
{
  const rows = [{ Job_Type: 'wo_create', Success: 'TRUE' }];
  const m = computeTelemetryMetrics(rows);
  ok(m.byJob.wo_create.cost_total === 0, 'a job type with no Est_Cost values at all (a non-AI job like wo_create) gets cost_total 0, not null/NaN/undefined');
}
{
  const rows = [{ Job_Type: 'receipt_parse', Success: 'TRUE', Est_Cost: 'not-a-number' }];
  const m = computeTelemetryMetrics(rows);
  ok(m.byJob.receipt_parse.cost_total === 0, 'a malformed Est_Cost value is ignored (Number.isFinite guard), never poisons the accumulator with NaN');
}
{
  const rows = [
    { Job_Type: 'a', Success: 'TRUE', Est_Cost: '0.000001', Latency_ms: '10' },
  ];
  const m = computeTelemetryMetrics(rows);
  ok(typeof m.byJob.a.cost_total === 'number' && !('_cost' in m.byJob.a), 'the private _cost accumulator is stripped from the returned object, same discipline as _sk/_st/_ls/_ln');
}

console.log(`telemetry-metrics-cost: ${n}/${n} passing`);
