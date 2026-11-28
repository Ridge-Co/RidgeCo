# Queue #140 slice: WO status helpers (label / color / isOpen / isActive / isClosed / canTransition)

**Status (Nov 27 2026):** PR open for Brett. 2 of 3 call sites moved (tenant labels, WO-page chip colour). Zero behaviour change by design: golden tests copy the old literals.

**Left (not built):** owner.html `STA` sort-order map is still hand-written (its numbers do not match `WOStatus.order`; Estimate Requested is 0.5), so a `rank()` helper would need a tweak; the brief said skip it then. No call site uses `isOpen/isActive/isClosed/canTransition` yet (additive only). `Pending Payment` / `Paid by Customer` labels wait for the QuickBooks webhook work.

**Needs a human:** merge; on the S23 open a tenant WO list and a shared WO page and check labels and chip colours look the same as before.

## Pre-build gate
Shapes: `ui` (text and chip colour only). No record, list, endpoint, message, money or job shape: no Sheet, route, text or QuickBooks path is touched.

Items that are N (known gaps):
- B26 Spanish: N. The labels were English-only before and still are; wo.html still passes the status through its existing `t()`.
- B27 Where else will he look: N. Pure refactor; owner.html order map left as is (see Left).
- B20 Voice dictation / B32 states / B33 phone: not applicable, no new control or screen; ui-check run on both pages anyway.

Defaults taken: C3 no new catch blocks; C6 no money fields; C9 SAFE (additive pure functions + label/colour text); C11 blank/unknown input returns what the old code returned (`|| wo.Status`, grey `#6b7280`); C12 no data change; C17 no columns.

Companion actions included: golden tests pinned to the old literals (every known, legacy, reserved and Estimate Requested status); advisory-only `canTransition` with a test that no worker.js call site uses it; tenant-never-sees-billing-words test; the module still byte-mirrored into worker.js.

## Late requests
None yet.

## FEATURE_LOG
**[FL-20261127-q140-wo-status-helpers]** `WOStatus.label(status, role)`, `.color`, `.isOpen/.isActive/.isClosed`, `.canTransition` added inside the mirrored block. Rules: (1) keep LABEL_TENANT / COLOR / NEXT as objects, never arrays of status names (ssot check #2). (2) `canTransition` is advisory; enforcing it would change write behaviour and is GATED. (3) Tenant label output is pinned by `test/wo-status-helpers.test.mjs`; changing a label means changing that golden table on purpose. Tests: `test/wo-status-helpers.test.mjs`.
