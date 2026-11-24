// PORTAL MONEY FIREWALL — build gate (Nov 24 2026).
// Brett: "no possibility of sharing markup information with anyone. Ever. ... Make that a part of every single build.
// You check for that, you make sure it doesn't happen, or else the build fails."
// This file runs in the Unit tests workflow on every PR and every push to main, so any of these makes the build red:
//   1. the response-level firewall is removed from the Worker's front door, or reordered so a response skips it
//   2. the firewall stops removing a markup / customer-price / vendor-cost field for the audience that must not see it
//   3. a vendor, tenant, owner or shared-link page starts reading a field its audience must never see
//   4. enrichWO stops returning through stripExternalMoney (the first wall)
// It runs the REAL functions extracted from worker.js, so it cannot drift from what ships.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
function grabLine(sig) { const s = src.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig); return src.slice(s, src.indexOf('\n', s)); }
function grabFn(sig) {
  const s = src.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', src.indexOf(')', s));
  let d = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } }
  return src.slice(s, i + 1);
}
const { portalMoneyKeyForbidden, scrubPortalMoney } = new Function([
  grabLine('const PORTAL_MARKUP_KEYS'), grabLine('const PORTAL_PRICE_KEYS ='), grabLine('const PORTAL_PRICE_KEYS_PASCAL'), grabLine('const PORTAL_VENDOR_COST_KEYS'),
  grabFn('function portalMoneyKeyForbidden('), grabFn('function scrubPortalMoneyDeep('), grabFn('function scrubPortalMoney('),
].join('\n') + '\nreturn { portalMoneyKeyForbidden, scrubPortalMoney };')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m); };

// ── 1. wired into the front door, after every other handler ─────────────────────────────────────────────────────
{
  const front = src.slice(src.indexOf('export default {'), src.indexOf('export default {') + 900);
  ok(/const res = await firewallPortalMoney\(request, env, ctx, await scrubResponseForProdReadToken\(request, env, await _hubWorkerCore\.fetch\(request, env, ctx\)\)\);/.test(front),
    'every Worker response passes through firewallPortalMoney at the front door');
  ok((src.match(/^export default \{/gm) || []).length === 1, 'there is exactly one front door (no second export that skips the firewall)');
  const fw = grabFn('async function firewallPortalMoney(');
  ok(/status: 500/.test(fw) && /could not be loaded safely/.test(fw), 'fails CLOSED: an unreadable body becomes an error, never an unchecked body');
  ok(/reportFailure\(env, \{[^}]*where: 'portal_money_firewall'[^}]*severity: 'P1'/.test(fw), 'anything it has to remove is filed as a P1 failure naming the endpoint');
  const aud = grabFn('async function portalAudienceOf(');
  ok(/path\.startsWith\('\/wo\/shared'\)\) return 'vendor'/.test(aud), 'the no-login shared work order link is treated like a vendor');
  ok(/s\.role === 'vendor' \|\| s\.role === 'tenant' \|\| s\.role === 'owner'/.test(aud), 'every portal role is covered');
}

// ── 2. what each audience loses ─────────────────────────────────────────────────────────────────────────────────
const MARKUP = ['Markup', 'markup_pct', 'Markup_Percent', 'Margin', 'margin_amount', 'Profit', 'gross_profit', 'Materials_Fee', 'RC_Fee'];
const PRICE = ['Customer_Charge', 'customer_price', 'Customer_Total', 'Sell_Price', 'Owner_Price', 'price_override', 'Invoice_Total', 'Invoice_Memo', 'QBO_Invoice_Number', 'Invoice_ID', 'Invoice_Number', 'Invoice_Date', 'Processing_Fee'];
const VCOST = ['Vendor_Cost', 'vendor_cost', 'Vendor_Pay', 'vendor_paid_amount', 'Vendor_Total', 'Labor_Cost', 'Max_Price', 'Hourly_Rate', 'Instant_Fee', 'Deposit_Fee', 'payout_amount', 'vendor_rate'];
for (const aud of ['vendor', 'tenant', 'owner']) for (const k of MARKUP) assert.ok(portalMoneyKeyForbidden(k, aud), aud + ' must not get ' + k);
ok(true, 'markup / margin / profit / hidden materials fee never reach ANY portal');
for (const aud of ['vendor', 'tenant']) for (const k of PRICE) assert.ok(portalMoneyKeyForbidden(k, aud), aud + ' must not get ' + k);
ok(true, 'customer price / invoice fields never reach a vendor, tenant or shared link');
for (const aud of ['owner', 'tenant']) for (const k of VCOST) assert.ok(portalMoneyKeyForbidden(k, aud), aud + ' must not get ' + k);
ok(true, 'vendor cost / vendor pay never reach an owner or tenant');
// The vendor still gets their own pay information (their bills, their ceiling, their rate, THEIR invoice number).
for (const k of ['Max_Price', 'vendor_rate', 'invoice_number', 'invoice_date', 'Invoice_Description', 'Invoice_File_URL', 'Labor_Total', 'Status', 'Notes'])
  assert.ok(!portalMoneyKeyForbidden(k, 'vendor'), 'vendor keeps ' + k);
ok(true, 'vendor keeps their own pay fields (Max_Price, vendor_rate, their own invoice number/date)');
for (const k of ['Invoice_Total', 'Invoice_Number', 'customer_price', 'Processing_Fee']) assert.ok(!portalMoneyKeyForbidden(k, 'owner'), 'owner keeps ' + k);
ok(true, 'owner keeps what THEY are charged (they are the customer)');

// ── 3. deep scrub on a realistic leaky response ─────────────────────────────────────────────────────────────────
{
  const leaky = { workorders: [{ ID: 'WO-1253', Description: 'Replace filter', Customer_Charge: '830', Markup: '0.35', Max_Price: '500',
    estimate: { vendor_total: 460, customer_price: 830, items: [{ desc: 'filter', price_override: 40, vendor_cost: 12 }] } }], ok: true };
  const v = scrubPortalMoney(leaky, 'vendor');
  const vs = JSON.stringify(v.data);
  ok(!/830|0\.35|price_override|customer_price|Customer_Charge|Markup/.test(vs), 'vendor response: customer price and markup removed at every depth');
  ok(/"Max_Price":"500"/.test(vs) && /"vendor_total":460/.test(vs) && /"vendor_cost":12/.test(vs), 'vendor response: their own pay figures stay');
  ok(v.removed.length === 4 && v.removed.includes('workorders[].estimate.items[].price_override'), 'removed fields are reported with their path (for the P1)');
  const o = JSON.stringify(scrubPortalMoney(leaky, 'owner').data);
  ok(!/vendor_total|vendor_cost|Max_Price|Markup|0\.35/.test(o) && /customer_price/.test(o), 'owner response: vendor cost and markup removed, their own price kept');
  const t = JSON.stringify(scrubPortalMoney(leaky, 'tenant').data);
  ok(!/830|460|500|0\.35|\b12\b/.test(t), 'tenant response: every money figure removed');
  ok(leaky.workorders[0].Customer_Charge === '830', 'scrub never mutates the original object');
  ok(scrubPortalMoney({ a: 1 }, 'vendor').removed.length === 0, 'a clean response is left alone (no P1 noise)');
}

// ── 4. the portal pages themselves never read a forbidden field ─────────────────────────────────────────────────
// Field-like tokens only (snake_case / Snake_Case): CSS words like "margin" have no underscore and are not data fields.
const PAGES = {
  vendor: ['vendor.html', 'vendor-home.js', 'vendor-job-order.js', 'vendor-setup.html', 'wo.html'],
  tenant: ['tenant.html', 'submit.html'],
  owner: ['owner.html', 'owner-submit.html', 'owner-setup.html', 'owner-onboard.html'],
};
for (const [aud, files] of Object.entries(PAGES)) {
  for (const f of files) {
    if (!fs.existsSync(new URL('../' + f, import.meta.url))) continue;
    const txt = read(f);
    const bad = [...new Set((txt.match(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g) || []).filter(k => portalMoneyKeyForbidden(k, aud)))];
    assert.deepStrictEqual(bad, [], `${f} (${aud} page) reads money fields its audience must never see: ${bad.join(', ')}`);
  }
  ok(true, `${aud} pages read no forbidden money field`);
}

// ── 5. the first wall is still standing ─────────────────────────────────────────────────────────────────────────
{
  const enrich = grabFn('function enrichWO(');
  ok(/return stripExternalMoney\(base, opts\);\s*\}$/.test(enrich), 'enrichWO still returns through stripExternalMoney');
}
console.log(`portal-money-firewall: ${n}/${n} passing`);

// ── 6. endpoints the firewall caught on day one are fixed at the source (Nov 24 2026) ────────────────────────────
{
  ok(src.includes("if (path === '/vendor-bills')           return await listVendorBills(env, url, callerRole);"), '/vendor-bills gets the caller role');
  const lvb = grabFn('async function listVendorBills(');
  ok((lvb.match(/vendorBillsOut\(/g) || []).length === 2, 'both /vendor-bills return paths scrub for a portal session');
  const ga = grabFn('async function getAttachments(');
  ok(/return json\(scrubPortalMoney\(visible, callerRole\)\.data\);/.test(ga), '/attachments scrubs for a portal session');
  const bill = { ID: 'B1', Vendor_ID: '4', Labor_Total: 300, Markup: 0.35, Profit: 105, Customer_Total: 405, Processing_Fee: 12, invoice_number: 'V-77' };
  const v = scrubPortalMoney([bill], 'vendor').data[0];
  ok(v.Labor_Total === 300 && v.invoice_number === 'V-77' && !('Markup' in v) && !('Profit' in v) && !('Customer_Total' in v) && !('Processing_Fee' in v), 'a vendor bill row keeps the vendor\'s own figures and loses the customer side');
}
console.log(`portal-money-firewall (with source fixes): ${n} checks`);
