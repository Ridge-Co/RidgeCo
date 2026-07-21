# Email → Work Order Intake — Claude Code Build Brief v1.0 (B-103)

**For:** the Claude Code session that builds this. **Read `brett-context` + `brett-flow` skills / context repo first (PAT-024).**
Full design rationale is in `RidgeCo_Email_Intake_Build_Plan_v1.0` (delivered in Cowork). This brief is the execution contract.

---

## Decisions locked (Brett, July 21)
- **Sources in v1:** Buildium (`donotreply@managebuilding.com`) **and** manual free-text lists (`phoenixestatesmaryland@gmail.com`).
- **Engine:** source-agnostic, parsers are pluggable modules (AppFolio drops in later, no engine changes).
- **On create:** create WO (status `New`) + **notify admin only** (no vendor/tenant SMS in v1). Leave a clean `onIntakeCreated()` seam for future auto-assign.
- **Trade:** keyword-based guess, **must be easily overridable** in the review queue and on the WO.
- **Auth:** dedicated `INTAKE_TOKEN` env var (do NOT reuse `WORKER_SECRET`, which is being rotated in the security build).
- **Manual-list parsing:** AI parse (LLM) → review queue. (Heuristic split is an acceptable fallback since every manual item is human-reviewed anyway.)

## Build ALL of this on the `staging` branch + a STAGING SHEET — never against live during dev. See "Sandbox contract" below.

---

## Buildium email = one WO. Parseable blocks (verified against real mail):
- Ref: subject `Work order 838106` + body `Work order #838106-1:` → `Owner_WO_Ref = "838106-1"`.
- Description: title after the colon + "Job description / Tenant notes".
- Location: `1110 North Dukeland Street - 1` + `Baltimore, MD 21216` → property addr / unit `1` / city / state / zip.
- Tenant (Entry contacts): name `Ian Rogers`, phone, email.
- Entry/pets → WO `Notes` + access hint.
- Owner: `Phoenix Estate Rentals, LLC` (header/footer).
- Files: S3 links in body (images AND video, e.g. `.MOV`).

## Manual list (Mark) = many items, no unit/tenant/files. Split → each item → `Intake_Queue` (never auto-create).

---

## Code map (current worker.js — reuse, don't reinvent)
- Router: `if (path === ...)` dispatch. Auth gate ~line 37: non-`PUBLIC_PATHS` require header `X-Auth-Token === env.WORKER_SECRET`. **Add a parallel check for `INTAKE_TOKEN` for `/intake*`.**
- `createWorkOrder(env, body)` ~636 — already accepts `property_id, unit_id, tenant_id, description, priority, owner_wo_ref, wo_contact_name, wo_contact_phone, notes`; auto-links tenants by unit/property. **Reuse.**
- `addRow(env, tab, body)` ~1761 — auto-assigns numeric ID (col 0); for `Tenants` auto-generates phone-based PIN; normalizes phone. **Use for find-or-create writes.**
- `fetchTab(env, tab)` ~1689, `updateRow` ~1775, `updateWOFields` ~1794, `fetchConfig` ~1699, `setConfigKey` ~1706.
- Drive: `findOrCreateFolder` ~1369, `uploadFileToDrive(token, arrayBuffer, filename, mime, folderId, sharedDriveId)` ~1374, `getAccessToken`. `handlePhotoUploadClean` ~477 shows the WO-folder + `Attachments` logging pattern — refactor the folder lookup into a shared `getWOFolder(token, propAddr, woId)` and reuse for `ingestFiles`.
- `sendSMS(env, to, msg)` ~1627 (single chokepoint), `logSMS`. Admin phone = `fetchConfig(env).admin_phone`.
- WO key gotcha (FEATURE_LOG rule 6): match on the **`ID`** column by header name (`findWO`/`idColIndex`), never `r[0]`, never `WO_ID`.

## New functions to add (worker.js)
`detectSource(sender,subject)` · `parseBuildium(html)` · `parseManualList(text,env)` · `resolveOwner/Property/Unit/Tenant(...)` · `normalizeAddr(s)` (N↔North, St↔Street, Ave↔Avenue, Rd↔Road; strip punctuation + unit suffix; seed-test vs current Properties to avoid dup properties — ambiguous match ⇒ queue, don't create) · `ingestFiles(env,woId,propAddr,urls)` · `onIntakeCreated(env,wo)` (v1 = admin SMS; auto-assign seam) · `keywordTrade(text)` (guess only, overridable).

## New endpoints
- `POST /intake` — `{sender,subject,date,message_id,html,plaintext}` → detect → parse → (create+notify | queue). Behind `INTAKE_TOKEN`.
- `POST /intake/approve` — `{queue_id, confirmed:{...}}` → resolve+create, mark queue row `created`.
- `GET /intake-queue` — pending items (or reuse `getSheet('Intake_Queue')`).

## Sheet changes (via `context/sheet-ops/pending.json` — against the STAGING sheet during dev)
- Work_Orders: add `Source`, `Intake_Message_ID`.
- New tab `Intake_Queue`: `ID, Received_Date, Source, Sender, Subject, Message_ID, Owner_Ref, Raw_Excerpt, Parsed_JSON, Property_Guess, Unit_Guess, Tenant_Guess, Confidence, Status, Created_WO_ID, Notes, Active`.
- Config: `intake_admin_phone` (or reuse `admin_phone`), `intake_enabled`.

## Hub UI (index.html)
New "📥 Intake" review screen: lists pending `Intake_Queue`; parsed fields editable; Property/Unit/Tenant as searchable dropdowns (reuse existing component); trade guess pre-filled + editable; photos; **Approve** (→ `/intake/approve`) / **Reject**.

## Idempotency
Structured: skip if a WO already has that `Owner_WO_Ref`. All sources: Apps Script labels processed mail (`RidgeCo/Processed`). Partial property match ⇒ queue (never dup-create).

---

## Sandbox contract (staging-mode) — the important safety piece
Cloudflare **preview URLs share production secrets/env** — a preview of new code would otherwise write to the LIVE sheet and fire REAL SMS. So isolate DATA in code:

1. **Staging-mode detection** in worker.js: if `url.hostname.startsWith('staging-')` (the preview alias) **or** `env.STAGING === '1'` → staging mode.
2. In staging mode: use `env.STAGING_SHEET_ID` instead of `env.SHEET_ID` for ALL Sheets calls, and make `sendSMS()` **log-only** (no Twilio call). Everything else identical.
3. Frontend: make the API base swappable (hostname/`?api=staging`) so a staging index.html hits the staging preview Worker.
4. Promote by merging `staging → main` only after Chrome + curl smoke tests pass and no FEATURE_LOG regression rule is violated. Prod is never touched until merge.

### Manual steps Brett does (flagged; can't be done from code)
- Cloudflare → maintenance-hub → Settings → Build → enable **non-production branch builds** (gives `staging-maintenance-hub…workers.dev` preview URL).
- Add Cloudflare env vars: `STAGING_SHEET_ID` (the test sheet), `INTAKE_TOKEN` (new secret).
- Copy the RidgeCo Main sheet → "RidgeCo STAGING", **share it with `brett-os-sheets@brettos-502323.iam.gserviceaccount.com` (Editor)** (PAT-027).
- Authorize the Apps Script poller once under the Google account (script delivered separately).

## Build order
A) Engine + Buildium + resolver + ingestFiles + `/intake` + notify → test on the 10+ real Buildium emails. → B) Intake_Queue + Hub review + `/intake/approve`. → C) manual-list AI parser → queue. (D auto-assign = future.)

## Smoke-verify each phase (brett-flow): curl the endpoint against the staging preview + check the staging sheet; Chrome-test the review screen; confirm no FEATURE_LOG "✅ Working" row regressed. Then update FEATURE_LOG + BACKLOG (B-103) + push.
