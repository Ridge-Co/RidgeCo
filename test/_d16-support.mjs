// Shared test support for the D-16 SMS cost-control code (Oct 23 2026). Extracts the REAL blocks out of worker.js so the tests cannot drift
// from what ships. Not a test itself (no .test.mjs suffix): other tests import it when they run the real smsGatedSend / sendSMSRaw.
import fs from 'fs';
export const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function range(a, b) {
  const i = wsrc.indexOf(a); if (i < 0) throw new Error('start not found: ' + a);
  const j = wsrc.indexOf(b, i); if (j < 0) throw new Error('end not found: ' + b);
  return wsrc.slice(i, j);
}
// The cost-control block: marker, sanitizer, estimate, destination check, error table, dedupe, SMS_Logs writer, and the real sendSMSRaw.
export const D16_BLOCK = range('// ========== SMS COST CONTROL (D-16', '// sendSMS — the long-standing chokepoint');
// The helpers smsGatedSend uses (row objects, own-number test, outcome mapping, the legacy-site failure reporter).
export const D16_GATED = range('// Pure. Message_Queue values grid (header row first)', '// The one entry point for all 6 TWILIO_SMS_BUILD_BRIEF_v1.0 message types.');
// The queued-send path used by quiet-hours / manual release.
export const D16_QUEUED = range('// Sends one ALREADY-QUEUED Message_Queue row', '// Internal row update for Message_Queue');
const NAMES = ['smsMaskPhones', 'SMS_KNOWN_BAD_CODES', 'smsEstimate', 'smsSanitize', 'smsSanitizeText', 'smsDestinationCheck', 'smsErrorInfo', 'SMS_PERMANENT_ERRORS', 'SMS_NEVER_REMEMBER_CODES', 'smsHash', 'smsDedupeKey', 'smsDedupeCheck', 'smsDedupeRemember', 'mqFindDuplicate', 'mqFindRecentNudge', 'mqFindKnownBad', 'SMS_DEDUPE_WINDOW_MS',
  'mqRowsToObjects', 'smsIsOwnNumber', 'SMS_NUDGE_MIN_GAP_MS', 'SMS_KNOWN_BAD_WINDOW_MS', 'smsSendOutcome', 'smsReportIfFailed', 'smsLogAppend', 'smsLogRecord', 'smsReportRegionBlocked', 'smsLogHeaders', 'sendSMSRaw', 'SMS_COST_D16_MARKER', 'SMS_LOG_BASE_COLS', 'SMS_LOG_COST_COLS', 'SMS_CHAR_MAP'];
const normalizePhone = new Function(wsrc.slice(wsrc.indexOf('function normalizePhone('), wsrc.indexOf('// (xxx) xxx-xxxx for a US 10-digit number')) + '\nreturn normalizePhone;')();   // the REAL one
// Real implementations of every pure helper + injectable IO. `world` = extra stubs for the IO (sheetsRequest, ensureColumns, ensureTab, isMissingTabError,
// reportFailure, isStaging, fetch ...). Returns { ...functions, rec:{logs, reports} } where logs/reports record what smsLogRecord / reportFailure were given.
export function d16Real(world) {
  world = world || {};
  const rec = { logs: [], reports: [] };
  const stubs = Object.assign({
    normalizePhone, COLS_OK_MS: 600000, isStaging: () => false, isMissingTabError: () => false,
    ensureColumns: async () => {}, ensureTab: async () => {}, sheetsRequest: async () => ({ values: [['ID']], updates: { updatedRange: 'x' } }),
    reportFailure: async (env, o) => { rec.reports.push(o); }, fetch: async () => { throw new Error('fetch not stubbed'); },
  }, world);
  const names = Object.keys(stubs);
  const fns = new Function(...names, D16_BLOCK + '\n' + D16_GATED + '\nreturn {' + NAMES.join(',') + '};')(...names.map(k => stubs[k]));
  return Object.assign(fns, { rec });
}
// The names smsGatedSend needs, as spies: use  Object.assign(deps, d16Deps())  in a harness that injects dependencies by name.
export function d16Deps(over) {
  const real = d16Real(over && over.world);
  const rec = real.rec;
  const deps = {
    smsSanitizeText: real.smsSanitizeText, mqRowsToObjects: real.mqRowsToObjects, smsIsOwnNumber: real.smsIsOwnNumber, SMS_NUDGE_MIN_GAP_MS: real.SMS_NUDGE_MIN_GAP_MS,
    SMS_KNOWN_BAD_WINDOW_MS: real.SMS_KNOWN_BAD_WINDOW_MS, mqFindRecentNudge: real.mqFindRecentNudge, mqFindKnownBad: real.mqFindKnownBad, mqFindDuplicate: real.mqFindDuplicate,
    smsMaskPhones: real.smsMaskPhones, smsEstimate: real.smsEstimate, smsDestinationCheck: real.smsDestinationCheck, smsSendOutcome: real.smsSendOutcome,
    smsLogRecord: async (env, r) => { rec.logs.push(r); return { ok: true }; },
    smsReportRegionBlocked: async (env, rowId, check) => { rec.reports.push({ where: 'sms_destination_region', rowId, check }); },
    reportFailure: async (env, o) => { rec.reports.push(o); },
    invalidateTabCache: () => {},
  };
  return Object.assign(deps, over && over.extra, { __rec: rec });
}
// For a harness that runs the real processQuietHoursQueue / releaseMessageQueue: builds mqSendQueuedRow + mqStuckSending on top of the harness's own
// updateMessageQueueRow / sendSMSRaw stubs. Use:  Object.assign(deps, d16Deps(), d16Queue(deps))
export function d16Queue(deps) {
  const d = d16Real();
  const need = Object.assign({ mqReportFailure: async () => {}, reportFailure: async () => {}, smsReportRegionBlocked: async () => {} }, { smsMaskPhones: d.smsMaskPhones, smsSendOutcome: d.smsSendOutcome, smsDestinationCheck: d.smsDestinationCheck }, deps);
  const names = ['updateMessageQueueRow', 'sendSMSRaw', 'smsMaskPhones', 'smsSendOutcome', 'smsDestinationCheck', 'smsReportRegionBlocked', 'reportFailure', 'mqReportFailure'];
  const fns = new Function(...names, D16_QUEUED + '\nreturn { mqSendQueuedRow, mqStuckSending };')(...names.map(k => need[k]));
  return Object.assign({ mqReportFailure: need.mqReportFailure }, fns);
}
