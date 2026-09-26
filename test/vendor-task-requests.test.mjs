// Vendor Task Requests (CAP-036 #12, Sep 24 2026) — Brett explicitly flagging a vendor issue
// (Request Photos / Request Description Update / Other) from the WO detail view or the
// bill-review section, scoped to the vendor's estimate or invoice, surfaced in a dedicated
// vendor-portal section. A vendor "mark done" click does NOT auto-resolve it — it lands in
// Brett's own "needs your review" queue until he marks it reviewed. This is a DIFFERENT system
// from Vendor_Requests/processVendorNudges (the automatic chase-a-quiet-vendor clock, covered
// by vendor-nudges.test.mjs) — structural/static checks only, no live Sheets/Twilio calls.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- data model exists, additive (new tab, doesn't touch Vendor_Requests) ----
ok(src.includes("const VENDOR_TASK_TAB = 'Vendor_Task_Requests'"), 'uses its own tab, distinct from the existing Vendor_Requests nudge-clock tab');
ok(src.includes('VENDOR_TASK_COLS') && src.includes("'WO_ID'") && src.includes("'Vendor_ID'") && src.includes("'Request_Type'") && src.includes("'Scope'") && src.includes("'Status'"), 'tab has the columns the spec calls for');
ok(src.includes('ensureVendorTaskTab') && src.includes('ensureColumns(env, VENDOR_TASK_TAB, VENDOR_TASK_COLS)'), 'uses the repo’s ensureColumns/ensureTab additive-tab convention, not a bespoke one');

// ---- canned request types + estimate/invoice scope ----
const createBody = grabAsync('createVendorTaskRequest');
ok(src.includes("const VENDOR_TASK_TYPES = ['photos','description','other']"), 'exactly the three canned request types from Brett’s spec: photos, description, other');
ok(src.includes("const VENDOR_TASK_SCOPES = ['estimate','invoice']"), 'scope is estimate-or-invoice only, per Brett’s confirmed "only scoping needed" spec');
ok(createBody.includes('VENDOR_TASK_TYPES.includes(reqType)'), 'create rejects any request_type outside the three canned ones');
ok(createBody.includes('VENDOR_TASK_SCOPES.includes(scope)'), 'create rejects any scope outside estimate/invoice');
ok(createBody.includes("reqType === 'other' && !customMsg") || createBody.includes("reqType === 'other'") && createBody.includes('customMsg'), '\'other\' requires a free-typed message at send time — it is not a canned template');
ok(createBody.includes('vendorPortalLink('), 'the outgoing message links back to the vendor portal, matching every other vendor SMS in this file');
ok(createBody.includes('smsGatedSend('), 'notification reuses the ONE existing SMS chokepoint (smsGatedSend) rather than a new send path');

// ---- vendor marks done -> does NOT auto-resolve, goes to a review queue ----
const doneBody = grabAsync('markVendorTaskDone');
ok(doneBody.includes("Status: 'vendor_marked_done'"), 'the vendor-side "mark done" action sets an intermediate status, never the terminal resolved status directly');
ok(!doneBody.includes("Status: 'reviewed_resolved'"), 'marking done from the vendor side can never itself set the terminal reviewed_resolved status — that is Brett-only, per his explicit "don’t trust the vendor’s own click" instruction');
ok(doneBody.includes('Vendor_Marked_Done_Date'), 'records when the vendor marked it done, for Brett’s review context');
ok(doneBody.includes("row.Status !== 'open'"), 'only an open request can be marked done (no double-submitting an already-done or already-reviewed row)');

// ---- per-vendor ownership check (a vendor can only touch/see its own rows) ----
ok(doneBody.includes("callerRole === 'vendor'") && doneBody.includes('callerSessionId'), 'mark-done resolves the acting vendor from the verified session, not a client-supplied id, when called with a vendor session token');
ok(doneBody.includes("row.Vendor_ID !== vendorId") , 'mark-done refuses to let one vendor resolve a request that belongs to a different vendor');

const listBody = grabAsync('listVendorTaskRequests');
ok(listBody.includes("callerRole === 'vendor'") && listBody.includes('vendorId = callerSessionId'), 'the vendor-portal list forces vendor_id from the session for a vendor caller — a query-string vendor_id cannot be used to page through another vendor’s requests');

// ---- Brett's "needs your review" queue is a distinct read, and reviewing it is the only way to fully resolve ----
const reviewListBody = grabAsync('listVendorTaskPendingReview');
ok(reviewListBody.includes("r.Status === 'vendor_marked_done'"), 'the pending-review queue is exactly the vendor-marked-done rows Brett has not yet cleared');

const reviewedBody = grabAsync('markVendorTaskReviewed');
ok(reviewedBody.includes("row.Status !== 'vendor_marked_done'"), 'only a vendor-marked-done row can be marked reviewed (can’t skip straight from open to resolved)');
ok(reviewedBody.includes("Status: 'reviewed_resolved'") && reviewedBody.includes('Reviewed_Date'), 'marking reviewed is the only path to the terminal resolved status, and it is timestamped');

// ---- routing + per-role auth wiring ----
ok(src.includes("if (path === '/vendor-task-request/create')") , 'POST /vendor-task-request/create is routed');
ok(src.includes("if (path === '/vendor-task-requests')") , 'GET /vendor-task-requests is routed');
ok(src.includes("if (path === '/vendor-task-requests/pending-review')"), 'GET /vendor-task-requests/pending-review is routed');
ok(src.includes("if (path === '/vendor-task-request/mark-done')"), 'POST /vendor-task-request/mark-done is routed');
ok(src.includes("if (path === '/vendor-task-request/mark-reviewed')"), 'POST /vendor-task-request/mark-reviewed is routed');

const roleScopesIdx = src.indexOf('const ROLE_SCOPES = {');
const roleScopesBlock = src.slice(roleScopesIdx, src.indexOf('};', roleScopesIdx) + 2);
ok(roleScopesBlock.includes("'/vendor-task-requests'") && roleScopesBlock.includes("'/vendor-task-request/mark-done'"), 'a vendor’s own session token is allow-listed for the two vendor-facing endpoints (list + mark-done) only');
ok(!roleScopesBlock.includes("'/vendor-task-request/create'") && !roleScopesBlock.includes("'/vendor-task-request/mark-reviewed'") && !roleScopesBlock.includes("'/vendor-task-requests/pending-review'"), 'create, mark-reviewed, and the pending-review queue are admin-only — deliberately absent from every ROLE_SCOPES entry');

console.log(`vendor-task-requests: ${n}/${n} passing`);
