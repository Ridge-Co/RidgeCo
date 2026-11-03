// Offline test for judge() wired onto statement-import "possible" matches (queue #55, B-211's first real
// call site, Nov 3 2026). Runs the REAL receiptReconImportStatement and the REAL pure helpers
// (statementLineMatch, statementJudgeEvidence, statementWindowCount) extracted from worker.js, with
// judge()/logTelemetry/addRow stubbed, so this cannot drift from what ships.
// What it pins: judge() is only asked about 'possible' matches; it is shown the matched record's own data;
// an approval resolves the line, anything else (reject, throw, model down, over the cap, ambiguity) goes
// to the manual queue exactly as before; a thrown judge() is logged loudly, never swallowed.
// Run: node test/statement-judge-wire.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

function extract(name, isAsync = false) {
  const start = src.indexOf(`${isAsync ? 'async ' : ''}function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}

const pure = new Function(`
  ${extract('_rcNorm')}
  ${extract('statementLineMatch')}
  ${extract('statementJudgeEvidence')}
  ${extract('statementWindowCount')}
  return { statementLineMatch, statementJudgeEvidence, statementWindowCount };
`)();

// Builds a fresh import function + recorders for one scenario.
function setup({ receipts = [], queue = [], judgeImpl, telemetryImpl } = {}) {
  const inserted = [], judgeCalls = [], telemetry = [];
  const deps = {
    ensureTab: async () => {}, ensureColumns: async () => {},
    fetchTabs: async () => [receipts, queue],
    addRow: async (env, tab, row) => { inserted.push(row); },
    getAccessToken: async () => 'tok',
    driveDownload: async () => ({ bytes: new ArrayBuffer(1), mime: 'application/pdf' }),
    statementExtract: async () => ({ vendor_detected: '', lines: [] }),
    statementLineMatch: pure.statementLineMatch,
    statementJudgeEvidence: pure.statementJudgeEvidence,
    statementWindowCount: pure.statementWindowCount,
    judge: async (env, call) => { judgeCalls.push(call); return judgeImpl ? judgeImpl(call) : { verdict: 'approve', confidence: 0.9, reason: 'ok' }; },
    logTelemetry: async (env, rec) => { telemetry.push(rec); if (telemetryImpl) return telemetryImpl(rec); },
    aiCreditPausedJson: (o) => o,
    RECEIPT_RECON_QUEUE_HEADERS: [],
    json: (o) => o,
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, `return (${extract('receiptReconImportStatement', true)});`)(...names.map(n => deps[n]));
  return { fn, inserted, judgeCalls, telemetry };
}

const R = (id, amount, date, store = 'Home Depot', extra = {}) => ({ ID: id, Active: 'TRUE', Amount: String(amount), Date: date, Store: store, WO_ID: 'WO-1', Description: 'lumber', ...extra });
const line = (amount, date, extra = {}) => ({ amount, date, description: 'HOME DEPOT #123', ref: '', ...extra });

// 1) possible + judge approves -> resolved, NOT inserted, and judge was shown the existing receipt's own data.
{
  const t = setup({ receipts: [R('R1', 56.04, '2026-09-20')] });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(56.04, '2026-09-22')] });
  ok(t.judgeCalls.length === 1, 'a possible match is sent to judge() exactly once');
  const c = t.judgeCalls[0] || {};
  ok(c.riskClass === 'SAFE', 'judge() is called with riskClass SAFE');
  ok(c.proposedChange && c.proposedChange.existing_record && c.proposedChange.existing_record.store === 'Home Depot' && c.proposedChange.existing_record.date === '2026-09-20' && c.proposedChange.existing_record.amount === '56.04' && c.proposedChange.existing_record.work_order === 'WO-1',
    'judge() is SHOWN the matched receipt itself (store, date, amount, work order), not just an id');
  ok(c.proposedChange && c.proposedChange.statement_line && c.proposedChange.statement_line.amount === '56.04' && c.proposedChange.statement_line.date === '2026-09-22', 'judge() is shown the statement line too');
  ok(Array.isArray(c.acceptanceCriteria) && c.acceptanceCriteria.length >= 3, 'acceptance criteria are a real list');
  ok(/R1/.test(c.action || '') && /56\.04/.test(c.action || ''), 'the action string names the line and the record, so the telemetry verdict row can be traced');
  ok(r.inserted === 0 && t.inserted.length === 0, 'an approved line is not filed to the manual queue');
  ok(r.matched_confirmed === 1 && r.judge_confirmed === 1 && r.flagged_possible === 1, 'approved line counts as matched_confirmed AND judge_confirmed (response shows how much judge() resolved)');
}

// 2) possible + judge rejects -> filed to the manual queue with the verifier's reason in the note.
{
  const t = setup({ receipts: [R('R1', 56.04, '2026-09-20')], judgeImpl: () => ({ verdict: 'reject', confidence: 0.8, reason: 'different work order on the receipt' }) });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(56.04, '2026-09-22')] });
  ok(r.inserted === 1 && t.inserted.length === 1, 'a rejected line is filed to the manual queue');
  ok(/Possibly matches/.test(t.inserted[0].Notes) && /Verifier did not confirm: different work order on the receipt/.test(t.inserted[0].Notes), 'the note keeps the existing warning and adds the verifier reason for Brett');
  ok(r.judge_confirmed === 0 && r.matched_confirmed === 0, 'a reject confirms nothing');
}

// 3) 'confirmed' and no-match lines never reach judge().
{
  const t = setup({ receipts: [R('R1', 56.04, '2026-09-20')] });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(56.04, '2026-09-20'), line(11.11, '2026-09-20')] });
  ok(t.judgeCalls.length === 0, 'an exact (confirmed) match and a no-match line never call judge()');
  ok(r.matched_confirmed === 1 && r.inserted === 1, 'exact match resolved as before; no-match inserted as before');
}

// 4) judge() throws -> line filed, error returned, logged loudly (Success FALSE), and the rest of the call stops asking.
{
  const t = setup({ receipts: [R('R1', 10, '2026-09-20'), R('R2', 20, '2026-09-20')], judgeImpl: () => { throw new Error('boom'); } });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(10, '2026-09-21'), line(20, '2026-09-21')] });
  ok(r.inserted === 2, 'both lines reach the manual queue when judge() throws');
  ok(t.judgeCalls.length === 1, 'after one throw the rest of the call does not keep asking judge()');
  ok(r.errors.some(e => /judge\(\) threw/.test(e) && /boom/.test(e)), 'the failure is in the returned errors (not swallowed)');
  ok(t.telemetry.some(x => x.Success === 'FALSE' && x.Job_Type === 'statement_judge_error'), 'the failure is logged to telemetry with Success FALSE (reaches Needs Attention)');
}

// 5) the telemetry write itself failing is also reported, not swallowed.
{
  const t = setup({ receipts: [R('R1', 10, '2026-09-20')], judgeImpl: () => { throw new Error('boom'); }, telemetryImpl: () => { throw new Error('sheet down'); } });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(10, '2026-09-21')] });
  ok(r.errors.some(e => /could not record that judge\(\) failure/.test(e) && /sheet down/.test(e)), 'a failed telemetry write is reported in errors too');
  ok(r.inserted === 1, 'the line still goes to the manual queue');
}

// 6) model unavailable (judge() fail-closed with its own reason) -> stop asking for the rest of the call, tell the caller once.
{
  const t = setup({ receipts: [R('R1', 10, '2026-09-20'), R('R2', 20, '2026-09-20'), R('R3', 30, '2026-09-20')],
    judgeImpl: () => ({ verdict: 'reject', confidence: 0, reason: 'judge model call failed: AI credit paused' }) });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(10, '2026-09-21'), line(20, '2026-09-21'), line(30, '2026-09-21')] });
  ok(t.judgeCalls.length === 1, 'when the model path is down, judge() is asked once, not once per line');
  ok(r.inserted === 3 && r.judge_skipped === 2, 'all three lines are filed to the manual queue; two were skipped without a model call');
  ok(r.errors.length === 1 && /judge\(\) unavailable/.test(r.errors[0]), 'the caller is told once that the verifier was unavailable');
}

// 7) per-call cap: 8 possible lines -> 5 judged, 3 straight to the manual queue.
{
  const receipts = [], rows = [];
  for (let i = 1; i <= 8; i++) { receipts.push(R('R' + i, i * 10, '2026-09-20')); rows.push(line(i * 10, '2026-09-21')); }
  const t = setup({ receipts });
  const r = await t.fn({}, { vendor: 'Home Depot', rows });
  ok(t.judgeCalls.length === 5, 'at most 5 judge() calls per import call (got ' + t.judgeCalls.length + ')');
  ok(r.judge_confirmed === 5 && r.judge_skipped === 3 && r.inserted === 3, 'the 3 lines past the cap go to the manual queue untouched');
}

// 8) ambiguity -> never auto-confirmed, no model call.
{
  const t = setup({ receipts: [R('R1', 56.04, '2026-09-20'), R('R2', 56.04, '2026-09-21')] });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(56.04, '2026-09-22')] });
  ok(t.judgeCalls.length === 0 && r.inserted === 1 && r.judge_skipped === 1, 'two existing records fit the window -> manual queue, judge() not asked');
}
{
  const t = setup({ receipts: [R('R1', 56.04, '2026-09-20')] });
  const r = await t.fn({}, { vendor: 'Home Depot', rows: [line(56.04, '2026-09-22'), line(56.04, '2026-09-23')] });
  ok(t.judgeCalls.length === 0 && r.inserted === 2, 'the same amount twice on one statement -> manual queue, judge() not asked (could be a repeat charge)');
}

// 9) matched record cannot be found -> nothing to show the verifier -> manual queue.
{
  const t = setup({ receipts: [] });
  // Force a 'possible' match whose record is missing by stubbing the matcher result through a queue row that then vanishes.
  const deps2 = pure.statementJudgeEvidence({ confidence: 'possible', type: 'window_receipt', receipt_id: 'GONE' }, [], []);
  ok(deps2 === null, 'statementJudgeEvidence returns null when the matched record is not in the data');
}

// 10) pure helpers.
{
  const ev = pure.statementJudgeEvidence({ confidence: 'possible', type: 'window_queue', queue_id: 'Q9' }, [], [{ ID: 'Q9', Status: 'confirmed', Vendor: 'Lowes', Receipt_Date: '2026-08-01', Total: '12.50', Confirmed_WO_ID: 'WO-7', PO_Reference: 'PO-1' }]);
  ok(ev && ev.record === 'receipt_queue_row' && ev.vendor === 'Lowes' && ev.work_order === 'WO-7' && ev.po_reference === 'PO-1', 'queue-row evidence carries vendor, date, amount, work order and PO');
  ok(pure.statementWindowCount({ amount: 5, date: '2026-09-10' }, [R('A', 5, '2026-09-08'), R('B', 5, '2026-09-14'), R('C', 6, '2026-09-10'), R('D', 5, '2026-09-10', 'X', { Active: 'FALSE' })], []) === 1,
    'window count: only same-amount, active, within 3 days (the day-4 record, the other amount and the inactive record are excluded)');
}

// 11) A confirmed queue row and the Receipts row it created are ONE purchase (found on the Nov 3 staging run) - count once, judge() still asked.
{
  const t = setup({ receipts: [R('9', 56.04, '2026-11-01', 'TEST-JudgeVendor')], queue: [{ ID: '73', Status: 'confirmed', Vendor: 'TEST-JudgeVendor', Receipt_Date: '2026-11-01', Total: '56.04', Confirmed_Receipt_ID: '9' }] });
  const r = await t.fn({}, { vendor: 'TEST-JudgeVendor', rows: [line(56.04, '2026-11-03')] });
  ok(pure.statementWindowCount({ amount: 56.04, date: '2026-11-03' }, [R('9', 56.04, '2026-11-01')], [{ ID: '73', Status: 'confirmed', Total: '56.04', Receipt_Date: '2026-11-01', Confirmed_Receipt_ID: '9' }]) === 1, 'window count: a receipt and the confirmed queue row that created it count once');
  ok(t.judgeCalls.length === 1 && r.judge_confirmed === 1 && r.inserted === 0, 'receipt + its own confirmed queue row is not treated as ambiguous: judge() is asked and an approval resolves the line');
  ok(pure.statementWindowCount({ amount: 56.04, date: '2026-11-03' }, [R('9', 56.04, '2026-11-01')], [{ ID: '80', Status: 'confirmed', Total: '56.04', Receipt_Date: '2026-11-02', Confirmed_Receipt_ID: '' }]) === 2, 'window count: an unlinked queue row with the same amount still counts as a second candidate');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
