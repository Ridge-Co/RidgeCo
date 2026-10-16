// Tenant fix-check (Oct 16 2026). Runs the REAL FIX_CHECK block of worker.js (plus the real SMS gate / token / tenant helpers it relies on)
// against in-memory sheets and a fake SMS sender. Includes forced-failure ("fault injection") tests: every failure must be logged,
// must reach the caller, and must never be reported as success.
import fs from 'fs';
import assert from 'node:assert';
import './_wo-status-global.mjs';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(sig) {
  const i = w.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = w.indexOf('{', w.indexOf(')', i));
  for (; j < w.length; j++) { if (w[j] === '{') d++; else if (w[j] === '}') { d--; if (!d) break; } }
  return w.slice(i, j + 1);
}
function grabLine(sig) { const i = w.indexOf(sig); if (i < 0) throw new Error('missing ' + sig); return w.slice(i, w.indexOf('\n', i)); }
let n = 0; const ok = (c, m, extra) => { try { assert.ok(c, m); } catch (e) { console.log('FAIL: ' + m, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); process.exitCode = 1; return; } n++; };

const BLOCK = w.slice(w.indexOf('/* FIX_CHECK:START */'), w.indexOf('/* FIX_CHECK:END */'));
ok(BLOCK.length > 20000, 'found the FIX_CHECK block');
// ── no swallowing catches anywhere in the block ──────────────────────────────────────────────
ok(!/catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/.test(BLOCK), 'no empty catch in the fix-check block');
ok(!/\.catch\(\s*\(\s*\)\s*=>/.test(BLOCK), 'no .catch(() => ...) in the fix-check block');
const catches = BLOCK.match(/catch\s*\((\w+)\)\s*\{[^}]*\}/g) || [];
const silent = catches.filter(c => !/(throw|return|push\(|fuTelemetry|errors\.push|console\.error|json\(|success: false)/.test(c));
ok(silent.length === 0, 'every catch in the block rethrows, returns, pushes a warning/error or logs telemetry', silent);

// ── the harness ──────────────────────────────────────────────────────────────────────────────
const helpers = [
  grabLine('const TENANT_STOP_NOTE'), grab('function withTenantStopNote('),
  grab('function isTenantCurrent('), grab('function tenantsForDispatch('), grab('function formatUnitLabel('),
  grab('function smsGateDecision('), grabLine('const smsToggleOn'), grab('function tenantMovedOut('), grab('function normalizePhone('),
  grab('function nyOffsetMinutes('), grab('function etHour('), grabLine('const QUIET_HOURS_START_ET'), grabLine('const QUIET_HOURS_END_ET'), grab('function isQuietHoursNow('),
  grab('function findWO('), grab('function isMissingTabError('), grabLine('const HUB_URL'), grabLine('const _tenc'),
  grab('function _b64urlBytes('), grab('function _b64urlToBytes('), grab('async function _hmac('), grab('async function makeSessionToken('), grab('async function verifySessionToken('),
].join('\n');
function makeWorld(init) {
  const W = { tabs: JSON.parse(JSON.stringify(init.tabs || {})), cfg: Object.assign({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE', admin_phone: '+14105550100' }, init.cfg || {}),
    sms: [], telemetry: [], audit: [], uploads: [], attachments: [], ensureTabCalls: [], fail: {}, smsResult: null, now: init.now || null };
  const hasTab = t => Object.prototype.hasOwnProperty.call(W.tabs, t);
  const missing = t => { const e = new Error('Unable to parse range: ' + t); return e; };
  const deps = {
    json: (data, status = 200) => ({ status, async json() { return JSON.parse(JSON.stringify(data)); }, _d: data }),
    fetchTab: async (_e, t) => { if (W.fail.fetchTab === t) throw new Error('Sheets read exploded (' + t + ')'); if (!hasTab(t)) throw missing(t); return W.tabs[t].map(r => Object.assign({}, r)); },
    fetchTabs: async (_e, ts) => Promise.all(ts.map(t => deps.fetchTab(_e, t))),
    fetchConfig: async () => Object.assign({}, W.cfg),
    ensureTab: async (_e, t, cols) => { W.ensureTabCalls.push(t); if (W.fail.ensureTab) throw new Error('could not create tab ' + t); if (!hasTab(t)) W.tabs[t] = []; },
    ensureColumns: async () => {},
    addRow: async (_e, t, body) => { if (W.fail.addRow) return deps.json({ error: 'append failed' }, 500); const rows = W.tabs[t]; const id = String(rows.reduce((m, r) => Math.max(m, parseInt(r.ID || '0') || 0), 0) + 1); rows.push(Object.assign({ ID: id, Active: 'TRUE' }, body)); return deps.json({ success: true, id }); },
    updateRow: async (_e, t, id, fields) => {
      if (W.fail.updateRow && W.fail.updateRow(fields)) throw new Error('Sheets write exploded');
      const r = W.tabs[t].find(x => String(x.ID) === String(id)); if (!r) return deps.json({ error: 'Row not found' }, 404);
      if (W.fail.dropWrite && W.fail.dropWrite(fields)) return deps.json({ success: true });           // claims success but changes nothing
      Object.assign(r, fields); return deps.json({ success: true });
    },
    logTelemetry: async (_e, rec) => { if (W.fail.telemetry) throw new Error('telemetry down'); W.telemetry.push(rec); },
    logWOAudit: async (_e, ...a) => { W.audit.push(a); },
    getAdminSmsRecipient: async () => ({ Name: 'Brett', Phone: W.cfg.admin_phone }),
    smsGatedSend: async (_e, o) => { W.sms.push(o); if (W.fail.sms) throw new Error('twilio down'); if (W.smsResult) return typeof W.smsResult === 'function' ? W.smsResult(o) : W.smsResult; return { queued_id: String(W.sms.length), send_ok: true, sent: true, gate_snapshot: 'all gates open', delivered_to: '+1', message_body: o.message_body }; },
    createUploadSession: async (_e, o) => { W.uploads.push(o); return deps.json({ success: true, upload_url: 'https://drive/upload', wo_folder_id: 'F1', wo_folder_url: 'u' }); },
    logAttachment: async (_e, o) => { W.attachments.push(o); return deps.json({ success: true }); },
    isStaging: () => false,
  };
  const names = Object.keys(deps);
  const src = helpers + '\n' + BLOCK + '\nreturn { classifyIssue, fuQuestionSpec, fuValidateAnswer, fuSuggestNext, fuResolveTenants, fuGateVerdict, fuMessage, fuTokenCheck, fuMintToken, fuAddHash, fuHashMatches, fuSha256, fuSweepDue, fuInReminderWindow, fuSendOutcome, fuDateLabel, fuLabelFor, followupPreview, followupSend, followupLink, followupClose, followupList, fixPage, fixAnswer, fixUploadSession, fixLogAttachment, followupSweep, fuDigestLines, makeSessionToken, FU_COLS, FU_DUE_DAYS, FU_WINDOW_DAYS };';
  const api = new Function(...names, src)(...names.map(k => deps[k]));
  return Object.assign(W, { api, env: { WORKER_SECRET: 'test-secret-123', __STAGING__: !!init.staging } });
}
const url = (path, params) => { const u = new URL('https://hub.test' + path); for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v); return u; };
const D = r => r._d;
const T0 = new Date('2026-10-16T15:00:00Z');           // 11:00 ET, inside reminder hours

// ═══ A. classifyIssue ═══════════════════════════════════════════════════════════════════════
const W0 = makeWorld({});
const C = d => W0.api.classifyIssue(typeof d === 'string' ? { Description: d } : d);
{
  const c = C('window leak. Need repaired and drywall/paint');
  ok(c.check_type === 'leak', 'WO-1152 text is a leak', c);
  ok(c.problem_label === 'the window leak', 'WO-1152 label is "the window leak"', c.problem_label);
  ok(c.repair_part === 'window leak. Need repaired', 'repair part is the leak, not the drywall', c.repair_part);
  ok(c.cosmetic_part === 'drywall/paint', 'cosmetic part is drywall/paint (kept whole)', c.cosmetic_part);
  ok(!c.cosmetic_only && c.confidence === 'high', 'not cosmetic only; high confidence');
  ok(c.object_label === 'the window' && c.problem_label_es === 'la filtración de agua en la ventana', 'object + Spanish label', c);
}
{
  const c = C('Slow bathtub drain. Remove clog and check sink drain as well. Change unit door locks');
  ok(c.check_type === 'plumbing_flow' && c.problem_label === 'the bathtub drain', 'drain WO is plumbing_flow / "the bathtub drain"', c);
  ok(/Slow bathtub drain/.test(c.repair_part) && /Remove clog/.test(c.repair_part) && !/lock/i.test(c.repair_part), 'repair part = the drain jobs, not the lock change', c.repair_part);
  ok(c.also_mentioned.length === 1 && /door locks/i.test(c.also_mentioned[0]), 'the lock change is listed as "also on this WO" (not asked)', c.also_mentioned);
  ok(c.cosmetic_part === '', 'no cosmetic part');
}
{
  const c = C('fan reinstall. Not sure what happened, but started falling off ceiling');
  ok(c.check_type === 'other' && c.problem_label === 'the fan', 'ceiling fan WO falls back to generic "other" / "the fan"', c);
  ok(/fan reinstall/.test(c.repair_part) && /falling off ceiling/.test(c.repair_part) && c.confidence === 'low', 'whole description kept as the repair part; low confidence');
}
ok(C('Kitchen outlet not working, sparks when plugging in').check_type === 'electrical' && C('Kitchen outlet not working').problem_label === 'the outlet', 'outlet = electrical / "the outlet"');
ok(C('Hot water heater not working').check_type === 'plumbing_flow' && C('Hot water heater not working').problem_label === 'the hot water', 'hot water heater is plumbing_flow, not hvac');
ok(C('No heat in bedroom').check_type === 'hvac' && C('AC not cooling').check_type === 'hvac', 'heat / AC = hvac');
ok(C('Fridge not cooling').check_type === 'appliance', 'a fridge that is not cooling is an appliance, not hvac');
ok(C('Toilet leaking at base').check_type === 'leak' && C('Toilet leaking at base').problem_label === 'the toilet leak', 'a leaking toilet is a leak');
ok(C('Mice in the kitchen').check_type === 'pest', 'mice = pest');
ok(C('Rekey front door lock').check_type === 'lock_door', 'rekey = lock_door');
{
  const c = C('Roof leak above bedroom; patch hole and paint ceiling');
  ok(c.check_type === 'leak' && c.problem_label === 'the roof leak' && /paint ceiling/.test(c.cosmetic_part) && /patch hole/.test(c.cosmetic_part) && !/paint/.test(c.repair_part), 'roof leak + patch/paint ceiling splits repair from cosmetic', c);
}
{
  const c = C('Repaint hallway and touch up trim');
  ok(c.cosmetic_only === true && c.repair_part === '' && c.warnings.length === 1, 'a cosmetic-only WO says so and has no repair part', c);
}
ok(C({ Description: 'broken', Trade: 'Electrical' }).check_type === 'electrical' && C({ Description: 'broken', Trade: 'Electrical' }).confidence === 'medium', 'trade is the tie-breaker when the words name nothing');
{ const c = C(''); ok(c.check_type === 'other' && c.problem_label === 'the repair', 'empty description -> generic, never throws', c); }
ok(C('Fix leak and repaint').cosmetic_part === 'repaint' && C('Fix leak and repaint').repair_part === 'Fix leak', 'joiners split "fix leak and repaint"');
ok(C(null).check_type === 'other', 'null work order does not throw');

// ═══ B. questions + answer validation ══════════════════════════════════════════════════════
const cls1152 = C('window leak. Need repaired and drywall/paint');
const specLeak = W0.api.fuQuestionSpec(Object.assign({}, cls1152, { repair_date: '2026-10-10' }));
ok(specLeak.question.en === 'Since Oct 10, have you seen water come in at the window?', 'leak question (EN)', specLeak.question);
ok(specLeak.question.es === 'Desde el 10 de oct, ¿ha visto entrar agua en la ventana?', 'leak question (ES)', specLeak.question);
ok(specLeak.options.map(o => o.value).join() === 'dry,same_spot,worse,different_spot,not_sure', 'leak options: dry / same / worse / different / not sure');
ok(specLeak.options.every(o => o.label.en && o.label.es), 'every option has English and Spanish');
ok(!/paint|drywall|cosmetic|patch/i.test(JSON.stringify(specLeak)), 'the tenant questions NEVER mention paint / drywall / cosmetics');
ok(W0.api.fuQuestionSpec({ check_type: 'leak', problem_label: 'the leak' }).question.en === 'Have you seen water come in at the spot we repaired?', 'no repair date: question still reads well');
{
  const v = (body, spec = specLeak) => W0.api.fuValidateAnswer(spec, body);
  ok(v({ choice: 'dry', rain_since: 'no' }).clean.answer === 'resolved' && v({ choice: 'dry', rain_since: 'no' }).clean.extra.rain_since === 'no', '"dry" -> resolved, keeps rain_since');
  ok(v({ choice: 'same_spot', trigger: 'during_rain', when: 'Tuesday', note: 'drips' }).clean.answer === 'persists', 'same spot -> persists');
  ok(v({ choice: 'worse' }).clean.answer === 'worse', 'worse -> worse');
  ok(v({ choice: 'different_spot' }).error === 'missing_field' && v({ choice: 'different_spot' }).field === 'location', 'a different spot REQUIRES a location');
  const dl = v({ choice: 'different_spot', location: 'Bathroom ceiling', trigger: 'all_the_time' }); ok(dl.ok && dl.clean.answer === 'different_location' && dl.clean.location === 'Bathroom ceiling', 'different spot with a location is accepted');
  ok(v({ choice: 'nonsense' }).error === 'bad_choice', 'unknown choice refused');
  ok(v({ choice: 'same_spot', trigger: 'bogus' }).error === 'bad_value', 'unknown multiple-choice value refused');
  ok(v({ choice: 'safety', note: 'ceiling sagging' }).clean.answer === 'safety', 'the safety link records answer=safety');
  ok(v({ choice: 'not_sure', note: 'x'.repeat(5000) }).clean.detail.length === 1000, 'notes are clipped to 1000 chars');
  ok(v({ choice: 'same_spot', rain_since: 'yes' }).clean.extra.rain_since === undefined, 'fields that do not belong to the chosen option are ignored');
}
{
  const el = W0.api.fuQuestionSpec({ check_type: 'electrical', problem_label: 'the outlet' });
  const v = b => W0.api.fuValidateAnswer(el, b);
  ok(el.options.map(o => o.value).join() === 'working,still_not_working,on_and_off,something_else', 'electrical: working / still not / on and off / something else');
  ok(v({ choice: 'working' }).clean.answer === 'resolved' && v({ choice: 'still_not_working' }).clean.answer === 'persists' && v({ choice: 'on_and_off' }).clean.answer === 'persists', 'electrical answers map correctly');
  ok(v({ choice: 'on_and_off' }).clean.choice === 'on_and_off', 'the raw choice is kept so "on and off" is not lost');
  ok(v({ choice: 'something_else' }).error === 'missing_field' && v({ choice: 'something_else', note: 'buzzing' }).clean.answer === 'not_sure', '"something else" needs a note');
  ok(el.safety && /spark|shock|burn/i.test(el.safety.label.en) && /911/.test(el.safety.message.en) && /\{phone\}/.test(el.safety.message.en), 'electrical has a prominent safety branch that says call us / 911');
  const gen = W0.api.fuQuestionSpec({ check_type: 'other', problem_label: 'the fan' });
  ok(gen.question.en === 'Is the fan fixed now?' && gen.options.map(o => o.answer).join() === 'resolved,persists,persists', 'generic: fixed / not fixed / partly fixed');
  for (const t of ['leak', 'electrical', 'plumbing_flow', 'hvac', 'appliance', 'lock_door', 'pest', 'other']) {
    const s = W0.api.fuQuestionSpec({ check_type: t, problem_label: 'the thing', repair_date: '2026-10-10' });
    ok(s.question.en && s.question.es && s.options.length >= 3 && s.options.every(o => o.label.es && o.label.en) && s.options.some(o => o.answer === 'resolved') && s.options.some(o => o.answer === 'persists' || o.answer === 'worse'), `question set for ${t} is complete in both languages`);
  }
}

// ═══ C. tokens ═════════════════════════════════════════════════════════════════════════════
{
  const A = makeWorld({}); const env = A.env;
  const row = { ID: '7', Tenant_ID: '100' };
  const exp = new Date(Date.now() + 14 * 86400000).toISOString();
  const tok = await A.api.fuMintToken(env, row, exp);
  const chk = await A.api.fuTokenCheck(tok, env.WORKER_SECRET);
  ok(chk.ok && chk.payload.f === '7' && chk.payload.t === '100' && chk.payload.scope === 'fix-check', 'a fresh token verifies and carries only follow-up id + tenant id', chk);
  ok(tok.length < 200, 'the token is short enough for a text message', tok.length);
  ok(Math.abs(chk.payload.exp - (Date.now() / 1000 + 14 * 86400)) < 120, 'expires in 14 days');
  const bad = tok.slice(0, -3) + (tok.endsWith('AAA') ? 'BBB' : 'AAA');
  ok((await A.api.fuTokenCheck(bad, env.WORKER_SECRET)).reason === 'invalid', 'a tampered token is invalid');
  ok((await A.api.fuTokenCheck(tok, 'other-secret')).reason === 'invalid', 'a token signed with another secret is invalid');
  ok((await A.api.fuTokenCheck('', env.WORKER_SECRET)).reason === 'invalid' && (await A.api.fuTokenCheck('abc', env.WORKER_SECRET)).reason === 'invalid', 'empty / garbage tokens are invalid');
  const old = await A.api.makeSessionToken({ scope: 'fix-check', f: '7', t: '100' }, env.WORKER_SECRET, -3600);
  const oc = await A.api.fuTokenCheck(old, env.WORKER_SECRET); ok(!oc.ok && oc.reason === 'expired', 'an old link says EXPIRED (not "broken")', oc);
  const other = await A.api.makeSessionToken({ scope: 'wo-share', f: '7', t: '100' }, env.WORKER_SECRET, 3600);
  ok((await A.api.fuTokenCheck(other, env.WORKER_SECRET)).reason === 'invalid', 'a token of another scope (vendor share link) is refused');
  const h = await A.api.fuSha256(tok); ok(/^[0-9a-f]{64}$/.test(h) && !h.includes(tok.slice(0, 20)), 'the stored value is a sha256 hex, never the token');
  const two = A.api.fuAddHash(A.api.fuAddHash('', 'aaa'), 'bbb'); ok(A.api.fuHashMatches(two, 'aaa') && A.api.fuHashMatches(two, 'bbb') && !A.api.fuHashMatches(two, 'ccc'), 'the first text and its reminder link both stay valid');
  ok(A.api.fuAddHash('a,b,c,d', 'e').split(',').length === 4, 'at most 4 hashes kept');
}

// ═══ D. gating: exact reasons ══════════════════════════════════════════════════════════════
{
  const G = o => W0.api.fuGateVerdict(Object.assign({ cfg: { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }, tenant: { ID: '1', Phone: '4105550111', Active: 'TRUE' }, property: {}, owner: {}, now: T0 }, o));
  ok(!G({}).blocked && G({}).reasons.length === 0, 'all gates open -> not blocked');
  ok(G({ cfg: {} }).reasons.map(r => r.code).join() === 'global_off' && /TWILIO_ENABLED/.test(G({ cfg: {} }).reasons[0].text), 'global OFF is named, with the config key');
  ok(G({ property: { SMS_Enabled: 'FALSE' } }).reasons[0].code === 'property_off' && /Properties/.test(G({ property: { SMS_Enabled: 'FALSE' } }).reasons[0].text), 'property OFF is named');
  ok(G({ owner: { SMS_Enabled: 'FALSE' } }).reasons[0].code === 'owner_off', 'owner OFF is named');
  ok(G({ tenant: { ID: '1', Phone: '4105550111', SMS_Enabled: 'FALSE' } }).reasons[0].code === 'tenant_off' && /consent/.test(G({ tenant: { ID: '1', Phone: '4105550111', SMS_Enabled: 'FALSE' } }).reasons[0].text), 'tenant OFF is named and mentions consent');
  ok(G({ tenant: { ID: '1', Phone: '4105550111', SMS_OptOut: 'TRUE' } }).reasons[0].code === 'tenant_opted_out', 'tenant STOP is named');
  ok(G({ tenant: { ID: '1', Phone: '4105550111', Active: 'FALSE' } }).reasons[0].code === 'tenant_moved_out', 'moved-out tenant is named');
  ok(G({ tenant: { ID: '1', Phone: '' } }).reasons.some(r => r.code === 'no_phone'), 'missing phone is named');
  const all = G({ cfg: {}, property: { SMS_Enabled: 'FALSE' }, owner: { SMS_Enabled: 'FALSE' }, tenant: { ID: '1', Phone: '4105550111', SMS_Enabled: 'FALSE' } });
  ok(all.reasons.map(r => r.code).join() === 'global_off,property_off,owner_off,tenant_off', 'every blocking layer is listed, in order', all.reasons);
  ok(G({ cfg: { TWILIO_ENABLED: 'TRUE' } }).test_mode === true && G({ cfg: { TWILIO_ENABLED: 'TRUE' } }).notes.some(x => /Test mode/.test(x)), 'test mode (the default) is called out as a note, not a block');
  ok(G({ now: new Date('2026-10-17T02:00:00Z') }).notes.some(x => /9am/.test(x)) && !G({ now: new Date('2026-10-17T02:00:00Z') }).blocked, 'after 7pm ET: held-until-9am note, not a block');
}

// ═══ E. tenant resolution fallbacks ════════════════════════════════════════════════════════
{
  const tenants = [
    { ID: '100', First_Name: 'Tom', Last_Name: 'Gramiski', Property_ID: '82', Unit_ID: '9', Active: 'TRUE', Phone: '4105550100' },
    { ID: '200', First_Name: 'Ann', Last_Name: 'A', Property_ID: '50', Unit_ID: '5', Active: 'TRUE' }, { ID: '201', First_Name: 'Bob', Last_Name: 'B', Property_ID: '50', Unit_ID: '5', Active: 'TRUE' },
    { ID: '300', First_Name: 'Old', Last_Name: 'Tenant', Property_ID: '60', Unit_ID: '6', Active: 'FALSE' }, { ID: '301', First_Name: 'New', Last_Name: 'Tenant', Property_ID: '60', Unit_ID: '6', Active: 'TRUE' },
    { ID: '400', First_Name: 'Solo', Last_Name: 'S', Property_ID: '70', Unit_ID: '', Active: 'TRUE' },
  ];
  const units = [{ ID: '9', Property_ID: '82' }, { ID: '5', Property_ID: '50' }, { ID: '6', Property_ID: '60' }];
  const R = (wo, want) => W0.api.fuResolveTenants(wo, tenants, units, want);
  let r = R({ ID: '1152', Property_ID: '82', Unit_ID: '', Tenant_ID: '' });
  ok(r.chosen && r.chosen.ID === '100' && r.source === 'property', 'WO-1152: blank tenant, no unit, property 82 -> its only tenant (100)', r);
  r = R({ ID: '1', Property_ID: '82', Unit_ID: '9', Tenant_ID: '100' }); ok(r.chosen.ID === '100' && r.source === 'wo_tenant', 'the WO\'s own tenant wins');
  r = R({ ID: '1', Property_ID: '82', Unit_ID: '9', Tenant_ID: '' }); ok(r.chosen.ID === '100' && r.source === 'unit', 'blank tenant + unit -> the unit\'s tenant');
  r = R({ ID: '1', Property_ID: '60', Unit_ID: '6', Tenant_ID: '300' }); ok(r.chosen.ID === '301' && /moved out/.test(r.note), 'the WO tenant moved out -> the CURRENT tenant, with a note');
  r = R({ ID: '1', Property_ID: '50', Unit_ID: '5', Tenant_ID: '' }); ok(r.chosen === null && r.candidates.length === 2 && /pick/i.test(r.note), 'two tenants in a unit -> nobody chosen, Brett must pick');
  r = R({ ID: '1', Property_ID: '50', Unit_ID: '5', Tenant_ID: '' }, '201'); ok(r.chosen && r.chosen.ID === '201', 'Brett\'s pick is honoured');
  r = R({ ID: '1', Property_ID: '50', Unit_ID: '5', Tenant_ID: '' }, '100'); ok(r.chosen === null && /not linked/.test(r.note), 'a tenant from another property cannot be picked');
  r = R({ ID: '1', Property_ID: '70', Unit_ID: '', Tenant_ID: '' }); ok(r.chosen && r.chosen.ID === '400' && r.source === 'property_no_unit', 'whole-property WO -> the tenant with no unit');
  r = R({ ID: '1', Property_ID: '999', Unit_ID: '', Tenant_ID: '' }); ok(r.chosen === null && r.candidates.length === 0 && /No current tenant/.test(r.note), 'nobody found -> says so');
}

// ═══ F. the full flow on fake sheets ═══════════════════════════════════════════════════════
const baseTabs = () => ({
  Work_Orders: [
    { ID: '1152', Property_ID: '82', Unit_ID: '', Tenant_ID: '', Vendor_ID: '2', Trade: 'Windows', Status: 'Assigned', Description: 'window leak. Need repaired and drywall/paint', Completed_Date: '' },
    { ID: '1154', Property_ID: '82', Unit_ID: '', Tenant_ID: '', Vendor_ID: '5', Trade: 'Roofing', Status: 'Complete', Description: 'roof flashing', Completed_Date: '2026-10-10' },
  ],
  Properties: [{ ID: '82', Address: '522 E Fort Ave', Owner_ID: '11' }],
  Units: [], Owners: [{ ID: '11', Company: 'Owner' }],
  Tenants: [{ ID: '100', First_Name: 'Tom', Last_Name: 'Gramiski', Property_ID: '82', Unit_ID: '', Active: 'TRUE', Phone: '4105550177' }],
  Vendors: [{ ID: '2', Name: 'Alex Busey', Trade: 'Painting', Active: 'TRUE' }, { ID: '5', Name: 'Eddie Smith', Trade: 'Roofing', Active: 'TRUE' }],
});
const sendBody = (o) => Object.assign({ wo_id: '1152', repair_wo_id: '1154', tenant_id: '100', check_type: 'leak', problem_label: 'the window leak', problem_label_es: 'la filtración de agua en la ventana', object_label: 'the window', object_label_es: 'la ventana', repair_part: 'window leak. Need repaired', cosmetic_part: 'drywall/paint', cosmetic_vendor_id: '2', rework_vendor_id: '5', mode: 'sms' }, o || {});
{
  // preview: reads only
  const A = makeWorld({ tabs: baseTabs() });
  const before = JSON.stringify(A.tabs);
  const pr = await A.api.followupPreview(A.env, url('/followup/preview', { wo_id: '1152', repair_wo_id: '1154' }));
  const p = D(pr);
  ok(p.ok && p.tenants.chosen_id === '100' && p.classification.check_type === 'leak' && p.classification.cosmetic_part === 'drywall/paint', 'preview resolves tenant 100 and splits repair / cosmetic', p.classification);
  ok(JSON.stringify(A.tabs) === before && A.sms.length === 0 && A.ensureTabCalls.length === 0, 'preview writes NOTHING and sends NOTHING (not even creating the tab)');
  ok(/finished the repair work on the window leak at 522 E Fort Ave/.test(p.message.text) && /Reply STOP/.test(p.message.text) && /private link/.test(p.message.text), 'preview shows the exact text incl. the STOP line', p.message.text);
  ok(p.questions.question.en === 'Since Oct 10, have you seen water come in at the window?' && p.repair_wo.completed_date === '2026-10-10', 'preview shows the exact question, dated from the repair WO (1154)');
  ok(p.vendor_defaults.rework_vendor_id === '5' && p.vendor_defaults.cosmetic_vendor_id === '2', 'vendor defaults: rework = repair WO vendor (Eddie 5), cosmetic = this WO vendor (Alex 2)');
  ok(!p.gate.blocked, 'gates open in this world');
  const es = D(await A.api.followupPreview(A.env, url('/followup/preview', { wo_id: '1152', lang: 'es' }))); ok(/Hola Tom/.test(es.message.text) && es.language === 'es', 'Spanish preview');
  const ed = D(await A.api.followupPreview(A.env, url('/followup/preview', { wo_id: '1152', problem_label: 'the bay window leak', cosmetic_part: 'paint only' }))); ok(/bay window leak/.test(ed.message.text) && ed.classification.cosmetic_part === 'paint only', 'Brett\'s edits flow into the message');
  const tc = D(await A.api.followupPreview(A.env, url('/followup/preview', { wo_id: '1152', check_type: 'electrical' }))); ok(tc.classification.check_type === 'electrical' && /working now/.test(tc.questions.question.en), 'changing the type rebuilds the questions');
  ok((await A.api.followupPreview(A.env, url('/followup/preview', {}))).status === 400 && (await A.api.followupPreview(A.env, url('/followup/preview', { wo_id: '999' }))).status === 404, 'missing / unknown WO handled');
}
{
  // preview blocked exactly why
  const A = makeWorld({ tabs: baseTabs(), cfg: { TWILIO_ENABLED: 'FALSE' } });
  A.tabs.Properties[0].SMS_Enabled = 'FALSE'; A.tabs.Tenants[0].SMS_Enabled = 'FALSE';
  const p = D(await A.api.followupPreview(A.env, url('/followup/preview', { wo_id: '1152' })));
  ok(p.gate.blocked && p.gate.reasons.map(r => r.code).join() === 'global_off,property_off,tenant_off', 'blocked preview lists each reason', p.gate);
}
// FC_TEST_CONT
