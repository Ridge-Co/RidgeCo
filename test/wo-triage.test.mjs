// Severity triage (queue #142 Phase 1): rules, stamp, fail-open, admin-only, never-lowers-priority.
// Run: node test/wo-triage.test.mjs   (SRC=path/to/worker.js to test another copy)
import fs from 'fs';
const src = fs.readFileSync(process.env.SRC || 'worker.js', 'utf8');
const a = src.indexOf('// ── SEVERITY TRIAGE'), b = src.indexOf('// ── END SEVERITY TRIAGE');
if (a < 0 || b < 0) throw new Error('triage block markers missing');
const block = src.slice(a, b);
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, x, y) => { if (JSON.stringify(x) === JSON.stringify(y)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(x), '\n   want', JSON.stringify(y)); } };

function make(over = {}) {
  const log = { writes: [], tele: [], fails: [], audit: [], ensured: [] };
  const state = { cfg: { Triage_Enabled: 'TRUE' }, rows: [{ ID: 'WO-1', Priority: 'normal', Created_Date: '2026-11-17T10:00:00Z' }], ...over };
  const env = {};
  const fns = {
    fetchConfig: async () => { if (state.cfgThrows) throw new Error('config down'); return state.cfg; },
    ensureColumns: async (e, tab, cols) => { log.ensured.push([tab, cols]); },
    updateRowVerified: async (e, tab, id, f) => { if (state.writeThrows) throw new Error('read-back mismatch'); log.writes.push({ id, f }); },
    logTelemetry: async (e, r) => { log.tele.push(r); },
    reportFailure: async (e, f) => { log.fails.push(f); },
    logWOAudit: async (e, id, by, role, field, o, n, notes) => { if (state.auditThrows) throw new Error('audit down'); log.audit.push({ id, field, o, n, notes }); },
    fetchTab: async () => state.rows,
    findWO: (rows, id) => rows.find(r => r.ID === id),
    json: (o, s = 200) => ({ body: o, status: s }),
    schedErrText: e => String((e && e.message) || e),
  };
  const mod = new Function(...Object.keys(fns), block + '\nreturn { triageByRules, triageParseKeywords, triageWorkOrder, triageIntakeSafe, woTriageSet, woTriagePreview, triageEnabled, triageSla, TRIAGE_COLS, TRIAGE_INTAKE_TYPES };')(...Object.values(fns));
  return { ...mod, log, state, env };
}
const m = make();
const JUL = new Date('2026-07-15T12:00:00Z'), JAN = new Date('2026-01-15T12:00:00Z');
const tier = (txt, trade = '', d = JUL) => m.triageByRules(txt, trade, d, null).tier;

// Golden set. Every Emergency sentence MUST come back Emergency.
const EMERGENCY = [
  'Water is pouring from the ceiling in the kitchen', 'There is a flood in the basement', 'Pipe burst under the sink and water everywhere',
  'I smell gas in the hallway', 'Strong gas smell near the stove', 'There is smoke coming from the outlet', 'The outlet is sparking',
  'Kitchen is on fire', 'burning smell from the breaker box', 'carbon monoxide alarm going off', 'Sewage is backing up into the tub',
  'Hay una inundacion en el sotano', 'Huele a gas en la cocina', 'Hay mucho humo', 'tuberia rota en el bano', 'se sale el agua del techo', 'Aguas negras en la ducha',
  'I am locked out and my baby is inside',
];
for (const s of EMERGENCY) t('emergency: ' + s, tier(s) === 'Emergency');
t('no heat in January is Emergency', tier('We have no heat', '', JAN) === 'Emergency');
t('no heat in July is only Urgent', tier('We have no heat', '', JUL) === 'Urgent');
t('no heat in July but freezing words is Emergency', tier('no heat and it is freezing', '', JUL) === 'Emergency');
t('Spanish no heat in winter', tier('No tenemos calefaccion', '', JAN) === 'Emergency');
const URGENT = ['No hot water since yesterday', 'the toilet is leaking at the base', 'Fridge is not cooling', 'We lost power in the bedroom', 'Front door lock is broken', 'sin agua caliente'];
for (const s of URGENT) t('urgent: ' + s, tier(s) === 'Urgent');
t('only toilet not flushing is Urgent', tier('Our only toilet will not flush') === 'Urgent');
t('no A/C in a heat wave is Urgent', tier('No AC and it is a heat wave') === 'Urgent');
const ROUTINE = ['Please replace the light bulb in the hall', 'Window screen is torn', 'Garbage disposal is slow', 'Need a new key made', 'Dishwasher is noisy'];
for (const s of ROUTINE) t('routine: ' + s, tier(s) === 'Routine');
const LOW = ['Touch up paint in the bedroom', 'Cabinet door squeaks', 'Loose towel bar', 'Scuffs on the wall'];
for (const s of LOW) t('low: ' + s, tier(s) === 'Low');
t('alarm that will not stop is at least Urgent (safety side)', ['Urgent','Emergency'].includes(tier("Smoke detector going off and won't stop")));
// false alarms
t('chirping smoke detector is not Emergency', tier('The smoke detector is chirping, needs a new battery') !== 'Emergency');
t('fireplace is not Emergency', tier('Please clean the fireplace') !== 'Emergency');
t('fire extinguisher is not Emergency', tier('Need a fire extinguisher inspected') !== 'Emergency');
t('"no longer leaking" lowers one step', tier('The pipe burst but it is no longer leaking') === 'Urgent');
t('"not an emergency" lowers Emergency one step', tier('smell gas but not an emergency') === 'Urgent');
t('empty text is Routine', tier('') === 'Routine');
t('null text is Routine', m.triageByRules(null, null, JUL, null).tier === 'Routine');
t('why is returned, never the tenant sentence', !JSON.stringify(m.triageByRules('Secret sentence about a flood', '', JUL, null).matched).includes('Secret'));
eq('trade suggestion', m.triageByRules('furnace is dead', '', JUL, null).suggested_trade, 'HVAC');
eq('trade on the request wins', m.triageByRules('furnace is dead', 'Plumbing', JUL, null).suggested_trade, 'Plumbing');
// custom keywords
const kw = m.triageParseKeywords('{"Emergency":["tree fell"],"Low":["lightbulb"]}');
t('custom emergency word', m.triageByRules('A tree fell on the porch', '', JUL, kw).tier === 'Emergency');
t('custom list REPLACES built-in for that tier', m.triageByRules('flood', '', JUL, kw).tier === 'Routine');
t('bad JSON reports an error', !!m.triageParseKeywords('{nope').error);
t('non-object reports an error', !!m.triageParseKeywords('[1]').error);
t('blank keywords is null', m.triageParseKeywords('  ') === null);
// config
t('OFF when blank', !m.triageEnabled({}));
t('OFF when FALSE', !m.triageEnabled({ Triage_Enabled: 'FALSE' }));
t('ON when TRUE', m.triageEnabled({ Triage_Enabled: 'true' }));
eq('default SLA', m.triageSla({}).Emergency, 1);
eq('custom SLA', m.triageSla({ Triage_SLA_Hours: '{"Emergency":2}' }).Emergency, 2);
eq('bad SLA keeps defaults', m.triageSla({ Triage_SLA_Hours: 'zzz' }).Urgent, 4);

// stamping
{ const x = make(); const r = await x.triageWorkOrder(x.env, 'WO-1', { description: 'water pouring from ceiling', trade: '', priority: 'normal' }, 'rules');
  eq('stamped Emergency', r.tier, 'Emergency'); t('raised', r.raised);
  const w = x.log.writes[0].f; eq('tier written', w.Triage_Tier, 'Emergency'); eq('priority raised to urgent', w.Priority, 'urgent');
  t('due date set', !!w.Triage_Due_At && Date.parse(w.Triage_Due_At) > Date.now());
  eq('audit row for raise', x.log.audit.length, 1); t('columns ensured (not tab created)', x.log.ensured[0][0] === 'Work_Orders' && x.log.ensured[0][1].includes('Triage_Tier'));
  eq('success telemetry', x.log.tele[0].Success, 'TRUE'); }
{ const x = make(); await x.triageWorkOrder(x.env, 'WO-1', { description: 'flood', priority: 'urgent' }, 'rules');
  t('already urgent: Priority not rewritten', x.log.writes[0].f.Priority === undefined); eq('no audit when not raised', x.log.audit.length, 0); }
{ const x = make(); await x.triageWorkOrder(x.env, 'WO-1', { description: 'touch up paint', priority: 'urgent' }, 'rules');
  t('Low tier never lowers a Priority a person chose', x.log.writes[0].f.Priority === undefined); }
{ const x = make(); await x.triageWorkOrder(x.env, 'WO-1', { description: 'urgent flood', priority: 'high' }, 'rules');
  t('Emergency over "high" raises to urgent', x.log.writes[0].f.Priority === 'urgent'); }
{ const x = make({ cfg: {} }); const r = await x.triageWorkOrder(x.env, 'WO-1', { description: 'flood' }, 'rules');
  eq('OFF skips', r.skipped, 'off'); eq('OFF writes nothing', x.log.writes.length, 0); eq('OFF ensures nothing', x.log.ensured.length, 0); }
{ const x = make({ cfg: { Triage_Enabled: 'TRUE', Triage_Keywords: '{bad' } }); await x.triageWorkOrder(x.env, 'WO-1', { description: 'flood' }, 'rules');
  t('bad keywords: still triaged with built-ins', x.log.writes[0].f.Triage_Tier === 'Emergency'); t('bad keywords: loud failed telemetry', x.log.tele.some(r => r.Job_Type === 'triage_config_bad' && r.Success === 'FALSE')); }
// fail open + loud
{ const x = make({ writeThrows: true }); const r = await x.triageIntakeSafe(x.env, 'WO-1', { description: 'flood' });
  t('write failure does not throw', !!r.failed); t('failure telemetry row', x.log.tele.some(e => e.Success === 'FALSE' && /could not triage/.test(e.Notes)));
  eq('failure ledger row', x.log.fails.length, 1); eq('failure severity', x.log.fails[0].severity, 'P2'); }
{ const x = make({ cfgThrows: true }); const r = await x.triageIntakeSafe(x.env, 'WO-1', { description: 'flood' }); t('config failure does not throw', !!r.failed); eq('config failure logged', x.log.fails.length, 1); }
// admin routes
{ const x = make(); let r = await x.woTriageSet(x.env, { wo_id: 'WO-1', tier: 'Emergency', reason: 'tenant called' });
  eq('triage-set ok', r.body.success, true); eq('manual source', x.log.writes[0].f.Triage_Source, 'manual'); eq('set by admin', x.log.writes[0].f.Triage_Set_By, 'admin'); eq('priority raised', x.log.writes[0].f.Priority, 'urgent');
  r = await x.woTriageSet(x.env, { wo_id: 'WO-1', tier: 'Bogus' }); eq('bad tier 400', r.status, 400);
  r = await x.woTriageSet(x.env, { tier: 'Low' }); eq('missing id 400', r.status, 400);
  r = await x.woTriageSet(x.env, { wo_id: 'WO-NOPE', tier: 'Low' }); eq('unknown wo 404', r.status, 404);
  const w0 = x.log.writes.length; r = await x.woTriageSet(x.env, { wo_id: 'WO-1', tier: 'Low' }); t('Low via hand does not touch Priority', x.log.writes[w0].f.Priority === undefined);
  const p = await x.woTriagePreview(x.env, { text: 'gas smell' }); eq('preview', p.body.tier, 'Emergency'); const n = x.log.writes.length; await x.woTriagePreview(x.env, { text: 'x' }); eq('preview writes nothing', x.log.writes.length, n); }

// wiring (source-level)
t('intake types are the 4 customer-facing ones', JSON.stringify(m.TRIAGE_INTAKE_TYPES) === JSON.stringify(['tenant', 'owner', 'email', 'manual']));
t('router sets the flag itself from type', /body\.__triage = TRIAGE_INTAKE_TYPES\.includes\(String\(body\.type \|\| 'manual'\)\)/.test(src));
t('Buildium intake sets the flag', /created_by: 'buildium-email', notes, __triage: true/.test(src));
t('createWorkOrder only triages when flag is true', /if \(body\.__triage === true\) await triageIntakeSafe\(/.test(src));
t('hook sits before the wo_create telemetry line', src.indexOf('await triageIntakeSafe(env, woId') < src.indexOf("Job_Type:'wo_create', Skill_Or_Endpoint:'/workorder'"));
t('enrichWO strips Triage_ for tenant/owner/vendor/shared', /startsWith\('Triage_'\)\) delete base\[k\]/.test(src) && /opts\.tenantView \|\| opts\.ownerView \|\| opts\.vendorView/.test(src));
t('routes exist', src.includes("path === '/wo/triage-set'") && src.includes("path === '/wo/triage-preview'"));
const rs = src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('const ROLE_SCOPES') + 40000);
t('triage paths are in no ROLE_SCOPES list (admin only)', src.indexOf('const ROLE_SCOPES') > 0 && !/triage-(set|preview)/.test(rs.slice(0, rs.indexOf('\n};') > 0 ? rs.indexOf('\n};') : 20000)));
// a failed audit row is reported, never only console.error (gate C3, Nov 17 2026)
{ const x = make({ auditThrows: true }); const r = await x.triageWorkOrder(x.env, 'WO-1', { description: 'water pouring from ceiling', trade: '', priority: 'normal' }, 'rules');
  eq('audit failure: still stamped Emergency', r.tier, 'Emergency'); t('audit failure: reported to the failure ledger', x.log.fails.some(f => f.where === 'wo_triage_audit' && f.severity === 'P2')); }
{ const x = make({ auditThrows: true }); const r = await x.woTriageSet(x.env, { wo_id: 'WO-1', tier: 'Emergency', reason: 'tenant called' });
  eq('audit failure: tier-set still ok', r.body.success, true); t('audit failure on tier-set: reported', x.log.fails.some(f => f.where === 'wo_triage_audit')); }
console.log(`wo-triage: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
