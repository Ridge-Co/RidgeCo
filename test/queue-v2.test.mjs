// Queue v2 (Nov 16 2026): one lifecycle (Stage), the narrow report-back route, tick sync + deploy check, the risk guard.
// Pulls the REAL functions out of worker.js and runs the handlers against an in-memory fake sheet, so a regression in
// worker.js fails here. Nothing touches the network, a real sheet, GitHub or Twilio.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../proposals.html', import.meta.url), 'utf8');
const gs = fs.readFileSync(new URL('../apps-script/hub-scheduler/HubScheduler.gs', import.meta.url), 'utf8');
const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  const start = src.slice(i - 6, i) === 'async ' ? i - 6 : i;
  return src.slice(start, j + 1);
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' = ');
  if (i < 0) throw new Error('missing const ' + name);
  let d = 0, j = i;
  for (; j < src.length; j++) { const c = src[j]; if ('[({'.includes(c)) d++; else if ('])}'.includes(c)) d--; else if (c === ';' && d === 0) break; }
  return src.slice(i, j + 1);
}

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ── fake sheet ──────────────────────────────────────────────────────────────────────────────
const CONSTS = ['OPS_QUEUE_COLS', 'QUEUE_STAGES', 'QUEUE_SHIPPED_STAGES', 'QUEUE_STAGE_FAMILY', 'QUEUE_STUCK_MS', 'QUEUE_DEPLOY_GRACE_MS', 'QUEUE_DEPLOY_MARK',
  'QUEUE_STAGE_LOG_MAX', 'QUEUE_BULK_MAX', 'QUEUE_STAGE_FIELDS', 'QUEUE_STAGE_ADMIN_FIELDS', 'QUEUE_BLOCKED_ON', 'QUEUE_TOKEN_FROM', 'QUEUE_TOKEN_TO', 'QUEUE_RISK_RULES'];
const FNS = ['isSnoozed', 'snoozeUntilFromDays', 'cleanPrNumber', 'prStateToBuildState', 'matchPrToItem', 'queueLegacyStage', 'queueStageOf', 'queueStuckInfo',
  'queueLogAppend', 'queueRiskGuard', 'queueRiskGuardText', 'queueRowText', 'queueResolveRisk', 'queueStagePlan', 'queueActorOf', 'opsQueueStage',
  'opsQueueRiskCheck', 'queueSyncStageFields', 'queueDeployVerdict', 'queueDeployStep', 'opsQueueSync', 'updateQueueRowOrThrow', 'opsQueueRead',
  'schedRunQueueSync', 'idColIndex', 'col'];
const S = { rows: [], gets: 0, posts: 0, failVerify: false, loseWrite: false, ensureTab: 0, ensureCols: 0, fails: [], gh: {}, ghCalls: [], version: { stamped: false, deployed_at: null, version_id: null } };
const json = (o, s) => ({ status: s || 200, body: o });
let COLS = null, colOf = null;
const helpers = {
  json,
  isMissingTabError: () => false,
  ensureTab: async () => { S.ensureTab++; },
  ensureColumns: async () => { S.ensureCols++; },
  invalidateTabCache: () => {},
  buildVersion: () => S.version,
  reportFailure: async (_e, f) => { S.fails.push(f); return { ok: true, id: 'F-' + S.fails.length }; },
  ghPublicJson: async (path) => { S.ghCalls.push(path); const h = S.gh[path]; if (h === undefined) throw new Error('GitHub ' + path + ' → HTTP 404'); if (h instanceof Error) throw h; return h; },
  schedStep: async (name, fn, errors) => { const r = await fn(); const b = r && r.body; if (!b || b.ok === false) errors.push({ step: name, error: JSON.stringify((b && b.errors) || b).slice(0, 200) }); return b; },
  sheetsRequest: async (_e, method, path, body) => {
    if (method === 'GET' && path.startsWith('/values/Ops_Build_Queue')) {
      S.gets++;
      if (S.failVerify && S.gets % 2 === 0) throw new Error('Quota exceeded for quota metric Read requests');
      return { values: [COLS, ...S.rows.map(r => COLS.map(c => (r[c] === undefined ? '' : String(r[c]))))] };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      S.posts++;
      if (S.loseWrite) return {};
      for (const u of body.data) {
        const m = /^Ops_Build_Queue!([A-Z]+)(\d+)$/.exec(u.range);
        if (!m) throw new Error('bad range ' + u.range);
        S.rows[parseInt(m[2], 10) - 2][colOf[m[1]]] = u.values[0][0];
      }
      return {};
    }
    throw new Error('unexpected sheet call ' + method + ' ' + path);
  },
  updateRow: async (_e, _t, id, f) => {
    const r = S.rows.find(x => String(x.ID) === String(id)); if (!r) return json({ error: 'Row not found' }, 404);
    Object.assign(r, f); return json({ success: true });
  },
};
const code = CONSTS.map(grabConst).join('\n') + '\n' + FNS.map(grab).join('\n') + `
const OPS_QUEUE_TAB = 'Ops_Build_Queue', QUEUE_REPO = 'Ridge-Co/RidgeCo';
return { OPS_QUEUE_COLS, QUEUE_STAGES, QUEUE_STAGE_LOG_MAX, QUEUE_DEPLOY_MARK, ${FNS.join(', ')} };`;
const L = new Function(...Object.keys(helpers), code)(...Object.values(helpers));
COLS = L.OPS_QUEUE_COLS;
colOf = {}; COLS.forEach((c, i) => { colOf[L.col(i)] = c; });

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const H = 3600000;
const row = (o) => Object.assign({ ID: '1', Timestamp: iso(40 * 24 * H), Title: 'TEST-Show the vendor trade on the job card', Problem: 'Vendors cannot see the trade', First_Step: 'Add the trade under the title', Status: 'proposed', Risk_Class: '' }, o);
const reset = (rows) => { S.rows = rows.map(r => Object.assign({}, r)); S.gets = 0; S.posts = 0; S.failVerify = false; S.loseWrite = false; S.ensureTab = 0; S.ensureCols = 0; S.fails = []; S.gh = {}; S.ghCalls = []; S.version = { stamped: false, deployed_at: null, version_id: null }; };
const ADMIN = { admin: true, actor: 'Brett', nowMs: NOW };
const TOKEN = { admin: false, actor: 'build session', nowMs: NOW };
const plan = (r, req, ctx) => L.queueStagePlan(r, req, Object.assign({}, ctx || ADMIN));

// ── 1. schema + wiring (static) ─────────────────────────────────────────────────────────────
for (const c of ['Stage', 'Stage_Updated', 'Stage_By', 'Stage_Log', 'Blocked_Reason', 'Blocked_On', 'Pinned']) ok(COLS.includes(c), 'column ' + c + ' is in OPS_QUEUE_COLS (added by ensureColumns)');
eq(COLS.slice(0, 11), ['ID', 'Timestamp', 'Title', 'Rank', 'Problem', 'Impact', 'Effort', 'Tag', 'First_Step', 'Review_TS', 'Status'], 'existing columns keep their order (new ones are appended)');
eq(L.QUEUE_STAGES, ['review', 'approved', 'queued', 'building', 'pr_open', 'merged', 'live', 'done', 'blocked', 'snoozed', 'dropped'], 'the stage list');
const stageFn = grab('opsQueueStage');
ok(!/ensureTab\(/.test(stageFn) && /ensureColumns\(env, OPS_QUEUE_TAB, OPS_QUEUE_COLS\)/.test(stageFn), 'the report-back route uses ensureColumns and never ensureTab on the live sheet');
const writeList = src.match(/const HUB_PROD_WRITE_PATHS = \[([^\]]*)\];/)[1];
ok(/'\/ops-queue-stage'/.test(writeList) && /'\/ops-queue\/risk-check'/.test(writeList), 'both routes are on the broker write allow-list');
ok(!/'\/ops-queue-update'/.test(writeList) && !/'\/ops-approve'/.test(writeList) && !/start-build/.test(writeList), 'the full-lifecycle admin routes are NOT on the broker allow-list');
const qGate = src.slice(src.indexOf('const _opsQueueOk'), src.indexOf('const _scoutOk'));
ok(/path === '\/ops-queue-stage'/.test(qGate) && /path === '\/ops-queue\/risk-check'/.test(qGate), 'the queue token reaches both routes');
ok(/if \(path === '\/ops-queue-stage'\)\s+return await opsQueueStage\(env, body, \{ actor: queueActorOf\(env, request\.headers\.get\('X-Auth-Token'\)\) \}\);/.test(src), 'route is wired, actor comes from the credential');
ok(/if \(path === '\/ops-queue\/risk-check'\)\s+return await opsQueueRiskCheck\(env, body\);/.test(src), 'risk-check route is wired');
const guardFn = grab('hubTestWriteAllowed');
ok(/path === '\/ops-queue-stage'/.test(guardFn) && /every target must be a TEST- row/.test(guardFn), 'staging token may only touch TEST- rows on the report-back route');
ok(/\{ name: 'queue_sync',\s+kind: 'interval', every_min: 14, run: \(env\) => schedRunQueueSync\(env\) \}/.test(src), 'queue_sync is a Hub scheduler job');
ok(/\{ name: 'queue_sync',\s+run: 'hub', every_min: 15,/.test(gs), 'queue_sync has a row in the Apps Script JOBS table');
ok(/queue_sync: '/.test(src.slice(src.indexOf('const SCHED_PF_WHAT'), src.indexOf('const SCHED_PF_WHAT') + 6000)), 'queue_sync has a plain-English preflight line');
ok(/crons\s*=\s*\[\s*\]/.test(toml), 'NO CRON: wrangler.toml crons stays empty');
ok(/hub_impr_daily',\s+kind: 'daily',\s+at: '07:30'/.test(src) && /opsQueueSync\(env, \{\}, \{ ignoreSuppliedPrs: true \}\)/.test(src), 'the existing daily sync run is kept');
const v2Block = src.slice(src.indexOf('// ══ QUEUE v2'), src.indexOf('async function schedRunQueueSync'));
ok(v2Block.length > 5000 && !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(v2Block) && !/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(v2Block), 'no swallowing catch in the Queue v2 code');
ok(!/anthropic|api\.claude|ROUTINE_/i.test(v2Block), 'the Queue v2 code calls no Claude API and no routine');

// ── 2. stage is worked out on read for old rows (no backfill) ───────────────────────────────
const legacy = (Status, Build_State, extra) => L.queueStageOf(row(Object.assign({ Status, Build_State: Build_State || '' }, extra || {})), NOW);
eq(legacy('proposed'), 'review', 'proposed -> review');
eq(legacy('proposed', '', { Snooze_Until: iso(-5 * 24 * H) }), 'snoozed', 'proposed + future snooze -> snoozed');
eq(legacy('proposed', '', { Snooze_Until: iso(24 * H) }), 'review', 'an expired snooze is back in review');
eq(legacy('greenlit'), 'approved', 'greenlit -> approved');
eq(legacy('prepared'), 'approved', 'prepared -> approved');
eq(legacy('building', 'building'), 'building', 'building -> building');
eq(legacy('building', 'pr_open'), 'pr_open', 'building + PR open -> pr_open');
eq(legacy('done', 'pr_open'), 'pr_open', 'done + PR open -> pr_open (the old "built, waiting for merge")');
eq(legacy('done', 'live'), 'live', 'done + live -> live');
eq(legacy('done', ''), 'done', 'done by hand -> done');
eq(legacy('held', 'held'), 'blocked', 'held -> blocked');
eq(legacy('building', 'pr_closed'), 'blocked', 'PR closed without merging -> blocked');
eq(legacy('dropped'), 'dropped', 'dropped -> dropped');
eq(legacy(''), 'review', 'blank status -> review');
eq(L.queueStageOf(row({ Status: 'greenlit', Stage: 'queued' }), NOW), 'queued', 'a stored Stage wins while Status agrees (queued on greenlit)');
eq(L.queueStageOf(row({ Status: 'prepared', Stage: 'queued' }), NOW), 'queued', 'queued survives the Prepare agent moving the row to prepared');
eq(L.queueStageOf(row({ Status: 'done', Build_State: 'live', Stage: 'merged' }), NOW), 'merged', 'merged sits on done + live');
eq(L.queueStageOf(row({ Status: 'building', Build_State: 'building', Stage: 'queued' }), NOW), 'building', 'an older writer moved the row on: the stage follows Status, not the stale cell');
eq(L.queueStageOf(row({ Status: 'dropped', Stage: 'pr_open' }), NOW), 'dropped', 'a row dropped through the old route reads as dropped');
eq(L.queueStageOf(row({ Status: 'greenlit', Stage: 'nonsense' }), NOW), 'approved', 'an unknown Stage value is ignored');
eq(L.queueStageOf(row({ Status: 'proposed', Stage: 'snoozed', Snooze_Until: iso(H) }), NOW), 'review', 'a stored snoozed stage ends when the snooze does');

// stuck
const stuck = (o) => L.queueStuckInfo(row(o), NOW);
ok(stuck({ Status: 'building', Build_State: 'building', Stage: 'building', Stage_Updated: iso(25 * H) }).stuck === true, 'building for 25h is stuck');
ok(stuck({ Status: 'building', Build_State: 'building', Stage: 'building', Stage_Updated: iso(23 * H) }).stuck === false, 'building for 23h is not stuck');
ok(stuck({ Status: 'done', Build_State: 'pr_open', Stage: 'pr_open', Stage_Updated: iso(73 * H) }).stuck === true, 'PR open for 73h is stuck');
ok(stuck({ Status: 'done', Build_State: 'pr_open', Stage: 'pr_open', Stage_Updated: iso(71 * H) }).stuck === false, 'PR open for 71h is not stuck');
ok(stuck({ Status: 'building', Build_State: 'building', Build_Updated: iso(30 * H) }).stuck === true, 'an old row with no Stage cell is judged on Build_Updated (row #55 case)');
ok(stuck({ Status: 'proposed', Timestamp: iso(900 * H) }).stuck === false && stuck({ Status: 'greenlit', Timestamp: iso(900 * H) }).stuck === false, 'review and approved rows are never "stuck"');
eq(stuck({ Status: 'building', Build_State: 'building', Stage_Updated: iso(25 * H) }).hours, 25, 'hours since the stage changed are reported');

// ── 3. the plan: every allowed move (Brett) ─────────────────────────────────────────────────
const R = { review: row({ Status: 'proposed' }), approved: row({ Status: 'greenlit', Risk_Class: 'SAFE', Stage: 'approved' }),
  building: row({ Status: 'building', Build_State: 'building', Risk_Class: 'SAFE', Stage: 'building' }),
  propen: row({ Status: 'done', Build_State: 'pr_open', Risk_Class: 'GATED', PR_Number: '560', Stage: 'pr_open' }),
  blockedBrett: row({ Status: 'held', Build_State: 'held', Risk_Class: 'GATED', Stage: 'blocked', Blocked_On: 'brett', Blocked_Reason: 'needs a decision', Held_Note: 'needs a decision' }),
  blockedBuild: row({ Status: 'held', Build_State: 'held', Risk_Class: 'GATED', Stage: 'blocked', Blocked_On: 'build', Blocked_Reason: 'tests red' }),
  merged: row({ Status: 'done', Build_State: 'live', Risk_Class: 'SAFE', PR_Number: '561', Stage: 'merged', Stage_Updated: iso(H) }),
  dropped: row({ Status: 'dropped', Drop_Reason: 'no' }) };
let p = plan(R.review, { id: '1', stage: 'approved', risk_class: 'AUTO' });
ok(p.ok && p.from === 'review' && p.to === 'approved' && p.fields.Status === 'greenlit' && p.fields.Stage === 'approved' && p.fields.Approved_By === 'Brett', 'approve: review -> approved writes Status greenlit in step');
eq(p.fields.Risk_Class, 'SAFE', '"Decide for me" stores SAFE when the wording is harmless');
ok(/^\d{4}-.* \| Brett \| review -> approved \| /.test(p.log) && p.fields.Stage_Log === p.log, 'the change is appended to Stage_Log with who and when');
p = plan(row({ Status: 'proposed', Title: 'TEST-Fix the invoice total on deposits' }), { id: '1', stage: 'approved', risk_class: 'AUTO' });
ok(p.ok && p.fields.Risk_Class === 'GATED' && /invoice/i.test(p.risk_reason), '"Decide for me" stores GATED when the title mentions invoices, and says why');
p = plan(R.review, { id: '1', stage: 'approved' });
eq(p.fields.Risk_Class, 'GATED', 'approving with no risk chosen at all is GATED (fail-closed)');
p = plan(R.approved, { id: '1', stage: 'queued' });
ok(p.ok && p.fields.Stage === 'queued' && p.fields.Pinned === 'TRUE' && p.fields.Status === undefined, 'Build now: approved -> queued sets Pinned and leaves Status greenlit');
p = plan(row({ Status: 'prepared', Risk_Class: 'SAFE' }), { id: '1', stage: 'queued' });
ok(p.ok && p.fields.Status === undefined && p.fields.Stage === 'queued', 'a prepared row keeps Status prepared when queued (the brief is not lost)');
p = plan(R.approved, { id: '1', stage: 'building' });
ok(p.ok && p.fields.Status === 'building' && p.fields.Build_State === 'building', 'approved -> building');
p = plan(R.building, { id: '1', stage: 'pr_open', pr_number: 562 });
ok(p.ok && p.fields.Status === 'done' && p.fields.Build_State === 'pr_open' && p.fields.PR_Number === '562' && p.fields.Stage === 'pr_open', 'building -> pr_open with a PR number');
p = plan(R.building, { id: '1', stage: 'pr_open' });
ok(!p.ok && p.status === 400 && /pr_number is required/.test(p.error), 'pr_open without any PR number is refused');
p = plan(R.building, { id: '1', stage: 'review' });
ok(p.ok && p.fields.Status === 'proposed' && p.fields.Build_State === '' && p.fields.Stage === 'review', 'pull out at building: back to review');
p = plan(R.propen, { id: '1', stage: 'review' });
ok(p.ok && p.fields.Status === 'proposed' && p.fields.PR_Number === '', 'pull out at pr_open: back to review, the old PR is forgotten');
p = plan(R.building, { id: '1', stage: 'snoozed', snooze_days: 10 });
ok(p.ok && p.fields.Status === 'proposed' && Date.parse(p.fields.Snooze_Until) > NOW + 9 * 24 * H && p.fields.Stage === 'snoozed', 'pull out: snooze with days');
ok(!plan(R.building, { id: '1', stage: 'snoozed' }).ok && !plan(R.building, { id: '1', stage: 'snoozed', snooze_days: 0 }).ok && !plan(R.building, { id: '1', stage: 'snoozed', snooze_days: 999 }).ok, 'snooze needs 1 to 365 days');
p = plan(R.building, { id: '1', stage: 'dropped', reason: 'not worth it' });
ok(p.ok && p.fields.Status === 'dropped' && p.fields.Drop_Reason === 'not worth it' && p.fields.Stage === 'dropped', 'pull out: drop with a reason');
ok(!plan(R.building, { id: '1', stage: 'dropped' }).ok && /reason is required/.test(plan(R.building, { id: '1', stage: 'dropped', reason: '  ' }).error), 'drop without a reason is refused');
p = plan(R.dropped, { id: '1', stage: 'review' });
ok(p.ok && p.fields.Status === 'proposed', 'undo: a dropped row can be brought back to review');
p = plan(R.building, { id: '1', stage: 'blocked', blocked_reason: 'needs your call on wording', blocked_on: 'brett' });
ok(p.ok && p.fields.Status === 'held' && p.fields.Build_State === 'held' && p.fields.Held_Note === 'needs your call on wording' && p.fields.Blocked_On === 'brett', 'block a row: Status held in step, reason kept');
ok(!plan(R.building, { id: '1', stage: 'blocked' }).ok && /blocked_reason is required/.test(plan(R.building, { id: '1', stage: 'blocked' }).error), 'block without a reason is refused');
ok(!plan(R.building, { id: '1', stage: 'blocked', blocked_reason: 'x', blocked_on: 'nobody' }).ok, 'blocked_on must be brett, build or external');
p = plan(R.blockedBrett, { id: '1', stage: 'queued' });
ok(p.ok && p.fields.Status === 'greenlit' && p.fields.Blocked_Reason === '' && p.fields.Blocked_On === '' && p.fields.Held_Note === '', 'unblock clears the block and re-queues');
p = plan(R.merged, { id: '1', stage: 'live' });
ok(p.ok && p.fields.Stage === 'live', 'Mark live: a SAFE merged row can be marked live by Brett');
p = plan(R.approved, { id: '1', risk_class: 'GATED' });
ok(p.ok && p.to === 'approved' && p.fields.Risk_Class === 'GATED' && p.fields.Stage === undefined, 'risk can change with no stage move');
p = plan(R.propen, { id: '1', risk_class: 'SAFE' });
ok(p.ok && p.fields.Risk_Class === 'SAFE', 'risk can be changed at pr_open');
p = plan(row({ Status: 'greenlit', Risk_Class: 'GATED', Title: 'TEST-Resend the tenant PIN text' }), { id: '1', risk_class: 'SAFE' });
ok(p.ok && p.fields.Risk_Class === 'SAFE' && p.warnings.length === 1 && /still forces it to gated/.test(p.warnings[0]), 'Brett may choose SAFE on a risky-sounding row, with a warning that the file check still applies');
p = plan(R.approved, { id: '1', pinned: true });
ok(p.ok && p.fields.Pinned === 'TRUE' && /pinned/.test(p.log), 'pin to top');
ok(plan(row({ Status: 'greenlit', Risk_Class: 'SAFE', Pinned: 'TRUE' }), { id: '1', pinned: false }).fields.Pinned === '', 'unpin');
ok(!plan(R.approved, { id: '1', pinned: 'yes' }).ok, 'pinned must be true or false');
p = plan(R.approved, { id: '1', stage: 'approved' });
ok(p.ok && p.fields.Stage === 'approved' && !p.noop, 'first write materialises the Stage cell');
p = plan(row({ Status: 'greenlit', Risk_Class: 'SAFE', Stage: 'approved', Stage_Updated: iso(H), Stage_By: 'Brett' }), { id: '1', stage: 'approved', risk_class: 'SAFE' });
ok(p.ok && p.noop === true && Object.keys(p.fields).length === 0, 'a request that changes nothing writes nothing');
p = plan(R.approved, { id: '1', note: 'looked at this, no change' });
ok(p.ok && !p.noop && Object.keys(p.fields).join() === 'Stage_Log' && /looked at this/.test(p.fields.Stage_Log), 'a note alone is logged');

// ── 3b. refused cases ───────────────────────────────────────────────────────────────────────
p = plan(R.approved, { id: '1', stage: 'queued', status: 'done' });
ok(!p.ok && p.status === 400 && /unknown field\(s\): status/.test(p.error), 'unknown fields are refused out loud');
ok(!plan(R.approved, { id: '1', Risk_Class: 'SAFE' }).ok && !plan(R.approved, { id: '1', build_brief: 'x' }).ok && !plan(R.approved, { id: '1', approved_by: 'x' }).ok, 'no back door to other columns');
p = plan(null, { id: '999', stage: 'building' });
ok(!p.ok && p.status === 404 && /not_found/.test(p.error), 'unknown id is a loud 404');
ok(!plan(R.approved, { id: '1', stage: 'shipped' }).ok && /stage must be one of/.test(plan(R.approved, { id: '1', stage: 'shipped' }).error), 'unknown stage is refused');
ok(!plan(R.approved, { id: '1', pr_number: 'abc' }).ok && !plan(R.approved, { id: '1', risk_class: 'MAYBE' }).ok && !plan(R.approved, { id: '1', note: 5 }).ok, 'bad pr_number / risk_class / note are refused');
ok(!plan(R.approved, { id: '1', snooze_days: 5 }).ok && !plan(R.approved, { id: '1', reason: 'x' }).ok, 'snooze_days / reason only go with their own stage');
// GATED rows and shipped stages
p = plan(row({ Status: 'done', Build_State: 'pr_open', Risk_Class: 'GATED', Stage: 'pr_open' }), { id: '1', stage: 'merged' });
ok(!p.ok && p.status === 409 && /real merged PR number/.test(p.error), 'GATED row: merged with no PR number is refused');
p = plan(R.propen, { id: '1', stage: 'live' });
ok(!p.ok && p.code === 'need_pr_check' && p.pr === '560', 'GATED row: live needs the PR checked on GitHub first');
p = plan(R.propen, { id: '1', stage: 'live' }, Object.assign({}, ADMIN, { prMerged: false }));
ok(!p.ok && p.status === 409 && /PR #560 is not merged/.test(p.error), 'GATED row: live is refused while the PR is not merged, even for Brett');
p = plan(R.propen, { id: '1', stage: 'merged' }, Object.assign({}, ADMIN, { prMerged: null, prCheckError: 'HTTP 403' }));
ok(!p.ok && p.status === 503 && /NOT marked merged/.test(p.error), 'GATED row: if GitHub cannot be read the row is NOT marked (fail-closed)');
p = plan(R.propen, { id: '1', stage: 'merged' }, Object.assign({}, ADMIN, { prMerged: true, prMergedAt: '2026-11-16T10:00:00Z' }));
ok(p.ok && p.fields.Stage === 'merged' && p.fields.Build_State === 'live' && p.fields.Stage_Updated === '2026-11-16T10:00:00Z', 'GATED row: merged is allowed once GitHub confirms, and records the real merge time');
p = plan(R.propen, { id: '1', stage: 'done', pr_number: 999 }, Object.assign({}, ADMIN, { prMerged: false }));
ok(!p.ok && p.status === 409, 'GATED row: done counts as shipped too, and a made-up PR number does not help');
p = plan(R.propen, { id: '1', stage: 'live', risk_class: 'SAFE' });
ok(!p.ok && p.code === 'need_pr_check', 'relabelling a GATED row SAFE in the same request does not skip the proof');
p = plan(row({ Status: 'greenlit', Risk_Class: '' }), { id: '1', stage: 'live' });
ok(!p.ok && p.status === 409, 'a row with no risk chosen counts as GATED');
// token (build session) limits
const tk = (r, req, extra) => plan(r, req, Object.assign({}, TOKEN, extra || {}));
ok(tk(R.approved, { id: '1', stage: 'building' }).ok, 'token: approved -> building is allowed');
p = tk(R.building, { id: '1', stage: 'pr_open', pr_number: '570' });
ok(p.ok && p.fields.Stage_By === 'build session' && p.fields.PR_Number === '570', 'token: reports the PR it opened (the call that used to 401)');
ok(tk(R.building, { id: '1', stage: 'blocked', blocked_reason: 'tests red', blocked_on: 'build' }).ok, 'token: can block a row with a reason');
ok(tk(R.building, { id: '1', stage: 'queued' }).ok, 'token: can hand a row back to queued');
ok(tk(R.building, { id: '1', risk_class: 'GATED' }).ok, 'token: can raise the risk to GATED');
ok(tk(R.blockedBuild, { id: '1', stage: 'building' }).ok, 'token: can resume a row that was blocked on the build');
p = tk(R.review, { id: '1', stage: 'approved' });
ok(!p.ok && p.status === 403, 'token: can NEVER approve a row in review (that is Brett\'s gate)');
ok(tk(row({ Status: 'proposed', Snooze_Until: iso(-24 * H) }), { id: '1', stage: 'building' }).status === 403 && tk(R.dropped, { id: '1', stage: 'building' }).status === 403 && tk(row({ Status: 'done' }), { id: '1', stage: 'building' }).status === 403, 'token: cannot move rows out of snoozed, dropped or done');
ok(tk(R.building, { id: '1', stage: 'review' }).status === 403 && tk(R.building, { id: '1', stage: 'dropped' }).status === 403 && tk(R.building, { id: '1', stage: 'snoozed' }).status === 403, 'token: cannot send a row to review, dropped or snoozed');
ok(/unknown field\(s\): reason/.test(tk(R.building, { id: '1', stage: 'dropped', reason: 'x' }).error) && /unknown field\(s\): snooze_days/.test(tk(R.building, { id: '1', stage: 'snoozed', snooze_days: 3 }).error), 'token: reason / snooze_days are unknown fields for it');
ok(tk(R.building, { id: '1', risk_class: 'SAFE' }).status === 403 && tk(R.building, { id: '1', risk_class: 'AUTO' }).status === 403, 'token: can never mark a row SAFE');
ok(tk(R.blockedBrett, { id: '1', stage: 'building' }).status === 403, 'token: cannot unblock a row that is blocked on Brett');
p = tk(row({ Status: 'building', Build_State: 'building', Risk_Class: 'SAFE', Stage: 'building' }), { id: '1', stage: 'live' });
ok(!p.ok && p.status === 409, 'token: even a SAFE row needs a merged PR before it can be marked live');
p = tk(row({ Status: 'done', Build_State: 'pr_open', Risk_Class: 'SAFE', PR_Number: '5', Stage: 'pr_open' }), { id: '1', stage: 'merged' }, { prMerged: false });
ok(!p.ok && p.status === 409, 'token: merged is refused while GitHub says the PR is open');
p = tk(row({ Status: 'done', Build_State: 'pr_open', Risk_Class: 'SAFE', PR_Number: '5', Stage: 'pr_open' }), { id: '1', stage: 'merged' }, { prMerged: true });
ok(p.ok && p.fields.Stage === 'merged', 'token: merged is allowed once GitHub confirms');
// log cap
let big = ''; for (let i = 0; i < 400; i++) big = L.queueLogAppend(big, 'line ' + i + ' ' + 'x'.repeat(40));
ok(big.length <= L.QUEUE_STAGE_LOG_MAX && /line 399/.test(big) && !/line 0 /.test(big) && !big.startsWith('\n'), 'Stage_Log keeps the newest lines and stays under the cell cap');
eq(L.queueLogAppend('a', 'b\nc'), 'a\nb c', 'a log line is always one line');

// ── 4. the route against the fake sheet ─────────────────────────────────────────────────────
const call = (body, actor) => L.opsQueueStage({}, body, actor ? { actor } : undefined);
const BUILD = { name: 'build session', admin: false }, BRETT = { name: 'Brett', admin: true }, STG = { name: 'staging test', admin: true, stagingTest: true };
reset([row({ ID: '7', Status: 'greenlit', Risk_Class: 'SAFE' }), row({ ID: '8', Status: 'building', Build_State: 'building', Risk_Class: 'GATED' }), row({ ID: '9', Status: 'proposed' })]);
let r = await call({ id: '7', stage: 'queued' }, BRETT);
ok(r.status === 200 && r.body.ok && r.body.stage === 'queued' && r.body.from === 'approved' && r.body.confirmed === true, 'route: approved -> queued saves and is confirmed by a re-read');
ok(S.rows[0].Stage === 'queued' && S.rows[0].Pinned === 'TRUE' && S.rows[0].Status === 'greenlit' && S.rows[0].Stage_By === 'Brett' && /approved -> queued/.test(S.rows[0].Stage_Log), 'route: the sheet row really changed');
ok(S.gets === 2 && S.posts === 1 && S.ensureTab === 0 && S.ensureCols === 1, 'route: 2 reads + 1 write, ensureColumns only');
r = await call({ id: '8', stage: 'pr_open', pr_number: 571 }, BUILD);
ok(r.status === 200 && r.body.ok && S.rows[1].Stage === 'pr_open' && S.rows[1].PR_Number === '571' && S.rows[1].Status === 'done' && S.rows[1].Build_State === 'pr_open' && S.rows[1].Stage_By === 'build session', 'route: a build session reports its PR and the row moves to pr_open');
r = await call({ id: '404', stage: 'building' }, BUILD);
ok(r.status === 404 && r.body.ok === false && /not_found/.test(r.body.error), 'route: unknown id is a loud 404');
r = await call({ id: '8', stage: 'building', Status: 'done' }, BUILD);
ok(r.status === 400 && /unknown field\(s\): Status/.test(r.body.error), 'route: unknown field is a loud 400');
r = await call({ stage: 'building' }, BUILD);
ok(r.status === 400 && /id required/.test(r.body.error), 'route: id is required');
r = await call({ id: '9', stage: 'approved' }, BUILD);
ok(r.status === 403 && S.rows[2].Status === 'proposed' && !S.rows[2].Stage, 'route: a build session cannot approve, and nothing was written');
r = await call({ ids: ['7', '8'], pinned: true }, BUILD);
ok(r.status === 400 && /unknown field\(s\): ids/.test(r.body.error), 'route: bulk ids are not available to a token');
r = await call({ id: '8', test_as_token: true, stage: 'building' }, BRETT);
ok(r.status === 400 && /test_as_token/.test(r.body.error), 'route: the staging test switch is an unknown field for real callers');
r = await call({ id: '9', test_as_token: true, stage: 'approved' }, STG);
ok(r.status === 403, 'route: on staging the switch makes the test token act as a build session');
// GATED + GitHub
S.gh['/pulls/571'] = { number: 571, state: 'open', merged: false, merged_at: null };
r = await call({ id: '8', stage: 'live' }, BRETT);
ok(r.status === 409 && /PR #571 is not merged/.test(r.body.error) && S.rows[1].Stage === 'pr_open', 'route: GATED row is not marked live while GitHub says the PR is open');
S.gh['/pulls/571'] = new Error('GitHub /pulls/571 → HTTP 403');
r = await call({ id: '8', stage: 'live' }, BRETT);
ok(r.status === 503 && /NOT marked live/.test(r.body.error) && S.rows[1].Stage === 'pr_open', 'route: GATED row is not marked live when GitHub cannot be read');
S.gh['/pulls/571'] = { number: 571, state: 'closed', merged: true, merged_at: iso(10 * 60000) };
r = await call({ id: '8', stage: 'merged' }, BUILD);
ok(r.status === 200 && S.rows[1].Stage === 'merged' && S.rows[1].Build_State === 'live' && S.rows[1].Status === 'done', 'route: with a PR GitHub confirms as merged the row is marked merged');
// bulk
reset([row({ ID: '1', Status: 'greenlit', Risk_Class: 'GATED' }), row({ ID: '2', Status: 'greenlit', Risk_Class: 'GATED' }), row({ ID: '3', Status: 'done', Build_State: 'pr_open', Risk_Class: 'GATED' })]);
r = await call({ ids: ['1', '2', '77'], risk_class: 'SAFE', pinned: true }, BRETT);
ok(r.status === 200 && r.body.bulk === true && r.body.ok === false && r.body.saved === 2 && r.body.failed === 1, 'bulk: good rows are saved, the bad id is reported, nothing is silent');
ok(S.rows[0].Risk_Class === 'SAFE' && S.rows[1].Pinned === 'TRUE' && r.body.results[2].id === '77' && r.body.results[2].status === 404, 'bulk: per-row results in request order');
ok(S.gets === 2 && S.posts === 1, 'bulk: still 2 reads + 1 write for the whole batch');
r = await call({ ids: ['1', '2'], stage: 'dropped', reason: 'duplicate of #3' }, BRETT);
ok(r.body.ok === true && S.rows[0].Status === 'dropped' && S.rows[1].Drop_Reason === 'duplicate of #3', 'bulk: drop with a reason');
ok((await call({ ids: [], pinned: true }, BRETT)).status === 400 && (await call({ ids: ['1'], id: '1', pinned: true }, BRETT)).status === 400 && (await call({ ids: new Array(41).fill('1'), pinned: true }, BRETT)).status === 400, 'bulk: empty, mixed and over-size lists are refused');
// verification
reset([row({ ID: '1', Status: 'greenlit', Risk_Class: 'SAFE' })]);
S.failVerify = true;
r = await call({ id: '1', stage: 'queued' }, BRETT);
ok(r.status === 200 && r.body.ok === true && r.body.confirmed === false && /check read was refused/.test(r.body.warnings.join(' ')) && S.rows[0].Stage === 'queued' && S.posts === 1, 'quota on the re-read: "saved, not confirmed", never a second write');
reset([row({ ID: '1', Status: 'greenlit', Risk_Class: 'SAFE' })]);
S.loseWrite = true;
r = await call({ id: '1', stage: 'queued' }, BRETT);
ok(r.status === 500 && r.body.ok === false && /did not stick/.test(r.body.error) && S.fails.length === 1 && S.fails[0].where === 'queue_stage_write_lost', 'a write that does not read back is an error and files a failure row');
reset([row({ ID: '1', Status: 'greenlit', Risk_Class: 'SAFE', Stage: 'approved', Stage_Updated: iso(H), Stage_By: 'Brett' })]);
r = await call({ id: '1', stage: 'approved' }, BRETT);
ok(r.status === 200 && r.body.noop === true && S.posts === 0, 'route: a no-change request writes nothing');

// actor
const envT = { HUB_PROD_WRITE_TOKEN: 'w', OPS_QUEUE_TOKEN: 'q', HUB_TEST_TOKEN: 't' };
eq(L.queueActorOf(envT, 'w'), { name: 'build session', admin: false }, 'broker write token = build session, not admin');
eq(L.queueActorOf(envT, 'q'), { name: 'queue token', admin: false }, 'queue token is not admin');
ok(L.queueActorOf(envT, 't').stagingTest === true && L.queueActorOf(envT, 'secret').admin === true && L.queueActorOf({}, '').name === 'Brett', 'staging test token is flagged; anything else the gate let through is the admin');
ok(L.queueActorOf({ HUB_PROD_WRITE_TOKEN: '' }, '').admin === true && L.queueActorOf({ OPS_QUEUE_TOKEN: undefined }, 'undefined').admin === true, 'an unset token never matches a blank header');

// ── 5. risk guard ───────────────────────────────────────────────────────────────────────────
const g = (inp) => L.queueRiskGuard(inp);
let v = g({ files: ['proposals.html', 'context/notes/20261116-x.md'], label: 'SAFE' });
ok(v.risk === 'SAFE' && v.forced === false && v.reasons.length === 0, 'harmless files + SAFE label -> SAFE');
v = g({ files: ['proposals.html'], label: 'GATED' });
ok(v.risk === 'GATED' && v.forced === false, 'a GATED label stays GATED (the guard never loosens)');
ok(g({ files: ['proposals.html'] }).risk === 'GATED', 'no label at all is GATED');
for (const [files, key] of [[['qb-email-backfill.html'], 'quickbooks'], [['signed-proposals.html'], 'money'], [['ar-report.html'], 'money'], [['test-login.js'], 'auth'], [['wrangler.toml'], 'auth'], [['.github/workflows/sync-staging.yml'], 'auth'], [['message-queue.html'], 'sms'], [['tenant-roster.js'], 'contacts'], [['importer.html'], 'contacts']]) {
  v = g({ files, label: 'SAFE' });
  ok(v.risk === 'GATED' && v.forced === true && v.reasons[0].rule === key && v.reason.length > 10, 'path ' + files[0] + ' is forced GATED (' + key + ') over a SAFE label, with a reason');
}
const patch = (lines) => '@@ -1,3 +1,4 @@\n context line\n' + lines.join('\n') + '\n another context line';
for (const [line, key] of [['+  const r = await qbFetch(env, url);', 'quickbooks'], ['+  const total = money2(subtotal * 1.1);', 'money'], ['-  if (invoice.Balance > 0) return;', 'money'], ['+  if (_tok === env.WORKER_SECRET) ok = true;', 'auth'],
  ['+const HUB_PROD_WRITE_PATHS = [\'/x\'];', 'auth'], ['+  const s = await verifySessionToken(tok, secret);', 'auth'], ['+  if (pin === row.PIN) return row;', 'auth'], ['+  await sendSMS(env, to, body);', 'sms'], ['+  await smsGatedSend(env, x);', 'sms'],
  ['+  updates.Phone = normalizePhone(v);', 'contacts'], ['+  row.Email = body.email;', 'contacts'], ['+  await updateRow(env, \'Tenants\', id, { tenant_phone: p });', 'contacts']]) {
  v = g({ files: [{ filename: 'worker.js', patch: patch([line]) }], label: 'SAFE' });
  ok(v.risk === 'GATED' && v.forced && v.reasons.some(x => x.rule === key), 'changed line "' + line.slice(0, 40) + '" is forced GATED (' + key + ')');
}
v = g({ files: [{ filename: 'worker.js', patch: '@@ -1,3 +1,4 @@\n   await sendSMS(env, to, body);\n   const s = verifySessionToken(t);\n+  const label = "Trade";\n   total = money2(x);' }], label: 'SAFE' });
ok(v.risk === 'SAFE' && !v.forced, 'risky words on UNCHANGED context lines do not count; only + / - lines do');
v = g({ diff: 'diff --git a/worker.js b/worker.js\n--- a/worker.js\n+++ b/worker.js\n@@\n+  await qbCreateInvoice(env, x);', label: 'SAFE' });
ok(v.risk === 'GATED' && v.forced, 'a raw diff is read too');
ok(g({ diff: 'this is not a diff but it says sendSMS(', label: 'SAFE' }).risk === 'GATED', 'text that is not a diff is read whole, never skipped');
v = g({ label: 'SAFE' });
ok(v.risk === 'GATED' && v.forced && v.reasons[0].rule === 'empty', 'nothing to read is GATED (fail-closed)');
v = g({ files: [{ filename: 'worker.js', patch: '', patch_missing: true }], label: 'SAFE' });
ok(v.risk === 'GATED' && v.reasons.some(x => x.rule === 'unreadable'), 'a code file whose diff GitHub left out is GATED');
ok(g({ files: ['a.html'], truncated: true, label: 'SAFE' }).risk === 'GATED', 'a cut-off file list is GATED');
// wording
ok(L.queueRiskGuardText('Show the vendor trade on the job card').hit === false, 'harmless wording does not hit');
for (const t of ['Fix the QuickBooks sync', 'Wrong invoice total', 'Let owners pay a deposit', 'Reset a tenant PIN', 'Change the login screen', 'Send an SMS when the job is done', 'Text the vendor', 'Update the owner phone number', 'Edit vendor contact details']) ok(L.queueRiskGuardText(t).hit === true, 'wording "' + t + '" hits the guard');
eq(L.queueResolveRisk('SAFE', { title: 'Wrong invoice total' }).risk, 'SAFE', 'an explicit SAFE is kept (the file check is the hard gate)');
eq(L.queueResolveRisk('AUTO', { title: 'Wrong invoice total' }).risk, 'GATED', 'AUTO + risky wording -> GATED');
eq(L.queueResolveRisk('AUTO', { Title: 'Wider cards on the proposals page', Problem: 'Cards are narrow' }).risk, 'SAFE', 'AUTO + harmless wording -> SAFE');
eq([L.queueResolveRisk('', {}).risk, L.queueResolveRisk('safe-ish', {}).risk, L.queueResolveRisk(undefined, {}).risk, L.queueResolveRisk('GATED', {}).risk], ['GATED', 'GATED', 'GATED', 'GATED'], 'anything that is not exactly SAFE or AUTO is GATED');
ok(/queueResolveRisk\(it\.risk_class \|\| it\.riskClass, it\)\.risk/.test(grab('opsApprove')), 'opsApprove uses the same resolver (AUTO from the weekly review list)');
// endpoint
reset([]);
S.gh['/pulls/600/files?per_page=100&page=1'] = [{ filename: 'proposals.html', changes: 10, patch: '@@\n+<div>hello</div>' }, { filename: 'context/notes/x.md', changes: 3, patch: '@@\n+note' }];
r = await L.opsQueueRiskCheck({}, { pr_number: 600, label: 'SAFE' });
ok(r.status === 200 && r.body.ok && r.body.risk === 'SAFE' && r.body.files_checked === 2 && S.posts === 0 && S.gets === 0, 'risk-check: a harmless PR is SAFE, and the route reads/writes no sheet');
S.gh['/pulls/601/files?per_page=100&page=1'] = [{ filename: 'worker.js', changes: 4, patch: '@@\n+const HUB_PROD_WRITE_PATHS = [];' }];
r = await L.opsQueueRiskCheck({}, { pr_number: 601, label: 'SAFE' });
ok(r.body.risk === 'GATED' && r.body.forced === true && /sign-in, PIN, session or token/.test(r.body.reason), 'risk-check: a PR touching the write allow-list is forced GATED (this very build)');
S.gh['/pulls/602/files?per_page=100&page=1'] = [{ filename: 'worker.js', changes: 9000 }];
r = await L.opsQueueRiskCheck({}, { pr_number: 602, label: 'SAFE' });
ok(r.body.risk === 'GATED' && r.body.reasons.some(x => x.rule === 'unreadable'), 'risk-check: worker.js with no readable diff is GATED');
r = await L.opsQueueRiskCheck({}, { pr_number: 603, label: 'SAFE' });
ok(r.status === 503 && r.body.ok === false && r.body.risk === 'GATED' && /treated as GATED/.test(r.body.error), 'risk-check: if GitHub cannot be read the answer is GATED, not a guess');
r = await L.opsQueueRiskCheck({}, { files: ['proposals.html'], label: 'SAFE', title: 'Fix invoice totals' });
ok(r.body.risk === 'SAFE' && r.body.text_check.hit === true, 'risk-check: files can be passed directly; wording is reported separately');
ok((await L.opsQueueRiskCheck({}, { pr: 5 })).status === 400 && (await L.opsQueueRiskCheck({}, { pr_number: 'x' })).status === 400, 'risk-check: unknown fields and bad PR numbers are refused');

// ── 6. sync + deploy check ──────────────────────────────────────────────────────────────────
ok(L.matchPrToItem([{ number: 1, title: 'Wider cards (queue #12)', body: '' }], '12') && !L.matchPrToItem([{ number: 1, title: 'Wider cards (queue #123)', body: '' }], '12'), '"queue #12" in a PR title matches item 12 and not 123');
ok(L.matchPrToItem([{ number: 1, title: 'x', body: 'Ops queue item #12' }], '12') && L.matchPrToItem([{ number: 1, title: 'x', body: 'queue row #12' }], '12'), 'the older "Ops queue item #N" wording still matches');
ok(!L.matchPrToItem([{ number: 1, title: 'queue 12 things', body: 'ops queue: process build, no queue row' }], '12'), 'a PR that names no queue row matches nothing');
const sync = (body, opts) => L.opsQueueSync({}, body || {}, opts || { ignoreSuppliedPrs: true });
// building -> pr_open -> merged -> live
reset([row({ ID: '12', Status: 'building', Build_State: 'building', Risk_Class: 'SAFE', Stage: 'building', Stage_Updated: iso(2 * H) })]);
S.gh['/pulls?state=all&sort=created&direction=desc&per_page=60'] = [{ number: 580, state: 'open', title: 'Trade on job card (queue #12)', body: '' }];
S.gh['/pulls/580'] = { number: 580, state: 'open', merged: false, merged_at: null };
r = await sync();
ok(r.body.ok && S.rows[0].Stage === 'pr_open' && S.rows[0].PR_Number === '580' && S.rows[0].Build_State === 'pr_open' && S.rows[0].Stage_By === 'sync', 'sync: a PR found by "queue #12" moves the row to pr_open');
const mergedAt = iso(10 * 60000);
S.gh['/pulls/580'] = { number: 580, state: 'closed', merged: true, merged_at: mergedAt };
S.version = { stamped: true, deployed_at: iso(3 * H), version_id: 'abcdef123456' };
r = await sync();
ok(S.rows[0].Stage === 'merged' && S.rows[0].Stage_Updated === mergedAt && S.rows[0].Status === 'done' && S.rows[0].Build_State === 'live', 'sync: a merged PR moves the row to merged, stamped with the real merge time');
ok(S.fails.length === 0 && r.body.deploy_missing.length === 0, 'sync: 10 minutes after the merge with no deploy yet is NOT a failure');
S.rows[0].Stage_Updated = iso(45 * 60000);
r = await sync();
ok(S.rows[0].Stage === 'merged' && S.fails.length === 1 && S.fails[0].where === 'queue_deploy_missing' && S.fails[0].ref === 'queue#12' && /PR #580/.test(S.fails[0].message) && r.body.deploy_missing.length === 1, 'sync: merged 45 minutes ago with no newer deploy files a failure-ledger row');
ok(S.rows[0].Stage_Log.includes(L.QUEUE_DEPLOY_MARK), 'sync: the row notes that it was reported');
r = await sync();
ok(S.fails.length === 1 && r.body.deploy_missing[0].already_reported === true && r.body.ok === true, 'sync: the next tick does not file it again');
ok(S.ghCalls.filter(x => x === '/pulls/580').length === 2, 'sync: a merged row costs no further GitHub calls');
S.version = { stamped: true, deployed_at: iso(60000), version_id: 'fedcba654321' };
r = await sync();
ok(S.rows[0].Stage === 'live' && S.rows[0].Status === 'done' && S.rows[0].Build_State === 'live' && /merged -> live/.test(S.rows[0].Stage_Log) && r.body.changed.some(c => c.stage === 'live'), 'sync: once /version shows a deploy newer than the merge the row is live');
r = await sync();
ok(r.body.checked === 0 && r.body.changed.length === 0, 'sync: a live row is finished and is not checked again');
// merged and deployed in one pass; unstamped version
reset([row({ ID: '55', Status: 'building', Build_State: 'building', PR_Number: '540', Build_Updated: iso(200 * H) })]);
S.gh['/pulls/540'] = { number: 540, state: 'closed', merged: true, merged_at: iso(150 * H) };
S.version = { stamped: true, deployed_at: iso(3 * H), version_id: 'abc' };
r = await sync();
ok(S.rows[0].Stage === 'live' && S.rows[0].Status === 'done' && S.fails.length === 0, 'sync: an old row still "building" after its PR merged (the row #55 case) goes straight to live');
reset([row({ ID: '1', Status: 'done', Build_State: 'live', PR_Number: '9', Stage: 'merged', Stage_Updated: iso(2 * H) })]);
r = await sync();
ok(S.fails.length === 1 && /unstamped/.test(S.fails[0].message), 'sync: an unstamped Worker version cannot confirm a deploy, and says so in the failure row');
ok(L.queueDeployVerdict({ Stage_Updated: iso(5 * 60000) }, { stamped: true, deployed_at: iso(60 * 60000) }, NOW).state === 'wait', 'deploy verdict: inside 30 minutes = wait');
ok(L.queueDeployVerdict({ Stage_Updated: iso(31 * 60000) }, { stamped: true, deployed_at: iso(60 * 60000) }, NOW).state === 'report', 'deploy verdict: after 30 minutes with an older deploy = report');
ok(L.queueDeployVerdict({ Stage_Updated: iso(31 * 60000) }, { stamped: true, deployed_at: iso(60000) }, NOW).state === 'live', 'deploy verdict: newer deploy = live');
// closed without merging
reset([row({ ID: '3', Status: 'done', Build_State: 'pr_open', PR_Number: '30', Stage: 'pr_open', Stage_Updated: iso(H) })]);
S.gh['/pulls/30'] = { number: 30, state: 'closed', merged: false, merged_at: null };
r = await sync();
ok(S.rows[0].Stage === 'blocked' && S.rows[0].Blocked_On === 'brett' && /closed without merging/.test(S.rows[0].Blocked_Reason) && S.rows[0].Build_State === 'pr_closed' && L.queueStageOf(S.rows[0], NOW) === 'blocked', 'sync: a PR closed without merging is blocked on Brett (never auto-dropped)');
// blocked row whose PR Brett merged anyway
reset([row({ ID: '4', Status: 'held', Build_State: 'held', PR_Number: '40', Stage: 'blocked', Blocked_On: 'brett', Blocked_Reason: 'needs a look' })]);
S.gh['/pulls/40'] = { number: 40, state: 'closed', merged: true, merged_at: iso(5 * 60000) };
r = await sync();
ok(S.rows[0].Stage === 'merged' && S.rows[0].Status === 'done', 'sync: a blocked row whose PR was merged anyway moves to merged');
// rate limit: tick vs daily
reset([row({ ID: '5', Status: 'building', Build_State: 'pr_open', PR_Number: '50', Stage: 'pr_open', Stage_Updated: iso(H) })]);
S.gh['/pulls/50'] = new Error('GitHub /pulls/50 → HTTP 403 (GitHub rate-limits the Hub\'s shared address)');
r = await sync({}, { ignoreSuppliedPrs: true, tick: true, max: 12 });
ok(r.body.ok === true && r.body.errors.length === 0 && r.body.rate_limited.length === 1 && S.ensureTab === 0, 'tick sync: a GitHub rate limit is reported as rate_limited and retried next tick (and the tick skips ensureTab)');
r = await sync();
ok(r.body.ok === false && r.body.errors.length === 1, 'daily sync: the same rate limit is still a loud error');
S.gh['/pulls/50'] = new Error('GitHub /pulls/50 → HTTP 500');
r = await sync({}, { ignoreSuppliedPrs: true, tick: true });
ok(r.body.ok === false && r.body.errors.length === 1, 'tick sync: any other GitHub failure is still an error');
// cap + stuck
reset(Array.from({ length: 15 }, (_, i) => row({ ID: String(100 + i), Status: 'building', Build_State: 'pr_open', PR_Number: String(700 + i), Stage: 'pr_open', Stage_Updated: iso((i === 0 ? 80 : 1) * H) })));
for (let i = 0; i < 15; i++) S.gh['/pulls/' + (700 + i)] = { number: 700 + i, state: 'open', merged: false };
r = await sync({}, { ignoreSuppliedPrs: true, tick: true, max: 12 });
ok(r.body.checked === 12 && r.body.remaining === 3, 'tick sync: at most 12 rows a tick, and it says how many are left');
eq(r.body.stuck, [{ id: '100', stage: 'pr_open', hours: 80 }], 'sync reports stuck rows');
// TEST- prefix scoping (staging)
reset([row({ ID: '1', Title: 'Real row', Status: 'building', Build_State: 'pr_open', PR_Number: '60' }), row({ ID: '2', Title: 'TEST-row', Status: 'building', Build_State: 'pr_open', PR_Number: '61' })]);
S.gh['/pulls/61'] = { number: 61, state: 'open', merged: false };
r = await sync({ title_prefix: 'TEST-' });
ok(r.body.checked === 1 && !S.ghCalls.includes('/pulls/60'), 'sync with title_prefix only touches TEST- rows');
// job wrapper
reset([row({ ID: '5', Status: 'building', Build_State: 'pr_open', PR_Number: '50', Stage: 'pr_open', Stage_Updated: iso(H) })]);
S.gh['/pulls/50'] = new Error('GitHub /pulls/50 → HTTP 429');
let j = await L.schedRunQueueSync({});
ok(j.ok === true && j.errors.length === 0 && j.detail.rate_limited === 1 && j.detail.checked === 1, 'job queue_sync returns {ok, errors} and stays green on a rate limit');
S.gh['/pulls/50'] = new Error('GitHub /pulls/50 → HTTP 500');
j = await L.schedRunQueueSync({});
ok(j.ok === false && j.errors.length === 1, 'job queue_sync fails loudly on a real error');

// ── 7. GET /ops-queue carries stage + stuck ─────────────────────────────────────────────────
reset([row({ ID: '1', Status: 'building', Build_State: 'building', Build_Updated: iso(30 * H) }), row({ ID: '2', Status: 'greenlit', Stage: 'queued' }), row({ ID: '3', Status: 'done', Build_State: 'live' })]);
r = await L.opsQueueRead({}, { searchParams: new URLSearchParams('all=1') });
const byId = Object.fromEntries(r.body.queue.map(x => [x.ID, x]));
ok(byId['1'].stage === 'building' && byId['1'].stuck === true && byId['1'].stage_hours === 30 && byId['2'].stage === 'queued' && byId['3'].stage === 'live' && byId['3'].stuck === false, 'GET /ops-queue?all=1 returns stage, stuck and hours for every row');
ok(S.posts === 0 && !S.rows[0].Stage, 'reading never back-fills the sheet');
r = await L.opsQueueRead({}, { searchParams: new URLSearchParams('') });
ok(r.body.queue.length === 2 && r.body.queue.every(x => typeof x.stage === 'string'), 'the active list (Prepare agent / build runner) carries stage too');

// ── 8. proposals.html pins ──────────────────────────────────────────────────────────────────
const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
ok(!/max-width:\s*560px/.test(page), 'page: the fixed 560px phone column is gone');
ok(/@media \(min-width:700px\)/.test(css) && /@media \(min-width:1101px\)/.test(css), 'page: two-column and board breakpoints exist');
ok(!/\.chip\{[^}]*white-space:\s*nowrap/.test(css) && /\.chips\{[^}]*flex-wrap:wrap/.test(css), 'page: chips wrap');
ok(/<option value="AUTO" selected>Decide for me<\/option>/.test(page) && !/<option value="GATED" selected>/.test(page), 'page: Approve defaults to "Decide for me", never GATED');
ok(!/start-build|startBuild|ROUTINE_|buildGo/.test(page), 'page: the Start Build / routine flow is removed');
ok(/'\/ops-queue-stage'/.test(page) && /Queued for the next build run/.test(page), 'page: writes go to the report-back route; Build now says it is queued');
ok(/q&&q\.truncated\) toast\(/.test(page), 'page: still warns when the queue list is cut off');
const sizes = [...page.matchAll(/font(?:-size)?:[^;"}]*?(\d+(?:\.\d+)?)px/g)].map(m => parseFloat(m[1]));
ok(sizes.length > 10 && Math.min(...sizes) >= 13, 'page: no text under 13px (smallest is ' + Math.min(...sizes) + 'px)');
ok(!/anthropic|api\.claude/i.test(page), 'page: calls no Claude API');
for (const label of ['Build now', 'Retry', 'Open PR', 'Mark live', 'Unblock', 'Back to review', 'Snooze', 'Drop', 'Pin to top']) ok(page.includes(label), 'page: has the "' + label + '" control');
for (const f of ['fStage', 'fRisk', 'fTag', 'fMine', 'fStuck', 'qsearch']) ok(page.includes('id="' + f + '"'), 'page: filter ' + f + ' exists');
ok(!/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(page.slice(page.indexOf('<script>'))) , 'page: no empty catch blocks in the page script');

console.log('queue-v2: ' + n + '/' + n + ' passing');
