# Quiet phone network drops in the browser Error log — 2026-11-06 — PR into main, head `fix/quiet-network-drop-log` (cut from main tip 6f05881e), merged: pending
## CURRENT
index.html only. A "Failed to fetch" / "Load failed" / "Request timed out" on /hub-bootstrap (weak signal, Chrome waking, wifi/cell handoff) no longer writes an Error log entry when the per-tab fallback then loads data. The drop is COUNTED in localStorage `mh_net_drops` {count,last}, not hidden. A total outage (all 8 fallback loads fail) logs ONE entry plus the existing toast and Retry banner. Real errors (HTTP 500, bad response, Not array) still log as before.
New test test/network-drop-quiet-log.test.mjs (13 pass); fix-check 237 pass; inline script syntax OK. Frontend only, so staging Worker is not involved (GitHub Pages serves the same file for ?api=staging); not verified in a live browser.
Silent-failure check: network drops are counted and a full outage is logged + toasted; no swallowing catch added (the counter's catch only guards localStorage, and the load continues via the fallback).
## FEATURE_LOG
**[FL-20261106-quiet-network-drop-log]** Browser Error log ignores recovered phone network drops (count in mh_net_drops); logs once on total outage; HTTP/real errors still logged. Do not revert to logging every "Failed to fetch". Test: network-drop-quiet-log.test.mjs.
