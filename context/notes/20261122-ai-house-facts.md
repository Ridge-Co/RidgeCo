# AI house facts + cache test (queue #151, Phase 1) — Nov 22, 2026

Row #151: give the #89 prompt-cache plumbing its first real large-prefix caller. Phase 1 only: build the shared text and an admin test that proves whether the cache hits. No live job uses it yet.

## What changed
- worker.js: `aiHouseFactsText` (pure, sorted, byte-stable), `aiHouseFactsHits` (refuses phone, email, access code, dollar sign, rate/markup words), `aiHouseFacts` (reads Properties, Units, Vendors, optional `AI_House_Policy`; memoised 10 min), `aiHouseFactsSafe` (never throws; logs `ai_house_facts` telemetry), `aiCacheTest`, route `POST /admin/ai-cache-test` (admin routes).
- index.html: Tools & Log tile "AI Cache Test" in Checks & diagnostics, with `runAiCacheTest()` (loading, error with Try again, paused states).
- Tests: `test/ai-house-facts.test.mjs` (new), `test/devlog-tools.test.mjs` (tile map).

## Pre-build gate
- Q1 Does the brief name every file and acceptance check? Y.
- Q2 Any vendor, tenant or owner page touched? N (admin Tools page only).
- Q3 Any money, send or schedule path changed? N. The test makes two tiny AI calls on tap and only when the credit guard is not paused.
- Q4 Anything silent on failure? N. Builder failure logs telemetry and shows on screen; the test shows the reason.
- N1 Phase 2 and Phase 3 callers not built (by design).
- N2 `test/route-ai-prompt-cache.test.mjs` not extended; the new test covers the caller side.
- N3 Each test run writes two `ai_cache_test` telemetry rows (routeAI logs one per call).
- N4 The real provider cache hit is unproven until Brett taps the tile once. Anthropic's cache needs the prefix at the 4096-character minimum; a small house may report "no cache hit" with the reason.

## Late requests
None.
