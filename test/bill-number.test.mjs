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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
