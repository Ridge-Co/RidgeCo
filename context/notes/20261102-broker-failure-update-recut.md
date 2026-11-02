# Broker may update failure-ledger rows (D-14) - re-cut of #429

Nov 2 2026. #429 went stale/conflicted, so this is the same change re-applied on current main.

- worker.js: `/failure/update` added to `HUB_PROD_WRITE_PATHS` (the gh-broker prod write token allow-list). It routes only to the existing `failUpdate` handler.
- No money, QuickBooks, SMS, login or session path is added; the test checks that.
- BUILD_VERSION is not touched (frozen per branch policy). The old "Bump build version" commit from #429 is dropped.
- test/broker-failure-update.test.mjs: allow-list contains the path, nothing money/auth on it, route still goes to failUpdate.
- Auth-adjacent: Brett's merge call.
