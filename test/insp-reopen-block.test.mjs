// Inspection scheduler — reopen / extend a block (Oct 14 2026). Runs the REAL worker.js functions (grabbed from source)
// against in-memory sheets and fake SMS / email / telemetry, with a pinned clock.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name, kind = 'function', isAsync = false) {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ((isAsync ? 'async ' : '') + 'function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  if (kind === 'const') {
    if (src[src.indexOf('=', i) + 2] === '[') { let d = 0, j = src.indexOf('[', i); for (; j < src.length; j++) { if (src[j] === '[') d++; else if (src[j] === ']') { d--; if (!d) break; } } return src.slice(i, j + 2); }
    const j = src.indexOf(';', i); return src.slice(i, j + 1);
  }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const consts = ['INSP_TZ', 'INSP_DEFAULT_BOOK_BY_HOURS', 'INSP_ACTIVE_BOOKING', 'PORTAL_BASE', 'INSP_REOPEN_PRESETS'].map(n => grab(n, 'const')).join('\n');
const fns = ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspAddDays', 'inspFmtEt', 'inspFmtEtTime', 'inspBlockExpiryMs', 'inspBlockWindowEndMs', 'inspDefaultBookByHours', 'inspBookUrl', 'inspReopenCloseTime', 'inspReopenMessage', 'inspReopenRecipients'].map(n => grab(n)).join('\n');
const handler = grab('inspOpenBlockReopen', 'function', true);

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

// ── harness ────────────────────────────────────────────────────────────────────────────────
function build(nowIso, h) {
  const NOW = Date.parse(nowIso);
  class FD extends Date { static now() { return NOW; } }
  const factory = new Function('Date', 'h', consts + '\n' + fns + '\n' + handler + `
    const json = (data, status = 200) => ({ status, body: data });
    const isMissingTabError = e => /missing tab/i.test(String(e && e.message));
    const fetchTab = (env, tab) => h.fetchTab(tab);
    const fetchConfig = async () => h.cfg;
    const inspStrStatus = (env, cfg, o) => h.strStatus(o);
    const updateRow = (env, tab, id, f) => h.updateRow(tab, id, f);
    const ensureInspTabs = async () => { h.calls.push('ensure'); };
    const sendSMS = (env, to, msg) => h.sendSMS(to, msg);
    const gmailSendEmail = (env, o) => h.email(o);
    const inspAlert = async (env, kind, msg) => { h.alerts.push({ kind, msg }); };
    const logTelemetry = async (env, rec) => { h.telemetry.push(rec); };
    return { inspReopenCloseTime, inspReopenMessage, inspReopenRecipients, inspBlockExpiryMs, inspEtWallToMs, inspOpenBlockReopen };
  `);
  return factory(FD, h);
}
function world(over) {
  const w = {
    blocks: [
      { ID: '4', Customer_ID: '', Date: '2026-10-15', Start_Time: '10:00', End_Time: '14:00', Note: '', Active: 'TRUE', Created_Date: '2026-10-07', Book_By_Hours: '', Book_By: '2026-10-13T17:00', Last_Start: '14:00', Reopen_Log: '' },
      { ID: '5', Customer_ID: '2', Date: '2026-10-20', Start_Time: '10:00', End_Time: '14:00', Note: '', Active: 'FALSE', Created_Date: '2026-10-12', Book_By_Hours: '', Book_By: '', Last_Start: '14:00', Reopen_Log: '' },
      { ID: '6', Customer_ID: '2', Date: '2026-10-21', Start_Time: '10:00', End_Time: '14:00', Note: '', Active: 'TRUE', Created_Date: '2026-10-12', Book_By_Hours: '', Book_By: '', Last_Start: '14:00', Reopen_Log: '' },
    ],
    customers: [
      { ID: '1', Name: 'Brett Lambert', Contact_Name: 'BJ', Contact_Phone: '+14100000001', Contact_Email: 'me@example.com', Active: 'TRUE', Book_Token: 'TOKBRETT00000000000000' },
      { ID: '2', Name: 'Premier Property Management', Contact_Name: 'Josiah Speed', Contact_Phone: '+16670000002', Contact_Email: 'josiah@example.com', Active: 'TRUE', Book_Token: 'TOKJOSIAH0000000000000' },
      { ID: '3', Name: 'Old Customer', Contact_Name: 'X', Contact_Phone: '+1', Contact_Email: 'x@example.com', Active: 'FALSE', Book_Token: 'TOKOLD' },
      { ID: '7', Name: 'No Link Co', Contact_Name: 'Y', Contact_Phone: '+1', Contact_Email: 'y@example.com', Active: 'TRUE', Book_Token: '' },
    ],
    bookings: [
      { ID: '2', Customer_ID: '2', Status: 'approved', Active: 'TRUE', Start_ISO: '2026-10-15T16:00:00.000Z' },
      { ID: '1', Customer_ID: '1', Status: 'declined', Active: 'TRUE', Start_ISO: '2026-10-15T14:00:00.000Z' },
    ],
    cfg: {}, str: { enabled: false, closed: [] }, strThrow: '', failUpdate: false, noPersist: false, failLogWrite: false,
    smsResult: { sid: 'SM1' }, emailThrow: '',
  };
  Object.assign(w, over || {});
  const h = {
    calls: [], alerts: [], telemetry: [], sms: [], emails: [], updates: [], cfg: w.cfg,
    fetchTab: async tab => { if (tab === 'Insp_Open_Blocks') return w.blocks.map(r => ({ ...r })); if (tab === 'Insp_Customers') return w.customers.map(r => ({ ...r })); if (tab === 'Insp_Bookings') return w.bookings.map(r => ({ ...r })); throw new Error('missing tab ' + tab); },
    strStatus: async () => { if (w.strThrow) throw new Error(w.strThrow); return w.str; },
    updateRow: async (tab, id, f) => {
      h.updates.push({ tab, id, f });
      if (f.Reopen_Log !== undefined && w.failLogWrite) return { json: async () => ({ success: false, error: 'sheet said no' }) };
      if (w.failUpdate) return { json: async () => ({ success: false, error: 'boom' }) };
      if (!w.noPersist) { const r = w.blocks.find(x => String(x.ID) === String(id)); Object.assign(r, f); }
      return { json: async () => ({ success: true }) };
    },
    sendSMS: async (to, msg) => { h.sms.push({ to, msg }); return w.smsResult; },
    email: async o => { if (w.emailThrow) throw new Error(w.emailThrow); h.emails.push(o); return {}; },
  };
  return { w, h };
}
const body = r => r.body, status = r => r.status;

// ── PURE: close time ───────────────────────────────────────────────────────────────────────
{
  const { h } = world();
  const E = build('2026-10-14T17:42:30.000Z', h); // Wed Oct 14 1:42:30 PM EDT
  const blk = { Date: '2026-10-15', Start_Time: '10:00', End_Time: '14:00', Last_Start: '14:00' };
  const now = Date.parse('2026-10-14T17:42:30.000Z');
  let r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: 'tomorrow' });
  t('until tomorrow = tomorrow 7:00 AM Eastern', r.ok && r.wall === '2026-10-15T07:00' && new Date(r.closeMs).toISOString() === '2026-10-15T11:00:00.000Z' && !r.capped, r);
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: '3h' });
  t('3 hrs rounds UP to the next whole minute (never earlier than asked)', r.ok && r.wall === '2026-10-14T16:43', r);
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: '6h' }); t('6 hrs', r.ok && r.wall === '2026-10-14T19:43', r);
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: '12h' }); t('12 hrs', r.ok && r.wall === '2026-10-15T01:43', r);
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: '24h' }); t('24 hrs fits before the block ends, not capped', r.ok && r.wall === '2026-10-15T13:43' && !r.capped, r);
  r = E.inspReopenCloseTime({ nowMs: now, block: { ...blk, Last_Start: '' , End_Time: '13:00' }, preset: '24h' });
  t('later than the block allows is CUT BACK and flagged, never silent', r.ok && r.capped && r.wall === '2026-10-15T13:00' && /Oct 15/.test(r.capped_to_label), r);
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: 'custom', custom: '2026-10-14T17:00' });
  t('custom exact time (datetime-local value) accepted', r.ok && r.wall === '2026-10-14T17:00' && new Date(r.closeMs).toISOString() === '2026-10-14T21:00:00.000Z', r);
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: 'custom', custom: '2026-10-14 09:00' });
  t('custom time already past is refused', !r.ok && r.error === 'in_the_past', r);
  t('custom blank / garbage is refused', ['', 'soon', '2026-13-45T99:99'].every(c => { const x = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: 'custom', custom: c }); return !x.ok && x.error === 'bad_custom'; }));
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: 'nope' }); t('unknown choice refused', !r.ok && r.error === 'bad_preset', r);
  r = E.inspReopenCloseTime({ nowMs: now, block: { Date: '2026-10-14', Start_Time: '09:00', End_Time: '13:00', Last_Start: '13:30' }, preset: '3h' });
  t('block whose window already ended cannot be reopened', !r.ok && r.error === 'block_over', r);
  r = E.inspReopenCloseTime({ nowMs: now, block: { Date: '', Start_Time: '', End_Time: '' }, preset: '3h' });
  t('unreadable block fails closed', !r.ok && r.error === 'block_unreadable', r);
  // the stored Book_By must reproduce the exact close moment through the SAME expiry function partners are checked with
  r = E.inspReopenCloseTime({ nowMs: now, block: blk, preset: '6h' });
  t('stored wall time round-trips through inspBlockExpiryMs to the same instant', E.inspBlockExpiryMs({ ...blk, Book_By: r.wall }, 48) === r.closeMs);
  // DST fall-back: tomorrow 7 AM on Nov 1 is EST (UTC-5)
  const E2 = build('2026-11-01T00:30:00.000Z', h);
  r = E2.inspReopenCloseTime({ nowMs: Date.parse('2026-10-31T20:00:00-04:00'), block: { Date: '2026-11-03', Start_Time: '10:00', End_Time: '14:00', Last_Start: '14:00' }, preset: 'tomorrow' });
  t('"until tomorrow 7 AM" survives the DST change (Nov 1 7:00 AM EST = 12:00Z)', r.ok && r.wall === '2026-11-01T07:00' && new Date(r.closeMs).toISOString() === '2026-11-01T12:00:00.000Z', r);
}

// ── PURE: message + recipients ─────────────────────────────────────────────────────────────
{
  const { w, h } = world();
  const E = build('2026-10-14T17:42:00.000Z', h);
  const b = w.blocks[0], close = E.inspEtWallToMs('2026-10-15', '07:00');
  let m = E.inspReopenMessage({ block: b, closeMs: close, url: 'https://x.test/inspect-book.html?k=ABC', extend: false });
  t('reopen text names the day, window, deadline and link', /reopened inspection times for Thu, Oct 15, 10:00 AM–2:00 PM/.test(m.sms) && /Book by Thu, Oct 15, 7:00 AM/.test(m.sms) && m.sms.endsWith('?k=ABC') && m.sms.length < 320, m.sms);
  m = E.inspReopenMessage({ block: b, closeMs: close, url: 'u', extend: true });
  t('extend wording differs and subject says extended', /extended booking for/.test(m.sms) && /extended/.test(m.subject), m);
  m = E.inspReopenMessage({ block: b, closeMs: close, url: 'https://x.test/?a=1&b="2"<s>', extend: false });
  t('email html escapes the link', !/<s>/.test(m.html) && /&amp;b=&quot;2&quot;&lt;s&gt;/.test(m.html), m.html);
  let rec = E.inspReopenRecipients(b, w.customers, w.bookings);
  t('"any customer" block: partners with a link are listed, only the one with a booking that day is pre-ticked (declined booking does not count)', rec.map(r => r.id).join() === '1,2' && rec.find(r => r.id === '2').selected && !rec.find(r => r.id === '1').selected, rec);
  t('inactive customers and customers without a booking link are never offered', !rec.some(r => r.id === '3' || r.id === '7'));
  rec = E.inspReopenRecipients(w.blocks[1], w.customers, w.bookings);
  t('block that belongs to one customer: only that customer, pre-ticked', rec.length === 1 && rec[0].id === '2' && rec[0].selected && rec[0].has_email && rec[0].has_phone, rec);
  t('recipient list never leaks phone/email values or the booking token', !JSON.stringify(rec).match(/TOK|@|\+1/));
}

// ── HANDLER ────────────────────────────────────────────────────────────────────────────────
const NOW_ISO = '2026-10-14T17:42:00.000Z';
async function run(over, req) {
  const { w, h } = world(over); const E = build(NOW_ISO, h);
  const r = await E.inspOpenBlockReopen({}, req);
  return { r, w, h, b: body(r), s: status(r) };
}
const reopenReq = (extra) => ({ id: '4', preset: 'tomorrow', notify: { email: true, sms: false }, recipients: ['2'], ...(extra || {}) });

{ // preview: writes nothing, tells him what state it is in
  const x = await run({}, { id: '4', preview: true, preset: 'tomorrow' });
  t('preview ok, block 4 (deadline passed) is a REOPEN', x.s === 200 && x.b.ok && x.b.mode === 'reopen' && x.b.closed_by === 'deadline', x.b);
  t('preview writes NOTHING and sends NOTHING', x.h.updates.length === 0 && x.h.sms.length === 0 && x.h.emails.length === 0 && x.h.telemetry.length === 0 && !x.h.calls.includes('ensure'));
  t('preview lists all six choices with their real close times', x.b.options.length === 6 && x.b.options[0].closes_label === 'Thu, Oct 15, 7:00 AM' && x.b.options[5].id === 'custom', x.b.options);
  t('preview shows the exact message with a placeholder link', x.b.sample && /\[their booking link\]/.test(x.b.sample.sms) && x.b.sample.closes_label === 'Thu, Oct 15, 7:00 AM', x.b.sample);
  t('preview pre-ticks Premier only', x.b.recipients.filter(r => r.selected).map(r => r.id).join() === '2');
  t('nothing blocks notifying', x.b.notify_blocked === '' && x.b.str_closed === false);
  const m = await run({}, { id: '5', preview: true });
  t('manually closed block is a REOPEN (closed by hand)', m.b.mode === 'reopen' && m.b.closed_by === 'manual', m.b);
  const o = await run({}, { id: '6', preview: true });
  t('block still open is an EXTEND', o.b.mode === 'extend' && o.b.closed_by === '', o.b);
  const nf = await run({}, { id: '999', preview: true });
  t('unknown block is a plain 404 with a message', nf.s === 404 && nf.b.error === 'not_found');
}
{ // reopen with email only (Brett's default): saved, read back, emailed, logged
  const x = await run({}, reopenReq());
  t('reopen succeeds', x.s === 200 && x.b.ok && x.b.mode === 'reopen' && x.b.closes_label === 'Thu, Oct 15, 7:00 AM', x.b);
  const u = x.h.updates[0];
  t('saved Active=TRUE and an exact Book_By, and cleared the hours (Book_By wins anyway)', u.tab === 'Insp_Open_Blocks' && u.id === '4' && u.f.Active === 'TRUE' && u.f.Book_By === '2026-10-15T07:00' && u.f.Book_By_Hours === '', u);
  t('tab columns were ensured before the write (Reopen_Log)', x.h.calls[0] === 'ensure');
  t('the partner email went to Josiah with HIS booking link and nobody else got anything', x.h.emails.length === 1 && x.h.emails[0].to === 'josiah@example.com' && x.h.emails[0].html.includes('k=TOKJOSIAH0000000000000') && x.h.sms.length === 0, x.h.emails);
  t('no text was sent (SMS box was off)', x.h.sms.length === 0);
  t('the result says exactly what was sent', x.b.notify.join() === 'Premier Property Management: email ok', x.b.notify);
  t('activity note written on the block and telemetry row Success=TRUE', /reopened until Thu, Oct 15, 7:00 AM; Premier Property Management: email ok/.test(x.w.blocks[0].Reopen_Log) && x.h.telemetry.length === 1 && x.h.telemetry[0].Success === 'TRUE' && x.h.alerts.length === 0, x.h.telemetry);
  t('after reopening, the block really is open to partners until that time', (() => { const b = x.w.blocks[0]; return String(b.Active).toUpperCase() !== 'FALSE' && build(NOW_ISO, world().h).inspBlockExpiryMs(b, 48) === Date.parse('2026-10-15T11:00:00.000Z'); })());
}
{ // text + email, real recipients both
  const x = await run({}, reopenReq({ notify: { email: true, sms: true } }));
  t('text goes to Josiah\'s phone with the book link', x.h.sms.length === 1 && x.h.sms[0].to === '+16670000002' && /Brett reopened/.test(x.h.sms[0].msg) && x.h.sms[0].msg.includes('k=TOKJOSIAH0000000000000'), x.h.sms);
  t('notify log lists both channels as ok', x.b.notify.join() === 'Premier Property Management: text ok,Premier Property Management: email ok', x.b.notify);
}
{ // nobody to tell: still saves, says so
  const x = await run({}, reopenReq({ notify: { email: false, sms: false }, recipients: [] }));
  t('reopen with no notification saves and sends nothing', x.s === 200 && x.b.ok && x.h.emails.length === 0 && x.h.sms.length === 0 && /nobody notified/.test(x.w.blocks[0].Reopen_Log), x.b);
}
{ // extend an open block
  const x = await run({}, { id: '6', preset: '24h', notify: { email: false, sms: false }, recipients: [] });
  t('extend of an open block saves the new cutoff', x.s === 200 && x.b.mode === 'extend' && x.w.blocks[2].Book_By === '2026-10-15T13:42' && x.w.blocks[2].Active === 'TRUE', x.w.blocks[2]);
  const y = await run({}, { id: '6', preset: '24h', notify: { email: true, sms: false }, recipients: ['2'] });
  t('extend email uses the "extended" wording', /extended/.test(y.h.emails[0].subject), y.h.emails[0]);
}
{ // custom time + capped
  const x = await run({}, reopenReq({ preset: 'custom', custom: '2026-10-14T20:15' }));
  t('custom time saved exactly', x.b.ok && x.h.updates[0].f.Book_By === '2026-10-14T20:15', x.b);
  const y = await run({}, reopenReq({ preset: 'custom', custom: '2026-10-20T09:00' }));
  t('a time later than the block allows is saved at the block\'s last start and the answer says so', y.b.ok && y.b.capped && y.h.updates[0].f.Book_By === '2026-10-15T14:00' && /Oct 15/.test(y.b.capped_to_label), y.b);
  const z = await run({}, reopenReq({ preset: 'custom', custom: '2026-10-14T09:00' }));
  t('a past custom time is a 400 and changes nothing', z.s === 400 && z.h.updates.length === 0 && z.h.emails.length === 0, z.b);
}
{ // SMS can't be sent (Twilio off) -> block saved, loudly NOT silently
  const x = await run({ smsResult: { skipped: true, reason: 'TWILIO_ENABLED not TRUE' } }, reopenReq({ notify: { email: true, sms: true } }));
  t('saved, but the text is reported as NOT SENT with the reason', x.b.ok && x.b.notify.some(l => /text NOT SENT — skipped \(TWILIO_ENABLED not TRUE\)/.test(l)) && x.b.notify.some(l => /email ok/.test(l)), x.b.notify);
  t('a missed text raises an alert and a failed telemetry row', x.h.alerts.some(a => a.kind === 'reopen_notify') && x.h.telemetry[0].Success === 'FALSE', { a: x.h.alerts, t: x.h.telemetry });
  const y = await run({ smsResult: { code: 21211, message: 'Invalid To number' } }, reopenReq({ notify: { email: false, sms: true } }));
  t('a Twilio error body is a FAILED text, never "ok"', y.b.notify.some(l => /text FAILED Invalid To number/.test(l)), y.b.notify);
  const z = await run({ emailThrow: 'Gmail 500' }, reopenReq());
  t('a thrown email error is reported as FAILED and alerted', z.b.ok && z.b.notify.some(l => /email FAILED Gmail 500/.test(l)) && z.h.alerts.length === 1, z.b.notify);
  const c = await run({ customers: world().w.customers.map(c => c.ID === '2' ? { ...c, Contact_Phone: '', Contact_Email: '' } : c) }, reopenReq({ notify: { email: true, sms: true } }));
  t('no phone / no email on file is reported, not skipped quietly', c.b.notify.some(l => /text NOT SENT — no phone number on file/.test(l)) && c.b.notify.some(l => /email NOT SENT — no email on file/.test(l)) && c.h.alerts.length === 1, c.b.notify);
}
{ // cleaning guard
  const x = await run({ str: { enabled: true, closed: ['2026-10-15'] } }, reopenReq());
  t('cleaning guard keeps the day closed: asking to notify is refused (409) BEFORE anything is written', x.s === 409 && x.b.error === 'notify_blocked' && x.h.updates.length === 0 && x.h.emails.length === 0, x.b);
  const y = await run({ str: { enabled: true, closed: ['2026-10-15'] } }, reopenReq({ notify: { email: false, sms: false }, recipients: [] }));
  t('...but reopening without telling anyone still works', y.s === 200 && y.b.ok, y.b);
  const p = await run({ str: { enabled: true, closed: ['2026-10-15'] } }, { id: '4', preview: true, preset: 'tomorrow' });
  t('preview tells him why notifying is off', p.b.str_closed === true && /cleaner/i.test(p.b.notify_blocked), p.b);
  const z = await run({ strThrow: 'calendar unreadable' }, reopenReq());
  t('cleaning calendars unreadable: refuses to tell a partner anything', z.s === 409 && /calendar unreadable/.test(z.b.message) && z.h.emails.length === 0, z.b);
}
{ // bad requests
  const a = await run({}, reopenReq({ recipients: [] }));
  t('notify ticked but nobody picked -> 400, nothing written', a.s === 400 && a.b.error === 'no_recipient' && a.h.updates.length === 0, a.b);
  const b = await run({}, reopenReq({ recipients: ['2', '3'] }));
  t('a recipient that is not valid for this block -> 400, nothing written', b.s === 400 && b.b.error === 'bad_recipient' && b.h.updates.length === 0, b.b);
  const c = await run({}, reopenReq({ preset: 'bogus' }));
  t('unknown choice -> 400, nothing written', c.s === 400 && c.h.updates.length === 0);
  const d = await run({}, { preset: '3h' });
  t('missing id -> 400', d.s === 400 && d.b.error === 'id_required');
  const e = await run({ blocks: [{ ID: '4', Customer_ID: '', Date: '2026-10-14', Start_Time: '09:00', End_Time: '10:00', Active: 'TRUE', Book_By: '', Book_By_Hours: '', Last_Start: '' }] }, reopenReq({ notify: { email: false, sms: false }, recipients: [] }));
  t('block whose time is over -> 400 with the reason, nothing written', e.s === 400 && e.b.error === 'block_over' && e.h.updates.length === 0, e.b);
}
{ // write failures are loud and nobody is told
  const a = await run({ failUpdate: true }, reopenReq());
  t('save fails: 500, nobody emailed, Brett alerted', a.s === 500 && a.b.error === 'save_failed' && a.h.emails.length === 0 && a.h.sms.length === 0 && a.h.alerts.some(x => x.kind === 'reopen_save'), a.b);
  const b = await run({ noPersist: true }, reopenReq({ notify: { email: true, sms: true } }));
  t('save says success but the read-back disagrees: 500, nobody told, Brett alerted', b.s === 500 && b.b.error === 'verify_failed' && b.h.emails.length === 0 && b.h.sms.length === 0 && b.h.alerts.some(x => x.kind === 'reopen_verify'), b.b);
  const c = await run({ failLogWrite: true }, reopenReq());
  t('the block saved but the activity note could not be written: succeeds WITH a visible warning', c.b.ok && c.b.warnings.some(x => /activity note/.test(x)) && c.h.emails.length === 1, c.b);
}

// ── wiring (static) ────────────────────────────────────────────────────────────────────────
t('route is registered in the admin POST block', /path === '\/insp\/open-block\/reopen'\)\s+return await inspOpenBlockReopen\(env, body\)/.test(src));
t('route is NOT public and has no role scope (admin secret only)', !/PUBLIC_PATHS[^;]*\/insp\/open-block\/reopen/.test(src) && (src.match(/\/insp\/open-block\/reopen/g) || []).length === 2, (src.match(/\/insp\/open-block\/reopen/g) || []).length);
t('Reopen_Log column is part of the block tab headers', /INSP_OPEN_BLOCK_HEADERS = \[[^\]]*'Reopen_Log'\]/.test(src));
t('staging write guard only lets the test token touch blocks owned by a TEST- customer', /path === '\/insp\/open-block\/reopen'[\s\S]{0,400}isTestRecord\(env, 'Insp_Customers', _bk\.Customer_ID\)/.test(src));
const fn = grab('inspOpenBlockReopen', 'function', true);
t('no swallowing catch in the new handler', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(fn) && !/catch\s*\(\s*_\s*\)/.test(fn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
