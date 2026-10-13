// Ops queue upgrade (Oct 13 2026): duplicate guard, edit-note, snooze, two-way PR sync.
// Pulls the REAL functions out of worker.js (same style as ops-queue-scout-submit.test.mjs) and
// runs the HTTP handlers against an in-memory fake sheet, so a regression in worker.js fails here.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name, kw = 'function ') {
  const i = src.indexOf(kw + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  const start = src.slice(i - 6, i) === 'async ' ? i - 6 : i;
  return src.slice(start, j + 1);
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' = ');
  if (i < 0) throw new Error('missing const ' + name);
  // end at the first ';' that closes the statement at depth 0
  let d = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if ('[({'.includes(c)) d++; else if ('])}'.includes(c)) d--;
    else if (c === ';' && d === 0) break;
  }
  return src.slice(i, j + 1);
}

// ── fake sheet backing the handlers ──────────────────────────────────────────────────────────────────────
const COLS = new Function('return ' + grabConst('OPS_QUEUE_COLS').replace(/^const OPS_QUEUE_COLS = /, '').replace(/;$/, ''))();
const STATUSES = new Function('return ' + grabConst('OPS_QUEUE_STATUSES').replace(/^const OPS_QUEUE_STATUSES = /, '').replace(/;$/, ''))();
let SHEET = [];
function resetSheet(rows) { SHEET = rows.map(r => Object.assign({}, r)); }
const json = (o, s) => ({ status: s || 200, body: o });
const env = { OPS_QUEUE_TOKEN: 'tok' };
const helpers = {
  json,
  isMissingTabError: () => false,
  ensureTab: async () => {}, ensureColumns: async () => {},
  sheetsRequest: async (_e, _m, path) => {
    if (path.startsWith('/values/Ops_Build_Queue')) return { values: [COLS, ...SHEET.map(r => COLS.map(c => r[c] === undefined ? '' : String(r[c])))] };
    throw new Error('unexpected sheet path ' + path);
  },
  addRow: async (_e, _t, o) => {
    const id = String(SHEET.reduce((m, r) => Math.max(m, parseInt(r.ID || '0')), 0) + 1);
    SHEET.push(Object.assign({}, o, { ID: id })); return json({ success: true, id });
  },
  updateRow: async (_e, _t, id, f) => {
    const r = SHEET.find(x => String(x.ID) === String(id)); if (!r) return json({ error: 'Row not found' }, 404);
    Object.assign(r, f); return json({ success: true });
  },
};
const names = ['QUEUE_STOPWORDS', 'QUEUE_STANDING_RULES', 'QUEUE_REPO'];
const code = names.map(grabConst).join('\n') + '\n' + [
  'queueTokens', 'queueDice', 'queueSimilarity', 'findQueueMatch', 'isSnoozed', 'snoozeUntilFromDays',
  'buildShippedIndex', 'findShippedMatch', 'prStateToBuildState', 'matchPrToItem', 'cleanPrNumber', 'ghPublicJson',
  'opsApprove', 'opsQueueUpdate', 'opsQueueStatus', 'validateQueueStatusReport', 'opsQueueSync',
  'validateScoutSubmitItems', 'buildScoutQueueRow', 'opsQueueScoutSubmit', 'buildStartBuildRoutineText',
].map(n => grab(n)).join('\n') + `
const OPS_QUEUE_TAB = 'Ops_Build_Queue', OPS_REVIEW_TAB = 'Ops_Review_Log', OPS_REVIEW_COLS = [];
const OPS_QUEUE_COLS = __COLS, OPS_QUEUE_STATUSES = __STATUSES;
async function getShippedIndex() { return globalThis.__shipped; }
return { queueTokens, queueDice, queueSimilarity, findQueueMatch, isSnoozed, snoozeUntilFromDays, buildShippedIndex, findShippedMatch,
  prStateToBuildState, matchPrToItem, cleanPrNumber, opsApprove, opsQueueUpdate, opsQueueStatus, opsQueueSync, opsQueueScoutSubmit, buildStartBuildRoutineText };`;
const L = new Function('__COLS', '__STATUSES', ...Object.keys(helpers), code)(COLS, STATUSES, ...Object.values(helpers));

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ── schema ───────────────────────────────────────────────────────────────────────────────────────────
for (const c of ['Brett_Note', 'Snooze_Until', 'PR_Number', 'Build_State', 'Build_Updated', 'Dup_Of', 'Shipped_Match', 'Scout_Verdict', 'Scout_Note', 'Scout_Reviewed']) ok(COLS.includes(c), 'column ' + c);
ok(STATUSES.length === 7 && STATUSES.includes('proposed'), 'statuses unchanged (no new lifecycle status needed)');

// ── similarity (real rows from Brett's queue, Oct 13 2026) ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const a = { Title: 'Add prompt caching to the model router', First_Step: "Mark the stable prefix (system prompt + reference data) as cached in routeAI's request", Problem: 'Every call re-sends the full static prefix.' };
  const b = Object.assign({}, a);
  ok(L.queueSimilarity(a, b).same, 'verbatim copy is "same"');
  const m1 = { Title: 'Input font >=16px sweep on portal forms', First_Step: 'Set a >=16px min on input/select/textarea via one token.', Problem: 'iOS/Android zoom on focus' };
  const m2 = { Title: 'Input font ≥16px + remove maximum-scale (Android zoom)', First_Step: 'Set input font-size ≥16px repo-wide and strip maximum-scale=1.0 from the viewport', Problem: 'Android zooms the page on focus' };
  ok(L.queueSimilarity(m1, m2).overlap, 'reworded input-font twins are flagged as overlap');
  const u1 = { Title: 'Door code watchdog alert', First_Step: 'ping str-automation health', Problem: 'guest locked out' };
  const u2 = { Title: 'Vendor 1099 year-end export', First_Step: 'sheet export of paid bills', Problem: 'tax time' };
  ok(!L.queueSimilarity(u1, u2).overlap, 'unrelated items are not flagged');
  ok(L.queueSimilarity({ title: 'Add prompt caching to the model router', action: a.First_Step, problem: a.Problem }, a).same, 'scout-shaped item (title/action/problem) compares to sheet row');
  eq(L.queueDice(new Set(), new Set(['a'])), 0, 'empty set dice = 0');
}

// ── findQueueMatch ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const rows = [{ ID: '1', Title: 'Monthly owner summary email', Problem: 'owners want a recap', First_Step: 'send per-owner email', Status: 'dropped' }];
  const it = { title: 'Monthly owner summary email', problem: 'owners want a recap', action: 'send per-owner email' };
  ok(L.findQueueMatch(it, rows, 'same').row.ID === '1', 'matches closed (dropped) rows too');
  ok(L.findQueueMatch(it, rows, 'same', ['1']) === null, 'ignoreIds skips the row itself');
}

// ── snooze helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const now = Date.parse('2026-10-13T12:00:00Z');
  eq(L.snoozeUntilFromDays(10, now), '2026-10-23T12:00:00.000Z', '10 days');
  eq(L.snoozeUntilFromDays(0, now), '', '0 clears');
  eq(L.snoozeUntilFromDays(-1, now), null, 'negative invalid');
  eq(L.snoozeUntilFromDays(400, now), null, '>365 invalid');
  eq(L.snoozeUntilFromDays('abc', now), null, 'NaN invalid');
  ok(L.isSnoozed({ Snooze_Until: '2026-10-23T12:00:00.000Z' }, now), 'future = snoozed');
  ok(!L.isSnoozed({ Snooze_Until: '2026-10-01T00:00:00.000Z' }, now), 'past = not snoozed');
  ok(!L.isSnoozed({ Snooze_Until: '' }, now), 'blank = not snoozed');
}

// ── PR helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  eq(L.prStateToBuildState({ state: 'open' }), 'pr_open', 'open');
  eq(L.prStateToBuildState({ state: 'closed', merged: true }), 'live', 'merged');
  eq(L.prStateToBuildState({ state: 'closed', merged_at: '2026-10-13T00:00:00Z' }), 'live', 'merged_at');
  eq(L.prStateToBuildState({ state: 'closed', merged: false }), 'pr_closed', 'closed unmerged is flagged, not abandoned');
  eq(L.prStateToBuildState(null), null, 'null');
  eq(L.cleanPrNumber('#198'), '198', '#198'); eq(L.cleanPrNumber('0'), null, '0'); eq(L.cleanPrNumber('abc'), null, 'abc');
  const prs = [{ number: 5, title: 'x', body: 'Ops queue item #12' }, { number: 6, title: 'y', body: 'Ops queue item #123' }];
  eq(L.matchPrToItem(prs, '12').number, 5, 'item 12 does not match #123');
  eq(L.matchPrToItem(prs, '123').number, 6, 'item 123');
  eq(L.matchPrToItem(prs, '7'), null, 'no match');
}

// ── shipped index ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const log = '# Log\n\n## [FL-20261009-1200-sfx] Oct 9, 2026 — small-fixes batch — mobile input font zoom prompt caching\nbody\n**5. Door watchdog health check alert guest lockout.** more text\n';
  const idx = L.buildShippedIndex(log);
  ok(idx.length === 2, 'indexes FL heading + numbered rule');
  ok(L.findShippedMatch('Mobile input font zoom fix', idx).ref === '[FL-20261009-1200-sfx]', 'finds shipped headline');
  ok(L.findShippedMatch('Quarterly tax export', idx) === null, 'no false match');
  ok(L.findShippedMatch('font fix', idx) === null, 'too-short titles never flag');
}

// ── opsApprove promotes in place (no clone) ────────────────────────────────────────────────────────────────────────────────────────────────
{
  resetSheet([
    { ID: '1', Title: 'Monthly owner summary email', Problem: 'recap', First_Step: 'send email', Status: 'proposed' },
    { ID: '2', Title: 'Door watchdog alert', Problem: 'lockout', First_Step: 'ping health', Status: 'greenlit' },
  ]);
  const r = await L.opsApprove(env, { items: [
    { title: 'Monthly owner summary email', problem: 'recap', action: 'send email' },
    { title: 'Door watchdog alert', problem: 'lockout', action: 'ping health' },
    { title: 'Brand new idea about gutters', problem: 'gutter cleaning schedule', action: 'template' },
  ] });
  eq([r.body.queued, r.body.promoted, r.body.already], [1, 1, 1], 'queued/promoted/already');
  eq(SHEET.length, 3, 'only the genuinely new item added a row — no clones');
  eq(SHEET.find(x => x.ID === '1').Status, 'greenlit', 'proposed twin promoted in place');
}

// ── opsQueueUpdate: note, snooze, status clears snooze ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  resetSheet([{ ID: '9', Title: 'Owner view', Status: 'proposed' }]);
  let r = await L.opsQueueUpdate(env, { id: '9', note: "Don't show monthly spend" });
  ok(r.body.success, 'note-only update works without status');
  eq(SHEET[0].Brett_Note, "Don't show monthly spend", 'note stored'); eq(SHEET[0].Status, 'proposed', 'status untouched by a note');
  r = await L.opsQueueUpdate(env, { id: '9', snooze_days: 10 });
  ok(Date.parse(SHEET[0].Snooze_Until) > Date.now() + 9 * 86400000, 'snoozed ~10 days'); eq(SHEET[0].Status, 'proposed', 'snooze keeps status proposed');
  r = await L.opsQueueUpdate(env, { id: '9', snooze_days: 999 }); eq(r.status, 400, 'bad snooze rejected');
  r = await L.opsQueueUpdate(env, { id: '9' }); eq(r.status, 400, 'empty update rejected');
  r = await L.opsQueueUpdate(env, { id: '9', status: 'greenlit', risk_class: 'SAFE', note: 'x' });
  eq(SHEET[0].Snooze_Until, '', 'approving ends the snooze'); eq(SHEET[0].Risk_Class, 'SAFE', 'risk class'); eq(SHEET[0].Brett_Note, 'x', 'note saved with approve');
  r = await L.opsQueueUpdate(env, { id: '9', pr_number: 'zz' }); eq(r.status, 400, 'bad PR rejected');
  r = await L.opsQueueUpdate(env, { id: '9', build_state: 'bogus' }); eq(r.status, 400, 'bad build_state rejected');
}

// ── opsQueueStatus: build session reports PR ───────────────────────────────────────────────────────────────────────────────────────────────
{
  resetSheet([{ ID: '3', Title: 'T', Status: 'building', Build_State: 'building' }]);
  let r = await L.opsQueueStatus(env, { id: '3', status: 'done', pr_number: 231 });
  eq([SHEET[0].Status, SHEET[0].PR_Number, SHEET[0].Build_State], ['done', '231', 'pr_open'], 'done + PR → built, awaiting merge');
  resetSheet([{ ID: '4', Title: 'T', Status: 'building' }]);
  r = await L.opsQueueStatus(env, { id: '4', status: 'held', note: 'need decision' });
  eq(SHEET[0].Build_State, 'held', 'held build state');
}

// ── scout submit: dedup / overlap / shipped flag / rechecks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  globalThis.__shipped = { ok: true, index: L.buildShippedIndex('## [FL-1] shipped — gutter cleaning reminder schedule template\n') };
  resetSheet([
    { ID: '1', Title: 'Add prompt caching to the model router', Problem: 'resends prefix', First_Step: 'mark stable prefix cached', Status: 'done' },
    { ID: '2', Title: 'Input font 16px sweep on portal forms', Problem: 'android zoom on focus', First_Step: 'set 16px min on input select textarea', Status: 'dropped' },
    { ID: '3', Title: 'Something snoozed', Problem: 'p', First_Step: 's', Status: 'proposed', Snooze_Until: '2026-12-01T00:00:00.000Z' },
  ]);
  const r = await L.opsQueueScoutSubmit(env, { summary: 's', items: [
    { title: 'Add prompt caching to the model router', problem: 'resends prefix', action: 'mark stable prefix cached' },
    { title: 'Input font ≥16px + remove maximum-scale (Android zoom)', problem: 'android zoom on focus', action: 'set input font-size 16px repo-wide strip maximum-scale' },
    { title: 'Gutter cleaning reminder schedule template for owners', problem: 'g', action: 'a' },
    { title: 'Totally different thing about tenant parking permits', problem: 'x', action: 'y' },
  ], rechecks: [{ id: '3', verdict: 'covered', note: 'built in PR 198' }, { id: '1', verdict: 'keep' }, { id: '99', verdict: 'keep' }] });
  ok(r.body.ok, 'ok');
  eq(r.body.skipped_duplicates.length, 1, 'verbatim copy of a DONE row is skipped and reported');
  eq(r.body.skipped_duplicates[0].duplicate_of, '1', 'names the row it duplicates');
  ok(r.body.queued === 3, 'the other three inserted: ' + r.body.queued);
  ok(r.body.flagged_overlaps.some(o => o.overlaps === '2'), 'overlap with a dropped row is flagged (not silently dropped)');
  const gut = SHEET.find(x => String(x.Title).startsWith('Gutter'));
  ok(/Looks already built/.test(gut.Shipped_Match || ''), 'shipped-index flag written: ' + gut.Shipped_Match);
  ok(SHEET.filter(x => x.Status === 'proposed' && x.Approved_By === 'scout-reuse-radar').every(x => x.Risk_Class === ''), 'scout rows still proposed / risk blank');
  eq(SHEET.find(x => x.ID === '3').Scout_Verdict, 'covered', 'recheck stored on proposed row');
  eq(r.body.rechecked, 1, 'only the proposed row rechecked');
  eq(r.body.recheck_errors.map(e => e.error).sort(), ['not_found', 'not_proposed'], 'bad rechecks reported, not swallowed');
  // recheck-only call
  const r2 = await L.opsQueueScoutSubmit(env, { rechecks: [{ id: '3', verdict: 'keep', note: 'still relevant' }] });
  ok(r2.body.ok && r2.body.queued === 0, 'recheck-only call allowed');
  // shipped index unavailable → surfaced
  globalThis.__shipped = { ok: false, error: 'HTTP 500' };
  const r3 = await L.opsQueueScoutSubmit(env, { items: [{ title: 'Another unrelated fresh idea alpha beta', problem: 'q', action: 'z' }] });
  ok(/unavailable/.test(r3.body.shipped_check), 'shipped-check outage is reported, not silent');
  const r4 = await L.opsQueueScoutSubmit(env, {}); eq(r4.status, 400, 'empty submit still 400');
}

// ── sync: PR state onto rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const prs = {
    '/pulls/10': { number: 10, state: 'closed', merged: true, merged_at: 'x' },
    '/pulls/11': { number: 11, state: 'closed', merged: false },
    '/pulls/12': { number: 12, state: 'open' },
  };
  globalThis.fetch = async (url) => {
    const p = String(url).split('RidgeCo')[1];
    if (p.startsWith('/pulls?')) return { ok: true, json: async () => [{ number: 12, title: 'x', body: 'Ops queue item #24' }] };
    if (prs[p]) return { ok: true, json: async () => prs[p] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  resetSheet([
    { ID: '20', Title: 'merged', Status: 'done', PR_Number: '10', Build_State: 'pr_open' },
    { ID: '21', Title: 'closed unmerged', Status: 'done', PR_Number: '11', Build_State: 'pr_open' },
    { ID: '22', Title: 'legacy done', Status: 'done' },
    { ID: '23', Title: 'broken pr', Status: 'building', PR_Number: '77', Build_State: 'pr_open' },
    { ID: '24', Title: 'found by body', Status: 'building', Build_State: 'building' },
  ]);
  const r = await L.opsQueueSync(env, {});
  eq(SHEET[0].Build_State, 'live', 'merged → live');
  eq([SHEET[1].Build_State, SHEET[1].Status], ['pr_closed', 'done'], 'closed unmerged → flagged pr_closed, NOT auto-abandoned');
  eq(SHEET[2].Build_State || '', '', 'legacy done rows untouched');
  eq(r.body.errors.length, 1, 'unreachable PR reported in errors, not swallowed'); eq(r.body.errors[0].id, '23', 'which row');
  eq([SHEET[4].PR_Number, SHEET[4].Build_State], ['12', 'pr_open'], 'PR found via "Ops queue item #24" in body');
  eq(r.body.ok, false, 'ok:false when any error');
  // title_prefix guard
  resetSheet([{ ID: '30', Title: 'real row', Status: 'done', PR_Number: '10', Build_State: 'pr_open' }]);
  await L.opsQueueSync(env, { title_prefix: 'TEST-' });
  eq(SHEET[0].Build_State, 'pr_open', 'title_prefix restricts which rows sync touches');
}

// ── routine text carries Brett's change + standing rules ──────────────────────────────────────────────────────────────────────────────────────────
{
  const t = L.buildStartBuildRoutineText([{ ID: '5', Title: 'Owner view', Risk_Class: 'SAFE', Brett_Note: 'Do not show monthly spend' }, { ID: '6', Title: 'Other', Risk_Class: 'SAFE' }], 'TOK');
  ok(/BRETT'S CHANGE \(overrides the proposal wherever they conflict\): Do not show monthly spend/.test(t), 'note injected');
  ok((t.match(/BRETT'S CHANGE/g) || []).length === 1, 'only on the item that has a note');
  ok(/NEVER show what an owner spends/.test(t) && /ALWAYS show amounts/.test(t), 'owner-spend rule + estimate exception present');
  ok(/Ops queue item #/.test(t) && /"pr_number"/.test(t), 'PR reporting instructions');
}

// ── wiring ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(/path === '\/ops-queue\/sync'\)\s+return await opsQueueSync/.test(src), 'sync route wired');
ok(/path === '\/ops-queue\/sync'\)\n\s+\);/.test(src) || /request\.method === 'POST' && path === '\/ops-queue\/sync'/.test(src), 'sync reachable with OPS_QUEUE_TOKEN');
ok(/BUILD_VERSION = '\d{4}-\d{2}-\d{2}\.\d+-[a-z-]+'/.test(src), 'BUILD_VERSION format rule');

console.log('ops-queue-upgrade: ' + n + '/' + n + ' passing');
