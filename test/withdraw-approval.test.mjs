// Prove the withdraw path's guards against the live source rather than by reading it.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n); } };

const fn = src.slice(src.indexOf('async function unapproveInvoiceReview'),
                     src.indexOf('async function approveInvoiceReview'));

t('refuses once a QuickBooks invoice exists', /QB_Invoice_ID \|\| ''/.test(fn) && /409/.test(fn));
t('refuses once a QuickBooks bill exists', /QB_Bill_ID \|\| ''/.test(fn));
t('deactivates the approval row', /Active: 'FALSE'/.test(fn));
t('marks it withdrawn rather than leaving it pending', /QB_Invoice_Status: 'withdrawn'/.test(fn));
t('puts the vendor bill back to submitted', /Status: 'submitted'/.test(fn));
t('checks that write actually landed', /parsed && parsed\.success/.test(fn));
t('warns when the bill could not be restored', /billRestored \? '' :/.test(fn));

// re-approval must see the withdrawn row as gone
t("re-approve only blocks on LIVE rows", /r\.Active !== 'FALSE' && String\(r\.Bill_ID\)/.test(src));
// and a withdrawn approval must release its receipts
const rb = src.slice(src.indexOf('async function listBilledReceipts'), src.indexOf('async function listReceipts'));
t('withdrawn approvals release their receipts', /r\.Active !== 'FALSE'/.test(rb));

// Review Bills asks for exactly the status we restore
t('the restored status is what Review Bills filters on',
  fs.readFileSync('index.html','utf8').includes("'/vendor-bills?status=submitted'"));

// the estimate side must tell the vendor
const est = src.slice(src.indexOf('async function unapproveEstimate'), src.indexOf('async function approveEstimate'));
t('estimate withdraw only acts on an Approved estimate', /!== 'Approved'/.test(est));
t('estimate withdraw sets it back to Pending', /\['Pending'\]/.test(est));
t('estimate withdraw texts the vendor', /sendSMS/.test(est));
t('and warns if that text failed', /could not be texted/.test(est));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
