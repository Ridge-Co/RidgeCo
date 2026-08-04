// The bill number: the vendor's own if they gave one, the work order number if not.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
function grab(name){
  let i = src.indexOf('function '+name+'(');
  if(i<0) throw new Error('missing '+name);
  let d=0,j=src.indexOf(')',i); j=src.indexOf('{',j);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1);
}
const MAX = parseInt(src.match(/QB_DOCNUMBER_MAX = (\d+)/)[1]);
const { qbBillDocNumber, qbIsDocNumberFault } = new Function(
  'const QB_DOCNUMBER_MAX = ' + MAX + ';\n' + grab('qbBillDocNumber') + '\n' + grab('qbIsDocNumberFault') +
  '\nreturn { qbBillDocNumber, qbIsDocNumberFault };')();
const num = (b, i, x) => qbBillDocNumber(b, i, x).number;

let pass=0,fail=0;
const t=(n,c,got)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n, got!==undefined?('got '+JSON.stringify(got)):'');} };

const ir = { WO_ID: 'WO-1062', Vendor_ID: '9', Bill_ID: '5' };

t('the vendor\'s own number wins',
  num({ Vendor_Invoice_No: 'INV-8823' }, ir, 0) === 'INV-8823');
t('OCR-read number is used the same way',
  num({ Invoice_Number: '77412' }, ir, 0) === '77412');
t('the explicit field beats the OCR one',
  num({ Vendor_Invoice_No: 'A1', Invoice_Number: 'B2' }, ir, 0) === 'A1');

t('no number falls back to the work order', num({}, ir, 0) === 'WO-1062');
t('blank and whitespace both count as no number',
  num({ Vendor_Invoice_No: '   ' }, ir, 0) === 'WO-1062');
t('a missing bill row still yields the WO number', num(null, ir, 0) === 'WO-1062');

// same vendor, same job, second bill
t('a second bill from the same vendor is disambiguated',
  num({}, ir, 1) === 'WO-1062-2', num({}, ir, 1));
t('and a third', num({}, ir, 2) === 'WO-1062-3');
t('but a vendor-supplied number is never suffixed',
  num({ Vendor_Invoice_No: 'INV-1' }, ir, 3) === 'INV-1');

// QuickBooks caps the field
const long = 'INV-' + '9'.repeat(40);
// A truncated invoice number looks authoritative and reconciles against nothing, so an
// over-long one falls back to the job number and reports what the vendor actually wrote.
const over = qbBillDocNumber({ Vendor_Invoice_No: long }, ir, 0);
t('an over-long number is NOT truncated', over.number === 'WO-1062', over);
t('and the vendor\'s real number is reported back', over.overlong === long);
t('a number exactly at the limit is kept',
  qbBillDocNumber({ Vendor_Invoice_No: 'X'.repeat(MAX) }, ir, 0).number === 'X'.repeat(MAX));

// the source is stated, so the preview can say where the number came from
t('a vendor number is labelled as such', qbBillDocNumber({ Vendor_Invoice_No: 'A' }, ir, 0).source === 'vendor');
t('a fallback is labelled as the work order', qbBillDocNumber({}, ir, 0).source === 'work order');

// retry safety: only a fault QuickBooks blames on the number is safe to retry
t('a duplicate-number fault is retryable',
  qbIsDocNumberFault({ Fault: { Error: [{ code: '6140', Message: 'Duplicate Document Number' }] } }) === true);
t('a DocNumber validation message is retryable',
  qbIsDocNumberFault({ Fault: { Error: [{ code: '2030', Detail: 'DocNumber is too long' }] } }) === true);
t('an unrelated fault is NOT retryable',
  qbIsDocNumberFault({ Fault: { Error: [{ code: '6000', Message: 'Closed accounting period' }] } }) === false);
t('an unreadable response is NOT retryable — the bill may already exist',
  qbIsDocNumberFault({ message: 'internal error' }) === false);
t('an empty response is NOT retryable', qbIsDocNumberFault(null) === false);

t('no WO and no vendor number yields nothing rather than a bad guess',
  num({}, { WO_ID: '' }, 0) === '');


// ── Terms: a vendor's own terms if the sheet gives any, otherwise due on receipt.
const worker = fs.readFileSync('worker.js','utf8');
const { vendorTermDays, vendorTermLabel } = new Function(
  grab('vendorTermDays') + '\n' + grab('vendorTermLabel') +
  '\nreturn { vendorTermDays, vendorTermLabel };')();

t('no terms on the vendor means due on receipt', vendorTermDays({}) === 0);
t('and it says so', vendorTermLabel({}) === 'Due on receipt');
t('"Net 7" is honoured', vendorTermDays({ Payment_Terms: 'Net 7' }) === 7);
t('"net10" without a space still parses', vendorTermDays({ Payment_Terms: 'net10' }) === 10);
t('"Net 30" is honoured', vendorTermLabel({ Payment_Terms: 'Net 30' }) === 'Net 30');
t('an explicit "Due on receipt" stays at zero', vendorTermDays({ Payment_Terms: 'Due on Receipt' }) === 0);
t('COD counts as due on receipt', vendorTermDays({ Payment_Terms: 'COD' }) === 0);
t('a Terms column works as well as Payment_Terms', vendorTermDays({ Terms: 'Net 15' }) === 15);
t('nonsense falls back to due on receipt rather than guessing',
  vendorTermDays({ Payment_Terms: 'whenever' }) === 0);
t('an absurd number is rejected', vendorTermDays({ Payment_Terms: 'Net 9999' }) === 0);

t('the due date is derived from the term', /dueDate\.setDate\(dueDate\.getDate\(\) \+ termDays\)/.test(worker));
t('and defaults to the transaction date when there is no term',
  /termDays > 0 \? dueDate\.toISOString\(\)\.split\('T'\)\[0\] : txnDate/.test(worker));
t('the Terms field is set, not just the date', /billPayload\.SalesTermRef = \{ value: dueTermId \}/.test(worker));
t('terms are looked up in the file, never hardcoded', /select Id, Name, DueDays from Term/.test(worker));
t('a renamed due-on-receipt term is matched by its zero days', /Number\(t\.DueDays\) === 0/.test(worker));
t('and it warns rather than failing when the term is missing',
  /has no "\$\{vendorTermLabel\(vendor\)\}" term|QuickBooks has no /.test(worker));
t('the lookup runs on the send path, not the preview',
  worker.indexOf('await qbTermForDays(env, token, termDays)') > worker.indexOf('if (previewOnly)'));
t('invoices are left alone — this is bills only',
  !/invoicePayload\.SalesTermRef/.test(worker) && !/invoicePayload\.DueDate/.test(worker));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
