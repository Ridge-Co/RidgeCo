// DEMO SAMPLE DATA (Nov 12 2026, Phase 3a): each slot is handed out with 8 sample work orders, photos and a fictional receipt, rebuilt after every reset.
// Drives the REAL worker.js over a fake Google Sheets with a fake Twilio and fake Gmail (shared harness: _demo-world.mjs).
import fs from 'fs';
import { root, wsrc, store, outbound, worker, call, tab, adminCall, rows, rowOf, login, PH1, PH2, realWo, realWoBefore, grab, grabConst } from './_demo-world.mjs';
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ===== 1. Pure seed rows =====
const pure = new Function(grabConst('DEMO_OWNER_IDLE') + '\n' + grabConst('DEMO_TENANT_IDLE') + '\n' + grabConst('DEMO_ASSET_BASE') + '\n' + ['demoTrue', 'demoFixture', 'demoSeedRows'].map(grab).join('\n') + '\nreturn { demoFixture, demoSeedRows, DEMO_ASSET_BASE };')();
const NOW = Date.parse('2026-11-12T15:00:00Z');
const s1 = pure.demoSeedRows(1, NOW), s2 = pure.demoSeedRows(2, NOW), fx1 = pure.demoFixture(1);
t('seed: 8 sample work orders and 7 attachments per slot', s1.wos.length === 8 && s1.atts.length === 7);
t('seed: ids are unique across slots (WO-D1nn vs WO-D2nn, DA1nn vs DA2nn)', ![...s1.wos, ...s1.atts].some(a => [...s2.wos, ...s2.atts].some(b => b.ID === a.ID)) && new Set(s1.wos.map(w => w.ID)).size === 8);
t('seed: every sample work order is flagged demo and sits on this slot\'s own fake properties and units', s1.wos.every(w => w.Is_Demo === 'TRUE' && fx1.props.some(p => p.ID === w.Property_ID) && fx1.units.some(u => u.ID === w.Unit_ID && u.Property_ID === w.Property_ID)));
t('seed: no vendor on any sample work order, and nothing is set to notify (cannot queue a message)', s1.wos.every(w => w.Vendor_ID === '' && w.Tenant_Notify_Created === 'FALSE' && w.Tenant_Notify_Updates === 'FALSE' && w.Owner_Notify_Override === 'off' && w.Owner_Notified === 'FALSE' && w.Vendor_SMS_Sent === 'FALSE'));
t('seed: a mix of statuses (New, Assigned, Accepted/scheduled, In Progress, On Hold, Complete)', ['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Complete'].every(st => s1.wos.some(w => w.Status === st)));
t('seed: scheduled job has a date and window; finished jobs have a completed date', s1.wos.filter(w => w.Status === 'Accepted').every(w => /^\d{4}-\d\d-\d\d$/.test(w.Scheduled_Date) && w.Scheduled_Window) && s1.wos.filter(w => w.Status === 'Complete').every(w => /^\d{4}-\d\d-\d\d$/.test(w.Completed_Date)));
t('seed: dates are relative to now (a later slot hand-out gets later dates)', pure.demoSeedRows(1, NOW + 5 * 86400000).wos[5].Completed_Date > s1.wos[5].Completed_Date);
t('seed: the demo tenant has two jobs of their own that they can see; other jobs belong to nobody', s1.wos.filter(w => w.Tenant_ID === 'DT1' && w.Tenant_Visible === 'TRUE').length === 2 && s1.wos.filter(w => w.Tenant_ID === '').length === 6);
t('seed: attachments belong to sample work orders; 3 completed jobs carry photos and/or a receipt', s1.atts.every(a => s1.wos.some(w => w.ID === a.WO_ID && w.Status === 'Complete')) && new Set(s1.atts.map(a => a.WO_ID)).size === 3 && s1.atts.filter(a => a.File_Type === 'receipt').length === 2);
t('seed: photo and receipt links point at the repo\'s /demo/ pictures and carry no Drive id', s1.atts.every(a => a.Drive_URL.startsWith(pure.DEMO_ASSET_BASE) && a.Drive_File_ID === '' && a.Drive_URL.endsWith('.svg')));
for (const f of ['photo-before.svg', 'photo-after.svg', 'receipt-sample.svg']) t('asset exists and is marked SAMPLE: demo/' + f, fs.existsSync(root + 'demo/' + f) && /SAMPLE/.test(fs.readFileSync(root + 'demo/' + f, 'utf8')));
t('asset: the receipt says it is fictional / not a real transaction', /NOT A REAL TRANSACTION/.test(fs.readFileSync(root + 'demo/receipt-sample.svg', 'utf8')) && !/<script|href=|http:\/\/(?!www\.w3\.org)/.test(fs.readFileSync(root + 'demo/receipt-sample.svg', 'utf8')));
t('guard: a text that names WO-D101 is recognised as demo (regex now allows the D)', /\\bWO\[-\\s#\]\?\(D\?\\d\+\)\\b/.test(wsrc));

// ===== 2. Handing out a slot seeds it =====
let r = await adminCall('POST', '/demo/add', { name: 'Ann Prospect', phone: PH1, email: 'Ann@Prospect.example' });
t('add: succeeds', r.status === 200 && r.json.slot === 1, r.json);
const PIN1 = r.json && r.json.pin;
const demoWos = () => rows('Work_Orders').filter(w => /^WO-D\d/.test(w.ID));
t('add: slot 1 now holds its 8 sample work orders, flagged demo, and 7 attachments', demoWos().filter(w => w.ID.startsWith('WO-D1')).length === 8 && demoWos().every(w => w.Is_Demo === 'TRUE') && rows('Attachments').filter(a => a.ID.startsWith('DA1')).length === 7);
t('add: real work order and real attachment untouched', realWo() === realWoBefore, []);
t('add: nothing was sent', outbound.length === 0, outbound.map(o => o.url));
r = await login('owner', 'Ann', PIN1);
const tokO = r.json && r.json.token;
r = await call('GET', '/owner-workorders?owner_id=DO1', tokO);
const ownerList = Array.isArray(r.json) ? r.json : (r.json && r.json.work_orders) || [];
t('owner portal: the demo owner sees all 8 sample work orders and none of the real one', r.status === 200 && ownerList.filter(w => String(w.ID).startsWith('WO-D1')).length === 8 && !ownerList.some(w => w.ID === 'WO-100'), { s: r.status, n: ownerList.length });
r = await call('GET', '/attachments?wo_id=WO-D106', tokO);
t('owner portal: a finished sample job returns its before, after and receipt pictures', r.status === 200 && Array.isArray(r.json) && ['before', 'after', 'receipt'].every(ty => r.json.some(a => a.File_Type === ty)), r.json);
r = await login('tenant', 'Ann', PIN1);
const tokT = r.json && r.json.token;
r = await call('GET', '/tenant-workorders?tenant_id=DT1', tokT);
const tenList = Array.isArray(r.json) ? r.json : (r.json && r.json.work_orders) || [];
t('tenant portal: the demo tenant sees their own two sample jobs and no other slot\'s or real jobs', r.status === 200 && tenList.filter(w => String(w.ID).startsWith('WO-D1')).length >= 2 && !tenList.some(w => w.ID === 'WO-100' || String(w.ID).startsWith('WO-D2')), { s: r.status, ids: tenList.map(w => w.ID) });
r = await adminCall('GET', '/workorders');
const adminList = Array.isArray(r.json) ? r.json : [];
t('Hub: sample work orders are hidden from the admin work-order list (and the real one is listed, so the check is meaningful)', r.status === 200 && adminList.some(w => w.ID === 'WO-100') && !adminList.some(w => String(w.ID).startsWith('WO-D')), adminList.map(w => w.ID));

// ===== 3. Reset wipes what the prospect made AND rebuilds the sample data =====
r = await call('POST', '/workorder', tokT, { property_id: 'DP1A', unit_id: 'DU1A1', tenant_id: 'DT1', trade: 'Plumbing', description: 'prospect made this one', type: 'tenant' });
const madeId = r.json && (r.json.wo_id || r.json.id);
t('prospect can submit their own request in the demo', r.status === 200 && !!madeId, r.json);
const countBeforeReset = rows('Work_Orders').filter(w => w.Property_ID.startsWith('DP1')).length;
t('before reset: 9 work orders on slot 1 (8 sample + the prospect\'s)', countBeforeReset === 9, countBeforeReset);
// the prospect also tampers with a sample job's description in the sheet (simulates an edit); the reset must restore it
const idx = store.tabs.get('Work_Orders'); const hdr = idx[0]; const row = idx.find(x => x[0] === 'WO-D101'); row[hdr.indexOf('Description')] = 'EDITED BY PROSPECT';
r = await adminCall('POST', '/demo/reset', { slot: 1 });
t('reset: succeeds and reports the sample data was rebuilt', r.status === 200 && r.json.reset === true && r.json.seeded === true, r.json);
t('reset: exactly 8 sample work orders again, the prospect\'s request and the edit are gone', rows('Work_Orders').filter(w => w.Property_ID.startsWith('DP1')).length === 8 && !rowOf('Work_Orders', madeId) && rowOf('Work_Orders', 'WO-D101').Description !== 'EDITED BY PROSPECT');
t('reset: attachments rebuilt (7) with no duplicates', rows('Attachments').filter(a => a.ID.startsWith('DA1')).length === 7 && new Set(rows('Attachments').map(a => a.ID)).size === rows('Attachments').length);
t('reset: slot is idle again (no contact, cannot log in)', rowOf('Owners', 'DO1').Phone === '' && rowOf('Owners', 'DO1').Active === 'FALSE' && (await login('owner', 'Ann', PIN1)).status >= 400);
t('reset: real rows still untouched and nothing sent', realWo() === realWoBefore && outbound.length === 0);
r = await adminCall('POST', '/demo/add', { name: 'Bo Second', phone: PH2, email: 'bo@prospect.example', slot: 1 });
t('re-add to the same slot: still exactly 8 sample work orders (no duplicates)', r.status === 200 && rows('Work_Orders').filter(w => w.Property_ID.startsWith('DP1')).length === 8 && rows('Attachments').filter(a => a.ID.startsWith('DA1')).length === 7);

// ===== 4. Two slots stay separate =====
r = await adminCall('POST', '/demo/add', { name: 'Cy Third', phone: '4105550177', email: 'cy@prospect.example' });
t('second slot gets its own 8 sample work orders; slot 1 still has 8', r.status === 200 && r.json.slot === 2 && rows('Work_Orders').filter(w => w.Property_ID.startsWith('DP2')).length === 8 && rows('Work_Orders').filter(w => w.Property_ID.startsWith('DP1')).length === 8);

// ===== 5. A failed seed never hands out a slot =====
const wasFetch = globalThis.fetch;
let failAppend = true;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (failAppend && /Work_Orders:append/.test(decodeURIComponent(url)) && ((init && init.method) || 'GET') === 'POST') return new Response(JSON.stringify({ error: { code: 500, message: 'sheet is down (test)' } }), { status: 500 });
  return wasFetch(input, init);
};
r = await adminCall('POST', '/demo/add', { name: 'Di Fourth', phone: '4105550188', email: 'di@prospect.example' });
failAppend = false; globalThis.fetch = wasFetch;
t('failed seed: add is refused with a plain-words error and the slot got no contact', r.status >= 400 && /sample data/i.test(JSON.stringify(r.json) + r.text), { s: r.status, t: r.text.slice(0, 200) });
t('failed seed: no slot holds Di\'s phone', !rows('Owners').concat(rows('Tenants')).some(x => x.Phone === '+14105550188'));

console.log(`demo-seed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
