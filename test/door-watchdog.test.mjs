// Door-code system watchdog (Oct 12 2026): independent check of the str-automation Worker's public
// /health, run from the Hub's existing */15 cron. Brett's standing rule: NOTHING FAILS SILENTLY, so this
// file has a test for every failure path (health fetch, Config/state read, corrupt state, state write,
// SMS, email fallback, telemetry write, unexpected throw) plus the pure evaluation / dedupe / recovery logic.
// Run: node test/door-watchdog.test.mjs   (SRC=path/to/worker.js to test another copy)
import fs from 'fs';
const src = fs.readFileSync(process.env.SRC || new URL('../worker.js', import.meta.url), 'utf8');
const START = src.indexOf('// ── Door-code system watchdog (Oct 12 2026)');
const END = src.indexOf('// ── Gated tenant/vendor messaging (TWILIO_SMS_BUILD_BRIEF_v1.0)');
if (START < 0 || END < START) throw new Error('watchdog block not found in worker.js');
const block = src.slice(START, END);
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const W = new Function(
  grab('scrubPhones') + '\n' + block +
  '\nreturn { evaluateDoorHealth, doorWdComposeAlert, doorWdComposeRecovered, doorWdParseState, doorWdPrune, doorWdDecide, doorWdNextState, fetchDoorHealth, runDoorWatchdogPass, DOOR_WD_URL, DOOR_WD_STATE_KEY, setMem: (v) => { __doorWdMem = v; }, getMem: () => __doorWdMem };'
)();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };

const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const MIN = 60000, HR = 3600000;
const secrets = { ADMIN_TOKEN: true, SEAM_API_KEY: true, UPLISTING_API_KEY: true, UPLISTING_WEBHOOK_SECRET: true, TRUVI_INGEST_TOKEN: true, HUB_NOTIFY_TOKEN: true };
const good = (over) => Object.assign({ ok: true, service: 'str-automation', secrets_set: Object.assign({}, secrets), last_tick: new Date(NOW - 20 * MIN).toISOString(), problems: [] }, over || {});
const okFr = (json, status) => ({ status: status || 200, json });
const codes = (ev) => ev.reasons.map(r => r.code);

// ───────────────────────── pure evaluation ─────────────────────────
{
  const ev = W.evaluateDoorHealth(okFr(good()), NOW);
  t('healthy payload -> healthy', ev.healthy === true && ev.reasons.length === 0 && ev.key === '');
  t('missing problems == []', W.evaluateDoorHealth(okFr((() => { const g = good(); delete g.problems; return g; })()), NOW).healthy === true);
  t('null problems treated as []', W.evaluateDoorHealth(okFr(good({ problems: null })), NOW).healthy === true);
}
{
  eq('fetch throws -> unreachable', codes(W.evaluateDoorHealth({ error: 'boom' }, NOW)), ['unreachable']);
  const to = W.evaluateDoorHealth({ error: 'timeout', timeout: true }, NOW);
  t('timeout -> unreachable with timed-out text', codes(to)[0] === 'unreachable' && /timed out/.test(to.reasons[0].text));
  eq('undefined fetch result -> unreachable', codes(W.evaluateDoorHealth(undefined, NOW)), ['unreachable']);
  eq('HTTP 503 -> http_503', codes(W.evaluateDoorHealth({ status: 503, json: good() }, NOW)), ['http_503']);
  eq('HTTP 404 -> http_404', codes(W.evaluateDoorHealth({ status: 404 }, NOW)), ['http_404']);
  eq('non-JSON body -> bad_json', codes(W.evaluateDoorHealth({ status: 200, bad_json: true }, NOW)), ['bad_json']);
  eq('JSON array -> bad_json', codes(W.evaluateDoorHealth({ status: 200, json: [] }, NOW)), ['bad_json']);
  eq('JSON null -> bad_json', codes(W.evaluateDoorHealth({ status: 200, json: null }, NOW)), ['bad_json']);
  eq('ok:false -> not_ok', codes(W.evaluateDoorHealth(okFr(good({ ok: false })), NOW)), ['not_ok']);
  eq('ok missing -> not_ok', codes(W.evaluateDoorHealth(okFr((() => { const g = good(); delete g.ok; return g; })()), NOW)), ['not_ok']);
  eq('ok:"true" (string) -> not_ok', codes(W.evaluateDoorHealth(okFr(good({ ok: 'true' })), NOW)), ['not_ok']);
}
{
  const ev = W.evaluateDoorHealth(okFr(good({ secrets_set: Object.assign({}, secrets, { SEAM_API_KEY: false, ADMIN_TOKEN: false }) })), NOW);
  eq('two false secrets named, sorted', codes(ev), ['secret:ADMIN_TOKEN', 'secret:SEAM_API_KEY']);
  eq('secret not exactly true (null) is a problem', codes(W.evaluateDoorHealth(okFr(good({ secrets_set: Object.assign({}, secrets, { HUB_NOTIFY_TOKEN: null }) })), NOW)), ['secret:HUB_NOTIFY_TOKEN']);
  eq('secrets_set missing -> secrets_field', codes(W.evaluateDoorHealth(okFr((() => { const g = good(); delete g.secrets_set; return g; })()), NOW)), ['secrets_field']);
  eq('secrets_set array -> secrets_field', codes(W.evaluateDoorHealth(okFr(good({ secrets_set: [] })), NOW)), ['secrets_field']);
}
{
  eq('last_tick null -> tick_null (a PROBLEM)', codes(W.evaluateDoorHealth(okFr(good({ last_tick: null })), NOW)), ['tick_null']);
  eq('76m old -> tick_stale', codes(W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 76 * MIN).toISOString() })), NOW)), ['tick_stale']);
  eq('exactly 75m -> not stale (older than 75 only)', codes(W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 75 * MIN).toISOString() })), NOW)), []);
  eq('74m -> fine', codes(W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 74 * MIN).toISOString() })), NOW)), []);
  eq('very old timestamp -> tick_stale', codes(W.evaluateDoorHealth(okFr(good({ last_tick: '2026-01-01T00:00:00.000Z' })), NOW)), ['tick_stale']);
  eq('garbage timestamp -> tick_invalid', codes(W.evaluateDoorHealth(okFr(good({ last_tick: 'yesterday-ish' })), NOW)), ['tick_invalid']);
  eq('numeric last_tick -> tick_invalid', codes(W.evaluateDoorHealth(okFr(good({ last_tick: 12345 })), NOW)), ['tick_invalid']);
  const stale = W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 130 * MIN).toISOString() })), NOW);
  t('stale text shows hours past 2h', /last tick 2h ago/.test(stale.reasons[0].text));
  // key absent = "not deployed yet": tolerated, but only for 24h
  const noTick = good(); delete noTick.last_tick;
  const a0 = W.evaluateDoorHealth(okFr(noTick), NOW, {});
  t('last_tick key ABSENT -> healthy + lastTickAbsent flag', a0.healthy === true && a0.lastTickAbsent === true);
  t('absent for 23h -> still tolerated', W.evaluateDoorHealth(okFr(noTick), NOW, { absentSinceMs: NOW - 23 * HR }).healthy === true);
  eq('absent for 25h -> tick_field_missing (cannot stay silently off)', codes(W.evaluateDoorHealth(okFr(noTick), NOW, { absentSinceMs: NOW - 25 * HR })), ['tick_field_missing']);
  t('present last_tick clears the absent flag', W.evaluateDoorHealth(okFr(good()), NOW).lastTickAbsent === false);
}
{
  const ev = W.evaluateDoorHealth(okFr(good({ problems: [{ key: 'seam_auth_failed', at: 'x' }, { key: 'uplisting_webhook_bad_sig', at: 'y' }] })), NOW);
  eq('problems listed by key, sorted', codes(ev), ['problem:seam_auth_failed', 'problem:uplisting_webhook_bad_sig']);
  eq('duplicate problem keys collapse', codes(W.evaluateDoorHealth(okFr(good({ problems: [{ key: 'a' }, { key: 'a' }] })), NOW)), ['problem:a']);
  eq('problems not an array -> problems_field', codes(W.evaluateDoorHealth(okFr(good({ problems: 'oops' })), NOW)), ['problems_field']);
  eq('problem without key -> (invalid), not a crash', codes(W.evaluateDoorHealth(okFr(good({ problems: [{}] })), NOW)), ['problem:(invalid)']);
  const evil = W.evaluateDoorHealth(okFr(good({ problems: [{ key: 'x'.repeat(200) }, { key: 'call 410-555-0100 now' }] })), NOW);
  t('hostile / overlong problem keys are neutralised (no free text in the SMS)', codes(evil).every(c => c === 'problem:(invalid)'));
  const many = W.evaluateDoorHealth(okFr(good({ problems: Array.from({ length: 9 }, (_, i) => ({ key: 'p' + i })) })), NOW);
  t('long problem list truncated in the SMS', /\+3 more/.test(W.doorWdComposeAlert(many.reasons)));
}
{
  // reason-set identity: stable across volatile bits, different across different sets
  const k1 = W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 90 * MIN).toISOString() })), NOW).key;
  const k2 = W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 500 * MIN).toISOString() })), NOW + 7 * MIN).key;
  t('same reason-set has the same key regardless of age', k1 === k2 && k1 === 'tick_stale');
  const k3 = W.evaluateDoorHealth(okFr(good({ last_tick: new Date(NOW - 90 * MIN).toISOString(), ok: false })), NOW).key;
  t('different reason-set -> different key', k3 !== k1 && k3 === 'not_ok|tick_stale');
  const multi = W.evaluateDoorHealth(okFr(good({ ok: false, last_tick: null, problems: [{ key: 'z' }], secrets_set: Object.assign({}, secrets, { ADMIN_TOKEN: false }) })), NOW);
  eq('multiple reasons all reported', codes(multi).sort(), ['not_ok', 'problem:z', 'secret:ADMIN_TOKEN', 'tick_null']);
}
{
  const ev = W.evaluateDoorHealth(okFr(good({ ok: false, problems: [{ key: 'seam_auth_failed' }], secrets_set: Object.assign({}, secrets, { SEAM_API_KEY: false }) })), NOW);
  const txt = W.doorWdComposeAlert(ev.reasons);
  t('alert text starts with the required prefix', txt.startsWith('ALERT: door-code system (str-automation): '));
  t('alert text ends with the required suffix + health link', txt.endsWith('. Guests may not get codes or alerts. Health: https://str-automation.brett-2f8.workers.dev/health'));
  t('alert text names the reasons', /secrets not set: SEAM_API_KEY/.test(txt) && /problems: seam_auth_failed/.test(txt));
  t('alert text carries no phone number / PII', !/\d{3}[-. )]*\d{3}[-. ]*\d{4}/.test(txt));
  t('recovered text', W.doorWdComposeRecovered().startsWith('RECOVERED: door-code system (str-automation) is healthy again.'));
  t('alert length is SMS-sane', txt.length < 480);
  t('health URL constant matches spec', W.DOOR_WD_URL === 'https://str-automation.brett-2f8.workers.dev/health');
}

// ───────────────────────── state / dedupe / recovery (pure) ─────────────────────────
{
  eq('empty cell -> clean state, not corrupt', W.doorWdParseState(''), { state: { active: false, sent: {}, absent_since: null }, corrupt: false });
  t('garbage cell -> corrupt flagged, clean state', W.doorWdParseState('{nope').corrupt === true && W.doorWdParseState('{nope').state.active === false);
  t('JSON array cell -> corrupt', W.doorWdParseState('[1]').corrupt === true);
  const p = W.doorWdParseState(JSON.stringify({ active: true, sent: { tick_stale: '2026-10-12T17:00:00.000Z', bad: 'nope' }, absent_since: 'zzz' }));
  t('valid state parsed, junk entries dropped', p.state.active === true && Object.keys(p.state.sent).join() === 'tick_stale' && p.state.absent_since === null && !p.corrupt);

  const bad = W.evaluateDoorHealth(okFr(good({ ok: false })), NOW);
  const clean = { active: false, sent: {}, absent_since: null };
  t('problem + no prior alert -> alert', W.doorWdDecide(bad, clean, NOW) === 'alert');
  const afterAlert = W.doorWdNextState(clean, bad, 'alert', true, NOW);
  t('delivered alert recorded + active', afterAlert.active === true && afterAlert.sent.not_ok === new Date(NOW).toISOString());
  t('same set 15 min later -> suppressed', W.doorWdDecide(bad, afterAlert, NOW + 15 * MIN) === 'suppressed');
  t('same set 5h59m later -> suppressed', W.doorWdDecide(bad, afterAlert, NOW + 6 * HR - MIN) === 'suppressed');
  t('same set 6h later -> alert again (reminder)', W.doorWdDecide(bad, afterAlert, NOW + 6 * HR) === 'alert');
  const other = W.evaluateDoorHealth(okFr(good({ last_tick: null })), NOW);
  t('DIFFERENT reason-set within 6h -> alert immediately', W.doorWdDecide(other, afterAlert, NOW + 15 * MIN) === 'alert');
  const both = W.doorWdNextState(afterAlert, other, 'alert', true, NOW + 15 * MIN);
  t('both sets tracked independently (A,B,A flapping does not re-text A)', W.doorWdDecide(bad, both, NOW + 30 * MIN) === 'suppressed' && W.doorWdDecide(other, both, NOW + 30 * MIN) === 'suppressed');
  const healthy = W.evaluateDoorHealth(okFr(good()), NOW);
  t('healthy + earlier delivered alert -> recovered', W.doorWdDecide(healthy, afterAlert, NOW + 30 * MIN) === 'recovered');
  t('healthy + nothing alerted -> none', W.doorWdDecide(healthy, clean, NOW) === 'none');
  const afterRec = W.doorWdNextState(afterAlert, healthy, 'recovered', true, NOW + 30 * MIN);
  t('delivered recovery clears active + sent', afterRec.active === false && Object.keys(afterRec.sent).length === 0);
  t('problem again after RECOVERED -> alerts again (new episode)', W.doorWdDecide(bad, afterRec, NOW + 45 * MIN) === 'alert');
  // undelivered => nothing recorded => retried next pass
  const undeliveredAlert = W.doorWdNextState(clean, bad, 'alert', false, NOW);
  t('UNDELIVERED alert is not marked sent (retry next pass)', undeliveredAlert.active === false && Object.keys(undeliveredAlert.sent).length === 0 && W.doorWdDecide(bad, undeliveredAlert, NOW + 15 * MIN) === 'alert');
  const undeliveredRec = W.doorWdNextState(afterAlert, healthy, 'recovered', false, NOW + 30 * MIN);
  t('UNDELIVERED recovery keeps active (retry next pass)', undeliveredRec.active === true && W.doorWdDecide(healthy, undeliveredRec, NOW + 45 * MIN) === 'recovered');
  // absent_since bookkeeping
  const noTick = good(); delete noTick.last_tick;
  const evAbs = W.evaluateDoorHealth(okFr(noTick), NOW, {});
  const s1 = W.doorWdNextState(clean, evAbs, 'none', false, NOW);
  t('first absent pass stamps absent_since', s1.absent_since === new Date(NOW).toISOString());
  const s2 = W.doorWdNextState(s1, evAbs, 'none', false, NOW + HR);
  t('absent_since is kept, not re-stamped', s2.absent_since === s1.absent_since);
  const s3 = W.doorWdNextState(s2, healthy, 'none', false, NOW + 2 * HR);
  t('absent_since cleared once last_tick appears', s3.absent_since === null);
  t('old sent entries pruned', Object.keys(W.doorWdPrune({ active: true, sent: { a: new Date(NOW - 7 * HR).toISOString(), b: new Date(NOW - HR).toISOString() }, absent_since: null }, NOW).sent).join() === 'b');
}

// ───────────────────────── fetch wrapper ─────────────────────────
const jres = (obj, status) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status: status || 200 });
{
  const r1 = await W.fetchDoorHealth(async () => jres(good()), { timeoutMs: 200 });
  t('200 JSON -> parsed, one attempt', r1.status === 200 && r1.json.ok === true && r1.attempts === 1);
  const r2 = await W.fetchDoorHealth(async () => jres('<html>nope</html>'), { timeoutMs: 200 });
  t('200 non-JSON -> bad_json', r2.status === 200 && r2.bad_json === true);
  let n = 0;
  const r3 = await W.fetchDoorHealth(async () => { n++; if (n === 1) throw new Error('blip'); return jres(good()); }, { timeoutMs: 200, retryDelayMs: 1 });
  t('one transient network error is retried once and recovers', r3.status === 200 && r3.attempts === 2);
  let m = 0;
  const r4 = await W.fetchDoorHealth(async () => { m++; return jres({}, 503); }, { timeoutMs: 200, retryDelayMs: 1 });
  t('persistent 503 -> 2 attempts, status 503 surfaced', r4.status === 503 && r4.attempts === 2 && m === 2);
  let k = 0;
  const r5 = await W.fetchDoorHealth(async () => { k++; return jres({}, 404); }, { timeoutMs: 200, retryDelayMs: 1 });
  t('404 is not retried', r5.status === 404 && r5.attempts === 1 && k === 1);
  const t0 = Date.now();
  const r6 = await W.fetchDoorHealth(() => new Promise(() => {}), { timeoutMs: 60, retryDelayMs: 1 });
  t('hung fetch -> timeout error (does not hang the cron)', r6.error && r6.timeout === true && r6.attempts === 2 && Date.now() - t0 < 2000);
  const r8 = await W.fetchDoorHealth(async () => jres('error code: 1042', 404), { timeoutMs: 200 });
  t('non-healthy reply keeps a short body excerpt for diagnosis', r8.status === 404 && r8.snippet === 'error code: 1042');
  const r9 = await W.fetchDoorHealth(async () => jres(good()), { timeoutMs: 200 });
  t('healthy reply carries no snippet', r9.snippet === undefined);
  const r7 = await W.fetchDoorHealth(async () => { throw new Error('dns'); }, { timeoutMs: 200, retryDelayMs: 1 });
  t('throwing fetch -> error result, never throws', r7.error === 'dns' && r7.attempts === 2);
}

// ───────────────────────── full passes with injected io ─────────────────────────
function harness(over) {
  const h = { cell: '', sms: [], emails: [], tel: [], writes: 0, cfg: { admin_phone: '410-555-0100' }, health: good(), fetchImpl: null };
  h.io = {
    // the default fixture's last_tick is "20 min before NOW"; keep it "20 min before the simulated pass time" so a long simulated sequence stays fresh
    fetch: async () => {
      if (h.fetchImpl) return h.fetchImpl();
      const hp = Object.assign({}, h.health);
      if (hp.last_tick === new Date(NOW - 20 * MIN).toISOString()) hp.last_tick = new Date(h.nowMs - 20 * MIN).toISOString();
      return jres(hp);
    },
    readConfig: async () => Object.assign({}, h.cfg, { [W.DOOR_WD_STATE_KEY]: h.cell }),
    writeState: async (v) => { h.writes++; h.cell = v; },
    sendSms: async (phone, text) => { h.sms.push(text); return { sid: 'SMtest' }; },
    sendEmail: async (m) => { h.emails.push(m); return { sent: true }; },
    logTelemetry: async (env, rec) => { h.tel.push(rec); },
  };
  Object.assign(h.io, over || {});
  h.run = (nowMs, extra) => (h.nowMs = nowMs, W.runDoorWatchdogPass({}, Object.assign({ nowMs, io: h.io, retryDelayMs: 1, timeoutMs: 100 }, extra || {})));
  return h;
}
const logsOff = () => { const orig = console.error; console.error = () => {}; return () => { console.error = orig; }; };

{ // happy sequence: healthy -> problem -> suppressed -> reminder -> recovered -> healthy
  W.setMem(null);
  const h = harness();
  let r = await h.run(NOW);
  t('healthy pass: nothing sent, no telemetry, no state write', r.ok && r.action === 'none' && h.sms.length === 0 && h.tel.length === 0 && h.writes === 0);
  h.health = good({ ok: false, problems: [{ key: 'seam_auth_failed' }] });
  r = await h.run(NOW + 15 * MIN);
  t('problem: exactly one SMS with the alert text, state saved', r.ok && r.action === 'alert' && h.sms.length === 1 && h.sms[0] === r.sms_text && /^ALERT: door-code system/.test(h.sms[0]) && r.state_saved === true && h.writes === 1);
  t('problem alert leaves a FALSE telemetry row (key, no phone/text)', h.tel.length === 1 && h.tel[0].Success === 'FALSE' && /problem_alerted/.test(h.tel[0].Notes) && !/410-555/.test(JSON.stringify(h.tel)));
  r = await h.run(NOW + 30 * MIN);
  t('15 min later: suppressed, no second SMS', r.action === 'suppressed' && h.sms.length === 1);
  r = await h.run(NOW + 15 * MIN + 6 * HR);
  t('6h later, still broken: one reminder SMS', r.action === 'alert' && h.sms.length === 2);
  h.health = good();
  r = await h.run(NOW + 15 * MIN + 6 * HR + 15 * MIN);
  t('cleared: one RECOVERED SMS', r.action === 'recovered' && h.sms.length === 3 && /^RECOVERED: door-code system/.test(h.sms[2]) && h.tel[h.tel.length - 1].Success === 'TRUE');
  r = await h.run(NOW + 15 * MIN + 6 * HR + 30 * MIN);
  t('healthy again: nothing more sent', r.action === 'none' && h.sms.length === 3);
  h.health = good({ ok: false, problems: [{ key: 'seam_auth_failed' }] });
  r = await h.run(NOW + 8 * HR);
  t('same problem after RECOVERED is a new episode -> alerts again', r.action === 'alert' && h.sms.length === 4);
}
{ // different reason-set within the window alerts immediately
  W.setMem(null);
  const h = harness();
  h.health = good({ ok: false });
  await h.run(NOW);
  h.health = good({ last_tick: null });
  const r = await h.run(NOW + 15 * MIN);
  t('different reason-set within 6h -> second SMS', r.action === 'alert' && h.sms.length === 2);
}
{ // FAILURE PATH: health fetch fails (throws / timeout / 503 / non-JSON) is itself an alert
  for (const [label, impl, rx] of [
    ['throws', () => { throw new Error('dns failure'); }, /unreachable/],
    ['hangs', () => new Promise(() => {}), /timed out/],
    ['503', () => jres({}, 503), /HTTP 503/],
    ['non-JSON', () => jres('<html>'), /not valid JSON/],
  ]) {
    W.setMem(null);
    const h = harness(); h.fetchImpl = impl;
    const r = await h.run(NOW);
    t('fetch ' + label + ' -> alert SMS naming it', r.action === 'alert' && h.sms.length === 1 && rx.test(h.sms[0]) && r.healthy === false);
  }
}
{ // FAILURE PATH: SMS fails -> email fallback delivers, failure logged loudly
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ sendSms: async () => ({ error: 'Twilio 21608 unverified number' }) });
  h.health = good({ ok: false });
  const r = await h.run(NOW);
  restore();
  t('SMS error -> email fallback sent with the alert text', h.emails.length === 1 && h.emails[0].html.includes('ALERT: door-code system') && r.delivered === true);
  t('SMS error recorded: errors[] + FALSE telemetry', r.ok === false && r.errors.some(e => e.startsWith('sms:')) && h.tel.some(x => x.Success === 'FALSE' && /sms_alert/.test(x.Notes)));
  t('email-delivered alert counts as delivered (state recorded)', r.state_saved === true && JSON.parse(h.cell).active === true);
}
{ // FAILURE PATH: Twilio disabled (sendSMS returns skipped) is a delivery FAILURE, not a success
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ sendSms: async () => ({ skipped: true, reason: 'TWILIO_ENABLED not TRUE' }) });
  h.health = good({ ok: false });
  const r = await h.run(NOW);
  restore();
  t('skipped SMS -> loud failure + email fallback', r.delivery.sms.ok === false && /skipped/.test(r.delivery.sms.detail) && h.emails.length === 1 && h.tel.some(x => x.Success === 'FALSE' && /sms_alert/.test(x.Notes)));
}
{ // FAILURE PATH: SMS throws
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ sendSms: async () => { throw new Error('socket hang up'); } });
  h.health = good({ ok: false });
  const r = await h.run(NOW);
  restore();
  t('SMS throws -> caught, logged, email fallback', r.delivery.sms.ok === false && /threw/.test(r.delivery.sms.detail) && h.emails.length === 1);
}
{ // FAILURE PATH: admin_phone missing
  W.setMem(null);
  const restore = logsOff();
  const h = harness(); h.cfg = { admin_phone: '' };
  h.health = good({ ok: false });
  const r = await h.run(NOW);
  restore();
  t('admin_phone missing -> reported + email fallback', /admin_phone not set/.test(r.delivery.sms.detail) && h.sms.length === 0 && h.emails.length === 1);
}
{ // FAILURE PATH: BOTH channels fail -> not marked sent, retried, loud
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ sendSms: async () => ({ error: 'down' }), sendEmail: async () => { throw new Error('gmail down'); } });
  h.health = good({ ok: false });
  let r = await h.run(NOW);
  t('both channels fail -> delivered=false, errors, telemetry', r.delivered === false && r.ok === false && r.errors.some(e => e.startsWith('delivery:')) && r.errors.some(e => e.startsWith('email_fallback:')) && h.tel.filter(x => x.Success === 'FALSE').length >= 3);
  t('undelivered alert not recorded as sent', JSON.parse(h.cell || '{"active":false,"sent":{}}').active === false);
  h.io.sendSms = async (p, text) => { h.sms.push(text); return { sid: 'SMx' }; };
  r = await h.run(NOW + 15 * MIN);
  restore();
  t('next pass retries and delivers', r.action === 'alert' && r.delivered === true && h.sms.length === 1);
}
{ // FAILURE PATH: recovery text undeliverable -> stays active, retried
  W.setMem(null);
  const restore = logsOff();
  const h = harness();
  h.health = good({ ok: false });
  await h.run(NOW);
  h.health = good();
  h.io.sendSms = async () => ({ error: 'down' }); h.io.sendEmail = async () => ({ error: 'down' });
  let r = await h.run(NOW + 30 * MIN);
  t('RECOVERED undeliverable -> still active in state', r.delivered === false && JSON.parse(h.cell).active === true);
  h.io.sendSms = async (p, text) => { h.sms.push(text); return { sid: 'SMy' }; };
  r = await h.run(NOW + 45 * MIN);
  restore();
  t('RECOVERED retried next pass', r.action === 'recovered' && r.delivered === true && JSON.parse(h.cell).active === false);
}
{ // FAILURE PATH: state READ fails -> loud, still alerts, in-memory dedupe prevents a text every 15 min
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ readConfig: async () => { throw new Error('Sheets 429'); } });
  h.health = good({ ok: false });
  let r = await h.run(NOW);
  t('state read failure: reported + telemetry', r.ok === false && r.errors.some(e => e.startsWith('state_read:')) && h.tel.some(x => x.Success === 'FALSE' && /state_read/.test(x.Notes)));
  t('state read failure: no Config => no phone => email fallback still alerts Brett', h.emails.length === 1 && h.sms.length === 0 && r.delivered === true);
  r = await h.run(NOW + 15 * MIN);
  restore();
  t('state read failure: in-memory dedupe suppresses the repeat', r.action === 'suppressed' && h.emails.length === 1);
}
{ // FAILURE PATH: state WRITE fails -> loud, in-memory copy prevents spam
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ writeState: async () => { throw new Error('read-back mismatch'); } });
  h.health = good({ ok: false });
  let r = await h.run(NOW);
  t('state write failure: reported + FALSE telemetry', r.ok === false && r.state_saved === false && r.errors.some(e => e.startsWith('state_write:')) && h.tel.some(x => x.Success === 'FALSE' && /state_write/.test(x.Notes)));
  t('alert was still delivered', h.sms.length === 1);
  r = await h.run(NOW + 15 * MIN);
  restore();
  t('state write failure: in-memory dedupe stops a repeat text', r.action === 'suppressed' && h.sms.length === 1);
  t('dirty memory is flagged so the write is retried', W.getMem() && W.getMem().dirty === true);
}
{ // FAILURE PATH: corrupt stored state
  W.setMem(null);
  const restore = logsOff();
  const h = harness(); h.cell = '{garbage';
  h.health = good({ ok: false });
  const r = await h.run(NOW);
  restore();
  t('corrupt state: reported, telemetry, reset to clean + overwritten', r.errors.some(e => e.startsWith('state_corrupt:')) && h.tel.some(x => /state_corrupt/.test(x.Notes)) && JSON.parse(h.cell).active === true && r.action === 'alert');
}
{ // FAILURE PATH: telemetry write itself fails -> surfaced in errors, never throws, alert still goes out
  W.setMem(null);
  const restore = logsOff();
  const h = harness({ logTelemetry: async () => { throw new Error('Ops_Telemetry down'); } });
  h.health = good({ ok: false });
  let threw = false, r;
  try { r = await h.run(NOW); } catch (e) { threw = true; }
  restore();
  t('telemetry failure does not throw', threw === false);
  t('telemetry failure is visible in errors[] and the alert still went out', r.ok === false && r.errors.some(e => e.startsWith('telemetry_write(')) && h.sms.length === 1);
}
{ // absent last_tick: tolerated, then escalates after 24h via persisted absent_since
  W.setMem(null);
  const h = harness();
  const noTick = good(); delete noTick.last_tick; h.health = noTick;
  let r = await h.run(NOW);
  t('absent last_tick: no alert on first pass, absent_since persisted', r.action === 'none' && h.sms.length === 0 && JSON.parse(h.cell).absent_since === new Date(NOW).toISOString());
  r = await h.run(NOW + 23 * HR);
  t('absent 23h: still quiet', r.action === 'none' && h.sms.length === 0);
  r = await h.run(NOW + 25 * HR);
  t('absent 25h: escalates to an alert (check can never stay silently off)', r.action === 'alert' && /last_tick field/.test(h.sms[0]));
  h.health = good();
  r = await h.run(NOW + 26 * HR);
  t('last_tick appears: RECOVERED + absent_since cleared', r.action === 'recovered' && JSON.parse(h.cell).absent_since === null);
}
{ // result never leaks a phone number
  W.setMem(null);
  const h = harness(); h.health = good({ ok: false });
  const r = await h.run(NOW);
  t('pass result contains no phone number', !/410-555-0100|4105550100/.test(JSON.stringify(r)));
}

// ───────────────────────── cron wrapper: an unexpected throw is logged + alerted, never propagated ─────────────────────────
{
  const log = { tel: [], alerts: [] };
  const mk = (runImpl, telFails, alertFails) => new Function('runDoorWatchdogPass', 'logTelemetry', 'alertAdminOnFailure', 'DOOR_WD_JOB',
    'return (' + src.slice(src.indexOf('async function doorWatchdogCron('), src.indexOf('// GET /watchdog/door-system - read-only')).trim() + ');')(runImpl,
    async (env, rec) => { if (telFails) throw new Error('tel down'); log.tel.push(rec); },
    async (env, job, msg) => { if (alertFails) throw new Error('alert down'); log.alerts.push([job, msg]); }, 'door_watchdog');
  const restore = logsOff();
  let threw = false;
  try { await mk(async () => { throw new Error('kaboom'); }, false, false)({}); } catch (e) { threw = true; }
  t('unexpected throw does not propagate to the scheduler job', threw === false);
  t('unexpected throw -> FALSE telemetry + admin failure alert', log.tel.length === 1 && log.tel[0].Success === 'FALSE' && /kaboom/.test(log.tel[0].Notes) && log.alerts.length === 1 && log.alerts[0][0] === 'door_watchdog');
  threw = false;
  try { await mk(async () => { throw new Error('kaboom2'); }, true, true)({}); } catch (e) { threw = true; }
  t('even telemetry + alert failing cannot break the scheduler job', threw === false);
  const okRes = await mk(async () => ({ ok: true, errors: [] }), false, false)({});
  restore();
  t('normal pass result passed through', okRes.ok === true);
}

// ───────────────────────── structural (wiring) ─────────────────────────
{
  // Oct 12 2026: no cron - the watchdog is the scheduler's `door_watchdog` job (first in priority, every ~15 min).
  const wdJob = src.slice(src.indexOf('async function schedRunDoorWatchdog('), src.indexOf('// The three sweep jobs below'));
  t('watchdog is the FIRST scheduler job (priority order), 15-minute interval', /\{ name: 'door_watchdog',\s+kind: 'interval', every_min: 14/.test(src) && src.indexOf("name: 'door_watchdog'") < src.indexOf("name: 'sweep'"));
  t('the watchdog job calls doorWatchdogCron and returns its errors (not swallowed)', /schedStep\('door_watchdog', \(\) => doorWatchdogCron\(env\)/.test(wdJob) && /ok: !errors\.length/.test(wdJob));
  const cronFn = block.slice(block.indexOf('async function doorWatchdogCron('), block.indexOf('// GET /watchdog/door-system - read-only'));
  t('cron wrapper: own try/catch, logs telemetry AND alerts, never rethrows', /try \{\s*const wd = await runDoorWatchdogPass\(env\)/.test(cronFn) && /Job_Type: DOOR_WD_JOB/.test(cronFn) && /alertAdminOnFailure\(env, 'door_watchdog'/.test(cronFn) && !/throw /.test(cronFn));
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  t('same-account Worker fetch enabled (global_fetch_strictly_public) - otherwise Cloudflare answers error 1042/404', /compatibility_flags = \["global_fetch_strictly_public"\]/.test(toml));
  t('NO cron triggers at all (permanent rule, Oct 12 2026): crons = [] removes any attached trigger', /\[triggers\]\s*\ncrons = \[\]/.test(toml) && !/crons = \[\s*"/.test(toml));
  const testFn = block.slice(block.indexOf('async function doorWatchdogTest('));
  t('test hook is staging-only (first statement)', /^async function doorWatchdogTest\(env, url, body\) \{\s*if \(!isStaging\(env, url\)\) return json\(\{ error: 'Not found' \}, 404\);/.test(testFn));
  t('test hook is routed + allowed for HUB_TEST_TOKEN writes', /path === '\/watchdog\/door-system\/test'\)\s*return await doorWatchdogTest\(env, url, body\)/.test(src) && /if \(path === '\/watchdog\/door-system\/test'\) return true;/.test(src));
  t('GET status is routed', /path === '\/watchdog\/door-system'\)\s*return await doorWatchdogStatus\(env\)/.test(src));
  t('no swallowing catches in the watchdog block', !/catch\s*\([^)]*\)\s*\{\s*\}/.test(block) && !/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(block) && !/catch\s*\(\s*_\s*\)\s*\{\s*\/\*/.test(block));
  t('no secrets / phone numbers in the block', !/\+?1?[ -]?\(?\d{3}\)?[ -]\d{3}-\d{4}/.test(block) && !/Bearer |TOKEN\s*=/.test(block));
  t('BUILD_VERSION bumped', /const BUILD_VERSION = '2026-10-12\.3-door-watchdog'/.test(src));
}

console.log(`door-watchdog: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
