// Receipt Reconciler accuracy build, PHASE 2 (Nov 17 2026): the Phase 1 pure functions wired into the real scan, the queue list,
// the duplicate checker, the cards / rules / mark-customer-card endpoints. Every function under test is cut out of the REAL worker.js
// and run against an in-memory fake of the sheet tabs, so this cannot drift from what ships.
// Run: node --experimental-vm-modules test/receipt-accuracy-wiring.test.mjs   (the flag only enables the whole-file syntax check)
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';
import './_wo-status-global.mjs';
import { aiCreditGuardPrelude } from './_ai-credit-guard.mjs';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0;
const ok = (c, m) => { assert.ok(c, 'FAILED: ' + m); pass++; console.log('  ✓ ' + m); };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, 'FAILED: ' + m + ' — got ' + JSON.stringify(a)); pass++; console.log('  ✓ ' + m); };

// ── 0. whole-file syntax check (node --check worker.js is refused by this environment's privacy plugin) ───────────────
if (typeof vm.SourceTextModule === 'function') {
  new vm.SourceTextModule(src, { identifier: 'worker.js' });
  pass++; console.log('  ✓ worker.js compiles as a module');
} else console.log('  (skipped the whole-file syntax check: run with --experimental-vm-modules)');

function ex(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function konst(re) { const m = src.match(re); if (!m) throw new Error('missing const ' + re); return m[0]; }

const FNS = ['_rcNorm', '_rcPropActive', 'matchReceiptCandidates', 'matchReceiptProperty', '_rcUnitKey', 'receiptUnitHint', '_rcWoNum', '_rcWoOpenOn', 'receiptWORef',
  'receiptPropertyHint', 'rankReceiptWOs', 'receiptCardStatus', 'receiptCardLast4Strict', 'receiptIsVendorInvoice', '_rcStoreKey', '_rcInvKey', 'receiptDupSignals',
  'receiptRuleDecision', 'receiptIsDuplicate', 'receiptSuggestCore', 'receiptReconCutoff', 'receiptBeforeCutoff', 'receiptCutoffNote', 'receiptReconGmailIdFromDescription',
  'receiptReconEntrySource', 'receiptReconFindRescanMatches', 'receiptCardListFromCfg', 'receiptCardLabelsFromCfg', 'receiptAccuracyCtx', 'receiptLoadRules', 'receiptReconScan',
  'listReceiptReconQueue', 'receiptReconMarkCustomerCard', 'receiptCardsChange', 'receiptReconCards', 'receiptReconCardsList', 'receiptReconRulesList', 'receiptReconRuleSave',
  'receiptReconRuleDeactivate', 'receiptReconUnskip', 'receiptCheckDuplicatesOne', 'receiptDuplicatesAtProperty', 'receiptReconIsConfigError', 'receiptSuggest', 'isMissingTabError'];
const CONSTS = [
  'const RECEIPT_OPEN_STATUSES = WOStatus.sets.ACTIVE;',
  "const RECEIPT_STOP=new Set(['the','and','for','with','apt','ste','unit','street','saint','st','ave','rd','ln','pl','n','s','e','w','2x','x']);",
  'const RECEIPT_CLOSED_WINDOW_DAYS = 30;',
  konst(/const RECEIPT_VENDOR_INVOICE_NAMES_DEFAULT = \[[^\]]*\];/), konst(/const RECEIPT_RULES_HEADERS = \[[^\]]*\];/),
  konst(/const RECEIPT_RULE_NO_AUTO_VENDORS = \[[^\]]*\];/), konst(/const RECEIPT_AUTO_MAX_PER_SCAN = \d+;/), konst(/const RECEIPT_RECON_MIN_DATE_DEFAULT = '[^']*';/),
  "const RECEIPT_RECON_QUEUE_HEADERS = ['ID'];", "const RECEIPT_RECON_FOLDER_ID_DEFAULT = 'FOLDER';",
];

// ── the fake world: tabs in memory, every write recorded ───────────────────────────────────────────────────────────
function makeWorld(o = {}) {
  const tabs = {
    Properties: o.properties || [], Units: o.units || [], Work_Orders: o.workorders || [], Receipts: o.receipts || [],
    Receipt_Recon_Queue: o.queue || [], Receipt_Rules: o.rules || [], Config: o.config || {},
  };
  const log = { adds: [], updates: [], configWrites: [], confirms: [], ensures: [] };
  const failReads = new Set(o.failReads || []);
  const files = o.files || [];
  const extracts = (o.extracts || []).slice();
  const env = Object.assign({}, o.env || {});
  // a response that reads both ways: fields spread on top (scan result), plus .body / .status / .json() (handlers)
  const J = (b, status) => Object.assign({}, b, { body: b, status: status || 200, json: async () => b });
  const deps = {
    fetchConfig: async () => Object.assign({}, tabs.Config),
    getAccessToken: async () => 'tok', ensureTab: async (e, name) => { log.ensures.push(name); }, ensureColumns: async () => {},
    fetch: async () => ({ json: async () => ({ files }) }),
    fetchTab: async (e, name) => { if (o.missingTabs && o.missingTabs.includes(name)) throw new Error('Unable to parse range: ' + name); if (failReads.has(name)) throw new Error('read failed: ' + name); return (tabs[name] || []).map(r => Object.assign({}, r)); },
    fetchTabs: async (e, names) => Promise.all(names.map(n => deps.fetchTab(e, n))),
    driveDownload: async () => ({ bytes: new ArrayBuffer(1), mime: 'application/pdf' }),
    receiptExtract: async () => extracts.length > 1 ? extracts.shift() : extracts[0],
    addRow: async (e, tab, row) => { const id = String(((tabs[tab] || []).reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0)) + 1); tabs[tab] = (tabs[tab] || []).concat([Object.assign({ ID: id }, row)]); log.adds.push({ tab, row, id }); return J({ success: true, id }); },
    updateRow: async (e, tab, id, f) => { log.updates.push({ tab, id: String(id), f }); tabs[tab] = (tabs[tab] || []).map(r => String(r.ID) === String(id) ? Object.assign({}, r, f) : r); },
    setConfigKey: async (e, { key, value }) => { log.configWrites.push({ key, value }); tabs.Config[key] = value; return J({ success: true }); },
    receiptReconConfirm: async (e, body) => { log.confirms.push(body); const r = o.confirm ? await o.confirm(body, tabs) : { success: true, id: 'R' + body.id }; return J(r); },
    softFail: async () => ({ ok: false }),
    parseJsonCell: (cell, fb) => { if (cell === undefined || cell === null || String(cell).trim() === '') return fb; try { return JSON.parse(cell); } catch (e) { return fb; } },
    fetchTabSoft: async (e, name) => { try { return { rows: await deps.fetchTab(e, name), error: null }; } catch (err) { return { rows: [], error: String(err.message || err) }; } },
    json: J, isStaging: () => false,
    qbAccessToken: async () => { throw new Error('QuickBooks not reachable in this test'); },
  };
  return { tabs, log, env, deps };
}
function build(world, names) {
  const all = FNS;
  const body = aiCreditGuardPrelude() + '\n' + CONSTS.join('\n') + '\n' + all.map(ex).join('\n') + '\nreturn { ' + all.join(', ') + ' };';
  const dn = Object.keys(world.deps);
  return new Function(...dn, body)(...dn.map(n => world.deps[n]));
}

const PROPS = [
  { ID: '2', Address: '928 N Calvert St', Active: 'FALSE' }, { ID: '11', Address: '928 N Calvert St', Active: 'TRUE' },
  { ID: '7', Address: '1864 Kerns School Rd', Active: 'TRUE' }, { ID: '30', Address: '1220 Anywhere St', Active: 'TRUE' },
];
const UNITS = [{ ID: '30', Property_ID: '11', Unit_Label: 'Apt 2R' }, { ID: '32', Property_ID: '11', Unit_Label: 'Apt 3R' }];
const WOS = [{ ID: 'WO-1220', Property_ID: '11', Unit_ID: '32', Status: 'In Progress', Created_Date: '2026-09-23', Description: 'repair ceiling light' }];
const F = (id) => ({ id, name: id + '.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive/' + id });
const HD = (o) => Object.assign({ vendor: 'Home Depot', total: 43.23, date: '2026-09-24', items: ['LED BULB'], card_last4: '1661', po_reference: '' }, o);
const RULE = (o) => Object.assign({ ID: '1', Match_Vendor: 'Google LLC', Min_Amount: '', Max_Amount: '', Action: 'business', Property_ID: '', Unit_ID: '', Description: 'Workspace subscription', Auto: 'TRUE', Active: 'TRUE', Hits: '0' }, o);
const CFG = { receipt_my_cards: '1661,7508', receipt_customer_cards: '7442' };

// ── 1. scan: property / unit / WO come from ALL the text, on the real data shape (the 928 N Calvert twin) ────────────
{
  const w = makeWorld({ properties: PROPS, units: UNITS, workorders: WOS, config: CFG, files: [F('a')], extracts: [HD({ po_reference: '928 n calvert apt 2R', total: 12.5 })] });
  const r = await build(w).receiptReconScan(w.env, {});
  const sug = JSON.parse(w.log.adds[0].row.Suggestion);
  ok(r.scanned === 1 && sug.property.id === '11', 'receipt for "928 n calvert apt 2R" lands on the ACTIVE property 11, not the empty inactive twin 2');
  eq(sug.unit && sug.unit.id, '30', 'the unit Apt 2R (30) is suggested');
  ok(sug.card_status === 'mine', 'a Home Depot receipt on card 1661 reads as Brett\'s own card');
}
{
  const w = makeWorld({ properties: PROPS, units: UNITS, workorders: WOS, config: CFG, files: [F('a')], extracts: [HD({ po_reference: 'po 1220', total: 34.95, date: '2026-10-02' })] });
  await build(w).receiptReconScan(w.env, {});
  const sug = JSON.parse(w.log.adds[0].row.Suggestion);
  ok((sug.flags || []).includes('po_ambiguous') && sug.action === 'need_property', '"po 1220" (WO-1220 or 1220 Anywhere St) is flagged ambiguous and nothing is picked');
}
{
  const w = makeWorld({ properties: PROPS, units: UNITS, workorders: WOS, config: CFG, files: [F('a')], extracts: [HD({ po_reference: '', ship_to_address: '928 N Calvert St Apt 3R', total: 9.99 })] });
  await build(w).receiptReconScan(w.env, {});
  const sug = JSON.parse(w.log.adds[0].row.Suggestion);
  ok(sug.property && sug.property.id === '11', 'a property that is only on the printed ship-to address (no PO) is still found');
}

// ── 2. cards: unknown last-4 is flagged, never guessed; customer card stays excluded ─────────────────────────────────
{
  const w = makeWorld({ properties: PROPS, units: UNITS, config: CFG, files: [F('a'), F('b'), F('c')],
    extracts: [HD({ card_last4: '9999', total: 5 }), HD({ card_last4: '7442', total: 6 }), HD({ card_last4: '', total: 7 })] });
  await build(w).receiptReconScan(w.env, {});
  const s = w.log.adds.map(a => JSON.parse(a.row.Suggestion));
  ok((s[0].flags || []).includes('card_unknown'), 'a last-4 on neither list is flagged card_unknown');
  ok(s[1].category === 'customer_paid' && s[1].action === 'exclude', 'the customer card (7442) stays excluded');
  ok((s[2].flags || []).includes('card_not_read'), 'no card digits read is card_not_read');
}

// ── 3. duplicates: the Sep 24 screenshot pair, same-scan twins, +/-3 days ─────────────────────────────────────────────
{
  const queue = [{ ID: '5', Active: 'TRUE', Status: 'pending', Vendor: 'Home Depot', Total: '43.23', Receipt_Date: '2026-09-24', Invoice_Number: '', Source_File_ID: 'drive-drop' }];
  const w = makeWorld({ properties: PROPS, config: CFG, queue, files: [F('email-copy')], extracts: [HD({ vendor: 'The Home Depot #4412', date: '2026-09-24', items: ['LED BULB 4PK'] })] });
  const r = await build(w).receiptReconScan(w.env, {});
  const m = JSON.parse(w.log.adds[0].row.Rescan_Match_JSON);
  ok(r.flagged_rescan === 1 && m.some(x => x.queue_id === '5' && x.type === 'other_queue_row'), 'the $43.23 Home Depot twin of a still-PENDING row is flagged (fuzzy store, was invisible before)');
  ok(w.log.adds[0].row.Status === 'pending', 'it is still queued as pending: flag only, never auto-skipped');
}
{
  const w = makeWorld({ properties: PROPS, config: CFG, files: [F('one'), F('two')], extracts: [HD({}), HD({ date: '2026-09-26' })] });
  const r = await build(w).receiptReconScan(w.env, {});
  const m2 = JSON.parse(w.log.adds[1].row.Rescan_Match_JSON);
  ok(r.flagged_rescan === 1 && m2.some(x => x.queue_id === w.log.adds[0].id), 'two copies of one receipt inside the same scan (2 days apart) flag each other: the second sees the first');
}
{
  const w = makeWorld({ properties: PROPS, config: CFG, files: [F('one'), F('two')], extracts: [HD({ invoice_number: 'INV-7781', date: '2026-08-01' }), HD({ invoice_number: 'inv 7781', date: '2026-09-20' })] });
  const r = await build(w).receiptReconScan(w.env, {});
  ok(r.flagged_rescan === 1, 'the same vendor invoice number at the same amount flags even when the dates are weeks apart');
}

// ── 4. vendor invoices stay out of the receipt queue ──────────────────────────────────────────────────────────────────
{
  const w = makeWorld({ properties: PROPS, config: CFG, files: [F('a'), F('b')], extracts: [HD({ vendor: 'Alex Busey', total: 400 }), HD({ vendor: 'K&C Cleaning', total: 120 })] });
  const r = await build(w).receiptReconScan(w.env, {});
  ok(r.vendor_invoice_skipped === 2 && w.log.adds.every(a => a.row.Status === 'skipped'), 'Alex Busey and K&C Cleaning invoices land as skipped, not pending receipts');
  ok(/Who To Pay/.test(w.log.adds[0].row.Notes) && /Move back to Pending/.test(w.log.adds[0].row.Notes), 'the note says where they belong and how to bring one back');
  ok(w.log.confirms.length === 0 && w.log.adds.every(a => a.tab === 'Receipt_Recon_Queue'), 'nothing was billed and no other tab was touched (Vendor_Bills is never written)');
}
{
  const w = makeWorld({ properties: PROPS, config: Object.assign({ receipt_vendor_invoice_names: 'acme plumbing' }, CFG), files: [F('a'), F('b')], extracts: [HD({ vendor: 'Acme Plumbing Supply LLC' }), HD({ vendor: 'Alex Busey' })] });
  await build(w).receiptReconScan(w.env, {});
  ok(w.log.adds[0].row.Status === 'skipped' && w.log.adds[1].row.Status === 'pending', 'the name list is editable in Config: the Config list replaces the default one');
}

// ── 5. "Always" rules: auto-confirm, guards, caps, failures ───────────────────────────────────────────────────────────
const GOOGLE = (o) => HD(Object.assign({ vendor: 'Google LLC', total: 14.4, items: ['Workspace'], card_last4: '1661' }, o));
{
  const w = makeWorld({ properties: PROPS, config: CFG, rules: [RULE()], files: [F('a')], extracts: [GOOGLE()] });
  const r = await build(w).receiptReconScan(w.env, {});
  eq(w.log.confirms.map(c => ({ id: c.id, no_wo: c.no_wo, property_id: c.property_id, description: c.description })), [{ id: w.log.adds[0].id, no_wo: true, property_id: '', description: 'Workspace subscription' }], 'always-business rule confirms through the existing no-WO path with no property');
  ok(r.auto_handled === 1 && /^🤖 Auto-handled by rule #1/.test(w.tabs.Receipt_Recon_Queue[0].Notes), 'Notes start with "🤖 Auto-handled by rule #1" (this is what the Auto-handled list reads)');
  ok(w.log.updates.some(u => u.tab === 'Receipt_Rules' && u.f.Hits === '1' && u.f.Last_Hit_Date), 'the rule\'s hit count and last-hit date are recorded');
}
{
  const w = makeWorld({ properties: PROPS, config: CFG, rules: [RULE({ ID: '2', Match_Vendor: 'Apple Valley Waste', Action: 'property', Property_ID: '7', Description: '' })], files: [F('a')], extracts: [HD({ vendor: 'Apple Valley Waste Services', total: 65, items: [] })] });
  await build(w).receiptReconScan(w.env, {});
  ok(w.log.confirms.length === 1 && w.log.confirms[0].no_wo === true && w.log.confirms[0].property_id === '7', 'always-this-property posts an expense to property 7 (1864 Kerns School Rd) with no work order');
}
{
  // Every guard: the rule still PRE-SELECTS (suggestion.rule) but never auto-confirms.
  const cases = [
    ['customer card', GOOGLE({ card_last4: '7442' }), {}, 'customer_card'],
    ['refund', GOOGLE({ total: -14.4 }), {}, 'refund'],
    ['duplicate flag', GOOGLE({}), { queue: [{ ID: '9', Active: 'TRUE', Status: 'pending', Vendor: 'Google LLC', Total: '14.40', Receipt_Date: '2026-09-24' }] }, 'duplicate_flag'],
    ['before the cutoff', GOOGLE({ date: '2025-03-01' }), {}, null],
    ['unknown card', GOOGLE({ card_last4: '5555' }), {}, 'card_unknown'],
    ['amount over the rule\'s max', GOOGLE({ total: 99 }), { rules: [RULE({ Max_Amount: '50' })] }, null],
    ['amount under the rule\'s min', GOOGLE({ total: 5 }), { rules: [RULE({ Min_Amount: '10' })] }, null],
    ['rule switched off', GOOGLE({}), { rules: [RULE({ Active: 'FALSE' })] }, null],
    ['Auto=FALSE', GOOGLE({}), { rules: [RULE({ Auto: 'FALSE' })] }, 'none'],
  ];
  for (const [label, extract, extra, blocked] of cases) {
    const w = makeWorld(Object.assign({ properties: PROPS, config: CFG, rules: [RULE()], files: [F('a')], extracts: [extract] }, extra));
    await build(w).receiptReconScan(w.env, {});
    const sug = JSON.parse(w.log.adds[0].row.Suggestion);
    ok(w.log.confirms.length === 0, 'rule does NOT auto-confirm: ' + label);
    if (blocked && blocked !== 'none') ok(sug.rule && sug.rule.auto === false && sug.rule.blocked.includes(blocked), '  …and the card still shows the rule, blocked by ' + blocked);
  }
}
{
  const w = makeWorld({ properties: PROPS, config: CFG, rules: [RULE()], files: [1, 2, 3, 4, 5, 6].map(i => F('f' + i)), extracts: [1, 2, 3, 4, 5, 6].map(i => GOOGLE({ total: 10 + i, date: '2026-09-' + (10 + i * 3) })) });
  const r = await build(w).receiptReconScan(w.env, {});
  ok(r.auto_handled === 4 && w.log.confirms.length === 4, 'at most 4 rule auto-confirms per scan (subrequest safety)');
  ok(w.tabs.Receipt_Recon_Queue.filter(q => q.Status === 'pending' && /scan already auto-handled 4/.test(q.Notes || '')).length >= 1, 'the rest stay pending and say why');
}
{
  const w = makeWorld({ properties: PROPS, config: CFG, rules: [RULE()], files: [F('a')], extracts: [GOOGLE()], confirm: async () => ({ error: 'QuickBooks said no' }) });
  const r = await build(w).receiptReconScan(w.env, {});
  ok(r.auto_failed === 1 && r.auto_handled === 0 && r.errors.some(e => /QuickBooks said no/.test(e)), 'a failed auto-confirm is reported in the scan result, never swallowed');
  ok(w.tabs.Receipt_Recon_Queue[0].Status === 'pending' && /Left for you/.test(w.tabs.Receipt_Recon_Queue[0].Notes), 'and the row stays pending with a plain note');
}
{
  // Fail CLOSED: rules unreadable -> no auto-confirm, and the page is told.
  const w = makeWorld({ properties: PROPS, config: CFG, rules: [RULE()], failReads: ['Receipt_Rules'], files: [F('a')], extracts: [GOOGLE()] });
  const r = await build(w).receiptReconScan(w.env, {});
  ok(w.log.confirms.length === 0 && r.list_errors.some(e => /Receipt_Rules/.test(e)) && r.scanned === 1, 'an unreadable rules tab: nothing auto-confirms, the receipt is still queued, the error is reported');
}

// ── 6. queue list: manual customer card, twins on both rows, restored vendor invoice ───────────────────────────────────
{
  const queue = [
    { ID: '1', Active: 'TRUE', Status: 'pending', Vendor: 'Home Depot', Total: '43.23', Receipt_Date: '2026-09-24', Suggestion: JSON.stringify({ category: 'billable', action: 'need_property' }) },
    { ID: '2', Active: 'TRUE', Status: 'pending', Vendor: 'The Home Depot #12', Total: '43.23', Receipt_Date: '2026-09-24', Suggestion: JSON.stringify({ category: 'billable', action: 'need_property' }), Manual_Customer_Card: 'TRUE' },
    { ID: '3', Active: 'TRUE', Status: 'pending', Vendor: 'Alex Busey', Total: '400', Receipt_Date: '2026-09-01', Suggestion: JSON.stringify({ category: 'vendor_invoice', action: 'exclude' }) },
    { ID: '4', Active: 'TRUE', Status: 'confirmed', Vendor: 'Lowes', Total: '8', Receipt_Date: '2026-09-02', Notes: '🤖 Auto-handled by rule #3 (always a business expense).', Suggestion: '{}' },
  ];
  const w = makeWorld({ queue });
  const rows = await (await build(w).listReceiptReconQueue(w.env, new URL('https://x/receipt-recon/queue?status=all'))).json();
  const by = id => rows.find(r => r.ID === id);
  ok(by('1').dup_signals.some(s => s.queue_id === '2') && by('2').dup_signals.some(s => s.queue_id === '1'), 'both twins carry "possible duplicate of the other"');
  ok(by('2').suggestion.category === 'customer_paid' && by('2').suggestion.manual_customer_card === true, 'Manual_Customer_Card=TRUE shows the excluded customer_paid card');
  ok(by('1').suggestion.category === 'billable', 'the stored suggestion of an unmarked row is untouched');
  ok(by('3').suggestion.category === 'billable' && by('3').suggestion.vendor_invoice_restored, 'a vendor invoice moved back to Pending becomes an ordinary manual card');
  ok(by('4').auto_handled === true && by('1').auto_handled === false, 'auto-handled rows are marked for the Auto-handled list');
  const w2 = makeWorld({ queue, failReads: ['Receipts'] });
  const rows2 = await (await build(w2).listReceiptReconQueue(w2.env, new URL('https://x/q'))).json();
  ok(rows2.length === 3 && rows2[0].dup_read_error && rows2[0].dup_signals.length >= 1, 'if Receipts cannot be read the queue twins still show and the page is told');
}

// ── 7. mark-as-customer-card ───────────────────────────────────────────────────────────────────────────────────────────
{
  const queue = [{ ID: '1', Active: 'TRUE', Status: 'pending', Vendor: 'Home Depot', Total: '10', Receipt_Date: '2026-09-24' }, { ID: '2', Active: 'TRUE', Status: 'confirmed' }];
  const w = makeWorld({ queue, config: { receipt_customer_cards: '7442' } });
  const fn = build(w);
  let r = await fn.receiptReconMarkCustomerCard(w.env, { id: '1', last4: '12345' });
  ok(r.status === 400 && w.log.updates.length === 0, 'a last-4 that is not exactly 4 digits is rejected BEFORE anything is written');
  r = await fn.receiptReconMarkCustomerCard(w.env, { id: '2' });
  ok(r.status === 409, 'only a pending row can be marked');
  r = await fn.receiptReconMarkCustomerCard(w.env, { id: '1', last4: '1234', label: 'Smith' });
  ok(r.body.ok && r.body.card_saved === true && w.tabs.Receipt_Recon_Queue[0].Manual_Customer_Card === 'TRUE', 'marks the row');
  ok(w.tabs.Config.receipt_customer_cards === '7442,1234' && JSON.parse(w.tabs.Config.receipt_card_labels)['1234'] === 'Smith', 'and remembers the last-4 on the customer list with its label');
  r = await fn.receiptReconMarkCustomerCard(w.env, { id: '1', customer_card: false });
  ok(w.tabs.Receipt_Recon_Queue[0].Manual_Customer_Card === 'FALSE', 'undo clears the mark');
  const w3 = makeWorld({ queue: [{ ID: '1', Active: 'TRUE', Status: 'skipped', Manual_Customer_Card: 'TRUE' }] });
  await build(w3).receiptReconUnskip(w3.env, { id: '1' });
  ok(w3.log.updates[0].f.Status === 'pending' && w3.log.updates[0].f.Manual_Customer_Card === 'FALSE', '"Move back to Pending" also clears a manual customer-card mark');
}

// ── 8. cards panel ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = makeWorld({ config: { receipt_my_cards: '1661', receipt_customer_cards: '7442' } });
  const fn = build(w);
  ok((await fn.receiptReconCards(w.env, { last4: 'abcd', owner: 'mine' })).status === 400, 'letters are rejected');
  ok((await fn.receiptReconCards(w.env, { last4: '12345', owner: 'mine' })).status === 400, 'five digits are rejected');
  ok((await fn.receiptReconCards(w.env, { last4: '7508', owner: 'bogus' })).status === 400, 'an unknown owner is rejected');
  await fn.receiptReconCards(w.env, { last4: '7508', owner: 'mine', label: "Lowe's" });
  await fn.receiptReconCards(w.env, { last4: '1661', owner: 'customer' });
  eq([w.tabs.Config.receipt_my_cards, w.tabs.Config.receipt_customer_cards], ['7508', '7442,1661'], 'a card moves between the lists (never on both)');
  await fn.receiptReconCards(w.env, { last4: '7508', owner: 'remove' });
  eq([w.tabs.Config.receipt_my_cards, JSON.parse(w.tabs.Config.receipt_card_labels)['7508']], ['', undefined], 'remove drops the card and its label');
  const before = w.log.configWrites.length; await fn.receiptReconCards(w.env, { last4: '7442', owner: 'customer' });
  ok(w.log.configWrites.length === before, 'setting a card to what it already is writes nothing');
  const list = await (await fn.receiptReconCardsList(w.env)).json();
  ok(list.ok && list.customer.some(c => c.last4 === '7442') && !JSON.stringify(list).includes('receipt_my_cards'), 'GET lists last-4s and labels only');
  const w2 = makeWorld({ config: {}, env: { RECEIPT_CUSTOMER_CARDS: '7442' } });
  ok((await build(w2).receiptReconCards(w2.env, { last4: '1111', owner: 'customer' })).status === 409, 'a customer-card change that the Cloudflare secret would override is refused with the reason, not silently ignored');
}

// ── 9. rules endpoints ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = makeWorld({ properties: PROPS });
  const fn = build(w);
  ok((await fn.receiptReconRuleSave(w.env, { match_vendor: 'a', action: 'business' })).status === 400, 'a vendor of fewer than 3 characters is refused (one rule cannot swallow every receipt)');
  ok((await fn.receiptReconRuleSave(w.env, { match_vendor: 'Google LLC', action: 'sideways' })).status === 400, 'action must be business or property');
  ok((await fn.receiptReconRuleSave(w.env, { match_vendor: 'Apple Valley Waste', action: 'property' })).status === 400, 'a property rule needs a property');
  ok((await fn.receiptReconRuleSave(w.env, { match_vendor: 'Apple Valley Waste', action: 'property', property_id: '2' })).status === 400, 'an inactive property is refused');
  ok((await fn.receiptReconRuleSave(w.env, { match_vendor: 'Google LLC', action: 'business', min_amount: '50', max_amount: '10' })).status === 400, 'min above max is refused');
  let r = await fn.receiptReconRuleSave(w.env, { match_vendor: 'Google LLC', action: 'business', description: 'Workspace' });
  ok(r.body.created && r.body.auto === true && w.tabs.Receipt_Rules[0].Auto === 'TRUE' && w.tabs.Receipt_Rules[0].Active === 'TRUE' && w.tabs.Receipt_Rules[0].Hits === '0', 'a rule is saved Auto=TRUE (Brett\'s Q6 decision), Active, 0 hits');
  r = await fn.receiptReconRuleSave(w.env, { match_vendor: 'google llc', action: 'business' });
  ok(r.status === 409 && r.body.existing_id === '1', 'a second active rule for the same vendor and action is refused and points at the first');
  r = await fn.receiptReconRuleSave(w.env, { match_vendor: 'Home Depot', action: 'business' });
  ok(r.body.created && r.body.auto === false && r.body.warnings.length === 1, 'a rule for a job-materials store (Home Depot) is saved with Auto OFF and says so');
  r = await fn.receiptReconRuleSave(w.env, { id: '1', match_vendor: 'Google LLC', action: 'business', max_amount: '50' });
  ok(r.body.updated && w.tabs.Receipt_Rules[0].Max_Amount === '50', 'a rule can be edited');
  r = await fn.receiptReconRuleDeactivate(w.env, { id: '1' });
  ok(r.body.ok && w.tabs.Receipt_Rules[0].Active === 'FALSE' && w.tabs.Receipt_Rules.length === 2, 'deactivate keeps the row (no hard delete)');
  const list = await (await fn.receiptReconRulesList(w.env)).json();
  ok(list.rules[list.rules.length - 1].ID === '1', 'the list shows active rules first, deactivated last');
  ok((await fn.receiptReconRuleDeactivate(w.env, { id: '99' })).status === 404, 'deactivating a rule that does not exist is a 404');
}
{
  // GET /receipt-recon/rules is reachable with the read-only production token, so it must never write (no tab creation).
  const w = makeWorld({ missingTabs: ['Receipt_Rules'] });
  const r = await build(w).receiptReconRulesList(w.env);
  ok(r.body.ok && r.body.rules.length === 0 && w.log.ensures.length === 0 && w.log.adds.length === 0, 'the rules GET on a missing tab answers with an empty list and creates nothing');
  const w2 = makeWorld({ failReads: ['Receipt_Rules'] });
  const r2 = await build(w2).receiptReconRulesList(w2.env);
  ok(r2.status === 500 && /Receipt_Rules/.test(r2.body.error), 'any other read failure on the rules GET is an error, not an empty list');
  const w3 = makeWorld({ missingTabs: ['Receipt_Rules'], properties: PROPS });
  await build(w3).receiptReconRuleSave(w3.env, { match_vendor: 'Google LLC', action: 'business' });
  ok(w3.log.ensures.includes('Receipt_Rules'), 'the first rule SAVE creates the tab (new tab only, via ensureTab)');
}

// ── 10. duplicate checker button now looks at the queue (pending included) ─────────────────────────────────────────────────
{
  const queue = [
    { ID: '1', Active: 'TRUE', Status: 'pending', Vendor: 'Home Depot', Total: '43.23', Receipt_Date: '2026-09-24', Invoice_Number: '' },
    { ID: '2', Active: 'TRUE', Status: 'pending', Vendor: 'The Home Depot #1234', Total: '43.23', Receipt_Date: '2026-09-24', Invoice_Number: '' },
  ];
  const w = makeWorld({ queue });
  const ev = await build(w).receiptCheckDuplicatesOne(w.env, queue[0]);
  ok(ev.some(e => e.signal === 'other_queue_row' && String(e.queue_id) === '2'), 'Check duplicates now finds the pending twin (it used to say "no matching entries")');
  ok(!ev.some(e => e.signal === 'other_queue_row' && String(e.queue_id) === '1'), 'and never matches the row against itself');
}

// ── 11. the staging token's record-level gate knows the new write paths (and stays default-deny for risky shapes) ──────────
{
  const guard = new Function('isTestRecord', 'fetchTab', ex('hubTestWriteAllowed') + '\nreturn hubTestWriteAllowed;')(async (e, tab, id) => String(id) === 'T1', async () => []);
  ok(await guard({}, '/receipt-recon/mark-customer-card', { id: '1' }) === true, 'staging token: mark-customer-card (flag only) is allowed');
  ok(await guard({}, '/receipt-recon/mark-customer-card', { id: '1', last4: '1234' }) === false, 'staging token: mark-customer-card with a last4 (a Config write) is refused');
  ok(await guard({}, '/receipt-recon/cards', { last4: '1234', owner: 'mine' }) === true && await guard({}, '/receipt-recon/rules/deactivate', { id: '1' }) === true, 'staging token: cards and rule-deactivate are allowed');
  ok(await guard({}, '/receipt-recon/rules', { match_vendor: 'Google LLC', action: 'business' }) === true, 'staging token: a business rule is allowed');
  ok(await guard({}, '/receipt-recon/rules', { match_vendor: 'X Co', action: 'property', property_id: 'T1' }) === true && await guard({}, '/receipt-recon/rules', { match_vendor: 'X Co', action: 'property', property_id: '7' }) === false, 'staging token: an always-this-property rule may only point at a TEST- property');
}

console.log('\n' + pass + ' passed, 0 failed');
