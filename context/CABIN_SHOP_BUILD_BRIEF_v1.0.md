# Milam Ridge Cabin Shop — Build Brief v1.0 (Oct 6, 2026)

**What:** a very basic, mobile-first order page for barrels / planters / spheres sold at Brett's WV cabin ("Milam Ridge"), reached by a QR code on a sign. Lives under Ridge Co at `https://ridge-co.github.io/RidgeCo/shop/` (QR source tag: `?src=sign`).

**Brett's rules for it:** customers pick product + quantity, give full name (first/last, in order), email, phone, billing address; pick a cash-transfer method (Venmo / Cash App / PayPal / Zelle); no card processing. Prices and photos changeable later. Linked to StockShift inventory. Branding "Milam Ridge" is a placeholder — update later.

## Pieces (two repos, two PRs — Brett merges both)
| Piece | Repo / path | Notes |
|---|---|---|
| Public page | `Ridge-Co/RidgeCo` `shop/index.html`, `shop/img/*.jpg` | static, no build; talks to the BarrelCo Worker |
| API | `brett332/BarrelCo` `worker.js` | `GET /public/shop`, `POST /public/order` (BarrelCo Worker `barrel-co`, NOT the Hub) |
| StockShift link | `brett332/BarrelCo` `index.html` | cabin location `cabin_wv`, product `p_sph` (SPH), cabin prices 95/65/60; cabin counts are Sheet-authoritative |
| Tests | `brett332/BarrelCo` `tests/` | `node tests/shop.test.mjs` (35 Worker checks, fake Sheets), `serve.mjs` + `e2e.mjs` (Playwright mobile+desktop), `stockshift.mjs` |

## Data (BarrelCo Google Sheet — tabs auto-create on first load)
- `Shop_Products`: Id, Name, Price, Description, Photos (comma list: `img/barrel-1.jpg` or https URL), Active, SortOrder, StockProductId, StockCode. **Change a price / hide a product / reorder here — no code.**
- `Shop_Settings`: ShopName, Tagline, **Open** (TRUE/FALSE kill switch), PickupNote, ContactPhone, EnabledMethods, VenmoHandle, CashAppHandle, PayPalHandle, ZelleNumber.
- `Shop_Orders`: OrderId, Token, Timestamp, Status (New / TEST / OVERSOLD — Brett edits to Paid/Picked up/Cancelled), name, email, phone, address, Items, Subtotal, PaymentMethod, MarketingOptIn, Source, **StockStatus** (DONE / PENDING / FAILED / CHECK / OVERSOLD / TEST), Notes.
- Stock = existing `Inventory` tab rows at location `cabin_wv` (venture barrelco): p_ob2 (full-size barrels, SKU OB2), p_op (planters), p_sph (spheres). Seeded 4 / 7 / 4 on first load only; after that edit counts in StockShift.
- Each order decrements Inventory and writes a `sold` row to `History` (note `Web order MR-XXXXXXXX`).

## Behavior
- Server decides price + stock (browser values ignored; page sends `expectedTotal` so a stale price gets a 409 and a refresh).
- Idempotent per order token (retry never double-orders). Max 10 units/order, 12 orders/hour global breaker, honeypot, Origin allow-list (`ridge-co.github.io`; `SHOP_ALLOWED_ORIGINS` env adds more; `SHOP_ALLOW_LOCALHOST=1` is test-only).
- Test order: first name `TEST`, last name `ORDER` → recorded as Status TEST, no stock change.
- Stock is taken at order time (reserved) — **cancelling an order means manually adding the stock back in StockShift.**
- Never silent: every Sheets call status-checked; failures → Debug tab (app `shop`) + StockStatus flag + visible message; page shows errors/retry; StockShift now toasts sync failures. `/debug` clear refuses app `shop`.
- Pre-existing fixes made along the way: `appendRow`/`writeInventory` now throw on Sheets errors (were silent); `getSheetToken` throws on failure; `deleteRow` used hard-coded sheetId 0 (deleted from the wrong tab) — now looks up the tab id and checks the result.

## Known limits / follow-ups (told to Brett)
1. **No push alert on a new order** — Brett reads `Shop_Orders` (or asks Claude). Best follow-up: SMS/email on every order and any non-DONE StockStatus.
2. Last-unit race: two simultaneous buyers can both pass the first stock check; the decrement re-checks and marks the loser OVERSOLD (customer sees "just grabbed") — but absolute-count writes in StockShift vs. web orders can still drift by 1 if edited at the same instant.
3. No CAPTCHA; a determined bot could reserve stock (capped by the hourly breaker). Follow-up: Cloudflare Turnstile.
4. Pre-existing, not changed: `/ai`, `/inventory` POST, `/history` POST, `/debug` GET are unauthenticated on `barrel-co`.
5. Photos live in the repo (`shop/img`); the Drive tool cannot create anyone-with-link shares. Adding photos later = Claude commits them + adds the path to `Shop_Products.Photos`.
6. Copy (descriptions, pickup note, tagline) is a draft.
