/* wo-status.js — the ONE definition of Work_Orders.Status values and every named group of them.
   (Ops_Build_Queue #140 / #87, Oct 14 2026; HUB_UX_DESIGN_FOUNDATION §4.)

   MIRROR RULE: the block between the WO_STATUS_SSOT markers is copied byte-for-byte into worker.js.
   test/wo-status-ssot.test.mjs fails if the two copies differ, and fails if any other status list is
   written out by hand anywhere in worker.js or the pages. To change a list, change it HERE and in the
   worker.js copy. Never add a new array of status names anywhere else.

   Stored values are the exact Title-Case strings already in the sheet. This module does NOT change which
   statuses a screen treats as open or closed: every named group below keeps exactly the members the
   hand-written list it replaced had (the lists really do differ; each name says what it is for). */

/* WO_STATUS_SSOT:BEGIN */
function __makeWOStatus() {
  var FIELD = ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold'];
  // Lifecycle order of the statuses a WO really holds today. 'Estimate Requested' is set by
  // /scope/to-wo (a WO created from a scope, waiting for the vendor's estimate) and sits before Assigned.
  // Declined / Cancelled are side exits, not steps.
  var ORDER = ['New', 'Estimate Requested', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete',
               'Pending Invoice', 'Invoiced', 'Paid'];
  var SIDE = ['Declined', 'Cancelled'];
  // Names that appear in old code paths but are NOT statuses a WO is given today. Kept only so the groups
  // that listed them keep identical membership. Do not write these.
  var LEGACY = ['Canceled', 'Closed', 'Void', 'Scheduled'];
  // Designed in HUB_UX §4, not built. Listed so the two groups that already mention them keep working.
  var RESERVED = ['Pending Payment', 'Paid by Customer'];

  // Oct 23 2026 (Ops_Build_Queue #175): 'Estimate Requested' WOs (made by /scope/to-wo, waiting on a vendor
  // estimate) were in NO group, so they vanished from owner lists, the admin Open filter and property open
  // counts. OPEN_WORK is the lists-and-counts version of FIELD_OPEN. FIELD_OPEN itself is unchanged ON PURPOSE:
  // it also drives behaviour that must NOT fire on an estimate request (a vendor bill auto-completing the job,
  // the duplicate-WO guard, 'still active' checks, same-area bundling, move-in WO linking). ACTIVE is unchanged
  // too, so tenant lists, the vendor portal and receipt matching do not start showing estimate requests.
  var OPEN_WORK = ['New', 'Estimate Requested', 'Assigned', 'Accepted', 'In Progress', 'On Hold'];

  var sets = {
    // --- the two core groups (HUB_UX isOpen / isActive) ---
    FIELD_OPEN: FIELD,                                                    // work not finished yet (field work only; NOT Estimate Requested)
    OPEN_WORK: OPEN_WORK,                                                 // FIELD_OPEN + Estimate Requested: admin property counts, aging badge
    ACTIVE: FIELD.concat(['Complete', 'Pending Invoice']),                // still on a portal / dashboard open list
    ACTIVE_OWNER: OPEN_WORK.concat(['Complete', 'Pending Invoice']),      // ACTIVE + Estimate Requested: the owner portal open list only
    // --- what a vendor may set / what the admin picker offers ---
    VENDOR_SETTABLE: ['Accepted', 'In Progress', 'On Hold', 'Complete'],  // vendor portal, share links
    VENDOR_STARTED: ['Accepted', 'In Progress', 'On Hold'],               // vendor has taken or begun the job
    PRE_START: ['Assigned', 'Accepted'],                                  // not started yet (Mark In Progress offered)
    ADMIN_PICKER: ['Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled'],
    // --- finished / billing ---
    DONE_THROUGH_PAID: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid'],
    COMPLETE_INVOICED_PAID: ['Complete', 'Invoiced', 'Paid'],
    COMPLETE_OR_LATER: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Closed'],
    ACCEPTED_OR_LATER: ['Accepted', 'In Progress', 'On Hold', 'Complete', 'Pending Invoice', 'Invoiced', 'Paid'],
    INVOICED_OR_LATER: ['Invoiced', 'Paid'],
    INVOICED_OR_PAYMENT: ['Invoiced', 'Paid', 'Pending Payment'],
    // --- ended / closed (they differ on purpose; see each use) ---
    DEAD: ['Cancelled', 'Declined'],
    CLOSED_OUT_FOLD: ['Cancelled', 'Paid', 'Invoiced'],                   // admin WO list, "Not Assigned" filter: folded into the collapsed Closed-out group
    CLOSED_TERMINAL: ['Paid', 'Cancelled'],
    CLOSED_FINAL: ['Paid', 'Cancelled', 'Canceled', 'Closed', 'Void'],
    ADDON_PARENT_BLOCKED: ['Cancelled', 'Canceled', 'Paid', 'Invoiced', 'Closed'],
    RECEIPT_CLOSED: ['Paid', 'Cancelled', 'Canceled', 'Closed', 'Void', 'Complete', 'Invoiced'],
    RECUR_CLOSED: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled', 'Canceled', 'Closed', 'Void', 'Declined'],
    DIGEST_CLOSED: ['Paid', 'Invoiced', 'Cancelled', 'Closed', 'Void'],
    TURNOVER_DONE: ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Cancelled', 'Closed'],
    STALE_ACTIVE: ['New', 'Assigned', 'Accepted', 'In Progress'],         // can go stale (On Hold is waiting on purpose)
    // --- command-center dashboard counts ---
    DASH_NOT_OPEN: ['Complete', 'Paid', 'Pending Invoice', 'Invoiced', 'Pending Payment', 'Paid by Customer', 'Cancelled', 'Canceled', 'Closed', 'Void'],
    DASH_OPEN_LEGACY: ['New', 'Assigned', 'Accepted', 'Scheduled', 'In Progress', 'On Hold'],
    // --- what a tenant sees ---
    TENANT_OPEN: ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Pending Invoice'],
    TENANT_TIMELINE: ['New', 'Assigned', 'Accepted', 'In Progress', 'Complete'],
    TENANT_TIMELINE_STEPS: ['New', 'Assigned', 'In Progress', 'Complete'],
    BILLING_STAGE: ['Pending Invoice', 'Invoiced', 'Paid']
  };
  var names = Object.keys(sets);
  for (var i = 0; i < names.length; i++) Object.freeze(sets[names[i]]);
  Object.freeze(sets);

  var known = ORDER.concat(SIDE, LEGACY, RESERVED);
  return Object.freeze({
    statuses: Object.freeze(ORDER.concat(SIDE)),
    legacy: Object.freeze(LEGACY.slice()),
    reserved: Object.freeze(RESERVED.slice()),
    sets: sets,
    // Position in the lifecycle (0..9); -1 for a side exit or anything unknown.
    order: function (s) { return ORDER.indexOf(s); },
    isKnown: function (s) { return known.indexOf(s) >= 0; },
    inSet: function (name, s) {
      if (!sets[name]) throw new Error('WOStatus: no such status group "' + name + '"');
      return sets[name].indexOf(s) >= 0;
    }
  });
}
/* WO_STATUS_SSOT:END */
var WOStatus = __makeWOStatus();
