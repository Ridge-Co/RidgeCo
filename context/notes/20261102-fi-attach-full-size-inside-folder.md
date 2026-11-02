# FIELD INSPECTION: "FULL SIZE" FOLDER MAY ALSO SIT INSIDE THE INSPECTION FOLDER — Nov 2, 2026 — head `feat/fi-attach-full-size-inside-folder`, merged: no
## CURRENT
🟡 Small follow-up to #484. Brett put 931 Saint Paul St's "Full size" folder INSIDE the inspection folder (the other ten sit beside it, under the property folder). `fiBridgeContext` now looks for a folder named "Full size" (any case/spaces) both under the property folder and inside the inspection folder, de-duplicated. Still additive only; same route, same allow-list entry, no new write path. Tests: `test/fi-attach-drive-originals.test.mjs` 53/53 (3 new).
## FEATURE_LOG
**[FL-20261102-fi-attach-full-size-inside-folder]** A "Full size" folder is accepted beside OR inside the inspection folder; nothing else about what the bridge can read or attach changed. Silent-failure check: unchanged from #484 (listing errors are thrown, nothing skipped quietly).
