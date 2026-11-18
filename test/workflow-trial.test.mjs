// Queue #92 Phase 1 (Nov 18 2026): the Workflows trial. Run: node test/workflow-trial.test.mjs
// Proves, with a fake Workflow runtime (cached steps, retries, ctx.attempt) and the REAL worker.js route code where it can be loaded:
//  - a forced failure in step 2 retries step 2 and does NOT re-run step 1 (resume, not restart)
//  - a re-run of a finished step never writes twice
//  - a run that fails for good reports a failure (never silent) and still ends errored
//  - the three routes answer 403 on production, work on staging, refuse a missing binding loudly
//  - src/workflow-trial.js never imports "cloudflare:workers" (node cannot load it); only the entry file does
import fs from 'node:fs';
import { runReceiptScanTrial, makeHubCaller, trialStepConfig, summarizeScan } from '../src/workflow-trial.js';
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const W = read('worker.js'), TOML = read('wrangler.toml'), FLOW = read('src/workflow-trial.js'), ENTRY = read('src/workflows-entry.js');

// ---- fake Workflows runtime: a step that finished is cached and never runs again; a step that throws is retried up to limit+1 times with ctx.attempt ----
function fakeRuntime() {
  const cache = new Map(), ran = [];
  return {
    ran, cache,
    step: {
      async do(name, cfg, cb) {
        if (typeof cfg === 'function') { cb = cfg; cfg = {}; }
        if (cache.has(name)) return cache.get(name);
        const limit = ((cfg && cfg.retries && cfg.retries.limit) || 0) + 1;
        let last;
        for (let attempt = 1; attempt <= limit; attempt++) {
          ran.push(name + '#' + attempt);
          try { const v = await cb({ attempt }); cache.set(name, v); return v; } catch (e) { last = e; }
        }
        throw last;
      },
    },
  };
}
// ---- fake Hub: records calls, answers the three routes ----
function fakeCall(opts = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/workflow-trial/report') {
      if (opts.reportRefuses && opts.reportRefuses(body)) return { status: 500, ok: false, json: { ok: false, error: 'sheet write failed' }, text: '' };
      return { status: 200, ok: true, json: { ok: true }, text: '' };
    }
    if (path === '/receipt-recon/scan') {
      const n = calls.filter(c => c.path === path).length;
      if (opts.scanFails && opts.scanFails(n)) return { status: 500, ok: false, json: { ok: false, error: 'quota busy' }, text: '' };
      return { status: 200, ok: true, json: { ok: true, scanned: 3, added: 2, errors: [] }, text: '' };
    }
    return { status: 404, ok: false, json: null, text: 'nope' };
  };
  call.calls = calls; return call;
}
const ev = (payload = {}) => ({ instanceId: 'run-1', payload: Object.assign({ origin: 'https://maintenance-hub-staging.example' }, payload) });
const phases = (call) => call.calls.filter(c => c.path === '/workflow-trial/report').map(c => c.body.phase);

// 1. happy path
{ const rt = fakeRuntime(), call = fakeCall(); const out = await runReceiptScanTrial(ev(), rt.step, call);
  t('happy path: three steps run once each', JSON.stringify(rt.ran) === JSON.stringify(['preflight#1', 'scan#1', 'finish#1']), rt.ran);
  t('happy path: reports preflight then finish, scan called with max 5', JSON.stringify(phases(call)) === '["preflight","finish"]' && call.calls.find(c => c.path === '/receipt-recon/scan').body.max === 5);
  t('happy path: finish carries the timing and a counts-only summary', (() => { const f = call.calls.find(c => c.body && c.body.phase === 'finish').body; return typeof f.scan_ms === 'number' && f.summary.includes('"scanned":3'); })());
  t('happy path: returns ok', out.ok === true && out.run_id === 'run-1'); }

// 2. forced failure in step 2 resumes at step 2, step 1 is not re-run
{ const rt = fakeRuntime(), call = fakeCall(); const out = await runReceiptScanTrial(ev({ force_fail_once: true }), rt.step, call);
  t('forced failure: step scan runs twice (attempt 1 fails, attempt 2 passes)', JSON.stringify(rt.ran) === JSON.stringify(['preflight#1', 'scan#1', 'scan#2', 'finish#1']), rt.ran);
  t('forced failure: preflight was reported exactly once (resume, not restart)', phases(call).filter(p => p === 'preflight').length === 1, phases(call));
  t('forced failure: the real scan call happened once (attempt 1 failed before calling it)', call.calls.filter(c => c.path === '/receipt-recon/scan').length === 1);
  t('forced failure: the run still finishes ok and records attempt 2', out.ok === true && call.calls.find(c => c.body && c.body.phase === 'finish').body.scan_attempt === 2); }

// 3. force_fail_once is ignored unless it is exactly true
{ const rt = fakeRuntime(), call = fakeCall(); await runReceiptScanTrial(ev({ force_fail_once: 'yes' }), rt.step, call);
  t('force_fail_once only honours boolean true', rt.ran.join() === 'preflight#1,scan#1,finish#1'); }

// 4. a finished step is never run twice (idempotent re-run: the runtime replays the whole function, cached steps return)
{ const rt = fakeRuntime(), call = fakeCall();
  await runReceiptScanTrial(ev(), rt.step, call); await runReceiptScanTrial(ev(), rt.step, call);
  t('replaying a finished run writes nothing new (reports stay 2, scan stays 1)', phases(call).length === 2 && call.calls.filter(c => c.path === '/receipt-recon/scan').length === 1, { phases: phases(call) }); }

// 5. permanent scan failure: errors out, reports "failed" once, never silent
{ const rt = fakeRuntime(), call = fakeCall({ scanFails: () => true }); let err = null;
  try { await runReceiptScanTrial(ev(), rt.step, call); } catch (e) { err = e; }
  t('permanent failure: the run throws (ends errored)', err && /receipt scan failed.*quota busy/.test(err.message), err && err.message);
  t('permanent failure: scan tried 3 times (limit 2 retries)', rt.ran.filter(x => x.startsWith('scan#')).length === 3, rt.ran);
  t('permanent failure: a "failed" report with the reason was sent', call.calls.some(c => c.body && c.body.phase === 'failed' && /quota busy/.test(c.body.error)));
  t('permanent failure: finish was never reported', !phases(call).includes('finish')); }

// 6. the report itself failing is retried, then surfaced (not dropped)
{ const rt = fakeRuntime(); let n = 0, err = null; const call = fakeCall({ reportRefuses: (b) => b.phase === 'preflight' && ++n <= 1 });
  await runReceiptScanTrial(ev(), rt.step, call);
  t('a refused preflight report is retried and then succeeds', rt.ran.filter(x => x.startsWith('preflight#')).length === 2);
  const call2 = fakeCall({ reportRefuses: () => true }); const rt2 = fakeRuntime();
  const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  try { await runReceiptScanTrial(ev(), rt2.step, call2); } catch (e) { err = e; } finally { console.error = orig; }
  t('every report refused: the run throws and the double failure is logged loudly', err && /refused the "preflight" report/.test(err.message) && logged.some(l => /report ALSO failed/.test(l)), { err: err && err.message, logged }); }

// 7. step policy + summary are safe
t('retry policy: 2 retries, exponential, bounded timeout', trialStepConfig().retries.limit === 2 && trialStepConfig().retries.backoff === 'exponential' && !!trialStepConfig().timeout);
t('summary keeps counts only (no file names, no amounts)', summarizeScan({ ok: true, scanned: 4, files: ['Invoice 123.pdf'], total: { a: 1 }, errors: ['x'] }) === '{"ok":true,"scanned":4,"errors_count":1}', summarizeScan({ ok: true, scanned: 4, files: ['Invoice 123.pdf'], errors: ['x'] }));

// 8. makeHubCaller: sends the admin token, talks to the Hub's own fetch, reads JSON, tolerates a non-JSON body
{ let seen; const hub = { async fetch(req, env, ctx) { seen = { url: req.url, method: req.method, tok: req.headers.get('X-Auth-Token'), body: req.method === 'POST' ? await req.text() : '' , ctx }; return new Response('not json', { status: 502 }); } };
  const r = await makeHubCaller(hub, { WORKER_SECRET: 's3cret' }, { id: 'c' }, 'https://maintenance-hub-staging.example/')('POST', '/x', { a: 1 });
  t('caller: admin token + origin joined without a double slash', seen.url === 'https://maintenance-hub-staging.example/x' && seen.tok === 's3cret' && seen.body === '{"a":1}');
  t('caller: a non-JSON answer is reported as not ok, not thrown', r.ok === false && r.status === 502 && r.json === null); }

// 9. wiring (static)
t('flow module never imports cloudflare:workers', !/from\s+['"]cloudflare:workers['"]/.test(FLOW));
t('entry file is the only one that imports cloudflare:workers and extends WorkflowEntrypoint', /from 'cloudflare:workers'/.test(ENTRY) && /class ReceiptScanTrialWorkflow extends WorkflowEntrypoint/.test(ENTRY));
t('entry re-exports the Hub handler and the Durable Object class unchanged', /export \{ ReadMeterStore \}/.test(ENTRY) && /export default hub/.test(ENTRY) && /import hub, \{ ReadMeterStore \} from '\.\.\/worker\.js'/.test(ENTRY));
t('worker.js still exports ReadMeterStore and its default handler', /^export class ReadMeterStore \{/m.test(W) && /^export default \{/m.test(W));
t('wrangler main points at the entry file', /^main = "src\/workflows-entry\.js"/m.test(TOML));
t('wrangler binds RECEIPT_SCAN_TRIAL to the class', /\[\[workflows\]\]\s*\nname = "receipt-scan-trial"\s*\nbinding = "RECEIPT_SCAN_TRIAL"\s*\nclass_name = "ReceiptScanTrialWorkflow"/.test(TOML));
t('NO CRON: crons stays empty and no schedule was added', /crons\s*=\s*\[\s*\]/.test(TOML) && !/schedule\s*:/.test(FLOW + ENTRY));
t('ReadMeterStore binding and migration untouched', /new_sqlite_classes = \["ReadMeterStore"\]/.test(TOML) && /name = "READ_METER_STORE"/.test(TOML));
t('the class name in the entry matches the toml', ENTRY.includes('ReceiptScanTrialWorkflow') && TOML.includes('class_name = "ReceiptScanTrialWorkflow"'));
t('no swallowing catch in the new source files', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(FLOW + ENTRY));
t('the three routes are wired once each, and appear in no ROLE_SCOPES list (admin only)', ['status', 'start', 'report'].every(p => (W.match(new RegExp("path === '/workflow-trial/" + p + "'\\)\\s+return await", 'g')) || []).length === 1) && (W.match(/ROLE_SCOPES\s*=\s*\{[\s\S]*?\n\};?/) || [''])[0].indexOf('workflow-trial') < 0);
t('the staging test token may start a run (hubTestWriteAllowed) and nothing else new', /path === '\/workflow-trial\/start'\) return true/.test(W) && !/hubTestWriteAllowed[\s\S]{0,600}workflow-trial\/report/.test(W.slice(W.indexOf('async function hubTestWriteAllowed'), W.indexOf('async function hubTestWriteAllowed') + 600)));

// ---- the real handlers, cut out of worker.js and run with fakes ----
const a = W.indexOf('function workflowTrialStagingOnly'), b = W.indexOf('// Thin wrapper (Sep 29 2026)');
const logged = [];
const mk = new Function('json', 'logTelemetry', 'schedErrText', 'console', W.slice(a, b) + '\nreturn { workflowTrialStart, workflowTrialStatus, workflowTrialReport };');
const jsonFn = (d, s = 200) => ({ status: s, body: d });
let telemetryFail = false;
const api = mk(jsonFn, async (env, rec) => { if (telemetryFail) throw new Error('sheet down'); logged.push(rec); }, (e) => String((e && e.message) || e), { error() {}, log() {} });
const u = (q = '') => new URL('https://maintenance-hub-staging.example/workflow-trial/status' + q);

{ const prod = { __STAGING__: false, RECEIPT_SCAN_TRIAL: { create: async () => { throw new Error('must not be called'); } } };
  const r1 = await api.workflowTrialStart(prod, {}, u()), r2 = await api.workflowTrialStatus(prod, u('?id=x')), r3 = await api.workflowTrialReport(prod, { phase: 'finish', run_id: 'x' });
  t('production: start, status and report all answer 403', [r1, r2, r3].every(r => r.status === 403 && r.body.ok === false), [r1.status, r2.status, r3.status]);
  t('production: nothing was written', logged.length === 0); }
{ const noBind = await api.workflowTrialStart({ __STAGING__: true }, {}, u());
  t('missing binding: 503, says why, and files a failure row', noBind.status === 503 && /not on this Worker/.test(noBind.body.error) && logged.at(-1).Success === 'FALSE' && /binding is missing/.test(logged.at(-1).Notes)); }
{ let params; const env = { __STAGING__: true, RECEIPT_SCAN_TRIAL: { create: async (o) => { params = o.params; return { id: 'abc-123' }; }, get: async (id) => ({ status: async () => ({ status: 'running', id }) }) } };
  const s = await api.workflowTrialStart(env, { force_fail_once: true }, u());
  t('staging start: passes origin and the force switch, returns the id', s.status === 200 && s.body.id === 'abc-123' && params.origin === 'https://maintenance-hub-staging.example' && params.force_fail_once === true);
  const s2 = await api.workflowTrialStart(env, { force_fail_once: 'true' }, u()); t('start: a non-boolean force switch is false', params.force_fail_once === false && s2.body.force_fail_once === false);
  const st = await api.workflowTrialStatus(env, u('?id=abc-123')); t('status: returns the run status', st.status === 200 && st.body.status.status === 'running');
  t('status: id required', (await api.workflowTrialStatus(env, u())).status === 400);
  const bad = await api.workflowTrialStatus({ __STAGING__: true, RECEIPT_SCAN_TRIAL: { get: async () => { throw new Error('instance.not_found'); } } }, u('?id=zzz'));
  t('status: a lookup error is shown, not hidden', bad.status === 500 && /instance\.not_found/.test(bad.body.error));
  const boom = await api.workflowTrialStart({ __STAGING__: true, RECEIPT_SCAN_TRIAL: { create: async () => { throw new Error('limit reached'); } } }, {}, u());
  t('start: a create error is shown and filed as a failure', boom.status === 500 && /limit reached/.test(boom.body.error) && logged.at(-1).Success === 'FALSE'); }
{ const env = { __STAGING__: true };
  const ok = await api.workflowTrialReport(env, { phase: 'finish', run_id: 'r9', scan_ms: 412, scan_attempt: 2, summary: '{"ok":true}' });
  const row = logged.at(-1);
  t('report finish: Ops_Telemetry row with the timing, Success TRUE', ok.status === 200 && row.Job_Type === 'workflow_trial_finish' && row.Success === 'TRUE' && row.Latency_ms === 412 && row.Skill_Or_Endpoint === 'ReceiptScanTrialWorkflow:r9');
  await api.workflowTrialReport(env, { phase: 'failed', run_id: 'r9', error: 'boom' });
  t('report failed: Success FALSE (which also reaches the failure ledger through logTelemetry)', logged.at(-1).Success === 'FALSE' && logged.at(-1).Job_Type === 'workflow_trial_failed');
  t('report: bad phase / missing run_id are 400', (await api.workflowTrialReport(env, { phase: 'x', run_id: 'r' })).status === 400 && (await api.workflowTrialReport(env, { phase: 'finish' })).status === 400);
  telemetryFail = true; const lost = await api.workflowTrialReport(env, { phase: 'finish', run_id: 'r9' }); telemetryFail = false;
  t('report: a failed write answers 500 (so the step retries), never ok', lost.status === 500 && lost.body.ok === false && /sheet down/.test(lost.body.error));
  const long = await api.workflowTrialReport(env, { phase: 'finish', run_id: 'r9', summary: 'x'.repeat(2000) }); t('report: notes are capped', logged.at(-1).Notes.length <= 480 && long.status === 200); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
