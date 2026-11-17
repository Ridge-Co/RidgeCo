// Fault-injection test for Phase 2 of the silent-failure burn-down (Nov 17 2026): message and alert send paths.
// Runs the REAL functions out of the Worker source with fakes. A text or email that does not go out must be REPORTED (P0 for a person-facing or alarm send),
// must never be recorded as delivered, and must never stop the job it belongs to. A send that was skipped on purpose is not a failure.
// Run: node test/send-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return src.slice(i, j); };
const helpers = slice('// ═══ SOFT-FAILURE-HELPERS-BEGIN', '// ═══ SOFT-FAILURE-HELPERS-END');
const fnText = name => { let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('\nfunction ' + name + '(') + 1; if (i <= 0) throw new Error('function missing: ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };

// ── shared fake world ────────────────────────────────────────────────────────────────────────────────────────────────────────
let REPORTED, SMS, SMS_RESULT, SMS_THROWS, EMAIL_THROWS, CONFIG, CONFIG_THROWS, SET_KEYS, TEL, TEL_ROWS, ROW_WRITES, QUEUE_THROWS, UPDATE_THROWS, READ_BAD, EMAILS, TRANSLATE_THROWS;
const reset = () => { REPORTED = []; SMS = []; SMS_RESULT = { sid: 'SM1' }; SMS_THROWS = false; EMAIL_THROWS = false; CONFIG = { failure_alert_enabled: 'TRUE', admin_phone: '+15555550100', dead_man_switch_enabled: 'TRUE', TWILIO_ENABLED: 'TRUE' }; CONFIG_THROWS = false; SET_KEYS = []; TEL = []; TEL_ROWS = []; ROW_WRITES = []; QUEUE_THROWS = false; UPDATE_THROWS = false; READ_BAD = []; EMAILS = []; TRANSLATE_THROWS = false; };
const world = {
  reportFailure: async (env, f) => { REPORTED.push(f); return { ok: true }; },
  fetchConfig: async () => { if (CONFIG_THROWS) throw new Error('Config read failed'); return CONFIG; },
  sendSMS: async (env, to, msg) => { if (SMS_THROWS) throw new Error('network down'); SMS.push({ to, msg }); return SMS_RESULT; },
  setConfigKey: async (env, o) => { SET_KEYS.push(o.key); },
  logTelemetry: async (env, r) => { TEL.push(r); },
  readTelemetryRows: async () => TEL_ROWS,
  gmailSendEmail: async (env, o) => { if (EMAIL_THROWS) throw new Error('Gmail send failed (HTTP 500)'); EMAILS.push(o); return { sent: true }; },
  fetchTab: async (env, tab) => { if (READ_BAD.includes(tab)) throw new Error(tab + ' read failed'); return world.__rows[tab] || []; },
  __rows: {},
  ensureColumns: async () => {}, updateRow: async (env, tab, id, f) => { if (UPDATE_THROWS) throw new Error('write failed'); ROW_WRITES.push({ tab, id, f }); return {}; },
  translateText: async () => { if (TRANSLATE_THROWS) throw new Error('translate down'); return 'traducido'; },
  makeSessionToken: async () => 'tok', parseHolidayMap: () => ({}), vendorPaymentWindow: () => null, findWO: (rows, id) => (rows || []).find(r => String(r.ID) === String(id)),
  driveIdFromUrl: () => '', _escHtml: s => String(s), logMessageAudit: async () => {},
  alertDebounceOk: (cfg, key) => !cfg[key],
  isDeadManSwitchTripped: () => true,
  etHour: () => 12, etDateString: () => '2026-11-17',
  json: (b, s) => ({ body: b, status: s || 200 }),
  __inspAlertAt: {},
};
const NAMES = ['alertAdminOnFailure', 'checkDeadManSwitch', 'inspAlert', 'processEstimateReminders', 'sendVendorInvoiceConfirmationEmail'];
const names = Object.keys(world);
const code = helpers + '\n' + NAMES.map(fnText).join('\n') + '\nreturn { sendFailure, ' + NAMES.join(', ') + ' };';
const F = new Function(...names, code)(...names.map(n => world[n]));
const lastReport = () => REPORTED[REPORTED.length - 1] || {};

console.log('sendFailure (pure)');
ok(F.sendFailure({ sid: 'SM1' }) === '' && F.sendFailure({ staged: true }) === '' && F.sendFailure({ skipped: true, reason: 'TWILIO_ENABLED not TRUE' }) === '' && F.sendFailure({ held_for_quiet_hours: true }) === '', 'sent, staged, skipped and held are not failures');
ok(F.sendFailure({ sent: false, reason: 'owner SMS switch is off' }) === '' && F.sendFailure(undefined) === '' && F.sendFailure(null) === '', 'a send blocked on purpose (reason only) and an empty result are not failures');
ok(/Twilio|credential|invalid/i.test(F.sendFailure({ code: 21211, message: 'Twilio: invalid To number' })) && F.sendFailure({ error: 'No phone number' }) === 'No phone number', 'a Twilio refusal (JSON, no sid) and { error } are failures');

console.log('alertAdminOnFailure (the alert that tells Brett something broke)');
reset();
{
  const r = await F.alertAdminOnFailure({}, 'sweep', 'boom');
  ok(r.sent === true && SMS.length === 1 && SET_KEYS.length === 1 && REPORTED.length === 0, 'healthy: texted, debounce stamped, nothing reported');
}
reset(); SMS_RESULT = { code: 21614, message: 'To number is not a valid mobile number' };
{
  const r = await F.alertAdminOnFailure({}, 'sweep', 'boom');
  ok(r.sent === false && /not a valid/.test(r.error), 'Twilio refuses the text: the answer is { sent:false }, not the old { sent:true }');
  ok(SET_KEYS.length === 0, 'no debounce stamp, so the next failure tries again instead of waiting an hour');
  ok(REPORTED.length === 1 && lastReport().severity === 'P0' && lastReport().where === 'alertAdminOnFailure:sweep' && /boom/.test(lastReport().context), 'reported once at P0 with the original problem attached');
}
reset(); SMS_THROWS = true;
{
  const r = await F.alertAdminOnFailure({}, 'sweep', 'boom');
  ok(r.sent === false && SET_KEYS.length === 0 && REPORTED.length === 1 && lastReport().severity === 'P0', 'sendSMS throwing is handled the same way');
}
reset(); SMS_RESULT = { skipped: true, reason: 'TWILIO_ENABLED not TRUE' };
{
  const r = await F.alertAdminOnFailure({}, 'sweep', 'boom');
  ok(r.sent === true && REPORTED.length === 0, 'Twilio switched off on purpose: not reported (behaviour unchanged)');
}
reset(); world.setConfigKey = async () => { throw new Error('config write failed'); };
{
  const G = new Function(...names, code)(...names.map(n => world[n]));
  const r = await G.alertAdminOnFailure({}, 'sweep', 'boom');
  ok(r.sent === true && REPORTED.length === 1 && lastReport().severity === 'P1' && lastReport().where === 'alertAdminOnFailure:debounce', 'the text went out but the debounce stamp failed: reported P1, alert still counted as sent');
  world.setConfigKey = async (env, o) => { SET_KEYS.push(o.key); };
}

console.log('checkDeadManSwitch');
reset(); TEL_ROWS = [];
{
  const r = await F.checkDeadManSwitch({});
  ok(r.alerted === true && SMS.length === 1 && SET_KEYS.length === 1 && TEL.length === 1 && REPORTED.length === 0, 'healthy trip: Brett texted, 24h debounce stamped, telemetry row written');
}
reset(); TEL_ROWS = []; SMS_RESULT = { code: 30007, message: 'Message filtered' };
{
  const r = await F.checkDeadManSwitch({});
  ok(r.alerted === false && r.tripped === true && r.error, 'the text is refused: alerted is false and the error is returned');
  ok(SET_KEYS.length === 0 && REPORTED.length === 1 && lastReport().severity === 'P0' && lastReport().where === 'checkDeadManSwitch:sms', 'no debounce stamp (it retries on the next sweep) and one P0 report');
}

console.log('inspAlert');
reset(); world.__inspAlertAt = {}; SMS_RESULT = { sid: 'SM2' };
{
  const G = new Function(...names, code)(...names.map(n => world[n]));
  await G.inspAlert({}, 'k1', 'calendar full');
  ok(SMS.length === 1 && EMAILS.length === 1 && REPORTED.length === 0, 'healthy: text and email both go out, nothing reported');
}
reset(); SMS_RESULT = { code: 21211, message: 'invalid To' }; EMAIL_THROWS = true;
{
  const G = new Function(...names, code)(...names.map(n => world[n]), );
  // fresh throttle map so the 30-minute guard does not hide the second case
  await G.inspAlert({}, 'k2-' + Math.random(), 'drive time lookup failed');
  const w = REPORTED.map(r => r.where).sort();
  ok(w.length === 2 && w[0] === 'inspAlert:email' && w[1] === 'inspAlert:sms' && REPORTED.every(r => r.severity === 'P0'), 'a refused text AND a failed email are each reported at P0');
  ok(/drive time/.test(lastReport().context), 'the original problem text is on the report');
}

console.log('processEstimateReminders (claims the day in Config before it texts)');
reset(); CONFIG_THROWS = true;
{
  const r = await F.processEstimateReminders({}, new Date('2026-11-17T17:00:00Z'));
  ok(r && /could not be read/.test(r.skipped || ''), 'settings unreadable: it sends nothing this run');
  ok(REPORTED.length === 1 && lastReport().severity === 'P0' && lastReport().where === 'processEstimateReminders:config' && SMS.length === 0, 'reported at P0, and no text went out (no guess at "not yet sent today")');
}
reset(); CONFIG = { estimate_reminder_last_date: '2026-11-17' };
{
  const r = await F.processEstimateReminders({}, new Date('2026-11-17T17:00:00Z'));
  ok(r && /already sent today/.test(r.skipped || '') && REPORTED.length === 0, 'readable settings, already claimed today: unchanged, nothing reported');
}

console.log('sendVendorInvoiceConfirmationEmail');
const bill = { Vendor_ID: 'V1', WO_ID: 'WO-9', Submitted_At: '2026-11-17T15:00:00Z', Total: '100' };
const seed = vendor => { world.__rows = { Vendors: [vendor], Work_Orders: [{ ID: 'WO-9', Property_ID: 'P1', Description: 'Fix sink' }], Properties: [{ ID: 'P1', Address: '1 Main St' }] }; CONFIG = Object.assign(CONFIG, { VENDOR_INVOICE_EMAIL_TEST_VENDOR_IDS: 'V1' }); };
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: 'sam@example.com', Language: 'en' });
{
  await F.sendVendorInvoiceConfirmationEmail({}, bill);
  ok(EMAILS.length === 1 && REPORTED.length === 0, 'healthy: email goes out, nothing reported');
}
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: 'sam@example.com', Language: 'en' }); READ_BAD = ['Vendors'];
{
  await F.sendVendorInvoiceConfirmationEmail({}, bill);
  ok(EMAILS.length === 0 && REPORTED.length === 1 && lastReport().severity === 'P1' && lastReport().where === 'vendorInvoiceConfirm:read:Vendors', 'Vendors tab unreadable: no email (as before) but now reported once at P1, not mistaken for "no such vendor"');
}
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: 'sam@example.com', Language: 'en' }); EMAIL_THROWS = true;
{
  let threw = false; try { await F.sendVendorInvoiceConfirmationEmail({}, bill); } catch (e) { threw = true; }
  ok(threw === true, 'a failed email is still rethrown to the caller (behaviour unchanged)');
  ok(REPORTED.some(r => r.where === 'vendorInvoiceConfirm:send' && r.severity === 'P0'), 'and it is reported at P0');
}
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: 'sam@example.com', Language: 'es' }); TRANSLATE_THROWS = true;
{
  await F.sendVendorInvoiceConfirmationEmail({}, bill);
  ok(EMAILS.length === 1 && REPORTED.length === 1 && lastReport().where === 'vendorInvoiceConfirm:translate' && lastReport().severity === 'P2', 'translation fails: the email still goes out (English description) and the miss is reported at P2');
}
console.log('  ... vendor with no email on file: the "please add your email" text');
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: '', Phone: '+15555550111', Language: 'en' });
{
  await F.sendVendorInvoiceConfirmationEmail({}, bill);
  ok(SMS.length === 1 && ROW_WRITES.length === 1 && ROW_WRITES[0].f.Email_Request_Sent_Date && REPORTED.length === 0, 'healthy: asked once and stamped');
}
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: '', Phone: '+15555550111', Language: 'en' }); SMS_RESULT = { code: 21211, message: 'invalid To' };
{
  await F.sendVendorInvoiceConfirmationEmail({}, bill);
  ok(ROW_WRITES.length === 0, 'the text was refused: the vendor is NOT stamped as asked, so he is asked again on the next bill');
  ok(REPORTED.length === 1 && lastReport().severity === 'P0' && lastReport().where === 'vendorInvoiceConfirm:emailRequestSms', 'reported at P0');
}
reset(); seed({ ID: 'V1', Name: 'Sam Vendor', Email: '', Phone: '+15555550111', Language: 'en' }); UPDATE_THROWS = true;
{
  await F.sendVendorInvoiceConfirmationEmail({}, bill);
  ok(SMS.length === 1 && REPORTED.length === 1 && lastReport().where === 'vendorInvoiceConfirm:emailRequestStamp' && lastReport().severity === 'P1', 'the text went out but the stamp did not save: reported P1 (he will be asked again)');
}

console.log('queueNotification (a text held for quiet hours: if it cannot be queued it is never sent)');
{
  let appendFails = false, appended = 0;
  const w2 = { reportFailure: world.reportFailure, NOTIF_QUEUE_TAB: 'Message_Queue', NOTIF_QUEUE_COLS: ['ID', 'WO_ID', 'Type', 'Phone', 'Message', 'Send_After', 'Sent', 'Created_At', 'Message_Type', 'Recipient_Type', 'Recipient_ID', 'Property_ID'], _notifQueueReady: false,
    ensureTab: async () => {}, ensureColumns: async () => {}, nextSafeId: () => 7,
    sheetsRequest: async (env, method) => { if (method === 'GET') return { values: [] }; if (appendFails) throw new Error('append failed'); appended++; return {}; } };
  const n2 = Object.keys(w2);
  const Q = new Function(...n2, helpers + '\n' + fnText('queueNotification') + '\nreturn queueNotification;')(...n2.map(n => w2[n]));
  reset();
  let r = await Q({}, 'WO-1', 'tenant_received', '+15555550123', 'hi', '2026-11-18T13:00:00Z', { message_type: 'tenant_job_received', recipient_type: 'tenant' });
  ok(r.queued === true && appended === 1 && REPORTED.length === 0, 'healthy: queued, nothing reported');
  appendFails = true;
  r = await Q({}, 'WO-1', 'tenant_received', '+15555550123', 'hi', '2026-11-18T13:00:00Z', { message_type: 'tenant_job_received', recipient_type: 'tenant' });
  ok(r.queued === false && REPORTED.length === 1 && lastReport().severity === 'P0' && lastReport().ref === 'WO-1' && /will not be sent/.test(lastReport().context), 'append fails: reported at P0 with the WO and what was lost, the caller still gets an answer (not a throw)');
}

console.log('addonOwnerNotice (owner text + email about additional work)');
{
  let stampFails = false, auditFails = false, smsResult = { sent: true }, emailResult = { sent: true }, cfgFails = false, updated = 0;
  const w3 = {
    reportFailure: world.reportFailure, json: world.json, fetchConfig: async () => { if (cfgFails) throw new Error('cfg down'); return { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }; },
    fetchTabs: async () => [[{ ID: 'WO-C' , Addon_Status: 'Submitted', Parent_WO_ID: 'WO-P', Property_ID: 'P1', Unit_ID: '' }, { ID: 'WO-P', Property_ID: 'P1' }], [{ WO_ID: 'WO-C', Status: 'Approved', Line_Items: '{not json' }], [], [{ ID: 'P1', Owner_ID: 'O1', SMS_Enabled: 'TRUE', Address: '1 Main' }], [{ ID: 'O1', First_Name: 'Pat', Phone: '+15555550199', Email: 'pat@example.com', SMS_Enabled: 'TRUE', Notify_Method: 'sms' }], []],
    findWO: (rows, id) => rows.find(r => r.ID === id), addonIsChild: () => true, addonLatestEstimate: (est) => est[0], addonPhotosByItem: () => ({}), addonParseItems: () => [{ index: 1, desc: 'Fix' }],
    englishOnly: s => s, propUnitText: () => '1 Main', addonBuildOwnerNotice: () => ({ sms: 'sms body', subject: 's', html: '<p>h</p>' }),
    addonEmailGate: () => ({ ok: true, reason: '' }), smsGatedSend: async () => smsResult, gmailSendEmail: async () => emailResult,
    updateWOFields: async () => { if (stampFails) throw new Error('stamp write failed'); updated++; }, logWOAudit: async () => { if (auditFails) throw new Error('audit write failed'); },
  };
  const n3 = Object.keys(w3);
  const A = new Function(...n3, helpers + '\n' + fnText('addonOwnerNotice') + '\nreturn addonOwnerNotice;')(...n3.map(n => w3[n]));
  reset();
  let r = await A({}, { child_wo_id: 'WO-C', preview: false });
  ok(r.body.success === true && updated === 1, 'sends and stamps the notified date');
  ok(REPORTED.some(x => x.where === 'addonOwnerNotice:lineItems' && x.severity === 'P1') && r.body.warnings.some(x => /estimate lines could not be read/.test(x)), 'corrupt saved estimate lines: reported P1 AND shown to the admin as a warning (they used to vanish)');
  reset(); stampFails = true; auditFails = true;
  r = await A({}, { child_wo_id: 'WO-C', preview: false });
  ok(r.body.success === true && r.body.warnings.some(x => /Check before sending it again/.test(x)), 'the notice went out but the "notified" date did not save: the admin is told not to resend blindly');
  ok(REPORTED.some(x => x.where === 'addonOwnerNotice:stamp' && x.severity === 'P1') && REPORTED.some(x => x.where === 'addonOwnerNotice:audit' && x.severity === 'P2'), 'the stamp (P1) and the audit row (P2) failures are both reported');
  reset(); stampFails = false; auditFails = false; cfgFails = true;
  r = await A({}, { child_wo_id: 'WO-C', preview: false });
  ok(r.body.warnings.some(x => /Settings could not be read/.test(x)) && REPORTED.some(x => x.where === 'addonOwnerNotice:config' && x.severity === 'P1'), 'settings unreadable: warned on screen and reported, not silently treated as "email off"');
  reset(); cfgFails = false; smsResult = Object.assign(() => {}, {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
