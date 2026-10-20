// "payment date unavailable" warnings are display-only (no money moves): recorded as P2, never a P0 on every page load. Real QuickBooks failures stay P0.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const tbl = /const FAIL_SEVERITY_BY_WHERE = \[[\s\S]*?\n\];/.exec(src)[0];
const fn = /function failSeverity[\s\S]*?\n}\n/.exec(src)[0];
const sev = new Function(tbl + '\n' + fn + '\nreturn failSeverity;')();
const msg = 'WO-1246 err=1 paid/part-paid invoice(s) have no QuickBooks Payment with a usable date (credit memo, journal entry or lookup problem)';
let n = 0; const t = (name, ok) => { assert.ok(ok, name); n++; };
t('customer payment date missing is P2', sev('qb_payables_payment_date_missing', msg) === 'P2');
t('vendor paid date missing is P2', sev('qb_payables_vendor_paid_date_missing', msg) === 'P2');
t('a real QuickBooks sync failure stays P0', sev('qb_sync_failed', 'sync failed') === 'P0');
t('QuickBooks auth trouble stays P0 even on a date-missing row', sev('qb_payables_payment_date_missing', 'invalid_grant token expired') === 'P0');
console.log(`failure-severity-date-missing: ${n}/${n} passing`);
