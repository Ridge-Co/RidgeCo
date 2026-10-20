// Phase C batch w1 (Oct 20 2026): fault-injection tests for the swallowed-error sites converted in worker.js lines 1-4956 (base 1dd7520).
// Extracts the REAL functions from worker.js, FORCES each failure and asserts: (a) it is reported with the right severity,
// (b) the caller still returns what it did before (or now says so where "done" was falsely claimed), (c) the happy path reports nothing.
// Run: node test/cw1-silent-failures.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
function grab(name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}
const constLine = (n) => { const m = new RegExp('^(?:const|let) ' + n + ' = .*?;(?:[ ]*//.*)?$', 'm').exec(src); if (!m) throw new Error('missing ' + n); return m[0]; };
console.error = () => {};

// ── recorder: every softNote / softFail the code under test makes ──
let LOG;
const resetLog = () => { LOG = { notes: [], fails: [] }; };
resetLog();
const softNote = (where, err, severity, context) => { LOG.notes.push({ where, severity, msg: String((err && err.message) || err) }); return true; };
const softFail = async (env, where, err, severity, context) => { LOG.fails.push({ where, severity, msg: String((err && err.message) || err), context }); return { ok: false, error: String((err && err.message) || err), reported: true }; };
const reported = (where) => LOG.notes.concat(LOG.fails).filter(r => r.where === where || r.where.startsWith(where));
const anyReport = () => LOG.notes.length + LOG.fails.length;
// real helpers (their own behaviour is covered in soft-fail-helpers.test.mjs); here they feed the recorder above
const parseJsonCell = new Function('softNote', grab('parseJsonCell') + '\nreturn parseJsonCell;')(softNote);
const safeJson = new Function('softNote', grab('safeJson') + '\nreturn safeJson;')(softNote);
const tryWrite = new Function('softFail', grab('tryWrite') + '\nreturn tryWrite;')(softFail);
const json = (d, s = 200) => ({ status: s, ok: s < 400, _d: d, clone() { return this; }, json: async () => d });
const BASE = { softNote, softFail, parseJsonCell, safeJson, tryWrite, json };
function load(names, deps) {
  const all = Object.assign({}, BASE, deps);
  const keys = Object.keys(all);
  const body = names.map(n => (/^(const|let) /.test(n) ? n : grab(n))).join('\n') + '\nreturn {' + names.filter(n => !/^(const|let) /.test(n)).join(',') + '};';
  return new Function(...keys, body)(...keys.map(k => all[k]));
}
const env = {};

// ───────────────────────── 1. pure parsers of stored cells ─────────────────────────
console.log('scopeParseItems / scopeParseMaterialsPricing (stored JSON cells)');
{
  resetLog();
  const { scopeParseItems, scopeParseMaterialsPricing } = load(['scopeParseItems', constLine('SCOPE_MATERIALS_MODES'), 'scopeCleanMaterialsPricing', 'scopeParseMaterialsPricing']);
  ok(scopeParseItems({ Line_Items: '[{"id":"a"}]' }).length === 1 && anyReport() === 0, 'valid line items parse, nothing reported');
  ok(scopeParseItems({ Line_Items: '' }).length === 0 && scopeParseItems(null).length === 0 && anyReport() === 0, 'an empty cell is an empty scope, nothing reported');
  ok(scopeParseItems({ Line_Items: '[{broken' }).length === 0 && reported('json_cell_corrupt:Scopes.Line_Items').length === 1, 'corrupt Line_Items still reads as [] but is reported');
  ok(scopeParseItems({ Line_Items: '{"a":1}' }).length === 0, 'a non-array value still reads as []');
  resetLog();
  ok(scopeParseMaterialsPricing({ Materials_Pricing_JSON: '{"mode":"at_cost"}' }).mode === 'at_cost' && anyReport() === 0, 'valid materials pricing is used, nothing reported');
  ok(scopeParseMaterialsPricing({}).mode === 'markup' && scopeParseMaterialsPricing({ Materials_Pricing_JSON: '  ' }).mode === 'markup' && anyReport() === 0, 'no stored choice = default markup, nothing reported');
  const bad = scopeParseMaterialsPricing({ ID: '7', Materials_Pricing_JSON: '{nope' });
  ok(bad.mode === 'markup' && LOG.notes.length === 1 && LOG.notes[0].where === 'scope_materials_pricing_corrupt' && LOG.notes[0].severity === 'P1', 'corrupt pricing choice: still markup, reported P1 (it changes a customer price)');
  resetLog();
  const inv = scopeParseMaterialsPricing({ ID: '7', Materials_Pricing_JSON: '{"mode":"bogus"}' });
  ok(inv.mode === 'markup' && LOG.notes.length === 1 && LOG.notes[0].where === 'scope_materials_pricing_invalid' && LOG.notes[0].severity === 'P1', 'valid JSON with an invalid mode: still markup, reported P1');
}

// ───────────────────────── 2. audit / lockout writes (P1) ─────────────────────────
console.log('\nlogVendorContactChange / clearPinLockout');
{
  resetLog();
  let fail = true;
  const { logVendorContactChange, clearPinLockout } = load(['logVendorContactChange', 'clearPinLockout'], {
    ensureTab: async () => {}, addRow: async () => { if (fail) throw new Error('Sheets 503'); return json({ ok: true }); },
    sheetsRequest: async (e, m, p) => { if (fail) throw new Error('Sheets 429'); return { values: [['PIN', 'Fail_Count', 'Locked_Until'], ['1234', '3', 'x']] }; },
    col: (i) => 'ABC'[i],
  });
  let threw = false; try { await logVendorContactChange(env, 'V1', 'Acme', 'phone', 'a', 'b', 'vendor'); } catch (e) { threw = true; }
  ok(!threw && reported('vendor_contact_history_write_failed').length === 1 && LOG.fails[0].severity === 'P1', 'history write failure: caller does not throw, reported P1');
  resetLog(); threw = false; try { await clearPinLockout(env, '1234'); } catch (e) { threw = true; }
  ok(!threw && reported('pin_lockout_clear_failed').length === 1 && LOG.fails[0].severity === 'P1', 'lockout reset failure: login proceeds, reported P1');
  resetLog(); fail = false;
  await logVendorContactChange(env, 'V1', 'Acme', 'phone', 'a', 'b', 'vendor'); await clearPinLockout(env, '1234');
  ok(anyReport() === 0, 'happy path reports nothing');
}

// ───────────────────────── 3. addReceipt: ensureColumns + attachments gallery ─────────────────────────
console.log('\naddReceipt');
{
  let ecFail, galleryFail, telemetryFail;
  const rows = [];
  const mk = () => load(['addReceipt'], {
    findRecentDuplicate: async () => null,
    ensureColumns: async (e, tab) => { if (tab === 'Receipts' && ecFail) throw new Error('quota'); if (tab === 'Attachments' && galleryFail) throw new Error('attachments tab gone'); },
    addRow: async (e, tab, r) => { if (tab === 'Attachments' && galleryFail) throw new Error('attachments write failed'); rows.push([tab, r]); return json({ success: true, id: '77' }); },
    logTelemetry: async () => { if (telemetryFail) throw new Error('telemetry down'); },
  }).addReceipt;
  const call = async () => (await mk()(env, { wo_id: 'WO-1', amount: '12.50', store: 'HD', source_file_id: 'F1', added_by: 'x', added_by_id: '1' })).json();
  ecFail = true; galleryFail = false; telemetryFail = false; resetLog();
  let r = await call();
  ok(r.success && r.id === '77' && !r.failure_warning && reported('receipt_add_ensure_columns').length === 1 && LOG.fails[0].severity === 'P1', 'ensureColumns failure: receipt still saved, reported P1');
  ecFail = false; galleryFail = true; resetLog();
  r = await call();
  ok(r.success && r.id === '77' && /image could not be added/.test(r.failure_warning || ''), 'gallery write failure: receipt saved AND the response now says the image was not attached');
  telemetryFail = true; resetLog();
  r = await call();
  ok(r.success && reported('telemetry_write_failed:receipt_attachment_gallery_write').length === 1 && reported('telemetry_write_failed:receipt_attachment_gallery_write')[0].severity === 'P2', 'telemetry write failure inside that catch is reported (P2), not swallowed');
  galleryFail = false; telemetryFail = false; resetLog();
  r = await call();
  ok(r.success && r.failure_warning === undefined && anyReport() === 0, 'happy path: no warning field, nothing reported');
}

// ───────────────────────── 4. receiptAddJson + confirm flows ─────────────────────────
console.log('\nreceiptAddJson (addReceipt response body)');
{
  resetLog();
  const { receiptAddJson } = load(['receiptAddJson']);
  const good = await receiptAddJson(env, { status: 200, json: async () => ({ success: true, id: '5' }) }, 'confirm');
  ok(good.success && good.id === '5' && anyReport() === 0, 'readable body passes through untouched');
  const bad = await receiptAddJson(env, { status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }, 'confirm');
  ok(!bad.success && /unreadable response \(HTTP 502\)/.test(bad.error) && reported('receipt_add_response_unreadable:confirm').length === 1 && LOG.fails[0].severity === 'P1', 'unreadable body: reported P1 and handed back as { error } instead of {}');
}
console.log('\nreceiptReconBulkAction');
{
  resetLog();
  const { receiptReconBulkAction } = load([constLine('RECEIPT_BULK_ACTIONS'), constLine('RECEIPT_BULK_ACTION_MAX'), 'receiptReconBulkAction'], {
    receiptReconSkip: async (e, b) => (b.id === 'bad' ? { json: async () => { throw new SyntaxError('not json'); } } : (b.id === 'err' ? json({ error: 'nope' }) : json({ ok: true }))),
  });
  const r = await (await receiptReconBulkAction(env, { action: 'skip', ids: ['a', 'bad', 'err'] })).json();
  ok(r.succeeded.length === 1 && r.failed.length === 2 && r.failed.some(f => f.id === 'bad'), 'an unreadable result counts as FAILED, not succeeded');
  ok(reported('receipt_bulk_action_item_failed:skip').length === 1 && LOG.notes[0].severity === 'P1', 'and is reported P1');
}

// ───────────────────────── 5. listReceiptReconQueue (cells + read) ─────────────────────────
console.log('\nlistReceiptReconQueue');
{
  let rowsOut = [{ ID: '1', Status: 'pending', Suggestion: '{bad', Items: '[1]', Items_Summary: '', Duplicate_Evidence_JSON: '', Rescan_Match_JSON: '' }];
  let readFail = false;
  const { listReceiptReconQueue } = load(['listReceiptReconQueue'], { fetchTab: async () => { if (readFail) throw new Error('read 500'); return rowsOut; }, receiptReconRowView: (x) => x });
  resetLog();
  let res;
  try { res = await (await listReceiptReconQueue(env, new URL('https://x/receipt-recon/queue?status=pending'))).json(); } catch (e) { res = { threw: String(e) }; }
  ok(Array.isArray(res) && res.length === 1 && res[0].items.length === 1, 'queue list runs and still returns the row with parsed cells', res);
  ok(reported('json_cell_corrupt:Receipt_Recon_Queue.Suggestion').length === 1 && reported('json_cell_corrupt:Receipt_Recon_Queue.Items').length === 0 && reported('json_cell_corrupt:Receipt_Recon_Queue.Items_Summary').length === 0, 'only the corrupt cell is reported; empty cells are quiet');
  // Regression (reviewer, Oct 20): a Manual_Refund row reassigns `suggestion`; it must not be const
  rowsOut = [{ ID: '2', Status: 'pending', Manual_Refund: 'TRUE', Suggestion: '{"category":"expense"}', Items: '', Items_Summary: '', Duplicate_Evidence_JSON: '', Rescan_Match_JSON: '' }];
  resetLog();
  try { res = await (await listReceiptReconQueue(env, new URL('https://x/receipt-recon/queue?status=pending'))).json(); } catch (e) { res = { threw: String(e) }; }
  ok(Array.isArray(res) && res[0] && res[0].suggestion && res[0].suggestion.category === 'refund' && res[0].suggestion.manual_refund === true, 'Manual_Refund row: queue still loads and shows category refund', res);
  readFail = true; resetLog();
  res = await (await listReceiptReconQueue(env, new URL('https://x/receipt-recon/queue'))).json();
  ok(Array.isArray(res) && res.length === 0 && reported('receipt_recon_queue_list_read').length === 1 && LOG.fails[0].severity === 'P1', 'read failure: still [] for the old UI, but reported P1');
}

// ───────────────────────── 6. scope helpers ─────────────────────────
console.log('\nscopeAddr');
{
  let propFail = false, unitFail = false;
  const { scopeAddr } = load(['scopeAddr'], { fetchTab: async (e, t) => { if (t === 'Properties') { if (propFail) throw new Error('p read'); return [{ ID: 'P1', Address: '1 Main St' }]; } if (unitFail) throw new Error('u read'); return [{ ID: 'U1', Unit_Label: '2F' }]; } });
  resetLog(); ok(await scopeAddr(env, { ID: 's', Property_ID: 'P1', Unit_ID: 'U1' }) === '1 Main St Unit 2F' && anyReport() === 0, 'happy path: address with unit label, nothing reported');
  unitFail = true; resetLog(); ok(await scopeAddr(env, { ID: 's', Property_ID: 'P1', Unit_ID: 'U1' }) === '1 Main St Unit U1' && reported('scopeAddr_units_read').length === 1 && LOG.fails[0].severity === 'P2', 'units read fails: raw Unit_ID fallback kept, reported P2');
  unitFail = false; propFail = true; resetLog(); ok(await scopeAddr(env, { ID: 's', Property_ID: 'P1' }) === '' && reported('scopeAddr_properties_read').length === 1, 'properties read fails: blank address as before, reported');
}
console.log('\nscopeSplit');
{
  let childBody = 'ok'; const updates = [];
  const { scopeSplit } = load(['scopeSplit'], {
    scopesTab: async () => {}, scopeFind: async () => ({ ID: '9', Property_ID: 'P', Title: 'T', Line_Items: '[{"id":"a"},{"id":"b"}]' }),
    scopeParseItems: (s) => parseJsonCell(s.Line_Items, [], 'x'),
    addRow: async () => (childBody === 'ok' ? json({ id: '10' }) : { json: async () => { throw new SyntaxError('html'); } }),
    updateRow: async (e, t, id, f) => { updates.push([t, id]); },
  });
  resetLog();
  let r = await scopeSplit(env, { scope_id: '9', line_item_ids: ['a'], remove_from_parent: true });
  let j = await r.json();
  ok(j.success && j.id === '10' && j.moved === 1 && updates.length === 1 && anyReport() === 0, 'happy path unchanged: child created, parent trimmed, nothing reported');
  childBody = 'bad'; updates.length = 0; resetLog();
  r = await scopeSplit(env, { scope_id: '9', line_item_ids: ['a'], remove_from_parent: true }); j = await r.json();
  ok(r.status === 502 && j.error && updates.length === 0 && reported('scopeSplit_child_response_unreadable').length === 1 && LOG.fails[0].severity === 'P1', 'unreadable create response: 502 with a plain message, parent NOT trimmed, reported P1');
}
console.log('\nscopeToWO');
{
  let ecFail = false, attFail = false;
  const { scopeToWO } = load(['scopeToWO'], {
    scopesTab: async () => {}, scopeFind: async () => ({ ID: '3', Property_ID: 'P', Unit_ID: '', Room: '', Line_Items: JSON.stringify([{ id: 'a', description: 'fix', area: 'Kitchen' }]) }),
    scopeParseItems: (s) => parseJsonCell(s.Line_Items, [], 'x'),
    createWorkOrder: async () => json({ id: 'WO-5' }),
    ensureColumns: async () => { if (ecFail) throw new Error('quota'); },
    updateWOFields: async () => {}, updateRow: async () => {},
    fetchTab: async () => { if (attFail) throw new Error('att read'); return [{ ID: 'A1', WO_ID: 'SCOPE-3', Active: 'TRUE' }]; },
  });
  resetLog(); let j = await (await scopeToWO(env, { scope_id: '3' })).json();
  ok(j.success && j.wo_id === 'WO-5' && j.photos_moved === 1 && j.failure_warnings === undefined && anyReport() === 0, 'happy path: no warnings field, nothing reported');
  ecFail = true; resetLog(); j = await (await scopeToWO(env, { scope_id: '3' })).json();
  ok(j.success && Array.isArray(j.failure_warnings) && /Scope_ID/.test(j.failure_warnings[0]) && reported('scopeToWO_ensure_scope_id_column').length === 1 && LOG.fails[0].severity === 'P1', 'ensureColumns failure: WO still created, warning shown, reported P1');
  ecFail = false; attFail = true; resetLog(); j = await (await scopeToWO(env, { scope_id: '3' })).json();
  ok(j.success && j.photos_moved === 0 && /photos/.test((j.failure_warnings || [''])[0]) && reported('scopeToWO_move_photos').length === 1, 'photo move failure: WO created, warning shown, reported P1');
}
console.log('\nscopeEstimate');
{
  let woFail = false;
  const { scopeEstimate } = load(['scopeEstimate'], {
    scopesTab: async () => {}, scopeFind: async () => ({ ID: '3', Status: 'draft', WO_ID: 'WO-5' }),
    updateRow: async () => {}, setApprovalStage: async () => {}, plausiblyNonEnglish: () => false, translateBatchToEnglish: async () => ({ ok: false }),
    ensureColumns: async () => {}, updateWOFields: async () => { if (woFail) throw new Error('wo write'); },
  });
  resetLog(); let j = await (await scopeEstimate(env, { scope_id: '3', vendor_id: 'V1' })).json();
  ok(j.success && j.failure_warning === undefined && anyReport() === 0, 'happy path: plain { success:true }');
  woFail = true; resetLog(); j = await (await scopeEstimate(env, { scope_id: '3', vendor_id: 'V1' })).json();
  ok(j.success && /not updated with the new vendor/.test(j.failure_warning || '') && reported('scopeEstimate_wo_vendor_sync').length === 1 && LOG.fails[0].severity === 'P1', 'WO vendor sync failure: saved, but the response says the WO was not updated, reported P1');
}
console.log('\nbackfills');
{
  let readFail = null, writeFail = false; const writes = [];
  const deps = {
    fetchTab: async (e, t) => { if (t === readFail) throw new Error(t + ' read'); return t === 'Scopes' ? [{ ID: 's', WO_ID: 'w', Vendor_ID: 'v' }] : t === 'Work_Orders' ? [{ ID: 'w', Vendor_ID: '' }] : t === 'Receipts' ? [{ ID: 'r', Active: 'TRUE', WO_ID: 'w', Source_File_ID: 'F' }] : []; },
    updateWOFields: async (e, id, f) => { writes.push(id); },
    scopeBackfillEligible: (s, w) => !!(s && w && s.WO_ID && s.Vendor_ID && !w.Vendor_ID),
    ensureColumns: async () => {}, addRow: async () => { if (writeFail) throw new Error('add failed'); writes.push('att'); }, logTelemetry: async () => {},
  };
  const { backfillScopeWOVendor, backfillReceiptAttachments } = load(['backfillScopeWOVendor', 'backfillReceiptAttachments'], deps);
  resetLog(); let r = await backfillScopeWOVendor(env); let j = await r.json();
  ok(j.success && j.wo_vendor_backfilled === 1 && anyReport() === 0, 'vendor backfill happy path unchanged');
  readFail = 'Work_Orders'; writes.length = 0; resetLog(); r = await backfillScopeWOVendor(env); j = await r.json();
  ok(r.status === 500 && j.success === false && /Work_Orders/.test(j.error) && writes.length === 0 && reported('backfillScopeWOVendor_read:Work_Orders').length === 1 && LOG.fails[0].severity === 'P1', 'vendor backfill: unreadable tab = stop + say so + reported (was "success, nothing to do")');
  readFail = null; writes.length = 0; resetLog(); r = await backfillReceiptAttachments(env, { apply: true }); j = await r.json();
  ok(j.success && j.attachments_created === 1 && j.attachments_failed === undefined && anyReport() === 0, 'receipt backfill happy path unchanged');
  readFail = 'Attachments'; writes.length = 0; resetLog(); r = await backfillReceiptAttachments(env, { apply: true }); j = await r.json();
  ok(r.status === 500 && j.success === false && writes.length === 0 && reported('backfillReceiptAttachments_read:Attachments').length === 1, 'receipt backfill: unreadable Attachments stops the run (it would otherwise create duplicates) and is reported');
  readFail = null; writeFail = true; resetLog(); r = await backfillReceiptAttachments(env, { apply: true }); j = await r.json();
  ok(j.success && j.attachments_created === 0 && j.attachments_failed === 1 && /could not be written/.test(j.failure_warning), 'receipt backfill: a failed row write is counted and warned about');
}

// ───────────────────────── 7. proposal link / tracking ─────────────────────────
console.log('\nproposal tracking + link token');
{
  let teFail = true;
  const { proposalRecordHit, proposalStampSms, scopeProposalLinkToken } = load([constLine('PROPOSAL_TRACK_COLS') , 'proposalRecordHit', 'proposalStampSms', constLine('SCOPE_PROPOSAL_LINK_TTL'), 'scopeProposalLinkToken'].filter(Boolean), {
    classifyProposalHit: () => 'real',
    ensureColumns: async (e, t, c) => { if (c && c.includes('Link_Rev')) throw new Error('no col'); throw new Error('quota'); },
    updateRow: async () => ({ status: 200 }),
    logTelemetry: async () => { if (teFail) throw new Error('telemetry down'); },
    scopeFind: async () => ({ ID: '4', Link_Rev: '2' }), makeSessionToken: async (p) => 'tok:' + p.rev,
  });
  resetLog(); await proposalRecordHit(env, { ID: '4' }, 'page', 'ua');
  ok(reported('telemetry_write_failed:proposal_hit_log_failed').length === 1 && LOG.notes[0].severity === 'P2', 'proposalRecordHit: failing to log the failure is itself reported');
  resetLog(); await proposalStampSms(env, '4', 'sent');
  ok(reported('telemetry_write_failed:proposal_sms_stamp_failed').length === 1, 'proposalStampSms: same');
  resetLog(); const t = await scopeProposalLinkToken(env, '4');
  ok(t === 'tok:2' && reported('scopeProposalLinkToken_ensure_link_rev').length === 1 && LOG.fails[0].severity === 'P1', 'link token still issued when the Link_Rev column cannot be ensured, but reported P1 (revoke would not work)');
}

// ───────────────────────── 8. upload-photo ─────────────────────────
console.log('\nhandlePhotoUploadClean');
{
  let shareFail = false, shareFalse = false, attFail = false, woFail = false;
  const file = { name: 'a.jpg', type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(2) };
  const req = { formData: async () => ({ get: (k) => ({ file, wo_id: 'WO-1', property: '1 Main', file_type: 'photo' })[k] }) };
  const { handlePhotoUploadClean } = load(['handlePhotoUploadClean'], {
    getAccessToken: async () => 'tok', findOrCreateFolder: async () => ({ id: 'F', webViewLink: 'https://f' }), uploadFileToDrive: async () => ({ id: 'D1', webViewLink: 'https://d' }),
    driveShareAnyone: async () => { if (shareFail) throw new Error('share 403'); return !shareFalse; },
    addRow: async () => { if (attFail) throw new Error('att'); }, updateWOField: async () => { if (woFail) throw new Error('wo'); }, logTelemetry: async () => {},
  });
  const env2 = { DRIVE_PROPERTIES_ROOT: 'root' };
  resetLog(); let j = await (await handlePhotoUploadClean(env2, req)).json();
  ok(j.success && j.fileId === 'D1' && j.failure_warnings === undefined && anyReport() === 0, 'happy path: response unchanged (no warnings field), nothing reported');
  shareFail = true; resetLog(); j = await (await handlePhotoUploadClean(env2, req)).json();
  ok(j.success && /sharing it by link failed/.test((j.failure_warnings || [''])[0]) && reported('upload_photo_drive_share').length === 1 && LOG.fails[0].severity === 'P1', 'share error: upload succeeds, warning shown, reported P1');
  shareFail = false; shareFalse = true; resetLog(); j = await (await handlePhotoUploadClean(env2, req)).json();
  ok(j.success && /could not be made viewable/.test((j.failure_warnings || [''])[0]), 'share returned false: warning shown (telemetry row still written)');
  shareFalse = false; attFail = true; woFail = true; resetLog(); j = await (await handlePhotoUploadClean(env2, req)).json();
  ok(j.success && j.failure_warnings.length === 2 && reported('upload_photo_attachment_row').length === 1 && reported('upload_photo_wo_folder_link').length === 1, 'attachment row + folder link failures: both reported P1 and both named in the response');
}

// ───────────────────────── 9. grep: the old swallowing shapes are gone from the converted sites ─────────────────────────
console.log('\nno swallowing shape left at the converted sites');
{
  const gone = [
    "catch (e) { /* never blocks vendor creation */ }", "} catch(e) { /* non-fatal */ }\n}\n\nasync function pinLookup", "catch (e) { /* history is best-effort",
    "catch(sheetErr) { /* non-fatal */ }", "catch(woErr) { /* non-fatal */ }", "catch (e) { /* logged centrally by ensureColumns;",
    "newId = j && j.id || ''; } catch (e) {}", "let existing = []; try { existing = await fetchTab(env, 'Receipt_Recon_Queue'); } catch (e) {}",
    "JSON.parse(r.Suggestion || 'null'); } catch (e) {}", "JSON.parse(row.Suggestion || 'null'); } catch (e) {}", "JSON.parse(row.Items || '[]'); } catch (e) {}",
    "addResp.json().catch(() => ({}))", "const j = await r.json().catch(() => ({}));", "const resJson = await res.json().catch(() => ({}));",
    "try { properties = await fetchTab(env, 'Properties'); } catch (e) {}", "let srcs = []; try { srcs = JSON.parse(s.Source_Refs || '[]'); } catch (_) {}",
    "const cj = await child.json().catch(() => ({}));", "const wj = await woResp.json().catch(() => ({}));", "const createJson = await createResp.clone().json().catch(() => ({}));",
    "try { await ensureColumns(env, 'Work_Orders', ['Scope_ID']); } catch (_) {}", "try { await updateWOFields(env, s.WO_ID, { Vendor_ID: body.vendor_id }); } catch (_) {}",
    "fetchTab(env, 'Scopes').catch(() => [])", "fetchTab(env, 'Receipts').catch(() => [])", "try { await ensureColumns(env, 'Scopes', ['Link_Rev']); } catch (e) {}",
    "lineItems = JSON.parse(estimate.Line_Items || '[]'); } catch (_) {}", "convertedMarked = true;\n  } catch (e) {}",
  ];
  const region = src.slice(0, src.indexOf('async function proposalOwnerSms('));   // batch w1 owns worker.js up to here; later sections belong to other batches
  const stillThere = gone.filter(g => region.includes(g));
  ok(stillThere.length === 0, 'none of ' + gone.length + ' old swallowing snippets remain', stillThere);
  const cfgCatches = (region.match(/await fetchConfig\(env\)\.catch\(\(\) => \(\{\}\)\)/g) || []).length;
  ok(cfgCatches === 0, 'fetchConfig(env).catch(() => ({})) dead code is gone from the region (fetchConfig reports and never throws)');
}

console.log(`\ncw1-silent-failures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
