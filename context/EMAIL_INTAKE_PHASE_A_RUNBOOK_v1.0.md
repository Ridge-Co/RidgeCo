# Email → WO Intake — Phase A Runbook v1.0 (B-103)

**Status:** built on the `staging` branch, **not merged to main, never run against a real email or a live Worker.**
Everything below is the path from "code exists" to "verified working."

---

## What Phase A does

`POST /intake` accepts a forwarded email and, for **Buildium** mail only, creates a work order:

```
detect source → parse → dedupe → resolve Owner/Property/Unit/Tenant
             → createWorkOrder (status New, stamped Owner_WO_Ref)
             → ingest S3 photos/video → Drive → notify admin by SMS
```

It always returns **HTTP 200** with a `status` the poller branches on:

| status | meaning | Gmail label applied |
|---|---|---|
| `created` | WO created | `RidgeCo/Processed` |
| `duplicate` | this ref/message already made a WO | `RidgeCo/Processed` |
| `skipped` | `intake_enabled` is `FALSE` | `RidgeCo/Processed` |
| `needs_review` | parsed, but a human must confirm | `RidgeCo/NeedsReview` |
| `unsupported` | unknown sender / AppFolio | `RidgeCo/NeedsReview` |
| non-200 | transport or server error | none — retried next run |

**What it deliberately will NOT do:** create an Owner (ever), or create a Property on a *partial*
address match. Those return `needs_review`. A duplicate property would silently split a building's
WO history in two, and Owners feed QuickBooks invoicing. Units and Tenants *are* created on a
genuine no-match — cheap to fix if wrong.

---

## Brett's manual steps (cannot be done from code)

1. **Cloudflare** → maintenance-hub → Settings → Build → enable **non-production branch builds**
   → gives `https://staging-maintenance-hub.brett-2f8.workers.dev`.
2. **Cloudflare** → Variables → add:
   - `STAGING_SHEET_ID` = the staging sheet id (step 3)
   - `INTAKE_TOKEN` = a new random secret (do **not** reuse `WORKER_SECRET` — it's being rotated)
   - `STAGING` = `1` **on the preview environment only.** Staging is also auto-detected from a
     `staging-` hostname, but Cloudflare's *version* preview URLs look like
     `<hash>-maintenance-hub…` and would NOT match — they'd hit live data. Setting `STAGING=1`
     explicitly is the reliable switch; the hostname check is the backstop.
3. **Copy** the RidgeCo Main sheet → name it "RidgeCo STAGING" →
   **share it with `brett-os-sheets@brettos-502323.iam.gserviceaccount.com` as Editor** (PAT-027).
4. **Apps Script** — paste `appsscript/intake_poller.gs` into script.google.com, set the two Script
   Properties, run `testOneEmail`, approve consent. Setup detail is in the file's header comment.
   **Do not add the 5-minute trigger until the smoke tests below pass.**

> Until `STAGING_SHEET_ID` exists, the staging Worker returns **503 by design** — it refuses to fall
> back to the live sheet. A 503 here means the guard is working, not that the build is broken.

---

## Sheet change (run against STAGING first)

`context/sheet-ops/staged_B103_phaseA.json` adds `Source` + `Intake_Message_ID` to `Work_Orders`.
It is **inert where it sits** — the GitHub Action only fires on the exact path
`context/sheet-ops/pending.json`. To run it: set `sheet_id` to the staging id, copy it to
`pending.json`, push.

Both ops are additive (new trailing columns), so no existing `worker.js` column index shifts.

⚠️ **Run this before enabling the 5-minute trigger.** Without `Intake_Message_ID` the second dedupe
layer can't persist. `Owner_WO_Ref` and the Gmail label still cover it, but an email whose ref fails
to parse would lose one of its three guards.

---

## Smoke tests

**1. Offline (no infrastructure needed — run these now):**
```bash
node test/intake.test.mjs              # 85 parser/matcher/regression tests
node test/intake.integration.test.mjs  # 56 end-to-end tests vs a fake Sheets API
```

**2. Staging Worker — the guard fires:**
```bash
curl -s -X POST https://staging-maintenance-hub.brett-2f8.workers.dev/intake \
  -H "X-Auth-Token: $INTAKE_TOKEN" -H "Content-Type: application/json" -d '{}'
# before STAGING_SHEET_ID is set → 503 "refusing to fall back to the live sheet"  ✅ expected
```

**3. Staging Worker — auth:**
```bash
curl -s -X POST .../intake -H "X-Auth-Token: wrong" -d '{}'     # → 401
curl -s -X POST .../workorders -H "X-Auth-Token: $INTAKE_TOKEN" # → 401 (INTAKE_TOKEN is /intake only)
```

**4. Staging Worker — a real Buildium email.** In Apps Script, run `testOneEmail` (it posts the most
recent matching message and applies **no** label, so it's safe to re-run). Then confirm on the
**staging** sheet: one new `Work_Orders` row, correct `Property_ID`/`Unit_ID`/`Tenant_ID`,
`Owner_WO_Ref` populated, and no duplicate Property row. Check the Cloudflare log for the
`[STAGING] SMS suppressed` line — that proves no real text was sent.

**5. Regression (worker.js changed — FEATURE_LOG rules 1, 2, 13):** the `getWOFolder` refactor
touches the photo-upload path. On the S23, upload a job photo and a receipt to any WO and confirm
the photo lands in the WO folder and the receipt in `_Internal — Vendor Bills`.

---

## What the July 21 adversarial review changed

The code was reviewed against its own diff before commit. Nine real defects were found and fixed;
each has a regression test (see the `REGRESSION:` sections in `test/intake.test.mjs`):

| # | Defect | Why it mattered |
|---|---|---|
| 1 | Parser preferred `plaintext`; the poller always sends both | The tested HTML path would **never have run in production**, and Gmail's flattened plain body doesn't parse → every email stuck in `needs_review` |
| 2 | Staging didn't isolate QuickBooks | A staging `/qb/*` hit (some are `PUBLIC_PATHS`, so unauthenticated) would rotate + invalidate the **production** refresh token, and `/qb/send-invoice` would create a **real** invoice |
| 3 | `resolveOwner` loose substring match | `"Ridge Co, LLC"` → `"ridge"` matched `"Ridge Estates of Maryland"` → new property bound to the **wrong owner**, i.e. invoicing the wrong customer |
| 4 | Unit-suffix regex had no word boundaries | `1200 Winchester` → `1200 winche` + a phantom `Unit "r"`; truncation was asymmetric so the property matched *itself* as ambiguous and stuck every WO there in review |
| 5 | `contactName` accepted any short line | `"No pets"` / `"Tenant will be home"` became a **created Tenant row** with an auto PIN |
| 6 | Extension-less file links dropped | Buildium's `/api/file/download?id=…` photos silently lost; thumbnails also uploaded twice |
| 7 | No-ref emails could auto-create | With `Intake_Message_ID` not yet in the sheet, such a WO is undedupable → double-create. Now returns `needs_review` |
| 8 | Kill switch was exact-match `'FALSE'` | `false` / `no` / `0` left intake fully enabled |
| 9 | `getAccessToken` re-minted per Sheets call | One intake with photos ran ~55–60 subrequests, over Cloudflare's 50 cap. Now cached per isolate |

Confirmed clean by the same review: the `getWOFolder` refactor is behavior-identical (rule 13
preserved), the auth gate doesn't weaken any existing route, and Sheets + Twilio are correctly
isolated in staging.

---

## Known gaps / risks

0. **Drive is not fully isolated in staging.** There is no staging Drive root, so intake uploads go
   under the live `DRIVE_PROPERTIES_ROOT`. Staging files are prefixed `_STAGING <WO id>` so they're
   obvious and never mix into a customer-facing folder — but they are real files in the real Drive.
   Delete those folders after testing.
0b. **A file with no `Content-Length` bypasses the 45 MB pre-check.** Chunked S3/CloudFront responses
   report no length, so the guard falls through to the post-download `byteLength` check — by which
   point a very large `.MOV` has already been buffered and could OOM the isolate. Per-file errors are
   caught, but an isolate OOM would 500 the request and the poller would retry the thread. Watch for
   this on the first real email with video.
0c. **`addRow` derives the next id from column 0 while writing to the `ID` header column.** Intake is
   the first caller to use that returned id as a foreign key, so confirm on the staging sheet that
   column 0 **is** `ID` on `Properties`, `Units`, and `Tenants` (it is NOT on `Work_Orders` — rule 6).
1. **The parser has never seen a real Buildium email.** All 100 tests run against a synthetic
   message built to the format documented in the build brief. Section labels, the `- 1` unit
   separator, and the S3 link shape are the likeliest things to differ. This is the single biggest
   reason not to merge before step 4 above.
2. **S3 links may not be publicly fetchable** (open item #1 in the build plan — still unverified).
   `ingestFiles` handles it gracefully: a link that returns HTML is skipped with the warning
   "link is not publicly fetchable" and the WO is still created. If that warning shows up on real
   mail, photos need the Buildium API instead.
3. **Files over 45 MB are skipped** with a warning (Worker memory limit). Buildium `.MOV` clips can
   exceed this.
4. **Phases B and C are not built** — manual lists from Mark return `needs_review` and get the
   `RidgeCo/NeedsReview` label. They are not lost, but nothing surfaces them in the Hub yet.
   Remove the label to reprocess after Phase B ships.

---

## Promotion to production

Only after steps 1–5 pass: run the sheet-op against the live sheet, merge `staging` → `main`
(push to main auto-deploys), point the Apps Script `WORKER_URL` at the production Worker, then add
the 5-minute trigger. Confirm no `✅ Working` row in FEATURE_LOG regressed before merging.
