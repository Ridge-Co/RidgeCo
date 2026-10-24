// Oct 24 2026 (FEATURE_LOG rule 231): per-property switches, customer apply-with-exclusions, duplicate/merge, gate preview.
// Pulls the REAL functions out of worker.js (same extraction pattern as test/message-queue.test.mjs) and drives them against a small
// in-memory fake of the sheet, so the handlers' real logic runs; only the Sheets plumbing is faked.
import fs from 'fs';
import assert from 'node:assert';
import { d16Deps } from './_d16-support.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const re = new RegExp('(?:async )?function ' + name + '\\(');
  const m = re.exec(src); if (!m) throw new Error('missing ' + name);
  const i = m.index; let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing const ' + name);
  const j = src.indexOf(';\n', i);
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ───────────────────────── pure pieces ─────────────────────────
const PURE_CONSTS = ['smsToggleOn', 'PROPERTY_TOGGLES', 'propToggleDef', 'propToggleRaw', 'SMS_GATE_REASONS', 'PROPERTY_DUP_COLS', 'PROPERTY_MERGE_SKIP_FIELDS', 'PROPERTY_MERGE_BLOCK_IF_DIFFERENT', 'PROPERTY_REF_REGISTRY', 'PROPERTY_REF_IGNORE', 'PROPERTY_REF_COL_RE'];
const PURE_FNS = ['smsGateDecision', 'propToggleOn', 'propToggleStates', 'smsPropertyGateFlags', 'propertyOwnerEmailOn', 'smsGateReasonsFor', 'smsGatePreview', 'ownerToggleApplyPlan', 'propertyMergeFieldPlan', 'propertyMergeWrites', 'propertyRefTargets', 'propertyRefCellHits', 'propertyRefCellRepoint', 'addonEmailGate', 'tenantMovedOut'];
const pureCode = PURE_CONSTS.map(grabConst).join('\n') + '\n' + PURE_FNS.map(grab).join('\n');
const P = new Function('stubs', 'const { normalizePhone, isQuietHoursNow, nextQuietHoursEnd, quietHoldUntil } = stubs;\n' + pureCode + '\nreturn { ' + PURE_CONSTS.concat(PURE_FNS).join(', ') + ' };')({
  normalizePhone: p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : ''; },
  isQuietHoursNow: d => d.getUTCHours() >= 23 || d.getUTCHours() < 13,     // test clock: pretend ET quiet hours are 23:00-13:00 UTC
  nextQuietHoursEnd: d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (d.getUTCHours() >= 23 ? 1 : 0), 13)),
  quietHoldUntil: (d, s, e) => { const h = d.getUTCHours(); return (h >= 20 || h < 8) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (h >= 20 ? 1 : 0), 8)) : null; },
});

// ---- the OLD gate, frozen as an oracle: with no new flags the new function must answer EXACTLY the same ----
function oldGate(o) {
  const fails = [];
  if (!o.global) fails.push('Global OFF');
  if (o.kind === 'tenant') { if (!o.propertyOn) fails.push('Property OFF'); if (!o.ownerOn) fails.push('Customer OFF'); if (!o.tenantOn) fails.push('Tenant OFF'); if (o.tenantOptOut) fails.push('Tenant opted out'); if (o.tenantMovedOut) fails.push('Tenant moved out'); }
  else if (o.kind === 'vendor') { if (!o.vendorOn) fails.push('Vendor OFF'); if (o.vendorOptOut) fails.push('Vendor opted out'); }
  else if (o.kind === 'owner') { if (!o.propertyOn) fails.push('Property OFF'); if (!o.ownerOn) fails.push('Customer OFF'); }
  return { sendOk: fails.length === 0, gateSnapshot: fails.length ? fails.join(', ') : 'all gates open' };
}
{
  let combos = 0;
  for (const kind of ['tenant', 'owner', 'vendor', 'admin']) for (let m = 0; m < 128; m++) {
    const o = { kind, global: !!(m & 1), propertyOn: !!(m & 2), ownerOn: !!(m & 4), tenantOn: !!(m & 8), vendorOn: !!(m & 16), tenantOptOut: !!(m & 32), tenantMovedOut: !!(m & 64) };
    eq(P.smsGateDecision(o), oldGate(o), 'back-compat ' + kind + ' ' + m); combos++;
    // and a property row with NO new columns / blank new columns adds nothing
    eq(P.smsGateDecision(Object.assign({}, o, P.smsPropertyGateFlags({ ID: '1', SMS_Enabled: 'TRUE' }))), oldGate(o), 'blank new columns change nothing ' + kind + ' ' + m);
    eq(P.smsGateDecision(Object.assign({}, o, P.smsPropertyGateFlags(null))), oldGate(o), 'no property changes nothing ' + kind + ' ' + m);
  }
  ok(combos === 512, 'full back-compat matrix ran');
}

// ---- each new switch: blank = ON, TRUE = ON, FALSE = OFF; it blocks ONLY its own audience ----
const base = { global: true, propertyOn: true, ownerOn: true, tenantOn: true, vendorOn: true, tenantOptOut: false, tenantMovedOut: false };
const SW = [['SMS_Tenants_Enabled', 'tenant', 'Property tenant texts OFF'], ['SMS_Owners_Enabled', 'owner', 'Property owner texts OFF'], ['SMS_Vendors_Enabled', 'vendor', 'Property vendor texts OFF']];
for (const [colName, audience, reason] of SW) {
  for (const blank of [undefined, '', '   ']) { const p = {}; if (blank !== undefined) p[colName] = blank; eq(P.smsGateDecision(Object.assign({}, base, { kind: audience }, P.smsPropertyGateFlags(p))).sendOk, true, colName + ' blank is ON'); }
  for (const v of ['TRUE', 'true', ' True ']) eq(P.smsGateDecision(Object.assign({}, base, { kind: audience }, P.smsPropertyGateFlags({ [colName]: v }))).sendOk, true, colName + ' ' + v + ' is ON');
  for (const v of ['FALSE', 'false', ' False ']) {
    const r = P.smsGateDecision(Object.assign({}, base, { kind: audience }, P.smsPropertyGateFlags({ [colName]: v })));
    eq(r.sendOk, false, colName + ' ' + v + ' blocks ' + audience); eq(r.gateSnapshot, reason, colName + ' names its own reason in Gate_Snapshot');
    for (const other of ['tenant', 'owner', 'vendor'].filter(k => k !== audience)) eq(P.smsGateDecision(Object.assign({}, base, { kind: other }, P.smsPropertyGateFlags({ [colName]: v }))).sendOk, true, colName + ' does not block ' + other);
  }
}
{ // master + sub-switch interplay
  const both = P.smsGateDecision(Object.assign({}, base, { kind: 'tenant', propertyOn: false }, P.smsPropertyGateFlags({ SMS_Tenants_Enabled: 'FALSE' })));
  eq(both.gateSnapshot, 'Property OFF, Property tenant texts OFF', 'both reasons are listed, not just the first');
  eq(P.smsGateDecision(Object.assign({}, base, { kind: 'owner', propertyOn: false }, P.smsPropertyGateFlags({ SMS_Owners_Enabled: 'TRUE' }))).gateSnapshot, 'Property OFF', 'master OFF still blocks when the sub-switch is ON');
  eq(P.smsGateDecision(Object.assign({}, base, { kind: 'owner', ownerOn: false }, P.smsPropertyGateFlags({ SMS_Owners_Enabled: 'FALSE' }))).gateSnapshot, 'Property owner texts OFF, Customer OFF', 'customer reason kept alongside');
}
// the registry itself
{
  const keys = P.PROPERTY_TOGGLES.map(t => t.key);
  eq(keys, ['active', 'tenant_wo', 'sms_master', 'sms_tenants', 'sms_owners', 'sms_vendors', 'owner_email'], 'registry has the agreed switches in order');
  ok(P.PROPERTY_TOGGLES.every(t => t.col && t.label && t.help && t.group && t.kind), 'every row has col/label/help/group/kind');
  eq(new Set(P.PROPERTY_TOGGLES.map(t => t.col)).size, P.PROPERTY_TOGGLES.length, 'no two switches share a column');
  const st = P.propToggleStates({ Active: 'TRUE', SMS_Enabled: 'FALSE', Tenant_WO_Toggle: 'ON' });
  eq(st.find(s => s.key === 'sms_master').on, false, 'existing master switch read as before');
  eq(st.find(s => s.key === 'sms_owners').on, true, 'new switch with no column reads ON');
  eq(st.find(s => s.key === 'tenant_wo').on, true, 'tenant WO ON');
  eq(P.propToggleStates({}).find(s => s.key === 'tenant_wo').on, false, 'tenant WO: nothing set stays OFF (existing rule unchanged)');
  eq(P.propToggleStates({ Active: '' }).find(s => s.key === 'active').on, true, 'blank Active reads active');
}
// every real call site spreads the property flags (except the email gate, which must NOT use the text switches)
{
  const calls = [...src.matchAll(/smsGateDecision\(/g)].map(m => m.index);
  let spread = 0, plain = [];
  for (const i of calls) {
    const ctx = src.slice(Math.max(0, i - 120), i + 420);
    if (/function smsGateDecision\(/.test(ctx.slice(0, 160))) continue;
    if (/smsPropertyGateFlags\(/.test(src.slice(i, i + 1100))) spread++; else plain.push(src.slice(i - 60, i + 60).replace(/\s+/g, ' '));
  }
  ok(spread >= 4, 'smsGatedSend, releaseMessageQueue, processQuietHoursQueue, fuGateVerdict all use the property flags (found ' + spread + ')');
  ok(plain.length === 1 && /addonEmailGate|on\(property/.test(plain[0] + src.slice(src.indexOf('function addonEmailGate'), src.indexOf('function addonEmailGate') + 400)), 'only the owner-EMAIL gate calls it without the text switches: ' + JSON.stringify(plain));
}
// reasons text
{
  eq(P.smsGateReasonsFor('all gates open'), [], 'open gates: no reasons');
  const r = P.smsGateReasonsFor('Property OFF, Property owner texts OFF, Customer OFF');
  eq(r.map(x => x.code).sort(), ['customer_off', 'property_off', 'property_owners_off'], 'each token maps to one reason, Property OFF does not swallow the longer names');
  ok(r.find(x => x.code === 'property_owners_off').fix.toggle === 'sms_owners', 'a property reason points at the switch to flip');
  ok(P.smsGateReasonsFor('Global OFF')[0].fix.target === 'global', 'global reason is not fixable on a property');
}

// ───────────────────────── owner email gate ─────────────────────────
{
  const cfg = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }, owner = { SMS_Enabled: 'TRUE', Notify_Method: 'sms' };
  eq(P.addonEmailGate({ cfg, property: { SMS_Enabled: 'TRUE' }, owner }), { ok: true, reason: '' }, 'email allowed as before');
  eq(P.addonEmailGate({ cfg, property: { SMS_Enabled: 'TRUE', Owner_Email_Enabled: '' }, owner }).ok, true, 'blank email switch = ON');
  eq(P.addonEmailGate({ cfg, property: { SMS_Enabled: 'TRUE', Owner_Email_Enabled: 'FALSE' }, owner }), { ok: false, reason: 'Property owner emails OFF' }, 'email switch OFF blocks with its reason');
  eq(P.addonEmailGate({ cfg, property: { SMS_Enabled: 'TRUE', SMS_Owners_Enabled: 'FALSE' }, owner }).ok, true, 'the owner TEXT switch does not block owner EMAILS');
  eq(P.addonEmailGate({ cfg, property: { SMS_Enabled: 'FALSE' }, owner }), { ok: false, reason: 'Property OFF' }, 'existing master-switch outcome unchanged');
  eq(P.addonEmailGate({ cfg: { TWILIO_ENABLED: 'TRUE' }, property: { SMS_Enabled: 'TRUE' }, owner }).reason.startsWith('Test Mode'), true, 'existing Test Mode outcome unchanged');
}

// ───────────────────────── gate preview == the real gate ─────────────────────────
const CFG_OPEN = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' };
const noon = new Date(Date.UTC(2026, 9, 24, 15, 0)), night = new Date(Date.UTC(2026, 9, 25, 0, 30));
{
  const owner = { ID: '5', Phone: '4105551212', SMS_Enabled: 'TRUE' };
  let r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: { ID: '9', SMS_Enabled: 'TRUE' }, owner, now: noon });
  eq([r.outcome, r.will_send, r.gate_snapshot], ['send', true, 'all gates open'], 'open gates: will send');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: { ID: '9', SMS_Enabled: 'FALSE' }, owner, now: noon });
  eq([r.outcome, r.will_send, r.gate_snapshot], ['blocked', false, 'Property OFF'], 'property off: blocked');
  ok(/NOT send/.test(r.headline) && /Texts are OFF for this property/.test(r.headline), 'headline says it will NOT send and why: ' + r.headline);
  eq(r.reasons[0].fix, { target: 'property', toggle: 'sms_master' }, 'reason carries the switch to flip');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: { ID: '9' }, owner: Object.assign({}, owner, { SMS_Enabled: 'FALSE' }), now: noon });
  eq(r.gate_snapshot, 'Customer OFF', 'customer off');
  r = P.smsGatePreview({ cfg: { TWILIO_ENABLED: 'FALSE', TWILIO_TEST_MODE: 'FALSE' }, kind: 'owner', property: { ID: '9' }, owner, now: noon });
  eq(r.gate_snapshot, 'Global OFF', 'global off');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: { ID: '9' }, owner: { ID: '5', SMS_Enabled: 'TRUE' }, now: noon });
  eq(r.outcome, 'no_phone', 'no phone is a reason, not a silent send');
  r = P.smsGatePreview({ cfg: Object.assign({}, CFG_OPEN, { TWILIO_TEST_MODE: 'TRUE' }), kind: 'owner', property: { ID: '9' }, owner, now: noon });
  ok(r.will_send && r.test_mode && /TEST number/.test(r.headline) && r.notes.some(x => /Test Mode/.test(x)), 'test mode is said out loud');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: { ID: '9' }, owner, now: night, quietWindow: { start: 20, end: 8 } });
  eq([r.outcome, r.will_send, r.will_send_later], ['held_quiet_hours', false, true], 'inside the proposal quiet window: held');
  ok(r.send_after, 'held preview says when it goes out');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: { ID: '9' }, owner, now: night, quietWindow: { start: 20, end: 8 }, bypassQuietHours: true });
  eq(r.outcome, 'send', 'quiet-hours override sends now (same as the real send)');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'vendor', property: { ID: '9', SMS_Vendors_Enabled: 'FALSE' }, vendor: { ID: '2', Phone: '4105550000' }, now: noon });
  eq(r.gate_snapshot, 'Property vendor texts OFF', 'vendor preview honours the property switch');
  r = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'tenant', property: { ID: '9' }, owner, tenant: { ID: '3', Phone: '4105559999', SMS_Enabled: 'FALSE' }, now: noon });
  eq(r.gate_snapshot, 'Tenant OFF', 'tenant preview');
}
{ // property x customer x global matrix: preview's snapshot is, by construction and by test, exactly smsGateDecision's for the same inputs
  for (const kind of ['owner', 'tenant', 'vendor']) for (let m = 0; m < 64; m++) {
    const property = { ID: '9', SMS_Enabled: m & 1 ? 'TRUE' : 'FALSE', SMS_Tenants_Enabled: m & 2 ? '' : 'FALSE', SMS_Owners_Enabled: m & 4 ? 'TRUE' : 'FALSE', SMS_Vendors_Enabled: m & 8 ? 'TRUE' : 'FALSE' };
    const owner = { ID: '5', Phone: '4105551212', SMS_Enabled: m & 16 ? 'TRUE' : 'FALSE' };
    const cfg = { TWILIO_ENABLED: m & 32 ? 'TRUE' : 'FALSE', TWILIO_TEST_MODE: 'FALSE' };
    const tenant = { Phone: '4105551111', SMS_Enabled: 'TRUE' }, vendor = { Phone: '4105552222', SMS_Enabled: 'TRUE' };
    const real = P.smsGateDecision(Object.assign({ global: m & 32 ? true : false, propertyOn: P.smsToggleOn(property.SMS_Enabled), ownerOn: P.smsToggleOn(owner.SMS_Enabled), tenantOn: true, vendorOn: true, tenantOptOut: false, vendorOptOut: false, kind, tenantMovedOut: false }, P.smsPropertyGateFlags(property)));
    const pv = P.smsGatePreview({ cfg, kind, property, owner, tenant, vendor, now: noon });
    eq(pv.gate_snapshot, real.gateSnapshot, 'preview == real gate: ' + kind + ' ' + m); eq(pv.gates_open, real.sendOk, 'gates_open agrees ' + kind + ' ' + m);
  }
}

// ── the REAL releaseMessageQueue (what Manual Send runs) gives the same Gate_Snapshot the preview shows, and still ignores quiet hours ──
{
  const code = [grab('releaseMessageQueue'), ...['smsGateDecision', 'smsPropertyGateFlags', 'propToggleOn'].map(grab)].join('\n');
  const calls = { sent: [], updates: [] };
  const mk = rows => new Function('stubs', 'const { ensureSmsInfra, fetchConfig, normalizePhone, fetchTab, tenantForQueuedText, updateMessageQueueRow, mqSendQueuedRow, json, tenantMovedOut, smsToggleOn, MSG_QUEUE_TAB, PROPERTY_TOGGLES, propToggleDef, propToggleRaw } = stubs;\n' + code + '\nreturn releaseMessageQueue;')({
    ensureSmsInfra: async () => {}, fetchConfig: async () => CFG_OPEN, normalizePhone: p => String(p || ''), MSG_QUEUE_TAB: 'Message_Queue',
    fetchTab: async (e, t) => rows[t] || [], tenantForQueuedText: () => null, tenantMovedOut: P.tenantMovedOut, smsToggleOn: P.smsToggleOn,
    PROPERTY_TOGGLES: P.PROPERTY_TOGGLES, propToggleDef: P.propToggleDef, propToggleRaw: (p, d) => String(p && p[d.col] != null ? p[d.col] : '').trim(),
    updateMessageQueueRow: async (e, id, f) => { calls.updates.push([id, f]); }, mqSendQueuedRow: async (e, row) => { calls.sent.push(row.ID); return { sent: true, outcome: {} }; },
    json: x => x,
  });
  const rows = { Message_Queue: [
      { ID: '1', Status: 'pending', Recipient_Type: 'owner', Recipient_Phone: '4105551212', Property_ID: '9', Send_After: '' },
      { ID: '2', Status: 'pending', Recipient_Type: 'vendor', Recipient_Phone: '4105550000', Property_ID: '9', Send_After: '' },
      { ID: '3', Status: 'pending', Recipient_Type: 'owner', Recipient_Phone: '4105551212', Property_ID: '8', Send_After: '' } ],
    Properties: [{ ID: '9', Owner_ID: '5', SMS_Enabled: 'TRUE', SMS_Owners_Enabled: 'FALSE', SMS_Vendors_Enabled: 'FALSE' }, { ID: '8', Owner_ID: '5', SMS_Enabled: 'TRUE' }],
    Owners: [{ ID: '5', SMS_Enabled: 'TRUE', Phone: '4105551212' }], Tenants: [], Vendors: [{ ID: '2', Phone: '4105550000', SMS_Enabled: 'TRUE' }] };
  const out = await mk(rows)({}, { ids: ['1', '2', '3'] });
  const res = out.results;
  eq(res.find(r => r.id === '1').gate_snapshot, 'Property owner texts OFF', 'real release: owner text held with the new reason');
  eq(res.find(r => r.id === '2').gate_snapshot, 'Property vendor texts OFF', 'real release: vendor text held with the new reason');
  eq(res.find(r => r.id === '3').sent, true, 'real release: a property with blank new switches still sends (Manual Send skips quiet hours, nothing else changed)');
  const pv = P.smsGatePreview({ cfg: CFG_OPEN, kind: 'owner', property: rows.Properties[0], owner: rows.Owners[0], now: night });
  eq(pv.gate_snapshot, res.find(r => r.id === '1').gate_snapshot, 'preview text == real release text for the same row');
  ok(calls.sent.length === 1 && calls.updates.length === 2, 'only the open row was sent; the two held rows got their reason written');
}

// ───────────────────────── customer apply-with-exclusions ─────────────────────────
{
  const props = [
    { ID: '1', Address: 'A', Owner_ID: '7', Active: 'TRUE', SMS_Enabled: 'TRUE', SMS_Owners_Enabled: '' },
    { ID: '2', Address: 'B', Owner_ID: '7', Active: 'TRUE', SMS_Enabled: 'TRUE', SMS_Owners_Enabled: 'FALSE' },
    { ID: '3', Address: 'C', Owner_ID: '7', Active: 'FALSE', SMS_Enabled: 'TRUE' },
    { ID: '4', Address: 'D', Owner_ID: '7', Active: 'TRUE', SMS_Enabled: 'TRUE' },
    { ID: '5', Address: 'E', Owner_ID: '8', Active: 'TRUE', SMS_Enabled: 'TRUE' },
  ];
  let pl = P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'FALSE', excludeIds: ['4'] });
  ok(pl.ok, 'plan ok');
  eq(pl.rows.map(r => [r.property_id, r.action]), [['1', 'change'], ['2', 'unchanged'], ['3', 'skip_inactive'], ['4', 'excluded']], 'only this customer; changed / already-off / inactive / excluded');
  eq(pl.rows.find(r => r.property_id === '1').before_on, true, 'blank cell shown as ON before');
  eq(pl.rows.find(r => r.property_id === '1').after_value, 'FALSE', 'will write FALSE');
  eq(pl.rows.find(r => r.property_id === '4').after_value, '', 'excluded: cell stays as it is');
  eq(pl.counts, { total: 4, will_change: 1, unchanged: 1, excluded: 1, inactive: 1 }, 'counts');
  eq(pl.changes.map(c => c.property_id), ['1'], 'only the changed one is written; other customer untouched');
  pl = P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'TRUE', excludeIds: [] });
  eq(pl.changes.map(c => c.property_id), ['2', '4'].filter(id => id === '2'), 'turning ON: a blank (already ON) cell is NOT rewritten; only the explicit FALSE is');
  ok(P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'FALSE', excludeIds: ['5'] }).error.includes('do not belong'), 'excluding another customer\'s property is refused');
  ok(P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'active', value: 'FALSE' }).error, 'Active cannot be bulk-applied');
  ok(P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'tenant_wo', value: 'ON' }).error, 'Tenant WO cannot be bulk-applied here');
  ok(P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'nope', value: 'ON' }).error, 'unknown key refused');
  ok(P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'maybe' }).error, 'bad value refused');
  const none = P.ownerToggleApplyPlan({ properties: props, ownerId: '99', key: 'sms_owners', value: 'FALSE' });
  eq([none.ok, none.counts.total, none.changes.length], [true, 0, 0], 'a customer with no properties plans nothing');
  const a = P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'FALSE', excludeIds: ['4'] }), b = P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'FALSE', excludeIds: ['4'] });
  eq(a.canon, b.canon, 'same plan, same fingerprint'); ok(a.canon !== P.ownerToggleApplyPlan({ properties: props, ownerId: '7', key: 'sms_owners', value: 'FALSE', excludeIds: [] }).canon, 'different exclusions, different fingerprint');
  ok(a.canon !== P.ownerToggleApplyPlan({ properties: props.map(p => p.ID === '1' ? Object.assign({}, p, { SMS_Owners_Enabled: 'TRUE' }) : p), ownerId: '7', key: 'sms_owners', value: 'FALSE', excludeIds: ['4'] }).canon, 'data moved since preview, different fingerprint');
}

// ───────────────────────── merge: field resolution ─────────────────────────
const HDR = ['ID', 'Address', 'City', 'Market', 'Type', 'Unit_Count', 'Owner_ID', 'Lockbox_Code', 'Access_Notes', 'Active', 'SMS_Enabled', 'QBO_Customer_ID', 'Duplicate_Of', 'Duplicate_Marked_Date', 'Merge_Log'];
{ // the real 93 / 94 situation
  const p93 = { ID: '93', Address: '411 W 23rd St', City: '', Market: 'Baltimore', Type: 'rowhome', Unit_Count: '1', Owner_ID: '', Active: 'TRUE', SMS_Enabled: '' };
  const p94 = { ID: '94', Address: '411 West 23rd St', City: 'Baltimore', Market: 'Baltimore', Type: 'rowhome', Unit_Count: '1', Owner_ID: '24', Active: 'TRUE', SMS_Enabled: 'TRUE', Access_Notes: 'lockbox on rail' };
  const fp = P.propertyMergeFieldPlan(p93, p94, HDR);
  eq(fp.conflicts, [{ col: 'Address', from: '411 W 23rd St', to: '411 West 23rd St' }], '93 -> 94: the ONLY question is the address spelling');
  eq(fp.auto, [], 'nothing needs copying over from the empty-ish 93');
  eq(fp.blocks, [], 'no hard block: 93 has no owner, so there is no owner conflict');
  ok(fp.keep_target >= 3, 'empty side never overwrites 94 (city, owner, SMS, notes)');
  const rev = P.propertyMergeFieldPlan(p94, p93, HDR);
  eq(rev.auto.map(a => a.col).sort(), ['Access_Notes', 'City', 'Owner_ID', 'SMS_Enabled'], 'merging the other way would pull 94\'s values into 93 with no prompt');
}
{
  const fp = P.propertyMergeFieldPlan({ Address: 'X', City: ' baltimore ', Type: 'a', Lockbox_Code: '1234' }, { Address: 'X', City: 'Baltimore', Type: 'b', Lockbox_Code: '' }, HDR);
  eq(fp.same, 2, 'identical (ignoring case and spaces) is not a question'); eq(fp.conflicts.map(c => c.col), ['Type'], 'only a real difference is asked');
  eq(fp.auto, [{ col: 'Lockbox_Code', value: '1234' }], 'one side empty: take the non-empty, no prompt');
  const w = P.propertyMergeWrites(fp, {}); eq(w.missing, ['Type'], 'unanswered conflict is reported, never guessed'); eq(w.writes, { Lockbox_Code: '1234' }, 'auto values are written');
  const w2 = P.propertyMergeWrites(fp, { Type: 'from' }); eq(w2.writes, { Lockbox_Code: '1234', Type: 'a' }, 'picking the duplicate\'s value writes it'); eq(w2.missing, [], 'nothing missing');
  eq(P.propertyMergeWrites(fp, { Type: 'to' }).writes, { Lockbox_Code: '1234' }, 'picking the kept property\'s value writes nothing');
  eq(P.propertyMergeWrites(fp, { Type: 'bogus' }).missing, ['Type'], 'a bad pick counts as unanswered');
  const blk = P.propertyMergeFieldPlan({ Owner_ID: '1', QBO_Customer_ID: '77' }, { Owner_ID: '2', QBO_Customer_ID: '88' }, HDR);
  eq(blk.blocks.length, 2, 'two different owners / QuickBooks customers is a hard block, not a pick'); eq(blk.conflicts, [], 'and never offered as a pick');
  eq(P.propertyMergeFieldPlan({ ID: '1', Active: 'FALSE', Unit_Count: '2', Duplicate_Of: 'x' }, { ID: '2', Active: 'TRUE', Unit_Count: '3', Duplicate_Of: '' }, HDR).conflicts, [], 'ID, Active, Unit_Count and the duplicate columns are never compared');
}

// ───────────────────────── merge: references ─────────────────────────
{
  const hb = { Properties: HDR, Work_Orders: ['ID', 'Property_ID', 'Property_Address', 'Status'], Units: ['ID', 'Property_ID', 'Unit_Label', 'Property_Address'], Master_Keys: ['ID', 'Property_IDs'], Trash_Visits: ['ID', 'Property_ID'], Insp_Units: ['ID', 'Property_ID'], Widgets: ['ID', 'Linked_Property_ID'], Message_Queue: ['ID', 'Property_ID'], Owners: ['ID', 'Tenant_WO_Property_IDs'], Vendors: ['ID', 'Billing_Property_Access'], Receipts_Queue: ['ID', 'Suggested_Property_ID'], Notes: ['ID', 'Property_ID'] };
  const t = P.propertyRefTargets(hb);
  ok(['Work_Orders', 'Units', 'Master_Keys', 'Message_Queue', 'Owners', 'Vendors', 'Receipts_Queue', 'Notes'].every(x => t.targets.some(y => y.tab === x)), 'registry columns found by header');
  eq(t.ignored.map(i => i.tab).sort(), ['Insp_Units', 'Trash_Visits'], 'other lists\' ids (Trash, Insp) are ignored on purpose');
  eq(t.unknown, [{ tab: 'Widgets', col: 'Linked_Property_ID' }], 'a property-id-looking column nobody registered is surfaced');
  ok(!t.targets.some(x => x.tab === 'Properties'), 'the Properties tab itself is not scanned');
  ok(P.propertyRefTargets({ Work_Orders: ['ID', 'Status'] }).targets.length === 0, 'a tab without the column is skipped');
  eq(P.propertyRefCellRepoint('1,93,5', 'list', '93', '94'), '1,94,5', 'comma list: id swapped in place');
  eq(P.propertyRefCellRepoint('94,93', 'list', '93', '94'), '94', 'comma list: target already there, no duplicate id');
  eq(P.propertyRefCellRepoint('93', 'id', '93', '94'), '94', 'single id');
  ok(P.propertyRefCellHits('1, 93 ,5', 'list', '93') && !P.propertyRefCellHits('193', 'list', '93') && !P.propertyRefCellHits('193', 'id', '93') && !P.propertyRefCellHits('', 'id', '93'), 'matches whole ids only (93 is not 193)');
}

// ───────────────────────── merge: full plan + handlers on a fake sheet ─────────────────────────
function colLetter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function makeWorld(db, hooks = {}) {
  const failures = [], telemetry = [], batchWrites = [];
  const fake = {
    sheetsRequest: async (env, method, path, body) => {
      if (hooks.failRead && method === 'GET') throw new Error('Sheets API error: 503');
      if (method === 'GET' && path.startsWith('?fields=')) return { sheets: Object.keys(db).map(t => ({ properties: { title: t } })) };
      if (method === 'GET' && path.startsWith('/values:batchGet?')) {
        const ranges = path.slice('/values:batchGet?'.length).split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, '')));
        return { valueRanges: ranges.map(r => {
          let m = /^'(.*)'!1:1$/.exec(r); if (m) return { values: [(db[m[1]] || [[]])[0]] };
          m = /^'(.*)'!([A-Z]+)(\d+)$/.exec(r);
          if (m) { const rows = db[m[1]], ci = [...m[2]].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, v = (rows[+m[3] - 1] || [])[ci]; return v === undefined || v === '' ? {} : { values: [[v]] }; }
          m = /^'(.*)'$/.exec(r); return { values: db[m[1]] };
        }) };
      }
      if (method === 'POST' && path === '/values:batchUpdate') {
        if (hooks.failWrite && body.data.some(d => hooks.failWrite(d))) throw new Error('Sheets API error: quota');
        batchWrites.push(body.data);
        for (const d of body.data) { const m = /^'(.*)'!([A-Z]+)(\d+)$/.exec(d.range), ci = [...m[2]].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1; const row = db[m[1]][+m[3] - 1]; while (row.length <= ci) row.push(''); row[ci] = d.values[0][0]; }
        return {};
      }
      throw new Error('unexpected sheets call ' + method + ' ' + path);
    },
    toObjs: t => { const [h, ...r] = db[t] || [[]]; return r.map(row => { const o = {}; h.forEach((k, i) => { o[k] = row[i] == null ? '' : String(row[i]); }); return o; }); },
  };
  const stubs = {
    sheetsRequest: fake.sheetsRequest, json: (x, status) => ({ status: status || 200, body: x }),
    fetchTab: async (e, t) => fake.toObjs(t), fetchTabs: async (e, ts) => ts.map(t => fake.toObjs(t)), invalidateTabCache: () => {},
    ensureColumns: async (e, t, cols) => { if (hooks.failEnsure) throw new Error('ensureColumns failed'); for (const c of cols) if (!db[t][0].includes(c)) { db[t][0].push(c); db[t].slice(1).forEach(r => r.push('')); } },
    updateRowVerified: async (e, t, id, fields) => {
      if (hooks.failVerified && hooks.failVerified(t, id, fields)) throw new Error(t + ' row ' + id + ' did not keep: ' + Object.keys(fields).join(', '));
      const h = db[t][0], row = db[t].slice(1).find(r => String(r[h.indexOf('ID')]) === String(id)); if (!row) throw new Error('no row');
      for (const [k, v] of Object.entries(fields)) { const ci = h.indexOf(k); if (ci < 0) throw new Error(t + ' row ' + id + ' was not updated (No matching fields)'); while (row.length <= ci) row.push(''); row[ci] = v; }
      return {};
    },
    reportFailure: async (e, f) => { failures.push(f); }, logTelemetry: async (e, r) => { telemetry.push(r); },
    fuSha256: async s => 'H' + Array.from(String(s)).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16),
    etTodayISO: () => '2026-10-24', col: colLetter, idColIndex: h => Math.max(0, h.indexOf('ID')), resolveTenantWOAccess: () => false, smsToggleOn: P.smsToggleOn,
    PORTAL_BASE: 'https://x.test', SCOPE_SMS_QUIET_WINDOW: { start: 20, end: 8 }, fetchConfig: async () => CFG_OPEN, findWO: (w, id) => w.find(x => x.ID === id),
  };
  const names = ['ppWriteCells', 'propertyToggleSet', 'propertyInfoSave', 'propertyUnitSave', 'ownerToggleApplyHandler', 'propertyMarkDuplicate', 'propertyMergeLoad', 'propertyMergePlan', 'propertyMergeHandler', 'propertyDetail', 'smsGatePreviewHandler', 'ppResolveGateProperty'];
  const consts = ['PP_TOGGLE_COLS', 'PP_SYSTEM_COLS', 'PROPERTY_INFO_GROUPS', 'PP_UNIT_FIELDS', 'PP_UNIT_NEW_COLS', 'ppStr', 'ppIdx', 'ppOwnerName', 'ppFail', 'ppAudit', 'ppSheetRange', 'ppRawObj', 'ppMergeView'];
  const code = consts.map(grabConst).join('\n') + '\n' + names.map(grab).join('\n');
  const stubNames = Object.keys(stubs);
  const API = new Function('stubs', 'P', 'const { ' + stubNames.join(', ') + ' } = stubs;\nconst { PROPERTY_TOGGLES, propToggleDef, propToggleRaw, propToggleOn, propToggleStates, ownerToggleApplyPlan, propertyMergeFieldPlan, propertyMergeWrites, propertyRefTargets, propertyRefCellHits, propertyRefCellRepoint, PROPERTY_DUP_COLS, smsGatePreview, propertyOwnerEmailOn } = P;\nconst isStaging = () => false;\n' + code + '\nreturn { ' + names.join(', ') + ' };')(stubs, P);
  return { API, db, failures, telemetry, batchWrites, fake };
}
const freshDb = () => ({
  Properties: [HDR.slice(), ['93', '411 W 23rd St', '', 'Baltimore', 'rowhome', '1', '', '', '', 'TRUE', '', '', '', '', ''], ['94', '411 West 23rd St', 'Baltimore', 'Baltimore', 'rowhome', '1', '24', '', 'lockbox', 'TRUE', 'TRUE', '', '', '', ''], ['10', 'TEST-1 Main', 'Balt', 'Baltimore', 'house', '2', '7', '', '', 'TRUE', '', '', '', '', ''], ['11', 'TEST-2 Main', 'Balt', 'Baltimore', 'house', '2', '7', '', '', 'TRUE', '', '', '', '', '']],
  Work_Orders: [['ID', 'Property_ID', 'Property_Address', 'Status'], ['W1', '10', 'TEST-1 Main', 'Done'], ['W2', '11', 'TEST-2 Main', 'Open'], ['W3', '10', 'TEST-1 Main', 'Open'], ['W4', '93', 'x', 'Open']],
  Units: [['ID', 'Property_ID', 'Unit_Label', 'Property_Address', 'Active'], ['u1', '10', 'A', 'TEST-1 Main', 'FALSE'], ['u2', '10', 'B', 'TEST-1 Main', 'TRUE'], ['u3', '11', 'C', 'TEST-2 Main', 'TRUE']],
  Master_Keys: [['ID', 'Property_IDs'], ['k1', '1,10,5'], ['k2', '10'], ['k3', '11,10']],
  Message_Queue: [['ID', 'Property_ID', 'Status'], ['m1', '10', 'sent']],
  Trash_Visits: [['ID', 'Property_ID'], ['t1', '10']],
  Owners: [['ID', 'Tenant_WO_Property_IDs', 'SMS_Enabled', 'Company', 'First_Name', 'Last_Name', 'Active'], ['7', '10,11', 'TRUE', 'Phoenix', 'Amanda', 'I', 'TRUE'], ['24', '', 'TRUE', '', 'Greg', 'O', 'TRUE']],
});
{ // preview: 10 -> 11, counts per tab, inactive unit included, comma lists, trash ignored
  const w = makeWorld(freshDb());
  const out = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false);
  const v = out.body;
  eq(v.preview, true, 'preview flagged'); eq(v.ok, true, 'no blocks: ' + JSON.stringify(v.blocks));
  eq(Object.fromEntries(v.tabs.map(t => [t.tab, t.count])), { Work_Orders: 2, Units: 2, Master_Keys: 3, Message_Queue: 1, Owners: 1 }, 'per-tab counts incl. the INACTIVE unit, comma lists and the message queue; Trash_Visits ignored');
  eq(v.total_rows_to_move, 9, 'total rows to move'); ok(v.token && v.token.startsWith('H'), 'preview returns a token');
  eq(w.batchWrites.length, 0, 'preview writes nothing'); eq(w.failures.length, 0, 'preview reports nothing');
}
{ // apply: everything moves, nothing deleted, old property marked only at the end, list cells fixed, address text refreshed
  const w = makeWorld(freshDb());
  const prev = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  const out = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: prev.token, confirm: true, resolutions: Object.fromEntries(prev.conflicts.map(c => [c.col, 'to'])) }, true);
  eq([out.status, out.body.ok, out.body.merged], [200, true, true], 'merge ok: ' + JSON.stringify(out.body));
  const d = w.db;
  eq(d.Work_Orders.slice(1).map(r => r[1]), ['11', '11', '11', '93'], 'work orders re-pointed (93 untouched)');
  eq(d.Work_Orders.slice(1, 4).map(r => r[2]), ['TEST-2 Main', 'TEST-2 Main', 'TEST-2 Main'], 'denormalized address text matches the surviving property');
  eq(d.Units.slice(1).map(r => r[1]), ['11', '11', '11'], 'units (including the inactive one) re-pointed');
  eq(d.Master_Keys.slice(1).map(r => r[1]), ['1,11,5', '11', '11'], 'master-key lists re-pointed without duplicate ids');
  eq(d.Owners[1][1], '11', 'owner tenant-WO property list re-pointed (10,11 -> 11)');
  eq(d.Trash_Visits[1][1], '10', 'Trash_Visits belongs to another list and is untouched');
  const old = d.Properties.find(r => r[0] === '10'), h = d.Properties[0];
  eq([old[h.indexOf('Active')], old[h.indexOf('Duplicate_Of')]], ['FALSE', '11'], 'old property hidden and pointed at the survivor');
  ok(old[h.indexOf('Merge_Log')].includes('"Work_Orders":2'), 'merge log keeps the per-tab counts'); ok(d.Properties.length === 5, 'NOTHING deleted: the old property row still exists');
  eq(w.failures.length, 0, 'happy path reports nothing');
  const again = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(again.ok, false, 'a merged property cannot be merged again'); ok(/already merged/.test(again.blocks.join(' ')), 'and says why');
}
{ // apply is refused on a stale token, an unanswered conflict, and a missing confirm - and writes nothing
  const db = freshDb(); db.Properties[3][1] = 'TEST-1 Main St'; db.Properties[4][1] = 'TEST-2 Main Street';   // an address conflict
  const w = makeWorld(db);
  const prev = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(prev.conflicts.map(c => c.col), ['Address'], 'address is the one question');
  let r = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: prev.token, confirm: true }, true);
  eq([r.status, r.body.missing], [400, ['Address']], 'unanswered conflict is refused');
  r = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: 'stale', confirm: true, resolutions: { Address: 'from' } }, true);
  eq([r.status, r.body.code], [409, 'changed_since_preview'], 'stale token refused');
  r = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: prev.token, resolutions: { Address: 'from' } }, true);
  eq(r.status, 400, 'no confirm, no merge');
  eq(w.batchWrites.length, 0, 'none of those wrote anything');
  r = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: prev.token, confirm: true, resolutions: { Address: 'from' } }, true);
  eq(r.body.ok, true, 'with the pick it merges'); eq(w.db.Properties.find(x => x[0] === '11')[1], 'TEST-1 Main St', 'the picked address was written to the survivor');
}
{ // blocks: self, unknown reference that mentions the property, twin unit, different owners
  let w = makeWorld(freshDb());
  eq((await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '10' }, false)).body.ok, false, 'self-merge refused');
  const db = freshDb(); db.Widgets = [['ID', 'Linked_Property_ID'], ['x', '10']];
  w = makeWorld(db); let v = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(v.ok, false, 'an unknown column that mentions the property blocks the merge'); ok(/Widgets\.Linked_Property_ID/.test(v.blocks.join(' ')), 'and names it');
  const db2 = freshDb(); db2.Widgets = [['ID', 'Linked_Property_ID'], ['x', '55']];
  w = makeWorld(db2); v = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(v.ok, true, 'an unknown column that does NOT mention it does not block'); eq(v.unknown_columns, [{ tab: 'Widgets', col: 'Linked_Property_ID', count: 0 }], 'but is listed');
  const db3 = freshDb(); db3.Units.push(['u9', '11', 'a', 'x', 'TRUE']);
  w = makeWorld(db3); v = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(v.ok, false, 'twin unit labels (A on both, case-insensitive) block'); ok(/"A"/.test(v.blocks.join(' ')), 'and name the unit');
  const db4 = freshDb(); db4.Properties[3][6] = '7'; db4.Properties[4][6] = '24';
  w = makeWorld(db4); v = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(v.ok, false, 'two different owners block'); ok(/Owner_ID/.test(v.blocks.join(' ')), 'and says Owner_ID');
  const db5 = freshDb(); db5.Properties[4][12] = '94';
  w = makeWorld(db5); v = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(v.ok, false, 'cannot merge INTO a property that is itself a marked duplicate');
}
{ // the known real case: 93 -> 94, zero rows to move except one work order, nothing executed by this test beyond the fake
  const w = makeWorld(freshDb());
  const v = (await w.API.propertyMergeHandler({}, { from_id: '93', to_id: '94' }, false)).body;
  eq(v.ok, true, '93 -> 94 is mergeable'); eq(v.conflicts.map(c => c.col), ['Address'], 'one pick: the address');
  eq(v.auto, [], 'nothing auto-taken'); eq(v.tabs.map(t => [t.tab, t.count]), [['Work_Orders', 1]], 'only what the fake gave 93');
}
// ── fault injection: a write that fails mid-merge is REPORTED, returned as a failure, and the old property is NOT marked ──
{
  const w = makeWorld(freshDb(), { failWrite: d => /Units/.test(d.range) });
  const prev = (await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  const r = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: prev.token, confirm: true, resolutions: { Address: 'to' } }, true);
  eq([r.status, r.body.ok], [500, false], 'failed write is a failure, not a success claim');
  ok(/stopped/.test(r.body.error) && r.body.error.includes('Work_Orders'), 'tells the user what moved and what to do: ' + r.body.error);
  eq(w.failures.length, 1, 'reported once'); eq([w.failures[0].severity, w.failures[0].where], ['P1', 'property_merge_apply'], 'P1 data write failure');
  eq(w.db.Properties.find(x => x[0] === '10')[w.db.Properties[0].indexOf('Active')], 'TRUE', 'the old property is NOT marked when the move did not finish');
  const retry = makeWorld(w.db);   // same (half-moved) data, no fault: preview again then finish
  const pv = (await retry.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  eq(pv.tabs.some(t => t.tab === 'Work_Orders'), false, 'after the partial move, preview shows only what is left (safe to re-run)');
  const fin = await retry.API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: pv.token, confirm: true, resolutions: { Address: 'to' } }, true);
  eq(fin.body.ok, true, 'a re-run finishes the job'); eq(retry.failures.length, 0, 'and reports nothing');
}
{ // a scan that cannot read the sheet refuses, reports, and writes nothing
  const w = makeWorld(freshDb(), { failRead: true });
  const r = await w.API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false);
  eq([r.status, r.body.ok], [500, false], 'FAULT: unreadable sheet -> a failure, not an empty "nothing to move" preview');
  ok(/Nothing was changed/.test(r.body.error), 'says nothing was changed'); eq([w.failures.length, w.failures[0].where], [1, 'property_merge_scan'], 'and reports it');
}
// ── a cell that does not keep its value (read-back mismatch) is a failure too ──
{
  const { API, failures } = makeWorld(freshDb(), { failVerified: (t, id, f) => t === 'Properties' && 'Duplicate_Of' in f });
  const prev = (await API.propertyMergeHandler({}, { from_id: '10', to_id: '11' }, false)).body;
  const r = await API.propertyMergeHandler({}, { from_id: '10', to_id: '11', token: prev.token, confirm: true, resolutions: { Address: 'to' } }, true);
  eq([r.status, r.body.ok], [500, false], 'final marking that does not stick is a visible failure'); eq(failures.length, 1, 'and is reported');
}

// ───────────────────────── toggle write, apply, mark duplicate: success AND fault injection ─────────────────────────
{
  const w = makeWorld(freshDb());
  let r = await w.API.propertyToggleSet({}, { property_id: '10', key: 'sms_owners', value: 'FALSE' });
  eq([r.status, r.body.ok, r.body.before, r.body.value], [200, true, '', 'FALSE'], 'toggle written, before was blank');
  ok(w.db.Properties[0].includes('SMS_Owners_Enabled'), 'ensureColumns ran before the write');
  eq(w.db.Properties.find(x => x[0] === '10')[w.db.Properties[0].indexOf('SMS_Owners_Enabled')], 'FALSE', 'sheet really holds FALSE');
  eq(w.failures.length, 0, 'happy path reports nothing');
//__CONT__
