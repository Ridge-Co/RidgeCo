// Guided request with emergency catch, Phase 1 (queue #116, Nov 19 2026).
// Covers the server side: the emergency decision, the column writes, "alert only after a confirmed write", the alert failure path, the recheck, and the routes.
// Run: node test/intake-guided.test.mjs
import fs from 'node:fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
function grab(sig) {
  const start = w.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = w.indexOf('{', start); let d = 0, i = open;
  for (; i < w.length; i++) { if (w[i] === '{') d++; else if (w[i] === '}') { d--; if (!d) break; } }
  return w.slice(start, i + 1);
}
const consts = w.slice(w.indexOf("const GUIDED_INTAKE_COLS = ["), w.indexOf('function intakeOn'));
const fnNames = ['intakeOn', 'intakeEmergencyWords', 'intakeWordHit', 'intakeClean', 'intakeDecide', 'intakeAlertText', 'intakeTextAdmin', 'intakeReadRow', 'intakeAfterCreate', 'processIntakeEmergencyRecheck', 'intakeAck', 'intakeDeflected'];
const fnSrc = fnNames.map(f => grab((f === 'intakeTextAdmin' || f === 'intakeReadRow' || f === 'intakeAfterCreate' || f === 'processIntakeEmergencyRecheck' || f === 'intakeAck' || f === 'intakeDeflected' ? 'async function ' : 'function ') + f + '(')).join('\n');
function make(deps) {
  const names = ['sheetsRequest', 'idColIndex', 'updateWOFields', 'fetchTabs', 'fetchTab', 'fetchConfig', 'smsGatedSend', 'pushNotify', 'reportFailure', 'formatUnitLabel', 'isStaging', 'json', 'logTelemetry'];
  const base = {
    idColIndex: h => h.indexOf('ID'), formatUnitLabel: x => String(x), isStaging: () => false, json: (o, s) => ({ body: o, status: s || 200 }),
    reportFailure: async () => ({}), pushNotify: async () => ({ ok: true, sent: 1 }), logTelemetry: async () => ({}),
    fetchConfig: async () => ({ intake_guided_enabled: 'TRUE', admin_phone: '+15551230000' }),
    fetchTabs: async () => [[{ ID: 'P1', Address: '12 Oak St' }], [{ ID: 'U1', Unit_Label: '2B' }]], fetchTab: async () => [],
    smsGatedSend: async (e, o) => ({ sent: true }), updateWOFields: async () => {}, sheetsRequest: async () => ({ values: [['ID']] })
  };
  const d = Object.assign(base, deps || {});
  return new Function(...names, 'const env = {};\n' + consts + fnSrc + '\nreturn { ' + fnNames.join(', ') + ' };')(...names.map(k => d[k]));
}
const F = make();

// the decision: the SERVER decides, not the page
{
  const words = F.intakeEmergencyWords({});
  const clean = o => F.intakeClean(o);
  ok(F.intakeDecide(clean({ emergency: true, kind: 'Smell of gas' }), 'x', words).emergency === true, 'a tenant who tapped an emergency is an emergency');
  ok(F.intakeDecide(clean({ emergency: false, answers: {} }), 'There is a gas smell in the kitchen', words).emergency === true, 'AC3: "gas smell" in the description files as an emergency even though the tenant tapped No');
  ok(F.intakeDecide(clean({ emergency: false, answers: {} }), 'My basement is flooding', words).emergency === true, 'flooding is an emergency word');
  ok(F.intakeDecide(clean({ emergency: false, answers: {} }), 'The fireplace damper is stuck', words).emergency === false, '"fireplace" does not trip the "fire" word (whole words only)');
  ok(F.intakeDecide(clean({ emergency: false, answers: { what: 'leak' } }), 'Kitchen faucet drips slowly', words).emergency === false, 'AC4: an ordinary request is not an emergency');
  ok(F.intakeDecide(clean({ emergency: false, answers: { burn: 'yes' } }), 'outlet is sparking', words).emergency === true, 'sparking is an emergency word');
  ok(F.intakeDecide(null, 'gas smell', words).emergency === false, 'no intake object = nothing decided here (the old form path)');
  ok(F.intakeEmergencyWords({ intake_emergency_words: 'mold, wasp nest' }).join() === 'mold,wasp nest', 'Config intake_emergency_words replaces the default list');
  ok(F.intakeEmergencyWords({ intake_emergency_words: '  ' }).includes('gas smell'), 'a blank Config value falls back to the fixed default');
  ok(F.intakeOn({ intake_guided_enabled: 'TRUE' }) && F.intakeOn({ intake_guided_enabled: ' true ' }) && !F.intakeOn({}) && !F.intakeOn({ intake_guided_enabled: 'FALSE' }), 'the switch starts OFF and only TRUE turns it on');
  const c = clean({ answers: { a: 'x'.repeat(500) }, summary: 'y'.repeat(5000), emergency: 'yes', channel: 'sms', lang: 'fr' });
  ok(c.answers.a.length === 120 && c.summary.length === 900 && c.tappedEmergency === false && c.channel === 'web' && c.lang === 'en', 'the page input is capped; only the literal true counts as a tap; channel is always web; unknown language is English');
}
// the alert text: one SMS piece, plain characters
{
  const t = F.intakeAlertText({ woId: 'WO-1234', where: '1601 Ingleside Avenue Unit 2B Catonsville', what: 'Smell of gas' });
  ok(t.length <= 160 && /^[\x20-\x7E]+$/.test(t), 'AC: the alert text is one SMS piece (<=160) in plain ASCII: ' + t.length);
  ok(t.includes('WO-1234') && t.includes('?wo=WO-1234') && /^EMERGENCY/.test(t), 'names the work order and carries the short link');
  const long = F.intakeAlertText({ woId: 'WO-99999', where: 'é'.repeat(300) + 'A'.repeat(300), what: 'carbon monoxide alarm is going off right now please help' });
  ok(long.length <= 160 && /^[\x20-\x7E]+$/.test(long), 'a very long or non-ASCII address is still one plain SMS piece');
  ok(/^REMINDER EMERGENCY/.test(F.intakeAlertText({ woId: 'WO-1', where: 'x', what: '', again: true })), 'the second text says REMINDER');
}
// alert only after a confirmed write; failures are loud
async function run() {
  const goodRow = { ID: 'WO-7', Property_ID: 'P1', Unit_ID: 'U1', Priority: 'urgent', Intake_Emergency: 'TRUE', Description: 'gas smell' };
  const hdr = Object.keys(goodRow);
  const sheet = row => async () => ({ values: [hdr, hdr.map(h => row[h])] });
  {
    const sent = [], upd = [], fails = [];
    const G = make({ sheetsRequest: sheet(goodRow), smsGatedSend: async (e, o) => { sent.push(o); return { sent: true }; }, updateWOFields: async (e, id, f) => upd.push(f), reportFailure: async (e, f) => fails.push(f) });
    const r = await G.intakeAfterCreate({}, 'WO-7', { emergency: true, kind: 'Smell of gas' });
    ok(r.alert === 'sent' && sent.length === 1 && sent[0].message_type === 'admin_intake_emergency' && sent[0].bypassQuietHours === true && sent[0].recipient_type === 'admin', 'AC2: one text to Brett, type admin_intake_emergency, ignoring quiet hours');
    ok(upd.some(f => /^sent\|/.test(f.Intake_Alert_State || '')) && !fails.length, 'the state is recorded as sent and nothing is reported as failed');
  }
  {
    const sent = [], fails = [];
    const G = make({ sheetsRequest: sheet(Object.assign({}, goodRow, { Intake_Emergency: '' })), smsGatedSend: async (e, o) => { sent.push(o); return { sent: true }; }, reportFailure: async (e, f) => fails.push(f) });
    const r = await G.intakeAfterCreate({}, 'WO-7', { emergency: true, kind: 'x' });
    ok(sent.length === 0 && /^NOT SENT/.test(r.alert) && fails.length === 1 && fails[0].severity === 'P0', 'AC5: if the row does not read back as an emergency NO text goes out, and a P0 failure is reported');
  }
  {
    const sent = [], upd = [], fails = [];
    const G = make({ sheetsRequest: sheet(goodRow), smsGatedSend: async (e, o) => { sent.push(o); return { sent: false, gate_snapshot: 'twilio refused' }; }, updateWOFields: async (e, id, f) => upd.push(f), reportFailure: async (e, f) => fails.push(f) });
    const r = await G.intakeAfterCreate({}, 'WO-7', { emergency: true, kind: 'x' });
    ok(/^FAILED/.test(r.alert) && upd.some(f => /^FAILED\|/.test(f.Intake_Alert_State || '')) && fails.some(f => f.where === 'intake_emergency_alert' && f.severity === 'P0'), 'AC6: a refused alert text shows as FAILED on the work order and goes to the failure ledger at top priority');
  }
  {
    const G = make({ sheetsRequest: sheet(goodRow), pushNotify: async () => { throw new Error('push down'); } });
    const r = await G.intakeAfterCreate({}, 'WO-7', { emergency: true, kind: 'x' });
    ok(r.alert === 'sent' && r.warnings.some(x => /push/.test(x)), 'a push failure is returned as a warning but does not stop the text');
  }
  {
    const G = make({});
    const r = await G.intakeAfterCreate({}, 'WO-7', { emergency: false });
    ok(r.alert === 'not needed', 'AC4: a non-emergency sends nothing');
  }
  // recheck: second text after the wait, once, only if still New and not opened
  {
    const old = new Date(Date.now() - 20 * 60000).toISOString(), fresh = new Date(Date.now() - 2 * 60000).toISOString();
    const H = ['ID', 'Status', 'Created_Date', 'Intake_Emergency', 'Intake_Alert_State'];
    const rows = [
      ['WO-1', 'New', old, 'TRUE', 'sent|x|sent|push 1 sent'], ['WO-2', 'New', fresh, 'TRUE', 'sent|x'], ['WO-3', 'Assigned', old, 'TRUE', 'sent|x'],
      ['WO-4', 'New', old, 'TRUE', 'sent|x;ack|2026'], ['WO-5', 'New', old, 'TRUE', 'sent|x;recheck|sent|y'], ['WO-6', 'New', old, 'FALSE', ''], ['WO-8', 'New', old, 'TRUE', 'FAILED|x|refused']];
    const texts = [], upd = [];
    const G = make({ sheetsRequest: async () => ({ values: [H, ...rows] }), smsGatedSend: async (e, o) => { texts.push(o.wo_id); return { sent: true }; }, updateWOFields: async (e, id, f) => upd.push([id, f.Intake_Alert_State]) });
    const r = await G.processIntakeEmergencyRecheck({});
    ok(texts.join() === 'WO-1,WO-8' && r.resent === 2, 'only the old, still-New, unopened, not-yet-rechecked emergencies get the second text (and a refused first text is retried once): ' + texts.join());
    ok(upd.every(([, s]) => /;recheck\|sent/.test(s)), 'each recheck is recorded so it cannot repeat');
    const off = make({ fetchConfig: async () => ({}) });
    ok((await off.processIntakeEmergencyRecheck({})).skipped, 'with the switch OFF the recheck does nothing');
    let threw = false; const G2 = make({ sheetsRequest: async () => ({ values: [H, rows[0]] }), smsGatedSend: async () => ({ sent: false, gate_snapshot: 'no' }) });
    try { await G2.processIntakeEmergencyRecheck({}); } catch (e) { threw = true; }
    ok(threw, 'a second text that cannot be sent makes the sweep job FAIL (visible in the scheduler), not pass quietly');
  }
  // ack
  {
    const H = ['ID', 'Intake_Emergency', 'Intake_Alert_State']; let st = 'sent|x';
    const G = make({ sheetsRequest: async () => ({ values: [H, ['WO-1', 'TRUE', st]] }), updateWOFields: async (e, id, f) => { st = f.Intake_Alert_State; } });
    const r1 = await G.intakeAck({}, { wo_id: 'WO-1' });
    ok(r1.status === 200 && r1.body.changed === true && /;ack\|/.test(st), 'opening an emergency records the acknowledgement');
    const r2 = await G.intakeAck({}, { wo_id: 'WO-1' });
    ok(r2.body.changed === false, 'a second open changes nothing');
    const B = make({ sheetsRequest: async () => ({ values: [H, ['WO-1', 'TRUE', 'sent|x']] }), updateWOFields: async () => {} });
    ok((await B.intakeAck({}, { wo_id: 'WO-1' })).status === 500, 'an acknowledgement that does not read back is an error, not a quiet success');
  }
  // deflected
  {
    const logs = [];
    const G = make({ fetchTab: async () => [{ ID: 'T1', Property_ID: 'P9' }], logTelemetry: async (e, r) => logs.push(r) });
    const r = await G.intakeDeflected({}, { trade: 'Electrical', check: 'gfci' }, 'tenant', 'T1');
    ok(r.body.ok && logs.length === 1 && logs[0].Job_Type === 'intake_deflected' && /property=P9/.test(logs[0].Notes), '"That fixed it" logs one telemetry row with trade, check and property');
    const bad = make({ fetchTab: async () => [], logTelemetry: async () => { throw new Error('quota'); } });
    ok((await bad.intakeDeflected({}, {}, 'tenant', 'T1')).status === 500, 'a failed log is an error response (and is reported), not a silent ok');
  }
}
await run();

// wiring in createWorkOrder and the router (source checks)
{
  const cwo = grab('async function createWorkOrder(');
  ok(cwo.includes('if (intakeOn(_icfg))') && cwo.includes("ensureColumns(env, 'Work_Orders', GUIDED_INTAKE_COLS)"), 'AC1: intake is read only while the switch is on, and its columns are added with ensureColumns');
  ok(cwo.indexOf('guardAppendedIds') < cwo.indexOf('intakeAfterCreate(') && cwo.indexOf('intakeAfterCreate(') < cwo.indexOf("addRow(env, 'WO_Tenants'"), 'the alert comes only after the row is appended and its id confirmed, and before the tenant/owner texts');
  ok(cwo.includes("if (_intakeDecision.emergency) body.priority = 'urgent'"), 'an emergency forces Priority urgent');
  ok(/Intake_Emergency: _intake \?/.test(cwo) && /Intake_Channel: _intake \?/.test(cwo), 'with no intake the Intake_* cells stay blank');
  ok(!/catch\s*\(\s*_?\s*\)\s*\{\s*\}/.test(grab('async function intakeAfterCreate(')), 'intakeAfterCreate has no swallowing catch');
  ok(w.includes("if (path === '/intake/ack')") && w.includes("if (path === '/intake/deflected')"), 'both routes exist');
  const scopes = w.slice(w.indexOf('const ROLE_SCOPES'), w.indexOf('function isPathAllowedForRole'));
  ok((scopes.match(/'\/intake\/deflected'/g) || []).length === 1 && !scopes.includes('/intake/ack'), '/intake/deflected is open to the tenant role only; /intake/ack is admin only');
  ok(w.includes("detail.intake_recheck = await schedStep('intake_recheck'"), 'the recheck rides the existing 14-minute work sweep (no new job, no cron)');
  ok(!/crons\s*=\s*\[\s*"/.test(fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')), 'no cron trigger was added');
  const tbp = grab('async function tenantByPin(');
  ok(tbp.includes('intake_guided:') && tbp.includes('emergency_phone:'), 'tenant-by-pin tells the page whether the flow is on and which number to call');
}
{
  // Quiet hours: the ONLY thing this build sends that ignores quiet hours is the emergency type, and it says so explicitly.
  const tx = grab('async function intakeTextAdmin(');
  ok(tx.includes("message_type: 'admin_intake_emergency'") && tx.includes('bypassQuietHours: true'), 'the emergency text bypasses quiet hours explicitly');
  const others = [grab('async function intakeDeflected('), grab('async function intakeAck(')].join('');
  ok(!/smsGatedSend|bypassQuietHours/.test(others), 'nothing else added here sends a text');
}
console.log(`intake-guided: ${n}/${n} passing`);
