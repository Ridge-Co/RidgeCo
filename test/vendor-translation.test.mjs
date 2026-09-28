// Vendor translation (Sep 28 2026): outbound vendor messages go out in the vendor's language.
// Pulls the REAL helpers + the REAL smsGatedSend out of worker.js (same brace-matching extraction
// as message-queue.test.mjs) and runs them against a stubbed Anthropic fetch and stubbed Sheets deps.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing ' + name);
  return src.slice(i, src.indexOf(';\n', i) + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- stub Anthropic: records every call; behavior switchable per test ----
let calls = [], mode = 'es';
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body); const prompt = body.messages[0].content;
  calls.push({ url, prompt, max_tokens: body.max_tokens });
  if (mode === 'throw') throw new Error('network down');
  if (mode === 'empty') return { json: async () => ({ content: [{ text: '' }] }) };
  if (mode === 'same') return { json: async () => ({ content: [{ text: prompt.split('\n\n').slice(1).join('\n\n') }] }) };
  const text = prompt.split('\n\n').slice(1).join('\n\n');
  if (mode === 'droplink') return { json: async () => ({ content: [{ text: 'Hola, aquí está la orden de trabajo (enlace omitido).' }] }) };
  if (mode === 'html-break') return { json: async () => ({ content: [{ text: '<div>' + text.replace(/<[^>]+>/g, '') + '</div>' }] }) };
  // "translate": keep tokens, swap a couple of English words for Spanish
  return { json: async () => ({ content: [{ text: text.replace('Hi ', 'Hola ').replace('New job', 'Trabajo nuevo').replace('Hold on', 'Espere').replace(/Welcome/g, 'Bienvenido') }] }) };
};

const H = new Function(
  grabConst('VENDOR_TRANSLATE_PRESERVE') + '\n' +
  ['vendorWantsSpanish', 'extractPreservedTokens', 'preservedTokensIntact', 'htmlTagSkeleton', 'translateText', 'translateForVendorDetailed', 'translateForVendor', 'translateVendorEmail'].map(grab).join('\n') +
  '\nreturn { VENDOR_TRANSLATE_PRESERVE, vendorWantsSpanish, extractPreservedTokens, preservedTokensIntact, htmlTagSkeleton, translateText, translateForVendorDetailed, translateForVendor, translateVendorEmail };'
)();
const env = { ANTHROPIC_API_KEY: 'test-key' };
const MSG = 'Hi Alex, New job at 123 Main St. Portal: https://ridge-co.github.io/RidgeCo/vendor.html PIN: ABC12345 Estimate $1,250.00 approved. Ref: WO-1234.';

// ── which vendors get translated ──
{
  ok(H.vendorWantsSpanish({ Language: 'es' }) && H.vendorWantsSpanish({ Language: ' ES ' }), "Language 'es' (any case/space) wants Spanish");
  ok(!H.vendorWantsSpanish({ Language: 'en' }) && !H.vendorWantsSpanish({ Language: '' }) && !H.vendorWantsSpanish({}) && !H.vendorWantsSpanish(null), 'en / blank / missing / null vendor never translates');
}
{
  calls = []; mode = 'es';
  const r = await H.translateForVendorDetailed(env, { Language: 'es' }, MSG);
  ok(r.translated === true && r.lang === 'es', 'es vendor: translated');
  ok(r.text.startsWith('Hola Alex') && r.text.includes('Trabajo nuevo'), 'es vendor: Spanish text returned');
  ok(r.original === MSG, 'es vendor: English original returned alongside for the audit');
  ok(calls.length === 1, 'exactly one model call');
  ok(calls[0].prompt.includes('English to Spanish') || calls[0].prompt.includes('from English to Spanish'), 'direction is English -> Spanish');
}
{
  calls = [];
  const a = await H.translateForVendorDetailed(env, { Language: 'en' }, MSG);
  const b = await H.translateForVendorDetailed(env, { Language: '' }, MSG);
  const c = await H.translateForVendorDetailed(env, undefined, MSG);
  ok(!a.translated && a.text === MSG && !b.translated && b.text === MSG && !c.translated && c.text === MSG, 'en / blank / no vendor: text unchanged');
  ok(calls.length === 0, 'en / blank vendors never cost a model call');
}
{
  calls = [];
  const r = await H.translateForVendorDetailed(env, { Language: 'es' }, MSG, { already_localized: true });
  ok(!r.translated && r.text === MSG && calls.length === 0, 'already_localized skips translation entirely (no double translating hand-built bilingual text)');
  const e = await H.translateForVendorDetailed(env, { Language: 'es' }, '   ');
  ok(!e.translated && calls.length === 0, 'blank text is never sent to the model');
}
// ── failure modes always fall back to the English original ──
for (const m of ['throw', 'empty', 'same']) {
  mode = m; calls = [];
  const r = await H.translateForVendorDetailed(env, { Language: 'es' }, MSG);
  ok(!r.translated && r.text === MSG, `model ${m}: English original is sent (never blocks a send)`);
}
{
  mode = 'es';
  const r = await H.translateForVendorDetailed({}, { Language: 'es' }, MSG);
  ok(!r.translated && r.text === MSG, 'no ANTHROPIC_API_KEY: English original');
}
// ── link / PIN / amount preservation ──
{
  mode = 'droplink';
  const r = await H.translateForVendorDetailed(env, { Language: 'es' }, MSG);
  ok(!r.translated && r.text === MSG && r.skipped_reason === 'preservation_check_failed', 'a translation that loses the link/PIN/amount is discarded and the English original is sent');
  mode = 'es';
  const good = await H.translateForVendorDetailed(env, { Language: 'es' }, MSG);
  ok(good.translated && good.text.includes('https://ridge-co.github.io/RidgeCo/vendor.html') && good.text.includes('ABC12345') && good.text.includes('$1,250.00') && good.text.includes('Ref: WO-1234'), 'link, PIN, dollar amount and Ref survive a good translation');
  const toks = H.extractPreservedTokens(MSG);
  ok(toks.includes('https://ridge-co.github.io/RidgeCo/vendor.html') && toks.includes('ABC12345') && toks.includes('$1,250.00'), 'token extractor sees the URL (no trailing punctuation), PIN value and dollar amount');
  ok(H.preservedTokensIntact('call 4439617927 $50', 'llame 4439617927 $50') && !H.preservedTokensIntact('call 4439617927 $50', 'llame $50'), 'phone-length digit runs are protected too');
}
{
  calls = []; mode = 'es';
  await H.translateForVendorDetailed(env, { Language: 'es' }, MSG);
  const p = calls[0].prompt;
  ok(/URL/.test(p) && /PIN/.test(p) && /dollar amount/.test(p) && /"Ref:"/.test(p) && /EXACTLY/.test(p), 'the prompt instructs the model to preserve URLs, PINs, amounts and Ref');
  calls = [];
  await H.translateText(env, 'hello', 'English', 'Spanish');
  ok(!/dollar amount/.test(calls[0].prompt) && calls[0].max_tokens === 600, 'translateText with no opts is byte-compatible with the old behavior (no preserve block, 600 tokens)');
}
// ── vendor email (subject + HTML) ──
{
  mode = 'es'; calls = [];
  const html1 = '<p>Hi Alex,</p><p>New job: <a href="https://x.co/a?b=1">open it</a></p>';
  const r = await H.translateVendorEmail(env, { Language: 'es' }, { subject: 'New job WO-1234', html: html1 });
  ok(r.translated && r.html.includes('<a href="https://x.co/a?b=1">') && r.subject.includes('WO-1234'), 'email: subject + body translated, tags/links kept');
  ok(calls.some(c => /keep every tag/i.test(c.prompt)), 'email body prompt says it is HTML and to keep every tag');
  mode = 'html-break';
  const b = await H.translateVendorEmail(env, { Language: 'es' }, { subject: 'S', html: html1 });
  ok(b.html === html1, 'email: if the model changes the HTML structure, the English HTML is kept');
  calls = []; mode = 'es';
  const c = await H.translateVendorEmail(env, { Language: 'es' }, { subject: 'S', html: html1, already_localized: true });
  const d = await H.translateVendorEmail(env, { Language: 'en' }, { subject: 'S', html: html1 });
  ok(!c.translated && !d.translated && calls.length === 0 && c.html === html1 && d.html === html1, 'email: already_localized / English vendor untouched');
}

// ── smsGatedSend: the one hook ──
const QCOLS = JSON.parse(grabConst('MSG_QUEUE_COLS').replace(/^const MSG_QUEUE_COLS = /, '').replace(/;$/, '').replace(/'/g, '"'));
function makeGate(overrides) {
  const state = { queue: [], updates: [], raw: [], audit: [], sheetsPosts: [] };
  const deps = Object.assign({
    ensureSmsInfra: async () => {}, fetchConfig: async () => ({ TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }),
    normalizePhone: p => String(p || '').replace(/\D/g, '') ? '+1' + String(p).replace(/\D/g, '').slice(-10) : '',
    sheetsRequest: async (e, method, path, body) => { if (method === 'GET') return { values: [QCOLS] }; state.sheetsPosts.push(body); return {}; },
    nextSafeId: () => 7, isQuietHoursNow: () => false, nextQuietHoursEnd: () => new Date('2026-09-29T13:00:00Z'),
    updateMessageQueueRow: async (e, id, f) => { state.updates.push({ id, f }); },
    sendSMSRaw: async (e, to, msg) => { state.raw.push({ to, msg }); return { sid: 'SM1' }; },
    logMessageAudit: async (e, a) => { state.audit.push(a); },
    smsGateDecision: new Function(grab('smsGateDecision') + '\nreturn smsGateDecision;')(),
    smsToggleOn: v => String(v == null ? '' : v).toUpperCase() !== 'FALSE',
    translateForVendorDetailed: H.translateForVendorDetailed,
    MSG_QUEUE_TAB: 'Message_Queue',
    MSG_QUEUE_COLS: QCOLS,
  }, overrides || {});
  const names = Object.keys(deps);
  const fn = new Function(...names, grab('smsGatedSend') + '\nreturn smsGatedSend;')(...names.map(k => deps[k]));
  return { fn, state, deps };
}
const queueRow = (state, deps) => { const cols = deps.MSG_QUEUE_COLS; const row = state.sheetsPosts[0].values[0]; return Object.fromEntries(cols.map((c, i) => [c, row[i]])); };
const vendorEs = { ID: '9', Name: 'Alex Perez', Phone: '4105551212', Language: 'es' };
{
  mode = 'es'; calls = [];
  const { fn, state, deps } = makeGate();
  const r = await fn(env, { wo_id: '1234', message_type: 'vendor_request_photos', recipient_type: 'vendor', vendor: vendorEs, message_body: MSG });
  const q = queueRow(state, deps);
  ok(r.sent === true, 'es vendor send goes through');
  ok(state.raw.length === 1 && state.raw[0].msg.startsWith('Hola Alex'), 'the SMS actually sent is the Spanish text');
  ok(q.Message_Body.startsWith('Hola Alex'), 'Message_Queue.Message_Body holds what was sent (so a later release/quiet-hours sweep sends Spanish too)');
  ok(q.Original_Body === MSG && q.Translated_To === 'es', 'Message_Queue.Original_Body keeps the English original, Translated_To=es');
  ok(state.audit.length === 1 && state.audit[0].originalBody === MSG && state.audit[0].translatedTo === 'es' && state.audit[0].messageBody.startsWith('Hola'), 'WO_Audit row carries the Spanish sent text + the English original');
  ok(calls.length === 1, 'one model call per send');
  ok(r.original_body === MSG && r.translated_to === 'es' && r.message_body.startsWith('Hola'), 'return value exposes both bodies');
}
{
  mode = 'es'; calls = [];
  const { fn, state, deps } = makeGate();
  await fn(env, { wo_id: '1234', message_type: 'vendor_request_photos', recipient_type: 'vendor', vendor: { ID: '10', Name: 'Sam', Phone: '4105551213', Language: 'en' }, message_body: MSG });
  const q = queueRow(state, deps);
  ok(state.raw[0].msg === MSG && q.Original_Body === '' && q.Translated_To === '' && calls.length === 0, 'English/blank-language vendor: untouched, no model call, no Original_Body');
}
{
  calls = [];
  const { fn, state } = makeGate();
  await fn(env, { wo_id: '1234', message_type: 'vendor_job_assigned', recipient_type: 'vendor', vendor: vendorEs, message_body: 'Hola, ya está en español.', already_localized: true });
  ok(calls.length === 0 && state.raw[0].msg === 'Hola, ya está en español.', 'already_localized: no second translation (assignVendor / add-email / invoice confirmation style bodies)');
}
{
  calls = [];
  const { fn, state } = makeGate();
  await fn(env, { wo_id: '1234', message_type: 'tenant_manual', recipient_type: 'tenant', tenant: { ID: '5', Phone: '4105551214', Language: 'es', First_Name: 'T' }, message_body: MSG });
  ok(calls.length === 0 && state.raw[0].msg === MSG, 'tenant recipients are never touched by the vendor hook, even with a Language column');
}
{
  mode = 'throw';
  const { fn, state, deps } = makeGate();
  const r = await fn(env, { wo_id: '1234', message_type: 'vendor_request_photos', recipient_type: 'vendor', vendor: vendorEs, message_body: MSG });
  ok(r.sent === true && state.raw[0].msg === MSG && queueRow(state, deps).Original_Body === '', 'translation failure: the English message still sends (never blocks) and no fake Original_Body is recorded');
}
{
  mode = 'es';
  const { fn, state } = makeGate({ isQuietHoursNow: () => true });
  const r = await fn(env, { wo_id: '1234', message_type: 'vendor_request_photos', recipient_type: 'vendor', vendor: vendorEs, message_body: MSG });
  ok(r.held_for_quiet_hours === true && state.raw.length === 0 && r.message_body.startsWith('Hola'), 'quiet-hours hold: nothing sent, but the queued (and later released) body is already Spanish');
  ok(state.audit[0].outcome === 'held_quiet_hours' && state.audit[0].originalBody === MSG, 'held audit row also keeps the English original');
}
{
  const { fn, state } = makeGate({ fetchConfig: async () => ({ TWILIO_ENABLED: 'FALSE' }) });
  const r = await fn(env, { wo_id: '1234', message_type: 'vendor_request_photos', recipient_type: 'vendor', vendor: vendorEs, message_body: MSG });
  ok(r.sent === false && r.send_ok === false && state.raw.length === 0 && /Global OFF/.test(r.gate_snapshot), 'gates still decide whether it sends: Global OFF blocks even a translated message');
}
{
  mode = 'es';
  const { fn, state, deps } = makeGate();
  await fn(env, { wo_id: '1234', message_type: 'vendor_wo_shared', recipient_type: 'vendor', vendor: vendorEs, message_body: 'Hola', already_localized: true, original_body: 'Hi', translated_to: 'es' });
  ok(queueRow(state, deps).Original_Body === 'Hi' && queueRow(state, deps).Translated_To === 'es', 'callers that translated themselves (Send to Vendor) can pass original_body/translated_to through to the audit');
}

// ── structural: wiring at every vendor send site ──
{
  const sms = grab('smsGatedSend');
  ok(sms.includes("kind === 'vendor' && !opts.already_localized") && sms.includes('translateForVendorDetailed'), 'smsGatedSend translates for vendor recipients unless already_localized');
  ok(sms.indexOf('translateForVendorDetailed') < sms.indexOf("sheetsRequest(env, 'POST', `/values/${MSG_QUEUE_TAB}:append"), 'translation happens BEFORE the queue write');
  ok(!/sendSMSRaw\(env, deliveredTo, opts\.message_body\)/.test(sms), 'the raw send uses the (possibly translated) body, not opts.message_body');
  ok(/MSG_QUEUE_COLS = \[[^\]]*'Original_Body','Translated_To'\]/.test(src), 'Message_Queue gets Original_Body + Translated_To (ensureColumns adds them to the live tab)');
  ok(/WO_AUDIT_MSG_COLS = \[[^\]]*'Original_Body', 'Translated_To'\]/.test(src), 'WO_Audit gets Original_Body + Translated_To');
  const assign = src.slice(src.indexOf("message_type: 'vendor_job_assigned'") - 200, src.indexOf("message_type: 'vendor_job_assigned'") + 260);
  ok(assign.includes('already_localized: true'), 'assignVendor (hand-built bilingual) is marked already_localized');
  const pin = grab('sendPinMessage');
  ok(pin.includes('translateForVendorDetailed(env, vendorRec, message)') && pin.includes('sendSMS(env, phone, outMessage)'), 'PIN/welcome-style direct sendSMS to a vendor is translated');
  const un = grab('unapproveEstimate'), ap = grab('approveEstimate');
  ok(un.includes('translateForVendorDetailed(env, vendor, msgEn)'), 'estimate unapprove hold text to the vendor is translated');
  ok(ap.includes('notifyVendorTemplated(') && grab('sendTemplatedSms').includes('smsGatedSend(env, opts)') && !/already_localized/.test(grab('sendTemplatedSms')), 'estimate approve text goes via the templated smsGatedSend path (translated by the gate hook, not marked already_localized)');
  ok(!/sendVendorInvoiceConfirmationEmail[\s\S]{0,200}translateForVendor/.test(src.slice(src.indexOf('async function sendVendorInvoiceConfirmationEmail'), src.indexOf('async function sendVendorInvoiceConfirmationEmail') + 400)), 'the invoice-confirmation email (hand-built bilingual) is not double translated');
}
// ── Language dropdown on Add / Edit Vendor ──
{
  ok(html.includes('id="v-language"') && html.includes('id="ev-language"'), 'Add Vendor and Edit Vendor modals both have a Language dropdown');
  ok(/<select id="v-language">\s*<option value="en">English<\/option><option value="es">Español<\/option>/.test(html.replace(/\n/g, '')) || html.includes('<select id="v-language"><option value="en">English</option><option value="es">Español</option></select>'), 'options are English / Español');
  ok(html.includes("Language:document.getElementById('v-language').value==='es'?'es':'en'") && html.includes("Language:document.getElementById('ev-language').value==='es'?'es':'en'"), 'submitAddVendor / submitEditVendor write Language en|es');
  ok(html.includes("document.getElementById('ev-language').value=(String(v.Language||'').toLowerCase()==='es')?'es':'en'"), 'Edit modal loads the vendor current Language');
  ok(/\/vendor\/add'\)[^\n]*'Language'/.test(src) && /\/vendor\/update'\)[^\n]*'Language'/.test(src), '/vendor/add and /vendor/update ensureColumns the Language column so the write can never silently drop');
}
console.log(`vendor-translation: ${n}/${n} passing`);