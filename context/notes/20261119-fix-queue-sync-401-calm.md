# 2026-11-19 queue_sync: GitHub 401 is a calm P2, not a failing job

CURRENT: Since Nov 18 18:32Z the Hub's GITHUB_READ_TOKEN gets HTTP 401 from GitHub (revoked/expired). queue_sync then failed every tick (P0 F-1795027659213-1oyy, overdue P0 F-c1795030305235-0). Fix: opsQueueSync now treats 401 like 403/429 (rate_limited bucket, one calm P2 `queue_sync_github_blocked` row). The token itself is a secret and needs Brett (inbox card D-21).

FEATURE_LOG: queue_sync never goes red for a refused GitHub read; the refusal is one P2 row that names the token. Test: test/queue-sync-github-403.test.mjs (5b).

Silent-failure check: the refusal is still filed (P2 row) and returned in rate_limited; other GitHub errors stay loud job errors.
