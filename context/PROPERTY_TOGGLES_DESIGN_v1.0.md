# Properties page: per-property toggles, customer apply, duplicate/merge, detail tabs, proposal SMS-hold warning

Design note v1.0 (Oct 24 2026), written BEFORE coding. Feeds FEATURE_LOG rule 231. Status: PR open, NOT merged (Brett's call).

## 1. What is in the data (Customer vs Owner)

- Customer = a row in `Owners`. `Properties.Owner_ID` points at it. `Owners.SMS_Enabled` is today's "Customer OFF" gate. That is what "apply to all of this customer's properties" keys on.
- Owner (the person) = the contact fields on that same Owners row, plus any extra logins in `Owner_Users` (`Owner_ID` -> Owners.ID). `Owner_Users` has NO SMS switch of its own. Owner texts go to the Owners row phone.
- Not unified in the data: Goldszmidt is two Owners rows (IDs 3 and 19, same Company), Phoenix has Amanda Ireland (1) plus an inactive Mark Passerelli (18). "Customer" is therefore per Owners row, not per Company name. The apply panel lists exactly the properties whose `Owner_ID` equals the chosen row and says so. Grouping sibling rows by Company is NOT built (question for Brett).
- No existing UI edited any SMS switch (they were sheet-only).

## 2. Switches (one registry, `PROPERTY_TOGGLES`)

| key | column | blank means | wired into |
|---|---|---|---|
| Active | `Active` | ON | list visibility (existing) |
| Tenant WO submission | `Tenant_WO_Toggle` | OFF (existing rule, unchanged) | `resolveTenantWOAccess` (existing) |
| SMS master | `SMS_Enabled` | ON | tenant + owner gates (existing, unchanged) |
| Texts to tenants | `SMS_Tenants_Enabled` (new) | ON | `smsGateDecision` tenant branch -> "Property tenant texts OFF" |
| Texts to owner | `SMS_Owners_Enabled` (new) | ON | owner branch -> "Property owner texts OFF" |
| Texts to vendors | `SMS_Vendors_Enabled` (new) | ON | vendor branch -> "Property vendor texts OFF" |
| Owner emails | `Owner_Email_Enabled` (new) | ON | `addonEmailGate` (the only automatic property-aware owner email) |

The brief's `ownerEmailAllowed` does not exist in code; its job is done by `addonEmailGate`. Its existing outcomes (Global/Property master/Customer/Notify none/Test Mode) are unchanged; the new switch is checked after them.

New gate flags default to ON when absent (`=== false` test), so every existing caller and test keeps its exact result. Every `smsGateDecision` call site spreads `smsPropertyGateFlags(property)`; a test fails if one does not.

Vendor texts: today vendor sends do not nest under Property and most call sites do not pass the property. `smsGatedSend` now resolves the property from `opts.property`, else `opts.property_id`, else the work order's `Property_ID`. If that lookup fails it is reported (P2) and the text goes out (fails open, visibly). The resolved property is stored on the Message_Queue row so a held text is re-checked correctly at release. Vendor texts with no work order and no property (e.g. PIN texts) are never affected.

## 3. Customer "apply to all, with exclusions"

Explicit write, never live inheritance. Preview (`POST /owner/property-toggle-preview`) lists every property of the customer with before/after; excluded and inactive properties are marked and skipped; a blank cell that already means ON is shown "unchanged" and not rewritten. Apply (`/owner/property-toggle-apply`) needs the preview token (hash of the exact plan). If the data moved between preview and confirm it refuses and asks for a new preview. It writes the per-property column with read-back (`updateRowVerified`) and returns per-property results; any failure is shown and reported. Re-running is safe (idempotent). Only registry switches marked `applyAll` can be applied; Active and Tenant WO are not bulk-applied.

## 4. Duplicate and merge

- Mark as duplicate: `Duplicate_Of` = other property id, `Duplicate_Marked_Date`, `Active` FALSE. Nothing deleted, nothing re-pointed. "Restore" clears them. Hidden from normal lists and pickers, shown in a "Duplicates" filter.
- Merge: field rule = both non-empty and different -> Brett picks (side by side); one empty -> take the non-empty with no prompt; same value (ignoring case/spaces) -> nothing. `Owner_ID` or `QBO_Customer_ID` different on both sides is a hard block, not a pick.
- Every reference is re-pointed from a registry (`PROPERTY_REF_REGISTRY`, 26 columns incl. comma-list columns) found by header on the live sheet, including inactive rows (the old admin merge skipped them and missed Key_History, Message_Queue, Scopes, WO_Followups, Master_Keys, etc.). A column that looks like a property reference but is not in the registry or the ignore list BLOCKS the merge ("unknown reference, cannot move it safely"). Per-tab counts shown before confirm.
- Apply re-scans, checks the token, writes target fields, re-points tab by tab, then re-reads every tab and counts leftovers. Any leftover or write failure is reported (P1) and returned as a visible failure; the source stays as it was marked only after all moves verify. Never deletes. Source becomes Active FALSE, `Duplicate_Of` = target, `Merge_Log` note.
- Blocks: same Unit_Label on both properties (would create a twin unit), source already a duplicate/merged, target is a duplicate, self-merge.
- ID 93 vs 94: 93 has no owner and no work orders, so merge preview shows Owner auto-keeps 94's, address W/West is the one pick, zero rows to move. NOT executed.
- The old `/admin/merge-property` (incomplete reference list) is left untouched; flagged in BACKLOG.

## 5. Detail view

Tabs: Settings, Info, Units, Cleanup. One lazy endpoint `GET /property/detail?id=` (reads Properties, Owners, Units, Tenants via `fetchTabs`, i.e. cached/coalesced) fetched only when a property is opened; the list uses data already in `hub-bootstrap` (no extra reads). Info tab groups every Properties column (key/lockbox/door codes in an "Access (sensitive)" group, hidden until tapped, endpoint is admin-only like the rest of the Hub; vendor-facing endpoints untouched). Units tab: per-unit fields incl. new `HVAC_Filter_Size` and `HVAC_Change_Interval` columns on `Units` (ensureColumns on first save). Deep link `?property=ID&tab=settings`.

## 6. Proposal screen + Message Queue

`GET /sms/gate-preview` (admin, read-only) runs `smsGatePreview` -> the same `smsGateDecision` + same flags as the real sender, plus phone, quiet-hours and Test Mode. Proposal screen asks it before send and shows "Text will NOT send: ..." with a link to the property's Settings tab, and after send shows sent/held and why. Quiet-hours override unchanged (Manual Send in the Message Queue still skips quiet hours). Message Queue pending rows link to the property Settings tab when the held reason is a property/customer switch.

## 7. Edge cases checked at design time

1. Property row has no new columns yet -> all ON, nothing flips. 2. Column exists but cell blank -> ON. 3. `true`/`False`/spaces -> case-insensitive, trimmed. 4. Master OFF + sub-switch ON -> still blocked (master is a superset). 5. Master ON + sub-switch OFF -> only that audience blocked. 6. Vendor text with no property -> unchanged. 7. New properties are created `SMS_Enabled FALSE` on purpose; new columns blank. 8. Customer apply with all excluded / zero properties / inactive properties / excluded id that is not theirs -> refused or skipped with message. 9. Apply after data changed since preview -> refused. 10. Partial write failure -> per-property result, reported, re-runnable. 11. Merge: source = target, chained duplicates, empty both, W/West address, unit twins, comma-list ids (`1,93,5` -> `1,94,5`, no duplicate ids), Property_Address denormalized text, inactive rows, unknown reference column. 12. Staging: new writes only on TEST- records (`hubTestWriteAllowed`). 13. 100+ properties: list uses bootstrap; detail loads one property. 14. 44px targets, inputs >= 16px, 412px wide.

Silent-failure check: see PR body (fault-injection tests force a failing Sheets write on toggle, apply, merge, and a failing property lookup in the vendor gate).
