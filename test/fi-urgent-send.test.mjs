// Oct 28 2026 (Brett): urgent items emailed to the requester ahead of the inspection report (+ optional text, only 9am-4pm ET).
// Runs the REAL worker code against the in-memory Sheets/Drive/Gmail/SMS fake (test/_fi-world.mjs), including forced failures:
// nothing may report success when a send, a photo read or the send log fails, and a retry may never double-send.
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 700) : ''); } };
const realNow = Date.now;
const withNow = async (iso, fn) => { Date.now = () => Date.parse(iso); try { return await fn(); } finally { Date.now = realNow; } };
const OPEN = '2026-10-28T14:00:00Z';   // 10:00 ET

function mkDoc(over) {
  return Object.assign({
    v: 1, date: '2026-10-28', property: { address: '3572 Dudley Ave, Baltimore, MD 21213' },
    booking: { id: '4', contact: { name: 'Josiah Speed', phone: '+16674158226', email: 'josiah@example.test' } },
    owner: { name: 'Premier Property Management' }, overall: { condition: 'fair' },
    areas: [
      { id: 'a1', name: 'Kitchen', condition: 'fair', issues: [
        { id: 'is_aaa111', title: 'Gas smell near stove', trade: 'safety', severity: 'urgent', detail: 'Smell of gas when the range is on', photo_ids: ['ph_1', 'ph_2'] },
        { id: 'is_bbb222', title: 'Leak under sink', trade: 'plumbing', severity: 'high', detail: '', photo_ids: [] }] },
      { id: 'a2', name: 'Roof', condition: 'poor', issues: [{ id: 'is_ccc333', title: 'Exposed wiring in attic', trade: 'electrical', severity: 'urgent', detail: '', photo_ids: ['ph_3'] }] },
    ],
  }, over || {});
}
async function seed(doc, photos) {
  const w = world();
  await w.fiList(w.env);   // creates the FI tabs
  const r = await w.fiSave(w.env, { id: 'fi_urgent00001', base_rev: 0, doc: doc || mkDoc() });
  const ph = photos || ['ph_1', 'ph_2', 'ph_3'];
  for (const p of ph) w.h.tabs.FI_Photos.rows.push([p, 'fi_urgent00001', 'drv_' + p, 'image/jpeg', '1000', '2026-10-28T10:00:00Z', 'TRUE']);
  return { w, rev: r.body.rev, id: 'fi_urgent00001' };
}
const send = (w, id, rev, extra) => w.fiUrgentSend(w.env, Object.assign({ id, rev, issue_ids: ['is_aaa111', 'is_bbb222'], send_key: 'key12345678', preview: false }, extra || {}));

// ── 1. doc validation for the phone-only fields ──
{
  const w = world();
  const d = (m) => { const x = mkDoc(); m(x); return w.fiValidateDoc(x); };
  t('flag_send true and a sent mark are valid', d(x => { x.areas[0].issues[0].flag_send = true; x.areas[0].issues[0].sent = { at: '2026-10-28T15:00:00Z', to: 'josiah@example.test', via: 'email' }; }).ok);
  t('flag_send must be a boolean', !d(x => { x.areas[0].issues[0].flag_send = 'yes'; }).ok);
  t('sent must be an object with an at', !d(x => { x.areas[0].issues[0].sent = 'yes'; }).ok && !d(x => { x.areas[0].issues[0].sent = {}; }).ok);
  t('sent.to over 120 rejected', !d(x => { x.areas[0].issues[0].sent = { at: 'x', to: 'a'.repeat(121) }; }).ok);
}

// ── 2. text window: 9am up to (not including) 4pm ET, summer and winter time ──
{
  const w = world(); const o = (iso) => w.fiUrgentTextWindow(Date.parse(iso)).open;
  t('window: 10am ET open', o('2026-10-28T14:00:00Z'));
  t('window: 9:00 ET open, 8:59 ET closed (EDT)', o('2026-10-28T13:00:00Z') && !o('2026-10-28T12:59:00Z'));
  t('window: 3:59pm ET open, 4:00pm ET closed (EDT)', o('2026-10-28T19:59:00Z') && !o('2026-10-28T20:00:00Z'));
  t('window: night closed', !o('2026-10-29T02:00:00Z') && !o('2026-10-28T08:00:00Z'));
  t('window: winter (EST) 9:00 open, 8:59 closed', o('2026-12-15T14:00:00Z') && !o('2026-12-15T13:59:00Z'));
  t('window: winter 3:59pm open, 4:00pm closed', o('2026-12-15T20:59:00Z') && !o('2026-12-15T21:00:00Z'));
}

// ── 3. preview ──
{
  const { w, rev, id } = await seed();
  const r = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_aaa111', 'is_bbb222'] }));
  t('preview is the default and sends nothing', r.status === 200 && r.body.preview === true && w.h.multi.length === 0 && w.h.sms.length === 0, r.body);
  t('preview: goes to the booking contact, copies Brett', r.body.to === 'josiah@example.test' && r.body.cc === 'brett@bmoremanagement.com');
  t('preview: address, items in the order given, greeting by first name', r.body.html.includes('3572 Dudley Ave') && r.body.html.indexOf('Gas smell') < r.body.html.indexOf('Leak under sink') && r.body.html.includes('Hi Josiah,'));
  t('preview: subject names count + address, flags urgent', /^Urgent: 2 items at 3572 Dudley Ave/.test(r.body.subject), r.body.subject);
  t('preview: photos counted from the chosen items only', r.body.photo_count === 2 && r.body.photos_omitted === 0, r.body);
  t('preview: text available in the window with a phone', r.body.text.available === true && r.body.text.window_open === true && /^Ridge Co: 2 urgent inspection items/.test(r.body.text.body), r.body.text);
  const n = await withNow('2026-10-29T02:00:00Z', () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_aaa111'] }));
  t('preview at night: text not available, email still is', n.body.text.available === false && n.body.text.window_open === false);
  const only = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_bbb222'] }));
  t('preview: a single item with no photos', only.body.photo_count === 0 && /^Urgent: 1 item at/.test(only.body.subject) === false && /^1 item at/.test(only.body.subject), only.body.subject);
}

// ── 4. refusals (nothing sent) ──
{
  const { w, rev, id } = await seed();
  const R = async (b) => withNow(OPEN, () => w.fiUrgentSend(w.env, Object.assign({ id, rev, issue_ids: ['is_aaa111'], send_key: 'key12345678', preview: false }, b)));
  t('bad id', (await R({ id: 'x' })).body.error === 'bad_id');
  t('no items', (await R({ issue_ids: [] })).body.error === 'no_items');
  t('a junk id is refused outright (never silently dropped)', (await R({ issue_ids: ['<script>'] })).body.error === 'bad_items' && (await R({ issue_ids: ['is_aaa111', 'is.odd.id'] })).body.error === 'bad_items');
  t('too many items', (await R({ issue_ids: Array.from({ length: 21 }, (_, i) => 'is_' + String(i).padStart(4, '0')) })).body.error === 'too_many');
  t('stale rev -> not_saved', (await R({ rev: rev - 1 })).body.error === 'not_saved');
  t('unknown item -> item_missing', (await R({ issue_ids: ['is_zzz999'] })).body.error === 'item_missing');
  t('real send needs a send_key', (await R({ send_key: '' })).body.error === 'no_send_key');
  t('nothing was sent by any refusal', w.h.multi.length === 0 && w.h.sms.length === 0);
}
{
  const { w, rev, id } = await seed(mkDoc(), ['ph_1']);   // ph_2 and ph_3 not uploaded
  const r = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_aaa111'], send_key: 'key12345678', preview: false }));
  t('photos not uploaded -> 409 photos_missing, nothing sent, nothing logged as sent', r.status === 409 && r.body.error === 'photos_missing' && w.h.multi.length === 0 && !(w.h.tabs.FI_Email_Log.rows.some(x => x && /^sent/.test(x[4]))), r.body);
  const pv = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_aaa111'] }));
  t('preview also refuses missing photos (so the send screen can wait)', pv.status === 409 && pv.body.error === 'photos_missing');
}
{   // no booking contact -> must be told who to send to
  const d = mkDoc(); delete d.booking;
  const { w, rev, id } = await seed(d);
  const r = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_bbb222'], preview: true }));
  t('no booking -> no_recipient asks for an address', r.status === 400 && r.body.error === 'no_recipient' && r.body.need_to === true);
  const bad = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_bbb222'], preview: true, to: 'nope' }));
  t('a bad typed address is refused', bad.body.error === 'no_recipient');
  const ok = await withNow(OPEN, () => w.fiUrgentSend(w.env, { id, rev, issue_ids: ['is_bbb222'], preview: true, to: 'owner@example.test' }));
  t('a typed address works when there is no booking', ok.status === 200 && ok.body.to === 'owner@example.test' && ok.body.text.phone_on_file === false && ok.body.text.available === false);
  const d2 = mkDoc(); d2.booking.contact.email = 'broken';
  const s2 = await seed(d2);
  const r2 = await withNow(OPEN, () => s2.w.fiUrgentSend(s2.w.env, { id: s2.id, rev: s2.rev, issue_ids: ['is_bbb222'], preview: true }));
  t('a broken email on the booking needs a typed one', r2.body.error === 'no_recipient');
}

// ── 5. a real send ──
{
  const { w, rev, id } = await seed();
  const r = await withNow(OPEN, () => send(w, id, rev, { note: 'Please call me today.' }));
  t('send ok (staging stub says staged, honestly)', r.status === 200 && r.body.ok && r.body.staged === true && r.body.sent === false && r.body.logged === true, r.body);
  t('one email, photos attached, Brett copied, note included', w.h.multi.length === 1 && w.h.multi[0].attachments.length === 2 && w.h.multi[0].cc === 'brett@bmoremanagement.com' && w.h.multi[0].html.includes('Please call me today.'));
  t('attachments are real base64 jpegs', w.h.multi[0].attachments.every(a => a.mimeType === 'image/jpeg' && a.base64Data === Buffer.from('BYTES').toString('base64') && /\.jpg$/.test(a.filename)));
  const log = w.h.tabs.FI_Email_Log.rows.filter(Boolean);
  t('exactly one log row, keyed by the send key, final state', log.length === 1 && /^ug_key12345678_[0-9a-f]{8}$/.test(log[0][0]) && /^sent-staged/.test(log[0][4]), log);
  t('no text unless asked', w.h.sms.length === 0 && r.body.text.requested === false);
  const again = await withNow(OPEN, () => send(w, id, rev, { note: 'Please call me today.' }));
  t('same send_key again: reports already_sent, sends nothing', again.body.ok && again.body.already_sent === true && w.h.multi.length === 1 && w.h.tabs.FI_Email_Log.rows.filter(Boolean).length === 1, again.body);
  const other = await withNow(OPEN, () => send(w, id, rev, { send_key: 'otherkey9999', issue_ids: ['is_ccc333'] }));
  t('a different send_key is a new send', other.body.ok && w.h.multi.length === 2 && w.h.tabs.FI_Email_Log.rows.filter(Boolean).length === 2);
  t('the server never trusts item text from the request', (await withNow(OPEN, () => send(w, id, rev, { send_key: 'key_evil_0001', issue_ids: ['is_bbb222'], items: [{ title: 'HACKED' }], title: 'HACKED' }))).body.ok && !w.h.multi[2].html.includes('HACKED'));
}

// ── 6. optional text ──
{
  const { w, rev, id } = await seed();
  const r = await withNow(OPEN, () => send(w, id, rev, { also_text: true }));
  t('text inside the window goes out after the email', r.body.ok && r.body.text.sent === true && w.h.sms.length === 1 && w.h.sms[0].to === '+16674158226' && /^Ridge Co: 2 urgent inspection items at 3572 Dudley Ave/.test(w.h.sms[0].msg) && w.h.sms[0].msg.includes('Gas smell near stove (+1 more)'), w.h.sms);
  t('text uses the street only (short), no city/zip', !/Baltimore|21213/.test(w.h.sms[0].msg), w.h.sms[0].msg);
  t('text carries no photos or links, only a pointer to the email', !/http/.test(w.h.sms[0].msg) && /sent to your email/.test(w.h.sms[0].msg));
  t('log row records the text', /text:staged/.test(w.h.tabs.FI_Email_Log.rows.filter(Boolean)[0][4]));
  const bs = (iso) => seed().then(async (s) => ({ s, r: await withNow(iso, () => send(s.w, s.id, s.rev, { also_text: true })) }));
  for (const [label, iso] of [['8:59am', '2026-10-28T12:59:00Z'], ['4:00pm', '2026-10-28T20:00:00Z'], ['10pm', '2026-10-29T02:00:00Z']]) {
    const x = await bs(iso);
    t(`outside the window (${label}): email only, no text, told why, nothing queued`, x.r.body.ok && x.r.body.text.sent === false && /9am-4pm/.test(x.r.body.text.reason) && x.s.w.h.sms.length === 0 && x.s.w.h.multi.length === 1, x.r.body.text);
  }
  const d = mkDoc(); d.booking.contact.phone = '';
  const np = await seed(d);
  const rn = await withNow(OPEN, () => send(np.w, np.id, np.rev, { also_text: true }));
  t('no phone on the booking: email only, told why', rn.body.ok && rn.body.text.sent === false && /no phone/i.test(rn.body.text.reason) && np.w.h.sms.length === 0);
  const th = await seed(); th.w.h.smsThrow = 'twilio down';
  const rt = await withNow(OPEN, () => send(th.w, th.id, th.rev, { also_text: true }));
  t('text failure after a good email: ok, text.sent false with the reason, telemetry written', rt.body.ok && rt.body.text.sent === false && /did go out/.test(rt.body.text.reason) && th.w.h.telemetry.some(x => x.Job_Type === 'fi_urgent_text_failed'), rt.body);
  const sk = await seed(); sk.w.h.smsResult = { skipped: true, reason: 'TWILIO_ENABLED not TRUE' };
  const rk = await withNow(OPEN, () => send(sk.w, sk.id, sk.rev, { also_text: true }));
  t('texts switched off: email still sent, text reported as not sent (not as sent)', rk.body.ok && rk.body.text.sent === false && /TWILIO_ENABLED/.test(rk.body.text.reason));
  const ts = await seed(); ts.w.h.smsResult = { error: 'Twilio not configured' };
  const rs = await withNow(OPEN, () => send(ts.w, ts.id, ts.rev, { also_text: true }));
  t('Twilio error object is not mistaken for success', rs.body.text.sent === false && /Twilio not configured/.test(rs.body.text.reason));
}

// ── 7. forced failures ──
{
  const a = await seed(); a.w.h.multiFail = 'Gmail 401';
  const r = await withNow(OPEN, () => send(a.w, a.id, a.rev, { also_text: true }));
  t('email failure: 502, says NOT sent, no text goes out, telemetry', r.status === 502 && r.body.error === 'send_failed' && /NOT sent/.test(r.body.message) && a.w.h.sms.length === 0 && a.w.h.telemetry.some(x => x.Job_Type === 'fi_urgent_send_error'), r.body);
  const lg = a.w.h.tabs.FI_Email_Log.rows.filter(Boolean);
  t('failed send is logged as failed (not stuck on "sending")', lg.length === 1 && /^failed/.test(lg[0][4]), lg);
  a.w.h.multiFail = null;
  const retry = await withNow(OPEN, () => send(a.w, a.id, a.rev, {}));
  t('retry with the SAME key after a failure works, once', retry.body.ok && !retry.body.already_sent && a.w.h.multi.length === 1 && a.w.h.tabs.FI_Email_Log.rows.filter(Boolean).length === 1);
}
{
  const a = await seed(); a.w.h.driveOk = false;
  const r = await withNow(OPEN, () => send(a.w, a.id, a.rev, {}));
  t('photo unreadable: 502, nothing sent, logged failed', r.status === 502 && r.body.error === 'photo_read_failed' && a.w.h.multi.length === 0 && /^failed/.test(a.w.h.tabs.FI_Email_Log.rows.filter(Boolean)[0][4]), r.body);
}
{   // the send succeeded but the final log write fails -> still ok (the mail went), logged:false, telemetry, and a retry cannot double-send
  const a = await seed(); let puts = 0;
  a.w.h.corrupt = (tab, vals) => { if (tab === 'FI_Email_Log') { puts++; if (puts >= 2) throw new Error('sheets down'); } return vals; };
  const r = await withNow(OPEN, () => send(a.w, a.id, a.rev, {}));
  a.w.h.corrupt = null;
  t('log write fails after a good send: ok but logged:false + telemetry', r.status === 200 && r.body.ok && r.body.logged === false && a.w.h.telemetry.some(x => x.Job_Type === 'fi_urgent_log_error'), r.body);
  const re = await withNow(OPEN, () => send(a.w, a.id, a.rev, {}));
  t('an immediate retry is blocked (in_progress), no second mail', re.status === 409 && re.body.error === 'in_progress' && a.w.h.multi.length === 1, re.body);
  const row = a.w.h.tabs.FI_Email_Log.rows.filter(Boolean)[0]; row[5] = new Date(Date.parse(OPEN) - 600000).toISOString();
  const old = await withNow(OPEN, () => send(a.w, a.id, a.rev, {}));
  t('a stale unfinished send is never auto-resent: tells him to check his inbox', old.status === 409 && old.body.error === 'unknown_state' && /inbox/.test(old.body.message) && a.w.h.multi.length === 1, old.body);
}

// ── 7b. review findings (independent validator, Oct 28): key bound to the items, concurrent same-key sends, photo labels ──
{
  const { w, rev, id } = await seed();
  const a = await withNow(OPEN, () => send(w, id, rev, { issue_ids: ['is_aaa111'] }));
  const b = await withNow(OPEN, () => send(w, id, rev, { issue_ids: ['is_bbb222'] }));   // SAME key, different item
  t('same send_key but DIFFERENT items is a new send, not "already sent"', a.body.ok && b.body.ok && !b.body.already_sent && w.h.multi.length === 2 && /Leak under sink/.test(w.h.multi[1].html), b.body);
  const c = await withNow(OPEN, () => send(w, id, rev, { issue_ids: ['is_bbb222', 'is_aaa111'] }));
  const d = await withNow(OPEN, () => send(w, id, rev, { issue_ids: ['is_aaa111', 'is_bbb222'] }));
  t('same items in a different order with the same key is the same send (idempotent)', c.body.ok && d.body.already_sent === true && w.h.multi.length === 3, d.body);
}
{
  const { w, rev, id } = await seed();
  const rs = await withNow(OPEN, () => Promise.all([send(w, id, rev, {}), send(w, id, rev, {})]));
  t('two concurrent sends with the same key: exactly ONE email goes out', w.h.multi.length === 1, w.h.multi.length);
  t('the loser is told it is in progress (not a success)', rs.filter(r => r.status === 409 && r.body.error === 'in_progress').length + rs.filter(r => r.status === 200 && r.body.ok).length === 2 && rs.some(r => r.status === 200), rs.map(r => r.body.error || r.body.ok));
  const ids = w.h.tabs.FI_Email_Log.rows.filter(Boolean).map(r => r[4]);
  t('no row is left stuck on "sending"', !ids.some(x => /^sending/.test(x)), ids);
}
{
  const { w, rev, id } = await seed();
  const r = await withNow(OPEN, () => send(w, id, rev, {}));
  const html = w.h.multi[0].html;
  t('email says which photos belong to which item', /Gas smell[\s\S]*Photos 1, 2 attached[\s\S]*Leak under sink/.test(html) && !/Photo[s]? \d attached/.test(html.split('Leak under sink')[1] || ''), html.slice(0, 900));
  const pn = await seed(mkDoc(), ['ph_3']);
  const rp = await withNow(OPEN, () => send(pn.w, pn.id, pn.rev, { issue_ids: ['is_ccc333'] }));
  t('a jpeg photo is named .jpg', rp.body.ok && /\.jpg$/.test(pn.w.h.multi[0].attachments[0].filename));
}

// ── 8. photo cap + escaping ──
{
  const d = mkDoc(); d.areas[0].issues[0].photo_ids = Array.from({ length: 8 }, (_, i) => 'ph_' + (10 + i)); d.areas[0].issues[0].title = 'Gas <b>smell</b> & "fire"'; d.areas[0].issues[0].detail = '<img src=x onerror=alert(1)>';
  const s = await seed(d, d.areas[0].issues[0].photo_ids);
  const r = await withNow(OPEN, () => send(s.w, s.id, s.rev, { issue_ids: ['is_aaa111'] }));
  t('8 photos: 6 attached, 2 reported as left for the full report', r.body.ok && r.body.photo_count === 6 && r.body.photos_omitted === 2 && s.w.h.multi[0].attachments.length === 6 && /2 more will be in the full report/.test(s.w.h.multi[0].html), r.body);
  const html = s.w.h.multi[0].html;
  t('item text is HTML-escaped in the email', !html.includes('<b>smell</b>') && !html.includes('<img src=x') && html.includes('&lt;b&gt;smell&lt;/b&gt;'));
  t('SMS body is plain ASCII', /^[\x20-\x7e]+$/.test(s.w.h.sms.length ? s.w.h.sms[0].msg : s.w.fiUrgentSmsBody(d, [{ title: 'Gas ’ smell' }])));
}

// ── 9. phone-only fields never reach the public report, and marking items sent never un-publishes ──
{
  const d = mkDoc(); d.areas[0].issues[0].flag_send = true; d.areas[0].issues[0].sent = { at: '2026-10-28T15:00:00Z', to: 'josiah@example.test', via: 'email' };
  const scrubbed = w0().fiScrubDocForReport(JSON.parse(JSON.stringify(d)));
  t('public report scrub drops flag_send and sent', scrubbed.areas[0].issues.every(i => i.flag_send === undefined && i.sent === undefined));
  t('...but keeps the item itself', scrubbed.areas[0].issues[0].title === 'Gas smell near stove');
  const w = world(); const A = JSON.stringify(mkDoc()); const B = (m) => { const x = mkDoc(); m(x); return JSON.stringify(x); };
  t('only flag/sent/updated differ -> not a public change', w.fiOnlyPhoneMarksChanged(A, B(x => { x.areas[0].issues[0].sent = { at: 'z' }; x.areas[0].issues[1].flag_send = true; x.updated = 'now'; })));
  t('a title edit IS a public change', !w.fiOnlyPhoneMarksChanged(A, B(x => { x.areas[0].issues[0].title = 'Changed'; })));
  t('garbage input is treated as changed (fail safe)', !w.fiOnlyPhoneMarksChanged('{bad', A) && !w.fiOnlyPhoneMarksChanged(A, '{bad'));
  // end to end: publish, mark an item sent -> stays published; real edit -> un-publishes
  const s = await seed(); const w2 = s.w;
  let p = await w2.fiPublish(w2.env, { id: s.id, rev: s.rev, ack_warnings: true });
  t('published for the test', p.status === 200, p.body);
  const d2 = mkDoc(); d2.areas[0].issues[0].flag_send = true; d2.areas[0].issues[0].sent = { at: '2026-10-28T15:00:00Z', to: 'x@y.zz', via: 'email' }; d2.updated = '2026-10-28T15:00:01Z';
  const sv = await w2.fiSave(w2.env, { id: s.id, base_rev: s.rev, doc: d2 });
  t('marking an item sent keeps a published report published', sv.status === 200 && sv.body.unpublished === false && sv.body.status === 'published', sv.body);
  const d3 = JSON.parse(JSON.stringify(d2)); d3.areas[0].issues[0].title = 'Gas smell near the stove';
  const sv2 = await w2.fiSave(w2.env, { id: s.id, base_rev: sv.body.rev, doc: d3 });
  t('a real edit still un-publishes', sv2.body.unpublished === true && sv2.body.status === 'draft', sv2.body);
}
function w0() { return world(); }

// ── 10. wiring ──
{
  t('route is wired', /path === '\/fi\/urgent-send'\)\s+return await fiRoute\(env, 'urgent-send', \(\) => fiUrgentSend\(env, body\)\)/.test(src));
  t('staging write gate: only TEST- inspections', /path === '\/fi\/email-report' \|\| path === '\/fi\/urgent-send'\) return String\(\(body && body\.id\) \|\| ''\)\.startsWith\('TEST-'\)/.test(src));
  const fn = src.slice(src.indexOf('async function fiUrgentSend('), src.indexOf('// ═══ Part 2 (Oct 15 2026'));
  t('the text window is checked before any SMS call', fn.indexOf('win.open') > -1 && fn.indexOf('win.open') < fn.indexOf('await sendSMS('));
  t('the text goes only after the email succeeded', fn.indexOf('await gmailSendEmailMulti(') < fn.indexOf('await sendSMS('));
  t('texts use sendSMS (global kill switch applies), never a queue that could hold/defer past 4pm', !/Message_Queue|smsGatedSend|enqueue/i.test(fn));
  t('the log row is written BEFORE anything is sent', fn.indexOf("logRow('sending')") > -1 && fn.indexOf("logRow('sending')") < fn.indexOf('await gmailSendEmailMulti('));
  t('items come from the saved inspection, not the request body', /fiUrgentCollect\(doc, ids\)/.test(fn) && !/body\.items/.test(fn));
  const g = src.slice(src.indexOf('async function gmailSendEmailMulti('), src.indexOf('// Read a receipt image/PDF with Claude vision'));
  t('staging email goes through the stub/redirect policy, never a real send', /isStaging\(env\)\) return await gmailSendEmail\(/.test(g));
  t('no silent catch without a reason', !/catch \([a-z0-9]+\) \{\s*\}/.test(fn));
}
console.log(`fi-urgent-send: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
