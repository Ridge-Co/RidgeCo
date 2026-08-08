// ============================================================
// MAINTENANCE HUB — Cloudflare Worker
// Deploy to: maintenance-hub.brett-2f8.workers.dev
// ============================================================
// FIXES IN THIS VERSION:
//   1. listVendorBills — try/catch; returns [] if Vendor_Bills tab missing
//   2. tenantByPin — returns owner_id for tenant portal config check
//   3. addWONote — sends owner SMS when notify_owner_status_note === true
//   4. normalizePhone — returns E.164 (+1XXXXXXXXXX) for Twilio
//   5. /smslog route — fixed typo 'SMS_Logss' -> 'SMS_Logs'
//   6. Duplicate POST routes removed (/unit/update, /tenant/update, /upload-photo)
//   7. logSMS — try/catch so missing tab never breaks an operation
//   8. processPendingNotifications — try/catch
//   9. fetchConfig — try/catch
//  10. NEW: /public/entities-feed — cross-hub integration contract for BrettOS
// SESSION 1 CHANGES (July 2026):
//  11. listVendorBills — status-only filter for Invoice Review admin view
//  12. NEW: /invoice-review/approve POST endpoint — marks bill reviewed, logs to Invoice_Review sheet
//  13. vendorByPin — vendor_rate already present (confirmed, no change needed)
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
};
const PIN_MAX_ATTEMPTS = 4;
const PIN_LOCKOUT_MIN  = 5;
const OPEN_WO_STATUSES = ['New','Assigned','Accepted','In Progress','On Hold','Complete','Pending Invoice'];
const PRIORITY_ORDER   = { urgent:0, high:1, normal:2, low:3 };
// BUILD_VERSION: bumped on every deploy that changes the Worker OR any portal.
// Portals poll GET /version and refresh themselves onto new code when this changes
// (B-093 auto-refresh). Format: YYYY-MM-DD.N  — bump N for same-day redeploys.
const BUILD_VERSION = '2026-08-08.1';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url  = new URL(request.url);
    const path = url.pathname;
    const PUBLIC_PATHS = ['/health','/version','/vendor-by-pin','/tenant-by-pin','/owner-by-pin','/sms-inbound','/qb/test','/qb/accounts','/qb/setup-trades','/qb/connect','/qb/callback','/qb/webhook'];
    if (!PUBLIC_PATHS.includes(path)) {
      // Auth gate (SEC-1 / B-093). Admin secret = full access. Otherwise a valid
      // PIN-issued session token grants ONLY its role's allow-listed endpoints
      // (scoped, see ROLE_SCOPES). Per-record authz (vendor_id/Owner_ID/PIN) still
      // enforced inside each handler. PIN-login endpoints are PUBLIC (gated by PIN +
      // lockout) so a portal can log in without ever carrying the admin secret.
      const _tok = request.headers.get('X-Auth-Token') || '';
      if (_tok !== env.WORKER_SECRET) {
        // Dedicated contacts-sync token (Google Contacts sync). Accepted ONLY for:
        //   • GET on the list endpoints the sync reads, and
        //   • POST /contact/augment — an augment-ONLY write (fills blank fields
        //     from an allow-list, never overwrites, never touches phone/ID).
        // Nothing else. Fully inert unless env.CONTACTS_SYNC_TOKEN is set, so
        // deploying this has zero effect until the secret is added. Does not
        // touch WORKER_SECRET or the PIN/session auth below.
        const SYNC_READ_PATHS = ['/tenants','/owners','/vendors','/properties','/units'];
        const _syncOk = !!env.CONTACTS_SYNC_TOKEN
          && _tok === env.CONTACTS_SYNC_TOKEN
          && (
            (request.method === 'GET'  && SYNC_READ_PATHS.includes(path)) ||
            (request.method === 'POST' && path === '/contact/augment')
          );
        // Narrow read-only token for the trash push-nudge: accepted ONLY for
        // GET /trash/unbilled (a list of property labels + missed/unbilled counts —
        // no money, no PII, no writes). Lets a scheduled task poll for the nudge
        // without carrying the full admin secret. Fully inert unless env.TRASH_NUDGE_TOKEN is set.
        const _nudgeOk = !!env.TRASH_NUDGE_TOKEN
          && _tok === env.TRASH_NUDGE_TOKEN
          && request.method === 'GET' && path === '/trash/unbilled';
        if (!_syncOk && !_nudgeOk) {
          const _session = await verifySessionToken(_tok, env.WORKER_SECRET);
          if (!_session || !isPathAllowedForRole(path, _session.role))
            return json({ error: 'Unauthorized' }, 401);
        }
      }
    }
    try {
      if (request.method === 'GET') {
        if (path === '/health')                 return await health(env);
        if (path === '/version')                return json({ version: BUILD_VERSION });
        if (path === '/properties')             return await getSheet(env, 'Properties');
        if (path === '/public/entities-feed')   return await getEntitiesFeed(env);
        if (path === '/units')                  return await getSheet(env, 'Units');
        if (path === '/tenants')                return await getSheet(env, 'Tenants');
        if (path === '/owners')                 return await getSheet(env, 'Owners');
        if (path === '/vendors')                return await getSheet(env, 'Vendors');
        if (path === '/workorders')             return await getSheet(env, 'Work_Orders');
        if (path === '/wo-tenants')             return await listWOTenants(env, url);
        if (path === '/time-entries')           return await listTimeEntries(env, url);
        if (path === '/receipts')               return await listReceipts(env, url);
        if (path === '/receipts-billed')        return await listBilledReceipts(env, url);
        if (path === '/invoices')               return await getSheet(env, 'Invoices');
        if (path === '/templates')              return await getSheet(env, 'Recurring_Templates');
        if (path === '/smslog')                 return await getSheet(env, 'SMS_Logs');
        if (path === '/wishlist')               return await getSheet(env, 'Wishlist');
        if (path === '/keys')                   return await getSheet(env, 'Keys');
        if (path === '/keys-history')           return await getSheet(env, 'Keys_History');
        if (path === '/config')                 return await getConfig(env);
        if (path === '/property')               return await getPropertyFull(env, url);
        if (path === '/building-info')          return await getBuildingInfo(env, url);
        if (path === '/cache')                  return await getSheet(env, 'Troubleshooting_Cache');
        if (path === '/keys-by-property')       return await keysByProperty(env, url);
        if (path === '/keys-by-unit')           return await keysByUnit(env, url);
        if (path === '/attachments')            return await getAttachments(env, url);
        if (path === '/wo-audit')               return await getWOAudit(env, url);
        if (path === '/tenant-by-pin')          return await tenantByPin(env, url);
        if (path === '/owner-by-pin')           return await ownerByPin(env, url);
        if (path === '/vendor-by-pin')          return await vendorByPin(env, url);
        if (path === '/owner-properties')       return await ownerProperties(env, url);
        if (path === '/vendor-workorders')      return await vendorWorkorders(env, url);
        if (path === '/tenant-workorders')      return await tenantWorkorders(env, url);
        if (path === '/owner-workorders')       return await ownerWorkorders(env, url);
        if (path === '/owner-notifications')    return await getOwnerNotifications(env, url);
        if (path === '/owner-users')            return await getOwnerUsers(env, url);
        if (path === '/notifications/pending')  return await processPendingNotifications(env);
        if (path === '/master-keys')            return await getSheet(env, 'Master_Keys');
        if (path === '/wo-templates')           return await listWOTemplates(env, url);
        if (path === '/materials')              return await listMaterials(env, url);
        if (path === '/returns')                return await getSheet(env, 'Returns');
        if (path === '/vendor-bills')           return await listVendorBills(env, url);
        if (path === '/estimates')              return await listEstimates(env, url);
        if (path === '/nearby-wos')             return await listNearbyWOs(env, url);
        if (path === '/cluster-suggestions')    return await clusterSuggestions(env, url);
        if (path === '/qb/test')                return await qbTest(env);
        if (path === '/qb/accounts')            return await qbListAccounts(env);
        if (path === '/qb/setup-trades')        return await qbSetupTrades(env);
        if (path === '/qb/ready')               return await qbReadyQueue(env, url);
        if (path === '/qb/entities')            return await qbEntities(env, url);
        if (path === '/admin/duplicate-properties') return await adminDuplicateProperties(env);
        if (path === '/admin/duplicate-owners')     return await adminDuplicateOwners(env);
        if (path === '/qb/trade-map')           return await qbTradeMap(env);
        if (path === '/qb/unit-audit')          return await qbUnitAudit(env, url);
        if (path === '/qb/repairable')          return await qbRepairable(env, url);
        if (path === '/qb/payables')            return await qbPayables(env, url);
        if (path === '/daily-digest')           return await digestResponse(env, url);
        if (path === '/ops-telemetry')          return await opsTelemetryRead(env, url);
        if (path === '/ops-review-log')         return await opsReviewLogRead(env, url);
        if (path === '/receipt-queue')          return await listReceiptQueue(env, url);
        if (path === '/trash/properties')       return await trashListProperties(env);
        if (path === '/trash/week')             return await trashWeek(env, url);
        if (path === '/trash/unbilled')         return await trashUnbilled(env, url);
        if (path === '/trash/qb-customers')     return await trashQbCustomers(env);
        if (path === '/trash/qb-items')         return await trashQbItems(env);
      }
      if (request.method === 'POST') {
        if (path === '/upload-photo') return await handlePhotoUploadClean(env, request);
        if (path === '/sms-inbound')  return await handleInboundSMS(env, request);
        const body = await request.json();
        if (path === '/contact/augment')          return await augmentContact(env, body);
        if (path === '/workorder')                return await createWorkOrder(env, body);
        if (path === '/workorder/update')         return await updateRow(env, 'Work_Orders', body.id, body.fields);
        if (path === '/workorder/notes')          return await appendWONotes(env, body);
        if (path === '/wo-tenant/add')            return await addTenantToWO(env, body);
        if (path === '/wo-tenant/remove')         return await removeTenantFromWO(env, body);
        if (path === '/time-entry/add')           return await addTimeEntry(env, body);
        if (path === '/time-entry/delete')        return await updateRow(env, 'Time_Entries', body.id, { Active: 'FALSE' });
        if (path === '/receipt/add')              return await addReceipt(env, body);
        if (path === '/receipt/delete')           return await updateRow(env, 'Receipts', body.id, { Active: 'FALSE' });
        if (path === '/tenant/move-out')          return await processMoveOut(env, body);
        if (path === '/assign')                   return await assignVendor(env, body);
        if (path === '/status')                   return await updateStatus(env, body);
        if (path === '/invoice')                  return await createInvoice(env, body);
        if (path === '/invoice/update')           return await updateRow(env, 'Invoices', body.id, body.fields);
        if (path === '/property/add')             return await addRow(env, 'Properties', body);
        if (path === '/property/update')          return await updateRow(env, 'Properties', body.id, body.fields);
        if (path === '/unit/add')                 return await addRow(env, 'Units', body);
        if (path === '/unit/update')              return await updateRow(env, 'Units', body.id, body.fields);
        if (path === '/tenant/add')               return await addRow(env, 'Tenants', body);
        if (path === '/tenant/update')            return await updateRow(env, 'Tenants', body.id, body.fields);
        if (path === '/owner/add')                return await addRow(env, 'Owners', body);
        if (path === '/owner/update')             return await updateRow(env, 'Owners', body.id, body.fields);
        if (path === '/owner/billing')            return await updateOwnerBilling(env, body);
        if (path === '/owner/get-billing')        return await getOwnerBilling(env, url);
        if (path === '/vendor/add')               return await addRow(env, 'Vendors', body);
        if (path === '/vendor/update')            return await updateRow(env, 'Vendors', body.id, body.fields);
        if (path === '/set-pin')                  return await updateRow(env, 'Tenants', body.tenant_id, { PIN: body.pin });
        if (path === '/vendor/set-pin')           return await updateRow(env, 'Vendors', body.vendor_id, { PIN: body.pin });
        if (path === '/owner/set-pin')            return await updateRow(env, 'Owners', body.owner_id, { PIN: body.pin });
        if (path === '/key/add')                  return await addRow(env, 'Keys', body);
        if (path === '/key/update')               return await updateKeyWithHistory(env, body);
        if (path === '/key/delete')               return await updateRow(env, 'Keys', body.id, { Active: 'FALSE' });
        if (path === '/building-info/save')       return await saveBuildingInfo(env, body);
        if (path === '/attachment/delete')        return await updateRow(env, 'Attachments', body.id, { Active: 'FALSE' });
        if (path === '/wo/add-note')              return await addWONote(env, body);
        if (path === '/wo/owner-update')          return await ownerUpdateWO(env, body);
        if (path === '/wo/admin-update')          return await adminUpdateWO(env, body);
        if (path === '/wo/append-description')    return await appendDescription(env, body);
        if (path === '/wo/set-tenant-visibility') return await setTenantVisibility(env, body);
        if (path === '/schedule')                 return await scheduleWO(env, body);
        if (path === '/owner/notifications')      return await saveOwnerNotifications(env, body);
        if (path === '/owner-user/add')           return await addRow(env, 'Owner_Users', body);
        if (path === '/owner-user/update')        return await updateRow(env, 'Owner_Users', body.id, body.fields);
        if (path === '/send-pin')                 return await sendPinMessage(env, body);
        if (path === '/regenerate-pin')           return await regeneratePIN(env, body);
        if (path === '/admin/fix-pins')           return await adminFixPins(env, body);
        if (path === '/admin/fix-stale-tenants')  return await adminFixStaleTenants(env, body);
        if (path === '/admin/merge-property')     return await adminMergeProperty(env, body);
        if (path === '/admin/merge-owner')        return await adminMergeOwner(env, body);
        if (path === '/admin/owner-to-user')      return await adminOwnerToUser(env, body);
        if (path === '/admin/migrate-trades')     return await adminMigrateTrades(env, body);
        if (path === '/admin/share-attachments')  return await adminShareAttachments(env, body);
        if (path === '/admin/reformat-sheets')    return await adminReformatSheets(env);
        if (path === '/admin/test-drive')         return await testDriveAccess(env);
        if (path === '/estimate')                 return await addEstimateVersion(env, body);
        if (path === '/estimate/approve')         return await approveEstimate(env, body);
        if (path === '/estimate/unapprove')       return await unapproveEstimate(env, body);
        if (path === '/geocode-property')         return await geocodeProperty(env, body);
        if (path === '/save-property-clusters')   return await savePropertyClusters(env, body);
        if (path === '/import-key-registry')      return await importKeyRegistry(env, body);
        if (path === '/generate-estimate-text')   return await generateEstimateText(env, body);
        if (path === '/create-upload-session')    return await createUploadSession(env, body);
        if (path === '/log-attachment')           return await logAttachment(env, body);
        if (path === '/vendor-bill/add')          return await addVendorBill(env, body);
        if (path === '/vendor-bill/update')       return await updateRow(env, 'Vendor_Bills', body.id, body.fields);
        if (path === '/wo/set-qbo-info')          return await updateRow(env, 'Work_Orders', body.id, body.fields);
        if (path === '/master-key/add')           return await addRow(env, 'Master_Keys', body);
        if (path === '/master-key/update')        return await updateRow(env, 'Master_Keys', body.id, body.fields);
        if (path === '/master-key/bulk-assign')   return await bulkAssignMasterKey(env, body);
        if (path === '/wo-template/add')          return await addRow(env, 'WO_Templates', body);
        if (path === '/wo-template/update')       return await updateRow(env, 'WO_Templates', body.id, body.fields);
        if (path === '/material/add')             return await addRow(env, 'Materials', body);
        if (path === '/material/update')          return await updateRow(env, 'Materials', body.id, body.fields);
        if (path === '/return/add')               return await addRow(env, 'Returns', body);
        if (path === '/return/update')            return await updateRow(env, 'Returns', body.id, body.fields);
        if (path === '/cache/save')               return await saveCacheEntry(env, body);
        if (path === '/cache/flag')               return await flagCacheEntry(env, body);
        if (path === '/cache/refresh')            return await refreshCacheEntry(env, body);
        if (path === '/wishlist/add')             return await addWishlistItem(env, body);
        if (path === '/wishlist/delete')          return await updateRow(env, 'Wishlist', body.id, { Active: 'FALSE' });
        if (path === '/config/set')               return await setConfigKey(env, body);
        if (path === '/telemetry/log')            return await telemetryLog(env, body);
        if (path === '/ops-review')               return await opsReviewRun(env, body);
        if (path === '/invoice-review/approve')   return await approveInvoiceReview(env, body);
        if (path === '/qb/send-invoice')          return await qbSendInvoice(env, body);
        if (path === '/invoice-review/unapprove') return await unapproveInvoiceReview(env, body);
        if (path === '/qb/map')                   return await qbMapEntity(env, body);
        if (path === '/qb/repair-invoice')        return await qbRepairInvoice(env, body);
        if (path === '/qb/sync-payments')         return await qbSyncPayments(env, body);
        if (path === '/qb/create-subcustomer')    return await qbCreateSubCustomer(env, body);
        if (path === '/qb/backfill-emails')       return await qbBackfillEmails(env, body);
        if (path === '/qb/reparent-unit')         return await qbReparentUnit(env, body);
        if (path === '/qb/vendor-in-house')       return await qbSetVendorInHouse(env, body);
        if (path === '/qb/record-paid-bill')      return await qbRecordPaidBill(env, body);
        if (path === '/qb/clear-ir-bill')         return await qbClearIrBill(env, body);
        if (path === '/qb/reprice-invoice')       return await qbRepriceInvoice(env, body);
        if (path === '/qb/relabel-invoice')       return await qbRelabelInvoice(env, body);
        if (path === '/qb/set-bill-docnumber')    return await qbSetBillDocNumber(env, body);
        if (path === '/qb/attach-to-bill')        return await qbAttachToBill(env, body);
        if (path === '/qb/find-bills')            return await qbFindBills(env, body);
        if (path === '/qb/delete-bill')           return await qbDeleteBill(env, body);
        if (path === '/receipt-intake')           return await receiptIntake(env, body);
        if (path === '/receipt-scan')             return await receiptScan(env);
        if (path === '/receipt-queue/approve')    return await approveReceiptQueue(env, body);
        if (path === '/trash/property/add')       return await trashAddProperty(env, body);
        if (path === '/trash/property/update')    return await updateRow(env, 'Trash_Properties', body.id, body.fields);
        if (path === '/trash/log-visit')          return await trashLogVisit(env, body);
        if (path === '/trash/invoice')            return await trashInvoice(env, body);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message, stack: err.stack, type: err.constructor.name }, 500);
    }
  },

  // Daily digest cron (Session 5). Delivery is gated by Config flags and stays
  // dormant until Brett flips digest_enabled=TRUE after Twilio send is live. A fire
  // with delivery off just builds the digest and returns — no messages, negligible cost.
  async scheduled(event, env, ctx) {
    const cron = event && event.cron;
    // Weekly Optimizer Reviewer (B-129) — Mondays 12:00 UTC (8am ET). Reads the last 7 days
    // of Ops_Telemetry, computes metrics, asks Claude for a ranked proposal, logs it to
    // Ops_Review_Log, and delivers IF digest delivery is enabled. Isolated from the digest.
    if (cron === '0 12 * * 1') {
      try { await runWeeklyReview(env, { deliver: true, trigger: 'cron' }); } catch (e) { /* non-fatal */ }
      return;
    }
    // Daily digest (existing) — 11:00 UTC. Now self-instruments a telemetry row so the
    // Ops_Telemetry tab self-creates and gets a heartbeat row every morning (best-effort).
    try {
      const _t0 = Date.now();
      const digest = await buildDigest(env);
      const delivery = await deliverDigest(env, digest);
      try { await logTelemetry(env, { Source:'worker', Job_Type:'daily_digest', Skill_Or_Endpoint:'scheduled/daily-digest', Success:'TRUE', Latency_ms: Date.now()-_t0, Notes: (delivery&&delivery.delivered)?'delivered':'dormant' }); } catch (_) { /* telemetry best-effort */ }
    } catch (e) { /* non-fatal: a digest error must never affect anything else */ }
    // Receipt inbox sweep — self-provisions the folder, then pulls any new drops into
    // the confirm-first queue. Read + queue only; no money, no customer contact.
    try { await receiptScan(env); } catch (e) { /* non-fatal */ }
    // Payment sync — reads QuickBooks and auto-closes work orders whose vendor bill is now paid
    // (marks them Paid so they drop off the active work list). Read + status-only; no money moves,
    // no customer/vendor contact. Runs once here; the "Check & save" button does the same on demand.
    try { await qbSyncPayments(env, {}); } catch (e) { /* non-fatal: never breaks the digest run */ }
  }
};

// -- CROSS-HUB ENTITY FEED (BrettOS integration) -----------------------------
// GET /public/entities-feed
// Deliberate, versioned, external-facing contract -- this is what BrettOS reads
// to resolve shorthand like "151" to a real property. Internal routes/schema
// above can change freely; only a breaking change to THIS shape requires
// bumping `version`. If you ever need to change the shape, bump version to 2
// rather than silently changing what version 1 returns.
async function getEntitiesFeed(env) {
  const properties = await fetchTab(env, 'Properties');
  return json({
    version: 1,
    generated_at: new Date().toISOString(),
    properties: properties
      .filter(p => p.Active !== 'FALSE')
      .map(p => ({
        id: p.ID,
        address: p.Address || '',
        city: p.City || '',
        aliases: buildAddressAliases(p.Address || ''),
        owner_id: p.Owner_ID || '',
      })),
  });
}

// Generates shorthand variants of an address so "151" and "151 lanvale" both
// resolve to "151 W Lanvale St". Deliberately conservative -- false positives
// (matching the wrong property) are worse than missing a match.
function buildAddressAliases(address) {
  if (!address) return [];
  const aliases = new Set();
  const trimmed = address.trim();
  aliases.add(trimmed.toLowerCase());

  const parts = trimmed.split(/\s+/);
  const numMatch = trimmed.match(/^(\d+)/);
  if (numMatch) aliases.add(numMatch[1]); // "151"

  if (parts.length >= 2) {
    let streetIdx = 1;
    if (/^[NSEW]$/i.test(parts[1]) && parts.length > 2) streetIdx = 2;
    if (parts[streetIdx]) aliases.add(`${parts[0]} ${parts[streetIdx]}`.toLowerCase()); // "151 lanvale"
  }

  return [...aliases].filter(Boolean);
}

// ── PIN LOCKOUT ──────────────────────────────────────────────

async function checkPinLockout(env, pin) {
  try {
    const data = await sheetsRequest(env, 'GET', `/values/PIN_Lockout`);
    const rows = data.values || [];
    if (rows.length < 2) return { locked: false, fail_count: 0 };
    const [headers, ...dataRows] = rows;
    const iP = headers.indexOf('PIN'), iF = headers.indexOf('Fail_Count'), iL = headers.indexOf('Locked_Until');
    const row = dataRows.find(r => (r[iP]||'').toLowerCase() === pin.toLowerCase());
    if (!row) return { locked: false, fail_count: 0 };
    const failCount = parseInt(row[iF]||'0');
    const lockedUntil = row[iL] ? new Date(row[iL]) : null;
    if (lockedUntil && lockedUntil > new Date())
      return { locked: true, minutes_remaining: Math.ceil((lockedUntil - Date.now()) / 60000), fail_count: failCount };
    return { locked: false, fail_count: failCount };
  } catch(e) { return { locked: false, fail_count: 0 }; }
}

async function recordPinFailure(env, pin) {
  try {
    const data = await sheetsRequest(env, 'GET', `/values/PIN_Lockout`);
    const rows = data.values || [];
    const headers = rows.length ? rows[0] : ['PIN','Fail_Count','Locked_Until'];
    const dataRows = rows.slice(1);
    const iP = headers.indexOf('PIN'), iF = headers.indexOf('Fail_Count'), iL = headers.indexOf('Locked_Until');
    const rowIndex = dataRows.findIndex(r => (r[iP]||'').toLowerCase() === pin.toLowerCase());
    const existing = rowIndex >= 0 ? parseInt(dataRows[rowIndex][iF]||'0') : 0;
    const newCount = existing + 1;
    const lockedUntil = newCount >= PIN_MAX_ATTEMPTS ? new Date(Date.now() + PIN_LOCKOUT_MIN * 60000).toISOString() : '';
    if (rowIndex >= 0) {
      const sr = rowIndex + 2;
      await sheetsRequest(env, 'POST', `/values:batchUpdate`, { valueInputOption: 'RAW', data: [
        { range: `PIN_Lockout!${col(iF)}${sr}`, values: [[String(newCount)]] },
        { range: `PIN_Lockout!${col(iL)}${sr}`, values: [[lockedUntil]] },
      ]});
    } else {
      const newRow = headers.map(h => ({ PIN: pin, Fail_Count: String(newCount), Locked_Until: lockedUntil }[h] || ''));
      await sheetsRequest(env, 'POST', `/values/PIN_Lockout:append?valueInputOption=RAW`, { values: [newRow] });
    }
    return { fail_count: newCount, locked: newCount >= PIN_MAX_ATTEMPTS };
  } catch(e) { return { fail_count: 0, locked: false }; }
}

async function clearPinLockout(env, pin) {
  try {
    const data = await sheetsRequest(env, 'GET', `/values/PIN_Lockout`);
    const rows = data.values || [];
    if (rows.length < 2) return;
    const [headers, ...dataRows] = rows;
    const iP = headers.indexOf('PIN'), iF = headers.indexOf('Fail_Count'), iL = headers.indexOf('Locked_Until');
    const rowIndex = dataRows.findIndex(r => (r[iP]||'').toLowerCase() === pin.toLowerCase());
    if (rowIndex < 0) return;
    const sr = rowIndex + 2;
    await sheetsRequest(env, 'POST', `/values:batchUpdate`, { valueInputOption: 'RAW', data: [
      { range: `PIN_Lockout!${col(iF)}${sr}`, values: [['0']] },
      { range: `PIN_Lockout!${col(iL)}${sr}`, values: [['']] },
    ]});
  } catch(e) { /* non-fatal */ }
}

async function pinLookup(env, pin, finder) {
  if (!pin || pin.length < 5) return json({ error: 'Invalid PIN' }, 400);
  const lock = await checkPinLockout(env, pin);
  if (lock.locked) return json({ error: 'Too many failed attempts', locked: true, minutes_remaining: lock.minutes_remaining }, 429);
  const result = await finder(pin);
  if (!result) {
    const fail = await recordPinFailure(env, pin);
    const left = PIN_MAX_ATTEMPTS - fail.fail_count;
    if (fail.locked) return json({ error: `Too many failed attempts. Locked for ${PIN_LOCKOUT_MIN} minutes.`, locked: true, minutes_remaining: PIN_LOCKOUT_MIN }, 429);
    return json({ error: `PIN not found. ${left} attempt${left !== 1 ? 's' : ''} remaining.` }, 404);
  }
  await clearPinLockout(env, pin);
  return result;
}

// ── PIN LOOKUPS ──────────────────────────────────────────────

async function tenantByPin(env, url) {
  const pin  = url.searchParams.get('pin')  || '';
  const name = (url.searchParams.get('name') || '').trim().toLowerCase();
  if (!name) return json({ error: 'First name is required', name_required: true }, 400);
  return await pinLookup(env, pin, async (p) => {
    const tenants = await fetchTab(env, 'Tenants');
    const tenant = tenants.find(t => t.PIN && t.PIN.toLowerCase() === p.toLowerCase() && t.Active !== 'FALSE');
    if (!tenant) return null;
    if (tenant.Move_Out_Date) {
      const moveOut = new Date(tenant.Move_Out_Date + 'T23:59:59');
      if (moveOut < new Date()) return null;
    }
    const tFirst = (tenant.First_Name||'').toLowerCase();
    if (tFirst !== name && !tFirst.startsWith(name)) return null;
    const [props, units] = await fetchTabs(env, ['Properties','Units']);
    const unit = units.find(u => u.ID === tenant.Unit_ID) || {};
    const prop = props.find(pr => pr.ID === (tenant.Property_ID || unit.Property_ID)) || {};
    return json({
      tenant_id:        tenant.ID,
      tenant_name:      `${tenant.First_Name} ${tenant.Last_Name||''}`.trim(),
      property_id:      prop.ID||'',
      property_address: prop.Address||'',
      unit_id:          tenant.Unit_ID||'',
      unit_label:       unit.Unit_Label||'',
      owner_id:         prop.Owner_ID||'',  // FIX: added for Tenant_Submit_WOs check
      token:            await makeSessionToken({ role: 'tenant', id: tenant.ID }, env.WORKER_SECRET),
    });
  });
}

async function ownerByPin(env, url) {
  const pin = url.searchParams.get('pin') || '';
  const _ownerName = (url.searchParams.get('name') || '').trim();
  if (!_ownerName) return json({ error: 'First name is required', name_required: true }, 400);
  return await pinLookup(env, pin, async (p) => {
    const [ownerUsers, owners] = await fetchTabs(env, ['Owner_Users','Owners']);
    const enteredName = (url?.searchParams?.get('name')||'').trim().toLowerCase();
    if (!enteredName) return null;
    const user = ownerUsers.find(u => u.PIN && u.PIN.toLowerCase() === p.toLowerCase() && u.Active !== 'FALSE');
    if (user) {
      const uFirst = (user.First_Name||'').toLowerCase();
      if (uFirst !== enteredName && !uFirst.startsWith(enteredName)) return null;
      const owner = owners.find(o => o.ID === user.Owner_ID);
      return json({
        owner_id: user.Owner_ID, owner_user_id: user.ID,
        owner_name: owner ? `${owner.First_Name||''} ${owner.Last_Name||''}`.trim() || owner.Company || '' : '',
        owner_company: owner?.Company||'', owner_phone: owner?.Phone||'',
        user_name: `${user.First_Name} ${user.Last_Name||''}`.trim(), user_phone: user.Phone||'', is_sub_user: true,
        token: await makeSessionToken({ role: 'owner', id: user.Owner_ID }, env.WORKER_SECRET),
      });
    }
    const owner = owners.find(o => o.PIN && o.PIN.toLowerCase() === p.toLowerCase() && o.Active !== 'FALSE');
    if (!owner) return null;
    return json({
      owner_id: owner.ID, owner_name: `${owner.First_Name} ${owner.Last_Name||''}`.trim(),
      owner_company: owner.Company||'', owner_phone: owner.Phone||'',
      user_name: `${owner.First_Name} ${owner.Last_Name||''}`.trim(), is_sub_user: false,
      token: await makeSessionToken({ role: 'owner', id: owner.ID }, env.WORKER_SECRET),
    });
  });
}

async function getOwnerUsers(env, url) {
  const ownerId = url.searchParams.get('owner_id');
  if (!ownerId) return json({ error: 'Missing owner_id' }, 400);
  const users = await fetchTab(env, 'Owner_Users');
  return json(users.filter(u => u.Owner_ID === ownerId && u.Active !== 'FALSE'));
}

async function vendorByPin(env, url) {
  const pin  = url.searchParams.get('pin')  || '';
  const name = (url.searchParams.get('name') || '').trim().toLowerCase();
  if (!name) return json({ error: 'Name is required', name_required: true }, 400);
  return await pinLookup(env, pin, async (p) => {
    const vendors = await fetchTab(env, 'Vendors');
    const vendor = vendors.find(v => v.PIN && v.PIN.toLowerCase() === p.toLowerCase() && v.Active !== 'FALSE');
    if (!vendor) return null;
    const loginName = ((vendor.First_Name||'').trim() || (vendor.Name||'').split(' ')[0]).toLowerCase();
    if (loginName !== name && !loginName.startsWith(name)) return null;
    return json({
      vendor_id: vendor.ID, vendor_name: vendor.Name || `${vendor.First_Name||''} ${vendor.Last_Name||''}`.trim(),
      vendor_phone: vendor.Phone||'', vendor_trade: vendor.Trade||'',
      vendor_trades: vendor.Trades||vendor.Trade||'', vendor_rate: vendor.Hourly_Rate||'', language: vendor.Language||'en',
      token: await makeSessionToken({ role: 'vendor', id: vendor.ID }, env.WORKER_SECRET),
    });
  });
}
// ── KEYS ─────────────────────────────────────────────────────

async function keysByProperty(env, url) {
  const propId = url.searchParams.get('property_id');
  if (!propId) return json({ error: 'Missing property_id' }, 400);
  const keys = await fetchTab(env, 'Keys');
  return json(keys.filter(k => k.Property_ID === propId && k.Active !== 'FALSE'));
}

async function keysByUnit(env, url) {
  const unitId = url.searchParams.get('unit_id');
  const propId = url.searchParams.get('property_id') || '';
  if (!unitId) return json({ error: 'Missing unit_id' }, 400);
  const keys = await fetchTab(env, 'Keys');
  return json(keys.filter(k => {
    if (k.Active === 'FALSE') return false;
    if (k.Unit_ID === unitId) return true;
    if (propId && k.Property_ID === propId && !k.Unit_ID && k.Shared !== 'FALSE') return true;
    return false;
  }));
}

function getWOLockboxes(keys, woPropertyId, woUnitId, woUnitLabel) {
  return keys
    .filter(k => {
      if (k.Active === 'FALSE') return false;
      if (!k.Property_ID || String(k.Property_ID) !== String(woPropertyId)) return false;
      const kUnit = (k.Unit_ID || k.Unit_Label || '').toString().trim();
      const isPropertyLevel = kUnit === '' || kUnit === '0';
      const unitMatches = woUnitId && (String(kUnit) === String(woUnitId) || (woUnitLabel && kUnit.toLowerCase() === woUnitLabel.toLowerCase()));
      if (isPropertyLevel && k.Shared !== 'FALSE') return true;
      if (unitMatches) return true;
      if (!woUnitId && isPropertyLevel) return true;
      return false;
    })
    .map(k => {
      const kUnit = (k.Unit_ID || k.Unit_Label || '').toString().trim();
      const isBuilding = kUnit === '' || kUnit === '0';
      const TYPE_MAP = { 'Lockbox':'Lockbox','lockbox':'Lockbox','Door Code':'Door Code','Door_Code':'Door Code','Electronic':'Electronic Code','Front Door':'Front Door','front door':'Front Door','Unit Key':'Unit Key','unit key':'Unit Key','Key':'Key','Gate Code':'Gate Code','Gate_Code':'Gate Code','Building Code':'Building Code','Building_Code':'Building Code','Other':'Access' };
      const typeLabel = TYPE_MAP[k.Key_Type] || (k.Key_Type || 'Key');
      const unitDisplay = kUnit || woUnitLabel || '';
      const label = isBuilding ? `Building — ${typeLabel}` : `${unitDisplay ? 'Unit '+unitDisplay+' — ' : ''}${typeLabel}`;
      const code = k.Key_Code || k.Lockbox_Code || k.Code || k.code || '';
      const location = k.Lockbox_Location || k.Location || k.Notes || '';
      return { label, code, location, notes: k.Notes||'', type: k.Key_Type||'', scope: isBuilding ? 'building' : 'unit' };
    })
    .filter(k => k.code || k.location)
    .sort((a, b) => a.scope === 'building' && b.scope !== 'building' ? -1 : 1);
}

async function updateKeyWithHistory(env, body) {
  const keys = await fetchTab(env, 'Keys');
  const existing = keys.find(k => k.ID === String(body.id));
  if (!existing) return json({ error: 'Key not found' }, 404);
  const now = new Date().toISOString().split('T')[0];
  const codeChanged = (body.fields.Key_Code !== undefined && body.fields.Key_Code !== existing.Key_Code) || (body.fields.Lockbox_Code !== undefined && body.fields.Lockbox_Code !== existing.Lockbox_Code);
  if (codeChanged) {
    const histData = await sheetsRequest(env, 'GET', `/values/Keys_History`);
    const histRows = histData.values || [];
    if (histRows.length) {
      const hh = histRows[0];
      const newRow = hh.map(h => ({ ID: String(nextSafeId(histRows)), Key_ID: String(body.id), Property_ID: existing.Property_ID||'', Unit_ID: existing.Unit_ID||'', Key_Type: existing.Key_Type||'', Old_Code: existing.Key_Code || existing.Lockbox_Code||'', New_Code: body.fields.Key_Code || body.fields.Lockbox_Code||'', Changed_Date: now, Changed_By: body.changed_by||'admin', Reason: body.reason||'', Notes: body.notes||'' }[h] ?? ''));
      await sheetsRequest(env, 'POST', `/values/Keys_History:append?valueInputOption=RAW`, { values: [newRow] });
    }
  }
  return await updateRow(env, 'Keys', body.id, { ...body.fields, Last_Changed: now });
}

// ── ATTACHMENTS ──────────────────────────────────────────────

async function getAttachments(env, url) {
  const woId = url.searchParams.get('wo_id') || '';
  const invoiceId = url.searchParams.get('invoice_id') || '';
  if (!woId && !invoiceId) return json({ error: 'Missing wo_id or invoice_id' }, 400);
  const attachments = await fetchTab(env, 'Attachments');
  return json(attachments.filter(a => { if (a.Active === 'FALSE') return false; if (woId && a.WO_ID === woId) return true; if (invoiceId && a.Invoice_ID === invoiceId) return true; return false; }));
}

async function listAttachments(env, url) {
  const woId = url.searchParams.get('wo_id') || '';
  const rows = await fetchTab(env, 'Attachments');
  let items = rows.filter(r => r.Active !== 'FALSE');
  if (woId) items = items.filter(r => r.WO_ID === woId);
  return json(items);
}

// ── PHOTO UPLOAD ─────────────────────────────────────────────

async function handlePhotoUploadClean(env, request) {
  const step = { current: 'init' };
  try {
    step.current = 'parse_form';
    const formData = await request.formData();
    const file     = formData.get('file');
    const woId     = (formData.get('wo_id')    || '').trim();
    const propAddr = (formData.get('property') || 'Unknown Property').trim() || 'Unknown Property';
    const fileType = (formData.get('file_type')|| 'photo').trim();
    if (!file) return json({ error: 'No file provided' }, 400);
    const filename = file.name || `${fileType}_${Date.now()}`;
    const mimeType = file.type || 'application/octet-stream';
    step.current = 'get_token';
    const propsRoot = env.DRIVE_PROPERTIES_ROOT;
    if (!propsRoot) return json({ error: 'DRIVE_PROPERTIES_ROOT env var not set' }, 500);
    const token = await getAccessToken(env);
    if (!token) return json({ error: 'Failed to get Google access token' }, 500);
    step.current = 'find_prop_folder';
    const propFolder = await findOrCreateFolder(token, propAddr, propsRoot, propsRoot);
    if (!propFolder || !propFolder.id) return json({ error: `Could not find/create property folder "${propAddr}"`, step: step.current }, 500);
    step.current = 'find_wo_folder';
    const woLabel  = woId || `upload_${Date.now()}`;
    // Vendor cost docs (receipts/bills/invoices) go to a NON-shared internal folder — never the
    // customer-facing WO folder that gets shared on the invoice. Job photos stay in the WO folder.
    const INTERNAL_TYPES = ['receipt','bill','invoice'];
    const isInternal = INTERNAL_TYPES.includes(fileType.toLowerCase());
    let woFolder;
    if (isInternal) {
      const internalRoot = await findOrCreateFolder(token, '_Internal — Vendor Bills', propFolder.id);
      if (!internalRoot || !internalRoot.id) return json({ error: 'Could not find/create internal vendor-bills folder', step: step.current }, 500);
      woFolder = await findOrCreateFolder(token, woLabel, internalRoot.id);
    } else {
      woFolder = await findOrCreateFolder(token, woLabel, propFolder.id);
    }
    if (!woFolder || !woFolder.id) return json({ error: `Could not find/create WO folder "${woLabel}"`, step: step.current }, 500);
    step.current = 'upload_file';
    const arrayBuffer = await file.arrayBuffer();
    const uploaded = await uploadFileToDrive(token, arrayBuffer, filename, mimeType, woFolder.id, propsRoot);
    if (!uploaded || !uploaded.id) return json({ error: 'Drive upload failed', step: step.current }, 500);
    // Make customer/job-facing media (before/after/report/photo/video) anyone-with-link readable so
    // vendors/tenants/owners can open it in the portal without a Google login. Internal cost docs
    // (receipt/bill/invoice → _Internal — Vendor Bills) are NEVER shared (FEATURE_LOG rule 13).
    if (!isInternal) { try { await driveShareAnyone(token, uploaded.id); } catch(_) { /* non-fatal */ } }
    step.current = 'log_attachments';
    try {
      await addRow(env, 'Attachments', { WO_ID: woId, File_Name: filename, File_Type: fileType, Drive_File_ID: uploaded.id, Drive_URL: uploaded.webViewLink || uploaded.id, Mime_Type: mimeType, Created_Date: new Date().toISOString().split('T')[0], Active: 'TRUE' });
    } catch(sheetErr) { /* non-fatal */ }
    step.current = 'update_wo_fields';
    try {
      // Only the customer-facing WO folder becomes the WO's shared Drive_Folder (photo link).
      if (!isInternal && woFolder.webViewLink) {
        await updateWOField(env, woId, 'Drive_Folder_URL', woFolder.webViewLink);
        await updateWOField(env, woId, 'Drive_Folder_ID',  woFolder.id);
      }
    } catch(woErr) { /* non-fatal */ }
    return json({ success: true, fileId: uploaded.id, url: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`, name: filename, woFolderUrl: woFolder.webViewLink || '' });
  } catch(e) {
    return json({ error: e.message || 'Upload failed', step: step.current, stack: e.stack?.substring(0,300) }, 500);
  }
}

// ── WO HELPERS ───────────────────────────────────────────────

// Is this tenant still living there? Used by every path that decides whether to hand a
// tenant's contact details to anyone. One predicate on purpose — three near-copies of this
// check in three files is how one of them ends up not being applied.
function isTenantCurrent(t) {
  if (!t || !t.ID) return false;
  if (String(t.Active || '').toUpperCase() === 'FALSE') return false;
  if (t.Move_Out_Date) {
    const out = new Date(t.Move_Out_Date + 'T23:59:59');
    if (!isNaN(out) && out < new Date()) return false;
  }
  return true;
}

// The tenant to hand a VENDOR. Deliberately stricter than "whoever the work order names":
// a vendor going to an address today needs the person living there today. A moved-out
// tenant's name and phone must not travel out to a third party — they no longer live
// there, and it's their personal contact detail being passed to a stranger.
function currentTenantForDispatch(tenants, unit, wo) {
  const id = (unit && unit.Tenant_ID) || (wo && wo.Tenant_ID) || '';
  if (!id) return null;
  const t = (tenants || []).find(x => String(x.ID) === String(id));
  return isTenantCurrent(t) ? t : null;
}

function isTenantNotifiable(tenant, wo) {
  if (!tenant || !tenant.Phone) return false;
  // Delegates the "do they still live there" question rather than restating it. Three
  // near-copies of this check is why one of them ended up not being applied.
  if (!isTenantCurrent(tenant)) return false;
  if (tenant.Move_In_Date && wo && wo.Created_Date) { if (new Date(tenant.Move_In_Date) > new Date(wo.Created_Date)) return false; }
  return true;
}

function roundUpTo15(minutes) { if (minutes <= 0) return 15; return Math.ceil(minutes / 15) * 15; }

// Ids arrive as an array from the Hub and as a comma string from anything hand-rolled.
// Accept both rather than silently doing nothing to one of them.
function parseIdList(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [];
  arr.map(x => String(x == null ? '' : x).trim()).forEach(x => { if (x && out.indexOf(x) < 0) out.push(x); });
  return out;
}

// Stamp the bill onto the hours it was built from. Bill_ID is not an original Time_Entries
// column and addRow/updateRow map by header — writing it without this reports success and
// stores nothing (rule 37).
async function linkTimeEntriesToBill(env, entryIds, billId, woId) {
  const ids = parseIdList(entryIds);
  if (!ids.length || !billId) return 0;
  await ensureColumns(env, 'Time_Entries', ['Bill_ID']);
  const rows = await fetchTab(env, 'Time_Entries');
  let linked = 0;
  for (const id of ids) {
    const row = rows.find(r => String(r.ID) === String(id));
    // Only hours on THIS job, and never re-point an entry that is already inside a bill —
    // that would move money from one invoice to another without either one changing.
    if (!row) continue;
    if (woId && String(row.WO_ID) !== String(woId)) continue;
    if (String(row.Bill_ID || '').trim()) continue;
    await updateRow(env, 'Time_Entries', id, { Bill_ID: String(billId) });
    linked++;
  }
  return linked;
}

async function listTimeEntries(env, url) {
  const woId = url.searchParams.get('wo_id') || '', vendorId = url.searchParams.get('vendor_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  try {
    const rows = await fetchTab(env, 'Time_Entries');
    let results = rows.filter(r => r.WO_ID === woId && r.Active !== 'FALSE');
    if (vendorId) results = results.filter(r => r.Role === 'vendor' && r.Entered_By_ID === vendorId);

    // Hours rolled into a vendor bill are already being charged as that bill's labour.
    // Say so, so the billing panel doesn't add them a second time on top. A VOIDED bill
    // releases them again — otherwise voiding a mistake would strand the time forever.
    let live = null;
    try {
      const bills = await fetchTab(env, 'Vendor_Bills');
      live = new Set(bills.filter(b => b.Active !== 'FALSE').map(b => String(b.ID)));
    } catch (e) { live = null; }
    results = results.map(r => {
      const billId = String(r.Bill_ID || '').trim();
      return Object.assign({}, r, {
        // null (couldn't read the bills) is deliberately different from '' (read them, not
        // billed) — the panel must not treat "don't know" as "safe to charge again".
        Billed_Bill_ID: live === null ? null : (billId && live.has(billId) ? billId : ''),
      });
    });

    return json(results.sort((a, b) => new Date(a.Created_Date) - new Date(b.Created_Date)));
  } catch(e) { return json([]); }
}

// GET /receipts-billed?wo_id=  — receipt ids already committed to an approved invoice on
// this job. A receipt can be charged to the owner exactly once, and two vendors' bills on
// one job means two invoices that would otherwise each pick up the same materials. Panel
// heuristics only work while both panels happen to be open; this survives reloads.
async function listBilledReceipts(env, url) {
  const woId = url.searchParams.get('wo_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  try {
    const irs = await fetchTab(env, 'Invoice_Review');
    const billed = {};
    irs.filter(r => r.Active !== 'FALSE' && String(r.WO_ID) === String(woId)).forEach(r => {
      String(r.Own_Material_IDs || '').split(',').map(x => x.trim()).filter(Boolean)
        .forEach(id => { billed[id] = String(r.ID); });
    });
    return json({ ok: true, wo_id: woId, billed });
  } catch (e) { return json({ ok: false, error: e.message, billed: {} }); }
}

async function listReceipts(env, url) {
  const woId = url.searchParams.get('wo_id') || '', vendorId = url.searchParams.get('vendor_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  try {
    const rows = await fetchTab(env, 'Receipts');
    let results = rows.filter(r => r.WO_ID === woId && r.Active !== 'FALSE');
    if (vendorId) results = results.filter(r => r.Role === 'vendor' && r.Added_By_ID === vendorId);
    return json(results.sort((a,b) => new Date(a.Created_Date)-new Date(b.Created_Date)));
  } catch(e) { return json([]); }
}

async function addReceipt(env, body) {
  const { wo_id, amount, description, store, date, added_by, added_by_id, role } = body;
  if (!wo_id)  return json({ error: 'wo_id required' }, 400);
  if (!amount) return json({ error: 'amount required' }, 400);
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return json({ error: 'amount must be a positive number' }, 400);

  // Same receipt, same job, same store, seconds apart = a double-tap, not two purchases.
  // Added_By_ID and Date are in the signature and the window is short, because two small
  // identical purchases on one job (two of the same fitting from the same run) is a real
  // thing and must not be swallowed.
  const dupe = await findRecentDuplicate(env, 'Receipts', {
    WO_ID: wo_id, Amount: amt.toFixed(2), Store: store || '', Description: description || '',
    Added_By_ID: String(added_by_id || ''), Date: date || new Date().toISOString().split('T')[0],
  }, 30);
  if (dupe) return json({ success: true, duplicate: true, amount: amt.toFixed(2) });

  await addRow(env, 'Receipts', { WO_ID: wo_id, Amount: amt.toFixed(2), Description: description||'', Store: store||'', Date: date||new Date().toISOString().split('T')[0], Added_By: added_by||'', Added_By_ID: String(added_by_id||''), Role: role||'hub', Created_Date: new Date().toISOString(), Active: 'TRUE' });
  return json({ success: true, amount: amt.toFixed(2) });
}

// Brett's default hourly rate for his own (hub) time when a customer has no specific rate on
// the Owners tab. Per-customer overrides live in Owners.Hourly_Rate (blank = this default).
const DEFAULT_HUB_RATE = 85;

// Resolve the hourly rate for Brett's own time on a job: the owner's Owners.Hourly_Rate if
// they have one set, otherwise DEFAULT_HUB_RATE. Follows WO → Property → Owner, the same
// chain the invoice path uses. Falls back to the default on any read miss rather than
// billing $0 (a missing rate must never silently zero out the time).
async function resolveHubHourlyRate(env, woId) {
  try {
    const [wos, props, owners] = await fetchTabs(env, ['Work_Orders', 'Properties', 'Owners']);
    const wo = findWO(wos, woId);
    if (!wo) return DEFAULT_HUB_RATE;
    const prop = props.find(p => p.ID === wo.Property_ID);
    const owner = prop ? owners.find(o => o.ID === prop.Owner_ID) : null;
    const r = owner ? parseFloat(owner.Hourly_Rate || 0) : 0;
    return r > 0 ? r : DEFAULT_HUB_RATE;
  } catch (e) {
    return DEFAULT_HUB_RATE;
  }
}

async function addTimeEntry(env, body) {
  const { wo_id, entered_by, entered_by_id, role, entry_type, start_datetime, end_datetime, duration_minutes_raw, notes, billable, hourly_rate } = body;
  if (!wo_id) return json({ error: 'wo_id required' }, 400);
  if (!role)  return json({ error: 'role required (hub or vendor)' }, 400);
  let durationMinutes = 0;
  if (start_datetime && end_datetime) { durationMinutes = roundUpTo15((new Date(end_datetime) - new Date(start_datetime)) / 60000); }
  else if (duration_minutes_raw) { durationMinutes = roundUpTo15(parseFloat(duration_minutes_raw) || 0); }
  if (durationMinutes <= 0) return json({ error: 'Could not calculate duration' }, 400);
  let rate = parseFloat(hourly_rate || 0);
  // Brett's own (hub) time bills at a per-customer rate. When the Hub sends no explicit rate,
  // resolve it from the job's owner (Owners.Hourly_Rate, else the default). Vendor entries
  // always carry their own rate and are left untouched.
  if (role === 'hub' && !(rate > 0)) {
    rate = await resolveHubHourlyRate(env, wo_id);
  }
  const billableAmt = (billable === 'TRUE' || billable === true) ? (durationMinutes / 60) * rate : 0;

  // Same worker, same job, same block of time, seconds apart = a double-tap on Log Time.
  // Notes and Entry_Type are part of the signature on purpose: on the quick-duration path
  // there are no start/end times, so without them the signature collapses to
  // job + person + minutes — and logging two genuine 30-minute blocks back to back is
  // exactly what those quick buttons are for. The window is deliberately short for the
  // same reason: catching up on a day's entries in one sitting must not eat any of them.
  const dupe = await findRecentDuplicate(env, 'Time_Entries', {
    WO_ID: wo_id, Entered_By_ID: String(entered_by_id||''), Duration_Minutes: String(durationMinutes),
    Start_DateTime: start_datetime || '', End_DateTime: end_datetime || '',
    Notes: notes || '', Entry_Type: entry_type || (role === 'hub' ? 'Admin' : 'Labor'),
  }, 30);
  if (dupe) return json({ success: true, duplicate: true, duration_minutes: durationMinutes });

  await addRow(env, 'Time_Entries', { WO_ID: wo_id, Entered_By: entered_by||'', Entered_By_ID: String(entered_by_id||''), Role: role, Entry_Type: entry_type || (role === 'hub' ? 'Admin' : 'Labor'), Start_DateTime: start_datetime||'', End_DateTime: end_datetime||'', Duration_Minutes: String(durationMinutes), Notes: notes||'', Billable: role === 'hub' ? String(billable === 'TRUE' || billable === true) : 'TRUE', Hourly_Rate: String(rate), Billable_Amount: String(billableAmt.toFixed(2)), Created_Date: new Date().toISOString(), Active: 'TRUE' });
  return json({ success: true, duration_minutes: durationMinutes, hourly_rate: rate });
}

async function listWOTenants(env, url) {
  const woId = url.searchParams.get('wo_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  try { const rows = await fetchTab(env, 'WO_Tenants'); return json(rows.filter(r => r.WO_ID === woId && r.Active !== 'FALSE')); }
  catch(e) { return json([]); }
}

async function addTenantToWO(env, body) {
  const { wo_id, tenant_id, added_by } = body;
  if (!wo_id || !tenant_id) return json({ error: 'wo_id and tenant_id required' }, 400);
  const tenants = await fetchTab(env, 'Tenants');
  const tenant = tenants.find(t => t.ID === tenant_id);
  if (!tenant) return json({ error: 'Tenant not found' }, 404);
  try { const existing = await fetchTab(env, 'WO_Tenants'); const already = existing.find(r => r.WO_ID === wo_id && r.Tenant_ID === tenant_id && r.Active !== 'FALSE'); if (already) return json({ success: true, id: already.ID, already_linked: true }); } catch(e) {}
  await addRow(env, 'WO_Tenants', { WO_ID: wo_id, Tenant_ID: tenant_id, Tenant_Name: ((tenant.First_Name||'')+' '+(tenant.Last_Name||'')).trim(), Tenant_Phone: tenant.Phone||'', Added_By: added_by||'system', Added_Date: new Date().toISOString(), Active: 'TRUE' });
  return json({ success: true });
}

async function removeTenantFromWO(env, body) {
  const { wo_id, tenant_id } = body;
  if (!wo_id || !tenant_id) return json({ error: 'wo_id and tenant_id required' }, 400);
  try { const rows = await fetchTab(env, 'WO_Tenants'); const row = rows.find(r => r.WO_ID === wo_id && r.Tenant_ID === tenant_id && r.Active !== 'FALSE'); if (!row) return json({ success: true, not_found: true }); await updateRow(env, 'WO_Tenants', row.ID, { Active: 'FALSE' }); return json({ success: true }); }
  catch(e) { return json({ error: e.message }, 500); }
}

async function processMoveOut(env, body) {
  const { tenant_id, move_out_date } = body;
  if (!tenant_id) return json({ error: 'tenant_id required' }, 400);
  const moveOutDate = move_out_date || new Date().toISOString().split('T')[0];
  const moveOutDt = new Date(moveOutDate + 'T23:59:59');

  // The tenant's own row is left intact on purpose — same ID, same Unit_ID and
  // Property_ID, now carrying a move-out date. That row IS the history: their work
  // orders, their contact record, everything logged while they lived there stays
  // attached to it. A new tenant gets a new row and a new ID; nothing is reused.
  await updateRow(env, 'Tenants', tenant_id, { Active: 'FALSE', Move_Out_Date: moveOutDate, PIN: '' });

  // What DOES have to change is the unit's pointer to its CURRENT tenant. Move-out
  // never cleared it, so the unit went on naming someone who had left — and because
  // vendor dispatch reads the unit's tenant, vendors were being texted a former
  // tenant's name and phone number when they took a new job at that address.
  let unitsCleared = [], unitsFailed = false;
  try {
    const units = await fetchTab(env, 'Units');
    for (const u of units.filter(x => String(x.Tenant_ID || '') === String(tenant_id))) {
      await updateRow(env, 'Units', u.ID, { Tenant_ID: '' });
      unitsCleared.push(u.Unit_Label || u.ID);
    }
  } catch (e) { unitsFailed = true; }

  let retroCount = 0;
  try {
    const [wos, woTenants] = await fetchTabs(env, ['Work_Orders','WO_Tenants']);
    for (const link of woTenants.filter(r => r.Tenant_ID === tenant_id && r.Active !== 'FALSE')) {
      const wo = wos.find(w => w.ID === link.WO_ID);
      if (!wo || !wo.Created_Date) continue;
      if (new Date(wo.Created_Date) > moveOutDt) { await updateRow(env, 'WO_Tenants', link.ID, { Active: 'FALSE' }); retroCount++; }
    }
  } catch(e) {}
  return json({ success: true, move_out_date: moveOutDate, retro_wos_cleaned: retroCount,
                units_unlinked: unitsCleared.length, units: unitsCleared,
                // Say so loudly. A half-cleared pointer means a former tenant's number is
                // still reachable, which is the whole thing this is meant to prevent.
                units_incomplete: unitsFailed,
                warning: unitsFailed ? 'Some unit links could not be cleared — run "Check units naming moved-out tenants" in Dev tools.' : '' });
}

async function createWorkOrder(env, body) {
  const data = await sheetsRequest(env, 'GET', `/values/Work_Orders`);
  const rows = data.values || [];
  if (!rows.length) throw new Error('Work_Orders tab has no headers');
  const headers = rows[0];
  // The WO number lives in the "ID" column, which is NOT column 0 — column 0 is
  // Vendor_Needs_Access (blank/"auto"). Reading r[0] found no numbers at all, so
  // every new WO restarted at WO-1001 and collided with itself. Resolve by header.
  const idCol = headers.indexOf('ID');
  if (idCol === -1) throw new Error('Work_Orders tab has no ID column');
  let nextWONum = 1001;
  if (rows.length > 1) {
    const existingNums = rows.slice(1).map(r => parseInt(String(r[idCol]||'').replace(/\D/g,'')) || 0).filter(n => Number.isFinite(n) && n > 0);
    if (existingNums.length > 0) nextWONum = Math.max(...existingNums) + 1;
  }
  const woId = `WO-${nextWONum}`, now = new Date().toISOString();
  const newRow = headers.map(h => ({ ID: woId, Property_ID: body.property_id||'', Unit_ID: body.unit_id||'', Tenant_ID: body.tenant_id||'', Vendor_ID: '', Type: body.type||'manual', Trade: body.trade||'', Description: body.description||'', Priority: body.priority||'normal', Status: 'New', Scheduled_Date: '', Scheduled_Window: '', Completed_Date: '', Invoice_ID: '', Owner_WO_Ref: body.owner_wo_ref||'', WO_Contact_Name: body.wo_contact_name||'', WO_Contact_Phone: body.wo_contact_phone||'', Tenant_Visible: body.tenant_visible !== false && body.tenant_visible !== 'FALSE' ? 'TRUE' : 'FALSE', Tenant_Notify_Created: body.tenant_notify_created !== false && body.tenant_notify_created !== 'FALSE' ? 'TRUE' : 'FALSE', Tenant_Notify_Updates: body.tenant_notify_updates !== false && body.tenant_notify_updates !== 'FALSE' ? 'TRUE' : 'FALSE', Vendor_SMS_Sent: 'FALSE', Tenant_SMS_Sent: 'FALSE', Owner_Notified: 'FALSE', Created_By: body.created_by||'admin', Created_Date: now, Notes: body.notes||'', Vendor_Needs_Access: body.vendor_needs_access||'auto' }[h] ?? ''));
  await sheetsRequest(env, 'POST', `/values/Work_Orders:append?valueInputOption=RAW`, { values: [newRow] });
  try {
    const tenants = await fetchTab(env, 'Tenants');
    const activeTenants = tenants.filter(t => { if (t.Active === 'FALSE') return false; if (body.unit_id) return t.Unit_ID === body.unit_id; if (body.property_id) return !t.Unit_ID && String(t.Property_ID) === String(body.property_id); return false; });
    const allTenantIds = new Set([...activeTenants.map(t => t.ID), ...(Array.isArray(body.tenant_ids) ? body.tenant_ids : [])]);
    for (const tid of allTenantIds) {
      const t = tenants.find(x => x.ID === tid); if (!t) continue;
      await addRow(env, 'WO_Tenants', { WO_ID: woId, Tenant_ID: tid, Tenant_Name: ((t.First_Name||'')+' '+(t.Last_Name||'')).trim(), Tenant_Phone: t.Phone||'', Added_By: 'system-auto', Added_Date: now, Active: 'TRUE' });
    }
  } catch(e) {}
  try { await logTelemetry(env, { Source:'worker', Job_Type:'wo_create', Skill_Or_Endpoint:'/workorder', Success:'TRUE', Notes:`trade=${body.trade||''} type=${body.type||'manual'}` }); } catch(_){}
  return json({ success: true, id: woId });
}

async function appendWONotes(env, body) {
  const workorders = await fetchTab(env, 'Work_Orders');
  const wo = findWO(workorders, body.wo_id);
  if (!wo) return json({ error: 'WO not found' }, 404);
  const ts = new Date().toLocaleString('en-US', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  const prefix = body.author ? `[${ts} — ${body.author}] ` : `[${ts}] `;
  await updateWOFields(env, body.wo_id, { Notes: wo.Notes ? `${wo.Notes}\n${prefix}${body.note}` : `${prefix}${body.note}` });
  return json({ success: true });
}
async function assignVendor(env, body) {
  const [workorders, vendors, tenants, units, properties, keys] = await fetchTabs(env, [
    'Work_Orders','Vendors','Tenants','Units','Properties','Keys',
  ]);
  const wo = findWO(workorders, body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  const vendor = vendors.find(v => v.ID === body.vendor_id); if (!vendor) return json({ error: 'Vendor not found' }, 404);
  const property = properties.find(p => p.ID === wo.Property_ID);
  const unit     = units.find(u => u.ID === wo.Unit_ID);
  const tenant   = currentTenantForDispatch(tenants, unit, wo);
  const address  = property ? `${property.Address}${unit ? ' Unit '+unit.Unit_Label : ''}` : 'the property';
  let accessInfo = '';
  const lockboxes = getWOLockboxes(keys, wo.Property_ID, wo.Unit_ID);
  if (lockboxes.length) {
    accessInfo = ' ' + lockboxes.map(lb => `Lockbox${lb.location ? ' ('+lb.location+')' : ''}: ${lb.code}`).join('. ') + '.';
  } else {
    if (property?.Lockbox_Code) accessInfo += ` Lockbox: ${property.Lockbox_Code}.`;
    if (property?.Lock_Code)    accessInfo += ` Door code: ${property.Lock_Code}.`;
  }
  if (property?.Access_Notes) accessInfo += ` ${property.Access_Notes}.`;
  let vendorSMSSent = false, tenantSMSSent = false;
  if (vendor.Phone) {
    const isSpanish = vendor.Language === 'es';
    const tenantLine   = tenant ? ` Tenant: ${tenant.First_Name} ${tenant.Last_Name||''} ${tenant.Phone}.` : '';
    const tenantLineES = tenant ? ` Inquilino: ${tenant.First_Name} ${tenant.Last_Name||''} ${tenant.Phone}.` : '';
    const msg = isSpanish
      ? `[${body.wo_id}] Nuevo trabajo: ${wo.Trade} en ${address}. Problema: ${wo.Description}.${tenantLineES}${accessInfo} Responda SI para aceptar o NO para rechazar.`
      : `[${body.wo_id}] New job: ${wo.Trade} at ${address}. Issue: ${wo.Description}.${tenantLine}${accessInfo} Reply YES to accept or NO to decline.`;
    await sendSMS(env, vendor.Phone, msg);
    await logSMS(env, body.wo_id, 'vendor', vendor.ID, vendor.Phone, msg);
    vendorSMSSent = true;
  }
  if (tenant?.Phone && isTenantNotifiable(tenant, wo)) {
    const msg = `Hi ${tenant.First_Name}, your maintenance request (${wo.Trade}) has been assigned to a technician. They will contact you to schedule. Ref: ${body.wo_id}.`;
    await sendSMS(env, tenant.Phone, msg);
    await logSMS(env, body.wo_id, 'tenant', tenant.ID, tenant.Phone, msg);
    tenantSMSSent = true;
  }
  await updateWOFields(env, body.wo_id, { Vendor_ID: body.vendor_id, Status: 'Assigned', Vendor_SMS_Sent: vendorSMSSent ? 'TRUE' : 'FALSE', Tenant_SMS_Sent: tenantSMSSent ? 'TRUE' : 'FALSE' });
  try { await logTelemetry(env, { Source:'worker', Job_Type:'wo_assign', Skill_Or_Endpoint:'/assign', Success:'TRUE', Notes:`trade=${wo.Trade||''} vendor_sms=${vendorSMSSent} tenant_sms=${tenantSMSSent}` }); } catch(_){}
  return json({ success: true, vendor_sms: vendorSMSSent, tenant_sms: tenantSMSSent });
}

async function updateStatus(env, body) {
  const workorders = await fetchTab(env, 'Work_Orders');
  const wo = findWO(workorders, body.wo_id);
  if (!wo) return json({ error: 'WO not found' }, 404);
  const changedBy = body.updated_by || 'system', changedRole = body.updated_by_role || 'admin';
  const fields = { Status: body.status };
  if (body.notes) {
    let statusNote = body.notes;
    if (body.vendor_id) {
      const sVendors = await fetchTab(env, 'Vendors');
      const sVendor = sVendors.find(v => v.ID === body.vendor_id);
      if (sVendor?.Language === 'es') { const en = await translateToEnglish(env, statusNote); if (en && en !== statusNote) statusNote = `[ES] ${statusNote}\n[EN] ${en}`; }
    }
    fields.Notes = statusNote;
  }
  if (body.scheduled_date) fields.Scheduled_Date = body.scheduled_date;
  if (body.status === 'Complete' || body.status === 'Pending Invoice')
    fields.Completed_Date = wo.Completed_Date || new Date().toISOString();
  await updateWOFields(env, body.wo_id, fields);
  await logWOAudit(env, body.wo_id, changedBy, changedRole, 'Status', wo.Status||'', body.status, body.notes||'');
  const config = await fetchConfig(env);
  if (body.status === 'Complete') {
    const [units, tenants, properties] = await fetchTabs(env, ['Units','Tenants','Properties']);
    const unit = units.find(u => u.ID === wo.Unit_ID), tenant = tenants.find(t => t.ID === (unit?.Tenant_ID || wo.Tenant_ID)), property = properties.find(p => p.ID === wo.Property_ID);
    const address = property ? property.Address + (unit ? ' Unit '+unit.Unit_Label : '') : 'your unit';
    if (isTenantNotifiable(tenant, wo) && wo.Tenant_Notify_Updates !== 'FALSE') {
      const msg = `Hi ${tenant.First_Name}, your ${wo.Trade} repair at ${address} is complete. If you have any concerns please reply or call us. Ref: ${body.wo_id}.`;
      await sendSMS(env, tenant.Phone, msg); await logSMS(env, body.wo_id, 'tenant_complete', tenant.ID, tenant.Phone, msg);
    }
    if (config.admin_phone) await sendSMS(env, config.admin_phone, `✅ ${body.wo_id} marked Complete${body.updated_by ? ' (by '+body.updated_by+')' : ''}. ${wo.Trade} @ ${wo.Property_ID}. Pending invoice.`);
    await updateWOFields(env, body.wo_id, { Owner_Notified: 'PENDING' });
  }
  const notifyStatuses = ['Assigned','Scheduled','Complete','Invoiced'];
  if (notifyStatuses.includes(body.status)) {
    const notify = await shouldNotifyOwner(env, wo, body.status);
    if (notify) {
      const [properties, owners] = await fetchTabs(env, ['Properties','Owners']);
      const property = properties.find(p => p.ID === wo.Property_ID), owner = property ? owners.find(o => o.ID === property.Owner_ID) : null;
      if (owner?.Phone) {
        const statusMsgs = { Assigned: `Hi ${owner.First_Name}, a technician has been assigned to the ${wo.Trade} job at ${property.Address}. Ref: ${body.wo_id}.`, Scheduled: `Hi ${owner.First_Name}, the ${wo.Trade} job at ${property.Address} has been scheduled. Ref: ${body.wo_id}.`, Complete: `Hi ${owner.First_Name}, the ${wo.Trade} work at ${property.Address} is complete. An invoice will follow. Ref: ${body.wo_id}.`, Invoiced: `Hi ${owner.First_Name}, an invoice has been submitted for ${wo.Trade} at ${property.Address}. Ref: ${body.wo_id}. Contact us with any questions.` };
        const msg = statusMsgs[body.status];
        if (msg) { await sendSMS(env, owner.Phone, msg); await logSMS(env, body.wo_id, `owner_${body.status.toLowerCase()}`, owner.ID, owner.Phone, msg); await updateWOFields(env, body.wo_id, { Owner_Notified: 'TRUE' }); }
      }
    }
  }
  try { await logTelemetry(env, { Source:'worker', Job_Type:'wo_status', Skill_Or_Endpoint:'/status', Success:'TRUE', Notes:`status=${body.status||''}` }); } catch(_){}
  return json({ success: true });
}

async function createInvoice(env, body) {
  const data = await sheetsRequest(env, 'GET', `/values/Invoices`);
  const rows = data.values || [[]], headers = rows[0], invoiceId = String(nextSafeId(rows)), now = new Date().toISOString().split('T')[0];
  const newRow = headers.map(h => ({ ID: invoiceId, WO_ID: body.wo_id||'', Vendor_ID: body.vendor_id||'', Amount: body.amount||'', Date_Submitted: now, Date_Paid: '', Status: 'Submitted', QB_Ref: body.qb_ref||'', Notes: body.notes||'' }[h] ?? ''));
  await sheetsRequest(env, 'POST', `/values/Invoices:append?valueInputOption=RAW`, { values: [newRow] });
  await updateStatus(env, { wo_id: body.wo_id, status: 'Invoiced' });
  await updateWOFields(env, body.wo_id, { Invoice_ID: invoiceId });
  return json({ success: true, id: invoiceId });
}

// ── PORTAL VIEWS ─────────────────────────────────────────────

async function vendorWorkorders(env, url) {
  const vendorId = url.searchParams.get('vendor_id');
  if (!vendorId) return json({ error: 'Missing vendor_id' }, 400);
  const includeClosed = url.searchParams.get('include_closed') === 'true';
  const [[workorders, properties, units, tenants, keys], config] = await Promise.all([
    fetchTabs(env, ['Work_Orders','Properties','Units','Tenants','Keys']),
    fetchConfig(env),
  ]);
  let tradeAccessDefaults = {};
  try { tradeAccessDefaults = JSON.parse(config.Access_Trade_Defaults || '{}'); } catch(e) {}
  const wos = workorders.filter(w => w.Vendor_ID === vendorId && (includeClosed || OPEN_WO_STATUSES.includes(w.Status)));
  const enriched = wos.map(wo => enrichWO(wo, properties, units, tenants, keys, { tradeAccessDefaults }));
  enriched.sort((a, b) => { const pa = PRIORITY_ORDER[a.Priority?.toLowerCase()] ?? 2, pb = PRIORITY_ORDER[b.Priority?.toLowerCase()] ?? 2; return pa !== pb ? pa - pb : (a.property_address||'').localeCompare(b.property_address||''); });
  return json(enriched);
}

async function tenantWorkorders(env, url) {
  const tenantId = url.searchParams.get('tenant_id');
  if (!tenantId) return json({ error: 'Missing tenant_id' }, 400);
  const includeClosed = url.searchParams.get('include_closed') === 'true';
  const [workorders, properties, units, tenants, keys] = await fetchTabs(env, ['Work_Orders','Properties','Units','Tenants','Keys']);
  const tenant = tenants.find(t => t.ID === tenantId); if (!tenant) return json([]);
  const wos = workorders.filter(w => { if (w.Tenant_Visible === 'FALSE') return false; if (!includeClosed && !OPEN_WO_STATUSES.includes(w.Status)) return false; if (w.Property_ID !== tenant.Property_ID) return false; if (tenant.Unit_ID) return w.Unit_ID === tenant.Unit_ID || w.Tenant_ID === tenantId; return true; });
  const enriched = wos.map(wo => enrichWO(wo, properties, units, tenants, keys, { omitLockbox: true, tenantView: true }));
  enriched.sort((a, b) => new Date(b.Created_Date) - new Date(a.Created_Date));
  return json(enriched);
}

async function ownerWorkorders(env, url) {
  const ownerId = url.searchParams.get('owner_id');
  if (!ownerId) return json({ error: 'Missing owner_id' }, 400);
  const includeClosed = url.searchParams.get('include_closed') === 'true';
  const [workorders, properties, units, tenants, keys] = await fetchTabs(env, ['Work_Orders','Properties','Units','Tenants','Keys']);
  const ownerPropIds = new Set(properties.filter(p => p.Owner_ID === ownerId).map(p => p.ID));
  const wos = workorders.filter(w => ownerPropIds.has(w.Property_ID) && (includeClosed || OPEN_WO_STATUSES.includes(w.Status)));
  const enriched = wos.map(wo => enrichWO(wo, properties, units, tenants, keys, { omitLockbox: true, omitTenantPhone: true, ownerView: true }));
  enriched.sort((a, b) => new Date(b.Created_Date) - new Date(a.Created_Date));
  return json(enriched);
}

function enrichWO(wo, properties, units, tenants, keys, opts={}, masterKeys=[]) {
  const property = properties.find(p => p.ID === wo.Property_ID) || {};
  const unit     = units.find(u => u.ID === wo.Unit_ID) || {};
  let tenant = {};
  const tenantId = wo.Tenant_ID || unit.Tenant_ID;
  if (tenantId) tenant = tenants.find(t => t.ID === tenantId) || {};
  if (!tenant.ID && wo.Unit_ID)       tenant = tenants.find(t => t.Unit_ID === wo.Unit_ID && t.Active !== 'FALSE') || {};
  if (!tenant.ID && wo.Property_ID && !wo.Unit_ID) tenant = tenants.find(t => t.Property_ID === wo.Property_ID && !t.Unit_ID && t.Active !== 'FALSE') || {};

  // Work orders keep their original Tenant_ID forever — that IS the history, and clearing
  // it would destroy the record of who reported what. But a work order raised while
  // someone lived here does not entitle a vendor to their phone number today. The unit
  // pointer being cleaned on move-out cannot help here, because this reads wo.Tenant_ID
  // first. So the person's number is withheld once they've gone, while the name stays for
  // the Hub's own records.
  const tenantIsFormer = !!tenant.ID && !isTenantCurrent(tenant);
  const tradeDefaults = opts.tradeAccessDefaults || {};
  const woAccess = (wo.Vendor_Needs_Access || 'auto').trim();
  let vendorHasAccess;
  if (woAccess === 'TRUE')  vendorHasAccess = true;
  else if (woAccess === 'FALSE') vendorHasAccess = false;
  else {
    const trade = (wo.Trade || '').trim();
    // Check the raw spelling AND the resolved one. A default saved under "Electric" must
    // keep applying now that the trade resolves to "Electrical" — an unmatched lookup
    // yields undefined, and `undefined !== 'FALSE'` GRANTS access. A rename must never
    // quietly turn a no-access trade into an access-granted one.
    const resolvedName = resolveTrade(trade).name;
    let tradeDefault = tradeDefaults[trade];
    if (tradeDefault === undefined) tradeDefault = tradeDefaults[resolvedName];
    if (tradeDefault === undefined) {
      // Resolve the CONFIG KEYS too, not just the work order's trade. His access rules were
      // saved through a dropdown that only offered "Electric", so the keys are the old
      // spelling while new work orders say "Electrical" — and an unmatched lookup GRANTS
      // access. A rule he set to no-access must not be silently ignored because the
      // vocabulary moved underneath it.
      const key = Object.keys(tradeDefaults).find(kk => resolveTrade(kk).name === resolvedName);
      if (key !== undefined) tradeDefault = tradeDefaults[key];
    }
    vendorHasAccess = tradeDefault !== 'FALSE';
  }
  const rawLockboxes = getWOLockboxes(keys, wo.Property_ID, wo.Unit_ID, unit.Unit_Label||'');
  const lockboxes = (opts.omitLockbox || !vendorHasAccess) ? [] : rawLockboxes;
  const accessNotes = (!vendorHasAccess) ? '' : (property.Access_Notes||'');
  const legacyLockbox = (!lockboxes.length && vendorHasAccess && property.Lockbox_Code) ? property.Lockbox_Code : '';
  const base = {
    ...wo,
    property_address: property.Address||'', property_city: property.City||'', unit_label: unit.Unit_Label||'',
    tenant_name:  wo.WO_Contact_Name || (tenant.First_Name ? `${tenant.First_Name} ${tenant.Last_Name||''}`.trim() : ''),
    // A named WO contact is a deliberate override and stands on its own; the TENANT's
    // number is what gets withheld once they've moved out.
    tenant_phone: opts.omitTenantPhone ? '' : (wo.WO_Contact_Phone || (tenantIsFormer ? '' : (tenant.Phone||''))),
    tenant_former: tenantIsFormer,
    tenant_record_name:  tenant.First_Name ? `${tenant.First_Name} ${tenant.Last_Name||''}`.trim() : '',
    tenant_record_phone: (opts.omitTenantPhone || tenantIsFormer) ? '' : (tenant.Phone||''),
    lockboxes,
    legacy_lockbox: legacyLockbox,
    access_notes: accessNotes,
    vendor_has_access: vendorHasAccess,
  };
  if (opts.tenantView) { delete base.access_notes; delete base.legacy_lockbox; base.lockboxes = []; base.vendor_phone = ''; }
  if (opts.ownerView)  { delete base.Invoice_ID; base.Display_Status = base.Status === 'Pending Invoice' ? 'Complete' : base.Status; }
  return base;
}

async function getPropertyFull(env, url) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);
  const [props, units, tenants, keys] = await fetchTabs(env, ['Properties','Units','Tenants','Keys']);
  const property = props.find(p => p.ID === id);
  if (!property) return json({ error: 'Property not found' }, 404);
  const propUnits = units.filter(u => u.Property_ID === id).map(unit => ({ ...unit, tenant: tenants.find(t => t.ID === unit.Tenant_ID)||null, keys: keys.filter(k => k.Unit_ID === unit.ID && k.Active !== 'FALSE') }));
  return json({ ...property, units: propUnits, keys: keys.filter(k => k.Property_ID === id && !k.Unit_ID && k.Active !== 'FALSE') });
}

async function getBuildingInfo(env, url) {
  const propId = url.searchParams.get('property_id'), unitId = url.searchParams.get('unit_id') || '';
  if (!propId) return json({ error: 'Missing property_id' }, 400);
  const [properties, units] = await fetchTabs(env, ['Properties','Units']);
  const prop = properties.find(p => p.ID === propId);
  if (!prop) return json({ error: 'Property not found' }, 404);
  return json({ property: prop, unit: unitId ? (units.find(u => u.ID === unitId)||null) : null, units: units.filter(u => u.Property_ID === propId) });
}

async function saveBuildingInfo(env, body) {
  const { type, id, fields, bulk_unit_ids } = body; const results = [];
  if (type === 'property') { results.push({ id, result: await updateRow(env, 'Properties', id, fields) }); }
  else if (type === 'unit') { results.push({ id, result: await updateRow(env, 'Units', id, fields) }); for (const uid of (bulk_unit_ids||[])) { if (uid !== id) results.push({ id: uid, result: await updateRow(env, 'Units', uid, fields) }); } }
  return json({ success: true, results });
}

async function ownerProperties(env, url) {
  const ownerId = url.searchParams.get('owner_id');
  if (!ownerId) return json({ error: 'Missing owner_id' }, 400);
  const [properties, units] = await fetchTabs(env, ['Properties','Units']);
  return json(properties.filter(p => p.Owner_ID === ownerId && p.Active !== 'FALSE').map(p => ({ ...p, units: units.filter(u => u.Property_ID === p.ID) })));
}

async function saveCacheEntry(env, body) {
  const data = await sheetsRequest(env, 'GET', `/values/Troubleshooting_Cache`);
  const rows = data.values || []; if (!rows.length) throw new Error('Troubleshooting_Cache tab missing headers');
  const headers = rows[0], now = new Date().toISOString().split('T')[0];
  const existing = rows.slice(1).find(r => { const obj={}; headers.forEach((h,i) => obj[h]=r[i]||''); return obj.Trade === body.trade && obj.Keywords === body.keywords; });
  if (existing) return await updateRow(env, 'Troubleshooting_Cache', existing[0], { Response: body.response, Use_Count: String(parseInt(existing[headers.indexOf('Use_Count')]||'0') + 1), Last_Used: now, Flagged: 'FALSE' });
  const newRow = headers.map(h => ({ ID: String(nextSafeId(rows)), Trade: body.trade||'', Keywords: body.keywords||'', Season: body.season||'', Property_Type: body.property_type||'', Response: body.response||'', Use_Count: '1', Created_Date: now, Last_Used: now, Flagged: 'FALSE', Flag_Reason: '', Flag_Date: '', Last_Refreshed: '', Active: 'TRUE' }[h] ?? ''));
  await sheetsRequest(env, 'POST', `/values/Troubleshooting_Cache:append?valueInputOption=RAW`, { values: [newRow] });
  return json({ success: true });
}
async function flagCacheEntry(env, body) { return await updateRow(env, 'Troubleshooting_Cache', body.id, { Flagged: 'TRUE', Flag_Reason: body.reason||'', Flag_Date: new Date().toISOString().split('T')[0] }); }
async function refreshCacheEntry(env, body) { return await updateRow(env, 'Troubleshooting_Cache', body.id, { Response: '', Flagged: 'FALSE', Flag_Reason: '', Last_Refreshed: new Date().toISOString().split('T')[0] }); }
// ── PIN GENERATION & SEND ─────────────────────────────────────

const PORTAL_BASE = 'https://ridge-co.github.io/RidgeCo';

function generatePIN(phone) {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = [0,1,2].map(() => alpha[Math.floor(Math.random() * alpha.length)]).join('');
  const digits = (phone || '').replace(/\D/g, '').slice(-5).padStart(5, '0');
  return prefix + digits;
}

async function regeneratePIN(env, body) {
  const { type, id, send } = body;
  if (!type || !id) return json({ error: 'Missing type or id' }, 400);
  let tab, phoneField;
  if (type === 'vendor') { tab = 'Vendors'; phoneField = 'Phone'; }
  else if (type === 'owner_user') { tab = 'Owner_Users'; phoneField = 'Phone'; }
  else if (type === 'tenant') { tab = 'Tenants'; phoneField = 'Phone'; }
  else return json({ error: 'type must be vendor, owner_user, or tenant' }, 400);
  const rows = await fetchTab(env, tab);
  const record = rows.find(r => r.ID === id);
  if (!record) return json({ error: `${type} not found` }, 404);
  if (!record[phoneField]) return json({ error: 'Phone number required to generate PIN' }, 400);
  const newPIN = generatePIN(record[phoneField]);
  await updateRow(env, tab, id, { PIN: newPIN });
  if (send) { const sendResult = await sendPinMessage(env, { type, id }); return json({ success: true, pin: newPIN, sms_sent: !!sendResult }); }
  return json({ success: true, pin: newPIN });
}

async function sendPinMessage(env, body) {
  const { type, id } = body;
  if (!type || !id) return json({ error: 'Missing type or id' }, 400);
  let firstName, phone, pin;
  if (type === 'tenant') {
    const tenants = await fetchTab(env, 'Tenants'); const t = tenants.find(r => r.ID === id);
    if (!t) return json({ error: 'Tenant not found' }, 404);
    if (!t.Phone) return json({ error: 'No phone number on file', name: t.First_Name||'' }, 400);
    if (!t.PIN)   return json({ error: 'No PIN set — set a PIN first', name: t.First_Name||'' }, 400);
    firstName = t.First_Name||'Resident'; phone = t.Phone; pin = t.PIN;
  } else if (type === 'vendor') {
    const vendors = await fetchTab(env, 'Vendors'); const v = vendors.find(r => r.ID === id);
    if (!v) return json({ error: 'Vendor not found' }, 404);
    if (!v.Phone) return json({ error: 'No phone number on file', name: v.Name||'' }, 400);
    if (!v.PIN)   return json({ error: 'No PIN set — set a PIN first', name: v.Name||'' }, 400);
    firstName = (v.Name||'').split(' ')[0]; phone = v.Phone; pin = v.PIN;
  } else if (type === 'owner') {
    const owners = await fetchTab(env, 'Owners'); const o = owners.find(r => r.ID === id);
    if (!o) return json({ error: 'Owner not found' }, 404);
    if (!o.Phone) return json({ error: 'No phone on file', name: o.First_Name||'' }, 400);
    if (!o.PIN)   return json({ error: 'No PIN set', name: o.First_Name||'' }, 400);
    firstName = o.First_Name||'Owner'; phone = o.Phone; pin = o.PIN;
  } else if (type === 'owner_user') {
    const ownerUsers = await fetchTab(env, 'Owner_Users'); const u = ownerUsers.find(r => r.ID === id);
    if (!u) return json({ error: 'Owner user not found' }, 404);
    if (!u.Phone) return json({ error: 'No phone on file', name: u.First_Name||'' }, 400);
    if (!u.PIN)   return json({ error: 'No PIN set', name: u.First_Name||'' }, 400);
    firstName = u.First_Name||'Owner'; phone = u.Phone; pin = u.PIN;
  } else { return json({ error: 'Invalid type. Use: tenant, vendor, owner, owner_user' }, 400); }
  const portalUrl = type === 'vendor' ? PORTAL_BASE+'/vendor.html' : type === 'tenant' ? PORTAL_BASE+'/tenant.html' : PORTAL_BASE+'/owner.html';
  const messages = {
    tenant:     `Hi ${firstName}! Ridge Co. Property Management has set up your resident portal.\n\nPortal: ${portalUrl}\nYour PIN: ${pin}\n\nUse this to check on maintenance requests and submit new ones. Reply to this number with any questions.`,
    vendor:     `Hi ${firstName}! Ridge Co. has set up your vendor portal.\n\nPortal: ${portalUrl}\nYour PIN: ${pin}\n\nLog in to view your assigned jobs, update work order status, and upload photos. Reply to this number with questions.`,
    owner:      `Hi ${firstName}! Ridge Co. has set up your owner portal.\n\nPortal: ${portalUrl}\nYour PIN: ${pin}\n\nLog in to check on your work orders, submit requests, and manage your notification settings. Reply to this number with questions.`,
    owner_user: `Hi ${firstName}! Ridge Co. has set up your owner portal.\n\nPortal: ${portalUrl}\nYour PIN: ${pin}\n\nLog in to check on your work orders, submit requests, and manage your notification settings. Reply to this number with questions.`,
  };
  if (body.preview_only) return json({ preview: messages[type], phone, name: firstName, pin });
  await sendSMS(env, phone, messages[type]);
  await logSMS(env, '', `pin_send_${type}`, id, phone, `[PIN sent to ${firstName}]`);
  return json({ success: true, sent_to: phone, name: firstName });
}

// ── VENDOR BILLING ───────────────────────────────────────────

async function addVendorBill(env, body) {
  // Vendor_Bills stores Created_Date as a date only, so the finest duplicate window
  // available here is the same day: same job, same vendor, same total, same day, still
  // sitting unreviewed. That is a re-submit, not a second bill. Returned as success with
  // duplicate:true rather than an error — the vendor's bill IS recorded, and reporting a
  // failure is what drives the next re-tap in the first place.
  // Notes, Hours and the receipts subtotal are all in the signature, not just the total.
  // A same-day window is coarse — two genuine visits to one job in a day can carry the
  // same trip charge — so the rest of the bill has to match byte-for-byte before this
  // treats it as a re-submit. An already-reviewed bill never blocks a new one.
  const dupeKey = body.WO_ID || body.wo_id;
  if (dupeKey && body.Total) {
    const dupe = await findRecentDuplicate(env, 'Vendor_Bills', {
      WO_ID: dupeKey, Vendor_ID: String(body.Vendor_ID || ''), Total: String(body.Total),
      Status: 'submitted', Notes: String(body.Notes || ''), Hours: String(body.Hours || ''),
      Receipts_Total: String(body.Receipts_Total || ''),
    }, 86400);
    if (dupe) {
      // A re-submit didn't create a second bill, but the hours it was built from still
      // belong to the bill that DID get created. Link them to that one rather than leaving
      // them loose and billable a second time.
      try { await linkTimeEntriesToBill(env, body.time_entry_ids, String(dupe.ID || ''), dupeKey); } catch (e) {}
      return json({ success: true, duplicate: true, id: String(dupe.ID || '') });
    }
  }
  // Vendor_Bills has no column for the vendor's own invoice number until something needs
  // one, and addRow maps by header — a write to a missing column stores nothing silently.
  if (body.Vendor_Invoice_No) { try { await ensureColumns(env, 'Vendor_Bills', ['Vendor_Invoice_No']); } catch (e) {} }

  // Hours logged on the job can BE the bill — that is the whole point when Brett is the
  // vendor. The ids ride in on the body but are not a Vendor_Bills column, so they come
  // out before the row is written and get stamped onto the time rows afterwards instead.
  const timeIds = parseIdList(body.time_entry_ids);
  delete body.time_entry_ids;

  const res = await addRow(env, 'Vendor_Bills', body);
  if (timeIds.length) {
    // Link AFTER the bill exists. If this half fails the bill is still right — the hours
    // simply stay available, which is recoverable. The reverse (hours marked spent against
    // a bill that was never created) is not.
    try {
      const created = await res.clone().json();
      if (created && created.id) await linkTimeEntriesToBill(env, timeIds, String(created.id), body.WO_ID || body.wo_id);
    } catch (e) { /* the bill is saved; the link is not worth losing it over */ }
  }
  // Automation: entering a bill moves the WO to Complete (if still pre-complete).
  try {
    const woKey = body.WO_ID || body.wo_id;
    if (woKey) {
      const wos = await fetchTab(env, 'Work_Orders');
      const wo = findWO(wos, woKey);
      const preComplete = ['New','Assigned','Accepted','In Progress','On Hold'];
      if (wo && preComplete.includes(wo.Status)) {
        await updateWOFields(env, woKey, { Status: 'Complete', Completed_Date: wo.Completed_Date || new Date().toISOString().split('T')[0] });
      }
    }
  } catch(e) { /* non-fatal: bill is still saved */ }
  return res;
}

async function listVendorBills(env, url) {
  const woId = url.searchParams.get('wo_id') || '', vendorId = url.searchParams.get('vendor_id') || '', statusFilter = url.searchParams.get('status') || '';
  try {
    const bills = await fetchTab(env, 'Vendor_Bills');
    let results = bills.filter(b => b.Active !== 'FALSE');
    if (statusFilter && !woId) {
      // Admin view: Invoice Review screen — return all bills matching this status
      return json(results.filter(b => (b.Status || '').toLowerCase() === statusFilter.toLowerCase()));
    }
    if (woId)     results = results.filter(b => b.WO_ID     === woId);
    if (vendorId) results = results.filter(b => b.Vendor_ID === vendorId);
    return json(results);
  } catch(e) { return json([]); }
}

// POST /invoice-review/unapprove { id }
// Approving a bill locks the price in, and there was no way back — a second approve just
// handed back the existing row, so a bill approved at $185 stayed $185 no matter what
// happened to the number afterwards. Withdrawing puts the bill back in Review Bills to be
// priced again.
//
// Only ever before it reaches QuickBooks. Once an invoice or bill exists there, the Hub
// row is the record of what was actually sent, and quietly retiring it would leave the two
// systems disagreeing with nothing to reconcile against.
async function unapproveInvoiceReview(env, body) {
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'id required' }, 400);

  const irs = await fetchTab(env, 'Invoice_Review');
  const ir = irs.find(r => String(r.ID) === id);
  if (!ir) return json({ error: `No approval row ${id}` }, 404);
  if (ir.Active === 'FALSE') return json({ success: true, already_withdrawn: true });

  const sentInv  = (ir.QB_Invoice_ID || '').trim();
  const sentBill = (ir.QB_Bill_ID || '').trim();
  if (sentInv || sentBill) {
    return json({
      error: `This one is already in QuickBooks (${sentInv ? 'invoice ' + sentInv : ''}${sentInv && sentBill ? ', ' : ''}${sentBill ? 'bill ' + sentBill : ''}). Withdrawing the approval here would leave the Hub and QuickBooks disagreeing. Void or edit it in QuickBooks instead.`,
      qb_invoice_id: sentInv, qb_bill_id: sentBill,
    }, 409);
  }

  await updateRow(env, 'Invoice_Review', id, {
    Active: 'FALSE',
    QB_Invoice_Status: 'withdrawn',
  });

  // Put the bill back where it came from, or it won't reappear in Review Bills to be
  // priced again — which would leave the job stuck with no way to invoice it.
  let billRestored = false;
  if (ir.Bill_ID) {
    try {
      const res = await updateRow(env, 'Vendor_Bills', ir.Bill_ID, { Status: 'submitted' });
      const parsed = await res.clone().json();
      billRestored = !!(parsed && parsed.success);
    } catch (e) { billRestored = false; }
  }

  return json({
    success: true, id, wo_id: ir.WO_ID || '', bill_id: ir.Bill_ID || '',
    customer_total: ir.Customer_Total || '',
    bill_restored: billRestored,
    warning: billRestored ? '' : 'The approval is withdrawn, but the vendor bill could not be set back to submitted — it may not reappear in Review Bills. Check the Vendor_Bills row.',
  });
}

async function approveInvoiceReview(env, body) {
  const {
    bill_id, wo_id, vendor_id, vendor_name,
    job_type, vendor_cost, brett_time, brett_hrs, travel,
    markup, processing_fee, customer_total, brett_net, approved_by,
    own_wage, profit, own_materials, own_material_ids,
  } = body;
  if (!bill_id || !customer_total) return json({ error: 'bill_id and customer_total required' }, 400);
  const today = new Date().toISOString().split('T')[0];

  // Approving twice must not create a second Invoice_Review row — the Hub can now approve
  // straight from the work order, so the same bill is reachable from two places. If this
  // bill already has a live review row, hand that one back instead of logging another.
  try {
    const existingIR = await fetchTab(env, 'Invoice_Review');
    const already = existingIR.find(r => r.Active !== 'FALSE' && String(r.Bill_ID) === String(bill_id));
    if (already) {
      // Hand back the existing row rather than logging a second one — but say what it's
      // for. Approving again at a different number used to look like it worked while the
      // original amount quietly stood.
      return json({ success: true, already_approved: true, id: String(already.ID),
        approved_total: already.Customer_Total || '',
        differs: String(already.Customer_Total || '') !== String(customer_total || ''),
        qb_status: already.QB_Invoice_Status || 'pending' });
    }
  } catch (e) { /* tab unreadable — fall through and let the append surface the real error */ }
  // Neither tab has these columns yet, and updateRow/addRow map by header — a write to a
  // column that isn't there reports success and stores nothing.
  try {
    await Promise.all([
      ensureColumns(env, 'Vendor_Bills',   ['Own_Wage', 'Profit', 'Own_Materials']),
      ensureColumns(env, 'Invoice_Review', ['Own_Wage', 'Profit', 'Own_Materials', 'Own_Material_IDs']),
    ]);
  } catch (e) { /* the money fields below still land; only the split is lost */ }

  // 1. Update Vendor_Bills row: mark reviewed, save markup fields
  await updateRow(env, 'Vendor_Bills', bill_id, {
    Status:         'reviewed',
    Job_Type:       job_type        || 'standard',
    Own_Materials:  own_materials   || '0',
    Brett_Time:     brett_time      || '0',
    Brett_Hrs:      brett_hrs       || '0',
    Travel:         travel          || '0',
    Markup:         markup          || '0',
    Processing_Fee: processing_fee  || '0',
    Customer_Total: customer_total,
    Brett_Net:      brett_net       || '0',
    Own_Wage:       own_wage        || '0',
    Profit:         profit          || '0',
    Approved_By:    approved_by     || 'Brett',
    Reviewed_Date:  today,
  });
  // 2. Append to Invoice_Review log — this row is what /qb/send-invoice acts on.
  // NOTE: the ID below is a placeholder. addRow overwrites the ID column with its own
  // auto-increment, so this 'IR-…' value never reaches the sheet. It used to be returned
  // to the caller anyway, handing back an id that matches no row — which meant the Hub
  // could not chain "approve" straight into "send to QuickBooks". The real id is read back
  // out of addRow's response below.
  const reviewRow = {
    ID:                 'IR-' + Date.now(),
    Bill_ID:            bill_id,
    WO_ID:              wo_id,
    Vendor_ID:          vendor_id,
    Vendor_Name:        vendor_name,
    Job_Type:           job_type,
    Vendor_Cost:        vendor_cost,
    Brett_Time:         brett_time,
    // Which receipts from the Receipts tab the customer is paying for. Recorded by id so
    // the send builds exactly the lines that were approved, not whatever is on the job by
    // the time it goes out.
    Own_Materials:      own_materials || '0',
    Own_Material_IDs:   own_material_ids || '',
    Travel:             travel,
    Markup:             markup,
    Processing_Fee:     processing_fee,
    Customer_Total:     customer_total,
    Brett_Net:          brett_net,
    // Brett_Net is cash in minus cash OUT. Own_Wage is how much of it is his own hours
    // rather than what the business made — the two are different questions, and a job that
    // only covers his wage is not a job that works once he pays someone else to do it.
    Own_Wage:           own_wage || '0',
    Profit:             profit   || '0',
    QB_Invoice_Status:  'pending',
    QB_Invoice_ID:      '',
    QB_Bill_ID:         '',
    Approved_By:        approved_by,
    Approved_Date:      today,
    Active:             'TRUE',
  };
  const addRes = await addRow(env, 'Invoice_Review', reviewRow);
  let realId = '';
  try {
    const parsed = await addRes.clone().json();
    if (parsed && parsed.error) return addRes;      // missing tab / no header row — surface it
    realId = String(parsed && parsed.id || '');
  } catch (e) { /* fall through with an empty id rather than fail the whole approval */ }
  return json({ success: true, id: realId });
}

// ── ESTIMATES ────────────────────────────────────────────────

async function listEstimates(env, url) {
  const woId = url.searchParams.get('wo_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  const all = await fetchTab(env, 'Estimates');
  const results = all.filter(e => e.WO_ID === woId && e.Active !== 'FALSE').sort((a, b) => parseInt(a.Version||'1') - parseInt(b.Version||'1')).map(e => { try { e.Line_Items = JSON.parse(e.Line_Items||'[]'); } catch { e.Line_Items = []; } return e; });
  return json(results);
}

// POST /estimate/unapprove { wo_id, reason? }
// An approved estimate is a commitment the vendor has been told to proceed on, so taking
// it back has to tell them — otherwise they carry on working to a number that no longer
// stands.
async function unapproveEstimate(env, body) {
  const woId = body.wo_id; if (!woId) return json({ error: 'wo_id required' }, 400);
  const all = await fetchTab(env, 'Estimates');
  const versions = all.filter(e => e.WO_ID === woId && e.Active !== 'FALSE');
  if (!versions.length) return json({ error: 'No estimate found for this WO' }, 404);
  const latest = versions.reduce((a, b) => parseInt(a.Version) > parseInt(b.Version) ? a : b);
  if (String(latest.Status || '') !== 'Approved') {
    return json({ error: `That estimate is "${latest.Status || 'Pending'}", not approved — nothing to withdraw.` }, 409);
  }

  const data = await sheetsRequest(env, 'GET', '/values/Estimates');
  const rows = data.values || [], headers = rows[0] || [];
  const idCol = headers.indexOf('ID'), statusCol = headers.indexOf('Status');
  if (idCol === -1 || statusCol === -1) return json({ error: 'Estimates tab missing ID or Status column' }, 500);
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === latest.ID);
  if (rowIdx === -1) return json({ error: 'Could not locate estimate row' }, 404);
  const sheetRow = rowIdx + 1;

  const batch = [{ range: `Estimates!${col(statusCol)}${sheetRow}`, values: [['Pending']] }];
  const note = body.reason ? ('Approval withdrawn: ' + body.reason) : 'Approval withdrawn';
  const noteCol = headers.indexOf('Approval_Note');
  if (noteCol > -1) batch.push({ range: `Estimates!${col(noteCol)}${sheetRow}`, values: [[note]] });
  await sheetsRequest(env, 'POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: batch });

  // Tell the vendor. They were told to proceed; they need to know that's paused.
  let vendorTold = false;
  if (latest.Vendor_ID) {
    try {
      const vendors = await fetchTab(env, 'Vendors');
      const vendor = vendors.find(v => v.ID === latest.Vendor_ID);
      if (vendor?.Phone) {
        const msg = `Hold on WO ${woId} — the approved estimate ($${latest.Subtotal}) has been put back on hold${body.reason ? ': ' + body.reason : ''}. Please don't proceed until we confirm the revised number.`;
        await sendSMS(env, vendor.Phone, msg);
        await logSMS(env, woId, 'estimate_unapproved', vendor.ID, vendor.Phone, msg);
        vendorTold = true;
      }
    } catch (e) { /* status is already back to Pending; the SMS is best-effort */ }
  }
  return json({ success: true, wo_id: woId, version: latest.Version, subtotal: latest.Subtotal,
                vendor_notified: vendorTold,
                warning: (latest.Vendor_ID && !vendorTold) ? 'Estimate is back on hold, but the vendor could not be texted — tell them directly.' : '' });
}

async function approveEstimate(env, body) {
  const woId = body.wo_id; if (!woId) return json({ error: 'wo_id required' }, 400);
  const all = await fetchTab(env, 'Estimates'); const versions = all.filter(e => e.WO_ID === woId && e.Active !== 'FALSE');
  if (!versions.length) return json({ error: 'No estimate found for this WO' }, 404);
  const latest = versions.reduce((a, b) => parseInt(a.Version) > parseInt(b.Version) ? a : b);
  const data = await sheetsRequest(env, 'GET', '/values/Estimates'); const rows = data.values || [], headers = rows[0] || [];
  const idCol = headers.indexOf('ID'), statusCol = headers.indexOf('Status');
  if (idCol === -1 || statusCol === -1) return json({ error: 'Estimates tab missing ID or Status column' }, 500);
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === latest.ID);
  if (rowIdx === -1) return json({ error: 'Could not locate estimate row' }, 404);
  const sheetRow = rowIdx + 1;
  function colLetter(n) { return n < 26 ? String.fromCharCode(65+n) : 'A'+String.fromCharCode(65+n-26); }
  const approvedBy = body.approved_by || 'admin', requestDeposit = !!body.request_deposit;
  const approvalNote = body.approval_type || (requestDeposit ? 'Deposit requested' : 'Approved — no deposit required');
  const batch = [{ range: `Estimates!${colLetter(statusCol)}${sheetRow}`, values: [['Approved']] }];
  const optionalCols = { Approved_By: approvedBy, Approved_Date: new Date().toISOString(), Approval_Note: approvalNote };
  Object.entries(optionalCols).forEach(([colName, val]) => { const idx = headers.indexOf(colName); if (idx > -1) batch.push({ range: `Estimates!${colLetter(idx)}${sheetRow}`, values: [[val]] }); });
  await sheetsRequest(env, 'POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: batch });
  if (latest.Vendor_ID) {
    try { const vendors = await fetchTab(env, 'Vendors'); const vendor = vendors.find(v => v.ID === latest.Vendor_ID); if (vendor?.Phone) { const msg = requestDeposit ? `Estimate approved for WO ${woId} ($${latest.Subtotal}). Deposit being requested from customer — we'll confirm once received.` : `Estimate approved for WO ${woId} ($${latest.Subtotal}). You're clear to proceed — no deposit required for this job.`; await sendSMS(env, vendor.Phone, msg); } } catch(e) {}
  }
  return json({ success: true, requestDeposit });
}

async function addEstimateVersion(env, body) {
  const woId = body.wo_id; if (!woId) return json({ error: 'wo_id required' }, 400);
  if (!Array.isArray(body.line_items) || !body.line_items.length) return json({ error: 'line_items required' }, 400);
  const existing = await fetchTab(env, 'Estimates'), priorVersions = existing.filter(e => e.WO_ID === woId);
  const nextVersion = priorVersions.length ? Math.max(...priorVersions.map(e => parseInt(e.Version||'0'))) + 1 : 1;
  const subtotal = body.line_items.reduce((sum, li) => sum + (parseFloat(li.amount)||0), 0);
  const lineItemsJson = JSON.stringify(body.line_items);

  // WO-1052, WO-1012 and WO-1062 each carry two byte-identical estimates written about a
  // second apart — a double-tap on the vendor's Submit button. Note the version counter
  // masked it: the second write read the first row and dutifully incremented 1→2, so the
  // twins look like a legitimate revision until you compare the line items. Re-submitting
  // the exact same numbers is never a real revision, so hand back the row that already
  // exists instead of appending a second one.
  const dupe = await findRecentDuplicate(env, 'Estimates', {
    WO_ID: woId, Line_Items: lineItemsJson, Vendor_ID: body.vendor_id || '',
  }, 120);
  if (dupe) return json({ success: true, duplicate: true, version: parseInt(dupe.Version || '1'), subtotal: dupe.Subtotal || subtotal.toFixed(2) });

  await addRow(env, 'Estimates', { WO_ID: woId, Vendor_ID: body.vendor_id||'', Version: String(nextVersion), Line_Items: lineItemsJson, Subtotal: subtotal.toFixed(2), Change_Reason: nextVersion === 1 ? 'Initial estimate' : (body.change_reason||'Revised'), Created_By: body.created_by||'vendor', Created_Date: new Date().toISOString(), Status: body.status||'Pending' });
  try { await updateWOField(env, woId, 'Current_Estimate', subtotal.toFixed(2)); } catch(e) {}
  return json({ success: true, version: nextVersion, subtotal: subtotal.toFixed(2) });
}

function calcTieredEstimate(rawCost) {
  const cost = parseFloat(rawCost) || 0;
  let pct; if (cost<=250) pct=0.35; else if (cost<=500) pct=0.33; else if (cost<=750) pct=0.31; else if (cost<=1000) pct=0.29; else if (cost<=1250) pct=0.27; else if (cost<=1500) pct=0.26; else pct=0.25;
  const stepA=cost*(1+pct),stepB=stepA+75,stepC=stepB*1.05,finalPrice=Math.ceil(stepC/5)*5,deposit=finalPrice/2;
  return { rawCost:cost, markupPct:pct, stepA:+stepA.toFixed(2), stepB:+stepB.toFixed(2), stepC:+stepC.toFixed(2), finalPrice:+finalPrice.toFixed(2), deposit:+deposit.toFixed(2) };
}

// ── LOCATION / CLUSTER ───────────────────────────────────────

async function listNearbyWOs(env, url) {
  const woId = url.searchParams.get('wo_id')||'', vendorId = url.searchParams.get('vendor_id')||'';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  const [wos, props, tenants] = await fetchTabs(env, ['Work_Orders','Properties','Tenants']);
  const wo = wos.find(w => w.ID === woId); if (!wo) return json({ error: 'WO not found' }, 404);
  const prop = props.find(p => String(p.ID) === String(wo.Property_ID)); if (!prop) return json({ nearby: [], message: 'Property not found' });
  const primary = (prop.Location_Cluster||'').trim(), overlap = (prop.Location_Overlap||'').split(',').map(s=>s.trim()).filter(Boolean), allTags = [primary, ...overlap].filter(Boolean);
  if (!allTags.length) return json({ nearby: [], message: 'no_tags', primary_cluster: null });
  const nearbyPropIds = new Set();
  props.forEach(p => { if (String(p.ID) === String(wo.Property_ID)) return; const pTags = [(p.Location_Cluster||'').trim(), ...(p.Location_Overlap||'').split(',').map(s=>s.trim())].filter(Boolean); if (pTags.some(t => allTags.includes(t))) nearbyPropIds.add(String(p.ID)); });
  if (!nearbyPropIds.size) return json({ nearby: [], message: 'no_nearby', primary_cluster: primary });
  const OPEN = new Set(['New','Assigned','Accepted','In Progress','On Hold']);
  const nearby = wos.filter(w => w.ID !== woId && nearbyPropIds.has(String(w.Property_ID)) && OPEN.has(w.Status) && (!vendorId || w.Vendor_ID === vendorId)).map(w => { const wProp = props.find(p => String(p.ID) === String(w.Property_ID)), t = tenants.find(t => String(t.ID) === String(w.Tenant_ID)); return { id: w.ID, property_id: w.Property_ID, address: (wProp&&wProp.Address)||'', city: (wProp&&wProp.City)||'', description: w.Description, trade: w.Trade, priority: w.Priority, status: w.Status, vendor_id: w.Vendor_ID, tenant_name: t ? `${t.First_Name||''} ${t.Last_Name||''}`.trim() : '', tenant_phone: isTenantCurrent(t) ? (t.Phone||'') : '' }; });
  return json({ nearby, primary_cluster: primary, overlap_clusters: overlap });
}

async function geocodeProperty(env, body) {
  if (!env.GOOGLE_MAPS_KEY) return json({ error: 'GOOGLE_MAPS_KEY not set' }, 500);
  const address = (body.address||'').trim(); if (!address) return json({ error: 'address required' }, 400);
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${env.GOOGLE_MAPS_KEY}`);
  const d = await r.json(); if (d.status !== 'OK' || !d.results.length) return json({ error: 'Geocoding failed: '+d.status }, 400);
  const loc = d.results[0].geometry.location; return json({ success: true, lat: loc.lat, lng: loc.lng, formatted: d.results[0].formatted_address });
}

async function clusterSuggestions(env, url) {
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng')), maxKm = parseFloat(url.searchParams.get('max_km')||'2.5');
  if (isNaN(lat)||isNaN(lng)) return json({ error: 'lat and lng required' }, 400);
  const props = await fetchTab(env, 'Properties'), tagged = props.filter(p => p.Location_Cluster && p.Lat && p.Lng);
  if (!tagged.length) return json({ suggestions: { primary: null, overlap: [] }, nearby: [], message: 'No tagged properties with coordinates yet' });
  function haversineKm(lat1,lng1,lat2,lng2) { const R=6371,d2r=Math.PI/180,dLat=(lat2-lat1)*d2r,dLng=(lng2-lng1)*d2r,a=Math.sin(dLat/2)**2+Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
  const nearby = tagged.map(p => ({ id:p.ID, address:p.Address, cluster:p.Location_Cluster, overlap:p.Location_Overlap, dist_km:haversineKm(lat,lng,parseFloat(p.Lat),parseFloat(p.Lng)) })).filter(p => p.dist_km<=maxKm).sort((a,b)=>a.dist_km-b.dist_km);
  const counts={}; nearby.slice(0,5).forEach(p => { counts[p.cluster]=(counts[p.cluster]||0)+1; });
  const primary = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const overlapSet=new Set(); nearby.filter(p=>p.dist_km>0.4).forEach(p => { if(p.cluster!==primary) overlapSet.add(p.cluster); (p.overlap||'').split(',').forEach(o=>{ const t=o.trim(); if(t&&t!==primary) overlapSet.add(t); }); });
  return json({ suggestions: { primary, overlap: [...overlapSet].slice(0,4) }, nearby });
}

async function savePropertyClusters(env, body) {
  const { property_id, cluster, overlap, lat, lng } = body; if (!property_id) return json({ error: 'property_id required' }, 400);
  const data = await sheetsRequest(env, 'GET', '/values/Properties'); const rows = data.values||[]; if (rows.length<2) return json({ error: 'Properties tab empty' }, 500);
  const headers = rows[0], idCol = headers.indexOf('ID'), needed = ['Location_Cluster','Location_Overlap','Lat','Lng'], missing = needed.filter(n=>headers.indexOf(n)===-1);
  if (missing.length) return json({ error: `Add these columns to Properties tab: ${missing.join(', ')}`, missing }, 400);
  const rowIdx = rows.findIndex((r,i)=>i>0&&String(r[idCol])===String(property_id)); if (rowIdx===-1) return json({ error: 'Property not found: '+property_id }, 404);
  const sheetRow = rowIdx+1, colFn = n => n<26?String.fromCharCode(65+n):'A'+String.fromCharCode(65+n-26), updates=[];
  if (cluster!==undefined) updates.push({ range:`Properties!${colFn(headers.indexOf('Location_Cluster'))}${sheetRow}`, values:[[cluster||'']] });
  if (overlap!==undefined) updates.push({ range:`Properties!${colFn(headers.indexOf('Location_Overlap'))}${sheetRow}`, values:[[Array.isArray(overlap)?overlap.join(','):(overlap||'')]] });
  if (lat!==undefined) updates.push({ range:`Properties!${colFn(headers.indexOf('Lat'))}${sheetRow}`, values:[[String(lat)]] });
  if (lng!==undefined) updates.push({ range:`Properties!${colFn(headers.indexOf('Lng'))}${sheetRow}`, values:[[String(lng)]] });
  if (!updates.length) return json({ success:true, message:'Nothing to update' });
  await sheetsRequest(env, 'POST', '/values:batchUpdate', { valueInputOption:'RAW', data:updates }); return json({ success:true });
}

// ── KEY REGISTRY IMPORTER ────────────────────────────────────

async function importKeyRegistry(env, body) {
  const registryId = env.KEY_REGISTRY_SHEET_ID; if (!registryId) return json({ error: 'KEY_REGISTRY_SHEET_ID not set' }, 500);
  const token = await getAccessToken(env);
  const regResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${registryId}/values/Sheet1`, { headers: { 'Authorization': `Bearer ${token}` } });
  const regData = await regResp.json(); if (regData.error) return json({ error: `Key Registry read error: ${regData.error.message}` }, 400);
  const regRows = regData.values||[]; if (regRows.length<2) return json({ error: 'Key Code Registry appears empty' }, 400);
  const rH = regRows[0];
  const iAddr=rH.findIndex(h=>h.toLowerCase().includes('property')), iUnit=rH.findIndex(h=>h.toLowerCase()==='unit'), iCode=rH.findIndex(h=>h.toLowerCase().includes('key code')||h.toLowerCase()==='key code');
  const iLoc=rH.findIndex(h=>h.toLowerCase().includes('lock box location')||h.toLowerCase().includes('location')), iDate=rH.findIndex(h=>h.toLowerCase().includes('as of')||h.toLowerCase().includes('date'));
  const iMailbox=rH.findIndex(h=>h.toLowerCase().includes('mail')), iNotes=rH.findIndex(h=>h.toLowerCase()==='notes');
  if (iAddr===-1||iUnit===-1) return json({ error: `Could not find address/unit columns. Found: ${rH.join(', ')}` }, 400);
  const [props,units,keysTabData] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Units'), sheetsRequest(env,'GET','/values/Keys')]);
  const keysHeaders = (keysTabData.values&&keysTabData.values[0])||['ID','Property_ID','Unit_ID','Key_Type','Key_Code','Lockbox_Code','Location','Notes','Possession_Status','Active'];
  let nextId = (keysTabData.values||[]).slice(1).reduce((max,r)=>{ const n=parseInt(r[keysHeaders.indexOf('ID')]||'0'); return n>max?n:max; },0)+1;
  function matchProp(addr) { if(!addr)return null; const a=addr.toLowerCase().trim().replace(/[.,]/g,''); return props.find(p=>{ const pa=(p.Address||'').toLowerCase().trim().replace(/[.,]/g,''); return pa===a||pa.startsWith(a.split(' ').slice(0,3).join(' '))||a.startsWith(pa.split(',')[0]); }); }
  function matchUnit(prop,unitLabel) { if(!prop||!unitLabel)return null; const ul=unitLabel.toLowerCase().trim().replace(/apt\.?\s*/i,'apt ').replace(/\s+/g,' '); return units.find(u=>{ if(String(u.Property_ID)!==String(prop.ID))return false; const hl=(u.Unit_Label||'').toLowerCase().trim().replace(/apt\.?\s*/i,'apt ').replace(/\s+/g,' '); return hl===ul||hl.replace(/\s/g,'')===ul.replace(/\s/g,''); }); }
  function inferKeyType(u) { const l=(u||'').toLowerCase().trim(); if(l==='fd'||l.includes('front door'))return 'Building-FrontDoorKey'; if(l.includes('ridge')&&l.includes('lock'))return 'Building-Lockbox'; if(l==='lock box'||l==='lockbox')return 'Building-Lockbox'; if(l.includes('mailbox')||l.includes('mail box'))return 'Unit-MailboxKey'; if(l.includes('gate'))return 'Building-GateCode'; if(l.match(/^apt|^unit/i))return 'Unit-Key'; return 'Building-CustomKey'; }
  function isUnitSpecific(u) { return !!(u||'').match(/^apt|^unit/i); }
  const preview=body.preview!==false, mapped=[], skipped=[];
  for (let i=1;i<regRows.length;i++) {
    const row=regRows[i], addr=(iAddr>=0?row[iAddr]:'')||'', unitCol=(iUnit>=0?row[iUnit]:'')||'', code=(iCode>=0?row[iCode]:'')||'';
    const loc=(iLoc>=0?row[iLoc]:'')||'', asOf=(iDate>=0?row[iDate]:'')||'', mailbox=(iMailbox>=0?row[iMailbox]:'')||'', notes=(iNotes>=0?row[iNotes]:'')||'';
    if (!addr&&!unitCol&&!code) continue;
    const prop=matchProp(addr); if (!prop) { skipped.push({ row:i+1,addr,unitCol,reason:'Property not found in hub' }); continue; }
    const keyType=inferKeyType(unitCol); let unitId='',unitLabel='';
    if (isUnitSpecific(unitCol)) { const unit=matchUnit(prop,unitCol); if(unit){unitId=unit.ID;unitLabel=unit.Unit_Label;}else{unitLabel=unitCol;} }
    mapped.push({ property_id:prop.ID,property_address:prop.Address,unit_id:unitId,unit_label:unitLabel||unitCol,key_type:keyType,key_code:code,location:loc,notes:[notes,mailbox?'Mailbox: '+mailbox:'',asOf?'As of: '+asOf:''].filter(Boolean).join(' | '),source_row:i+1 });
  }
  if (preview) return json({ preview:true,total:mapped.length,skipped:skipped.length,rows:mapped,skippedRows:skipped });
  const now=new Date().toISOString();
  const newRows=mapped.map(m=>{ const row=Array(keysHeaders.length).fill(''); function set(c,v){const i=keysHeaders.indexOf(c);if(i>=0)row[i]=v;} set('ID',String(nextId++));set('Property_ID',String(m.property_id));set('Unit_ID',String(m.unit_id));set('Key_Type',m.key_type);set('Key_Code',m.key_code);set('Lockbox_Code',m.key_code);set('Location',m.location);set('Lockbox_Location',m.location);set('Notes',m.notes);set('Possession_Status','Have It');set('Active','TRUE');set('Added_Date',now); return row; });
  await sheetsRequest(env,'POST','/values/Keys:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{ values:newRows });
  return json({ success:true,imported:newRows.length,skipped:skipped.length });
}

// ── ESTIMATE TEXT GENERATION ─────────────────────────────────

async function generateEstimateText(env, body) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  const { property_address, issues, line_items, wo_id } = body;
  if (!property_address||!issues) return json({ error: 'property_address and issues required' }, 400);
  if (!Array.isArray(line_items)||!line_items.length) return json({ error: 'line_items required' }, 400);
  const rawCost = line_items.reduce((sum,li)=>sum+(parseFloat(li.amount)||0),0), pricing = calcTieredEstimate(rawCost);
  let includeIntegrityClause=false;
  if (wo_id) { try { const all=await fetchTab(env,'Estimates'); const versions=all.filter(e=>e.WO_ID===wo_id).sort((a,b)=>parseInt(a.Version||'1')-parseInt(b.Version||'1')); if(versions.length){const firstItems=JSON.parse(versions[0].Line_Items||'[]'); if(firstItems.length>1&&line_items.length<firstItems.length) includeIntegrityClause=true;} } catch(e){} }
  const itemsList=line_items.map(li=>`- ${li.desc}`).join('\n');
  const integrityClauseText=includeIntegrityClause?'\n- Estimate Integrity Clause: This estimate is priced as a single, unified project based on current mobilization efficiencies. If individual line items are selectively removed or declined by the client, any remaining approved items are subject to a 15% price adjustment plus a $150 travel/mobilization fee.':'';
  const prompt=`You are a property maintenance estimate writer. Rewrite the following raw, messy scope-of-work items into a polished, professional, scannable bulleted list. Correct all typos, slang, and grammar. Group related items under bold category headers where it makes sense.\n\nProperty: ${property_address}\nRaw issue description: ${issues}\nRaw line items:\n${itemsList}\n\nReturn ONLY the rewritten "Scope of Work:" bulleted section — clean Markdown, no emojis, no preamble, no other sections. Do not include any dollar amounts or pricing.`;
  try {
    const resp=await fetch('https://api.anthropic.com/v1/messages',{ method:'POST', headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'}, body:JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:800, messages:[{role:'user',content:prompt}] }) });
    const data=await resp.json(); const scopeText=data.content?.[0]?.text?.trim()||''; if (!scopeText) return json({ error:'Claude returned empty response',detail:data }, 500);
    const doc=`${property_address}\n\n${scopeText}\n\nFinancial Terms:\n\nTotal Estimated Cost: $${pricing.finalPrice.toFixed(2)}\nRequired 50% Deposit: $${pricing.deposit.toFixed(2)}\n\nPayment & Project Terms:\n\n- A 50% electronic deposit is required to approve this estimate and schedule the work.\n- All deposits and final invoices must be paid electronically. Physical checks are not accepted.`+integrityClauseText;
    return json({ success:true, text:doc, pricing:{ finalPrice:pricing.finalPrice, deposit:pricing.deposit } });
  } catch(e) { return json({ error:e.message }, 500); }
}
// ── WO AUDIT ─────────────────────────────────────────────────

async function logWOAudit(env, woId, changedBy, changedByRole, field, oldValue, newValue, notes='') {
  try {
    const data = await sheetsRequest(env, 'GET', `/values/WO_Audit`);
    const rows = data.values||[]; if (!rows.length) return;
    const headers = rows[0], now = new Date().toISOString();
    const newRow = headers.map(h => ({ ID:String(nextSafeId(rows)), WO_ID:woId||'', Changed_By:changedBy||'unknown', Changed_By_Role:changedByRole||'unknown', Field:field||'', Old_Value:String(oldValue??''), New_Value:String(newValue??''), Timestamp:now, Notes:notes||'' }[h]??''));
    await sheetsRequest(env, 'POST', `/values/WO_Audit:append?valueInputOption=RAW`, { values:[newRow] });
  } catch(e) { /* never break main operation */ }
}

async function getWOAudit(env, url) {
  const woId = url.searchParams.get('wo_id'); if (!woId) return json({ error: 'Missing wo_id' }, 400);
  try {
    const audit = await fetchTab(env, 'WO_Audit');
    return json(audit.filter(a => a.WO_ID === woId).sort((a,b) => new Date(a.Timestamp)-new Date(b.Timestamp)));
  } catch(e) { return json([]); }
}

async function translateToEnglish(env, text) {
  if (!env.ANTHROPIC_API_KEY) return text;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'}, body:JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:400, messages:[{role:'user',content:`Translate the following from Spanish to English. Return only the translation, nothing else:\n\n${text}`}] }) });
    const data = await resp.json(); return data.content?.[0]?.text?.trim() || text;
  } catch(e) { return text; }
}

// ── WO NOTES ─────────────────────────────────────────────────

async function addWONote(env, body) {
  if (!body.wo_id || !body.note) return json({ error: 'Missing wo_id or note' }, 400);
  const workorders = await fetchTab(env, 'Work_Orders');
  const wo = findWO(workorders, body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  if (body.author_role === 'owner' && body.owner_id) {
    const properties = await fetchTab(env, 'Properties');
    const prop = properties.find(p => p.ID === wo.Property_ID);
    if (!prop || prop.Owner_ID !== body.owner_id) return json({ error: 'Unauthorized' }, 403);
  }
  let noteText = body.note;
  if (body.author_role === 'vendor' && body.vendor_id) {
    const allVendors = await fetchTab(env, 'Vendors'), noteVendor = allVendors.find(v => v.ID === body.vendor_id);
    if (noteVendor?.Language === 'es') { const en = await translateToEnglish(env, noteText); if (en && en !== noteText) noteText = `[ES] ${noteText}\n[EN] ${en}`; }
  }
  const ts = new Date().toLocaleString('en-US', { timeZone:'America/New_York', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
  const attribution = `[${ts} — ${body.author||'Unknown'} (${body.author_role||'unknown'})]`;
  const newNotes = wo.Notes ? `${wo.Notes}\n${attribution} ${noteText}` : `${attribution} ${noteText}`;
  await updateWOFields(env, body.wo_id, { Notes: newNotes });
  await logWOAudit(env, body.wo_id, body.author, body.author_role, 'Notes', wo.Notes||'', noteText.substring(0,100), 'Note appended');

  if (body.notify_owner_status_note === true) {
    try {
      const [properties, owners] = await fetchTabs(env, ['Properties','Owners']);
      const noteProp = properties.find(p => p.ID === wo.Property_ID);
      const noteOwner = noteProp ? owners.find(o => o.ID === noteProp.Owner_ID) : null;
      if (noteOwner?.Phone) {
        const ownerMsg = `Hi ${noteOwner.First_Name}, your work order ${body.wo_id} has been placed on hold. Note: ${noteText}. Reply or call us with any questions.`;
        await sendSMS(env, noteOwner.Phone, ownerMsg);
        await logSMS(env, body.wo_id, 'owner_onhold_note', noteOwner.ID, noteOwner.Phone, ownerMsg);
      }
    } catch(e) { /* non-fatal — note already saved */ }
  }

  return json({ success: true });
}

const OWNER_EDITABLE_FIELDS = ['Owner_WO_Ref','Priority','Scheduled_Date'];

async function ownerUpdateWO(env, body) {
  const allowed = {}; for (const [k,v] of Object.entries(body.fields||{})) { if (OWNER_EDITABLE_FIELDS.includes(k)) allowed[k]=v; }
  if (!Object.keys(allowed).length) return json({ error: 'No owner-editable fields provided' }, 400);
  const [workorders, properties] = await fetchTabs(env, ['Work_Orders','Properties']);
  const wo = findWO(workorders, body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  const prop = properties.find(p => p.ID === wo.Property_ID);
  if (!prop || String(prop.Owner_ID) !== String(body.owner_id)) return json({ error: 'Unauthorized' }, 403);
  await updateRow(env, 'Work_Orders', body.wo_id, allowed);
  for (const [field, newVal] of Object.entries(allowed)) { if (String(wo[field]||'') !== String(newVal||'')) await logWOAudit(env, body.wo_id, body.owner_name, 'owner', field, wo[field]||'', newVal, 'Owner updated via portal'); }
  return json({ success: true });
}

async function adminUpdateWO(env, body) {
  const adminName = body.admin_name||'Admin'; if (!body.wo_id||!body.fields) return json({ error: 'Missing wo_id or fields' }, 400);
  const workorders = await fetchTab(env, 'Work_Orders'); const wo = workorders.find(w => w.ID === body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  await updateRow(env, 'Work_Orders', body.wo_id, body.fields);
  for (const [field, newVal] of Object.entries(body.fields)) { if (String(wo[field]||'') !== String(newVal||'')) await logWOAudit(env, body.wo_id, adminName, 'admin', field, wo[field]||'', newVal, 'Admin updated via portal'); }
  return json({ success: true });
}

async function appendDescription(env, body) {
  if (!body.wo_id||!body.text) return json({ error: 'Missing wo_id or text' }, 400);
  const [workorders, properties] = await fetchTabs(env, ['Work_Orders','Properties']);
  const wo = findWO(workorders, body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  if (body.author_role === 'owner' && body.owner_id) { const prop = properties.find(p => p.ID === wo.Property_ID); if (!prop || String(prop.Owner_ID) !== String(body.owner_id)) return json({ error: 'Unauthorized' }, 403); }
  const ts = new Date().toLocaleString('en-US', { timeZone:'America/New_York', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
  const newDesc = (wo.Description||'') + `\n\n[${ts} — ${body.author||'Unknown'} (${body.author_role||'unknown'})] ${body.text.trim()}`;
  await updateWOFields(env, body.wo_id, { Description: newDesc });
  await logWOAudit(env, body.wo_id, body.author, body.author_role, 'Description', wo.Description||'', newDesc, 'Description update appended');
  return json({ success: true });
}

async function setTenantVisibility(env, body) {
  const ALLOWED = ['Tenant_Visible','Tenant_Notify_Created','Tenant_Notify_Updates'], updates = {};
  for (const [k,v] of Object.entries(body.fields||{})) { if (ALLOWED.includes(k)) updates[k]=v; }
  if (!Object.keys(updates).length) return json({ error: 'No valid fields' }, 400);
  const workorders = await fetchTab(env, 'Work_Orders'); const wo = workorders.find(w => w.ID === body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  await updateRow(env, 'Work_Orders', body.wo_id, updates);
  for (const [field, newVal] of Object.entries(updates)) { if (String(wo[field]||'') !== String(newVal||'')) await logWOAudit(env, body.wo_id, body.changed_by||'admin', body.changed_by_role||'admin', field, wo[field]||'', newVal, 'Tenant visibility setting changed'); }
  return json({ success: true });
}

// ── MASTER KEYS / TEMPLATES / MATERIALS ──────────────────────

async function bulkAssignMasterKey(env, body) {
  if (!body.master_key_id||!body.owner_id) return json({ error: 'Missing master_key_id or owner_id' }, 400);
  const propData = await sheetsRequest(env, 'GET', `/values/Properties`); const props = propData.values||[], headers = props[0]||[];
  const ownerIdx=headers.indexOf('Owner_ID'), mkIdx=headers.indexOf('Master_Key_ID');
  if (ownerIdx===-1||mkIdx===-1) return json({ error: 'Properties tab missing Owner_ID or Master_Key_ID column' }, 400);
  let updated=0; const requests=[];
  props.slice(1).forEach((row,i) => { if(row[ownerIdx]===body.owner_id){ requests.push({ range:`Properties!${col(mkIdx)}${i+2}`, values:[[body.master_key_id]] }); updated++; } });
  if (requests.length) await sheetsRequest(env, 'POST', `/values:batchUpdate`, { valueInputOption:'RAW', data:requests });
  return json({ success:true, updated });
}

async function listWOTemplates(env, url) {
  const ownerId = url.searchParams.get('owner_id')||'';
  const templates = await fetchTab(env, 'WO_Templates');
  return json(templates.filter(t => t.Active!=='FALSE' && (!t.Owner_ID||t.Owner_ID===''||(ownerId&&t.Owner_ID===ownerId))));
}

async function listMaterials(env, url) {
  const woId=url.searchParams.get('wo_id')||'', vendorId=url.searchParams.get('vendor_id')||'', showAll=url.searchParams.get('all')==='true';
  const materials = await fetchTab(env, 'Materials'); let items = materials.filter(m => m.Active!=='FALSE');
  if (woId) { items=items.filter(m=>m.WO_ID===woId); }
  else if (vendorId&&!showAll) { const wos=await fetchTab(env,'Work_Orders'); const vids=new Set(wos.filter(w=>w.Vendor_ID===vendorId).map(w=>w.ID)); items=items.filter(m=>vids.has(m.WO_ID)); }
  if (showAll||(!woId&&!vendorId)) { const wos=await fetchTab(env,'Work_Orders'); const ps=await fetchTab(env,'Properties'); items=items.map(m=>{ const wo=wos.find(w=>w.ID===m.WO_ID)||{}; const prop=ps.find(p=>p.ID===wo.Property_ID)||{}; return {...m,wo_status:wo.Status||'',property_address:prop.Address||'',wo_trade:wo.Trade||''}; }); }
  return json(items);
}

// ── GOOGLE DRIVE ─────────────────────────────────────────────

async function findDriveFolder(token, name, parentId, sharedDriveId) {
  const q=`name=${JSON.stringify(name)} and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const params=new URLSearchParams({ q, fields:'files(id,name,webViewLink)', supportsAllDrives:'true', includeItemsFromAllDrives:'true', ...(sharedDriveId?{driveId:sharedDriveId,corpora:'drive'}:{}) });
  const res=await fetch(`https://www.googleapis.com/drive/v3/files?${params}`,{headers:{Authorization:`Bearer ${token}`}});
  const data=await res.json(); return (data.files||[])[0]||null;
}

async function createDriveFolder(token, name, parentId) {
  const res=await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=id,name,webViewLink',{ method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parentId]}) });
  return await res.json();
}

async function findOrCreateFolder(token, name, parentId, sharedDriveId) {
  const existing = await findDriveFolder(token, name, parentId, sharedDriveId);
  return existing || await createDriveFolder(token, name, parentId);
}

async function uploadFileToDrive(token, arrayBuffer, filename, mimeType, folderId, sharedDriveId) {
  const metadata=JSON.stringify({name:filename,parents:[folderId]}), boundary='ridgeco_boundary_xyz', enc=new TextEncoder();
  const metaPart=enc.encode(`--${boundary}\nContent-Type: application/json\n\n${metadata}\n--${boundary}\nContent-Type: ${mimeType}\n\n`);
  const closePart=enc.encode(`\n--${boundary}--`), fileBytes=new Uint8Array(arrayBuffer);
  const combined=new Uint8Array(metaPart.length+fileBytes.length+closePart.length);
  combined.set(metaPart,0); combined.set(fileBytes,metaPart.length); combined.set(closePart,metaPart.length+fileBytes.length);
  const res=await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=id,name,webViewLink,mimeType,size${sharedDriveId?'&driveId='+sharedDriveId:''}`,{ method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`}, body:combined });
  return await res.json();
}

async function updateWOField(env, woId, fieldName, value) {
  try {
    const data=await sheetsRequest(env,'GET','/values/Work_Orders'); const rows=data.values||[], headers=rows[0]||[];
    const colIdx=headers.indexOf(fieldName); if(colIdx===-1) return;
    const idCol=idColIndex(headers), rowIdx=rows.findIndex((r,i)=>i>0&&r[idCol]===woId); if(rowIdx===-1) return;
    const colLetter=colIdx<26?String.fromCharCode(65+colIdx):'A'+String.fromCharCode(65+colIdx-26);
    await sheetsRequest(env,'PUT',`/values/Work_Orders!${colLetter}${rowIdx+1}?valueInputOption=RAW`,{values:[[value]]});
  } catch(e) { /* non-fatal */ }
}

// Retired July 20, 2026 — the Make.com → QBO webhook path is dead (Make stopped
// firing in 2025). Invoicing now goes through the preview-first /qb/send-invoice
// flow against Intuit directly. The old /fire-make-webhook route is gone; the Hub
// button that called it now opens the QB preview modal.

async function updateOwnerBilling(env, body) {
  if (!body.owner_id) return json({error:'Missing owner_id'},400);
  const BILLING_FIELDS=['Billing_Name','Billing_Address','Billing_City','Billing_State','Billing_Zip','Billing_Phone','Billing_Email'];
  const fields={}; for(const f of BILLING_FIELDS){if(body[f]!==undefined)fields[f]=body[f];}
  if(!Object.keys(fields).length) return json({error:'No billing fields provided'},400);
  await updateRow(env,'Owners',body.owner_id,fields); return json({success:true});
}

async function getOwnerBilling(env, url) {
  const ownerId=url.searchParams.get('owner_id'); if(!ownerId) return json({error:'Missing owner_id'},400);
  const owners=await fetchTab(env,'Owners'); const owner=owners.find(o=>o.ID===ownerId); if(!owner) return json({error:'Owner not found'},404);
  return json({owner_id:owner.ID,name:owner.First_Name+' '+(owner.Last_Name||''),company:owner.Company||'',billing_name:owner.Billing_Name||'',billing_address:owner.Billing_Address||'',billing_city:owner.Billing_City||'',billing_state:owner.Billing_State||'',billing_zip:owner.Billing_Zip||'',billing_phone:owner.Billing_Phone||'',billing_email:owner.Billing_Email||'',qbo_customer_id:owner.QBO_Customer_ID||''});
}

// ── ADMIN TOOLS ──────────────────────────────────────────────

// POST /admin/fix-stale-tenants { apply?: true }
// Units still naming a tenant who has moved out. Move-out never cleared the pointer, so
// this backlog exists in the live sheet right now — and every one of them is a former
// tenant's phone number waiting to be texted to a vendor. Reports by default; only
// writes when explicitly told to.
// ── DUPLICATE PROPERTIES: INSPECT, THEN MERGE ────────────────
// The same building entered twice is not a cosmetic problem. Work orders, units, keys,
// tenants and receipts each attach to whichever ID they happened to be created against,
// so the history splits in two and neither half is complete. Deleting the wrong one
// silently orphans everything pointing at it.
//
// Nothing here deletes. The loser is deactivated, and every reference is repointed first.

// Every tab that stores a Property_ID, and what else needs repointing alongside it.
const PROPERTY_REFS = [
  { tab: 'Work_Orders',  col: 'Property_ID' },
  { tab: 'Units',        col: 'Property_ID' },
  { tab: 'Keys',         col: 'Property_ID' },
  { tab: 'Tenants',      col: 'Property_ID' },
  { tab: 'Attachments',  col: 'Property_ID' },
  { tab: 'Receipts',     col: 'Property_ID' },
  { tab: 'Estimates',    col: 'Property_ID' },
  { tab: 'Materials',    col: 'Property_ID' },
  // Not called Property_ID. A queued receipt auto-linked to the losing row would otherwise
  // stay pointed at a property that no longer exists as far as the Hub is concerned.
  { tab: 'Receipts_Queue', col: 'Suggested_Property_ID' },
];

// GET /admin/duplicate-properties
// Addresses appearing more than once, with a full reference count per ID so you can see
// which row the work actually lives on before touching anything.
// POST /admin/migrate-trades { apply?: true }
// One-time sweep bringing stored trade names onto the canonical list. The worker already
// aliases on read, so the MONEY was never wrong — but every client-side filter compares
// raw strings, so a Hub filter set to "Electrical" returns none of the history stored as
// "Electric". This closes that.
//
// Safe to run now in a way it wasn't before: every form writes the canonical list, so
// nothing is going to reintroduce the old spellings behind the sweep.
const TRADE_MIGRATION_TABS = [
  { tab: 'Work_Orders', cols: ['Trade'] },
  { tab: 'Vendors',     cols: ['Trade', 'Trades'] },
  { tab: 'Materials',   cols: ['Trade'] },
  { tab: 'WO_Templates',cols: ['Trade'] },
];

async function adminMigrateTrades(env, body) {
  const apply = body && (body.apply === true || String(body.apply).toUpperCase() === 'TRUE');
  const report = [];

  for (const spec of TRADE_MIGRATION_TABS) {
    let rows;
    try { rows = await fetchTab(env, spec.tab); }
    catch (e) { if (isMissingTabError(e)) continue; report.push({ tab: spec.tab, error: e.message }); continue; }

    for (const col of spec.cols) {
      const changes = [];
      for (const r of rows) {
        const raw = String(r[col] || '').trim();
        if (!raw) continue;
        // Trades is a comma list; Trade is a single value. Handle both by splitting.
        const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
        const mapped = parts.map(x => { const res = resolveTrade(x); return res.matched ? res.name : x; });
        const next = mapped.join(', ');
        if (next !== raw) changes.push({ id: r.ID, from: raw, to: next });
      }
      if (!changes.length) continue;
      if (apply) {
        for (const c of changes) {
          try { await updateRow(env, spec.tab, c.id, { [col]: c.to }); c.done = true; }
          catch (e) { c.done = false; }
        }
      }
      report.push({ tab: spec.tab, col, count: changes.length,
                    applied: apply ? changes.filter(c => c.done).length : 0,
                    sample: changes.slice(0, 8) });
    }
  }

  const total = report.reduce((n, r) => n + (r.count || 0), 0);
  return json({ success: true, applied: apply, total, report });
}

// Owners duplicate the same way properties do — the same company entered twice, each row
// collecting its own properties and its own portal users. Same treatment: show what is
// attached to each, repoint everything onto the keeper, deactivate the loser, delete
// nothing.
const OWNER_REFS = [
  { tab: 'Properties',   col: 'Owner_ID' },
  { tab: 'Owner_Users',  col: 'Owner_ID' },
  { tab: 'WO_Templates', col: 'Owner_ID' },   // templates can be scoped to one owner
];

// GET /admin/duplicate-owners
// POST /admin/owner-to-user { from_id, to_id, apply? }
// Two people at one company should be ONE owner record with TWO logins — that's exactly
// what Owner_Users is for. Two Owners rows instead means the properties split, reporting
// sees two owners, and only one of them can hold the QuickBooks link.
//
// This converts the surplus Owners row into an Owner_User on the keeper, carrying the
// person's PIN across so their login keeps working, then moves anything attached and
// deactivates the old row. Nobody loses access, which is the whole difference between
// this and a merge.
async function adminOwnerToUser(env, body) {
  const fromId = String(body.from_id || '').trim();
  const toId   = String(body.to_id || '').trim();
  const apply  = body.apply === true || String(body.apply).toUpperCase() === 'TRUE';
  if (!fromId || !toId) return json({ error: 'from_id and to_id required' }, 400);
  if (fromId === toId) {
    return json({ error: 'Those two rows carry the SAME ID in the Owners tab. That is a data problem, not a duplicate — give one of them a unique ID in the sheet first, or every lookup will keep finding whichever comes first.' }, 400);
  }

  const [owners, ownerUsers] = await fetchTabs(env, ['Owners','Owner_Users']);
  const from = owners.find(o => String(o.ID) === fromId);
  const to   = owners.find(o => String(o.ID) === toId);
  if (!from) return json({ error: `No owner ${fromId}` }, 404);
  if (!to)   return json({ error: `No owner ${toId}` }, 404);

  const personName = ((from.First_Name || '') + ' ' + (from.Last_Name || '')).trim() || qbOwnerDisplayName(from);
  if (!personName) return json({ error: 'That row has no person name to carry across.' }, 400);

  // A PIN already in use would let two people log in as each other.
  const pin = String(from.PIN || '').trim();
  if (pin) {
    const pinClash = ownerUsers.find(u => String(u.PIN || '').trim().toLowerCase() === pin.toLowerCase() && u.Active !== 'FALSE');
    if (pinClash) return json({ error: `That PIN is already used by owner user "${pinClash.First_Name || pinClash.ID}". Change one of them first.` }, 409);
    // Check active OWNERS too. Login tries Owner_Users first and returns null outright on a
    // name mismatch — no fallthrough. So a PIN shared with another owner would send that
    // person's login into this new user, fail the name check, and lock them out completely.
    const ownerClash = owners.find(o => String(o.ID) !== fromId && String(o.PIN || '').trim().toLowerCase() === pin.toLowerCase() && o.Active !== 'FALSE');
    if (ownerClash) return json({ error: `That PIN is also on owner "${qbOwnerDisplayName(ownerClash)}". Converting would lock them out — change one PIN first.` }, 409);
  }

  const alreadyUser = ownerUsers.find(u => String(u.Owner_ID) === toId && u.Active !== 'FALSE' &&
    ((u.First_Name || '') + ' ' + (u.Last_Name || '')).trim().toLowerCase() === personName.toLowerCase());

  // What moves across with them.
  const plan = [];
  for (const ref of OWNER_REFS) {
    let rows;
    try { rows = await fetchTab(env, ref.tab); }
    catch (e) { if (isMissingTabError(e)) continue; return json({ error: `Could not read ${ref.tab} — stopping.` }, 500); }
    const hits = rows.filter(r => String(r[ref.col] || '') === fromId && r.Active !== 'FALSE');
    if (hits.length) plan.push({ tab: ref.tab, col: ref.col, ids: hits.map(r => r.ID), count: hits.length });
  }

  const loginFirstName = from.First_Name || personName.split(' ')[0] || '';
  if (!apply) {
    return json({ success: true, applied: false, from: fromId, to: toId,
      person: personName, keeper: qbOwnerDisplayName(to),
      has_pin: !!pin, already_user: !!alreadyUser,
      // Owner rows log in on PIN alone; owner USERS must also give a first name. That's a
      // real change to how this person signs in, and it should not be a surprise.
      login_first_name: loginFirstName,
      login_name_changes: !from.First_Name,
      plan, total: plan.reduce((n, p) => n + p.count, 0) });
  }

  // Create the login FIRST. If anything later fails, the person can already sign in and
  // the old row is still live — nobody is locked out at any point.
  let userId = alreadyUser ? alreadyUser.ID : '';
  if (!alreadyUser) {
    const res = await addRow(env, 'Owner_Users', {
      Owner_ID: toId,
      First_Name: loginFirstName,
      Last_Name:  from.Last_Name || '',
      Phone: from.Phone || '', Email: from.Billing_Email || from.Email || '',
      PIN: pin, Role: 'secondary', Active: 'TRUE',
      Created_Date: new Date().toISOString().split('T')[0],
    });
    try { const parsed = await res.clone().json(); userId = parsed && parsed.id ? String(parsed.id) : ''; } catch (e) {}
    if (!userId) return json({ error: 'Could not create the owner user — nothing else was changed.' }, 500);
  }

  const moved = [], failed = [];
  for (const step of plan) {
    for (const id of step.ids) {
      try { await updateRow(env, step.tab, id, { [step.col]: toId }); moved.push(step.tab + ':' + id); }
      catch (e) { failed.push(step.tab + ':' + id); }
    }
  }
  if (failed.length) {
    return json({ success: false, applied: true, owner_user_id: userId, moved: moved.length, failed,
      error: `${personName} can now sign in under ${qbOwnerDisplayName(to)}, but ${failed.length} reference(s) didn't move. Both owner rows are still active. Re-run to finish.` }, 500);
  }

  // Carry the QuickBooks link over if only the old row had one.
  const fq = (from.QBO_Customer_ID || '').trim(), tq = (to.QBO_Customer_ID || '').trim();
  if (fq && !tq) { try { await updateRow(env, 'Owners', toId, { QBO_Customer_ID: fq }); } catch (e) {} }

  // Clear the old PIN before deactivating, so one PIN never resolves to two records.
  // updateRow returns a 404 response rather than throwing, so its result has to be read —
  // otherwise a failed deactivation reports success while the old row stays live with a
  // working PIN.
  let deactivated = true;
  try {
    const dRes = await updateRow(env, 'Owners', fromId, { Active: 'FALSE', PIN: '' });
    const dBody = await dRes.clone().json();
    deactivated = !!(dBody && dBody.success);
  } catch (e) { deactivated = false; }

  return json({ success: true, applied: true, owner_user_id: userId, person: personName,
    keeper: qbOwnerDisplayName(to), moved: moved.length, qb_moved: !!(fq && !tq),
    deactivated,
    warning: deactivated ? '' : `${personName} can sign in under ${qbOwnerDisplayName(to)}, but the old owner row could not be deactivated — it is still active and still holds the PIN. Deactivate it by hand.`,
    login_name: loginFirstName,
    note: `${personName} now signs in as a secondary user on ${qbOwnerDisplayName(to)} with the same PIN, giving their first name "${loginFirstName}".` });
}

async function adminDuplicateOwners(env) {
  const owners = (await fetchTab(env, 'Owners')).filter(o => o.Active !== 'FALSE');
  const groups = {};
  for (const o of owners) {
    const key = qbNormName(qbOwnerDisplayName(o));
    if (!key) continue;
    (groups[key] = groups[key] || []).push(o);
  }
  const dupeKeys = Object.keys(groups).filter(k => groups[k].length > 1);
  if (!dupeKeys.length) return json({ success: true, duplicates: [] });

  const refData = {};
  for (const ref of OWNER_REFS) {
    if (refData[ref.tab] !== undefined) continue;
    try { refData[ref.tab] = await fetchTab(env, ref.tab); }
    catch (e) { refData[ref.tab] = isMissingTabError(e) ? [] : null; }
  }

  // Two rows sharing an ID is a different and worse problem than two rows for one company:
  // every lookup by id takes whichever comes first, so half the system sees one row and
  // half sees the other. Surface it rather than letting a merge fail with a confusing error.
  const idCounts = {};
  owners.forEach(o => { const k = String(o.ID || ''); idCounts[k] = (idCounts[k] || 0) + 1; });
  const sharedIds = Object.keys(idCounts).filter(k => k && idCounts[k] > 1);

  const duplicates = dupeKeys.map(key => ({
    name: qbOwnerDisplayName(groups[key][0]),
    shared_id: groups[key].length > 1 && new Set(groups[key].map(o => String(o.ID))).size === 1,
    rows: groups[key].map(o => {
      const counts = {}; let total = 0;
      for (const ref of OWNER_REFS) {
        const rows = refData[ref.tab];
        if (!rows) { counts[ref.tab] = null; continue; }
        const n = rows.filter(r => String(r[ref.col] || '') === String(o.ID) && r.Active !== 'FALSE').length;
        counts[ref.tab] = n; total += n;
      }
      return { id: o.ID, display: qbOwnerDisplayName(o),
               email: o.Billing_Email || o.Email || '', phone: o.Phone || '',
               // An Owners row with a PIN is somebody's portal login. Deactivating it on
               // merge takes their access away, so it has to be visible BEFORE the merge.
               has_login: !!String(o.PIN || '').trim(),
               qb_id: o.QBO_Customer_ID || '', refs: counts, total_refs: total };
    }),
  }));
  return json({ success: true, duplicates, shared_ids: sharedIds });
}

// POST /admin/merge-owner { from_id, to_id, apply? }
async function adminMergeOwner(env, body) {
  const fromId = String(body.from_id || '').trim();
  const toId   = String(body.to_id || '').trim();
  const apply  = body.apply === true || String(body.apply).toUpperCase() === 'TRUE';
  if (!fromId || !toId) return json({ error: 'from_id and to_id required' }, 400);
  if (fromId === toId) {
    return json({ error: 'Those two rows carry the SAME ID in the Owners tab. Give one of them a unique ID in the sheet first — with a shared ID, every lookup finds whichever comes first.' }, 400);
  }

  const owners = await fetchTab(env, 'Owners');
  const from = owners.find(o => String(o.ID) === fromId);
  const to   = owners.find(o => String(o.ID) === toId);
  if (!from) return json({ error: `No owner ${fromId}` }, 404);
  if (!to)   return json({ error: `No owner ${toId}` }, 404);

  // Merging two genuinely different owners would move properties onto the wrong ledger.
  if (qbNormName(qbOwnerDisplayName(from)) !== qbNormName(qbOwnerDisplayName(to))) {
    return json({ error: `"${qbOwnerDisplayName(from)}" and "${qbOwnerDisplayName(to)}" are not the same name. Refusing to merge.` }, 409);
  }
  // Two different QuickBooks customers means two real ledgers with real history.
  const fq = (from.QBO_Customer_ID || '').trim(), tq = (to.QBO_Customer_ID || '').trim();
  if (fq && tq && fq !== tq) {
    return json({ error: `These are linked to different QuickBooks customers (#${fq} and #${tq}). Sort that out first — merging would abandon one ledger.` }, 409);
  }

  const plan = [];
  for (const ref of OWNER_REFS) {
    let rows;
    try { rows = await fetchTab(env, ref.tab); }
    catch (e) { if (isMissingTabError(e)) continue; return json({ error: `Could not read ${ref.tab} — stopping rather than half-merging.` }, 500); }
    const hits = rows.filter(r => String(r[ref.col] || '') === fromId && r.Active !== 'FALSE');
    if (hits.length) plan.push({ tab: ref.tab, col: ref.col, ids: hits.map(r => r.ID), count: hits.length });
  }

  if (!apply) {
    return json({ success: true, applied: false, from: fromId, to: toId, name: qbOwnerDisplayName(from),
                  plan, total: plan.reduce((n, p) => n + p.count, 0),
                  // The system already models several people at one company: Owner_Users.
                  // Two Owners rows each with a login means the second person belongs
                  // there, not merged away.
                  loser_has_login: !!String(from.PIN || '').trim(),
                  loser_phone: from.Phone || '',
                  qb_note: (!tq && fq) ? `The keeper isn't linked to QuickBooks but #${fromId} is (#${fq}) — that link moves across.` : '' });
  }

  const moved = [], failed = [];
  for (const step of plan) {
    for (const id of step.ids) {
      try { await updateRow(env, step.tab, id, { [step.col]: toId }); moved.push(step.tab + ':' + id); }
      catch (e) { failed.push(step.tab + ':' + id); }
    }
  }
  if (failed.length) {
    return json({ success: false, applied: true, moved: moved.length, failed,
      error: `Moved ${moved.length} but ${failed.length} failed. Both owners are still active — nothing was hidden. Re-run to finish.` }, 500);
  }

  // Carry the QuickBooks link over if only the loser had one, so the keeper inherits the
  // ledger rather than looking unmapped and getting a new customer created for it.
  if (fq && !tq) { try { await updateRow(env, 'Owners', toId, { QBO_Customer_ID: fq }); } catch (e) {} }
  await updateRow(env, 'Owners', fromId, { Active: 'FALSE' });
  return json({ success: true, applied: true, from: fromId, to: toId, moved: moved.length,
                qb_moved: !!(fq && !tq),
                note: `Owner ${fromId} is deactivated, not deleted — the row is still in the sheet.` });
}

async function adminDuplicateProperties(env) {
  const properties = await fetchTab(env, 'Properties');
  const live = properties.filter(p => p.Active !== 'FALSE');

  // Group on address AND city. Same street number and name in two different towns is a
  // realistic shape in a Baltimore-area portfolio, and presenting those as duplicates with
  // a proposed keeper is how you'd merge two genuinely different buildings.
  const groups = {};
  for (const p of live) {
    const addr = qbNormAddress(p.Address || '');
    if (!addr) continue;
    const key = addr + '|' + qbNormAddress(p.City || '');
    (groups[key] = groups[key] || []).push(p);
  }
  const dupeKeys = Object.keys(groups).filter(k => groups[k].length > 1);
  if (!dupeKeys.length) return json({ success: true, duplicates: [] });

  // Only read the reference tabs when there's actually something to report on.
  const refData = {};
  for (const ref of PROPERTY_REFS) {
    if (refData[ref.tab] !== undefined) continue;
    // A tab that doesn't exist holds no references — that's an answer, not a failure.
    // Only a genuine read error is unknown, and that's what null means here.
    try { refData[ref.tab] = await fetchTab(env, ref.tab); }
    catch (e) { refData[ref.tab] = isMissingTabError(e) ? [] : null; }
  }

  const duplicates = dupeKeys.map(key => ({
    address: groups[key][0].Address,
    rows: groups[key].map(p => {
      const counts = {}; let total = 0;
      for (const ref of PROPERTY_REFS) {
        const rows = refData[ref.tab];
        if (!rows) { counts[ref.tab] = null; continue; }   // unreadable, not zero
        const n = rows.filter(r => String(r[ref.col] || '') === String(p.ID) && r.Active !== 'FALSE').length;
        counts[ref.tab] = n; total += n;
      }
      return {
        id: p.ID,
        unit_count_field: p.Unit_Count || '',
        owner_id: p.Owner_ID || '',
        lockbox: p.Lockbox_Code || '',
        qb_id: p.QBO_Customer_ID || '',
        refs: counts,
        total_refs: total,
      };
    }),
  }));
  return json({ success: true, duplicates });
}

// POST /admin/merge-property { from_id, to_id, apply? }
// Repoints every reference from the duplicate onto the keeper, then deactivates the
// duplicate. Reports what it WOULD do unless apply is explicitly true.
async function adminMergeProperty(env, body) {
  const fromId = String(body.from_id || '').trim();
  const toId   = String(body.to_id || '').trim();
  const apply  = body.apply === true || String(body.apply).toUpperCase() === 'TRUE';
  if (!fromId || !toId) return json({ error: 'from_id and to_id required' }, 400);
  if (fromId === toId)  return json({ error: 'from_id and to_id are the same row' }, 400);

  const properties = await fetchTab(env, 'Properties');
  const from = properties.find(p => String(p.ID) === fromId);
  const to   = properties.find(p => String(p.ID) === toId);
  if (!from) return json({ error: `No property ${fromId}` }, 404);
  if (!to)   return json({ error: `No property ${toId}` }, 404);

  // Merging two genuinely different buildings would be far worse than the duplicate.
  if (qbNormAddress(from.Address || '') !== qbNormAddress(to.Address || '')) {
    return json({ error: `"${from.Address}" and "${to.Address}" are not the same address. Refusing to merge.` }, 409);
  }
  if (qbNormAddress(from.City || '') !== qbNormAddress(to.City || '')) {
    return json({ error: `Same street address but different cities (${from.City || 'blank'} vs ${to.City || 'blank'}). Those are two different buildings.` }, 409);
  }
  if (String(from.Owner_ID || '') !== String(to.Owner_ID || '')) {
    return json({ error: `Those two rows have different owners (${from.Owner_ID || 'none'} vs ${to.Owner_ID || 'none'}). Fix the owner first — merging would move work onto the wrong ledger.` }, 409);
  }

  const plan = [];
  for (const ref of PROPERTY_REFS) {
    let rows;
    try { rows = await fetchTab(env, ref.tab); }
    catch (e) {
      // A tab this system has never created can't be holding references to anything.
      // Only a real read failure justifies stopping — that one could hide rows that
      // need moving, and a half-merge is worse than no merge.
      if (isMissingTabError(e)) continue;
      return json({ error: `Could not read ${ref.tab} — stopping rather than half-merging.` }, 500);
    }
    const hits = rows.filter(r => String(r[ref.col] || '') === fromId && r.Active !== 'FALSE');
    if (hits.length) plan.push({ tab: ref.tab, col: ref.col, ids: hits.map(r => r.ID), count: hits.length });
  }

  // Two units called "Apt 1" on one property will collide when they're linked to
  // QuickBooks: the second create hits a duplicate-name fault, resolves to the SAME
  // sub-customer, and both units end up billing to one ledger. Worth knowing before the
  // merge, not after.
  let labelClashes = [];
  try {
    const units = await fetchTab(env, 'Units');
    const labelOf = u => String(u.Unit_Label || '').trim().toLowerCase();
    const toLabels = new Set(units.filter(u => String(u.Property_ID) === toId && u.Active !== 'FALSE').map(labelOf).filter(Boolean));
    labelClashes = units.filter(u => String(u.Property_ID) === fromId && u.Active !== 'FALSE' && toLabels.has(labelOf(u)))
                        .map(u => u.Unit_Label);
  } catch (e) { /* advisory only */ }

  if (!apply) {
    return json({ success: true, applied: false, from: fromId, to: toId, address: from.Address,
                  plan, total: plan.reduce((n, p) => n + p.count, 0), label_clashes: labelClashes });
  }

  // Repoint everything BEFORE deactivating, so a failure part-way leaves both rows live
  // and the references still resolve. A half-merge that has already hidden the source
  // would strand whatever hadn't moved yet.
  const moved = [], failed = [];
  for (const step of plan) {
    for (const id of step.ids) {
      try { await updateRow(env, step.tab, id, { [step.col]: toId }); moved.push(step.tab + ':' + id); }
      catch (e) { failed.push(step.tab + ':' + id); }
    }
  }
  if (failed.length) {
    return json({ success: false, applied: true, moved: moved.length, failed,
      error: `Moved ${moved.length} reference(s) but ${failed.length} failed. Both properties are still active — nothing was hidden. Re-run to finish.` }, 500);
  }

  await updateRow(env, 'Properties', fromId, { Active: 'FALSE' });
  return json({ success: true, applied: true, from: fromId, to: toId, moved: moved.length,
                label_clashes: labelClashes,
                note: `Property ${fromId} is deactivated, not deleted — its row is still in the sheet if you need to look at it.` });
}

async function adminFixStaleTenants(env, body) {
  const apply = body && (body.apply === true || String(body.apply).toUpperCase() === 'TRUE');
  const [units, tenants] = await fetchTabs(env, ['Units','Tenants']);
  // A Tenants read that succeeds but returns nothing would classify EVERY linked unit as
  // an orphan, and one click would wipe the portfolio. Refuse before doing any work.
  if (apply && !tenants.length) {
    return json({ error: 'Refusing to clear: the Tenants tab came back empty, which is a read problem rather than a real backlog.' }, 409);
  }
  const now = new Date();
  const stale = [];

  for (const u of units) {
    const tid = String(u.Tenant_ID || '').trim();
    if (!tid) continue;
    const t = tenants.find(x => String(x.ID) === tid);
    if (!t) { stale.push({ unit: u.ID, label: u.Unit_Label || '', tenant: tid, why: 'tenant record no longer exists' }); continue; }
    const inactive = String(t.Active || '').toUpperCase() === 'FALSE';
    const movedOut = t.Move_Out_Date && !isNaN(new Date(t.Move_Out_Date + 'T23:59:59')) && new Date(t.Move_Out_Date + 'T23:59:59') < now;
    if (inactive || movedOut) {
      stale.push({ unit: u.ID, label: u.Unit_Label || '', tenant: tid,
                   name: ((t.First_Name || '') + ' ' + (t.Last_Name || '')).trim(),
                   why: movedOut ? ('moved out ' + t.Move_Out_Date) : 'marked inactive' });
    }
  }

  // A missing tenant ROW is a data anomaly that deserves a human look, not an automatic
  // clear — the link may be the only remaining evidence of who lived there.
  const clearable = stale.filter(r => r.why !== 'tenant record no longer exists');
  const needsReview = stale.filter(r => r.why === 'tenant record no longer exists');

  if (apply) {
    for (const row of clearable) { try { await updateRow(env, 'Units', row.unit, { Tenant_ID: '' }); row.cleared = true; } catch (e) { row.cleared = false; } }
  }
  // Clearing unit pointers doesn't end the exposure. Work orders keep their Tenant_ID by
  // design — that's the history — so count how many still name someone who has left. Those
  // are now phone-suppressed rather than cleared, and this is how you see the size of it.
  let woExposed = 0, contactExposed = 0;
  try {
    const wos = await fetchTab(env, 'Work_Orders');
    const gone = tenants.filter(t => !isTenantCurrent(t));
    const goneIds = new Set(gone.map(t => String(t.ID)));
    woExposed = wos.filter(w => w.Tenant_ID && goneIds.has(String(w.Tenant_ID))).length;

    // A WO_Contact_Phone typed by hand is a deliberate override and is never suppressed —
    // it's usually a super or a family member, which is the point of the field. But if
    // someone typed the TENANT's own number in there and that tenant has since left, it
    // stays reachable to vendors and no gate can tell. Detectable, so report it.
    // Compare on the last 10 digits. Tenants sits in PHONE_TABS so its numbers are stored
    // normalised as +1XXXXXXXXXX (11 digits), while WO_Contact_Phone is free text and is
    // usually typed as 10. Comparing the full strings would have matched nothing and
    // reported a reassuring zero on exactly the data this exists to find.
    const last10 = v => { const n = String(v || '').replace(/\D/g, ''); return n.length >= 10 ? n.slice(-10) : ''; };
    const goneNumbers = new Set(gone.map(t => last10(t.Phone)).filter(Boolean));
    contactExposed = wos.filter(w => { const n = last10(w.WO_Contact_Phone); return n && goneNumbers.has(n); }).length;
  } catch (e) { woExposed = -1; }

  return json({ success: true, applied: apply, count: stale.length,
                clearable: clearable.length, needs_review: needsReview.length,
                wos_naming_former_tenants: woExposed,
                wos_with_former_tenant_contact_phone: contactExposed, stale });
}

async function adminFixPins(env, body) {
  const results=[], batchData=[];
  function colLetter(n){return n<26?String.fromCharCode(65+n):'A'+String.fromCharCode(65+n-26);}
  function queueCell(tab,sheetRowNum,colIdx,value){batchData.push({range:`${tab}!${colLetter(colIdx)}${sheetRowNum}`,values:[[value]]});}
  const vData=await sheetsRequest(env,'GET','/values/Vendors'); const vRows=vData.values||[],vH=vRows[0]||[],vPhone=vH.indexOf('Phone');
  for(let i=1;i<vRows.length;i++){const row=vRows[i];if(!row[vPhone])continue;const norm=normalizePhone(row[vPhone]);if(norm&&norm!==row[vPhone]){queueCell('Vendors',i+1,vPhone,norm);results.push({tab:'Vendors',name:row[vH.indexOf('Name')],field:'Phone',from:row[vPhone],to:norm});}}
  const oData=await sheetsRequest(env,'GET','/values/Owners');const oRows=oData.values||[],oH=oRows[0]||[];
  const [oPhone,oPin,oFirst]=[oH.indexOf('Phone'),oH.indexOf('PIN'),oH.indexOf('First_Name')];
  for(let i=1;i<oRows.length;i++){const row=oRows[i],name=row[oFirst]||'';if(row[oPhone]){const norm=normalizePhone(row[oPhone]);if(norm&&norm!==row[oPhone]){queueCell('Owners',i+1,oPhone,norm);results.push({tab:'Owners',name,field:'Phone',from:row[oPhone],to:norm});}const pin=row[oPin]||'',digits=normalizePhone(row[oPhone]).replace(/\D/g,'').slice(-5).padStart(5,'0');if(name==='Adrian'&&pin.length<8){const np='ADR'+digits;queueCell('Owners',i+1,oPin,np);results.push({tab:'Owners',name,field:'PIN',from:pin,to:np});}if(name==='Heather'&&pin.length<8){const np='HER'+digits;queueCell('Owners',i+1,oPin,np);results.push({tab:'Owners',name,field:'PIN',from:pin,to:np});}}}
  const ouData=await sheetsRequest(env,'GET','/values/Owner_Users');const ouRows=ouData.values||[],ouH=ouRows[0]||[],[ouPhone,ouFirst]=[ouH.indexOf('Phone'),ouH.indexOf('First_Name')];
  let heatherInOwnUsers=false;
  for(let i=1;i<ouRows.length;i++){const row=ouRows[i];if((row[ouFirst]||'')==='Heather')heatherInOwnUsers=true;if(row[ouPhone]){const norm=normalizePhone(row[ouPhone]);if(norm&&norm!==row[ouPhone]){queueCell('Owner_Users',i+1,ouPhone,norm);results.push({tab:'Owner_Users',name:row[ouFirst],field:'Phone',from:row[ouPhone],to:norm});}}}
  const tData=await sheetsRequest(env,'GET','/values/Tenants');const tRows=tData.values||[],tH=tRows[0]||[],[tPhone,tPin,tFirst]=[tH.indexOf('Phone'),tH.indexOf('PIN'),tH.indexOf('First_Name')];
  for(let i=1;i<tRows.length;i++){const row=tRows[i],rawPhone=row[tPhone]||'';if(!rawPhone)continue;const norm=normalizePhone(rawPhone);if(norm&&norm!==rawPhone){queueCell('Tenants',i+1,tPhone,norm);results.push({tab:'Tenants',name:row[tFirst],field:'Phone',from:rawPhone,to:norm});}if(!row[tPin]&&norm){const np=generatePIN(norm);queueCell('Tenants',i+1,tPin,np);results.push({tab:'Tenants',name:row[tFirst],field:'PIN',from:'',to:np});}}
  if(batchData.length) await sheetsRequest(env,'POST','/values:batchUpdate',{valueInputOption:'RAW',data:batchData});
  if(!heatherInOwnUsers){const heather=oRows.slice(1).map(r=>({row:r,name:r[oFirst]})).find(x=>x.name==='Heather');if(heather){const phone=normalizePhone(heather.row[oPhone]||''),pin='HER'+phone.replace(/\D/g,'').slice(-5).padStart(5,'0');await addRow(env,'Owner_Users',{Owner_ID:heather.row[oH.indexOf('ID')]||'5',First_Name:'Heather',Phone:phone,PIN:pin,Active:'TRUE'});results.push({tab:'Owner_Users',action:'created',name:'Heather',pin,phone});}}
  return json({success:true,changes:results.length,results});
}

async function adminReformatSheets(env) {
  const results=[],batch=[];
  function colLetter(n){return n<26?String.fromCharCode(65+n):'A'+String.fromCharCode(65+n-26);}
  function queueCell(tab,sheetRow,colIdx,value){batch.push({range:`${tab}!${colLetter(colIdx)}${sheetRow}`,values:[[value]]});}
  const TABS=['Properties','Units','Tenants','Owners','Owner_Users','Vendors','Work_Orders'];
  for(const tab of TABS){
    const data=await sheetsRequest(env,'GET',`/values/${tab}`);const rows=data.values||[];if(rows.length<2)continue;
    const h=rows[0],idCol=h.indexOf('ID'),phoneCol=h.indexOf('Phone'),activeCol=h.indexOf('Active'),pinCol=h.indexOf('PIN');
    let maxId=rows.slice(1).map(r=>parseInt(r[idCol]||'0')).filter(n=>Number.isFinite(n)&&n>0).reduce((a,b)=>Math.max(a,b),0);
    for(let i=1;i<rows.length;i++){const row=rows[i],sheetRow=i+1;if(row.every(cell=>!cell||cell===''))continue;
      if(idCol>=0&&(!row[idCol]||row[idCol].trim()==='')){maxId++;queueCell(tab,sheetRow,idCol,String(maxId));results.push({tab,row:sheetRow,fix:'Added ID',value:maxId});}
      if(phoneCol>=0&&row[phoneCol]){const norm=normalizePhone(row[phoneCol]);if(norm&&norm!==row[phoneCol]){queueCell(tab,sheetRow,phoneCol,norm);results.push({tab,row:sheetRow,fix:'Phone',from:row[phoneCol],to:norm});}}
      if(activeCol>=0&&row[activeCol]){const raw=String(row[activeCol]).toLowerCase().trim(),norm=(raw==='false'||raw==='0')?'FALSE':'TRUE';if(norm!==row[activeCol]){queueCell(tab,sheetRow,activeCol,norm);results.push({tab,row:sheetRow,fix:'Active',from:row[activeCol],to:norm});}}
      const PIN_TABS=['Vendors','Owner_Users','Tenants'];if(PIN_TABS.includes(tab)&&pinCol>=0&&!row[pinCol]&&row[phoneCol]){const pin=generatePIN(normalizePhone(row[phoneCol]));queueCell(tab,sheetRow,pinCol,pin);results.push({tab,row:sheetRow,fix:'Generated PIN',value:pin});}
    }
  }
  if(batch.length) await sheetsRequest(env,'POST','/values:batchUpdate',{valueInputOption:'RAW',data:batch});
  return json({success:true,fixes:results.length,results});
}

async function testDriveAccess(env) {
  const results={};
  try {
    results.propsRoot=env.DRIVE_PROPERTIES_ROOT||'NOT SET'; results.saEmail=env.GOOGLE_SA_EMAIL?env.GOOGLE_SA_EMAIL.substring(0,30)+'...':'NOT SET'; results.saKey=env.GOOGLE_SA_KEY?'SET ('+env.GOOGLE_SA_KEY.length+' chars)':'NOT SET';
    const token=await getAccessToken(env); results.token=token?'OK':'FAILED'; if(!token) return json({ok:false,results});
    const params=new URLSearchParams({q:`'${env.DRIVE_PROPERTIES_ROOT}' in parents and trashed=false`,fields:'files(id,name)',supportsAllDrives:'true',includeItemsFromAllDrives:'true',driveId:env.DRIVE_PROPERTIES_ROOT,corpora:'drive',pageSize:'3'});
    const listRes=await fetch(`https://www.googleapis.com/drive/v3/files?${params}`,{headers:{Authorization:`Bearer ${token}`}});const listData=await listRes.json();
    results.listStatus=listRes.status; results.listResult=listData.error?listData.error:`${(listData.files||[]).length} folders found`;
    const testName=`_test_${Date.now()}`;
    const createRes=await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:testName,mimeType:'application/vnd.google-apps.folder',parents:[env.DRIVE_PROPERTIES_ROOT]})});
    const createData=await createRes.json(); results.createStatus=createRes.status; results.createResult=createData.error?createData.error:`Created: ${createData.name}`;
    if(createData.id){const delRes=await fetch(`https://www.googleapis.com/drive/v3/files/${createData.id}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});results.deleteStatus=delRes.status;}
    return json({ok:results.createStatus===200,results});
  } catch(e){return json({ok:false,error:e.message,results});}
}

async function createUploadSession(env, body) {
  const woId=(body.wo_id||'').trim(), propAddr=(body.property||'Unknown Property').trim()||'Unknown Property';
  const fileName=(body.file_name||`file_${Date.now()}`).trim(), mimeType=(body.mime_type||'application/octet-stream').trim();
  const fileType=(body.file_type||'other').toLowerCase(); // before | after | receipt | invoice | report | other
  try {
    const token=await getAccessToken(env), propsRoot=env.DRIVE_PROPERTIES_ROOT; if(!propsRoot) return json({error:'DRIVE_PROPERTIES_ROOT not configured'},500);
    const propFolder=await findOrCreateFolder(token,propAddr,propsRoot,propsRoot); if(!propFolder?.id) return json({error:'Cannot create property folder',addr:propAddr},500);

    // Vendor invoices/bills go to a separate internal folder — never inside the customer WO folder
    if (fileType === 'invoice' || fileType === 'bill') {
      const internalRoot = await findOrCreateFolder(token,'_Internal — Vendor Bills',propFolder.id);
      if(!internalRoot?.id) return json({error:'Cannot create internal bills folder'},500);
      const woLabel = woId||`upload_${Date.now()}`;
      const billsWOFolder = await findOrCreateFolder(token,woLabel,internalRoot.id);
      if(!billsWOFolder?.id) return json({error:'Cannot create WO bills folder'},500);
      const sessionResp=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Upload-Content-Type':mimeType,'Origin':body.origin||'https://ridge-co.github.io'},body:JSON.stringify({name:fileName,parents:[billsWOFolder.id]})});
      const uploadUrl=sessionResp.headers.get('Location'); if(!uploadUrl){const errBody=await sessionResp.text();return json({error:'Drive did not return upload URL',status:sessionResp.status,detail:errBody},500);}
      return json({success:true,upload_url:uploadUrl,wo_folder_id:billsWOFolder.id,wo_folder_url:billsWOFolder.webViewLink||'',file_name:fileName});
    }

    // All other file types go into the customer-facing WO folder with subfolders
    let woFolder; if(body.folder_id){woFolder={id:body.folder_id,webViewLink:body.folder_url||''};} else{const woLabel=woId||`upload_${Date.now()}`;woFolder=await findOrCreateFolder(token,woLabel,propFolder.id);if(!woFolder?.id)return json({error:'Cannot create WO folder',wo:woLabel},500);}

    // Route to subfolder by file type
    let targetFolderId = woFolder.id;
    if (fileType === 'before') {
      const sub = await findOrCreateFolder(token,'Before Photos',woFolder.id);
      if (sub?.id) targetFolderId = sub.id;
    } else if (fileType === 'after' || fileType === 'receipt') {
      const sub = await findOrCreateFolder(token,'After + Receipts',woFolder.id);
      if (sub?.id) targetFolderId = sub.id;
    }
    // report and other go flat in WO folder

    const sessionResp=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Upload-Content-Type':mimeType,'Origin':body.origin||'https://ridge-co.github.io'},body:JSON.stringify({name:fileName,parents:[targetFolderId]})});
    const uploadUrl=sessionResp.headers.get('Location'); if(!uploadUrl){const errBody=await sessionResp.text();return json({error:'Drive did not return upload URL',status:sessionResp.status,detail:errBody},500);}
    return json({success:true,upload_url:uploadUrl,wo_folder_id:woFolder.id,wo_folder_url:woFolder.webViewLink||'',file_name:fileName});
  } catch(e){return json({error:e.message,step:'create_upload_session'},500);}
}

// File types whose media stays PRIVATE — vendor cost docs never go anyone-with-link (FEATURE_LOG rule 13).
const NON_SHARE_FILE_TYPES = ['receipt','bill','invoice'];

async function logAttachment(env, body) {
  try {
    await addRow(env,'Attachments',{WO_ID:body.wo_id||'',File_Name:body.file_name||'',File_Type:body.file_type||'photo',Drive_File_ID:body.file_id||'',Drive_URL:body.file_url||'',Mime_Type:body.mime_type||'',Created_Date:new Date().toISOString().split('T')[0],Active:'TRUE'});
    // Share the just-uploaded job media anyone-with-link so it opens in the portal without a Google
    // login. This is the resumable-upload path the vendor portal uses (createUploadSession → PUT → here).
    const ft=(body.file_type||'').toLowerCase();
    if(body.file_id && !NON_SHARE_FILE_TYPES.includes(ft)){ try{ const tok=await getAccessToken(env); await driveShareAnyone(tok, body.file_id); }catch(_){ /* non-fatal */ } }
    if(body.wo_folder_url){await updateWOField(env,body.wo_id,'Drive_Folder_URL',body.wo_folder_url);await updateWOField(env,body.wo_id,'Drive_Folder_ID',body.wo_folder_id||'');}
    return json({success:true});
  } catch(e){return json({error:e.message},500);}
}

// One-time backfill: share every existing job-media attachment anyone-with-link so photos/videos on
// past work orders open in the portal without a Google login. Skips vendor cost docs (receipt/bill/
// invoice — FEATURE_LOG rule 13). Idempotent: re-sharing an already-public file is harmless.
// Body: { dry_run?:true, limit?:N }. Secret-gated (admin).
async function adminShareAttachments(env, body) {
  body = body || {};
  const dryRun = body.dry_run === true;
  const limit = Number.isInteger(body.limit) && body.limit > 0 ? body.limit : 0;
  try {
    const rows = await fetchTab(env, 'Attachments');
    const token = await getAccessToken(env);
    if (!token) return json({ error: 'Failed to get Google access token' }, 500);
    let scanned = 0, shareable = 0, shared = 0, skippedInternal = 0, skippedNoId = 0, failed = 0;
    const failures = [];
    for (const r of rows) {
      scanned++;
      if (r.Active === 'FALSE') continue;
      const ft = (r.File_Type || '').toLowerCase();
      if (NON_SHARE_FILE_TYPES.includes(ft)) { skippedInternal++; continue; }
      const fileId = r.Drive_File_ID || '';
      if (!fileId) { skippedNoId++; continue; }
      shareable++;
      if (limit && shared >= limit) continue;
      if (dryRun) continue;
      const ok = await driveShareAnyone(token, fileId);
      if (ok) shared++; else { failed++; if (failures.length < 25) failures.push({ wo: r.WO_ID || '', file: r.File_Name || '', id: fileId }); }
    }
    try { await logTelemetry(env, { Source:'worker', Job_Type:'admin_share_attachments', Skill_Or_Endpoint:'/admin/share-attachments', Success: failed ? 'FALSE' : 'TRUE', Notes:`dry_run=${dryRun} shareable=${shareable} shared=${shared} failed=${failed}` }); } catch(_){}
    return json({ success: true, dry_run: dryRun, scanned, shareable, shared, skipped_internal: skippedInternal, skipped_no_id: skippedNoId, failed, failures });
  } catch (e) { return json({ error: e.message }, 500); }
}

// ── SCHEDULING ───────────────────────────────────────────────

async function scheduleWO(env, body) {
  const workorders=await fetchTab(env,'Work_Orders'); const wo=workorders.find(w=>w.ID===body.wo_id); if(!wo) return json({error:'WO not found'},404);
  const isWithinHour=body.window==='Within 1 hour', today=new Date().toISOString().split('T')[0], schedDate=body.date||today;
  const updates={Scheduled_Date:schedDate,Scheduled_Window:body.window||''};
  if(isWithinHour&&['Assigned','Accepted'].includes(wo.Status)) updates.Status='In Progress';
  await updateWOFields(env,body.wo_id,updates);
  await logWOAudit(env,body.wo_id,body.updated_by||'admin',body.updated_by_role||'admin','Scheduled',wo.Scheduled_Date||'',schedDate+' '+(body.window||''),isWithinHour?'On my way notification':'Appointment scheduled');
  let tenantSMSSent=false, notifyQueued=false;
  if(body.notify_tenant&&wo.Tenant_Notify_Updates!=='FALSE'){
    const [units,tenants,properties]=await fetchTabs(env, ['Units','Tenants','Properties']);
    const unit=units.find(u=>u.ID===wo.Unit_ID), tenant=tenants.find(t=>t.ID===(unit?.Tenant_ID||wo.Tenant_ID)), property=properties.find(p=>p.ID===wo.Property_ID);
    const address=property?property.Address+(unit?' Unit '+unit.Unit_Label:''):'your address';
    if(isTenantNotifiable(tenant,wo)){
      const dateStr=new Date(schedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
      const msg=isWithinHour?`Hi ${tenant.First_Name}, your technician is on the way and will arrive within 1 hour for the ${wo.Trade} work at ${address}. Ref: ${body.wo_id}.`:`Hi ${tenant.First_Name}, your ${wo.Trade} appointment at ${address} is scheduled for ${dateStr}, ${body.window}. Ref: ${body.wo_id}.`;
      const now=new Date(), tomorrow=new Date(now); tomorrow.setDate(tomorrow.getDate()+1); const tomorrowStr=tomorrow.toISOString().split('T')[0];
      if(schedDate===today||isWithinHour){await sendSMS(env,tenant.Phone,msg);await logSMS(env,body.wo_id,'tenant_schedule',tenant.ID,tenant.Phone,msg);tenantSMSSent=true;}
      else{let sendAfter;if(schedDate===tomorrowStr){sendAfter=new Date(now.getTime()+3600000).toISOString();}else{const fivePM=new Date(now);fivePM.setUTCHours(21,0,0,0);if(now<fivePM){sendAfter=fivePM.toISOString();}else{const eightAM=new Date(tomorrow);eightAM.setUTCHours(13,0,0,0);sendAfter=eightAM.toISOString();}}await queueNotification(env,body.wo_id,'tenant_schedule',tenant.Phone,msg,sendAfter);notifyQueued=true;}
    }
  }
  try { await logTelemetry(env, { Source:'worker', Job_Type:'wo_schedule', Skill_Or_Endpoint:'/schedule', Success:'TRUE', Notes:`window=${body.window||''} new_status=${updates.Status||wo.Status||''}` }); } catch(_){}
  return json({success:true,tenant_sms:tenantSMSSent,notify_queued:notifyQueued,new_status:updates.Status||wo.Status});
}

async function queueNotification(env, woId, type, phone, message, sendAfter) {
  try {
    const data=await sheetsRequest(env,'GET',`/values/Notification_Queue`);const rows=data.values||[];if(!rows.length)return;
    const headers=rows[0],now=new Date().toISOString();
    const newRow=headers.map(h=>({ID:String(nextSafeId(rows)),WO_ID:woId,Type:type,Phone:phone,Message:message,Send_After:sendAfter,Sent:'FALSE',Created_At:now}[h]??''));
    await sheetsRequest(env,'POST',`/values/Notification_Queue:append?valueInputOption=RAW`,{values:[newRow]});
  } catch(e){/* non-fatal */}
}

async function processPendingNotifications(env) {
  try {
    const data=await sheetsRequest(env,'GET',`/values/Notification_Queue`); if(!data.values||data.values.length<2) return json({processed:0});
    const [headers,...rows]=data.values;
    const iPhone=headers.indexOf('Phone'),iMsg=headers.indexOf('Message'),iAfter=headers.indexOf('Send_After'),iSent=headers.indexOf('Sent'),iWO=headers.indexOf('WO_ID');
    const now=new Date(); let processed=0;
    for(const row of rows){
      if((row[iSent]||'')==='TRUE') continue;
      const sendAfter=row[iAfter]?new Date(row[iAfter]):null; if(sendAfter&&sendAfter>now) continue;
      const phone=row[iPhone],msg=row[iMsg];
      if(phone&&msg){await sendSMS(env,phone,msg);await logSMS(env,row[iWO]||'','queued_notification','',phone,msg);const rowIndex=rows.indexOf(row);await sheetsRequest(env,'POST',`/values:batchUpdate`,{valueInputOption:'RAW',data:[{range:`Notification_Queue!${col(iSent)}${rowIndex+2}`,values:[['TRUE']]}]});processed++;}
    }
    return json({processed});
  } catch(e){return json({processed:0,error:e.message});}
}

const OWNER_NOTIFY_DEFAULTS={urgent:'always',normal:'key',low:'completion'};
const NOTIFY_TIERS={always:['Assigned','Accepted','In Progress','Scheduled','Complete','Pending Invoice','Invoiced'],key:['Assigned','Scheduled','Complete','Invoiced'],completion:['Complete','Invoiced'],off:[]};

async function getOwnerNotifications(env, url) {
  const ownerId=url.searchParams.get('owner_id'); if(!ownerId) return json({error:'Missing owner_id'},400);
  const owners=await fetchTab(env,'Owners'); const owner=owners.find(o=>o.ID===ownerId); if(!owner) return json({error:'Owner not found'},404);
  return json({method:owner.Notify_Method||'sms',urgent:owner.Notify_Urgent||OWNER_NOTIFY_DEFAULTS.urgent,normal:owner.Notify_Normal||OWNER_NOTIFY_DEFAULTS.normal,low:owner.Notify_Low||OWNER_NOTIFY_DEFAULTS.low});
}

async function saveOwnerNotifications(env, body) {
  if(!body.owner_id) return json({error:'Missing owner_id'},400);
  const fields={}; if(body.method!==undefined) fields.Notify_Method=body.method; if(body.urgent!==undefined) fields.Notify_Urgent=body.urgent; if(body.normal!==undefined) fields.Notify_Normal=body.normal; if(body.low!==undefined) fields.Notify_Low=body.low;
  if(!Object.keys(fields).length) return json({error:'No fields to update'},400);
  await updateRow(env,'Owners',body.owner_id,fields); return json({success:true});
}

async function shouldNotifyOwner(env, wo, statusEvent) {
  const [properties,owners]=await fetchTabs(env, ['Properties','Owners']);
  const prop=properties.find(p=>p.ID===wo.Property_ID); if(!prop) return false;
  const owner=owners.find(o=>o.ID===prop.Owner_ID); if(!owner||!owner.Phone) return false;
  if((owner.Notify_Method||'sms')==='none') return false;
  if(wo.Owner_Notify_Override&&wo.Owner_Notify_Override!=='') return (NOTIFY_TIERS[wo.Owner_Notify_Override]||[]).includes(statusEvent);
  const priority=(wo.Priority||'normal').toLowerCase();
  const tier=(priority==='urgent'?owner.Notify_Urgent:priority==='low'?owner.Notify_Low:owner.Notify_Normal)||OWNER_NOTIFY_DEFAULTS[priority==='urgent'?'urgent':priority==='low'?'low':'normal'];
  return (NOTIFY_TIERS[tier]||[]).includes(statusEvent);
}

async function addWishlistItem(env, body) {
  const data=await sheetsRequest(env,'GET',`/values/Wishlist`); const rows=data.values||[['ID','Text','Created','Active']], headers=rows[0];
  const now=new Date().toISOString().replace('T',' ').split('.')[0];
  const newRow=headers.map(h=>({ID:String(nextSafeId(rows)),Text:body.text||'',Created:now,Active:'TRUE'}[h]??''));
  await sheetsRequest(env,'POST',`/values/Wishlist:append?valueInputOption=RAW`,{values:[newRow]}); return json({success:true});
}

// ── SMS ──────────────────────────────────────────────────────

async function handleInboundSMS(env, request) {
  const params=new URLSearchParams(await request.text()), from=params.get('From')||'', body=(params.get('Body')||'').trim().toUpperCase();
  const vendors=await fetchTab(env,'Vendors'); const vendor=vendors.find(v=>v.Phone&&normalizePhone(v.Phone)===normalizePhone(from));
  if(!vendor) return twilioResponse('Sorry, we could not find your vendor record. Please contact your coordinator.');
  const workorders=await fetchTab(env,'Work_Orders');
  const recentWO=workorders.filter(w=>w.Vendor_ID===vendor.ID&&w.Status==='Assigned').sort((a,b)=>new Date(b.Created_Date)-new Date(a.Created_Date))[0];
  if(!recentWO) return twilioResponse('No open assignments found for your number.');
  const config=await fetchConfig(env); const vendorName=vendor.Name||`${vendor.First_Name||''} ${vendor.Last_Name||''}`.trim();
  if(body==='YES'||body==='Y'){
    await updateWOFields(env,recentWO.ID,{Status:'Accepted'});await logSMS(env,recentWO.ID,'vendor_reply',vendor.ID,from,body);
    await logWOAudit(env,recentWO.ID,vendorName,'vendor','Status',recentWO.Status,'Accepted','Accepted via SMS reply');
    if(config.admin_phone) await sendSMS(env,config.admin_phone,`✅ ${vendorName} accepted ${recentWO.ID} (${recentWO.Trade} @ property ${recentWO.Property_ID}).`);
    return twilioResponse(vendor.Language==='es'?`Entendido. Confirmado para ${recentWO.ID}. Contacte al inquilino para programar la fecha.`:`Got it! You're confirmed for ${recentWO.ID}. Contact the tenant to schedule.`);
  }
  if(body==='NO'||body==='N'){
    await updateWOFields(env,recentWO.ID,{Status:'Declined',Vendor_ID:''});await logSMS(env,recentWO.ID,'vendor_reply',vendor.ID,from,body);
    await logWOAudit(env,recentWO.ID,vendorName,'vendor','Status',recentWO.Status,'Declined','Declined via SMS reply');
    if(config.admin_phone) await sendSMS(env,config.admin_phone,`❌ ${vendorName} declined ${recentWO.ID}. Needs reassignment.`);
    return twilioResponse(vendor.Language==='es'?`Entendido. Su coordinador ha sido notificado.`:`Understood. Your coordinator has been notified.`);
  }
  await logSMS(env,recentWO.ID,'vendor_reply',vendor.ID,from,body);
  if(config.admin_phone) await sendSMS(env,config.admin_phone,`💬 ${vendorName} replied to ${recentWO.ID}: "${body}"`);
  return twilioResponse(`Message received. Your coordinator will follow up.`);
}

async function sendSMS(env, to, message) {
  to = normalizePhone(to);
  if (!to) return { error: 'No phone number' };
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(`${env.TWILIO_SID}:${env.TWILIO_AUTH}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: env.TWILIO_FROM, To: to, Body: message }).toString(),
  });
  return resp.json();
}

async function logSMS(env, woId, recipientType, recipientId, phone, message) {
  try {
    const data=await sheetsRequest(env,'GET',`/values/SMS_Logs`);const rows=data.values||[[]];const headers=rows[0];const now=new Date().toISOString();
    const newRow=headers.map(h=>({ID:String(nextSafeId(rows)),WO_ID:woId||'',Recipient_Type:recipientType||'',Recipient_ID:recipientId||'',Phone:phone||'',Message:message||'',Sent_Date:now,Status:'sent',Twilio_SID:''}[h]??''));
    await sheetsRequest(env,'POST',`/values/SMS_Logs:append?valueInputOption=RAW`,{values:[newRow]});
  } catch(e) { /* non-fatal — SMS already sent, logging is secondary */ }
}

// ── DAILY DIGEST (Session 5) ─────────────────────────────────
// Read-only 7am morning digest. buildDigest NEVER writes business data. Delivery
// is gated by Config flags and stays dormant until Brett enables it after Twilio
// send is live. Pulls from live tabs by their real column names.
const DIGEST_CLOSED = ['Paid','Invoiced','Cancelled','Closed','Void'];

function etTodayISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
function etStamp() { return new Date().toLocaleString('en-US', { timeZone:'America/New_York', weekday:'short', month:'short', day:'numeric', year:'numeric' }); }
function daysAgoISO(n) { return new Date(Date.now()-n*86400000).toLocaleDateString('en-CA', { timeZone:'America/New_York' }); }
function activeRows(rows) { return rows.filter(r => String(r.Active||'').toUpperCase() !== 'FALSE'); }

async function buildDigest(env) {
  const today = etTodayISO();
  const [wos, bills, props, vendors, tenants] = await Promise.all([
    fetchTab(env,'Work_Orders').catch(()=>[]),
    fetchTab(env,'Vendor_Bills').catch(()=>[]),
    fetchTab(env,'Properties').catch(()=>[]),
    fetchTab(env,'Vendors').catch(()=>[]),
    fetchTab(env,'Tenants').catch(()=>[]),
  ]);
  const open = wos.filter(w => OPEN_WO_STATUSES.includes(w.Status));
  const isUrgent = w => String(w.Priority||'').toLowerCase()==='urgent';
  const label = w => `WO-${w.ID||'?'} · ${w.Property_Address||('prop '+(w.Property_ID||'?'))}${w.Unit_Label?(' '+w.Unit_Label):''} · ${w.Status}${isUrgent(w)?' · URGENT':''}${w.Description?(' · '+String(w.Description).slice(0,55)):''}`;
  const overdue = open.filter(w => w.Scheduled_Date && w.Scheduled_Date < today && !DIGEST_CLOSED.includes(w.Status));
  const dueToday = open.filter(w => w.Scheduled_Date === today);
  const onHold  = open.filter(w => w.Status === 'On Hold');
  const urgent  = open.filter(w => isUrgent(w) && w.Status!=='On Hold' && !overdue.includes(w)).slice(0,6);
  const pendingBills = activeRows(bills).filter(b => String(b.Status||'').toLowerCase()==='submitted');
  const billsTotal = pendingBills.reduce((s,b)=> s + (parseFloat(b.Total||b.Customer_Total||0)||0), 0);
  const since = daysAgoISO(4);
  const wins = wos.filter(w => w.Completed_Date && w.Completed_Date >= since).slice(0,6);
  return {
    today, stamp: etStamp(),
    overdue: overdue.map(label), dueToday: dueToday.map(label), onHold: onHold.map(label), urgent: urgent.map(label),
    pendingBills: pendingBills.map(b=>`Bill ${b.ID} · ${b.Vendor_Name||('V-'+(b.Vendor_ID||'?'))} · WO-${b.WO_ID||'?'} · $${(parseFloat(b.Total||b.Customer_Total||0)||0).toFixed(2)}`),
    billsTotal,
    wins: wins.map(w=>`WO-${w.ID} · ${w.Property_Address||('prop '+(w.Property_ID||'?'))} · ${w.Status} · ${String(w.Description||'').slice(0,45)}`),
    pulse: { properties: activeRows(props).length, tenants: activeRows(tenants).length, vendors: activeRows(vendors).length, open_wos: open.length, pending_bills: pendingBills.length },
  };
}

function formatDigestText(d) {
  const L = [];
  L.push(`RIDGE CO — DAILY DIGEST · ${d.stamp}`); L.push('');
  L.push('▶ NEEDS YOU TODAY');
  if (d.overdue.length)  { L.push(`${d.overdue.length} overdue:`); d.overdue.slice(0,6).forEach(x=>L.push('· '+x)); }
  if (d.dueToday.length) { L.push(`${d.dueToday.length} scheduled today:`); d.dueToday.forEach(x=>L.push('· '+x)); }
  if (d.onHold.length)   { L.push(`${d.onHold.length} on hold:`); d.onHold.forEach(x=>L.push('· '+x)); }
  if (d.urgent.length)   { L.push('Urgent open:'); d.urgent.forEach(x=>L.push('· '+x)); }
  if (!d.overdue.length && !d.dueToday.length && !d.onHold.length && !d.urgent.length) L.push('· Nothing flagged — clear runway.');
  L.push(''); L.push('▶ MONEY');
  if (d.pendingBills.length) { L.push(`${d.pendingBills.length} vendor bills to review ($${d.billsTotal.toFixed(2)}):`); d.pendingBills.forEach(x=>L.push('· '+x)); }
  else L.push('· No vendor bills awaiting review.');
  L.push(''); L.push('▶ WINS (last 4 days)');
  if (d.wins.length) d.wins.forEach(x=>L.push('· '+x)); else L.push('· —');
  L.push(''); L.push(`▶ PULSE  ${d.pulse.properties} properties · ${d.pulse.tenants} tenants · ${d.pulse.vendors} vendors · ${d.pulse.open_wos} open WOs`);
  return L.join('\n');
}

async function deliverDigest(env, digest) {
  const cfg = await fetchConfig(env);
  if (String(cfg.digest_enabled||'').toUpperCase() !== 'TRUE') return { delivered:false, reason:'digest_enabled not TRUE (dormant)' };
  const text = formatDigestText(digest);
  const out = { sms:null, email:null };
  if (String(cfg.digest_sms_enabled||'').toUpperCase()==='TRUE' && cfg.digest_sms_to && env.TWILIO_FROM) out.sms = await sendSMS(env, cfg.digest_sms_to, text);
  if (String(cfg.digest_email_enabled||'').toUpperCase()==='TRUE' && cfg.digest_email_to) out.email = await deliverDigestEmail(env, cfg.digest_email_to, 'Ridge Co — Daily Digest', text);
  return { delivered:true, out };
}

// Email adapter — intentionally a stub until Brett picks a provider (SendGrid /
// Twilio Email / Resend). Turning it on is one function body + one secret; nothing
// else in the digest changes.
async function deliverDigestEmail(env, to, subject, text) {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) return { skipped:'email provider not configured' };
  return { skipped:'adapter not yet wired' };
}

async function digestResponse(env, url) {
  const _t0 = Date.now();
  const digest = await buildDigest(env);
  let delivery = { delivered:false, reason:'preview only (add ?deliver=1 to send)' };
  if (url.searchParams.get('deliver') === '1') delivery = await deliverDigest(env, digest);
  // Best-effort telemetry (B-128). MUST never break the digest — the digest is the
  // product, the telemetry row is a side-effect. Any failure is swallowed on purpose.
  try {
    await logTelemetry(env, {
      Source: 'worker', Job_Type: 'daily_digest', Skill_Or_Endpoint: '/daily-digest',
      Success: 'TRUE', Latency_ms: Date.now() - _t0,
      Notes: (delivery && delivery.delivered) ? 'delivered' : 'preview',
    });
  } catch (_) { /* telemetry is best-effort; never let it take down the host job */ }
  return json({ ok:true, text: formatDigestText(digest), digest, delivery });
}

// ── RECEIPT PIPELINE (Session 5) ─────────────────────────────
// Own-purchase receipts (NOT vendor/WO receipts — those stay in the vendor-portal
// flow). Intake → Claude-vision extract → confirm-first queue → on approval, file to
// the Vendors Drive folder. No QuickBooks, no money movement. Additive + safe.
const RECEIPTS_QUEUE_HEADERS = ['ID','Source','Source_File_ID','Source_File_URL','Received_Date','Vendor','Receipt_Date','Total','Category','Handwritten_Note','PO_Reference','Suggested_WO_ID','Suggested_Property_ID','Confidence','Status','Filed_File_URL','Raw_Extract','Notes','Active'];
const RECEIPT_CATEGORIES = ['customer WO','owned-property','BMore business','personal/HSA'];

// Create a tab + header row if missing (self-provisioning — no manual sheet-ops step).
async function ensureTab(env, name, headers) {
  try {
    const data = await sheetsRequest(env, 'GET', `/values/${name}`);
    if (!data.values || !data.values.length) await sheetsRequest(env, 'POST', `/values/${name}:append?valueInputOption=RAW`, { values: [headers] });
    return;
  } catch (e) {
    if (!isMissingTabError(e)) throw e;
    await sheetsRequest(env, 'POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: name } } }] });
    await sheetsRequest(env, 'POST', `/values/${name}:append?valueInputOption=RAW`, { values: [headers] });
  }
}

// ── TELEMETRY SPINE (B-128) ──────────────────────────────────────────────────
// The measurable "state" the Optimizer's outer loop reads (see CONTINUOUS_IMPROVEMENT_
// STRATEGY_v1.0 + TELEMETRY_SPINE_BUILD_BRIEF_v1.0). One tab, two feeders: Worker jobs
// call logTelemetry() directly; Cowork sessions/skills POST /telemetry/log (gated
// by WORKER_SECRET at the top auth gate) at session close. Design rules, load-bearing:
//   (1) `Success` is written by a verifier/caller from the REAL outcome, never a handler's
//       own optimism (the "verifier, not self-agreement" rule).
//   (2) For host endpoints telemetry is BEST-EFFORT — a failed telemetry write must never
//       break the job it measures (see digestResponse: the whole call is try/swallowed).
//   (3) The /telemetry/log endpoint is FAIL-LOUD (500 on write failure) so a broken pipe
//       is visible, not a silent gap the Optimizer would read as "nothing happened".
// Self-provisions its tab via ensureTab — no sheet-op needed; first write creates it.
const TELEMETRY_TAB  = 'Ops_Telemetry';
const TELEMETRY_COLS = ['ID','Timestamp','Source','Session_Id','Job_Type','Skill_Or_Endpoint','Tier_Requested','Model_Used','Escalated','Tokens_In','Tokens_Out','Est_Cost','Latency_ms','Success','Confidence','Human_Corrected','Notes'];
let _telemetryTabReady = false;

async function logTelemetry(env, rec) {
  rec = rec || {};
  // Self-provision the tab (behind an isolate flag), then ensureColumns on EVERY write —
  // FEATURE_LOG rule 37: ensureTab only writes a header to an EMPTY tab, so a pre-existing
  // tab with a drifted/partial header would silently drop fields on append. ensureColumns
  // backfills any missing header before addRow maps values by header name.
  if (!_telemetryTabReady) { await ensureTab(env, TELEMETRY_TAB, TELEMETRY_COLS); _telemetryTabReady = true; }
  await ensureColumns(env, TELEMETRY_TAB, TELEMETRY_COLS);
  const S = (v) => (v === undefined || v === null) ? '' : String(v);
  const row = {
    Timestamp:         rec.Timestamp || new Date().toISOString(),
    Source:            rec.Source || 'worker',
    Session_Id:        S(rec.Session_Id),
    Job_Type:          S(rec.Job_Type),
    Skill_Or_Endpoint: S(rec.Skill_Or_Endpoint),
    Tier_Requested:    S(rec.Tier_Requested),
    Model_Used:        S(rec.Model_Used),
    Escalated:         S(rec.Escalated),
    Tokens_In:         S(rec.Tokens_In),
    Tokens_Out:        S(rec.Tokens_Out),
    Est_Cost:          S(rec.Est_Cost),
    Latency_ms:        S(rec.Latency_ms),
    Success:           S(rec.Success),
    Confidence:        S(rec.Confidence),
    Human_Corrected:   S(rec.Human_Corrected),
    Notes:             S(rec.Notes),
  };
  const res = await addRow(env, TELEMETRY_TAB, row);  // addRow assigns the next ID + appends
  // Landed-guard — FEATURE_LOG rule 19: a write can "succeed" without landing a row. addRow
  // returns a 4xx Response on a missing tab/header and only json({success:true,id}) on a real
  // append. Treat anything else as a failed write and THROW, so /telemetry/log 500s (fail-loud)
  // and host callers swallow a genuine error rather than the Optimizer reading a silent hole.
  let landed = !!res && res.status === 200;
  if (landed) { try { const j = await res.clone().json(); landed = !!(j && j.success === true && j.id); } catch (_) { landed = false; } }
  if (!landed) throw new Error(`telemetry row did not land (addRow status ${res && res.status})`);
  return res;
}

// POST /telemetry/log — the Cowork/skill feeder. Not in PUBLIC_PATHS and no role scope
// allows it, so the top auth gate already pins it to WORKER_SECRET. Fail-loud by design.
async function telemetryLog(env, body) {
  try {
    return await logTelemetry(env, body || {});
  } catch (e) {
    return json({ error: 'telemetry write failed', detail: String((e && e.message) || e) }, 500);
  }
}

// ── OPTIMIZER: WEEKLY REVIEWER (B-129) ───────────────────────────────────────
// The "Review" step of CONTINUOUS_IMPROVEMENT_STRATEGY_v1.0, running where it can
// actually authenticate: a Worker cron (Mondays 8am ET) with full env access —
// Sheets + ANTHROPIC_API_KEY. A fresh Cowork scheduled session can't do this yet
// (no WORKER_SECRET / no BRETT_GH_PAT in a headless run), so the Worker is the home.
// Reads the last 7d of Ops_Telemetry → deterministic metrics + stuck-pattern flags
// (H2) → a ranked, telemetry-grounded proposal from Claude → Ops_Review_Log tab, and
// delivers only if digest delivery is enabled. Also exposed on-demand at GET /ops-review
// so Brett can run + read it now (the model call is best-effort; metrics never depend on it).
const OPS_REVIEW_TAB  = 'Ops_Review_Log';
const OPS_REVIEW_COLS = ['ID','Timestamp','Window_Days','Total_Jobs','Success_Rate','Escalation_Rate','Human_Corrected','Est_Cost','Stuck_Patterns','Proposal','Trigger','Delivered'];

async function readTelemetryRows(env, days) {
  let data;
  try { data = await sheetsRequest(env, 'GET', `/values/${TELEMETRY_TAB}`); }
  catch (e) { if (isMissingTabError(e)) return []; throw e; }   // no tab yet = no data, not an error
  const rows = data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  const objs = rows.slice(1).map(r => { const o = {}; headers.forEach((h, i) => { o[h] = (r[i] !== undefined) ? r[i] : ''; }); return o; });
  if (!days) return objs;
  const cutoff = Date.now() - days * 86400000;
  // Drop rows with an unparseable timestamp from a WINDOWED query — an undated stale row
  // must not inflate metrics.total or skew rates (reviewer LOW-3).
  return objs.filter(o => { const t = Date.parse(o.Timestamp || ''); return isNaN(t) ? false : t >= cutoff; });
}

function computeTelemetryMetrics(rows) {
  const isTrue  = v => String(v).toUpperCase() === 'TRUE';
  const isFalse = v => String(v).toUpperCase() === 'FALSE';
  const bySource = {}, byJob = {};
  let escalated = 0, humanCorrected = 0, cost = 0, latSum = 0, latN = 0, successKnown = 0, successTrue = 0;
  for (const r of rows) {
    bySource[r.Source || '(none)'] = (bySource[r.Source || '(none)'] || 0) + 1;
    const jt = r.Job_Type || '(none)';
    byJob[jt] = byJob[jt] || { count: 0, fail: 0, corrected: 0 };
    byJob[jt].count++;
    if (isTrue(r.Escalated)) escalated++;
    if (isTrue(r.Human_Corrected)) { humanCorrected++; byJob[jt].corrected++; }
    if (isFalse(r.Success)) byJob[jt].fail++;
    if (r.Success !== undefined && r.Success !== '') { successKnown++; if (isTrue(r.Success)) successTrue++; }
    const c = parseFloat(r.Est_Cost);   if (Number.isFinite(c)) cost += c;
    const l = parseFloat(r.Latency_ms); if (Number.isFinite(l)) { latSum += l; latN++; }
  }
  // Stuck-pattern flags (H2): a job type looping on the same failure or repeatedly corrected.
  const stuck = [];
  for (const [jt, m] of Object.entries(byJob)) {
    if (m.fail >= 2)      stuck.push(`${jt}: ${m.fail} failures`);
    if (m.corrected >= 2) stuck.push(`${jt}: ${m.corrected} human-corrections`);
  }
  return {
    total: rows.length, bySource, byJob,
    escalated, escalation_rate: rows.length ? +(escalated / rows.length).toFixed(3) : 0,
    human_corrected: humanCorrected,
    success_rate: successKnown ? +(successTrue / successKnown).toFixed(3) : null,
    est_cost_total: +cost.toFixed(4), avg_latency_ms: latN ? Math.round(latSum / latN) : null,
    stuck_patterns: stuck,
  };
}

async function llmReviewProposal(env, metrics, days) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const prompt = `You are "The Optimizer" — a supervisory continuous-improvement reviewer for Brett's property-maintenance automation (BrettOS). You are given ${days} days of operational telemetry metrics as JSON. Produce a SHORT, ranked improvement proposal in Brett's style: direct, scannable, no cheerleading; each item is one concrete next action with payoff / effort / risk.

Rules:
- Rank by impact (recurring time or cost saved, or an effectiveness/accuracy gain), highest first. Max 5 items.
- Ground EVERY item in the metrics — cite the number that motivates it. No generic advice.
- If a job_type shows repeated failures or human-corrections (see stuck_patterns), call it out as a stuck loop to fix by CHANGING approach, not retrying the same thing.
- If escalation_rate is high, flag likely model mis-tiering. If one job_type dominates cost, flag it.
- End with exactly one line: the single highest-leverage action for this week.
Return plain text, no markdown headers.

TELEMETRY METRICS (${days}d):
${JSON.stringify(metrics, null, 2)}`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }) });
  const data = await resp.json();
  const txt = (data.content && data.content[0] && data.content[0].text || '').trim();
  if (!txt) throw new Error('empty LLM response');
  return txt;
}

async function deliverReview(env, metrics, proposal, days) {
  const cfg = await fetchConfig(env);
  if (String(cfg.digest_enabled || '').toUpperCase() !== 'TRUE') return { delivered: false, reason: 'digest_enabled not TRUE (dormant)' };
  const pct = (x) => (x == null ? 'n/a' : Math.round(x * 100) + '%');
  const text = `Ridge Co — Weekly Ops Review (${days}d)\n${metrics.total} jobs · success ${pct(metrics.success_rate)} · escalation ${pct(metrics.escalation_rate)} · $${metrics.est_cost_total}\n\n${proposal}`;
  const out = {};
  if (String(cfg.digest_sms_enabled || '').toUpperCase() === 'TRUE' && cfg.digest_sms_to && env.TWILIO_FROM) out.sms = await sendSMS(env, cfg.digest_sms_to, text.slice(0, 1400));
  if (String(cfg.digest_email_enabled || '').toUpperCase() === 'TRUE' && cfg.digest_email_to) out.email = await deliverDigestEmail(env, cfg.digest_email_to, 'Ridge Co — Weekly Ops Review', text);
  return { delivered: true, out };
}

async function runWeeklyReview(env, opts) {
  opts = opts || {};
  const days = opts.days || 7;
  const rows = await readTelemetryRows(env, days);
  const metrics = computeTelemetryMetrics(rows);
  let proposal;
  if (metrics.total < 5) {
    proposal = `Not enough telemetry yet (${metrics.total} row(s) in ${days}d). The spine is collecting — a data-backed ranked proposal needs a bit more history. This will get sharper every week as jobs accrue.`;
  } else {
    try { proposal = await llmReviewProposal(env, metrics, days); }
    catch (e) { proposal = `(Model proposal unavailable this round: ${String((e && e.message) || e)}.) Metrics captured below.`; }
  }
  // Deliver first (gated), so the history row records the REAL outcome (reviewer NIT-1).
  let delivery = null;
  if (opts.deliver) { try { delivery = await deliverReview(env, metrics, proposal, days); } catch (_) { delivery = { delivered: false, reason: 'error' }; } }
  const deliveredCol = !opts.deliver ? 'no' : (delivery && delivery.delivered) ? 'yes' : ('attempted:' + ((delivery && delivery.reason) || 'failed'));
  let logged = false;
  try {
    await ensureTab(env, OPS_REVIEW_TAB, OPS_REVIEW_COLS);
    await ensureColumns(env, OPS_REVIEW_TAB, OPS_REVIEW_COLS);
    await addRow(env, OPS_REVIEW_TAB, {
      Timestamp: new Date().toISOString(), Window_Days: String(days), Total_Jobs: String(metrics.total),
      Success_Rate: metrics.success_rate == null ? '' : String(metrics.success_rate),
      Escalation_Rate: String(metrics.escalation_rate), Human_Corrected: String(metrics.human_corrected),
      Est_Cost: String(metrics.est_cost_total), Stuck_Patterns: (metrics.stuck_patterns || []).join(' | '),
      Proposal: proposal, Trigger: opts.trigger || 'manual', Delivered: deliveredCol,
    });
    logged = true;
  } catch (_) { /* history write is best-effort; the review still returns */ }
  // Self-instrument (PAT-031): the reviewer is itself a measured job.
  try { await logTelemetry(env, { Source: 'worker', Job_Type: 'weekly_review', Skill_Or_Endpoint: 'runWeeklyReview', Success: 'TRUE', Notes: `${metrics.total} rows/${days}d` }); } catch (_) {}
  return { ok: true, window_days: days, metrics, proposal, logged, delivery };
}

// GET /ops-telemetry?days=7 — authed read of the telemetry tab (for the Hub + humans).
async function opsTelemetryRead(env, url) {
  const days = parseInt(url.searchParams.get('days') || '7') || 7;
  const rows = await readTelemetryRows(env, days);
  return json({ ok: true, window_days: days, count: rows.length, metrics: computeTelemetryMetrics(rows), rows: rows.slice(-200) });
}

// GET /ops-review-log?limit=N — READ-ONLY latest weekly-review rows (most recent first).
// For the BrettOS Command Center to pull the Optimizer's output. Never spends or writes.
async function opsReviewLogRead(env, url) {
  const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '5') || 5));
  let data;
  try { data = await sheetsRequest(env, 'GET', `/values/${OPS_REVIEW_TAB}`); }
  catch (e) { if (isMissingTabError(e)) return json({ ok: true, rows: [] }); throw e; }
  const rows = data.values || [];
  if (rows.length < 2) return json({ ok: true, rows: [] });
  const headers = rows[0];
  const objs = rows.slice(1).map(r => { const o = {}; headers.forEach((hh, i) => { o[hh] = (r[i] !== undefined) ? r[i] : ''; }); return o; });
  objs.reverse(); // most recent first
  return json({ ok: true, rows: objs.slice(0, limit) });
}

// POST /ops-review {days?} — run the weekly review on demand (test + read). POST because
// it spends (LLM) and writes rows — not idempotent (reviewer LOW-1). Manual runs NEVER
// deliver (LOW-2); only the Monday cron path delivers, by calling runWeeklyReview directly.
async function opsReviewRun(env, body) {
  const days = parseInt((body && body.days) || '7') || 7;
  return json(await runWeeklyReview(env, { days, deliver: false, trigger: 'manual' }));
}

function bytesToB64(buf) {
  const b = new Uint8Array(buf); let s = ''; const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return btoa(s);
}

// Read a receipt image/PDF with Claude vision → strict JSON. Money-facing ⇒ Claude (PAT-031).
async function receiptExtract(env, bytes, mime) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const b64 = bytesToB64(bytes), isPdf = /pdf/i.test(mime);
  const media = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: (String(mime).split(';')[0] || 'image/jpeg'), data: b64 } };
  const prompt = `You are a receipt data extractor for a property-maintenance business. Read this receipt carefully, INCLUDING any hand-written markings AND any printed reference line such as "PO", "LBA/PO", "PO#", account, or job reference (these often carry the account name like "BMORE" or a property address like "1214 n calvert apt 3"). Return ONLY strict minified JSON with keys: vendor (string), date ("YYYY-MM-DD" or ""), total (number or null — the invoice/charged total), handwritten_note (verbatim hand-written text, else ""), po_reference (verbatim the printed PO/LBA/PO/account/job reference line, else ""), invoice_number (the vendor's OWN invoice/receipt number exactly as printed — often labelled Invoice #, Inv No, Receipt #, Ticket #, Order #; return "" if there isn't one or you cannot read it confidently), suggested_category (exactly one of: "customer WO","owned-property","BMore business","personal/HSA"), confidence (0..1). Use BOTH the hand-written note AND the po_reference to choose the category: a property address or job/WO reference ⇒ "customer WO" (or "owned-property" if it's one of Brett's own properties), an account like "BMORE" with no job/property ⇒ "BMore business". Either, both, or neither may be present. JSON only, no prose.`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: [media, { type: 'text', text: prompt }] }] }) });
  const data = await resp.json();
  const txt = (data.content?.[0]?.text || '').trim();
  try { return JSON.parse(txt.replace(/^```json?/i, '').replace(/```$/, '').trim()); }
  catch (e) { return { _raw: txt.slice(0, 300), _parse_error: true, vendor: '', date: '', total: null, handwritten_note: '', invoice_number: '', suggested_category: '', confidence: 0 }; }
}

// Best-effort auto-link to a WO (by "WO-1234" in the note) or a property (address token).
async function autoLinkReceipt(env, ex) {
  const out = { wo_id: '', property_id: '' };
  const note = `${ex.handwritten_note || ''} ${ex.po_reference || ''} ${ex.vendor || ''}`.toLowerCase();
  try {
    const m = note.match(/wo[-\s]?(\d{3,5})/);
    if (m) { const wos = await fetchTab(env, 'Work_Orders'); const hit = wos.find(w => String(w.ID) === m[1]); if (hit) out.wo_id = hit.ID; }
    const props = await fetchTab(env, 'Properties');
    const hit = props.find(p => { const a = String(p.Address || '').toLowerCase(); return a && a.length > 4 && note.includes(a.split(' ').slice(0, 2).join(' ')); });
    if (hit) out.property_id = hit.ID;
  } catch (e) { /* best-effort */ }
  return out;
}

// POST /receipt-intake — {file_id | file_url | image_b64(+mime), source} → queue row (pending).
async function receiptIntake(env, body) {
  let bytes, mime, fileId = body.file_id || '', fileUrl = body.file_url || '';
  if (!fileId && fileUrl) fileId = driveIdFromUrl(fileUrl);
  if (fileId) { const tok = await getAccessToken(env); const dl = await driveDownload(tok, fileId); bytes = dl.bytes; mime = dl.mime; }
  else if (body.image_b64) { const bin = atob(body.image_b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); bytes = arr.buffer; mime = body.mime || 'image/jpeg'; }
  else return json({ error: 'need file_id, file_url, or image_b64' }, 400);
  const ex = await receiptExtract(env, bytes, mime);
  const cfg = await fetchConfig(env);
  let defaults = {}; try { defaults = JSON.parse(cfg.receipt_vendor_defaults || '{}'); } catch (e) {}
  const vkey = String(ex.vendor || '').toLowerCase().trim();
  let category = ex.suggested_category || '';
  for (const k in defaults) { if (k && vkey && vkey.includes(k)) { category = defaults[k]; break; } }
  const link = await autoLinkReceipt(env, ex);
  await ensureTab(env, 'Receipts_Queue', RECEIPTS_QUEUE_HEADERS);
  const row = {
    Source: body.source || 'manual', Source_File_ID: fileId || '', Source_File_URL: fileUrl || '', Received_Date: new Date().toISOString(),
    Vendor: ex.vendor || '', Receipt_Date: ex.date || '', Total: (ex.total === null || ex.total === undefined) ? '' : String(ex.total),
    Category: category, Handwritten_Note: ex.handwritten_note || '', PO_Reference: ex.po_reference || '',
    Invoice_Number: ex.invoice_number || '', Suggested_WO_ID: link.wo_id || '', Suggested_Property_ID: link.property_id || '',
    Confidence: String(ex.confidence ?? ''), Status: 'pending', Filed_File_URL: '', Raw_Extract: JSON.stringify(ex).slice(0, 900), Notes: '', Active: 'TRUE',
  };
  const appended = await addRow(env, 'Receipts_Queue', row);
  let newId = ''; try { const j = await appended.json(); newId = j.id || ''; } catch (e) {}
  return json({ ok: true, id: newId, queued: { ...row, ID: newId }, extract: ex });
}

// POST /receipt-scan (also called by cron) — pull new files from the inbox Drive folder.
// Self-provisions the folder the first time so there's no manual setup.
async function receiptScan(env) {
  const cfg = await fetchConfig(env);
  const tok = await getAccessToken(env);
  let folder = cfg.receipts_inbox_folder_id;
  if (!folder) {
    const root = env.DRIVE_PROPERTIES_ROOT;
    if (!root) return json({ ok: true, scanned: 0, note: 'no inbox folder and no DRIVE_PROPERTIES_ROOT to create one' });
    const f = await findOrCreateFolder(tok, 'Receipts_Inbox', root, root);
    if (!f?.id) return json({ error: 'could not create Receipts_Inbox' }, 500);
    folder = f.id;
    await setConfigKey(env, { key: 'receipts_inbox_folder_id', value: folder });
    return json({ ok: true, scanned: 0, provisioned: true, folder_id: folder, folder_url: f.webViewLink || '', note: 'Receipts_Inbox created — drop receipts here, then scan again.' });
  }
  const params = new URLSearchParams({ q: `'${folder}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', pageSize: '50' });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${tok}` } });
  const data = await res.json(); const files = data.files || [];
  let existing = []; try { existing = await fetchTab(env, 'Receipts_Queue'); } catch (e) {}
  const seen = new Set(existing.map(r => r.Source_File_ID).filter(Boolean));
  let n = 0; const errs = [];
  for (const f of files) { if (seen.has(f.id)) continue; try { await receiptIntake(env, { file_id: f.id, source: 'drive' }); n++; } catch (e) { errs.push(f.name + ': ' + (e.message || 'err')); } }
  return json({ ok: true, folder_id: folder, scanned: n, skipped: files.length - n, errors: errs });
}

async function listReceiptQueue(env, url) {
  let rows = []; try { rows = await fetchTab(env, 'Receipts_Queue'); } catch (e) { return json([]); }
  const status = url.searchParams.get('status') || 'pending';
  return json(rows.filter(r => String(r.Active || '').toUpperCase() !== 'FALSE' && (status === 'all' || (r.Status || 'pending') === status)));
}

// POST /receipt-queue/approve — {id, corrections?} → file to Vendors Drive, mark filed, learn vendor default.
async function approveReceiptQueue(env, body) {
  const id = body.id; if (!id) return json({ error: 'id required' }, 400);
  const rows = await fetchTab(env, 'Receipts_Queue'); const row = rows.find(r => String(r.ID) === String(id));
  if (!row) return json({ error: 'queue row not found' }, 404);
  const c = body.corrections || {};
  const vendor = c.vendor ?? row.Vendor, date = c.date ?? row.Receipt_Date, total = c.total ?? row.Total, category = c.category ?? row.Category;
  const woId = c.wo_id ?? row.Suggested_WO_ID, propId = c.property_id ?? row.Suggested_Property_ID;
  const cfg = await fetchConfig(env); const dest = cfg.receipts_dest_folder_id || env.DRIVE_VENDORS_ROOT;
  let filedUrl = '';
  const fileId = row.Source_File_ID || driveIdFromUrl(row.Source_File_URL);
  if (fileId && dest) {
    try {
      const tok = await getAccessToken(env); const dl = await driveDownload(tok, fileId);
      const ext = /pdf/i.test(dl.mime) ? '.pdf' : /png/i.test(dl.mime) ? '.png' : '.jpg';
      const safe = s => String(s || '').replace(/[^\w .-]/g, '_').slice(0, 40);
      const name = `${date || 'nodate'}_${safe(vendor)}_${safe(total)}${ext}`;
      const up = await uploadFileToDrive(tok, dl.bytes, name, dl.mime, dest, dest);
      filedUrl = up.webViewLink || '';
    } catch (e) { /* filing best-effort — still mark reviewed */ }
  }
  await updateRow(env, 'Receipts_Queue', id, { Vendor: vendor, Receipt_Date: date, Total: String(total), Category: category, Suggested_WO_ID: woId, Suggested_Property_ID: propId, Status: 'filed', Filed_File_URL: filedUrl });
  try { const vk = String(vendor || '').toLowerCase().trim(); if (vk && category) { const d = JSON.parse(cfg.receipt_vendor_defaults || '{}'); d[vk] = category; await setConfigKey(env, { key: 'receipt_vendor_defaults', value: JSON.stringify(d) }); } } catch (e) {}
  return json({ ok: true, id, filed: filedUrl || null, category });
}

// ── GOOGLE SHEETS / AUTH ─────────────────────────────────────

function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

// ── Scoped session tokens (SEC-1 / B-093) ──────────────────────────────────────
// PIN login issues a signed, role-scoped token so portals never carry the admin
// secret. HMAC-SHA256 over the payload; integrity-protected (not secret). Same code
// is offline-tested in test/session-auth.test.mjs.
const _tenc = new TextEncoder(), _tdec = new TextDecoder();
function _b64urlBytes(bytes){ let s=''; for(const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function _b64urlToBytes(str){ str=str.replace(/-/g,'+').replace(/_/g,'/'); while(str.length%4) str+='='; const bin=atob(str); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
async function _hmac(data, secret){ const key=await crypto.subtle.importKey('raw', _tenc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']); const sig=await crypto.subtle.sign('HMAC', key, _tenc.encode(data)); return _b64urlBytes(new Uint8Array(sig)); }
async function makeSessionToken(payloadObj, secret, ttlSeconds){ const now=Math.floor(Date.now()/1000); const payload={...payloadObj, iat:now, exp:now+(ttlSeconds||60*60*24*90)}; const body=_b64urlBytes(_tenc.encode(JSON.stringify(payload))); const sig=await _hmac(body, secret); return `${body}.${sig}`; }
async function verifySessionToken(token, secret){ if(typeof token!=='string'||token.indexOf('.')<0) return null; const [body,sig]=token.split('.'); if(!body||!sig) return null; const expected=await _hmac(body, secret); if(sig.length!==expected.length) return null; let diff=0; for(let i=0;i<sig.length;i++) diff|=sig.charCodeAt(i)^expected.charCodeAt(i); if(diff!==0) return null; let payload; try{ payload=JSON.parse(_tdec.decode(_b64urlToBytes(body))); }catch(e){ return null; } const now=Math.floor(Date.now()/1000); if(!payload.exp||payload.exp<now) return null; return payload; }
const ROLE_SCOPES = {
  vendor: ['/vendor-by-pin','/vendor-workorders','/vendor-bills','/vendor-bill/add','/receipts','/receipt/add','/receipt/delete','/time-entries','/time-entry/add','/time-entry/delete','/status','/upload-photo','/wishlist/add','/schedule','/attachments','/create-upload-session','/estimate','/estimates','/log-attachment','/nearby-wos'],
  tenant: ['/tenant-by-pin','/tenant-workorders','/attachments','/wo/add-note','/wishlist/add','/create-upload-session','/log-attachment','/workorder','/upload-photo'],
  owner:  ['/owner-by-pin','/owner-workorders','/owner-properties','/owner-notifications','/owner/notifications','/attachments','/wo-audit','/wo/add-note','/wo/append-description','/wo/owner-update','/wo/set-tenant-visibility','/workorder','/wishlist/add','/create-upload-session','/log-attachment','/owner/billing','/owner/get-billing','/upload-photo'],
};
function isPathAllowedForRole(path, role){ const s = ROLE_SCOPES[role]; return !!(s && s.includes(path)); }

// The service-account token is valid for an hour. Minting a fresh one on every
// Sheets call doubled the outbound requests (a token POST per read) and added
// latency for nothing. Cache it in the isolate and reuse until it is about to
// expire. Keyed by SA email so a staging/prod env swap can never reuse the wrong
// credential. This is an app credential, not user data — safe to share across
// requests in the same isolate.
let __sheetsToken = { key: '', token: '', exp: 0 };
async function getAccessToken(env) {
  const now=Math.floor(Date.now()/1000);
  const cacheKey=env.GOOGLE_SA_EMAIL||'';
  if(__sheetsToken.token && __sheetsToken.key===cacheKey && __sheetsToken.exp>now+60) return __sheetsToken.token;
  const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=b64url(JSON.stringify({iss:env.GOOGLE_SA_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now}));
  const sigInput=`${header}.${claim}`, key=await importPrivateKey(env.GOOGLE_SA_KEY);
  const jwt=`${sigInput}.${await signRS256(sigInput,key)}`;
  const resp=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`});
  const data=await resp.json(); if(!data.access_token) throw new Error('Google auth failed: '+JSON.stringify(data));
  __sheetsToken={key:cacheKey, token:data.access_token, exp:now+3600};
  return data.access_token;
}

async function importPrivateKey(pem) {
  const pemBody=pem.replace(/-----BEGIN PRIVATE KEY-----/,'').replace(/-----END PRIVATE KEY-----/,'').replace(/\s/g,'');
  const der=Uint8Array.from(atob(pemBody),c=>c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8',der.buffer,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
}

async function signRS256(input, key) {
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

// Google throttles Sheets reads on a "read requests per minute per user" quota,
// and the whole Hub shares ONE service-account identity, so every user's reads
// pile onto the same per-user bucket. When it trips, Google returns a 429 and the
// old code threw it straight onto the user's screen. Now a 429 is waited out and
// retried with exponential backoff so a brief throttle self-heals instead of
// erroring. Retry safety by method: a 429 means the request was rate-limited and
// NEVER applied, so it is safe to retry any method (including an append). A 500/503
// is ambiguous — the write may have landed — so those are retried ONLY for GET,
// never for a POST/PUT that could double-write a bill or row.
async function sheetsRequest(env, method, path, body) {
  const MAX_ATTEMPTS=4;
  for(let attempt=1;;attempt++){
    const token=await getAccessToken(env);
    const opts={method,headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}};
    if(body) opts.body=JSON.stringify(body);
    const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}${path}`,opts);
    const data=await res.json();
    if(data.error){
      const code=data.error.code||res.status;
      const retryable = code===429 || ((code===500||code===503) && method==='GET');
      if(retryable && attempt<MAX_ATTEMPTS){
        await new Promise(r=>setTimeout(r, 300*Math.pow(2,attempt-1)+Math.floor(Math.random()*120)));
        continue;
      }
      throw new Error(`Sheets API error on ${method} ${path}: ${data.error.message||JSON.stringify(data.error)}`);
    }
    return data;
  }
}

async function getSheet(env, tab) {
  const data=await sheetsRequest(env,'GET',`/values/${tab}`); if(!data.values||data.values.length<2) return json([]);
  const [headers,...rows]=data.values; return json(rows.map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]||'');return o;}));
}

async function fetchTab(env, tab) {
  const data=await sheetsRequest(env,'GET',`/values/${tab}`); if(!data.values||data.values.length<2) return [];
  const [headers,...rows]=data.values; return rows.map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]||'');return o;});
}

// Read several tabs in ONE HTTP request via values:batchGet instead of one GET
// per tab. A screen that used to fire 5 separate reads (each counted against the
// per-minute quota) now costs a single read. Returns an array of row-object lists
// in the SAME ORDER as `tabs` (batchGet preserves request order), each parsed
// exactly like fetchTab — so callers just swap `Promise.all([fetchTab,...])` for
// `fetchTabs(env,[...])` with no change to the data shape. Still a fresh read
// every time: no caching, no staleness risk to money data.
async function fetchTabs(env, tabs) {
  if(!tabs||!tabs.length) return [];
  const qs=tabs.map(t=>`ranges=${encodeURIComponent(t)}`).join('&');
  const data=await sheetsRequest(env,'GET',`/values:batchGet?${qs}`);
  const ranges=data.valueRanges||[];
  return tabs.map((_,i)=>{
    const values=(ranges[i]&&ranges[i].values)||[];
    if(values.length<2) return [];
    const [headers,...rows]=values; return rows.map(row=>{const o={};headers.forEach((h,idx)=>o[h]=row[idx]||'');return o;});
  });
}

async function health(env) {
  // PUBLIC read-only self-check so an automated agent can verify the Worker
  // without a browser or auth. Row counts per key tab + which sheet it points at
  // (last 6 chars of SHEET_ID, so staging vs prod is visible without leaking it).
  const out = { ok: true, sheet_tail: (env.SHEET_ID || '').slice(-6), tabs: {}, ts: Date.now() };
  for (const t of ['Work_Orders','Vendors','Invoices','Config']) {
    try { const rows = await fetchTab(env, t); out.tabs[t] = rows.length; }
    catch (e) { out.ok = false; out.tabs[t] = 'ERROR: ' + (e && e.message ? e.message : String(e)); }
  }
  return json(out);
}

async function getConfig(env) {
  const data=await sheetsRequest(env,'GET',`/values/Config`); if(!data.values) return json({});
  const config={}; data.values.forEach(([k,v])=>{if(k)config[k]=v||'';}); return json(config);
}

async function fetchConfig(env) {
  try {
    const data=await sheetsRequest(env,'GET',`/values/Config`); if(!data.values) return {};
    const config={}; data.values.forEach(([k,v])=>{if(k)config[k]=v||'';}); return config;
  } catch(e){return {};}
}

async function setConfigKey(env, body) {
  const { key, value } = body;
  if (!key) return json({ error: 'key required' }, 400);
  const data = await sheetsRequest(env, 'GET', '/values/Config');
  const rows = data.values || [];
  const rowIdx = rows.findIndex(r => (r[0]||'').trim() === key);
  if (rowIdx >= 0) {
    const sheetRow = rowIdx + 1;
    await sheetsRequest(env, 'POST', '/values:batchUpdate', {
      valueInputOption: 'RAW',
      data: [{ range: `Config!B${sheetRow}`, values: [[value||'']] }],
    });
  } else {
    await sheetsRequest(env, 'POST', '/values/Config:append?valueInputOption=RAW', {
      values: [[key, value||'']],
    });
  }
  return json({ success: true });
}

function nextSafeId(rows) {
  if(rows.length<=1) return 1;
  const ids=rows.slice(1).map(r=>parseInt(r[0]||'0')).filter(n=>Number.isFinite(n)&&n>0);
  return ids.length>0?Math.max(...ids)+1:1;
}

// PAT-014: a missing tab must surface as a clean, actionable 404 — never a raw
// Sheets stack trace. Reads already swallow this (returning []), which is exactly
// what hid the missing Receipts tab for weeks: /receipts looked healthy while every
// write 500'd. Writes must fail LOUDLY but legibly.
// Resolves the column holding a row's key. Most tabs put "ID" at column 0, but
// Work_Orders does NOT — column 0 is Vendor_Needs_Access and "ID" sits at index 1.
// Matching on r[0] therefore compared against a blank column and silently matched
// nothing, so status/vendor writes reported success while changing nothing. There
// is no "WO_ID" column on Work_Orders; earlier code looked one up and got -1.
// Work_Orders has no WO_ID column, so `w.WO_ID === id` evaluates undefined === undefined
// whenever the caller omits the id — silently matching the FIRST work order in the sheet
// and operating on the wrong record. Require a real id and match only the ID column.
function findWO(workorders, woId) {
  if (!woId) return null;
  return workorders.find(w => w.ID === woId) || null;
}

function idColIndex(headers) {
  const i = headers.indexOf('ID');
  return i >= 0 ? i : 0;
}

function isMissingTabError(e) {
  return /Unable to parse range/i.test(e && e.message || '');
}
function missingTabResponse(tab) {
  return json({ error: `Sheet tab "${tab}" does not exist`, tab, hint: 'Create it via context/sheet-ops/pending.json' }, 404);
}

// Server-side backstop against the same submission landing twice.
//
// The portals now hold a client-side latch on every submit button, but a latch dies with
// the page. A dropped connection after the append already committed, a refresh mid-request,
// or the vendor picking the phone back up and tapping again all still produce a real second
// row, and the Sheets `:append` API will take it without complaint. So check before writing.
//
// `signature` is the set of column→value pairs that make two rows "the same submission".
// Matching rows are only treated as duplicates if they were written inside `windowSeconds`;
// tabs that store a full ISO Created_Date get a tight window, tabs that store a date only
// (Vendor_Bills) get a same-day window because that is the finest resolution available.
// A failure in this check must never block a legitimate write — it returns null and the
// caller proceeds to append.
async function findRecentDuplicate(env, tab, signature, windowSeconds) {
  try {
    const rows = await fetchTab(env, tab);
    const cutoff = Date.now() - (windowSeconds || 120) * 1000;
    const keys = Object.keys(signature);
    for (let i = rows.length - 1; i >= 0; i--) {   // newest first — duplicates are recent
      const r = rows[i];
      if (!r || r.Active === 'FALSE') continue;
      if (!keys.every(k => String(r[k] === undefined || r[k] === null ? '' : r[k]) === String(signature[k] === undefined || signature[k] === null ? '' : signature[k]))) continue;
      const ts = Date.parse(r.Created_Date || '');
      // An undateable row must NOT count as a duplicate. Getting this backwards meant any
      // signature-matching row with a blank or hand-typed Created_Date — a bill entered
      // months ago, a row touched by hand — silently swallowed a brand-new submission and
      // reported success, at any age. That loses a vendor's work with a green checkmark on
      // screen, which is far worse than the duplicate this function exists to prevent.
      // When in doubt, let the write through.
      if (!Number.isFinite(ts)) continue;
      if (ts >= cutoff) return r;
    }
    return null;
  } catch (e) { return null; }
}

async function addRow(env, tab, body) {
  let data;
  try { data = await sheetsRequest(env,'GET',`/values/${tab}`); }
  catch(e) { if(isMissingTabError(e)) return missingTabResponse(tab); throw e; }
  const rows=data.values||[[]], headers=rows[0];
  if(!headers||!headers.length) return json({ error:`Sheet tab "${tab}" has no header row`, tab }, 500);
  // Resolve the key column BY HEADER NAME, never r[0] — FEATURE_LOG rule 6. Work_Orders
  // proves the point: its column 0 is Vendor_Needs_Access and ID sits at index 1, so
  // reading r[0] there finds no numbers at all and restarts the sequence from 1 on every
  // insert. Every other tab happens to have ID at 0 today, which is exactly why this stayed
  // invisible. Math.max(...arr) is also swapped for a reduce — Attachments is already 160
  // rows and spreading a large array at the call site is a stack-overflow waiting to happen.
  const _idc = idColIndex(headers);
  let nextId = 1;
  if (rows.length > 1) {
    const maxId = rows.slice(1).reduce((max, r) => {
      const n = parseInt((r && r[_idc]) || '0');
      return (Number.isFinite(n) && n > max) ? n : max;
    }, 0);
    if (maxId > 0) nextId = maxId + 1;
  }
  const PHONE_TABS=['Vendors','Owner_Users','Tenants','Owners']; if(PHONE_TABS.includes(tab)&&body.Phone) body.Phone=normalizePhone(body.Phone);
  const PIN_TABS=['Vendors','Owner_Users','Tenants']; if(PIN_TABS.includes(tab)&&!body.PIN&&body.Phone) body.PIN=generatePIN(body.Phone);
  const newRow=headers.map(h=>{if(h==='ID')return String(nextId);if(h==='Active'&&body[h]===undefined)return 'TRUE';return body[h]!==undefined?String(body[h]):'';});
  await sheetsRequest(env,'POST',`/values/${tab}:append?valueInputOption=RAW`,{values:[newRow]});
  return json({success:true,id:String(nextId),pin:body.PIN||null});
}

async function updateRow(env, tab, id, fields) {
  // Callers pass body.fields straight through, so an omitted `fields` used to throw
  // a raw TypeError on `fields.Phone` before any validation ran.
  if(!fields||typeof fields!=='object') return json({error:'fields object required'},400);
  if(id===undefined||id===null||id==='') return json({error:'id required'},400);
  if(fields.Phone) fields.Phone=normalizePhone(fields.Phone);
  let data;
  try { data = await sheetsRequest(env,'GET',`/values/${tab}`); }
  catch(e) { if(isMissingTabError(e)) return missingTabResponse(tab); throw e; }
  if(!data.values) return json({error:'Tab not found'},404);
  const [headers,...rows]=data.values; const _idc=idColIndex(headers); const rowIndex=rows.findIndex(r=>r[_idc]===String(id));
  if(rowIndex===-1) return json({error:'Row not found'},404);
  const sheetRow=rowIndex+2, updates=[];
  for(const [field,value] of Object.entries(fields)){const colIndex=headers.indexOf(field);if(colIndex!==-1)updates.push({range:`${tab}!${col(colIndex)}${sheetRow}`,values:[[value]]});}
  if(!updates.length) return json({success:true,message:'No matching fields'});
  await sheetsRequest(env,'POST',`/values:batchUpdate`,{valueInputOption:'RAW',data:updates});
  return json({success:true});
}

// ── Contacts sync: augment-ONLY write-back ─────────────────────────────────
// Fills BLANK Hub fields from the operator's Google Contacts. Hard rules:
//   • Only the allow-listed fields below are ever writable (never Phone, ID, PIN…).
//   • A field is written ONLY when its current cell is blank — never overwrites.
//   • preview:true reports what WOULD be written without writing.
//   • Every real write is logged to Contact_Augment_Log (best-effort).
const AUGMENT_ALLOWED_FIELDS = ['Email'];
const AUGMENT_TYPE_TAB = { tenant: 'Tenants', owner: 'Owners', vendor: 'Vendors' };

async function augmentContact(env, body) {
  const type = String((body && body.type) || '').toLowerCase();
  const tab = AUGMENT_TYPE_TAB[type];
  if (!tab) return json({ error: 'type must be tenant|owner|vendor' }, 400);
  const id = body.id;
  if (id === undefined || id === null || id === '') return json({ error: 'id required' }, 400);
  const preview = body.preview === true || body.preview === '1';
  const inFields = (body.fields && typeof body.fields === 'object') ? body.fields : {};

  // Allow-list filter — anything not explicitly allowed (Phone, ID, PIN, …) is dropped.
  const fields = {};
  for (const k of AUGMENT_ALLOWED_FIELDS) {
    if (inFields[k] !== undefined && String(inFields[k]).trim() !== '') fields[k] = String(inFields[k]).trim();
  }
  const rejected = Object.keys(inFields).filter(k => !AUGMENT_ALLOWED_FIELDS.includes(k));
  if (!Object.keys(fields).length)
    return json({ ok: true, type, id, preview, results: [], rejected, message: 'No allow-listed non-empty fields' });

  // Make sure the target column exists (Tenants may not have Email yet). FL rule 37.
  // Skipped in preview so a preview writes NOTHING at all — not even a header.
  if (!preview) await ensureColumns(env, tab, Object.keys(fields));

  let data;
  try { data = await sheetsRequest(env, 'GET', `/values/${tab}`); }
  catch (e) { if (isMissingTabError(e)) return missingTabResponse(tab); throw e; }
  if (!data.values) return json({ error: 'Tab not found' }, 404);
  const [headers, ...rows] = data.values;
  const idc = idColIndex(headers);
  const rowIndex = rows.findIndex(r => r[idc] === String(id));
  if (rowIndex === -1) return json({ error: 'Row not found', type, id }, 404);
  const sheetRow = rowIndex + 2;
  const row = rows[rowIndex];

  const results = [], updates = [];
  for (const [field, value] of Object.entries(fields)) {
    const colIndex = headers.indexOf(field);
    if (colIndex === -1) {
      // Column not present yet. In preview, a new column is definitionally blank.
      if (preview) results.push({ field, written: false, newValue: value, reason: 'would add column + fill blank' });
      else results.push({ field, written: false, reason: 'column missing after ensureColumns' });
      continue;
    }
    const current = (row[colIndex] !== undefined ? String(row[colIndex]) : '').trim();
    if (current !== '') { results.push({ field, written: false, reason: 'already set', current }); continue; } // NEVER overwrite
    results.push({ field, written: !preview, newValue: value, reason: preview ? 'would fill blank' : 'filled blank' });
    updates.push({ range: `${tab}!${col(colIndex)}${sheetRow}`, values: [[value]] });
  }

  if (preview) return json({ ok: true, type, id, preview: true, results, rejected });

  if (updates.length) {
    await sheetsRequest(env, 'POST', `/values:batchUpdate`, { valueInputOption: 'RAW', data: updates });
    for (const r of results) { if (r.written) await logAugment(env, type, id, r.field, '', r.newValue); }
  }
  return json({ ok: true, type, id, preview: false, results, rejected });
}

// Self-creating audit log for augment writes. Never throws into the caller.
async function ensureAugmentLog(env) {
  const TAB = 'Contact_Augment_Log';
  const HEADERS = ['ID', 'Timestamp', 'Type', 'Row_ID', 'Field', 'Old_Value', 'New_Value', 'Written', 'Source'];
  try {
    const data = await sheetsRequest(env, 'GET', `/values/${TAB}`);
    if (data.values && data.values.length) return TAB;
    await sheetsRequest(env, 'POST', `/values/${TAB}:append?valueInputOption=RAW`, { values: [HEADERS] });
    return TAB;
  } catch (e) {
    if (isMissingTabError(e)) {
      await sheetsRequest(env, 'POST', `:batchUpdate`, { requests: [{ addSheet: { properties: { title: TAB } } }] });
      await sheetsRequest(env, 'POST', `/values/${TAB}:append?valueInputOption=RAW`, { values: [HEADERS] });
      return TAB;
    }
    throw e;
  }
}

async function logAugment(env, type, id, field, oldVal, newVal) {
  try {
    const TAB = await ensureAugmentLog(env);
    const data = await sheetsRequest(env, 'GET', `/values/${TAB}`);
    const rows = data.values || [];
    if (!rows.length) return;
    const headers = rows[0];
    const rec = {
      ID: String(nextSafeId(rows)), Timestamp: new Date().toISOString(), Type: type,
      Row_ID: String(id), Field: field, Old_Value: String(oldVal ?? ''),
      New_Value: String(newVal ?? ''), Written: 'TRUE', Source: 'contacts-sync'
    };
    const newRow = headers.map(h => rec[h] ?? '');
    await sheetsRequest(env, 'POST', `/values/${TAB}:append?valueInputOption=RAW`, { values: [newRow] });
  } catch (e) { /* audit must never break the write */ }
}

async function updateWOFields(env, woId, fields) {
  const data=await sheetsRequest(env,'GET',`/values/Work_Orders`); if(!data.values) return;
  const [headers,...rows]=data.values; const _idc=idColIndex(headers); const rowIndex=rows.findIndex(r=>r[_idc]===woId);
  if(rowIndex===-1) return; const sheetRow=rowIndex+2, updates=[];
  for(const [field,value] of Object.entries(fields)){const ci=headers.indexOf(field);if(ci!==-1)updates.push({range:`Work_Orders!${col(ci)}${sheetRow}`,values:[[value]]});}
  if(updates.length) await sheetsRequest(env,'POST',`/values:batchUpdate`,{valueInputOption:'RAW',data:updates});
}

// ── QUICKBOOKS ONLINE (production) ───────────────────────────
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE  = 'https://quickbooks.api.intuit.com/v3/company';

async function qbAccessToken(env) {
  if (!env.QB_CLIENT_ID || !env.QB_CLIENT_SECRET || !env.QB_REALM_ID)
    throw new Error('QB env vars missing (need QB_CLIENT_ID, QB_CLIENT_SECRET, QB_REALM_ID)');
  // Intuit rotates the refresh token. Prefer the rotated value persisted in the Config
  // tab; fall back to the env seed. After a successful refresh, persist the new token.
  let cfg = {}; try { cfg = await fetchConfig(env); } catch (e) {}
  const refresh = (cfg.QB_REFRESH_TOKEN && cfg.QB_REFRESH_TOKEN.trim()) || env.QB_REFRESH_TOKEN;
  if (!refresh) throw new Error('QB refresh token missing (set QB_REFRESH_TOKEN env or Config)');
  const basic = btoa(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`);
  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`,
  });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) {}
  if (!res.ok || !data.access_token) {
    if (text.includes('invalid_grant'))
      throw new Error('QB refresh token expired or revoked — reconnect QuickBooks (re-auth needed).');
    throw new Error(`QB token refresh ${res.status}: ${text.slice(0, 220)}`);
  }
  // Persist the rotated refresh token so the next call uses the fresh one (fixes the
  // old discard-on-every-call bug that would eventually break auth after rotation).
  if (data.refresh_token && data.refresh_token !== refresh) {
    try { await setConfigKey(env, { key: 'QB_REFRESH_TOKEN', value: data.refresh_token }); } catch (e) {}
  }
  return data.access_token;
}

async function qbApi(env, path, method = 'GET', body = null, token = null) {
  if (!token) token = await qbAccessToken(env);
  const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`${QB_API_BASE}/${env.QB_REALM_ID}/${path}`, opts);
  return await res.json();
}

async function qbTest(env) {
  try {
    const info = await qbApi(env, `companyinfo/${env.QB_REALM_ID}?minorversion=73`);
    const name = info?.CompanyInfo?.CompanyName || null;
    return json({ ok: !!name, company: name, detail: name ? undefined : info });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// GET /qb/trade-map — every trade the Hub knows, what QuickBooks account it books to, and
// the full list of expense accounts available. Two trades currently share the General
// account because they have none of their own; this is how you see that and pick better.
// ── REPAIR INVOICES ALREADY IN QUICKBOOKS ────────────────────
// Invoices sent before the line-description and photo-link fixes are already in QuickBooks
// with the description buried in a note, no photo link, and — where custom numbering was
// on — no number. Rather than void and re-create, patch them in place.
//
// Rebuilds the lines from exactly the same inputs the original send used, so the totals
// cannot drift: the customer still owes the same Customer_Total, to the cent.

// The receipts an invoice was approved with, read back by id. The repair path needs the
// same set the send used, or its rebuilt lines would be missing them and the total check
// would fail — or worse, pass while silently dropping a materials line.
async function qbApprovedReceipts(env, ir) {
  const ids = String((ir && ir.Own_Material_IDs) || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!ids.length) return [];
  try {
    const rows = await fetchTab(env, 'Receipts');
    return rows.filter(r => ids.includes(String(r.ID)) && r.Active !== 'FALSE');
  } catch (e) { return []; }
}

// The item an invoice was originally posted against. Reused when repairing so the wording
// changes and the accounting doesn't.
function qbOriginalItemRef(inv) {
  const line = ((inv && inv.Line) || []).find(l => l && l.DetailType === 'SalesItemLineDetail' &&
    l.SalesItemLineDetail && l.SalesItemLineDetail.ItemRef);
  return line ? { value: line.SalesItemLineDetail.ItemRef.value } : null;
}

// GET /qb/repairable?days=N — invoices we can fix, with what's wrong with each.
async function qbRepairable(env, url) {
  try {
    const days = Math.max(1, Math.min(90, parseInt(url && url.searchParams.get('days')) || 7));
    const cutoff = new Date(Date.now() - days * 86400000);
    const token = await qbAccessToken(env);
    const [irs, wos, bills] = await fetchTabs(env, ['Invoice_Review','Work_Orders','Vendor_Bills']);

    const sent = irs.filter(r => r.Active !== 'FALSE' && (r.QB_Invoice_ID || '').trim());
    const out = [];
    for (const ir of sent) {
      const when = new Date(ir.Approved_Date || 0);
      if (!isNaN(when) && when < cutoff) continue;

      const inv = await qbApi(env, `invoice/${encodeURIComponent(ir.QB_Invoice_ID)}?minorversion=73`, 'GET', null, token);
      const q = inv && inv.Invoice;
      if (!q) continue;

      const wo = findWO(wos, ir.WO_ID) || {};
      const billRow = bills.find(b => String(b.ID) === String(ir.Bill_ID)) || {};
      const resolved = resolveTrade(wo.Trade);
      const trade = QB_TRADE_MAP[resolved.name];
      const origItemRef = qbOriginalItemRef(q);
      const rebuilt = buildInvoiceLines(ir, billRow, trade, resolved.name, wo, origItemRef, await qbApprovedReceipts(env, ir));

      const folderId  = wo.Drive_Folder_ID || '';
      const folderUrl = wo.Drive_Folder_URL || (folderId ? ('https://drive.google.com/drive/folders/' + folderId) : '');
      const currentDesc = (q.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail').map(l => l.Description || '').join(' | ');
      const currentMemo = (q.CustomerMemo && q.CustomerMemo.value) || '';

      const qBal = Number(q.Balance);
      const paid = !isNaN(qBal) && Math.abs(qBal - Number(q.TotalAmt || 0)) > 0.005;

      const issues = [];
      if (!q.DocNumber) issues.push('no invoice number');
      if (currentDesc !== rebuilt.lines.map(l => l.Description).join(' | ')) issues.push('line description');
      if (folderUrl && currentMemo.indexOf(folderUrl) === -1) issues.push('photo link missing');
      if (!issues.length) continue;

      out.push({
        ir_id: ir.ID, wo_id: ir.WO_ID, invoice_id: ir.QB_Invoice_ID,
        doc_number: q.DocNumber || '', total: q.TotalAmt,
        paid, balance: isNaN(qBal) ? null : qBal,
        customer: (q.CustomerRef && q.CustomerRef.name) || '',
        issues,
        new_description: rebuilt.lines[0] ? rebuilt.lines[0].Description : '',
        photo_url: folderUrl,
      });
    }
    return json({ ok: true, count: out.length, invoices: out });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/repair-invoice { ir_id, apply?, doc_number? }
async function qbRepairInvoice(env, body) {
  try {
    const irId = String(body.ir_id || '').trim();
    const apply = body.apply === true || String(body.apply).toUpperCase() === 'TRUE';
    if (!irId) return json({ error: 'ir_id required' }, 400);

    const [irs, wos, bills] = await fetchTabs(env, ['Invoice_Review','Work_Orders','Vendor_Bills']);
    const ir = irs.find(r => String(r.ID) === irId);
    if (!ir) return json({ error: `No Invoice_Review row ${irId}` }, 404);
    const qbInvId = (ir.QB_Invoice_ID || '').trim();
    if (!qbInvId) return json({ error: 'That row has no QuickBooks invoice to repair.' }, 400);

    const token = await qbAccessToken(env);
    const got = await qbApi(env, `invoice/${encodeURIComponent(qbInvId)}?minorversion=73`, 'GET', null, token);
    const existing = got && got.Invoice;
    if (!existing) return json({ error: qbFault(got) || 'Could not read that invoice from QuickBooks.' }, 404);

    const wo = findWO(wos, ir.WO_ID) || {};
    const billRow = bills.find(b => String(b.ID) === String(ir.Bill_ID)) || {};
    const resolved = resolveTrade(wo.Trade);
    const trade = QB_TRADE_MAP[resolved.name];
    const origRef = qbOriginalItemRef(existing);
    const rebuilt = buildInvoiceLines(ir, billRow, trade, resolved.name, wo, origRef, await qbApprovedReceipts(env, ir));
    // Without the original item we'd fall back to the freshly-resolved trade, which could
    // move posted revenue to a different income account. Say so rather than doing it.
    const itemWarning = origRef ? '' : 'Could not read the income account this invoice posted to, so it would be re-derived from the trade. Check it in QuickBooks afterwards.';

    // The rebuilt lines MUST still sum to what the customer was told they owe. If they
    // don't, something upstream changed and this stops rather than silently re-pricing
    // an invoice that has already gone out.
    const rebuiltTotal = rebuilt.lines.reduce((n, l) => n + (Number(l.Amount) || 0), 0);
    const owedTotal = Number(ir.Customer_Total) || 0;
    if (Math.abs(rebuiltTotal - owedTotal) > 0.005) {
      return json({ error: `Rebuilt lines total $${rebuiltTotal.toFixed(2)} but the invoice is for $${owedTotal.toFixed(2)}. Not touching it.` }, 409);
    }
    if (Math.abs(Number(existing.TotalAmt || 0) - owedTotal) > 0.005) {
      return json({ error: `The QuickBooks invoice is $${Number(existing.TotalAmt || 0).toFixed(2)} but this row says $${owedTotal.toFixed(2)}. It may have been edited in QuickBooks — sort that out first.` }, 409);
    }
    // A paid invoice keeps its TotalAmt — only the Balance drops — so neither check above
    // catches one. Replacing the lines on a transaction that already has a payment against
    // it is not worth the risk for better wording, and an invoice the customer has already
    // paid doesn't need a photo link.
    const bal = Number(existing.Balance);
    if (isNaN(bal)) {
      return json({ error: 'QuickBooks did not report a balance for that invoice, so there is no way to tell whether it has been paid. Not touching it.' }, 409);
    }
    if (Math.abs(bal - Number(existing.TotalAmt || 0)) > 0.005) {
      return json({ error: `That invoice has a payment against it (balance $${bal.toFixed(2)} of $${Number(existing.TotalAmt || 0).toFixed(2)}). Not touching a paid invoice.` }, 409);
    }

    const folderId  = wo.Drive_Folder_ID || '';
    const folderUrl = wo.Drive_Folder_URL || (folderId ? ('https://drive.google.com/drive/folders/' + folderId) : '');
    const docNumber = String(body.doc_number || '').trim();

    const patch = {
      Id: qbInvId, SyncToken: existing.SyncToken, sparse: true,
      Line: rebuilt.lines,
    };
    if (folderUrl) patch.CustomerMemo = { value: ('View job photos: ' + folderUrl).slice(0, 1000) };
    if (docNumber && !existing.DocNumber) patch.DocNumber = docNumber;

    if (!apply) {
      return json({ ok: true, applied: false, invoice_id: qbInvId, wo_id: ir.WO_ID,
        current_number: existing.DocNumber || '',
        will_set_number: (docNumber && !existing.DocNumber) ? docNumber : '',
        total: owedTotal,
        new_lines: rebuilt.lines.map(l => ({ desc: l.Description, amount: l.Amount })),
        item_warning: itemWarning,
        photo_url: folderUrl });
    }

    // Share the photo folder so the link in the memo actually opens for the customer.
    if (folderId) { try { const gtok = await getAccessToken(env); await driveShareAnyone(gtok, folderId); } catch (e) {} }

    const r = await qbApi(env, 'invoice?minorversion=73', 'POST', patch, token);
    const updated = r && r.Invoice;
    if (!updated) return json({ error: qbFault(r) || 'QuickBooks refused the update.' }, 500);

    return json({ ok: true, applied: true, invoice_id: qbInvId, wo_id: ir.WO_ID,
      doc_number: updated.DocNumber || '', total: updated.TotalAmt,
      photo_linked: !!folderUrl });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// ── WHO DO I NEED TO PAY ─────────────────────────────────────
// The cash-flow question this business actually runs on: the owner pays the invoice, and
// THEN the vendor gets paid. Nothing connected those two facts — the invoice was paid in
// QuickBooks and the Hub had no idea, so knowing who was owed meant cross-checking two
// systems by hand.
//
// Reads the balance on each sent invoice and its bill, and works out where each job sits.
// Read-only against QuickBooks; the only writes are status columns on rows the Hub owns.

// GET /qb/payables?days=N — every sent job with who has paid and who is owed.
async function qbPayables(env, url) {
  try {
    const days = Math.max(1, Math.min(365, parseInt(url && url.searchParams.get('days')) || 90));
    const cutoff = new Date(Date.now() - days * 86400000);
    const token = await qbAccessToken(env);
    const [irs, vendors] = await fetchTabs(env, ['Invoice_Review','Vendors']);

    const rows = [];
    for (const ir of irs) {
      if (ir.Active === 'FALSE') continue;
      const invId = (ir.QB_Invoice_ID || '').trim();
      if (!invId) continue;
      const when = new Date(ir.Approved_Date || 0);
      if (!isNaN(when) && when < cutoff) continue;

      let customerPaid = null, customerBalance = null, invNumber = '';
      try {
        const r = await qbApi(env, `invoice/${encodeURIComponent(invId)}?minorversion=73`, 'GET', null, token);
        const q = r && r.Invoice;
        if (q) {
          customerBalance = Number(q.Balance);
          customerPaid = !isNaN(customerBalance) && customerBalance <= 0.005;
          invNumber = q.DocNumber || '';
        }
      } catch (e) { /* leave null — unknown, not paid */ }

      const billId = (ir.QB_Bill_ID || '').trim();
      let vendorPaid = null, vendorBalance = null, billDue = '', vendorRef = '', vendorTotal = null;
      if (billId) {
        try {
          const r = await qbApi(env, `bill/${encodeURIComponent(billId)}?minorversion=73`, 'GET', null, token);
          const b = r && r.Bill;
          if (b) {
            vendorBalance = Number(b.Balance);
            vendorTotal = Number(b.TotalAmt);
            vendorPaid = !isNaN(vendorBalance) && vendorBalance <= 0.005;
            billDue = b.DueDate || '';
            // The vendor's own reference number (what shows in QuickBooks' Pay Bills "REF NO").
            // Blank when the vendor gave no number — the card falls back to the WO number, which
            // is also what QuickBooks shows in that case, so the two views still line up.
            vendorRef = b.DocNumber || '';
          }
        } catch (e) { /* unknown */ }
      }

      const vendor = vendors.find(v => String(v.ID) === String(ir.Vendor_ID));
      const inHouse = String(ir.QB_In_House || '').toUpperCase() === 'TRUE';

      // Partial detection: a balance that is neither zero nor the whole amount means part-paid.
      const custTotal = Number(ir.Customer_Total) || 0;
      const customerPartial = customerBalance != null && customerBalance > 0.005 && custTotal > 0 && customerBalance < (custTotal - 0.005);
      const vendorPartial = vendorBalance != null && vendorBalance > 0.005 && vendorTotal != null && vendorTotal > 0 && vendorBalance < (vendorTotal - 0.005);

      // The state that matters: money in, money not yet out.
      let state;
      if (inHouse || !billId)          state = 'nothing to pay';
      else if (vendorPaid)             state = 'vendor paid';
      else if (customerPaid)           state = 'PAY THE VENDOR';        // owner has paid in full, vendor hasn't
      else if (customerPartial)        state = 'owner paid in part';    // some money in, not all
      else if (customerPaid === false) state = 'waiting on the owner';
      else                             state = 'unknown';

      rows.push({
        ir_id: ir.ID, wo_id: ir.WO_ID,
        vendor_id: ir.Vendor_ID || '', vendor_name: ir.Vendor_Name || (vendor ? qbVendorDisplayName(vendor) : ''),
        terms: vendorTermLabel(vendor),
        invoice_id: invId, invoice_number: invNumber,
        customer_total: Number(ir.Customer_Total) || 0, customer_balance: customerBalance, customer_paid: customerPaid,
        customer_partial: customerPartial,
        bill_id: billId, vendor_ref: vendorRef, vendor_cost: Number(ir.Vendor_Cost) || 0,
        vendor_balance: vendorBalance, vendor_paid: vendorPaid, vendor_partial: vendorPartial,
        bill_due: billDue, in_house: inHouse, state,
      });
    }

    const owed = rows.filter(r => r.state === 'PAY THE VENDOR');
    return json({
      ok: true, count: rows.length,
      owed_now: owed.length,
      owed_total: +owed.reduce((n, r) => n + (r.vendor_balance != null ? r.vendor_balance : r.vendor_cost), 0).toFixed(2),
      rows,
    });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/sync-payments { days? }
// Writes what QuickBooks says back onto the Hub's own rows, so the payable state is
// visible without going and asking QuickBooks every time.
async function qbSyncPayments(env, body) {
  const url = { searchParams: { get: (k) => (k === 'days' ? String((body && body.days) || 90) : null) } };
  const res = await qbPayables(env, url);
  const data = await res.clone().json();
  if (!data.ok) return res;

  try { await ensureColumns(env, 'Invoice_Review', ['Customer_Paid', 'Vendor_Paid', 'Payable_State', 'Payment_Checked']); }
  catch (e) { /* the report below still stands; only the stored copy is lost */ }

  const now = new Date().toISOString();
  // Auto-close needs the current WO status so we never overwrite one already finished.
  const WO_DONE = ['Paid', 'Cancelled', 'Canceled', 'Closed', 'Void'];
  let workorders = [];
  try { workorders = await fetchTab(env, 'Work_Orders'); } catch (e) { /* flip step just no-ops */ }

  let written = 0, failed = 0, closed = 0;
  const closedWOs = [];
  for (const r of data.rows) {
    try {
      await updateRow(env, 'Invoice_Review', r.ir_id, {
        Customer_Paid: r.customer_paid === null ? '' : (r.customer_paid ? 'TRUE' : 'FALSE'),
        Vendor_Paid:   r.vendor_paid === null ? '' : (r.vendor_paid ? 'TRUE' : 'FALSE'),
        Payable_State: r.state,
        Payment_Checked: now,
      });
      written++;
    } catch (e) { failed++; }

    // When QuickBooks POSITIVELY reports the vendor bill paid, mark the work order Paid so it
    // drops off the active work list. Strictly === true (never on an unknown/null read), and
    // never over a WO already in a done state — so re-running is a safe no-op.
    if (r.vendor_paid === true && r.wo_id) {
      try {
        const wo = findWO(workorders, r.wo_id);
        const cur = wo ? String(wo.Status || '') : '';
        if (wo && !WO_DONE.includes(cur)) {
          await updateWOFields(env, r.wo_id, { Status: 'Paid' });
          try { await logWOAudit(env, r.wo_id, 'system-qb', 'system', 'Status', cur, 'Paid',
            'Vendor bill paid in QuickBooks (' + (r.vendor_ref || ('bill ' + r.bill_id)) + ')'); } catch (e2) {}
          closed++; closedWOs.push({ wo_id: r.wo_id, from: cur, vendor_ref: r.vendor_ref || '' });
        }
      } catch (e) { /* non-fatal: the payable state still saved above */ }
    }
  }
  return json({ ok: true, checked: data.count, written, failed, closed, closed_wos: closedWOs,
                owed_now: data.owed_now, owed_total: data.owed_total, rows: data.rows });
}

async function qbTradeMap(env) {
  try {
    const q = encodeURIComponent("select Id,Name,AccountType,AccountSubType,FullyQualifiedName from Account where Active=true maxresults 500");
    const data = await qbApi(env, `query?query=${q}&minorversion=73`);
    const all = (data && data.QueryResponse && data.QueryResponse.Account) || [];
    const byId = {}; all.forEach(a => { byId[String(a.Id)] = a; });
    const expenses = all.filter(a => /Expense|Cost of Goods Sold/i.test(a.AccountType || ''))
                        .map(a => ({ id: a.Id, name: a.FullyQualifiedName || a.Name, type: a.AccountSubType || a.AccountType }))
                        .sort((x, y) => x.name.localeCompare(y.name));

    const trades = Object.keys(QB_TRADE_MAP).map(t => {
      const m = QB_TRADE_MAP[t];
      const acct = byId[String(m.expense)];
      return { trade: t, expense_id: m.expense, income_id: m.income, item_id: m.item,
               expense_name: acct ? (acct.FullyQualifiedName || acct.Name) : '(not found in QuickBooks)',
               shares_general: String(m.expense) === '68' && t !== 'General' };
    });
    return json({ ok: true, trades, expense_accounts: expenses, aliases: QB_TRADE_ALIASES });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}


async function qbListAccounts(env) {
  try {
    const q = encodeURIComponent("select Id,Name,AccountType,AccountSubType,Classification from Account where Active=true maxresults 500");
    const data = await qbApi(env, `query?query=${q}&minorversion=73`);
    const accounts = (data?.QueryResponse?.Account || []).map(a => ({ id: a.Id, name: a.Name, type: a.AccountType, sub: a.AccountSubType, cls: a.Classification }));
    return json({ ok: true, count: accounts.length, accounts });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}


// ── QUICKBOOKS: ENTITY LOOKUP + MAPPING ──────────────────────
// The Hub's owners/vendors and QuickBooks' customers/vendors are two separate lists.
// Until now nothing connected them except a stored ID column, so an owner with a blank
// column was ALWAYS created fresh in QuickBooks — even when that customer already existed
// there under a slightly different name. "Goldszmidt Properties" vs "Goldszmidt Properties
// LLC" would have quietly become two customers. These helpers read the real QB list so we
// can match first and create only as a genuine last resort.

// QBO's query language is SQL-ish; a name containing an apostrophe ("O'Brien Plumbing")
// terminates the string literal early and the query fails. Doubling it is the escape.
function qbEscape(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }

// The exact DisplayName the send path would use for an owner / a vendor. Extracted so the
// mapping screen matches on the same string that would actually be sent to QuickBooks —
// if these two ever drifted, you'd map a name that never gets looked up.
function qbOwnerDisplayName(o) {
  if (!o) return '';
  return (o.Billing_Name || o.Company || ((o.First_Name || '') + ' ' + (o.Last_Name || '')).trim() || '').trim();
}
function qbVendorDisplayName(v) {
  if (!v) return '';
  return (v.Name || v.Company || ((v.First_Name || '') + ' ' + (v.Last_Name || '')).trim() || '').trim();
}

// Names differ in punctuation and suffix far more often than in substance. Compare on a
// stripped form so "Goldszmidt Properties, LLC." and "goldszmidt properties llc" meet.
function qbNormName(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|properties|property)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Full customer/vendor lists from QuickBooks. Cached briefly so the mapping screen, the
// preview, and a batch of sends don't each pay for the same round trip.
// Each list carries its OWN clock. Sharing one meant fetching vendors refreshed the
// customer list's timestamp too, so an alternating pattern could serve a stale customer
// list forever — and a customer renamed in QuickBooks would keep resolving under its old
// name indefinitely.
const _qbEntityCache = { customer: null, vendor: null, customerAt: 0, vendorAt: 0 };
const QB_ENTITY_TTL_MS = 60000;

async function qbListEntities(env, kind, token, force) {
  const type = kind === 'vendor' ? 'Vendor' : 'Customer';
  const key  = kind === 'vendor' ? 'vendor' : 'customer';
  const atKey = key + 'At';
  const fresh = _qbEntityCache[key] && (Date.now() - _qbEntityCache[atKey]) < QB_ENTITY_TTL_MS;
  if (fresh && !force) return _qbEntityCache[key];
  // Active-only, stated explicitly. QBO happens to default to this, but an archived
  // customer becoming matchable is not something to leave to a default.
  // FullyQualifiedName and ParentRef are what make sub-customers legible: without them a
  // property under one owner is indistinguishable from the same address under another.
  const fields = type === 'Customer'
    ? 'Id, DisplayName, CompanyName, PrimaryEmailAddr, Active, FullyQualifiedName, ParentRef, Job, Level'
    : 'Id, DisplayName, CompanyName, PrimaryEmailAddr, Active';
  const q = encodeURIComponent(`select ${fields} from ${type} where Active = true maxresults 1000`);
  const data = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
  const rows = (data && data.QueryResponse && data.QueryResponse[type]) || [];
  const list = rows.map(r => ({
    id: r.Id,
    name: r.DisplayName || r.CompanyName || '',
    company: r.CompanyName || '',
    email: (r.PrimaryEmailAddr && r.PrimaryEmailAddr.Address) || '',
    active: r.Active !== false,
    parent_id: (r.ParentRef && String(r.ParentRef.value)) || '',
    path: r.FullyQualifiedName || r.DisplayName || '',
    is_sub: r.Job === true || !!(r.ParentRef && r.ParentRef.value),
    level: typeof r.Level === 'number' ? r.Level : 0,
  })).filter(r => r.name && r.active);
  _qbEntityCache[key] = list;
  _qbEntityCache[atKey] = Date.now();
  return list;
}

// Best match for a name against a QB list. Returns { id, name, confidence } or null.
// "exact" is a literal DisplayName hit; "strong" survived normalisation (suffix/punctuation
// only); "weak" is one name containing the other. Weak matches are SUGGESTED to Brett but
// never acted on automatically — guessing wrong here means an invoice on the wrong customer.
function qbMatchEntity(list, name, email) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const arr = Array.isArray(list) ? list : [];
  const em = String(email || '').trim().toLowerCase();

  // COUNT candidates per tier, never take the first. `.find()` was picking arbitrarily
  // between real alternatives: with "Smith Inc" and "Smith Properties LLC" both in
  // QuickBooks, a Hub owner called "Smith Co" normalises to the same "smith" as both, and
  // whichever QuickBooks happened to return first won. QBO does not guarantee ordering,
  // so the same owner could resolve to a different customer on a different day.
  const pick = (matches, confidence) => {
    if (!matches.length) return null;
    if (matches.length > 1) {
      return { id: matches[0].id, name: matches[0].name, confidence: 'ambiguous',
               candidates: matches.slice(0, 6).map(m => ({ id: m.id, name: m.name })) };
    }
    return { id: matches[0].id, name: matches[0].name, confidence };
  };

  const lower = raw.toLowerCase();
  const exact = arr.filter(e => e.name.toLowerCase() === lower);
  if (exact.length) return pick(exact, 'exact');

  const norm = qbNormName(raw);
  if (norm) {
    const strong = arr.filter(e => qbNormName(e.name) === norm || (e.company && qbNormName(e.company) === norm));
    if (strong.length) return pick(strong, 'strong');
  }

  // Email alone is NOT strong evidence here. One owner contact address across several
  // single-property LLCs is the normal shape in property management, so an email hit with
  // nothing corroborating it in the name is a suggestion for Brett, not a decision.
  if (em) {
    const byEmail = arr.filter(e => e.email && e.email.toLowerCase() === em);
    const corroborated = byEmail.filter(e => norm && qbNormName(e.name) === norm);
    if (corroborated.length) return pick(corroborated, 'strong');
    if (byEmail.length) return pick(byEmail, 'weak');
  }

  if (norm && norm.length >= 4) {
    const weak = arr.filter(e => { const n = qbNormName(e.name); return n && (n.indexOf(norm) === 0 || norm.indexOf(n) === 0); });
    if (weak.length) return pick(weak, 'weak');
  }
  return null;
}

// GET /qb/entities — the real QuickBooks customer and vendor lists, each Hub owner/vendor
// paired with its stored mapping and a suggested match for anything unmapped. This is what
// the mapping screen renders.
async function qbEntities(env, url) {
  try {
    const token = await qbAccessToken(env);
    const force = url && url.searchParams.get('refresh') === '1';
    const [customers, vendors, [owners, hubVendors, properties, units]] = await Promise.all([
      qbListEntities(env, 'customer', token, force),
      qbListEntities(env, 'vendor', token, force),
      fetchTabs(env, ['Owners','Vendors','Properties','Units']),
    ]);

    const ownerRows = owners.filter(o => o.Active !== 'FALSE').map(o => {
      const display = qbOwnerDisplayName(o);
      const mapped  = (o.QBO_Customer_ID || '').trim();
      const inQB    = mapped ? customers.find(c => String(c.id) === mapped) : null;
      const subCount = mapped ? customers.filter(c => String(c.parent_id || '') === mapped).length : 0;
      // Owners live at the TOP of the QuickBooks tree. Matching them against the whole
      // customer list meant "Phoenix Estates" was being offered six of its own buildings
      // as candidates — they're sub-customers, and an owner is never one of those.
      const topLevel = customers.filter(c => !c.parent_id);
      // A person and their company are often BOTH customers in QuickBooks, with the
      // properties hanging off one of them. Surface any same-surname top-level customer
      // that has sub-customers, so "you mapped the company but the buildings are under
      // the person" is visible here rather than only inside QuickBooks.
      const surname = String(o.Last_Name || '').trim().toLowerCase();
      const elsewhere = (!mapped || subCount === 0) && surname.length > 2
        ? customers.filter(c => !c.parent_id && String(c.id) !== mapped &&
            new RegExp('\\b' + surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(c.name) &&
            customers.some(x => String(x.parent_id || '') === String(c.id)))
            .map(c => ({ id: c.id, name: c.name, subs: customers.filter(x => String(x.parent_id || '') === String(c.id)).length }))
            .slice(0, 3)
        : [];
      return {
        id: o.ID, display,
        email: o.Billing_Email || o.Email || '',
        qb_id: mapped,
        qb_name: inQB ? inQB.name : '',
        sub_count: subCount,
        elsewhere,
        stale: !!(mapped && !inQB),     // mapped to an id QuickBooks no longer returns
        suggest: mapped ? null : qbMatchEntity(topLevel, display, o.Billing_Email || o.Email || ''),
      };
    });

    const vendorRows = hubVendors.filter(v => v.Active !== 'FALSE').map(v => {
      const display = qbVendorDisplayName(v);
      const mapped  = (v.QBO_Vendor_ID || '').trim();
      const inQB    = mapped ? vendors.find(c => String(c.id) === mapped) : null;
      return {
        id: v.ID, display,
        email: v.Email || '',
        qb_id: mapped,
        qb_name: inQB ? inQB.name : '',
        stale: !!(mapped && !inQB),
        in_house: String(v.In_House || '').toUpperCase() === 'TRUE',
        suggest: mapped ? null : qbMatchEntity(vendors, display, v.Email || ''),
      };
    });

    // Properties nest under their owner in QuickBooks, and units under their property, so
    // each row needs to know whether its parent is linked yet — a sub-customer can't be
    // created without one.
    const ownerById = {}; owners.forEach(o => { ownerById[String(o.ID)] = o; });
    const propRows = properties.filter(p => p.Active !== 'FALSE').map(p => {
      const owner   = ownerById[String(p.Owner_ID)] || null;
      const parentQb = owner ? (owner.QBO_Customer_ID || '').trim() : '';
      const display = qbPropertyDisplayName(p);
      const mapped  = (p.QBO_Customer_ID || '').trim();
      const inQB    = mapped ? customers.find(c => String(c.id) === mapped) : null;
      return {
        id: p.ID, display,
        owner_id: p.Owner_ID || '', owner_name: owner ? qbOwnerDisplayName(owner) : '',
        parent_qb_id: parentQb,
        qb_id: mapped, qb_name: inQB ? (inQB.path || inQB.name) : '',
        stale: !!(mapped && !inQB),
        suggest: mapped ? null : qbMatchAddress(customers, display, parentQb),
      };
    });

    const propById = {}; properties.forEach(p => { propById[String(p.ID)] = p; });
    const unitRows = units.filter(u => u.Active !== 'FALSE').map(u => {
      const prop    = propById[String(u.Property_ID)] || null;
      const parentQb = prop ? (prop.QBO_Customer_ID || '').trim() : '';
      const display = qbUnitDisplayName(u, prop);
      const mapped  = (u.QBO_Customer_ID || '').trim();
      const inQB    = mapped ? customers.find(c => String(c.id) === mapped) : null;
      // Only ever consider this property's own children. Matching a unit label against the
      // whole customer list is how "Apt 1" ended up pointing at another building's flat.
      const siblings = parentQb ? customers.filter(c => String(c.parent_id || '') === String(parentQb)) : [];
      const misparented = !!(inQB && parentQb && String(inQB.parent_id || '') !== String(parentQb));
      return {
        id: u.ID, display,
        property_id: u.Property_ID || '', property_name: prop ? qbPropertyDisplayName(prop) : '',
        parent_qb_id: parentQb,
        qb_id: mapped, qb_name: inQB ? (inQB.path || inQB.name) : '',
        stale: !!(mapped && !inQB),
        // Linked, but sitting under the wrong parent in QuickBooks — or under none.
        misparented,
        actual_parent: misparented ? (customers.find(c => String(c.id) === String(inQB.parent_id)) || {}).name || 'nothing' : '',
        suggest: (mapped || !parentQb) ? null : qbMatchAddress(siblings, display, parentQb),
      };
    });

    return json({ ok: true, qb_customers: customers, qb_vendors: vendors,
                  owners: ownerRows, vendors: vendorRows, properties: propRows, units: unitRows });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

// Which sheet tab and column a mappable kind lives in. Properties and Units both store a
// QuickBooks CUSTOMER id, because a sub-customer is still a customer.
const QB_MAP_KINDS = {
  owner:    { tab: 'Owners',     col: 'QBO_Customer_ID', label: 'owner' },
  vendor:   { tab: 'Vendors',    col: 'QBO_Vendor_ID',   label: 'vendor' },
  property: { tab: 'Properties', col: 'QBO_Customer_ID', label: 'property' },
  unit:     { tab: 'Units',      col: 'QBO_Customer_ID', label: 'unit' },
};

// Is another active Hub record already pointing at this QuickBooks entity? Two Hub owners
// sharing one QB customer silently merges their invoices into one ledger. Used by BOTH the
// manual mapping screen and the automatic send-path persistence — the automatic path used
// to bypass this and could create exactly the state the manual path refuses.
async function qbMappingClash(env, kind, id, qbId) {
  if (!qbId) return null;
  const spec = QB_MAP_KINDS[kind];
  if (!spec) return null;
  const rows = await fetchTab(env, spec.tab);
  return rows.find(r => String(r.ID) !== String(id) && (r[spec.col] || '').trim() === String(qbId) && r.Active !== 'FALSE') || null;
}

// POST /qb/map { kind: 'owner'|'vendor', id, qb_id }
// Writes the link. qb_id '' clears it, which is how you undo a wrong match.
async function qbMapEntity(env, body) {
  const kind = String(body.kind || '').toLowerCase();
  const id   = String(body.id || '').trim();
  const qbId = String(body.qb_id == null ? '' : body.qb_id).trim();
  const spec = QB_MAP_KINDS[kind];
  if (!spec) return json({ error: 'kind must be owner, vendor, property or unit' }, 400);
  if (!id) return json({ error: 'Missing id' }, 400);
  if (qbId && !/^\d+$/.test(qbId)) return json({ error: 'qb_id must be a QuickBooks numeric id' }, 400);

  // Two Hub records pointing at one QuickBooks entity merges their invoices into a single
  // ledger. Usually that's a mistake. But two owner rows for one company — a second contact
  // set up with their own portal login — is a real shape, and refusing it outright leaves
  // no way to express it. So: never by accident, but possible on purpose.
  if (qbId && !(body.allow_shared === true || String(body.allow_shared).toUpperCase() === 'TRUE')) {
    const clash = await qbMappingClash(env, kind, id, qbId);
    if (clash) {
      const who = kind === 'owner' ? qbOwnerDisplayName(clash)
                : kind === 'vendor' ? qbVendorDisplayName(clash)
                : kind === 'property' ? qbPropertyDisplayName(clash)
                : qbUnitLabel(clash);
      return json({
        shared_conflict: true, other_id: clash.ID, other_name: who || ('#' + clash.ID),
        error: `"${who || ('#' + clash.ID)}" is already linked to QuickBooks #${qbId}. Both would bill to the same ledger.`,
      }, 409);
    }
  }

  // Properties and Units have no QuickBooks column until something needs one, and a write
  // to a column that doesn't exist reports success and stores nothing.
  if (kind === 'property' || kind === 'unit') await ensureColumns(env, spec.tab, [spec.col]);
  await updateRow(env, spec.tab, id, { [spec.col]: qbId });
  return json({ success: true, kind, id, qb_id: qbId });
}


// ── QUICKBOOKS SUB-CUSTOMERS: PROPERTY AND UNIT ──────────────
// Owners bill at the top level, but the money is really earned at an address. QuickBooks
// models that as sub-customers: Goldszmidt Properties → 928 N Calvert St → Apt 3R. Until
// now every invoice landed on the owner, so an owner with a dozen buildings had one
// undifferentiated ledger.

// Properties and Units have no QuickBooks column out of the box, and updateRow maps by
// header name — writing to a column that doesn't exist succeeds and stores nothing. That
// silent no-op has bitten this system before, so the column is created before it's used.
async function ensureColumns(env, tab, columns) {
  // Read the WHOLE tab, not just row 1. Sheets trims trailing empty cells, so a column with
  // a blank header but real data underneath makes row 1 look narrower than the sheet is —
  // and appending at that index would drop a new header on top of live data. The widest row
  // is the honest width.
  const data = await sheetsRequest(env, 'GET', `/values/${tab}`);
  const rows = data.values || [];
  const headers = rows[0] || [];
  const missing = columns.filter(c => !headers.includes(c));
  if (!missing.length) return;

  const width = rows.reduce((w, r) => Math.max(w, (r && r.length) || 0), headers.length);

  // Single-cell writes via batchUpdate, the same shape updateRow uses. Rewriting the entire
  // header row would mean two concurrent calls each read the old headers and the second
  // write silently drops the first's column.
  const updates = missing.map((name, i) => ({
    range: `${tab}!${col(width + i)}1`,
    values: [[name]],
  }));
  await sheetsRequest(env, 'POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: updates });
  // Deliberately returns nothing. The obvious return — headers.concat(missing) — would have
  // indices that don't match the sheet whenever a gap was stepped over, which is a trap for
  // whoever uses it next. Callers that need the headers should re-read them.
}

// Addresses differ in abbreviation far more than in substance. "928 N. Calvert Street" and
// "928 N Calvert St" are the same building, and one of them is in QuickBooks already.
const QB_ADDR_WORDS = {
  street: 'st', str: 'st', avenue: 'ave', av: 'ave', boulevard: 'blvd', road: 'rd',
  drive: 'dr', lane: 'ln', court: 'ct', place: 'pl', terrace: 'ter', circle: 'cir',
  parkway: 'pkwy', highway: 'hwy', square: 'sq', trail: 'trl',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  apartment: 'apt', unit: 'apt', suite: 'ste', number: '', building: 'bldg', floor: 'fl',
};

function qbNormAddress(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .map(w => (Object.prototype.hasOwnProperty.call(QB_ADDR_WORDS, w) ? QB_ADDR_WORDS[w] : w))
    .filter(Boolean)
    .join(' ')
    .trim();
}

// The name a property / unit gets in QuickBooks. Street address for the building, the unit
// label nested beneath it — QuickBooks renders the path itself as
// "Goldszmidt Properties:928 N Calvert St:Apt 3R", so repeating the street on the child
// would read as "928 N Calvert St:928 N Calvert St Apt 3R".
function qbPropertyDisplayName(p) {
  return String((p && p.Address) || '').trim();
}
function qbUnitLabel(u) {
  const label = String((u && u.Unit_Label) || '').trim();
  if (!label) return '';
  return /^(apt|unit|ste|suite|#|bldg|fl)\b/i.test(label) ? label : ('Apt ' + label);
}

// The name a unit gets in QuickBooks. It has to carry the building, because DisplayName is
// unique across the WHOLE file — "Apt 1" is not a name, every property has one. Naming them
// all "Apt 1" meant the second one collided with the first and got linked to a unit of a
// different building. QuickBooks still shows the nesting as
// "Goldszmidt Properties:151 W Lanvale St:151 W Lanvale St Apt 1", so the address repeats
// in the path — but a name that's ambiguous on its own is worse than one that's verbose.
function qbUnitDisplayName(u, prop) {
  const label = qbUnitLabel(u);
  if (!label) return '';
  const addr = qbPropertyDisplayName(prop);
  return addr ? (addr + ' ' + label) : label;
}

// Match an address against QuickBooks customers, preferring children of the owner this
// property actually belongs to. Scoping to the owner's sub-tree is what makes this safe:
// "100 Main St" under one owner is a different building from "100 Main St" under another.
function qbMatchAddress(list, name, parentQbId) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const arr = Array.isArray(list) ? list : [];
  const norm = qbNormAddress(raw);
  if (!norm) return null;

  const scoped = parentQbId ? arr.filter(e => String(e.parent_id || '') === String(parentQbId)) : [];
  const pools = scoped.length ? [scoped, arr] : [arr];

  for (const pool of pools) {
    // Compare on the leaf name, and also on the full path's last segment, so a QuickBooks
    // record named with the whole address still meets one named with just the street.
    const hits = pool.filter(e => qbNormAddress(e.name) === norm);
    if (hits.length === 1) return { id: hits[0].id, name: hits[0].name, path: hits[0].path || hits[0].name, confidence: pool === scoped ? 'exact' : 'strong' };
    if (hits.length > 1) {
      return { id: hits[0].id, name: hits[0].name, confidence: 'ambiguous',
               candidates: hits.slice(0, 6).map(h => ({ id: h.id, name: h.path || h.name })) };
    }
  }

  // Nothing matched outright. Offer a containment hit as a suggestion only — an address
  // that merely starts the same ("100 Main St" vs "100 Main St Rear") is a different unit.
  if (norm.length >= 5) {
    const loose = (scoped.length ? scoped : arr).filter(e => {
      const n = qbNormAddress(e.name);
      return n && (n.indexOf(norm) === 0 || norm.indexOf(n) === 0);
    });
    if (loose.length === 1) return { id: loose[0].id, name: loose[0].name, path: loose[0].path || loose[0].name, confidence: 'weak' };
    if (loose.length > 1) return { id: loose[0].id, name: loose[0].name, confidence: 'ambiguous',
                                   candidates: loose.slice(0, 6).map(h => ({ id: h.id, name: h.path || h.name })) };
  }
  return null;
}

// Walk from the most specific linked level outwards. Returns which level the invoice will
// land on and why, so the preview can show it rather than leaving Brett to guess.
function qbResolveBillTo(owner, prop, unit) {
  const unitId  = unit && (unit.QBO_Customer_ID || '').trim();
  const propId  = prop && (prop.QBO_Customer_ID || '').trim();
  const ownerId = owner && (owner.QBO_Customer_ID || '').trim();
  if (unitId)  return { level: 'unit',     qb_id: unitId,  display: qbUnitDisplayName(unit, prop), row: unit };
  if (propId)  return { level: 'property', qb_id: propId,  display: qbPropertyDisplayName(prop), row: prop };
  return { level: 'owner', qb_id: ownerId || '', display: qbOwnerDisplayName(owner), row: owner || null };
}

// Falling back to the owner is not a failure — the invoice sends and the money is right.
// But it is silent, and it does NOT fix itself. Sending an invoice creates the OWNER in
// QuickBooks; it never creates the property beneath them. So a new address invoices at
// owner level the first time, and every time after that, until someone links the property.
// This is the sentence that says so, and it is the only place that says it.
function qbBillToNote(billTo, prop, unit) {
  if (!billTo || billTo.level !== 'owner') return '';
  const addr = qbPropertyDisplayName(prop);
  if (!addr) return '';                       // no address on file — nothing to nest under
  const label = qbUnitLabel(unit);
  const where = label ? (addr + ' ' + label) : addr;
  const ownerLinked = !!(billTo.qb_id || '').trim();
  return `This lands on ${billTo.display || 'the owner'}'s top-level ledger, not ${where} — ` +
    (ownerLinked
      ? 'that property has no QuickBooks sub-customer yet. '
      : 'the owner gets created in QuickBooks by this send, but the property does not. ') +
    'Create it on QB Mapping and later invoices will nest under the building. Sending it now is fine.';
}

// POST /qb/vendor-in-house { id, in_house }
// Marks a vendor as in-house: the work is yours or an employee's, so no QuickBooks Bill is
// created and no payable is raised against a person the business doesn't actually owe.
async function qbSetVendorInHouse(env, body) {
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);
  const on = body.in_house === true || String(body.in_house).toUpperCase() === 'TRUE';
  await ensureColumns(env, 'Vendors', ['In_House']);
  await updateRow(env, 'Vendors', id, { In_House: on ? 'TRUE' : 'FALSE' });
  return json({ success: true, id, in_house: on });
}

// POST /qb/create-subcustomer { kind: 'property'|'unit', id }
// Creates the sub-customer under its parent and stores the id. Only ever on request —
// the same rule as customers: nothing appears in QuickBooks without Brett asking for it.
// POST /qb/reparent-unit { unit_id, apply?, rename? }
// Units already created in QuickBooks under the wrong parent — or under none — because
// "Apt 1" collided with another building's flat. Moves the existing customer under the
// right property rather than making yet another one, and optionally renames it so the
// collision can't recur.
// GET /qb/unit-audit — every unit, what state it's actually in, and what to do about it.
// The mapping screen only ever flagged ONE failure (linked under the wrong parent) and
// showed a green tick for everything else — including states that are not fine at all,
// like a unit linked while its own property isn't. Hence "it's a little confusing".
async function qbUnitAudit(env, url) {
  try {
    const token = await qbAccessToken(env);
    const force = !url || url.searchParams.get('refresh') !== '0';
    const [customers, [units, properties, owners]] = await Promise.all([
      qbListEntities(env, 'customer', token, force),
      fetchTabs(env, ['Units','Properties','Owners']),
    ]);
    const byId = {}; customers.forEach(c => { byId[String(c.id)] = c; });

    const rows = units.filter(u => u.Active !== 'FALSE').map(u => {
      const prop = properties.find(p => String(p.ID) === String(u.Property_ID)) || null;
      const owner = prop ? owners.find(o => String(o.ID) === String(prop.Owner_ID)) : null;
      const unitQb = String(u.QBO_Customer_ID || '').trim();
      const propQb = prop ? String(prop.QBO_Customer_ID || '').trim() : '';
      const ownerQb = owner ? String(owner.QBO_Customer_ID || '').trim() : '';
      const inQB = unitQb ? byId[unitQb] : null;
      const propInQB = propQb ? byId[propQb] : null;
      const wantName = qbUnitDisplayName(u, prop);

      let state, why, fix;
      if (!prop) {
        state = 'no property'; why = 'This unit has no property in the sheet, so there is nothing for it to nest under.'; fix = 'Set its Property_ID in the Units tab.';
      } else if (!ownerQb) {
        state = 'blocked'; why = `The owner (${owner ? qbOwnerDisplayName(owner) : 'none set'}) isn't linked to QuickBooks, so neither the property nor the unit can be.`; fix = 'Link the owner first.';
      } else if (!propQb) {
        state = 'blocked'; why = `"${qbPropertyDisplayName(prop)}" isn't linked to QuickBooks. Nothing can nest under a property that doesn't exist there — which is why this unit shows no problem and can't be moved.`; fix = 'Link or create the property, then come back to this unit.';
      } else if (propQb && !propInQB) {
        state = 'property stale'; why = `The property is linked to QuickBooks #${propQb}, which QuickBooks no longer returns as an active customer.`; fix = 'Re-link the property.';
      } else if (!unitQb) {
        state = 'not linked'; why = 'This unit has no QuickBooks sub-customer yet.'; fix = `Create it — it will be named "${wantName}" under ${qbPropertyDisplayName(prop)}.`;
      } else if (!inQB) {
        state = 'stale'; why = `Linked to QuickBooks #${unitQb}, which QuickBooks no longer returns. It may have been deleted or made inactive.`; fix = 'Clear the link and create it again.';
      } else if (String(inQB.parent_id || '') !== propQb) {
        const actual = inQB.parent_id ? (byId[String(inQB.parent_id)] || {}).name || ('#' + inQB.parent_id) : 'nothing (it is top-level)';
        state = 'wrong parent'; why = `Linked to "${inQB.name}", which sits under ${actual} rather than under ${qbPropertyDisplayName(prop)}.`; fix = 'Move it.';
      } else if (inQB.name !== wantName) {
        state = 'nested, name is ambiguous'; why = `Correctly under ${qbPropertyDisplayName(prop)}, but named "${inQB.name}". QuickBooks names are unique across the whole file, so a bare unit label will collide with another building's.`; fix = `Rename to "${wantName}".`;
      } else {
        state = 'ok'; why = `Nested under ${qbPropertyDisplayName(prop)} and named correctly.`; fix = '';
      }

      return {
        unit_id: u.ID, label: qbUnitLabel(u), want_name: wantName,
        property: prop ? qbPropertyDisplayName(prop) : '', property_id: u.Property_ID || '',
        owner: owner ? qbOwnerDisplayName(owner) : '',
        unit_qb_id: unitQb, unit_qb_name: inQB ? inQB.name : '', unit_qb_path: inQB ? (inQB.path || inQB.name) : '',
        property_qb_id: propQb, owner_qb_id: ownerQb,
        state, why, fix,
        movable: state === 'wrong parent' || state === 'nested, name is ambiguous',
      };
    });

    const counts = {};
    rows.forEach(r => { counts[r.state] = (counts[r.state] || 0) + 1; });
    return json({ ok: true, total: rows.length, counts, rows });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

async function qbReparentUnit(env, body) {
  const unitId = String(body.unit_id || '').trim();
  const apply = body.apply === true || String(body.apply).toUpperCase() === 'TRUE';
  const rename = body.rename !== false;
  if (!unitId) return json({ error: 'unit_id required' }, 400);

  const [units, properties] = await fetchTabs(env, ['Units','Properties']);
  const unit = units.find(u => String(u.ID) === unitId);
  if (!unit) return json({ error: `No unit ${unitId}` }, 404);
  const qbId = (unit.QBO_Customer_ID || '').trim();
  if (!qbId) return json({ error: 'That unit is not linked to QuickBooks yet — create it instead.' }, 400);

  const prop = properties.find(p => String(p.ID) === String(unit.Property_ID));
  if (!prop) return json({ error: 'That unit has no property.' }, 400);
  const parentId = (prop.QBO_Customer_ID || '').trim();
  if (!parentId) return json({ error: `Link "${qbPropertyDisplayName(prop)}" to QuickBooks first — a unit nests under it.` }, 400);

  const token = await qbAccessToken(env);
  const got = await qbApi(env, `customer/${encodeURIComponent(qbId)}?minorversion=73`, 'GET', null, token);
  const cust = got && got.Customer;
  if (!cust) return json({ error: qbFault(got) || 'Could not read that customer from QuickBooks.' }, 404);

  const currentParent = (cust.ParentRef && String(cust.ParentRef.value)) || '';
  const wantName = qbUnitDisplayName(unit, prop);
  const needsMove = currentParent !== String(parentId);
  const needsRename = rename && String(cust.DisplayName || '') !== wantName;

  if (!needsMove && !needsRename) {
    return json({ ok: true, applied: false, nothing_to_do: true,
      message: `"${cust.DisplayName}" is already under ${qbPropertyDisplayName(prop)} with the right name.` });
  }
  // A rename with no move is a legitimate fix on its own: correctly nested, but named
  // something that will collide with another building's unit.


  if (!apply) {
    return json({ ok: true, applied: false, qb_id: qbId,
      current_name: cust.DisplayName || '', current_parent: currentParent,
      new_name: needsRename ? wantName : (cust.DisplayName || ''),
      new_parent: parentId, new_parent_name: qbPropertyDisplayName(prop),
      needs_move: needsMove, needs_rename: needsRename });
  }

  // Sparse update: move it and rename it in one call. QuickBooks keeps the customer's
  // history, so any invoice already on it follows the customer to its new home.
  const patch = { Id: qbId, SyncToken: cust.SyncToken, sparse: true, ParentRef: { value: String(parentId) }, Job: true };
  if (needsRename) patch.DisplayName = wantName;

  const r = await qbApi(env, 'customer?minorversion=73', 'POST', patch, token);
  const updated = r && r.Customer;
  if (!updated) return json({ error: qbFault(r) || 'QuickBooks refused the change.' }, 500);

  _qbEntityCache.customer = null;   // the tree changed
  return json({ ok: true, applied: true, qb_id: qbId,
    name: updated.DisplayName || wantName,
    parent_name: qbPropertyDisplayName(prop),
    note: 'Any invoice already on this customer moved with it — QuickBooks keeps the history.' });
}

// Pure planner for the email backfill. Given the full QuickBooks customer list (as
// qbListEntities returns it — id, name, path, email, parent_id, is_sub), work out which
// sub-customers have no email and what to copy onto each. A unit inherits its property's
// email; a property inherits its owner's. Walk UP the tree to the nearest ancestor that
// actually has an email, so a unit is still fixed even when its property is also blank but
// the owner above it is not. Anything with no email anywhere above it is reported as
// skipped rather than guessed — the fix there is to give the property/owner an email first.
// Kept pure (no env, no I/O) so the test harness can exercise it directly.
function qbResolveEmailBackfill(customers) {
  const list = Array.isArray(customers) ? customers : [];
  const byId = {};
  for (const c of list) byId[String(c.id)] = c;

  const norm = e => String(e || '').trim();
  const toSet = [], skipped = [];

  for (const c of list) {
    const isSub = c.is_sub === true || !!(c.parent_id);
    if (!isSub) continue;                 // owners sit at the top; nothing to inherit
    if (norm(c.email)) continue;          // already has one — never overwrite

    // Climb to the first ancestor carrying an email. Guard against a parent cycle so a bad
    // tree can never spin here.
    let anc = byId[String(c.parent_id)];
    const seen = new Set([String(c.id)]);
    while (anc && !norm(anc.email)) {
      if (seen.has(String(anc.id))) { anc = null; break; }
      seen.add(String(anc.id));
      anc = byId[String(anc.parent_id)];
    }

    if (anc && norm(anc.email)) {
      toSet.push({
        id: String(c.id), name: c.name || c.path || ('#' + c.id),
        path: c.path || c.name || '', current_email: norm(c.email),
        email: norm(anc.email), source_id: String(anc.id),
        source_name: anc.name || anc.path || ('#' + anc.id),
        inherited_from_grandparent: String(anc.id) !== String(c.parent_id),
      });
    } else {
      skipped.push({
        id: String(c.id), name: c.name || c.path || ('#' + c.id),
        path: c.path || c.name || '',
        reason: 'no parent or ancestor in QuickBooks has an email to copy down',
      });
    }
  }
  return { toSet, skipped };
}

// POST /qb/backfill-emails { apply?, ids? }
// Preview-first. With apply falsey it only reports what it WOULD change. With apply true it
// sets PrimaryEmailAddr on each sub-customer that has none, copying the nearest ancestor's
// email down via a sparse update (QuickBooks keeps every other field and all history). An
// optional ids array restricts the write to just those sub-customer ids, so the Hub page
// can let a row be unticked. Idempotent: a sub-customer that already has an email is never
// touched, so re-running only ever fills the ones still blank.
async function qbBackfillEmails(env, body) {
  body = body || {};
  const apply = body.apply === true || String(body.apply).toUpperCase() === 'TRUE';
  const onlyIds = Array.isArray(body.ids) ? body.ids.map(x => String(x).trim()).filter(Boolean) : null;

  try {
    const token = await qbAccessToken(env);
    const customers = await qbListEntities(env, 'customer', token, true); // force fresh — the tree matters
    const { toSet, skipped } = qbResolveEmailBackfill(customers);

    if (!apply) {
      return json({
        ok: true, applied: false,
        total_customers: customers.length,
        to_set_count: toSet.length, skipped_count: skipped.length,
        to_set: toSet, skipped,
      });
    }

    const targets = onlyIds ? toSet.filter(t => onlyIds.includes(String(t.id))) : toSet;
    const updated = [], failed = [];

    for (const t of targets) {
      try {
        // A sparse update needs the current SyncToken, so read the customer first.
        const got = await qbApi(env, `customer/${encodeURIComponent(t.id)}?minorversion=73`, 'GET', null, token);
        const cust = got && got.Customer;
        if (!cust) { failed.push({ id: t.id, name: t.name, error: qbFault(got) || 'could not read customer from QuickBooks' }); continue; }

        // Guard the race: if it already picked up an email since the preview, leave it.
        if (cust.PrimaryEmailAddr && cust.PrimaryEmailAddr.Address) {
          updated.push({ id: t.id, name: t.name, email: cust.PrimaryEmailAddr.Address, already_had: true });
          continue;
        }

        const patch = { Id: String(t.id), SyncToken: cust.SyncToken, sparse: true, PrimaryEmailAddr: { Address: t.email } };
        const r = await qbApi(env, 'customer?minorversion=73', 'POST', patch, token);
        if (r && r.Customer) {
          updated.push({ id: t.id, name: t.name, email: t.email, source_name: t.source_name });
        } else {
          failed.push({ id: t.id, name: t.name, error: qbFault(r) || 'QuickBooks refused the update' });
        }
      } catch (e) {
        failed.push({ id: t.id, name: t.name, error: e.message });
      }
    }

    _qbEntityCache.customer = null; // emails changed; don't serve a stale list
    return json({
      ok: true, applied: true,
      requested: targets.length, updated: updated.length, failed_count: failed.length,
      updated_list: updated, failed, skipped,
    });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

async function qbCreateSubCustomer(env, body) {
  const kind = String(body.kind || '').toLowerCase();
  const id = String(body.id || '').trim();
  if (kind !== 'property' && kind !== 'unit') return json({ error: 'kind must be property or unit' }, 400);
  if (!id) return json({ error: 'Missing id' }, 400);

  const token = await qbAccessToken(env);
  let displayName = '', parentId = '', tab = '', row = null;

  if (kind === 'property') {
    const [properties, owners] = await fetchTabs(env, ['Properties','Owners']);
    row = properties.find(p => String(p.ID) === id);
    if (!row) return json({ error: 'Property not found' }, 404);
    if ((row.QBO_Customer_ID || '').trim()) return json({ error: 'Already linked to QuickBooks #' + row.QBO_Customer_ID }, 409);
    const owner = owners.find(o => String(o.ID) === String(row.Owner_ID));
    if (!owner) return json({ error: 'This property has no owner — set one first.' }, 400);
    parentId = (owner.QBO_Customer_ID || '').trim();
    if (!parentId) return json({ error: `Link the owner "${qbOwnerDisplayName(owner)}" to QuickBooks first — a sub-customer needs a parent.` }, 400);
    displayName = qbPropertyDisplayName(row);
    tab = 'Properties';
  } else {
    const [units, properties] = await fetchTabs(env, ['Units','Properties']);
    row = units.find(u => String(u.ID) === id);
    if (!row) return json({ error: 'Unit not found' }, 404);
    if ((row.QBO_Customer_ID || '').trim()) return json({ error: 'Already linked to QuickBooks #' + row.QBO_Customer_ID }, 409);
    const prop = properties.find(p => String(p.ID) === String(row.Property_ID));
    if (!prop) return json({ error: 'This unit has no property.' }, 400);
    parentId = (prop.QBO_Customer_ID || '').trim();
    if (!parentId) return json({ error: `Link or create "${qbPropertyDisplayName(prop)}" in QuickBooks first — the unit nests under it.` }, 400);
    displayName = qbUnitDisplayName(row, prop);
    tab = 'Units';
  }

  if (!displayName) return json({ error: 'No address or unit label to name this with.' }, 400);

  // Carry the parent's billing email down onto the new sub-customer. Without this a unit
  // is created with a blank email, so an invoice sent for it has nobody to go to — the
  // exact gap the email backfill was built to clean up. Read it from the parent in QB so
  // a property inherits the owner's email and a unit inherits the property's. Best-effort:
  // a missing parent email just means the sub-customer starts blank, same as before.
  let parentEmail = '';
  try {
    const pg = await qbApi(env, `customer/${encodeURIComponent(parentId)}?minorversion=73`, 'GET', null, token);
    parentEmail = (pg && pg.Customer && pg.Customer.PrimaryEmailAddr && pg.Customer.PrimaryEmailAddr.Address) || '';
  } catch (e) {}

  // QuickBooks requires DisplayName to be unique across ALL customers, not just within a
  // parent. Two owners each with a "100 Main St" collide, so fall back to the full path.
  const payload = { DisplayName: displayName, Job: true, ParentRef: { value: String(parentId) } };
  if (parentEmail) payload.PrimaryEmailAddr = { Address: parentEmail };
  let r = await qbApi(env, 'customer?minorversion=73', 'POST', payload, token);
  let newId = (r && r.Customer && r.Customer.Id) || '';

  if (!newId) {
    const dup = qbDupId(r);
    if (dup) {
      // The name is taken by an existing customer. That is a LINK, not a create — but only
      // if it actually sits under the right parent. Otherwise it's someone else's address.
      const all = await qbListEntities(env, 'customer', token, true);
      const existing = all.find(e => String(e.id) === String(dup));
      if (existing && String(existing.parent_id || '') === String(parentId)) {
        await ensureColumns(env, tab, ['QBO_Customer_ID']);
        await updateRow(env, tab, id, { QBO_Customer_ID: String(dup) });
        return json({ success: true, id: String(dup), linked_existing: true, name: existing.path || existing.name });
      }
      return json({ error: `"${displayName}" already exists in QuickBooks under a different parent. Link it manually if it's the right one.` }, 409);
    }
    return json({ error: qbFault(r) || 'QuickBooks would not create that sub-customer' }, 500);
  }

  await ensureColumns(env, tab, ['QBO_Customer_ID']);
  await updateRow(env, tab, id, { QBO_Customer_ID: String(newId) });
  _qbEntityCache.customer = null;          // the tree changed; don't serve a list without it
  return json({ success: true, id: String(newId), name: displayName, parent_id: parentId });
}

// Trade → QB accounts/items map. Income created as sub-accounts of "Services" (5).
// Bills reference the expense account directly; invoices reference the item.
const QB_INCOME_PARENT = '5'; // Services (Income)
const QB_TRADES = [
  { trade: 'Plumbing',    income: 'Plumbing Income',    expenseId: '245' },
  { trade: 'Electrical',  income: 'Electrical Income',  expenseId: '235' },
  { trade: 'HVAC',        income: 'HVAC Income',        expenseId: '239' },
  { trade: 'Painting',    income: 'Painting Income',    expenseId: '243' },
  { trade: 'Flooring',    income: 'Flooring Income',    expenseId: '237' },
  { trade: 'Carpentry',   income: 'Carpentry Income',   expenseId: '218' },
  { trade: 'Roofing',     income: 'Roofing Income',     expenseId: '246' },
  { trade: 'Landscaping', income: 'Landscaping Income', expenseId: '220' },
  { trade: 'Cleaning',    income: 'Cleaning Income',    expenseId: '282', itemName: 'Cleaning Service' }, // a QB *category* already owns the name "Cleaning" (item 22, unusable on invoice lines); the sellable service item is created as "Cleaning Service"
  { trade: 'Appliance',   income: 'Appliance Income',   expenseId: '230' },
  { trade: 'Windows',     incomeId: '204',              expenseId: '249' }, // Window Installation Income exists
  { trade: 'Locks',       income: 'Locks Income',       expenseId: '68'  }, // no dedicated expense account yet
  { trade: 'Pest Control',income: 'Pest Control Income',expenseId: '68'  }, // no dedicated expense account yet
  { trade: 'General',     incomeId: '198',              expenseId: '68'  }, // Repairs Income exists
];

// Resolved trade → QB ids (created via /qb/setup-trades, July 19, 2026).
// Invoices reference `item` (income); vendor bills reference `expense` (account).
// The Hub's dropdowns and the QuickBooks map drifted apart. The work-order form offers
// "Electric" while the map is keyed "Electrical", so EVERY electrical job has been booking
// to the General repairs account. Same for "Pest Control" and "Other", which the map never
// had at all. It warns, but a warning in a batch of eight is a warning nobody reads.
// Aliases resolve the old spellings; existing rows keep working without a data migration.
const QB_TRADE_ALIASES = {
  'electric': 'Electrical', 'electrician': 'Electrical',
  // 'heating' → HVAC: revisit if a dedicated Heating account is ever created, or this
  // alias will keep routing past it without saying so.
  'hvac/heating': 'HVAC', 'heating': 'HVAC', 'ac': 'HVAC', 'a/c': 'HVAC',
  'paint': 'Painting', 'lock': 'Locks', 'locksmith': 'Locks',
  'pest': 'Pest Control', 'exterminator': 'Pest Control',
  'clean': 'Cleaning', 'floor': 'Flooring', 'window': 'Windows',
  'carpenter': 'Carpentry', 'roof': 'Roofing', 'landscape': 'Landscaping',
  'appliances': 'Appliance', 'plumber': 'Plumbing',
  'other': 'General', 'misc': 'General', 'miscellaneous': 'General',
};

// Resolve a work order's trade to a key the QuickBooks map actually holds.
function resolveTrade(raw) {
  const t = String(raw || '').trim();
  if (!t) return { name: 'General', matched: false };
  if (QB_TRADE_MAP[t]) return { name: t, matched: true };
  const alias = QB_TRADE_ALIASES[t.toLowerCase()];
  if (alias && QB_TRADE_MAP[alias]) return { name: alias, matched: true, via: t };
  // Case-only difference ("plumbing" vs "Plumbing") shouldn't cost you an account.
  const ci = Object.keys(QB_TRADE_MAP).find(k => k.toLowerCase() === t.toLowerCase());
  if (ci) return { name: ci, matched: true, via: t };
  return { name: 'General', matched: false };
}

const QB_TRADE_MAP = {
  Plumbing:   { item: '30', income: '287', expense: '245' },
  Electrical: { item: '31', income: '288', expense: '235' },
  HVAC:       { item: '32', income: '289', expense: '239' },
  Painting:   { item: '33', income: '290', expense: '243' },
  Flooring:   { item: '34', income: '291', expense: '237' },
  Carpentry:  { item: '35', income: '292', expense: '218' },
  Roofing:    { item: '36', income: '293', expense: '246' },
  Landscaping:{ item: '37', income: '294', expense: '220' },
  Cleaning:   { item: '43', income: '295', expense: '282' }, // item 43 = "Cleaning Service" (a real Service item -> Cleaning Income 295); item 22 is the "Cleaning" CATEGORY and cannot be used on an invoice line
  Appliance:  { item: '39', income: '296', expense: '230' },
  Windows:    { item: '38', income: '204', expense: '249' },
  General:    { item: '40', income: '198', expense: '68'  },
  // Locks and Pest Control have no dedicated QuickBooks accounts yet, so they book to the
  // same General repairs account they already fall back to. Run /qb/setup-trades to create
  // proper accounts, then point these at the ids it returns.
  Locks:         { item: '40', income: '198', expense: '68' },
  'Pest Control':{ item: '40', income: '198', expense: '68' },
};

// Extract an existing entity Id from a QBO "Duplicate Name Exists" (6240) error.
function qbDupId(r) {
  try { const e = r?.Fault?.Error?.[0]; if (e?.code === '6240' && e?.Detail) { const m = e.Detail.match(/Id=(\d+)/); if (m) return m[1]; } } catch (x) {}
  return null;
}

// Turn a QBO Fault response into a readable one-line error (qbApi does not throw on Faults).
function qbFault(r) {
  const e = r?.Fault?.Error?.[0];
  if (!e) return null;
  return `QBO ${e.code || ''}: ${e.Message || 'error'}${e.Detail ? ' — ' + e.Detail : ''}`.trim();
}

// One-time: create the trade income accounts + service items in QuickBooks.
// Idempotent — safe to re-run; skips anything that already exists by name.
async function qbSetupTrades(env) {
  try {
    const token = await qbAccessToken(env); // single refresh for the whole batch
    const acctData = await qbApi(env, `query?query=${encodeURIComponent('select Id,Name from Account where Active=true maxresults 1000')}&minorversion=73`, 'GET', null, token);
    const acctByName = {}; for (const a of (acctData?.QueryResponse?.Account || [])) acctByName[a.Name.toLowerCase()] = a.Id;
    const itemData = await qbApi(env, `query?query=${encodeURIComponent('select Id,Name from Item where Active=true maxresults 1000')}&minorversion=73`, 'GET', null, token);
    const itemByName = {}; for (const it of (itemData?.QueryResponse?.Item || [])) itemByName[it.Name.toLowerCase()] = it.Id;

    const map = {}, log = [];
    for (const t of QB_TRADES) {
      let incomeId = t.incomeId || null;
      if (!incomeId) {
        const found = acctByName[t.income.toLowerCase()];
        if (found) { incomeId = found; log.push(`income exists: ${t.income} (${found})`); }
        else {
          const r = await qbApi(env, 'account?minorversion=73', 'POST',
            { Name: t.income, AccountType: 'Income', AccountSubType: 'ServiceFeeIncome', SubAccount: true, ParentRef: { value: QB_INCOME_PARENT } }, token);
          incomeId = r?.Account?.Id || qbDupId(r);
          if (!incomeId) { log.push(`FAIL income ${t.income}: ${JSON.stringify(r).slice(0,140)}`); continue; }
          log.push(`${r?.Account?.Id ? 'created' : 'exists'} income: ${t.income} (${incomeId})`);
        }
      }
      const itemLabel = t.itemName || t.trade;
      let itemId = itemByName[itemLabel.toLowerCase()];
      if (!itemId) {
        const r = await qbApi(env, 'item?minorversion=73', 'POST',
          { Name: itemLabel, Type: 'Service', IncomeAccountRef: { value: incomeId } }, token);
        itemId = r?.Item?.Id || qbDupId(r);
        if (!itemId) { log.push(`FAIL item ${itemLabel}: ${JSON.stringify(r).slice(0,140)}`); continue; }
        log.push(`${r?.Item?.Id ? 'created' : 'exists'} item: ${itemLabel} (${itemId})`);
      } else log.push(`item exists: ${itemLabel} (${itemId})`);
      map[t.trade] = { income_acct_id: incomeId, item_id: itemId, expense_acct_id: t.expenseId };
    }
    return json({ ok: true, map, log });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// ── QUICKBOOKS: SEND-TO-QB (invoice + bill, preview-first) ───

// Does this name already exist in QuickBooks? Returns the id or null.
// Two passes on purpose: the cached list catches suffix/punctuation differences, then a
// FRESH exact query catches anything created in QuickBooks since the cache was filled.
// Only exact and strong matches are acted on automatically — a weak match is a guess, and
// guessing wrong here bills the wrong customer.
async function qbLookupExisting(env, kind, displayName, email, token) {
  try {
    const list = await qbListEntities(env, kind, token, false);
    const m = qbMatchEntity(list, displayName, email);
    // ONLY an unambiguous exact name match is acted on without a human. "strong" means the
    // names merely normalised the same way — "Smith Inc" and "Smith Properties LLC" both
    // reduce to "smith", and an owner running several LLCs under one family name is the
    // normal shape here. Choosing between those puts an invoice on the wrong ledger, so
    // strong is offered as a SUGGESTION on the mapping screen and nothing more.
    if (m && m.confidence === 'exact') return m.id;
  } catch (e) { /* fall through to the direct query */ }

  try {
    const type = kind === 'vendor' ? 'Vendor' : 'Customer';
    const q = encodeURIComponent(`select Id, DisplayName from ${type} where DisplayName = '${qbEscape(displayName)}'`);
    const data = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
    const rows = (data && data.QueryResponse && data.QueryResponse[type]) || [];
    if (rows.length === 1 && rows[0].Id) return rows[0].Id;   // exactly one, or don't guess
  } catch (e) { /* fall through to create */ }

  return null;
}

// Find (by stored id) or create a QB Customer from an Owner row; persists QBO_Customer_ID back.
async function qbFindOrCreateCustomer(env, owner, displayName, token) {
  if (owner.QBO_Customer_ID && owner.QBO_Customer_ID.trim()) return owner.QBO_Customer_ID.trim();
  const dn = (displayName || '').trim();
  if (!dn) throw new Error('owner has no name for a QB DisplayName');

  // LOOK BEFORE CREATING. This function was named find-or-create but only ever checked the
  // stored column, so an unmapped owner was always created fresh — duplicating a customer
  // that was already in QuickBooks under a slightly different name.
  const found = await qbLookupExisting(env, 'customer', dn, owner.Billing_Email || owner.Email || '', token);
  if (found) {
    if (owner.ID) {
      const clash = await qbMappingClash(env, 'owner', owner.ID, found);
      if (clash) {
        // Two owners resolving to one QuickBooks customer means their invoices merge.
        // Stop rather than guess — the mapping screen is where this gets settled.
        throw new Error(`"${dn}" matches QuickBooks #${found}, but that customer is already linked to "${qbOwnerDisplayName(clash)}". Sort it out on the QB Mapping screen.`);
      }
      try { await updateRow(env, 'Owners', owner.ID, { QBO_Customer_ID: found }); } catch (e) {}
    }
    return found;
  }

  const payload = { DisplayName: dn };
  if (owner.Company) payload.CompanyName = owner.Company;
  const email = owner.Billing_Email || '';
  if (email) payload.PrimaryEmailAddr = { Address: email };
  const phone = owner.Billing_Phone || owner.Phone || '';
  if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
  const addr = {};
  if (owner.Billing_Address) addr.Line1 = owner.Billing_Address;
  if (owner.Billing_City) addr.City = owner.Billing_City;
  if (owner.Billing_State) addr.CountrySubDivisionCode = owner.Billing_State;
  if (owner.Billing_Zip) addr.PostalCode = owner.Billing_Zip;
  if (Object.keys(addr).length) payload.BillAddr = addr;
  const r = await qbApi(env, 'customer?minorversion=73', 'POST', payload, token);
  const id = r?.Customer?.Id || qbDupId(r);
  if (!id) throw new Error(qbFault(r) || 'could not create QB customer');
  if (owner.ID) { try { await updateRow(env, 'Owners', owner.ID, { QBO_Customer_ID: id }); } catch (e) {} }
  return id;
}

// Find (by stored id) or create a QB Vendor from a Vendors row; persists QBO_Vendor_ID back.
async function qbFindOrCreateVendor(env, vendor, displayName, token) {
  if (vendor.QBO_Vendor_ID && vendor.QBO_Vendor_ID.trim()) return vendor.QBO_Vendor_ID.trim();
  const dn = (displayName || '').trim();
  if (!dn) throw new Error('vendor has no name for a QB DisplayName');

  const found = await qbLookupExisting(env, 'vendor', dn, vendor.Email || '', token);
  if (found) {
    if (vendor.ID) {
      const clash = await qbMappingClash(env, 'vendor', vendor.ID, found);
      if (clash) {
        throw new Error(`"${dn}" matches QuickBooks #${found}, but that vendor is already linked to "${qbVendorDisplayName(clash)}". Sort it out on the QB Mapping screen.`);
      }
      try { await updateRow(env, 'Vendors', vendor.ID, { QBO_Vendor_ID: found }); } catch (e) {}
    }
    return found;
  }

  const payload = { DisplayName: dn };
  const phone = vendor.Phone || '';
  if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
  const email = vendor.Email || '';
  if (email) payload.PrimaryEmailAddr = { Address: email };
  const r = await qbApi(env, 'vendor?minorversion=73', 'POST', payload, token);
  const id = r?.Vendor?.Id || qbDupId(r);
  if (!id) throw new Error(qbFault(r) || 'could not create QB vendor');
  if (vendor.ID) { try { await updateRow(env, 'Vendors', vendor.ID, { QBO_Vendor_ID: id }); } catch (e) {} }
  return id;
}


// Did QuickBooks reject this specifically because of the document number? Only then is a
// retry safe — a validation fault is raised before anything is persisted, so nothing was
// created. Any other failure could mean the transaction went through despite the error.
function qbIsDocNumberFault(r) {
  const e = r && r.Fault && r.Fault.Error && r.Fault.Error[0];
  if (!e) return false;                       // not a fault we can read — never retry
  if (String(e.code) === '6140') return true; // duplicate document number
  const text = ((e.Message || '') + ' ' + (e.Detail || '')).toLowerCase();
  return text.indexOf('docnumber') !== -1 || text.indexOf('document number') !== -1;
}


// ── VENDOR BILL TERMS ────────────────────────────────────────
// Bills were landing on whatever QuickBooks defaults to — Net 30 — regardless of what the
// vendor's own terms say. These are small trade bills that get paid as they come in, and a
// 30-day due date makes the payables report describe money that isn't actually owed later.
//
// SalesTermRef is the right lever rather than a bare DueDate: QuickBooks then shows "Due on
// receipt" as the terms and derives the date itself, so the bill reads correctly instead of
// showing Net 30 with a contradictory date.
let _qbDueOnReceiptId = null;      // '' means looked and QuickBooks has no such term
let _qbTermCheckedAt = 0;

// A vendor's own terms, from the Vendors sheet. Blank means due on receipt — most of these
// are small trade bills paid as they come in, and that should stay the default rather than
// something to configure for every vendor. "Net 7", "Net 10", "Net 30" set a real term.
function vendorTermDays(vendor) {
  const raw = String((vendor && (vendor.Payment_Terms || vendor.Terms)) || '').trim();
  if (!raw) return 0;
  if (/due\s*(up)?on\s*receipt|^dor$|^cod$/i.test(raw)) return 0;
  const m = raw.match(/(\d{1,3})/);
  const n = m ? parseInt(m[1], 10) : 0;
  return (Number.isFinite(n) && n > 0 && n <= 365) ? n : 0;
}

function vendorTermLabel(vendor) {
  const d = vendorTermDays(vendor);
  return d > 0 ? ('Net ' + d) : 'Due on receipt';
}

// The QuickBooks Term matching a number of days, so the bill shows real terms rather than a
// bare date. Cached per-file; falls back to just setting the due date.
let _qbTermsByDays = null;
let _qbTermsAt = 0;

async function qbTermForDays(env, token, days) {
  if (!_qbTermsByDays || (Date.now() - _qbTermsAt) > 600000) {
    _qbTermsByDays = {};
    try {
      const q = encodeURIComponent("select Id, Name, DueDays from Term where Active = true maxresults 100");
      const data = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
      ((data && data.QueryResponse && data.QueryResponse.Term) || []).forEach(t => {
        const d = Number(t.DueDays);
        // Zero days is due-on-receipt however the file has it named.
        const key = Number.isFinite(d) ? d : (/due\s*(up)?on\s*receipt/i.test(String(t.Name || '')) ? 0 : null);
        if (key !== null && _qbTermsByDays[key] === undefined) _qbTermsByDays[key] = String(t.Id);
      });
    } catch (e) { /* leave empty — the due date still gets set */ }
    _qbTermsAt = Date.now();
  }
  return _qbTermsByDays[days] || '';
}

async function qbDueOnReceiptTerm(env, token) {
  if (_qbDueOnReceiptId !== null && (Date.now() - _qbTermCheckedAt) < 600000) return _qbDueOnReceiptId;
  try {
    const q = encodeURIComponent("select Id, Name, DueDays from Term where Active = true maxresults 100");
    const data = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
    const terms = (data && data.QueryResponse && data.QueryResponse.Term) || [];
    // Match on the name QuickBooks ships with, then on any zero-day term — some files have
    // it renamed ("Due Upon Receipt", "COD") but the meaning is carried by DueDays 0.
    const byName = terms.find(t => /due\s*(up)?on\s*receipt/i.test(String(t.Name || '')));
    const byDays = terms.find(t => Number(t.DueDays) === 0);
    _qbDueOnReceiptId = String((byName || byDays || {}).Id || '');
    _qbTermCheckedAt = Date.now();
  } catch (e) {
    _qbDueOnReceiptId = '';       // couldn't ask — the DueDate fallback still applies
    _qbTermCheckedAt = Date.now();
  }
  return _qbDueOnReceiptId;
}

// The number that goes on the QuickBooks BILL. A vendor's own invoice number is the right
// answer when there is one — it's what they'll quote when chasing payment, and what the
// bill needs to be matched against. Plenty of Brett's vendors hand over a scrawled note
// with no number at all, and OCR can't invent one. For those, the work order number is
// the next best reference: it's unique, it's already on the job, and it points both
// people at the same thing.
//
// QuickBooks caps this field, and the commonly-documented limit is 21 characters. Intuit's
// own docs wouldn't load to confirm it, so this trims to 21 and the caller handles a
// rejection rather than assuming.
const QB_DOCNUMBER_MAX = 21;

// POST /qb/record-paid-bill  { vendor_qbo_id, amount, expense_account_id, pay_account_id?,
//   doc_number?, txn_date?, pay_date?, memo? }
// Records a vendor bill that has ALREADY been paid outside the Hub (e.g. a PayPal-paid cleaning
// invoice that never had a customer invoice, so /qb/send-invoice — which requires a customer
// total — cannot post it). Creates the QB Bill and, if pay_account_id is given, a Bill Payment
// that clears it. Idempotent: a Bill with the same DocNumber already on this vendor is reused,
// not duplicated, and a bill with no remaining balance is not paid again.
async function qbRecordPaidBill(env, body) {
  try {
    const vendorId    = String(body.vendor_qbo_id || '').trim();
    const amount      = Number(body.amount) || 0;
    const expenseAcct = String(body.expense_account_id || '').trim();
    const payAcct     = String(body.pay_account_id || '').trim();
    const docNum      = String(body.doc_number || '').trim();
    const txnDate     = String(body.txn_date || '').trim() || new Date().toISOString().split('T')[0];
    const payDate     = String(body.pay_date || '').trim() || txnDate;
    const memo        = String(body.memo || '').slice(0, 1000);
    if (!vendorId || amount <= 0 || !expenseAcct)
      return json({ ok: false, error: 'vendor_qbo_id, amount and expense_account_id are required' }, 400);

    const token = await qbAccessToken(env);

    // Idempotency: reuse an existing same-numbered bill on this vendor rather than double-posting.
    let bill = null;
    if (docNum) {
      try {
        const q = encodeURIComponent(`select Id, DocNumber, TotalAmt, Balance, VendorRef from Bill where DocNumber = '${qbEscape(docNum)}'`);
        const r = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
        const hits = (r && r.QueryResponse && r.QueryResponse.Bill) || [];
        bill = hits.find(b => String(b.VendorRef && b.VendorRef.value) === vendorId) || null;
      } catch (e) { /* fall through to create */ }
    }

    let billCreated = false;
    if (!bill) {
      const billPayload = {
        VendorRef: { value: vendorId },
        TxnDate: txnDate,
        PrivateNote: memo,
        Line: [{
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: +amount.toFixed(2),
          Description: memo || undefined,
          AccountBasedExpenseLineDetail: { AccountRef: { value: expenseAcct } },
        }],
      };
      if (docNum) billPayload.DocNumber = docNum;
      const br = await qbApi(env, 'bill?minorversion=73', 'POST', billPayload, token);
      bill = br && br.Bill;
      if (!bill || !bill.Id) return json({ ok: false, error: 'Bill: ' + (qbFault(br) || 'unknown error') }, 502);
      billCreated = true;
    }

    // Pay it, unless already settled or no pay account was given.
    let paymentId = '', paid = false;
    const balance = Number(bill.Balance != null ? bill.Balance : bill.TotalAmt != null ? bill.TotalAmt : amount);
    if (payAcct && balance > 0) {
      const amt = +Number(bill.TotalAmt || amount).toFixed(2);
      const payPayload = {
        VendorRef: { value: vendorId },
        TotalAmt: amt,
        PayType: 'Check',
        CheckPayment: { BankAccountRef: { value: payAcct } },
        TxnDate: payDate,
        PrivateNote: memo,
        Line: [{ Amount: amt, LinkedTxn: [{ TxnId: String(bill.Id), TxnType: 'Bill' }] }],
      };
      const pr = await qbApi(env, 'billpayment?minorversion=73', 'POST', payPayload, token);
      const pay = pr && pr.BillPayment;
      if (!pay || !pay.Id)
        return json({ ok: false, bill_id: String(bill.Id), bill_created: billCreated,
          error: 'Bill is recorded but the payment failed: ' + (qbFault(pr) || 'unknown error') }, 502);
      paymentId = String(pay.Id); paid = true;
    } else if (payAcct && balance <= 0) {
      paid = true; // already had no balance
    }

    return json({ ok: true, bill_id: String(bill.Id), bill_created: billCreated,
      bill_reused: !billCreated, payment_id: paymentId, paid, doc_number: docNum });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/clear-ir-bill  { ir_id }
// Clears the QuickBooks bill reference from an Invoice_Review row whose vendor bill was later
// deleted in QuickBooks (leaving the customer invoice intact). Without this the Hub keeps
// showing a vendor bill that no longer exists. Only the bill fields are touched — the customer
// invoice id/number and status are left exactly as they were.
async function qbClearIrBill(env, body) {
  try {
    const irId = String(body.ir_id || '').trim();
    if (!irId) return json({ ok: false, error: 'ir_id required' }, 400);
    const irs = await fetchTab(env, 'Invoice_Review');
    const ir = irs.find(r => String(r.ID) === irId);
    if (!ir) return json({ ok: false, error: 'Invoice_Review row ' + irId + ' not found' }, 404);
    const prevBill = ir.QB_Bill_ID || '';
    const prevBillNum = ir.QB_Bill_Number || '';
    await updateRow(env, 'Invoice_Review', irId, { QB_Bill_ID: '', QB_Bill_Number: '' });
    return json({ ok: true, ir_id: irId, wo_id: ir.WO_ID || '',
      cleared: { qb_bill_id: prevBill, qb_bill_number: prevBillNum },
      kept: { qb_invoice_id: ir.QB_Invoice_ID || '', status: ir.QB_Invoice_Status || '' } });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/reprice-invoice  { ir_id, new_total, new_markup?, new_fee? }
// Changes the dollar amount of an ALREADY-SENT customer invoice (unlike /qb/repair-invoice,
// which preserves the total and only fixes wording). Rewrites the single sales line to the new
// total, preserving its item (income account) and description, and writes the new
// Customer_Total / Markup / Processing_Fee back to the Invoice_Review row. Refuses if the
// invoice has any payment against it, or if it isn't a single-line invoice (use QuickBooks).
async function qbRepriceInvoice(env, body) {
  try {
    const irId = String(body.ir_id || '').trim();
    const newTotal = Number(body.new_total) || 0;
    if (!irId || newTotal <= 0) return json({ ok: false, error: 'ir_id and a positive new_total are required' }, 400);
    const irs = await fetchTab(env, 'Invoice_Review');
    const ir = irs.find(r => String(r.ID) === irId);
    if (!ir) return json({ ok: false, error: 'Invoice_Review row ' + irId + ' not found' }, 404);
    const qbInvId = String(ir.QB_Invoice_ID || '').trim();
    if (!qbInvId) return json({ ok: false, error: 'That row has no QuickBooks invoice to reprice.' }, 400);

    const token = await qbAccessToken(env);
    const got = await qbApi(env, `invoice/${encodeURIComponent(qbInvId)}?minorversion=73`, 'GET', null, token);
    const inv = got && got.Invoice;
    if (!inv) return json({ ok: false, error: qbFault(got) || 'Could not read that invoice from QuickBooks.' }, 404);

    const totalAmt = Number(inv.TotalAmt || 0), bal = Number(inv.Balance);
    if (isNaN(bal)) return json({ ok: false, error: 'QuickBooks reported no balance, so there is no way to tell if it is paid. Not touching it.' }, 409);
    if (Math.abs(bal - totalAmt) > 0.005)
      return json({ ok: false, error: `That invoice has a payment against it (balance $${bal.toFixed(2)} of $${totalAmt.toFixed(2)}). Not repricing a paid invoice.` }, 409);

    const itemLines = (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail');
    if (itemLines.length !== 1)
      return json({ ok: false, error: `Expected one sales line, found ${itemLines.length}. Reprice this one in QuickBooks instead.` }, 409);
    const line = itemLines[0];
    const amt = +newTotal.toFixed(2);
    const newLine = {
      Id: line.Id, DetailType: 'SalesItemLineDetail', Amount: amt,
      Description: line.Description,
      SalesItemLineDetail: Object.assign({}, line.SalesItemLineDetail, { Qty: 1, UnitPrice: amt }),
    };
    const patch = { Id: qbInvId, SyncToken: inv.SyncToken, sparse: true, Line: [newLine] };
    const upd = await qbApi(env, 'invoice?minorversion=73', 'POST', patch, token);
    const updated = upd && upd.Invoice;
    if (!updated) return json({ ok: false, error: 'Invoice update failed: ' + (qbFault(upd) || 'unknown error') }, 502);

    const fields = { Customer_Total: String(amt) };
    if (body.new_markup != null) fields.Markup = String(body.new_markup);
    if (body.new_fee != null) fields.Processing_Fee = String(body.new_fee);
    await updateRow(env, 'Invoice_Review', irId, fields);

    return json({ ok: true, ir_id: irId, wo_id: ir.WO_ID || '', invoice_id: qbInvId,
      old_total: +totalAmt.toFixed(2), new_total: amt, qb_confirms: Number(updated.TotalAmt || 0) });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/relabel-invoice  { ir_id, description }
// Rewrites the DESCRIPTION of a sent customer invoice's single sales line without changing the
// amount — e.g. to make clear a job was a one-time comprehensive deep clean. Refuses a paid or
// multi-line invoice.
async function qbRelabelInvoice(env, body) {
  try {
    const irId = String(body.ir_id || '').trim();
    const desc = String(body.description || '').slice(0, 4000);
    if (!irId || !desc) return json({ ok: false, error: 'ir_id and description are required' }, 400);
    const irs = await fetchTab(env, 'Invoice_Review');
    const ir = irs.find(r => String(r.ID) === irId);
    if (!ir) return json({ ok: false, error: 'Invoice_Review row ' + irId + ' not found' }, 404);
    const qbInvId = String(ir.QB_Invoice_ID || '').trim();
    if (!qbInvId) return json({ ok: false, error: 'That row has no QuickBooks invoice.' }, 400);
    const token = await qbAccessToken(env);
    const got = await qbApi(env, `invoice/${encodeURIComponent(qbInvId)}?minorversion=73`, 'GET', null, token);
    const inv = got && got.Invoice;
    if (!inv) return json({ ok: false, error: qbFault(got) || 'Could not read that invoice.' }, 404);
    const totalAmt = Number(inv.TotalAmt || 0), bal = Number(inv.Balance);
    if (isNaN(bal)) return json({ ok: false, error: 'No balance reported; cannot tell if paid.' }, 409);
    if (Math.abs(bal - totalAmt) > 0.005) return json({ ok: false, error: 'That invoice has a payment against it. Not touching it.' }, 409);
    const itemLines = (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail');
    if (itemLines.length !== 1) return json({ ok: false, error: `Expected one sales line, found ${itemLines.length}.` }, 409);
    const line = itemLines[0];
    const newLine = { Id: line.Id, DetailType: 'SalesItemLineDetail', Amount: line.Amount,
      Description: desc, SalesItemLineDetail: line.SalesItemLineDetail };
    const patch = { Id: qbInvId, SyncToken: inv.SyncToken, sparse: true, Line: [newLine] };
    const upd = await qbApi(env, 'invoice?minorversion=73', 'POST', patch, token);
    if (!(upd && upd.Invoice)) return json({ ok: false, error: 'Update failed: ' + (qbFault(upd) || 'unknown') }, 502);
    return json({ ok: true, ir_id: irId, invoice_id: qbInvId, description: desc });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/set-bill-docnumber  { qb_bill_id, doc_number }
// Sets the reference number (DocNumber) on a QuickBooks vendor bill — e.g. to carry the vendor's
// own invoice number instead of the WO number the Hub falls back to.
async function qbSetBillDocNumber(env, body) {
  try {
    const billId = String(body.qb_bill_id || '').trim();
    const docNum = String(body.doc_number || '').trim();
    if (!billId || !docNum) return json({ ok: false, error: 'qb_bill_id and doc_number are required' }, 400);
    const token = await qbAccessToken(env);
    const got = await qbApi(env, `bill/${encodeURIComponent(billId)}?minorversion=73`, 'GET', null, token);
    const bill = got && got.Bill;
    if (!bill) return json({ ok: false, error: qbFault(got) || 'Could not read that bill.' }, 404);
    const prev = bill.DocNumber || '';
    // QB requires VendorRef on a Bill update even in sparse mode (unlike Invoice/CustomerRef).
    const patch = { Id: billId, SyncToken: bill.SyncToken, sparse: true, DocNumber: docNum, VendorRef: bill.VendorRef };
    const upd = await qbApi(env, 'bill?minorversion=73', 'POST', patch, token);
    if (!(upd && upd.Bill)) return json({ ok: false, error: 'Update failed: ' + (qbFault(upd) || 'unknown') }, 502);
    return json({ ok: true, qb_bill_id: billId, was: prev, now: docNum });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/attach-to-bill  { qb_txn_id, qb_txn_type?, drive_file_id, file_name? }
// Downloads a file from Google Drive and attaches it to a QuickBooks transaction (default Bill),
// so the original vendor invoice PDF is one click away from the bill.
async function qbAttachToBill(env, body) {
  try {
    const txnType = String(body.qb_txn_type || 'Bill').trim();
    const txnId   = String(body.qb_txn_id || '').trim();
    const fileId  = String(body.drive_file_id || '').trim();
    const fileName = String(body.file_name || 'invoice.pdf').trim();
    if (!txnId || !fileId) return json({ ok: false, error: 'qb_txn_id and drive_file_id are required' }, 400);
    const gtok = await getAccessToken(env);
    const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${gtok}` } });
    if (!dl.ok) return json({ ok: false, error: 'Drive download failed (HTTP ' + dl.status + ')' }, 502);
    const bytes = await dl.arrayBuffer();
    const qtok = await qbAccessToken(env);
    const meta = { AttachableRef: [{ EntityRef: { type: txnType, value: txnId } }], FileName: fileName, ContentType: 'application/pdf' };
    const fd = new FormData();
    fd.append('file_metadata_01', new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'metadata.json');
    fd.append('file_content_01', new Blob([bytes], { type: 'application/pdf' }), fileName);
    const up = await fetch(`${QB_API_BASE}/${env.QB_REALM_ID}/upload?minorversion=73`, {
      method: 'POST', headers: { Authorization: `Bearer ${qtok}`, Accept: 'application/json' }, body: fd });
    const jr = await up.json();
    const resp = jr && jr.AttachableResponse && jr.AttachableResponse[0];
    const att = resp && resp.Attachable;
    if (!(att && att.Id)) return json({ ok: false, error: 'QB attach failed: ' + JSON.stringify(resp || jr).slice(0, 300) }, 502);
    return json({ ok: true, attachable_id: String(att.Id), txn_type: txnType, txn_id: txnId, file_name: fileName });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/find-bills  { vendor_qbo_id, doc_number? }
// Read-only lookup of a vendor's bills in QuickBooks (id, DocNumber, date, total, balance) — so a
// bill can be matched by amount/date when its reference number is blank, instead of blindly
// creating a duplicate. Exists because record-paid-bill matches ONLY by DocNumber, and bills
// entered with no number can't be found that way (that's how the #0017/#0021 dupes happened).
async function qbFindBills(env, body) {
  try {
    const vendorId = String(body.vendor_qbo_id || '').trim();
    if (!vendorId) return json({ ok: false, error: 'vendor_qbo_id required' }, 400);
    const token = await qbAccessToken(env);
    let where = `VendorRef = '${qbEscape(vendorId)}'`;
    if (body.doc_number) where += ` and DocNumber = '${qbEscape(String(body.doc_number))}'`;
    const q = encodeURIComponent(`select Id, DocNumber, TxnDate, TotalAmt, Balance from Bill where ${where} maxresults 500`);
    const r = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
    const bills = (r && r.QueryResponse && r.QueryResponse.Bill) || [];
    return json({ ok: true, count: bills.length,
      bills: bills.map(b => ({ id: String(b.Id), doc: b.DocNumber || '', date: b.TxnDate,
        total: Number(b.TotalAmt || 0), balance: Number(b.Balance != null ? b.Balance : b.TotalAmt) })) });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// POST /qb/delete-bill  { qb_bill_id }
// Deletes a QuickBooks vendor bill. REFUSES a bill that has a payment against it (balance != total)
// — deleting a paid bill is destructive. For removing an accidental duplicate before it's paid.
async function qbDeleteBill(env, body) {
  try {
    const billId = String(body.qb_bill_id || '').trim();
    if (!billId) return json({ ok: false, error: 'qb_bill_id required' }, 400);
    const token = await qbAccessToken(env);
    const got = await qbApi(env, `bill/${encodeURIComponent(billId)}?minorversion=73`, 'GET', null, token);
    const bill = got && got.Bill;
    if (!bill) return json({ ok: false, error: qbFault(got) || 'Could not read that bill.' }, 404);
    const bal = Number(bill.Balance), tot = Number(bill.TotalAmt);
    if (!isNaN(bal) && !isNaN(tot) && Math.abs(bal - tot) > 0.005)
      return json({ ok: false, error: `Bill ${billId} has a payment against it (balance $${bal.toFixed(2)} of $${tot.toFixed(2)}). Not deleting.` }, 409);
    const del = await qbApi(env, 'bill?operation=delete&minorversion=73', 'POST', { Id: billId, SyncToken: bill.SyncToken }, token);
    const done = del && del.Bill && (del.Bill.status === 'Deleted' || del.Bill.Id);
    if (!done) return json({ ok: false, error: 'Delete failed: ' + (qbFault(del) || JSON.stringify(del).slice(0, 200)) }, 502);
    return json({ ok: true, deleted_bill_id: billId, doc: bill.DocNumber || '', total: Number(bill.TotalAmt || 0) });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

function qbBillDocNumber(billRow, ir, siblingIndex) {
  const own = String((billRow && (billRow.Vendor_Invoice_No || billRow.Invoice_Number)) || '').trim();
  const wo  = String((ir && ir.WO_ID) || '').trim();
  // Same vendor billing the same job twice is the only real collision — two DIFFERENT
  // vendors both referencing WO-1062 is correct, since a bill number is scoped to the
  // vendor it came from.
  const suffix = siblingIndex > 0 ? ('-' + (siblingIndex + 1)) : '';
  const woNumber = wo ? (wo + suffix).slice(0, QB_DOCNUMBER_MAX) : '';

  if (own && own.length <= QB_DOCNUMBER_MAX) return { number: own, source: 'vendor', overlong: '' };
  // Don't truncate. A cut-off invoice number looks authoritative and reconciles against
  // nothing — and the slice would keep the head, while the part that distinguishes one
  // invoice from another is usually the tail. Fall back to the job number and say what
  // the vendor actually wrote.
  if (own) return { number: woNumber, source: 'work order', overlong: own };
  return { number: woNumber, source: woNumber ? 'work order' : '', overlong: '' };
}

// Build customer-invoice lines: one line per receipt (materials) + one line for
// truck/shop stock (if any) + a single labor summary line. Materials show at cost;
// the labor line absorbs the remainder so the lines always sum to Customer_Total —
// keeping the internal $75 first-hour / markup off the customer's invoice.
function buildInvoiceLines(ir, billRow, trade, tradeName, wo, itemRefOverride, ownReceipts) {
  // An override is used when REPAIRING an existing invoice: the wording changes, the
  // account it posted to must not. Trade resolution has changed since some invoices were
  // sent, and moving posted revenue between income accounts is a separate decision.
  const itemRef = itemRefOverride || { value: trade.item };
  const lines = [];
  let materialsTotal = 0;
  let receipts = [];
  try { receipts = JSON.parse(billRow?.Receipts_JSON || '[]'); } catch (e) {}
  if (Array.isArray(receipts)) {
    for (const rc of receipts) {
      const amt = +(Number(rc && rc.amount) || 0).toFixed(2);
      if (amt <= 0) continue;
      materialsTotal += amt;
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: amt,
        Description: ('Materials — ' + ((rc && rc.desc) || 'receipt')).slice(0, 4000),
        SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: amt },
      });
    }
  }
  // Materials bought outside the vendor's bill — Brett's own receipts, approved onto this
  // invoice. They were previously invisible here, so they never appeared on the invoice at
  // all even though the customer was meant to pay for them.
  if (Array.isArray(ownReceipts)) {
    for (const rc of ownReceipts) {
      const amt = +(Number(rc && rc.Amount) || 0).toFixed(2);
      if (amt <= 0) continue;
      materialsTotal += amt;
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: amt,
        Description: ('Materials — ' + ((rc && (rc.Description || rc.Store)) || 'receipt')).slice(0, 4000),
        SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: amt },
      });
    }
  }

  const truck = +(Number(billRow && billRow.Truck_Stock) || 0).toFixed(2);
  if (truck > 0) {
    materialsTotal += truck;
    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: truck,
      Description: ('Materials — ' + ((billRow && billRow.Truck_Desc) || 'shop/truck stock')).slice(0, 4000),
      SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: truck },
    });
  }
  const total = +(Number(ir.Customer_Total) || 0).toFixed(2);
  const laborAmt = +(total - materialsTotal).toFixed(2);
  // Say what was actually done. The description belongs on the line the owner is paying,
  // not buried in a note under the total — an invoice reading "Labor & service —
  // Landscaping" tells them nothing about the job.
  // Slice the description, not the joined string — otherwise a long one takes the
  // "— WO 1062" reference off the end with it.
  const workDesc = String((wo && (wo.Invoice_Memo || wo.Description)) || '').trim().slice(0, 3800);
  const labelParts = [tradeName];
  if (workDesc) labelParts.push(workDesc);
  labelParts.push('WO ' + (ir.WO_ID || ''));
  // Show the labor line as hours × rate, not a flat "1 × $total". A 2-hour, $150 job was
  // going to QuickBooks as Qty 1 / UnitPrice 150, so the customer read it as $150/hr — the
  // opposite of the transparency Brett wants (they should see the time that built the price).
  //
  // CRITICAL: only split when the bill is genuinely hourly AND its STORED rate reconciles
  // with the labor amount to the cent. `laborAmt` is Customer_Total − materials, which on a
  // marked-up vendor bill carries markup + on-site time + the 5% fee — so hours × the
  // vendor's rate would NOT tie out, and deriving a rate from laborAmt/hours would print a
  // fabricated $/hr that quietly exposes the markup. Reconciling against the bill's own
  // stored Rate (hrs × Rate === Labor_Total === laborAmt) is true only when the labor passes
  // straight through — Brett's own time — and false for every marked-up bill, which falls
  // back to the single combined line. Either way the invoice TOTAL is untouched (Amount is
  // always laborAmt).
  const billedHours = +(Number(billRow && billRow.Hours) || 0).toFixed(2);
  const storedRate  = +(Number(billRow && billRow.Rate) || 0).toFixed(2);
  const isHourlyBill = String((billRow && billRow.Bill_Type) || '').toLowerCase() === 'hourly';
  let laborLineDetail = { ItemRef: itemRef, Qty: 1, UnitPrice: laborAmt };
  let laborLineLabel = labelParts.join(' — ');
  if (isHourlyBill && billedHours > 0 && storedRate > 0 &&
      Math.abs(+(storedRate * billedHours).toFixed(2) - laborAmt) < 0.01) {
    laborLineDetail = { ItemRef: itemRef, Qty: billedHours, UnitPrice: storedRate };
    // Put the breakdown in the description too — some QuickBooks invoice styles hide the
    // Qty/Rate columns, and the whole point is that the customer sees the hours.
    laborLineLabel = labelParts.join(' — ') + ' — ' + billedHours + ' hr' + (billedHours === 1 ? '' : 's') + ' × $' + storedRate.toFixed(2) + '/hr';
  }
  lines.unshift({
    DetailType: 'SalesItemLineDetail',
    Amount: laborAmt,
    Description: laborLineLabel.slice(0, 4000),
    SalesItemLineDetail: laborLineDetail,
  });
  return { lines, materialsTotal: +materialsTotal.toFixed(2), laborAmt, total };
}

// Make a Drive folder/file anyone-with-link readable (for the customer photo link). Idempotent.
async function driveShareAnyone(token, fileId) {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    return res.ok;
  } catch (e) { return false; }
}

// Download a Drive file's bytes (+ its content-type) so they can be re-uploaded to QuickBooks.
async function driveDownload(token, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('drive download ' + res.status);
  const mime = res.headers.get('content-type') || 'application/octet-stream';
  const bytes = await res.arrayBuffer();
  return { bytes, mime };
}

// Extract a Drive file id from a webViewLink (…/d/<ID>/… or ?id=<ID>).
function driveIdFromUrl(url) {
  if (!url) return '';
  const m = String(url).match(/\/d\/([A-Za-z0-9_-]+)/) || String(url).match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

// Upload a file and attach it to a QBO transaction via the Attachable /upload endpoint (multipart).
async function qbUploadAttachable(env, qbToken, entityType, entityId, filename, mime, bytes, includeOnSend) {
  const meta = { AttachableRef: [{ EntityRef: { type: entityType, value: String(entityId) }, IncludeOnSend: !!includeOnSend }], FileName: filename, ContentType: mime };
  const form = new FormData();
  form.append('file_metadata_01', new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'metadata.json');
  form.append('file_content_01', new Blob([bytes], { type: mime }), filename);
  const res = await fetch(`${QB_API_BASE}/${env.QB_REALM_ID}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${qbToken}`, Accept: 'application/json' },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  const id = data && data.AttachableResponse && data.AttachableResponse[0] && data.AttachableResponse[0].Attachable && data.AttachableResponse[0].Attachable.Id;
  if (!id) throw new Error(qbFault(data) || ('attach HTTP ' + res.status));
  return id;
}

// Attach material receipt images: ALL receipts to the customer Invoice (visible on send),
// and reimbursable receipts also to the vendor Bill (internal). Downloads each file once.
// Best-effort — every failure is a warning, never blocks the send.
async function qbAttachReceipts(env, qbToken, invoiceId, billId, billRow, warnings) {
  let receipts = [];
  try { receipts = JSON.parse((billRow && billRow.Receipts_JSON) || '[]'); } catch (e) {}
  const withUrl = (Array.isArray(receipts) ? receipts : []).filter(r => r && r.url);
  if (!withUrl.length) return;
  let gtoken;
  try { gtoken = await getAccessToken(env); } catch (e) { warnings.push('Attachments skipped: Drive auth failed'); return; }
  for (const r of withUrl) {
    const fid = driveIdFromUrl(r.url);
    if (!fid) continue;
    let dl;
    try { dl = await driveDownload(gtoken, fid); }
    catch (e) { warnings.push('Receipt download failed: ' + (e.message || 'error')); continue; }
    const ext = dl.mime.includes('pdf') ? '.pdf' : dl.mime.includes('png') ? '.png' : '.jpg';
    const name = ((r.desc || 'receipt').replace(/[^\w .-]/g, '_')).slice(0, 60) + ext;
    // Customer invoice: every material receipt, regardless of who paid the store.
    if (invoiceId) {
      try { await qbUploadAttachable(env, qbToken, 'Invoice', invoiceId, name, dl.mime, dl.bytes, true); }
      catch (e) { warnings.push('Invoice attach failed: ' + (e.message || 'error')); }
    }
    // Vendor bill: only reimburse-the-vendor receipts (they back the payable).
    if (billId && r.pay !== 'account') {
      try { await qbUploadAttachable(env, qbToken, 'Bill', billId, name, dl.mime, dl.bytes, false); }
      catch (e) { warnings.push('Bill attach failed: ' + (e.message || 'error')); }
    }
  }
}

// GET /qb/ready — approved Invoice_Review rows still waiting to go to QuickBooks.
// `?all=1` returns rows at ANY status (including already-sent), optionally narrowed by
// `?wo_id=`. The Hub needs this to state a bill's QuickBooks position from evidence — the
// row's own QB_Invoice_ID — instead of inferring "already sent" from absence, which is the
// mistake FEATURE_LOG rule 16 exists to stop.
async function qbReadyQueue(env, url) {
  const wantAll = url && url.searchParams.get('all') === '1';
  const woFilter = (url && url.searchParams.get('wo_id')) || '';
  try {
    const [irRows, wos] = await fetchTabs(env, ['Invoice_Review','Work_Orders']);
    // 'partial' MUST be included. qbSendInvoice stamps that status when the invoice half
    // posted to QuickBooks but the bill half did not (bad vendor ref, an Intuit hiccup,
    // Vendor_Cost missing). Nothing anywhere ever writes the status back to 'pending', so
    // filtering to 'pending' alone made a half-finished row vanish from this queue forever
    // — invoice in QuickBooks, vendor bill never created, and the screen cheerfully
    // reporting "nothing waiting". The resume logic in qbSendInvoice handles a partial row
    // correctly; it just had no way to be reached. A blank status counts as pending too.
    const OPEN_QB = ['pending', 'partial', ''];
    const pending = irRows.filter(r => {
      if (r.Active === 'FALSE') return false;
      if (woFilter && String(r.WO_ID) !== String(woFilter)) return false;
      if (wantAll) return true;
      return OPEN_QB.includes((r.QB_Invoice_Status || '').toLowerCase().trim());
    });
    const out = pending.map(r => {
      const wo = findWO(wos, r.WO_ID) || {};
      const rawStatus = (r.QB_Invoice_Status || '').toLowerCase().trim();
      const status = rawStatus || 'pending';
      return {
        id: r.ID, bill_id: r.Bill_ID, wo_id: r.WO_ID,
        vendor_id: r.Vendor_ID, vendor_name: r.Vendor_Name,
        trade: wo.Trade || '', job_type: r.Job_Type || '',
        description: wo.Description || '',
        customer_total: r.Customer_Total || '0', vendor_cost: r.Vendor_Cost || '0',
        approved_date: r.Approved_Date || '',
        qb_invoice_id: r.QB_Invoice_ID || '', qb_bill_id: r.QB_Bill_ID || '',
        qb_status: status,
        // A blank status is NOT the same as 'pending'. approveInvoiceReview has always
        // written 'pending', so a blank one is legacy or hand-edited — quite possibly a job
        // already invoiced by hand before this integration existed. It carries no
        // QB_Invoice_ID, so nothing stops a send from creating a fresh customer invoice.
        // Surfaced here so batch send skips it and it has to go through preview one at a time.
        needs_individual_send: rawStatus === '',
        // Surfaced so the screen can warn BEFORE sending: a zero vendor cost means the
        // vendor bill will be skipped and only the customer invoice will post.
        vendor_cost_zero: !(parseFloat(r.Vendor_Cost) > 0),
      };
    });
    return json(out);
  } catch (e) {
    // Was `return json([])`. A Sheets outage or a renamed tab then rendered as a green
    // "✓ Nothing waiting for QuickBooks" — a read returning [] is not proof the tab exists
    // (FEATURE_LOG rule 16). Fail loudly instead.
    return json({ error: 'Could not read the QuickBooks queue: ' + (e && e.message || 'unknown error') }, 500);
  }
}

// POST /qb/send-invoice { id | bill_id, preview_only? }
// Preview returns the resolved customer/vendor/trade + exact lines with ZERO writes.
// Confirm creates the QB Invoice + Bill (find-or-create customer/vendor), writes the
// ids + status back to the Invoice_Review row, and flips the WO to Invoiced.
async function qbSendInvoice(env, body) {
  try {
    const previewOnly = !!body.preview_only;
    const irRows = await fetchTab(env, 'Invoice_Review');
    const ir = irRows.find(r => (body.id && r.ID === body.id) || (body.bill_id && r.Bill_ID === body.bill_id));
    if (!ir) return json({ ok: false, error: 'Invoice_Review row not found' }, 404);
    if (ir.Active === 'FALSE') return json({ ok: false, error: 'This review row is voided' }, 400);

    const haveInv  = !!(ir.QB_Invoice_ID && ir.QB_Invoice_ID.trim());
    const haveBill = !!(ir.QB_Bill_ID && ir.QB_Bill_ID.trim());
    if (haveInv && haveBill && !previewOnly) {
      return json({ ok: true, already_sent: true, invoice_id: ir.QB_Invoice_ID, bill_id: ir.QB_Bill_ID, status: ir.QB_Invoice_Status });
    }

    const [wos, props, owners, vendors, bills, units] = await fetchTabs(env, [
      'Work_Orders','Properties','Owners','Vendors','Vendor_Bills','Units',
    ]);
    const wo      = findWO(wos, ir.WO_ID) || {};
    const prop    = props.find(p => p.ID === wo.Property_ID) || {};
    const owner   = owners.find(o => o.ID === prop.Owner_ID) || null;
    const unit    = units.find(u => u.ID === wo.Unit_ID) || null;
    const vendor  = vendors.find(v => v.ID === ir.Vendor_ID) || {};
    const billRow = bills.find(b => b.ID === ir.Bill_ID) || {};

    // Bill to the most specific place that's actually linked: the unit if it has its own
    // sub-customer, else the building, else the owner. An owner with a dozen buildings
    // otherwise gets one undifferentiated ledger and no way to see which address earns.
    const billTo = qbResolveBillTo(owner, prop, unit);

    const resolved = resolveTrade(wo.Trade);
    const tradeName = resolved.name;
    const trade = QB_TRADE_MAP[tradeName];

    const warnings = [];
    if (!wo.WO_ID && !wo.ID) warnings.push('Work order ' + ir.WO_ID + ' not found — trade defaulted to General.');
    else if (!resolved.matched) warnings.push('WO trade "' + (wo.Trade || 'blank') + '" is not in the QuickBooks map — booking to General. Add it, or pick a listed trade.');
    else if (resolved.via) warnings.push('WO trade "' + resolved.via + '" booked as "' + tradeName + '".');
    // Locks and Pest Control resolve cleanly but share the General repairs account, so
    // neither branch above fires. Without this they'd send with no warning at all, which
    // is less honest than the "not in the QB map" message they used to get.
    if (trade && String(trade.expense) === '68' && tradeName !== 'General') {
      warnings.push(tradeName + ' has no dedicated QuickBooks account yet — booking to General repairs.');
    }
    if (!owner) warnings.push('No owner found for this property — set the property owner before sending.');
    const billToNote = qbBillToNote(billTo, prop, unit);
    if (billToNote) warnings.push(billToNote);
    const custTotal  = Number(ir.Customer_Total) || 0;
    const vendorCost = Number(ir.Vendor_Cost) || 0;
    if (custTotal <= 0) warnings.push('Customer_Total is 0 — nothing to invoice.');
    if (vendorCost <= 0) warnings.push('Vendor_Cost is 0 — the vendor bill will be skipped.');

    // Exactly the receipts that were ticked at approval — read by id, so adding a receipt
    // to the job afterwards can't quietly change what the customer is billed.
    let ownReceipts = [];
    const ownIds = String(ir.Own_Material_IDs || '').split(',').map(x => x.trim()).filter(Boolean);
    if (ownIds.length) {
      try {
        const allReceipts = await fetchTab(env, 'Receipts');
        ownReceipts = allReceipts.filter(r => ownIds.includes(String(r.ID)) && r.Active !== 'FALSE');
        if (ownReceipts.length !== ownIds.length) {
          warnings.push(`${ownIds.length - ownReceipts.length} approved receipt(s) are no longer on this job — the invoice total still stands, but a materials line is missing.`);
        }
      } catch (e) { warnings.push('Could not read the Receipts tab — materials you bought are not itemised on this invoice.'); }
    }

    const inv = buildInvoiceLines(ir, billRow, trade, tradeName, wo, null, ownReceipts);
    if (inv.laborAmt < 0) warnings.push('Materials exceed the customer total — labor line is negative; check the bill.');

    const custDisplay = owner ? (owner.Billing_Name || owner.Company || ((owner.First_Name || '') + ' ' + (owner.Last_Name || '')).trim()) : '';
    const vendDisplay = vendor.Name || ir.Vendor_Name || ('Vendor ' + (ir.Vendor_ID || ''));
    const txnDate = ir.Approved_Date || new Date().toISOString().split('T')[0];
    const note = `RidgeCo IR ${ir.ID} · WO ${ir.WO_ID} · Bill ${ir.Bill_ID}`;

    // Customer-facing photo link (the shared job-photo folder). The folder is shared on confirm only.
    const photoFolderId  = wo.Drive_Folder_ID || '';
    // The ID and the URL are written by two separate updates, so a folder can exist with no
    // URL stored. That folder is real and shareable — build the link from the id rather
    // than telling Brett there are no photos.
    const photoFolderUrl = wo.Drive_Folder_URL || (photoFolderId ? ('https://drive.google.com/drive/folders/' + photoFolderId) : '');
    // The memo is now for the photo link only. The work description moved to the line item
    // where it belongs — repeating it here just made the invoice say the same thing twice.
    const memoParts = [];
    if (photoFolderUrl) memoParts.push('View job photos: ' + photoFolderUrl);
    const customerMemo = memoParts.join('\n');

    // Count receipts (with an image): all → customer invoice; reimbursable → also the vendor bill.
    let reimburseWithUrl = 0, allWithUrl = 0;
    try { const _r = JSON.parse((billRow && billRow.Receipts_JSON) || '[]'); if (Array.isArray(_r)) { allWithUrl = _r.filter(x => x && x.url).length; reimburseWithUrl = _r.filter(x => x && x.pay !== 'account' && x.url).length; } } catch (e) {}

    // DocNumber is deliberately NOT sent — QuickBooks assigns the next number in its own
    // sequence. Supplying one here would break that sequence and collide on a re-send.
    const invoicePayload = { Line: inv.lines, TxnDate: txnDate, PrivateNote: note };
    if (customerMemo) invoicePayload.CustomerMemo = { value: customerMemo.slice(0, 1000) };
    const billPayload = {
      Line: [{
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: +vendorCost.toFixed(2),
        Description: (vendDisplay + ' — ' + tradeName + ' — WO ' + ir.WO_ID).slice(0, 4000),
        AccountBasedExpenseLineDetail: { AccountRef: { value: trade.expense } },
      }],
      TxnDate: txnDate, PrivateNote: note,
    };

    // How many earlier bills THIS vendor already has on this job — only that combination
    // can genuinely collide on a bill number.
    const priorSameVendor = bills.filter(b =>
      b.Active !== 'FALSE' && String(b.WO_ID) === String(ir.WO_ID) &&
      String(b.Vendor_ID) === String(ir.Vendor_ID) && String(b.ID) !== String(ir.Bill_ID) &&
      Number(b.ID) < Number(ir.Bill_ID)).length;
    // Due on receipt on every vendor bill. The date is pinned here — it costs nothing and
    // needs no round trip. The Terms field itself is set just before the POST, where a
    // token already exists, so the preview doesn't pay for a lookup it can't use.
    // The vendor's own terms if the sheet gives any, otherwise due on receipt.
    const termDays = vendorTermDays(vendor);
    const dueDate = new Date(txnDate + 'T12:00:00');
    dueDate.setDate(dueDate.getDate() + termDays);
    billPayload.DueDate = termDays > 0 ? dueDate.toISOString().split('T')[0] : txnDate;

    const billDoc = qbBillDocNumber(billRow, ir, priorSameVendor);
    if (billDoc.number) billPayload.DocNumber = billDoc.number;
    if (billDoc.overlong) {
      warnings.push(`Vendor invoice number "${billDoc.overlong}" is too long for QuickBooks (${QB_DOCNUMBER_MAX} characters), so the bill is numbered ${billDoc.number} instead.`);
    }

    if (previewOnly) {
      // For anything not yet mapped, look it up in the real QuickBooks list so the preview
      // can say "this looks like the customer you already have" instead of flatly claiming
      // it's new and creating a duplicate on confirm. Best-effort: a QuickBooks outage
      // must not block the preview, it just means no suggestion.
      let custSuggest = null, vendSuggest = null, qbCustomers = [], qbVendors = [];
      try {
        const ptok = await qbAccessToken(env);
        if (!(owner && (owner.QBO_Customer_ID || '').trim())) {
          qbCustomers = await qbListEntities(env, 'customer', ptok, false);
          custSuggest = qbMatchEntity(qbCustomers, custDisplay, (owner && (owner.Billing_Email || owner.Email)) || '');
        }
        if (!(vendor.QBO_Vendor_ID || '').trim()) {
          qbVendors = await qbListEntities(env, 'vendor', ptok, false);
          vendSuggest = qbMatchEntity(qbVendors, vendDisplay, vendor.Email || '');
        }
      } catch (e) { warnings.push('Could not read the QuickBooks customer/vendor list — no match suggestions.'); }

      const previewInHouse = String(vendor.In_House || '').toUpperCase() === 'TRUE';
      if (previewInHouse && vendorCost > 0) {
        warnings.push(`No vendor bill will be created — ${vendDisplay} is marked in-house.`);
      }

      if (!photoFolderUrl) {
        warnings.push('No job-photo folder on this work order, so the invoice will carry no photo link. Upload a photo to the job to create one.');
      }

      return json({ preview: {
        ir_id: ir.ID, wo_id: ir.WO_ID, trade: tradeName,
        bill_to: { level: billTo.level, qb_id: billTo.qb_id, display: billTo.display,
                   property: qbPropertyDisplayName(prop), unit: qbUnitLabel(unit),
                   property_id: prop.ID || '', unit_id: (unit && unit.ID) || '',
                   // Same string as the warning above, deliberately: the preview shows it on
                   // the bill-to line and drops it from the warning list, so it reads once.
                   note: billToNote,
                   owner_linked: !!((owner && owner.QBO_Customer_ID) || '').trim() },
        vendor_in_house: previewInHouse,
        customer: { display: custDisplay, existing_id: (owner && owner.QBO_Customer_ID) || '', email: (owner && owner.Billing_Email) || '',
                    owner_id: (owner && owner.ID) || '', suggest: custSuggest, qb_list: qbCustomers },
        vendor:   { display: vendDisplay, existing_id: vendor.QBO_Vendor_ID || '',
                    vendor_id: vendor.ID || '', suggest: vendSuggest, qb_list: qbVendors },
        invoice:  { total: +custTotal.toFixed(2), lines: inv.lines.map(l => ({ desc: l.Description, amount: l.Amount })), attach_receipts: allWithUrl },
        bill:     { total: +vendorCost.toFixed(2), account: trade.expense,
                    terms: vendorTermLabel(vendor),
                    doc_number: qbBillDocNumber(billRow, ir, 0).number,
                    doc_from: qbBillDocNumber(billRow, ir, 0).source,
                    skipped: vendorCost <= 0 || previewInHouse, in_house: previewInHouse, attach_receipts: reimburseWithUrl },
        photo_link: photoFolderUrl,
        already:  { invoice: haveInv ? ir.QB_Invoice_ID : '', bill: haveBill ? ir.QB_Bill_ID : '' },
        warnings,
      }});
    }

    // ---- CONFIRM (writes to QuickBooks) ----
    if (!owner) return json({ ok: false, error: 'No owner on this property — cannot create a QB customer.', warnings });
    if (custTotal <= 0) return json({ ok: false, error: 'Customer_Total is 0 — nothing to invoice.', warnings });

    const token = await qbAccessToken(env);
    const errors = [];
    let invoiceId = ir.QB_Invoice_ID || '';
    let billId    = ir.QB_Bill_ID || '';
    let invoiceDocNumber = '', billDocAssigned = '';

    // Share the job-photo folder so the invoice's CustomerMemo link is viewable by the customer.
    if (photoFolderId) { try { const gtok = await getAccessToken(env); await driveShareAnyone(gtok, photoFolderId); } catch (e) { warnings.push('Photo-link share failed'); } }

    // Batch send skips the preview, so it is the one path where a NEW QuickBooks customer
    // or vendor could be created without Brett ever seeing the "this looks like one you
    // already have" suggestion. When we can see a likely match, stop and send him to the
    // mapping screen rather than quietly creating a second copy of a customer he has.
    if (body.batch) {
      const unmapped = [];
      let checkFailed = '';
      const needsCust = !!(owner && !(owner.QBO_Customer_ID || '').trim());
      const vendorInHouseEarly = String(vendor.In_House || '').toUpperCase() === 'TRUE';
      const needsVend = !!(vendorCost > 0 && vendor && vendor.ID && !(vendor.QBO_Vendor_ID || '').trim() && !vendorInHouseEarly);
      try {
        if (needsCust) {
          const m = qbMatchEntity(await qbListEntities(env, 'customer', token, false), custDisplay, owner.Billing_Email || owner.Email || '');
          if (m && m.confidence !== 'exact') unmapped.push(`customer "${custDisplay}"`);
        }
        if (needsVend && !vendorInHouseEarly) {
          const m = qbMatchEntity(await qbListEntities(env, 'vendor', token, false), vendDisplay, vendor.Email || '');
          if (m && m.confidence !== 'exact') unmapped.push(`vendor "${vendDisplay}"`);
        }
      } catch (e) { checkFailed = e.message || 'could not read the QuickBooks list'; }

      // A failed READ is not permission to proceed. Batch has no preview, so if we could
      // not verify whether these already exist, the next step would create them with
      // nobody watching. Stop and let Brett send this one through Preview & Send.
      if (checkFailed && (needsCust || needsVend)) {
        return json({ ok: false, needs_mapping: true, warnings,
          error: `Not sent: couldn't check QuickBooks for an existing customer/vendor (${checkFailed}). Use Preview & Send for this one so nothing gets created twice.` });
      }
      if (unmapped.length) {
        return json({ ok: false, needs_mapping: true, warnings,
          error: `Not sent: ${unmapped.join(' and ')} may already exist in QuickBooks. Link ${unmapped.length > 1 ? 'them' : 'it'} on the QB Mapping screen, or use Preview & Send to decide.` });
      }
    }

    let customerId = '';
    if (billTo.level !== 'owner' && billTo.qb_id) {
      // Property or unit is already linked — use it directly. Nothing to find or create.
      customerId = billTo.qb_id;
    } else {
      try { customerId = await qbFindOrCreateCustomer(env, owner, custDisplay, token); }
      catch (e) { return json({ ok: false, error: 'Customer: ' + e.message, warnings }); }
    }

    if (!haveInv) {
      invoicePayload.CustomerRef = { value: customerId };
      const r = await qbApi(env, 'invoice?minorversion=73', 'POST', invoicePayload, token);
      invoiceId = (r && r.Invoice && r.Invoice.Id) || '';
      if (!invoiceId) errors.push('Invoice: ' + (qbFault(r) || 'unknown error'));
      else {
        // QuickBooks assigns the invoice number itself — UNLESS "Custom transaction
        // numbers" is on in its settings, in which case an omitted number stays blank.
        invoiceDocNumber = (r.Invoice && r.Invoice.DocNumber) || '';
        if (!invoiceDocNumber) {
          warnings.push('QuickBooks left the invoice number blank. Turn OFF Settings → Sales → Sales form content → Custom transaction numbers, and it will number them itself.');
        } else {
          // QuickBooks' own counter can fall behind invoices entered by hand, and it will
          // happily reuse a number that already exists. Two invoices sharing a number is
          // the kind of thing that surfaces at reconciliation, months later.
          try {
            const dupQ = encodeURIComponent(`select Id, DocNumber from Invoice where DocNumber = '${qbEscape(invoiceDocNumber)}'`);
            const dupR = await qbApi(env, `query?query=${dupQ}&minorversion=73`, 'GET', null, token);
            const hits = (dupR && dupR.QueryResponse && dupR.QueryResponse.Invoice) || [];
            const others = hits.filter(x => String(x.Id) !== String(invoiceId));
            if (others.length) {
              warnings.push(`Invoice number ${invoiceDocNumber} is already used by invoice ${others.map(o => o.Id).join(', ')}. QuickBooks' counter has fallen behind your manual invoices — set the next number in QuickBooks or you'll keep getting duplicates.`);
            }
          } catch (e) { /* the invoice exists; the duplicate check is advisory */ }
        }
      }
    }

    // An in-house vendor is you, or someone on the payroll. The work happened, but no money
    // left the business to a third party, so a QuickBooks Bill would create a payable the
    // company owes itself. The customer invoice is unaffected — the margin is simply real
    // rather than netted against a cost that was never paid out.
    const vendorInHouse = String(vendor.In_House || '').toUpperCase() === 'TRUE';
    if (vendorInHouse && vendorCost > 0) {
      warnings.push(`No vendor bill created — ${vendDisplay} is marked in-house, so there's no payable.`);
    }

    if (!haveBill && vendorCost > 0 && !vendorInHouse) {
      let vendorId = '';
      try { vendorId = await qbFindOrCreateVendor(env, vendor, vendDisplay, token); }
      catch (e) { errors.push('Vendor: ' + e.message); }
      if (vendorId) {
        billPayload.VendorRef = { value: vendorId };
        // Terms, so the bill reads "Due on receipt" rather than showing a blank term
        // alongside a same-day due date.
        const dueTermId = await qbTermForDays(env, token, termDays);
        if (dueTermId) billPayload.SalesTermRef = { value: dueTermId };
        else warnings.push(`QuickBooks has no "${vendorTermLabel(vendor)}" term, so the bill carries the right due date but a blank Terms field. Add that term in QuickBooks and it will be used from then on.`);
        let r = await qbApi(env, 'bill?minorversion=73', 'POST', billPayload, token);
        billId = (r && r.Bill && r.Bill.Id) || '';
        // A rejected bill number should not cost you the bill. Drop it and retry once,
        // rather than failing the whole send over a reference field.
        if (!billId && billPayload.DocNumber && qbIsDocNumberFault(r)) {
          // Only retry on a fault QuickBooks clearly attributes to the bill number. Those
          // are rejected before anything is written, so a second attempt is safe. Any
          // other failure — or a response we can't read as a fault at all — might mean the
          // bill WAS created, and retrying would double-bill the vendor.
          warnings.push('QuickBooks would not accept bill number "' + billPayload.DocNumber + '" (' + (qbFault(r) || '') + ') — created without one.');
          delete billPayload.DocNumber;
          r = await qbApi(env, 'bill?minorversion=73', 'POST', billPayload, token);
          billId = (r && r.Bill && r.Bill.Id) || '';
        }
        if (!billId) errors.push('Bill: ' + (qbFault(r) || 'unknown error'));
        else billDocAssigned = (r.Bill && r.Bill.DocNumber) || '';
      }
    }

    // Attach receipts: ALL to the customer invoice; reimburse-the-vendor ones also to the bill.
    if (invoiceId || billId) { try { await qbAttachReceipts(env, token, invoiceId, billId, billRow, warnings); } catch (e) { warnings.push('Attachments error: ' + (e.message || '')); } }

    // An in-house job is COMPLETE with no bill — treat a deliberately skipped bill the same
    // as no vendor cost, or the row sits at "partial" forever waiting for a bill that is
    // never coming, and Review Bills keeps offering to resume it.
    const billNotOwed = vendorCost <= 0 || vendorInHouse;
    const status = (invoiceId && (billId || billNotOwed)) ? 'sent' : (invoiceId || billId) ? 'partial' : 'pending';
    // Record WHICH ledger this landed on, and whether a bill was deliberately not raised.
    // Without these, an owner ledger lighter than expected has no explanation in the sheet,
    // and in-house rows carry a Vendor_Cost with no matching payable to reconcile against.
    try { await ensureColumns(env, 'Invoice_Review', ['QB_Bill_To', 'QB_In_House', 'QB_Invoice_Number', 'QB_Bill_Number']); }
    catch (e) { warnings.push('Could not record which ledger this billed to — the invoice and bill ids are still saved.'); }
    await updateRow(env, 'Invoice_Review', ir.ID, {
      QB_Invoice_ID: invoiceId, QB_Bill_ID: billId, QB_Invoice_Status: status,
      // The NUMBER, kept apart from the internal id. Screens were showing the id
      // (a five-digit QuickBooks key) under the label "invoice number".
      QB_Invoice_Number: invoiceDocNumber,
      QB_Bill_Number: billDocAssigned,
      QB_Bill_To: billTo.level + (billTo.display ? ': ' + billTo.display : ''),
      QB_In_House: vendorInHouse ? 'TRUE' : 'FALSE',
    });
    if (status === 'sent' && ir.WO_ID) {
      try {
        await updateWOFields(env, ir.WO_ID, { Status: 'Invoiced' });
        // The work order screen reads QBO_Invoice_Number and nothing ever wrote it.
        if (invoiceDocNumber) await updateWOFields(env, ir.WO_ID, { QBO_Invoice_Number: invoiceDocNumber });
      } catch (e) {}
    }

    return json({ ok: errors.length === 0, invoice_id: invoiceId, bill_id: billId,
                  invoice_number: invoiceDocNumber, bill_number: billDocAssigned,
                  status, errors, warnings });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

// ══════════════════════════════════════════════════════════════
//  TRASH SERVICE — one-tap recurring flat-rate billing (B-203)
// ══════════════════════════════════════════════════════════════
// Brett services trash areas 2×/week at a handful of side-by-side rental
// buildings for a flat $40/visit, plus occasional $20-increment extras for
// bulk/cleanup. Two layers, deliberately separate:
//   • Trash_Visits  = PROOF + tracking. One row per trip (photos, date, extra).
//                     This is what the nudge watches and what proves he went.
//   • the QB invoice = MONEY. One invoice per property per WEEK, assembled from
//                     that week's visits. A property doing 2 visits/week bills
//                     one invoice covering both; a property doing 1 (the Lanvale
//                     151/153 split) bills one visit.
// QB customer + item are chosen once per property (existing QB records — no
// find-or-create, so no duplicate customers). Preview-first on every send
// (FL rule 10). Tabs self-provision so this works identically on prod + staging.

const TRASH_PROP_HEADERS  = ['ID','Label','QBO_Customer_ID','Customer_Name','QBO_Item_ID','Item_Name','Flat_Rate','Visits_Per_Week','Nudge_Day','Grace_Days','Active','Created_Date'];
const TRASH_VISIT_HEADERS = ['ID','Property_ID','Label','Visit_Date','Week_Key','Photo_Folder_ID','Photo_Folder_URL','Photo_File_IDs','Base_Rate','Extra_Amount','Extra_Reason','QB_Invoice_ID','QB_Invoice_Number','Invoice_Status','Created_Date','Active'];
const TRASH_DOW = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };

// Monday-anchored week key (YYYY-MM-DD of that week's Monday). Date-only + UTC
// noon so a Baltimore evening never rolls into the next day's bucket.
function trashWeekKey(dateStr) {
  const base = (dateStr && String(dateStr).slice(0,10)) || new Date().toISOString().slice(0,10);
  const d = new Date(base + 'T12:00:00Z');
  const day = d.getUTCDay();            // 0 Sun .. 6 Sat
  const back = day === 0 ? 6 : day - 1; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0,10);
}

// Is `today` at/after this property's nudge deadline for `week`?
// Deadline = (week Monday) + nudge-day offset + grace days.
function trashPastDeadline(p, week, today) {
  const off = TRASH_DOW[String(p.Nudge_Day || 'Thu').slice(0,3)];
  const dayOff = (off === undefined ? 3 : off);
  // Grace defaults to 1 only when unset — an explicit 0 (nudge exactly on the day) must hold.
  const grace = (p.Grace_Days === '' || p.Grace_Days == null) ? 1 : (Number(p.Grace_Days) || 0);
  const dl = new Date(week + 'T12:00:00Z');
  dl.setUTCDate(dl.getUTCDate() + dayOff + grace);
  return today >= dl;
}

// PURE — build QB invoice lines for a set of visits. One flat-rate line per
// visit + one extra line per visit that carried an extra charge. Returns
// { lines, total }. Unit-tested in test/trash.test.mjs.
function buildTrashInvoiceLines(property, visits) {
  const itemRef = { value: String((property && property.QBO_Item_ID) || '40') }; // 40 = General item fallback
  const rate = Number((property && property.Flat_Rate) || 40) || 0;
  const lines = [];
  let total = 0;
  for (const v of (visits || [])) {
    // Blank/missing Base_Rate falls back to the property rate; an explicit 0 stays 0
    // (a visit logged with no base, only an extra). `|| rate` would wrongly bill $40 on a 0.
    const rawBase = (v && v.Base_Rate !== '' && v.Base_Rate != null) ? Number(v.Base_Rate) : rate;
    const base = +(Number(rawBase) || 0).toFixed(2);
    if (base > 0) {
      total += base;
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: base,
        Description: ('Trash service — ' + ((v && v.Visit_Date) || '')).slice(0, 4000),
        SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: base },
      });
    }
    const extra = +(Number(v && v.Extra_Amount) || 0).toFixed(2);
    if (extra > 0) {
      total += extra;
      const reason = String((v && v.Extra_Reason) || 'extra cleanup');
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: extra,
        Description: ('Extra — ' + reason + ' (' + ((v && v.Visit_Date) || '') + ')').slice(0, 4000),
        SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: extra },
      });
    }
  }
  return { lines, total: +total.toFixed(2) };
}

// The ONE generic QuickBooks item every trash property bills against unless it has
// its own. A single shared "Trash Service" item means new properties reuse the exact
// same charge with NO address in the Product/Service column — the address lives only
// on the customer. Find-or-create once, then cached in Config so it costs nothing after.
async function trashDefaultItem(env, token) {
  try {
    const cfg = await fetchConfig(env);
    if (cfg.trash_qb_item_id) return { id: String(cfg.trash_qb_item_id), name: cfg.trash_qb_item_name || 'Trash Service' };
  } catch (e) {}
  // Look for an existing item by name first (don't duplicate one Brett already made).
  try {
    const q = encodeURIComponent("select Id, Name from Item where Name = 'Trash Service'");
    const d = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
    let it = ((d && d.QueryResponse && d.QueryResponse.Item) || [])[0];
    if (!it) {
      const r = await qbApi(env, 'item?minorversion=73', 'POST', { Name: 'Trash Service', Type: 'Service', IncomeAccountRef: { value: '198' } }, token);
      it = (r && r.Item) || (qbDupId(r) ? { Id: qbDupId(r), Name: 'Trash Service' } : null);
    }
    if (it && it.Id) {
      try { await setConfigKey(env, { key: 'trash_qb_item_id', value: String(it.Id) }); await setConfigKey(env, { key: 'trash_qb_item_name', value: it.Name || 'Trash Service' }); } catch (e) {}
      return { id: String(it.Id), name: it.Name || 'Trash Service' };
    }
  } catch (e) {}
  return { id: '40', name: 'General' }; // ultimate fallback: the existing General item
}

// Create the two tabs + headers if missing. Runtime SA has edit on both prod and
// staging sheets, so this provisions each environment on first write — no
// sheet-op round trip, no cross-account sharing to remember.
async function ensureTrashTabs(env) {
  const meta = await sheetsRequest(env, 'GET', '?fields=sheets.properties.title');
  const titles = (meta.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
  const need = [];
  if (!titles.includes('Trash_Properties')) need.push('Trash_Properties');
  if (!titles.includes('Trash_Visits'))     need.push('Trash_Visits');
  if (need.length) {
    await sheetsRequest(env, 'POST', ':batchUpdate', { requests: need.map(t => ({ addSheet: { properties: { title: t } } })) });
  }
  await ensureColumns(env, 'Trash_Properties', TRASH_PROP_HEADERS);
  await ensureColumns(env, 'Trash_Visits', TRASH_VISIT_HEADERS);
}

async function trashListProperties(env) {
  let rows = [];
  try { rows = await fetchTab(env, 'Trash_Properties'); } catch (e) {}
  const out = rows.filter(r => r.Active !== 'FALSE').map(r => ({
    id: r.ID, label: r.Label,
    customer_id: r.QBO_Customer_ID || '', customer_name: r.Customer_Name || '',
    item_id: r.QBO_Item_ID || '', item_name: r.Item_Name || '',
    flat_rate: Number(r.Flat_Rate || 40) || 40,
    visits_per_week: Number(r.Visits_Per_Week || 2) || 2,
    nudge_day: r.Nudge_Day || 'Thu', grace_days: Number(r.Grace_Days || 1) || 1,
  }));
  return json(out);
}

async function trashAddProperty(env, body) {
  if (!body || !body.label) return json({ error: 'label required' }, 400);
  await ensureTrashTabs(env);
  return await addRow(env, 'Trash_Properties', {
    Label: body.label,
    QBO_Customer_ID: body.qbo_customer_id || '', Customer_Name: body.customer_name || '',
    QBO_Item_ID: body.qbo_item_id || '', Item_Name: body.item_name || '',
    Flat_Rate: (body.flat_rate != null && body.flat_rate !== '') ? body.flat_rate : 40,
    Visits_Per_Week: (body.visits_per_week != null && body.visits_per_week !== '') ? body.visits_per_week : 2,
    Nudge_Day: body.nudge_day || 'Thu',
    Grace_Days: (body.grace_days != null && body.grace_days !== '') ? body.grace_days : 1,
    Active: 'TRUE', Created_Date: new Date().toISOString().slice(0,10),
  });
}

// GET /trash/qb-customers — existing QB customers for the add-property dropdown.
async function trashQbCustomers(env) {
  try {
    const token = await qbAccessToken(env);
    const list = await qbListEntities(env, 'customer', token, false);
    return json(list.map(c => ({ id: c.id, name: c.name, path: c.path || c.name })));
  } catch (e) { return json({ error: e.message }, 500); }
}

// GET /trash/qb-items — active Service/NonInventory items for the item dropdown.
async function trashQbItems(env) {
  try {
    const token = await qbAccessToken(env);
    const q = encodeURIComponent('select Id, Name, Type, Active from Item where Active = true maxresults 500');
    const d = await qbApi(env, `query?query=${q}&minorversion=73`, 'GET', null, token);
    const items = ((d && d.QueryResponse && d.QueryResponse.Item) || [])
      .filter(i => i.Type === 'Service' || i.Type === 'NonInventory')
      .map(i => ({ id: i.Id, name: i.Name }));
    return json(items);
  } catch (e) { return json({ error: e.message }, 500); }
}

// POST /trash/log-visit — record ONE trip. Idempotent per property+date: a second
// tap the same day merges photos/extra into the existing row instead of duplicating.
async function trashLogVisit(env, body) {
  if (!body || !body.property_id) return json({ error: 'property_id required' }, 400);
  await ensureTrashTabs(env);
  const props = await fetchTab(env, 'Trash_Properties');
  const p = props.find(r => r.ID === String(body.property_id));
  if (!p) return json({ error: 'property not found' }, 404);

  const visitDate = String(body.visit_date || new Date().toISOString().slice(0,10)).slice(0,10);
  const weekKey = trashWeekKey(visitDate);
  const photoIds = Array.isArray(body.photo_file_ids) ? body.photo_file_ids.filter(Boolean).join(',') : String(body.photo_file_ids || '');
  const extraAmt = +(Number(body.extra_amount || 0) || 0).toFixed(2);

  const visits = await fetchTab(env, 'Trash_Visits');
  const existing = visits.find(v => v.Active !== 'FALSE' && v.Property_ID === String(body.property_id) && v.Visit_Date === visitDate);
  if (existing) {
    const fields = {};
    if (photoIds) fields.Photo_File_IDs = [existing.Photo_File_IDs, photoIds].filter(Boolean).join(',');
    if (body.photo_folder_id)  fields.Photo_Folder_ID  = body.photo_folder_id;
    if (body.photo_folder_url) fields.Photo_Folder_URL = body.photo_folder_url;
    if (extraAmt > 0) {
      fields.Extra_Amount = String(+((Number(existing.Extra_Amount || 0) || 0) + extraAmt).toFixed(2));
      if (body.extra_reason) fields.Extra_Reason = [existing.Extra_Reason, body.extra_reason].filter(Boolean).join('; ');
    }
    if (Object.keys(fields).length) await updateRow(env, 'Trash_Visits', existing.ID, fields);
    return json({ success: true, visit_id: existing.ID, week_key: weekKey, merged: true });
  }

  await addRow(env, 'Trash_Visits', {
    Property_ID: String(body.property_id), Label: p.Label,
    Visit_Date: visitDate, Week_Key: weekKey,
    Photo_Folder_ID: body.photo_folder_id || '', Photo_Folder_URL: body.photo_folder_url || '',
    Photo_File_IDs: photoIds,
    Base_Rate: (p.Flat_Rate || 40),
    Extra_Amount: extraAmt > 0 ? String(extraAmt) : '',
    Extra_Reason: extraAmt > 0 ? (body.extra_reason || '') : '',
    QB_Invoice_ID: '', QB_Invoice_Number: '', Invoice_Status: 'unbilled',
    Created_Date: new Date().toISOString(), Active: 'TRUE',
  });
  return json({ success: true, week_key: weekKey, merged: false });
}

// GET /trash/week?week=YYYY-MM-DD&property_id= — per-property status for one week.
async function trashWeek(env, url) {
  const week = (url && url.searchParams.get('week')) || trashWeekKey(null);
  const pid  = (url && url.searchParams.get('property_id')) || '';
  let props = [], visits = [];
  try { props  = await fetchTab(env, 'Trash_Properties'); } catch (e) {}
  try { visits = await fetchTab(env, 'Trash_Visits'); } catch (e) {}
  props = props.filter(p => p.Active !== 'FALSE' && (!pid || p.ID === pid));
  const out = props.map(p => {
    const vs = visits.filter(v => v.Active !== 'FALSE' && v.Property_ID === p.ID && v.Week_Key === week);
    const expected = Number(p.Visits_Per_Week || 2) || 2;
    const billed = vs.filter(v => v.QB_Invoice_ID);
    const base  = vs.reduce((s, v) => s + (Number(v.Base_Rate || p.Flat_Rate || 40) || 0), 0);
    const extra = vs.reduce((s, v) => s + (Number(v.Extra_Amount || 0) || 0), 0);
    return {
      property_id: p.ID, label: p.Label, week, expected, logged: vs.length,
      visits: vs.map(v => ({ id: v.ID, date: v.Visit_Date, extra: Number(v.Extra_Amount || 0) || 0, reason: v.Extra_Reason || '', billed: !!v.QB_Invoice_ID })),
      base_total: +base.toFixed(2), extra_total: +extra.toFixed(2), total: +(base + extra).toFixed(2),
      invoiced: billed.length > 0 && billed.length === vs.length,
      qb_invoice_id: (billed[0] && billed[0].QB_Invoice_ID) || '',
      qb_invoice_number: (billed[0] && billed[0].QB_Invoice_Number) || '',
      ready_to_invoice: vs.length > 0 && billed.length < vs.length,
    };
  });
  return json({ week, properties: out });
}

// GET /trash/unbilled — what needs Brett's attention. Powers the push nudge.
// Last week: any shortfall OR any logged-but-uninvoiced visit. This week: a
// shortfall only once past the property's nudge deadline (so a day-late trip
// never false-alarms).
async function trashUnbilled(env, url) {
  const today = new Date();
  const thisWeek = trashWeekKey(today.toISOString().slice(0,10));
  const prevD = new Date(thisWeek + 'T12:00:00Z'); prevD.setUTCDate(prevD.getUTCDate() - 7);
  const prevWeek = prevD.toISOString().slice(0,10);
  let props = [], visits = [];
  try { props  = await fetchTab(env, 'Trash_Properties'); } catch (e) {}
  try { visits = await fetchTab(env, 'Trash_Visits'); } catch (e) {}
  props = props.filter(p => p.Active !== 'FALSE');
  const items = [];
  for (const week of [prevWeek, thisWeek]) {
    for (const p of props) {
      const vs = visits.filter(v => v.Active !== 'FALSE' && v.Property_ID === p.ID && v.Week_Key === week);
      const expected = Number(p.Visits_Per_Week || 2) || 2;
      const missed = Math.max(0, expected - vs.length);
      const unbilled = vs.filter(v => !v.QB_Invoice_ID);
      if (week === prevWeek) {
        if (missed > 0)        items.push({ property_id: p.ID, label: p.Label, week, type: 'missed',   missing: missed,        message: `${p.Label}: ${missed} of ${expected} visits not logged for last week.` });
        if (unbilled.length)   items.push({ property_id: p.ID, label: p.Label, week, type: 'unbilled', count: unbilled.length, message: `${p.Label}: ${unbilled.length} logged visit(s) from last week not invoiced yet.` });
      } else if (missed > 0 && trashPastDeadline(p, week, today)) {
        items.push({ property_id: p.ID, label: p.Label, week, type: 'missed', missing: missed, message: `${p.Label}: ${missed} of ${expected} visits still not logged this week.` });
      }
    }
  }
  return json({ generated_at: new Date().toISOString(), this_week: thisWeek, prev_week: prevWeek, count: items.length, items });
}

// POST /trash/invoice { property_id, week?, preview_only? } — assemble + send the
// weekly QB invoice for the visits not yet billed. Preview writes nothing.
async function trashInvoice(env, body) {
  try {
    const previewOnly = !!(body && body.preview_only);
    if (!body || !body.property_id) return json({ ok: false, error: 'property_id required' }, 400);
    const week = body.week || trashWeekKey(null);
    await ensureTrashTabs(env);
    const props = await fetchTab(env, 'Trash_Properties');
    const p = props.find(r => r.ID === String(body.property_id));
    if (!p) return json({ ok: false, error: 'property not found' }, 404);

    const allVisits = await fetchTab(env, 'Trash_Visits');
    const weekVisits = allVisits.filter(v => v.Active !== 'FALSE' && v.Property_ID === p.ID && v.Week_Key === week);
    if (!weekVisits.length) return json({ ok: false, error: 'No visits logged for this property/week' }, 400);

    const toBill = weekVisits.filter(v => !v.QB_Invoice_ID);
    const alreadyBilled = weekVisits.filter(v => v.QB_Invoice_ID);
    if (!toBill.length) {
      return json({ ok: true, already_sent: true, invoice_id: alreadyBilled[0].QB_Invoice_ID, invoice_number: alreadyBilled[0].QB_Invoice_Number });
    }

    const warnings = [];
    const hasOwnItem = !!String(p.QBO_Item_ID || '').trim();
    const photoCount = toBill.reduce((s, v) => s + String(v.Photo_File_IDs || '').split(',').filter(Boolean).length, 0);

    if (previewOnly) {
      // Preview writes NOTHING (no item creation). Line descriptions don't depend on the item
      // id, so build with the property as-is purely for display of amounts.
      const pv = buildTrashInvoiceLines(p, toBill);
      if (pv.total <= 0) return json({ ok: false, error: 'Nothing to invoice (total is 0)' }, 400);
      if (!p.QBO_Customer_ID) warnings.push('No QuickBooks customer set on this property — set one before sending.');
      if (!hasOwnItem) warnings.push('Will bill the shared generic "Trash Service" item — keeps the invoice free of any address.');
      if (!photoCount) warnings.push('No photos on these visits — the invoice will carry no photo proof.');
      return json({ preview: {
        property: p.Label, week,
        customer: { id: p.QBO_Customer_ID || '', name: p.Customer_Name || '' },
        visits: toBill.map(v => ({ date: v.Visit_Date, base: Number(v.Base_Rate || p.Flat_Rate || 40) || 0, extra: Number(v.Extra_Amount || 0) || 0, reason: v.Extra_Reason || '' })),
        lines: pv.lines.map(l => ({ desc: l.Description, amount: l.Amount })),
        total: +pv.total.toFixed(2), attach_photos: photoCount, warnings,
      }});
    }

    // ---- CONFIRM (writes to QuickBooks) ----
    if (!p.QBO_Customer_ID) return json({ ok: false, error: 'No QuickBooks customer set on this property.', warnings });
    const token = await qbAccessToken(env);
    // Resolve the billing item: the property's own, else the shared generic "Trash Service"
    // item (find-or-created ONCE here — never during preview). Keeps every property's invoice
    // free of any address in the Product/Service column.
    let itemId = String(p.QBO_Item_ID || '').trim();
    if (!itemId) {
      try { const gi = await trashDefaultItem(env, token); itemId = gi.id; }
      catch (e) { itemId = '40'; warnings.push('Could not resolve the generic Trash Service item — billed to General (40).'); }
    }
    const { lines, total } = buildTrashInvoiceLines(Object.assign({}, p, { QBO_Item_ID: itemId }), toBill);
    if (total <= 0) return json({ ok: false, error: 'Nothing to invoice (total is 0)' }, 400);
    const txnDate = String((toBill[toBill.length - 1].Visit_Date) || new Date().toISOString().slice(0,10)).slice(0,10);
    const payload = {
      CustomerRef: { value: String(p.QBO_Customer_ID) },
      Line: lines, TxnDate: txnDate,
      PrivateNote: `RidgeCo Trash — ${p.Label} — week ${week}`,
    };
    const r = await qbApi(env, 'invoice?minorversion=73', 'POST', payload, token);
    const invoiceId = (r && r.Invoice && r.Invoice.Id) || '';
    const invoiceNumber = (r && r.Invoice && r.Invoice.DocNumber) || '';
    if (!invoiceId) return json({ ok: false, error: 'Invoice: ' + (qbFault(r) || 'unknown error'), warnings }, 500);

    // Stamp every billed visit IMMEDIATELY — before the slower photo attach — so a crash or
    // a Sheets write error mid-attach can never leave the invoice created in QuickBooks while
    // the visits still read as unbilled, which is exactly what would double-bill on a re-send.
    const stampFail = [];
    for (const v of toBill) {
      try {
        const resp = await updateRow(env, 'Trash_Visits', v.ID, { QB_Invoice_ID: invoiceId, QB_Invoice_Number: invoiceNumber, Invoice_Status: 'invoiced' });
        if (!resp || !resp.ok) stampFail.push(v.ID);
      } catch (e) { stampFail.push(v.ID); }
    }
    if (stampFail.length) {
      // The invoice IS in QuickBooks. Tell the truth and stop a retry cold — a second send
      // would create a duplicate. Brett fixes the tracking by hand rather than re-billing.
      return json({ ok: false, invoice_created: true, invoice_id: invoiceId, invoice_number: invoiceNumber,
        error: `Invoice ${invoiceNumber || invoiceId} WAS created in QuickBooks, but ${stampFail.length} visit(s) could not be marked as billed (ids ${stampFail.join(', ')}). DO NOT resend — that would duplicate the invoice. The invoice is correct; only the Hub's record of it needs a manual fix.`,
        warnings }, 500);
    }

    // Attach before/after photos to the invoice — best-effort, never blocks the send.
    let attached = 0;
    try {
      const gtok = await getAccessToken(env);
      for (const v of toBill) {
        for (const fid of String(v.Photo_File_IDs || '').split(',').filter(Boolean)) {
          try {
            const dl = await driveDownload(gtok, fid);
            const ext = dl.mime.includes('pdf') ? '.pdf' : dl.mime.includes('png') ? '.png' : '.jpg';
            const name = (p.Label + ' ' + v.Visit_Date + ' ' + fid.slice(-4) + ext).replace(/[^\w .-]/g, '_');
            await qbUploadAttachable(env, token, 'Invoice', invoiceId, name, dl.mime, dl.bytes, true);
            attached++;
          } catch (e) { warnings.push('Photo attach failed: ' + (e.message || '')); }
        }
      }
    } catch (e) { warnings.push('Photo attach skipped: ' + (e.message || '')); }

    return json({ ok: true, invoice_id: invoiceId, invoice_number: invoiceNumber, total: +total.toFixed(2), photos_attached: attached, warnings });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

// ── UTILITY ──────────────────────────────────────────────────

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function twilioResponse(msg) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`, { headers: { 'Content-Type': 'text/xml' } });
}
function col(index) {
  let letter='', n=index;
  while(n>=0){letter=String.fromCharCode((n%26)+65)+letter;n=Math.floor(n/26)-1;}
  return letter;
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  return '+' + digits;
}
