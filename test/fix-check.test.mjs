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
{
  // SEND (sms) happy path
  const A = makeWorld({ tabs: baseTabs() });
  const res = await A.api.followupSend(A.env, sendBody(), url('/followup/send'));
  const j = D(res);
  ok(res.status === 200 && j.ok && j.status === 'Sent' && j.followup_id === '1' && /fix-check\.html\?t=/.test(j.link), 'send creates the row and returns the link', j);
  const row = A.tabs.WO_Followups[0];
  ok(row.Status === 'Sent' && row.Send_Method === 'sms' && row.Tenant_ID === '100' && row.Check_Type === 'leak' && row.Repair_Date === '2026-10-10' && row.Cosmetic_Part === 'drywall/paint', 'row fields', row);
  ok(Math.abs(Date.parse(row.Due_At) - Date.parse(row.Sent_At) - 2 * 86400000) < 1000, 'due 2 days after sent');
  const tok = decodeURIComponent(j.link.split('t=')[1]);
  ok(row.Token_Hash === await A.api.fuSha256(tok) && !JSON.stringify(row).includes(tok), 'only the HASH of the token is stored');
  ok(A.sms.length === 1 && A.sms[0].recipient_type === 'tenant' && A.sms[0].message_type === 'tenant_fix_check' && A.sms[0].tenant.ID === '100' && A.sms[0].wo_id === '1152', 'goes through smsGatedSend as a tenant message tied to the WO');
  ok(A.sms[0].message_body.includes(j.link) && /Reply STOP/.test(A.sms[0].message_body), 'the text carries the link and the tenant STOP line');
  ok(Math.abs(Date.parse(row.Token_Expires_At) - Date.now() - 14 * 86400000) < 5000, '14-day window');
  ok(A.telemetry.some(t => t.Job_Type === 'fix_check_send' && t.Success === 'TRUE'), 'send logged to telemetry');
  ok(A.audit.length === 1, 'a line is added to the work order history');
  ok(A.ensureTabCalls.includes('WO_Followups'), 'the tab is created on first send');
  // duplicate
  const dup = await A.api.followupSend(A.env, sendBody(), url('/x')); ok(dup.status === 409 && D(dup).code === 'already_open' && A.tabs.WO_Followups.length === 1 && A.sms.length === 1, 'a second send while one is open is refused, nothing sent', D(dup));
  const rep = await A.api.followupSend(A.env, sendBody({ replace: true }), url('/x')); ok(D(rep).ok && A.tabs.WO_Followups.length === 2 && A.tabs.WO_Followups[0].Status === 'Closed' && /Replaced/.test(A.tabs.WO_Followups[0].Closed_Reason), 'replace:true closes the old one and sends a new one');
}
{
  // SEND blocked by the gate: refuses, row-less, offers copy link; copy_link works
  const A = makeWorld({ tabs: baseTabs(), cfg: { TWILIO_ENABLED: 'FALSE' } });
  const res = await A.api.followupSend(A.env, sendBody(), url('/x')); const j = D(res);
  ok(res.status === 409 && j.blocked && j.reasons[0].code === 'global_off' && /Copy link/i.test(j.hint) && !A.tabs.WO_Followups && A.sms.length === 0, 'blocked: says why, no row, no text', j);
  const cp = D(await A.api.followupSend(A.env, sendBody({ mode: 'copy_link' }), url('/x')));
  ok(cp.ok && cp.status === 'Sent' && cp.link && A.sms.length === 0 && A.tabs.WO_Followups[0].Send_Method === 'copied_link', 'copy_link works when texting is blocked and sends nothing');
}
{
  // validation
  const A = makeWorld({ tabs: baseTabs() });
  ok((await A.api.followupSend(A.env, sendBody({ problem_label: '' }), url('/x'))).status === 400, 'a blank "what we are checking" is refused');
  ok((await A.api.followupSend(A.env, sendBody({ check_type: 'nope' }), url('/x'))).status === 400, 'unknown check type refused');
  ok((await A.api.followupSend(A.env, sendBody({ tenant_id: '555' }), url('/x'))).status === 400, 'a tenant not linked to the WO is refused');
  ok((await A.api.followupSend(A.env, sendBody({ repair_wo_id: '9999' }), url('/x'))).status === 404, 'unknown repair WO refused');
  ok(!A.tabs.WO_Followups && A.sms.length === 0, 'nothing created or sent by the refusals');
}
{
  // FAULT INJECTION on send
  let A = makeWorld({ tabs: baseTabs() }); A.fail.ensureTab = true;
  let thrown = null; try { await A.api.followupSend(A.env, sendBody(), url('/x')); } catch (e) { thrown = e; }
  ok(thrown && /could not create tab/.test(thrown.message) && A.sms.length === 0, 'tab creation failure is LOUD (throws) and nothing is sent');
  A = makeWorld({ tabs: baseTabs() }); A.tabs.WO_Followups = []; A.fail.addRow = true;
  thrown = null; try { await A.api.followupSend(A.env, sendBody(), url('/x')); } catch (e) { thrown = e; }
  ok(thrown && /Could not create the WO_Followups row/.test(thrown.message) && A.sms.length === 0, 'row creation failure throws; no text goes out');
  A = makeWorld({ tabs: baseTabs() }); A.smsResult = { queued_id: '1', send_ok: true, sent: false, gate_snapshot: 'all gates open' };
  let res = await A.api.followupSend(A.env, sendBody(), url('/x')); let j = D(res);
  ok(res.status === 200 && j.ok === false && j.status === 'Blocked' && /did not go through/.test(j.error) && j.link && A.tabs.WO_Followups[0].Status === 'Blocked' && /Twilio/.test(A.tabs.WO_Followups[0].Blocked_Reason), 'Twilio refusing the text -> row Blocked, error returned WITH the link to copy', j);
  ok(A.telemetry.some(t => t.Job_Type === 'fix_check_send' && t.Success === 'FALSE'), '...and logged as a failure');
  A = makeWorld({ tabs: baseTabs() }); A.fail.sms = true;
  res = await A.api.followupSend(A.env, sendBody(), url('/x')); j = D(res);
  ok(res.status === 500 && j.ok === false && /twilio down/.test(j.error) && A.tabs.WO_Followups[0].Status === 'Draft' && A.telemetry.some(t => t.Success === 'FALSE'), 'the sender throwing -> 500, row stays Draft (visible), telemetry FALSE', j);
  A = makeWorld({ tabs: baseTabs() }); A.fail.dropWrite = f => 'Token_Hash' in f;
  res = await A.api.followupSend(A.env, sendBody(), url('/x')); j = D(res);
  ok(res.status === 500 && j.ok === false && /did not save/.test(j.error), 'a write that claims success but changes nothing is caught by the read-back (failure, not success)', j);
  A = makeWorld({ tabs: baseTabs() }); A.fail.telemetry = true;
  j = D(await A.api.followupSend(A.env, sendBody(), url('/x'))); ok(j.ok && j.warnings.some(x => /telemetry write failed/.test(x)), 'a telemetry outage is returned as a warning, not hidden');
  A = makeWorld({ tabs: baseTabs() }); A.smsResult = { queued_id: '1', send_ok: true, held_for_quiet_hours: true, send_after: '2026-10-17T13:00:00.000Z', gate_snapshot: 'x' };
  j = D(await A.api.followupSend(A.env, sendBody(), url('/x'))); ok(j.ok && j.held_for_quiet_hours && A.tabs.WO_Followups[0].Send_Method === 'sms_held' && Date.parse(A.tabs.WO_Followups[0].Due_At) === Date.parse('2026-10-19T13:00:00.000Z'), 'held text: due date counts from when it actually goes out', A.tabs.WO_Followups[0]);
  A = makeWorld({ tabs: baseTabs(), staging: true }); A.smsResult = { queued_id: '1', send_ok: true, sent: false, gate_snapshot: 'x' };
  j = D(await A.api.followupSend(A.env, sendBody(), url('/x'))); ok(j.ok && j.staged && A.tabs.WO_Followups[0].Send_Method === 'sms_staging_stub' && /api=staging/.test(j.link), 'staging stub counts as sent on staging only, and the link points the page at staging', j);
}

// ── tenant page + answers ──────────────────────────────────────────────────────────────────
async function sentWorld(extra) {
  const A = makeWorld(Object.assign({ tabs: baseTabs() }, extra || {}));
  const j = D(await A.api.followupSend(A.env, sendBody(), url('/x')));
  A.token = decodeURIComponent(j.link.split('t=')[1].split('&')[0]); A.link = j.link;
  return A;
}
{
  const A = await sentWorld();
  const pg = await A.api.fixPage(A.env, url('/fix/page', { t: A.token })); const p = D(pg);
  ok(pg.status === 200 && p.ok && p.state === 'open' && p.first_name === 'Tom' && p.address === '522 E Fort Ave' && p.spec.options.length === 5, 'the page payload: name, own address, the questions', p);
  const flat = JSON.stringify(p);
  ok(!/Alex|Eddie|vendor|Vendor|Owner|lockbox|Lock_Code|Access|Gramiski|4105550177|drywall|paint|Token_Hash|Cosmetic|Repair_Part|PIN/i.test(flat), 'the tenant page never carries vendor / owner / access / last name / phone / cosmetic info', flat.match(/Alex|Eddie|vendor|Owner|Gramiski|4105550177|drywall|paint|Token|Cosmetic|Repair_Part/i));
  ok((await A.api.fixPage(A.env, url('/fix/page', { t: 'nope' }))).status === 401, 'bad token -> 401');
  const exp = await A.api.makeSessionToken({ scope: 'fix-check', f: '1', t: '100' }, A.env.WORKER_SECRET, -60); const er = await A.api.fixPage(A.env, url('/fix/page', { t: exp }));
  ok(er.status === 410 && D(er).state === 'expired', 'expired link -> 410 "expired"');
  const wrongTenant = await A.api.makeSessionToken({ scope: 'fix-check', f: '1', t: '999' }, A.env.WORKER_SECRET, 3600); ok((await A.api.fixPage(A.env, url('/fix/page', { t: wrongTenant }))).status === 401, 'a validly signed token for a different tenant is refused (hash + tenant check)');
  const rowOnly = await A.api.makeSessionToken({ scope: 'fix-check', f: '1', t: '100' }, A.env.WORKER_SECRET, 3600); ok((await A.api.fixPage(A.env, url('/fix/page', { t: rowOnly }))).status === 401, 'a validly signed token that was never issued (hash not stored) is refused');
  A.tabs.WO_Followups[0].Token_Expires_At = new Date(Date.now() - 1000).toISOString(); ok((await A.api.fixPage(A.env, url('/fix/page', { t: A.token }))).status === 410, 'the stored window end also expires the link');
}
{
  // answers + alerts
  const A = await sentWorld();
  const ans = async b => A.api.fixAnswer(A.env, Object.assign({ t: A.token }, b));
  let r = await ans({ choice: 'same_spot', trigger: 'during_rain', when: 'Tuesday night', note: 'drip by the frame' }); let j = D(r);
  const row = () => A.tabs.WO_Followups[0];
  ok(r.status === 200 && j.ok && j.answer === 'persists' && row().Status === 'Answered' && row().Answer === 'persists' && row().Answer_Detail === 'drip by the frame' && JSON.parse(row().Answer_Extra).trigger === 'during_rain', 'answer stored', row());
  const alerts = () => A.sms.filter(s => s.recipient_type === 'admin');
  ok(alerts().length === 1 && /still happening/.test(alerts()[0].message_body) && /WO-1152/.test(alerts()[0].message_body) && row().Alerted_Answer === 'persists' && row().Alert_Result === 'sent', 'Brett is texted at once about "persists"', alerts().map(a => a.message_body));
  ok(A.audit.some(a => a[3] === 'Fix-check answer'), 'the answer is added to the WO history');
  await ans({ choice: 'same_spot' }); ok(alerts().length === 1, 'the same answer again does not page Brett again');
  r = await ans({ choice: 'worse' }); ok(alerts().length === 2 && /WORSE/.test(alerts()[1].message_body) && JSON.parse(row().Answer_History).length === 2, 'changing to "worse" pages again; history keeps the earlier answers');
  r = await ans({ choice: 'dry', rain_since: 'no' }); ok(D(r).answer === 'resolved' && alerts().length === 2 && row().Answer === 'resolved' && row().Suggested_Next === 'create_cosmetic_wo', 'changing to "dry" is allowed inside the window, no alert, suggestion becomes create_cosmetic_wo');
  r = await ans({ choice: 'different_spot' }); ok(r.status === 400 && D(r).field === 'location', 'missing required detail -> 400 with the field');
  r = await ans({ choice: 'different_spot', location: 'Bathroom ceiling' }); ok(D(r).answer === 'different_location' && alerts().length === 3 && /DIFFERENT/.test(alerts()[2].message_body) && /Bathroom ceiling/.test(alerts()[2].message_body), 'different location pages with the location');
  r = await ans({ choice: 'safety', note: 'ceiling sagging' }); ok(D(r).safety === true && alerts().length === 4 && /^URGENT/.test(alerts()[3].message_body), 'safety is an URGENT immediate alert');
  r = await ans({ choice: 'bogus' }); ok(r.status === 400, 'unknown choice -> 400');
  const pg = D(await A.api.fixPage(A.env, url('/fix/page', { t: A.token }))); ok(pg.state === 'answered' && pg.previous.choice === 'safety', 'reopening the link shows the previous answer');
  // closed
  row().Status = 'Closed'; r = await ans({ choice: 'dry' }); ok(r.status === 200 && D(r).ok === false && D(r).state === 'closed', 'a closed check cannot be changed', D(r));
}
{
  // alert cannot be delivered -> recorded on the row, visible
  const A = await sentWorld(); A.smsResult = o => o.recipient_type === 'admin' ? { send_ok: false, sent: false, gate_snapshot: 'Global OFF' } : { send_ok: true, sent: true };
  const r = await A.api.fixAnswer(A.env, { t: A.token, choice: 'worse' });
  ok(D(r).ok && A.tabs.WO_Followups[0].Alert_Result.startsWith('NOT sent') && /Global OFF/.test(A.tabs.WO_Followups[0].Alert_Result) && A.tabs.WO_Followups[0].Status === 'Answered', 'an undeliverable alert is written on the follow-up row ("NOT sent: ...") and the answer still stands');
}
{
  // FAULT INJECTION on answering
  const A = await sentWorld(); A.fail.updateRow = f => 'Answer' in f;
  const r = await A.api.fixAnswer(A.env, { t: A.token, choice: 'worse' }); const j = D(r);
  ok(r.status === 500 && j.ok === false && /could not save/i.test(j.error), 'a failed save is reported to the tenant as a failure (not "thanks")', j);
  ok(A.telemetry.some(t => t.Job_Type === 'fix_check_answer' && t.Success === 'FALSE'), 'and logged to telemetry as FALSE');
  ok(A.sms.some(s => s.recipient_type === 'admin' && /could NOT be saved/.test(s.message_body)), 'and Brett is told the answer was lost, so he can call them');
  const B = await sentWorld(); B.fail.dropWrite = f => 'Answer' in f;
  const r2 = await B.api.fixAnswer(B.env, { t: B.token, choice: 'worse' }); ok(r2.status === 500 && D(r2).ok === false, 'a write that silently changes nothing is a failure, not a success');
}
{
  // photos
  const A = await sentWorld();
  const us = b => A.api.fixUploadSession(A.env, Object.assign({ t: A.token, file_name: 'a b.jpg', mime_type: 'image/jpeg' }, b));
  let r = await us({}); ok(D(r).success && A.uploads[0].wo_id === '1152' && A.uploads[0].file_type === 'photo' && /^FixCheck-1-/.test(A.uploads[0].file_name) && A.uploads[0].property === '522 E Fort Ave', 'photo upload goes to the follow-up\'s own WO folder (from the token, not the client)', A.uploads[0]);
  ok((await us({ mime_type: 'application/pdf' })).status === 400 && (await us({ mime_type: 'text/html' })).status === 400, 'only images');
  ok((await A.api.fixUploadSession(A.env, { t: 'bad', file_name: 'x.jpg', mime_type: 'image/jpeg' })).status === 401, 'bad token refused');
  for (let i = 0; i < 6; i++) { const lr = await A.api.fixLogAttachment(A.env, { t: A.token, file_id: 'f' + i, file_name: 'p.jpg', mime_type: 'image/jpeg' }); ok(D(lr).ok, 'photo ' + i + ' logged'); }
  ok((await A.api.fixLogAttachment(A.env, { t: A.token, file_id: 'f7' })).status === 400 && (await us({})).status === 400, 'capped at 6 photos');
  ok(A.attachments.length === 6 && A.attachments.every(a => a.wo_id === '1152' && a.file_type === 'photo') && A.tabs.WO_Followups[0].Answer_Photo_IDs.split(',').length === 6, 'attachments logged against the WO and the ids saved on the follow-up');
}

// ═══ G. suggestions ════════════════════════════════════════════════════════════════════════
{
  const wo = { ID: '1152', Trade: 'Windows', Vendor_ID: '2' }, rwo = { ID: '1154', Trade: 'Roofing', Vendor_ID: '5' };
  const row = (o) => Object.assign({ ID: '1', WO_ID: '1152', Repair_WO_ID: '1154', Property_ID: '82', Unit_ID: '', Problem_Label: 'the window leak', Cosmetic_Part: 'drywall/paint', Cosmetic_Vendor_ID: '2', Rework_Vendor_ID: '5', Status: 'Answered', Answer: 'resolved', Answer_Extra: '{}' }, o);
  let s = W0.api.fuSuggestNext(row(), wo, rwo);
  ok(s.action === 'create_cosmetic_wo' && s.prefill.trade === 'Painting' && s.prefill.vendor_id === '2' && /drywall\/paint/.test(s.prefill.description) && s.prefill.property_id === '82', 'dry -> suggest the drywall/paint WO, vendor Alex (2), trade Painting', s);
  s = W0.api.fuSuggestNext(row({ Answer_Extra: '{"rain_since":"no"}' }), wo, rwo); ok(s.action === 'create_cosmetic_wo' && s.severity === 'caution' && /not rained/.test(s.detail), 'dry but it has not rained -> caution');
  s = W0.api.fuSuggestNext(row({ Cosmetic_Part: '' }), wo, rwo); ok(s.action === 'close', 'dry with no cosmetic part -> just close');
  s = W0.api.fuSuggestNext(row({ Answer: 'persists', Answer_Location: 'by the frame', Answer_Extra: '{"trigger":"during_rain"}' }), wo, rwo);
  ok(s.action === 'send_vendor_back' && s.vendor_id === '5' && s.prefill.trade === 'Roofing' && /Re-check the window leak \(WO-1154\)/.test(s.prefill.description) && /during rain/.test(s.prefill.description), 'persists -> send Eddie (5) back, prefilled', s);
  ok(W0.api.fuSuggestNext(row({ Answer: 'worse' }), wo, rwo).severity === 'urgent' && W0.api.fuSuggestNext(row({ Answer: 'different_location', Answer_Location: 'Bathroom' }), wo, rwo).action === 'send_vendor_back', 'worse is urgent; different location sends the vendor back');
  ok(W0.api.fuSuggestNext(row({ Answer: 'safety' }), wo, rwo).action === 'call_now' && W0.api.fuSuggestNext(row({ Answer: 'not_sure' }), wo, rwo).action === 'call_tenant', 'safety -> call now; not sure -> call');
  ok(W0.api.fuSuggestNext(row({ Next_WO_ID: '1300' }), wo, rwo).action === 'done' && W0.api.fuSuggestNext(row({ Answer: '' }), wo, rwo) === null, 'handled / unanswered');
}

// ═══ H. admin list, link, close ════════════════════════════════════════════════════════════
{
  const A = await sentWorld();
  await A.api.fixAnswer(A.env, { t: A.token, choice: 'dry' });
  const l = D(await A.api.followupList(A.env, url('/followup/list')));
  ok(l.ok && l.count === 1 && l.followups[0].needs_action === true && l.followups[0].suggestion.action === 'create_cosmetic_wo' && !('Token_Hash' in l.followups[0]), 'list: needs action, suggestion, no token hash', l.followups[0]);
  const link = D(await A.api.followupLink(A.env, { id: '1' }, url('/x'))); const t2 = decodeURIComponent(link.link.split('t=')[1].split('&')[0]);
  ok(link.ok && t2 !== A.token && D(await A.api.fixPage(A.env, url('/fix/page', { t: t2 }))).ok && D(await A.api.fixPage(A.env, url('/fix/page', { t: A.token }))).ok, 'copy-link-again mints a new link; the first one still works until the same window ends');
  const cl = D(await A.api.followupClose(A.env, { id: '1', next_wo_id: '1300' })); ok(cl.ok && A.tabs.WO_Followups[0].Status === 'Closed' && A.tabs.WO_Followups[0].Next_WO_ID === '1300', 'closing links the follow-on WO');
  const l2 = D(await A.api.followupList(A.env, url('/followup/list', { open: '1' }))); ok(l2.count === 0, 'closed ones leave the open list');
  const l3 = D(await A.api.followupList(A.env, url('/followup/list', { wo_id: '1152' }))); ok(l3.count === 1 && l3.followups[0].suggestion.action === 'done', 'per-WO list still shows it, handled');
  ok((await A.api.followupLink(A.env, { id: '1' }, url('/x'))).status === 409 && (await A.api.followupLink(A.env, { id: '99' }, url('/x'))).status === 404, 'cannot re-link a closed / unknown follow-up');
  const nt = makeWorld({ tabs: baseTabs() }); ok(D(await nt.api.followupList(nt.env, url('/followup/list'))).count === 0, 'no tab yet -> empty list, not an error');
  const bad = makeWorld({ tabs: Object.assign(baseTabs(), { WO_Followups: [] }) }); bad.fail.fetchTab = 'WO_Followups'; let th = null; try { await bad.api.followupList(bad.env, url('/followup/list')); } catch (e) { th = e; } ok(th && /exploded/.test(th.message), 'a real read failure propagates (the UI shows it), it is not turned into an empty list');
}

// ═══ I. the reminder sweep ═════════════════════════════════════════════════════════════════
{
  const mk = async (over) => { const A = await sentWorld(); Object.assign(A.tabs.WO_Followups[0], { Due_At: new Date(T0.getTime() - 3600000).toISOString() }, over || {}); A.sms.length = 0; return A; };
  const S = (A, now) => A.api.followupSweep(A.env, { now: now || T0 });
  const rows = [{ ID: '1', Status: 'Sent', Due_At: '2026-10-16T10:00:00Z', Reminder_Sent_At: '', Answer: '' }];
  ok(W0.api.fuSweepDue(rows, T0).length === 1, 'due: Sent, due time passed, never reminded');
  ok(!W0.api.fuSweepDue([{ ...rows[0], Due_At: '2026-10-16T16:00:00Z' }], T0).length, 'not due before Due_At');
  ok(!W0.api.fuSweepDue([{ ...rows[0], Reminder_Sent_At: '2026-10-16T12:00:00Z' }], T0).length, 'never a second reminder');
  ok(!W0.api.fuSweepDue([{ ...rows[0], Answer: 'resolved' }], T0).length && !W0.api.fuSweepDue([{ ...rows[0], Status: 'Answered' }], T0).length && !W0.api.fuSweepDue([{ ...rows[0], Status: 'Closed' }], T0).length && !W0.api.fuSweepDue([{ ...rows[0], Status: 'Overdue' }], T0).length, 'answered / closed / already-overdue are never reminded');
  const hr = (iso) => W0.api.fuInReminderWindow(new Date(iso));
  ok(!hr('2026-10-16T12:59:00Z') && hr('2026-10-16T13:00:00Z') && hr('2026-10-16T22:59:00Z') && !hr('2026-10-16T23:00:00Z'), 'reminders only 9:00-18:59 ET (EDT)');
  ok(!hr('2026-12-16T13:59:00Z') && hr('2026-12-16T14:00:00Z') && hr('2026-12-16T23:59:00Z') && !hr('2026-12-17T00:00:00Z'), '...and the same wall-clock hours in winter (EST)');
  // quiet hours: nothing changes
  let A = await mk(); let r = await S(A, new Date('2026-10-17T00:30:00Z'));       // 8:30pm ET
  ok(r.ok && r.detail.due === 1 && r.detail.skipped_outside_hours && A.sms.length === 0 && A.tabs.WO_Followups[0].Status === 'Sent' && !A.tabs.WO_Followups[0].Reminder_Sent_At, 'after 7pm: nothing sent, nothing marked (waits for a later tick)', r);
  r = await S(A, new Date('2026-10-17T11:00:00Z'));                                 // 7am ET next day
  ok(r.detail.skipped_outside_hours && A.sms.length === 0, 'before 9am: nothing sent');
  // in-window: one reminder + one alert, then never again
  r = await S(A); const row = A.tabs.WO_Followups[0];
  const tenantTexts = A.sms.filter(s => s.recipient_type === 'tenant'), adminTexts = A.sms.filter(s => s.recipient_type === 'admin');
  ok(r.ok && r.detail.reminded === 1 && tenantTexts.length === 1 && adminTexts.length === 1, 'in window: ONE tenant reminder and ONE alert to Brett', { r, n: A.sms.length });
  ok(/quick reminder/.test(tenantTexts[0].message_body) && /Reply STOP/.test(tenantTexts[0].message_body) && /fix-check\.html\?t=/.test(tenantTexts[0].message_body) && tenantTexts[0].message_type === 'tenant_fix_check_reminder', 'reminder text: link + STOP line, gated as a tenant message');
  ok(/No answer after 2 days/.test(adminTexts[0].message_body) && /Call them/.test(adminTexts[0].message_body), 'Brett: "no answer after 2 days - call them"');
  ok(row.Status === 'Overdue' && row.Reminder_Sent_At && row.Reminder_Result === 'text sent', 'row marked Overdue with the reminder time and result', row);
  const rtok = decodeURIComponent(tenantTexts[0].message_body.match(/t=([^&\s]+)/)[1]);
  ok(D(await A.api.fixPage(A.env, url('/fix/page', { t: rtok }))).ok && D(await A.api.fixPage(A.env, url('/fix/page', { t: A.token }))).ok, 'the reminder link works AND the original link still works');
  const r2 = await S(A); ok(r2.detail.due === 0 && A.sms.length === 2, 'a second sweep sends nothing (max one reminder, ever)');
  ok(A.telemetry.some(t => t.Job_Type === 'fix_check_reminder' && t.Success === 'TRUE'), 'logged');
  // an answer after the reminder works (Overdue -> Answered)
  const ar = await A.api.fixAnswer(A.env, { t: A.token, choice: 'dry' }); ok(D(ar).ok && A.tabs.WO_Followups[0].Status === 'Answered', 'a late answer on an overdue check is accepted');
  // copied link: no text to the tenant, Brett still told
  A = await mk({ Send_Method: 'copied_link' }); r = await S(A);
  ok(A.sms.filter(s => s.recipient_type === 'tenant').length === 0 && A.sms.filter(s => s.recipient_type === 'admin').length === 1 && /sent by hand/.test(A.tabs.WO_Followups[0].Reminder_Result) && A.tabs.WO_Followups[0].Status === 'Overdue', 'copied-link check: no tenant text, Brett told to call');
  // gate blocked now
  A = await mk(); A.cfg.TWILIO_ENABLED = 'FALSE'; r = await S(A);
  ok(A.sms.filter(s => s.recipient_type === 'tenant').length === 0 && /not texted: .*TWILIO_ENABLED/.test(A.tabs.WO_Followups[0].Reminder_Result) && r.detail.texts_blocked === 1, 'gate closed at reminder time: no text, exact reason recorded');
  A = await mk(); A.tabs.Tenants[0].SMS_OptOut = 'TRUE'; await S(A); ok(A.sms.filter(s => s.recipient_type === 'tenant').length === 0 && /opted out/.test(A.tabs.WO_Followups[0].Reminder_Result), 'a tenant who replied STOP is not reminded');
  A = await mk({ Token_Expires_At: new Date(T0.getTime() - 1000).toISOString() }); await S(A); ok(A.sms.filter(s => s.recipient_type === 'tenant').length === 0 && /expired/.test(A.tabs.WO_Followups[0].Reminder_Result), 'expired link: not texted');
  // no tab / read failure / undeliverable alert / forced failures
  const none = makeWorld({ tabs: baseTabs() }); r = await none.api.followupSweep(none.env, { now: T0 }); ok(r.ok && r.detail.due === 0, 'no WO_Followups tab yet: ok, nothing due');
  A = await mk(); A.fail.fetchTab = 'WO_Followups'; r = await S(A); ok(r.ok === false && r.errors[0].step === 'read' && /exploded/.test(r.errors[0].error), 'a failed read is returned as a job failure (the scheduler shows it overdue)');
  A = await mk(); A.fail.updateRow = f => f.Status === 'Overdue'; r = await S(A);
  ok(r.ok === false && r.errors.length === 1 && A.sms.length === 0 && A.telemetry.some(t => t.Job_Type === 'fix_check_reminder' && t.Success === 'FALSE'), 'if the claim cannot be written NOTHING is texted, the error is returned and logged', r);
  A = await mk(); A.smsResult = o => o.recipient_type === 'tenant' ? { send_ok: true, sent: false, gate_snapshot: 'x' } : { send_ok: true, sent: true };
  r = await S(A); ok(r.ok === false && r.errors.some(e => e.step === 'reminder_sms') && /FAILED/.test(A.tabs.WO_Followups[0].Reminder_Result) && A.sms.filter(s => s.recipient_type === 'admin').length === 1, 'Twilio refusing the reminder: returned as an error, recorded, Brett still told to call');
  A = await mk(); A.smsResult = o => o.recipient_type === 'admin' ? { send_ok: false, gate_snapshot: 'Global OFF' } : { send_ok: true, sent: true };
  r = await S(A); ok(r.ok === false && r.errors.some(e => e.step === 'admin_alert'), 'an alert to Brett that cannot be delivered is a reported error');
  // schedRunFollowupSweep wrapper shape
}

// ═══ J. digest ═════════════════════════════════════════════════════════════════════════════
{
  const A = await sentWorld(); await A.api.fixAnswer(A.env, { t: A.token, choice: 'dry' });
  const d = await A.api.fuDigestLines(A.env);
  ok(d.error === '' && d.lines.length === 1 && /WO-1152/.test(d.lines[0]) && /says it is fixed/.test(d.lines[0]) && /Create the drywall\/paint work order/.test(d.lines[0]), 'resolved answers appear in the daily digest with the suggested next step', d);
  A.fail.fetchTab = 'WO_Followups'; const e = await A.api.fuDigestLines(A.env); ok(e.error && /exploded/.test(e.error) && A.telemetry.some(t => t.Job_Type === 'fix_check_digest' && t.Success === 'FALSE'), 'an unreadable list is reported in the digest AND to telemetry');
  const o = await sentWorld(); o.tabs.WO_Followups[0].Status = 'Overdue'; ok(/no answer yet - call them/.test((await o.api.fuDigestLines(o.env)).lines[0]), 'overdue checks are listed');
}

// ═══ K. wiring in worker.js ═══════════════════════════════════════════════════════════════
{
  const pub = w.slice(w.indexOf('const PUBLIC_PATHS = ['), w.indexOf("if (!PUBLIC_PATHS.includes(path))"));
  for (const p of ['/fix/page', '/fix/answer', '/fix/upload-session', '/fix/log-attachment']) ok(pub.includes("'" + p + "'"), p + ' is public (token-verified)');
  for (const p of ['/followup/preview', '/followup/list', '/followup/send', '/followup/link', '/followup/close']) ok(!pub.includes("'" + p + "'"), p + ' is NOT public');
  const roles = w.slice(w.indexOf('const ROLE_SCOPES = {'), w.indexOf('function isPathAllowedForRole'));
  ok(!/followup|\/fix\//.test(roles), 'no portal role (tenant / vendor / owner) can call the admin follow-up routes');
  for (const p of ['/fix/page', '/followup/preview', '/followup/list', '/fix/answer', '/fix/upload-session', '/fix/log-attachment', '/followup/send', '/followup/link', '/followup/close']) ok(new RegExp("path === '" + p + "'").test(w), 'route wired: ' + p);
  ok(/\{ name: 'followup_sweep',\s+kind: 'interval', every_min: 59,/.test(w), 'SCHED_JOBS has followup_sweep (hourly)');
  ok(/name: 'followup_sweep',\s+run: 'hub', every_min: 60,\s+enabled: true/.test(fs.readFileSync(new URL('../apps-script/hub-scheduler/HubScheduler.gs', import.meta.url), 'utf8')), 'HubScheduler.gs JOBS table has the followup_sweep row');
  ok(/followup_sweep: '/.test(w), 'preflight has a plain-English line for followup_sweep');
  ok(/\[triggers\][^[]*crons\s*=\s*\[\]/.test(fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')), 'wrangler.toml still has crons = []');
  const guard = w.slice(w.indexOf("if (path === '/followup/send') {"), w.indexOf("if (path === '/wo/share-send') {"));
  ok(/isTestWO\(env, body\.wo_id\)/.test(guard) && /isTestRecord\(env, 'Tenants'/.test(guard), 'the staging test token can only create fix-checks on TEST- work orders and TEST- tenants');
  ok(fs.existsSync(new URL('../fix-check.html', import.meta.url)), 'fix-check.html exists');
}

console.log(`fix-check: ${n} checks passed` + (process.exitCode ? ' (WITH FAILURES)' : ''));
