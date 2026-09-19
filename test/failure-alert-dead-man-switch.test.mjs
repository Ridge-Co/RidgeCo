// Ops_Build_Queue #14 (failure runbook for wo_create/wo_status) + #10 (zero-activity
// dead-man's-switch) — Sep 19 2026. Both are dormant-by-default admin alerts reusing the
// existing config.admin_phone + sendSMS delivery shape already used everywhere else in this
// file, gated behind their own Config flags (failure_alert_enabled / dead_man_switch_enabled)
// so nothing pages Brett until he opts in. This file covers the pure decision logic
// (alertDebounceOk, isDeadManSwitchTripped) directly, plus structural checks that the router
// dispatch for /workorder and /status now route through callWithFailureAlert, and that
// cronSweep calls checkDeadManSwitch on its existing ~15-min cadence (no new cron slot).
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
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- pure decision logic, extracted and exercised directly ----
const { alertDebounceOk, isDeadManSwitchTripped } = new Function(
  grab('alertDebounceOk') + '\n' + grab('isDeadManSwitchTripped') +
  '\nreturn { alertDebounceOk, isDeadManSwitchTripped };'
)();

{
  const now = Date.parse('2026-09-19T12:00:00Z');
  ok(alertDebounceOk({}, 'k', now, 3600000) === true, 'no prior alert recorded -> ok to send');
  const cfgRecent = { k: new Date(now - 10 * 60000).toISOString() }; // 10 min ago
  ok(alertDebounceOk(cfgRecent, 'k', now, 3600000) === false, 'alerted 10 min ago, 1h window -> still debounced');
  const cfgOld = { k: new Date(now - 2 * 3600000).toISOString() }; // 2h ago
  ok(alertDebounceOk(cfgOld, 'k', now, 3600000) === true, 'alerted 2h ago, 1h window -> debounce has expired, ok to send again');
  ok(alertDebounceOk({ k: 'not-a-date' }, 'k', now, 3600000) === true, 'unparseable prior timestamp treated as no prior alert, not a crash');
}

{
  const now = Date.parse('2026-09-19T12:00:00Z');
  ok(isDeadManSwitchTripped(null, now) === true, 'no activity at all in the lookback window -> tripped');
  ok(isDeadManSwitchTripped(NaN, now) === true, 'unparseable last-activity value -> tripped, not a crash');
  ok(isDeadManSwitchTripped(now - 25 * 3600000, now) === true, '25h since last activity -> tripped (past the 24h line)');
  ok(isDeadManSwitchTripped(now - 23 * 3600000, now) === false, '23h since last activity -> not yet tripped');
  ok(isDeadManSwitchTripped(now - 24 * 3600000, now) === false, 'exactly 24h -> boundary is exclusive (strictly greater-than), not tripped yet');
  ok(isDeadManSwitchTripped(now - 24 * 3600000 - 1, now) === true, '24h + 1ms -> tripped');
}

// ---- structural: both features start dormant (Config-flag gated), matching the
// weekly_review_enabled/selftest_digest_enabled convention, not shipped defaulted-on ----
const alertBody = grabAsync('alertAdminOnFailure');
{
  ok(/failure_alert_enabled/.test(alertBody), 'alertAdminOnFailure is gated behind its own failure_alert_enabled Config flag');
  ok(/!==\s*'TRUE'/.test(alertBody), 'the gate requires an exact TRUE value, not just truthy — matches the established dormant-by-default pattern');
  ok(/admin_phone/.test(alertBody), 'reuses the existing admin_phone Config key rather than inventing a new delivery target');
  ok(/sendSMS\(/.test(alertBody), 'delivers via the existing sendSMS helper — same admin-alert shape as every other admin notification in this file');
}

const deadManBody = grabAsync('checkDeadManSwitch');
{
  ok(/dead_man_switch_enabled/.test(deadManBody), 'checkDeadManSwitch is gated behind its own dead_man_switch_enabled Config flag');
  ok(/readTelemetryRows\(env,\s*2\)/.test(deadManBody), 'reads a bounded 2-day telemetry window, not the entire history table, to find the last activity timestamp');
  ok(/sendSMS\(/.test(deadManBody), 'alerts via the existing sendSMS admin-phone pattern');
  ok(/alertDebounceOk\(/.test(deadManBody), 'reuses the shared debounce helper so an ongoing outage does not re-page Brett every ~15 min sweep');
}

// ---- structural: the failure runbook wraps BOTH critical entry points, and re-throws so
// the outer handler's existing error response to the caller is unchanged ----
const wrapBody = grabAsync('callWithFailureAlert');
{
  ok(/throw e/.test(wrapBody), 'callWithFailureAlert re-throws on failure — this only adds observability, it never changes what a failing request returns to the caller');
  ok(/logTelemetry\(/.test(wrapBody), 'logs a structured Success:\'FALSE\' telemetry row on failure — previously these exceptions never reached logTelemetry at all');
  ok(/alertAdminOnFailure\(/.test(wrapBody), 'calls the admin-alert helper on failure');
}

{
  ok(src.includes("callWithFailureAlert(env, 'wo_create', '/workorder', () => createWorkOrder(env, body))"), 'the /workorder router dispatch now routes through callWithFailureAlert for wo_create');
  ok(src.includes("callWithFailureAlert(env, 'wo_status', '/status', () => updateStatus(env, body))"), "the /status router dispatch now routes through callWithFailureAlert for wo_status");
}

// ---- structural: cronSweep calls the dead-man's-switch on its existing cadence, no new
// Cloudflare Cron Trigger slot (all 5 are already spoken for per rule 166/rule "maybeRunDailySelftest") ----
const sweepBody = grabAsync('cronSweep');
{
  ok(sweepBody.includes('checkDeadManSwitch(env)'), 'cronSweep calls checkDeadManSwitch every pass, riding the existing ~15-min sweep cadence');
  ok(/try\s*\{\s*out\.dead_man_switch/.test(sweepBody), 'the call is wrapped in its own try/catch, matching every other cronSweep sub-task, so one failing check can never take down the rest of the sweep');
}

console.log(`failure-alert-dead-man-switch: ${n}/${n} passing`);
