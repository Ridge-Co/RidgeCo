# Quota-calm: Sheets read-quota errors reach the calm P2 path everywhere (Oct 29, 2026)
Build 2026-10-29.01-quota-calm. Branch fix/quota-calm-oct29. Queue items 215, 216, 222. (Proposed FEATURE_LOG rule 236; renumber at merge if it collides.) Risk class: SAFE (telemetry/classification only; no money, PII, auth, schema or customer-facing text).

## Trigger
PR #421 made Google's shared per-minute Sheets READ quota a calm P2 `sheets_quota_busy` row. Four paths still filed the same event as a P0/P1 failure and paged or cluttered Needs Attention:
1. `inspGuardFailure` wrote the cleaning-coverage guard's quota hit as `insp_booking`; the text "Quota exceeded" made it P1.
2. `ensureColumns` (the header check, a plain read) always wrote `ensure_columns_failed` (P1).
3. `sheetsQuotaBusyError` is anchored on "Sheets API error on GET", so `schedErrorsAreQuotaBusy` missed a quota error nested in a job's error text (`ok:false [{"stage":"deposit_sweep_read","error":"Sheets API error on GET ..."}]`) and `strSystemAlert` missed one behind a label ("Held cleaner texts could not be processed: ..."). Both stayed P0 / P1.
4. `processDepositPaidSweep` logged its own P1 `deposit_sweep_read` row for the same quota stop.

## Rules (do not break)
1. A Sheets quota hit on a READ is `Job_Type: sheets_quota_busy` (P2) everywhere. A quota error on a WRITE (`on POST`), or anything not provably the read quota, keeps its old loud row.
2. `sheetsQuotaBusyText(text)`: true for the raw message, for `"<label>: Sheets API error on GET ..."` (plain label, at most 150 characters, no JSON characters), or when EVERY `"error":"..."` value in a closed JSON-looking list is a read-quota error. One real error, one write-quota error, an unreadable value (`{...}`, `null`), or a second Sheets error in the same label means NOT busy.
3. The scheduler cuts job error text at 300 characters. A text that does not close (does not end in a closing bracket) is never assumed busy on its own. `schedStep` therefore decides on the STRUCTURED result (`schedBodyIsQuotaBusy`: every errors[] entry is a read-quota error, and no `not_found`, no `failed`, no HTTP error) and stamps the entry `quota_busy: true`, or `quota_busy: false` when the text looks busy but the result had something else wrong. `schedErrorsAreQuotaBusy` honours the stamp either way.
4. `inspGuardFailure`: quota -> `sheets_quota_busy` row (same endpoint name), the 45-minute persistent alert (SMS + email via `inspAlert`) is UNCHANGED. A bookings-feed outage keeps `insp_booking`.
5. `ensureColumns`: a read-quota failure files `sheets_quota_busy` (endpoint `ensure_columns/<tab>`) and still THROWS. Guarded with `typeof` so tests that slice the function out keep the old row.
6. `processDepositPaidSweep`: on a read-quota failure of its first reads it returns `{ok:false, quota_busy:true, reason, errors:[]}` and files ONE `sheets_quota_busy` row, no `deposit_sweep_read` row. No `errors[]` entry means the Who To Pay banner stays quiet; `schedBadness` hands the scheduler the raw Sheets text. If the P2 row itself cannot be written, that failure goes in `errors[]` (loud, not busy). Every non-quota read failure is unchanged.
7. NOT changed on purpose: deposit classification, the `not_found` surface and the scope-11 behaviour (a separate decision is pending with Brett), the Config read at the top of the sweep (`deposit_sweep_config`), the qb-sync slice's `sweep_done` bookkeeping.

## Tests
New `test/quota-calm.test.mjs` (61 assertions): anchored, nested, `N error(s)` form, mixed (quota + real in either order, quota read + quota write, across entries), cut-off at 300, unreadable values, escaped quotes, scope-11 `not_found` text, labelled held-texts alert, the real `schedStep` plumbing with a production-length Google message, `inspGuardFailure` at 0 / 20 / 46 minutes plus real and feed controls, `ensureColumns` quota vs non-quota vs write-quota vs telemetry tab vs sliced-without-helper. Extended `test/deposit-paid-who-to-pay.test.mjs` (+12 assertions): sweep read quota, non-quota control, write-quota control, telemetry failing too, happy path, money code untouched. Each case compares against the real failure ledger classifier (`failSeverity`).

## Known limits
Other jobs' own `logAndCollectError` rows keep their own Job_Type (only the deposit sweep read was routed). A quota stop of the sweep's Config read still files `deposit_sweep_config` (P1). A quota-busy page-open sweep shows nothing on Who To Pay; the scheduler retries it.
