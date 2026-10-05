// QuickBooks -> Hub vendor sync: pure-function coverage (source-sliced from worker.js, like vendor-onboarding.test.mjs).
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  if (kind === 'const' && src[src.indexOf('=', i) + 2] !== '{' && src[src.indexOf('=', i) + 2] !== '[') {
    return src.slice(i, src.indexOf('\n', i));
  }
  if (kind === 'const' && src[src.indexOf('=', i) + 2] === '[') return src.slice(i, src.indexOf(';', i) + 1);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const F = new Function(
  grab('VENDOR_ONBOARDING_REQUIRED_FIELDS', 'const') + '\n' + grab('QBO_FILLABLE_FIELDS', 'const') + '\n' +
  ['vendorOnboardingComplete', 'qbAddrToString', 'qbVendorHubFields', 'vendorQboFillPlan', 'vendorQboMatch', 'qbMatchEntity', 'qbNormName'].map(n => grab(n)).join('\n') +
  '\nreturn { vendorOnboardingComplete, qbAddrToString, qbVendorHubFields, vendorQboFillPlan, vendorQboMatch };'
)();
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? JSON.stringify(got) : ''); } };

// gate relaxation
t('unlinked vendor still needs Tax_ID', F.vendorOnboardingComplete({ Phone: '1', Billing_Email: 'a@b.c', Billing_Address: 'x' }).missing.join() === 'Tax_ID');
t('QBO-linked vendor does not need Tax_ID', F.vendorOnboardingComplete({ QBO_Vendor_ID: '77', Phone: '1', Billing_Email: 'a@b.c', Billing_Address: 'x' }).complete === true);
t('QBO-linked vendor still needs the other three', F.vendorOnboardingComplete({ QBO_Vendor_ID: '77' }).missing.join() === 'Phone,Billing_Email,Billing_Address');
t('blank QBO id counts as unlinked', F.vendorOnboardingComplete({ QBO_Vendor_ID: '  ' }).missing.includes('Tax_ID'));

// address / field mapping
t('address joins street + city/state/zip', F.qbAddrToString({ Line1: '1 Main St', Line2: 'Apt 2', City: 'Baltimore', CountrySubDivisionCode: 'MD', PostalCode: '21201' }) === '1 Main St, Apt 2, Baltimore, MD 21201');
t('empty/absent address is blank', F.qbAddrToString(null) === '' && F.qbAddrToString({}) === '');
const qv = { Id: '77', PrimaryEmailAddr: { Address: 'c@x.com' }, PrimaryPhone: { FreeFormNumber: '410-555-0100' }, BillAddr: { Line1: '9 Oak', City: 'Towson', CountrySubDivisionCode: 'MD', PostalCode: '21204' } };
const h = F.qbVendorHubFields(qv);
t('hub fields from QBO vendor', h.Billing_Email === 'c@x.com' && h.Phone === '410-555-0100' && h.Billing_Address === '9 Oak, Towson, MD 21204', h);
t('mobile is the phone fallback', F.qbVendorHubFields({ Mobile: { FreeFormNumber: '443' } }).Phone === '443');

// fill plan
let p = F.vendorQboFillPlan({ QBO_Vendor_ID: '77' }, qv);
t('fills all three blanks and is ready (linked => no Tax ID)', Object.keys(p.fill).length === 3 && p.still_missing.length === 0, p);
p = F.vendorQboFillPlan({ Phone: 'KEEP', Billing_Email: '', QBO_Vendor_ID: '77' }, qv);
t('never overwrites an existing Hub value', !('Phone' in p.fill) && p.fill.Billing_Email === 'c@x.com', p);
p = F.vendorQboFillPlan({ Email: 'hub@x.com', Payment_Address: '5 Elm' }, { Id: '9' });
t('falls back to Hub Email/Payment_Address when QBO is empty', p.fill.Billing_Email === 'hub@x.com' && p.fill.Billing_Address === '5 Elm', p);
p = F.vendorQboFillPlan({}, null);
t('no QBO record and nothing to fill reports everything missing', Object.keys(p.fill).length === 0 && p.still_missing.length === 4, p);
p = F.vendorQboFillPlan({ Name: 'A' }, { Id: '5' });
t('QBO record with no data: linked so only three missing', p.still_missing.join() === 'Phone,Billing_Email,Billing_Address', p);

// matching
const list = [{ id: '77', name: 'Cesar Diaz', company: '', email: '' }, { id: '8', name: 'Smith Inc', company: '', email: '' }, { id: '9', name: 'Smith Properties LLC', company: '', email: '' }];
let m = F.vendorQboMatch({ Name: 'Cesar Diaz' }, list);
t('exact name match', m && m.id === '77' && m.confidence === 'exact', m);
m = F.vendorQboMatch({ Name: 'Caesar Diaz', Company: 'Cesar Diaz' }, list);
t('falls through to Company for an exact hit', m && m.id === '77' && m.confidence === 'exact', m);
m = F.vendorQboMatch({ First_Name: 'Cesar', Last_Name: 'Diaz' }, list);
t('First+Last match', m && m.id === '77', m);
m = F.vendorQboMatch({ Name: 'Smith Co' }, list);
t('ambiguous never reported as exact', m && m.confidence === 'ambiguous', m);
t('no match is null', F.vendorQboMatch({ Name: 'Zed Plumbing' }, list) === null);

console.log(fail ? `FAILED ${fail}/${pass + fail}` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
