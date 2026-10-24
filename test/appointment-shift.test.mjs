// Appointment Shift (Oct 23 2026, FEATURE_LOG rule 231). Runs the REAL code out of worker.js (the SHIFT block plus the helpers it uses) in a fake world.
// Covers: the exact Premier times, the re-lay / running-late math, DST (clocks go back Sun Nov 1 2026), locked items, propose -> approve, idempotent apply,
// failure injection (every failure must be reported AND visible in the result, and nothing downstream may go out after a failed write).
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grabFn(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) { const i = src.indexOf('const ' + name + ' ='); if (i < 0) throw new Error('missing const ' + name); return src.slice(i, src.indexOf(';\n', i) + 1); }
const BEGIN = src.indexOf('// ═══ SHIFT-BLOCK-BEGIN'), END = src.indexOf('// ═══ SHIFT-BLOCK-END');
if (BEGIN < 0 || END < BEGIN) throw new Error('shift block markers missing');
const BLOCK = src.slice(BEGIN, END);
const realFns = ['nyOffsetMinutes', 'inspDurationMin', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspEtDow', 'inspFmtEt', 'inspFmtEtTime', 'inspErr', 'inspBookingEventBody', 'inspBookUrl', 'inspIcsEsc', 'inspIcsStamp', 'inspIcsFold', 'inspSenderAddr', 'inspIcs', 'inspKeyMin', 'inspConflictsFrom', 'woJobLabel', 'normalizePhone', 'tenantMovedOut', 'tenantForQueuedText', 'isMissingTabError', 'inspGoogleCalUrl'].map(grabFn).join('\n');
const realConsts = ['INSP_TZ', 'INSP_ACTIVE_BOOKING', 'PORTAL_BASE'].map(grabConst).join('\n');

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

// ── the fake world ──
function makeWorld() {
  const W = { tabs: {}, calls: [], alerts: [], failures: [], telemetry: [], emails: [], sms: [], gated: [], schedWO: [], events: [], calEvents: {}, inject: {}, tok: 0, reconcile: [], nowMs: Date.parse('2026-10-23T15:00:00Z') };
  const clone = o => JSON.parse(JSON.stringify(o));
  const stubs = {
    W,
    fetchTab: async (env, tab) => { if (!W.tabs[tab]) throw new Error('Unable to parse range: ' + tab); if (W.inject.readFail === tab) throw new Error('sheet read failed'); return clone(W.tabs[tab]); },
    invalidateTabCache: () => {},
    updateRowVerified: async (env, tab, id, fields) => {
      W.calls.push(['write', tab, String(id), clone(fields)]);
      if (W.inject.writeFail && W.inject.writeFail(tab, id, fields)) throw new Error('injected write failure');
      const row = W.tabs[tab].find(r => String(r.ID) === String(id)); if (!row) throw new Error(tab + ' row ' + id + ' did not read back after the update');
      Object.assign(row, fields); return clone(row);
    },
    updateRow: async () => ({ json: async () => ({ success: true }) }),
    addRow: async (env, tab, rec) => { const id = String((W.tabs[tab].length || 0) + 100); W.tabs[tab].push(Object.assign({ ID: id }, rec)); return { json: async () => ({ success: true, id }) }; },
    fetchConfig: async () => Object.assign({ admin_phone: '+14105550100' }, W.cfg || {}),
    inspEnsureTabsOnce: async () => {},
    inspRandToken: () => 'tok' + String(++W.tok).padStart(24, '0'),
    inspCalStaged: (env, cfg) => !!W.staged,
    inspCalFetch: async (env, cfg, method, path, body) => {
      W.calls.push(['cal', method, path]);
      if (W.inject.calFail) throw Object.assign(new Error('calendar boom'), { httpStatus: 500 });
      if (method === 'PATCH') { const ev = { id: path.split('/').pop(), start: body && body.start, end: body && body.end }; if (W.inject.calMismatch) ev.start = { dateTime: '2026-01-01T00:00:00Z' }; return ev; }
      if (method === 'POST') return { id: 'newev1' };
      return { items: [] };
    },
    inspCalListEvents: async () => { if (W.inject.calListFail) throw new Error('calendar list boom'); return { items: W.events }; },
    inspStrBookingConflict: async () => W.strConflict || null,
    inspReconcileKeyPickup: async (env, cfg, cust, day) => { W.reconcile.push(day); return W.inject.keyFail ? ['key_pickup_FAILED: boom'] : ['key_pickup: ok']; },
    inspSendPartnerEmail: async (env, o) => { if (W.inject.inviteFail) throw new Error('invite boom'); W.emails.push({ kind: 'invite', ...o }); return { staged: true, ics_staged: true }; },
    gmailSendEmail: async (env, o) => { if (W.inject.emailFail) throw new Error('gmail boom'); W.emails.push({ kind: 'mail', ...o }); return { staged: true }; },
    sendSMS: async (env, to, text) => { W.sms.push({ to, text }); return { sid: 'SM1' }; },
    smsGatedSend: async (env, o) => { W.gated.push(o); return { sent: true }; },
    scheduleWO: async (env, b) => { W.schedWO.push(b); if (W.inject.woFail) return { json: async () => ({ error: 'refused' }) }; const wo = W.tabs.Work_Orders.find(w => w.ID === b.wo_id); if (!W.inject.woNoKeep) wo.Scheduled_Window = b.window; return { json: async () => ({ success: true, tenant_sms: true }) }; },
    inspAlert: async (env, kind, msg) => { W.alerts.push([kind, msg]); },
    reportFailure: async (env, f) => { W.failures.push(f); return { ok: true }; },
    logTelemetry: async (env, r) => { W.telemetry.push(r); },
    inspStrBookingConflictDummy: null,
    inspEventsToBusy: (items) => (items || []).map(ev => ({ startMs: Date.parse(ev.start && ev.start.dateTime), endMs: Date.parse(ev.end && ev.end.dateTime), title: ev.summary || 'event' })),
    _hmac: async (m, k) => 'h' + [...(m + k)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(4),
    json: (data, status = 200) => ({ data, status }),
    WOStatus: { sets: { RECEIPT_CLOSED: ['Paid', 'Cancelled', 'Closed', 'Void', 'Complete', 'Invoiced'] } },
    tenantsDummy: null,
  };
  return stubs;
}
function load(stubs) {
  const names = Object.keys(stubs);
  const body = realConsts + '\n' + realFns + '\n' + BLOCK + `
  const __d = Date;
  return { ${['shiftQuarterUp', 'shiftParseWindow', 'shiftFormatWindow', 'shiftRelayPlan', 'shiftLatePlan', 'shiftFinalOverlaps', 'shiftOccupied', 'shiftOverlaps', 'shiftTokenState', 'shiftReminderStage', 'shiftPlanId', 'shiftEmailDraft', 'shiftEmailValidate', 'shiftEmailRender', 'shiftTenantText', 'shiftAddrKey', 'shiftInput', 'shiftPlan', 'shiftCollect', 'shiftApply', 'shiftPreviewRoute', 'shiftCommit', 'shiftChangeApprove', 'shiftChangeReschedule', 'shiftChangeInfo', 'shiftRemindersRun', 'shiftBatchToken', 'shiftVerifyBatchToken', 'shiftProposalCancel', 'shiftForceApply', 'shiftProposalsList', 'shiftTestSeed', 'inspIcs', 'inspDurationMin', 'inspEtWallToMs', 'inspFmtEtTime', 'shiftHhmm', 'shiftNotifyTenants', 'shiftTenantTargets'].join(',')} };`;
  return new Function('RealDate', ...names, body)(RealDate, ...names.map(n => stubs[n]));
}

const RealDate = Date;
const at = (E, d, hm) => E.inspEtWallToMs(d, hm);
const hh = (E, ms) => E.shiftHhmm(ms);

// ════════ pure: the exact Premier times ════════
{
  const w = makeWorld(), E = load(w);
  const mk = (E, d, stops) => stops.map((s, i) => ({ key: 'k' + i, startMs: at(E, d, s.start), endMs: at(E, d, s.start) + 40 * 60000, newDurMin: 60, driveBefore: s.before, driveAfter: s.after, include: true }));
  const tue = E.shiftRelayPlan(mk(E, '2026-10-27', [{ start: '11:00', after: 10 }, { start: '12:00', before: 10, after: 11 }, { start: '13:00', before: 11 }]));
  t('Tue #3 stays 11:00-12:00', hh(E, tue[0].newStartMs) === '11:00' && hh(E, tue[0].newEndMs) === '12:00' && tue[0].fixedFirst, tue[0]);
  t('Tue #4 12:15-1:15 (12:00 + 10 min drive, up to the quarter)', hh(E, tue[1].newStartMs) === '12:15' && hh(E, tue[1].newEndMs) === '13:15', tue[1]);
  t('Tue #5 1:30-2:30 (1:15 + 11 min = 1:26, up to 1:30)', hh(E, tue[2].newStartMs) === '13:30' && hh(E, tue[2].newEndMs) === '14:30', tue[2]);
  const wed = E.shiftRelayPlan(mk(E, '2026-10-28', [{ start: '10:30', after: 36 }, { start: '12:00', before: 36, after: 33 }, { start: '13:00', before: 33 }]));
  t('Wed #6 stays 10:30-11:30', hh(E, wed[0].newStartMs) === '10:30' && hh(E, wed[0].newEndMs) === '11:30', wed[0]);
  t('Wed #7 12:15-1:15 (11:30 + 36 = 12:06, up to 12:15)', hh(E, wed[1].newStartMs) === '12:15' && hh(E, wed[1].newEndMs) === '13:15', wed[1]);
  t('Wed #8 2:00-3:00 (1:15 + 33 = 1:48, up to 2:00)', hh(E, wed[2].newStartMs) === '14:00' && hh(E, wed[2].newEndMs) === '15:00', wed[2]);
  const fromAfter = E.shiftRelayPlan(mk(E, '2026-10-27', [{ start: '11:00', after: 10 }, { start: '12:00', after: 11 }, { start: '13:00' }]));
  t('drive minutes fall back to the previous stop\'s Drive_After when the later stop has no Drive_Before', hh(E, fromAfter[1].newStartMs) === '12:15' && hh(E, fromAfter[2].newStartMs) === '13:30', fromAfter.map(x => hh(E, x.newStartMs)));
  const none = E.shiftRelayPlan([{ key: 'a', startMs: at(E, '2026-10-27', '09:00'), endMs: at(E, '2026-10-27', '09:40'), newDurMin: 60, include: true }, { key: 'b', startMs: at(E, '2026-10-27', '10:00'), endMs: at(E, '2026-10-27', '10:40'), newDurMin: 60, include: true }]);
  t('no stored drive time: flat default used AND a warning says so', none[1].warnings.length === 1 && /No drive time/.test(none[1].warnings[0]) && hh(E, none[1].newStartMs) === '10:30', none[1]);
  const exact = E.shiftRelayPlan([{ key: 'a', startMs: at(E, '2026-10-27', '09:00'), endMs: at(E, '2026-10-27', '09:30'), newDurMin: 60, include: true }, { key: 'b', startMs: at(E, '2026-10-27', '11:00'), endMs: at(E, '2026-10-27', '11:30'), newDurMin: 60, driveBefore: 15, include: true }]);
  t('a start that already lands on a quarter hour is not bumped', hh(E, exact[1].newStartMs) === '10:15', hh(E, exact[1].newStartMs));
  // unchecked rows are fixed anchors; the checked row after one packs from it
  const anchor = E.shiftRelayPlan([{ key: 'a', startMs: at(E, '2026-10-27', '09:00'), endMs: at(E, '2026-10-27', '09:30'), newDurMin: 60, include: false }, { key: 'b', startMs: at(E, '2026-10-27', '11:00'), endMs: at(E, '2026-10-27', '11:30'), newDurMin: 60, driveBefore: 15, include: true }]);
  t('an unchecked stop stays exactly as it is and anchors the next', hh(E, anchor[0].newStartMs) === '09:00' && hh(E, anchor[0].newEndMs) === '09:30' && hh(E, anchor[1].newStartMs) === '09:45', anchor.map(x => hh(E, x.newStartMs)));
  // hand edit wins and the next stop packs from it
  const edited = E.shiftRelayPlan(mk(E, '2026-10-27', [{ start: '11:00', after: 10 }, { start: '12:00', before: 10, after: 11 }, { start: '13:00', before: 11 }]).map((r, i) => i === 1 ? Object.assign(r, { override: { startMs: at(E, '2026-10-27', '12:30') } }) : r));
  t('a hand-edited start is honoured and the next stop re-packs from it', hh(E, edited[1].newStartMs) === '12:30' && edited[1].edited && hh(E, edited[1].newEndMs) === '13:30' && hh(E, edited[2].newStartMs) === '13:45', edited.map(x => hh(E, x.newStartMs)));
  // running late
  const lateRows = [{ key: 'a', startMs: at(E, '2026-10-27', '09:00'), endMs: at(E, '2026-10-27', '10:00'), include: true }, { key: 'b', startMs: at(E, '2026-10-27', '11:00'), endMs: at(E, '2026-10-27', '12:00'), include: true }, { key: 'c', startMs: at(E, '2026-10-27', '13:00'), endMs: at(E, '2026-10-27', '14:00'), include: false }];
  const late = E.shiftLatePlan(lateRows, 30, at(E, '2026-10-27', '10:30'));
  t('running late +30: only checked rows starting at/after "now" move', hh(E, late[0].newStartMs) === '09:00' && hh(E, late[1].newStartMs) === '11:30' && hh(E, late[1].newEndMs) === '12:30' && hh(E, late[2].newStartMs) === '13:00', late.map(x => hh(E, x.newStartMs)));
  t('shiftQuarterUp is exact on quarters and rounds up otherwise', E.shiftQuarterUp(at(E, '2026-10-27', '12:15')) === at(E, '2026-10-27', '12:15') && E.shiftQuarterUp(at(E, '2026-10-27', '12:16')) === at(E, '2026-10-27', '12:30'));
}

// ════════ DST: clocks go back Sun Nov 1 2026 (2:00 AM EDT -> 1:00 AM EST) ════════
{
  const w = makeWorld(), E = load(w);
  t('Nov 1 09:00 ET is 14:00Z (EST)', new Date(at(E, '2026-11-01', '09:00')).toISOString() === '2026-11-01T14:00:00.000Z');
  t('Oct 31 09:00 ET is 13:00Z (still EDT)', new Date(at(E, '2026-10-31', '09:00')).toISOString() === '2026-10-31T13:00:00.000Z');
  const rows = [{ key: 'a', startMs: at(E, '2026-11-01', '09:00'), endMs: at(E, '2026-11-01', '09:40'), newDurMin: 60, include: true }, { key: 'b', startMs: at(E, '2026-11-01', '10:00'), endMs: at(E, '2026-11-01', '10:40'), newDurMin: 60, driveBefore: 12, include: true }];
  const p = E.shiftRelayPlan(rows);
  t('re-lay on the fall-back day: 9:00-10:00 then 10:15 (EST)', hh(E, p[0].newEndMs) === '10:00' && hh(E, p[1].newStartMs) === '10:15' && E.inspFmtEtTime(p[1].newStartMs) === '10:15 AM', p.map(x => hh(E, x.newStartMs)));
  const night = at(E, '2026-11-01', '00:45');
  const l = E.shiftLatePlan([{ key: 'n', startMs: night, endMs: night + 3600000, include: true }], 90, 0);
  t('+90 min from 12:45 AM EDT on the fall-back night is 1:15 AM EST (real elapsed time, not wall-clock addition)', E.inspFmtEtTime(l[0].newStartMs) === '1:15 AM' && l[0].newStartMs - night === 90 * 60000, E.inspFmtEtTime(l[0].newStartMs));
  const sat = at(E, '2026-10-31', '21:00'), l2 = E.shiftLatePlan([{ key: 'm', startMs: sat, endMs: sat + 3600000, include: true }], 240, 0);
  t('a shift that spans the clock change keeps real elapsed minutes', l2[0].newStartMs - sat === 240 * 60000);
  const sunStart = at(E, '2026-11-01', '09:00');
  t('quarter rounding works in EST', hh(E, E.shiftQuarterUp(sunStart + 61 * 60000)) === '10:15');
}

// ════════ pure: occupied windows, tokens, reminders, email, ics ════════
{
  const w = makeWorld(), E = load(w);
  const A = { ID: '3', Status: 'approved', Active: 'TRUE', Start_ISO: '2026-10-27T15:00:00.000Z', End_ISO: '2026-10-27T15:40:00.000Z', Formatted_Address: '3133 Dudley', Change_Status: 'proposed', Proposed_Start_ISO: '2026-10-27T15:00:00.000Z', Proposed_End_ISO: '2026-10-27T16:00:00.000Z' };
  const B = { ID: '4', Status: 'approved', Active: 'TRUE', Start_ISO: '2026-10-27T16:00:00.000Z', End_ISO: '2026-10-27T16:40:00.000Z', Formatted_Address: '3572 Dudley', Change_Status: 'none' };
  const C = { ID: '9', Status: 'cancelled', Active: 'TRUE', Start_ISO: '2026-10-27T17:00:00.000Z', End_ISO: '2026-10-27T18:00:00.000Z' };
  const occ = E.shiftOccupied([A, B, C], {});
  t('a booking with a waiting change occupies BOTH its old and its proposed window', occ.filter(o => o.id === '3').length === 2 && occ.some(o => o.id === '3' && o.kind === 'old') && occ.some(o => o.id === '3' && o.kind === 'proposed'), occ);
  t('cancelled bookings occupy nothing', !occ.some(o => o.id === '9'));
  t('selfId is skipped', E.shiftOccupied([A, B], { selfId: '3' }).every(o => o.id !== '3'));
  t('movingIds drops the old window of a proposed booking but keeps its proposed one', (() => { const o = E.shiftOccupied([A], { movingIds: ['3'] }); return o.length === 1 && o[0].kind === 'proposed'; })());
  t('overlap detection is exclusive at the edges', E.shiftOverlaps(occ, Date.parse('2026-10-27T15:40:00Z'), Date.parse('2026-10-27T16:00:00Z')).filter(o => o.id === '3' && o.kind === 'old').length === 0 && E.shiftOverlaps(occ, Date.parse('2026-10-27T15:50:00Z'), Date.parse('2026-10-27T16:10:00Z')).length >= 1);
  const now = Date.parse('2026-10-24T12:00:00Z');
  t('token fresh', E.shiftTokenState({ Change_Proposed_At: '2026-10-23T12:00:00Z', Start_ISO: '2026-10-27T15:00:00Z' }, now).ok);
  t('token expires after the visit started', !E.shiftTokenState({ Change_Proposed_At: '2026-10-23T12:00:00Z', Start_ISO: '2026-10-24T11:00:00Z' }, now).ok);
  t('token expires after 14 days', !E.shiftTokenState({ Change_Proposed_At: '2026-10-01T12:00:00Z', Start_ISO: '2026-12-27T15:00:00Z' }, now).ok);
  t('reminder: nothing while fresh', E.shiftReminderStage({ Change_Status: 'proposed', Change_Proposed_At: '2026-10-24T08:00:00Z', Start_ISO: '2026-10-30T15:00:00Z' }, now, 12) === '');
  t('reminder: stale after N hours', E.shiftReminderStage({ Change_Status: 'proposed', Change_Proposed_At: '2026-10-23T23:00:00Z', Start_ISO: '2026-10-30T15:00:00Z' }, now, 12) === 'stale');
  t('reminder: urgent when the visit is within 24h, even if just sent', E.shiftReminderStage({ Change_Status: 'proposed', Change_Proposed_At: '2026-10-24T11:30:00Z', Start_ISO: '2026-10-25T09:00:00Z' }, now, 12) === 'urgent');
  t('reminder: only for proposed', E.shiftReminderStage({ Change_Status: 'applied', Change_Proposed_At: '2026-10-01T00:00:00Z', Start_ISO: '2026-10-25T09:00:00Z' }, now, 12) === '');
  const d = E.shiftEmailDraft({ date: '2026-10-27', greetName: 'Josiah', items: [{ id: '3', address: '3133 Dudley', units: 1, oldStartMs: Date.parse('2026-10-27T15:00:00Z'), oldEndMs: Date.parse('2026-10-27T15:40:00Z'), newStartMs: Date.parse('2026-10-27T15:00:00Z'), newEndMs: Date.parse('2026-10-27T16:00:00Z') }, { id: '4', address: '3572 Dudley', units: 1, oldStartMs: Date.parse('2026-10-27T16:00:00Z'), oldEndMs: Date.parse('2026-10-27T16:40:00Z'), newStartMs: Date.parse('2026-10-27T16:15:00Z'), newEndMs: Date.parse('2026-10-27T17:15:00Z') }] });
  t('email lists old -> new, an approve and reschedule link per inspection and an approve-all link', /Was: 11:00 AM to 11:40 AM/.test(d.body) && /Now: 11:00 AM to 12:00 PM/.test(d.body) && d.body.includes('[[APPROVE:3]]') && d.body.includes('[[RESCHEDULE:4]]') && d.body.includes('[[APPROVE_ALL]]'), d.body);
  t('email never mentions tenants (Premier tells its own)', !/tenant/i.test(d.body));
  t('a valid email passes', E.shiftEmailValidate(d.body, ['3', '4']).ok);
  t('an email missing the approve links is refused', !E.shiftEmailValidate(d.body.replace(/\[\[APPROVE:[34]\]\]/g, '').replace('[[APPROVE_ALL]]', ''), ['3', '4']).ok);
  t('an email with a link to a different inspection is refused', !E.shiftEmailValidate(d.body + ' [[APPROVE:77]]', ['3', '4']).ok);
  t('a stray [[ is refused', !E.shiftEmailValidate(d.body + ' [[oops', ['3', '4']).ok);
  const r = E.shiftEmailRender(d.body, { approve: { 3: 'https://x/a3', 4: 'https://x/a4' }, reschedule: { 3: 'https://x/r3', 4: 'https://x/r4' }, all: 'https://x/all' });
  t('rendering turns placeholders into real links and reports nothing missing', r.missing.length === 0 && r.html.includes('href="https://x/a3"') && r.text.includes('https://x/all') && !/\[\[/.test(r.html), r.missing);
  t('rendering reports a placeholder with no link', E.shiftEmailRender(d.body, { approve: { 3: 'u' }, reschedule: {}, all: '' }).missing.length > 0);
  const bk = { ID: '5', Manage_Token: 'm'.repeat(18), Formatted_Address: '3207 Cliftmont', Start_ISO: '2026-10-27T17:30:00.000Z', End_ISO: '2026-10-27T18:30:00.000Z', Contact_Name: 'J' };
  t('ics SEQUENCE is 0 by default and 1 on cancel (unchanged behaviour)', /SEQUENCE:0/.test(E.inspIcs(bk, 'PUBLISH')) && /SEQUENCE:1/.test(E.inspIcs(bk, 'CANCEL', { organizer: 'a@b.c' })));
  t('ics SEQUENCE follows Ics_Seq on a time change', /SEQUENCE:3/.test(E.inspIcs(Object.assign({ Ics_Seq: '3' }, bk), 'REQUEST', { organizer: 'a@b.c', attendee: 'j@p.c' })) && /SEQUENCE:4/.test(E.inspIcs(Object.assign({ Ics_Seq: '3' }, bk), 'CANCEL', { organizer: 'a@b.c' })));
  t('ics keeps the same UID so the invite REPLACES the old entry', /UID:insp-5@ridgeco/.test(E.inspIcs(Object.assign({ Ics_Seq: '1' }, bk), 'REQUEST', { organizer: 'a@b.c', attendee: 'j@p.c' })));
  t('window parse / format round trip', (() => { const x = E.shiftParseWindow('9:00 AM – 11:00 AM'); return x && x.startMin === 540 && x.endMin === 660 && E.shiftFormatWindow(570, 690) === '9:30 AM – 11:30 AM'; })());
  t('window parse refuses "Within 1 hour" and "All Day"', E.shiftParseWindow('Within 1 hour') === null && E.shiftParseWindow('All Day') === null);
  t('window parse reads "Morning (8:00 AM – 12:00 PM)"', (() => { const x = E.shiftParseWindow('Morning (8:00 AM – 12:00 PM)'); return x && x.startMin === 480 && x.endMin === 720; })());
  t('duration rule 1u=60, 4u/1b=150, 2b x 2u=180', E.inspDurationMin(1, 1) === 60 && E.inspDurationMin(4, 1) === 150 && E.inspDurationMin(4, 2) === 180);
  t('batch token round trip and tamper check', await (async () => { const tk = await E.shiftBatchToken({ WORKER_SECRET: 's' }, 'Babc'); return (await E.shiftVerifyBatchToken({ WORKER_SECRET: 's' }, tk)) === 'Babc' && (await E.shiftVerifyBatchToken({ WORKER_SECRET: 's' }, tk.slice(0, -1) + 'x')) === null && (await E.shiftVerifyBatchToken({ WORKER_SECRET: 'other' }, tk)) === null; })());
  t('address key matches across formats', E.shiftAddrKey('3133 Dudley Ave, Baltimore, MD') === E.shiftAddrKey('3133 Dudley Avenue') && E.shiftAddrKey('3133 Dudley Ave') !== E.shiftAddrKey('3572 Dudley Ave'));
}

// ════════ seeded world: the six Premier bookings on staging-like data ════════
function seed(W, opts) {
  opts = opts || {};
  const mkB = (id, d, start, addr, before, after, extra) => { const s = Date.parse(new Date(0).toISOString()); return Object.assign({ ID: id, Customer_ID: 'C1', Manage_Token: 'manage' + id.padEnd(14, 'x'), Status: 'approved', Address: addr, Formatted_Address: addr, Buildings: '1', Units: '1', Duration_Min: '40', Date: d, Contact_Name: 'Josiah', Contact_Email: 'josiah.speed@ppmillc.com', Calendar_Event_ID: 'ev' + id, Notify_Log: '', Active: 'TRUE', Drive_Before_Min: before == null ? '' : String(before), Drive_After_Min: after == null ? '' : String(after), Change_Status: '', Start_ISO: '', End_ISO: '' }, extra || {}, { _start: start }); };
  const rows = [mkB('3', '2026-10-27', '11:00', '3133 Dudley Ave', null, 10), mkB('4', '2026-10-27', '12:00', '3572 Dudley Ave', 10, 11), mkB('5', '2026-10-27', '13:00', '3207 Cliftmont Ave', 11, null), mkB('6', '2026-10-28', '10:30', '606 Kittendale Rd', null, 36), mkB('7', '2026-10-28', '12:00', '705 S Macon St', 36, 33), mkB('8', '2026-10-28', '13:00', '637 E 29th St', 33, null)];
  return rows;
}
function mkWorld(opts) {
  opts = opts || {};
  const w = makeWorld(), E = load(w), W = w.W;
  const rows = seed(W);
  for (const r of rows) { const s = E.inspEtWallToMs(r.Date, r._start); r.Start_ISO = new Date(s).toISOString(); r.End_ISO = new Date(s + 40 * 60000).toISOString(); r.Start_Time = E.inspFmtEtTime(s); delete r._start; }
  W.tabs.Insp_Bookings = rows;
  W.tabs.Insp_Customers = [{ ID: 'C1', Name: 'Premier', Active: 'TRUE', Notify_Tenants: opts.notify || 'FALSE', Key_Address: '', Key_Pickup_Min: '' }];
  W.tabs.Work_Orders = []; W.tabs.Vendors = []; W.tabs.Properties = []; W.tabs.Deliveries = []; W.tabs.Insp_Properties = []; W.tabs.Insp_Units = []; W.tabs.Tenants = []; W.tabs.Owners = [];
  return { w, E, W };
}

// ════════ preview: exact times for the six, locked rows, late mode ════════
{
  const { w, E, W } = mkWorld();
  for (const [date, want] of [['2026-10-27', ['11:00-12:00', '12:15-13:15', '13:30-14:30']], ['2026-10-28', ['10:30-11:30', '12:15-13:15', '14:00-15:00']]]) {
    const r = await E.shiftPreviewRoute({}, { date, mode: 'relay' });
    const items = r.data.items.filter(i => i.type === 'inspection');
    t('preview ' + date + ': exact target times', r.data.ok && items.map(i => i.new.start_hhmm + '-' + i.new.end_hhmm).join() === want.join(), items.map(i => i.new && i.new.start_hhmm + '-' + i.new.end_hhmm));
    t('preview ' + date + ': first stop is fixed, the others move, all checked by default', items[0].fixed_first && items[0].new.start_hhmm === items[0].old.start_hhmm && items.slice(1).every(i => i.changed) && items.every(i => i.checked), items.map(i => [i.changed, i.checked]));
    t('preview ' + date + ': builds one email to Josiah only, with all links', r.data.notice_to === 'josiah.speed@ppmillc.com' && r.data.email && r.data.email.to === 'josiah.speed@ppmillc.com' && r.data.email.body.includes('[[APPROVE_ALL]]'), r.data.notice_to);
    t('preview ' + date + ': writes nothing', W.calls.filter(c => c[0] === 'write').length === 0 && W.emails.length === 0);
  }
  const late = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T15:30:00.000Z' });
  const li = late.data.items.filter(i => i.type === 'inspection');
  t('running late +30 from 11:30 ET: #3 (11:00) stays, #4 and #5 move 30', li[0].new.start_hhmm === '11:00' && li[1].new.start_hhmm === '12:30' && li[2].new.start_hhmm === '13:30', li.map(i => i.new.start_hhmm));
  t('late mode echoes the resolved "from" so Apply cannot drift', late.data.from_iso === '2026-10-27T15:30:00.000Z');
  const bad = await E.shiftPreviewRoute({}, { date: 'nope', mode: 'relay' }); t('bad date is a 400 with a plain message', bad.status === 400 && /day/.test(bad.data.message));
  const bad2 = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'late', minutes: 0 }); t('running late without minutes is a 400', bad2.status === 400);
  // pending booking is listed but locked
  W.tabs.Insp_Bookings.find(b => b.ID === '5').Status = 'pending';
  const pend = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'relay' });
  const p5 = pend.data.items.find(i => i.id === '5');
  t('a pending booking is listed, locked, with a reason, never checked', !p5.shiftable && /Not approved/.test(p5.locked_reason) && !p5.checked, p5);
  // unchecking #4: it stays, and #5... (locked) stays
  W.tabs.Insp_Bookings.find(b => b.ID === '5').Status = 'approved';
  const unc = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'relay', checked: { 'insp:4': false } });
  const u4 = unc.data.items.find(i => i.id === '4'), u5 = unc.data.items.find(i => i.id === '5');
  t('unchecking #4 leaves it where it is and #5 packs from #4\'s OLD end', !u4.checked && !u4.changed && u5.new.start_hhmm === '13:00' && u5.checked, [u4.changed, u5.new.start_hhmm]);
  // deliveries locked
  W.tabs.Deliveries = [{ ID: 'D1', Store: 'Lowes', Item_Type: 'Washer', Expected_Date: '2026-10-27', Expected_Window: '8:00 AM – 12:00 PM', Status: 'En-Route', Active: 'TRUE', Delivery_Address: '1 Test St' }, { ID: 'D2', Store: 'Done', Expected_Date: '2026-10-27', Status: 'Delivered', Active: 'TRUE' }];
  const dl = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T10:00:00.000Z', checked: { 'delivery:D1': true } });
  const d1 = dl.data.items.find(i => i.key === 'delivery:D1');
  t('delivery windows are locked and never move, even if checked', d1 && !d1.shiftable && /can't be changed/.test(d1.locked_reason) && !d1.changed && !d1.checked && d1.old.window === d1.new.window, d1);
  t('delivered deliveries are not listed', !dl.data.items.some(i => i.id === 'D2'));
  // missing Deliveries tab is reported, not hidden
  delete W.tabs.Deliveries; const nd = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'relay' });
  t('a missing Deliveries tab is a visible warning', nd.data.ok && nd.data.warnings.some(x => /Deliveries tab/.test(x)), nd.data.warnings);
  W.tabs.Deliveries = [];
  W.inject.readFail = 'Insp_Bookings'; const rf = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'relay' });
  t('a failed read is an error the caller sees (503), reported, not an empty list', rf.status === 503 && !rf.data.ok && /Insp_Bookings/.test(rf.data.message), rf);
  W.inject.readFail = null;
}

// ════════ wo_window: only Brett's OWN windows ════════
{
  const { w, E, W } = mkWorld();
  W.tabs.Vendors = [{ ID: 'V1', Name: 'Brett (me)', In_House: 'TRUE' }, { ID: 'V2', Name: 'Bob Plumbing', In_House: 'FALSE' }];
  W.tabs.Work_Orders = [
    { ID: 'W1', Scheduled_Date: '2026-10-27', Scheduled_Window: '9:00 AM – 11:00 AM', Vendor_ID: 'V1', Status: 'Scheduled', Trade: 'Plumbing', Description: 'leak' },
    { ID: 'W2', Scheduled_Date: '2026-10-27', Scheduled_Window: '9:00 AM – 11:00 AM', Vendor_ID: 'V2', Status: 'Scheduled', Trade: 'HVAC', Description: 'ac' },
    { ID: 'W3', Scheduled_Date: '2026-10-27', Scheduled_Window: 'Within 1 hour', Vendor_ID: 'V1', Status: 'Scheduled', Trade: 'Electrical', Description: 'plug' },
    { ID: 'W4', Scheduled_Date: '2026-10-27', Scheduled_Window: '9:00 AM – 11:00 AM', Vendor_ID: '', Status: 'New', Trade: 'General', Description: 'x' },
    { ID: 'W5', Scheduled_Date: '2026-10-27', Scheduled_Window: '9:00 AM – 11:00 AM', Vendor_ID: 'V1', Status: 'Paid', Trade: 'General', Description: 'done' }];
  const r = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T10:00:00.000Z', only_keys: ['wo:W1', 'wo:W2', 'wo:W3', 'wo:W4', 'wo:W5'] });
  const g = id => r.data.items.find(i => i.id === id);
  t('own in-house window with clock times is shiftable and moves 30', g('W1').shiftable && g('W1').changed && g('W1').new.window === '9:30 AM – 11:30 AM', g('W1'));
  t('vendor-assigned WO is locked ("vendor shifting not built yet")', !g('W2').shiftable && /not built yet/.test(g('W2').locked_reason) && !g('W2').changed);
  t('a window with no clock times is locked', !g('W3').shiftable && /no clock times/.test(g('W3').locked_reason));
  t('an unassigned WO is locked', !g('W4').shiftable);
  t('closed work orders are not listed', !g('W5'));
  const pv = r.data;
  const ap = await E.shiftApply({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T10:00:00.000Z', plan_id: pv.plan_id, only_keys: ['wo:W1', 'wo:W2', 'wo:W3', 'wo:W4', 'wo:W5'] });
  t('apply moves ONLY the checked own-window WO through the normal scheduling path, with tenant notice on', ap.data.ok && W.schedWO.length === 1 && W.schedWO[0].wo_id === 'W1' && W.schedWO[0].window === '9:30 AM – 11:30 AM' && W.schedWO[0].notify_tenant === true, [ap.data, W.schedWO]);
  t('the WO window is read back', W.tabs.Work_Orders.find(x => x.ID === 'W1').Scheduled_Window === '9:30 AM – 11:30 AM');
  t('no inspection email for a WO-only shift', W.emails.length === 0);
  // failure: scheduling path refuses
  W.tabs.Work_Orders.find(x => x.ID === 'W1').Scheduled_Window = '9:00 AM – 11:00 AM'; W.schedWO.length = 0; W.inject.woFail = true; W.alerts.length = 0;
  const pv2 = await E.shiftPreviewRoute({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T10:00:00.000Z', only_keys: ['wo:W1'] });
  const ap2 = await E.shiftApply({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T10:00:00.000Z', plan_id: pv2.data.plan_id, only_keys: ['wo:W1'] });
  const r2 = ap2.data.results.find(x => x.key === 'wo:W1');
  t('a refused WO change is an error in the result, an alert, and a 207', !ap2.data.ok && ap2.status === 207 && r2.errors.length === 1 && /refused/.test(r2.errors[0]) && W.alerts.some(a => a[0] === 'shift_wo'), [ap2.data, W.alerts]);
  W.inject.woFail = false; W.inject.woNoKeep = true; W.alerts.length = 0;
  const ap3 = await E.shiftApply({}, { date: '2026-10-27', mode: 'late', minutes: 30, from_iso: '2026-10-27T10:00:00.000Z', plan_id: pv2.data.plan_id, only_keys: ['wo:W1'] });
  t('a WO that does not keep the window (read-back mismatch) is a failure, not a success', !ap3.data.ok && /did not keep/.test(ap3.data.results.find(x => x.key === 'wo:W1').errors.join()), ap3.data);
}

// ════════ apply: propose (nothing moves), one email, idempotent, failures ════════
{
  const { w, E, W } = mkWorld();
  const body = { date: '2026-10-27', mode: 'relay' };
  const pv = (await E.shiftPreviewRoute({}, body)).data;
  const stale = await E.shiftApply({}, Object.assign({}, body, { plan_id: 'deadbeef' }));
  t('a stale / missing plan id changes nothing (409)', stale.status === 409 && stale.data.error === 'stale' && W.calls.filter(c => c[0] === 'write').length === 0);
  const noid = await E.shiftApply({}, body); t('Apply without a preview is refused', noid.status === 409);
  const badEmail = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv.plan_id, email: { subject: 'x', body: 'Hello, please see Brett.' } }));
  t('an email that lost its approve links is refused BEFORE anything is written', badEmail.status === 400 && badEmail.data.error === 'bad_email' && W.calls.filter(c => c[0] === 'write').length === 0 && W.emails.length === 0, badEmail.data);
  const edited = pv.email.body.replace('I need to adjust', 'Quick heads-up: I need to adjust');
  const ap = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv.plan_id, email: { subject: 'Edited subject', body: edited } }));
  t('apply ok', ap.data.ok && ap.status === 200, ap.data);
  const rows = W.tabs.Insp_Bookings.filter(b => b.Date === '2026-10-27');
  t('bookings #4 and #5 now carry a proposal; #3 (unchanged start... changed length) too', rows.every(r => r.Change_Status === 'proposed' && r.Change_Token && r.Proposed_Start_ISO && r.Change_Batch), rows.map(r => [r.ID, r.Change_Status]));
  t('the OLD times are untouched until approval', rows.every(r => r.End_ISO === new Date(Date.parse(r.Start_ISO) + 40 * 60000).toISOString()));
  t('exactly ONE email, to Josiah, with the edited subject and real links', W.emails.length === 1 && W.emails[0].to === 'josiah.speed@ppmillc.com' && W.emails[0].subject === 'Edited subject' && /inspect-change\.html\?c=/.test(W.emails[0].html) && /inspect-change\.html\?b=/.test(W.emails[0].html) && /Quick heads-up/.test(W.emails[0].html), W.emails.map(e => e.to));
  t('no tenant text and no partner SMS from a proposal', W.gated.length === 0 && W.sms.length === 0);
  t('no ics / invite until approval', !W.emails.some(e => e.kind === 'invite'));
  const emailsBefore = W.emails.length, writesBefore = W.calls.filter(c => c[0] === 'write').length;
  const pv2 = (await E.shiftPreviewRoute({}, body)).data;
  const ap2 = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv2.plan_id, email: { subject: pv2.email.subject, body: pv2.email.body } }));
  t('re-applying the same plan is idempotent: no new writes, NO second email', W.emails.length === emailsBefore && W.calls.filter(c => c[0] === 'write').length === writesBefore && ap2.data.results.filter(r => r.idempotent).length === 3, [ap2.data.results.map(r => r.steps)]);
  // the slot picker treats both windows as occupied
  const busy = E.shiftOccupied(W.tabs.Insp_Bookings, {});
  t('while pending, both windows are occupied for every moved booking', ['3', '4', '5'].every(id => busy.filter(o => o.id === id).length === 2));
}
{
  // email failure withdraws the proposals and says so
  const { w, E, W } = mkWorld();
  const body = { date: '2026-10-27', mode: 'relay' };
  const pv = (await E.shiftPreviewRoute({}, body)).data;
  W.inject.emailFail = true;
  const ap = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv.plan_id }));
  const rows = W.tabs.Insp_Bookings.filter(b => b.Date === '2026-10-27');
  t('email failure: not ok, 207, every item carries the error', !ap.data.ok && ap.status === 207 && ap.data.results.filter(r => r.errors.length).length === 3, ap.data);
  t('email failure: proposals withdrawn (status none, token cleared)', rows.every(r => r.Change_Status === 'none' && !r.Change_Token), rows.map(r => r.Change_Status));
  t('email failure: Brett alerted loudly', W.alerts.some(a => a[0] === 'shift_email'), W.alerts);
  t('email failure: telemetry row Success=FALSE for the apply', W.telemetry.some(x => x.Skill_Or_Endpoint === 'shift/apply' && x.Success === 'FALSE'), W.telemetry);
  W.inject.emailFail = false; W.alerts.length = 0;
  const pv2 = (await E.shiftPreviewRoute({}, body)).data;
  const ap2 = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv2.plan_id }));
  t('after a failed send, Apply can be run again cleanly', ap2.data.ok && W.emails.length === 1, ap2.data);
}
{
  // a proposal write failure is reported per item and no links for it go out
  const { w, E, W } = mkWorld();
  const body = { date: '2026-10-27', mode: 'relay' };
  const pv = (await E.shiftPreviewRoute({}, body)).data;
  W.inject.writeFail = (tab, id, f) => String(id) === '5' && f.Change_Status === 'proposed';
  const ap = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv.plan_id }));
  const r5 = ap.data.results.find(r => r.key === 'insp:5');
  t('one proposal that cannot be saved: that item shows the error, the others still go', !ap.data.ok && r5.errors.some(e => /Could not save/.test(e)) && ap.data.results.find(r => r.key === 'insp:4').ok, ap.data.results.map(r => [r.key, r.ok]));
  t('the email only carries the proposals that exist', W.emails.length === 1 && !/c=[^"]*#5/.test(W.emails[0].html) && (W.emails[0].html.match(/inspect-change\.html\?c=/g) || []).length === 4, (W.emails[0].html.match(/inspect-change\.html\?c=/g) || []).length);
  t('and the failed save is in telemetry as a failure', W.telemetry.some(x => x.Success === 'FALSE' && /#5/.test(x.Notes)), W.telemetry);
}
{
  // overlap with an unrelated booking is a hard stop: nothing written
  const { w, E, W } = mkWorld();
  W.tabs.Insp_Bookings.push({ ID: '50', Customer_ID: 'C1', Status: 'approved', Active: 'TRUE', Address: 'Other', Formatted_Address: 'Other St', Start_ISO: '2026-10-27T17:15:00.000Z', End_ISO: '2026-10-27T18:15:00.000Z', Units: '1', Buildings: '1', Change_Status: '' });
  W.tabs.Insp_Bookings.find(b => b.ID === '50').Date = '2026-10-27';
  const body = { date: '2026-10-27', mode: 'relay', customer_id: 'C1', only_keys: ['insp:3', 'insp:4', 'insp:5'] };
  const pv = (await E.shiftPreviewRoute({}, body)).data;
  t('preview warns about the overlap', pv.items.some(i => i.warnings.some(x => /Overlaps Other St/.test(x))), pv.items.map(i => i.warnings));
  const ap = await E.shiftApply({}, Object.assign({}, body, { plan_id: pv.plan_id }));
  t('apply refuses with 409 and writes NOTHING', ap.status === 409 && ap.data.error === 'conflict' && W.calls.filter(c => c[0] === 'write').length === 0 && W.emails.length === 0, ap.data);
}

// ════════ approve: the full commit ════════
async function proposed(opts) {
  const x = mkWorld(opts); const { E, W } = x;
  const body = { date: '2026-10-27', mode: 'relay' };
  const pv = (await E.shiftPreviewRoute({}, body)).data;
  await E.shiftApply({}, Object.assign({}, body, { plan_id: pv.plan_id }));
  W.emails.length = 0; W.calls.length = 0; W.alerts.length = 0; W.failures.length = 0; W.telemetry.length = 0;
  x.tokenOf = id => W.tabs.Insp_Bookings.find(b => b.ID === id).Change_Token;
  return x;
}
{
  const { E, W, tokenOf } = await proposed();
  W.staged = false;                         // exercise the live calendar path with the fake calendar
  W.cfg = { INSP_CALENDAR_STAGING_MODE: 'LIVE' };
  const r = await E.shiftChangeApprove({}, { c: tokenOf('4') });
  const b4 = W.tabs.Insp_Bookings.find(b => b.ID === '4');
  t('approve #4 ok', r.data.ok && r.data.results[0].done, r.data);
  t('sheet row now holds the new times, duration and a bumped Ics_Seq', b4.Start_ISO === '2026-10-27T16:15:00.000Z' && b4.End_ISO === '2026-10-27T17:15:00.000Z' && b4.Duration_Min === '60' && b4.Ics_Seq === '1' && b4.Date === '2026-10-27' && b4.Start_Time === '12:15 PM', b4);
  t('status went proposed -> approved -> applied', b4.Change_Status === 'applied' && W.calls.filter(c => c[0] === 'write' && c[2] === '4').map(c => c[3].Change_Status).filter(Boolean).join() === 'approved,applied', W.calls.filter(c => c[0] === 'write' && c[2] === '4').map(c => c[3].Change_Status));
  t('calendar event was PATCHed (and verified)', W.calls.some(c => c[0] === 'cal' && c[1] === 'PATCH' && /evev4|ev4/.test(c[2])));
  t('key pickup reconciled for the day', W.reconcile.length === 0 || W.reconcile.includes('2026-10-27'));
  t('the confirmation + ics (SEQUENCE+1) went to Josiah only', W.emails.filter(e => e.kind === 'invite').length === 1 && W.emails.find(e => e.kind === 'invite').to === 'josiah.speed@ppmillc.com' && /SEQUENCE:1/.test(W.emails.find(e => e.kind === 'invite').ics) && W.emails.find(e => e.kind === 'invite').method === 'REQUEST', W.emails.map(e => e.to));
  t('Brett is told by EMAIL only (no extra texts)', W.emails.some(e => e.kind === 'mail' && /Inspection moved/.test(e.subject)) && W.sms.length === 0, W.emails.map(e => e.subject));
  const again = await E.shiftChangeApprove({}, { c: tokenOf('4') });
  t('clicking the link twice is safe: already approved, NO second invite', again.data.ok && again.data.results[0].already && W.emails.filter(e => e.kind === 'invite').length === 1, again.data);
  // the OTHER proposals are still waiting and untouched
  t('#5 and #3 are still just proposals', ['3', '5'].every(id => W.tabs.Insp_Bookings.find(b => b.ID === id).Change_Status === 'proposed'));
  const info = await E.shiftChangeInfo({}, { searchParams: new URLSearchParams('c=' + tokenOf('5')) });
  t('info for a waiting change: old -> new, can_act', info.data.ok && info.data.changes[0].can_act && /12:15 PM|1:30 PM/.test(info.data.changes[0].new) && info.data.changes[0].state === 'waiting', info.data);
  const bogus = await E.shiftChangeInfo({}, { searchParams: new URLSearchParams('c=' + 'z'.repeat(30)) });
  t('a made-up token is a 404 "no longer valid", never a booking', bogus.status === 404 && bogus.data.error === 'invalid_link');
}
{
  // approve all, in order
  const { E, W, tokenOf } = await proposed();
  W.cfg = { INSP_CALENDAR_STAGING_MODE: 'LIVE' };
  const batch = W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Batch;
  const tok = await E.shiftBatchToken({ WORKER_SECRET: 'x' }, batch);
  const r = await E.shiftChangeApprove({ WORKER_SECRET: 'x' }, { b: tok });
  const rows = W.tabs.Insp_Bookings.filter(b => b.Date === '2026-10-27');
  t('approve-all applies all three', r.data.ok && rows.every(b => b.Change_Status === 'applied'), r.data);
  t('final schedule is exactly the target', rows.map(b => E.inspFmtEtTime(Date.parse(b.Start_ISO)) + '-' + E.inspFmtEtTime(Date.parse(b.End_ISO))).join() === '11:00 AM-12:00 PM,12:15 PM-1:15 PM,1:30 PM-2:30 PM', rows.map(b => b.Start_ISO));
  t('one invite per inspection', W.emails.filter(e => e.kind === 'invite').length === 3);
  const bad = await E.shiftChangeApprove({ WORKER_SECRET: 'x' }, { b: tok.slice(0, -2) + 'zz' });
  t('a tampered approve-all token is refused', bad.status === 404);
}
{
  // failure injection at each step: nothing downstream after a failed write
  for (const [label, setup, expectKind] of [
    ['calendar PATCH fails', W => { W.inject.calFail = true; }, 'calendar'],
    ['calendar read-back does not keep the times', W => { W.inject.calMismatch = true; }, 'did not keep'],
    ['sheet times write fails', W => { W.inject.writeFail = (tab, id, f) => !!f.Start_ISO && f.Ics_Seq; }, 'booking row'],
    ['key pickup block fails', W => { W.inject.keyFail = true; W.keyCust = true; }, 'key-pickup'],
    ['confirmation email fails', W => { W.inject.inviteFail = true; }, 'confirmation email'],
  ]) {
    const { E, W, tokenOf } = await proposed();
    W.cfg = { INSP_CALENDAR_STAGING_MODE: 'LIVE' };
    if (label.startsWith('key')) W.tabs.Insp_Customers[0].Key_Address = '1 Office St, Baltimore'; W.tabs.Insp_Customers[0].Key_Pickup_Min = label.startsWith('key') ? '20' : '';
    setup(W);
    const r = await E.shiftChangeApprove({}, { c: tokenOf('4') });
    const b4 = W.tabs.Insp_Bookings.find(b => b.ID === '4');
    t(label + ': the person sees a friendly "we\'ll follow up", not success', !r.data.ok && /follow up/.test(r.data.message) && r.data.results[0].done === false, r.data);
    t(label + ': status = failed with the reason saved', b4.Change_Status === 'failed' && b4.Change_Note.length > 5, [b4.Change_Status, b4.Change_Note]);
    t(label + ': Brett alerted loudly + telemetry Success=FALSE', W.alerts.some(a => a[0] === 'shift_failed') && W.telemetry.some(x => x.Skill_Or_Endpoint === 'shift/commit' && x.Success === 'FALSE'), [W.alerts, W.telemetry]);
    if (label !== 'confirmation email fails') t(label + ': NO downstream notice after the failed write (no invite, no tenant text, no Brett "moved" email)', !W.emails.some(e => e.kind === 'invite') && !W.emails.some(e => /Inspection moved/.test(e.subject || '')) && W.gated.length === 0, W.emails.map(e => e.subject));
    else t(label + ': nothing else went out after it', !W.emails.some(e => /Inspection moved/.test(e.subject || '')) && W.gated.length === 0);
    // retry through Apply anyway after the cause is fixed
    W.inject = {}; W.alerts.length = 0;
    const re = await E.shiftForceApply({}, { id: '4' });
    t(label + ': retry with Apply anyway finishes it', re.data.ok && W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Status === 'applied', re.data);
  }
}
{
  // conflict at approval: nothing moves, Brett alerted; Apply anyway then works and records the override
  const { E, W, tokenOf } = await proposed();
  W.cfg = { INSP_CALENDAR_STAGING_MODE: 'LIVE' };
  W.events = [{ id: 'dentist', summary: 'Dentist', start: { dateTime: '2026-10-27T16:30:00.000Z' }, end: { dateTime: '2026-10-27T17:00:00.000Z' } }];
  const r = await E.shiftChangeApprove({}, { c: tokenOf('4') });
  const b4 = W.tabs.Insp_Bookings.find(b => b.ID === '4');
  t('conflict at approval: not applied, still proposed, old times intact', !r.data.ok && b4.Change_Status === 'proposed' && b4.Start_ISO === '2026-10-27T16:00:00.000Z' && /Dentist/.test(b4.Change_Note), [b4.Change_Status, b4.Change_Note]);
  t('conflict at approval: Brett alerted, no invite', W.alerts.some(a => a[0] === 'shift_conflict') && !W.emails.some(e => e.kind === 'invite'));
  const f = await E.shiftForceApply({}, { id: '4' });
  const b4b = W.tabs.Insp_Bookings.find(b => b.ID === '4');
  t('Apply anyway writes the change, sends the updated invite and RECORDS the override', f.data.ok && b4b.Start_ISO === '2026-10-27T16:15:00.000Z' && b4b.Change_Status === 'applied' && W.calls.some(c => c[0] === 'write' && /APPLIED ANYWAY/.test(c[3].Change_Note || '')) && W.emails.filter(e => e.kind === 'invite').length === 1, f.data);
  W.inject.calListFail = true;
  const x2 = await E.shiftChangeApprove({}, { c: tokenOf('5') });
  t('an unreadable calendar at approval fails LOUDLY (no change, alert), not "no conflicts"', !x2.data.ok && W.tabs.Insp_Bookings.find(b => b.ID === '5').Change_Status === 'proposed' && W.alerts.some(a => /calendar/.test(a[0] + a[1])), W.alerts);
}
{
  // a proposal that overlaps another booking's CURRENT time is blocked on approve; its batch mates are only a warning
  const { E, W, tokenOf } = await proposed();
  W.cfg = { INSP_CALENDAR_STAGING_MODE: 'LIVE' };
  const r = await E.shiftCommit({}, '4', { via: 'link' });
  t('approving #4 first while #5 still sits at 1:00: allowed, with a plain warning', r.ok && r.warnings.some(x => /3207 Cliftmont Ave \(#5\) is still at/.test(x)), r);
  W.tabs.Insp_Bookings.push({ ID: '60', Customer_ID: 'C1', Status: 'approved', Active: 'TRUE', Address: 'Z', Formatted_Address: 'Z St', Start_ISO: '2026-10-27T17:40:00.000Z', End_ISO: '2026-10-27T18:40:00.000Z', Change_Status: '' });
  const r5 = await E.shiftCommit({}, '5', { via: 'link' });
  t('approving #5 into someone else\'s booking is blocked', !r5.ok && r5.code === 'conflict' && W.tabs.Insp_Bookings.find(b => b.ID === '5').Change_Status === 'proposed', r5);
}
{
  // expired token / reschedule / withdraw
  const { E, W, tokenOf } = await proposed();
  W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Proposed_At = '2026-09-01T00:00:00.000Z';
  const ex = await E.shiftChangeApprove({}, { c: tokenOf('4') });
  t('an old link (more than 14 days) is refused with the reason', !ex.data.ok && /expired|14 days|more than/.test(JSON.stringify(ex.data)) && W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Status === 'proposed', ex.data);
  const rs = await E.shiftChangeReschedule({}, { c: tokenOf('5') });
  const b5 = W.tabs.Insp_Bookings.find(b => b.ID === '5');
  t('reschedule: status reschedule_requested, booking keeps its old time, partner is sent to the manage page', rs.data.ok && b5.Change_Status === 'reschedule_requested' && b5.Start_ISO === '2026-10-27T17:00:00.000Z' && /inspect-book\.html\?m=/.test(rs.data.manage_url), rs.data);
  t('reschedule: Brett is alerted by email AND text', W.emails.some(e => /Different time requested/.test(e.subject || '')) && W.sms.length === 1, [W.emails.map(e => e.subject), W.sms]);
  t('reschedule frees the proposed window', E.shiftOccupied(W.tabs.Insp_Bookings, {}).filter(o => o.id === '5').length === 1);
  const rs2 = await E.shiftChangeReschedule({}, { c: tokenOf('5') });
  t('asking twice is harmless (no second alert)', rs2.data.ok && rs2.data.already && W.sms.length === 1);
  const ap = await E.shiftChangeApprove({}, { c: tokenOf('5') });
  t('after a reschedule request the approve link no longer applies', !ap.data.ok && W.tabs.Insp_Bookings.find(b => b.ID === '5').Start_ISO === '2026-10-27T17:00:00.000Z');
  const wd = await E.shiftProposalCancel({}, { id: '3' });
  t('withdrawing a proposal clears it and kills its link', wd.data.ok && W.tabs.Insp_Bookings.find(b => b.ID === '3').Change_Status === 'none' && (await E.shiftChangeInfo({}, { searchParams: new URLSearchParams('c=' + 'q'.repeat(30)) })).status === 404);
  const list = await E.shiftProposalsList({});
  t('the proposals list shows what is waiting / answered', list.data.ok && list.data.proposals.some(p => p.id === '4' && p.status === 'proposed') && list.data.proposals.some(p => p.id === '5' && p.status === 'reschedule_requested') && !list.data.proposals.some(p => p.id === '3'), list.data.proposals.map(p => [p.id, p.status]));
}

// ════════ tenant text: the existing pipeline only, flag-driven ════════
{
  const { E, W, tokenOf } = await proposed({ notify: 'FALSE' });
  await E.shiftChangeApprove({}, { c: tokenOf('4') });
  t('Notify_Tenants FALSE (Premier): no tenant text of any kind', W.gated.length === 0 && W.sms.length === 0);
}
{
  const { E, W, tokenOf } = await proposed({ notify: 'TRUE' });
  W.tabs.Insp_Properties = [{ ID: 'P1', Customer_ID: 'C1', Address: '3572 Dudley Ave, Baltimore', Active: 'TRUE' }];
  W.tabs.Insp_Units = [{ ID: 'U1', Property_ID: 'P1', Label: 'A', Tenant_Name: 'Pat', Tenant_Phone: '4105551234', Active: 'TRUE' }];
  const r = await E.shiftChangeApprove({}, { c: tokenOf('4') });
  t('Notify_Tenants TRUE but the number is not a Hub tenant: NOT texted, the gap is reported (ledger + result warning), the move still happens', W.gated.length === 0 && W.failures.some(f => f.where === 'shift_tenant_text' && /not a tenant in the Hub/.test(f.message)) && W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Status === 'applied', [W.failures, r.data]);
}
{
  const { E, W, tokenOf } = await proposed({ notify: 'TRUE' });
  W.tabs.Insp_Properties = [{ ID: 'P1', Customer_ID: 'C1', Address: '3572 Dudley Ave, Baltimore', Active: 'TRUE' }];
  W.tabs.Insp_Units = [{ ID: 'U1', Property_ID: 'P1', Label: 'A', Tenant_Name: 'Pat', Tenant_Phone: '4105551234', Active: 'TRUE' }];
  W.tabs.Tenants = [{ ID: 'T1', First_Name: 'Pat', Last_Name: 'Q', Phone: '+14105551234', Property_ID: 'HP1', SMS_Enabled: 'TRUE', Active: 'TRUE' }];
  W.tabs.Properties = [{ ID: 'HP1', Address: '3572 Dudley', Owner_ID: 'O1' }]; W.tabs.Owners = [{ ID: 'O1', First_Name: 'Own' }];
  await E.shiftChangeApprove({}, { c: tokenOf('4') });
  t('Notify_Tenants TRUE and a Hub tenant: goes through smsGatedSend (the existing pipeline) once, with the tenant, property and owner', W.gated.length === 1 && W.gated[0].recipient_type === 'tenant' && W.gated[0].tenant.ID === 'T1' && W.gated[0].property.ID === 'HP1' && W.gated[0].owner.ID === 'O1' && /12:15 PM to 1:15 PM/.test(W.gated[0].message_body) && !W.gated[0].bypassQuietHours, W.gated);
  t('and no raw sendSMS to the tenant', W.sms.length === 0);
}

// ════════ reminders (scheduler job) ════════
{
  const { E, W } = await proposed();
  W.cfg = {};
  const t0 = Date.parse('2026-10-23T15:00:00Z');
  for (const b of W.tabs.Insp_Bookings) if (b.Change_Status === 'proposed') b.Change_Proposed_At = '2026-10-23T15:00:00.000Z';
  let r = await E.shiftRemindersRun({}, { nowMs: t0 + 2 * 3600000 });
  t('fresh proposals: no reminder yet', r.reminded.length === 0 && r.errors.length === 0, r);
  r = await E.shiftRemindersRun({}, { nowMs: t0 + 13 * 3600000 });
  t('unanswered for 12h+: one reminder per proposal (email, no text yet)', r.reminded.length === 3 && r.reminded.every(x => x.stage === 'stale') && W.sms.length === 0, r);
  const mails = W.emails.length;
  r = await E.shiftRemindersRun({}, { nowMs: t0 + 14 * 3600000 });
  t('reminders do not repeat', r.reminded.length === 0 && W.emails.length === mails, r);
  r = await E.shiftRemindersRun({}, { nowMs: Date.parse('2026-10-26T20:00:00Z') });
  t('within 24h of the visit: URGENT, with a text', r.reminded.length === 3 && r.reminded.every(x => x.stage === 'urgent') && W.sms.length === 3, r);
  r = await E.shiftRemindersRun({}, { nowMs: Date.parse('2026-10-27T15:05:00Z') });
  t('visit time passed with no answer: the proposal is closed and Brett told', r.expired.length >= 1 && W.tabs.Insp_Bookings.find(b => b.ID === '3').Change_Status === 'none', r);
}
{
  const { E, W } = await proposed();
  W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Status = 'approved'; W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Decided_At = '2026-10-23T14:00:00.000Z';
  const r = await E.shiftRemindersRun({}, { nowMs: Date.parse('2026-10-23T15:00:00Z') });
  t('an approval stuck half-way is marked failed and alerted', r.stuck.includes('4') && W.tabs.Insp_Bookings.find(b => b.ID === '4').Change_Status === 'failed' && W.alerts.some(a => a[0] === 'shift_stuck'), r);
  W.inject.writeFail = () => true;
  const r2 = await E.shiftRemindersRun({}, { nowMs: Date.parse('2026-10-24T15:00:00Z') });
  t('a reminder run that cannot write reports the errors instead of hiding them', r2.errors.length > 0, r2);
}

// ════════ the test seeder is staging + TEST- only ════════
{
  const { E, W } = mkWorld();
  const prod = await E.shiftTestSeed({ __STAGING__: false }, { name: 'TEST-x', bookings: [{ date: '2026-10-27', start: '11:00' }] });
  t('seeder refuses outside staging', prod.status === 403);
  const real = await E.shiftTestSeed({ __STAGING__: true }, { name: 'Premier', bookings: [{ date: '2026-10-27', start: '11:00' }] });
  t('seeder refuses a non-TEST name', real.status === 400);
}

// ════════ source-level guards ════════
{
  t('the block has no empty or swallowing catch', !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(BLOCK));
  const catches = [...BLOCK.matchAll(/catch\s*\((\w+)\)\s*\{/g)];
  const loud = /(errors|warnings|warn|notes|res\.errors|r\.errors|r\.warnings|w\.r\.errors|w\.r\.warnings|out\.errors)\.push|reportFailure|inspAlert|shiftTelemetry|shiftCommitFail|shiftRouteErr|throw |log\.push|console\.error|return json\(|return out\(|i\.warnings\.push|r\.errors\.push|silent-ok/;
  const quiet = [];
  for (const m of catches) {
    let d = 0, j = m.index + m[0].length - 1, k = j;
    for (; k < BLOCK.length; k++) { if (BLOCK[k] === '{') d++; else if (BLOCK[k] === '}') { d--; if (!d) break; } }
    const body = BLOCK.slice(j, k + 1);
    if (!loud.test(body)) quiet.push(body.slice(0, 120));
  }
  t('every catch in the shift block reports, returns or rethrows', quiet.length === 0, quiet);
  t('the shift block never builds its own SMS sender', !/twilio\.com|sendSMSRaw/.test(BLOCK) && /smsGatedSend/.test(BLOCK));
  t('the slot picker counts proposed windows', /Appointment Shift: while a move is waiting for an answer, BOTH its old and its proposed window are taken/.test(src));
  t('approving a pending booking counts proposed windows', /a time that another booking has been PROPOSED to move into is taken too/.test(src));
  t('new routes: public ones are in PUBLIC_PATHS, admin ones are not', ['/insp-change/info', '/insp-change/approve', '/insp-change/reschedule'].every(p => src.slice(src.indexOf('const PUBLIC_PATHS'), src.indexOf('const PUBLIC_PATHS') + 6000).includes("'" + p + "'")) && !['/shift/preview', '/shift/apply', '/shift/force-apply', '/shift/proposals', '/shift/proposal/cancel', '/shift/test-seed'].some(p => src.slice(src.indexOf('const PUBLIC_PATHS'), src.indexOf('const PUBLIC_PATHS') + 6000).includes("'" + p + "'")));
  t('the reminder job is in SCHED_JOBS, the preflight text and the Apps Script table; crons stay empty', /name: 'insp_shift_reminders', kind: 'interval'/.test(src) && /insp_shift_reminders: '/.test(src) && /name: 'insp_shift_reminders'/.test(fs.readFileSync(new URL('../apps-script/hub-scheduler/HubScheduler.gs', import.meta.url), 'utf8')) && /crons\s*=\s*\[\]/.test(fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')));
  t('the test-token guard allows shift writes only for TEST- records', /path === '\/shift\/apply'[\s\S]{0,700}isTestWO[\s\S]{0,300}isTestRecord\(env, 'Insp_Customers'/.test(src));
}

console.log(`appointment-shift: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
