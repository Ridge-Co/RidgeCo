// Inspection billing (Oct 22 2026): "complete the inspection, everything else follows".
// Pulls the REAL INSB block out of worker.js (between its two marker lines) and runs it against an in-memory sheet, a fake QuickBooks and a fake Gmail,
// so the money math, the idempotent/resumable Complete, the loud failures and the owner-facing PDF are all exercised without any network.
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const a = src.indexOf('// ═══ INSB-BLOCK-START'), z = src.indexOf('// ═══ INSB-BLOCK-END');
if (a < 0 || z < 0) throw new Error('INSB block markers missing from worker.js');
const block = src.slice(a, z);
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (x, y, m) => { assert.deepStrictEqual(x, y, m); n++; };

// ───────────────────────── in-memory world ─────────────────────────
function world(opts = {}) {
  const w = {
    tabs: { Insp_Bookings: [], Insp_Customers: [] }, telemetry: [], mails: [], qbPosts: [], qbCalls: [], config: {}, staging: !!opts.staging, qbCreds: opts.qbCreds !== false,
    failNext: {}, locks: 0, ids: 0, invoiceSeq: 1800, qbInvoices: [], failWhen: null, failAlways: null, stealLock: false,
  };
  w.tabs.Insp_Customers.push(Object.assign({ ID: '5', Name: 'Premier Property Management', Active: 'TRUE', Billing_Mode: 'wo', Owner_Invoice: 'TRUE', QBO_Customer_ID: '', Bill_To_Name: 'Premier Property Management Investment, LLC',
    Bill_To_Address: '400 W. Franklin Street #400, Baltimore, MD 21201', Bill_Email_To: 'josiah.speed@ppmillc.com', Bill_Email_Cc: 'starr.byrd@ppmillc.com, office@ppmillc.com', AppFolio_Email: '', Markup_Pct: '', InvB_Phone: '(410) 555-0100', InvB_Email: 'office@ppmillc.com' }, opts.customer || {}));
  w.tabs.Insp_Bookings.push(Object.assign({ ID: '2', Customer_ID: '5', Status: 'approved', Active: 'TRUE', Address: '122 S Gilmor St', Formatted_Address: '122 S Gilmor St, Baltimore, MD 21223, USA', Units: '1', Buildings: '1',
    Start_ISO: '2026-10-15T14:00:00.000Z', End_ISO: '2026-10-15T14:40:00.000Z', WO_Number: '43945-1', Manage_Token: 'secret-token', Contact_Name: 'Josiah Speed' }, opts.booking || {}));
  const dep = {
    fetchTab: async (env, t) => w.tabs[t].map(r => Object.assign({}, r)),
    ensureColumns: async () => {}, invalidateTabCache: () => {},
    updateRowVerified: async (env, t, id, f) => {
      if (w.failWhen && w.failWhen(f)) throw new Error('Sheets said no (forced)');
      if (w.failAlways && Object.keys(f).some(k => w.failAlways.includes(k))) throw new Error('Sheets said no (forced, every time)');
      if (w.failNext.updateRowVerified && Object.keys(f).some(k => w.failNext.updateRowVerified.includes(k))) { const e = new Error('Sheets said no'); w.failNext.updateRowVerified = null; throw e; }
      const r = w.tabs[t].find(x => String(x.ID) === String(id)); if (!r) throw new Error('no row'); Object.assign(r, f);
      if (w.stealLock && f.Billing_Lock && String(f.Billing_Lock).startsWith('T')) { r.Billing_Lock = 'Tother|' + Date.now(); w.stealLock = false; }   // another request grabbed the lock right after ours
      return Object.assign({}, r);
    },
    logTelemetry: async (env, rec) => { w.telemetry.push(rec); },
    qbApi: async (env, p, method, body) => {
      w.qbCalls.push({ p, method });
      if (method === 'POST' && p.startsWith('invoice?')) {
        w.qbPosts.push({ p, body });
        if (w.failNext.invoice) { const f = w.failNext.invoice; w.failNext.invoice = null; return f; }
        const rid = p.match(/requestid=([^&]+)/)[1];
        w.invoiceByReq = w.invoiceByReq || {};
        if (!w.invoiceByReq[rid]) {
          const inv = { Id: String(77 + w.qbInvoices.length + 1), DocNumber: String(++w.invoiceSeq), TotalAmt: w.failNext.invoiceTotal != null ? w.failNext.invoiceTotal : body.Line[0].Amount, TxnDate: body.TxnDate, PrivateNote: body.PrivateNote, CustomerRef: body.CustomerRef };
          w.failNext.invoiceTotal = null; w.qbInvoices.push(inv); w.invoiceByReq[rid] = { Invoice: inv };
        }
        if (w.failNext.invoiceAfterCreate) { w.failNext.invoiceAfterCreate = null; throw new Error('timeout talking to QuickBooks'); }   // QuickBooks DID create it, but the answer never arrived
        return w.invoiceByReq[rid];
      }
      if (p.startsWith('query?') && decodeURIComponent(p).includes('from Invoice')) { if (w.failNext.invoiceQuery) throw new Error('QuickBooks is down'); return { QueryResponse: { Invoice: w.qbInvoices.slice() } }; }
      if (p.startsWith('query?')) { if (decodeURIComponent(p).includes("Type = 'Service'")) return { QueryResponse: { Item: opts.noServiceItem ? [] : [{ Id: '5', IncomeAccountRef: { value: '321' } }] } }; return { QueryResponse: { Item: [] } }; }
      if (p.startsWith('item/40')) return opts.noItem40 ? { Fault: { Error: [{ code: '610', Message: 'Object Not Found' }] } } : { Item: { Id: '40', IncomeAccountRef: { value: '198' } } };
      if (method === 'POST' && p.startsWith('item?')) { w.itemPosts = (w.itemPosts || []).concat([body]); return { Item: { Id: '901', Name: 'Property Inspection' } }; }
      return {};
    },
    qbAccessToken: async () => 'tok', qbBase: () => 'https://qb.test/v3/company',
    qbFault: r => (r && r.Fault ? 'QBO ' + r.Fault.Error[0].code + ': ' + r.Fault.Error[0].Message : null), qbDupId: () => null,
    qbFindOrCreateCustomer: async (env, owner, name) => { w.custCalls = (w.custCalls || []).concat([{ owner, name }]); return 'C1'; },
    qbLookupExisting: async () => null,
    isStaging: () => w.staging, fetchConfig: async () => w.config, failSetConfig: async (env, k, v) => { w.config[k] = v; },
    inspEtDate: ms => new Date(ms - 4 * 3600000).toISOString().slice(0, 10), inspAddDays: (new Function(grab('inspAddDays') + '\nreturn inspAddDays;'))(),
    inspRandToken: () => 'T' + (++w.ids), inspAdminBooking: b => { const o = Object.assign({}, b); delete o.Manage_Token; return o; },
    updateRow: async (env, t, id, f) => { w.plainUpdates = (w.plainUpdates || []).concat([f]); return { body: { ok: true }, status: 200 }; },
    json: (body, status) => ({ body, status: status || 200 }), _escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _b64urlBytes: bytes => Buffer.from(bytes).toString('base64url'),
    gmailAccessToken: async () => 'gtok', _utf8B64url: s => Buffer.from(s, 'utf8').toString('base64url'),
    inspNotAvailable: null,
    fetch: async (url, o) => {
      if (url.includes('/invoice/') && url.includes('/pdf')) { if (w.failNext.pdf) { w.failNext.pdf = null; return { ok: false, status: 503, arrayBuffer: async () => new TextEncoder().encode('busy').buffer }; } const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(400)); return { ok: true, status: 200, arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.length) }; }
      if (url.includes('gmail.googleapis.com')) {
        if (w.failNext.mail) { w.failNext.mail = null; return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }; }
        const raw = Buffer.from(JSON.parse(o.body).raw, 'base64url').toString('utf8'); w.mails.push(raw); return { ok: true, status: 200, json: async () => ({ id: 'm' + w.mails.length }) };
      }
      throw new Error('unexpected fetch ' + url);
    },
  };
  const names = Object.keys(dep);
  const factory = new Function(...names, 'INSP_TZ', 'INSP_ACTIVE_BOOKING', block + '\nreturn { insbPlan, insbComplete, insbPreview, insbReleaseOwner, insbCustomerConfig, insbQueue, insbPdfDownload, insbOwnerPdf, insbQbStubbed };');
  const api = factory(...names.map(k => dep[k]), 'America/New_York', ['pending', 'approved']);
  const env = { QB_CLIENT_ID: w.qbCreds ? 'x' : '', QB_CLIENT_SECRET: w.qbCreds ? 'y' : '', QB_REALM_ID: w.qbCreds ? 'z' : '', GMAIL_SENDER: 'ridgeco@test', __STAGING__: w.staging };
  return { w, api, env };
}

// ───────────────────────── pure functions ─────────────────────────
const P = new Function('inspAddDays', '_b64urlBytes', block + '\nreturn { insbRateCents, insbTripCents, insbMarkup, insbNormWO, insbOwnerInvoiceNumber, insbDollars, insbMDY, insbEmails, insbEmailOk, insbAddrLines, insbRecipients, insbPlan, insbAscii, insbTextWidth, insbWrap, insbPdfBytes, insbOwnerInvoiceOps, insbCustomerRow, insbB64, insbJobType };')(new Function(grab('inspAddDays') + '\nreturn inspAddDays;')(), bytes => Buffer.from(bytes).toString('base64url'));

// rate card: 1st $95, 2nd $85, 3rd and 4th $75, 5th and up $65
eq([1, 2, 3, 4, 5, 6, 12].map(P.insbRateCents), [9500, 8500, 7500, 7500, 6500, 6500, 6500], 'rate for each unit position');
eq(P.insbRateCents(0), 0, 'unit 0 is free'); eq(P.insbRateCents('x'), 0, 'junk unit is 0');
const t = (kind, units) => P.insbTripCents({ kind, units });
eq(t('inspected', 1).cents, 9500, '1 unit = $95'); eq(t('inspected', 2).cents, 18000, '2 units = $180'); eq(t('inspected', 3).cents, 25500, '3 units = $255');
eq(t('inspected', 4).cents, 33000, '4 units = $330'); eq(t('inspected', 5).cents, 39500, '5 units = $395'); eq(t('inspected', 8).cents, 59000, '8 units = $590');
eq(t('inspected', 60).cents, 9500 + 8500 + 7500 * 2 + 6500 * 56, '60 units = tiers add up');
eq(t('inspected', '3').cents, 25500, 'units typed as text still price');
eq(t('inspected', 3).breakdown.map(x => x.cents), [9500, 8500, 7500], 'breakdown per unit');
ok(!t('inspected', 0).ok, '0 units is not an inspection (use zero access)'); ok(!t('inspected', 61).ok, 'over 60 refused'); ok(!t('inspected', 2.5).ok, 'half a unit refused');
ok(!t('inspected', '').ok && !t('inspected', null).ok && !t('inspected', 'abc').ok && !t('inspected', -1).ok, 'blank / junk / negative refused');
eq(t('zero_access', 0).cents, 8500, 'zero access = $85'); eq(t('zero_access', '').cents, 8500, 'zero access with blank units = $85'); ok(!t('zero_access', 2).ok, 'zero access with units refused');
eq(t('no_charge', 3).cents, 0, 'no charge = $0'); ok(!t('', 1).ok && !t('weird', 1).ok, 'unknown kind refused');

// markup: penny-correct, half-cent rounds UP, traceable to the base
const mk = (c, p) => P.insbMarkup(c, p);
eq(mk(9500, 20).total_cents, 11400, '$95 at 20% = $114.00 (Brett\'s example)'); eq(mk(9500, 20).markup_cents, 1900, 'markup is $19.00');
eq(mk(9500, 25).total_cents, 11875, '$95 at 25% = $118.75'); eq(mk(18000, 12.5).total_cents, 20250, '$180 at 12.5% = $202.50');
eq(mk(8500, 15).markup_cents, 1275, '$85 at 15% = $12.75'); eq(mk(9500, 15).markup_cents, 1425, '$95 at 15% = $14.25 exactly');
eq(mk(9900, 12.5).markup_cents, 1238, '$99 at 12.5% = 12.375 rounds UP to $12.38'); eq(mk(1, 50).markup_cents, 1, '0.5 cent rounds up to 1');
eq(mk(9500, 0).total_cents, 9500, '0% leaves the base'); eq(mk(9500, '20').total_cents, 11400, 'percent typed as text'); eq(mk(9500, 7.25).markup_cents, 689, '$95 at 7.25% = 6.8875 -> $6.89');
ok(!mk(9500, '').ok && !mk(9500, null).ok && !mk(9500, -1).ok && !mk(9500, 201).ok && !mk(9500, 'abc').ok, 'blank / null / negative / over 200 / junk refused');
ok(!mk(9500, 12.345).ok, 'more than 2 decimals refused'); ok(!mk(95.5, 20).ok, 'base must be whole cents');
for (let c = 0; c <= 60000; c += 1250) for (const p of [5, 10, 12.5, 15, 17.5, 20, 25, 30, 33.33]) { const r = mk(c, p); if (r.total_cents !== c + r.markup_cents || r.markup_cents < 0 || Math.abs(r.markup_cents - c * p / 100) > 0.5 + 1e-9) ok(false, 'markup drift ' + c + ' ' + p); }
ok(true, 'markup never drifts more than half a cent from the exact figure across a sweep');

// work order number + owner invoice number
eq(P.insbNormWO(' 43945-1 '), '43945-1', 'trims'); eq(P.insbNormWO('43945 - 1'), '43945-1', 'inner spaces removed'); eq(P.insbNormWO('wo-44005-1'), 'WO-44005-1', 'upper-cased');
eq(P.insbNormWO(''), '', 'blank'); eq(P.insbNormWO('a'), '', 'too short'); eq(P.insbNormWO('43945/1'), '', 'slash refused'); eq(P.insbNormWO('<b>'), '', 'markup refused'); eq(P.insbNormWO('1'.repeat(31)), '', 'too long');
const n1 = P.insbOwnerInvoiceNumber('43945-1', 2);
ok(/^43945-1-\d{4}$/.test(n1), 'owner invoice number = WO + 4 digits: ' + n1);
eq(P.insbOwnerInvoiceNumber('43945-1', 2), n1, 'same booking -> same number every time');
ok(P.insbOwnerInvoiceNumber('43945-1', 3) !== n1, 'a different booking gets a different suffix');
eq(P.insbOwnerInvoiceNumber('', 2), '', 'no WO -> no number'); ok(+n1.slice(-4) >= 1000 && +n1.slice(-4) <= 9999, 'suffix is always 4 digits');

// base64 helper (no new btoa in the Worker)
ok(P.insbB64(new Uint8Array([1,2,3,250,251])) === Buffer.from([1,2,3,250,251]).toString('base64'), 'standard base64 with padding for attachments');
ok(P.insbB64(new TextEncoder().encode('Café')) === Buffer.from('Café').toString('base64'), 'UTF-8 safe for subjects');
// small formatters
eq(P.insbDollars(11400), '$114.00', 'dollars'); eq(P.insbDollars(5), '$0.05', 'cents'); eq(P.insbDollars(123456), '$1,234.56', 'thousands');
eq(P.insbMDY('2026-10-22'), '10/22/2026', 'MDY'); eq(P.insbEmails('a@b.co, c@d.org;  e@f.net'), ['a@b.co', 'c@d.org', 'e@f.net'], 'email list split');
ok(P.insbEmailOk('josiah.speed@ppmillc.com') && !P.insbEmailOk('nope') && !P.insbEmailOk('a@b') && !P.insbEmailOk('a b@c.de'), 'email check');
eq(P.insbAddrLines('122 S Gilmor St, Baltimore, MD 21223, USA'), ['122 S Gilmor St', 'Baltimore, MD 21223'], 'address lines');
eq(P.insbAddrLines('19 East Fayette Street, Apt 2, Baltimore, MD 21202'), ['19 East Fayette Street, Apt 2', 'Baltimore, MD 21202'], 'address with unit');
eq(P.insbAddrLines(''), [], 'empty address'); eq(P.insbAddrLines('Just words'), ['Just words'], 'unparseable address kept whole');
const cr = P.insbCustomerRow({ Name: 'X', Bill_To_Name: 'Premier Property Management Investment, LLC', Bill_To_Address: '400 W. Franklin Street #400, Baltimore, MD 21201', Bill_Email_To: 'a@b.co' });
eq([cr.Company, cr.Billing_Address, cr.Billing_City, cr.Billing_State, cr.Billing_Zip, cr.Billing_Email, cr.ID], ['Premier Property Management Investment, LLC', '400 W. Franklin Street #400', 'Baltimore', 'MD', '21201', 'a@b.co', ''], 'QuickBooks customer fields parsed from the address');

// recipients
let r = P.insbRecipients({ Bill_Email_To: 'j@p.com', Bill_Email_Cc: 'o@p.com' });
eq([r.a_to, r.a_cc, r.b_to, r.appfolio], [['j@p.com'], ['o@p.com'], ['j@p.com'], ''], 'without AppFolio, people get everything');
r = P.insbRecipients({ Bill_Email_To: 'j@p.com', Bill_Email_Cc: 'o@p.com', AppFolio_Email: 'bills@premier.appfolio.us' });
eq([r.a_to, r.a_cc, r.b_to, r.b_cc, r.appfolio], [['bills@premier.appfolio.us'], [], ['j@p.com'], ['o@p.com'], 'bills@premier.appfolio.us'], 'with AppFolio, OUR invoice goes only to the inbox; the owner invoice goes to the people');
ok(P.insbRecipients({}).problems.length === 1, 'no email at all is a problem'); ok(P.insbRecipients({ Bill_Email_To: 'bad' }).problems.length === 1, 'bad email is a problem');
ok(P.insbRecipients({ Bill_Email_To: 'j@p.com', AppFolio_Email: 'a@b.co, c@d.co' }).problems.length === 1, 'two AppFolio addresses refused');

// plan
const cust = { Billing_Mode: 'wo', Owner_Invoice: 'TRUE', Bill_To_Name: 'Premier', Bill_To_Address: '400 W. Franklin Street #400, Baltimore, MD 21201', Bill_Email_To: 'j@p.com', Markup_Pct: '', InvB_Phone: '(410) 555-0100', InvB_Email: 'o@p.com' };
const bk = { ID: '2', Status: 'approved', Units: '1', WO_Number: '43945-1', Formatted_Address: '122 S Gilmor St, Baltimore, MD 21223, USA' };
let pl = P.insbPlan({ booking: bk, customer: cust, kind: 'inspected', units: 1, todayIso: '2026-10-22' });
ok(pl.ok, 'plain plan is ok'); eq(pl.base_cents, 9500, 'plan base'); eq(pl.invoice.due, '2026-11-06', 'Net 15 from 10/22 is 11/06'); eq(pl.owner.status, 'held_no_markup', 'owner invoice held until the markup exists');
ok(pl.invoice.description.includes('Work Order 43945-1') && pl.invoice.description.includes('122 S Gilmor St'), 'description carries the WO and the address');
pl = P.insbPlan({ booking: bk, customer: Object.assign({}, cust, { Markup_Pct: '20' }), kind: 'inspected', units: 1, todayIso: '2026-10-22' });
eq([pl.owner.status, pl.owner.total_cents, pl.owner.markup_cents, pl.owner.pct], ['ready', 11400, 1900, '20'], 'markup set -> owner invoice ready at $114.00');
eq(P.insbPlan({ booking: bk, customer: Object.assign({}, cust, { Markup_Pct: '20', InvB_Phone: '' }), kind: 'inspected', units: 1, todayIso: '2026-10-22' }).owner.status, 'held_no_contact', "no Premier phone -> held, never a blank phone line on their invoice");
eq(P.insbPlan({ booking: bk, customer: Object.assign({}, cust, { Markup_Pct: '20', Bill_To_Address: '' }), kind: 'inspected', units: 1, todayIso: '2026-10-22' }).owner.status, 'held_no_contact', 'no Premier address -> held');
eq(P.insbPlan({ booking: bk, customer: Object.assign({}, cust, { Markup_Pct: '999' }), kind: 'inspected', units: 1, todayIso: '2026-10-22' }).owner.status, 'held_bad_markup', 'silly markup -> held, loudly');
eq(P.insbPlan({ booking: bk, customer: Object.assign({}, cust, { Owner_Invoice: 'FALSE', Markup_Pct: '20' }), kind: 'inspected', units: 1, todayIso: '2026-10-22' }).owner.status, 'off', 'owner invoice switched off');
const blk = x => P.insbPlan(Object.assign({ booking: bk, customer: cust, kind: 'inspected', units: 1, todayIso: '2026-10-22' }, x));
ok(!blk({ booking: Object.assign({}, bk, { WO_Number: '' }) }).ok, 'no WO blocks billing'); ok(blk({ booking: Object.assign({}, bk, { WO_Number: '' }) }).blockers[0].includes('work order'), 'and says why');
ok(!blk({ booking: Object.assign({}, bk, { Status: 'pending' }) }).ok, 'a pending booking cannot be completed'); ok(!blk({ booking: Object.assign({}, bk, { Status: 'cancelled' }) }).ok, 'a cancelled one neither');
ok(!blk({ units: 0 }).ok, '0 units blocks'); ok(!blk({ customer: Object.assign({}, cust, { Bill_Email_To: '' }) }).ok, 'no billing email blocks');
ok(blk({ units: 3 }).warnings.some(w => w.includes('booking was for 1')), 'billing more units than booked warns');
ok(blk({ kind: 'no_charge' }).ok, 'no charge needs no email'); eq(blk({ kind: 'zero_access', units: 0 }).base_cents, 8500, 'zero access plan = $85'); eq(blk({ kind: 'zero_access', units: 0 }).owner.status, 'held_no_markup', 'zero access still gets an owner invoice (held)');

// ───────────────────────── PDF writer ─────────────────────────
ok(P.insbAscii('Café — “x”') === 'Caf? - "x"', 'non-ASCII is made safe');
ok(Math.abs(P.insbTextWidth('Total Amount: $114.00', 11, true) - 117.359) < 0.01, 'bold text width equals the Helvetica-Bold AFM width (117.359 from reportlab)');
eq(Math.round(P.insbTextWidth('Hello', 10, false) * 100), Math.round((722 + 556 + 222 + 222 + 556) * 10 / 1000 * 100), 'regular widths are Helvetica AFM widths');
eq(P.insbWrap('Premier Property Management Investment, LLC', 11, false, 160).length, 2, 'long names wrap');
const ops = P.insbOwnerInvoiceOps({ issuer: ['Premier Property Management Investment, LLC', '400 W. Franklin Street #400', 'Baltimore, MD 21201', 'Phone: (410) 555-0100', 'Email: office@p.com'], number: '43945-1-5513', date: '2026-10-22', wo: '43945-1', service: ['122 S Gilmor St', 'Baltimore, MD 21223'], description: 'Comprehensive property inspection', cents: 11400 });
const bytes = P.insbPdfBytes(ops, 'Invoice 43945-1-5513');
ok(String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-', 'PDF header'); ok(String.fromCharCode(...bytes.slice(-6)).includes('%%EOF'), 'PDF trailer');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'insbpdf-')), pdfPath = path.join(tmp, 'a.pdf'); fs.writeFileSync(pdfPath, bytes);
const pt = spawnSync('pdftotext', ['-layout', pdfPath, '-']);
if (pt.status === 0) {
  const txt = String(pt.stdout);
  for (const s of ['Premier Property Management Investment, LLC', '400 W. Franklin Street #400', 'Phone: (410) 555-0100', 'Email: office@p.com', 'INVOICE', 'Bill to:', 'Service Address:', 'Invoice #: 43945-1-5513', 'Bill Date: 10/22/2026', 'Work Order: 43945-1', 'Description', 'Quantity', 'Amount', 'Comprehensive property inspection', '$114.00', 'Total Amount: $114.00', '122 S Gilmor St'])
    ok(txt.includes(s), 'PDF text contains: ' + s);
  ok((txt.match(/122 S Gilmor St/g) || []).length === 2, 'service address shown under Bill to AND Service Address (specimen layout, no bill-to person)');
  ok(!/Nelson|Ridge Co|Saint Thomas/.test(txt), "the owner invoice carries none of Brett's business details");
  const info = String(spawnSync('pdfinfo', [pdfPath]).stdout); ok(/Pages:\s+1/.test(info) && /612 x 792/.test(info), 'one US-Letter page');
} else ok(true, 'pdftotext not installed here: PDF text checks skipped');
const ov = P.insbPdfBytes([{ t: 'text', x: 10, y: 700, size: 10, s: 'a (b) \\ c' }], 't'); ok(Buffer.from(ov).toString('latin1').includes('(a \\(b\\) \\\\ c)'), 'parentheses and backslashes are escaped in the PDF');

// ───────────────────────── Failure severity (money = P0, data write = P1, read = P2) ─────────────────────────
{
  const sev = new Function(/const FAIL_SEVERITY_BY_WHERE = \[[\s\S]*?\n\];/.exec(src)[0] + '\n' + /function failSeverity[\s\S]*?\n}\n/.exec(src)[0] + '\nreturn failSeverity;')();
  for (const k of ['qb', 'pdf', 'email', 'stamp', 'stamp_after_send', 'resume_mismatch', 'complete', 'release', 'item_cache', 'unlock']) eq(sev(P.insbJobType(k), 'x'), 'P0', k + ' failure is P0');
  for (const k of ['customer_config', 'set_wo']) eq(sev(P.insbJobType(k), 'x'), 'P1', k + ' failure is P1');
  for (const k of ['queue', 'pdf_download', 'preview', 'preview_qb_lookup']) eq(sev(P.insbJobType(k), 'x'), 'P2', k + ' failure is P2');
}

// ───────────────────────── Complete: the whole flow against fakes ─────────────────────────
const call = async (api, env, fn, body) => await api[fn](env, body);
const latest = w => w.tabs.Insp_Bookings[0];
async function main() {
  // 1) happy path, markup not set: our invoice goes out, owner invoice is held
  {
    const { w, api, env } = world();
    const pv = await call(api, env, 'insbPreview', { id: '2', kind: 'inspected', units: 1 });
    ok(pv.body.ok && pv.body.plan.ok, 'preview ok: ' + JSON.stringify(pv.body).slice(0, 400)); eq(w.qbPosts.length, 0, 'preview wrote nothing to QuickBooks'); eq(w.mails.length, 0, 'preview sent nothing'); eq(latest(w).Invoice_Status, undefined, 'preview wrote nothing to the sheet');
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(res.body.ok, 'complete ok: ' + JSON.stringify(res.body).slice(0, 300)); eq(res.status, 200, '200');
    eq(w.qbPosts.length, 1, 'exactly one QuickBooks invoice'); const inv = w.qbPosts[0].body;
    eq(inv.Line[0].Amount, 95, 'invoice line is $95'); eq(inv.Line[0].SalesItemLineDetail.Qty, 1, 'quantity 1'); eq(inv.CustomerRef.value, 'C1', 'billed to the new QuickBooks customer');
    eq(inv.TxnDate.length, 10, 'dated'); ok(inv.DueDate > inv.TxnDate, 'due date after bill date'); ok(inv.Line[0].Description.includes('43945-1'), 'WO on the line'); ok(inv.CustomerMemo.value.includes('43945-1'), 'WO in the memo');
    ok(!('DocNumber' in inv), 'QuickBooks numbers the invoice itself (no custom number)'); eq(inv.BillEmail.Address, 'josiah.speed@ppmillc.com', 'send-to email set on the invoice');
    ok(/requestid=insp-bk-2-43945-1/.test(w.qbPosts[0].p), 'QuickBooks request id guards against double posting');
    eq(w.custCalls.length, 1, 'customer created once'); eq(w.custCalls[0].name, 'Premier Property Management Investment, LLC', 'customer name is the Bill_To_Name'); eq(w.tabs.Insp_Customers[0].QBO_Customer_ID, 'C1', 'customer id saved on the customer row');
    eq(w.config.insp_qb_item_id, '901', 'inspection item created once and cached');
    eq(w.mails.length, 1, 'one email'); const m = w.mails[0];
    ok(m.includes('To: josiah.speed@ppmillc.com') && m.includes('Cc: starr.byrd@ppmillc.com, office@ppmillc.com'), 'to Josiah, cc Starr and the office'); ok(m.includes('Content-Type: application/pdf; name="Invoice_1801_122_S_Gilmor_St.pdf"'), 'QuickBooks PDF attached under the invoice number');
    eq((m.match(/Content-Type: application\/pdf/g) || []).length, 1, 'only our invoice attached while the markup is unknown');
    const row = latest(w); eq([row.Invoice_Status, row.QB_Invoice_Number, row.Units_Billed, row.Invoice_Base_Cents, row.Completion_Kind, row.InvB_Status], ['emailed', '1801', '1', '9500', 'inspected', 'held_no_markup'], 'row stamped');
    ok(row.Invoice_Emailed_At && row.Invoice_Emailed_To.includes('josiah'), 'email recorded'); eq(row.Billing_Lock, '', 'lock cleared'); eq(w.telemetry.length, 0, 'no failures logged');
    // 2) tap again: nothing is created or sent twice
    const again = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 5, confirm: true });
    ok(again.body.ok, 'second tap ok'); eq(w.qbPosts.length, 1, 'second tap did NOT create a second invoice'); eq(w.mails.length, 1, 'second tap did NOT send a second email'); eq(latest(w).Units_Billed, '1', 'second tap did not re-price from what was typed');
    // 3) Premier sends the markup -> held owner invoice is released
    const cfgRes = await call(api, env, 'insbCustomerConfig', { customer_id: '5', Markup_Pct: '20' });
    ok(cfgRes.body.ok && cfgRes.body.held_owner_invoices.length === 1, 'saving the markup lists the held owner invoice'); eq(w.tabs.Insp_Customers[0].Markup_Pct, '20', 'markup saved');
    const rp = await call(api, env, 'insbReleaseOwner', { id: '2', preview: true }); ok(rp.body.ok && rp.body.preview && rp.body.owner_cents === 11400, 'release preview shows $114.00'); eq(w.mails.length, 1, 'release preview sent nothing');
    const rel = await call(api, env, 'insbReleaseOwner', { id: '2' }); ok(rel.body.ok, 'release ok: ' + JSON.stringify(rel.body).slice(0, 200));
    eq(w.mails.length, 2, 'owner invoice email sent'); const m2 = w.mails[1]; ok(m2.includes('To: josiah.speed@ppmillc.com'), 'owner invoice goes to the people'); eq((m2.match(/Content-Type: application\/pdf/g) || []).length, 1, 'exactly the owner invoice attached, NOT ours again'); ok(m2.includes('$114.00') && m2.includes('20% markup'), 'email states the amount and markup');
    eq([latest(w).InvB_Status, latest(w).InvB_Cents, latest(w).InvB_Markup_Pct], ['sent', '11400', '20'], 'owner invoice stamped'); eq(w.qbPosts.length, 1, 'still only one QuickBooks invoice');
    const rel2 = await call(api, env, 'insbReleaseOwner', { id: '2' }); ok(!rel2.body.ok && rel2.status === 409, 'cannot release a sent owner invoice again'); eq(w.mails.length, 2, 'and nothing was sent');
  }
  // 4) markup already on file at completion: both go in one email, owner PDF built from the stamped numbers
  {
    const { w, api, env } = world({ customer: { Markup_Pct: '20' } });
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(res.body.ok, 'complete with markup ok');
    eq(w.mails.length, 1, 'one email'); eq((w.mails[0].match(/Content-Type: application\/pdf/g) || []).length, 2, 'both invoices attached to the one email');
    eq([latest(w).InvB_Status, latest(w).InvB_Cents, latest(w).Invoice_Status], ['sent', '11400', 'emailed'], 'both stamped');
    ok(/Invoice_43945-1-\d{4}_owner\.pdf/.test(w.mails[0]), 'owner invoice named by its WO-based number');
  }
  // 5) AppFolio Smart Bill Entry address: our invoice alone to the inbox, owner invoice to the people
  {
    const { w, api, env } = world({ customer: { Markup_Pct: '20', AppFolio_Email: 'bills.premier@appfolio.test.com' } });
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(res.body.ok, 'complete with AppFolio ok');
    eq(w.mails.length, 2, 'two emails'); const toA = w.mails.find(m => m.includes('To: bills.premier@appfolio.test.com')), toB = w.mails.find(m => m.includes('To: josiah.speed@ppmillc.com'));
    ok(toA && toB, 'one to the AppFolio inbox, one to the people'); eq((toA.match(/Content-Type: application\/pdf/g) || []).length, 1, 'the AppFolio email carries exactly one PDF'); ok(!toA.includes('Cc:'), 'nobody copied on the AppFolio email (no second keying-in)');
    ok(toA.includes('name="Invoice_1801_') && !toA.includes('_owner'), 'the AppFolio PDF is OUR invoice, never the owner one'); ok(/_owner\.pdf|Invoice_43945-1-\d{4}\.pdf/.test(toB) && !toB.includes('Invoice_1801'), 'the people get the owner invoice only');
    eq([latest(w).Invoice_Emailed_To, latest(w).InvB_Status], ['bills.premier@appfolio.test.com', 'sent'], 'recorded');
  }
  // 6) email failure: invoice stays created, loud, and the retry sends ONLY the email
  {
    const { w, api, env } = world(); w.failNext.mail = true;
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(!res.body.ok && res.body.invoice_created && res.body.stage === 'email', 'email failure is reported with the invoice noted as created'); ok(res.body.error.includes('Tap Complete again'), 'and says what to do');
    eq(w.qbPosts.length, 1, 'one invoice so far'); eq(latest(w).Invoice_Status, 'invoiced', 'not marked emailed'); ok(w.telemetry.some(t => t.Success === 'FALSE' && /insp-billing\/email/.test(t.Skill_Or_Endpoint)), 'failure logged (Needs Attention)'); eq(latest(w).Billing_Lock, '', 'lock cleared even after failure');
    const q = await api.insbQueue(env); ok(q.body.items.some(x => x.needs_attention), 'the failed one shows on the Needs-billing list');
    const retry = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(retry.body.ok, 'retry ok'); eq(w.qbPosts.length, 1, 'retry did not create a second invoice'); eq(w.mails.length, 1, 'retry sent the one email'); eq(latest(w).Invoice_Status, 'emailed', 'now emailed');
  }
  // 7) QuickBooks PDF failure: nothing is emailed, loud, retry works
  {
    const { w, api, env } = world(); w.failNext.pdf = true;
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(!res.body.ok && res.body.stage === 'pdf' && res.body.invoice_created, 'PDF failure is reported'); eq(w.mails.length, 0, 'nothing emailed without the PDF'); ok(w.telemetry.some(t => /insp-billing\/pdf/.test(t.Skill_Or_Endpoint)), 'logged');
    const retry = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(retry.body.ok && w.mails.length === 1 && w.qbPosts.length === 1, 'retry sends with the PDF and still one invoice');
  }
  // 8) QuickBooks refuses: nothing stamped, nothing sent, loud, lock cleared
  {
    const { w, api, env } = world(); w.failNext.invoice = { Fault: { Error: [{ code: '6000', Message: 'Business Validation Error' }] } };
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(w.telemetry.some(t => t.Success === 'FALSE' && t.Job_Type === 'insp_billing_money'), 'a failed QuickBooks invoice is filed as a MONEY failure'); ok(!res.body.ok && res.status === 502, 'QuickBooks refusal is an error'); ok(res.body.message.includes('Business Validation Error'), 'with QuickBooks\' own words'); eq(latest(w).QB_Invoice_ID, undefined, 'nothing stamped'); eq(w.mails.length, 0, 'nothing emailed'); eq(latest(w).Billing_Lock, '', 'lock cleared'); ok(w.telemetry.length >= 1, 'logged');
  }
  // 9) the invoice is created but the Hub cannot record it: say DO NOT resend
  {
    const { w, api, env } = world(); w.failNext.updateRowVerified = ['QB_Invoice_ID'];
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(!res.body.ok && res.body.invoice_created === true && /DO NOT/.test(res.body.error), 'a failed stamp after creation says DO NOT create it again'); eq(res.status, 500, '500'); eq(w.mails.length, 0, 'no email after a failed stamp'); ok(w.telemetry.some(t => /DO NOT create it again/.test(t.Notes)), 'logged with the warning');
    // even if someone taps again, QuickBooks' request id returns the SAME invoice
    const again = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    eq(new Set(w.qbPosts.map(p => p.p.match(/requestid=([^&]+)/)[1])).size, 1, 'a second try reuses the same QuickBooks request id, so QuickBooks cannot double-post'); ok(again.body.ok, 'and the second try completes: ' + JSON.stringify(again.body).slice(0, 160));
  }
  // 10) blockers
  {
    const { w, api, env } = world({ booking: { WO_Number: '' } });
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(!res.body.ok && res.status === 409 && /work order/.test(res.body.message), 'no WO blocks completion'); eq(w.qbPosts.length, 0, 'nothing posted');
    const nc = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1 }); ok(nc.status === 400 && nc.body.error === 'confirm_required', 'no confirm, no action');
    const w2 = world({ booking: { Status: 'pending' } }); const r2 = await call(w2.api, w2.env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(!r2.body.ok && w2.w.qbPosts.length === 0, 'pending booking cannot be billed');
    const w3 = world({ customer: { Billing_Mode: '' } }); const r3 = await call(w3.api, w3.env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(r3.status === 409 && r3.body.error === 'not_billed_here' && w3.w.qbPosts.length === 0, 'a customer not set up for this is never billed by it');
    const r4 = await call(api, env, 'insbComplete', { id: '99', kind: 'inspected', units: 1, confirm: true }); ok(r4.status === 404, 'unknown booking is a 404');
  }
  // 11) lock: a second request while one is running is refused
  {
    const { w, api, env } = world({ booking: { Billing_Lock: 'Tx|' + Date.now() } });
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(res.status === 409 && res.body.error === 'in_progress', 'fresh lock refuses'); eq(w.qbPosts.length, 0, 'nothing posted');
    const w2 = world({ booking: { Billing_Lock: 'Tx|' + (Date.now() - 300000) } }); const r2 = await call(w2.api, w2.env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(r2.body.ok, 'a stale lock (crashed request) does not block forever');
  }
  // 12) multi-unit, zero access, no charge
  {
    const { w, api, env } = world({ booking: { Units: '3' } });
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 3, confirm: true }); ok(res.body.ok, '3 units ok'); eq(w.qbPosts[0].body.Line[0].Amount, 255, '3 units invoice = $255'); ok(w.qbPosts[0].body.Line[0].Description.includes('(3 units)'), 'description says 3 units');
    const z = world(); const rz = await call(z.api, z.env, 'insbComplete', { id: '2', kind: 'zero_access', units: 0, confirm: true }); ok(rz.body.ok, 'zero access ok'); eq(z.w.qbPosts[0].body.Line[0].Amount, 85, 'zero access = $85'); ok(z.w.qbPosts[0].body.Line[0].Description.includes('zero access'), 'says zero access');
    const nc = world(); const rn = await call(nc.api, nc.env, 'insbComplete', { id: '2', kind: 'no_charge', units: 0, confirm: true }); ok(rn.body.ok && rn.body.billed === false, 'no charge completes'); eq(nc.w.qbPosts.length, 0, 'no invoice for no charge'); eq(nc.w.mails.length, 0, 'no email for no charge'); eq(nc.w.tabs.Insp_Bookings[0].Invoice_Status, 'none', 'recorded as none');
  }
  // 13) existing QuickBooks customer id is reused, never recreated
  {
    const { w, api, env } = world({ customer: { QBO_Customer_ID: 'C77' } });
    await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); eq(w.custCalls, undefined, 'no customer lookup/create when one is linked'); eq(w.qbPosts[0].body.CustomerRef.value, 'C77', 'billed to the linked customer');
  }
  // 14) staging without QuickBooks credentials: stubbed QB, stubbed email, still verifiable
  {
    const { w, api, env } = world({ staging: true, qbCreds: false, customer: { Markup_Pct: '20' } });
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(res.body.ok, 'staged complete ok: ' + JSON.stringify(res.body).slice(0, 200));
    eq(w.qbPosts.length, 0, 'QuickBooks untouched on staging'); eq(w.mails.length, 0, 'staging email is stubbed (nothing reaches a real inbox)'); eq(latest(w).Invoice_Status, 'staged', 'marked staged'); eq(latest(w).InvB_Status, 'staged', 'owner invoice built and stub-"sent"'); ok(res.body.steps.some(s => /STUBBED/.test(s)), 'the steps say the email was stubbed');
    const again = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(again.body.ok && w.qbPosts.length === 0, 'repeat is harmless');
  }
  // 15) staging REDIRECT mode would only ever go to the test recipient
  {
    const { w, api, env } = world({ staging: true, qbCreds: true }); w.config.GMAIL_STAGING_MODE = 'REDIRECT'; w.config.GMAIL_TEST_RECIPIENT = 'brett@test.example';
    const res = await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true }); ok(res.body.ok, 'redirected complete ok');
    ok(w.mails.length === 1 && w.mails[0].includes('To: brett@test.example'), 'redirected to the test recipient'); ok(!/^To:.*ppmillc/m.test(w.mails[0]), 'the real customer address is NOT in the To header'); ok(!/^Cc:/m.test(w.mails[0]), 'nobody is copied in redirect mode');
  }
  // 16) config validation + owner PDF download
  {
    const { w, api, env } = world();
    const bad = await call(api, env, 'insbCustomerConfig', { customer_id: '5', Markup_Pct: '12.345' }); ok(!bad.body.ok && bad.status === 400, 'bad markup refused');
    const bad2 = await call(api, env, 'insbCustomerConfig', { customer_id: '5', AppFolio_Email: 'nope' }); ok(!bad2.body.ok, 'bad AppFolio address refused'); eq(w.tabs.Insp_Customers[0].AppFolio_Email, '', 'nothing saved on a refusal');
    const good = await call(api, env, 'insbCustomerConfig', { customer_id: '5', AppFolio_Email: 'bills@x.appfolio.com', Markup_Pct: '17.5' }); ok(good.body.ok && w.tabs.Insp_Customers[0].Markup_Pct === '17.5', 'good config saved');
    const none = await call(api, env, 'insbCustomerConfig', { customer_id: '5' }); ok(!none.body.ok, 'nothing to save is not a silent success');
    await call(api, env, 'insbComplete', { id: '2', kind: 'inspected', units: 2, confirm: true });
    const url = new URL('https://x.test/insp/billing/pdf?id=2&which=b'); const dlb = await api.insbPdfDownload(env, url); ok(dlb.status === 200 && dlb.headers.get('Content-Type') === 'application/pdf', 'owner invoice downloads as a PDF');
    const buf = Buffer.from(await dlb.arrayBuffer()); eq(buf.slice(0, 5).toString(), '%PDF-', 'valid PDF bytes');
    const dla = await api.insbPdfDownload(env, new URL('https://x.test/insp/billing/pdf?id=2&which=a')); ok(dla.status === 200, 'our invoice downloads (QuickBooks PDF)');
    const pdfp = path.join(tmp, 'b.pdf'); fs.writeFileSync(pdfp, buf); const t2 = spawnSync('pdftotext', ['-layout', pdfp, '-']); if (t2.status === 0) ok(String(t2.stdout).includes('Total Amount: $211.50'), '2 units $180 at 17.5% = $211.50 on the owner PDF'); else ok(true, 'skipped');
  }
  // 17) the QuickBooks company has no General item 40 (e.g. the Intuit sandbox): borrow a service item's income account; if there is none, stop loudly - never guess an item id
  {
    const a = world({ noItem40: true }); const ra = await call(a.api, a.env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(ra.body.ok, 'sandbox-style company completes: ' + JSON.stringify(ra.body).slice(0, 200)); eq(a.w.itemPosts[0].IncomeAccountRef.value, '321', 'item created on the income account of an existing service item'); eq(a.w.qbPosts[0].body.Line[0].SalesItemLineDetail.ItemRef.value, '901', 'invoice uses the new item, not a guessed id');
    const b = world({ noItem40: true, noServiceItem: true }); const rb = await call(b.api, b.env, 'insbComplete', { id: '2', kind: 'inspected', units: 1, confirm: true });
    ok(!rb.body.ok && /income account/.test(rb.body.message), 'no usable income account: stops with a clear message'); eq(b.w.qbPosts.length, 0, 'no invoice posted'); eq(b.w.mails.length, 0, 'no email'); eq(b.w.tabs.Insp_Bookings[0].Billing_Lock, '', 'lock cleared'); ok(b.w.telemetry.some(t => t.Success === 'FALSE'), 'logged to Needs Attention');
  }
}
await main();
console.log('insp-billing: ' + n + ' checks passed');
