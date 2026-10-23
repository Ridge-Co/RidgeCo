// Invoice 1767 / WO-1169 end to end through buildInvoiceLines: Brett's own billable hours (Notes only,
// logged before Invoice Description existed) + 4 receipts. The labor line must say what was done,
// every receipt stays its own line, and the total still ties to the cent ($638.75).
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { buildInvoiceLines, buildLaborDescription, laborDescriptionIsGeneric } = new Function(grab('englishOnly') + '\n' + grab('isTrueish') + '\n' + grab('laborEntryText') + '\n' + grab('buildLaborDescription') + '\n' + grab('laborDescriptionIsGeneric') + '\n' + grab('buildInvoiceLines') + '\nreturn { buildInvoiceLines, buildLaborDescription, laborDescriptionIsGeneric };')();

const hub = (id, notes, billable, created) => ({ ID: id, Active: 'TRUE', Role: 'hub', Billable: billable, Bill_ID: '', Start_DateTime: '', Created_Date: created, Invoice_Description: '', Notes: notes });
const entries = [
  hub('45', '1305 3rd floor key copies ahead of electric plus Roberts key invoice 8/19/26 1 hr (minimum)', 'false', '2026-08-26T12:46:38Z'),
  hub('46', '1305 electric meeting and key copies 2nd floor plus Roberts key invoice 8/20/26 2 hr', 'true', '2026-08-26T12:47:25Z'),
  hub('47', 'Drop 3rd floor keys ahead of electrical work. 1 hr (minimum)', 'true', '2026-08-26T12:48:35Z'),
  hub('52', 'Let cat out of 3rd floor apartment per tenant/owner request. Minimum applied.', 'true', '2026-09-07T21:33:52Z'),
  hub('58', "Pick up keys for building from BFR office. Make copies at Robert's Key Service. Test keys at property (1 and 4 did not work).", 'true', '2026-09-10T00:34:22Z'),
];
const receipts = [
  { Amount: '97.10', Description: 'rekeying, remote control, hardware', Store: "Robert's Key Service, Inc." },
  { Amount: '12.72', Description: 'keys', Store: 'Roberts Key Service, Inc.' },
  { Amount: '15.90', Description: 'keys', Store: "Robert's Key Service, Inc." },
  { Amount: '66.78', Description: 'keys, lock, labor, tax', Store: "Robert's Key Service, Inc." },
];
const ir = { WO_ID: 'WO-1169', Customer_Total: '638.75' };
const wo = { Invoice_Memo: 'Billable hours', Description: 'Billable hours' };

test('WO-1169 invoice: labor line lists what was done, receipts stay separate, total ties to $638.75', () => {
  const r = buildInvoiceLines(ir, {}, { item: '1' }, 'General', wo, null, receipts, entries);
  const labor = r.lines[0];
  assert.strictEqual(labor.Amount, 446.25);
  assert.ok(!/Billable hours/.test(labor.Description), labor.Description);
  for (const frag of ['2nd floor', 'Drop 3rd floor keys', 'Let cat out', 'BFR office']) assert.ok(labor.Description.includes(frag), frag + ' :: ' + labor.Description);
  assert.ok(!labor.Description.includes('3rd floor key copies ahead of electric plus'), 'non-billable entry must not appear');
  assert.strictEqual(r.lines.length, 5);                       // 1 labor + 4 materials
  assert.strictEqual(+r.lines.reduce((n, l) => n + l.Amount, 0).toFixed(2), 638.75);
});

// ── Oct 23 2026 — invoice 1767 / WO-1169 ────────────────────────────────────────────────────────
// Owner asked for "more detail of the larger amounts". Brett's own billable hours were logged
// BEFORE the Invoice Description field existed, so the detail lived only in Notes and the invoice
// said "Billable hours". These are the real WO-1169 entries.
const hubEntry = (over) => Object.assign({ Active: 'TRUE', Role: 'hub', Billable: 'true', Bill_ID: '', Start_DateTime: '', Created_Date: '2026-08-26T12:47:25.760Z', Invoice_Description: '', Notes: '' }, over);
const wo1169 = { Invoice_Memo: 'Billable hours', Description: 'Billable hours' };
const e45 = hubEntry({ ID: '45', Billable: 'false', Created_Date: '2026-08-26T12:46:38.585Z', Notes: '1305 3rd floor key copies ahead of electric plus Roberts key invoice 8/19/26 1 hr (minimum)' });
const e46 = hubEntry({ ID: '46', Created_Date: '2026-08-26T12:47:25.760Z', Notes: '1305 electric meeting and key copies 2nd floor plus Roberts key invoice 8/20/26 2 hr' });
const e47 = hubEntry({ ID: '47', Created_Date: '2026-08-26T12:48:35.505Z', Notes: 'Drop 3rd floor keys ahead of electrical work. 1 hr (minimum)' });
const e52 = hubEntry({ ID: '52', Created_Date: '2026-09-07T21:33:52.043Z', Notes: 'Let cat out of 3rd floor apartment per tenant/owner request. Minimum applied.' });
const e58 = hubEntry({ ID: '58', Created_Date: '2026-09-10T00:34:22.137Z', Notes: 'Pick up keys for building from BFR office. Make copies at Robert\'s Key Service. Test keys at property (1 and 4 did not work).' });

test('WO-1169: Brett\'s own billable hours with only Notes describe themselves — not "Billable hours"', () => {
  const out = buildLaborDescription({}, [e45, e46, e47, e52, e58], wo1169);
  assert.notStrictEqual(out, 'Billable hours');
  assert.ok(out.includes('1305 electric meeting and key copies 2nd floor'), out);
  assert.ok(out.includes('Drop 3rd floor keys ahead of electrical work'), out);
  assert.ok(out.includes('Let cat out of 3rd floor apartment'), out);
  assert.ok(out.includes('Pick up keys for building from BFR office'), out);
});

test('WO-1169: the NON-billable entry (#45) is never listed', () => {
  const out = buildLaborDescription({}, [e45, e46, e47, e52, e58], wo1169);
  assert.ok(!out.includes('3rd floor key copies ahead of electric plus'), out);
});

test('Notes-fallback entries carry NO date prefix (Created_Date is when it was logged, not when the work happened)', () => {
  const out = buildLaborDescription({}, [e46], wo1169);
  assert.strictEqual(out, e46.Notes);
  assert.ok(!out.includes('2026-08-26'), out);
});

test('a hub entry WITH an Invoice_Description uses it and never leaks its private Notes', () => {
  const e = hubEntry({ Invoice_Description: 'Copied keys for the 2nd floor', Notes: 'ran long because the tenant was late', Start_DateTime: '2026-08-20T09:00' });
  const out = buildLaborDescription({}, [e], wo1169);
  assert.strictEqual(out, '2026-08-20 — Copied keys for the 2nd floor');
  assert.ok(!out.includes('tenant was late'), out);
});

test('a VENDOR entry\'s private Notes never reach the customer', () => {
  const v = { Active: 'TRUE', Role: 'vendor', Billable: 'TRUE', Bill_ID: 'B-7', Notes: 'tenant was rude, went back twice' };
  const out = buildLaborDescription({ ID: 'B-7' }, [v], wo1169);
  assert.strictEqual(out, 'Billable hours');
});

test('laborDescriptionIsGeneric: billable hours with nothing the customer can read -> true; with Notes fallback or a description -> false', () => {
  assert.strictEqual(laborDescriptionIsGeneric({}, [hubEntry({ Notes: '' })]), true);
  assert.strictEqual(laborDescriptionIsGeneric({}, [e46]), false);
  assert.strictEqual(laborDescriptionIsGeneric({}, [hubEntry({ Invoice_Description: 'Did the thing' })]), false);
  assert.strictEqual(laborDescriptionIsGeneric({ ID: 'B-1', Invoice_Description: 'Flat rate repair' }, []), false);
  assert.strictEqual(laborDescriptionIsGeneric({}, []), false);   // no hours at all: nothing to explain
  assert.strictEqual(laborDescriptionIsGeneric({}, [hubEntry({ Billable: 'false', Notes: '' })]), false);   // only non-billable hours
});
