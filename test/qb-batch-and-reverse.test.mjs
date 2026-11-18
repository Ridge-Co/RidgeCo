// Nov 17 2026 — QuickBooks receipt emails go in ONE daily batch (never at confirm), with hold / reverse / send-now, reverse-after-send
// (qb_delete_needed + the "I deleted it in QuickBooks" tick), no double send, no swallowed failure. Run: node test/qb-batch-and-reverse.test.mjs
// Extracts the REAL functions from worker.js and runs them against fake Sheets / Drive / Gmail (same convention as receipt-expense-path.test.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
function extractFn(name) {
  let start = src.indexOf(`async function ${name}(`);
  if (start === -1) start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
const FNS = ['qbBatchStatus', 'qbBatchWaiting', 'qbBatchSendable', 'qbBatchSubject', 'qbBatchWrite', 'sendReceiptsToQBEmail', 'qbBatchAction', 'qbBatchDeleteDone', 'qbDeleteNeeded',
  'qbBatchQueuedNote', 'qbBatchListItem', 'qbBatchHoursUntil', 'qbBatchList', 'voidConfirmedReceiptForQueueRow', 'receiptReconUndo', 'receiptReconConfirm', 'receiptReconReassign',
  'findReceiptForQueueRow', '_rcNorm', 'receiptRowIsCustomerCard', 'schedRunDailyReceiptsPost'];
const jsonResp = (o, status = 200) => ({ status, json: async () => o, clone() { return this; } });

function world(opts = {}) {
  const tabs = {
    Receipts: [], Receipt_Recon_Queue: [], Work_Orders: [{ ID: 'WO-1', Description: 'tub drain', Property_ID: '85' }], Properties: [{ ID: '85', Address: '1864 Kerns School Rd' }],
  };
  const sent = [], reports = [], writes = [], irUnlinks = [];
  let nextId = 1000;
  const cols = new Set(opts.missingCols ? [] : ['QB_Email_Sent', 'QB_Email_Sent_Date', 'QB_Batch_Status', 'QB_Batch_Sent_Date', 'QB_Reversed_Date', 'QB_Email_Subject', 'QB_Batch_Error', 'QB_Delete_Confirmed', 'QB_Delete_Confirmed_Date', 'Active', 'Description', 'Status']);
  const flags = { failSendFor: new Set(), failSentWrite: false };
  const deps = {
    QB_BATCH_COLS: ['QB_Batch_Status', 'QB_Batch_Sent_Date', 'QB_Reversed_Date', 'QB_Email_Subject', 'QB_Batch_Error', 'QB_Delete_Confirmed', 'QB_Delete_Confirmed_Date'],
    QB_BATCH_MAX_PER_CALL: 8, QB_BATCH_DEFAULT_PER_CALL: 5,
    json: (o, s) => jsonResp(o, s),
    fetchTab: async (env, t) => (tabs[t] || []).map(r => ({ ...r })),
    fetchConfig: async () => ({ qb_receipts_email: 'qb@example.com' }),
    ensureColumns: async () => { if (opts.ensureFails) throw new Error('sheets down'); },
    updateRow: async (env, t, id, fields) => {
      writes.push({ t, id, fields });
      if (flags.failSentWrite && fields.QB_Email_Sent === 'TRUE') return jsonResp({ error: 'boom' }, 500);
      const r = (tabs[t] || []).find(x => String(x.ID) === String(id));
      if (!r) return jsonResp({ error: 'Row not found' }, 404);
      const usable = Object.keys(fields).filter(k => t !== 'Receipts' || cols.has(k) || ['Active', 'Description'].includes(k) || k in r);
      if (!usable.length) return jsonResp({ success: true, message: 'No matching fields' });
      for (const k of usable) r[k] = fields[k];
      return jsonResp({ success: true });
    },
    addReceipt: async (env, body) => { const id = String(nextId++); tabs.Receipts.push({ ID: id, Active: 'TRUE', QB_Email_Sent: 'FALSE', Store: body.store, Amount: String(body.amount), Date: body.date, WO_ID: body.wo_id, Property_ID: body.property_id, Category: body.category, Payment_Source: 'company_card', Source_File_ID: body.source_file_id, Description: body.description }); return jsonResp({ success: true, id, amount: String(body.amount) }); },
    scopeCoveringSignatureForWO: async () => null,
    appendReceiptToInvoiceReview: async () => ({ linked: true }),
    removeReceiptFromInvoiceReview: async (env, a) => { irUnlinks.push(a); return { unlinked: true }; },
    voidAttachmentForReceipt: async () => ({ voided: true }),
    _recoverReceiptSourceFile: (r) => ({ id: r.Source_File_ID || '', url: '' }),
    getAccessToken: async () => 't',
    driveDownload: async () => { if (opts.driveFails) throw new Error('drive 500'); return { bytes: new ArrayBuffer(2), mime: 'application/pdf' }; },
    bytesToB64: () => 'AA==',
    gmailSendEmailWithAttachment: async (env, m) => { if (flags.failSendFor.has(m.subject) || opts.gmailFails) throw new Error('Gmail send failed (HTTP 500)'); sent.push(m); return { sent: true }; },
    reportFailure: async (env, f) => { reports.push(f); return { ok: true }; },
    softFail: async (env, where, err, o) => { reports.push({ where, severity: (o && o.severity) || 'P2', ref: o && o.ref, err }); return { ok: false }; },
    fetchTabSoft: async (env, t) => ({ rows: (tabs[t] || []).map(r => ({ ...r })) }),
    _escHtml: (s) => String(s),
    setTimeout: (f) => f(),
    // scheduler pieces used by the daily job
    schedStep: async (name, fn, errors) => { try { const r = await fn(); return await r.json(); } catch (e) { errors.push({ step: name, error: String(e.message || e) }); } },
    schedAiStep: async () => ({ ok: true }),
    backfillItemsSummary: async () => jsonResp({ ok: true }),
    purgeConfirmedDuplicateReceipts: async () => jsonResp({ ok: true }),
    // list pieces
    schedReadConfigRows: async () => [], schedParseState: () => ({}), schedCell: () => '', SCHED_STATE_KEY: 'Scheduler_State', SCHED_JOBS: [{ name: 'daily_receipts_post', kind: 'daily', at: '07:00' }],
    schedEffective: () => ({ jobs: [{ name: 'daily_receipts_post', kind: 'daily', at: '07:00' }] }), schedEtParts: () => ({ date: '2026-11-18', minutes: 60 }), schedAtMinutes: (a) => { const [h, m] = a.split(':').map(Number); return h * 60 + m; },
  };
  const names = Object.keys(deps);
  const all = new Function(...names, FNS.map(extractFn).join('\n') + `\nreturn { ${FNS.join(', ')} };`)(...names.map(n => deps[n]));
  const call = async (fn, ...a) => { const r = await all[fn]({}, ...a); return r && typeof r.json === 'function' ? { status: r.status, ...(await r.json()) } : r; };
  return { tabs, sent, reports, writes, irUnlinks, flags, all, call, addRcpt(o) { const id = String(o.ID || nextId++); tabs.Receipts.push({ Active: 'TRUE', QB_Email_Sent: 'FALSE', Store: 'Home Depot', Amount: '10.00', Date: '2026-11-10', Payment_Source: 'company_card', ...o, ID: id }); return id; } };
}
const row = (w, id) => w.tabs.Receipts.find(r => r.ID === String(id));
const stuck = new Date(Date.now() - 3600e3).toISOString();

console.log('no immediate send at confirm / reassign');
{
  const w = world();
  w.tabs.Receipt_Recon_Queue.push({ ID: '1', Status: 'pending', Total: '50.22', Vendor: 'Home Depot', Receipt_Date: '2026-09-04', PO_Reference: 'x', Source_File_ID: 'F1', Suggestion: JSON.stringify({ category: 'billable' }) },
    { ID: '2', Status: 'pending', Total: '18.13', Vendor: 'Lowes', Receipt_Date: '2026-09-04', PO_Reference: 'y', Source_File_ID: 'F2', Suggestion: JSON.stringify({ category: 'billable' }) });
  const a = await w.call('receiptReconConfirm', { id: '1', no_wo: true, amount: '50.22', store: 'Home Depot', date: '2026-09-04', description: 'gloves' });
  const b = await w.call('receiptReconConfirm', { id: '2', wo_id: 'WO-1', property_id: '85', amount: '18.13', store: 'Lowes', date: '2026-09-04', description: 'pipe' });
  ok(w.sent.length === 0, 'a no-WO expense confirm sends NO email (used to send at once)');
  ok(a.qb_email && a.qb_email.queued === true && a.qb_email.sent === false && !a.qb_email.error, 'the no-WO answer says it is queued, not sent');
  ok(b.qb_email && b.qb_email.queued === true, 'a work-order confirm is queued the same way');
  ok(qbReady(w, a.id) && qbReady(w, b.id), 'both new Receipts rows are ready for the batch (no sent flag)');
  const s = await w.call('sendReceiptsToQBEmail', { ids: [a.id], limit: 1 });
  ok(s.queued === true && s.sent === 0 && w.sent.length === 0, 'an old-style immediate request (ids, no release) only queues: nothing is emailed');
}
function qbReady(w, id) { const r = row(w, id); return r && r.QB_Email_Sent === 'FALSE' && w.all.qbBatchStatus(r) === 'ready'; }

console.log('daily batch: ready sent, held / reimbursed / voided skipped, once');
{
  const w = world();
  const a = w.addRcpt({ Store: 'Home Depot', Amount: '12.34' }), b = w.addRcpt({ QB_Batch_Status: 'ready', WO_ID: 'WO-1' }), held = w.addRcpt({ QB_Batch_Status: 'held' });
  w.addRcpt({ Payment_Source: 'vendor_reimburse' }); w.addRcpt({ Active: 'FALSE' }); w.addRcpt({ QB_Email_Sent: 'TRUE', QB_Batch_Status: 'sent' }); w.addRcpt({ Non_Billable: 'TRUE', Non_Billable_Reason: 'customer_card' });
  const r = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(r.sent === 2 && w.sent.length === 2, 'only the two ready receipts were emailed');
  ok(r.held === 1 && row(w, held).QB_Batch_Status === 'held' && row(w, held).QB_Email_Sent === 'FALSE', 'the held receipt was NOT sent and stays held (reported in the answer)');
  ok(row(w, a).QB_Email_Sent === 'TRUE' && row(w, a).QB_Batch_Status === 'sent' && row(w, a).QB_Email_Sent_Date && row(w, a).QB_Email_Subject === 'Receipt — Home Depot — $12.34', 'sent flag, status, date and the subject that was sent are recorded');
  ok(w.sent[0].to === 'qb@example.com' && w.sent[0].attachment === null, 'goes to the configured QuickBooks address (no file on these rows)');
  const r2 = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(r2.sent === 0 && w.sent.length === 2, 'a second run sends nothing again (no double send)');
  await w.call('qbBatchAction', { receipt_id: held, action: 'release' });
  const r3 = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(r3.sent === 1 && row(w, held).QB_Email_Sent === 'TRUE', 'a released receipt goes in the next run');
}

console.log('paging: nothing silently dropped');
{
  const w = world(); const ids = []; for (let i = 0; i < 12; i++) ids.push(w.addRcpt({ Amount: String(10 + i) + '.00' }));
  const r1 = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(r1.sent === 5 && r1.remaining === 7, 'first call sends the per-call cap (5) and says 7 remain');
  const job = await w.call('schedRunDailyReceiptsPost');
  ok(job.partial === true && job.progress_made === true && job.ok === true, 'the daily job returns partial + progress_made so the scheduler resumes it');
  const r3 = await w.call('sendReceiptsToQBEmail', { release: true, limit: 50 });
  ok(r3.sent === 2 && r3.remaining === 0, 'a limit above the cap is clamped to 8 (5 sent by the job, 2 left)');
  ok(w.sent.length === 12 && new Set(w.sent.map(m => m.subject)).size === 12, 'all 12 were sent exactly once across the slices');
  const fin = await w.call('schedRunDailyReceiptsPost');
  ok(!fin.partial && fin.ok === true, 'with nothing left the job finishes normally (and runs the summary/purge steps)');
}

console.log('double-send protection and loud failures');
{
  const w = world({ missingCols: true }); const a = w.addRcpt({});
  const r = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(w.sent.length === 0 && r.failed.length === 1 && /NOT emailed/.test(r.failed[0].error), 'claim marker cannot be saved (column missing) -> the receipt is NOT emailed and the failure is returned');
  ok(w.reports.some(x => x.where === 'qb_batch.claim' && x.severity === 'P1'), '...and goes to the failure ledger (P1)');
  const w2 = world({ ensureFails: true }); w2.addRcpt({});
  const r2 = await w2.call('sendReceiptsToQBEmail', { release: true });
  ok(r2.ok === false && w2.sent.length === 0 && /nothing was emailed/.test(r2.error), 'columns cannot be ensured -> nothing is sent, the error is returned (not swallowed)');
}
{
  const w = world(); const a = w.addRcpt({ Store: 'Lowes', Amount: '19.31' }); w.flags.failSentWrite = true;
  const r = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(w.sent.length === 1 && r.failed.length === 1 && r.failed[0].emailed === true, 'email went but the sent flag could not be written -> reported as failed with emailed:true');
  ok(row(w, a).QB_Batch_Status === 'sending' && row(w, a).QB_Email_Sent === 'FALSE', 'the row is left claimed as sending');
  ok(w.reports.some(x => x.where === 'qb_batch.record_sent' && x.severity === 'P1'), 'the unsaved flag is in the failure ledger');
  w.flags.failSentWrite = false;
  const r2 = await w.call('sendReceiptsToQBEmail', { release: true }); const r3 = await w.call('sendReceiptsToQBEmail', { release: true, manual: true });
  ok(w.sent.length === 1 && r2.stuck === 1 && r3.sent === 0, 'a claimed row is NEVER re-sent by the next run or by Send batch now (no double send)');
  const job = await w.call('schedRunDailyReceiptsPost');
  ok(job.warnings && job.warnings.some(x => /stuck in "sending"/.test(x)), 'the daily job warns about the stuck row');
}
{
  const w = world(); const a = w.addRcpt({ Store: 'Menards', Amount: '5.00' }), b = w.addRcpt({ Store: 'Lowes', Amount: '6.00' }); w.flags.failSendFor.add('Receipt — Menards — $5.00');
  const r = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(r.sent === 1 && r.failed.length === 1 && row(w, a).QB_Batch_Status === 'failed' && /Gmail send failed/.test(row(w, a).QB_Batch_Error), 'a send failure marks only that receipt failed, with the error shown, and the rest still go');
  ok(w.reports.some(x => x.where === 'qb_batch.send' && x.ref === a && x.severity === 'P1'), 'the failure is in the failure ledger');
  const again = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(again.sent === 0 && w.sent.length === 1, 'a failed row is not retried the same day (no loop)');
  w.flags.failSendFor.clear();
  const man = await w.call('sendReceiptsToQBEmail', { release: true, manual: true });
  ok(man.sent === 1 && row(w, a).QB_Email_Sent === 'TRUE', 'Send batch now retries it');
  const w2 = world(); const c = w2.addRcpt({ QB_Batch_Status: 'failed', QB_Batch_Sent_Date: new Date(Date.now() - 86400e3 * 2).toISOString() });
  const n = await w2.call('sendReceiptsToQBEmail', { release: true });
  ok(n.sent === 1, "a receipt that failed on an earlier day is retried by the next day's batch");
  const w3 = world({ gmailFails: true }); w3.addRcpt({});
  const job = await w3.call('schedRunDailyReceiptsPost');
  ok(job.ok === false && job.errors.some(e => /could not be sent to QuickBooks/.test(e.error)) && job.no_retry === true, 'the daily job reports the failure (ok:false) and is not blindly retried');
  const w4 = world({ driveFails: true }); w4.addRcpt({ Source_File_ID: 'F9' });
  const d = await w4.call('sendReceiptsToQBEmail', { release: true });
  ok(d.sent === 1 && d.sent_without_attachment === 1 && d.warnings.length === 1 && w4.reports.some(x => x.where === 'sendReceiptsToQB:attachment' && x.severity === 'P1'), 'a Drive failure still sends the email but is reported (answer + ledger), not hidden');
}

console.log('hold / release / mark-sent actions');
{
  const w = world(); const a = w.addRcpt({}), s = w.addRcpt({ QB_Batch_Status: 'sending', QB_Batch_Sent_Date: stuck }), done = w.addRcpt({ QB_Email_Sent: 'TRUE', QB_Batch_Status: 'sent' });
  ok((await w.call('qbBatchAction', { receipt_id: a, action: 'hold' })).status === 'held' && row(w, a).QB_Batch_Status === 'held', 'hold');
  ok((await w.call('qbBatchAction', { receipt_id: a, action: 'release' })).status === 'ready', 'release');
  ok((await w.call('qbBatchAction', { receipt_id: s, action: 'hold' })).status === 409, 'cannot hold a receipt that is being sent');
  ok((await w.call('qbBatchAction', { receipt_id: done, action: 'hold' })).status === 409, 'cannot hold an already-sent receipt');
  ok((await w.call('qbBatchAction', { receipt_id: a, action: 'mark_sent' })).status === 409, 'mark_sent only for a stuck sending row');
  const m = await w.call('qbBatchAction', { receipt_id: s, action: 'mark_sent' });
  ok(m.status === 'sent' && row(w, s).QB_Email_Sent === 'TRUE', 'a stuck row can be marked as sent after checking');
  ok((await w.call('qbBatchAction', { receipt_id: a, action: 'zap' })).status === 400, 'unknown action refused');
}

console.log('reverse BEFORE send');
{
  const w = world(); const rid = w.addRcpt({ Store: 'Home Depot', Amount: '50.22', WO_ID: 'WO-1' });
  w.tabs.Receipt_Recon_Queue.push({ ID: '5', Status: 'confirmed', Confirmed_Receipt_ID: rid, Confirmed_Amount: '50.22', Total: '50.22', Vendor: 'Home Depot', Receipt_Date: '2026-11-10' });
  const r = await w.call('receiptReconUndo', { id: '5' });
  ok(r.ok && r.qb_delete_needed === null && row(w, rid).Active === 'FALSE', 'undo before send voids the row and needs nothing in QuickBooks');
  ok(w.tabs.Receipt_Recon_Queue[0].Status === 'pending' && w.irUnlinks.length === 1, 'queue row back to pending, invoice amount removed');
  const s = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(s.sent === 0 && w.sent.length === 0, 'a reversed receipt is never emailed');
}

console.log('reverse AFTER send -> qb_delete_needed, resend works');
{
  const w = world(); const rid = w.addRcpt({ Store: "Lowe's", Amount: '19.31', Date: '2026-11-12', WO_ID: '' });
  w.tabs.Receipt_Recon_Queue.push({ ID: '196', Status: 'confirmed', Confirmed_Receipt_ID: rid, Confirmed_Amount: '19.31', Total: '19.31', Vendor: "Lowe's", Receipt_Date: '2026-11-12', Invoice_Number: 'INV-77' });
  await w.call('sendReceiptsToQBEmail', { release: true });
  ok(row(w, rid).QB_Email_Sent === 'TRUE', 'the receipt was emailed first');
  const r = await w.call('receiptReconUndo', { id: '196' });
  ok(r.ok === true && !r.error, 'undo of an ALREADY-SENT receipt now works (was a 409)');
  const n = r.qb_delete_needed;
  ok(n && n.vendor === "Lowe's" && n.amount === '19.31' && n.receipt_date === '2026-11-12' && n.hub_receipt_number === rid && n.email_subject === "Receipt — Lowe's — $19.31" && n.qb_email_sent_date, 'qb_delete_needed carries vendor, amount, receipt date, Hub receipt #, subject sent and sent date');
  ok(row(w, rid).Active === 'FALSE' && row(w, rid).QB_Email_Sent === 'TRUE' && row(w, rid).QB_Reversed_Date && row(w, rid).QB_Delete_Confirmed === 'FALSE', 'Hub side voided exactly like before; sent history kept; QB_Reversed_Date recorded');
  ok(w.irUnlinks.length === 1 && w.tabs.Receipt_Recon_Queue[0].Status === 'pending' && w.tabs.Receipt_Recon_Queue[0].Confirmed_Receipt_ID === '', 'invoice amount removed, queue row back to pending, Confirmed_* cleared');
  const list = await w.call('qbBatchList');
  ok(list.cleanup.length === 1 && list.cleanup[0].receipt_id === rid && list.items.length === 0, 'the QuickBooks clean-up stays in the list until ticked; the voided row is not in the waiting list');
  // corrected re-confirm -> NEW row, sends
  const c = await w.call('receiptReconConfirm', { id: '196', no_wo: true, amount: '19.31', store: "Lowe's", date: '2026-11-12', description: 'fixed' });
  ok(c.id && c.id !== rid && qbReady(w, c.id), 'a corrected re-confirm writes a NEW Receipts row that is ready (not blocked by the old sent flag)');
  const s = await w.call('sendReceiptsToQBEmail', { release: true });
  ok(s.sent === 1 && w.sent.length === 2 && row(w, c.id).QB_Email_Sent === 'TRUE', 'the corrected receipt is sent; the reversed one is not sent again');
  const t = await w.call('qbBatchDeleteDone', { receipt_id: rid, done: true });
  ok(t.ok && row(w, rid).QB_Delete_Confirmed === 'TRUE' && row(w, rid).QB_Delete_Confirmed_Date, 'the "I deleted it in QuickBooks" tick is recorded with a date');
  ok((await w.call('qbBatchList')).cleanup.length === 0, 'a ticked clean-up leaves the list');
  ok((await w.call('qbBatchDeleteDone', { receipt_id: c.id, done: true })).status === 409, 'cannot tick a receipt that was never reversed after sending');
}
{
  const w = world(); const rid = w.addRcpt({ QB_Batch_Status: 'sending', QB_Batch_Sent_Date: stuck });
  w.tabs.Receipt_Recon_Queue.push({ ID: '9', Status: 'confirmed', Confirmed_Receipt_ID: rid, Confirmed_Amount: '10.00', Total: '10.00', Vendor: 'Home Depot', Receipt_Date: '2026-11-10' });
  const r = await w.call('receiptReconUndo', { id: '9' });
  ok(r.status === 409 && /being emailed/.test(r.error) && row(w, rid).Active === 'TRUE', 'a receipt claimed by a sender (maybe in flight) cannot be reversed until released or marked sent');
}
{
  const w = world(); const rid = w.addRcpt({ Store: 'Home Depot', Amount: '30.00', Date: '2026-11-10', Property_ID: '85', QB_Email_Sent: 'TRUE', QB_Email_Sent_Date: '2026-11-11T07:00:00Z', QB_Batch_Status: 'sent' });
  w.tabs.Receipt_Recon_Queue.push({ ID: '7', Status: 'confirmed', Confirmed_Receipt_ID: rid, Confirmed_Amount: '30.00', Total: '30.00', Vendor: 'Home Depot', Receipt_Date: '2026-11-10', Source_File_ID: 'F7' });
  const r = await w.call('receiptReconReassign', { id: '7', property_id: '85', amount: '30.00', store: 'Home Depot', date: '2026-11-10', description: 'moved' });
  ok(r.ok && r.qb_delete_needed && r.qb_delete_needed.receipt_id === rid && row(w, rid).Active === 'FALSE' && row(w, rid).QB_Reversed_Date, 'reassign of an already-sent receipt works and returns qb_delete_needed');
  ok(r.id && qbReady(w, r.id) && r.qb_email.queued === true && w.sent.length === 0, 'the replacement row waits in the batch (no immediate send)');
}

console.log('review list pieces');
{
  const w = world(); w.addRcpt({ QB_Batch_Status: 'held', Receipt_Number: 'R-5' }); w.addRcpt({ QB_Batch_Status: 'failed', QB_Batch_Error: 'boom' });
  const q = w.addRcpt({ WO_ID: 'WO-1', Property_ID: '85' });
  w.tabs.Receipt_Recon_Queue.push({ ID: '3', Status: 'confirmed', Confirmed_Receipt_ID: q, Invoice_Number: 'Q-9' });
  const l = await w.call('qbBatchList');
  const it = l.items.find(i => i.receipt_id === q);
  ok(l.total === 3 && l.counts.held === 1 && l.counts.failed === 1 && l.counts.ready === 1, 'list counts ready / held / failed');
  ok(it.queue_id === '3' && it.can_reverse === true && it.receipt_number === 'Q-9' && it.wo_id === 'WO-1' && /tub drain/.test(it.wo_description) && it.property_address === '1864 Kerns School Rd', 'each item has vendor, amount, date, receipt number, WO / property and a Reverse link to its queue row');
  ok(l.items.find(i => i.status === 'held').can_reverse === false && l.items.find(i => i.status === 'held').receipt_number === 'R-5', 'a receipt not made in the Reconciler has no Reverse (hold only) and shows its own receipt number');
  ok(l.next_send && l.next_send.at === '07:00' && typeof l.next_send.hours_until === 'number', 'the list says when the daily send is');
  const h = w.all.qbBatchHoursUntil;
  ok(h({ date: '2026-11-18', minutes: 60 }, '07:00', '2026-11-17') === 6 && h({ date: '2026-11-18', minutes: 8 * 60 }, '07:00', '2026-11-17') === 0 && h({ date: '2026-11-18', minutes: 8 * 60 }, '07:00', '2026-11-18') === 23, 'hours until the send: before the slot, overdue, already ran today');
}

console.log('send time = midnight Eastern (Brett, Nov 17 2026)');
{
  const gs = readFileSync(join(here, '..', 'apps-script', 'hub-scheduler', 'HubScheduler.gs'), 'utf8');
  ok(/\{ name: 'daily_receipts_post', run: 'hub', at: '00:00',\s+enabled: true/.test(gs), 'the Apps Script JOBS table sends the QuickBooks batch at 00:00 (midnight Eastern)');
  ok(/\{ name: 'daily_receipts',\s+run: 'hub', at: '07:00'/.test(gs), 'the receipt inbox scan keeps its 07:00 slot');
  ok(/"timeZone": "America\/New_York"/.test(readFileSync(join(here, '..', 'apps-script', 'hub-scheduler', 'appsscript.json'), 'utf8')), 'the Apps Script project time zone is already America/New_York (no change needed)');
  const apply = new Function('SCHED_OVERRIDE_FIELDS', 'SCHED_EVERY_MIN_MAX', 'schedHumanEvery', extractFn('schedApplyOverrides') + '\nreturn schedApplyOverrides;')(['enabled', 'every_min', 'at', 'dow'], 1440, () => 15);
  const r = apply([{ name: 'daily_receipts_post', kind: 'daily', at: '07:00' }], { daily_receipts_post: { at: '00:00' } });
  ok(!r.errors.length && r.applied.daily_receipts_post && r.applied.daily_receipts_post.at === '00:00' && r.jobs[0].at === '00:00', 'the Hub accepts and applies a 00:00 override for the daily job');
  const hh = world().all.qbBatchHoursUntil;
  ok(hh({ date: '2026-11-18', minutes: 22 * 60 }, '00:00', '2026-11-18') === 2 && hh({ date: '2026-11-18', minutes: 60 }, '00:00', '2026-11-18') === 23, 'hours until the midnight send, once it has run today: 2 h at 10 PM, 23 h at 1 AM');
  ok(hh({ date: '2026-11-18', minutes: 5 }, '00:00', '2026-11-17') === 0, 'just after midnight and not yet run today: due now (next scheduler check)');
  ok(/function qbbClock\(at\)/.test(readFileSync(join(here, '..', 'receipt-reconciler.html'), 'utf8')) && /\(midnight\)/.test(readFileSync(join(here, '..', 'receipt-reconciler.html'), 'utf8')), 'the page words 00:00 as "12:00 AM (midnight)"');
}

console.log('wiring');
ok(/\/receipts\/qb-batch'\)\s+return await qbBatchList\(env\)/.test(src) && /'\/receipts\/qb-batch\/send-now'\) return await sendReceiptsToQBEmail\(env, \{ limit: body && body.limit, ids: body && body.ids, release: true, manual: true \}\)/.test(src), 'list and send-now are routed (send-now passes release:true)');
ok(/'\/receipts\/qb-batch\/action'\) return await qbBatchAction/.test(src) && /'\/receipts\/qb-batch\/delete-done'\) return await qbBatchDeleteDone/.test(src), 'action and delete-done are routed');
ok(!/sendReceiptsToQBEmail\(env, \{ ids:/.test(src) && (src.match(/sendReceiptsToQBEmail\(/g) || []).length === 4, 'no caller asks for an immediate one-receipt send any more (only the job and the two explicit routes call the sender)');
ok(/path === '\/receipts\/qb-batch\/action' \|\| path === '\/receipts\/qb-batch\/delete-done'/.test(src) && /path === '\/receipts\/qb-batch\/send-now'/.test(src), 'staging test token gating covers the new write routes (TEST receipts only)');
const ui = readFileSync(join(here, '..', 'receipt-reconciler.html'), 'utf8');
ok(/id="qb-batch-section"/.test(ui) && /Waiting to send to QuickBooks/.test(ui) && /qbbSendNow/.test(ui) && /Delete this in QuickBooks by hand/.test(ui) && /I deleted it in QuickBooks/.test(ui), 'the page has the Waiting list, Send batch now and the delete-in-QuickBooks box with its checkbox');
ok(/qbbShowDeleteNeeded\(res\.qb_delete_needed\)/.test(ui) && (ui.match(/qb_delete_needed/g) || []).length >= 6, 'undo, mark-refund, reassign and the list Reverse all show the delete-in-QuickBooks box');
ok(!/the 7am sweep will retry|straight to QuickBooks/.test(ui), 'the page no longer promises an immediate QuickBooks send');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
