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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url  = new URL(request.url);
    const path = url.pathname;

    // ── STAGING SANDBOX (B-103) ──────────────────────────────────────────────
    // Cloudflare preview deployments SHARE production secrets/env, so a preview of
    // new code would otherwise write to the LIVE sheet and fire REAL SMS. Isolate
    // the DATA in code instead: swap SHEET_ID for STAGING_SHEET_ID and make sendSMS
    // log-only. Everything else behaves identically.
    // Fails CLOSED: if staging is detected but STAGING_SHEET_ID is unset we refuse
    // the request rather than silently falling back to the production sheet.
    if (url.hostname.startsWith('staging-') || env.STAGING === '1') {
      if (!env.STAGING_SHEET_ID)
        return json({ error: 'Staging mode active but STAGING_SHEET_ID is not set — refusing to fall back to the live sheet.' }, 503);
      env = { ...env, STAGING: '1', SHEET_ID: env.STAGING_SHEET_ID };
      // QuickBooks has NO staging equivalent — the creds point at the live realm.
      // Two ways staging would corrupt production if these ran: (a) Intuit ROTATES
      // and invalidates the refresh token on every refresh and qbAccessToken
      // persists the new one to the *staging* Config, leaving production holding a
      // dead token (FEATURE_LOG rule 8); (b) /qb/send-invoice would create a REAL
      // invoice from test data. Note the /qb/* read routes are in PUBLIC_PATHS, so
      // this must be blocked before the auth gate, not after.
      if (path.startsWith('/qb'))
        return json({ error: 'QuickBooks is disabled in staging — it has no sandbox and would rotate the production refresh token.', staging: true }, 503);
    }

    const PUBLIC_PATHS = ['/sms-inbound','/qb/test','/qb/accounts','/qb/setup-trades','/qb/connect','/qb/callback','/qb/webhook'];
    if (!PUBLIC_PATHS.includes(path)) {
      // Shared-secret gate. Rotated 2026-07-20 (old value retired). NOTE: this is a
      // coarse anti-bot gate only — real per-record authz is enforced per endpoint
      // (Owner_ID / vendor_id / PIN). Slated for replacement by per-user auth.
      const token = request.headers.get('X-Auth-Token');
      // /intake* accepts its own dedicated INTAKE_TOKEN so that rotating the shared
      // WORKER_SECRET (security build) doesn't break the Apps Script poller, and vice
      // versa. WORKER_SECRET still works so the Hub can call these routes too.
      const intakeOk = path.startsWith('/intake') && env.INTAKE_TOKEN && token === env.INTAKE_TOKEN;
      if (!intakeOk && token !== env.WORKER_SECRET)
        return json({ error: 'Unauthorized' }, 401);
    }
    try {
      if (request.method === 'GET') {
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
        if (path === '/owner-export')           return await ownerExport(env, url);
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
        if (path === '/qb/ready')               return await qbReadyQueue(env);
      }
      if (request.method === 'POST') {
        if (path === '/upload-photo') return await handlePhotoUploadClean(env, request);
        if (path === '/sms-inbound')  return await handleInboundSMS(env, request);
        const body = await request.json();
        if (path === '/workorder')                return await createWorkOrder(env, body);
        if (path === '/workorder/update')         return await updateRow(env, 'Work_Orders', body.id, body.fields);
        if (path === '/workorder/notes')          return await appendWONotes(env, body);
        if (path === '/wo/append-entry-note')     return await appendEntryNote(env, body);
        if (path === '/workorder/vendor-note')    return await addVendorNote(env, body);
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
        if (path === '/admin/reformat-sheets')    return await adminReformatSheets(env);
        if (path === '/admin/test-drive')         return await testDriveAccess(env);
        if (path === '/estimate')                 return await addEstimateVersion(env, body);
        if (path === '/estimate/approve')         return await approveEstimate(env, body);
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
        if (path === '/invoice-review/approve')   return await approveInvoiceReview(env, body);
        if (path === '/qb/send-invoice')          return await qbSendInvoice(env, body);
        if (path === '/intake')                   return await handleIntake(env, body);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message, stack: err.stack, type: err.constructor.name }, 500);
    }
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
    const [props, units] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Units')]);
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
    });
  });
}

async function ownerByPin(env, url) {
  const pin = url.searchParams.get('pin') || '';
  const _ownerName = (url.searchParams.get('name') || '').trim();
  if (!_ownerName) return json({ error: 'First name is required', name_required: true }, 400);
  return await pinLookup(env, pin, async (p) => {
    const [ownerUsers, owners] = await Promise.all([fetchTab(env, 'Owner_Users'), fetchTab(env, 'Owners')]);
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
      });
    }
    const owner = owners.find(o => o.PIN && o.PIN.toLowerCase() === p.toLowerCase() && o.Active !== 'FALSE');
    if (!owner) return null;
    return json({
      owner_id: owner.ID, owner_name: `${owner.First_Name} ${owner.Last_Name||''}`.trim(),
      owner_company: owner.Company||'', owner_phone: owner.Phone||'',
      user_name: `${owner.First_Name} ${owner.Last_Name||''}`.trim(), is_sub_user: false,
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
    step.current = 'find_wo_folder';
    const woLabel  = woId || `upload_${Date.now()}`;
    // Vendor cost docs (receipts/bills/invoices) go to a NON-shared internal folder — never the
    // customer-facing WO folder that gets shared on the invoice. Job photos stay in the WO folder.
    const INTERNAL_TYPES = ['receipt','bill','invoice'];
    const isInternal = INTERNAL_TYPES.includes(fileType.toLowerCase());
    const woFolder = await getWOFolder(token, propsRoot, propAddr, woLabel, isInternal);
    if (!woFolder || !woFolder.id) return json({ error: `Could not find/create WO folder "${woLabel}"`, step: step.current }, 500);
    step.current = 'upload_file';
    const arrayBuffer = await file.arrayBuffer();
    const uploaded = await uploadFileToDrive(token, arrayBuffer, filename, mimeType, woFolder.id, propsRoot);
    if (!uploaded || !uploaded.id) return json({ error: 'Drive upload failed', step: step.current }, 500);
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

function isTenantNotifiable(tenant, wo) {
  if (!tenant || !tenant.Phone) return false;
  if (tenant.Active === 'FALSE') return false;
  const now = new Date();
  if (tenant.Move_Out_Date) { const moveOut = new Date(tenant.Move_Out_Date + 'T23:59:59'); if (moveOut < now) return false; }
  if (tenant.Move_In_Date && wo && wo.Created_Date) { if (new Date(tenant.Move_In_Date) > new Date(wo.Created_Date)) return false; }
  return true;
}

function roundUpTo15(minutes) { if (minutes <= 0) return 15; return Math.ceil(minutes / 15) * 15; }

async function listTimeEntries(env, url) {
  const woId = url.searchParams.get('wo_id') || '', vendorId = url.searchParams.get('vendor_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  try {
    const rows = await fetchTab(env, 'Time_Entries');
    let results = rows.filter(r => r.WO_ID === woId && r.Active !== 'FALSE');
    if (vendorId) results = results.filter(r => r.Role === 'vendor' && r.Entered_By_ID === vendorId);
    return json(results.sort((a, b) => new Date(a.Created_Date) - new Date(b.Created_Date)));
  } catch(e) { return json([]); }
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
  await addRow(env, 'Receipts', { WO_ID: wo_id, Amount: amt.toFixed(2), Description: description||'', Store: store||'', Date: date||new Date().toISOString().split('T')[0], Added_By: added_by||'', Added_By_ID: String(added_by_id||''), Role: role||'hub', Created_Date: new Date().toISOString(), Active: 'TRUE' });
  return json({ success: true, amount: amt.toFixed(2) });
}

async function addTimeEntry(env, body) {
  const { wo_id, entered_by, entered_by_id, role, entry_type, start_datetime, end_datetime, duration_minutes_raw, notes, billable, hourly_rate } = body;
  if (!wo_id) return json({ error: 'wo_id required' }, 400);
  if (!role)  return json({ error: 'role required (hub or vendor)' }, 400);
  let durationMinutes = 0;
  if (start_datetime && end_datetime) { durationMinutes = roundUpTo15((new Date(end_datetime) - new Date(start_datetime)) / 60000); }
  else if (duration_minutes_raw) { durationMinutes = roundUpTo15(parseFloat(duration_minutes_raw) || 0); }
  if (durationMinutes <= 0) return json({ error: 'Could not calculate duration' }, 400);
  const rate = parseFloat(hourly_rate || 0);
  const billableAmt = (billable === 'TRUE' || billable === true) ? (durationMinutes / 60) * rate : 0;
  await addRow(env, 'Time_Entries', { WO_ID: wo_id, Entered_By: entered_by||'', Entered_By_ID: String(entered_by_id||''), Role: role, Entry_Type: entry_type || (role === 'hub' ? 'Admin' : 'Labor'), Start_DateTime: start_datetime||'', End_DateTime: end_datetime||'', Duration_Minutes: String(durationMinutes), Notes: notes||'', Billable: role === 'hub' ? String(billable === 'TRUE' || billable === true) : 'TRUE', Hourly_Rate: String(rate), Billable_Amount: String(billableAmt.toFixed(2)), Created_Date: new Date().toISOString(), Active: 'TRUE' });
  return json({ success: true, duration_minutes: durationMinutes });
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
  await updateRow(env, 'Tenants', tenant_id, { Active: 'FALSE', Move_Out_Date: moveOutDate, PIN: '' });
  let retroCount = 0;
  try {
    const [wos, woTenants] = await Promise.all([fetchTab(env,'Work_Orders'), fetchTab(env,'WO_Tenants')]);
    for (const link of woTenants.filter(r => r.Tenant_ID === tenant_id && r.Active !== 'FALSE')) {
      const wo = wos.find(w => w.ID === link.WO_ID);
      if (!wo || !wo.Created_Date) continue;
      if (new Date(wo.Created_Date) > moveOutDt) { await updateRow(env, 'WO_Tenants', link.ID, { Active: 'FALSE' }); retroCount++; }
    }
  } catch(e) {}
  return json({ success: true, move_out_date: moveOutDate, retro_wos_cleaned: retroCount });
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
  const newRow = headers.map(h => ({ ID: woId, Property_ID: body.property_id||'', Unit_ID: body.unit_id||'', Tenant_ID: body.tenant_id||'', Vendor_ID: '', Type: body.type||'manual', Trade: body.trade||'', Description: body.description||'', Priority: body.priority||'normal', Status: 'New', Scheduled_Date: '', Scheduled_Window: '', Completed_Date: '', Invoice_ID: '', Owner_WO_Ref: body.owner_wo_ref||'', WO_Contact_Name: body.wo_contact_name||'', WO_Contact_Phone: body.wo_contact_phone||'', Tenant_Visible: body.tenant_visible !== false && body.tenant_visible !== 'FALSE' ? 'TRUE' : 'FALSE', Tenant_Notify_Created: body.tenant_notify_created !== false && body.tenant_notify_created !== 'FALSE' ? 'TRUE' : 'FALSE', Tenant_Notify_Updates: body.tenant_notify_updates !== false && body.tenant_notify_updates !== 'FALSE' ? 'TRUE' : 'FALSE', Vendor_SMS_Sent: 'FALSE', Tenant_SMS_Sent: 'FALSE', Owner_Notified: 'FALSE', Created_By: body.created_by||'admin', Created_Date: now, Notes: body.notes||'', Admin_Notes: body.admin_notes||'', Hold_Reason: '', Vendor_Needs_Access: body.vendor_needs_access||'auto' }[h] ?? ''));
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
  return json({ success: true, id: woId });
}

// One attributed line: "[Jul 21, 3:45 PM — Brett] text". Shared by every
// append-only WO field so attribution can't drift between them (B-104).
function attributedLine(text, author) {
  const ts = new Date().toLocaleString('en-US', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  return `${author ? `[${ts} — ${author}] ` : `[${ts}] `}${text}`;
}

// APPEND, never overwrite. Entry_Notes and Vendor_Thread are multi-source: Brett's
// "lockbox is red" and Buildium's "call 24h ahead" must BOTH survive on the same
// WO, so a write that replaces the field is always a bug.
async function appendWOField(env, woId, field, text, author, wo = null) {
  if (!text) return { skipped: true };
  if (!wo) {
    const workorders = await fetchTab(env, 'Work_Orders');
    wo = findWO(workorders, woId);
    if (!wo) return { error: 'WO not found' };
  }
  const existing = wo[field] || '';
  const line = attributedLine(text, author);
  await updateWOFields(env, woId, { [field]: existing ? `${existing}\n${line}` : line });
  return { success: true, line };
}

async function appendWONotes(env, body) {
  const workorders = await fetchTab(env, 'Work_Orders');
  const wo = findWO(workorders, body.wo_id);
  if (!wo) return json({ error: 'WO not found' }, 404);
  const res = await appendWOField(env, body.wo_id, 'Notes', body.note, body.author, wo);
  if (res.error) return json({ error: res.error }, 404);
  return json({ success: true });
}

// Admin appends access/scheduling info to a WO. Append-only + attributed.
async function appendEntryNote(env, body) {
  if (!body.wo_id || !body.note) return json({ error: 'wo_id and note required' }, 400);
  const res = await appendWOField(env, body.wo_id, 'Entry_Notes', body.note, body.author || 'admin');
  if (res.error) return json({ error: res.error }, 404);
  return json({ success: true, line: res.line });
}

// Vendor writes to the shared private admin↔vendor thread. Scoped: a vendor may
// only post to a WO actually assigned to them.
async function addVendorNote(env, body) {
  if (!body.wo_id || !body.note) return json({ error: 'wo_id and note required' }, 400);
  if (!body.vendor_id) return json({ error: 'vendor_id required' }, 400);
  const [workorders, vendors] = await Promise.all([fetchTab(env, 'Work_Orders'), fetchTab(env, 'Vendors')]);
  const wo = findWO(workorders, body.wo_id);
  if (!wo) return json({ error: 'WO not found' }, 404);
  if (String(wo.Vendor_ID) !== String(body.vendor_id)) return json({ error: 'Unauthorized' }, 403);
  const vendor = vendors.find(v => v.ID === body.vendor_id) || {};
  let text = body.note;
  if (vendor.Language === 'es') {
    const en = await translateToEnglish(env, text);
    if (en && en !== text) text = `[ES] ${text}\n[EN] ${en}`;
  }
  const name = vendor.Name || `${vendor.First_Name||''} ${vendor.Last_Name||''}`.trim() || 'Vendor';
  const res = await appendWOField(env, body.wo_id, 'Vendor_Admin_Notes', text, `${name} (vendor)`, wo);
  await logWOAudit(env, body.wo_id, name, 'vendor', 'Vendor_Admin_Notes', '', text.substring(0, 100), 'Vendor note appended');
  return json({ success: true, line: res.line });
}

// The owner-facing export payload (WO PDF, owner email, anything a customer
// receives). Deliberately a SEPARATE endpoint built through ownerExportWO() so a
// future PDF cannot be wired to the raw row by accident.
async function ownerExport(env, url) {
  const ownerId = url.searchParams.get('owner_id');
  const woId    = url.searchParams.get('wo_id');
  if (!ownerId) return json({ error: 'Missing owner_id' }, 400);
  const [workorders, properties, units, tenants, keys, vendors] = await Promise.all([
    fetchTab(env,'Work_Orders'), fetchTab(env,'Properties'), fetchTab(env,'Units'),
    fetchTab(env,'Tenants'), fetchTab(env,'Keys'), fetchTab(env,'Vendors'),
  ]);
  const ownerPropIds = new Set(properties.filter(p => String(p.Owner_ID) === String(ownerId)).map(p => p.ID));
  let wos = workorders.filter(w => ownerPropIds.has(w.Property_ID));
  if (woId) wos = wos.filter(w => w.ID === woId);
  const out = wos.map(wo => ownerExportWO(
    enrichWO(wo, properties, units, tenants, keys, { omitLockbox: true, omitTenantPhone: true, ownerView: true, vendors })
  ));
  return json(out);
}
async function assignVendor(env, body) {
  const [workorders, vendors, tenants, units, properties, keys] = await Promise.all([
    fetchTab(env,'Work_Orders'), fetchTab(env,'Vendors'), fetchTab(env,'Tenants'),
    fetchTab(env,'Units'), fetchTab(env,'Properties'), fetchTab(env,'Keys'),
  ]);
  const wo = findWO(workorders, body.wo_id); if (!wo) return json({ error: 'WO not found' }, 404);
  const vendor = vendors.find(v => v.ID === body.vendor_id); if (!vendor) return json({ error: 'Vendor not found' }, 404);
  const property = properties.find(p => p.ID === wo.Property_ID);
  const unit     = units.find(u => u.ID === wo.Unit_ID);
  const tenant   = tenants.find(t => t.ID === (unit?.Tenant_ID || wo.Tenant_ID));
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
  return json({ success: true, vendor_sms: vendorSMSSent, tenant_sms: tenantSMSSent });
}

async function updateStatus(env, body) {
  const workorders = await fetchTab(env, 'Work_Orders');
  const wo = findWO(workorders, body.wo_id);
  if (!wo) return json({ error: 'WO not found' }, 404);
  const changedBy = body.updated_by || 'system', changedRole = body.updated_by_role || 'admin';
  const fields = { Status: body.status };
  let statusNote = '';
  if (body.notes) {
    statusNote = body.notes;
    if (body.vendor_id) {
      const sVendors = await fetchTab(env, 'Vendors');
      const sVendor = sVendors.find(v => v.ID === body.vendor_id);
      if (sVendor?.Language === 'es') { const en = await translateToEnglish(env, statusNote); if (en && en !== statusNote) statusNote = `[ES] ${statusNote}\n[EN] ${en}`; }
    }
    // Was `fields.Notes = statusNote` — a destructive OVERWRITE that replaced the
    // entire note history with one status comment, on a field the owner and
    // tenant portals both rendered. Now appended to the private admin↔vendor
    // thread after the status write.
  }
  // Moving to On Hold captures the plain-language reason. Hold_Reason is the ONE
  // note field the matrix exposes to owner and tenant, so it is written from an
  // explicit hold_reason, never silently from an internal status note.
  if (body.status === 'On Hold' && body.hold_reason) fields.Hold_Reason = body.hold_reason;
  if (body.scheduled_date) fields.Scheduled_Date = body.scheduled_date;
  if (body.status === 'Complete' || body.status === 'Pending Invoice')
    fields.Completed_Date = wo.Completed_Date || new Date().toISOString();
  await updateWOFields(env, body.wo_id, fields);
  if (statusNote) await appendWOField(env, body.wo_id, 'Vendor_Admin_Notes', statusNote, `${changedBy} (${changedRole})`, wo);
  await logWOAudit(env, body.wo_id, changedBy, changedRole, 'Status', wo.Status||'', body.status, body.notes||'');
  const config = await fetchConfig(env);
  if (body.status === 'Complete') {
    const [units, tenants, properties] = await Promise.all([fetchTab(env,'Units'), fetchTab(env,'Tenants'), fetchTab(env,'Properties')]);
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
      const [properties, owners] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Owners')]);
      const property = properties.find(p => p.ID === wo.Property_ID), owner = property ? owners.find(o => o.ID === property.Owner_ID) : null;
      if (owner?.Phone) {
        const statusMsgs = { Assigned: `Hi ${owner.First_Name}, a technician has been assigned to the ${wo.Trade} job at ${property.Address}. Ref: ${body.wo_id}.`, Scheduled: `Hi ${owner.First_Name}, the ${wo.Trade} job at ${property.Address} has been scheduled. Ref: ${body.wo_id}.`, Complete: `Hi ${owner.First_Name}, the ${wo.Trade} work at ${property.Address} is complete. An invoice will follow. Ref: ${body.wo_id}.`, Invoiced: `Hi ${owner.First_Name}, an invoice has been submitted for ${wo.Trade} at ${property.Address}. Ref: ${body.wo_id}. Contact us with any questions.` };
        const msg = statusMsgs[body.status];
        if (msg) { await sendSMS(env, owner.Phone, msg); await logSMS(env, body.wo_id, `owner_${body.status.toLowerCase()}`, owner.ID, owner.Phone, msg); await updateWOFields(env, body.wo_id, { Owner_Notified: 'TRUE' }); }
      }
    }
  }
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
  const [workorders, properties, units, tenants, keys, config, vendors] = await Promise.all([
    fetchTab(env,'Work_Orders'), fetchTab(env,'Properties'), fetchTab(env,'Units'),
    fetchTab(env,'Tenants'), fetchTab(env,'Keys'), fetchConfig(env), fetchTab(env,'Vendors'),
  ]);
  let tradeAccessDefaults = {};
  try { tradeAccessDefaults = JSON.parse(config.Access_Trade_Defaults || '{}'); } catch(e) {}
  const wos = workorders.filter(w => w.Vendor_ID === vendorId && (includeClosed || OPEN_WO_STATUSES.includes(w.Status)));
  // vendorView is explicit so the vendor gets the vendor allowlist (no
  // Admin_Notes, no legacy Notes) rather than falling through to admin.
  const enriched = wos.map(wo => enrichWO(wo, properties, units, tenants, keys, { tradeAccessDefaults, vendorView: true, vendors }));
  enriched.sort((a, b) => { const pa = PRIORITY_ORDER[a.Priority?.toLowerCase()] ?? 2, pb = PRIORITY_ORDER[b.Priority?.toLowerCase()] ?? 2; return pa !== pb ? pa - pb : (a.property_address||'').localeCompare(b.property_address||''); });
  return json(enriched);
}

async function tenantWorkorders(env, url) {
  const tenantId = url.searchParams.get('tenant_id');
  if (!tenantId) return json({ error: 'Missing tenant_id' }, 400);
  const includeClosed = url.searchParams.get('include_closed') === 'true';
  const [workorders, properties, units, tenants, keys, vendors] = await Promise.all([fetchTab(env,'Work_Orders'), fetchTab(env,'Properties'), fetchTab(env,'Units'), fetchTab(env,'Tenants'), fetchTab(env,'Keys'), fetchTab(env,'Vendors')]);
  const tenant = tenants.find(t => t.ID === tenantId); if (!tenant) return json([]);
  const wos = workorders.filter(w => { if (w.Tenant_Visible === 'FALSE') return false; if (!includeClosed && !OPEN_WO_STATUSES.includes(w.Status)) return false; if (w.Property_ID !== tenant.Property_ID) return false; if (tenant.Unit_ID) return w.Unit_ID === tenant.Unit_ID || w.Tenant_ID === tenantId; return true; });
  const enriched = wos.map(wo => enrichWO(wo, properties, units, tenants, keys, { omitLockbox: true, tenantView: true, vendors }));
  enriched.sort((a, b) => new Date(b.Created_Date) - new Date(a.Created_Date));
  return json(enriched);
}

async function ownerWorkorders(env, url) {
  const ownerId = url.searchParams.get('owner_id');
  if (!ownerId) return json({ error: 'Missing owner_id' }, 400);
  const includeClosed = url.searchParams.get('include_closed') === 'true';
  const [workorders, properties, units, tenants, keys, vendors] = await Promise.all([fetchTab(env,'Work_Orders'), fetchTab(env,'Properties'), fetchTab(env,'Units'), fetchTab(env,'Tenants'), fetchTab(env,'Keys'), fetchTab(env,'Vendors')]);
  const ownerPropIds = new Set(properties.filter(p => p.Owner_ID === ownerId).map(p => p.ID));
  const wos = workorders.filter(w => ownerPropIds.has(w.Property_ID) && (includeClosed || OPEN_WO_STATUSES.includes(w.Status)));
  const enriched = wos.map(wo => enrichWO(wo, properties, units, tenants, keys, { omitLockbox: true, omitTenantPhone: true, ownerView: true, vendors }));
  enriched.sort((a, b) => new Date(b.Created_Date) - new Date(a.Created_Date));
  return json(enriched);
}

// ── B-104 v2.0 VISIBILITY MATRIX ─────────────────────────────────────────────
// THE single source of truth for which note fields each role receives. enrichWO
// builds on {...wo}, so every Work_Orders column is exposed by default — this is
// an ALLOWLIST: any note field not named here is deleted before the payload
// leaves the Worker. A new note column is therefore private until it is listed,
// which is the safe direction to fail.
// `Notes` is the LEGACY column: admin-only archive, read-only, never written to
// again. It used to render verbatim on the owner AND tenant portals.
const WO_NOTE_FIELDS = ['Entry_Notes', 'Owner_Notes', 'Vendor_Admin_Notes', 'Admin_Notes', 'Hold_Reason', 'Notes'];
const WO_NOTE_VISIBILITY = {
  admin:  ['Entry_Notes', 'Owner_Notes', 'Vendor_Admin_Notes', 'Admin_Notes', 'Hold_Reason', 'Notes'],
  vendor: ['Entry_Notes', 'Owner_Notes', 'Vendor_Admin_Notes', 'Hold_Reason'],
  owner:  ['Owner_Notes', 'Hold_Reason'],
  tenant: ['Hold_Reason'],
};

function applyNoteVisibility(obj, role) {
  const allowed = WO_NOTE_VISIBILITY[role] || WO_NOTE_VISIBILITY.tenant;
  for (const f of WO_NOTE_FIELDS) if (!allowed.includes(f)) delete obj[f];
  return obj;
}

// The exact payload an owner may receive. A WO PDF or any other owner-facing
// export MUST be built from this and nothing else — building from the raw row is
// how a private note ends up in a document sent to a customer.
function ownerExportWO(enriched) {
  return {
    ID: enriched.ID,
    property_address: enriched.property_address || '',
    unit_label: enriched.unit_label || '',
    Trade: enriched.Trade || '',
    Description: enriched.Description || '',
    Status: enriched.Display_Status || enriched.Status || '',
    Priority: enriched.Priority || '',
    Scheduled_Date: enriched.Scheduled_Date || '',
    Completed_Date: enriched.Completed_Date || '',
    Created_Date: enriched.Created_Date || '',
    Hold_Reason: enriched.Hold_Reason || '',
    Owner_Notes: enriched.Owner_Notes || '',
    vendor_name: enriched.vendor_name || '',
    Owner_WO_Ref: enriched.Owner_WO_Ref || '',
  };
}

function enrichWO(wo, properties, units, tenants, keys, opts={}, masterKeys=[]) {
  const property = properties.find(p => p.ID === wo.Property_ID) || {};
  const unit     = units.find(u => u.ID === wo.Unit_ID) || {};
  let tenant = {};
  const tenantId = wo.Tenant_ID || unit.Tenant_ID;
  if (tenantId) tenant = tenants.find(t => t.ID === tenantId) || {};
  if (!tenant.ID && wo.Unit_ID)       tenant = tenants.find(t => t.Unit_ID === wo.Unit_ID && t.Active !== 'FALSE') || {};
  if (!tenant.ID && wo.Property_ID && !wo.Unit_ID) tenant = tenants.find(t => t.Property_ID === wo.Property_ID && !t.Unit_ID && t.Active !== 'FALSE') || {};
  const tradeDefaults = opts.tradeAccessDefaults || {};
  const woAccess = (wo.Vendor_Needs_Access || 'auto').trim();
  let vendorHasAccess;
  if (woAccess === 'TRUE')  vendorHasAccess = true;
  else if (woAccess === 'FALSE') vendorHasAccess = false;
  else {
    const trade = (wo.Trade || '').trim();
    const tradeDefault = tradeDefaults[trade];
    vendorHasAccess = tradeDefault !== 'FALSE';
  }
  const rawLockboxes = getWOLockboxes(keys, wo.Property_ID, wo.Unit_ID, unit.Unit_Label||'');
  const lockboxes = (opts.omitLockbox || !vendorHasAccess) ? [] : rawLockboxes;
  // BOTH, never one-or-the-other. The property default ("side gate is unlocked")
  // and the per-WO note ("call owner 24h ahead") are different facts — letting a
  // WO note hide the standing default is how a vendor ends up at a door they
  // can't open. Still fully gated by Vendor_Needs_Access.
  // Entry_Notes is append-only and therefore multi-line; flatten it, because this
  // same string is injected into the single-line vendor assignment SMS.
  const accessNotes = (!vendorHasAccess) ? ''
    : [property.Access_Notes, (wo.Entry_Notes || '').replace(/\n+/g, ' | ')].filter(Boolean).join(' | ');
  const legacyLockbox = (!lockboxes.length && vendorHasAccess && property.Lockbox_Code) ? property.Lockbox_Code : '';
  const base = {
    ...wo,
    property_address: property.Address||'', property_city: property.City||'', unit_label: unit.Unit_Label||'',
    tenant_name:  wo.WO_Contact_Name || (tenant.First_Name ? `${tenant.First_Name} ${tenant.Last_Name||''}`.trim() : ''),
    tenant_phone: opts.omitTenantPhone ? '' : (wo.WO_Contact_Phone || tenant.Phone||''),
    tenant_record_name:  tenant.First_Name ? `${tenant.First_Name} ${tenant.Last_Name||''}`.trim() : '',
    tenant_record_phone: opts.omitTenantPhone ? '' : (tenant.Phone||''),
    lockboxes,
    legacy_lockbox: legacyLockbox,
    access_notes: accessNotes,
    vendor_has_access: vendorHasAccess,
  };
  // Vendor identity. enrichWO never resolved this before, so owner.html:647 and
  // tenant.html:379 have been rendering an always-empty wo.vendor_name.
  const vendor = (opts.vendors || []).find(v => v.ID === wo.Vendor_ID) || {};
  const vendorName = vendor.Name || `${vendor.First_Name||''} ${vendor.Last_Name||''}`.trim();

  const role = opts.tenantView ? 'tenant' : opts.ownerView ? 'owner' : opts.vendorView ? 'vendor' : 'admin';
  base.vendor_name = vendorName;
  // Every role sees the vendor's NAME. Only the owner is denied the PHONE —
  // that's what protects Brett's GC position (owner can't go around him to the
  // sub). The tenant DOES get it; they coordinate access. (Changed in v2.0: the
  // tenant view used to blank it.)
  base.vendor_phone = role === 'owner' ? '' : (vendor.Phone || '');

  if (opts.tenantView) { delete base.access_notes; delete base.legacy_lockbox; base.lockboxes = []; }
  if (opts.ownerView)  {
    delete base.Invoice_ID;
    // Owners must not see access info. access_notes carries Entry_Notes as well
    // as the property default, so leaving it on the owner payload hands over both.
    delete base.access_notes; delete base.legacy_lockbox; base.lockboxes = [];
    base.Display_Status = base.Status === 'Pending Invoice' ? 'Complete' : base.Status;
  }
  return applyNoteVisibility(base, role);
}

async function getPropertyFull(env, url) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);
  const [props, units, tenants, keys] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Units'), fetchTab(env,'Tenants'), fetchTab(env,'Keys')]);
  const property = props.find(p => p.ID === id);
  if (!property) return json({ error: 'Property not found' }, 404);
  const propUnits = units.filter(u => u.Property_ID === id).map(unit => ({ ...unit, tenant: tenants.find(t => t.ID === unit.Tenant_ID)||null, keys: keys.filter(k => k.Unit_ID === unit.ID && k.Active !== 'FALSE') }));
  return json({ ...property, units: propUnits, keys: keys.filter(k => k.Property_ID === id && !k.Unit_ID && k.Active !== 'FALSE') });
}

async function getBuildingInfo(env, url) {
  const propId = url.searchParams.get('property_id'), unitId = url.searchParams.get('unit_id') || '';
  if (!propId) return json({ error: 'Missing property_id' }, 400);
  const [properties, units] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Units')]);
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
  const [properties, units] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Units')]);
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
  const res = await addRow(env, 'Vendor_Bills', body);
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

async function approveInvoiceReview(env, body) {
  const {
    bill_id, wo_id, vendor_id, vendor_name,
    job_type, vendor_cost, brett_time, brett_hrs, travel,
    markup, processing_fee, customer_total, brett_net, approved_by,
  } = body;
  if (!bill_id || !customer_total) return json({ error: 'bill_id and customer_total required' }, 400);
  const today = new Date().toISOString().split('T')[0];
  // 1. Update Vendor_Bills row: mark reviewed, save markup fields
  await updateRow(env, 'Vendor_Bills', bill_id, {
    Status:         'reviewed',
    Job_Type:       job_type        || 'standard',
    Brett_Time:     brett_time      || '0',
    Brett_Hrs:      brett_hrs       || '0',
    Travel:         travel          || '0',
    Markup:         markup          || '0',
    Processing_Fee: processing_fee  || '0',
    Customer_Total: customer_total,
    Brett_Net:      brett_net       || '0',
    Approved_By:    approved_by     || 'Brett',
    Reviewed_Date:  today,
  });
  // 2. Append to Invoice_Review log (bridge to Session 2 QuickBooks integration)
  const reviewRow = {
    ID:                 'IR-' + Date.now(),
    Bill_ID:            bill_id,
    WO_ID:              wo_id,
    Vendor_ID:          vendor_id,
    Vendor_Name:        vendor_name,
    Job_Type:           job_type,
    Vendor_Cost:        vendor_cost,
    Brett_Time:         brett_time,
    Travel:             travel,
    Markup:             markup,
    Processing_Fee:     processing_fee,
    Customer_Total:     customer_total,
    Brett_Net:          brett_net,
    QB_Invoice_Status:  'pending',
    QB_Invoice_ID:      '',
    QB_Bill_ID:         '',
    Approved_By:        approved_by,
    Approved_Date:      today,
    Active:             'TRUE',
  };
  await addRow(env, 'Invoice_Review', reviewRow);
  return json({ success: true, id: reviewRow.ID });
}

// ── ESTIMATES ────────────────────────────────────────────────

async function listEstimates(env, url) {
  const woId = url.searchParams.get('wo_id') || '';
  if (!woId) return json({ error: 'wo_id required' }, 400);
  const all = await fetchTab(env, 'Estimates');
  const results = all.filter(e => e.WO_ID === woId && e.Active !== 'FALSE').sort((a, b) => parseInt(a.Version||'1') - parseInt(b.Version||'1')).map(e => { try { e.Line_Items = JSON.parse(e.Line_Items||'[]'); } catch { e.Line_Items = []; } return e; });
  return json(results);
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
  await addRow(env, 'Estimates', { WO_ID: woId, Vendor_ID: body.vendor_id||'', Version: String(nextVersion), Line_Items: JSON.stringify(body.line_items), Subtotal: subtotal.toFixed(2), Change_Reason: nextVersion === 1 ? 'Initial estimate' : (body.change_reason||'Revised'), Created_By: body.created_by||'vendor', Created_Date: new Date().toISOString(), Status: body.status||'Pending' });
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
  const [wos, props, tenants] = await Promise.all([fetchTab(env,'Work_Orders'), fetchTab(env,'Properties'), fetchTab(env,'Tenants')]);
  const wo = wos.find(w => w.ID === woId); if (!wo) return json({ error: 'WO not found' }, 404);
  const prop = props.find(p => String(p.ID) === String(wo.Property_ID)); if (!prop) return json({ nearby: [], message: 'Property not found' });
  const primary = (prop.Location_Cluster||'').trim(), overlap = (prop.Location_Overlap||'').split(',').map(s=>s.trim()).filter(Boolean), allTags = [primary, ...overlap].filter(Boolean);
  if (!allTags.length) return json({ nearby: [], message: 'no_tags', primary_cluster: null });
  const nearbyPropIds = new Set();
  props.forEach(p => { if (String(p.ID) === String(wo.Property_ID)) return; const pTags = [(p.Location_Cluster||'').trim(), ...(p.Location_Overlap||'').split(',').map(s=>s.trim())].filter(Boolean); if (pTags.some(t => allTags.includes(t))) nearbyPropIds.add(String(p.ID)); });
  if (!nearbyPropIds.size) return json({ nearby: [], message: 'no_nearby', primary_cluster: primary });
  const OPEN = new Set(['New','Assigned','Accepted','In Progress','On Hold']);
  const nearby = wos.filter(w => w.ID !== woId && nearbyPropIds.has(String(w.Property_ID)) && OPEN.has(w.Status) && (!vendorId || w.Vendor_ID === vendorId)).map(w => { const wProp = props.find(p => String(p.ID) === String(w.Property_ID)), t = tenants.find(t => String(t.ID) === String(w.Tenant_ID)); return { id: w.ID, property_id: w.Property_ID, address: (wProp&&wProp.Address)||'', city: (wProp&&wProp.City)||'', description: w.Description, trade: w.Trade, priority: w.Priority, status: w.Status, vendor_id: w.Vendor_ID, tenant_name: t ? `${t.First_Name||''} ${t.Last_Name||''}`.trim() : '', tenant_phone: t ? (t.Phone||'') : '' }; });
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
  // B-104 v2.0: route by the AUTHOR'S ROLE instead of dumping everything into the
  // single `Notes` column, which rendered verbatim on the owner AND tenant
  // portals. Admin may target a specific field explicitly.
  const ADMIN_TARGETS = ['Vendor_Admin_Notes', 'Admin_Notes', 'Entry_Notes'];
  let field;
  if (body.author_role === 'owner')       field = 'Owner_Notes';
  else if (body.author_role === 'vendor') field = 'Vendor_Admin_Notes';
  else field = ADMIN_TARGETS.includes(body.field) ? body.field : 'Vendor_Admin_Notes';

  const author = `${body.author||'Unknown'} (${body.author_role||'unknown'})`;
  await appendWOField(env, body.wo_id, field, noteText, author, wo);
  await logWOAudit(env, body.wo_id, body.author, body.author_role, field, '', noteText.substring(0,100), 'Note appended');

  if (body.notify_owner_status_note === true) {
    // This text is about to be SMS'd to the owner, so it is customer-facing by
    // definition — it belongs in Hold_Reason, the one field the matrix exposes
    // to owner and tenant. Without this it would sit only in the admin↔vendor
    // thread while the owner had already received it.
    try { await updateWOFields(env, body.wo_id, { Hold_Reason: noteText }); } catch(e) {}
  }
  if (body.notify_owner_status_note === true) {
    try {
      const [properties, owners] = await Promise.all([fetchTab(env,'Properties'), fetchTab(env,'Owners')]);
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
  const [workorders, properties] = await Promise.all([fetchTab(env,'Work_Orders'), fetchTab(env,'Properties')]);
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
  const [workorders, properties] = await Promise.all([fetchTab(env,'Work_Orders'), fetchTab(env,'Properties')]);
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

// Resolves (creating as needed) the Drive folder a WO's files belong in:
//   <properties root>/<property address>/<WO id>                  ← customer-facing
//   <properties root>/<property address>/_Internal — Vendor Bills/<WO id>  ← isInternal
// Extracted from handlePhotoUploadClean (July 21, 2026) so the vendor-upload path and
// the email-intake ingest path can never drift apart on folder layout or on the
// receipt-privacy rule (FEATURE_LOG rule 13). Returns null if a folder can't be made.
async function getWOFolder(token, propsRoot, propAddr, woLabel, isInternal) {
  const propFolder = await findOrCreateFolder(token, propAddr, propsRoot, propsRoot);
  if (!propFolder || !propFolder.id) return null;
  if (!isInternal) return await findOrCreateFolder(token, woLabel, propFolder.id);
  const internalRoot = await findOrCreateFolder(token, '_Internal — Vendor Bills', propFolder.id);
  if (!internalRoot || !internalRoot.id) return null;
  return await findOrCreateFolder(token, woLabel, internalRoot.id);
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

async function logAttachment(env, body) {
  try {
    await addRow(env,'Attachments',{WO_ID:body.wo_id||'',File_Name:body.file_name||'',File_Type:body.file_type||'photo',Drive_File_ID:body.file_id||'',Drive_URL:body.file_url||'',Mime_Type:body.mime_type||'',Created_Date:new Date().toISOString().split('T')[0],Active:'TRUE'});
    if(body.wo_folder_url){await updateWOField(env,body.wo_id,'Drive_Folder_URL',body.wo_folder_url);await updateWOField(env,body.wo_id,'Drive_Folder_ID',body.wo_folder_id||'');}
    return json({success:true});
  } catch(e){return json({error:e.message},500);}
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
    const [units,tenants,properties]=await Promise.all([fetchTab(env,'Units'),fetchTab(env,'Tenants'),fetchTab(env,'Properties')]);
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
  const [properties,owners]=await Promise.all([fetchTab(env,'Properties'),fetchTab(env,'Owners')]);
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
  // Staging sandbox (B-103): never place a real Twilio call from a preview deploy.
  // This is the single SMS chokepoint, so gating here covers every caller.
  if (env.STAGING === '1') {
    console.log(`[STAGING] SMS suppressed → ${to}: ${message}`);
    return { staging: true, suppressed: true, to, body: message };
  }
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

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL → WORK ORDER INTAKE (B-103, Phase A)
// ══════════════════════════════════════════════════════════════════════════════
// An Apps Script poller reads Gmail and POSTs the raw message to /intake. ALL
// parsing and business logic lives here so it is git-versioned and curl-testable
// (PAT-001). Adding a new source later = one parser + one line in detectSource;
// nothing else in the pipeline changes.
//
//   detect → parse → dedupe → resolve → create WO → ingest files → notify
//
// SAFETY POSTURE: this path creates records from untrusted email, so it is
// deliberately conservative. A confident match is reused; a genuine no-match may
// create a Unit/Tenant (cheap to fix); an AMBIGUOUS or partial property match
// NEVER auto-creates — it returns needs_review so a human decides. Phase B turns
// those into Intake_Queue rows + a Hub review screen.

const INTAKE_SOURCES = {
  'managebuilding.com':               'buildium',
  'phoenixestatesmaryland@gmail.com': 'manual',
  'appfolio.com':                     'appfolio',
};

function detectSource(sender, subject) {
  const s = String(sender || '').toLowerCase();
  // Senders arrive as either "Name <a@b.com>" or a bare address.
  const addr = (s.match(/<([^>]+)>/) || [null, s])[1].trim();
  for (const [needle, source] of Object.entries(INTAKE_SOURCES)) {
    if (addr.includes(needle)) return source;
  }
  return 'unknown';
}

// ── TEXT EXTRACTION ──────────────────────────────────────────────────────────
const HTML_ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', '#39':"'", '#x27':"'", '#160':' ' };

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g,         (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi,      (m, e) => HTML_ENTITIES[e.toLowerCase()] ?? m);
}

// Buildium's mail is table-based HTML. Block-level tags become newlines so that
// "label / value" pairs stay on separate lines for the section parser below.
function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (arr[i - 1] || '') !== '')
    .join('\n')
    .trim();
}

// Labels that end a section. Kept broad so an unexpected block doesn't get
// swallowed into the previous field's value.
// Every one of these ENDS the preceding section. A header missing from this list
// doesn't just fail to parse — sectionAfter() runs straight through it and the
// literal header text lands in Description/Notes. That's how "Contact and
// scheduling information" leaked twice onto WO-1068 (real email, July 21).
const BUILDIUM_LABELS = [
  'work order','location','entry contacts','entry contact','entry details','entry notes',
  'job description','tenant notes','description','files','attachments','photos','priority',
  'category','requested by','status','assigned to','due date','notes','pets','property',
  'unit','tenant','vendor','created','scheduled',
  // Added July 21 from the WO-1068 real-email test.
  'contact and scheduling information','parts and labor details','vendor information',
  'vendor name','vendor contact info','vendor notes','invoice no','charge work to',
];

function isLabelLine(line) {
  // Trailing period matters: the real header is "Invoice no." — stripping only
  // colons/space left it unmatched.
  const l = line.toLowerCase().replace(/[.:\s]+$/, '').trim();
  return BUILDIUM_LABELS.includes(l);
}

// Buildium can add a section header at any time, and the failure mode is silent
// corruption of the WO. Rather than only ever finding out from a bad work order,
// flag anything INSIDE a captured section that looks like a header we don't know:
// a short, title-ish line with no sentence punctuation. This only ever adds a
// warning — it never changes what gets parsed.
function suspectHeaderLines(lines) {
  return lines.filter(l => {
    const t = l.trim();
    if (t.length < 8 || t.length > 60) return false;
    if (/[.!?,;:]/.test(t)) return false;
    const words = t.split(/\s+/);
    if (words.length < 2 || words.length > 6) return false;
    if (!/^[A-Z]/.test(t) || /\d/.test(t)) return false;
    // Must read as Title Case. Without this, ordinary entry content like
    // "Lockbox on the side door" trips the heuristic and every WO carries a
    // bogus warning — which trains you to ignore warnings entirely.
    const capitalized = words.filter(w => /^[A-Z]/.test(w)).length;
    return capitalized / words.length >= 0.6;
  });
}

// Returns the lines that follow `label` up to the next label line.
// Handles both "Label:" on its own line and "Label: value" inline.
function sectionAfter(lines, label) {
  const want = label.toLowerCase();
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i].toLowerCase().replace(/[:\s]+$/, '').trim();
    // Three shapes seen in the wild: "Label" alone, "Label: value", and — when a
    // mail client flattens the HTML table into a plain body — "Label value".
    const inline = lines[i].match(new RegExp(`^${want}\\s*(?::\\s*|\\s+)(.+)$`, 'i'));
    if (bare !== want && !inline) continue;
    if (inline && inline[1].trim()) out.push(inline[1].trim());
    for (let j = i + 1; j < lines.length; j++) {
      if (isLabelLine(lines[j])) break;
      if (lines[j].trim()) out.push(lines[j].trim());
    }
    break;
  }
  return out;
}

// ── ADDRESS NORMALIZATION ────────────────────────────────────────────────────
// Collapses the many spellings of one address to a single comparable key so
// "1110 North Dukeland Street - 1" and "1110 N Dukeland St" match. Normalizes to
// the SHORT form (n / st / ave) so both directions converge on the same key.
const ADDR_WORDS = {
  north:'n', south:'s', east:'e', west:'w',
  northeast:'ne', northwest:'nw', southeast:'se', southwest:'sw',
  street:'st', avenue:'ave', av:'ave', road:'rd', drive:'dr', lane:'ln',
  boulevard:'blvd', court:'ct', place:'pl', terrace:'ter', parkway:'pkwy',
  circle:'cir', highway:'hwy', square:'sq', trail:'trl', way:'way',
  apartment:'apt', suite:'ste',
};

// Matches a TRAILING unit designator only: " - 1", "#1", " Unit 1", " Apt 2B".
// The separators are anchored deliberately. An unanchored alternation like
// (?:-|#|unit|apt|ste) matches mid-word, which silently ate real street names:
// "1200 Winchester" → "1200 winche" + a phantom Unit "r", and "8 Cross-Keys" →
// "8 cross". Worse, it truncated asymmetrically, so a property matched itself as
// "ambiguous" and stuck every WO at that address in review.
const UNIT_SUFFIX = /(?:\s+-\s*|\s*#\s*|\s+(?:unit|apt|apartment|ste|suite)\.?\s*)([\w-]+)\s*$/i;

function normalizeAddr(s) {
  if (!s) return '';
  let out = String(s).toLowerCase();
  out = out.replace(/,\s*$/, '').replace(UNIT_SUFFIX, '');
  out = out.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return out.split(' ').map(w => ADDR_WORDS[w] || w).filter(Boolean).join(' ');
}

function unitKey(s) {
  return String(s || '').toLowerCase().replace(/^(?:#|(?:unit|apt|apartment|ste|suite)\b\.?)\s*/i, '').replace(/\s+/g, '').trim();
}

// Last 10 digits — the only phone comparison that survives +1 / (410) / dashes.
function phoneKey(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// ── TRADE GUESS ──────────────────────────────────────────────────────────────
// A GUESS ONLY — always overridable in the Hub. Keys must stay in QB_TRADE_MAP
// or /qb/send-invoice silently falls back to "General".
const TRADE_KEYWORDS = [
  ['Plumbing',    /\b(toilet|leak|leaking|drain|clog|clogged|faucet|sink|pipe|water heater|sewer|shower|tub|sump|garbage disposal|no hot water|running water)\b/i],
  ['Electrical',  /\b(outlet|breaker|electric|electrical|wiring|light switch|no power|short circuit|gfci|fuse|sparking)\b/i],
  // Appliance is tested BEFORE HVAC on purpose: "refrigerator is not cooling"
  // matches HVAC's "not cooling" too, and the appliance noun is the stronger signal.
  ['Appliance',   /\b(refrigerator|fridge|stove|oven|range|dishwasher|washer|dryer|microwave|appliance)\b/i],
  ['HVAC',        /\b(hvac|furnace|boiler|no heat|air condition|a\/c|ac unit|thermostat|radiator|not cooling|not heating)\b/i],
  ['Roofing',     /\b(roof|shingle|gutter|downspout|soffit|ceiling leak)\b/i],
  ['Windows',     /\b(window|screen|glass|pane|storm door)\b/i],
  ['Flooring',    /\b(floor|flooring|carpet|tile|hardwood|subfloor|laminate)\b/i],
  ['Painting',    /\b(paint|painting|drywall|plaster|patch)\b/i],
  ['Carpentry',   /\b(door|cabinet|trim|stair|railing|deck|fence|framing|lock|deadbolt)\b/i],
  ['Landscaping', /\b(lawn|grass|yard|tree|shrub|landscap|snow removal|leaves)\b/i],
  ['Cleaning',    /\b(clean|cleaning|trash|debris|junk removal|pest|rodent|roach|mice)\b/i],
];

function keywordTrade(text) {
  const t = String(text || '');
  for (const [trade, re] of TRADE_KEYWORDS) if (re.test(t)) return trade;
  return '';
}

// ── BUILDIUM PARSER ──────────────────────────────────────────────────────────
// One Buildium email == exactly one work order (confirmed: three issues at one
// address arrive as three separate emails). Returns a normalized item plus the
// warnings that downstream code uses to decide create-vs-review.
function parseBuildium(html, subject, plaintext) {
  // HTML FIRST — this is deliberate and load-bearing. Buildium sends table-based
  // HTML, and the Apps Script poller sends BOTH bodies on every message. Preferring
  // plaintext meant the tested HTML path would never execute in production, and
  // Gmail's flattened plain body renders the table as "Location 1110 N Dukeland St"
  // on ONE line, which the section parser can't split → every email would have
  // returned needs_review forever. Plaintext is the fallback for a text-only sender.
  const text = htmlToText(html) || String(plaintext || '').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const warnings = [];

  // Ref: body "Work order #838106-1: Leaking toilet" wins (it carries the -1
  // suffix); the subject "Work order 838106" is the fallback.
  const bodyRef = text.match(/work order\s*#\s*([\w-]+)\s*:?\s*(.*)/i);
  const subjRef = String(subject || '').match(/work order\s*#?\s*([\w-]+)/i);
  const ownerRef = (bodyRef && bodyRef[1]) || (subjRef && subjRef[1]) || '';
  if (!ownerRef) warnings.push('No Buildium work order number found');

  // Title = the text after the ref on the same line.
  let title = (bodyRef && bodyRef[2] || '').trim();
  const jobDesc    = sectionAfter(lines, 'job description').join('\n');
  const tenantNote = sectionAfter(lines, 'tenant notes').join('\n');
  const descBlock  = sectionAfter(lines, 'description').join('\n');
  if (!title) title = (jobDesc || descBlock || '').split('\n')[0] || '';
  const description = [title, jobDesc || descBlock, tenantNote].filter(Boolean).join(' — ').trim();
  if (!description) warnings.push('No description found');

  // Location block: street line, then "City, ST 12345".
  const loc = sectionAfter(lines, 'location');
  let street = '', unitLabel = '', city = '', state = '', zip = '';
  for (const line of loc) {
    const csz = line.match(/^(.+?),\s*([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?$/);
    if (csz && !city) { city = csz[1].trim(); state = csz[2].toUpperCase(); zip = csz[3]; continue; }
    if (!street) {
      const m = line.match(UNIT_SUFFIX);
      if (m) { street = line.slice(0, m.index).trim(); unitLabel = m[1].trim(); }
      else street = line.trim();
    }
  }
  if (!street) warnings.push('No property address found in the Location block');

  // Entry contacts → tenant.
  // The real WO-1068 mail puts the tenant under "Contact and scheduling
  // information", not "Entry contacts" — reading only the latter meant no tenant
  // name/phone/email was parsed at all, so no tenant got linked to the WO.
  const contact = [...new Set([
    ...sectionAfter(lines, 'entry contacts'),
    ...sectionAfter(lines, 'entry contact'),
    ...sectionAfter(lines, 'contact and scheduling information'),
  ])];
  const contactText = contact.join('\n');
  const email = (contactText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0];
  const phone = (contactText.match(/(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [''])[0];
  // A person's name, not just "a short line". The loose version accepted prose
  // like "Tenant will be home" or "No pets" — and resolveTenant CREATES a tenant
  // row (with an auto PIN) from whatever lands here. Require 2-4 tokens that all
  // start with a capital, which prose fails on its lowercase words.
  const NAME_STOPWORDS = new Set(['pets','pet','entry','notes','note','none','tenant','owner','contact','contacts','yes','no','na','unknown','vacant','key','lockbox']);
  let contactName = '';
  for (const line of contact) {
    if (line.includes('@') || phoneKey(line)) continue;
    const toks = line.trim().split(/\s+/);
    if (toks.length < 2 || toks.length > 4) continue;
    if (!toks.every(t => /^[A-Z][A-Za-z'.-]*$/.test(t))) continue;
    if (toks.some(t => NAME_STOPWORDS.has(t.toLowerCase().replace(/[^a-z]/g, '')))) continue;
    contactName = line.trim();
    break;
  }

  // Entry/pet details are ACCESS information, not a general note — they belong on
  // the WO's entry field where the vendor actually looks (and where the assign SMS
  // reads from), not appended to the free-text Notes log.
  // "Pets: Yes - Cat" sits INSIDE the entry-details block but also matches the
  // standalone "pets" label, so the naive concat captured it twice — once whole,
  // once as the bare value. Drop any line already contained in a longer one.
  const rawEntry = [...new Set(
    [...sectionAfter(lines, 'entry details'), ...sectionAfter(lines, 'entry notes'), ...sectionAfter(lines, 'pets')].filter(Boolean)
  )];
  const entryLines = rawEntry.filter(l => !rawEntry.some(o => o !== l && o.length > l.length && o.includes(l)));
  const entryNotes = entryLines.join(' | ');

  // Owner: Buildium puts the management company in the subject prefix and footer.
  const ownerName = (String(subject || '').match(/^(.*?):\s*work order/i) || [null, ''])[1].trim();

  // Files: S3 links in the body (images AND video). Scan the RAW html as well as
  // the flattened text — the links live in href/src attributes, which htmlToText
  // strips, leaving only the visible link label behind. Dedupe: the same asset is
  // routinely linked twice (thumbnail + full size).
  const urlSource = `${decodeEntities(String(html || ''))}\n${text}`;
  const candidates = (urlSource.match(/https?:\/\/[^\s"'<>)\]]+/gi) || [])
    .map(u => u.replace(/[.,;]+$/, ''))
    .filter(u => /amazonaws\.com|s3[.-]|managebuilding\.com/i.test(u))
    // Accept a known media extension OR a download-style link. Requiring an
    // extension alone silently dropped Buildium's extension-less
    // ".../api/file/download?id=99" links — i.e. lost photos, with no warning.
    // No PDFs: intake files are tenant job photos, and a PDF here would be logged
    // as a photo in the customer-facing folder (see FEATURE_LOG rule 13).
    .filter(u => /\.(jpe?g|png|gif|heic|webp|bmp|mov|mp4|m4v|avi)(\?|$)/i.test(u) || /\/(file|files|download|attachment)s?[\/?]/i.test(u));
  // Dedupe ignoring the query string: the same asset is routinely linked twice as
  // "photo.jpg?w=100" (thumbnail) and "photo.jpg" (full size). Keep the longest
  // variant of each path — the full-size link is the one without a size param.
  const byPath = new Map();
  for (const u of candidates) {
    const key  = u.split('?')[0];
    const prev = byPath.get(key);
    // Prefer the variant with no query string (the full-size original); the
    // thumbnail is the one carrying ?w=/?size= params.
    if (!prev || (prev.includes('?') && !u.includes('?'))) byPath.set(key, u);
  }
  const urls = [...byPath.values()];

  const priority = /\b(emergency|urgent|asap|no heat|no hot water|flood|gas leak)\b/i.test(text) ? 'urgent' : 'normal';

  // Surface unknown section headers that landed inside parsed content.
  const suspects = [...new Set([
    ...suspectHeaderLines((jobDesc || descBlock || '').split('\n')),
    ...suspectHeaderLines(tenantNote.split('\n')),
    ...suspectHeaderLines(entryLines),
  ])].filter(s => s.toLowerCase() !== title.toLowerCase());
  if (suspects.length)
    warnings.push(`Possible unrecognized section header(s) in parsed content — add to BUILDIUM_LABELS if so: ${suspects.join(' / ')}`);

  return {
    source: 'buildium',
    owner_wo_ref: ownerRef,
    owner_name: ownerName,
    description,
    priority,
    trade: keywordTrade(`${title} ${jobDesc} ${tenantNote}`),
    property: { address: street, city, state, zip },
    unit_label: unitLabel,
    tenant: { name: contactName, phone, email },
    entry_notes: entryNotes,
    notes: '',
    files: urls,
    warnings,
  };
}

// ── RESOLVERS ────────────────────────────────────────────────────────────────
// addRow returns a Response; these helpers unwrap it to the new row's id.
async function addRowId(env, tab, body) {
  const res  = await addRow(env, tab, body);
  const data = await res.json();
  if (!data.success || !data.id) throw new Error(`Could not add ${tab} row: ${data.error || 'unknown error'}`);
  return String(data.id);
}

// Owners are billing entities — a wrong or duplicated one corrupts invoicing, so
// this NEVER creates. No confident match ⇒ the item goes to review.
function resolveOwner(owners, name) {
  const want = String(name || '').toLowerCase().replace(/[.,]/g, '').replace(/\b(llc|inc|corp|co|ltd)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!want) return { status: 'no_match' };
  const active = owners.filter(o => o.Active !== 'FALSE');
  const norm = o => String(o.Company || `${o.First_Name || ''} ${o.Last_Name || ''}`)
    .toLowerCase().replace(/[.,]/g, '').replace(/\b(llc|inc|corp|co|ltd)\b/g, '').replace(/\s+/g, ' ').trim();
  const hits = active.filter(o => norm(o) === want);
  if (hits.length === 1) return { status: 'matched', row: hits[0] };
  if (hits.length > 1)   return { status: 'ambiguous' };
  // A loose match must clear a real bar. A bare substring test bound the wrong
  // owner: "Ridge Co, LLC" normalizes to "ridge", which is a substring of
  // "Ridge Estates of Maryland" — one hit, silently "matched", and the new
  // property lands under the wrong Owner_ID and invoices the wrong customer.
  // Require a substantial overlap: >=8 chars and >=2 shared significant words.
  const words = s => new Set(s.split(' ').filter(w => w.length > 2));
  const wantWords = words(want);
  const loose = active.filter(o => {
    const n = norm(o);
    if (!n || n.length < 8 || want.length < 8) return false;
    if (!n.includes(want) && !want.includes(n)) return false;
    let shared = 0;
    for (const w of words(n)) if (wantWords.has(w)) shared++;
    return shared >= 2;
  });
  if (loose.length === 1) return { status: 'matched', row: loose[0] };
  return { status: loose.length > 1 ? 'ambiguous' : 'no_match' };
}

// Properties are the join point for every WO — a duplicate property silently
// splits a building's history in two. Exact normalized match reuses; a PARTIAL
// match (same house number + street, different spelling) is treated as ambiguous
// and sent to review rather than risking either a dupe or the wrong building.
function resolveProperty(properties, parsed) {
  const want = normalizeAddr(parsed.property.address);
  if (!want) return { status: 'no_address' };
  const active = properties.filter(p => p.Active !== 'FALSE');
  const exact = active.filter(p => normalizeAddr(p.Address) === want);
  if (exact.length === 1) return { status: 'matched', row: exact[0] };
  if (exact.length > 1)   return { status: 'ambiguous', candidates: exact.map(p => p.ID) };

  const houseNum = (want.match(/^(\d+)/) || [])[1];
  if (houseNum) {
    const partial = active.filter(p => {
      const n = normalizeAddr(p.Address);
      if (!n.startsWith(houseNum + ' ')) return false;
      const a = want.split(' ').filter(w => w.length > 2);
      const b = n.split(' ').filter(w => w.length > 2);
      return a.some(w => b.includes(w));
    });
    if (partial.length) return { status: 'ambiguous', candidates: partial.map(p => p.ID) };
  }
  return { status: 'no_match' };
}

async function resolveUnit(env, units, propertyId, unitLabel) {
  if (!unitLabel) return '';
  const key = unitKey(unitLabel);
  const hit = units.find(u => String(u.Property_ID) === String(propertyId) && u.Active !== 'FALSE' && unitKey(u.Unit_Label) === key);
  if (hit) return hit.ID;
  return await addRowId(env, 'Units', { Property_ID: String(propertyId), Unit_Label: unitLabel, Active: 'TRUE' });
}

// Tenants match on phone first (the only reliable key), then on name within the
// same unit/property. A genuine no-match creates one — addRow auto-generates the
// phone-based PIN, so the new tenant can use the portal immediately.
async function resolveTenant(env, tenants, propertyId, unitId, tenant) {
  const pk = phoneKey(tenant.phone);
  const scoped = tenants.filter(t => t.Active !== 'FALSE' && (
    (unitId && String(t.Unit_ID) === String(unitId)) || String(t.Property_ID) === String(propertyId)
  ));
  if (pk) {
    const byPhone = tenants.find(t => t.Active !== 'FALSE' && phoneKey(t.Phone) === pk);
    if (byPhone) return byPhone.ID;
  }
  const name = String(tenant.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (name) {
    const byName = scoped.find(t => `${t.First_Name || ''} ${t.Last_Name || ''}`.toLowerCase().replace(/\s+/g, ' ').trim() === name);
    if (byName) return byName.ID;
  }
  if (!name && !pk) return '';
  const parts = name ? tenant.name.trim().split(/\s+/) : [];
  return await addRowId(env, 'Tenants', {
    Property_ID: String(propertyId),
    Unit_ID: unitId ? String(unitId) : '',
    First_Name: parts[0] || '',
    Last_Name: parts.slice(1).join(' '),
    Phone: tenant.phone || '',
    Email: tenant.email || '',
    Active: 'TRUE',
  });
}

// ── FILE INGEST ──────────────────────────────────────────────────────────────
const INTAKE_MAX_FILE_BYTES = 45 * 1024 * 1024; // Worker memory guard (videos!)

// Best-effort per file, exactly like the QB attachment path: one bad URL warns,
// it never fails the work order that was already created.
async function ingestFiles(env, woId, propAddr, urls) {
  const result = { uploaded: 0, warnings: [], folder_url: '' };
  if (!urls || !urls.length) return result;
  const propsRoot = env.DRIVE_PROPERTIES_ROOT;
  if (!propsRoot) { result.warnings.push('DRIVE_PROPERTIES_ROOT not set — files skipped'); return result; }

  let token, folder;
  try {
    token = await getAccessToken(env);
    // Drive has no staging root, and a staging sheet is a COPY of live, so its WO
    // ids collide with real folders. Prefix staging uploads so test files are
    // obvious and never mix into a customer-facing folder that gets shared.
    const label = env.STAGING === '1' ? `_STAGING ${woId}` : woId;
    folder = await getWOFolder(token, propsRoot, propAddr || 'Unknown Property', label, false);
  } catch (e) { result.warnings.push(`Drive setup failed: ${e.message}`); return result; }
  if (!folder || !folder.id) { result.warnings.push('Could not create the WO Drive folder — files skipped'); return result; }
  result.folder_url = folder.webViewLink || '';

  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) { result.warnings.push(`${url} → HTTP ${res.status}`); continue; }
      const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      // A login/interstitial page comes back as HTML with a 200. Uploading that
      // as a "photo" would be worse than skipping it — flag it loudly instead.
      if (/^text\/html/i.test(mime)) { result.warnings.push(`${url} → returned HTML (link is not publicly fetchable)`); continue; }
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      if (len > INTAKE_MAX_FILE_BYTES) { result.warnings.push(`${url} → ${Math.round(len / 1048576)}MB exceeds the ${INTAKE_MAX_FILE_BYTES / 1048576}MB limit`); continue; }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > INTAKE_MAX_FILE_BYTES) { result.warnings.push(`${url} → too large`); continue; }
      let filename = '';
      try { filename = decodeURIComponent((new URL(url).pathname.split('/').pop() || '').trim()); } catch (e) {}
      if (!filename) filename = `intake_${result.uploaded + 1}`;
      const up = await uploadFileToDrive(token, buf, filename, mime, folder.id, propsRoot);
      if (!up || !up.id) { result.warnings.push(`${filename} → Drive upload failed`); continue; }
      result.uploaded++;
      try {
        await addRow(env, 'Attachments', {
          WO_ID: woId, File_Name: filename, File_Type: 'photo',
          Drive_File_ID: up.id, Drive_URL: up.webViewLink || up.id, Mime_Type: mime,
          Created_Date: new Date().toISOString().split('T')[0], Active: 'TRUE',
        });
      } catch (e) { /* non-fatal — the file is already in Drive */ }
    } catch (e) { result.warnings.push(`${url} → ${e.message}`); }
  }

  if (result.uploaded > 0 && folder.webViewLink) {
    try {
      await updateWOFields(env, woId, { Drive_Folder_URL: folder.webViewLink, Drive_Folder_ID: folder.id });
    } catch (e) { /* non-fatal */ }
  }
  return result;
}

// ── POST-CREATE HOOK ─────────────────────────────────────────────────────────
// THE AUTO-ASSIGN SEAM (Phase D). v1 notifies the admin and nothing else. When
// auto-assign lands it calls pickVendor()/assignVendor() HERE — no other part of
// the intake pipeline changes.
async function onIntakeCreated(env, wo) {
  const config = await fetchConfig(env);
  const phone  = config.intake_admin_phone || config.admin_phone || '';
  if (!phone) return { notified: false, reason: 'no admin phone in Config' };
  const where = [wo.address, wo.unit_label ? `Unit ${wo.unit_label}` : ''].filter(Boolean).join(' ');
  const msg = `📥 New WO from email: ${wo.id}\n${where}\n${String(wo.description || '').slice(0, 120)}` +
              (wo.owner_wo_ref ? `\nRef ${wo.owner_wo_ref}` : '') +
              (wo.trade ? `\nTrade guess: ${wo.trade}` : '');
  await sendSMS(env, phone, msg);
  return { notified: true };
}

// ── ENDPOINT ─────────────────────────────────────────────────────────────────
// POST /intake  { sender, subject, date, message_id, html, plaintext }
//
// Always returns HTTP 200 with a `status` the poller branches on, so a parse
// problem never looks like a transport failure and never makes Apps Script retry
// forever:  created | duplicate | needs_review | skipped | unsupported
async function handleIntake(env, body) {
  const { sender = '', subject = '', message_id = '', html = '', plaintext = '' } = body || {};
  const config = await fetchConfig(env);
  // Tolerant of how the switch actually gets typed into the Config tab.
  if (/^(false|no|0|off)$/i.test(String(config.intake_enabled || '').trim()))
    return json({ status: 'skipped', reason: 'intake_enabled is off in Config' });

  const source = detectSource(sender, subject);
  if (source === 'unknown')  return json({ status: 'unsupported', reason: `Unrecognized sender: ${sender}`, source });
  if (source === 'appfolio') return json({ status: 'unsupported', reason: 'AppFolio parser not built yet (needs sample emails)', source });
  if (source === 'manual')   return json({ status: 'needs_review', reason: 'Manual free-text lists land in the review queue (Phase C)', source });

  const parsed = parseBuildium(html, subject, plaintext);
  const review = (reasons, extra = {}) =>
    json({ status: 'needs_review', source, reasons: [].concat(reasons), parsed, ...extra });

  // Dedupe BEFORE any write. Two layers: the customer's ref number (the real
  // business key) and the Gmail message id (guards a re-forwarded message).
  const workorders = await fetchTab(env, 'Work_Orders');
  if (parsed.owner_wo_ref) {
    const dupe = workorders.find(w => w.Owner_WO_Ref && w.Owner_WO_Ref === parsed.owner_wo_ref);
    if (dupe) return json({ status: 'duplicate', wo_id: dupe.ID, owner_wo_ref: parsed.owner_wo_ref, source });
  }
  if (message_id) {
    const dupe = workorders.find(w => w.Intake_Message_ID && w.Intake_Message_ID === message_id);
    if (dupe) return json({ status: 'duplicate', wo_id: dupe.ID, message_id, source });
  }
  if (!parsed.property.address) return review('No property address could be parsed from the email');
  if (!parsed.description)      return review('No description could be parsed from the email');
  // Owner_WO_Ref is the primary dedupe key. Auto-creating without one produces a
  // WO that nothing can match on a re-delivery — and Intake_Message_ID is the
  // only other layer, which no-ops until that column exists. Refuse rather than
  // risk a double-create; a human confirms it instead.
  if (!parsed.owner_wo_ref)
    return review('No Buildium work order number found — cannot dedupe this email, so it will not auto-create');

  const [properties, owners, units, tenants] = await Promise.all([
    fetchTab(env, 'Properties'), fetchTab(env, 'Owners'), fetchTab(env, 'Units'), fetchTab(env, 'Tenants'),
  ]);

  const prop = resolveProperty(properties, parsed);
  if (prop.status === 'ambiguous')
    return review(`Address "${parsed.property.address}" partially matches existing properties — confirm which one`, { candidates: prop.candidates });

  let propertyId, propAddress;
  if (prop.status === 'matched') {
    propertyId  = prop.row.ID;
    propAddress = prop.row.Address;
  } else {
    // Genuine no-match: safe to create, but only with a confident owner — an
    // ownerless property breaks invoicing downstream (/qb/send-invoice).
    const owner = resolveOwner(owners, parsed.owner_name);
    if (owner.status !== 'matched')
      return review(`New address "${parsed.property.address}", and its owner "${parsed.owner_name || 'unknown'}" could not be matched — confirm before creating the property`);
    propAddress = parsed.property.address;
    propertyId  = await addRowId(env, 'Properties', {
      Address: propAddress, City: parsed.property.city, State: parsed.property.state,
      Zip: parsed.property.zip, Owner_ID: String(owner.row.ID), Active: 'TRUE',
    });
  }

  const unitId   = await resolveUnit(env, units, propertyId, parsed.unit_label);
  const tenantId = await resolveTenant(env, tenants, propertyId, unitId, parsed.tenant);

  const createRes = await createWorkOrder(env, {
    property_id: String(propertyId),
    unit_id: unitId ? String(unitId) : '',
    tenant_id: tenantId ? String(tenantId) : '',
    description: parsed.description,
    priority: parsed.priority,
    trade: parsed.trade,
    owner_wo_ref: parsed.owner_wo_ref,
    wo_contact_name: parsed.tenant.name,
    wo_contact_phone: parsed.tenant.phone,
    // Entry info goes to Entry_Notes (admin+vendor only), never to Notes — the
    // owner and tenant portals both render Notes verbatim, so the old fallback
    // was publishing Buildium entry info to them.
    notes: '',
    type: 'email-intake',
    created_by: `intake:${source}`,
  });
  const created = await createRes.json();
  if (!created.success) return json({ status: 'error', error: created.error || 'createWorkOrder failed', parsed }, 500);
  const woId = created.id;

  // Traceability columns. updateWOFields skips headers that don't exist, so this
  // is a no-op (not an error) until the Source / Intake_Message_ID columns land.
  try {
    await updateWOFields(env, woId, { Source: `email-${source}`, Intake_Message_ID: message_id || '' });
    // Attributed append, per B-104. The WO was created microseconds ago so
    // Entry_Notes is empty, but this goes through the same append path as every
    // other writer — Brett's later "lockbox is red" must not overwrite this line
    // and this must not overwrite his. A blank is never written, so a WO with no
    // entry info keeps falling back to the property's Access_Notes default.
    if (parsed.entry_notes)
      await appendWOField(env, woId, 'Entry_Notes', parsed.entry_notes, 'Owner/Buildium', { Entry_Notes: '' });
  } catch (e) { /* non-fatal */ }

  const files = await ingestFiles(env, woId, propAddress, parsed.files);

  let notify = { notified: false };
  try {
    notify = await onIntakeCreated(env, {
      id: woId, description: parsed.description, address: propAddress,
      unit_label: parsed.unit_label, owner_wo_ref: parsed.owner_wo_ref, trade: parsed.trade,
    });
  } catch (e) { /* a notify failure must never undo a created WO */ }

  return json({
    status: 'created', source, wo_id: woId,
    owner_wo_ref: parsed.owner_wo_ref,
    property_id: String(propertyId), unit_id: unitId || '', tenant_id: tenantId || '',
    trade_guess: parsed.trade,
    files: { found: parsed.files.length, uploaded: files.uploaded, warnings: files.warnings },
    notified: notify.notified,
    warnings: parsed.warnings,
    staging: env.STAGING === '1',
  });
}

// Named exports for the offline parser tests (test/intake.test.mjs). Extra named
// exports alongside the default export are inert in the Workers runtime.
export { detectSource, htmlToText, normalizeAddr, unitKey, phoneKey, keywordTrade, parseBuildium, resolveOwner, resolveProperty, handleIntake, handlePhotoUploadClean, enrichWO, ownerExportWO };

// ── GOOGLE SHEETS / AUTH ─────────────────────────────────────

function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

// Google's tokens are valid for an hour, but this was re-minted on EVERY Sheets
// call — 2 subrequests apiece. One /intake with photos ran ~55-60 subrequests,
// over Cloudflare's 50-per-request cap. Cache per isolate, with a 5-minute safety
// margin. Keyed by SA email + sheet so a staging isolate can never reuse a token
// minted for different credentials.
let _tokenCache = null;

async function getAccessToken(env) {
  const now=Math.floor(Date.now()/1000);
  const cacheKey=`${env.GOOGLE_SA_EMAIL||''}|${env.SHEET_ID||''}`;
  if(_tokenCache&&_tokenCache.key===cacheKey&&_tokenCache.exp>now+300) return _tokenCache.token;
  const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=b64url(JSON.stringify({iss:env.GOOGLE_SA_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now}));
  const sigInput=`${header}.${claim}`, key=await importPrivateKey(env.GOOGLE_SA_KEY);
  const jwt=`${sigInput}.${await signRS256(sigInput,key)}`;
  const resp=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`});
  const data=await resp.json(); if(!data.access_token) throw new Error('Google auth failed: '+JSON.stringify(data));
  _tokenCache={key:cacheKey,token:data.access_token,exp:now+(data.expires_in||3600)};
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

async function sheetsRequest(env, method, path, body) {
  const token=await getAccessToken(env);
  const opts={method,headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}${path}`,opts);
  const data=await res.json();
  if(data.error) throw new Error(`Sheets API error on ${method} ${path}: ${data.error.message||JSON.stringify(data.error)}`);
  return data;
}

async function getSheet(env, tab) {
  const data=await sheetsRequest(env,'GET',`/values/${tab}`); if(!data.values||data.values.length<2) return json([]);
  const [headers,...rows]=data.values; return json(rows.map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]||'');return o;}));
}

async function fetchTab(env, tab) {
  const data=await sheetsRequest(env,'GET',`/values/${tab}`); if(!data.values||data.values.length<2) return [];
  const [headers,...rows]=data.values; return rows.map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]||'');return o;});
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

async function addRow(env, tab, body) {
  let data;
  try { data = await sheetsRequest(env,'GET',`/values/${tab}`); }
  catch(e) { if(isMissingTabError(e)) return missingTabResponse(tab); throw e; }
  const rows=data.values||[[]], headers=rows[0];
  if(!headers||!headers.length) return json({ error:`Sheet tab "${tab}" has no header row`, tab }, 500);
  let nextId=1; if(rows.length>1){const existingIds=rows.slice(1).map(r=>parseInt(r[0]||'0')).filter(n=>Number.isFinite(n)&&n>0);if(existingIds.length>0)nextId=Math.max(...existingIds)+1;}
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

async function qbListAccounts(env) {
  try {
    const q = encodeURIComponent("select Id,Name,AccountType,AccountSubType,Classification from Account where Active=true maxresults 500");
    const data = await qbApi(env, `query?query=${q}&minorversion=73`);
    const accounts = (data?.QueryResponse?.Account || []).map(a => ({ id: a.Id, name: a.Name, type: a.AccountType, sub: a.AccountSubType, cls: a.Classification }));
    return json({ ok: true, count: accounts.length, accounts });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
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
  { trade: 'Cleaning',    income: 'Cleaning Income',    expenseId: '282' },
  { trade: 'Appliance',   income: 'Appliance Income',   expenseId: '230' },
  { trade: 'Windows',     incomeId: '204',              expenseId: '249' }, // Window Installation Income exists
  { trade: 'General',     incomeId: '198',              expenseId: '68'  }, // Repairs Income exists
];

// Resolved trade → QB ids (created via /qb/setup-trades, July 19, 2026).
// Invoices reference `item` (income); vendor bills reference `expense` (account).
const QB_TRADE_MAP = {
  Plumbing:   { item: '30', income: '287', expense: '245' },
  Electrical: { item: '31', income: '288', expense: '235' },
  HVAC:       { item: '32', income: '289', expense: '239' },
  Painting:   { item: '33', income: '290', expense: '243' },
  Flooring:   { item: '34', income: '291', expense: '237' },
  Carpentry:  { item: '35', income: '292', expense: '218' },
  Roofing:    { item: '36', income: '293', expense: '246' },
  Landscaping:{ item: '37', income: '294', expense: '220' },
  Cleaning:   { item: '22', income: '295', expense: '282' },
  Appliance:  { item: '39', income: '296', expense: '230' },
  Windows:    { item: '38', income: '204', expense: '249' },
  General:    { item: '40', income: '198', expense: '68'  },
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
      let itemId = itemByName[t.trade.toLowerCase()];
      if (!itemId) {
        const r = await qbApi(env, 'item?minorversion=73', 'POST',
          { Name: t.trade, Type: 'Service', IncomeAccountRef: { value: incomeId } }, token);
        itemId = r?.Item?.Id || qbDupId(r);
        if (!itemId) { log.push(`FAIL item ${t.trade}: ${JSON.stringify(r).slice(0,140)}`); continue; }
        log.push(`${r?.Item?.Id ? 'created' : 'exists'} item: ${t.trade} (${itemId})`);
      } else log.push(`item exists: ${t.trade} (${itemId})`);
      map[t.trade] = { income_acct_id: incomeId, item_id: itemId, expense_acct_id: t.expenseId };
    }
    return json({ ok: true, map, log });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// ── QUICKBOOKS: SEND-TO-QB (invoice + bill, preview-first) ───

// Find (by stored id) or create a QB Customer from an Owner row; persists QBO_Customer_ID back.
async function qbFindOrCreateCustomer(env, owner, displayName, token) {
  if (owner.QBO_Customer_ID && owner.QBO_Customer_ID.trim()) return owner.QBO_Customer_ID.trim();
  const dn = (displayName || '').trim();
  if (!dn) throw new Error('owner has no name for a QB DisplayName');
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

// Build customer-invoice lines: one line per receipt (materials) + one line for
// truck/shop stock (if any) + a single labor summary line. Materials show at cost;
// the labor line absorbs the remainder so the lines always sum to Customer_Total —
// keeping the internal $75 first-hour / markup off the customer's invoice.
function buildInvoiceLines(ir, billRow, trade, tradeName) {
  const itemRef = { value: trade.item };
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
  lines.unshift({
    DetailType: 'SalesItemLineDetail',
    Amount: laborAmt,
    Description: ('Labor & service — ' + tradeName + ' — WO ' + (ir.WO_ID || '')).slice(0, 4000),
    SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: laborAmt },
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
async function qbReadyQueue(env) {
  try {
    const [irRows, wos] = await Promise.all([
      fetchTab(env, 'Invoice_Review'), fetchTab(env, 'Work_Orders'),
    ]);
    const pending = irRows.filter(r => r.Active !== 'FALSE' && (r.QB_Invoice_Status || '').toLowerCase() === 'pending');
    const out = pending.map(r => {
      const wo = findWO(wos, r.WO_ID) || {};
      return {
        id: r.ID, bill_id: r.Bill_ID, wo_id: r.WO_ID,
        vendor_id: r.Vendor_ID, vendor_name: r.Vendor_Name,
        trade: wo.Trade || '', job_type: r.Job_Type || '',
        customer_total: r.Customer_Total || '0', vendor_cost: r.Vendor_Cost || '0',
        approved_date: r.Approved_Date || '',
        qb_invoice_id: r.QB_Invoice_ID || '', qb_bill_id: r.QB_Bill_ID || '',
      };
    });
    return json(out);
  } catch (e) { return json([]); }
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

    const [wos, props, owners, vendors, bills] = await Promise.all([
      fetchTab(env, 'Work_Orders'), fetchTab(env, 'Properties'),
      fetchTab(env, 'Owners'), fetchTab(env, 'Vendors'), fetchTab(env, 'Vendor_Bills'),
    ]);
    const wo      = findWO(wos, ir.WO_ID) || {};
    const prop    = props.find(p => p.ID === wo.Property_ID) || {};
    const owner   = owners.find(o => o.ID === prop.Owner_ID) || null;
    const vendor  = vendors.find(v => v.ID === ir.Vendor_ID) || {};
    const billRow = bills.find(b => b.ID === ir.Bill_ID) || {};

    const tradeName = (wo.Trade && QB_TRADE_MAP[wo.Trade]) ? wo.Trade : 'General';
    const trade = QB_TRADE_MAP[tradeName];

    const warnings = [];
    if (!wo.WO_ID && !wo.ID) warnings.push('Work order ' + ir.WO_ID + ' not found — trade defaulted to General.');
    else if (!QB_TRADE_MAP[wo.Trade]) warnings.push('WO trade "' + (wo.Trade || 'blank') + '" not in the QB map — using General.');
    if (!owner) warnings.push('No owner found for this property — set the property owner before sending.');
    const custTotal  = Number(ir.Customer_Total) || 0;
    const vendorCost = Number(ir.Vendor_Cost) || 0;
    if (custTotal <= 0) warnings.push('Customer_Total is 0 — nothing to invoice.');
    if (vendorCost <= 0) warnings.push('Vendor_Cost is 0 — the vendor bill will be skipped.');

    const inv = buildInvoiceLines(ir, billRow, trade, tradeName);
    if (inv.laborAmt < 0) warnings.push('Materials exceed the customer total — labor line is negative; check the bill.');

    const custDisplay = owner ? (owner.Billing_Name || owner.Company || ((owner.First_Name || '') + ' ' + (owner.Last_Name || '')).trim()) : '';
    const vendDisplay = vendor.Name || ir.Vendor_Name || ('Vendor ' + (ir.Vendor_ID || ''));
    const txnDate = ir.Approved_Date || new Date().toISOString().split('T')[0];
    const note = `RidgeCo IR ${ir.ID} · WO ${ir.WO_ID} · Bill ${ir.Bill_ID}`;

    // Customer-facing photo link (the shared job-photo folder). The folder is shared on confirm only.
    const photoFolderId  = wo.Drive_Folder_ID || '';
    const photoFolderUrl = wo.Drive_Folder_URL || '';
    const memoParts = [];
    if (wo.Invoice_Memo) memoParts.push(wo.Invoice_Memo);
    if (photoFolderUrl) memoParts.push('View job photos: ' + photoFolderUrl);
    const customerMemo = memoParts.join('\n');

    // Count receipts (with an image): all → customer invoice; reimbursable → also the vendor bill.
    let reimburseWithUrl = 0, allWithUrl = 0;
    try { const _r = JSON.parse((billRow && billRow.Receipts_JSON) || '[]'); if (Array.isArray(_r)) { allWithUrl = _r.filter(x => x && x.url).length; reimburseWithUrl = _r.filter(x => x && x.pay !== 'account' && x.url).length; } } catch (e) {}

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

    if (previewOnly) {
      return json({ preview: {
        ir_id: ir.ID, wo_id: ir.WO_ID, trade: tradeName,
        customer: { display: custDisplay, existing_id: (owner && owner.QBO_Customer_ID) || '', email: (owner && owner.Billing_Email) || '' },
        vendor:   { display: vendDisplay, existing_id: vendor.QBO_Vendor_ID || '' },
        invoice:  { total: +custTotal.toFixed(2), lines: inv.lines.map(l => ({ desc: l.Description, amount: l.Amount })), attach_receipts: allWithUrl },
        bill:     { total: +vendorCost.toFixed(2), account: trade.expense, skipped: vendorCost <= 0, attach_receipts: reimburseWithUrl },
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

    // Share the job-photo folder so the invoice's CustomerMemo link is viewable by the customer.
    if (photoFolderId) { try { const gtok = await getAccessToken(env); await driveShareAnyone(gtok, photoFolderId); } catch (e) { warnings.push('Photo-link share failed'); } }

    let customerId = '';
    try { customerId = await qbFindOrCreateCustomer(env, owner, custDisplay, token); }
    catch (e) { return json({ ok: false, error: 'Customer: ' + e.message, warnings }); }

    if (!haveInv) {
      invoicePayload.CustomerRef = { value: customerId };
      const r = await qbApi(env, 'invoice?minorversion=73', 'POST', invoicePayload, token);
      invoiceId = (r && r.Invoice && r.Invoice.Id) || '';
      if (!invoiceId) errors.push('Invoice: ' + (qbFault(r) || 'unknown error'));
    }

    if (!haveBill && vendorCost > 0) {
      let vendorId = '';
      try { vendorId = await qbFindOrCreateVendor(env, vendor, vendDisplay, token); }
      catch (e) { errors.push('Vendor: ' + e.message); }
      if (vendorId) {
        billPayload.VendorRef = { value: vendorId };
        const r = await qbApi(env, 'bill?minorversion=73', 'POST', billPayload, token);
        billId = (r && r.Bill && r.Bill.Id) || '';
        if (!billId) errors.push('Bill: ' + (qbFault(r) || 'unknown error'));
      }
    }

    // Attach receipts: ALL to the customer invoice; reimburse-the-vendor ones also to the bill.
    if (invoiceId || billId) { try { await qbAttachReceipts(env, token, invoiceId, billId, billRow, warnings); } catch (e) { warnings.push('Attachments error: ' + (e.message || '')); } }

    const status = (invoiceId && (billId || vendorCost <= 0)) ? 'sent' : (invoiceId || billId) ? 'partial' : 'pending';
    await updateRow(env, 'Invoice_Review', ir.ID, {
      QB_Invoice_ID: invoiceId, QB_Bill_ID: billId, QB_Invoice_Status: status,
    });
    if (status === 'sent' && ir.WO_ID) { try { await updateWOFields(env, ir.WO_ID, { Status: 'Invoiced' }); } catch (e) {} }

    return json({ ok: errors.length === 0, invoice_id: invoiceId, bill_id: billId, status, errors, warnings });
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
