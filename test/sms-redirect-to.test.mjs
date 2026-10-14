// smsGatedSend opts.redirectTo (Oct 14 2026): one caller (the Milam Ridge cleaning scheduler) can send a text to a
// safe test phone while the global TWILIO_TEST_MODE stays OFF. Runs the REAL smsGatedSend out of worker.js.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const QCOLS = ['ID', 'WO_ID', 'Message_Type', 'Recipient_Type', 'Recipient_Name', 'Recipient_Phone', 'Property_ID', 'Property_Address', 'Message_Body', 'Status', 'Delivered_To', 'Gate_Snapshot', 'Created_Date', 'Sent_Date', 'Twilio_Message_SID', 'Active', 'Send_After', 'Original_Body', 'Translated_To', 'Skip_If_Seen'];
function makeGate(cfg) {
  const state = { raw: [], updates: [] };
  const deps = {
    ensureSmsInfra: async () => {}, fetchConfig: async () => Object.assign({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }, cfg || {}),
    normalizePhone: p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : (d.length === 11 && d[0] === '1' ? '+' + d : ''); },
    sheetsRequest: async (e, m) => m === 'GET' ? { values: [QCOLS] } : {}, nextSafeId: () => 7,
    isQuietHoursNow: () => false, nextQuietHoursEnd: () => new Date(), etHour: () => 12, quietHoldUntil: () => null,
    updateMessageQueueRow: async (e, id, f) => { state.updates.push(f); },
    sendSMSRaw: async (e, to, msg) => { state.raw.push({ to, msg }); return { sid: 'SM1' }; },
    logMessageAudit: async () => {},
    smsGateDecision: new Function(grab('smsGateDecision') + '\nreturn smsGateDecision;')(),
    smsToggleOn: v => String(v == null ? '' : v).toUpperCase() !== 'FALSE',
    translateForVendorDetailed: async () => ({ translated: false }),
    MSG_QUEUE_TAB: 'Message_Queue', MSG_QUEUE_COLS: QCOLS,
  };
  const names = Object.keys(deps);
  return { fn: new Function(...names, grab('smsGatedSend') + '\nreturn smsGatedSend;')(...names.map(k => deps[k])), state };
}
const vendor = { ID: '19', Name: 'Regina Saville', Phone: '5403364284', Language: 'en' };
const base = { message_type: 'str_offer', recipient_type: 'vendor', vendor, message_body: 'hi', bypassQuietHours: true };
{
  const { fn, state } = makeGate();
  const r = await fn({}, Object.assign({}, base, { redirectTo: '4439617927' }));
  ok(r.sent && state.raw.length === 1 && state.raw[0].to === '+14439617927', 'redirectTo: the text goes to the test phone, NOT the vendor, with global test mode OFF');
  ok(state.updates.some(u => u.Delivered_To === '+14439617927' && u.Status === 'sent'), 'Message_Queue.Delivered_To records the test phone');
  ok(r.test_mode === true && r.delivered_to === '+14439617927', 'return value reports test mode + the real delivery target');
}
{
  const { fn, state } = makeGate();
  const r = await fn({}, base);
  ok(r.sent && state.raw[0].to === '+15403364284' && r.test_mode === false, 'no redirectTo + test mode OFF: unchanged, goes to the real vendor');
}
{
  const { fn, state } = makeGate({ TWILIO_TEST_MODE: 'TRUE' });
  await fn({}, base);
  ok(state.raw[0].to === '+14439617927', 'no redirectTo + global test mode ON: unchanged, goes to the test recipient');
}
{
  const { fn, state } = makeGate();
  const r = await fn({}, Object.assign({}, base, { redirectTo: 'garbage' }));
  ok(!r.sent && state.raw.length === 0 && /redirectTo is not a valid phone/.test(r.gate_snapshot), 'invalid redirectTo fails CLOSED: nothing goes to the real vendor');
  ok(state.updates.some(u => u.Status === 'failed'), 'and the Message_Queue row is marked failed, not left pending');
}
console.log(`sms-redirect-to: ${n} passed`);
