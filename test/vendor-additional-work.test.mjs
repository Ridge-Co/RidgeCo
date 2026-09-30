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

const grab0 = n => new Function(grab(n) + '\nreturn ' + n + ';')();
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
t('qbSendInvoice passes the WO list to the grouping', /const groupRows = qbGroupOpenRows\(irRows, ir, wos, estRowsAll\);/.test(sendFn));
t('qbSendInvoice: ordinary group keeps wo / woTimeEntries exactly', /_groupWoIds\.size > 1 \? allTimeEntries\.filter/.test(sendFn) && /: woTimeEntries;/.test(sendFn));
const comb = grabAsync('qbSendCombinedInvoice');
t('combined: add-on child lines are relabelled "Additional work — … WO <parent>"', /'Additional work — ' \+ l\.Description/.test(comb) && /WO_ID: _rowWo\.Parent_WO_ID/.test(comb));
t('combined: relabel only applies to Type addon rows on a different WO than the anchor', /String\(_rowWo\.Type \|\| ''\) === 'addon'[\s\S]*?String\(r\.WO_ID\) !== String\(woId\)/.test(comb));
t('combined: parent AND children flip to Invoiced once every row is sent', /for \(const _wid of _distinctWoIds\)[\s\S]*?Status: 'Invoiced'/.test(comb));
t('combined: line amounts are never altered by the relabel (only Description)', !/l\.Amount\s*=|UnitPrice\s*=/.test(comb));
t('ready queue counts combines_with by ROOT wo', /_addonRoot\(r\.WO_ID\)/.test(grabAsync('qbReadyQueue')));


// ── B. approve / needs-info / decline guards (executed) ─────────────────────────
t('qbSendInvoice reads Estimates for the gate', /'Time_Entries','Estimates',\s*\]\);/.test(sendFn) && /estRowsAll/.test(sendFn));
{
  const blk = new Function(grab('addonEstimateActionBlock') + '\nreturn addonEstimateActionBlock;')();
  const A = (o = {}) => ({ ID: 'WO-9', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Submitted', Voided: 'FALSE', ...o });
  t('guard: voided add-on cannot be approved', !!blk(A({ Voided: 'TRUE' }), { Status: 'Pending' }, 'approve'));
  t('guard: Withdrawn add-on cannot be approved / needs-info / declined', !!blk(A({ Addon_Status: 'Withdrawn' }), { Status: 'Pending' }, 'approve') && !!blk(A({ Addon_Status: 'Withdrawn' }), { Status: 'Withdrawn' }, 'needs-info') && !!blk(A({ Addon_Status: 'Withdrawn' }), { Status: 'Pending' }, 'decline'));
  t('guard: Draft add-on cannot be approved', !!blk(A({ Addon_Status: 'Draft' }), null, 'approve'));
  t('guard: Declined / Withdrawn latest estimate cannot be approved', !!blk(A(), { Status: 'Declined' }, 'approve') && !!blk(A(), { Status: 'Withdrawn' }, 'approve'));
  t('guard: a live add-on (Pending / Needs Info) is not blocked', blk(A(), { Status: 'Pending' }, 'approve') === '' && blk(A(), { Status: 'Needs Info' }, 'approve') === '' && blk(A(), { Status: 'Pending' }, 'decline') === '');
  t('guard: normal WOs are never affected (even voided / declined)', blk({ ID: 'WO-1', Type: 'manual', Voided: 'TRUE' }, { Status: 'Declined' }, 'approve') === '' && blk(null, null, 'approve') === '');
  const json = (d, st = 200) => ({ status: st, _d: d });
  const stubs = (W, E) => [json, async () => [E, W], (l, id) => l.find(w => w.ID === id) || null, blk];
  const mkApprove = new Function('json', 'fetchTabs', 'findWO', 'addonEstimateActionBlock', 'sheetsRequest', grabAsync('approveEstimate') + '\nreturn approveEstimate;');
  const runApprove = async (W, E) => { const f = mkApprove(...stubs(W, E), async () => { throw new Error('PAST_GUARD'); }); try { const r = await f({}, { wo_id: 'WO-9' }); return { status: r.status, d: r._d }; } catch (e) { return { past: e.message === 'PAST_GUARD' }; } };
  const E1 = st => [{ ID: 'E1', WO_ID: 'WO-9', Version: '1', Status: st, Active: 'TRUE' }];
  let r = await runApprove([A({ Voided: 'TRUE' })], E1('Pending')); t('approveEstimate: voided add-on -> 400 with a message, nothing written', r.status === 400 && /withdrawn|voided/i.test(r.d.error));
  r = await runApprove([A({ Addon_Status: 'Withdrawn', Voided: 'TRUE' })], E1('Withdrawn')); t('approveEstimate: withdrawn add-on -> 400', r.status === 400);
  r = await runApprove([A({ Addon_Status: 'Draft' })], E1('Pending')); t('approveEstimate: draft add-on -> 400', r.status === 400);
  r = await runApprove([A()], E1('Declined')); t('approveEstimate: declined add-on estimate -> 400', r.status === 400 && /Declined/.test(r.d.error));
  r = await runApprove([A()], E1('Pending')); t('approveEstimate: a live add-on passes the guard', r.past === true);
  r = await runApprove([{ ID: 'WO-9', Type: 'manual', Voided: 'TRUE' }], E1('Declined')); t('approveEstimate: a normal WO passes the guard exactly as before', r.past === true);
  const mkFlag = new Function('json', 'fetchTabs', 'findWO', 'addonEstimateActionBlock', 'ensureColumns', 'updateRow', grabAsync('flagEstimate') + '\nreturn flagEstimate;');
  const runFlag = async (W, E, kind) => { const f = mkFlag(...stubs(W, E), async () => {}, async () => { throw new Error('PAST_GUARD'); }); try { const r = await f({}, { wo_id: 'WO-9' }, kind); return { status: r.status, d: r._d }; } catch (e) { return { past: e.message === 'PAST_GUARD' }; } };
  r = await runFlag([A({ Addon_Status: 'Withdrawn', Voided: 'TRUE' })], E1('Withdrawn'), 'needs-info'); t('needs-info on a Withdrawn add-on -> rejected (400)', r.status === 400);
  r = await runFlag([A({ Voided: 'TRUE' })], E1('Pending'), 'needs-info'); t('needs-info on a voided add-on -> rejected (400)', r.status === 400);
  r = await runFlag([A({ Voided: 'TRUE' })], E1('Pending'), 'decline'); t('decline on a voided add-on -> rejected (400)', r.status === 400);
  r = await runFlag([A()], E1('Pending'), 'needs-info'); t('needs-info on a live add-on passes the guard', r.past === true);
  r = await runFlag([A()], E1('Withdrawn'), 'decline'); t('decline on a Withdrawn estimate is still rejected by the existing status rule (409)', r.status === 409);
  t('push-to-scope silent approve never picks a Withdrawn estimate', /\['Approved', 'Converted', 'Declined', 'Withdrawn'\]\.includes\(String\(e\.Status/.test(src));
}

// ── C. vendor nudge clock ───────────────────────────────────────────────────────
{
  const hold = new Function(grab('addonNudgeHold') + '\nreturn addonNudgeHold;')();
  t('nudge hold: pending add-on (stage Estimated) is held', hold({ Type: 'addon', Approval_Stage: 'Estimated' }) === true);
  t('nudge hold: declined add-on (stage cleared) is held', hold({ Type: 'addon', Approval_Stage: '' }) === true);
  t('nudge hold: approved add-on still nudges', hold({ Type: 'addon', Approval_Stage: 'Approved' }) === false);
  t('nudge hold: normal WOs are never held (any stage)', hold({ Type: 'manual', Approval_Stage: '' }) === false && hold({ Type: 'estimate', Approval_Stage: 'Estimated' }) === false);
  // executed sweep: only the nudge decision path is exercised (stubs record what happens)
  const sweepSrc = grabAsync('processVendorNudges');
  const mkSweep = new Function('ensureVendorReqTab', 'fetchTab', 'fetchConfig', 'findWO', 'updateRow', 'addRow', 'addonNudgeHold', 'VENDOR_REQ_TAB', 'WO_STATUS_COMPLETE_OR_LATER', 'WO_STATUS_INVOICED_OR_LATER', 'VENDOR_NUDGE_MAX', 'VENDOR_NUDGE_REPEAT_HOURS', 'VENDOR_MANUAL_REPEAT_HOURS', 'smsGatedSend', 'sendTemplatedSms', 'notifyVendorTemplated', sweepSrc + '\nreturn processVendorNudges;');
  const sweep = async (wo) => {
    const rec = { updates: [], sms: 0 };
    const rows = [{ ID: 'R1', WO_ID: wo.ID, Vendor_ID: 'V1', Request_Type: 'status_update', Status: 'open', Next_Nudge_At: '2000-01-01T00:00:00Z', Nudge_Count: '0' }];
    const tabs = { Vendor_Requests: rows, Work_Orders: [wo], Vendors: [{ ID: 'V1', Name: 'V' }], Properties: [], Units: [] };
    const f = mkSweep(async () => {}, async (env, tab) => tabs[tab] || [], async () => ({}), (l, id) => l.find(w => w.ID === id) || null,
      async (env, tab, id, fields) => { rec.updates.push(fields); }, async () => {}, hold, 'Vendor_Requests', ['Complete', 'Pending Invoice', 'Invoiced', 'Paid', 'Closed'], ['Invoiced', 'Paid'], 5, 24, 48,
      async () => { rec.sms++; return { sent: true }; }, async () => { rec.sms++; return { sent: true }; }, async () => { rec.sms++; return { sent: true }; });
    let res; try { res = await f({}); } catch (e) { res = { err: String(e.message || e) }; }
    return { rec, res };
  };
  const base = { ID: 'WO-9', Type: 'addon', Parent_WO_ID: 'WO-1', Status: 'Assigned', Voided: 'FALSE', Property_ID: 'P1' };
  let x = await sweep({ ...base, Approval_Stage: 'Estimated' });
  t('sweep: a pending add-on gets NO nudge and nothing is written', x.rec.sms === 0 && x.rec.updates.length === 0);
  x = await sweep({ ...base, Approval_Stage: '' });
  t('sweep: a declined add-on closes its clock and sends nothing', x.rec.sms === 0 && x.rec.updates.some(u => u.Status === 'cancelled'));
  x = await sweep({ ...base, Approval_Stage: 'Approved' });
  t('sweep: an approved add-on falls through to the normal nudge path', !(x.rec.updates.some(u => u.Status === 'cancelled')) && (x.rec.sms > 0 || x.rec.updates.length > 0 || x.res && x.res.err));
  x = await sweep({ ...base, Type: 'manual', Approval_Stage: '' });
  t('sweep: a normal WO is untouched by the hold', !(x.rec.updates.some(u => u.Status === 'cancelled')));
  t('sweep: voided (withdrawn) add-on clock is cancelled by the existing rule', (await sweep({ ...base, Voided: 'TRUE', Approval_Stage: 'Estimated' })).rec.updates.some(u => u.Status === 'cancelled'));
}

// ── D. owner-notice email gates ──────────────────────────────────────────────────
{
  const gate = new Function(grab('smsGateDecision') + grab('addonEmailGate') + '\nreturn addonEmailGate;')();
  const cfgOn = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' };
  t('email gate: all gates open + live mode -> allowed', gate({ cfg: cfgOn, property: {}, owner: { Notify_Method: 'sms' } }).ok === true);
  t('email gate: Global OFF blocks', gate({ cfg: { TWILIO_ENABLED: 'FALSE', TWILIO_TEST_MODE: 'FALSE' }, property: {}, owner: {} }).ok === false);
  t('email gate: Test Mode blocks (no email to a real owner)', gate({ cfg: { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'TRUE' }, property: {}, owner: {} }).ok === false);
  t('email gate: default (no config) is blocked', gate({ cfg: {}, property: {}, owner: {} }).ok === false);
  t('email gate: owner Notify_Method none blocks', gate({ cfg: cfgOn, property: {}, owner: { Notify_Method: 'none' } }).ok === false);
  t('email gate: property SMS off blocks', gate({ cfg: cfgOn, property: { SMS_Enabled: 'FALSE' }, owner: {} }).ok === false);
  t('email gate: owner (customer) SMS off blocks', gate({ cfg: cfgOn, property: {}, owner: { SMS_Enabled: 'FALSE' } }).ok === false);
  const on = grabAsync('addonOwnerNotice');
  t('owner-notice: email is sent only when the gate is ok, and a blocked email reports its reason', /if \(ownerEmail && !emailGate\.ok\) emailResult = \{ sent: false, reason: emailGate\.reason \}/.test(on) && /else if \(ownerEmail\) \{/.test(on));
  t('owner-notice: preview warns when the email will not be sent', /Email will NOT be sent: /.test(on));
  t('owner-notice: a stubbed/failed email never counts as sent', /_er\.sent === false/.test(on));
}

// ── E. submit clears the stale void fields ──────────────────────────────────────
{ const st = draftState(); st.Work_Orders.find(w => w.ID === 'WO-9').Void_Reason = 'Other'; st.Work_Orders.find(w => w.ID === 'WO-9').Void_Reason_Detail = 'Additional-work draft (not submitted yet)';
  st.Attachments.push({ WO_ID: 'WO-9', File_Type: 'before', Addon_Item: '0', Active: 'TRUE' }, { WO_ID: 'WO-9', File_Type: 'before', Addon_Item: '1', Active: 'TRUE' });
  const x2 = await run('addonSubmit', st, { child_wo_id: 'WO-9' });
  const w9 = st.Work_Orders.find(w => w.ID === 'WO-9');
  t('submit: Void_Reason and Void_Reason_Detail are cleared with the un-void', x2.d.success && w9.Voided === 'FALSE' && w9.Void_Reason === '' && w9.Void_Reason_Detail === ''); }

// ── F. one call for the whole portal (executed) ─────────────────────────────────
{
  const mkList = new Function('json', 'fetchTabs', 'findWO', 'addonIsDraft', 'addonParseItems', 'addonLatestEstimate', 'addonPhotosByItem', 'ADDON_PHOTO_TYPES', grabAsync('addonList') + '\nreturn addonList;');
  const W = [
    { ID: 'WO-1', Vendor_ID: 'V1', Type: 'manual' }, { ID: 'WO-2', Vendor_ID: 'V2', Type: 'manual' },
    { ID: 'WO-11', Vendor_ID: 'V1', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Submitted', Addon_Items_JSON: '[{"index":0,"desc":"a"}]', Created_Date: '2' },
    { ID: 'WO-12', Vendor_ID: 'V1', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Draft', Addon_Items_JSON: '[]' },
    { ID: 'WO-13', Vendor_ID: 'V1', Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Withdrawn', Addon_Items_JSON: '[]' },
    { ID: 'WO-21', Vendor_ID: 'V2', Type: 'addon', Parent_WO_ID: 'WO-2', Addon_Status: 'Submitted', Addon_Items_JSON: '[{"index":0,"desc":"b"}]', Created_Date: '1' },
  ];
  const E = [{ ID: 'E1', WO_ID: 'WO-11', Version: '1', Status: 'Approved', Subtotal: '10.00', Line_Items: '[]', Active: 'TRUE' }, { ID: 'E2', WO_ID: 'WO-21', Version: '1', Status: 'Pending', Subtotal: '5.00', Line_Items: '[]', Active: 'TRUE' }];
  const json = d => ({ _d: d });
  const lf = mkList(json, async () => [W, E, []], (l, id) => l.find(w => w.ID === id) || null, grab0('addonIsDraft'), grab0('addonParseItems'), grab0('addonLatestEstimate'), grab0('addonPhotosByItem'), ['before', 'photo']);
  const q = p => ({ searchParams: { get: k => (k === 'parent_wo_id' ? p : null) } });
  let r = (await lf({}, q(''), 'vendor', 'V1'))._d;
  t('list (vendor, no parent): only MY submitted add-ons — no drafts, no withdrawn, never vendor 2\'s', r.success && r.items.length === 1 && r.items[0].child_wo_id === 'WO-11' && r.additional_work.length === 1);
  t('list (vendor, no parent): each row carries parent_wo_id and estimate_status', r.items[0].parent_wo_id === 'WO-1' && r.items[0].estimate_status === 'Approved');
  r = (await lf({}, q(''), 'vendor', 'V2'))._d;
  t('list: vendor B cannot see vendor A\'s rows', r.items.length === 1 && r.items[0].child_wo_id === 'WO-21');
  r = (await lf({}, q(''), 'vendor', 'V3'))._d;
  t('list: a vendor with no add-ons gets an empty list', r.success && r.items.length === 0);
  r = await lf({}, q(''), 'vendor', '');
  t('list: a vendor session with no id is rejected', r._d.error === 'Unauthorized');
  r = await lf({}, q(''), 'admin', '');
  t('list: admin must still name a parent (400)', r._d.error === 'parent_wo_id required');
  r = await lf({}, q('WO-1'), 'vendor', 'V2');
  t('list: the parent_wo_id form still 403s for another vendor\'s parent', r._d.error === 'This work order is not assigned to you');
  r = (await lf({}, q('WO-1'), 'vendor', 'V1'))._d;
  t('list: the parent_wo_id form still works for the owning vendor (withdrawn listed in additional_work, not in items)', r.additional_work.length === 2 && r.items.length === 1);
  r = (await lf({}, q('WO-1'), 'admin', ''))._d;
  t('list: admin + parent form still works and includes owner_notified', r.additional_work.length === 2 && 'owner_notified' in r.additional_work[0]);
}

// ── G. orphan guard on void / cancel ────────────────────────────────────────────
{
  const { addonLiveChildren } = new Function(grab('addonLiveChildren') + '\nreturn { addonLiveChildren };')();
  const kid = (id, over = {}) => ({ ID: id, Type: 'addon', Parent_WO_ID: 'WO-1', Addon_Status: 'Submitted', Voided: 'FALSE', ...over });
  const es = (id, status) => ({ WO_ID: id, Version: '1', Status: status, Active: 'TRUE' });
  t('orphans: Pending / Needs Info / Approved children block', addonLiveChildren([kid('A'), kid('B'), kid('C')], [es('A', 'Pending'), es('B', 'Needs Info'), es('C', 'Approved')], 'WO-1').join() === 'A,B,C');
  t('orphans: Declined / Withdrawn / Converted children do not block', addonLiveChildren([kid('A'), kid('B'), kid('C')], [es('A', 'Declined'), es('B', 'Withdrawn'), es('C', 'Converted')], 'WO-1').length === 0);
  t('orphans: voided / withdrawn / draft children do not block', addonLiveChildren([kid('A', { Voided: 'TRUE' }), kid('B', { Addon_Status: 'Withdrawn' }), kid('C', { Addon_Status: 'Draft' })], [es('A', 'Pending'), es('B', 'Pending'), es('C', 'Pending')], 'WO-1').length === 0);
  t('orphans: another parent\'s children never block', addonLiveChildren([kid('A', { Parent_WO_ID: 'WO-2' })], [es('A', 'Pending')], 'WO-1').length === 0);
  const vf = grabAsync('woVoid');
  t('woVoid: refuses (409) while live add-ons exist, except for reason Combined, and does so BEFORE writing', /reason !== 'Combined' && workorders\.some\(w => String\(w\.Type \|\| ''\) === 'addon'/.test(vf) && /409/.test(vf) && vf.indexOf('addonLiveChildren(') < vf.indexOf('await updateWOFields(env, woId'));
  const uf = grabAsync('updateStatus');
  t('updateStatus: Cancelled is refused (409) while live add-ons exist, before anything is written', /body\.status === 'Cancelled'/.test(uf) && uf.indexOf('addonLiveChildren(') < uf.indexOf('await updateWOFields('));
  t('orphans: only reads Estimates when the WO actually has add-on children (no extra read for ordinary WOs)', /workorders\.some\(w => String\(w\.Type \|\| ''\) === 'addon'[\s\S]{0,200}await fetchTab\(env, 'Estimates'\)/.test(vf) && /workorders\.some\(w => String\(w\.Type \|\| ''\) === 'addon'[\s\S]{0,260}await fetchTab\(env, 'Estimates'\)/.test(uf));
}

// ── owner notifications never fire for an add-on child ──────────────────────────
{
  const tiers = /const NOTIFY_TIERS=\{[^}]*\};/.exec(src)[0];
  const defaults = /const OWNER_NOTIFY_DEFAULTS\s*=\s*\{[^}]*\};/.exec(src)[0];
  const sn = new Function('fetchTabs', tiers + defaults + grabAsync('shouldNotifyOwner') + '\nreturn shouldNotifyOwner;')(async () => [[{ ID: 'P1', Owner_ID: 'O1' }], [{ ID: 'O1', Phone: '+15555550100', Notify_Method: 'sms', Notify_Normal: 'always', Notify_Urgent: 'always', Notify_Low: 'always' }]]);
  let all = true; for (const ev of ['Received', 'Scheduled', 'Complete', 'On_Hold']) if (await sn({}, { Property_ID: 'P1', Priority: 'normal', Owner_Notify_Override: 'off' }, ev)) all = false;
  t('shouldNotifyOwner: a WO created with owner_notify_override "off" (every add-on child) never notifies the owner on Complete / On Hold / Received / Scheduled', all);
  t('shouldNotifyOwner control: the same owner DOES get Complete for an ordinary WO', (await sn({}, { Property_ID: 'P1', Priority: 'normal', Owner_Notify_Override: '' }, 'Complete')) === true);
  t('addonStart creates the child with owner_notify_override off and createWorkOrder persists Owner_Notify_Override', /owner_notify_override: 'off'/.test(grabAsync('addonStart')) && /Owner_Notify_Override: body\.owner_notify_override\|\|''/.test(grabAsync('createWorkOrder')));
  const us = grabAsync('updateStatus');
  t('updateStatus: the owner Complete / On Hold text goes through shouldNotifyOwner then the gated chokepoint', /const notify = await shouldNotifyOwner\(env, wo, ownerEvent\)/.test(us) && /smsGatedSend\(env, \{ wo_id: body\.wo_id, message_type: msgType, recipient_type: 'owner'/.test(us));
}

t('BUILD_VERSION bumped', /const BUILD_VERSION = '2026-09-30\.\d+-vendor-additional-work'/.test(src));

console.log(`vendor-additional-work: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
