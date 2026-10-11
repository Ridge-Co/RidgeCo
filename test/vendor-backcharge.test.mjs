// Vendor back-charges (Oct 11 2026) — offline tests. Extracts the REAL back-charge block and the real
// sheet helpers from worker.js and runs them against an in-memory fake Sheets backend; the QuickBooks
// boundary (qbAccessToken / qbApi / qbFault) is mocked, so this proves the Hub calls QB correctly and
// handles every failure loudly — not that Intuit accepts a negative AccountBased bill line.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
function grabRange(src, a, b) {
  const s = src.indexOf(a); if (s < 0) throw new Error('not found: ' + a);
  const e = src.indexOf(b, s); if (e < 0) throw new Error('end not found: ' + b);
  return src.slice(s, e);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', n); } };

const bcBlock = grabRange(wsrc, 'const BACKCHARGE_TAB', 'async function addEstimateVersion');
const parts = [
  grabRange(wsrc, 'const __tabCache = new Map();', '// Google throttles Sheets reads'),
  grab(wsrc, 'async function sheetsRequest('), grab(wsrc, 'async function ensureColumns('), grab(wsrc, 'async function ensureColumnsInner('),
  grab(wsrc, 'function idColIndex('), grab(wsrc, 'function col(index'), grab(wsrc, 'function json(data'),
  grab(wsrc, 'async function fetchTab('), grab(wsrc, 'async function fetchTabs('), grab(wsrc, 'function findWO('),
  grab(wsrc, 'async function addRow('), grab(wsrc, 'async function updateRow('), grab(wsrc, 'async function ensureTab('),
  grab(wsrc, 'function isMissingTabError('), grab(wsrc, 'function missingTabResponse('),
  grab(wsrc, 'async function findRecentDuplicate('), grab(wsrc, 'async function logAndCollectError('),
  bcBlock,
];

// ── fake Sheets ───────────────────────────────────────────────────────────
function makeFetch(db, hooks) {
  return async (url, opts) => {
    const full = url.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/:]+/, '');
    const path = full.split('?')[0]; const method = opts.method || 'GET';
    let m;
    if (method === 'GET' && path === '/values:batchGet') {
      const names = [...full.split('?')[1].matchAll(/ranges=([^&]+)/g)].map(x => decodeURIComponent(x[1]));
      return { json: async () => ({ valueRanges: names.map(n => ({ values: db[n] ? [db[n].headers, ...db[n].rows] : [] })) }) };
    }
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) {
      const tab = db[m[1]];
      if (!tab) return { json: async () => ({ error: { code: 400, message: 'Unable to parse range: ' + m[1] } }) };
      return { json: async () => ({ values: [tab.headers, ...tab.rows] }) };
    }
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append$/.exec(path))) {
      const tab = db[m[1]]; const vals = JSON.parse(opts.body).values;
      if (!tab.headers.length) tab.headers = vals[0].slice(); else vals.forEach(v => tab.rows.push(v.slice()));
      return { json: async () => ({}) };
    }
    if (method === 'POST' && path === ':batchUpdate') {
      for (const r of JSON.parse(opts.body).requests) if (r.addSheet) db[r.addSheet.properties.title] = { headers: [], rows: [] };
      return { json: async () => ({}) };
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of JSON.parse(opts.body).data) {
        if (hooks && hooks.dropWrites && hooks.dropWrites(d)) continue;
        const [tabName, ref] = d.range.split('!'); const letters = ref.match(/[A-Z]+/)[0]; const rowNum = parseInt(ref.match(/\d+/)[0], 10);
        let ci = 0; for (const ch of letters) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1;
        const tab = db[tabName]; if (!tab) continue;
        if (rowNum === 1) { tab.headers[ci] = d.values[0][0]; continue; }
        if (tab.rows[rowNum - 2]) { while (tab.rows[rowNum - 2].length <= ci) tab.rows[rowNum - 2].push(''); tab.rows[rowNum - 2][ci] = d.values[0][0]; }
      }
      return { json: async () => ({}) };
    }
    throw new Error('unhandled mock path: ' + method + ' ' + path);
  };
}
const tabOf = (headers, rows) => ({ headers: headers.slice(), rows: rows.map(r => headers.map(h => r[h] ?? '')) });
const WO_H = ['ID', 'Property_ID', 'Vendor_ID', 'Status'];
const V_H = ['ID', 'Name', 'In_House'];
const TE_H = ['ID', 'WO_ID', 'Role', 'Duration_Minutes', 'Billable', 'Active', 'Bill_ID', 'Billed_Bill_ID', 'Date'];
const VB_H = ['ID', 'WO_ID', 'Active'];
const IR_H = ['ID', 'WO_ID', 'Vendor_ID', 'QB_Bill_ID', 'QB_Bill_Number', 'Active'];

function makeDb(over) {
  return Object.assign({
    Work_Orders: tabOf(WO_H, [{ ID: 'WO-1', Vendor_ID: 'V-1', Status: 'In Progress' }]),
    Vendors: tabOf(V_H, [{ ID: 'V-1', Name: 'Cesar' }, { ID: 'V-2', Name: 'In-house Joe', In_House: 'TRUE' }]),
    Time_Entries: tabOf(TE_H, [
      { ID: '1', WO_ID: 'WO-1', Role: 'hub', Duration_Minutes: '60', Billable: 'TRUE', Active: 'TRUE' },
      { ID: '2', WO_ID: 'WO-1', Role: 'hub', Duration_Minutes: '30', Billable: 'TRUE', Active: 'TRUE' },
      { ID: '3', WO_ID: 'WO-1', Role: 'vendor', Duration_Minutes: '60', Billable: 'TRUE', Active: 'TRUE' },
      { ID: '4', WO_ID: 'WO-1', Role: 'hub', Duration_Minutes: '60', Billable: 'TRUE', Active: 'TRUE', Bill_ID: '9' },
    ]),
    Vendor_Bills: tabOf(VB_H, [{ ID: '9', WO_ID: 'WO-1', Active: 'TRUE' }]),
    Invoice_Review: tabOf(IR_H, []),
  }, over || {});
}
function qbMock() {
  return `
    async function qbAccessToken() { if (qbState.tokenFails) throw new Error('mock QB auth failure'); return 'tok'; }
    function qbFault(r) { return (r && r.Fault && r.Fault.Error && r.Fault.Error[0] && r.Fault.Error[0].Message) || null; }
    async function qbApi(env, path, method, body) {
      qbState.calls.push({ path, method, body });
      if (method === 'GET') return qbState.getResult;
      return qbState.postResult(body);
    }
    async function logTelemetry(env, row) { qbState.telemetry.push(row); }
  `;
}
function build(db, qbState, hooks) {
  qbState.calls = []; qbState.telemetry = [];
  const src = ['const CORS = {};', 'const qbState = arguments[3];', parts[0], qbMock(), ...parts.slice(1),
    'return { planBackchargeLines, backchargeAdd, backchargeVoid, backchargeApplyToQb, backchargeList, backchargeRowsFor, backchargeMarkApplied, backchargeBillState, backchargeLineDescription };'].join('\n');
  return new Function('getAccessToken', 'fetch', 'setTimeout', 'qbStateArg', src.replace('arguments[3]', 'qbStateArg'))(async () => 'tok', makeFetch(db, hooks), fn => fn(), qbState);
}
const env = { SHEET_ID: 'S' };
const bcRows = db => db.Vendor_Backcharges.rows.map(r => Object.fromEntries(db.Vendor_Backcharges.headers.map((h, i) => [h, r[i]])));
const teRow = (db, id) => { const r = db.Time_Entries.rows.find(x => x[0] === id); return Object.fromEntries(db.Time_Entries.headers.map((h, i) => [h, r[i]])); };

console.log('Vendor back-charge — offline tests\n');

// ── planBackchargeLines (pure) ────────────────────────────────────────────
{
  const { planBackchargeLines } = build(makeDb(), {});
  const p = planBackchargeLines(1000, [{ ID: '1', Amount: '100', Hours: '1.18', Rate: '85', Description: 'Work completed by Brett, included in estimate' }], '68');
  t('$1000 − $100 → $900 net', p.netTotal === 900 && p.appliedTotal === 100 && p.unappliedTotal === 0);
  t('one NEGATIVE expense line, same account', p.lines.length === 1 && p.lines[0].Amount === -100 && p.lines[0].AccountBasedExpenseLineDetail.AccountRef.value === '68');
  t('line text carries the description', /Work completed by Brett, included in estimate/.test(p.lines[0].Description));
  const f = planBackchargeLines(60, [{ ID: '1', Amount: '100' }], '68');
  t('floored at $0: only $60 taken', f.appliedTotal === 60 && f.netTotal === 0 && f.lines[0].Amount === -60);
  t('remainder reported as unapplied, not dropped', f.unappliedTotal === 40 && f.items[0].unapplied === 40);
  const s = planBackchargeLines(150, [{ ID: '1', Amount: '100' }, { ID: '2', Amount: '100' }], '68');
  t('stacking: second one is split to fit', s.appliedTotal === 150 && s.items[1].applied === 50 && s.items[1].unapplied === 50 && s.netTotal === 0);
  const z = planBackchargeLines(0, [{ ID: '1', Amount: '100' }], '68');
  t('zero bill → no line at all, all unapplied', z.lines.length === 0 && z.unappliedTotal === 100);
  t('no back-charges → untouched', planBackchargeLines(500, [], '68').netTotal === 500);
  const desc = build(makeDb(), {}).backchargeLineDescription({ Hours: '1', Rate: '85', Amount: '85', Description: 'x', Private_Note: 'SECRET NOTE' });
  t('private note never in the vendor-visible text', !/SECRET/.test(desc) && /1 hr × \$85\.00\/hr/.test(desc));
}

// ── add: validation ───────────────────────────────────────────────────────
{
  const db = makeDb(); const { backchargeAdd } = build(db, {});
  const j = async r => ({ s: r.status, b: await r.json() });
  let r = await j(await backchargeAdd(env, {})); t('wo_id required', r.s === 400);
  r = await j(await backchargeAdd(env, { wo_id: 'WO-9' })); t('unknown WO → 404', r.s === 404);
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1', vendor_id: 'V-2', hours: 1 })); t('in-house vendor rejected', r.s === 400 && /in-house/.test(r.b.error));
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1', vendor_id: 'V-77', hours: 1 })); t('unknown vendor → 404', r.s === 404);
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1' })); t('no hours / amount → 400, nothing written', r.s === 400 && bcRows(db).length === 0);
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1', hours: 1, amount: 99999 })); t('absurd amount rejected', r.s === 400);
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['3'] })); t('vendor-role time entry rejected', r.s === 400 && /not your own/.test(r.b.error));
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['4'] })); t('time already inside a live vendor bill rejected', r.s === 409);
  r = await j(await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['99'] })); t('unknown time entry rejected', r.s === 400);
}

// ── add: happy path from time entries ─────────────────────────────────────
{
  const db = makeDb(); const { backchargeAdd } = build(db, {});
  const res = await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['1', '2'], private_note: 'skipped item 9' });
  const b = await res.json(); const rows = bcRows(db);
  t('success + 1.5h × $85 default = $127.50', b.success && b.amount === '127.50' && b.hours === 1.5 && b.rate === 85);
  t('row stored pending with default description', rows.length === 1 && rows[0].Status === 'pending' && rows[0].Description === 'Work completed by Brett, included in estimate');
  t('vendor id defaulted from the WO', rows[0].Vendor_ID === 'V-1' && rows[0].Amount === '127.50');
  t('private note stored', rows[0].Private_Note === 'skipped item 9');
  t('covered time taken off the customer (Billable FALSE)', teRow(db, '1').Billable === 'FALSE' && teRow(db, '2').Billable === 'FALSE');
  t('other time untouched', teRow(db, '3').Billable === 'TRUE');
  t('no bill yet → not_billed_yet', b.bill_state === 'not_billed_yet');
  const again = await (await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['1'] })).json();
  t('same time entry cannot be back-charged twice', /already on another back-charge/.test(again.error || ''));
}
{
  const db = makeDb(); const { backchargeAdd } = build(db, {});
  const a = await (await backchargeAdd(env, { wo_id: 'WO-1', hours: 2, rate: 100 })).json();
  t('explicit hours × rate', a.amount === '200.00');
  const b = await (await backchargeAdd(env, { wo_id: 'WO-1', hours: 2, rate: 100 })).json();
  t('30s duplicate guard returns the same id', b.duplicate === true && b.id === a.id && bcRows(db).length === 1);
  const c = await (await backchargeAdd(env, { wo_id: 'WO-1', amount: 40, description: 'Sunday trip' })).json();
  t('flat amount override', c.amount === '40.00' && bcRows(db).length === 2);
}
// bill already in QB → add tells the UI to offer the edit
{
  const db = makeDb({ Invoice_Review: tabOf(IR_H, [{ ID: '5', WO_ID: 'WO-1', Vendor_ID: 'V-1', QB_Bill_ID: '555', QB_Bill_Number: 'B-5', Active: 'TRUE' }]) });
  const b = await (await build(db, {}).backchargeAdd(env, { wo_id: 'WO-1', hours: 1 })).json();
  t('bill already in QuickBooks → in_qb with the bill listed', b.bill_state === 'in_qb' && b.qb_bills[0].bill_id === '555');
}
// not silent: a dropped time-entry write is warned about
{
  const db = makeDb(); const { backchargeAdd } = build(db, {}, { dropWrites: d => /^Time_Entries!/.test(d.range) });
  const b = await (await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['1'] })).json();
  t('failed time exclusion surfaces a warning, not silence', b.success && Array.isArray(b.warnings) && b.warnings.length > 0);
}
// not silent: a write that does not read back is an error
{
  const db = makeDb(); const { backchargeAdd } = build(db, {});
  const b = await (await backchargeAdd(env, { wo_id: 'WO-1', hours: 1 })).json();
  t('tab self-provisions on first use', b.success === true && db.Vendor_Backcharges.headers.includes('Unapplied_Amount'));
}

// ── void ──────────────────────────────────────────────────────────────────
{
  const db = makeDb(); const { backchargeAdd, backchargeVoid } = build(db, {});
  const a = await (await backchargeAdd(env, { wo_id: 'WO-1', time_entry_ids: ['1'] })).json();
  const v = await (await backchargeVoid(env, { id: a.id })).json();
  const row = bcRows(db)[0];
  t('void succeeds, row Status void + Active FALSE', v.success && row.Status === 'void' && row.Active === 'FALSE');
  t('void gives the time back to billable', teRow(db, '1').Billable === 'TRUE');
  const again = await backchargeVoid(env, { id: a.id });
  t('voiding twice does not silently succeed', again.status >= 400);
  t('unknown id → 404', (await backchargeVoid(env, { id: '999' })).status === 404);
}
{
  const db = makeDb(); const { backchargeAdd, backchargeVoid, backchargeMarkApplied } = build(db, {});
  const a = await (await backchargeAdd(env, { wo_id: 'WO-1', hours: 1 })).json();
  await backchargeMarkApplied(env, [{ id: a.id, applied: 85, unapplied: 0 }], { id: '555', number: 'B-5' });
  const r = await backchargeVoid(env, { id: a.id });
  t('an APPLIED back-charge cannot be voided from the Hub (409, points at QB)', r.status === 409 && /QuickBooks/.test((await r.json()).error));
}

// ── markApplied: read-back + failure reporting ────────────────────────────
{
  const db = makeDb(); const q = {}; const { backchargeAdd, backchargeMarkApplied } = build(db, q);
  const a = await (await backchargeAdd(env, { wo_id: 'WO-1', hours: 2 })).json();
  const f = await backchargeMarkApplied(env, [{ id: a.id, applied: 120, unapplied: 50 }], { id: '555', number: 'B-5' });
  const r = bcRows(db)[0];
  t('marks applied with bill id/number, applied + unapplied amounts', f.length === 0 && r.Status === 'applied' && r.QB_Bill_ID === '555' && r.QB_Bill_Number === 'B-5' && r.Applied_Amount === '120.00' && r.Unapplied_Amount === '50.00');
}
{
  const db = makeDb(); const q = {}; const { backchargeAdd, backchargeMarkApplied } = build(db, q, { dropWrites: d => /^Vendor_Backcharges!/.test(d.range) && false });
  const a = await (await backchargeAdd(env, { wo_id: 'WO-1', hours: 1 })).json();
  const b2 = build(db, q, { dropWrites: d => /^Vendor_Backcharges!/.test(d.range) });
  const f = await b2.backchargeMarkApplied(env, [{ id: a.id, applied: 85, unapplied: 0 }], { id: '555', number: 'B-5' });
  t('a write that does not stick is REPORTED (read-back), never swallowed', f.length > 0 && q.telemetry.length > 0);
}

// ── apply to an existing QB bill ──────────────────────────────────────────
const qbBill = (over) => ({ Bill: Object.assign({ Id: '555', SyncToken: '3', DocNumber: 'B-5', TotalAmt: 1000, Balance: 1000, VendorRef: { value: '77' },
  Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 1000, AccountBasedExpenseLineDetail: { AccountRef: { value: '68' } } }] }, over || {}) });
const irWithBill = () => tabOf(IR_H, [{ ID: '5', WO_ID: 'WO-1', Vendor_ID: 'V-1', QB_Bill_ID: '555', QB_Bill_Number: 'B-5', Active: 'TRUE' }]);
async function seedPending(db, q, amount) {
  const api = build(db, q); const a = await (await api.backchargeAdd(env, { wo_id: 'WO-1', amount })).json(); return { api, id: a.id };
}
{
  const db = makeDb({ Invoice_Review: irWithBill() });
  const q = { getResult: qbBill(), postResult: body => ({ Bill: Object.assign({}, qbBill().Bill, { TotalAmt: 900, Line: body.Line }) }) };
  const { api, id } = await seedPending(db, q, 100);
  const pv = await (await api.backchargeApplyToQb(env, { id, preview_only: true })).json();
  t('preview shows 1000 → 900', pv.ok && pv.preview.current_total === 1000 && pv.preview.new_total === 900 && pv.preview.deduction === 100);
  t('preview writes nothing to QuickBooks', !q.calls.some(c => c.method === 'POST'));
  t('preview leaves the row pending', bcRows(db)[0].Status === 'pending');
  const res = await (await api.backchargeApplyToQb(env, { id })).json();
  const post = q.calls.find(c => c.method === 'POST');
  t('apply succeeds at $900', res.ok && res.new_total === 900);
  t('sparse update appends ONE negative line and keeps the original line', post.body.sparse === true && post.body.Line.length === 2 && post.body.Line[1].Amount === -100 && post.body.Line[0].Amount === 1000);
  t('uses SyncToken + expense account of the existing line', post.body.SyncToken === '3' && post.body.Line[1].AccountBasedExpenseLineDetail.AccountRef.value === '68');
  t('row marked applied with the QB bill', bcRows(db)[0].Status === 'applied' && bcRows(db)[0].QB_Bill_ID === '555');
  const dbl = await api.backchargeApplyToQb(env, { id });
  t('applying twice is refused (no double deduction)', dbl.status === 409);
}
{
  const db = makeDb({ Invoice_Review: irWithBill() });
  const q = { getResult: qbBill({ Balance: 400 }), postResult: () => ({}) };
  const { api, id } = await seedPending(db, q, 100);
  const r = await api.backchargeApplyToQb(env, { id });
  t('partly/fully paid bill is NOT edited', r.status === 409 && !q.calls.some(c => c.method === 'POST') && bcRows(db)[0].Status === 'pending');
}
{
  const db = makeDb({ Invoice_Review: irWithBill() });
  const q = { getResult: qbBill({ TotalAmt: 60, Balance: 60, Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 60, AccountBasedExpenseLineDetail: { AccountRef: { value: '68' } } }] }),
              postResult: body => ({ Bill: { Id: '555', DocNumber: 'B-5', TotalAmt: 0, Line: body.Line } }) };
  const { api, id } = await seedPending(db, q, 100);
  const pv = await (await api.backchargeApplyToQb(env, { id, preview_only: true })).json();
  t('floor: $100 against a $60 bill previews $60 off, $40 unapplied', pv.preview.deduction === 60 && pv.preview.new_total === 0 && pv.preview.unapplied === 40);
  await api.backchargeApplyToQb(env, { id });
  t('floor: unapplied remainder is stored on the row', bcRows(db)[0].Unapplied_Amount === '40.00' && bcRows(db)[0].Applied_Amount === '60.00');
}
{
  const db = makeDb({ Invoice_Review: irWithBill() });
  const q = { getResult: qbBill({ TotalAmt: 0, Balance: 0, Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 0, AccountBasedExpenseLineDetail: { AccountRef: { value: '68' } } }] }), postResult: () => ({}) };
  const { api, id } = await seedPending(db, q, 100);
  t('already-$0 bill → refused, nothing to deduct', (await api.backchargeApplyToQb(env, { id })).status === 409);
}
{
  const db = makeDb({ Invoice_Review: irWithBill() });
  const q = { getResult: qbBill(), postResult: () => ({ Fault: { Error: [{ Message: 'Stale SyncToken' }] } }) };
  const { api, id } = await seedPending(db, q, 100);
  const r = await api.backchargeApplyToQb(env, { id }); const b = await r.json();
  t('QB rejects → clear error, row stays pending', r.status === 502 && /Stale SyncToken/.test(b.error) && bcRows(db)[0].Status === 'pending');
}
{
  const db = makeDb({ Invoice_Review: irWithBill() });
  const q = { getResult: qbBill(), postResult: () => ({ Bill: { Id: '555', DocNumber: 'B-5', TotalAmt: 1000 } }) };
  const { api, id } = await seedPending(db, q, 100);
  const r = await api.backchargeApplyToQb(env, { id });
  t('QB total does not match expected → NOT marked applied, loud error', r.status === 502 && bcRows(db)[0].Status === 'pending');
}
{
  const db = makeDb(); const q = { getResult: qbBill(), postResult: () => ({}) };
  const { api, id } = await seedPending(db, q, 100);
  const r = await api.backchargeApplyToQb(env, { id });
  t('no QB bill yet → explains it will apply on send', r.status === 400 && /applied automatically/.test((await r.json()).error));
}
{
  const db = makeDb({ Invoice_Review: tabOf(IR_H, [
    { ID: '5', WO_ID: 'WO-1', Vendor_ID: 'V-1', QB_Bill_ID: '555', Active: 'TRUE' }, { ID: '6', WO_ID: 'WO-1', Vendor_ID: 'V-1', QB_Bill_ID: '556', Active: 'TRUE' }]) });
  const q = { getResult: qbBill(), postResult: () => ({}) };
  const { api, id } = await seedPending(db, q, 100);
  const r = await api.backchargeApplyToQb(env, { id });
  t('two QB bills for the vendor → asks which, never guesses', r.status === 409 && (await r.json()).candidates.length === 2);
}
{
  const db = makeDb({ Invoice_Review: irWithBill() }); const q = { tokenFails: true };
  const { api, id } = await seedPending(db, q, 100);
  const r = await api.backchargeApplyToQb(env, { id });
  t('QB auth failure → error, not success', r.status === 500 && (await r.json()).ok === false);
}

// ── rowsFor: pending only, per WO + vendor, claimed set honoured ──────────
{
  const db = makeDb(); const { backchargeAdd, backchargeRowsFor, backchargeVoid } = build(db, {});
  const a = await (await backchargeAdd(env, { wo_id: 'WO-1', amount: 10, description: 'a' })).json();
  const b = await (await backchargeAdd(env, { wo_id: 'WO-1', amount: 20, description: 'b' })).json();
  const c = await (await backchargeAdd(env, { wo_id: 'WO-1', amount: 30, description: 'c' })).json();
  await backchargeVoid(env, { id: c.id });
  const rows = await backchargeRowsFor(env, 'WO-1', 'V-1');
  t('only pending, oldest first, voided excluded', rows.map(r => r.ID).join() === [a.id, b.id].join());
  const claimed = new Set([a.id]);
  t('rows another combined bill already claimed are skipped', (await backchargeRowsFor(env, 'WO-1', 'V-1', claimed)).map(r => r.ID).join() === b.id);
  t('other vendor sees none', (await backchargeRowsFor(env, 'WO-1', 'V-9')).length === 0);
}
// unreadable tab THROWS (callers must refuse to post the bill)
{
  const db = makeDb(); const api = build(db, {});
  const orig = globalThis.fetch;
  const bad = build(db, {}, null);
  db.Vendor_Backcharges = { headers: BACKCHARGE_COLS(), rows: [] };
  function BACKCHARGE_COLS() { return ['ID','WO_ID','Vendor_ID','Status','Active']; }
  let threw = false;
  const failing = new Function('getAccessToken', 'fetch', 'setTimeout', 'qbStateArg',
    ['const CORS = {};', 'const qbState = qbStateArg;', parts[0], qbMock(), ...parts.slice(1), 'return { backchargeRowsFor };'].join('\n'))(async () => 'tok', async () => { throw new Error('Sheets 500'); }, fn => fn(), { calls: [], telemetry: [] });
  try { await failing.backchargeRowsFor(env, 'WO-1', 'V-1'); } catch (e) { threw = true; }
  t('a failed read throws instead of returning [] (no silent full payment)', threw);
}

// ── source-level guarantees in the send paths ─────────────────────────────
{
  t('single send refuses to post when back-charges are unreadable', /bcReadFailed \? null : await qbApi/.test(wsrc));
  t('combined send refuses to post a row when back-charges are unreadable', /if \(rb\.bcReadFailed\)/.test(wsrc));
  t('single send pre-flights back-charges BEFORE the customer invoice is created', wsrc.indexOf('Back-charges pre-flight (Oct 11 2026): if this vendor') > 0 && wsrc.indexOf('Back-charges pre-flight (Oct 11 2026): if this vendor') < wsrc.indexOf("invoicePayload.CustomerRef = { value: customerId };\n\n      // Put a send-to email ON THE INVOICE"));
  t('combined send pre-flights before any invoice is created', /!previewOnly && rowBuilds\.some\(rb => rb\.bcReadFailed\)/.test(wsrc));
  t('combined send de-dupes claimed back-charges across rows', /_bcClaimed/.test(wsrc));
  t('routes are admin-only (no role scope lists them)', !/ROLE_SCOPES[\s\S]{0,4000}\/backcharge/.test(wsrc.slice(wsrc.indexOf('const ROLE_SCOPES'), wsrc.indexOf('const ROLE_SCOPES') + 6000)));
  const gate = grab(wsrc, 'async function hubTestWriteAllowed(');
  t('hub test token gate for back-charges lives INSIDE hubTestWriteAllowed (TEST- WOs only)', /path === '\/backcharge\/add'\) return !!\(body && body\.wo_id\) && await isTestWO/.test(gate) && /'\/backcharge\/void'/.test(gate) && /'\/backcharge\/apply-to-qb'/.test(gate));
  const router = wsrc.slice(wsrc.indexOf("if (path === '/backcharge/add')           return await backchargeAdd"), wsrc.indexOf("if (path === '/backcharge/add')           return await backchargeAdd") + 400);
  t('router dispatches the three POST routes to handlers (not to a boolean gate)', /return await backchargeVoid/.test(router) && /return await backchargeApplyToQb/.test(router));
  t('no stray isTestWO gate in the router', (wsrc.match(/if \(path === '\/backcharge\/add'\)/g) || []).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
