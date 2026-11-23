# Queue #166: Same-area job batching at Schedule and Assign (Nov 23 2026)

Status: built on branch `queue-166-nearby-at-schedule`. Schedule and Assign windows show a strip "N other open jobs nearby" (job, address, trade, vendor, date; tap opens the job). `/nearby-wos` now also returns other open jobs at the SAME property (`same_property`), falls back to map distance (`nearby_radius_km`, default 2.5) when the property has no area tag, and returns `no_location` when it has neither. Read-only; nothing is moved or changed.

## Pre-build gate
Shapes: `ui` `list` `endpoint`. Nobody was available to ask (scheduled run); every item took its default or the safer option.

Items that are N (known gaps):
- Vendor portal "Same building" label (Spanish "Mismo edificio"): N. Same-building jobs now arrive in the vendor's existing nearby list, but with no new label; `vendor.html` and `vendor-i18n.js` are untouched (customer-facing page, so left for Brett's look).
- Hub work-order detail panel (`loadHubNearbyWOs`) and "Bundling opportunities": N. They receive the new same-building rows through the endpoint but show no "Same building" badge and still swallow a failed lookup.
- Settings screen for `nearby_radius_km`: N. It is a Config key (default 2.5); no editor.
- Tapping a row only opens the job; no "bundle these" action (brief: information only).
- Staging check with TEST- rows: not run by this scheduled session (see PR body).

Defaults taken: radius 2.5 km (same as `clusterSuggestions`); list shows 5 rows then "+N more"; a bad radius value falls back to 2.5; `Vendors` tab is read through the same cached `fetchTabs` call for vendor names.

Companion actions included: loading, empty, no-location and error (with Retry) states; stale-response guard so a reopened window never shows another job's list; failure is logged through `logError`; vendor filter unchanged so a vendor never receives another vendor's job (tested).

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261123-nearby-at-schedule]** Same-area batching at scheduling. Regression rules:
1. `haversineKm` is module-level (was nested in `clusterSuggestions`); keep one copy.
2. `/nearby-wos` always includes same-property open jobs first; the vendor filter applies to them too.
3. A property with no tag but coordinates matches by distance within `nearby_radius_km`; neither returns `message: 'no_location'`.
4. The strip opens with one `/nearby-wos` call per window opening and shows Retry on failure, never a blank.
Tests: `test/nearby-wos.test.mjs`.
