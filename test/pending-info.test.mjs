// CAP-036 #14 -- "Invoiced -- Pending Info" sub-status.
// Prove the flag/clear handlers, the soft-block-with-override gates on the two real
// money-movement points (qb/send-invoice, scope-proposal/bill-milestones), and the UI
// surfacing against the live source, the same convention as withdraw-approval.test.mjs.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
const idx = fs.readFileSync('index.html','utf8');
const vh  = fs.readFileSync('vendor.html','utf8');
const sp  = fs.readFileSync('signed-proposals.html','utf8');
let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n); } };

// -- setVendorBillPendingInfo (Vendor_Bills flag) ----------------------------
const setVB = src.slice(src.indexOf('async function setVendorBillPendingInfo'),
                        src.indexOf('async function unapproveInvoiceReview'));
t('vendor-bill flag requires an id', /id required/.test(setVB));
t('setting the flag requires a note', /A note is required when flagging Pending Info/.test(setVB));
t('ensures the Pending_Info columns exist (additive, not a schema rewrite)',
  /ensureColumns\(env, 'Vendor_Bills', \['Pending_Info', 'Pending_Info_Note', 'Pending_Info_Set_By', 'Pending_Info_Set_Date'\]\)/.test(setVB));
t('clearing wipes the note/who/when fields', /Pending_Info_Note: pending \? note : ''/.test(setVB) && /Pending_Info_Set_By: pending \?/.test(setVB));
t('audits the flag change (best-effort)', /Vendor_Bill_Pending_Info/.test(setVB));
t('route is registered', /\/vendor-bill\/set-pending-info.*setVendorBillPendingInfo/.test(src));

// Status enum untouched -- this is a FLAG on top, not a new Status value (per Brett: a bill
// can be Status:'submitted' AND ALSO flagged Pending_Info at the same time).
t('addVendorBill still writes no Status at all (submitted is implicit / caller-set)',
  !/setVendorBillPendingInfo[\s\S]{0,400}Status:\s*'pending_info'/.test(src));
t('approveInvoiceReview still only ever writes reviewed (unchanged by this feature)',
  /Status:\s*'reviewed'/.test(src));

// -- qbSendInvoice soft block (single-bill path) -----------------------------
const qbSend = src.slice(src.indexOf('async function qbSendInvoice'), src.indexOf('async function qbSendCombinedInvoice') > src.indexOf('async function qbSendInvoice') ? src.indexOf('async function qbSendCombinedInvoice') : src.length);
t('single-bill preview warns about a flagged bill', /billPendingInfo/.test(qbSend) && /Invoiced . Pending Info/.test(qbSend));
t('single-bill real send is gated 409 unless overridden',
  /billPendingInfo && !body\.override_pending_info/.test(qbSend) && /409/.test(qbSend.slice(qbSend.indexOf('CONFIRM (writes to QuickBooks)'))));
t('override flag name is override_pending_info (matches the UI)', /override_pending_info/.test(qbSend));

// -- qbSendCombinedInvoice soft block (multi-bill grouped send) --------------
const qbCombined = src.slice(src.indexOf('async function qbSendCombinedInvoice'), src.indexOf('async function scopeProposalBook') > 0 ? src.length : src.length);
t('combined send warns per flagged row', /Pending_Info_Note/.test(qbCombined) && /Invoiced . Pending Info/.test(qbCombined));
t('combined send is gated unless overridePendingInfo', /overridePendingInfo/.test(qbCombined) && /pendingInfoRows/.test(qbCombined));
t('override is threaded from qbSendInvoice into the combined call',
  /overridePendingInfo: !!body\.override_pending_info/.test(qbSend));

// -- Scope Proposal / milestone billing also covered (Brett confirmed this explicitly) --
const setMS = src.slice(src.indexOf('async function setMilestonePendingInfo'), src.indexOf('async function scopeProposalBillMilestones'));
t('milestone flag requires signature_id + milestone_id', /signature_id and milestone_id required/.test(setMS));
t('milestone flag requires a note when setting', /A note is required when flagging Pending Info/.test(setMS));
t('ensures Payment_Milestones Pending_Info columns exist',
  /ensureColumns\(env, 'Payment_Milestones', \['Pending_Info', 'Pending_Info_Note', 'Pending_Info_Set_By', 'Pending_Info_Set_Date'\]\)/.test(setMS));
t('milestone route is registered', /\/scope-proposal\/milestone\/set-pending-info.*setMilestonePendingInfo/.test(src));

const billMs = src.slice(src.indexOf('async function scopeProposalBillMilestones'), src.indexOf('async function scopeProposalBook'));
t('billing a flagged pending milestone is soft-blocked (409) unless overridden',
  /flaggedPending.length && !body\.preview_only && !body\.override_pending_info/.test(billMs) && /409/.test(billMs));
t('preview_only still works even when flagged (so the UI can show the flag before billing)',
  /!body\.preview_only && !body\.override_pending_info/.test(billMs));
t('Payment_Milestones Status enum (pending/billed) is untouched by this feature',
  /Status: 'billed'/.test(billMs) && !/Status: 'pending_info'/.test(billMs));

// GET /scope-proposal/signed exposes the flag so signed-proposals.html can render it
const signedList = src.slice(src.indexOf('async function scopeProposalSignedList'), src.indexOf('async function scopeProposalBook') > src.indexOf('async function scopeProposalSignedList') ? src.indexOf('async function scopeProposalBillMilestones') : src.length);
t('milestone list output includes pending_info/pending_info_note', /pending_info:/.test(signedList) && /pending_info_note:/.test(signedList));

// -- hubTestWriteAllowed staging guard covers both new write endpoints -------
const guard = src.slice(src.indexOf('async function hubTestWriteAllowed'), src.length);
t('staging test-write guard covers /vendor-bill/set-pending-info (TEST- fixtures only)',
  /\/vendor-bill\/set-pending-info[\s\S]{0,700}isTestRecord\(env, 'Properties'/.test(guard));
t('staging test-write guard covers /scope-proposal/milestone/set-pending-info (TEST- fixtures only)',
  /\/scope-proposal\/milestone\/set-pending-info[\s\S]{0,900}isTestRecord\(env, 'Properties'/.test(guard));

// -- index.html (Review Bills, admin) ----------------------------------------
t('Review Bills sorts Pending-Info-flagged bills to the top', /Pending_Info.*sort to the TOP|ap - bp/.test(idx));
t('Review Bills renders a Pending Info banner on the card', /INVOICED . PENDING INFO/.test(idx));
t('Review Bills has a Flag/Clear affordance', /irFlagPendingInfo/.test(idx) && /irClearPendingInfo/.test(idx));
t('flagging requires a note client-side too (defense in depth, not just server)',
  /A note is required to flag pending info/.test(idx));
t('the QB-send modal offers a deliberate override rather than a dead end',
  /confirmQBSend\(true\)/.test(idx) && /Send anyway/.test(idx));
t('confirmQBSend forwards override_pending_info on retry', /payload\.override_pending_info = true/.test(idx));

// -- vendor.html (vendor portal) ----------------------------------------------
t('vendor sees the Pending Info banner on their own bill', /NEEDS SOMETHING BEFORE THIS CAN BE PAID/.test(vh));
t('vendor portal gained an Invoiced tab', /id="tabInvoiced"/.test(vh) && /switchTab\('invoiced'\)/.test(vh));
t('Invoiced tab sorts Pending-Info bills first, reviewed/paid last (minimal sort, not a redesign)',
  /function invoicedSortKey/.test(vh) && /if \(anyPending\) return 0/.test(vh) && /anyUnreviewed \? 1 : 2/.test(vh));
t('loadWOsForCurrentTab wires the new tab', /if \(currentTab === 'invoiced'\) return fetchInvoicedWOs\(\);/.test(vh));

// -- signed-proposals.html (Scope Proposal milestone billing) ---------------
t('milestone rows show a pending-info chip + flag/clear link', /toggleMilestonePendingInfo/.test(sp));
t('billing a flagged milestone offers a deliberate override, not a dead end',
  /confirmMilestoneBill\(this,true\)/.test(sp) && /Bill anyway/.test(sp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
