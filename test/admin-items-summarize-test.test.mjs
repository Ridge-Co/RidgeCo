// Ops_Build_Queue #24 (audit items_summarize 100% escalation rate) — Sep 19 2026. Static
// review of routeAI/callGemini/MODEL_REGISTRY didn't turn up a confident deterministic bug
// (JSON response mode already on, model id current), and this build sandbox has no live
// Ops_Telemetry access to read back the escalated_from_cheap reason strings that routeAI
// already captures (Ops_Build_Queue #18, done in an earlier session). So rather than guess a
// fix blind, this ships a read-only diagnostic endpoint that calls the CHEAP tier directly —
// bypassing routeAI's escalation — so a live call surfaces the real raw Gemini response, the
// actual JSON-parse outcome, and any API error in one shot. Same admin-gated, no-PUBLIC_PATHS
// shape as /admin/drive-file-check and /twilio/account-status. This file covers the function
// structurally (gating, direct CHEAP-tier call, fallback sample items, response shape) since
// exercising it for real would burn a live Gemini call.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- gating: not in PUBLIC_PATHS, so it's covered by the top-of-router admin-secret check ----
{
  const publicPathsBlock = src.slice(src.indexOf("const PUBLIC_PATHS = ["), src.indexOf("const PUBLIC_PATHS = [") + 3000);
  ok(!publicPathsBlock.includes("'/admin/items-summarize-test'"), 'the new endpoint is NOT in PUBLIC_PATHS — same admin-secret gate as /admin/drive-file-check');
  ok(src.includes("if (path === '/admin/items-summarize-test') return await adminItemsSummarizeTest(env, body);"), 'router dispatches the new admin path to adminItemsSummarizeTest');
}

const fnBody = grabAsync('adminItemsSummarizeTest');

// ---- structural: calls the CHEAP tier directly via routeAICall, bypassing routeAI's own
// escalation logic, so the diagnostic sees the RAW cheap-tier attempt, not an already-escalated
// REASON-tier result ----
{
  ok(/routeAICall\(env,\s*'CHEAP',\s*job\)/.test(fnBody), 'calls routeAICall directly at CHEAP tier — bypasses routeAI escalation entirely so the raw Gemini attempt is what gets reported');
  ok(!/routeAI\(env/.test(fnBody), 'does not call the full routeAI() wrapper, which would auto-escalate on failure and hide the cheap-tier response being diagnosed');
  ok(/routeAIValid\(attempt,\s*job\)/.test(fnBody), 'reuses the real routeAIValid() so "would this have passed?" reflects the actual production validation logic, not a re-implementation that could drift');
}

// ---- structural: falls back to a sensible built-in sample item list when no body.items given,
// so the endpoint is usable with a bare admin-secret POST and no payload ----
{
  ok(/Array\.isArray\(body\.items\)\s*&&\s*body\.items\.length/.test(fnBody), 'prefers caller-supplied body.items when present');
  ok(/:\s*\[/.test(fnBody) && /wood screws|batteries|paint/i.test(fnBody), 'falls back to a built-in realistic sample item list when body.items is absent, so the endpoint works with no payload');
}

// ---- structural: response reports the raw text, any API error, the parse outcome, and the
// validation verdict — everything needed to diagnose without guessing ----
{
  ok(/cheap_raw_text/.test(fnBody), 'reports the raw Gemini text so a human can see exactly what came back');
  ok(/cheap_api_error/.test(fnBody), 'surfaces a hard API error (e.g. missing key, non-2xx) distinctly from a parse failure');
  ok(/would_pass_routeai_validation/.test(fnBody), 'reports whether the real routeAIValid() would accept this response');
  ok(/json_parse_ok/.test(fnBody) && /json_parse_error/.test(fnBody), 'reports the JSON.parse outcome and, on failure, the actual parse error text');
  ok(/try\s*\{\s*attempt\s*=\s*await\s*routeAICall/.test(fnBody), 'the CHEAP-tier call itself is wrapped in try/catch, so a thrown error becomes a reported field rather than a 500 that hides the diagnosis');
}

// ---- structural: this is genuinely read-only — never calls updateRow/addRow/setConfigKey, so
// calling it repeatedly to diagnose can't corrupt any sheet data ----
{
  ok(!/updateRow\(|addRow\(|setConfigKey\(/.test(fnBody), 'adminItemsSummarizeTest never writes to a sheet — safe to call repeatedly while diagnosing');
}

console.log(`admin-items-summarize-test: ${n}/${n} passing`);
