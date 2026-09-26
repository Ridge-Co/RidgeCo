// QuickBooks customer creation for a Hub owner (Sep 26 2026). Live finding: owners added in the Hub with only
// the plain Email column (Nirnay Pradhan, Rei) got a QuickBooks customer with NO email, because creation only
// read Billing_Email while the look-before-create lookup already used Billing_Email || Email. Runs the REAL
// qbFindOrCreateCustomer from worker.js with stubbed QuickBooks/Sheets calls and inspects the create payload.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function build(stubs) {
  return new Function('stubs', 'const { qbLookupExisting, qbMappingClash, updateRow, qbApi, qbDupId, qbFault, qbOwnerDisplayName } = stubs;\n' +
    grab('qbFindOrCreateCustomer') + '\nreturn qbFindOrCreateCustomer;')(stubs);
}
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

async function run(owner, opts = {}) {
  const calls = { payload: null, updates: [], lookups: 0, apiCalls: 0 };
  const fn = build({
    qbLookupExisting: async () => { calls.lookups++; return opts.found || null; },
    qbMappingClash: async () => null,
    updateRow: async (env, tab, id, fields) => { calls.updates.push({ tab, id, fields }); },
    qbApi: async (env, path, method, payload) => { calls.apiCalls++; calls.payload = payload; return { Customer: { Id: '777' } }; },
    qbDupId: () => null, qbFault: () => '', qbOwnerDisplayName: () => '',
  });
  const id = await fn({}, owner, owner.dn || 'Nirnay Pradhan', 'tok');
  return { id, calls };
}

let r = await run({ ID: '23', First_Name: 'Nirnay', Last_Name: 'Pradhan', Email: 'aapropertymd@gmail.com', Billing_Email: '', Phone: '+14438897178' });
t('Email-only owner (the live Nirnay case) now gets a QuickBooks email', r.calls.payload && r.calls.payload.PrimaryEmailAddr && r.calls.payload.PrimaryEmailAddr.Address === 'aapropertymd@gmail.com', r.calls.payload);
t('customer id is returned and saved back to the owner row', r.id === '777' && r.calls.updates.some(u => u.tab === 'Owners' && u.id === '23' && u.fields.QBO_Customer_ID === '777'), r.calls.updates);
t('phone still sent', r.calls.payload.PrimaryPhone && r.calls.payload.PrimaryPhone.FreeFormNumber === '+14438897178');

r = await run({ ID: '1', Email: 'contact@x.com', Billing_Email: 'billing@x.com' });
t('Billing_Email still wins over Email', r.calls.payload.PrimaryEmailAddr.Address === 'billing@x.com');

r = await run({ ID: '2', Email: '   ', Billing_Email: '' });
t('no email anywhere → no PrimaryEmailAddr key (never sends blank)', !('PrimaryEmailAddr' in r.calls.payload), r.calls.payload);

r = await run({ ID: '3', Email: 'a@b.com', Billing_Address: '12 Main St', Billing_City: 'Baltimore', Billing_State: 'MD', Billing_Zip: '21201', Company: 'Lee Holdings LLC' });
t('billing address maps to BillAddr', r.calls.payload.BillAddr && r.calls.payload.BillAddr.Line1 === '12 Main St' && r.calls.payload.BillAddr.City === 'Baltimore' && r.calls.payload.BillAddr.CountrySubDivisionCode === 'MD' && r.calls.payload.BillAddr.PostalCode === '21201', r.calls.payload);
t('company maps to CompanyName', r.calls.payload.CompanyName === 'Lee Holdings LLC');

r = await run({ ID: '4', QBO_Customer_ID: '460', Email: 'x@y.com' });
t('already-linked owner returns the existing id and never calls QuickBooks', r.id === '460' && r.calls.apiCalls === 0 && r.calls.lookups === 0);

r = await run({ ID: '5', Email: 'x@y.com' }, { found: '901' });
t('existing QuickBooks customer is linked, not duplicated', r.id === '901' && r.calls.apiCalls === 0 && r.calls.updates.some(u => u.fields.QBO_Customer_ID === '901'));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
