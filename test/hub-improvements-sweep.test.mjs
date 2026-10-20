// RidgeCo Hub Improvements sweep (Oct 14 2026): Mon/Thu Hub-scheduler job that pulls new items from Brett's
// "RidgeCo Hub Improvements" Google Tasks list into the Optimizer queue (as proposed), a ledger tab that remembers
// each one, and a reconcile that marks them done once the queue item / PR is built. Pulls the REAL functions out of
// worker.js and runs them against in-memory fake sheets.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

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
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const QCOLS = new Function('return ' + grabConst('OPS_QUEUE_COLS').replace(/^const OPS_QUEUE_COLS = /, '').replace(/;$/, ''))();
const HCOLS = new Function('return ' + grabConst('HUBIMP_COLS').replace(/^const HUBIMP_COLS = /, '').replace(/;$/, ''))();
ok(QCOLS.includes('Source_Task_ID'), 'Ops_Build_Queue gained Source_Task_ID (additive)');
ok(['Task_ID', 'Status', 'Queue_ID', 'PR', 'Applied_Status', 'Apply_Error', 'Status_Changed_At'].every(c => HCOLS.includes(c)), 'ledger columns');

// ── fake sheets ──────────────────────────────────────────────────────────────────────────────
const TABS = { Ops_Build_Queue: [], Hub_Improvements: [] };
let TASKS = [];          // BrettOS Tasks_Sync rows (objects)
let PR = {};             // PR number -> github pull object
let SUBMIT_FAIL = false;
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
const TASK_HDR = ['Task_ID', 'Title', 'Notes', 'Category', 'Status', 'Due_Date', 'Updated', 'List_ID'];
let APPLIED = null;      // BrettOS Hub_Applied rows (objects) or null = tab missing
const APP_HDR = ['Task_ID', 'Applied_Status', 'Applied_At', 'Error', 'Title'];
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/spreadsheets/BRETTOS/values/Tasks_Sync')) return { json: async () => ({ values: [TASK_HDR, ...TASKS.map(t => TASK_HDR.map(h => t[h] === undefined ? '' : t[h]))] }) };
  if (u.includes('/spreadsheets/BRETTOS/values/Hub_Applied')) {
    if (APPLIED === null) return { json: async () => ({ error: { message: 'Unable to parse range: Hub_Applied' } }) };
    return { json: async () => ({ values: [APP_HDR, ...APPLIED.map(a => APP_HDR.map(h => a[h] === undefined ? '' : a[h]))] }) };
  }
  throw new Error('unexpected fetch ' + url);
};
const helpers = {
  softFail: async () => ({ ok: false }), softNote: () => true,   // Phase C helpers (reporting only)
  json,
  getAccessToken: async () => 'tok',
  ensureTab: async () => {}, ensureColumns: async () => {},
  isMissingTabError: () => false,
  fetchTab: async (_e, tab) => TABS[tab].map(r => Object.assign({}, r)),
  sheetsRequest: async (_e, _m, path) => {
    const tab = path.replace('/values/', '');
    const cols = tab === 'Ops_Build_Queue' ? QCOLS : HCOLS;
    return { values: [cols, ...TABS[tab].map(r => cols.map(c => r[c] === undefined ? '' : String(r[c])))] };
  },
  addRow: async (_e, tab, o) => {
    if (tab === 'Hub_Improvements' && globalThis.__ledgerAddFails) return json({ error: 'boom' }, 500);
    const id = String(TABS[tab].reduce((m, r) => Math.max(m, parseInt(r.ID || '0')), 0) + 1);
    TABS[tab].push(Object.assign({}, o, { ID: id })); return json({ success: true, id });
  },
  updateRow: async (_e, tab, id, f) => {
    const r = TABS[tab].find(x => String(x.ID) === String(id)); if (!r) return json({ error: 'Row not found' }, 404);
    Object.assign(r, f); return json({ success: true });
  },
  ghPublicJson: async (path) => { const m = /\/pulls\/(\d+)/.exec(path); if (!m || !PR[m[1]]) throw new Error('GitHub ' + path + ' -> HTTP 404'); return PR[m[1]]; },
  opsQueueSyncStub: null,
};
const code = [grabConst('QUEUE_STOPWORDS')].join('\n') + '\n' + [
  'queueTokens', 'queueDice', 'queueSimilarity', 'findQueueMatch', 'buildShippedIndex', 'findShippedMatch', 'prStateToBuildState', 'cleanPrNumber',
  'validateScoutSubmitItems', 'buildScoutQueueRow', 'opsQueueScoutSubmit',
  'hubImpObjs', 'hubImpPickNew', 'hubImpQueueItem', 'hubImpPlan', 'hubImpUpdate', 'hubImpAdd', 'hubImpReadBrettos', 'hubImpReadTasks', 'hubImpReadApplied', 'hubImpPull', 'hubImpReconcile',
  'schedErrText', 'schedUnwrap', 'schedBadness', 'schedStep', 'schedRunHubImprovements',
].map(grab).join('\n') + '\n' + ['HUBIMP_TAB', 'HUBIMP_LIST', 'HUBIMP_COLS', 'HUBIMP_APPLY_STALE_MS', 'HUBIMP_ACTIVE', 'HUBIMP_TRACKED', 'HUBIMP_REVIEW_KINDS'].map(grabConst).join('\n') + `
const OPS_QUEUE_TAB = 'Ops_Build_Queue', OPS_REVIEW_TAB = 'Ops_Review_Log', OPS_REVIEW_COLS = [];
const OPS_QUEUE_COLS = __QCOLS;
async function getShippedIndex() { return globalThis.__shipped; }
async function opsQueueSync(env, body, opts) { return json({ ok: true, checked: 0, changed: [], errors: globalThis.__syncErrors || [] }); }
return { hubImpPickNew, hubImpQueueItem, hubImpPlan, hubImpPull, hubImpReconcile, schedRunHubImprovements, opsQueueScoutSubmit };`;
const L = new Function('__QCOLS', ...Object.keys(helpers), code)(QCOLS, ...Object.values(helpers));
const env = { BRETTOS_TASKS_SHEET_ID: 'BRETTOS' };
globalThis.__shipped = { ok: true, index: [] };
const LIST = 'RidgeCo Hub Improvements';
const T = (id, title, over) => Object.assign({ Task_ID: id, Title: title, Notes: '', Category: LIST, Status: 'needsAction', List_ID: 'LST' }, over || {});

// ── pure: pick / shape ──────────────────────────────────────────────────────────────────────
{
  const tasks = [T('a', 'Alpha item'), T('b', 'Beta done', { Status: 'completed' }), T('c', 'Other list', { Category: 'Admin' }), T('d', 'Delta in ledger'), T('e', 'Echo in queue'), T('f', '  ')];
  const r = L.hubImpPickNew(tasks, [{ Task_ID: 'd' }], [{ ID: '9', Source_Task_ID: 'e' }]);
  eq(r.fresh.map(x => x.Task_ID), ['a'], 'only new open items of the list');
  eq(r.adopt.map(x => x.task.Task_ID + ':' + x.queue.ID), ['e:9'], 'already-queued items are adopted, never queued twice');
  const it = L.hubImpQueueItem(T('z', 'Fix thing', { Notes: 'some note' }));
  ok(it.title === 'Fix thing' && /some note/.test(it.problem) && it.source_task_id === 'z' && /may already be built/.test(it.first_step), 'queue item shape');
}

// ── pure: plan ──────────────────────────────────────────────────────────────────────────────
{
  const now = Date.parse('2026-10-15T12:00:00Z');
  const L1 = [
    { ID: '1', Title: 'q done', Status: 'pulled', Queue_ID: '10', Queue_Status: 'proposed' },
    { ID: '2', Title: 'q dropped', Status: 'pulled', Queue_ID: '11', Queue_Status: 'proposed' },
    { ID: '3', Title: 'q open', Status: 'pulled', Queue_ID: '12', Queue_Status: 'proposed' },
    { ID: '4', Title: 'q gone', Status: 'pulled', Queue_ID: '13' },
    { ID: '5', Title: 'pr merged', Status: 'building', PR: '262' },
    { ID: '6', Title: 'pr closed', Status: 'building', PR: '300' },
    { ID: '7', Title: 'pr err', Status: 'building', PR: '301' },
    { ID: '8', Title: 'nothing to watch', Status: 'building' },
    { ID: '9', Title: 'final', Status: 'done', Applied_Status: 'done' },
  ];
  const Q = [{ ID: '10', Status: 'done', PR_Number: '250', Build_State: 'live' }, { ID: '11', Status: 'dropped', Drop_Reason: 'not needed' }, { ID: '12', Status: 'greenlit' }];
  const p = L.hubImpPlan(L1, Q, { '262': 'live', '300': 'pr_closed', '301': 'error: HTTP 403' }, now);
  const u = Object.fromEntries(p.updates.map(x => [x.id, x.fields]));
  ok(u['1'].Status === 'done' && u['1'].PR === '250' && /PR #250/.test(u['1'].Note), 'queue item done AND live -> ledger done with its PR');
  ok(u['2'].Status === 'dropped' && /not needed/.test(u['2'].Note), 'queue item dropped -> ledger dropped (task stays open, noted)');
  eq(u['3'], { Queue_Status: 'greenlit' }, 'queue status mirrored, ledger stays pulled');
  ok(u['5'].Status === 'done', 'merged PR -> done');
  ok(!u['9'], 'done rows are final');
  const t = p.problems.join('\n');
  ok(/#4.*no longer exists/.test(t), 'missing queue item reported');
  ok(/#6.*closed without merging/.test(t), 'closed PR reported');
  ok(/#7.*could not check PR #301/.test(t), 'PR lookup failure reported');
  ok(/#8.*neither a queue item nor a PR/.test(t), 'unwatchable row reported');
  // applier staleness
  const S = (over) => L.hubImpPlan([Object.assign({ ID: '1', Title: 'x', Status: 'done', Status_Changed_At: '2026-10-14T00:00:00Z', Applied_Status: '' }, over)], [], {}, now).problems;
  ok(S().length === 1 && /over 24h/.test(S()[0]), 'unapplied for >24h is reported');
  eq(S({ Status_Changed_At: '2026-10-15T00:00:00Z' }), [], 'fresh change is not yet a problem');
  eq(S({ Applied_Status: 'done' }), [], 'applied is fine');
  ok(/failed: nope/.test(S({ Apply_Error: 'nope', Applied_Status: 'done' })[0]), 'applier error surfaced');
}

// ── pull: end to end ────────────────────────────────────────────────────────────────────────
{
  TABS.Ops_Build_Queue = [{ ID: '1', Title: 'Collapse cancelled paid and invoiced work orders on unassigned filter', Problem: 'collapse cancelled paid invoiced work orders unassigned filter', First_Step: 'collapse the closed out work orders on the unassigned filter', Status: 'done', PR_Number: '261' }];
  TABS.Hub_Improvements = [];
  TASKS = [
    T('t1', 'Add a vendor language badge to the work order card'),
    T('t2', 'Collapse cancelled paid and invoiced work orders on unassigned filter', { Notes: 'collapse cancelled paid invoiced work orders unassigned filter' }),
    T('t3', 'Some other list task', { Category: 'Admin' }),
    T('t4', 'Already completed', { Status: 'completed' }),
  ];
  globalThis.__shipped = { ok: true, index: [] };
  const r = await L.hubImpPull(env);
  eq(r.new, 2, 'two new items'); eq(r.queued.length, 1, 'one queued'); eq(r.skipped_duplicates.length, 1, 'one near-verbatim duplicate of a built queue item');
  const q = TABS.Ops_Build_Queue.find(x => x.Source_Task_ID === 't1');
  ok(q && q.Status === 'proposed' && q.Approved_By === 'hub-improvements-sweep' && q.Risk_Class === '', 'queued as proposed with the task id, never greenlit');
  const led = Object.fromEntries(TABS.Hub_Improvements.map(x => [x.Task_ID, x]));
  ok(led.t1.Status === 'pulled' && led.t1.Queue_ID === q.ID && led.t1.Queue_Status === 'proposed', 'ledger row for the queued item');
  ok(led.t2.Status === 'pulled' && led.t2.Queue_ID === '1' && /Same as existing queue item #1 \(done\)/.test(led.t2.Note), 'duplicate of a built item links to it');
  ok(!led.t3 && !led.t4, 'other lists / completed tasks ignored');
  // idempotent: second sweep does nothing
  const before = TABS.Ops_Build_Queue.length, lb = TABS.Hub_Improvements.length;
  const r2 = await L.hubImpPull(env);
  ok(r2.new === 0 && TABS.Ops_Build_Queue.length === before && TABS.Hub_Improvements.length === lb, 'second sweep adds nothing');
  // reconcile: t2 duplicates an already-built item -> flagged for review, NEVER auto-completed; t1 stays pulled
  const rec = await L.hubImpReconcile(env);
  const led2 = Object.fromEntries(TABS.Hub_Improvements.map(x => [x.Task_ID, x]));
  ok(led2.t2.Link_Kind === 'duplicate', 'duplicate link is recorded as such');
  ok(led2.t2.Status === 'pulled', 'duplicate of a built item is not auto-completed');
  ok(led2.t1.Status === 'pulled', 'unbuilt item stays pulled');
  eq(rec.completed_now.length, 0, 'nothing auto-completed');
  // queue row built later: PR opened (done, pr_open) -> building; merged (live) -> done
  const q1 = TABS.Ops_Build_Queue.find(x => x.Source_Task_ID === 't1'); q1.Status = 'done'; q1.PR_Number = '270'; q1.Build_State = 'pr_open';
  await L.hubImpReconcile(env);
  ok(TABS.Hub_Improvements.find(x => x.Task_ID === 't1').Status === 'building', 'PR open: building, not done');
  q1.Build_State = 'live';
  await L.hubImpReconcile(env);
  ok(TABS.Hub_Improvements.find(x => x.Task_ID === 't1').Status === 'done' && TABS.Hub_Improvements.find(x => x.Task_ID === 't1').PR === '270', 'done once the PR is live');
}

// ── pull: crash recovery (queued but ledger write failed) ───────────────────────────────────
{
  TABS.Ops_Build_Queue = []; TABS.Hub_Improvements = []; TASKS = [T('r1', 'Recover me later please')];
  globalThis.__ledgerAddFails = true;
  let threw = '';
  try { await L.hubImpPull(env); } catch (e) { threw = e.message; }
  globalThis.__ledgerAddFails = false;
  ok(/could not be saved/.test(threw), 'ledger write failure is thrown, not swallowed: ' + threw);
  eq(TABS.Ops_Build_Queue.length, 1, 'queue row exists');
  await L.hubImpPull(env);
  eq(TABS.Ops_Build_Queue.length, 1, 'retry does not queue a second copy');
  ok(TABS.Hub_Improvements.length === 1 && TABS.Hub_Improvements[0].Queue_ID === TABS.Ops_Build_Queue[0].ID, 'retry adopts the existing queue row');
}

// ── pull: possibly already built is flagged, never auto-completed ───────────────────────────
{
  TABS.Ops_Build_Queue = []; TABS.Hub_Improvements = []; TASKS = [T('s1', 'Gutter cleaning reminder schedule template for owners')];
  // build a real shipped index via the real helpers
  const idx = new Function(grab('queueTokens') + grabConst('QUEUE_STOPWORDS') + grab('buildShippedIndex') + 'return buildShippedIndex;')();
  globalThis.__shipped = { ok: true, index: idx('## [FL-1] shipped — gutter cleaning reminder schedule template\n') };
  const r = await L.hubImpPull(env);
  eq(r.possibly_already_built.length, 1, 'flagged in the job detail');
  ok(TABS.Hub_Improvements[0].Status === 'pulled' && /check before building/.test(TABS.Hub_Improvements[0].Note), 'ledger note warns; status is NOT done');
}

// ── reconcile: what the BrettOS applier reports is copied into the ledger ───────────────────
{
  TABS.Ops_Build_Queue = []; TASKS = [];
  TABS.Hub_Improvements = [{ ID: '1', Task_ID: 'k1', Title: 'x', Status: 'done', Status_Changed_At: '2026-10-14T00:00:00Z', Applied_Status: '' }, { ID: '2', Task_ID: 'k2', Title: 'y', Status: 'done', Status_Changed_At: '2026-10-14T00:00:00Z' }];
  APPLIED = [{ Task_ID: 'k1', Applied_Status: 'done', Applied_At: '2026-10-14T13:00:00Z', Error: '' }, { Task_ID: 'k2', Applied_Status: '', Applied_At: '', Error: 'Task not found' }];
  const rec = await L.hubImpReconcile(env);
  ok(TABS.Hub_Improvements[0].Applied_Status === 'done' && TABS.Hub_Improvements[0].Applied_At, 'applied status copied into the ledger');
  ok(TABS.Hub_Improvements[1].Apply_Error === 'Task not found' && rec.problems.some(p => /Task not found/.test(p)), 'applier error is copied and reported');
  ok(!rec.problems.some(p => /ledger #1/.test(p)), 'a task the applier finished is not a problem');
  APPLIED = null;           // tab missing: treated as "nothing applied yet", not as an error
  TABS.Hub_Improvements = [{ ID: '1', Task_ID: 'k1', Title: 'x', Status: 'pulled', Queue_ID: '5', Queue_Status: 'proposed', Status_Changed_At: new Date().toISOString() }]; TABS.Ops_Build_Queue = [{ ID: '5', Status: 'proposed' }];
  const rec2 = await L.hubImpReconcile(env);
  eq(rec2.problems, [], 'missing Hub_Applied tab is not an error while nothing is overdue');
  APPLIED = [];
}

// ── pull: loud failures ─────────────────────────────────────────────────────────────────────
{
  let m = ''; try { await L.hubImpPull({}); } catch (e) { m = e.message; }
  ok(/BRETTOS_TASKS_SHEET_ID is not set/.test(m), 'missing sheet id is an error');
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ error: { message: 'caller does not have permission' } }) });
  m = ''; try { await L.hubImpPull(env); } catch (e) { m = e.message; }
  ok(/does not have permission/.test(m), 'sheet read error surfaced');
  globalThis.fetch = async () => ({ json: async () => ({ values: [['Foo', 'Bar']] }) });
  m = ''; try { await L.hubImpPull(env); } catch (e) { m = e.message; }
  ok(/unexpected columns/.test(m), 'renamed columns are an error, not an empty sweep');
  globalThis.fetch = real;
}

// ── job wrapper ─────────────────────────────────────────────────────────────────────────────
{
  TABS.Ops_Build_Queue = []; TABS.Hub_Improvements = [{ ID: '1', Title: 'stuck', Status: 'done', Status_Changed_At: '2026-10-01T00:00:00Z', Applied_Status: '', Task_ID: 'x' }]; TASKS = [];
  const r = await L.schedRunHubImprovements(env, true);
  ok(r.ok === false && r.errors.some(e => /over 24h/.test(e.error)), 'a ledger change the applier never applied makes the job fail loudly');
  TABS.Hub_Improvements = [];
  const r2 = await L.schedRunHubImprovements(env, true);
  ok(r2.ok === true && r2.errors.length === 0, 'clean run is ok');
  globalThis.__syncErrors = [{ id: '5', error: 'GitHub 403' }];
  const r3 = await L.schedRunHubImprovements(env, false);
  ok(r3.ok === false && r3.errors.some(e => e.step === 'queue_sync'), 'queue sync errors surface');
  globalThis.__syncErrors = null;
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────
ok(/name: 'hub_impr_mon',\s+kind: 'weekly',\s+dow: 1, at: '07:15'/.test(src) && /name: 'hub_impr_thu',\s+kind: 'weekly',\s+dow: 4, at: '07:15'/.test(src) && /name: 'hub_impr_daily',\s+kind: 'daily'/.test(src), 'Mon + Thu 07:15 ET sweeps and a daily reconcile are in the Hub scheduler registry');
const gs = fs.readFileSync(new URL('../apps-script/hub-scheduler/HubScheduler.gs', import.meta.url), 'utf8');
ok(/name: 'hub_impr_mon',\s+run: 'hub', day: 'Mon', at: '07:15'/.test(gs) && /name: 'hub_impr_thu',\s+run: 'hub', day: 'Thu', at: '07:15'/.test(gs) && /name: 'hub_impr_daily',\s+run: 'hub', at: '07:30'/.test(gs), 'matching rows in the HubScheduler.gs JOBS table');
ok(!/cron\s*[:=]/i.test(src.slice(src.indexOf('// ── RidgeCo Hub Improvements sweep'), src.indexOf('// Standing rules every build brief carries'))), 'no cron in the sweep');


// ── Oct 14 review fixes: done != live; duplicate / shipped-match links never auto-complete ──
{
  const now = Date.parse('2026-10-15T12:00:00Z');
  const plan = (ledger, queue) => L.hubImpPlan(ledger, queue, {}, now);
  const row = (over) => Object.assign({ ID: '1', Title: 'x', Status: 'pulled', Queue_ID: '10', Queue_Status: 'done', Note: '' }, over);
  // queue 'done' with the PR still open = NOT built yet
  let p = plan([row({})], [{ ID: '10', Status: 'done', PR_Number: '300', Build_State: 'pr_open' }]);
  ok(p.updates.length === 1 && p.updates[0].fields.Status === 'building' && p.updates[0].fields.PR === '300', 'queue done + PR open -> ledger "building" with the PR, NOT done');
  ok(!p.updates.some(u => u.fields.Status === 'done'), 'PR open never completes the task');
  // already building + same PR: nothing to do
  p = plan([row({ Status: 'building', PR: '300' })], [{ ID: '10', Status: 'done', PR_Number: '300', Build_State: 'pr_open' }]);
  ok(p.updates.length === 0 && p.problems.length === 0, 'still waiting on the open PR: no churn, no noise');
  // build state not synced yet (blank) behaves like open
  p = plan([row({})], [{ ID: '10', Status: 'done', PR_Number: '300', Build_State: '' }]);
  ok(p.updates[0].fields.Status === 'building', 'blank Build_State is not live');
  // merged -> done
  p = plan([row({ Status: 'building', PR: '300' })], [{ ID: '10', Status: 'done', PR_Number: '300', Build_State: 'live' }]);
  ok(p.updates[0].fields.Status === 'done' && p.updates[0].fields.PR === '300', 'Build_State live -> done');
  // closed PR / done with no PR: reported, not completed
  p = plan([row({})], [{ ID: '10', Status: 'done', PR_Number: '300', Build_State: 'pr_closed' }]);
  ok(p.problems.some(x => /closed without merging/.test(x)) && !p.updates.some(u => u.fields.Status), 'closed PR is reported and not completed');
  p = plan([row({})], [{ ID: '10', Status: 'done', PR_Number: '', Build_State: 'pr_open' }]);
  ok(p.problems.some(x => /no PR to confirm/.test(x)) && !p.updates.some(u => u.fields.Status), 'done with no PR is reported and not completed');
  // duplicate / shipped match: never auto-completed, even when the old item is live
  for (const kind of ['duplicate', 'shipped_match']) {
    p = plan([row({ Link_Kind: kind })], [{ ID: '10', Status: 'done', PR_Number: '250', Build_State: 'live' }]);
    const f = (p.updates[0] || { fields: {} }).fields;
    ok(!f.Status && /Needs your review/.test(f.Note || '') && p.problems.some(x => /needs your review/.test(x)), kind + ' link to a live item: flagged for review, status untouched');
    p = plan([row({ Link_Kind: kind, Note: 'x Needs your review: y' })], [{ ID: '10', Status: 'done', PR_Number: '250', Build_State: 'live' }]);
    ok(p.problems.length === 0 && p.updates.length === 0, kind + ': already flagged -> reported once, not on every run');
    p = plan([row({ Link_Kind: kind })], [{ ID: '10', Status: 'dropped', Drop_Reason: 'no' }]);
    ok(!((p.updates[0] || { fields: {} }).fields.Status), kind + ': a dropped existing item does not drop the task');
  }
  // own link that is dropped still drops
  p = plan([row({})], [{ ID: '10', Status: 'dropped', Drop_Reason: 'no' }]);
  ok(p.updates[0].fields.Status === 'dropped', 'own queue item dropped -> ledger dropped');
}

// ── same-title tasks in ONE batch: the second links to the REAL queue id, not "new-N" ───────
{
  TABS.Ops_Build_Queue = []; TABS.Hub_Improvements = [];
  TASKS = [T('d1', 'Add a hot tub temperature log to the cabin checklist'), T('d2', 'Add a hot tub temperature log to the cabin checklist')];
  globalThis.__shipped = { ok: true, index: [] };
  const r = await L.hubImpPull(env);
  const led = Object.fromEntries(TABS.Hub_Improvements.map(x => [x.Task_ID, x]));
  const q1 = TABS.Ops_Build_Queue.find(x => x.Source_Task_ID === 'd1');
  ok(q1 && TABS.Ops_Build_Queue.length === 1, 'only one queue row for two identical tasks');
  ok(led.d2 && led.d2.Link_Kind === 'duplicate' && String(led.d2.Queue_ID) === String(q1.ID) && !/new-/.test(led.d2.Queue_ID + led.d2.Note), 'second task links to the real queue id (no "new-N" leaks)');
  const rec = await L.hubImpReconcile(env);
  ok(!rec.problems.some(x => /no longer exists/.test(x)), 'no dangling-link problem on reconcile');
}
console.log('hub-improvements-sweep: ' + n + '/' + n + ' passing');
