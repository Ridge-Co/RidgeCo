# Queue #233: Sheets quota spenders in the morning digest (smallest version, steps 1-5)

## Pre-build gate
- Risk: SAFE. Admin/digest only. No vendor, tenant, owner or customer page touched. No Sheets writes or reads added (Durable Object only).
- Smallest phase: store tally + `/read-meter/daily` route + one digest line + a fault line. The read-meter.html "Yesterday" button (step 7) is NOT built.
- No cron: the existing digest delivery (Hub scheduler) calls it; nothing new is scheduled.
- Nothing fails silently: a fold error answers `fold error: ...`; an unreadable store files `quota_digest_read` (P2) and the digest says "could not read yesterday's meter".

## What changed
- ReadMeterStore folds each saved minute into a per-Eastern-day record (`d:<tag>:<date>`), counting each minute once even when payloads overlap (marker `f:<tag>:<id>`). The in-progress minute is never counted. Records older than 8 days are pruned.
- `GET /read-meter/daily?date=` (default yesterday ET) -> reads, refusals, busy minutes, peak minute, top sources and tabs (caller ids and names scrubbed to path shapes).
- Digest: one warning line under SYSTEM HEALTH only when yesterday had refusals or at least N busy minutes (Config `quota_digest_min_busy_minutes`, default 5).

## Defaults taken
- Busy minute = 40+ reads in a minute; keep 8 days; threshold 5 busy minutes.

## Tested
- test/quota-digest.test.mjs (24 checks) and the full test suite pass locally. Not tested against live Sheets or the deployed Worker.
