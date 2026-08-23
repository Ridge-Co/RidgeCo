// B-211 independent verifier write-gate (judge()) — tests the pure/deterministic
// gate logic (fail-closed defaults, riskClass backstop, confidence floor, JSON
// parsing/cleanup) against the real worker.js source, with routeAI/logTelemetry
// mocked so no network I/O happens here — same convention as model-routing.test.mjs,
// which leaves the actual provider calls (callGemini/callClaude) untested live.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');

function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('async function ' + name + '(');
  let i = src.indexOf(needle);
  if (i < 0 && kind === 'function') i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (kind === 'const') {
    const end = src.indexOf(';', i);
    return src.slice(i, end + 1);
  }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

const judgeSrc = grab('judge');
const floorSrc = grab('JUDGE_CONFIDENCE_FLOOR', 'const');

// Build judge() with routeAI/logTelemetry as injectable mocks (free variables
// inside judge() resolve to these Function parameters via the scope chain).
function makeJudge({ routeAI, logTelemetry }) {
  const factory = new Function('routeAI', 'logTelemetry',
    floorSrc + '\n' + judgeSrc + '\nreturn judge;');
  return factory(
    routeAI || (async () => { throw new Error('routeAI mock not provided'); }),
    logTelemetry || (async () => {}),
  );
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };
const approveAttempt = (confidence = 0.9, verdict = 'approve') => async () => ({
  result: JSON.stringify({ verdict, confidence, reason: 'looks fine' }),
  model_used: 'gemini-2.5-flash-lite', tier_used: 'CHEAP', escalated: false,
});

(async () => {
  // ── Fail-closed on missing input — no model call should even be attempted ──
  {
    let called = false;
    const judge = makeJudge({ routeAI: async () => { called = true; return {}; } });
    const r = await judge({}, { intent: 'x' }); // missing action + proposedChange
    t('missing action/proposedChange rejects', r.verdict === 'reject');
    t('missing action/proposedChange has zero confidence', r.confidence === 0);
    t('missing action/proposedChange never calls the model', called === false);
  }
  {
    const judge = makeJudge({ routeAI: async () => { throw new Error('should not be called'); } });
    const r = await judge({}, { action: 'do_thing' }); // missing proposedChange
    t('missing proposedChange alone still rejects', r.verdict === 'reject');
  }

  // ── riskClass structural backstop — GATED never reaches the model ──
  {
    let called = false;
    const judge = makeJudge({ routeAI: async () => { called = true; return {}; } });
    const r = await judge({}, { action: 'send_invoice', proposedChange: 'x', riskClass: 'GATED' });
    t('GATED riskClass rejects', r.verdict === 'reject');
    t('GATED riskClass has full confidence in the rejection', r.confidence === 1);
    t('GATED riskClass never calls the model', called === false);
    t('GATED riskClass reason names the riskClass', r.reason.includes('GATED'));
  }
  {
    // Absence of riskClass is treated as fine (caller responsibility to classify) —
    // judge() only actively blocks when riskClass is EXPLICITLY non-SAFE.
    const judge = makeJudge({ routeAI: approveAttempt(0.95) });
    const r = await judge({}, { action: 'add_endpoint', proposedChange: 'x' }); // no riskClass given
    t('no riskClass given does not itself block', r.verdict === 'approve');
  }
  {
    const judge = makeJudge({ routeAI: approveAttempt(0.95) });
    const r = await judge({}, { action: 'add_endpoint', proposedChange: 'x', riskClass: 'SAFE' });
    t('explicit SAFE riskClass proceeds to the model', r.verdict === 'approve');
  }

  // ── routeAI failure → fail closed, never a silent pass ──
  {
    const judge = makeJudge({ routeAI: async () => { throw new Error('model down'); } });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('routeAI throw rejects', r.verdict === 'reject');
    t('routeAI throw has zero confidence', r.confidence === 0);
    t('routeAI throw reason mentions the failure', r.reason.includes('model down'));
  }

  // ── Malformed / non-JSON response → fail closed ──
  {
    const judge = makeJudge({ routeAI: async () => ({ result: 'not json at all', model_used: 'x', tier_used: 'CHEAP' }) });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('non-JSON model response rejects', r.verdict === 'reject');
  }

  // ── Markdown-fenced JSON gets cleaned and parsed ──
  {
    const judge = makeJudge({ routeAI: async () => ({ result: '```json\n{"verdict":"approve","confidence":0.85,"reason":"matches criteria"}\n```', model_used: 'gemini-2.5-flash-lite', tier_used: 'CHEAP', escalated: false }) });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('code-fenced JSON approve above floor passes', r.verdict === 'approve');
    t('reason is carried through from the model response', r.reason === 'matches criteria');
  }

  // ── Confidence floor — an unsure approve is a reject ──
  {
    const judge = makeJudge({ routeAI: approveAttempt(0.5, 'approve') }); // below 0.7 floor
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('approve below confidence floor is rejected', r.verdict === 'reject');
  }
  {
    const judge = makeJudge({ routeAI: approveAttempt(0.7, 'approve') }); // exactly at floor
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('approve exactly at confidence floor passes', r.verdict === 'approve');
  }
  {
    const judge = makeJudge({ routeAI: approveAttempt(0.99, 'reject') }); // model says reject regardless of confidence
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('explicit reject verdict rejects even at high confidence', r.verdict === 'reject');
  }

  // ── Non-numeric / out-of-range confidence is treated as 0, not trusted ──
  {
    const judge = makeJudge({ routeAI: async () => ({ result: JSON.stringify({ verdict: 'approve', confidence: 'high', reason: 'x' }), model_used: 'm', tier_used: 'CHEAP' }) });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('non-numeric confidence is coerced to 0 (reject)', r.verdict === 'reject' && r.confidence === 0);
  }
  {
    const judge = makeJudge({ routeAI: async () => ({ result: JSON.stringify({ verdict: 'approve', confidence: 1.5, reason: 'x' }), model_used: 'm', tier_used: 'CHEAP' }) });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('out-of-range confidence (>1) is coerced to 0 (reject)', r.verdict === 'reject' && r.confidence === 0);
  }

  // ── Result shape passes through routeAI's model metadata ──
  {
    const judge = makeJudge({ routeAI: approveAttempt(0.9) });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('result carries model_used', r.model_used === 'gemini-2.5-flash-lite');
    t('result carries tier_used', r.tier_used === 'CHEAP');
    t('result carries escalated flag', r.escalated === false);
  }

  // ── Telemetry is best-effort — a logging failure must never flip the verdict ──
  {
    const judge = makeJudge({ routeAI: approveAttempt(0.9), logTelemetry: async () => { throw new Error('sheets down'); } });
    const r = await judge({}, { action: 'x', proposedChange: 'y' });
    t('logTelemetry throwing does not break the returned verdict', r.verdict === 'approve');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
