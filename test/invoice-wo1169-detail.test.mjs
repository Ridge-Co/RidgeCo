// Invoice 1767 / WO-1169 end to end (Oct 23 2026). Brett's own billable hours were logged before the
// Invoice Description field existed, so their detail sits only in private Notes. Rules pinned here:
//   1. Notes NEVER reach an invoice on their own (no silent leak of private text).
//   2. The opt-in action (POST /time-entry/use-notes) COPIES hub billable Notes into Invoice_Description,
//      never touches vendor entries, non-billable hours, or an entry that already has a description,
//      verifies every write, and reports every failure.
//   3. Brett's own hours on a job with no vendor bill print as ONE LINE PER VISIT (hours x rate), and the
//      invoice total still ties to the cent ($638.75); when the visits do not reconcile it falls back to
//      the single combined line.
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const pure = new Function(grab('englishOnly') + '\n' + grab('isTrueish') + '\n' + grab('laborEntryText') + '\n' + grab('timeEntriesWithUsableNotes') + '\n' + grab('buildLaborDescription') + '\n' + grab('laborDescriptionIsGeneric') + '\n' + grab('hubVisitLaborLines') + '\n' + grab('buildInvoiceLines') +
  '\nreturn { buildInvoiceLines, buildLaborDescription, laborDescriptionIsGeneric, timeEntriesWithUsableNotes, laborEntryText, hubVisitLaborLines };')();
const { buildInvoiceLines, buildLaborDescription, laborDescriptionIsGeneric, timeEntriesWithUsableNotes, laborEntryText } = pure;

// The real WO-1169 rows (prod, Oct 23 2026): lowercase 'true'/'false' in Billable, Notes only.
const hub = (over) => Object.assign({ WO_ID: 'WO-1169', Active: 'TRUE', Role: 'hub', Billable: 'true', Bill_ID: '', Start_DateTime: '', Invoice_Description: '', Hourly_Rate: '85' }, over);
const e45 = hub({ ID: '45', Billable: 'false', Duration_Minutes: '60', Billable_Amount: '0.00', Created_Date: '2026-08-26T12:46:38.585Z', Notes: '1305 3rd floor key copies ahead of electric plus Roberts key invoice 8/19/26 1 hr (minimum)' });
const e46 = hub({ ID: '46', Duration_Minutes: '120', Billable_Amount: '170.00', Created_Date: '2026-08-26T12:47:25.760Z', Notes: '1305 electric meeting and key copies 2nd floor plus Roberts key invoice 8/20/26 2 hr' });
const e47 = hub({ ID: '47', Duration_Minutes: '60', Billable_Amount: '85.00', Created_Date: '2026-08-26T12:48:35.505Z', Notes: 'Drop 3rd floor keys ahead of electrical work. 1 hr (minimum)' });
const e52 = hub({ ID: '52', Duration_Minutes: '60', Billable_Amount: '85.00', Created_Date: '2026-09-07T21:33:52.043Z', Notes: 'Let cat out of 3rd floor apartment per tenant/owner request. Minimum applied.' });
const e58 = hub({ ID: '58', Entry_Type: 'Material Drop', Duration_Minutes: '75', Billable_Amount: '106.25', Created_Date: '2026-09-10T00:34:22.137Z', Notes: "Pick up keys for building from BFR office. Make copies at Robert's Key Service. Test keys at property (1 and 4 did not work)." });
const all = () => [e45, e46, e47, e52, e58].map(e => Object.assign({}, e));
const receipts = [
  { Amount: '97.10', Description: 'rekeying, remote control, hardware', Store: "Robert's Key Service, Inc." },
  { Amount: '12.72', Description: 'keys', Store: 'Roberts Key Service, Inc.' },
  { Amount: '15.90', Description: 'keys', Store: "Robert's Key Service, Inc." },
  { Amount: '66.78', Description: 'keys, lock, labor, tax', Store: "Robert's Key Service, Inc." },
];
const ir = { WO_ID: 'WO-1169', Customer_Total: '638.75' };
const wo = { Invoice_Memo: 'Billable hours', Description: 'Billable hours' };
const optIn = (list) => list.map(e => (timeEntriesWithUsableNotes([e], null).length ? Object.assign({}, e, { Invoice_Description: e.Notes.trim() }) : e));
const sum = (r) => +r.lines.reduce((n, l) => n + l.Amount, 0).toFixed(2);

// ── 1. no automatic leak ───────────────────────────────────────────────────────────────────────
test('private Notes never reach the invoice text without the opt-in', () => {
  assert.strictEqual(buildLaborDescription({}, all(), wo), 'Billable hours');
  const r = buildInvoiceLines(ir, {}, { item: '1' }, 'General', wo, null, receipts, all());
  for (const l of r.lines) for (const frag of ['electric meeting', 'Drop 3rd floor', 'cat out', 'BFR office']) assert.ok(!l.Description.includes(frag), l.Description);
});

test('laborDescriptionIsGeneric stays true until the notes are copied, false after; timeEntriesWithUsableNotes finds exactly the 4 billable hub entries', () => {
  assert.strictEqual(laborDescriptionIsGeneric({}, all()), true);
  assert.deepStrictEqual(timeEntriesWithUsableNotes(all(), '').map(e => e.ID), ['46', '47', '52', '58']);
  assert.strictEqual(laborDescriptionIsGeneric({}, optIn(all())), false);
  assert.deepStrictEqual(timeEntriesWithUsableNotes(optIn(all()), '').map(e => e.ID), []);
});

test('vendor entries, non-billable hours, inactive entries and described entries are never offered for copying', () => {
  const list = [
    Object.assign({}, e46, { ID: 'v1', Role: 'vendor', Notes: 'tenant was rude' }),
    Object.assign({}, e46, { ID: 'n1', Billable: 'false' }),
    Object.assign({}, e46, { ID: 'x1', Active: 'FALSE' }),
    Object.assign({}, e46, { ID: 'd1', Invoice_Description: 'Already written' }),
    Object.assign({}, e46, { ID: 'e1', Notes: '   ' }),
    Object.assign({}, e46, { ID: 'ok' }),
  ];
  assert.deepStrictEqual(timeEntriesWithUsableNotes(list, null).map(e => e.ID), ['ok']);
});

// ── 2. one line per visit ──────────────────────────────────────────────────────────────────────
test('WO-1169 after the opt-in: one line per visit (hours x rate), receipts stay separate, total ties to $638.75', () => {
  const r = buildInvoiceLines(ir, {}, { item: '1' }, 'General', wo, null, receipts, optIn(all()));
  assert.strictEqual(r.lines.length, 8);                                   // 4 visits + 4 materials
  const visits = r.lines.slice(0, 4);
  assert.deepStrictEqual(visits.map(l => l.Amount), [170, 85, 85, 106.25]);
  assert.deepStrictEqual(visits.map(l => l.SalesItemLineDetail.Qty), [2, 1, 1, 1.25]);
  assert.ok(visits.every(l => l.SalesItemLineDetail.UnitPrice === 85));
  assert.ok(visits.every((l, i) => Math.abs(l.SalesItemLineDetail.Qty * l.SalesItemLineDetail.UnitPrice - l.Amount) < 0.005));
  assert.ok(visits[0].Description.includes('1305 electric meeting and key copies 2nd floor'), visits[0].Description);
  assert.ok(visits[1].Description.includes('Drop 3rd floor keys ahead of electrical work'), visits[1].Description);
  assert.ok(visits[2].Description.includes('Let cat out of 3rd floor apartment'), visits[2].Description);
  assert.ok(visits[3].Description.includes('Pick up keys for building from BFR office'), visits[3].Description);
  assert.ok(visits[3].Description.endsWith('1.25 hrs × $85.00/hr'), visits[3].Description);
  assert.ok(visits[1].Description.endsWith('1 hr × $85.00/hr'), visits[1].Description);
  assert.ok(visits.every(l => l.Description.includes('WO WO-1169')));
  assert.ok(r.lines.slice(4).every(l => l.Description.startsWith('Materials — ')));
  assert.strictEqual(sum(r), 638.75);
  assert.strictEqual(r.laborAmt, 446.25);
  assert.ok(!r.lines.some(l => l.Description.includes('3rd floor key copies ahead of electric plus')), 'non-billable #45 must not appear');
});

test('hub entries with no recorded work date print no date; with Start_DateTime they print it; vendor entries keep Created_Date', () => {
  assert.strictEqual(laborEntryText(hub({ Invoice_Description: 'Did X', Created_Date: '2026-09-10T00:34:22Z' })), 'Did X');
  assert.strictEqual(laborEntryText(hub({ Invoice_Description: 'Did X', Start_DateTime: '2026-08-20T09:00' })), '2026-08-20 — Did X');
  assert.strictEqual(laborEntryText({ Role: 'vendor', Invoice_Description: 'Did Y', Created_Date: '2026-09-10T00:34:22Z' }), '2026-09-10 — Did Y');
});

test('without the opt-in the hours still split per visit (hours x rate) and the total still ties', () => {
  const r = buildInvoiceLines(ir, {}, { item: '1' }, 'General', wo, null, receipts, all());
  assert.strictEqual(r.lines.length, 8);
  assert.deepStrictEqual(r.lines.slice(0, 4).map(l => l.Amount), [170, 85, 85, 106.25]);
  assert.strictEqual(sum(r), 638.75);
});

test('falls back to the single combined labor line when the visits do not reconcile to the labor amount', () => {
  const r = buildInvoiceLines({ WO_ID: 'WO-1169', Customer_Total: '700.00' }, {}, { item: '1' }, 'General', wo, null, receipts, optIn(all()));
  assert.strictEqual(r.lines.length, 5);
  assert.strictEqual(r.lines[0].Amount, 507.5);
  assert.strictEqual(sum(r), 700);
});

test('a job with a vendor bill keeps the single combined line (markup/pass-through math is not touched)', () => {
  const r = buildInvoiceLines(ir, { ID: 'B-9', Receipts_JSON: '[]' }, { item: '1' }, 'General', wo, null, receipts, optIn(all()));
  assert.strictEqual(r.lines.filter(l => !l.Description.startsWith('Materials —')).length, 1);
  assert.strictEqual(sum(r), 638.75);
});

test('a single visit also prints as hours x rate; a 15-minute rounding entry stays exact', () => {
  const one = hub({ ID: '1', Duration_Minutes: '45', Billable_Amount: '63.75', Invoice_Description: 'Checked the boiler' });
  const r = buildInvoiceLines({ WO_ID: 'WO-1', Customer_Total: '63.75' }, {}, { item: '1' }, 'HVAC', wo, null, [], [Object.assign(one, { WO_ID: 'WO-1' })]);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].SalesItemLineDetail.Qty, 0.75);
  assert.strictEqual(r.lines[0].Amount, 63.75);
  assert.ok(r.lines[0].Description.includes('Checked the boiler') && r.lines[0].Description.endsWith('0.75 hrs × $85.00/hr'), r.lines[0].Description);
});

test('a minimum-charge visit whose amount is not hours x rate prints Qty 1 at the stored amount', () => {
  const m = hub({ ID: '2', WO_ID: 'WO-2', Duration_Minutes: '30', Billable_Amount: '85.00', Invoice_Description: 'Quick key drop (1 hr minimum)' });
  const r = buildInvoiceLines({ WO_ID: 'WO-2', Customer_Total: '85.00' }, {}, { item: '1' }, 'General', wo, null, [], [m]);
  assert.strictEqual(r.lines.length, 1);
  assert.deepStrictEqual([r.lines[0].SalesItemLineDetail.Qty, r.lines[0].SalesItemLineDetail.UnitPrice, r.lines[0].Amount], [1, 85, 85]);
  assert.ok(!/hr/.test(r.lines[0].Description.split('Quick key drop (1 hr minimum)')[1] || ''), r.lines[0].Description);
});

// ── 3. the opt-in endpoint ─────────────────────────────────────────────────────────────────────
function loadEndpoint(state, opts = {}) {
  const calls = { updates: [], telemetry: [], ensure: [] };
  const json = (body, status) => ({ status: status || 200, body });
  const fetchTab = async () => { if (opts.readFails) throw new Error('Sheets down'); return state.rows; };
  const updateRowVerified = async (tab, id, fields) => {
    if (opts.failId && String(opts.failId) === String(id)) throw new Error('did not keep: Invoice_Description');
    calls.updates.push({ tab, id: String(id), fields });
    const row = state.rows.find(r => String(r.ID) === String(id)); Object.assign(row, fields); return row;
  };
  const f = new Function('json', 'fetchTab', 'updateRowVerified', 'ensureColumns', 'logTelemetry', 'isTrueish', 'timeEntriesWithUsableNotes',
    'async ' + grab('useTimeEntryNotes') + '\nreturn useTimeEntryNotes;')(
    json, fetchTab,
    async (env, tab, id, fields) => updateRowVerified(tab, id, fields),
    async (env, tab, cols) => { calls.ensure.push([tab, cols]); },
    async (env, rec) => { if (opts.telemetryFails) throw new Error('telemetry tab unreachable'); calls.telemetry.push(rec); },
    pure.isTrueish || new Function(grab('isTrueish') + '\nreturn isTrueish;')(),
    timeEntriesWithUsableNotes);
  return { run: (body) => f({}, body), calls };
}

test('use-notes copies exactly the 4 billable hub notes on the job, word for word, and nothing else', async () => {
  const state = { rows: all().concat([Object.assign({}, e46, { ID: '900', WO_ID: 'WO-OTHER' }), Object.assign({}, e46, { ID: '901', Role: 'vendor', Notes: 'private vendor note' })]) };
  const ep = loadEndpoint(state);
  const r = await ep.run({ wo_id: 'WO-1169' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.deepStrictEqual(r.body.updated.map(u => u.id), ['46', '47', '52', '58']);
  assert.strictEqual(ep.calls.updates.length, 4);
  assert.ok(ep.calls.updates.every(u => u.tab === 'Time_Entries' && Object.keys(u.fields).join() === 'Invoice_Description'));
  assert.strictEqual(state.rows.find(x => x.ID === '46').Invoice_Description, e46.Notes);
  assert.strictEqual(state.rows.find(x => x.ID === '45').Invoice_Description, '');          // non-billable
  assert.strictEqual(state.rows.find(x => x.ID === '900').Invoice_Description, '');         // other job
  assert.strictEqual(state.rows.find(x => x.ID === '901').Invoice_Description, '');         // vendor
  assert.deepStrictEqual(ep.calls.ensure, [['Time_Entries', ['Invoice_Description']]]);
  assert.strictEqual(ep.calls.telemetry.length, 1);
  assert.strictEqual(ep.calls.telemetry[0].Success, 'TRUE');
});

test('use-notes with ids copies only those entries, and never overwrites a description that already exists', async () => {
  const state = { rows: all() };
  state.rows.find(x => x.ID === '47').Invoice_Description = 'Written by hand';
  const ep = loadEndpoint(state);
  const r = await ep.run({ wo_id: 'WO-1169', ids: ['46', '47'] });
  assert.deepStrictEqual(r.body.updated.map(u => u.id), ['46']);
  assert.strictEqual(state.rows.find(x => x.ID === '47').Invoice_Description, 'Written by hand');
  assert.strictEqual(state.rows.find(x => x.ID === '52').Invoice_Description, '');
});

test('use-notes run twice is a clean no-op the second time', async () => {
  const state = { rows: all() };
  const ep = loadEndpoint(state);
  await ep.run({ wo_id: 'WO-1169' });
  const again = await ep.run({ wo_id: 'WO-1169' });
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(again.body.updated, []);
  assert.ok(/Nothing to copy/.test(again.body.message));
});

test('use-notes: one failed write is reported per entry, the rest still land, and a FALSE telemetry row is filed (nothing silent)', async () => {
  const state = { rows: all() };
  const ep = loadEndpoint(state, { failId: '52' });
  const r = await ep.run({ wo_id: 'WO-1169' });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.ok, false);
  assert.deepStrictEqual(r.body.updated.map(u => u.id), ['46', '47', '58']);
  assert.deepStrictEqual(r.body.errors.map(x => x.id), ['52']);
  assert.ok(/did not keep/.test(r.body.errors[0].error));
  assert.strictEqual(ep.calls.telemetry.at(-1).Success, 'FALSE');
  assert.ok(ep.calls.telemetry.at(-1).Notes.includes('52'));
});

test('use-notes: an unreadable Time_Entries tab is a loud 500 with a telemetry row, not an empty success', async () => {
  const ep = loadEndpoint({ rows: all() }, { readFails: true });
  const r = await ep.run({ wo_id: 'WO-1169' });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.ok, false);
  assert.ok(/Could not read Time_Entries/.test(r.body.error));
  assert.strictEqual(ep.calls.telemetry[0].Success, 'FALSE');
});

test('use-notes: if the audit row cannot be filed the copy still stands and the caller is told (warning, not silence)', async () => {
  const state = { rows: all() };
  const ep = loadEndpoint(state, { telemetryFails: true });
  const r = await ep.run({ wo_id: 'WO-1169' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.updated.map(u => u.id), ['46', '47', '52', '58']);
  assert.strictEqual(r.body.warnings.length, 1);
  assert.ok(/audit row/.test(r.body.warnings[0]) && /telemetry tab unreachable/.test(r.body.warnings[0]));
});

test('use-notes requires a wo_id', async () => {
  const r = await loadEndpoint({ rows: [] }).run({});
  assert.strictEqual(r.status, 400);
});

// ── 4. wiring ──────────────────────────────────────────────────────────────────────────────────
test('wiring: the route exists, is admin-only (not in the vendor list), and is test-WO keyed for staging', () => {
  assert.ok(src.includes("if (path === '/time-entry/use-notes')     return await useTimeEntryNotes(env, body);"));
  const vendorList = src.match(/\n  vendor: \[[^\]]*\]/)[0];
  assert.ok(!vendorList.includes('/time-entry/use-notes'), 'vendors must never be able to call it');
  assert.ok(/_WO_KEYED = \[[^\]]*'\/time-entry\/use-notes'/.test(src));
});

test('wiring: Time Tracking shows the opt-in banner and per-entry button, both call /time-entry/use-notes, and the memo composer never uses Notes', () => {
  assert.ok(html.includes("api('POST', '/time-entry/use-notes'"));
  assert.ok(html.includes('Use notes as invoice descriptions'));
  assert.ok(html.includes('Use this note as the invoice description'));
  const memo = html.slice(html.indexOf('function invComposeMemo('), html.indexOf('function invRefreshMemoDefault('));
  assert.ok(!/e\.Notes/.test(memo), 'invComposeMemo must not read private Notes');
});

test('wiring: Log Time (Hub) still refuses billable time without an Invoice Description', () => {
  assert.ok(html.includes('Billable time needs an Invoice Description'));
});

test('wiring: the send-invoice preview points at the opt-in and never says it is using private notes', () => {
  assert.ok(src.includes('Use notes as invoice descriptions'));
  assert.ok(!src.includes('their private note is being used as the invoice wording'));
});
