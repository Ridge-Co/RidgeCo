// Vendor Onboarding Phase 1 — pure-function coverage, run against the live worker source.
// Covers vendorOnboardingComplete (the Submit-Bill gate / gap-report logic) and
// vendorQBOnboardingFields (the QuickBooks Vendor field-mapping — PrimaryEmailAddr/BillAddr/
// TaxIdentifier, confirmed against current QBO API docs, see VENDOR_ONBOARDING_BANKING_BUILD_BRIEF_v1.0
// section 3b). Both are PURE (no I/O), extracted by source-slicing exactly like
// test/qb-address.test.mjs and test/trade-map.test.mjs already do.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');

function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1) + (kind === 'const' ? ';' : '');
}

const { vendorOnboardingComplete, vendorQBOnboardingFields, VENDOR_ONBOARDING_REQUIRED_FIELDS } = new Function(
  grab('VENDOR_ONBOARDING_REQUIRED_FIELDS', 'const') + '\n' +
  grab('vendorOnboardingComplete') + '\n' +
  grab('vendorQBOnboardingFields') +
  '\nreturn { vendorOnboardingComplete, vendorQBOnboardingFields, VENDOR_ONBOARDING_REQUIRED_FIELDS };'
)();

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

// ── vendorOnboardingComplete ────────────────────────────────────────────────
t('required fields are exactly phone/billing email/billing address/tax id (not banking, not the doc upload)',
  JSON.stringify(VENDOR_ONBOARDING_REQUIRED_FIELDS) === JSON.stringify(['Phone', 'Billing_Email', 'Billing_Address', 'Tax_ID']));

t('a brand-new vendor with nothing set is incomplete, missing all four',
  vendorOnboardingComplete({}).complete === false &&
  JSON.stringify(vendorOnboardingComplete({}).missing) === JSON.stringify(['Phone', 'Billing_Email', 'Billing_Address', 'Tax_ID']));

t('a vendor with all four required fields is complete',
  vendorOnboardingComplete({ Phone: '4105550100', Billing_Email: 'a@b.com', Billing_Address: '1 Main St', Tax_ID: '12-3456789' }).complete === true);

const partial = vendorOnboardingComplete({ Phone: '4105550100', Billing_Email: 'a@b.com' });
t('a partially-filled vendor reports exactly the still-missing fields',
  partial.complete === false && JSON.stringify(partial.missing) === JSON.stringify(['Billing_Address', 'Tax_ID']), partial);

t('whitespace-only values count as missing, not present',
  vendorOnboardingComplete({ Phone: '   ', Billing_Email: 'a@b.com', Billing_Address: 'x', Tax_ID: 'y' }).missing.includes('Phone'));

t('banking fields are never part of the required-now check, even when absent',
  vendorOnboardingComplete({ Phone: '4105550100', Billing_Email: 'a@b.com', Billing_Address: '1 Main St', Tax_ID: '12-3456789', Bank_Info_Status: 'not_started' }).complete === true);

t('a completely undefined vendor does not throw and reports incomplete',
  vendorOnboardingComplete(undefined).complete === false);

// ── vendorQBOnboardingFields (QuickBooks Vendor field mapping) ──────────────
const fields = vendorQBOnboardingFields({ Billing_Email: 'ap@acme.com', Billing_Address: '123 Trade St', Tax_ID: '12-3456789' });
t('Billing_Email maps to PrimaryEmailAddr.Address', fields.PrimaryEmailAddr && fields.PrimaryEmailAddr.Address === 'ap@acme.com', fields);
t('Billing_Address maps to BillAddr.Line1 (compound Address object, confirmed against QBO Vendor API docs)',
  fields.BillAddr && fields.BillAddr.Line1 === '123 Trade St', fields);
t('Tax_ID maps to a plain-string TaxIdentifier field (not nested)', fields.TaxIdentifier === '12-3456789', fields);

t('no onboarding fields set on the vendor yields an empty patch (nothing to push)',
  Object.keys(vendorQBOnboardingFields({})).length === 0);

t('a vendor with only a legacy Email (no Billing_Email) yields no PrimaryEmailAddr here — that fallback lives in qbFindOrCreateVendor\'s create payload, not this shared/reused patch',
  vendorQBOnboardingFields({ Email: 'legacy@acme.com' }).PrimaryEmailAddr === undefined);

t('a vendor with only billing email set yields ONLY PrimaryEmailAddr (no stray BillAddr/TaxIdentifier keys)',
  (() => { const f = vendorQBOnboardingFields({ Billing_Email: 'x@y.com' }); return Object.keys(f).length === 1 && f.PrimaryEmailAddr.Address === 'x@y.com'; })());

t('vendorQBOnboardingFields does not throw on undefined input', Object.keys(vendorQBOnboardingFields(undefined)).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
