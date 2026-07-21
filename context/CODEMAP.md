# BrettOS Code Map — CODEMAP.md
**Version:** v1.0 | **As of:** 2026-07-21 (branch main, HEAD at load)
**Rule:** Index only — for any edit, still open the real handler at its line
(PAT-024). Refresh after any structural change to worker.js / index.html /
vendor.html. Generated + maintained by the `ridgeco-map` skill (fan-out reads).

Line anchors are **approximate** (prefixed `≈`) — jump close, then search by
function name. The endpoint index is comprehensive by design (~120 routes); that
completeness is the point — it's still a tiny fraction of the 160KB/380KB/106KB
of source it indexes.

---

## ⚠️ Doc-drift flags (found on first map — reconcile when convenient)

These are places the **code disagrees with the context docs**. The map reports
code reality; flagging so the docs can catch up (or the code, if the doc was the
intent).

1. **Vendor PIN is 8-char alphanumeric, not "4-digit."** `vendor.html` login
   takes a 3-letter + 5-digit PIN (`ABC12345`), and `/vendor-by-pin` validates
   it. **PAT-016 says "Vendors: 4-digit PIN."** Doc is stale, code is the truth.
2. **Route names are un-hyphenated in code.** The live WO-list route is
   **`GET /workorders`** (no hyphen); FEATURE_LOG writes it as `/work-orders`
   loosely. The map uses the real code paths. (Same pattern elsewhere — trust
   this map's paths over prose mentions.)
3. **`/sms-inbound` is PUBLIC (no WORKER_SECRET).** It must stay public for the
   Twilio webhook, but the Plan-B per-user auth work (B-093 security pass) should
   treat it as an untrusted entry point. Also public: `/qb/test`, `/qb/accounts`,
   `/qb/setup-trades`, and the reserved-but-unimplemented `/qb/connect`,
   `/qb/callback`, `/qb/webhook` (these 3 fall through to 404 — no handler yet).
   Note: `/public/entities-feed` is **behind** the secret despite the name.

Confirmed consistent with FEATURE_LOG: WO identity resolves by header-named `ID`
via `findWO` (`w.ID === woId`) / `idColIndex` (finds `ID` header, which sits at
**index 1** — col 0 is `Vendor_Needs_Access`), never `r[0]` (FL rule 6). ✅

---

## 1. Worker endpoints (worker.js)

Router = a plain if-chain in the `fetch` handler: OPTIONS handled first (≈34),
secret gate at ≈38 (`if (!PUBLIC_PATHS.includes(path))`), then method +
`path ===` equality tests. Auth legend: **PUBLIC** = in `PUBLIC_PATHS`;
**secret** = behind WORKER_SECRET. `≈Line` shows the handler fn where distinct.

### GET routes
| METHOD PATH | Handler | Purpose | Sheet tab(s) · R/W | Auth | ≈Line |
|---|---|---|---|---|---|
| GET /properties | getSheet | List properties | Properties · R | secret | ≈47 |
| GET /public/entities-feed | getEntitiesFeed | Entity feed for BrettOS (id/alias resolve) | Properties · R | secret | ≈189 |
| GET /units | getSheet | List units | Units · R | secret | ≈49 |
| GET /tenants | getSheet | List tenants | Tenants · R | secret | ≈50 |
| GET /owners | getSheet | List owners | Owners · R | secret | ≈51 |
| GET /vendors | getSheet | List vendors | Vendors · R | secret | ≈52 |
| GET /workorders | getSheet | List work orders | Work_Orders · R | secret | ≈53 |
| GET /wo-tenants | listWOTenants | Tenants linked to a WO | WO_Tenants · R | secret | ≈593 |
| GET /time-entries | listTimeEntries | Time entries for a WO | Time_Entries · R | secret | ≈547 |
| GET /receipts | listReceipts | Receipts for a WO | Receipts · R | secret | ≈558 |
| GET /invoices | getSheet | List invoices | Invoices · R | secret | ≈57 |
| GET /templates | getSheet | Recurring templates | Recurring_Templates · R | secret | ≈58 |
| GET /smslog | getSheet | SMS log | SMS_Logs · R | secret | ≈59 |
| GET /wishlist | getSheet | Wishlist / Dev Log items | Wishlist · R | secret | ≈60 |
| GET /keys | getSheet | List keys | Keys · R | secret | ≈61 |
| GET /keys-history | getSheet | Key history | Keys_History · R | secret | ≈62 |
| GET /config | getConfig | Config key/values | Config · R | secret | ≈1694 |
| GET /property | getPropertyFull | Property + units/tenants/keys | Properties, Units, Tenants, Keys · R | secret | ≈856 |
| GET /building-info | getBuildingInfo | Property/unit building info | Properties, Units · R | secret | ≈866 |
| GET /cache | getSheet | Troubleshooting cache | Troubleshooting_Cache · R | secret | ≈66 |
| GET /keys-by-property | keysByProperty | Keys for a property | Keys · R | secret | ≈391 |
| GET /keys-by-unit | keysByUnit | Keys for a unit | Keys · R | secret | ≈398 |
| GET /attachments | getAttachments | Attachments for a WO | Attachments · R | secret | ≈459 |
| GET /wo-audit | getWOAudit | Audit trail for a WO | WO_Audit · R | secret | ≈1229 |
| GET /tenant-by-pin | tenantByPin | PIN login → tenant | Tenants · R; PIN_Lockout · R/W | secret | ≈306 |
| GET /owner-by-pin | ownerByPin | PIN login → owner | Owner_Users, Owners · R; PIN_Lockout · R/W | secret | ≈335 |
| GET /vendor-by-pin | vendorByPin | PIN login → vendor (8-char PIN) | Vendors · R; PIN_Lockout · R/W | secret | ≈372 |
| GET /owner-properties | ownerProperties | Properties for an owner | Properties, Units · R | secret | ≈882 |
| GET /vendor-workorders | vendorWorkorders | WOs assigned to a vendor | Work_Orders · R | secret | ≈777 |
| GET /tenant-workorders | tenantWorkorders | WOs for a tenant | Work_Orders · R | secret | ≈793 |
| GET /owner-workorders | ownerWorkorders | WOs for an owner | Work_Orders · R | secret | ≈805 |
| GET /owner-notifications | getOwnerNotifications | Owner notify prefs | Owners · R | secret | ≈1571 |
| GET /owner-users | getOwnerUsers | Users under an owner | Owner_Users · R | secret | ≈365 |
| GET /notifications/pending | processPendingNotifications | Drain due queued notifs (sends SMS) | Notification_Queue · R/W | secret | ≈1552 |
| GET /master-keys | getSheet | List master keys | Master_Keys · R | secret | ≈81 |
| GET /wo-templates | listWOTemplates | WO templates | WO_Templates · R | secret | ≈1340 |
| GET /materials | listMaterials | Materials catalog | Materials · R | secret | ≈1346 |
| GET /returns | getSheet | Returns list | Returns · R | secret | ≈84 |
| GET /vendor-bills | listVendorBills | Vendor bills (opt. per-WO / status) | Vendor_Bills · R | secret | ≈991 |
| GET /estimates | listEstimates | Estimate versions for a WO | Estimates · R | secret | ≈1056 |
| GET /nearby-wos | listNearbyWOs | WOs near a location | Work_Orders · R | secret | ≈1108 |
| GET /cluster-suggestions | clusterSuggestions | Location-cluster suggestions | Properties · R | secret | ≈1132 |
| GET /qb/test | qbTest | QB connection test | — (QB API) | **PUBLIC** | ≈1843 |
| GET /qb/accounts | qbListAccounts | List QB accounts | — (QB API) | **PUBLIC** | ≈1851 |
| GET /qb/setup-trades | qbSetupTrades | Provision QB income accts/items per trade | — (QB API) | **PUBLIC** | ≈1910 |
| GET /qb/ready | qbReadyQueue | Invoices ready to push to QB | Invoice_Review, Work_Orders · R | secret | ≈2112 |

### POST routes
| METHOD PATH | Handler | Purpose | Sheet tab(s) · R/W | Auth | ≈Line |
|---|---|---|---|---|---|
| POST /upload-photo | handlePhotoUploadClean | Upload WO photo → Drive + log | Attachments · W (+Drive) | secret | ≈477 |
| POST /sms-inbound | handleInboundSMS | Twilio inbound webhook (vendor YES/NO) | Work_Orders · W, Vendors · R, SMS_Logs · W, WO_Audit · W | **PUBLIC** | ≈1604 |
| POST /workorder | createWorkOrder | Create work order | Work_Orders · W, Tenants · R | secret | ≈636 |
| POST /workorder/update | updateRow | Update WO fields | Work_Orders · W | secret | ≈99 |
| POST /workorder/notes | appendWONotes | Append to WO notes | Work_Orders · W | secret | ≈666 |
| POST /wo-tenant/add | addTenantToWO | Link tenant to WO | WO_Tenants · W | secret | ≈600 |
| POST /wo-tenant/remove | removeTenantFromWO | Unlink tenant (soft) | WO_Tenants · W | secret | ≈611 |
| POST /time-entry/add | addTimeEntry | Add time entry | Time_Entries · W | secret | ≈579 |
| POST /time-entry/delete | updateRow | Soft-delete time entry | Time_Entries · W | secret | ≈104 |
| POST /receipt/add | addReceipt | Add receipt | Receipts · W | secret | ≈569 |
| POST /receipt/delete | updateRow | Soft-delete receipt | Receipts · W | secret | ≈106 |
| POST /tenant/move-out | processMoveOut | Move-out a tenant | Tenants · W | secret | ≈618 |
| POST /assign | assignVendor | Assign vendor, SMS vendor+tenant | Work_Orders · W; Vendors/Tenants/Units/Properties/Keys · R; SMS | secret | ≈675 |
| POST /status | updateStatus | Change WO status, audit + notify | Work_Orders · W; WO_Audit · W; SMS | secret | ≈717 |
| POST /invoice | createInvoice | Create invoice | Invoices · W | secret | ≈765 |
| POST /invoice/update | updateRow | Update invoice | Invoices · W | secret | ≈111 |
| POST /property/add | addRow | Add property | Properties · W | secret | ≈112 |
| POST /property/update | updateRow | Update property | Properties · W | secret | ≈113 |
| POST /unit/add | addRow | Add unit | Units · W | secret | ≈114 |
| POST /unit/update | updateRow | Update unit | Units · W | secret | ≈115 |
| POST /tenant/add | addRow | Add tenant | Tenants · W | secret | ≈116 |
| POST /tenant/update | updateRow | Update tenant | Tenants · W | secret | ≈117 |
| POST /owner/add | addRow | Add owner | Owners · W | secret | ≈118 |
| POST /owner/update | updateRow | Update owner | Owners · W | secret | ≈119 |
| POST /owner/billing | updateOwnerBilling | Update owner billing | Owners · W | secret | ≈1399 |
| POST /owner/get-billing | getOwnerBilling | Get owner billing | Owners · R | secret | ≈1407 |
| POST /vendor/add | addRow | Add vendor | Vendors · W | secret | ≈122 |
| POST /vendor/update | updateRow | Update vendor | Vendors · W | secret | ≈123 |
| POST /set-pin | updateRow | Set tenant PIN | Tenants · W | secret | ≈124 |
| POST /vendor/set-pin | updateRow | Set vendor PIN | Vendors · W | secret | ≈125 |
| POST /owner/set-pin | updateRow | Set owner PIN | Owners · W | secret | ≈126 |
| POST /key/add | addRow | Add key | Keys · W | secret | ≈127 |
| POST /key/update | updateKeyWithHistory | Update key + history row | Keys · W, Keys_History · W | secret | ≈439 |
| POST /key/delete | updateRow | Soft-delete key | Keys · W | secret | ≈129 |
| POST /building-info/save | saveBuildingInfo | Save property/unit info (bulk units) | Properties, Units · W | secret | ≈875 |
| POST /attachment/delete | updateRow | Soft-delete attachment | Attachments · W | secret | ≈131 |
| POST /wo/add-note | addWONote | Add WO note (+ optional SMS) | Work_Orders · W; Properties/Vendors · R; SMS | secret | ≈1247 |
| POST /wo/owner-update | ownerUpdateWO | Owner-side WO update | Work_Orders · W | secret | ≈1285 |
| POST /wo/admin-update | adminUpdateWO | Admin WO update | Work_Orders · W | secret | ≈1297 |
| POST /wo/append-description | appendDescription | Append to WO description | Work_Orders · W | secret | ≈1305 |
| POST /wo/set-tenant-visibility | setTenantVisibility | Toggle tenant visibility | Work_Orders · W | secret | ≈1317 |
| POST /schedule | scheduleWO | Set scheduled date | Work_Orders · W | secret | ≈1520 |
| POST /owner/notifications | saveOwnerNotifications | Save owner notify prefs | Owners · W | secret | ≈1577 |
| POST /owner-user/add | addRow | Add owner user | Owner_Users · W | secret | ≈139 |
| POST /owner-user/update | updateRow | Update owner user | Owner_Users · W | secret | ≈140 |
| POST /send-pin | sendPinMessage | SMS a PIN to a person | Tenants/Vendors/Owners/Owner_Users · R; SMS | secret | ≈930 |
| POST /regenerate-pin | regeneratePIN | Regenerate + save PIN | Tenants/Vendors/Owners · W; SMS | secret | ≈912 |
| POST /admin/fix-pins | adminFixPins | Backfill PINs | Vendors, Owners, Owner_Users, Tenants · W | secret | ≈1415 |
| POST /admin/reformat-sheets | adminReformatSheets | Bulk sheet reformat | multiple · W | secret | ≈1434 |
| POST /admin/test-drive | testDriveAccess | Test Drive access | — (Drive) | secret | ≈1454 |
| POST /estimate | addEstimateVersion | Add estimate version | Estimates · W | secret | ≈1088 |
| POST /estimate/approve | approveEstimate | Approve estimate (SMS vendor) | Estimates · W; Vendors · R; SMS | secret | ≈1064 |
| POST /geocode-property | geocodeProperty | Geocode + save lat/lng | Properties · W | secret | ≈1124 |
| POST /save-property-clusters | savePropertyClusters | Save location clusters | Properties · W | secret | ≈1145 |
| POST /import-key-registry | importKeyRegistry | Import keys from external sheet | Keys · W; Properties, Units · R | secret | ≈1162 |
| POST /generate-estimate-text | generateEstimateText | LLM-generate estimate text | — (AI) | secret | ≈1199 |
| POST /create-upload-session | createUploadSession | Start Drive resumable upload | — (Drive) | secret | ≈1470 |
| POST /log-attachment | logAttachment | Log an uploaded attachment | Attachments · W | secret | ≈1510 |
| POST /vendor-bill/add | addVendorBill | Add vendor bill (auto-sets WO→Complete) | Vendor_Bills · W | secret | ≈974 |
| POST /vendor-bill/update | updateRow | Update vendor bill | Vendor_Bills · W | secret | ≈155 |
| POST /wo/set-qbo-info | updateRow | Save QBO ids onto WO | Work_Orders · W | secret | ≈156 |
| POST /master-key/add | addRow | Add master key | Master_Keys · W | secret | ≈157 |
| POST /master-key/update | updateRow | Update master key | Master_Keys · W | secret | ≈158 |
| POST /master-key/bulk-assign | bulkAssignMasterKey | Bulk-assign master key to properties | Properties · W | secret | ≈1329 |
| POST /wo-template/add | addRow | Add WO template | WO_Templates · W | secret | ≈160 |
| POST /wo-template/update | updateRow | Update WO template | WO_Templates · W | secret | ≈161 |
| POST /material/add | addRow | Add material | Materials · W | secret | ≈162 |
| POST /material/update | updateRow | Update material | Materials · W | secret | ≈163 |
| POST /return/add | addRow | Add return | Returns · W | secret | ≈164 |
| POST /return/update | updateRow | Update return | Returns · W | secret | ≈165 |
| POST /cache/save | saveCacheEntry | Save troubleshooting cache entry | Troubleshooting_Cache · W | secret | ≈889 |
| POST /cache/flag | flagCacheEntry | Flag cache entry | Troubleshooting_Cache · W | secret | ≈899 |
| POST /cache/refresh | refreshCacheEntry | Clear/refresh cache entry | Troubleshooting_Cache · W | secret | ≈900 |
| POST /wishlist/add | addWishlistItem | Add wishlist item | Wishlist · W | secret | ≈1595 |
| POST /wishlist/delete | updateRow | Soft-delete wishlist item | Wishlist · W | secret | ≈170 |
| POST /config/set | setConfigKey | Set config key | Config · W | secret | ≈1706 |
| POST /invoice-review/approve | approveInvoiceReview | Approve markup → Invoice_Review log | Vendor_Bills · W, Invoice_Review · W | secret | ≈1006 |
| POST /qb/send-invoice | qbSendInvoice | Push invoice+bill to QuickBooks (preview-first) | Work_Orders · W, Invoice_Review · W; Properties/Owners/Vendors/Vendor_Bills · R; QB API | secret | ≈2137 |

Unmatched method/path → `json({error:'Not found'}, 404)` at ≈175.
`PUBLIC_PATHS` (worker.js ≈37): `/sms-inbound`, `/qb/test`, `/qb/accounts`,
`/qb/setup-trades`, `/qb/connect`, `/qb/callback`, `/qb/webhook`.

---

## 2. Worker helpers / chokepoints (worker.js)

| Function | Concern | Notes / why it matters | ≈Line |
|---|---|---|---|
| sheetsRequest | Sheets I/O | Low-level Sheets REST wrapper (get/append/batchUpdate); every tab op funnels here | ≈1674 |
| getSheet | Sheets I/O | Read a tab → JSON Response (used by many GET routes) | ≈1684 |
| fetchTab | Sheets I/O | Read a tab → header-mapped row objects (in-code read primitive) | ≈1689 |
| addRow | Sheets I/O | Generic append; auto ID, Active=TRUE, normalizes Phone, auto-PINs, clean 404 on missing tab | ≈1761 |
| **updateRow** | Sheets I/O | **THE generic row-update chokepoint**; resolves key via idColIndex, batchUpdate by column; soft-deletes go through here | ≈1775 |
| updateWOFields / updateWOField | Sheets I/O | Work_Orders-specific multi/single field writers (assign/status/SMS) | ≈1794 / ≈1384 |
| **findWO** | WO id-resolution | Resolves WO by `w.ID === woId` (NOT r[0]); null if id missing — prevents hitting the first row (FL rule 6) | ≈1744 |
| **idColIndex** | WO id-resolution | Finds key col by header name `ID` (fallback col 0). Work_Orders' ID is at **index 1** (FL rule 6) | ≈1749 |
| nextSafeId | Sheets I/O | Next numeric ID = max(existing col-0 ids)+1 | ≈1726 |
| isMissingTabError / missingTabResponse | Sheets I/O | "Unable to parse range" → clean 404 (writes fail loudly; reads swallow — FL rule 16) | ≈1754 / ≈1757 |
| getConfig / fetchConfig / setConfigKey | config | Config tab read (Response/object) + upsert | ≈1694 / ≈1699 / ≈1706 |
| **logWOAudit** | Audit | THE audit logger → WO_Audit (field, old→new, who/role); swallows errors (FL) | ≈1219 |
| **sendSMS** | SMS | **THE single SMS-send chokepoint** — Twilio POST; wrap HERE for quiet-hours/opt-out/test (B-093) | ≈1629 |
| logSMS | SMS | Appends texts to SMS_Logs (non-fatal) | ≈1640 |
| twilioResponse | SMS | TwiML `<Response><Message>` for inbound webhook replies | ≈2273 |
| normalizePhone | SMS / auth | Canonicalizes phone numbers (matching + PIN gen) | ≈2282 |
| queueNotification / processPendingNotifications | SMS | Deferred queue (Notification_Queue) → drained by GET /notifications/pending. **No cron flushes it yet** (B-093 Phase 0.3) | ≈1543 / ≈1552 |
| shouldNotifyOwner | SMS | Owner notify-tier gate (priority × tiers × per-WO override) | ≈1584 |
| getAccessToken | auth/token | Google service-account JWT → OAuth token (Sheets/Drive) | ≈1652 |
| importPrivateKey / signRS256 / b64url | auth/token | RS256 JWT signing for the service account | ≈1663 / ≈1669 / ≈1650 |
| checkPinLockout / recordPinFailure / clearPinLockout | auth/session | PIN brute-force lockout via PIN_Lockout tab | ≈230 / ≈247 / ≈272 |
| pinLookup | auth/session | Generic PIN resolver wrapping lockout + per-role finder | ≈289 |
| generatePIN | auth/session | PIN derived from phone number | ≈905 |
| qbAccessToken / qbApi | QuickBooks | QB OAuth token refresh (reused per batch) + request wrapper | ≈1806 / ≈1835 |
| **QB_TRADE_MAP** | QuickBooks | Trade → {income/item/expense acct}; drives invoice/bill lines; unknown→'General' | ≈1880 |
| qbFindOrCreateCustomer / qbFindOrCreateVendor | QuickBooks | Resolve/create QB Customer (owner) / Vendor; persist QBO id back | ≈1949 / ≈1973 |
| buildInvoiceLines | QuickBooks | Build QB invoice lines from Invoice_Review + bill + trade (FL rule 11) | ≈1993 |
| qbUploadAttachable / qbAttachReceipts | QuickBooks | Attach receipts to QB invoice/bill (best-effort — FL rule 14) | ≈2064 / ≈2083 |
| findOrCreateFolder / uploadFileToDrive | Drive | Drive folder resolution + upload (shared-drive aware) | ≈1357–1374 |
| driveShareAnyone / driveDownload / driveIdFromUrl | Drive | Share link, download bytes, extract id (feeds QB attach) | ≈2034 / ≈2046 / ≈2057 |
| enrichWO | misc | Joins WO with property/unit/tenant/keys for display | ≈817 |
| getWOLockboxes | misc | Lockbox codes for a WO (vendor-assign SMS) | ≈411 |
| translateToEnglish | misc | ES→EN (LLM) for Spanish vendor status notes | ≈1237 |
| calcTieredEstimate | misc | Tiered markup math for estimates | ≈1099 |
| json | misc | Standard JSON Response (status + CORS) | ≈2270 |

---

## 3. index.html screens (admin Hub) — 5898 lines

Nav/router: `showPage` (≈1014) toggles `.page` divs + lazy-loads Review Bills /
QB / Dev Log; `navigateTo` (≈842) wraps it. All pages share `state`, hydrated
once by `loadAll` (≈989) which calls `/properties /units /tenants /vendors
/workorders /invoices /owners /keys` + `/notifications/pending` + `/config`.

| Screen / view | Render fn | Endpoints it calls | Notes | ≈Line |
|---|---|---|---|---|
| Dashboard | renderDashboard | (state via loadAll) | Stat tiles + top-15 active WO cards (`woCard`) | ≈1025 |
| Work Orders list | renderWOPage | (state; client-side filter/sort) | Bulk mode; `renderBundlingOpportunities` ≈4319 | ≈1132 |
| **WO Detail modal** | openWODetail | /vendor-bills?wo_id=, /keys, /wo-audit?wo_id=, then multi-pass sub-panels | **Multi-pass build — use insertAdjacentHTML, never += (FL rule 15)**; sub-panels injected async ≈1463-1474 | ≈1188 |
| — photos panel | buildPhotoSection / loadPortalAttachments | /attachments, /create-upload-session, /log-attachment, /attachment/delete | | ≈5746 / ≈5707 |
| — vendor-bill/invoice panel | loadVendorBillForInvoice | /vendor-bills?wo_id=, /qb/ready, /workorder/update | | ≈3689 |
| — estimates panel | loadHubEstimateView / openHubEstimateEditor | /estimates, /estimate, /estimate/approve, /generate-estimate-text | | ≈3795 |
| — receipts panel | loadHubReceiptTracking | /receipts, /receipt/add, /receipt/delete | | ≈3963 |
| — time panel | loadHubTimeTracking | /time-entries, /time-entry/add, /time-entry/delete | | ≈4062 |
| — nearby panel | loadHubNearbyWOs | /nearby-wos?wo_id= | bundling | ≈4282 |
| — materials panel | loadWOMaterials | /materials, /material/update, /material/add | | ≈3388 |
| Assign Vendor modal | openAssignModal / renderAssignVendorOptions | /assign | searchable picker | ≈1491 |
| New WO modal | openNewWOModal | /workorder → chains /assign, /schedule | | ≈1594 |
| Edit WO modal | openEditWOModal | /wo/admin-update, /wo/set-tenant-visibility, /workorder/update | | ≈2136 |
| Schedule modal | openSchedModal | /schedule | `buildTimeWindowOpts` ≈848 | ≈2339 |
| Properties page | renderPropertiesPage / renderUnitCards | (state) | | ≈1676 |
| Unit Detail | openUnitDetail | /keys | `renderKeyItem` ≈1926 | ≈1813 |
| Vendors page | renderVendorsPage | /vendor/update, /vendor/add, /send-pin | | ≈1972 |
| Tenants page | renderTenantsPage | /set-pin, /tenant/update | | ≈2000 |
| Invoices page | renderInvoicesPage | /status (mark-paid) | | ≈2077 |
| Owners page | renderOwnersPage | /owner-users?owner_id=all, /owner/add | | ≈2663 |
| Shopping: List/Returns/MasterKeys/Templates | renderMaterials / renderReturns / renderMasterKeys / renderTemplates | /materials, /returns, /master-keys, /wo-templates (+ add/update, /master-key/bulk-assign) | `switchShoppingTab` | ≈3331+ |
| **Review Bills** page | loadInvoiceReview / renderIRCard | /vendor-bills?status=submitted, /invoice-review/approve, /vendor-bill/update, /status | lazy-loaded | ≈4378 |
| **Send to QB** page | loadQBQueue / renderQBCard / renderQBPreview | /qb/ready, /qb/send-invoice (preview_only then real) | **preview-then-send (FL rule 10)** | ≈4724 |
| Keys view | showKeysView / renderKeyRow | /keys, /key/add, /key/update | modals ≈5200/5228 | ≈3048 |
| Move-In modal | openMoveInModal | /tenant/add, /unit/update, /wo-tenant/add, /tenant/move-out | uses apiWithTimeout | ≈2700 |
| Move-Out modal | openMoveOutModal | /tenant/move-out | | ≈5269 |
| PIN send modal | openPinSendModal / sendPin | /send-pin (preview then send), /regenerate-pin | shared vendors/tenants | ≈2583 |
| Dev Log page | renderErrorLog + loadWishlist + loadTradeAccessDefaults | /wishlist(+add/delete), /cache(+flag/refresh), /config(+set), /admin/fix-pins, /admin/reformat-sheets | data tools | ≈2472 |

---

## 4. vendor.html screens (vendor portal) — 8-char PIN, EN/ES

Base `WORKER = maintenance-hub.brett-2f8.workers.dev`; all calls go through
`api()` (≈210) which injects `X-Auth-Token: SECRET` (except direct upload/wishlist
fetches). i18n via `t`/`applyTranslations` (≈1782) — `LANG` from `data.language`.

| Screen / view | Render fn | Endpoints it calls | Notes | ≈Line |
|---|---|---|---|---|
| **PIN login** | doLogin | /vendor-by-pin?pin=&name= | **8-char PIN `ABC12345`** (3 alpha + 5 digit), NOT 4-digit (drift vs PAT-016) | ≈223 |
| Logout | doLogout | — | clears session | ≈275 |
| WO list (Open/All, filters) | loadWorkOrders → renderWOs; switchTab | /vendor-workorders?vendor_id=&include_closed | client-side filter/sort | ≈349 / ≈365 |
| WO detail card | renderWOs; toggleCard | (lazy sub-sections on expand) | | ≈365 / ≈911 |
| Status update | setStatus → submitStatus | POST /status | + optional note | ≈918 |
| Estimate builder | loadEstimateWidget / openEstimateEditor / submitEstimate | GET /estimates?wo_id=, POST /estimate | line items + total, history toggle | ≈481 / ≈612 |
| Nearby WOs | loadVendorNearbyWOs | GET /nearby-wos?wo_id=&vendor_id= | | ≈632 |
| Receipts | loadVendorReceipts / submitVendorReceipt / deleteVendorReceipt | /receipts, /receipt/add, /receipt/delete | amount/date/store | ≈685 / ≈728 |
| Bill summary | loadVendorBillSummary | /vendor-bills?wo_id=&vendor_id= | read-only rollup | ≈754 |
| **Bill submission modal** | openBillModal / submitVendorBill | POST /vendor-bill/add; receipt photos via /upload-photo | hourly/flat, truck-stock, receipt rows w/ pay mode | ≈1488 / ≈1655 |
| Time tracking | loadVendorTimeTracking / submitVendorTime / deleteVendorTime | /time-entries, /time-entry/add, /time-entry/delete | quick-set buttons | ≈792 / ≈864 |
| **Photo upload BEFORE/AFTER/REPORT/RECEIPT** | buildPhotoSection → portalUploadFiles → _uploadOneFile; loadPortalAttachments | /create-upload-session, PUT upload_url, /log-attachment, /attachments | **No `capture` attr (`cap:''`) — FL rule 4**; multi-file, image/video (receipt=img/pdf) | ≈1137 / ≈1081 |
| Legacy single upload | uploadPhoto | POST /upload-photo (X-Auth-Token) | older multipart path | ≈969 |
| Scheduling modal | openSchedModal / submitVendorSched | POST /schedule | date + window/custom, notify checkbox | ≈1316 |
| Feedback/report-issue | openFeedback / submitFeedback | POST /wishlist/add (hardcoded full URL) | source="VENDOR" | ≈1201 |

---

## 5. Sheet-tab reverse index

For each tab: which endpoints READ it, which WRITE it. Answers "what breaks if I
change this column?" in one read. (Writes via generic `updateRow` are noted by
their route.)

| Tab | Read by | Written by | Schema gotchas |
|---|---|---|---|
| **Work_Orders** | /workorders, /vendor-workorders, /tenant-workorders, /owner-workorders, /nearby-wos, /qb/ready, /property | /workorder, /workorder/update, /workorder/notes, /assign, /status, /schedule, /wo/add-note, /wo/owner-update, /wo/admin-update, /wo/append-description, /wo/set-tenant-visibility, /wo/set-qbo-info, /sms-inbound, /qb/send-invoice | col0=`Vendor_Needs_Access` (blank/"auto"), col1=**`ID`** — resolve by header via findWO/idColIndex, never r[0] (FL rule 6) |
| **Vendor_Bills** | /vendor-bills | /vendor-bill/add (auto→WO Complete), /vendor-bill/update, /invoice-review/approve | don't reorder columns (FL rule 5) |
| **Invoice_Review** | /qb/ready, /qb/send-invoice | /invoice-review/approve, /qb/send-invoice (QB ids) | 19-col header; QB_Invoice_ID/QB_Bill_ID written by send-invoice (FL rule 5) |
| **Receipts** | /receipts | /receipt/add, /receipt/delete | updateRow matches r[0]=ID; probe writes not reads (FL rule 16) |
| **WO_Audit** | /wo-audit | logWOAudit (via /status, /sms-inbound, /wo/admin-update…) | logWOAudit swallows errors; tab created July 21 |
| **Tenants** | /tenants, /tenant-by-pin, /workorder (create) | /tenant/add, /tenant/update, /set-pin, /tenant/move-out, /regenerate-pin, /admin/fix-pins | |
| **Vendors** | /vendors, /vendor-by-pin, /assign, /send-pin, /sms-inbound | /vendor/add, /vendor/update, /vendor/set-pin, /regenerate-pin, /admin/fix-pins | QBO_Vendor_ID col; 8-char PIN |
| **Owners** | /owners, /owner-by-pin, /owner-notifications, /owner/get-billing, /qb/send-invoice | /owner/add, /owner/update, /owner/billing, /owner/notifications, /owner/set-pin, /admin/fix-pins | QBO_Customer_ID col |
| **Owner_Users** | /owner-users, /owner-by-pin | /owner-user/add, /owner-user/update, /admin/fix-pins | |
| **Properties** | /properties, /public/entities-feed, /property, /building-info, /owner-properties, /cluster-suggestions | /property/add, /property/update, /building-info/save, /geocode-property, /save-property-clusters, /master-key/bulk-assign | |
| **Units** | /units, /property, /building-info, /owner-properties | /unit/add, /unit/update, /building-info/save | |
| **Keys** | /keys, /keys-by-property, /keys-by-unit, /property | /key/add, /key/update, /key/delete, /import-key-registry | |
| **Keys_History** | /keys-history | /key/update (updateKeyWithHistory) | |
| **Master_Keys** | /master-keys | /master-key/add, /master-key/update | |
| **WO_Tenants** | /wo-tenants | /wo-tenant/add, /wo-tenant/remove | |
| **Time_Entries** | /time-entries | /time-entry/add, /time-entry/delete | |
| **Attachments** | /attachments | /upload-photo, /log-attachment, /attachment/delete | |
| **Estimates** | /estimates | /estimate, /estimate/approve | |
| **Invoices** | /invoices | /invoice, /invoice/update | |
| **Materials** | /materials | /material/add, /material/update | |
| **Returns** | /returns | /return/add, /return/update | |
| **WO_Templates** | /wo-templates | /wo-template/add, /wo-template/update | prefill-only; no server-side instantiation |
| **Recurring_Templates** | /templates | — | |
| **Notification_Queue** | /notifications/pending | queueNotification, /notifications/pending | nothing flushes it (no cron yet — B-093) |
| **SMS_Logs** | /smslog | logSMS (via sendSMS, /sms-inbound) | |
| **PIN_Lockout** | pin-login endpoints | checkPinLockout/recordPinFailure/clearPinLockout | |
| **Config** | /config | /config/set | QB refresh-token persisted here (FL rule 8) |
| **Troubleshooting_Cache** | /cache | /cache/save, /cache/flag, /cache/refresh | |
| **Wishlist** | /wishlist | /wishlist/add, /wishlist/delete | Dev Log tab (PAT-008) |
