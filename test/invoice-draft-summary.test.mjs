// Queue #266 (Nov 24 2026): AI-drafted plain-English "what was done" for a vendor-bill invoice that would otherwise print only the
// generic work order text. Brett edits and approves; nothing is sent to QuickBooks; the AI being paused never blocks sending.
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';
globalThis.parseJsonCell = globalThis.parseJsonCell || ((c, fb) => { if (c === undefined || c === null || String(c).trim() === '') return fb; try { return JSON.parse(c); } catch (e) { return fb; } });

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name, text = src) {
  const i = text.indexOf((text.includes('async function ' + name + '(') ? 'async function ' : 'function ') + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const pure = ['englishOnly', 'looksLikeAccessDetail', 'sanitizeCustomerText', 'parseChecklistItems', 'clPastTense', 'checklistItemPastTense', 'workDoneFromChecklist', 'workDoneBlock', 'laborEntryText', 'isTrueish',
  'invoiceSummaryNeeded', 'invoiceSummaryInputs', 'invoiceSummaryClean'];
const H = new Function(pure.map(n => grab(n)).join('\n') + '\nreturn { ' + pure.join(', ') + ' };')();

const wo = { ID: 'WO-1', Trade: 'Plumbing', Description: 'Kitchen faucet drips', Completed_Date: '2026-11-20T10:00:00Z' };
const bill = { ID: 'B1', Invoice_Description: '' };

test('needed only when the bill, its time entries and the checklist all say nothing', () => {
  assert.strictEqual(H.invoiceSummaryNeeded(bill, [], wo), true);
  assert.strictEqual(H.invoiceSummaryNeeded({ ID: 'B1', Invoice_Description: 'Replaced cartridge' }, [], wo), false);
  assert.strictEqual(H.invoiceSummaryNeeded({ ID: 'B1', Invoice_Description: '[ES] Cambio\n[EN] Replaced cartridge' }, [], wo), false);
  assert.strictEqual(H.invoiceSummaryNeeded(bill, [{ Bill_ID: 'B1', Invoice_Description: 'Fixed leak', Active: 'TRUE' }], wo), false);
  assert.strictEqual(H.invoiceSummaryNeeded(bill, [{ Bill_ID: 'B2', Invoice_Description: 'Other bill', Active: 'TRUE' }], wo), true);
  assert.strictEqual(H.invoiceSummaryNeeded(bill, [], { ...wo, Checklist: JSON.stringify([{ t: 'Fix gate latch', done: true }]) }), false);
  assert.strictEqual(H.invoiceSummaryNeeded({ ID: 'B1', Standalone: 'TRUE' }, [], wo), false);
  assert.strictEqual(H.invoiceSummaryNeeded({}, [], wo), false);
});

test('inputs carry only customer-safe facts and call a one-line description "thin"', () => {
  const thin = H.invoiceSummaryInputs(wo, bill);
  assert.strictEqual(thin.thin, true);
  assert.deepStrictEqual(Object.keys(thin.facts).sort(), ['completed', 'description', 'materials_from_truck', 'trade']);
  assert.strictEqual(thin.facts.completed, '2026-11-20');
  const rich = H.invoiceSummaryInputs({ ...wo, Description: 'Kitchen faucet drips\nSink trap also leaking\nLockbox code 4821 on the gate' }, { ID: 'B1', Truck_Desc: 'New cartridge and supply line' });
  assert.strictEqual(rich.thin, false);
  assert.ok(!/4821|lockbox/i.test(JSON.stringify(rich.facts)), 'access detail must not reach the AI');
  assert.ok(!/\$|tenant|vendor/i.test(Object.keys(rich.facts).join(' ')));
});

test('clean strips markdown, caps at 400, and throws away prices, phone numbers and access details', () => {
  assert.strictEqual(H.invoiceSummaryClean('**Summary:** We replaced the faucet cartridge.\n- Tested for leaks.').text, 'We replaced the faucet cartridge. Tested for leaks.');
  const long = ('We replaced the faucet cartridge and tested it. ').repeat(20);
  const c = H.invoiceSummaryClean(long).text;
  assert.ok(c.length <= 401 && c.length > 100);
  assert.ok(H.invoiceSummaryClean('Replaced it for $250.').reason.includes('price'));
  assert.ok(H.invoiceSummaryClean('Call 410-555-1212 for details.').reason.includes('phone'));
  assert.strictEqual(H.invoiceSummaryClean('Call 410-555-1212 for details.').text, '');
  assert.ok(H.invoiceSummaryClean('Entered with the lockbox code 4821.').reason.length > 0);
  assert.strictEqual(H.invoiceSummaryClean('   ').text, '');
});

// ---- the IO around it, with the sheet and the AI faked ----
function build(opts) {
  const calls = { ai: 0, writes: [], telemetry: [] };
  const env = {};
  const fakes = {
    json: (o, status) => ({ body: o, status: status || 200 }),
    fetchTabs: async () => [opts.ir ? [opts.ir] : [], [wo], opts.bills || [bill], opts.entries || []],
    fetchTab: async (e, tab) => tab === 'Invoice_Review' ? (opts.ir ? [opts.ir] : []) : (opts.bills || [bill]),
    findWO: (rows, id) => rows.find(r => r.ID === id),
    routeAI: async () => { calls.ai++; if (opts.aiThrow) throw opts.aiThrow; return { result: opts.aiText, model_used: 'fake' }; },
    aiCreditIsPausedError: e => !!e && e.paused === true,
    logTelemetry: async (e, r) => { calls.telemetry.push(r); },
    ensureColumns: async () => {},
    updateRowVerified: async (e, tab, id, f) => { if (opts.writeFails) throw new Error('did not keep'); calls.writes.push({ tab, id, f }); return {}; },
  };
  const names = [...pure, 'invoiceDraftSummary', 'invoiceDraftSummaryUse'];
  const f = new Function(...Object.keys(fakes), names.map(n => grab(n)).join('\n') + '\nreturn { invoiceDraftSummary, invoiceDraftSummaryUse };');
  return { ...f(...Object.values(fakes)), calls, env };
}
const IR = { ID: 'IR1', Bill_ID: 'B1', WO_ID: 'WO-1' };

test('a thin work order makes NO AI call and opens an empty box', async () => {
  const t = build({ ir: IR });
  const r = await t.invoiceDraftSummary(t.env, { ir_id: 'IR1' });
  assert.strictEqual(r.body.draft, ''); assert.match(r.body.reason, /Not enough detail/); assert.strictEqual(t.calls.ai, 0);
});

test('a drafted summary comes back cleaned; AI paused and AI failure both answer calmly and write nothing', async () => {
  const rich = { ID: 'B1', Invoice_Description: '', Truck_Desc: 'New cartridge' };
  let t = build({ ir: IR, bills: [rich], aiText: '**We replaced the faucet cartridge.**' });
  let r = await t.invoiceDraftSummary(t.env, { ir_id: 'IR1' });
  assert.strictEqual(r.body.draft, 'We replaced the faucet cartridge.'); assert.strictEqual(t.calls.ai, 1); assert.strictEqual(t.calls.writes.length, 0);
  t = build({ ir: IR, bills: [rich], aiThrow: Object.assign(new Error('paused'), { paused: true }) });
  r = await t.invoiceDraftSummary(t.env, { ir_id: 'IR1' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.paused, true); assert.strictEqual(r.body.draft, '');
  t = build({ ir: IR, bills: [rich], aiThrow: new Error('boom') });
  r = await t.invoiceDraftSummary(t.env, { ir_id: 'IR1' });
  assert.strictEqual(r.status, 200); assert.match(r.body.error, /Could not draft/); assert.strictEqual(t.calls.telemetry[0].Success, 'FALSE');
  t = build({ ir: IR, bills: [rich], aiText: 'Charged $250 for the faucet.' });
  r = await t.invoiceDraftSummary(t.env, { ir_id: 'IR1' });
  assert.strictEqual(r.body.draft, ''); assert.match(r.body.reason, /price/);
});

test('use: verified write onto Invoice_Description, telemetry says edited or typed, never overwrites, refuses access details', async () => {
  let t = build({ ir: IR });
  let r = await t.invoiceDraftSummaryUse(t.env, { ir_id: 'IR1', text: 'Replaced the faucet cartridge.', draft: 'We replaced the faucet cartridge.' });
  assert.strictEqual(r.body.ok, true, JSON.stringify(r.body)); assert.strictEqual(r.body.edited, true);
  assert.deepStrictEqual(t.calls.writes, [{ tab: 'Vendor_Bills', id: 'B1', f: { Invoice_Description: 'Replaced the faucet cartridge.' } }]);
  assert.match(t.calls.telemetry[0].Notes, /edited=yes/); assert.strictEqual(t.calls.telemetry[0].Job_Type, 'invoice_summary_used');
  t = build({ ir: IR, bills: [{ ID: 'B1', Invoice_Description: 'Already here' }] });
  r = await t.invoiceDraftSummaryUse(t.env, { ir_id: 'IR1', text: 'New text' });
  assert.strictEqual(r.status, 409); assert.strictEqual(t.calls.writes.length, 0);
  t = build({ ir: IR });
  r = await t.invoiceDraftSummaryUse(t.env, { ir_id: 'IR1', text: 'Gate lockbox code 4821 used.' });
  assert.strictEqual(r.status, 400); assert.strictEqual(t.calls.writes.length, 0);
  t = build({ ir: IR, writeFails: true });
  r = await t.invoiceDraftSummaryUse(t.env, { ir_id: 'IR1', text: 'Fixed the faucet.' });
  assert.strictEqual(r.status, 500); assert.match(r.body.error, /not saved/); assert.strictEqual(t.calls.telemetry[0].Success, 'FALSE');
  r = await t.invoiceDraftSummaryUse(t.env, { ir_id: 'IR1', text: '  ' });
  assert.strictEqual(r.status, 400);
});

test('wiring: admin-only routes, staging TEST guard, preview flag, Hub box that never blocks Send', () => {
  assert.ok(src.includes("path === '/invoice/draft-summary'") && src.includes("path === '/invoice/draft-summary/use'"));
  // every mention of the path is the router line, the staging guard, or a comment: none sits in a role list, a public list or the prod write list
  const lines = src.split('\n').filter(l => l.includes('/invoice/draft-summary'));
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(/return await invoiceDraftSummary|path === '\/invoice\/draft-summary|^\s*\/\/|^\/\/|queue #266|Skill_Or_Endpoint/.test(l), l.slice(0, 120));
  assert.ok(!/HUB_PROD_WRITE_PATHS = \[[^\]]*draft-summary/.test(src));
  assert.ok(src.includes("path === '/invoice/draft-summary/use') {") && src.includes('isTestWO(env, _ir.WO_ID)'));
  assert.ok(src.includes('can_draft_summary: invoiceSummaryNeeded('));
  for (const s of ['Draft a summary', 'Use this on the invoice', 'Discard', 'qbDraftStart', 'qbDraftUse', "api('POST', '/invoice/draft-summary/use'", 'font-size:16px', 'min-height:44px']) assert.ok(hub.includes(s), s);
  assert.ok(!/qb-send-confirm-btn'\)\.disabled\s*=\s*[^;]*_qbDraft/.test(hub), 'the draft box must not gate the Send button');
});
