// Offline test for Part 4 of the Sep 22 2026 dup/refund/bulk brief: the Receipt Reconciler's
// bulk-actions dispatch endpoint, POST /receipt-recon/bulk-action. Extracts the REAL
// receiptReconBulkAction straight out of worker.js (not reimplemented), same convention as
// receipt-recon-cutoff-unskip.test.mjs and receipt-attach-only.test.mjs.
//
// mark_duplicate / move_to_pending / skip are exercised against the REAL extracted
// receiptReconConfirmDuplicate / receiptReconUnskip / receiptReconSkip, so this proves the
// dispatch endpoint reuses those single-row handlers verbatim rather than reimplementing their
// status logic. The 'expense' action is exercised against a STUB receiptReconConfirm (that
// function's own real behavior — addReceipt, QuickBooks email, Invoice_Review folding — is
// already covered by receipt-expense-path.test.mjs and receipt-attach-only.test.mjs); this test
// only proves the dispatcher calls it with the right { id, no_wo:true, property_id } shape for
// the whole batch.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

function extract(name, isAsync) {
  const start = src.indexOf(`${isAsync ? 'async ' : ''}function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
function extractConst(name) {
  const m = src.match(new RegExp('const ' + name + ' = [^\\n]+;'));
  if (!m) throw new Error(name + ' not found');
  return m[0];
}
const CONSTS = `${extractConst('RECEIPT_BULK_ACTIONS')}\n${extractConst('RECEIPT_BULK_ACTION_MAX')}`;

// ── Wiring sanity ────────────────────────────────────────────────────────────────────────────
ok(/if \(path === '\/receipt-recon\/bulk-action'\)\s+return await receiptReconBulkAction\(env, body\);/.test(src),
  "POST /receipt-recon/bulk-action is routed to receiptReconBulkAction");
ok(/async function receiptReconBulkAction\(env, body\)/.test(src), 'receiptReconBulkAction is defined');
ok(/RECEIPT_BULK_ACTIONS = \['mark_duplicate', 'expense', 'move_to_pending', 'skip'\]/.test(src),
  'the four decided bulk actions are exactly mark_duplicate/expense/move_to_pending/skip');
ok(/RECEIPT_BULK_ACTION_MAX = \d+/.test(src), 'a batch-size cap constant exists (Cloudflare subrequest guard)');
{
  const body = extract('receiptReconBulkAction', true);
  ok(/receiptReconConfirmDuplicate\(env,/.test(body), 'mark_duplicate dispatches to the real receiptReconConfirmDuplicate');
  ok(/receiptReconConfirm\(env, \{ id, no_wo: true, property_id/.test(body), 'expense dispatches to the real receiptReconConfirm with no_wo:true (PR #23\'s flow), never a reimplementation');
  ok(/receiptReconUnskip\(env,/.test(body), 'move_to_pending dispatches to the real receiptReconUnskip (PR #24\'s single-row undo)');
  ok(/receiptReconSkip\(env,/.test(body), 'skip dispatches to the real receiptReconSkip');
}

// ── Runtime behavior ─────────────────────────────────────────────────────────────────────────
function world() {
  const tab = [
    { ID: '1', Status: 'pending', Total: '10.00', Vendor: 'Home Depot', Active: 'TRUE' },
    { ID: '2', Status: 'pending', Total: '20.00', Vendor: 'Lowes', Active: 'TRUE' },
    { ID: '3', Status: 'skipped', Total: '30.00', Vendor: 'Surplus City', Active: 'TRUE' },
    { ID: '4', Status: 'pending', Total: '40.00', Vendor: 'Ace Hardware', Active: 'TRUE' },
  ];
  const confirmCalls = [];
  const deps = {
    json: (o, status) => ({ status: status || 200, json: async () => o }),
    fetchTab: async () => tab.map(r => ({ ...r })),
    updateRow: async (env, t, id, f) => { Object.assign(tab.find(r => r.ID === id), f); },
    // Stub for the heavy expense path — see file header. Mirrors receiptReconConfirm's own
    // success shape closely enough for the dispatcher's succeeded/failed split to exercise
    // real code, without pulling in addReceipt/QuickBooks.
    receiptReconConfirm: async (env, body) => {
      confirmCalls.push(body);
      if (!tab.find(r => r.ID === body.id)) return { status: 404, json: async () => ({ error: 'queue row not found' }) };
      return { status: 200, json: async () => ({ ok: true, success: true, id: body.id, amount: '1.00' }) };
    },
  };
  const code = `${CONSTS}\n${extract('receiptReconConfirmDuplicate', true)}\n${extract('receiptReconUnskip', true)}\n` +
    `${extract('receiptReconSkip', true)}\n${extract('receiptReconBulkAction', true)}\n` +
    `return { receiptReconBulkAction };`;
  const names = Object.keys(deps);
  const fns = new Function(...names, code)(...names.map(n => deps[n]));
  return {
    tab, confirmCalls,
    call: async (b) => (await fns.receiptReconBulkAction({}, b)).json(),
  };
}

// Validation
{
  const w = world();
  const r1 = await w.call({ ids: ['1'] });
  ok(r1.error && /action must be one of/.test(r1.error), 'missing action rejected (400-shaped error)');
  const r2 = await w.call({ ids: ['1'], action: 'delete_everything' });
  ok(r2.error && /action must be one of/.test(r2.error), 'unknown action rejected, never silently ignored');
  const r3 = await w.call({ action: 'skip' });
  ok(r3.error && /ids required/.test(r3.error), 'missing ids rejected');
  const r4 = await w.call({ action: 'skip', ids: [] });
  ok(r4.error && /ids required/.test(r4.error), 'empty ids array rejected');
  const r5 = await w.call({ action: 'expense', ids: ['1'] });
  ok(r5.error && /property_id required/.test(r5.error), 'expense with no property_id key at all is rejected (a bare string, including "", is fine)');
}

// mark_duplicate — real receiptReconConfirmDuplicate underneath
{
  const w = world();
  const res = await w.call({ ids: ['1', '2'], action: 'mark_duplicate' });
  ok(res.ok === true && res.succeeded.length === 2 && res.failed.length === 0, 'mark_duplicate succeeds for two pending rows');
  ok(w.tab.find(r => r.ID === '1').Status === 'duplicate_confirmed' && w.tab.find(r => r.ID === '2').Status === 'duplicate_confirmed',
    'both rows actually land in duplicate_confirmed — the SAME status the single "Confirm duplicate" button writes');
}

// move_to_pending — real receiptReconUnskip underneath; a non-skipped row must fail exactly like
// tapping the single-row ↩ button on it would (receiptReconUnskip's own 409), never silently
// succeed or silently get skipped from the result.
{
  const w = world();
  const res = await w.call({ ids: ['3', '1'], action: 'move_to_pending' });
  ok(res.succeeded.length === 1 && res.succeeded[0].id === '3', 'the skipped row (3) moves back to pending');
  ok(w.tab.find(r => r.ID === '3').Status === 'pending', 'row 3 is actually pending again');
  ok(res.failed.length === 1 && res.failed[0].id === '1' && /Only a skipped receipt/.test(res.failed[0].error),
    'the already-pending row (1) is reported failed with receiptReconUnskip\'s real error text, not swallowed');
}

// skip — real receiptReconSkip underneath
{
  const w = world();
  const res = await w.call({ ids: ['1', '4'], action: 'skip' });
  ok(res.succeeded.length === 2, 'skip succeeds for both rows');
  ok(w.tab.find(r => r.ID === '1').Status === 'skipped' && w.tab.find(r => r.ID === '4').Status === 'skipped', 'both rows actually land in skipped');
}

// expense — dispatcher wiring onto receiptReconConfirm(no_wo:true, property_id)
{
  const w = world();
  const res = await w.call({ ids: ['1', '2'], action: 'expense', property_id: '' });
  ok(res.succeeded.length === 2, 'expense (Ridge Co, blank property_id) succeeds for both rows');
  ok(w.confirmCalls.every(c => c.no_wo === true && c.property_id === ''), 'every call to receiptReconConfirm carries no_wo:true and the batch\'s Ridge Co property_id ("")');

  const w2 = world();
  const res2 = await w2.call({ ids: ['1', '2'], action: 'expense', property_id: '85' });
  ok(res2.succeeded.length === 2 && w2.confirmCalls.every(c => c.property_id === '85'),
    'a real property_id (e.g. 1864 Kerns School Rd\'s id) is passed through unchanged to every row in the batch — one property choice applies to the whole selection');

  const w3 = world();
  const res3 = await w3.call({ ids: ['1', '999'], action: 'expense', property_id: '' });
  ok(res3.succeeded.length === 1 && res3.failed.length === 1 && res3.failed[0].id === '999',
    'a nonexistent id in the batch fails just that row without blocking the rest');
}

// ids are deduplicated (checking the same box twice / a stale selection can never double-fire)
{
  const w = world();
  const res = await w.call({ ids: ['1', '1', '1'], action: 'skip' });
  ok(res.processed === 1 && res.succeeded.length === 1, 'duplicate ids in the request are de-duplicated before dispatch');
}

// Batch cap — Cloudflare subrequest guard: only the first RECEIPT_BULK_ACTION_MAX ids are
// processed per call; the rest come back as remaining_ids for the client to loop with, matching
// the /admin/share-attachments offset/limit convention this endpoint says it follows.
{
  const capMatch = src.match(/RECEIPT_BULK_ACTION_MAX = (\d+)/);
  const cap = Number(capMatch[1]);
  const bigTab = [];
  for (let i = 1; i <= cap + 5; i++) bigTab.push({ ID: String(i), Status: 'pending', Total: '1.00', Vendor: 'V', Active: 'TRUE' });
  const confirmCalls = [];
  const deps = {
    json: (o, status) => ({ status: status || 200, json: async () => o }),
    fetchTab: async () => bigTab.map(r => ({ ...r })),
    updateRow: async () => {},
    receiptReconConfirm: async (env, body) => { confirmCalls.push(body); return { status: 200, json: async () => ({ ok: true, success: true }) }; },
  };
  const code = `${CONSTS}\n${extract('receiptReconConfirmDuplicate', true)}\n${extract('receiptReconUnskip', true)}\n` +
    `${extract('receiptReconSkip', true)}\n${extract('receiptReconBulkAction', true)}\nreturn { receiptReconBulkAction };`;
  const names = Object.keys(deps);
  const fns = new Function(...names, code)(...names.map(n => deps[n]));
  const allIds = bigTab.map(r => r.ID);
  const first = await (await fns.receiptReconBulkAction({}, { ids: allIds, action: 'mark_duplicate' })).json();
  ok(first.processed === cap, `first call processes exactly RECEIPT_BULK_ACTION_MAX (${cap}) ids, not the whole selection at once`);
  ok(first.remaining_ids.length === 5 && first.remaining === 5, 'the remaining 5 ids come back in remaining_ids for the client to call again with');
  const second = await (await fns.receiptReconBulkAction({}, { ids: first.remaining_ids, action: 'mark_duplicate' })).json();
  ok(second.processed === 5 && second.remaining === 0, 'a second call with remaining_ids finishes the rest — the same "call again to continue" loop shape as runFullAudit/admin-share-attachments');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
