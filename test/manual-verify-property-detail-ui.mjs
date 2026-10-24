// Headless Playwright pass over the REAL index.html for the Oct 24 2026 Properties page build (FEATURE_LOG rule 231):
// list badges + view filter, tap-to-open detail view, Settings / Info / Units / Cleanup tabs, customer apply-with-exclusions
// (preview, re-preview on exclusion, confirm), mark-duplicate and merge with a side-by-side pick, visible failures, 44px targets,
// 16px inputs, no sideways scroll at phone width, and the ?property=ID&tab=settings deep link. Only the Worker's fetch endpoints
// are intercepted; the app code is the real shipped file. Not part of `node --test` (needs a browser).
// Usage: node test/manual-verify-property-detail-ui.mjs [path/to/index.html]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const OWNERS = [{ ID: '7', First_Name: 'Amanda', Last_Name: 'I', Company: 'Phoenix', Active: 'TRUE', SMS_Enabled: 'TRUE' }, { ID: '24', First_Name: 'Greg', Last_Name: 'Overton', Company: '', Active: 'TRUE' }];
const PROPS = [
  { ID: '50', Address: '9 Elm St', City: 'Winchester', Type: 'multi', Unit_Count: '2', Owner_ID: '7', Active: 'TRUE', Market: 'Winchester', SMS_Enabled: 'TRUE', Lockbox_Code: '4321', Access_Notes: 'gate on left' },
  { ID: '51', Address: '100 Market St', City: 'Baltimore', Type: 'house', Unit_Count: '1', Owner_ID: '7', Active: 'TRUE', Market: 'Baltimore', SMS_Enabled: 'FALSE' },
  { ID: '93', Address: '411 W 23rd St', City: '', Type: 'rowhome', Unit_Count: '1', Owner_ID: '', Active: 'TRUE', Market: 'Baltimore' },
  { ID: '94', Address: '411 West 23rd St', City: 'Baltimore', Type: 'rowhome', Unit_Count: '1', Owner_ID: '24', Active: 'TRUE', Market: 'Baltimore', SMS_Enabled: 'TRUE' },
  { ID: '60', Address: '5 Old Rd', City: 'Baltimore', Type: 'house', Active: 'FALSE', Duplicate_Of: '94', Owner_ID: '' },
];
const UNITS = [{ ID: 'u1', Property_ID: '50', Unit_Label: 'Apt 1', Active: 'TRUE' }];
const REG = [
  { key: 'active', col: 'Active', kind: 'bool', group: 'Status', label: 'Active', help: 'Off hides the property from lists and pickers.', applyAll: false },
  { key: 'tenant_wo', col: 'Tenant_WO_Toggle', kind: 'tri', group: 'Requests', label: 'Tenants can submit work orders', help: 'Existing setting.', applyAll: false },
  { key: 'sms_master', col: 'SMS_Enabled', kind: 'bool', group: 'Texts', label: 'Texts for this property (master switch)', help: 'The existing property switch.', applyAll: true },
  { key: 'sms_tenants', col: 'SMS_Tenants_Enabled', kind: 'bool', group: 'Texts', label: 'Texts to tenants', help: 'Tenants only.', applyAll: true },
  { key: 'sms_owners', col: 'SMS_Owners_Enabled', kind: 'bool', group: 'Texts', label: 'Texts to the owner', help: 'Owner texts only.', applyAll: true },
  { key: 'sms_vendors', col: 'SMS_Vendors_Enabled', kind: 'bool', group: 'Texts', label: 'Texts to vendors', help: 'Vendor texts only.', applyAll: true },
  { key: 'owner_email', col: 'Owner_Email_Enabled', kind: 'bool', group: 'Email', label: 'Automatic owner emails', help: 'Heads-up emails.', applyAll: true },
];
const state = { cells: {} };   // per property: col -> value written by the mock
function togglesFor(p) {
  return REG.map(t => { const raw = String((state.cells[p.ID] || {})[t.col] ?? p[t.col] ?? '').trim(); const on = t.kind === 'tri' ? raw.toUpperCase() === 'ON' : raw.toUpperCase() !== 'FALSE'; return { ...t, raw, on, ...(t.key === 'tenant_wo' ? { effective: on } : {}) }; });
}
function detailFor(id) {
  const p = PROPS.find(x => x.ID === id); if (!p) return null;
  const owner = OWNERS.find(o => o.ID === p.Owner_ID);
  const merged = { ...p, ...(state.cells[id] || {}) };
  return {
    property: merged, headers: Object.keys(merged), toggles: togglesFor(merged), system_cols: ['ID', 'SMS_Enabled', 'Active'],
    groups: [{ key: 'basics', label: 'Basics', sensitive: false, cols: ['Address', 'City', 'Market', 'Type', 'Unit_Count', 'Owner_ID'].filter(c => c in merged) }, { key: 'access', label: 'Access (sensitive)', sensitive: true, cols: ['Lockbox_Code', 'Access_Notes'].filter(c => c in merged) }],
    customer: owner ? { id: owner.ID, name: owner.Company ? owner.Company + ' (' + owner.First_Name + ' ' + owner.Last_Name + ')' : owner.First_Name + ' ' + owner.Last_Name, sms_on: true, active: true, property_count: PROPS.filter(x => x.Owner_ID === owner.ID).length, same_company_owner_ids: [] } : null,
    owner_options: OWNERS.map(o => ({ id: o.ID, name: o.First_Name + ' ' + o.Last_Name })),
    units: UNITS.filter(u => u.Property_ID === id).map(u => ({ ...u, _tenants: ['Jo Tenant'] })), unit_fields: ['Unit_Label', 'Notes', 'Active', 'Lock_Code', 'HVAC_Filter_Size', 'HVAC_Change_Interval'], unit_new_cols: ['HVAC_Filter_Size', 'HVAC_Change_Interval'],
    duplicate: { of: merged.Duplicate_Of || '', of_address: merged.Duplicate_Of ? '411 West 23rd St' : '', marked_date: merged.Duplicate_Of ? '2026-10-24' : '', merge_log: '', duplicates_of_me: id === '94' ? [{ id: '60', address: '5 Old Rd' }] : [] },
    candidates: PROPS.filter(x => x.ID !== id && !x.Duplicate_Of).map(x => ({ id: x.ID, address: x.Address, city: x.City || '', owner_id: x.Owner_ID || '', active: x.Active !== 'FALSE' })),
    missing_columns: ['SMS_Tenants_Enabled', 'SMS_Owners_Enabled', 'SMS_Vendors_Enabled', 'Owner_Email_Enabled', 'Duplicate_Of', 'Duplicate_Marked_Date', 'Merge_Log'],
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });   // a phone: the app's touch-only 16px input rule applies
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
let dialogMode = 'accept'; const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); return dialogMode === 'accept' ? d.accept() : d.dismiss(); });   // the confirm() prompts (apply, merge, mark duplicate, leave-without-saving)
await page.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
const posts = []; const gets = []; let failNext = null;
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
await page.route('**/*', async route => {
  const req = route.request(); const u = new URL(req.url());
  if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  const p = u.pathname, body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
  if (body) posts.push({ p, body }); else gets.push(p + u.search);
  if (p === '/hub-bootstrap') return json(route, { properties: PROPS, units: UNITS, tenants: [], vendors: [], workorders: [], invoices: [], owners: OWNERS, keys: [] });
  if (p === '/property/detail') { const d = detailFor(u.searchParams.get('id')); return d ? json(route, d) : json(route, { error: 'Property not found' }, 404); }
  if (failNext && p === failNext.path) { const f = failNext; failNext = null; return json(route, f.body, f.status); }
  if (p === '/property/toggle') { const t = REG.find(r => r.key === body.key); (state.cells[body.property_id] = state.cells[body.property_id] || {})[t.col] = body.value; return json(route, { ok: true, key: body.key, property_id: body.property_id, col: t.col, before: '', value: body.value, on: t.kind === 'tri' ? body.value === 'ON' : body.value !== 'FALSE' }); }
  if (p === '/owner/property-toggle-preview' || p === '/owner/property-toggle-apply') {
    const excl = body.exclude_ids || [];
    const rows = PROPS.filter(x => x.Owner_ID === body.owner_id).map(x => { const inactive = x.Active === 'FALSE'; const ex = excl.includes(x.ID); const before = true; const action = inactive ? 'skip_inactive' : ex ? 'excluded' : 'change'; return { property_id: x.ID, address: x.Address, city: x.City, before_raw: '', before_on: before, after_on: action === 'change' ? body.value === 'TRUE' : before, after_value: action === 'change' ? body.value : '', action }; });
    const counts = { total: rows.length, will_change: rows.filter(r => r.action === 'change').length, unchanged: 0, excluded: rows.filter(r => r.action === 'excluded').length, inactive: rows.filter(r => r.action === 'skip_inactive').length };
    const view = { key: body.key, label: REG.find(r => r.key === body.key).label, col: REG.find(r => r.key === body.key).col, value: body.value, rows, counts, token: 'T' + excl.join('-') };
    return p.endsWith('preview') ? json(route, { ok: true, preview: true, ...view }) : (body.confirm === true && body.token === view.token ? json(route, { ok: true, applied: counts.will_change, verified: true, ...view }) : json(route, { error: 'refused' }, 409));
  }
  if (p === '/property/info-save') return json(route, { ok: true, property_id: body.property_id, changed: Object.keys(body.fields) });
  if (p === '/property/unit-save') return json(route, { ok: true, unit_id: body.unit_id, changed: Object.keys(body.fields) });
  if (p === '/property/mark-duplicate') return json(route, { ok: true, property_id: body.property_id, duplicate_of: body.duplicate_of, still_attached: { work_orders: 0, units: 0, tenants: 0 }, note: 'Marked and hidden. It has no work orders, units or tenants.' });
  if (p === '/property/merge-preview') return json(route, { preview: true, ok: true, blocks: [], warnings: ['Text that merely mentions the old address is not rewritten.'], from: { id: body.from_id, address: '411 W 23rd St', city: '' }, to: { id: body.to_id, address: '411 West 23rd St', city: 'Baltimore' }, auto: [{ col: 'Owner_ID', value: '24' }], conflicts: [{ col: 'Address', from: '411 W 23rd St', to: '411 West 23rd St' }], same_fields: 3, tabs: [{ tab: 'Work_Orders', col: 'Property_ID', count: 2 }, { tab: 'Master_Keys', col: 'Property_IDs', count: 1 }], tabs_checked: 12, unknown_columns: [], total_rows_to_move: 3, unit_count_after: 1, token: 'MTOKEN' });
  if (p === '/property/merge-apply') return body.confirm === true && body.token === 'MTOKEN' && body.resolutions.Address === 'to' ? json(route, { ok: true, merged: true, from_id: body.from_id, to_id: body.to_id, moved: { Work_Orders: 2, Master_Keys: 1 }, total_rows_moved: 3, fields_taken: [] }) : json(route, { error: 'refused' }, 409);
  if (p === '/tenant-wo-settings') return json(route, { owners: [], properties: [] });
  if (p === '/config') return json(route, {});
  return json(route, req.method() === 'GET' ? [] : { success: true });
});
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForFunction(() => window.state && window.state.properties && window.state.properties.length === 5, null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => typeof window.openPropertyDetail === 'function'), 'Hub loaded with openPropertyDetail present');
await page.evaluate(() => showPage('properties', null)); await page.evaluate(() => renderPropertiesPage());

console.log('(1) list: badges, hidden view, no extra reads');
const getsBefore = gets.length;
let txt = await page.innerText('#properties-list');
ok(/411 West 23rd St/.test(txt) && !/5 Old Rd/.test(txt), 'active list hides the inactive duplicate');
ok(await page.locator('#prop-card-50 .pbadge.on').count() === 1, 'property 50 shows an "SMS on" badge');
ok(await page.locator('#prop-card-51 .pbadge.off').count() === 1, 'property 51 (master OFF) shows an "SMS off" badge');
await page.selectOption('#prop-view', 'hidden');
txt = await page.innerText('#properties-list');
ok(/5 Old Rd/.test(txt) && /Duplicate of #94/.test(txt) && !/9 Elm St/.test(txt), 'Hidden view lists only the duplicate, labelled "Duplicate of #94"');
await page.selectOption('#prop-view', 'active');
ok(gets.length === getsBefore, 'switching list views makes no extra server read');

console.log('(2) open detail lazily, Settings tab');
await page.click('#prop-card-50 .prop-row-main span[style*="font-weight:bold"]');
await page.waitForSelector('#modal-prop-detail.open .pd-sw');
ok(gets.filter(g => g.startsWith('/property/detail')).length === 1 && gets.includes('/property/detail?id=50'), 'tapping the row reads /property/detail once, for that property only');
ok(await page.locator('.pd-row').count() === 7, 'all 7 registry switches are listed');
ok(/Not set in the sheet, so it counts as ON/.test(await page.innerText('#pd-body')), 'a blank new column is described as ON');
ok(/Phoenix \(Amanda I\)/.test(await page.innerText('#pd-body')), 'the customer is named');
await page.click('[data-act="toggle"][data-key="sms_owners"]');
await page.waitForFunction(() => document.querySelector('[data-key="sms_owners"]').textContent.trim() === 'OFF');
const tp = posts.filter(x => x.p === '/property/toggle').pop();
ok(tp && tp.body.property_id === '50' && tp.body.key === 'sms_owners' && tp.body.value === 'FALSE', 'toggle posts the right body: ' + JSON.stringify(tp && tp.body));
ok(await page.locator('#prop-card-50 .pbadge.warn').count() === 1 && /no owner/.test(await page.innerText('#prop-card-50')), 'the list badge follows: "SMS: no owner"');
failNext = { path: '/property/toggle', status: 500, body: { ok: false, error: 'Not saved: Properties row 50 did not keep: SMS_Vendors_Enabled' } };
await page.click('[data-act="toggle"][data-key="sms_vendors"]');
await page.waitForSelector('#pd-msg.err');
ok(/Not saved/.test(await page.innerText('#pd-msg')) && /did not keep/.test(await page.innerText('#pd-msg')), 'FAULT: a failed write shows a red message with the real reason');
ok((await page.innerText('[data-key="sms_vendors"]')).trim() === 'ON', 'and the switch still shows the true (unchanged) state');

console.log('(3) customer apply with exclusions');
await page.click('[data-act="ap-open"]');
await page.selectOption('[data-f="key"]', 'sms_owners');
await page.click('[data-act="ap-preview"]');
await page.waitForSelector('.pd-trow');
ok(await page.locator('.pd-apply .pd-trow').count() === 2, 'preview lists both of the customer\'s active properties');
ok(/nothing is saved yet/i.test(await page.innerText('#pd-ap-out')), 'the preview says nothing is saved yet');
await page.locator('[data-chg="ap-excl"][data-id="51"]').check();
await page.waitForFunction(() => /1 left out/.test(document.querySelector('#pd-ap-out').innerText));
const pv2 = posts.filter(x => x.p === '/owner/property-toggle-preview').pop();
ok(JSON.stringify(pv2.body.exclude_ids) === '["51"]', 'ticking Leave out re-previews with exclude_ids ["51"]');
ok(!posts.some(x => x.p === '/owner/property-toggle-apply'), 'nothing has been applied yet');
await page.click('[data-act="ap-apply"]');
await page.waitForSelector('.pd-apply .pd-msg.ok');
const ap = posts.filter(x => x.p === '/owner/property-toggle-apply').pop();
ok(ap && ap.body.confirm === true && ap.body.token === 'T51' && ap.body.exclude_ids[0] === '51', 'apply sends confirm:true, the preview token and the exclusions');
ok(/Done and checked/.test(await page.innerText('#pd-ap-out')), 'shows the verified result');

console.log('(4) Info tab');
await page.click('[data-act="tab"][data-tab="info"]');
await page.waitForSelector('[data-pdcol="City"]');
ok(await page.locator('[data-pdcol="Lockbox_Code"]').count() === 0, 'lockbox/door codes are NOT in the page until revealed');
await page.fill('[data-pdcol="City"]', 'Towson');
await page.click('[data-act="info-save"]');
await page.waitForFunction(() => document.querySelector('#toast-container').innerText.includes('Saved: City'));
const isv = posts.filter(x => x.p === '/property/info-save').pop();
ok(JSON.stringify(isv.body.fields) === '{"City":"Towson"}', 'only the changed field is sent');
await page.fill('[data-pdcol="City"]', 'Elsewhere');
dialogMode = 'dismiss';
await page.click('[data-act="tab"][data-tab="units"]');
dialogMode = 'accept';
ok(await page.locator('[data-pdcol="City"]').count() === 1, 'unsaved typing: dismissing the "leave?" prompt keeps you on the tab');
await page.fill('[data-pdcol="City"]', 'Towson');
await page.click('[data-act="reveal"]');
await page.waitForSelector('[data-pdcol="Lockbox_Code"]');
ok(true, 'Show access details reveals the code fields');

console.log('(5) Units tab');
await page.click('[data-act="tab"][data-tab="units"]');
await page.waitForSelector('[data-ucol="HVAC_Filter_Size"]');
ok(/new — the sheet column is created when you save/.test(await page.innerText('#pd-body')), 'HVAC filter size is offered even before the column exists');
await page.fill('[data-ucol="HVAC_Filter_Size"]', '16x25x1');
await page.click('[data-act="unit-save"]');
await page.waitForFunction(() => document.querySelector('#toast-container').innerText.includes('Unit saved'));
ok(JSON.stringify(posts.filter(x => x.p === '/property/unit-save').pop().body) === '{"unit_id":"u1","fields":{"HVAC_Filter_Size":"16x25x1"}}', 'unit save posts only the changed field');

console.log('(6) Cleanup: mark duplicate and merge (property 93 into 94, as unit-test fixtures only)');
await page.evaluate(() => { document.getElementById('modal-prop-detail').classList.remove('open'); });
await page.evaluate(() => openPropertyDetail('93', 'cleanup'));
await page.waitForSelector('#pd-ps-merge');
ok(await page.locator('#pd-ps-merge option').count() > 2, 'the picker lists other properties');
await page.fill('#pd-pq-merge', '411 West');
ok(await page.locator('#pd-ps-merge option').count() === 2, 'typing narrows the picker to the match');
await page.selectOption('#pd-ps-merge', '94');
await page.click('#pd-mg-btn');
await page.waitForSelector('.pd-conf');
ok(await page.locator('.pd-opt').count() === 2 && /411 W 23rd St/.test(await page.innerText('.pd-conf')) && /411 West 23rd St/.test(await page.innerText('.pd-conf')), 'only the conflicting field is a side-by-side pick (Address)');
ok(await page.isDisabled('[data-act="merge-apply"]'), 'Merge button is disabled until the pick is made');
ok(/Work_Orders/.test(await page.innerText('#pd-merge-out')) && /rows that will move \(3\)/i.test(await page.innerText('#pd-merge-out')), 'per-sheet row counts are shown before confirming');
ok(!posts.some(x => x.p === '/property/merge-apply'), 'nothing merged yet');
await page.locator('input[name="pd-cf-Address"][value="to"]').check();
await page.waitForFunction(() => !document.querySelector('[data-act="merge-apply"]').disabled);
await page.click('[data-act="merge-apply"]');
await page.waitForSelector('.pd-msg.ok');
const ma = posts.filter(x => x.p === '/property/merge-apply').pop();
ok(ma && ma.body.confirm === true && ma.body.token === 'MTOKEN' && ma.body.resolutions.Address === 'to' && ma.body.from_id === '93' && ma.body.to_id === '94', 'merge-apply sends confirm, token and the picked value');
ok(/Merged and checked/.test(await page.innerText('#pd-body')), 'the result says merged and checked');

console.log('(7) phone-width layout and tap targets');
await page.evaluate(() => openPropertyDetail('50', 'settings'));
await page.waitForSelector('.pd-sw');
const small = await page.evaluate(() => Array.from(document.querySelectorAll('#modal-prop-detail button, #modal-prop-detail select, #modal-prop-detail input:not([type=checkbox]):not([type=radio]), #modal-prop-detail .pd-chk')).filter(e => e.offsetParent !== null).map(e => ({ t: (e.textContent || e.name || e.tagName).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height), fs: parseFloat(getComputedStyle(e).fontSize), tag: e.tagName })).filter(x => x.h < 44));
ok(small.length === 0, 'every visible button/select/input/label in the detail view is >= 44px tall' + (small.length ? ': ' + JSON.stringify(small.slice(0, 5)) : ''));
const fields = await page.evaluate(() => { openPropertyDetail('50', 'info'); return null; });
await page.waitForSelector('[data-pdcol="City"]');
const fs = await page.evaluate(() => Array.from(document.querySelectorAll('#modal-prop-detail input[type=text], #modal-prop-detail textarea, #modal-prop-detail select')).map(e => parseFloat(getComputedStyle(e).fontSize)));
ok(fs.length > 0 && fs.every(f => f >= 16), 'text inputs, textareas and selects are all >= 16px (no iOS zoom)');
const sw = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, modal: Math.round(document.querySelector('#modal-prop-detail .modal').getBoundingClientRect().width) }));
ok(sw.doc <= sw.win, 'no sideways scroll at 412px (' + sw.doc + ' <= ' + sw.win + ')');

console.log('(8) deep link ?property=ID&tab=settings');
const page2 = await browser.newPage({ viewport: { width: 412, height: 915 } });
await page2.addInitScript(() => { try { localStorage.setItem('mh_auth', 'TEST-TOKEN'); } catch (e) {} });
page2.on('pageerror', e => errors.push(String(e)));
await page2.route('**/*', async route => {
  const req = route.request(); const u = new URL(req.url());
  if (!/workers\.dev$/.test(u.hostname)) return route.continue();
  if (u.pathname === '/hub-bootstrap') return json(route, { properties: PROPS, units: UNITS, tenants: [], vendors: [], workorders: [], invoices: [], owners: OWNERS, keys: [] });
  if (u.pathname === '/property/detail') return json(route, detailFor(u.searchParams.get('id')));
  return json(route, req.method() === 'GET' ? [] : { success: true });
});
await page2.goto('file://' + target + '?property=51&tab=settings', { waitUntil: 'load' });
await page2.waitForSelector('#modal-prop-detail.open .pd-sw', { timeout: 10000 }).catch(() => {});
ok(await page2.locator('#modal-prop-detail.open .pd-sw').count() > 0, 'the link opens the detail view on its Settings tab');
ok((await page2.getAttribute('.pd-tab[data-tab="settings"]', 'aria-selected')) === 'true' && /100 Market St/.test(await page2.innerText('#pd-title')), 'for the right property');

ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
