// Max price (Nov 5 2026, Brett): a per-WO / per-template ceiling the VENDOR sees but that never reaches a description, invoice, tenant or owner.
// Runs the REAL worker functions (ceiling math, the bill gate, the admin setter) and pins every place worker.js is allowed to mention Max_Price,
// so a future change that copies it onto an invoice, a QuickBooks line, a tenant/owner view or the WO description fails the build.
import fs from 'fs';
import assert from 'node:assert';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const worker = read('worker.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const grab = (re) => { const m = worker.match(re); assert.ok(m, 'could not find ' + re); return m[0]; };

const src = [
  /function maxPriceNum\([\s\S]*?\n\}\n/, /function estimateSubtotalOf\([\s\S]*?\n\}\n/, /function woMaxCeiling\([\s\S]*?\n\}\n/, /function maxPriceMoney\([^\n]*\n/,
  /async function maxPriceGateResponse\([\s\S]*?\n\}\n/, /function vendorWantsSpanish\([^\n]*\n/, /async function setWoMaxPrice\([\s\S]*?\n\}\n/,
].map(grab).join('');

const json = (b, s = 200) => ({ body: b, status: s });
function mk(tabs, opts = {}) {
  const calls = { updates: [], audits: [], ensured: [] };
  const fetchTab = async (env, tab) => { if (opts.failTab === tab) throw new Error('sheet read failed'); return tabs[tab] || []; };
  const findWO = (rows, id) => rows.find(r => String(r.ID) === String(id));
  const ensureColumns = async (env, tab, cols) => { calls.ensured.push(tab + ':' + cols.join()); };
  const updateWOFields = async (env, id, f) => { calls.updates.push([id, f]); if (!opts.dropWrites) Object.assign(tabs.Work_Orders.find(r => r.ID === id), f); };
  const invalidateTabCache = () => {};
  const logWOAudit = async (...a) => { calls.audits.push(a); };
  const lib = new Function('json', 'fetchTab', 'findWO', 'ensureColumns', 'updateWOFields', 'invalidateTabCache', 'logWOAudit',
    src + '; return { maxPriceNum, woMaxCeiling, maxPriceGateResponse, setWoMaxPrice };')(json, fetchTab, findWO, ensureColumns, updateWOFields, invalidateTabCache, logWOAudit);
  return { ...lib, calls };
}

// --- reading the amount ---
{
  const { maxPriceNum } = mk({});
  eq(maxPriceNum('350'), 350, 'plain number');
  eq(maxPriceNum('$1,250.5'), 1250.5, 'dollar sign and commas');
  eq(maxPriceNum(' 99.999 '), 100, 'rounds to cents');
  for (const bad of ['', null, undefined, 'abc', '0', '-5', 0, NaN]) eq(maxPriceNum(bad), 0, 'no max for ' + String(bad));
}

// --- the ceiling: the max, or the latest APPROVED estimate if higher ---
{
  const { woMaxCeiling } = mk({});
  const wo = { ID: 'WO-1', Max_Price: '300.00' };
  eq(woMaxCeiling({ ID: 'WO-1' }, []), 0, 'no max set = no ceiling');
  eq(woMaxCeiling(wo, []), 300, 'no estimates: the max');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-1', Version: '1', Status: 'Pending', Subtotal: '500.00' }]), 300, 'a pending estimate does not raise it');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-1', Version: '1', Status: 'Declined', Subtotal: '500.00' }]), 300, 'a declined estimate does not raise it');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-1', Version: '1', Status: 'Approved', Subtotal: '450.00' }]), 450, 'an approved estimate raises it');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-1', Version: '1', Status: 'Converted', Subtotal: '600.00' }]), 600, 'an approved estimate pushed into a proposal still counts');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-1', Version: '1', Status: 'Approved', Subtotal: '450.00' }, { WO_ID: 'WO-1', Version: '2', Status: 'Approved', Subtotal: '320.00' }]), 320, 'the latest approved version wins');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-1', Version: '1', Status: 'Approved', Subtotal: '200.00' }]), 300, 'an approved estimate below the max never lowers it');
  eq(woMaxCeiling(wo, [{ WO_ID: 'WO-2', Version: '1', Status: 'Approved', Subtotal: '900.00' }]), 300, 'another job\'s estimate is ignored');
}

// --- the bill gate ---
{
  const tabs = { Work_Orders: [], Estimates: [], Vendors: [{ ID: 'V1', Language: 'en' }, { ID: 'V2', Language: 'es' }] };
  const { maxPriceGateResponse: gate } = mk(tabs);
  const wo = { ID: 'WO-1', Max_Price: '300.00' };
  eq(await gate({}, { ID: 'WO-1' }, 'V1', 99999), null, 'no max set: never blocks');
  eq(await gate({}, wo, 'V1', 300), null, 'exactly the max is fine');
  eq(await gate({}, wo, 'V1', '$250.00'), null, 'under the max is fine');
  eq(await gate({}, wo, 'V1', ''), null, 'no amount: nothing to compare');
  const r = await gate({}, wo, 'V1', '301');
  ok(r && r.status === 409 && r.body.code === 'over_max', 'over the max is refused with a 409 over_max');
  ok(r.body.max === 300 && r.body.ceiling === 300 && r.body.total === 301 && r.body.lang === 'en', 'the answer says the max, the ceiling and the total');
  ok(/max price/i.test(r.body.error) && /new estimate/i.test(r.body.error) && /\$301/.test(r.body.error) && /\$300/.test(r.body.error), 'the message offers: accept the max or send a new estimate');
  const es = await gate({}, wo, 'V2', 301);
  ok(es.body.lang === 'es' && /precio máximo/.test(es.body.error) && /presupuesto/.test(es.body.error), 'a Spanish-speaking vendor gets Spanish');
  ok((await gate({}, wo, '', 301, 'es')).body.lang === 'es', 'the language hint is honoured when the vendor is unknown');
  tabs.Estimates.push({ WO_ID: 'WO-1', Version: '1', Status: 'Pending', Subtotal: '500.00' });
  ok((await gate({}, wo, 'V1', 450)).status === 409, 'a pending estimate does not unlock a bigger bill');
  tabs.Estimates[0].Status = 'Approved'; tabs.Estimates[0].Subtotal = '450.00';
  eq(await gate({}, wo, 'V1', 450), null, 'an approved estimate covers a bill up to its amount');
  const r2 = await gate({}, wo, 'V1', 451);
  ok(r2.status === 409 && r2.body.ceiling === 450, 'but not above it');
}
{
  const { maxPriceGateResponse: gate } = mk({ Vendors: [] }, { failTab: 'Estimates' });
  const wo = { ID: 'WO-1', Max_Price: '300.00' };
  ok((await gate({}, wo, '', 301)).status === 409, 'if estimates cannot be read the bill over the max is still held (fails closed)');
  eq(await gate({}, wo, '', 300), null, 'and a bill within the max still goes through');
}

// --- the admin setter ---
{
  const tabs = { Work_Orders: [{ ID: 'WO-9', Max_Price: '' }] };
  const { setWoMaxPrice: set, calls } = mk(tabs);
  eq((await set({}, {})).status, 400, 'needs a work order');
  for (const bad of ['abc', '0', '-5', '2000000']) eq((await set({}, { wo_id: 'WO-9', max_price: bad })).status, 400, 'refuses ' + bad);
  eq((await set({}, { wo_id: 'WO-404', max_price: '100' })).status, 404, 'unknown work order');
  eq(calls.updates.length, 0, 'nothing written for a refused request');
  const a = await set({}, { wo_id: 'WO-9', max_price: '$1,250.5' });
  ok(a.status === 200 && a.body.success && a.body.max_price === '1250.50', 'saved as a clean 2-decimal amount');
  ok(calls.ensured.includes('Work_Orders:Max_Price'), 'the column is created on first use');
  eq(calls.audits.length, 1, 'the change is logged');
  ok(calls.audits[0][4] === 'Max_Price' && calls.audits[0][5] === '' && calls.audits[0][6] === '1250.50', 'with old and new value');
  await set({}, { wo_id: 'WO-9', max_price: '1250.50' });
  eq(calls.audits.length, 1, 'saving the same amount again logs nothing new');
  const c = await set({}, { wo_id: 'WO-9', max_price: '' });
  ok(c.body.success && c.body.max_price === '' && tabs.Work_Orders[0].Max_Price === '', 'a blank clears it');
}
{
  const { setWoMaxPrice: set } = mk({ Work_Orders: [{ ID: 'WO-9', Max_Price: '' }] }, { dropWrites: true });
  const r = await set({}, { wo_id: 'WO-9', max_price: '100' });
  ok(r.status === 500 && r.body.saved === false, 'if the sheet did not keep it, it says so instead of reporting saved');
}

// --- only the admin can set it ---
const rsAt = worker.indexOf('const ROLE_SCOPES = {'); ok(rsAt >= 0, 'ROLE_SCOPES exists');
const scopes = worker.slice(rsAt, worker.indexOf('\n};', rsAt));
ok(!scopes.includes("'/wo/max-price'"), 'no portal role is allowed to call /wo/max-price');
const pp = worker.match(/const PUBLIC_PATHS = \[[\s\S]*?\];/); ok(pp && !pp[0].includes('/wo/max-price'), '/wo/max-price is not a public path');
ok(/if \(path === '\/wo\/max-price'\)\s+return await setWoMaxPrice\(env, body\)/.test(worker), 'route is registered');
{
  const line = grab(/if \(callerRole && body && typeof body === 'object'\) \{ delete body\.max_price;[^\n]*\n/);
  const strip = new Function('callerRole', 'body', line + '; return body;');
  for (const role of ['vendor', 'tenant', 'owner']) {
    const b = strip(role, { max_price: '1', Max_Price: '1', fields: { Max_Price: '1', Status: 'x' }, note: 'keep' });
    ok(!('max_price' in b) && !('Max_Price' in b) && !('Max_Price' in b.fields) && b.fields.Status === 'x' && b.note === 'keep', role + ' session cannot send a max price, other fields untouched');
  }
  const adminBody = strip(null, { max_price: '5', fields: { Max_Price: '5' } });
  ok(adminBody.max_price === '5' && adminBody.fields.Max_Price === '5', 'the admin (no portal role) can');
  ok(worker.indexOf(line.trim()) < worker.indexOf('const _mmb = sessionIdentityMismatch(callerRole, callerSessionId, null, body)'), 'the strip runs before anything reads the body');
}

// --- where worker.js may mention Max_Price at all ---
{
  const lines = worker.split('\n'), fnAt = [];
  lines.forEach((l, i) => { const m = l.match(/^(?:async )?function (\w+)\(/); if (m) fnAt.push([i, m[1]]); });
  const enclosing = (i) => { let name = '(top level)'; for (const [fi, nm] of fnAt) { if (fi <= i) name = nm; else break; } return name; };
  const allowed = new Set(['createWorkOrder', 'assignVendor', 'enrichWO', 'maxPriceNum', 'estimateSubtotalOf', 'woMaxCeiling', 'maxPriceGateResponse', 'setWoMaxPrice',
    'recurSanitizeTemplateFields', 'recurPostWO', 'woSharedRead', 'addEstimateVersion', 'getWOAudit']);
  const seen = new Set();
  lines.forEach((l, i) => {
    if (!/Max_Price|max_price/.test(l)) return;
    if (/^\s*\/\//.test(l)) return;
    if (/delete body\.max_price/.test(l)) return;   // the router strip
    if (/^const RECUR_TEMPLATE_COLS/.test(l)) return;
    const fn = enclosing(i); seen.add(fn);
    ok(allowed.has(fn), 'Max_Price appears in ' + fn + ' (line ' + (i + 1) + ') — it may only live in the vendor-facing functions. If this is intentional, check it cannot reach an invoice, QuickBooks line, description, tenant or owner view, then add it here.');
  });
  ok(seen.size >= 10, 'the scan is not vacuous (' + seen.size + ' functions seen)');
  const invoiceish = [...seen].filter(f => /invoice|quickbooks|^qb|proposal|statement|billing|receipt|owner|tenant/i.test(f) && !['createWorkOrder'].includes(f));
  eq(invoiceish, [], 'no invoice / QuickBooks / proposal / statement / owner / tenant function mentions it');
  ok(/const RECUR_TEMPLATE_COLS = \[[^\]]*'Max_Price'\]/.test(worker), 'templates carry the column');
}

// --- never in a tenant / owner / shared view ---
{
  const e0 = worker.indexOf('function enrichWO('), e1 = worker.indexOf('\n}\n', e0), body = worker.slice(e0, e1);
  ok(/if \(!opts\.vendorView\) delete base\.Max_Price;/.test(body), 'enrichWO strips it unless this is the vendor portal view');
  ok(body.indexOf('delete base.Max_Price') > body.indexOf('...wo,') && body.indexOf('delete base.Max_Price') < body.indexOf('return base;'), 'and strips it after the whole row is copied in');
  ok(/const e = enrichWO\(wo, properties, units, tenants, keys, \{ tradeAccessDefaults, vendors, viewingVendorId: vendorRec\.ID \}/.test(worker), 'the shared link does not ask for vendorView');
  ok(/auth\.vid && String\(auth\.vid\) === String\(wo\.Vendor_ID/.test(worker), 'the shared link adds it only for the assigned vendor\'s own link');
  ok(/enrichWO\(wo, properties, units, tenants, keys, \{ omitLockbox: true, tenantView: true, vendors \}\)/.test(worker) && /ownerView: true, vendors \}\)/.test(worker), 'tenant and owner lists go through enrichWO (so they never carry it)');
  const a0 = worker.indexOf('async function getWOAudit('), audit = worker.slice(a0, worker.indexOf('\n}\n', a0));
  ok(/if \(callerRole\)/.test(audit) && /a\.Field !== 'Max_Price'/.test(audit) && /Precio máximo/.test(audit), 'the owner-readable audit log hides the change rows and the line in the vendor text');
  ok(/getWOAudit\(env, url, callerRole\)/.test(worker), 'the audit read is told who is asking');
  for (const page of ['tenant.html', 'owner.html']) ok(!/Max_Price|max_price|Max price/i.test(read(page)), page + ' never mentions it');
}

// --- the vendor text, the bill gate, the estimate rule ---
{
  const av = worker.slice(worker.indexOf('async function assignVendor('));
  ok(/Max price: \$\{_mpFmt\} — send a new estimate with your reason before going over\./.test(av) && /Precio máximo: \$\{_mpFmt\}/.test(av), 'the vendor job text carries an English and a Spanish max-price line');
  ok(/\$\{_mpLineEn\}\\n\$\{link\}/.test(av) && /\$\{_mpLineEs\}\\n\$\{link\}/.test(av), 'right before the link');
  ok(/const _mpAssign = Number\.isFinite\(_mpAssignRaw\)/.test(av) && /wo\.Max_Price == null/.test(av) && /_mpAssign \? ` Max price/.test(av), 'and only on a WO that has a max');
  const b0 = worker.indexOf('async function addVendorBill('), bill = worker.slice(b0, worker.indexOf('const dupe = await findRecentDuplicate', b0));
  ok(bill.indexOf("toLowerCase() !== 'hub'") >= 0 && bill.indexOf('maxPriceGateResponse(') > bill.indexOf("toLowerCase() !== 'hub'") && bill.indexOf('maxPriceGateResponse(') > bill.indexOf('checklistGateResponse('), 'vendor bills (portal and share link) go through the gate; the Hub is not gated');
  ok(/maxPriceGateResponse\(env, _gwo, body\.Vendor_ID \|\| body\.vendor_id \|\| _gwo\.Vendor_ID, body\.Total, body\.lang\)/.test(bill), 'with the bill total');
  const e0 = worker.indexOf('async function addEstimateVersion('), est = worker.slice(e0, worker.indexOf('\n}\n', e0));
  ok(/over_max_reason_needed/.test(est) && /body\.over_max_reason/.test(est) && /_estByAdmin/.test(est), 'a vendor estimate over the max needs a reason; the Hub is exempt');
  ok(/Over_Max_Reason/.test(est) && /Over_Max_Reason_EN/.test(est) && !/row\.Max_Price|Max_Price:/.test(est), 'the reason is stored on the estimate, the max amount is not');
  ok(/OVER MAX/.test(est), 'Brett\'s estimate text says OVER MAX');
}

// --- screens ---
{
  const hub = read('index.html'), vendor = read('vendor.html'), wo = read('wo.html');
  ok(/id="wo-max-price"/.test(hub) && /max_price:\(\(document\.getElementById\('wo-max-price'\)/.test(hub), 'New WO form sends it');
  ok(/id="tmpl-max-price"/.test(hub) && /Max_Price: document\.getElementById\('tmpl-max-price'\)\.value\.trim\(\)/.test(hub) && /t\.Max_Price/.test(hub), 'template editor saves and loads it');
  ok(/_tmx\.value = t\.Max_Price/.test(hub), 'a template prefills the New WO form');
  ok(/api\('POST','\/wo\/max-price'/.test(hub) && /MAX PRICE \(vendor sees this · never on invoices\)/.test(hub), 'WO detail has the set / clear box');
  ok(/OVER MAX PRICE/.test(hub) && /Over_Max_Reason_EN/.test(hub), 'the estimate panel flags an over-max estimate with the reason');
  ok(/woMaxBanner\(wo\) \+/.test(vendor), 'the vendor job card shows the banner');
  const sv = vendor.slice(vendor.indexOf('function submitVendorBill()'), vendor.indexOf('function startBillReviewFlow()'));
  ok(sv.indexOf('billMaxCheck(total)') > 0 && sv.indexOf('billMaxCheck(total)') < sv.indexOf('startBillReviewFlow()'), 'billing checks the max before the review steps');
  ok(/function billAcceptMax\(/.test(vendor) && /function billProposeEstimate\(/.test(vendor), 'the vendor gets both choices: accept the max, or propose a new estimate');
  ok(/over_max_reason: overMaxReason/.test(vendor) && /est-overmax-wrap-/.test(vendor), 'the estimate editor asks for the reason when over');
  const es = vendor.slice(vendor.indexOf('var ES = {'), vendor.indexOf('function t(key)'));
  for (const k of ['MAX PRICE', 'Over the max price', 'why is it more?', 'This invoice is over the max price', 'Accept the max price', 'Send a new estimate with my reason', 'Invoice set to the max price. Check it, then tap Submit.', 'Lower your invoice by $', 'This estimate is over the max price — add the reason for the difference.']) ok(es.includes("'" + k + "':"), 'Spanish for: ' + k);
  ok(/if\(_mp>0\) h \+= row\(t\('Max price'\)/.test(wo) && wo.includes("'Max price':'Precio máximo'"), 'the vendor\'s no-login link shows it (English and Spanish)');
}

console.log(`wo-max-price: ${n} assertions passed`);
