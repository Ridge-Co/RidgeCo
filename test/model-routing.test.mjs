// B-127 model routing layer — tests the pure/deterministic pieces (validation,
// tier resolution + customer/money-facing pinning, registry shape) against the
// real worker.js source. routeAI/callGemini/callClaude themselves do network
// I/O (fetch) so are exercised live via GET /model-registry + Ops_Telemetry
// rows once GEMINI_API_KEY/ANTHROPIC_API_KEY are set — not mocked here.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1) + (kind === 'const' ? ';' : '');
}
const { MODEL_REGISTRY, JOB_ROUTES, routeAIValid, modelRegistryInfo } = new Function(
  grab('MODEL_REGISTRY', 'const') + '\n' + grab('JOB_ROUTES', 'const') + '\n' +
  grab('routeAIValid') + '\n' + grab('modelRegistryInfo') +
  '\nreturn { MODEL_REGISTRY, JOB_ROUTES, routeAIValid, modelRegistryInfo };'
)();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// ── Registry shape (LOCKED providers v1: Gemini CHEAP, Claude REASON/HARD) ──
t('registry has exactly CHEAP/REASON/HARD tiers', Object.keys(MODEL_REGISTRY).sort().join(',') === 'CHEAP,HARD,REASON');
t('CHEAP tier is gemini', MODEL_REGISTRY.CHEAP.provider === 'gemini');
t('REASON tier is anthropic sonnet', MODEL_REGISTRY.REASON.provider === 'anthropic' && MODEL_REGISTRY.REASON.model === 'claude-sonnet-4-6');
t('HARD tier is anthropic opus', MODEL_REGISTRY.HARD.provider === 'anthropic' && MODEL_REGISTRY.HARD.model === 'claude-opus-4-8');

// ── modelRegistryInfo never leaks key env values, only tier/provider/model shape ──
const info = modelRegistryInfo();
t('modelRegistryInfo exposes all 3 tiers', Object.keys(info.tiers).length === 3);
t('modelRegistryInfo never includes a keyEnv field', JSON.stringify(info).indexOf('keyEnv') === -1);
t('modelRegistryInfo never includes cost fields', JSON.stringify(info).indexOf('costPer1k') === -1);
t('modelRegistryInfo exposes the job_routes table', info.job_routes.estimate_markup === 'REASON');

// ── JOB_ROUTES defaults from the brief ──
t('estimate_markup routes REASON (customer/money-adjacent)', JOB_ROUTES.estimate_markup === 'REASON');
t('receipt_parse routes CHEAP (bulk/structured)', JOB_ROUTES.receipt_parse === 'CHEAP');
t('tenant_message routes REASON (customer-facing)', JOB_ROUTES.tenant_message === 'REASON');

// ── routeAIValid — the escalation trigger ──
t('empty text is invalid', routeAIValid({ text: '' }, {}) === false);
t('error attempt is invalid', routeAIValid({ text: 'ok', error: 'boom' }, {}) === false);
t('non-empty text with no schema requirement is valid', routeAIValid({ text: 'ok' }, {}) === true);
t('valid JSON against a schema requirement passes', routeAIValid({ text: '{"a":1}' }, { schema: true }) === true);
t('code-fenced JSON against a schema requirement passes (matches scopeParseJSON convention)', routeAIValid({ text: '```json\n{"a":1}\n```' }, { schema: true }) === true);
t('malformed JSON against a schema requirement fails (triggers escalation)', routeAIValid({ text: 'not json' }, { schema: true }) === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
