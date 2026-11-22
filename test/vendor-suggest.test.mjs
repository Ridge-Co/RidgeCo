// Queue #58 Phase 1 (Nov 22 2026): vendor suggestions in the Assign Vendor box and the New Work Order box.
// Pure functions are pulled out of worker.js by source-slicing (same style as test/vendor-onboarding.test.mjs).
import fs from 'fs';
import vm from 'node:vm';
import assert from 'node:assert';
const W = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const H = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
function grab(src, sig) {
  const st = src.indexOf(sig); if (st < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', st); let d = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } }
  return src.slice(st, i + 1);
}
const ctx = vm.createContext({ console, JSON, Math, Number, String, Object, Array, isFinite, parseInt, Date, RegExp });
vm.runInContext('const VENDOR_SUGGEST_DEFAULT_WEIGHTS = { completion: 40, speed: 30, price: 15, workload: 15 }; const VENDOR_SUGGEST_LIMIT = 3;\n' +
  grab(W, 'function vendorTradeTokens') + '\n' + grab(W, 'function vendorSuggestWeights') + '\n' + grab(W, 'function rankVendorsForJob'), ctx);
const rank = (rows, job, o) => JSON.parse(vm.runInContext('JSON.stringify(rankVendorsForJob(' + JSON.stringify(rows) + ',' + JSON.stringify(job) + ',' + JSON.stringify(o || {}) + '))', ctx));
const tok = (s) => vm.runInContext('vendorTradeTokens(' + JSON.stringify(s) + ')', ctx);
const wts = (s) => JSON.parse(vm.runInContext('JSON.stringify(vendorSuggestWeights(' + JSON.stringify(s) + '))', ctx));
const V = (id, name, trade, o) => Object.assign({ vendor_id: id, name, trade, jobs_total: 20, jobs_completed: 18, jobs_open: 1, jobs_open_urgent: 0, completion_rate: 0.9, avg_days_to_complete: 4, total_billed: 2000, bill_count: 10, avg_bill: 200, last_activity: '2026-11-01' }, o || {});

// trade match
ok(JSON.stringify(tok('Plumbing, HVAC')) === '["plumbing","hvac"]', 'comma list splits');
ok(JSON.stringify(tok('Pest Control')) === '["pestcontrol"]', 'spaces and capitals ignored');
ok(JSON.stringify(tok('Plumbing/Electrical')) === '["plumbing","electrical"]', 'slash splits');
{
  const rows = [V('1', 'A', 'Plumbing'), V('2', 'B', 'plumbing'), V('3', 'C', 'Plumbing, HVAC'), V('4', 'D', 'Electrical')];
  const r = rank(rows, { trade: ' PLUMBING ' });
  ok(r.suggestions.map(s => s.vendor_id).sort().join() === '1,2,3', 'exact, other capitals and comma-list vendors all match; a different trade is never suggested');
  ok(rank(rows, { trade: 'Roofing' }).reason === 'no_vendor_for_trade' && rank(rows, { trade: 'Roofing' }).suggestions.length === 0, 'no vendor for the trade: empty with a reason');
  ok(rank(rows, { trade: '' }).reason === 'no_trade' && rank(rows, { trade: undefined }).reason === 'no_trade', 'blank job trade: no suggestion, reason no_trade');
}
// order, ties, low history, workload, limit
{
  const rows = [
    V('1', 'Slow', 'Plumbing', { avg_days_to_complete: 10, completion_rate: 0.8, jobs_completed: 16 }),
    V('2', 'Best', 'Plumbing', { avg_days_to_complete: 2, completion_rate: 0.98, avg_bill: 150 }),
    V('3', 'Mid', 'Plumbing', { avg_days_to_complete: 5, completion_rate: 0.9 }),
    V('4', 'Pricey', 'Plumbing', { avg_days_to_complete: 4, completion_rate: 0.95, avg_bill: 900 }),
    V('5', 'Newbie', 'Plumbing', { jobs_completed: 1, jobs_total: 1, completion_rate: 1, avg_days_to_complete: 1 }),
  ];
  const r = rank(rows, { trade: 'Plumbing' }, { limit: 5 });
  ok(r.suggestions[0].name === 'Best', 'best completion + speed + price ranks first', r.suggestions.map(s => s.name));
  ok(r.suggestions[r.suggestions.length - 1].name === 'Newbie' && r.suggestions[r.suggestions.length - 1].low_history === true, 'a vendor under the minimum finished jobs is listed last and flagged, even with a perfect rate');
  ok(/New - not enough history/.test(r.suggestions[4].reason), 'low-history reason says so');
  ok(rank(rows, { trade: 'Plumbing' }).suggestions.length === 3, 'default cap is 3');
  ok(/^20 jobs, 98% finished, about 2 days each, 1 open now$/.test(r.suggestions[0].reason), 'reason is plain words matching the scorecard numbers', r.suggestions[0].reason);
  const raised = rank(rows, { trade: 'Plumbing' }, { limit: 5, minJobs: 25 });
  ok(raised.suggestions.every(s => s.low_history), 'min jobs setting changes who counts as new');
}
{ // ties: same numbers -> most recent last_activity, then name
  const rows = [V('1', 'Zed', 'HVAC', { last_activity: '2026-11-10' }), V('2', 'Amy', 'HVAC', { last_activity: '2026-11-10' }), V('3', 'Old', 'HVAC', { last_activity: '2026-01-01' })];
  const r = rank(rows, { trade: 'HVAC' });
  ok(r.suggestions.map(s => s.name).join() === 'Amy,Zed,Old', 'tie: recent activity first, then name', r.suggestions.map(s => s.name));
}
{ // workload nudge: same scores otherwise, fewer open wins; urgent counts more
  const rows = [V('1', 'Busy', 'HVAC', { jobs_open: 6 }), V('2', 'Free', 'HVAC', { jobs_open: 0 }), V('3', 'Urgent', 'HVAC', { jobs_open: 2, jobs_open_urgent: 2 }), V('4', 'TwoOpen', 'HVAC', { jobs_open: 2 })];
  const r = rank(rows, { trade: 'HVAC' }, { limit: 4 });
  ok(r.suggestions[0].name === 'Free' && r.suggestions[3].name === 'Busy', 'fewer open jobs ranks higher', r.suggestions.map(s => s.name));
  const idx = (nm) => r.suggestions.findIndex(s => s.name === nm);
  ok(idx('TwoOpen') < idx('Urgent'), 'an open urgent job counts more than an ordinary one');
}
{ // missing data is neutral, not a crash
  const rows = [V('1', 'NoData', 'HVAC', { completion_rate: null, avg_days_to_complete: null, bill_count: 0, avg_bill: 0, jobs_completed: 5 }), V('2', 'Other', 'HVAC')];
  const r = rank(rows, { trade: 'HVAC' });
  ok(r.suggestions.length === 2 && r.suggestions.every(s => isFinite(s.score)), 'null completion / days / bills still score');
}
// weights
ok(wts('').warning === '' && wts('').weights.completion === 40, 'blank weights = defaults, no warning');
ok(wts('{"completion":10,"price":50}').weights.price === 50 && wts('{"completion":10,"price":50}').weights.speed === 30, 'Config weights override only the keys given');
{
  const bad = wts('{nope');
  ok(/not valid/.test(bad.warning) && bad.weights.completion === 40, 'broken JSON falls back to defaults and reports it');
  ok(/not valid/.test(wts('{"speed":-5}').warning) && /not valid/.test(wts('[1]').warning), 'negative or non-object weights are reported and ignored');
  const r1 = rank([V('1', 'A', 'HVAC', { avg_days_to_complete: 1, avg_bill: 900 }), V('2', 'B', 'HVAC', { avg_days_to_complete: 9, avg_bill: 100 })], { trade: 'HVAC' }, { weights: { completion: 0, speed: 0, price: 100, workload: 0 } });
  ok(r1.suggestions[0].name === 'B', 'all weight on price puts the cheaper vendor first');
}
// source checks
{
  const pub = W.slice(W.indexOf('const PUBLIC_PATHS'), W.indexOf(']', W.indexOf('const PUBLIC_PATHS')));
  ok(!/vendor-suggest/.test(pub), '/vendor-suggest is not in PUBLIC_PATHS');
  ok((W.match(/'\/vendor-suggest'/g) || []).length === 2, '/vendor-suggest appears only as the route and its telemetry label (not in any role path list)');
  const fn = grab(W, 'async function vendorSuggest');
  ok(/vendor_suggest_enabled/.test(fn) && fn.indexOf('vendor_suggest_enabled') < fn.indexOf('fetchTabs'), 'the switch is read before the batched read, so OFF costs no Sheets reads of the four tabs');
  ok((fn.match(/fetchTabs\(/g) || []).length === 1, 'one batched read per call');
  ok(!/sheetsRequest\([^)]*'(POST|PUT)'|appendRow|addRow|updateRow|sendSms|sendSMS/.test(fn), 'the endpoint writes nothing and texts nothing');
  ok(/Success: 'FALSE'/.test(fn) && /Job_Type: 'vendor_suggest'/.test(fn) && /ok: false/.test(fn), 'a failure is logged to Ops_Telemetry and returned as ok:false (never an empty list)');
  ok(/logTelemetry/.test(fn) && /console\.error/.test(fn), 'if logging itself fails it is shown in the Worker log, not swallowed');
}
// vendorPerfRows refactor: scorecard output unchanged
{
  const pre = "const WOStatus={sets:{DONE_THROUGH_PAID:['Complete','Paid']}};const OPEN_WO_STATUSES=['New','Assigned','In Progress','Complete'];const json=(o)=>o;";
  const vendors = [{ ID: 'V1', Name: 'A', Trades: 'Plumbing', Active: 'TRUE' }, { ID: 'V2', Name: 'B', Trade: 'HVAC', Active: 'FALSE' }];
  const wos = [{ Vendor_ID: 'V1', Status: 'Complete', Created_Date: '2026-01-01', Completed_Date: '2026-01-04', Priority: 'normal' }, { Vendor_ID: 'V1', Status: 'In Progress', Created_Date: '2026-02-01', Priority: 'urgent' }];
  const bills = [{ Vendor_ID: 'V1', Total: '100', Created_Date: '2026-01-05' }];
  const times = [{ Role: 'vendor', Entered_By_ID: 'V1', Duration_Minutes: '90' }];
  const c2 = vm.createContext({ Date, Math, Number, String, parseFloat, isNaN, Set, JSON });
  vm.runInContext(pre + grab(W, 'function vendorPerfRows') + grab(W, 'async function vendorPerformance') + ';globalThis.fetchTabs = async () => [' + [vendors, wos, bills, times].map(x => JSON.stringify(x)).join(',') + '];', c2);
  const out = await vm.runInContext('vendorPerformance({}, {})', c2);
  ok(out.vendors.length === 1 && out.vendors[0].jobs_total === 2 && out.vendors[0].jobs_completed === 1 && out.vendors[0].jobs_open === 1 && out.vendors[0].jobs_open_urgent === 1 && out.vendors[0].avg_days_to_complete === 3 && out.vendors[0].avg_bill === 100 && out.vendors[0].labor_hours === 1.5 && out.totals.open_jobs === 1, 'vendorPerformance still returns the same numbers after the helper extraction');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(out.as_of), 'as_of still present');
}
// client source checks
{
  const sa = H.slice(H.indexOf('function submitAssign()'));
  ok(/^function submitAssign\(\) \{\n  var btn = [^\n]*disabled = true;/.test(sa), 'submitAssign disables its button on its first line (it sends a text)');
  ok((sa.slice(0, 1400).match(/btn\.disabled = false/g) || []).length >= 3, 'the button is restored on validation failure, success and error');
  ok(/id="wo-vendor-opt"[^>]*><option value="">Assign after creation<\/option>/.test(H), 'New Work Order: "Assign after creation" is still the default option');
  const open = H.slice(H.indexOf('function openAssignModal'), H.indexOf('function renderAssignVendorOptions'));
  ok(!/\.value = (v|s|items)/.test(open) && /loadAssignSuggestions\(\)/.test(open), 'opening the Assign box only loads suggestions; nothing is selected for Brett');
  const loader = H.slice(H.indexOf('function loadAssignSuggestions'), H.indexOf('function renderAssignVendorOptions'));
  ok(!/api\('POST'/.test(loader) && /'GET', '\/vendor-suggest\?wo_id='/.test(loader), 'the suggestion call is a GET only');
  ok(/4000/.test(loader) && /Suggestions unavailable - showing all vendors\./.test(loader) && /assign-suggest-retry/.test(loader), 'slow or failed suggestions: the one-line message, a Retry button, the list still works');
  ok(/logError\('Vendor suggest'/.test(loader), 'a failed suggestion is logged, not swallowed');
  const wo = H.slice(H.indexOf('function woTradeChanged'), H.indexOf('function woVendorOptChanged'));
  ok(!/\.value = items|value = '\d|vs\.value = (res|items)/.test(wo) && /vs\.value = cur/.test(wo), 'New Work Order: the suggestion never changes the selected vendor');
  ok(/onchange="woTradeChanged\(\)"/.test(H), 'the trade select calls woTradeChanged');
}
console.log('vendor-suggest: ' + n + ' checks passed');
