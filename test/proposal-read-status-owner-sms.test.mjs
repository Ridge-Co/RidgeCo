// Hub Improvements (Oct 14 2026): proposal read status (pixel + page-view log) and the owner heads-up text
// (8pm-8am ET hold, per-send override, skip if the owner already opened it). Run: node test/proposal-read-status-owner-sms.test.mjs
import fs from 'fs'; import assert from 'node:assert';
import { d16Deps, d16Queue } from './_d16-support.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const grabAny = (kw, name) => { const i = src.indexOf(kw + name + '('); if (i < 0) throw new Error('missing ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', i)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const grab = n => grabAny('function ', n), grabAsync = n => grabAny('async function ', n);
const grabConst = name => { const i = src.indexOf('const ' + name + ' ='); if (i < 0) throw new Error('missing ' + name); return src.slice(i, src.indexOf(';\n', i) + 1); };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const build = (names, deps) => new Function(...Object.keys(deps), names.join('\n') + '\nreturn {' + names.map(x => x.match(/function (\w+)/)[1]).join(',') + '};')(...Object.values(deps));

// ── quietHoldUntil: 8pm-8am ET window (October = EDT, UTC-4) ──
{
  const { quietHoldUntil } = build([grab('nyOffsetMinutes'), grab('etHour'), grab('quietHoldUntil')], {});
  ok(quietHoldUntil(new Date('2026-10-14T23:30:00Z'), 20, 8) === null, '7:30pm ET is NOT held (owner text allowed until 8pm)');
  ok(quietHoldUntil(new Date('2026-10-15T00:00:00Z'), 20, 8)?.toISOString() === '2026-10-15T12:00:00.000Z', '8:00pm ET held until 8:00am ET next day');
  ok(quietHoldUntil(new Date('2026-10-15T01:30:00Z'), 20, 8)?.toISOString() === '2026-10-15T12:00:00.000Z', '9:30pm ET held until 8:00am ET next day');
  ok(quietHoldUntil(new Date('2026-10-14T07:00:00Z'), 20, 8)?.toISOString() === '2026-10-14T12:00:00.000Z', '3:00am ET held until 8:00am ET the same day');
  ok(quietHoldUntil(new Date('2026-10-14T12:00:00Z'), 20, 8) === null, '8:00am ET is allowed again');
}

// ── pure classifiers ──
const H = new Function([grabConst('PROPOSAL_OPEN_AUTO_WINDOW_MS'), grabConst('PROPOSAL_BOT_UA'), grab('classifyProposalHit'), grab('proposalSeenByOwner')].join('\n') + '\nreturn { classifyProposalHit, proposalSeenByOwner };')();
{
  const { classifyProposalHit, proposalSeenByOwner } = H;
  const t0 = Date.parse('2026-10-14T15:00:00Z'), sent = '2026-10-14T15:00:00Z';
  ok(classifyProposalHit({ kind: 'email', ua: 'Mozilla/5.0 Safari', sentDate: sent, now: t0 + 30000 }) === 'auto', 'email image fetched 30s after send = prefetch, not an open');
  ok(classifyProposalHit({ kind: 'email', ua: 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)', sentDate: sent, now: t0 + 600000 }) === 'real', 'Gmail proxy 10 min later = real open');
  ok(classifyProposalHit({ kind: 'page', ua: 'Mozilla/5.0', sentDate: sent, now: t0 + 1000 }) === 'real', 'a page view is always real (even right after send)');
  ok(classifyProposalHit({ kind: 'page', ua: 'Slackbot-LinkExpanding 1.0', sentDate: sent, now: t0 + 1e7 }) === 'ignore', 'link-preview bot ignored');
  ok(classifyProposalHit({ kind: 'email', ua: 'python-requests/2.31', sentDate: '', now: t0 }) === 'ignore', 'scripted fetch ignored');
  ok(classifyProposalHit({ kind: 'email', ua: '', sentDate: '', now: t0 }) === 'real', 'no Sent_Date: cannot call it auto');
  ok(proposalSeenByOwner({ Page_First_Viewed: '2026-10-14T16:00:00Z' }) && proposalSeenByOwner({ Email_First_Opened: 'x' }), 'either signal = seen');
  ok(!proposalSeenByOwner({ Email_Auto_Opens: '3' }) && !proposalSeenByOwner({}) && !proposalSeenByOwner(null), 'auto opens alone / nothing = not seen');
}

// ── proposalRecordHit: what gets written, and failures are reported ──
const mkHit = (over) => { const st = { updates: [], tele: [], ensured: [] }; const deps = Object.assign({
  ensureColumns: async (e, t, c) => { st.ensured.push(t); }, logTelemetry: async (e, r) => { st.tele.push(r); },
  updateRow: async (e, t, id, f) => { st.updates.push({ t, id, f }); return { status: 200 }; },
  classifyProposalHit: H.classifyProposalHit, PROPOSAL_TRACK_COLS: ['A'] }, over || {});
  return { st, fn: build([grabAsync('proposalRecordHit')], deps).proposalRecordHit }; };
{
  let { st, fn } = mkHit(); await fn({}, { ID: '7', Sent_Date: '2026-10-14T10:00:00Z', Page_View_Count: '2', Page_First_Viewed: '2026-10-14T11:00:00Z' }, 'page', 'Mozilla');
  ok(st.updates.length === 1 && st.updates[0].f.Page_View_Count === '3' && st.updates[0].f.Page_First_Viewed === '2026-10-14T11:00:00Z' && st.updates[0].f.Page_Last_Viewed, 'page view: count +1, first-viewed kept, last-viewed set');
  ({ st, fn } = mkHit()); await fn({}, { ID: '7', Sent_Date: new Date().toISOString() }, 'email', 'Mozilla');
  ok(st.updates.length === 1 && Object.keys(st.updates[0].f).join() === 'Email_Auto_Opens', 'immediate email fetch only bumps Email_Auto_Opens');
  ({ st, fn } = mkHit()); await fn({}, { ID: '7', Sent_Date: '2026-10-14T10:00:00Z' }, 'email', 'Mozilla');
  ok(st.updates[0].f.Email_First_Opened && st.updates[0].f.Email_Open_Count === '1', 'later email fetch: first-opened + count 1');
  ({ st, fn } = mkHit()); await fn({}, { ID: '7' }, 'page', 'Googlebot/2.1');
  ok(st.updates.length === 0 && st.ensured.length === 0, 'bot: nothing written');
  ({ st, fn } = mkHit({ updateRow: async () => ({ status: 404 }) })); await fn({}, { ID: '7' }, 'page', 'Mozilla');
  ok(st.tele.length === 1 && st.tele[0].Success === 'FALSE' && /proposal_hit_log_failed/.test(st.tele[0].Job_Type), 'Scopes write fails: Ops_Telemetry row, page still works (no throw)');
  ({ st, fn } = mkHit({ ensureColumns: async () => { throw new Error('sheets down'); } })); await fn({}, { ID: '7' }, 'page', 'Mozilla');
  ok(st.tele.length === 1 && /sheets down/.test(st.tele[0].Notes), 'exception: logged, never thrown');
}

// ── pixel endpoint ──
{
  const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  for (const auth of [{ s: { ID: '7' } }, null]) {
    const hits = [];
    const { scopeProposalPixel } = build([grabAsync('scopeProposalPixel')], { PROPOSAL_PIXEL_GIF_B64: gif, scopeProposalLinkAuth: async () => auth, proposalRecordHit: async (e, s, k) => hits.push(k), logTelemetry: async () => {}, Response, atob });
    const r = await scopeProposalPixel({}, new URL('https://x/scope-proposal/px?t=abc'), 'ua');
    ok(r.status === 200 && r.headers.get('Content-Type') === 'image/gif' && /no-store/.test(r.headers.get('Cache-Control')), 'pixel: gif + no-store (' + (auth ? 'valid' : 'bad') + ' token)');
    ok((await r.arrayBuffer()).byteLength === Buffer.from(gif, 'base64').length && hits.length === (auth ? 1 : 0), 'pixel: valid gif bytes; records only for a valid token');
  }
}

// ── smsGatedSend: custom window + Skip_If_Seen ──
const QCOLS = JSON.parse(grabConst('MSG_QUEUE_COLS').replace(/^const MSG_QUEUE_COLS = /, '').replace(/;$/, '').replace(/'/g, '"'));
ok(QCOLS.includes('Skip_If_Seen'), 'Message_Queue has the Skip_If_Seen column');
const gate = (over) => { const st = { updates: [], raw: [], posts: [] }; const deps = Object.assign({
  ensureSmsInfra: async () => {}, fetchConfig: async () => ({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }),
  normalizePhone: p => String(p || '').replace(/\D/g, '') ? '+1' + String(p).replace(/\D/g, '').slice(-10) : '',
  sheetsRequest: async (e, m, p, b) => { if (m === 'GET') return { values: [QCOLS] }; st.posts.push(b); return {}; },
  nextSafeId: () => 7, appendedRowNumber: () => 0, guardAppendedIds: async (e, t, r, n, c, ids) => ({ ids: ids.map(String), row: 0, repaired: false }), mqReportFailure: async () => {}, isQuietHoursNow: () => false, nextQuietHoursEnd: () => new Date('2026-10-15T13:00:00Z'),
  quietHoldUntil: () => null,
  updateMessageQueueRow: async (e, id, f) => { st.updates.push({ id, f }); }, sendSMSRaw: async (e, to, msg) => { st.raw.push({ to, msg }); return { sid: 'SM1' }; },
  logMessageAudit: async () => {}, smsGateDecision: new Function(grab('smsGateDecision') + '\nreturn smsGateDecision;')(),
  smsToggleOn: v => String(v == null ? '' : v).toUpperCase() !== 'FALSE', translateForVendorDetailed: async () => ({}),
  etHour: () => 12, MSG_QUEUE_TAB: 'Message_Queue', MSG_QUEUE_COLS: QCOLS }, over || {}); Object.assign(deps, d16Deps());
  return { st, deps, fn: new Function(...Object.keys(deps), grabAsync('smsGatedSend') + '\nreturn smsGatedSend;')(...Object.values(deps)) }; };
const owner = { ID: '3', First_Name: 'Pat', Phone: '4105550142' };
const base = { message_type: 'owner_proposal_ready', recipient_type: 'owner', owner, message_body: 'hi', property: { ID: '50' }, quietWindow: { start: 20, end: 8 }, skip_if_seen: 'scope:7' };
{
  let seen; const { fn, st, deps } = gate({ quietHoldUntil: (d, s, e) => { seen = [s, e]; return new Date('2026-10-15T12:00:00Z'); } });
  const r = await fn({}, base);
  const row = Object.fromEntries(QCOLS.map((c, i) => [c, st.posts[0].values[0][i]]));
  ok(seen[0] === 20 && seen[1] === 8, 'custom window 20..8 is what the hold check uses');
  ok(r.held_for_quiet_hours && r.send_after === '2026-10-15T12:00:00.000Z' && st.raw.length === 0, 'inside window: held until 8am ET, nothing sent');
  ok(row.Skip_If_Seen === 'scope:7' && row.Status === 'pending', 'queue row stores Skip_If_Seen=scope:7 and stays pending');
}
{
  const { fn, st } = gate({ quietHoldUntil: () => new Date('2026-10-15T12:00:00Z') });
  const r = await fn({}, Object.assign({}, base, { bypassQuietHours: true }));
  ok(r.sent && st.raw.length === 1, 'override (bypassQuietHours) sends now even inside the window');
}
{
  const { fn, st } = gate({ isQuietHoursNow: () => true, quietHoldUntil: () => null });
  const r = await fn({}, base);
  ok(r.sent && st.raw.length === 1, 'custom window wins: 7:30pm (global quiet, outside 8pm-8am) still sends');
  const g = gate({ isQuietHoursNow: () => true });
  const r2 = await g.fn({}, { message_type: 'x', recipient_type: 'owner', owner, message_body: 'hi', property: { ID: '50' } });
  ok(r2.held_for_quiet_hours && g.st.raw.length === 0, 'no quietWindow: the global 7pm-9am rule is unchanged');
}
{
  const { fn } = gate({ fetchConfig: async () => ({ TWILIO_ENABLED: 'FALSE' }) });
  const r = await fn({}, base); ok(r.sent === false && r.send_ok === false, 'global OFF still blocks the owner text');
  const g2 = gate(); const r3 = await g2.fn({}, Object.assign({}, base, { owner: { ID: '3', Phone: '4105550142', SMS_Enabled: 'FALSE' } }));
  ok(r3.sent === false && r3.send_ok === false && g2.st.raw.length === 0, 'owner SMS_Enabled=FALSE blocks it');
}

// ── processQuietHoursQueue: skip-if-seen ──
const release = (rows, scopes, over) => { const st = { updates: [], raw: [], stamps: [], tele: [] }; const deps = Object.assign({
  ensureSmsInfra: async () => {}, fetchConfig: async () => ({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }),
  normalizePhone: p => '+1' + String(p || '').replace(/\D/g, '').slice(-10),
  fetchTab: async (e, t) => t === 'Message_Queue' ? rows : t === 'Scopes' ? (typeof scopes === 'function' ? scopes() : scopes) : t === 'Properties' ? [{ ID: '50', Owner_ID: '3' }] : t === 'Owners' ? [{ ID: '3', Phone: '4105550142' }] : [],
  MSG_QUEUE_TAB: 'Message_Queue', smsToggleOn: v => String(v == null ? '' : v).toUpperCase() !== 'FALSE',
  smsGateDecision: new Function(grab('smsGateDecision') + '\nreturn smsGateDecision;')(),
  sendSMSRaw: async (e, to, m) => { st.raw.push(to); return { sid: 'S' }; }, updateMessageQueueRow: async (e, id, f) => { st.updates.push({ id, f }); },
  proposalSeenByOwner: H.proposalSeenByOwner, proposalStampSms: async (e, id, s) => { st.stamps.push([id, s]); }, logTelemetry: async (e, r) => { st.tele.push(r); } }, over || {});
  return { st, fn: new Function(...Object.keys(deps), grabAsync('processQuietHoursQueue') + '\nreturn processQuietHoursQueue;')(...Object.values(deps)) }; };
const dueRow = (id, skip) => ({ ID: id, Status: 'pending', Send_After: '2026-01-01T12:00:00Z', Recipient_Type: 'owner', Recipient_Phone: '+14105550142', Property_ID: '50', Message_Body: 'hi', Skip_If_Seen: skip || '' });
{
  const { st, fn } = release([dueRow('1', 'scope:7')], [{ ID: '7', Page_First_Viewed: '2026-10-14T03:00:00Z' }]);
  const r = await fn({});
  ok(st.raw.length === 0 && r.results[0].skipped === 'owner_already_seen', 'owner opened it overnight: held text is NOT sent');
  ok(st.updates[0].f.Status === 'skipped' && /already opened/.test(st.updates[0].f.Gate_Snapshot), 'row marked skipped with the reason (visible, not silent)');
  ok(st.stamps[0][0] === '7' && st.stamps[0][1] === 'skipped_seen', 'Scope Owner_SMS_Status = skipped_seen');
}
{
  const { st, fn } = release([dueRow('1', 'scope:7')], [{ ID: '7', Email_Auto_Opens: '2' }]);
  await fn({}); ok(st.raw.length === 1 && st.stamps[0][1] === 'sent', 'not seen (only machine prefetch): text sends at 8am and Scope is stamped sent');
}
{
  const { st, fn } = release([dueRow('1', 'scope:7')], () => { throw new Error('sheets 500'); });
  await fn({}); ok(st.raw.length === 1 && st.tele.length === 1 && /sending anyway/.test(st.tele[0].Notes), 'skip check fails: text still sends, failure logged');
}
{
  const { st, fn } = release([dueRow('1', ''), dueRow('2', 'scope:7')], [{ ID: '7', Page_First_Viewed: 'x' }]);
  await fn({}); ok(st.raw.length === 1 && st.updates.some(u => u.id === '2' && u.f.Status === 'skipped'), 'rows without Skip_If_Seen release as before; only the flagged one is skipped');
}

// ── proposalOwnerSms outcomes ──
const sms = (tpl, over) => { const st = { stamps: [], tele: [], sent: [] }; const deps = Object.assign({
  fetchConfig: async () => ({ ASSISTANT_NAME: 'Riley' }), normalizePhone: p => String(p || '').replace(/\D/g, ''), SCOPE_SMS_QUIET_WINDOW: { start: 20, end: 8 },
  sendTemplatedSms: async (e, o) => { st.sent.push(o); return tpl; }, proposalStampSms: async (e, id, s) => { st.stamps.push([id, s]); }, logTelemetry: async (e, r) => { st.tele.push(r); } }, over || {});
  return { st, fn: build([grabAsync('proposalOwnerSms')], deps).proposalOwnerSms }; };
const args = (o) => Object.assign({ scopeId: '7', prop: { ID: '50' }, owner, addr: '9 Elm St', ownerName: 'Pat Lee', override: false }, o || {});
{
  let { st, fn } = sms({ sent: true, test_mode: false }); let r = await fn({}, args());
  ok(r.status === 'sent' && st.stamps[0][1] === 'sent' && st.tele.length === 0, 'sent: stamped, no alert');
  ok(st.sent[0].type === 'owner_proposal_ready' && st.sent[0].kind === 'owner' && st.sent[0].skip_if_seen === 'scope:7' && st.sent[0].quietWindow.start === 20 && st.sent[0].bypassQuietHours === false && st.sent[0].tokens.FirstName === 'Pat', 'call carries type, owner, window 20-8, skip_if_seen, no bypass');
  ({ st, fn } = sms({ sent: true })); await fn({}, args({ override: true })); ok(st.sent[0].bypassQuietHours === true, 'override passes bypassQuietHours');
  ({ st, fn } = sms({ held_for_quiet_hours: true, send_after: '2026-10-15T12:00:00.000Z' })); r = await fn({}, args());
  ok(r.status === 'held' && r.send_after && st.stamps[0][1] === 'held' && st.tele.length === 0, 'held: reported with send_after');
  ({ st, fn } = sms({ sent: false, send_ok: false, gate_snapshot: 'Global OFF' })); r = await fn({}, args());
  ok(r.status === 'blocked' && /Global OFF/.test(r.note) && st.tele.length === 1, 'blocked by gates: reported + telemetry');
  ({ st, fn } = sms({ sent: true, test_mode: true })); r = await fn({}, args()); ok(/TEST MODE/.test(r.note), 'test mode is called out so Brett knows the owner was not really texted');
  ({ st, fn } = sms({ error: 'boom' })); r = await fn({}, args()); ok(r.status === 'failed' && st.tele.length === 1, 'sendTemplatedSms error: failed + telemetry');
  ({ st, fn } = sms({ sent: true })); r = await fn({}, args({ owner: { ID: '3', Phone: '' } })); ok(r.status === 'no_phone' && st.sent.length === 0 && st.tele.length === 1, 'no owner phone: no send, reported');
  ({ st, fn } = sms({}, { sendTemplatedSms: async () => { throw new Error('x'); } })); r = await fn({}, args()); ok(r.status === 'failed', 'thrown error is caught and reported, email result unaffected');
}

// ── structural ──
ok(/'\/scope-proposal\/view','\/scope-proposal\/sign','\/scope-proposal\/px'/.test(src), 'pixel path is on the public allow-list');
ok(/path === '\/scope-proposal\/px'\)\s+return await scopeProposalPixel/.test(src), 'pixel route wired');
{
  const { buildScopeProposalEmailHtml } = build([grab('buildScopeProposalEmailHtml')], {});
  const withPx = buildScopeProposalEmailHtml({ ownerName: 'Pat', addr: '9 Elm', url: 'https://u', pixelUrl: 'https://w/scope-proposal/px?t=abc' });
  ok(/<img src="https:\/\/w\/scope-proposal\/px\?t=abc" width="1" height="1"/.test(withPx) && withPx.includes('View &amp; Sign Estimate'), 'email carries the pixel and keeps the button');
  ok(!/<img/.test(buildScopeProposalEmailHtml({ ownerName: 'Pat', addr: '9 Elm', url: 'https://u' })), 'no pixelUrl = no img (other callers unchanged)');
}
{
  const tpl = src.match(/Message_Type: 'owner_proposal_ready', Channel: 'sms', Subject: '', Body:\s*"([^"]+)"/);
  ok(tpl && /\{FirstName\}/.test(tpl[1]) && /\{Address\}/.test(tpl[1]) && /email/i.test(tpl[1]) && !/https?:|\$\d/.test(tpl[1]), 'template exists, points at the email, no link and no dollar amounts');
}
ok(/Skip_If_Seen: opts\.skip_if_seen/.test(src) && /if \(o\.skip_if_seen\) opts\.skip_if_seen/.test(src) && /else if \(o\.kind === 'owner'\) opts\.owner = o\.owner/.test(src), 'sendTemplatedSms passes owner / window / skip through');
ok(/sms_again === true/.test(src) && /override_quiet_hours === true/.test(src), 'send endpoint reads override_quiet_hours and sms_again');
ok(/preview'\) !== '1'\) await proposalRecordHit/.test(src), 'view logging is skipped with &preview=1');

// ── Oct 14 review fixes: skip-if-seen only counts views AT/AFTER the latest send; double-send guard ──
{
  const { proposalSeenByOwner } = H;
  const sent = '2026-10-14T15:00:00Z';
  ok(!proposalSeenByOwner({ Page_First_Viewed: '2026-10-13T12:00:00Z', Page_Last_Viewed: '2026-10-13T12:00:00Z' }, sent), 'a view from BEFORE the latest send does not cancel the text');
  ok(!proposalSeenByOwner({ Email_First_Opened: '2026-10-13T12:00:00Z', Email_Last_Opened: '2026-10-14T14:59:59Z' }, sent), 'an email open 1s before the send does not count');
  ok(proposalSeenByOwner({ Page_First_Viewed: '2026-10-13T12:00:00Z', Page_Last_Viewed: '2026-10-14T16:00:00Z' }, sent), 'an older first view + a fresh last view after the send = seen');
  ok(proposalSeenByOwner({ Email_First_Opened: '2026-10-14T15:00:00Z', Email_Last_Opened: '2026-10-14T15:00:00Z' }, sent), 'a view exactly at Sent_Date counts (at or after)');
  ok(proposalSeenByOwner({ Page_First_Viewed: '2026-10-13T12:00:00Z' }, ''), 'no Sent_Date: legacy any-view rule still applies');
  ok(!proposalSeenByOwner({ Email_Auto_Opens: '2' }, sent), 'auto opens never count');
}
ok(/proposalSeenByOwner\(sc, sc\.Sent_Date\)/.test(src), 'the release sweep passes the scope Sent_Date to proposalSeenByOwner');
{
  const body = src.slice(src.indexOf('async function scopeProposalSend('), src.indexOf('async function scopeProposalSend(') + 2500);
  const guardAt = body.indexOf('PROPOSAL_RESEND_GUARD_MS'), emailAt = body.indexOf('gmailSendEmail');
  ok(guardAt > 0 && emailAt > guardAt, 'the double-send guard runs BEFORE the email is sent');
  ok(/code: 'just_sent' \}, 409/.test(body), 'a too-soon repeat is refused with 409 just_sent');
  const m = /const PROPOSAL_RESEND_GUARD_MS = (\d+);/.exec(src);
  ok(m && +m[1] >= 30000 && +m[1] <= 300000, 'guard window is 30s-5min');
  // behavioural: run the real guard lines against fake clocks
  const guard = (Sent_Date, now) => { const lastSent = Date.parse(Sent_Date || ''); return !!(lastSent && (now - lastSent) < +m[1] && (now - lastSent) >= 0); };
  const t0 = Date.parse('2026-10-14T15:00:00Z');
  ok(guard('2026-10-14T15:00:00Z', t0 + 5000) && !guard('2026-10-14T15:00:00Z', t0 + 61000) && !guard('', t0) && !guard('garbage', t0), 'guard blocks within the window only; first send and bad stamps pass');
}
{
  const c = fs.readFileSync(new URL('../scope-creator.html', import.meta.url), 'utf8');
  ok(/window\._proposalSending/.test(c) && /_sb\.disabled=true/.test(c) && /finally\{ window\._proposalSending=false/.test(c), 'the Send button disables while a send is in flight and re-enables in finally');
}
console.log(`proposal-read-status-owner-sms: ${n} checks passed`);
