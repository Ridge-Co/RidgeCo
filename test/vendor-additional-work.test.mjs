// Vendor Additional Work (Sep 30 2026) — worker half. Same source-grab / structural convention as
// combined-invoice.test.mjs: pure helpers are executed for real, handlers are executed against stubbed
// Sheets helpers, and the money / plumbing edits are asserted structurally.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');

function grabAny(prefix, name) {
  const i = src.indexOf(prefix + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let pd = 0, k = src.indexOf('(', i);
  for (; k < src.length; k++) { if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (!pd) break; } }   // skip the parameter list (may hold a destructuring {})
  let d = 0, j = src.indexOf('{', k);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const grab = n => grabAny('function ', n);
const grabAsync = n => grabAny('async function ', n);
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const constLine = n => { const m = new RegExp('const ' + n + ' = [^;]+;').exec(src); if (!m) throw new Error('missing const ' + n); return m[0]; };

// ── pure helpers ──────────────────────────────────────────────────────────────
const pure = new Function(
  constLine('ADDON_MAX_ITEMS') + constLine('ADDON_PHOTO_TYPES') +
  grab('addonValidateStart') + grab('addonMissingPhotoItems') + grab('addonBuildOwnerNotice') + grab('addonIsDraft') + grab('addonIsChild') +
  '\nreturn { addonValidateStart, addonMissingPhotoItems, addonBuildOwnerNotice, addonIsDraft, addonIsChild };')();

t('validate: no items rejected', !pure.addonValidateStart({ items: [], amount: 10 }).ok);
t('validate: items missing rejected', !pure.addonValidateStart({ amount: 10 }).ok);
t('validate: blank desc rejected', !pure.addonValidateStart({ items: [{ desc: '  ' }], amount: 10 }).ok);
t('validate: 21 items rejected', !pure.addonValidateStart({ items: Array.from({ length: 21 }, () => ({ desc: 'x' })), amount: 10 }).ok);
t('validate: 20 items accepted', pure.addonValidateStart({ items: Array.from({ length: 20 }, () => ({ desc: 'x' })), amount: 10 }).ok);
t('validate: amount 0 rejected', !pure.addonValidateStart({ items: [{ desc: 'leak' }], amount: 0 }).ok);
t('validate: negative amount rejected', !pure.addonValidateStart({ items: [{ desc: 'leak' }], amount: -5 }).ok);
t('validate: non-numeric amount rejected', !pure.addonValidateStart({ items: [{ desc: 'leak' }], amount: 'abc' }).ok);
t('validate: missing amount rejected', !pure.addonValidateStart({ items: [{ desc: 'leak' }] }).ok);
const okv = pure.addonValidateStart({ items: [{ desc: ' leak under sink ' }, { desc: 'rotten board' }], amount: '150.456' });
t('validate: ok -> indexed, trimmed items and 2dp amount', okv.ok && okv.items[0].index === 0 && okv.items[1].index === 1 && okv.items[0].desc === 'leak under sink' && okv.amount === 150.46);

const items2 = [{ index: 0, desc: 'a' }, { index: 1, desc: 'b' }];
t('photos: none -> both items missing', pure.addonMissingPhotoItems(items2, []).join() === '0,1');
t('photos: one item covered', pure.addonMissingPhotoItems(items2, [{ Addon_Item: '0', File_Type: 'before', Active: 'TRUE' }]).join() === '1');
t('photos: all covered', pure.addonMissingPhotoItems(items2, [{ Addon_Item: '0', File_Type: 'before' }, { Addon_Item: '1', File_Type: 'photo' }]).length === 0);
t('photos: receipt/bill types never count', pure.addonMissingPhotoItems(items2, [{ Addon_Item: '0', File_Type: 'receipt' }, { Addon_Item: '1', File_Type: 'bill' }]).length === 2);
t('photos: inactive rows never count', pure.addonMissingPhotoItems(items2, [{ Addon_Item: '0', File_Type: 'before', Active: 'FALSE' }, { Addon_Item: '1', File_Type: 'before' }]).join() === '0');
t('photos: a photo with no Addon_Item never counts', pure.addonMissingPhotoItems(items2, [{ Addon_Item: '', File_Type: 'before' }]).length === 2);

const notice = pure.addonBuildOwnerNotice({ ownerFirst: 'Sam', address: '12 Main St', parentId: 'WO-1', itemTexts: ['Leak under the kitchen cabinet'], photoUrls: ['https://drive.google.com/a', 'https://drive.google.com/b', 'https://drive.google.com/c', 'https://drive.google.com/d'] });
t('notice: has no dollar sign / price anywhere', !/\$|price|cost|amount/i.test(notice.sms + notice.html + notice.subject));
t('notice: describes the problem and includes photo links', /Leak under the kitchen cabinet/.test(notice.sms) && /drive\.google\.com\/a/.test(notice.sms) && /drive\.google\.com\/d/.test(notice.html));
t('notice: SMS caps links at 3 and says more are in the email', !/drive\.google\.com\/d/.test(notice.sms) && /\+1 more by email/.test(notice.sms));
t('notice: escapes html in the email', !/<script/.test(pure.addonBuildOwnerNotice({ ownerFirst: 'x', address: 'a', parentId: 'p', itemTexts: ['<script>x</script>'], photoUrls: [] }).html));
t('draft / child predicates', pure.addonIsDraft({ Addon_Status: 'Draft' }) && !pure.addonIsDraft({ Addon_Status: 'Submitted' }) && pure.addonIsChild({ Type: 'addon', Parent_WO_ID: 'WO-1' }) && !pure.addonIsChild({ Type: 'manual', Parent_WO_ID: '' }));

// ── handlers run against stubbed sheet helpers ─────────────────────────────────
function harness(state) {
  const calls = { created: [], assigned: [], updates: [], estimates: [], voids: [] };
  const body = [
    constLine('ADDON_WO_COLUMNS'), constLine('ADDON_MAX_ITEMS'), constLine('ADDON_PHOTO_TYPES'), constLine('ADDON_PARENT_BLOCKED_STATUSES'),
    grab('addonIsDraft'), grab('addonIsChild'), grab('addonActingVendor'), grab('addonValidateStart'), grab('addonMissingPhotoItems'),
    grab('addonParseItems'), grab('addonLatestEstimate'), grabAsync('addonStart'), grabAsync('addonSubmit'), grabAsync('addonWithdraw'),
  ].join('\n');
  const f = new Function('S', 'calls', 'json', 'fetchTab', 'findWO', 'ensureColumns', 'createWorkOrder', 'assignVendor', 'updateWOFields', 'addEstimateVersion', 'updateRow', 'logWOAudit', 'WO_VOID_COLUMNS',
    body + '\nreturn { addonStart, addonSubmit, addonWithdraw };');
  const json = (d, s = 200) => ({ status: s, _d: d, clone() { return this; }, json: async () => d });
  const fns = f(state, calls, json,
    async (env, tab) => state[tab] || [],
    (wos, id) => wos.find(w => w.ID === id) || null,
    async () => {},
    async (env, b) => { calls.created.push(b); state.Work_Orders.push({ ID: 'WO-9', Type: b.type, Parent_WO_ID: b.parent_wo_id }); return json({ success: true, id: 'WO-9' }); },
    async (env, b) => { calls.assigned.push(b); },
    async (env, id, fields) => { calls.updates.push({ id, fields }); const w = state.Work_Orders.find(x => x.ID === id); if (w) Object.assign(w, fields); },
    async (env, b) => { calls.estimates.push(b); state.Estimates.push({ WO_ID: b.wo_id, Version: '1', Status: 'Pending', Subtotal: b.line_items.reduce((s, l) => s + l.amount, 0).toFixed(2), Active: 'TRUE' }); return json({ success: true, version: 1 }); },
    async (env, tab, id, fields) => { calls.voids.push({ tab, id, fields }); return json({ success: true }); },
    async () => {}, ['Voided']);
  return { ...fns, calls };
}
const mk = () => ({
  Work_Orders: [
    { ID: 'WO-1', Vendor_ID: 'V1', Status: 'In Progress', Type: 'manual', Trade: 'Plumbing', Property_ID: 'P1', Unit_ID: 'U1' },
    { ID: 'WO-2', Vendor_ID: 'V1', Status: 'New', Type: 'estimate' },
    { ID: 'WO-3', Vendor_ID: 'V1', Status: 'Paid', Type: 'manual' },
    { ID: 'WO-4', Vendor_ID: 'V1', Status: 'New', Type: 'manual', Voided: 'TRUE' },
    { ID: 'WO-5', Vendor_ID: 'V2', Status: 'New', Type: 'manual' },
  ],
  Estimates: [], Attachments: [],
});
const good = { parent_wo_id: 'WO-1', items: [{ desc: 'Leak' }, { desc: 'Rot' }], amount: 200 };
const run = async (fn, st, body, role = 'vendor', sid = 'V1') => { const h = harness(st); const r = await h[fn]({}, body, role, sid); return { r, calls: h.calls, d: r._d }; };

let x = await run('addonStart', mk(), good);
t('start: ok creates a child with type addon + parent + all notify flags off', x.d.success && x.d.child_wo_id === 'WO-9' && x.calls.created.length === 1 && (c => c.type === 'addon' && c.parent_wo_id === 'WO-1' && c.tenant_notify_created === false && c.tenant_visible === false && c.tenant_notify_updates === false && c.owner_notify_override === 'off')(x.calls.created[0]));
t('start: child copies parent property / unit / trade', (c => c.property_id === 'P1' && c.unit_id === 'U1' && c.trade === 'Plumbing')(x.calls.created[0]));
t('start: vendor assigned with notify:false to the SESSION vendor', x.calls.assigned.length === 1 && x.calls.assigned[0].notify === false && x.calls.assigned[0].vendor_id === 'V1');
t('start: child saved as hidden Draft with items + amount', x.calls.updates.some(u => u.fields.Addon_Status === 'Draft' && u.fields.Voided === 'TRUE' && u.fields.Addon_Amount === '200.00' && JSON.parse(u.fields.Addon_Items_JSON).length === 2));
t('start: response lists indexed items', x.d.items.length === 2 && x.d.items[1].index === 1);
x = await run('addonStart', mk(), { ...good, vendor_id: 'V2' }, 'vendor', 'V2');
t('start: another vendor cannot add to a job assigned to someone else (body vendor_id ignored)', x.r.status === 403 && x.calls.created.length === 0);
x = await run('addonStart', mk(), { ...good, parent_wo_id: 'WO-2' });
t('start: estimate-type parent -> 400 pointing to the estimate editor', x.r.status === 400 && x.d.use_estimate_editor === true);
x = await run('addonStart', mk(), { ...good, parent_wo_id: 'WO-3' });
t('start: paid parent rejected', x.r.status === 400);
x = await run('addonStart', mk(), { ...good, parent_wo_id: 'WO-4' });
t('start: voided parent rejected', x.r.status === 400);
x = await run('addonStart', mk(), { ...good, parent_wo_id: 'WO-404' });
t('start: missing parent 404', x.r.status === 404);
x = await run('addonStart', mk(), { ...good, amount: 0 });
t('start: zero amount 400, nothing created', x.r.status === 400 && x.calls.created.length === 0);
x = await run('addonStart', mk(), { ...good, parent_wo_id: undefined });
t('start: parent_wo_id required', x.r.status === 400);
{ const st = mk(); st.Work_Orders.push({ ID: 'WO-8', Vendor_ID: 'V1', Status: 'New', Type: 'addon', Parent_WO_ID: 'WO-1' });
  x = await run('addonStart', st, { ...good, parent_wo_id: 'WO-8' });
  t('start: no nesting (add-on of an add-on)', x.r.status === 400); }

const draftState = () => { const st = mk(); st.Work_Orders.push({ ID: 'WO-9', Vendor_ID: 'V1', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Draft', Voided: 'TRUE', Addon_Amount: '200.00', Addon_Items_JSON: JSON.stringify([{ index: 0, desc: 'Leak' }, { index: 1, desc: 'Rot' }]) }); return st; };
x = await run('addonSubmit', draftState(), { child_wo_id: 'WO-9' });
t('submit: no photos -> 400 listing every missing item index, no estimate written', x.r.status === 400 && x.d.missing_items.join() === '0,1' && x.calls.estimates.length === 0);
{ const st = draftState(); st.Attachments.push({ WO_ID: 'WO-9', File_Type: 'before', Addon_Item: '0', Active: 'TRUE' });
  x = await run('addonSubmit', st, { child_wo_id: 'WO-9' });
  t('submit: one item still missing a photo -> 400 [1]', x.r.status === 400 && x.d.missing_items.join() === '1'); }
{ const st = draftState(); st.Attachments.push({ WO_ID: 'WO-9', File_Type: 'before', Addon_Item: '0', Active: 'TRUE' }, { WO_ID: 'WO-9', File_Type: 'before', Addon_Item: '1', Active: 'TRUE' });
  x = await run('addonSubmit', st, { child_wo_id: 'WO-9', amount: 1 });
  const e = x.calls.estimates[0];
  t('submit: ok -> one estimate, created_by vendor, sms kind Additional work, vendor_id = session vendor', x.d.success && x.calls.estimates.length === 1 && e.created_by === 'vendor' && e.sms_kind === 'Additional work' && e.vendor_id === 'V1' && e.wo_id === 'WO-9');
  t('submit: lump sum on line 1, $0 on the rest, Subtotal === amount, every item a line', e.line_items.length === 2 && e.line_items[0].amount === 200 && e.line_items[1].amount === 0 && e.line_items.reduce((s, l) => s + l.amount, 0) === 200 && e.line_items[1].addon_item === 1);
  t('submit: amount comes from the draft, not the submit body', e.line_items[0].amount === 200);
  t('submit: child un-hidden and marked Submitted', x.calls.updates.some(u => u.fields.Voided === 'FALSE' && u.fields.Addon_Status === 'Submitted'));
  const again = await (async () => { const h = harness(st); return h.addonSubmit({}, { child_wo_id: 'WO-9' }, 'vendor', 'V1'); })();
  t('submit: second submit is idempotent (no second estimate)', again._d.success && again._d.already_submitted === true && st.Estimates.length === 1); }
x = await run('addonSubmit', draftState(), { child_wo_id: 'WO-9' }, 'vendor', 'V2');
t('submit: other vendor -> 403', x.r.status === 403);
x = await run('addonSubmit', draftState(), { child_wo_id: 'WO-1' });
t('submit: a normal WO is not submit-able', x.r.status === 404);

{ const st = draftState(); st.Work_Orders.find(w => w.ID === 'WO-9').Addon_Status = 'Submitted'; st.Estimates.push({ ID: 'E1', WO_ID: 'WO-9', Version: '1', Status: 'Pending', Active: 'TRUE' });
  x = await run('addonWithdraw', st, { child_wo_id: 'WO-9' });
  t('withdraw: pending add-on is voided + Withdrawn + estimate marked', x.d.success && x.calls.updates.some(u => u.fields.Addon_Status === 'Withdrawn' && u.fields.Voided === 'TRUE') && x.calls.voids.some(v => v.tab === 'Estimates' && v.fields.Status === 'Withdrawn')); }
{ const st = draftState(); st.Work_Orders.find(w => w.ID === 'WO-9').Addon_Status = 'Submitted'; st.Estimates.push({ ID: 'E1', WO_ID: 'WO-9', Version: '1', Status: 'Approved', Active: 'TRUE' });
  x = await run('addonWithdraw', st, { child_wo_id: 'WO-9' });
  t('withdraw: approved add-on cannot be withdrawn', x.r.status === 400); }
{ const st = draftState(); st.Work_Orders.find(w => w.ID === 'WO-9').Addon_Status = 'Submitted'; st.Estimates.push({ ID: 'E1', WO_ID: 'WO-9', Version: '1', Status: 'Needs Info', Active: 'TRUE' });
  x = await run('addonWithdraw', st, { child_wo_id: 'WO-9' });
  t('withdraw: Needs Info add-on can be withdrawn', x.d.success === true); }
x = await run('addonWithdraw', draftState(), { child_wo_id: 'WO-9' }, 'vendor', 'V2');
t('withdraw: other vendor -> 403', x.r.status === 403);

// ── structural: persistence + plumbing ─────────────────────────────────────────
const createFn = grabAsync('createWorkOrder');
t('createWorkOrder row map persists Parent_WO_ID', /Parent_WO_ID: body\.parent_wo_id\|\|''/.test(createFn));
t('createWorkOrder dup signature includes Type and (when present) the parent id', /Type: body\.type \|\| 'manual',\s*\n\s*\.\.\.\(body\.parent_wo_id \? \{ Parent_WO_ID/.test(createFn));
t('claimWOSignature key includes Parent_WO_ID', /const key = \['Property_ID'[^\]]*'Type', 'Parent_WO_ID'\]/.test(src));
const logFn = grabAsync('logAttachment');
t('logAttachment ensures + persists Addon_Item', /ensureColumns\(env, 'Attachments', \['Addon_Item'\]\)/.test(logFn) && /Addon_Item:_addonItem/.test(logFn) && /body\.addon_item/.test(logFn));
const estFn = grabAsync('addEstimateVersion');
t('addEstimateVersion: Brett SMS Kind is "Additional work" for add-on WOs, unchanged otherwise', /c\.wo && c\.wo\.Type === 'addon'\) \? \(nextVersion > 1 \? 'Revised additional work' : 'Additional work'\) : \(nextVersion > 1 \? 'Revised estimate' : 'New estimate'\)/.test(estFn));

const scopes = /const ROLE_SCOPES = \{\s*vendor: \[([\s\S]*?)\],\s*tenant:/.exec(src)[1];
['/wo/additional-work', '/wo/additional-work/start', '/wo/additional-work/submit', '/wo/additional-work/withdraw'].forEach(p => t('ROLE_SCOPES.vendor allows ' + p, scopes.includes("'" + p + "'")));
t('owner-notice is admin-only (not in any ROLE_SCOPES list)', !/ROLE_SCOPES[\s\S]{0,4000}'\/wo\/additional-work\/owner-notice'/.test(src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('function isPathAllowedForRole'))));
['/wo/additional-work/start', '/wo/additional-work/submit', '/wo/additional-work/withdraw', '/wo/additional-work/owner-notice'].forEach(p => {
  t('POST router dispatches ' + p, src.includes("if (path === '" + p + "')"));
  t('hubTestWriteAllowed handles ' + p, grabAsync('hubTestWriteAllowed').includes(p));
});
t('GET router dispatches /wo/additional-work', /if \(path === '\/wo\/additional-work'\)\s+return await addonList\(/.test(src));
const gate = grabAsync('hubTestWriteAllowed');
t('test gate: start is keyed on the PARENT being a TEST- WO, the others on the CHILD', /\/wo\/additional-work\/start'\) return !!\(body && body\.parent_wo_id\) && await isTestWO/.test(gate) && /child_wo_id\) && await isTestWO/.test(gate));
t('test gate: a real owner-notice send also requires a TEST- owner', /body\.preview !== false\) return true;[\s\S]*?isTestRecord\(env, 'Owners'/.test(gate));

// ── hidden drafts ──────────────────────────────────────────────────────────────
t('admin WO list hides drafts', /filtered\.filter\(r => String\(r\.Addon_Status \|\| ''\) !== 'Draft'\)/.test(grabAsync('getWorkOrdersList')));
t('hub-bootstrap hides drafts', /workorders\.filter\(w => String\(w\.Addon_Status \|\| ''\) !== 'Draft'\)/.test(grabAsync('hubBootstrap')));
t('/vendor-workorders hides drafts', /String\(w\.Addon_Status \|\| ''\) !== 'Draft'/.test(grabAsync('vendorWorkorders')));
t('owner WO list never shows add-on children', /String\(w\.Type \|\| ''\) !== 'addon'/.test(grabAsync('ownerWorkorders')));
t('start voids the draft so every other Voided-aware list/nudge also skips it', /Voided: 'TRUE'[\s\S]{0,120}Addon_Status: 'Draft'/.test(grabAsync('addonStart')));
t('additional-work code never writes the parent\'s Current_Estimate/Approval_Stage/Estimates', !/Current_Estimate|Approval_Stage|setApprovalStage/.test(grabAsync('addonStart') + grabAsync('addonSubmit') + grabAsync('addonWithdraw')));

// ── owner notice (structural) ──────────────────────────────────────────────────
const ownerFn = grabAsync('addonOwnerNotice');
t('owner-notice: preview is the default; only preview:false sends', /const preview = !\(body && body\.preview === false\)/.test(ownerFn));
t('owner-notice: SMS goes through smsGatedSend as an owner recipient, email through gmailSendEmail', /smsGatedSend\(env, \{[^}]*recipient_type: 'owner'/.test(ownerFn) && /gmailSendEmail\(env/.test(ownerFn));
t('owner-notice: declined add-on is never shown to the owner', /Declined/.test(ownerFn));
t('owner-notice: records Addon_Owner_Notified_Date and blocks a silent re-send', /Addon_Owner_Notified_Date: new Date/.test(ownerFn) && /resend/.test(ownerFn));
t('owner-notice: only before/photo attachments are linked, never the WO folder', /addonPhotosByItem/.test(ownerFn) && !/Drive_Folder/.test(ownerFn + grab('addonPhotosByItem')));

// ── invoice rollup (MONEY GATE: only an Approved, Submitted, un-voided add-on child folds into the parent invoice) ──
const { qbGroupOpenRows, addonRollsIntoParent } = new Function(grab('addonRollsIntoParent') + grab('qbGroupOpenRows') + '\nreturn { qbGroupOpenRows, addonRollsIntoParent };')();
const P = { ID: '1', WO_ID: 'WO-100', Bill_ID: 'B1', Active: 'TRUE', QB_Invoice_ID: '' };
const P2 = { ID: '2', WO_ID: 'WO-100', Bill_ID: 'B2', Active: 'TRUE', QB_Invoice_ID: '' };
const C = { ID: '3', WO_ID: 'WO-101', Bill_ID: 'B3', Active: 'TRUE', QB_Invoice_ID: '' };
const O = { ID: '4', WO_ID: 'WO-200', Bill_ID: 'B4', Active: 'TRUE', QB_Invoice_ID: '' };
const childWo = (over = {}) => ({ ID: 'WO-101', Type: 'addon', Parent_WO_ID: 'WO-100', Addon_Status: 'Submitted', Voided: 'FALSE', ...over });
const wos = [{ ID: 'WO-100', Type: 'manual' }, childWo(), { ID: 'WO-200', Type: 'manual' }];
const est = (status, extra = {}) => ({ WO_ID: 'WO-101', Version: '1', Status: status, Active: 'TRUE', ...extra });
const APPROVED = [est('Approved')];
const ids = g => g.map(r => r.ID).join(',');
t('rollup: parent row pulls in its APPROVED add-on child row', ids(qbGroupOpenRows([P, C, O], P, wos, APPROVED)) === '1,3');
t('rollup: starting from the CHILD row finds the same group, parent rows first', ids(qbGroupOpenRows([C, P, P2, O], C, wos, APPROVED)) === '1,2,3');
t('rollup: unrelated WO never joins', !qbGroupOpenRows([P, C, O], P, wos, APPROVED).some(r => r.ID === '4'));
t('rollup: an already-invoiced child is excluded', ids(qbGroupOpenRows([P, { ...C, QB_Invoice_ID: '77' }], P, wos, APPROVED)) === '1');
t('rollup: an already-invoiced row never reopens with new siblings', ids(qbGroupOpenRows([{ ...P, QB_Invoice_ID: '9' }, C], { ...P, QB_Invoice_ID: '9' }, wos, APPROVED)) === '1');
t('rollup: a voided (Active FALSE) child row is excluded', ids(qbGroupOpenRows([P, { ...C, Active: 'FALSE' }], P, wos, APPROVED)) === '1');
t('rollup: parent already invoiced -> late child invoices alone', ids(qbGroupOpenRows([{ ...P, QB_Invoice_ID: '9' }, C], C, wos, APPROVED)) === '3');
t('rollup: a WO that merely CLAIMS a parent but is not Type addon is ignored', ids(qbGroupOpenRows([P, C], P, [{ ID: 'WO-101', Type: 'manual', Parent_WO_ID: 'WO-100', Addon_Status: 'Submitted' }], APPROVED)) === '1');
// every excluded child state: the child row never joins, the PARENT invoice is exactly its own rows, and the child row invoices alone
for (const [label, w, e] of [
  ['estimate Declined', childWo(), [est('Declined')]],
  ['estimate Needs Info', childWo(), [est('Needs Info')]],
  ['estimate Pending', childWo(), [est('Pending')]],
  ['estimate Withdrawn', childWo(), [est('Withdrawn')]],
  ['estimate Converted (billed via proposal milestones — never ALSO on the parent invoice)', childWo(), [est('Converted')]],
  ['child Voided', childWo({ Voided: 'TRUE' }), APPROVED],
  ['Addon_Status Withdrawn', childWo({ Addon_Status: 'Withdrawn' }), APPROVED],
  ['Addon_Status Draft', childWo({ Addon_Status: 'Draft' }), APPROVED],
  ['no estimate row at all', childWo(), []],
  ['estimates argument omitted (fail closed)', childWo(), undefined],
]) {
  const W = [{ ID: 'WO-100', Type: 'manual' }, w];
  t('rollup excluded: ' + label + ' -> parent group is only its own rows', ids(qbGroupOpenRows([P, P2, C], P, W, e)) === '1,2');
  t('rollup excluded: ' + label + ' -> child row invoices alone', ids(qbGroupOpenRows([P, C], C, W, e)) === '3');
  t('rollup excluded: ' + label + ' -> addonRollsIntoParent false', addonRollsIntoParent(w, e) === false);
}
t('rollup: latest estimate version wins (v1 Declined, v2 Approved -> included)', ids(qbGroupOpenRows([P, C], P, wos, [est('Declined'), est('Approved', { Version: '2' })])) === '1,3');
t('rollup: latest estimate version wins (v1 Approved, v2 Needs Info -> excluded)', ids(qbGroupOpenRows([P, C], P, wos, [est('Approved'), est('Needs Info', { Version: '2' })])) === '1');
t('rollup: an inactive newer estimate is ignored', ids(qbGroupOpenRows([P, C], P, wos, [est('Approved'), est('Declined', { Version: '2', Active: 'FALSE' })])) === '1,3');
// unchanged behaviour without children (same results with and without the woRows / estimates arguments)
const sets = [[P], [P, P2], [P, P2, O], [P, { ...P2, Active: 'FALSE' }, O], [{ ...P, QB_Invoice_ID: '5' }, P2]];
t('no children: results are identical to the original two-argument behaviour for every fixture',
  sets.every(rows => rows.every(r => ids(qbGroupOpenRows(rows, r)) === ids(qbGroupOpenRows(rows, r, [{ ID: 'WO-100', Type: 'manual' }, { ID: 'WO-200', Type: 'manual' }], [])) && ids(qbGroupOpenRows(rows, r)) === ids(qbGroupOpenRows(rows, r, [], APPROVED)))));

// qbReadyQueue's combines_with counts use the SAME gate (executed, not just grepped)
{
  const rq = new Function('json', 'fetchTabs', 'findWO', 'addonRollsIntoParent', grabAsync('qbReadyQueue') + '\nreturn qbReadyQueue;');
  const run = async (e, childOver = {}) => {
    const irRows = [{ ID: '1', WO_ID: 'WO-100', Bill_ID: 'B1', Active: 'TRUE', QB_Invoice_ID: '', QB_Invoice_Status: 'pending' }, { ID: '3', WO_ID: 'WO-101', Bill_ID: 'B3', Active: 'TRUE', QB_Invoice_ID: '', QB_Invoice_Status: 'pending' }];
    const W = [{ ID: 'WO-100', Type: 'manual' }, childWo(childOver)];
    const fn = rq(d => ({ _d: d }), async () => [irRows, W, e], (l, id) => l.find(w => w.ID === id) || null, addonRollsIntoParent);
    const out = (await fn({}, { searchParams: { get: () => '' } }, false))._d;
    return out.reduce((m, r) => (m[r.id] = r.combines_with, m), {});
  };
  let c = await run(APPROVED); t('ready queue: approved child -> each row says it combines with 1 other', c['1'] === 1 && c['3'] === 1);
  for (const st of ['Declined', 'Needs Info', 'Pending', 'Withdrawn', 'Converted']) { c = await run([est(st)]); t('ready queue: ' + st + ' child is not counted as combining', c['1'] === 0 && c['3'] === 0); }
  c = await run(APPROVED, { Voided: 'TRUE' }); t('ready queue: voided child is not counted as combining', c['1'] === 0 && c['3'] === 0);
}

const sendFn = grabAsync('qbSendInvoice');
t('qbSendInvoice passes the WO list to the grouping', /const groupRows = qbGroupOpenRows\(irRows, ir, wos\);/.test(sendFn));
t('qbSendInvoice: ordinary group keeps wo / woTimeEntries exactly', /_groupWoIds\.size > 1 \? allTimeEntries\.filter/.test(sendFn) && /: woTimeEntries;/.test(sendFn));
const comb = grabAsync('qbSendCombinedInvoice');
t('combined: add-on child lines are relabelled "Additional work — … WO <parent>"', /'Additional work — ' \+ l\.Description/.test(comb) && /WO_ID: _rowWo\.Parent_WO_ID/.test(comb));
t('combined: relabel only applies to Type addon rows on a different WO than the anchor', /String\(_rowWo\.Type \|\| ''\) === 'addon'[\s\S]*?String\(r\.WO_ID\) !== String\(woId\)/.test(comb));
t('combined: parent AND children flip to Invoiced once every row is sent', /for \(const _wid of _distinctWoIds\)[\s\S]*?Status: 'Invoiced'/.test(comb));
t('combined: line amounts are never altered by the relabel (only Description)', !/l\.Amount\s*=|UnitPrice\s*=/.test(comb));
t('ready queue counts combines_with by ROOT wo', /_addonRoot\(r\.WO_ID\)/.test(grabAsync('qbReadyQueue')));

t('BUILD_VERSION bumped', /const BUILD_VERSION = '2026-09-30\.\d+-vendor-additional-work'/.test(src));

console.log(`vendor-additional-work: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
