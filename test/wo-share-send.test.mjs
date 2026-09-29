// "Send to Vendor" is now a real send (Sep 28 2026): POST /wo/share-send texts the assigned vendor
// the no-login WO link through smsGatedSend. Real woShareBuild / woShareLink / woShareSend are
// extracted from worker.js and run against stubbed deps.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grabFrom(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (text.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const grab = n => grabFrom(src, n), grabH = n => grabFrom(html, n);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const WO = { ID: '1234', Property_ID: 'P1', Unit_ID: 'U1', Vendor_ID: 'V1', Share_Rev: '0' };
function harness(o) {
  o = o || {};
  const state = { sent: [], tel: [], translateCalls: [] };
  const vendors = o.vendors || [{ ID: 'V1', Name: 'Alex Perez', First_Name: 'Alex', Phone: '(410) 555-1212', Language: o.lang || 'en' }];
  const wos = o.wos || [WO];
  const deps = {
    ensureColumns: async () => {},
    fetchTabs: async () => [wos, [{ ID: 'P1', Address: '123 Main St' }], [{ ID: 'U1', Unit_Label: '2B' }], vendors],
    findWO: (list, id) => list.find(w => String(w.ID) === String(id)),
    _last4: p => String(p || '').replace(/\D/g, '').slice(-4),
    formatUnitLabel: l => 'Unit ' + l,
    makeSessionToken: async (p) => 'tok' + (state.tokN = (state.tokN || 0) + 1),
    WO_SHARE_LINK_TTL: 1000, env: { WORKER_SECRET: 's' },
    json: (b, status) => ({ status: status || 200, body: b }),
    plausiblyNonEnglish: new Function(grab('plausiblyNonEnglish') + '\nreturn plausiblyNonEnglish;')(),
    translateForVendorDetailed: async (e, v, t) => { state.translateCalls.push({ v, t }); return o.translateFails ? { text: t, original: t, translated: false } : { text: 'ES:' + t, original: t, translated: true }; },
    smsGatedSend: async (e, opts) => { state.sent.push(opts); return o.gate || { sent: true, send_ok: true, test_mode: false, gate_snapshot: 'all gates open', delivered_to: '+14105551212', queued_id: '55', message_body: opts.message_body, original_body: opts.original_body || '', translated_to: opts.translated_to || '' }; },
    logTelemetry: async (e, t) => { state.tel.push(t); },
  };
  const names = Object.keys(deps);
  const body = ['woShareBuild', 'woShareLink', 'woShareSend'].map(grab).join('\n') + '\nreturn { woShareBuild, woShareLink, woShareSend };';
  const fns = new Function(...names, body)(...names.map(k => deps[k]));
  return { fns, state, env: deps.env };
}

// ── woShareLink is unchanged for the copy flow ──
{
  const { fns, env } = harness({ lang: 'es' });
  const r = await fns.woShareLink(env, { wo_id: '1234', page_base: 'https://x.io/R/' });
  ok(r.status === 200 && r.body.success && r.body.link.startsWith('https://x.io/R/wo.html?wo=1234&t=tok'), 'share-link: still mints the same link format (token format untouched, page_base honored)');
  ok(r.body.language === 'es' && r.body.message === r.body.message_es && r.body.message_en && r.body.assigned && r.body.vendor_has_phone, 'share-link: still returns language/message/message_en/message_es/assigned/vendor_has_phone');
  ok((await fns.woShareLink(env, {})).status === 400 && (await fns.woShareLink(env, { wo_id: '9999' })).status === 404, 'share-link: 400 without wo_id, 404 for unknown WO');
}
// ── share-send validation ──
{
  const h = harness();
  ok((await h.fns.woShareSend(h.env, {})).status === 400, 'send: wo_id required');
  ok((await h.fns.woShareSend(h.env, { wo_id: '9999' })).status === 404, 'send: unknown WO is 404');
  ok(h.state.sent.length === 0, 'nothing sent on bad input');
}
{
  const h = harness({ wos: [Object.assign({}, WO, { Vendor_ID: '' })] });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234' });
  ok(r.status === 400 && r.body.success === false && r.body.code === 'no_vendor' && /No vendor is assigned/.test(r.body.error), 'no vendor assigned: clear error, nothing sent');
  ok(h.state.sent.length === 0, 'no vendor: smsGatedSend not called');
}
{
  const h = harness({ vendors: [{ ID: 'V1', Name: 'Alex Perez', Phone: '', Language: 'en' }] });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234' });
  ok(r.status === 400 && r.body.code === 'no_phone' && /no phone number on file/.test(r.body.error) && /Copy message/.test(r.body.error), 'vendor without phone: clear error that points at Copy message, nothing sent');
  ok(h.state.sent.length === 0, 'no phone: smsGatedSend not called');
}
// ── happy path (English vendor) ──
{
  const h = harness({ lang: 'en' });
  const stockEn = (await h.fns.woShareLink(h.env, { wo_id: '1234' })).body.message_en;
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234', lang: 'en', message: stockEn });
  const o = h.state.sent[0];
  ok(r.status === 200 && r.body.success === true && r.body.sent === true && r.body.language === 'en', 'happy path: success/sent/language');
  ok(o.message_type === 'vendor_wo_shared' && o.recipient_type === 'vendor' && o.wo_id === '1234' && o.vendor.ID === 'V1', 'goes through smsGatedSend as vendor_wo_shared for the assigned vendor');
  ok(o.already_localized === true, 'already_localized so the hook does not re-translate');
  ok(o.message_body.includes('/wo.html?wo=1234&t=') && /last 4 digits/.test(o.message_body), 'the message carries the WO link and the last-4 instruction');
  ok(h.state.translateCalls.length === 0, 'unedited English text for an English vendor: no translation');
  ok(r.body.sent_to === '(410) 555-1212' && r.body.delivered_to === '+14105551212' && r.body.vendor_name === 'Alex Perez' && r.body.message === o.message_body, 'response: sent_to, delivered_to, vendor_name, message');
  ok(h.state.tel[0].Skill_Or_Endpoint === '/wo/share-send' && h.state.tel[0].Success === 'TRUE', 'telemetry logged');
}
// ── language handling ──
{
  const h = harness({ lang: 'es' });
  const built = (await h.fns.woShareLink(h.env, { wo_id: '1234' })).body;
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234', message: built.message_es });   // lang omitted -> vendor language
  ok(r.body.language === 'es' && h.state.sent[0].message_body.startsWith('Hola') && h.state.translateCalls.length === 0, 'Spanish vendor: defaults to the stock Spanish message, unedited = no translation call');
}
{
  const h = harness({ lang: 'en' });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234', lang: 'es', message: 'Hi Alex, please call me. https://x.io/wo.html?wo=1234&t=abc' });
  const o = h.state.sent[0];
  ok(h.state.translateCalls.length === 1 && h.state.translateCalls[0].v.Language === 'es', 'edited English text + Español chosen: translated via translateForVendor (forced es)');
  ok(o.message_body.startsWith('ES:Hi Alex') && o.original_body.startsWith('Hi Alex') && o.translated_to === 'es' && o.already_localized === true, 'translated text is sent, English original + translated_to passed for the audit');
  ok(r.body.original_body.startsWith('Hi Alex') && r.body.language === 'es', 'response reports original_body');
}
{
  const h = harness({ lang: 'es' });
  await h.fns.woShareSend(h.env, { wo_id: '1234', lang: 'es', message: 'Hola Alex, llámeme por favor. https://x.io/wo.html?wo=1234&t=abc' });
  ok(h.state.translateCalls.length === 0, 'edited text that is already Spanish is not translated again');
}
{
  const h = harness({ lang: 'es' });
  await h.fns.woShareSend(h.env, { wo_id: '1234', lang: 'en', message: 'Hi Alex, here it is https://x.io/wo.html?wo=1234&t=abc' });
  ok(h.state.translateCalls.length === 0 && h.state.sent[0].message_body.startsWith('Hi Alex'), 'Brett picks English for a Spanish vendor: sent in English, never translated');
}
{
  const h = harness({ lang: 'en', translateFails: true });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234', lang: 'es', message: 'Hi Alex, please call. https://x.io/wo.html?wo=1234&t=abc' });
  ok(r.body.sent === true && h.state.sent[0].message_body.startsWith('Hi Alex') && !h.state.sent[0].original_body, 'translation failure: the English text still sends');
}
{
  const h = harness();
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234', lang: 'en', message: 'Hi Alex, see the work order.' });
  ok(r.body.link_appended === true && /\/wo\.html\?wo=1234&t=tok\d+$/.test(h.state.sent[0].message_body), 'a message edited down to no link gets the fresh link appended (never sent with no way in)');
  const h2 = harness();
  await h2.fns.woShareSend(h2.env, { wo_id: '1234' });
  ok(/\/wo\.html\?wo=1234/.test(h2.state.sent[0].message_body), 'empty message falls back to the stock message');
}
// ── gate outcomes surface clearly ──
{
  const h = harness({ gate: { sent: false, send_ok: false, gate_snapshot: 'Global OFF', queued_id: '56', message_body: 'x' } });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234' });
  ok(r.status === 200 && r.body.success === false && r.body.sent === false && /Blocked by SMS settings: Global OFF/.test(r.body.reason) && r.body.error === r.body.reason, 'gate refusal: success=false and the reason is surfaced');
  ok(h.state.tel[0].Success === 'FALSE', 'telemetry marks the blocked send');
}
{
  const h = harness({ gate: { sent: false, send_ok: true, held_for_quiet_hours: true, send_after: '2026-09-29T13:00:00.000Z', gate_snapshot: 'all gates open', queued_id: '57', message_body: 'x' } });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234' });
  ok(r.body.success === true && r.body.held_for_quiet_hours === true && r.body.sent === false && /quiet hours/.test(r.body.reason) && r.body.send_after, 'quiet-hours hold: success true, held flag + send_after + reason');
}
{
  const h = harness({ gate: { sent: false, send_ok: true, gate_snapshot: 'all gates open', queued_id: '58', message_body: 'x' } });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234' });
  ok(r.body.success === false && /Send failed/.test(r.body.reason), 'Twilio failure: success=false, "Send failed" reason');
}
{
  const h = harness({ gate: { sent: true, send_ok: true, test_mode: true, delivered_to: '+14439617927', gate_snapshot: 'all gates open', queued_id: '59', message_body: 'x' } });
  const r = await h.fns.woShareSend(h.env, { wo_id: '1234' });
  ok(r.body.test_mode === true && r.body.delivered_to === '+14439617927' && r.body.sent_to === '(410) 555-1212', 'test mode: response distinguishes the vendor phone from the number it was actually delivered to');
}

// ── routing / auth ──
{
  ok(/if \(path === '\/wo\/share-send'\)\s+return await woShareSend\(env, body\);/.test(src), 'route is registered');
  const roleBlock = src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('const ROLE_SCOPES') + 6000);
  ok(!roleBlock.includes('/wo/share-send') && !src.slice(0, src.indexOf("'/wo/shared','/wo/shared/unlock'")).includes("'/wo/share-send'"), '/wo/share-send is in neither a role scope nor PUBLIC_PATHS — admin-only, like /wo/share-link');
  ok(src.includes("path === '/wo/share-link'") && !/PUBLIC_PATHS[\s\S]{0,400}'\/wo\/share-link'/.test(src.slice(0, 5000)), '/wo/share-link stays admin-only too');
  const gate = src.slice(src.indexOf("if (path === '/wo/share-send') {"), src.indexOf("if (path === '/wo/share-send') {") + 700);
  ok(gate.includes("isTestRecord(env, 'Properties'") && gate.includes("isTestRecord(env, 'Vendors'"), 'hubTestWriteAllowed case: only a TEST- Property WO with a TEST- vendor');
  ok(grabFrom(src, 'smsGatedSend').includes('already_localized'), 'smsGatedSend honors already_localized');
}
// ── UI ──
{
  ok(html.includes('id="share-send-btn"') && html.includes('onclick="sendShareWO()"') && html.includes('📱 Send text to vendor'), 'modal has the real Send button');
  ok(html.includes("copyShare('msg')") && html.includes('revokeShare()') && html.includes('Copy message') && html.includes('Turn off old links'), 'Copy message and Turn off old links are kept');
  ok(html.includes('id="share-msg"') && /<textarea id="share-msg"/.test(html), 'message is an editable textarea');
  ok(html.includes('name="share-lang" value="en"') && html.includes('name="share-lang" value="es"') && html.includes('Español'), 'language radios English / Español');
  const open = grabH('openShareWO');
  ok(open.includes("'/wo/share-link'") && open.includes("res.language==='es'") && open.includes('res.vendor_phone'), 'modal still pre-fills from share-link and defaults language to the vendor language, showing vendor name + phone');
  const send = grabH('sendShareWO');
  ok(send.includes("'/wo/share-send'") && send.includes('btn.disabled = true') && send.includes('btn.disabled = false'), 'send posts to /wo/share-send and disables/re-enables the button (double-tap safe)');
  ok(send.includes('held_for_quiet_hours') && send.includes('r.reason') && send.includes('TEST MODE') && send.includes('Copy message'), 'UI surfaces sent / quiet-hours hold / gate refusal reason / test mode, and points at Copy on failure');
  ok(send.includes('_shareData.assigned') && send.includes('vendor_has_phone'), 'UI guards no-vendor and no-phone before calling');
  ok(send.includes("'Not sent") && send.includes('.catch('), 'network errors are shown, not swallowed');
  ok(html.includes("addBtn('📤 Send to Vendor','secondary',function(){openShareWO(woId);});"), 'the bottom-card Send to Vendor button still opens this modal');
  ok(/flex-wrap:wrap/.test(html.slice(html.indexOf('id="share-send-btn"') - 300, html.indexOf('id="share-send-btn"') + 100)), 'button row wraps at phone width');
}
console.log(`wo-share-send: ${n}/${n} passing`);
