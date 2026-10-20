# Hub for Contractors (Tenant Platform) — Planning Brief v1.0
**Status:** planning only, nothing built. Written Oct 20 2026 from Brett's description + his answers + a read of live `worker.js` / HTML (anonymous clone, main).

## 1. The idea
A new contractor customer (crew + subs; jobs for realtors and other customers) gets his own full Hub: same features, his own data, his own QuickBooks / calendar / email / phone number / AI usage. He can still assign work to Brett like a customer. Brett can see his data (support, read-only) but has no say in his scheduling or assignments. Costs Brett pays for him are billed back at a markup; new features Brett ships reach him automatically.

## 2. Decisions so far (Brett, Oct 20)
- Work he sends Brett: lives in HIS instance; Brett is a vendor in it; the job syncs into Brett's own Hub. (v1 sync can reuse existing email/SMS intake, `INTAKE_TOKEN`; direct API sync later.)
- His data model: customers → properties (access info, contact info: "this customer owns these 3 houses") → jobs → invoices, plus crew/subs. Landlord/unit/tenant modules optional, OFF by default.
- Unknown / not decided: his QuickBooks vs other books, Google vs Outlook, start date. Spitballing.
- Pricing: monthly fee with included allowance, overage at markup. Brett fronts costs, bills monthly. Setup costs (time + cash) mapped in section 6.
- Brett gets read-only "view as tenant", audit-logged, with a terms line. Agreed.
- Branding: tenant's own name/logo/domain (white-label) AND a platform brand separate from Ridge Co. Agreed.
- Launch modules: jobs, scheduling, vendors/crew, estimates/proposals/e-sign, invoicing + QB, SMS, receipts reconciler, AR report. Excluded: STR, trash, BarrelCo, ops queue/Scout.
- AI manager at launch. One tenant for now, so a provisioning CHECKLIST (not automation) is enough.
- Future project (not this one): a better Command Center with more visibility and visual cues; needs examples first.

## 3. Architecture (recommended): one codebase, one deployment per tenant
Same pattern as `maintenance-hub-staging` (own Worker, own Sheet, own variables). Real multi-tenant (tenant_id on every row) and Firebase are deferred until ~3 tenants or a wall.
Per tenant: Worker, Google Sheet, Google Cloud project + service account (own Sheets quota), Twilio subaccount + brand + campaign, QB OAuth connection, calendar/email connection, Anthropic workspace + key, frontend config, Apps Script scheduler rows (one JOBS table with a tenant column; no cron).
Deploys: tenants build from a `release` branch (staging → Brett's Hub → tenants). OPEN TECHNICAL ITEM: how to deploy N Workers with different names from one repo through Workers Builds (per-tenant wrangler config / custom deploy command) — verify before tenant #1.
Brett's access: read-only view-as, logged.

## 4. What the code looks like today (inventory, main @ Oct 20)
Good news:
- `SHEET_ID` is an env var (no hardcoded sheet ID). QB realm/client IDs, Twilio SID/API key/from-number, Anthropic key, Gmail creds, Drive roots are all env — they drop in per tenant.
- ONE Twilio send path: `sendSMSRaw` (worker.js ~14652) behind `sendSMS`, which already honors a `TWILIO_ENABLED` Config kill switch (default OFF). That switch is exactly the "block SMS until brand + campaign approved" gate.
- ONE Anthropic path: `anthropicMessages` (~18441); every call goes through it, and it already has an AI-credit pause/trip mechanism (`aiCreditCheck`/`aiCreditTrip`). `MODEL_REGISTRY` already carries per-1k-token costs and `routeAI` computes `estCost`.
- The Hub already reads Twilio message history, balance and number info (~16232, 17033, 25076, 25110): reconciliation plumbing partly exists.
- `isStaging()` stubs SMS/QB/Gmail: reusable for a tenant "sandbox" mode.
- `ensureColumns` lazily migrates a tenant Sheet to new columns.
Work needed:
- ~55 distinct env bindings. Per-tenant ones need a manifest + a `/health` missing-binding check.
- Worker URL `maintenance-hub.brett-2f8.workers.dev` hardcoded in 48 HTML files (70 occurrences); shared `X-Auth-Token` secret handled in 41 pages. Needs one shared config file. Shared-secret-in-browser is the known Plan B auth gap; per-tenant deployments contain the blast radius but don't fix it.
- Brand/identity strings in worker.js (non-comment lines): "Ridge Co" 89, "Brett" 136, "bmoremanagement" 12. Plus the admin test-phone fallback `+14439617927` in 6 places and `BRETT_PHONE` (~26249). Property/owner names (Milam, Goldszmidt, Phoenix, Kerns) appear in comments/modules; STR/cleaner/trash modules need feature flags.
- `/qb/connect` and `/qb/callback` are reserved but unbuilt: tenant QB onboarding needs them.
- No usage/cost ledger exists. SMS and AI costs are not recorded per call.

## 5. Safe groundwork (additive, no behavior change; branch → staging → tests; Brett's go for main)
1. Tenant config object `getTenant(env)`: defaults to current Ridge Co behavior; first PR replaces the test-phone fallbacks and `BRETT_PHONE`, later PRs the brand strings.
2. Usage ledger tab `Usage_Ledger` (Tenant_ID, Date, Kind, Units, Our_Cost, Billed, Ref). Hook `sendSMSRaw` (Twilio message sid; price reconciled later from the existing Twilio usage reads) and `anthropicMessages` (response `usage` tokens × `MODEL_REGISTRY` cost). Tag "ridgeco". A failed ledger write must log to Ops_Telemetry and surface (no silent failure).
3. Shared frontend `config.js` + codemod of the 48 pages; Playwright smoke on staging first. Higher risk, after 1–2.
4. Per-tenant env manifest + `/health` check.
5. Before building usage billing, vet open-source (Lago, OpenMeter); at this size a ledger tab may be enough (adopt-first).

## 6. Setup cost / time map, per tenant (verify prices before quoting)
- Twilio: brand $4.50 (low-volume standard, needs EIN) or $46 (standard); $15 one-time campaign vetting; campaign from $1.50/month (low-volume mixed) up to ~$10/month; plus number rental and per-message fees (check Twilio price page). ISV guidance: ~13–20 business days (brand 3–5 days, campaign 10–15). One subaccount, brand and campaign per customer; do not send under Brett's brand.
  Lesson from Oct 13–14 rejection of Brett's own new campaign (errors 30907, 30917): the tenant needs a real website/terms page naming his business and an accurate opt-in description. We should host per-tenant `/sms-terms` and `/sms-privacy` pages from the tenant config.
  Needs from the tenant: legal business name, EIN, address, website, contact. Brett's time ~1–2 h.
- Cloudflare: Workers Paid, $5/month minimum for the account (Free is 100,000 requests/day account-wide, 50 subrequests/request, 100 Workers).
- Google: per-tenant GCP project + service account, free. Gmail send and most Calendar scopes are "sensitive": app verification, budget ~10–20 days; testing-mode tokens expire in 7 days; Gmail read scopes also need a security assessment. Alternatives: tenant domain via a sending provider; calendar via iCal feed. If Outlook: Microsoft OAuth instead.
- QuickBooks: Intuit requires the app assessment questionnaire for any app connected to production companies (includes an estimated number of connected users); needs EULA/privacy URLs (repo has `eula.html`, `privacy.html`). Check whether Brett's current Intuit app's assessment covers other companies' books.
- Anthropic: one Console workspace per tenant: own key, monthly spend limit, usage/cost reporting per workspace (max 100 workspaces/org). Near-zero setup cost; the markup is applied against that workspace's reported cost.
- Support load is the real ongoing cost: price it in.

## 7. Phases
0. Groundwork (section 5).
1. Tenant #1 stand-up checklist: Cloudflare Paid; Worker + Sheet + SA; Twilio subaccount/brand/campaign (start as soon as he has a start date); Anthropic workspace; Apps Script rows; frontend config; QB/Google connect; terms + view-as + audit log.
2. Connectors: QB OAuth routes, calendar/email decision.
3. Billing: ledger reports, monthly invoice through Brett's QB, allowance + overage plan.
4. Later: Command Center redesign; provisioning automation at tenant #3; direct instance-to-instance job sync; Firebase only if forced.

## 8. Open items
- His QB / Google vs Outlook (ask him).
- Workers Builds multi-Worker deploy method.
- Intuit assessment coverage.
- Brett's go on groundwork PRs 1–2.
- Pricing numbers (allowance sizes, markup multiples): Brett's call after the ledger gives real costs.

Sources: Twilio ISV onboarding + fee pages; Cloudflare Workers limits; Nango Google verification guide; Intuit app assessment docs (via third-party mirrors); Anthropic Console workspaces docs.
