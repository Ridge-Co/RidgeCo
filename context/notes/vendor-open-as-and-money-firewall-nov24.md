# Open as vendor + portal money firewall (Nov 24 2026)

Brett's asks, same message: (1) a way to open any vendor's portal as them, no PIN, so he can show a vendor
(Oscar first) exactly where things go; (2) "no possibility of sharing markup information with anyone. Ever" and
make it part of every build so the build fails otherwise.

## Open as vendor
- Hub > Vendors: orange **👁 Open as** button on every active vendor. Hub > work order (with a vendor): **👁 See as vendor** opens that job.
- Worker `POST /admin/vendor-view-session {vendor_id}` — real admin secret only (staging test token on staging). Mints an
  ordinary vendor-role session (`av:1`, 4 hours). Same allow-list and money stripping as the vendor's own PIN login.
  No PIN read/shown/sent; no lockout row; never stamps First_Login / Login_Evidence (`callerAdminView`).
- vendor.html takes it from `#av=` (hash never reaches a server, wiped on arrival), keeps it in sessionStorage for that
  tab only, never writes the vendor's real `mh_vendor_sess` key, shows an orange ADMIN VIEW bar with Exit.
- Anything saved in that view is saved as the vendor (the bar says so).
- Tests: `test/vendor-admin-view.test.mjs`.

## Portal money firewall
- `firewallPortalMoney` wraps the Worker's front door: every JSON response to a vendor/tenant/owner session or
  `/wo/shared*` is deep-scrubbed by audience (MARKUP for all; PRICE for vendor/tenant/shared; VENDOR_COST for owner/tenant).
- Any removal files a P1 `portal_money_firewall` failure with the endpoint and field paths: that endpoint must be fixed at source.
- Fails closed (500) if a body can't be checked.
- Build gate: `test/portal-money-firewall.test.mjs` (wiring, patterns, deep scrub, portal pages never read forbidden fields,
  enrichWO still strips). Runs in Unit tests on every PR/push. CLAUDE.md rule added.
