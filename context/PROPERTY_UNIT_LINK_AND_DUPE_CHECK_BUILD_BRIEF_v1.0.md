# Property/Unit Linking Discoverability + Duplicate-Creation Guard — Build Brief v1.0

**Status:** ✅ Shipped Sep 24, 2026, PR #57 merged (`11b7e39751e259b0c059201dd3d9cec9ab963475`),
branch `feature/property-unit-link-and-dupe-check`.

**Origin:** Brett's ask, verbatim (Sep 24, 2026): *"can't find the property and unit link. I think
it might be on a separate page that doesn't have a corresponding link on the hub. Give that to me
in the devlog, but also put it on the owner's properties pages as a click through to the same
tool. And in the button where we add a property to an owner, there should be a stopgap that asks
if we want to link rather than create. And then it could show unlinked properties and units to
avoid creating properties that are already there. Then we should also have a duplicate check. So
if we go ahead and create properties or units for those properties, we check against existing to
make sure we're not creating duplicates."*

"The property and unit link" referred to the existing QB Mapping page/tool, which already existed
but had no cross-links from elsewhere in the app — this was a discoverability gap, not a missing
feature, so the fix adds links rather than a new competing tool.

## What shipped

1. **Discoverability**
   - Dev Log page: new "🔗 QB Mapping — link properties/units to QuickBooks" button under Money &
     QuickBooks.
   - Owners table: new 🔗 button per row that jumps straight into QB Mapping filtered to that
     owner (`goToQBMapping(filterText)`).
   - QB Mapping page itself gained a filter box (`filterQBMapping()`) so the jump-to-owner link has
     something to filter on; existing row-render functions were tagged with `data-qbfilter`
     attributes (owner/property/unit name context, lowercased) to support it.

2. **Link-vs-create stopgap** — the Add Property modal now renders an `#ap-unlinked-section`
   listing the owner's current unlinked (owner-less, active) properties from already-loaded
   `state.properties`, each with a "Link to this owner" button (`linkUnlinkedProperty`) that calls
   `POST /property/update` with the new `Owner_ID` instead of creating a duplicate record.

3. **Duplicate check** — `worker.js`, new helpers inserted before the shared `addRow`:
   - `findSimilarProperties(env, address, city)` — reuses the existing `qbNormAddress` normalizer
     (same one `adminDuplicateProperties` uses) to find active properties with a matching
     normalized address+city.
   - `qbNormUnitLabel(s)` / `findSimilarUnits(env, propertyId, label)` — same idea for units within
     a property, matching on `Unit_Label`.
   - `propertyAddWithDupeCheck` / `unitAddWithDupeCheck` wrap `addRow` for the `/property/add` and
     `/unit/add` dispatch paths only (the shared `addRow` used by Owners/Vendors/Tenants/etc. is
     untouched). Without `force:true` in the body, a match returns **HTTP 409** with an `error`
     message and a `duplicate_of` array of matching record IDs; with `force:true`, creation
     proceeds normally.
   - Frontend: `submitAddProperty(force)` and `addUnitToEditedProperty(force)` handle a 409 by
     rendering a banner with "Link ID X to this owner" / "Create a new one anyway" (re-calls the
     same submit function with `force:true`) — the same soft-block pattern already used by
     `depositApprove`/`qbSetIrBill`, not a native `confirm()` dialog. This repo has a documented
     prior failure with `confirm()` for exactly this kind of decision (an Aug 24 2026 comment on
     `qbSetMap`: it "either went unnoticed or got clicked through without registering what it
     meant") — deliberately not repeated here.

## Verification performed

- `node --check` clean on the full `worker.js`.
- Both large inline `<script>` blocks in `index.html` (index 1, ~637KB; index 2, ~133KB) extracted
  via Python regex and each independently syntax-checked with `node --check` — clean.
- Full `diff -u` against pre-branch content for both files, confirmed only intended lines changed.

## Still Brett's to-do (not agent work)

- Manually fix the QB Mapping click-through for the original 12 units at 931 St Paul St and 1305 N
  Calvert St (flagged before this build, unrelated to it).
- A live smoke-test of the new flow: open Add Property with an existing unowned property present,
  try adding a property/unit that already exists (should get the 409 banner), click the new 🔗
  button on an owner row (should land in QB Mapping filtered correctly).

## What NOT to do

- Don't touch `addRow` itself — it's shared by Owners/Vendors/Tenants/Properties/Units; the
  duplicate check is a wrapper around the two dispatch paths that need it, not a change to the
  shared primitive.
- Don't reach for a native `confirm()` for this class of decision in this codebase — see the
  Aug 24 2026 `qbSetMap` comment referenced above.
