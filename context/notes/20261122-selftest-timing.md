# Selftest timing is self-explaining — Nov 22 2026 — queue #271 — PR into main (number in the PR title "queue #271"), head `fix/selftest-timing-notes-q271` (cut from main tip 02f94e7), merged: no

## Pre-build gate
Shapes: `job` `write` (one telemetry row's wording). Nobody to ask (scheduled run); every item took its default.
Items that are N (known gaps):
- Digest email line: N. The brief called it optional; the digest and Selftest_Results row are unchanged on purpose.
- BUILD_VERSION bump and FEATURE_LOG edit: N. Overridden by BRANCH_POLICY / notes README (BUILD_VERSION is frozen, FEATURE_LOG is not edited); the FEATURE_LOG text is below.
- B9 who hears about it: n/a. Nothing is sent; same telemetry row as before.
Defaults taken: C2 no cron (no schedule change); C3 silent-failure line in the PR; C4 n/a (no new write); C9 SAFE (telemetry wording only).
Companion actions included: none needed (no screen, no message, no new data).

## Late requests
None yet.

## CURRENT
Built: `selftestTelemetryNotes` (pure) plus a slice counter in `selftestRunSlice` (`prog.slices`). The daily `selftest` Ops_Telemetry Notes now read
`39/39 passed, trigger=cron; 3 slices; last slice 20.4s; checks total 41.2s; slowest: a 3.1s, b 2.9s, c 2.7s; paced 2.5s between Sheets reads (by design)`.
`Latency_ms` still means the last slice. The "failing: ..." text stays first; extras are dropped first to stay under 300 characters. Manual `POST /selftest` keeps the old short form.

Production check (read-only, today's `selftest_progress`, Nov 22): 39 checks. About 16 checks sit at 2.4-2.7 s each = the 2.5 s pacing between Sheets reads. Real outliers: `qb_payables` 11.9 s (a QuickBooks call through the Worker), `health` 7.5 s (first call, cold), `deliveries` 5.0 s.
Verdict: **paced by design**; `qb_payables` (11.9 s) and `deliveries` (5.0 s) are the only checks over 5 s. A build run cannot create a queue row, so the suggested follow-up is: "look at why /qb/payables takes ~12 s".

## FEATURE_LOG
**[FL-20261122-selftest-timing]** The ~20 s on the daily selftest telemetry row is expected: it is the LAST slice (not the whole run), and about 8 paced Sheets reads at CRON_READ_GAP_MS 2.5 s make 20 s on their own. Never reduce the pacing, run checks in parallel or mock the endpoint calls to "fix" it. The Notes now carry slices / last slice / checks total / slowest three. Tests: `test/selftest-slice.test.mjs`.
