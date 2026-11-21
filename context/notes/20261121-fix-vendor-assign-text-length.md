# 2026-11-21 fix/vendor-assign-text-length

CURRENT: Message_Queue 693 (vendor_job_assigned, WO-1214 to Oscar Padilla, 2026-11-20 21:52Z) failed because the body was over 1600 characters (the WO description is a combined multi-WO checklist). The tenants were told he was assigned but the vendor never got his text. Fix: cap the description in the vendor assignment text at 300 chars (English and Spanish); full text stays in the portal.

FEATURE_LOG rule: Never put an uncapped WO description in an SMS body; Twilio refuses > 1600 characters.

## Pre-build gate
Shape: text template change only. No new sends, no money/QB/auth. Defaults used.

## Silent-failure check
The failure was already caught (status failed, ledger P1 cond|inv:mq_failed). No catch added or touched.

## Late requests
None.
