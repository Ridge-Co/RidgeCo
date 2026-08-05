// The QuickBooks labor line must read as hours × rate, not a flat "1 × $total" — but ONLY
// when the labor genuinely IS hours × rate. A 2-hour $150 hourly job (Brett's own time) was
// going out as Qty 1 / UnitPrice 150, so the customer read it as $150/hr. These pin:
//   (1) a clean HOURLY bill splits into Qty=hours / UnitPrice=stored-rate, total unchanged;
//   (2) materials stay their own line and the invoice total is preserved;
//   (3) a MARKED-UP vendor bill — where laborAmt carries markup, so hrs × the vendor rate
//       does NOT tie out — must fall back to the single combined line (never a fake $/hr);
//   (4) a flat bill / missing rate / zero hours falls back unchanged.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const buildInvoiceLines = new Function(grab('buildInvoiceLines') + '\nreturn buildInvoiceLines;')();

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };
const trade = { item: '7', expense: '80' };

// ── 1. clean hourly job: Brett's own time, 2h @ $75, $150 total, no materials ──
{
  const bill = { Bill_Type: 'hourly', Hours: '2', Rate: '75', Labor_Total: '150' };
  const r = buildInvoiceLines({ Customer_Total: '150', WO_ID: '1062' }, bill, trade, 'Handyman', { Description: 'Admin' }, null, []);
  const labor = r.lines[0];
  t('clean hourly: Qty is the hours', labor.SalesItemLineDetail.Qty === 2, labor.SalesItemLineDetail.Qty);
  t('clean hourly: UnitPrice is the stored rate', labor.SalesItemLineDetail.UnitPrice === 75, labor.SalesItemLineDetail.UnitPrice);
  t('clean hourly: Amount unchanged (total preserved)', labor.Amount === 150, labor.Amount);
  t('clean hourly: description shows the breakdown', /2 hrs × \$75\.00\/hr/.test(labor.Description), labor.Description);
  t('clean hourly: only one line', r.lines.length === 1, r.lines.length);
}

// ── 2. hourly with materials: 2h @ $75 ($150) + $50 receipt = $200 total ──
{
  const bill = { Bill_Type: 'hourly', Hours: '2', Rate: '75', Labor_Total: '150', Receipts_JSON: JSON.stringify([{ amount: 50, desc: 'parts' }]) };
  const r = buildInvoiceLines({ Customer_Total: '200', WO_ID: '1062' }, bill, trade, 'Handyman', {}, null, []);
  const labor = r.lines[0];
  t('materials: labour still splits to hours × rate', labor.SalesItemLineDetail.Qty === 2 && labor.SalesItemLineDetail.UnitPrice === 75, labor.SalesItemLineDetail);
  t('materials: labour Amount is the residual', labor.Amount === 150, labor.Amount);
  const sum = r.lines.reduce((s, l) => s + l.Amount, 0);
  t('materials: all lines sum to the customer total', Math.abs(sum - 200) < 0.001, sum);
}

// ── 3. THE dangerous case: marked-up vendor hourly bill. Vendor billed 2h @ $35 = $70, but
//     the customer total was marked up to $150. hrs × stored rate (70) != laborAmt (150),
//     so it MUST fall back — never print "2 × $75/hr" and expose the markup. ──
{
  const bill = { Bill_Type: 'hourly', Hours: '2', Rate: '35', Labor_Total: '70' };
  const r = buildInvoiceLines({ Customer_Total: '150', WO_ID: '9' }, bill, trade, 'Handyman', {}, null, []);
  const labor = r.lines[0];
  t('marked-up: does NOT split (falls back to Qty 1)', labor.SalesItemLineDetail.Qty === 1, labor.SalesItemLineDetail.Qty);
  t('marked-up: no fabricated $/hr in description', !/\/hr/.test(labor.Description), labor.Description);
  t('marked-up: total still the approved customer total', labor.Amount === 150, labor.Amount);
}

// ── 4. flat bill: never splits ──
{
  const bill = { Bill_Type: 'flat', Hours: '0', Rate: '0', Flat_Rate: '150' };
  const r = buildInvoiceLines({ Customer_Total: '150', WO_ID: '9' }, bill, trade, 'Handyman', {}, null, []);
  t('flat: Qty stays 1', r.lines[0].SalesItemLineDetail.Qty === 1, r.lines[0].SalesItemLineDetail.Qty);
}

// ── 5. hourly but stored rate blank (legacy row): falls back rather than guessing ──
{
  const bill = { Bill_Type: 'hourly', Hours: '2', Rate: '', Labor_Total: '' };
  const r = buildInvoiceLines({ Customer_Total: '150', WO_ID: '9' }, bill, trade, 'Handyman', {}, null, []);
  t('no stored rate: falls back to Qty 1', r.lines[0].SalesItemLineDetail.Qty === 1, r.lines[0].SalesItemLineDetail.Qty);
}

// ── 6. one hour reads "1 hr", not "1 hrs"; uses the $85 default rate ──
{
  const bill = { Bill_Type: 'hourly', Hours: '1', Rate: '85', Labor_Total: '85' };
  const r = buildInvoiceLines({ Customer_Total: '85', WO_ID: '9' }, bill, trade, 'Handyman', {}, null, []);
  t('singular hour label', /1 hr ×/.test(r.lines[0].Description), r.lines[0].Description);
  t('uses the per-customer $85 rate', r.lines[0].SalesItemLineDetail.UnitPrice === 85, r.lines[0].SalesItemLineDetail.UnitPrice);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
