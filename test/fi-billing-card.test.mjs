// Nov 2 2026 (Brett): put the work order number on the report and invoice, add an "Invoiced" mark (QuickBooks invoice created, not sent), and track payment.
// Pins (the REAL code out of field-inspect.html / inspection-report.html / worker.js): the Review screen's "Work order & billing" card in every state,
// the preview -> confirm flow, that errors are shown (never swallowed), and that the public report carries the work order number.
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const rep = fs.readFileSync(new URL('../inspection-report.html', import.meta.url), 'utf8');
const wk = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 600) : ''); } };
const a = html.indexOf('var BILL_KINDS'), z = html.indexOf('function publishedCard(){');
if (a < 0 || z < a) { console.log('FAIL: billing block not found'); process.exit(1); }
const code = html.slice(a, z);
const calls = [], toasts = [];
const ctx = {
  S: { view: 'review', rec: { id: 'insp_abc123', base_rev: 3 }, busy: {} }, esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  api: (m, p, b) => { calls.push({ m, p, b }); if (p.indexOf('/fi/billing') === 0) return Promise.resolve(ctx.S.bill.data); return ctx.__next ? ctx.__next(m, p, b) : Promise.resolve({ ok: true }); }, safeRender: () => true, render: () => {}, toast: x => toasts.push(x),
  claim: k => { if (ctx.S.busy[k]) return false; ctx.S.busy[k] = true; return true; }, release: k => { delete ctx.S.busy[k]; }, $: id => ({ value: ctx.__wo || '' }), setTimeout, clearTimeout, console,
};
vm.createContext(ctx); vm.runInContext(code, ctx);
const card = (data, extra) => { ctx.S.bill = Object.assign({ id: 'insp_abc123', loading: false, err: '', data }, extra || {}); return ctx.billingCard(); };
const bk = (o) => Object.assign({ ID: '2', Formatted_Address: '122 S Gilmor St, Baltimore', WO_Number: '43945-1', Units: '1', Completed_At: '', Invoice_Status: '' }, o || {});
const cu = (o) => Object.assign({ id: '5', name: 'Premier', billing: true, qb_only: true }, o || {});

t('nothing shows until the inspection is saved to the server', (ctx.S.rec.base_rev = 0, ctx.billingCard() === ''));
ctx.S.rec.base_rev = 3;
t('loading state', /Loading/.test(card(null, { loading: true })));
t('a load failure is SHOWN with a retry, not hidden', /banner err/.test(card(null, { err: 'Could not load the billing state: boom' })) && /reloadBilling/.test(ctx.billingCard()));
t('no booking -> says so plainly', /not linked to a booking/.test(card({ ok: true, linked: false })));
let h = card({ linked: true, booking: bk(), customer: cu() });
t('shows the work order number', /Work order <b>43945-1<\/b>/.test(h), h);
t('invoiced-only customer: button says Mark invoiced and explains it is not emailed', /Mark invoiced/.test(h) && /not<\/b> emailed/.test(h), h);
h = card({ linked: true, booking: bk(), customer: cu({ qb_only: false }) });
t('a normal customer gets Complete & bill', /Complete &amp; bill/.test(h) && !/not<\/b> emailed/.test(h));
h = card({ linked: true, booking: bk({ WO_Number: '' }), customer: cu() });
t('missing work order number is a visible warning with a way to add it', /No work order number/.test(h) && /fb-wo-in/.test(h) && /fbSetWO/.test(h), h);
h = card({ linked: true, booking: bk(), customer: cu({ billing: false }) });
t('customer not set up for billing -> no bill button', /not set up for automatic billing/.test(h) && !/fbOpen/.test(h));
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'invoiced', QB_Invoice_Number: '1801', Invoice_Base_Cents: '9500' }), customer: cu() });
t('invoiced + unpaid chips, QuickBooks number and amount', /pill ok">Invoiced/.test(h) && /pill warn">Unpaid/.test(h) && /#1801/.test(h) && /\$95\.00/.test(h) && /not emailed \(this customer is invoiced only\)/.test(h), h);
t('invoiced-only: no "not fully sent" nag', !/not been fully sent/.test(h));
t('unpaid: offers Check if paid and Mark paid', /fbCheckPaid/.test(h) && /fbAskPaid\(true\)/.test(h));
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'invoiced', QB_Invoice_Number: '1801', Invoice_Base_Cents: '9500' }), customer: cu({ qb_only: false }) });
t('a normal customer whose invoice was NOT emailed gets a loud pointer to finish it', /not been fully sent/.test(h), h);
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'invoiced', QB_Invoice_Number: '1801', Invoice_Base_Cents: '9500' }), customer: cu() }, { confirmPaid: true });
t('Mark paid asks for a second tap first', /Yes — mark paid today/.test(h) && /fbAskPaid\(false\)/.test(h) && !/fbAskPaid\(true\)/.test(h));
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'invoiced', QB_Invoice_Number: '1801', Invoice_Base_Cents: '9500', Paid_At: '2026-11-05T12:00:00.000Z', Paid_Source: 'quickbooks' }), customer: cu() });
t('paid: shows date and source, offers undo, no Check button', /Paid 2026-11-05 \(quickbooks\)/.test(h) && /fbUndoPaid/.test(h) && !/fbCheckPaid/.test(h), h);
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'none' }), customer: cu() });
t('completed with no charge is stated', /no charge/.test(h) && !/Unpaid/.test(h));
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'invoiced', QB_Invoice_Number: '1801', Invoice_Base_Cents: '9500' }), customer: cu() }, { msg: 'Not paid yet: QuickBooks balance is $95.00.', msgBad: false });
t('status messages from the last action are shown', /Not paid yet: QuickBooks balance is \$95\.00\./.test(h));
h = card({ linked: true, booking: bk({ Completed_At: '2026-11-02T15:00:00Z', Invoice_Status: 'invoiced', QB_Invoice_Number: '1801', Invoice_Base_Cents: '9500' }), customer: cu() }, { msg: 'Could not check: QuickBooks is down', msgBad: true });
t('a failed check is shown as an error', /banner err[^>]*>Could not check: QuickBooks is down/.test(h), h);

// the preview -> confirm flow
const plan = (o) => Object.assign({ ok: true, blockers: [], warnings: ['Invoiced only: the QuickBooks invoice is created but NOT emailed.'], kind: 'inspected', base_cents: 9500, base_label: '1 unit', resume: false, invoice: { wo: '43945-1', due: '2026-11-17' }, owner: { enabled: false } }, o || {});
const wait = () => new Promise(r => setTimeout(r, 5));
(async () => {
  calls.length = 0; ctx.S.bill = { id: 'insp_abc123', loading: false, data: { linked: true, booking: bk(), customer: cu() } };
  ctx.fbOpen(); await wait();
  t('opening the sheet previews (writes nothing)', calls.length === 1 && calls[0].p === '/insp/billing/preview' && calls[0].b.id === '2' && calls[0].b.units === '1', calls);
  ctx.__next = () => Promise.resolve({ ok: true, plan: plan(), qb: { name: 'Premier' } });
  ctx.fbPreview(); await wait();
  t('preview shows the amount, the work order and the not-emailed warning, and enables the button', /\$95\.00/.test(ctx.S.bill.sheet.html) && /43945-1/.test(ctx.S.bill.sheet.html) && /NOT emailed/.test(ctx.S.bill.sheet.html) && ctx.S.bill.sheet.canGo === true && ctx.S.bill.sheet.goLabel === 'Mark invoiced', ctx.S.bill.sheet);
  ctx.__next = () => Promise.resolve({ ok: true, plan: plan({ ok: false, blockers: ['This booking has no usable work order number.'] }), qb: {} });
  ctx.fbPreview(); await wait();
  t('blockers are shown and the button stays off', /Cannot bill yet/.test(ctx.S.bill.sheet.html) && ctx.S.bill.sheet.canGo === false);
  ctx.__next = () => Promise.reject(Object.assign(new Error('network down'), {}));
  ctx.fbPreview(); await wait();
  t('a preview failure is shown, button off', /Could not build the preview: network down/.test(ctx.S.bill.sheet.html) && ctx.S.bill.sheet.canGo === false);
  // confirm sends the amount the screen showed
  ctx.__next = () => Promise.resolve({ ok: true, plan: plan(), qb: {} }); ctx.fbPreview(); await wait();
  calls.length = 0; ctx.__next = () => Promise.resolve({ ok: true, invoice_number: '1801', steps: ['QuickBooks invoice 1801 created for $95.00'] });
  const btn = { disabled: false, textContent: '' }; ctx.fbConfirm(btn); await wait();
  t('confirm posts kind, units, expected_cents and confirm:true', calls[0] && calls[0].p === '/insp/billing/complete' && calls[0].b.expected_cents === 9500 && calls[0].b.confirm === true && calls[0].b.kind === 'inspected' && calls[0].b.units === '1', calls[0]);
  t('success closes the sheet and says what happened', ctx.S.bill.sheet === null && /QuickBooks invoice #1801/.test(ctx.S.bill.msg) && ctx.S.bill.msgBad === false, ctx.S.bill);
  // failure after the invoice exists: the error says so
  ctx.S.bill = { id: 'insp_abc123', loading: false, data: { linked: true, booking: bk(), customer: cu() }, sheet: { kind: 'inspected', units: '1', html: '', err: '', canGo: true, busy: false, seq: 0, plan: plan() } };
  ctx.__next = () => Promise.reject(Object.assign(new Error('Sheets said no'), { data: { invoice_created: true, steps: ['QuickBooks invoice 1801 created'] } }));
  ctx.fbConfirm({ disabled: false, textContent: '' }); await wait();
  t('a failure after the invoice was created says the invoice IS in QuickBooks', /The invoice IS in QuickBooks, but: <\/b>Sheets said no/.test(ctx.S.bill.sheet.err) && /Done so far/.test(ctx.S.bill.sheet.err) && ctx.S.bill.sheet.busy === false, ctx.S.bill.sheet);
  // mark paid / check paid / set wo
  ctx.S.bill = { id: 'insp_abc123', loading: false, data: { linked: true, booking: bk({ Completed_At: 'x', Invoice_Status: 'invoiced' }), customer: cu() } }; calls.length = 0;
  ctx.__next = () => Promise.resolve({ ok: true, checked: 1, paid: [], unpaid: [{ balance_cents: 9500 }], errors: [] }); ctx.fbCheckPaid({ disabled: false }); await wait();
  t('Check if paid posts to check-paid with the booking id and reports the balance', calls[0].p === '/insp/billing/check-paid' && calls[0].b.id === '2' && /Not paid yet: QuickBooks balance is \$95\.00/.test(ctx.S.bill.msg), [calls[0], ctx.S.bill.msg]);
  ctx.__next = () => Promise.resolve({ ok: false, checked: 1, errors: ['Booking 2: QuickBooks is down'] }); ctx.fbCheckPaid({ disabled: false }); await wait();
  t('errors inside a 200-style answer are surfaced too', ctx.S.bill.msgBad === true && /QuickBooks is down/.test(ctx.S.bill.msg), ctx.S.bill.msg);
  ctx.__next = () => Promise.reject(Object.assign(new Error('Only an invoiced booking can be marked paid.'), { data: {} })); ctx.fbMarkPaid({ disabled: false }); await wait();
  t('a refused mark-paid shows the reason', ctx.S.bill.msgBad === true && /Only an invoiced booking/.test(ctx.S.bill.msg));
  calls.length = 0; ctx.__next = () => Promise.resolve({ ok: true }); ctx.fbMarkPaid({ disabled: false }); await wait();
  t('mark paid sends confirm:true', calls[0].p === '/insp/billing/mark-paid' && calls[0].b.confirm === true && !calls[0].b.undo, calls[0]);
  calls.length = 0; ctx.fbUndoPaid({ disabled: false }); await wait();
  t('undo sends undo:true', calls[0].b.undo === true);
  calls.length = 0; ctx.__wo = '   '; ctx.fbSetWO('2', { disabled: false });
  t('an empty work order number is not sent', calls.length === 0 && toasts.some(x => /Type the work order/.test(x)));
  ctx.__wo = '43945-1'; ctx.fbSetWO('2', { disabled: false }); await wait();
  t('set work order posts to set-wo', calls[0] && calls[0].p === '/insp/billing/set-wo' && calls[0].b.wo === '43945-1' && calls[0].b.id === '2', calls[0]);

  // wiring
  t('the Review screen shows the card', /if \(rec\.status==='published'\) h \+= publishedCard\(\);\s*\n\s*h \+= billingCard\(\);/.test(html));
  t('the public report prints the work order in its header', /\(d\.wo_number\?'<div><span>Work order<\/span>'\+esc\(d\.wo_number\)\+'<\/div>':''\)/.test(rep));
  t('the report endpoint looks the work order up from the booking by Inspection_ID', /String\(x\.Inspection_ID\) === String\(insp\.o\.ID\)[\s\S]{0,200}insbNormWO\(bk\.WO_Number\)/.test(wk) && /wo_number: woNumber, wo_lookup_failed: woLookupFailed/.test(wk));
  t('a failed work order lookup on the report is logged, not swallowed', /catch \(e\) \{ woLookupFailed = true; await insbFail\(env, 'report_wo'/.test(wk));
  t('the billing and paid endpoints are routed', /'\/fi\/billing'\)\s+return await fiRoute\(env, 'billing'/.test(wk) && /'\/insp\/billing\/mark-paid'\)\s+return await insbMarkPaid/.test(wk) && /'\/insp\/billing\/check-paid'\)\s+return await insbCheckPaid/.test(wk));
  t('the work order never leaks other booking data into the public report', !/booking: *bk/.test(wk.slice(wk.indexOf('async function fiReport('), wk.indexOf('async function fiStructure('))));
  console.log(fail ? `FAIL ${fail}/${pass + fail}` : `ok ${pass}/${pass}`);
  process.exit(fail ? 1 : 0);
})();
