# Contacts Sync → Worker Migration — Build Brief v1.0

**Status:** Planned Aug 11 2026. Gated (PII + auth) → reviewed lane + test-verified-builds + ridgeco-validate before deploy. Replaces the standalone "RidgeCo Contacts sync" Apps Script that false-moved a live tenant (Angelic Herbert, 2026-08-11 — see CURRENT.md). Interim protection = the "Morning contact-loss guard" scheduled task (trig_01Qs6fhDKMowFVMHk4f93P8f, alert-only).

## The honest constraint (why it's in Apps Script today)
The Apps Script runs **as Brett's own Google account**, so it has native access to his **Google Contacts** — no OAuth plumbing. The Worker is NOT Brett, so to read/write his Contacts it needs **authorized People API access**. That is the ONE real setup step, and it's the only thing that can't be done from the road. Do NOT pretend it away and do NOT rabbit-hole it:

- **If `bmoremanagement.com` is Google Workspace:** add the People API scope to the existing runtime service account via **domain-wide delegation** and impersonate `brett@bmoremanagement.com`. No new token, no per-user consent — an admin-console config, ~10 min, then the existing `getAccessToken` path (worker.js ~L1652) just adds the contacts scope. **Preferred.**
- **If consumer Gmail:** one-time OAuth authorize from a computer → store `GOOGLE_CONTACTS_REFRESH_TOKEN` as a Worker secret (same pattern as the planned Gmail-send `GMAIL_REFRESH_TOKEN`). ~15 min, once.

Brett to confirm which; Claude hands the exact clicks. **This is the whole "setup" — nothing more.**

## The actual fix (independent of the above)
The bug is auto-move-out. The migrated sync **NEVER writes a tenant move-out from contact state.** Design:
- **Source of truth = the Hub `Tenants` tab.** Sync direction is Hub → Google Contacts only (upsert contact + owner/label; mirror `Active=FALSE` as the "Former Tenant" label). It **never** flips a Hub tenant to former based on a contact's label/absence. Move-out authority stays with explicit Hub actions (`/tenant/move-out`) — full stop.
- Anything the old script would have "moved out" becomes, at most, a **review-queue row** for Brett to confirm — never an automatic Sheet write.
This removes the entire bug class; the morning guard becomes redundant once shipped.

## Build
Worker (worker.js), secret-gated, reuse existing helpers (`getAccessToken`, `fetchTab`, `addRow`, `updateRow`, `logAugment` pattern):
- `GET /contacts/sync-preview` — dry run, read-only: what would be created/updated/relabeled. No writes.
- `POST /contacts/sync` — apply: upsert People API contacts from Hub tenants/owners/vendors; set owner-group labels; relabel Former where the **Hub** says inactive. Logs to a new `Contacts_Sync_Log` tab. **No tenant move-out writes.**
- Cron (`wrangler.toml`) to run daily; email Brett the same style of summary the Apps Script did.
- State: reuse/port the sync-state mapping (ResourceName per entity) into a Sheet tab so it's inspectable.

Retire the Apps Script (disable its trigger) once `/contacts/sync` is verified live. Refresh CODEMAP.

## Acceptance criteria
1. `/contacts/sync-preview` runs read-only and lists intended changes; no Sheet or Contacts write occurs.
2. A Hub tenant marked `Active=FALSE` gets their contact relabeled "Former Tenant" — but a tenant who is merely missing/edited in Contacts is **never** flipped to former in the Hub.
3. No code path writes `Tenants.Move_Out_Date`/`Active=FALSE` from the sync. (ridgeco-validate must confirm.)
4. Daily cron sends the summary email; the morning guard reports "all clear" thereafter.
5. Auth-boundary: `/contacts/sync` 401s without the secret. No cost/markup anywhere (HARD RULE).
