// Vendor estimate text -> English copy (Sep 28 2026). Real addEstimateVersion, retranslateEstimate,
// findRecentDuplicate, estimateEnglishFields, estimateLinesEnglish, scopeItemsFromEstimate,
// invoice builders and invoiceInputsEnglish are extracted from worker.js and run against stubs.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grabFrom(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (text.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const grab = n => grabFrom(src, n);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- stub Anthropic: batch translator. Input is a JSON array in the prompt; Spanish words -> English ----
let calls = [], mode = 'ok';
const DICT = { 'Pintar la sala': 'Paint the living room', 'Cambiar el lavabo': 'Replace the sink', 'Materiales y mano de obra': 'Materials and labor', 'Se necesita más material': 'More material is needed' };
globalThis.fetch = async (url, init) => {
  const prompt = JSON.parse(init.body).messages[0].content;
  calls.push(prompt);
  if (mode === 'throw') throw new Error('down');
  if (mode === 'garbage') return { json: async () => ({ content: [{ text: 'sorry I cannot' }] }) };
  if (mode === 'short') return { json: async () => ({ content: [{ text: '["only one"]' }] }) };
  const arr = JSON.parse(prompt.slice(prompt.indexOf('[')));
  return { json: async () => ({ content: [{ text: JSON.stringify(arr.map(t => DICT[t] || t)) }] }) };
};
const H = new Function(
  ['plausiblyNonEnglish', 'englishOnly', 'translateBatchToEnglish', 'estimateEnglishFields', 'estimateLinesEnglish', 'vendorWantsSpanish', 'estimateLineItemsCanonical', 'findRecentDuplicate', 'scopeItemsFromEstimate', 'buildLaborDescription', 'buildInvoiceLines', 'invoiceInputsEnglish'].map(grab).join('\n') +
  '\nreturn { plausiblyNonEnglish, englishOnly, translateBatchToEnglish, estimateEnglishFields, estimateLinesEnglish, vendorWantsSpanish, estimateLineItemsCanonical, findRecentDuplicate, scopeItemsFromEstimate, buildLaborDescription, buildInvoiceLines, invoiceInputsEnglish };'
)();
const env = { ANTHROPIC_API_KEY: 'k' };
let curFetchTab = async () => []; globalThis.fetchTab = (e, t) => curFetchTab(e, t);   // findRecentDuplicate reads the global

// ── cheap pre-filter ──
{
  ok(H.plausiblyNonEnglish('Pintar la sala') && H.plausiblyNonEnglish('Instalación de puerta') && H.plausiblyNonEnglish('Se necesita más material'), 'Spanish text is detected');
  ok(!H.plausiblyNonEnglish('Paint the living room') && !H.plausiblyNonEnglish('Replace kitchen faucet, 2 hrs') && !H.plausiblyNonEnglish('') && !H.plausiblyNonEnglish('Labor'), 'English text is not sent to the model');
  ok(H.englishOnly('[ES] Pintar [EN] Paint') === 'Paint' && H.englishOnly('[ES] a\n[EN] b') === 'b' && H.englishOnly('plain') === 'plain' && H.englishOnly('[ES] solo') === 'solo', 'englishOnly resolves [ES]/[EN] tags (inline and multi-line) and leaves plain text alone');
}
// ── estimateEnglishFields ──
{
  calls = []; mode = 'ok';
  const items = [{ desc: 'Pintar la sala', amount: '300' }, { desc: 'Replace outlet', amount: '50' }];
  const r = await H.estimateEnglishFields(env, items, 'Se necesita más material', {});
  ok(r.ok && r.line_items[0].desc === 'Pintar la sala' && r.line_items[0].desc_en === 'Paint the living room', 'Spanish line: original kept, desc_en added');
  ok(r.line_items[1].desc_en === undefined && r.line_items[1].desc === 'Replace outlet', 'English line: no desc_en');
  ok(r.change_reason_en === 'Materials' || r.change_reason_en === 'More material is needed', 'Spanish change reason gets an English copy');
  ok(calls.length === 1 && !calls[0].includes('Replace outlet'), 'ONE batched call, English lines not sent');
  ok(items[0].desc_en === undefined, 'input not mutated');
}
{
  calls = [];
  const r = await H.estimateEnglishFields(env, [{ desc: 'Replace outlet', amount: '5' }], 'Initial', {});
  ok(r.ok && !r.called && calls.length === 0 && !r.line_items[0].desc_en, 'English-only estimate: zero model calls');
}
for (const m of ['throw', 'garbage', 'short']) {
  mode = m;
  const r = await H.estimateEnglishFields(env, [{ desc: 'Pintar la sala', amount: '1' }, { desc: 'Cambiar el lavabo', amount: '2' }], '', {});
  ok(r.ok === false && r.line_items[0].desc === 'Pintar la sala' && !r.line_items[0].desc_en, `model ${m}: ok=false, original untouched`);
}
{
  mode = 'ok'; calls = [];
  const r = await H.estimateEnglishFields(env, [{ desc: 'Replace outlet', amount: '5' }], '', { force: true });
  ok(calls.length === 1 && r.ok && !r.line_items[0].desc_en, 'force (Re-translate / Spanish vendor) sends every non-blank text but stores desc_en only when it differs');
  const stale = await H.estimateEnglishFields(env, [{ desc: 'Replace outlet', amount: '5', desc_en: 'old wrong english' }], '', { force: true });
  ok(!stale.line_items[0].desc_en, 're-translate clears a stale desc_en when the text is already English');
  const noKey = await H.estimateEnglishFields({}, [{ desc: 'Pintar la sala' }], '', {});
  ok(noKey.ok === false, 'no API key: ok=false');
}
// ── estimateLinesEnglish (helper for downstream) ──
{
  const lines = H.estimateLinesEnglish({ Line_Items: JSON.stringify([{ desc: 'Pintar', desc_en: 'Paint', amount: '5' }, { desc: '[ES] a [EN] b', amount: '1' }, { desc: 'Plain', amount: '2' }]) });
  ok(lines[0].desc === 'Paint' && lines[0].desc_orig === 'Pintar' && lines[1].desc === 'b' && lines[2].desc === 'Plain' && lines[2].desc_orig === undefined, 'estimateLinesEnglish: desc_en > tag EN half > desc; desc_orig carries the vendor wording');
  ok(H.estimateLinesEnglish('not json').length === 0 && H.estimateLinesEnglish(null).length === 0, 'garbage in -> empty');
}
// ── addEstimateVersion (real function) ──
function estHarness(existing, vendors) {
  const state = { rows: [], wo: [], ensure: [], stage: [] };
  const tabs = { Estimates: existing || [], Vendors: vendors || [], Work_Orders: [{ ID: '1222', Property_ID: 'P' }] };
  const deps = {
    json: (b, s) => ({ status: s || 200, body: b }),
    fetchTab: async (e, t) => (t === 'Estimates' ? tabs.Estimates.concat(state.rows) : tabs[t] || []),
    findRecentDuplicate: H.findRecentDuplicate, estimateLineItemsCanonical: H.estimateLineItemsCanonical,
    estimateEnglishFields: H.estimateEnglishFields, vendorWantsSpanish: H.vendorWantsSpanish,
    addRow: async (e, t, row) => { state.rows.push(Object.assign({ ID: String(100 + state.rows.length), Active: 'TRUE' }, row)); return { ok: true }; },
    ensureColumns: async (e, t, cols) => { state.ensure.push({ t, cols }); },
    updateWOField: async () => {}, updateWOFields: async () => {}, setApprovalStage: async (e, a) => { state.stage.push(a); },
    findWO: (l, id) => l.find(w => w.ID === id),
  };
  curFetchTab = deps.fetchTab;
  const names = Object.keys(deps);
  const fn = new Function(...names, grab('addEstimateVersion') + '\nreturn addEstimateVersion;')(...names.map(k => deps[k]));
  return { fn, state };
}
{
  mode = 'ok'; calls = [];
  const { fn, state } = estHarness();
  const body = { wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Pintar la sala', amount: '300' }, { desc: 'Cambiar el lavabo', amount: '120' }], created_by: 'vendor' };
  const r = await fn(env, body);
  const stored = JSON.parse(state.rows[0].Line_Items);
  ok(r.body.success && r.body.version === 1 && r.body.subtotal === '420.00', 'Spanish estimate saved; version/subtotal unchanged');
  ok(stored[0].desc === 'Pintar la sala' && stored[0].desc_en === 'Paint the living room' && stored[1].desc_en === 'Replace the sink', 'Line_Items JSON keeps the original desc and adds desc_en per line (WO-1222 case)');
  ok(stored[0].amount === '300', 'amounts untouched');
  ok(state.rows[0].Change_Reason === 'Initial estimate' && state.rows[0].Change_Reason_EN === undefined, 'v1: no Change_Reason_EN needed');
  ok(body.line_items[0].desc_en === undefined, 'request body not mutated');
}
{
  mode = 'ok';
  const { fn, state } = estHarness([{ ID: '1', WO_ID: '1222', Version: '1', Line_Items: '[]', Active: 'TRUE' }]);
  await fn(env, { wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Materiales y mano de obra', amount: '90' }], change_reason: 'Se necesita más material' });
  ok(state.rows[0].Version === '2' && state.rows[0].Change_Reason === 'Se necesita más material' && state.rows[0].Change_Reason_EN === 'More material is needed', 'v2: original Change_Reason kept, Change_Reason_EN added');
  ok(state.ensure.some(e => e.t === 'Estimates' && e.cols.includes('Change_Reason_EN')), 'Change_Reason_EN column is ensureColumns-ed before the write (no silent drop)');
}
{
  calls = []; mode = 'ok';
  const { fn, state } = estHarness();
  const r = await fn(env, { wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Replace faucet', amount: '80' }] });
  ok(r.body.success && calls.length === 0 && !JSON.parse(state.rows[0].Line_Items)[0].desc_en, 'English estimate from an English vendor: no model call, no desc_en, stored as before');
}
{
  calls = []; mode = 'ok';
  const { fn, state } = estHarness([], [{ ID: 'V9', Language: 'es' }]);
  await fn(env, { wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Replace faucet', amount: '80' }] });
  ok(calls.length === 1, 'Spanish-language vendor: text is always run through the translator (force)');
}
{
  mode = 'throw';
  const { fn, state } = estHarness();
  const r = await fn(env, { wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Pintar la sala', amount: '300' }] });
  ok(r.status === 200 && r.body.success && JSON.parse(state.rows[0].Line_Items)[0].desc === 'Pintar la sala' && !JSON.parse(state.rows[0].Line_Items)[0].desc_en, 'translation failure never blocks the estimate; original saved, no desc_en');
}
{
  // double-tap guard still works now that stored Line_Items carries desc_en
  mode = 'ok';
  const { fn, state } = estHarness();
  const body = () => ({ wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Pintar la sala', amount: '300' }] });
  await fn(env, body());
  state.rows[0].Created_Date = new Date().toISOString();
  const again = await fn(env, body());
  ok(again.body.duplicate === true && state.rows.length === 1, 'an identical re-submit within 120s is still caught as a duplicate (desc_en ignored in the comparison)');
  const revised = await fn(env, { wo_id: '1222', vendor_id: 'V9', line_items: [{ desc: 'Pintar la sala', amount: '350' }] });
  ok(!revised.body.duplicate && state.rows.length === 2 && state.rows[1].Version === '2', 'a real revision (different amount) is not swallowed');
  ok(H.estimateLineItemsCanonical('[{"desc":"a","desc_en":"b","amount":"1"}]') === '[{"desc":"a","amount":"1"}]', 'canonical form strips only desc_en');
}
// ── retranslate endpoint ──
function retHarness(estimates, workorders) {
  const state = { updates: [], ensure: [], tel: [] };
  const deps = {
    json: (b, s) => ({ status: s || 200, body: b }),
    fetchTab: async (e, t) => t === 'Estimates' ? estimates : (workorders || []),
    estimateEnglishFields: H.estimateEnglishFields,
    ensureColumns: async (e, t, c) => { state.ensure.push({ t, c }); },
    updateRow: async (e, t, id, f) => { state.updates.push({ t, id, f }); return {}; },
    logTelemetry: async (e, t) => { state.tel.push(t); },
  };
  const names = Object.keys(deps);
  return { fn: new Function(...names, grab('retranslateEstimate') + '\nreturn retranslateEstimate;')(...names.map(k => deps[k])), state };
}
const EST = { ID: '77', WO_ID: '1222', Version: '2', Line_Items: JSON.stringify([{ desc: 'Pintar la sala', amount: '300' }, { desc: 'Replace outlet', amount: '5', desc_en: 'stale' }]), Change_Reason: 'Se necesita más material', Active: 'TRUE' };
{
  mode = 'ok'; calls = [];
  const { fn, state } = retHarness([EST]);
  const r = await fn(env, { estimate_id: '77' });
  const u = state.updates[0];
  ok(r.body.success && r.body.changed === true && r.body.estimate_id === '77', 'retranslate by estimate_id: success + changed');
  const lines = JSON.parse(u.f.Line_Items);
  ok(lines[0].desc === 'Pintar la sala' && lines[0].desc_en === 'Paint the living room' && !lines[1].desc_en && lines[1].amount === '5', 'writes desc_en, keeps originals + amounts, clears a stale desc_en on an already-English line');
  ok(u.f.Change_Reason_EN === 'More material is needed' && !('Change_Reason' in u.f) && !('Subtotal' in u.f), 'only derived English fields are written — Change_Reason/Subtotal never touched');
  ok(u.t === 'Estimates' && u.id === '77' && state.ensure[0].c.includes('Change_Reason_EN'), 'row targeted by ID; column ensured first');
  ok(r.body.line_items[0].desc_en && r.body.change_reason_en, 'response returns the new values');
}
{
  mode = 'ok';
  const { fn } = retHarness([EST]);
  const r = await fn(env, { wo_id: '1222', version: '2' });
  ok(r.body.success && r.body.version === '2', 'retranslate by wo_id + version works');
  ok((await fn(env, {})).status === 400 && (await fn(env, { estimate_id: 'nope' })).status === 404, '400 with no selector, 404 for unknown estimate');
  const empty = retHarness([Object.assign({}, EST, { Line_Items: '[]' })]);
  ok((await empty.fn(env, { estimate_id: '77' })).status === 400, 'no line items -> 400');
}
{
  mode = 'throw';
  const { fn, state } = retHarness([EST]);
  const r = await fn(env, { estimate_id: '77' });
  ok(r.status === 502 && r.body.success === false && /unavailable/i.test(r.body.error) && state.updates.length === 0, 'translation outage: 502, clear message, NOTHING written (existing English kept)');
}
// ── English used downstream ──
{
  const items = H.scopeItemsFromEstimate([{ desc: 'Pintar la sala', desc_en: 'Paint the living room', amount: '300' }, { desc: 'Replace outlet', amount: '50' }], []);
  ok(items[0].description === 'Paint the living room' && items[0].description_orig === 'Pintar la sala', 'push-to-scope: owner-facing description is English, vendor wording kept as description_orig');
  ok(items[1].description === 'Replace outlet' && !('description_orig' in items[1]), 'English lines unchanged, no description_orig');
  ok(items[0].variants[0].vendor_cost === 300 && items[0].selected_key === 'v1', 'pricing shape unchanged');
  const tagged = H.scopeItemsFromEstimate([{ desc: '[ES] Pintar [EN] Paint', amount: '1' }], []);
  ok(tagged[0].description === 'Paint', 'tagged text resolves to English');
}
{
  const push = grab('woPushToScope');
  ok(push.includes('plausiblyNonEnglish(li.desc)') && push.includes('translateBatchToEnglish(env'), 'woPushToScope translates older Spanish estimate lines (no desc_en yet) in memory before mapping');
  ok(/scopeCleanItems[\s\S]{0,80}/.test(src) && grab('scopeCleanItems').includes('description_orig'), 'scopeCleanItems keeps description_orig so a later Scope save does not lose the vendor wording');
  const se = grab('scopeEstimate');
  ok(se.includes('Estimate_Notes_Orig') && se.includes('translateBatchToEnglish'), 'scopeEstimate stores English Estimate_Notes and keeps the original in Estimate_Notes_Orig');
  const ge = grab('generateEstimateText');
  ok(ge.includes('englishOnly(li.desc_en || li.desc)') && ge.includes('write it in English'), 'the client-ready Generate Text uses desc_en and tells the model to write English');
}
{
  // invoice: buildLaborDescription / buildInvoiceLines emit English
  const wo = { Description: 'x' };
  ok(H.buildLaborDescription({ ID: '1', Invoice_Description: '[ES] Cambiar lavabo\n[EN] Replaced sink' }, [], wo) === 'Replaced sink', 'invoice: bill Invoice_Description tagged [ES]/[EN] -> English half');
  const te = [{ Bill_ID: '1', Active: 'TRUE', Start_DateTime: '2026-09-01T10:00', Invoice_Description: '[ES] Pintar [EN] Painted' }];
  ok(H.buildLaborDescription({ ID: '1' }, te, wo) === '2026-09-01 — Painted', 'invoice: time entry description -> English half');
  const inv = H.buildInvoiceLines({ Customer_Total: '200', WO_ID: '1' }, { ID: '1', Receipts_JSON: JSON.stringify([{ amount: 50, desc: '[ES] Tubo [EN] Pipe' }]), Truck_Stock: '10', Truck_Desc: '[ES] tornillos [EN] screws', Invoice_Description: 'Fix' }, { item: '9' }, 'Plumbing', wo, null, [{ Amount: 5, Description: '[ES] pintura [EN] paint' }], []);
  const d = inv.lines.map(l => l.Description).join(' | ');
  ok(!/\[ES\]|\[EN\]|Tubo|tornillos|pintura/.test(d) && d.includes('Pipe') && d.includes('screws') && d.includes('paint'), 'invoice lines: no [ES]/[EN] tags or Spanish leftovers on materials/truck/receipt lines');
  // async pre-pass: untagged Spanish translated in memory only
  mode = 'ok'; calls = [];
  const bill = { ID: '1', Invoice_Description: 'Pintar la sala', Truck_Desc: '' };
  const ents = [{ Bill_ID: '1', Active: 'TRUE', Invoice_Description: 'Cambiar el lavabo' }, { Bill_ID: '1', Active: 'TRUE', Invoice_Description: 'Replaced outlet' }];
  const en = await H.invoiceInputsEnglish(env, bill, ents);
  ok(en.billRow.Invoice_Description === 'Paint the living room' && en.timeEntries[0].Invoice_Description === 'Replace the sink' && en.timeEntries[1].Invoice_Description === 'Replaced outlet', 'invoiceInputsEnglish: Spanish free text becomes English, English untouched');
  ok(bill.Invoice_Description === 'Pintar la sala' && ents[0].Invoice_Description === 'Cambiar el lavabo', 'originals in the Sheet rows are never mutated (in-memory only)');
  ok(calls.length === 1, 'one batched call for the whole invoice');
  mode = 'throw';
  const fail = await H.invoiceInputsEnglish(env, bill, ents);
  ok(fail.billRow.Invoice_Description === 'Pintar la sala', 'failure fails open to the original');
  const callSites = src.match(/await invoiceInputsEnglish\(env,/g) || [];
  ok(callSites.length === 4, 'all four buildInvoiceLines call sites run the pre-pass');
  ok(!/buildInvoiceLines\([^)]*, billRow, trade/.test(src.replace(/function buildInvoiceLines\(/, '')), 'no call site passes the raw billRow anymore');
}
{
  ok(/findVendorPricingLeak\(v\.rc_materials_desc/.test(src), 'findVendorPricingLeak guard on proposal build is still in place');
}
// ── UI ──
{
  const rv = grabFrom(html, 'renderHubEstimateView');
  ok(rv.includes("<b>English:</b> ' + esc(li.desc_en)") && rv.includes('li.desc_en') && rv.includes("String(li.desc || '').trim()"), 'estimate panel shows the original, then an English: line only when it differs');
  ok(rv.includes('Change_Reason_EN'), 'change reason English shown');
  ok(rv.includes('🌐 Re-translate') && rv.includes('retranslateEstimateUI('), 'panel has the Re-translate button');
  const rt = grabFrom(html, 'retranslateEstimateUI');
  ok(rt.includes("'/estimate/retranslate'") && rt.includes('estimate_id') && rt.includes('btn.disabled = true') && rt.includes('refreshHubEstimateView(woId)') && rt.includes('delete _estimateCache[woId]'), 'button posts to /estimate/retranslate, is double-tap safe, and refreshes the panel from a busted cache');
  const rvt = grabFrom(html, 'renderVendorText');
  ok(rvt.includes('vt-en') && rvt.includes('Original (ES)'), 'Review Bills: [ES]/[EN] vendor text shows English first, original beneath');
  ok(grabFrom(html, 'invComposeMemo').includes('enOnly('), 'the invoice memo composer uses the English half');
  ok((html.match(/renderVendorText\(bill\.Notes\)|renderVendorText\(b\.Notes\)/g) || []).length === 3, 'all three bill Notes displays use it');
  ok(/'\/estimate\/retranslate'/.test(src) === false || /path === '\/estimate\/retranslate'\)\s+return await retranslateEstimate/.test(src), 'route registered');
  const roleBlock = src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('const ROLE_SCOPES') + 6000);
  ok(!roleBlock.includes('/estimate/retranslate'), '/estimate/retranslate is in no role scope: admin-only');
  ok(src.includes("path === '/estimate/retranslate') {"), 'hubTestWriteAllowed has a TEST-record case for it');
}
console.log(`estimate-translation: ${n}/${n} passing`);
