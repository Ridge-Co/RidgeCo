# Second Sheets identity (Nov 2 2026)

**Why:** Google allows 60 Sheets reads/minute per user. The whole Hub signs in as ONE service account, so busy minutes hit 429s. A second service account doubles the read budget.

**What it does**
- Secret `GOOGLE_SA2_JSON` (Cloudflare, prod Worker `maintenance-hub`, type Secret). Paste the WHOLE key file Google downloads (the `{ ... }` JSON). A key-only paste also works if `GOOGLE_SA2_EMAIL` is set.
- Sheets READS (GET) alternate between the main and second account. A 429 retry switches to the other account. WRITES always use the main account. The second account signs in with the read-only scope.
- Any failure of the second account (bad paste, Google refuses the key, Sheet not shared with it, 401/403/404) falls back to the main account, backs the second off for 10 minutes, and is reported ONCE via reportFailure (where `sheets_second_account`, P2) in plain words. Reads never break because of it. With the secret unset nothing changes.
- Same email as the main account is refused (it would add no quota).

**Verify:** `GET /sheets-identities` (read-only token allowed) shows both accounts: sign-in, can-read-the-Sheet, key format, and a plain-words `problem` if any. Never prints a secret.

**Setup reminder:** the Google Sheet must be shared (Viewer is enough) with the second service account's email.

**Tests:** test/second-sheets-identity.test.mjs (37 checks).

**Not touched:** BUILD_VERSION (#411 guard).
