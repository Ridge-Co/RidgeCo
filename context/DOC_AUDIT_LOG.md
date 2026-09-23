# Documentation Audit Log

Append-only run history for `scripts/doc_audit.py`, run nightly by
`.github/workflows/doc-audit.yml`. Exists so a night the workflow silently doesn't
fire is itself visible — a gap in this file's own run sequence, not just an
invisible missed check. See the workflow file and script for the full mechanism
and its known limitations (it's a keyword-clustering heuristic against
FEATURE_LOG.md, not a certainty check — flagged commits need a real look, never
an auto-filed entry).


## Run: 2026-09-15 16:45 UTC
Since: 2026-09-15 (source: CURRENT.md header (first run — no audit history yet))
Checked commits: 17 (excluding merges/doc-audit itself)
No gaps flagged.

## Run: 2026-09-16 17:26 UTC
Since: 2026-09-15 (source: this script's own last recorded run)
Checked commits: 32 (excluding merges/doc-audit itself)
No gaps flagged.

## Run: 2026-09-17 17:25 UTC
Since: 2026-09-16 (source: this script's own last recorded run)
Checked commits: 232 (excluding merges/doc-audit itself)
**6 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `1da1d33` (2026-09-17 13:52) OPTIMIZER_ROUND_LOG.md: note the v1.1 addendum in the governing header — best single-entry match: 40%
- `c9bf6db` (2026-09-17 00:54) Fix garbled merge in CURRENT.md from the previous patch (dangling duplicate sentence fragment) — best single-entry match: 44%
- `34a4220` (2026-09-17 00:41) Bump BUILD_VERSION for bulk-welcome template consistency fix — best single-entry match: 40%
- `7690c84` (2026-09-16 21:45) Bump BUILD_VERSION to 2026-09-16.4 (deploy marker for the held-WO owner-contact resolution) — best single-entry match: 43%
- `2f4f36a` (2026-09-16 18:45) docs: v1.5 -- document the add_repo cross-tier wall and the standing rule to avoid it — best single-entry match: 38%
- `08c5698` (2026-09-16 18:42) docs: sync CLAUDE.md's private-context load instructions with CREDENTIALS_MAP.md v1.4 (applies PR #5) — best single-entry match: 44%

## Run: 2026-09-18 16:54 UTC
Since: 2026-09-17 (source: this script's own last recorded run)
Checked commits: 93 (excluding merges/doc-audit itself)
**4 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `7b027ba` (2026-09-17 18:18) WO Templates: add hidden tmpl-id + title/save-button ids for edit-mode reuse — best single-entry match: 25%
- `1da1d33` (2026-09-17 13:52) OPTIMIZER_ROUND_LOG.md: note the v1.1 addendum in the governing header — best single-entry match: 40%
- `c9bf6db` (2026-09-17 00:54) Fix garbled merge in CURRENT.md from the previous patch (dangling duplicate sentence fragment) — best single-entry match: 44%
- `34a4220` (2026-09-17 00:41) Bump BUILD_VERSION for bulk-welcome template consistency fix — best single-entry match: 40%

## Run: 2026-09-19 16:11 UTC
Since: 2026-09-18 (source: this script's own last recorded run)
Checked commits: 99 (excluding merges/doc-audit itself)
**4 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `cfc98f0` (2026-09-19 16:05) One-time cleanup: de-identify the duplicate fixture set the ID-comparison bug created — best single-entry match: 38%
- `9d4fb7a` (2026-09-19 13:48) Add HUB_TEST_TOKEN helpers: isTestRecord, hubTestWriteAllowed, seedTestFixtures — best single-entry match: 20%
- `bcfe74f` (2026-09-19 13:46) Declare _viaHubTestToken (outer-scope flag for the new staging test-token gate) — best single-entry match: 43%
- `e87d218` (2026-09-18 20:25) Fix backlog id B-141 -> B-240 in OPS_QUEUE_STATUSES comment — best single-entry match: 33%

## Run: 2026-09-20 16:40 UTC
Since: 2026-09-19 (source: this script's own last recorded run)
Checked commits: 75 (excluding merges/doc-audit itself)
**7 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `98bd310` (2026-09-19 19:00) Fix CHEAP tier: gemini-2.5-flash-lite retired, swap to gemini-3.5-flash-lite — best single-entry match: 38%
- `6e42d51` (2026-09-19 16:54) seedTestFixtures: verify+retry Unit 40 migration marker write — best single-entry match: 43%
- `33546bd` (2026-09-19 16:53) Add ensureMarker: self-verifying/self-healing marker writes for test fixtures — best single-entry match: 29%
- `3be8195` (2026-09-19 16:13) Replace hardcoded per-ID repair/cleanup hacks in seedTestFixtures with a generic dedupeTestFixtures() helper that de-duplicates any TEST- marker set by keeping the lowest ID, so debugging-induced duplicates (Owners 11/12/13 etc) self-heal on every call instead of needing one-off patches — best single-entry match: 39%
- `cfc98f0` (2026-09-19 16:05) One-time cleanup: de-identify the duplicate fixture set the ID-comparison bug created — best single-entry match: 38%
- `9d4fb7a` (2026-09-19 13:48) Add HUB_TEST_TOKEN helpers: isTestRecord, hubTestWriteAllowed, seedTestFixtures — best single-entry match: 20%
- `bcfe74f` (2026-09-19 13:46) Declare _viaHubTestToken (outer-scope flag for the new staging test-token gate) — best single-entry match: 43%

## Run: 2026-09-21 18:26 UTC
Since: 2026-09-20 (source: this script's own last recorded run)
Checked commits: 65 (excluding merges/doc-audit itself)
**5 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `b5631fd` (2026-09-21 01:20) Fix transcription slip: restore trailing newline at end of file — best single-entry match: 43%
- `7fe1c59` (2026-09-21 01:20) Fix transcription slip: bold-marker placement in the 828 S Charles St Verify line — best single-entry match: 43%
- `ba3b4e4` (2026-09-21 00:22) Merge main (PR #17) into PR #14 branch: restore WO_Audit message-audit columns, logWOAuditMany extended shape, and logMessageAudit wrapper — best single-entry match: 42%
- `e1ca3fe` (2026-09-20 22:56) Add collapsed-card badge slot for invoice-submitted confirmation — best single-entry match: 40%
- `a58f7d3` (2026-09-20 20:26) Stop swallowing exceptions in isTestRecord; surface via debug field — best single-entry match: 43%

## Run: 2026-09-22 17:29 UTC
Since: 2026-09-21 (source: this script's own last recorded run)
Checked commits: 60 (excluding merges/doc-audit itself)
**6 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `60b0d57` (2026-09-21 16:51) Allow tenant-role tokens to call /tenant-session-refresh — best single-entry match: 40%
- `495e37e` (2026-09-21 16:51) Add GET /tenant-session-refresh route (session-flag staleness fix) — best single-entry match: 40%
- `7e47df9` (2026-09-21 16:05) Add openSendMessageModal/openWOMessageModal/confirmSendMessage JS for the new messaging feature — best single-entry match: 40%
- `b5631fd` (2026-09-21 01:20) Fix transcription slip: restore trailing newline at end of file — best single-entry match: 43%
- `7fe1c59` (2026-09-21 01:20) Fix transcription slip: bold-marker placement in the 828 S Charles St Verify line — best single-entry match: 43%
- `ba3b4e4` (2026-09-21 00:22) Merge main (PR #17) into PR #14 branch: restore WO_Audit message-audit columns, logWOAuditMany extended shape, and logMessageAudit wrapper — best single-entry match: 42%

## Run: 2026-09-23 17:39 UTC
Since: 2026-09-22 (source: this script's own last recorded run)
Checked commits: 278 (excluding merges/doc-audit itself)
**22 possible gap(s) — needs a human/Claude look, not auto-filed:**
- `bc8746b` (2026-09-23 16:03) Flag unresolved staging-deploy-lag question found while live-testing the new PAT-033 autonomy — best single-entry match: 44%
- `61f4294` (2026-09-23 13:57) openUnitDetail: avoid double-prefixing Unit_Label, mirroring worker.js formatUnitLabel — best single-entry match: 43%
- `bdfcdb0` (2026-09-23 13:56) Add formatUnitLabel helper (avoid double-prefixing Unit_Label) — best single-entry match: 40%
- `f1e8a72` (2026-09-23 01:46) Part 3: pure-logic + wiring tests for refund detection, matching, and the Rung-3 reversal write — reconstructs the real Aug 24 2026 Home Depot return as a fixture and proves detection fires on it — best single-entry match: 42%
- `9e5523e` (2026-09-23 01:42) Part 3: add receiptReconRefundCandidates (read-only match search) and receiptReconRefundReverse (Rung-3 money write — Brett's-tap-only, admin-gated, reuses addReceipt + appendReceiptToInvoiceReview, same convention as scopeProposalAdjustBill) — best single-entry match: 47%
- `241b17d` (2026-09-23 01:41) Part 3 follow-up: keep the same receipt-id dedupe/tracking for a negative (refund-reversal) delta as for a positive one — no sign-conditional branch needed — best single-entry match: 40%
- `a1127db` (2026-09-23 01:40) Part 3: add receiptRefundFindMatches — pure, unit-testable scorer for candidate original-purchase matches against a refund (store/date-window/amount/item-overlap) — best single-entry match: 43%
- `ff67972` (2026-09-23 01:40) Part 3: refund detection in receiptExtract — code-level guard (receiptApplyRefundDetection) forces refund totals negative regardless of OCR sign, fixes the Aug 24 Home Depot return misread — best single-entry match: 47%
- `277f1f2` (2026-09-23 01:32) Bulk actions: JS dispatch (bulkAction/bulkExpense/updateBulkBar) — Part 4 — best single-entry match: 43%
- `256c709` (2026-09-23 01:19) receipt-recon: bump BUILD_VERSION for Parts 1+2 (image-attached indicator + attach-only) — best single-entry match: 43%
- `81edbc6` (2026-09-23 01:12) Part 5: add woDatesLabel/woDateWindowWarning pure helpers + embed in woSelectHTML — best single-entry match: 43%
- `b6feb56` (2026-09-23 00:56) receipt-reconciler UI: render entry-source + rescan banner in rowCard — best single-entry match: 33%
- `54caac0` (2026-09-23 00:44) Add receipt-duplicate-audit/flags to HUB_PROD_RO_READ_PATHS — best single-entry match: 33%
- `4009c9e` (2026-09-23 00:44) Add receipt-duplicate-audit paths to HUB_TEST allow-lists — best single-entry match: 25%
- `6385a8d` (2026-09-23 00:06) Add urgent Part 0: intake-time cross-check against already-processed receipts — best single-entry match: 43%
- `7df2406` (2026-09-22 20:46) Update acceptance criteria and rollout for the two-path allow-list — best single-entry match: 40%
- `f1a34c7` (2026-09-22 20:46) Update Design section 1 with widened allow-list and same-PR addition convention — best single-entry match: 43%
- `8426a48` (2026-09-22 20:45) Update build brief: widened starting allow-list + durable same-PR addition convention (Brett feedback) — best single-entry match: 40%
- `e30b840` (2026-09-22 20:45) Widen HUB_PROD_WRITE_TOKEN allow-list + establish same-PR addition convention — best single-entry match: 43%
- `acbc1e7` (2026-09-22 20:20) wo-combine: add offline tests for resolveCombineFields() and woCombine() — best single-entry match: 40%
- `5fa56b0` (2026-09-22 20:05) wo-combine: add woCombine() + resolveCombineFields() backend logic — best single-entry match: 40%
- `64f9f4b` (2026-09-22 19:48) Reconciler: rowCard uses evidenceHtml wrapper — best single-entry match: 40%
