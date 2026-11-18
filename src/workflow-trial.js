// Queue #92, Phase 1 of 3 (Nov 18 2026): the staging-only trial of ONE non-money flow as a Cloudflare Workflow.
// The flow: the receipt scan (receiptReconScan, the same code the Hub scheduler already runs every tick) split into three
// restart-safe steps: preflight -> scan -> finish.
//
// THIS FILE HAS NO "cloudflare:workers" IMPORT ON PURPOSE. Node cannot load that module, and every test in test/ loads Hub code in node.
// The Workflow class itself lives in src/workflows-entry.js (the only file that imports "cloudflare:workers"); it calls runReceiptScanTrial()
// below. Everything that can be wrong is therefore testable here with a fake `step` and a fake Hub.
//
// How a step reaches the Hub: through the Hub's own fetch handler with the admin token, so the scan runs the existing, unchanged code
// (auth, quota guard, failure ledger and all). Nothing in worker.js is duplicated here.
//
// Rules this honours (CLAUDE.md): nothing fails silently (every step failure throws so Workflows retries it, and the final failure is
// reported to the Hub, which writes a failure-ledger row); no cron (a run starts from POST /workflow-trial/start only); never touches
// money, QuickBooks, texting or personal data (the receipt scan reads files and writes queue rows only, same as the scheduler tick does).

export const TRIAL_FLOW = 'receipt_scan';

// Per-step retry policy. A step that throws is retried (resume at THAT step, earlier steps are not re-run), then the run errors.
export function trialStepConfig() {
  return { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '2 minutes' };
}

// One call into the Hub's own handler. Returns { status, ok, json }; never throws on a non-2xx (the caller decides), throws on a network-level fault.
export function makeHubCaller(hub, env, ctx, origin) {
  return async function call(method, path, body) {
    const headers = { 'X-Auth-Token': String(env.WORKER_SECRET || ''), 'Content-Type': 'application/json' };
    const init = { method, headers };
    if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
    const res = await hub.fetch(new Request(String(origin).replace(/\/+$/, '') + path, init), env, ctx);
    let json = null, text = '';
    try { text = await res.text(); json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 300) };
  };
}

// A short, safe one-line summary of what the scan answered (counts only; never file names, never amounts).
export function summarizeScan(j) {
  if (!j || typeof j !== 'object') return 'no JSON answer';
  const keep = {};
  for (const k of ['ok', 'scanned', 'added', 'skipped', 'remaining', 'duplicates', 'new_rows', 'errors_count']) if (j[k] !== undefined && typeof j[k] !== 'object') keep[k] = j[k];
  if (Array.isArray(j.errors)) keep.errors_count = j.errors.length;
  return JSON.stringify(keep).slice(0, 200);
}

function why(r) { return `HTTP ${r.status} ${(r.json && (r.json.error || r.json.message)) || r.text || ''}`.slice(0, 240); }

// The whole flow. `step` is Cloudflare's WorkflowStep (or the fake in the tests); `call` is makeHubCaller().
export async function runReceiptScanTrial(event, step, call) {
  const p = (event && event.payload) || {};
  const runId = String((event && event.instanceId) || p.run_id || 'unknown');
  const cfg = trialStepConfig();
  const report = async (phase, extra) => {
    const r = await call('POST', '/workflow-trial/report', Object.assign({ run_id: runId, phase }, extra || {}));
    if (!r.ok || !r.json || r.json.ok !== true) throw new Error(`the Hub refused the "${phase}" report: ${why(r)}`);   // throws, so the step is retried; never swallowed
    return { recorded: true, phase };
  };
  try {
    await step.do('preflight', cfg, async () => report('preflight'));
    const scan = await step.do('scan', cfg, async (ctx) => {
      const attempt = (ctx && ctx.attempt) || 1;
      if (p.force_fail_once === true && attempt === 1) throw new Error('forced failure on attempt 1 (trial switch force_fail_once)');   // proves a failed step resumes at itself
      const t0 = Date.now();
      const r = await call('POST', '/receipt-recon/scan', { max: 5 });
      const ms = Date.now() - t0;
      if (!r.ok || (r.json && r.json.ok === false)) throw new Error(`the receipt scan failed: ${why(r)}`);
      return { ms, attempt, summary: summarizeScan(r.json) };
    });
    await step.do('finish', cfg, async () => report('finish', { scan_ms: scan.ms, scan_attempt: scan.attempt, summary: scan.summary }));
    return { ok: true, run_id: runId, scan_ms: scan.ms, summary: scan.summary };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    try { await report('failed', { error: msg }); }
    catch (e2) { console.error('workflow-trial: the failure report ALSO failed (the run itself is marked errored in Workflows):', String((e2 && e2.message) || e2), '| original:', msg); }
    throw e;   // the run ends "errored" and shows as errored in /workflow-trial/status; never swallowed
  }
}
