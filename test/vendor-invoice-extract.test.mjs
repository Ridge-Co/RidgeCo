// Vendor invoice auto-read (OCR pre-fill) — the money-facing half. These pin the behaviour a
// vendor's two-tap submit depends on, using the REAL functions pulled out of worker.js:
//   (1) the extractor parses a clean/fenced/string-amount reply into the right shape;
//   (2) it FAILS OPEN on every bad reply (prose, network, no API key) — a vendor mid-submit
//       must never see a 500, the fields just stay blank and manual;
//   (3) PAT-031: money-facing routes to Claude (REASON), never the cheap Gemini tier;
//   (4) the picked file actually reaches the model (a blind OCR would "work" and be wrong);
//   (5) /wo/shared/bill-extract fails closed on a forged/expired/cross-WO token — and spends
//       no AI call when it does;
//   (6) neither endpoint writes to Vendor_Bills / Invoice_Review (they are read-only suggesters);
//   (7) the /selftest/invoice-extract canary gates on its own SELFTEST_TOKEN (never WORKER_SECRET),
//       says "not configured" rather than 401ing forever when the secret is missing, and reports
//       read_ok honestly so a fail-open blank can't be mistaken for a passing canary.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name){
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;   // keep the async prefix
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name){
  const i = src.indexOf('const ' + name + ' = {');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1) + ';';
}

const M = new Function(`
  const _tenc = new TextEncoder(), _tdec = new TextDecoder();
  ${grabConst('CORS')}
  ${grabConst('MODEL_REGISTRY')}
  ${grabConst('JOB_ROUTES')}
  ${grab('_b64urlBytes')}
  ${grab('_b64urlToBytes')}
  ${grab('_hmac')}
  ${grab('makeSessionToken')}
  ${grab('verifySessionToken')}
  ${grab('woShareAuth')}
  ${grab('json')}
  ${grab('bytesToB64')}
  ${grab('logTelemetry')}
  ${grab('routeAIValid')}
  ${grab('callGemini')}
  ${grab('callClaude')}
  ${grab('routeAICall')}
  ${grab('routeAI')}
  ${grab('invoiceExtract')}
  ${grab('vendorBillExtract')}
  ${grab('woSharedBillExtract')}
  ${grab('selfTestInvoiceExtract')}
  return { invoiceExtract, vendorBillExtract, woSharedBillExtract, selfTestInvoiceExtract, makeSessionToken, MODEL_REGISTRY };
`)();

const SECRET = 'test-worker-secret-abc123';
const env = { WORKER_SECRET: SECRET, ANTHROPIC_API_KEY: 'sk-test-stub' };

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

// Network stub: records every outbound call; answers Anthropic with a canned body so no test
// ever needs a real key or a real invoice photo.
let calls = [], reply = '', mode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); calls.push({ url: u, body: opts.body ? String(opts.body) : '' });
  if (u.includes('api.anthropic.com')) {
    if (mode === 'throw') throw new Error('network down');
    if (mode === 'http500') return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 500 });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: reply }], usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200 });
  }
  return new Response(JSON.stringify({ access_token: 'stub', values: [] }), { status: 200 });
};
const set = (r, m = 'ok') => { calls = []; reply = r; mode = m; };
const bytes = s => new Uint8Array(Buffer.from(s)).buffer;
const b64 = s => Buffer.from(s).toString('base64');
const billWrites = () => calls.filter(c => /sheets\.googleapis\.com/.test(c.url) && /Vendor_Bills|Invoice_Review/i.test(c.url + c.body));

(async () => {
  // ── 1. parsing & coercion ──
  set(JSON.stringify({ vendor_name:'Test Vendor LLC', invoice_number:'INV-4471', invoice_date:'2026-08-14', amount:1284.50, line_items:['2 hrs labor'], notes:'' }));
  let r = await M.invoiceExtract(env, bytes('jpeg'), 'image/jpeg');
  t('clean JSON -> numeric amount', r.amount === 1284.50, r.amount);
  t('clean JSON -> invoice number', r.invoice_number === 'INV-4471', r.invoice_number);
  t('clean JSON -> invoice date', r.invoice_date === '2026-08-14', r.invoice_date);
  t('clean JSON -> no error flags', !r._error && !r._parse_error);

  set(JSON.stringify({ amount: '1284.50' }));
  t('string amount coerced to number', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg')).amount === 1284.50);
  set(JSON.stringify({ amount: '$1,284.50' }));
  t('currency-formatted amount -> null, never NaN', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg')).amount === null);
  set(JSON.stringify({ amount: null }));
  t('null amount stays null', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg')).amount === null);
  set('```json\n{"amount":42.5,"invoice_number":"F-1"}\n```');
  r = await M.invoiceExtract(env, bytes('x'), 'image/jpeg');
  t('markdown-fenced JSON parses', r.amount === 42.5 && r.invoice_number === 'F-1', r);
  set(JSON.stringify({ amount: 5, line_items: 'not-an-array' }));
  t('non-array line_items -> []', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg')).line_items.length === 0);
  set(JSON.stringify({ amount: 5, line_items: Array.from({ length: 80 }, (_, i) => 'i' + i) }));
  t('line_items capped at 30', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg')).line_items.length === 30);

  // ── 2. fail open — a vendor mid-submit never sees a 500 ──
  set("I'm sorry, I can't read this blurry image.");
  r = await M.invoiceExtract(env, bytes('x'), 'image/jpeg');
  t('prose reply -> _parse_error, blank fields', r._parse_error === true && r.amount === null && r.invoice_number === '');
  set('', 'throw');
  t('network throw -> _error, no exception', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg'))._error === true);
  set('', 'http500');
  t('Claude 500 -> _error, no exception', (await M.invoiceExtract(env, bytes('x'), 'image/jpeg'))._error === true);
  set(JSON.stringify({ amount: 1 }));
  t('missing ANTHROPIC_API_KEY -> _error, no exception', (await M.invoiceExtract({ WORKER_SECRET: SECRET }, bytes('x'), 'image/jpeg'))._error === true);

  // ── 3. PAT-031 — money-facing pins to Claude, never the cheap tier ──
  set(JSON.stringify({ amount: 1 }));
  await M.invoiceExtract(env, bytes('x'), 'image/jpeg');
  const ai = calls.filter(c => c.url.includes('api.anthropic.com'));
  t('routed to Anthropic', ai.length === 1, ai.length);
  t('never touched the Gemini/cheap tier', calls.filter(c => /generativelanguage|gemini/i.test(c.url)).length === 0);
  t('used the REASON Claude model', ai[0] && ai[0].body.includes(M.MODEL_REGISTRY.REASON.model), M.MODEL_REGISTRY.REASON.model);

  // ── 4. the picked file actually reaches the model (blind-OCR guard) ──
  set(JSON.stringify({ amount: 1 }));
  await M.invoiceExtract(env, bytes('HELLO-INVOICE-BYTES'), 'image/jpeg');
  let content = JSON.parse(calls.find(c => c.url.includes('anthropic')).body).messages[0].content;
  t('request carries an image block', Array.isArray(content) && content[0].type === 'image', content[0] && content[0].type);
  t('image payload is the real file bytes', Buffer.from(content[0].source.data, 'base64').toString() === 'HELLO-INVOICE-BYTES');
  t('prompt travels with the image', content[1].type === 'text' && content[1].text.includes('VENDOR INVOICE'));
  set(JSON.stringify({ amount: 1 }));
  await M.invoiceExtract(env, bytes('%PDF-1.4'), 'application/pdf');
  content = JSON.parse(calls.find(c => c.url.includes('anthropic')).body).messages[0].content;
  t('PDF -> document block, not image', content[0].type === 'document' && content[0].source.media_type === 'application/pdf', content[0].type);
  set(JSON.stringify({ amount: 1 }));
  await M.invoiceExtract(env, bytes('x'), 'image/jpeg; charset=binary');
  content = JSON.parse(calls.find(c => c.url.includes('anthropic')).body).messages[0].content;
  t('mime ;charset suffix stripped', content[0].source.media_type === 'image/jpeg', content[0].source.media_type);

  // ── 5. POST /vendor-bill/extract ──
  set(JSON.stringify({ amount: 99.99 }));
  t('missing image_b64 -> 400', (await M.vendorBillExtract(env, {})).status === 400);
  set(JSON.stringify({ amount: 1 }));
  t('bad base64 -> 400', (await M.vendorBillExtract(env, { image_b64: '!!!not-base64!!!' })).status === 400);
  set(JSON.stringify({ amount: 99.99, invoice_number: 'V-1' }));
  let res = await M.vendorBillExtract(env, { image_b64: b64('bytes'), mime: 'image/jpeg' });
  let body = await res.json();
  t('happy path -> 200 {success, extract}', res.status === 200 && body.success === true && body.extract.amount === 99.99, res.status);
  t('no write to Vendor_Bills / Invoice_Review', billWrites().length === 0, billWrites().length);

  // ── 6. POST /wo/shared/bill-extract — fails closed, and spends nothing when it does ──
  set(JSON.stringify({ amount: 1 }));
  t('forged token -> 401', (await M.woSharedBillExtract(env, { st:'garbage', wo:'1042', image_b64:b64('x') })).status === 401);
  t('forged token spends NO AI call', calls.filter(c => c.url.includes('anthropic')).length === 0);

  const good = await M.makeSessionToken({ scope:'wo-share', wo:'1042' }, SECRET, 60);
  const wrongScope = await M.makeSessionToken({ scope:'wo-share-link', wo:'1042' }, SECRET, 60);
  const otherSecret = await M.makeSessionToken({ scope:'wo-share', wo:'1042' }, 'other-secret', 60);
  const expired = await M.makeSessionToken({ scope:'wo-share', wo:'1042' }, SECRET, -10);

  set(JSON.stringify({ amount: 1 }));
  t('link-scope token rejected', (await M.woSharedBillExtract(env, { st:wrongScope, wo:'1042', image_b64:b64('x') })).status === 401);
  t('token signed with another secret rejected', (await M.woSharedBillExtract(env, { st:otherSecret, wo:'1042', image_b64:b64('x') })).status === 401);
  t('expired token rejected', (await M.woSharedBillExtract(env, { st:expired, wo:'1042', image_b64:b64('x') })).status === 401);
  t('valid token but WRONG WO rejected (cross-WO)', (await M.woSharedBillExtract(env, { st:good, wo:'1043', image_b64:b64('x') })).status === 401);
  t('valid token, missing image -> 400', (await M.woSharedBillExtract(env, { st:good, wo:'1042' })).status === 400);

  set(JSON.stringify({ amount: 250, invoice_number: 'S-7', invoice_date: '2026-08-01' }));
  res = await M.woSharedBillExtract(env, { st:good, wo:'1042', image_b64:b64('x'), mime:'image/png' });
  body = await res.json();
  t('valid token -> 200 + extract', res.status === 200 && body.success === true && body.extract.amount === 250, res.status);
  t('no write to Vendor_Bills / Invoice_Review', billWrites().length === 0, billWrites().length);

  // ── 7. the live OCR canary's own gate (scripts/selftest-invoice.mjs calls this) ──
  set(JSON.stringify({ amount: 1284.50, invoice_number: 'RT-2049', invoice_date: '2026-08-14', vendor_name: 'Ridgeline Test Plumbing LLC' }));
  let sres = await M.selfTestInvoiceExtract({ ANTHROPIC_API_KEY: 'sk-test-stub' }, { token: 'anything', image_b64: b64('x') });
  t('canary: no SELFTEST_TOKEN configured -> 503, not a confusing 401', sres.status === 503, sres.status);
  t('canary: unconfigured spends NO AI call', calls.filter(c => c.url.includes('anthropic')).length === 0);

  const senv = { ANTHROPIC_API_KEY: 'sk-test-stub', SELFTEST_TOKEN: 'canary-token-xyz' };
  set(JSON.stringify({ amount: 1 }));
  t('canary: wrong token -> 401', (await M.selfTestInvoiceExtract(senv, { token: 'wrong', image_b64: b64('x') })).status === 401);
  t('canary: wrong token spends NO AI call', calls.filter(c => c.url.includes('anthropic')).length === 0);
  t('canary: empty token -> 401', (await M.selfTestInvoiceExtract(senv, { token: '', image_b64: b64('x') })).status === 401);
  t('canary: token as a prefix of the real one -> 401', (await M.selfTestInvoiceExtract(senv, { token: 'canary-token-xy', image_b64: b64('x') })).status === 401);
  t('canary: WORKER_SECRET is NOT accepted here', (await M.selfTestInvoiceExtract({ ...senv, WORKER_SECRET: SECRET }, { token: SECRET, image_b64: b64('x') })).status === 401);
  t('canary: right token, missing image -> 400', (await M.selfTestInvoiceExtract(senv, { token: 'canary-token-xyz' })).status === 400);

  set(JSON.stringify({ amount: 1284.50, invoice_number: 'RT-2049', invoice_date: '2026-08-14', vendor_name: 'Ridgeline Test Plumbing LLC' }));
  sres = await M.selfTestInvoiceExtract(senv, { token: 'canary-token-xyz', image_b64: b64('x'), mime: 'image/jpeg' });
  let sbody = await sres.json();
  t('canary: happy path -> 200', sres.status === 200, sres.status);
  t('canary: read_ok true on a real read', sbody.read_ok === true);
  t('canary: returns the parsed fixture values', sbody.extract.amount === 1284.50 && sbody.extract.invoice_number === 'RT-2049', JSON.stringify(sbody.extract));
  t('canary: reports the Claude model it used', /claude/i.test(sbody.model), sbody.model);
  t('canary: never echoes a secret back', !JSON.stringify(sbody).includes('canary-token-xyz') && !JSON.stringify(sbody).includes('sk-test-stub'));

  // The important one: invoiceExtract fails OPEN, so a blank result must NOT read as a pass.
  set('', 'throw');
  sbody = await (await M.selfTestInvoiceExtract(senv, { token: 'canary-token-xyz', image_b64: b64('x') })).json();
  t('canary: model unreachable -> read_ok FALSE (fail-open blank is not a pass)', sbody.read_ok === false, JSON.stringify(sbody.read_ok));
  t('canary: names the failure mode', sbody.error_flag === 'model_unreachable', sbody.error_flag);
  set('total is about twelve hundred dollars');
  sbody = await (await M.selfTestInvoiceExtract(senv, { token: 'canary-token-xyz', image_b64: b64('x') })).json();
  t('canary: unparseable reply -> read_ok FALSE', sbody.read_ok === false);
  t('canary: names it unparseable', sbody.error_flag === 'unparseable_reply', sbody.error_flag);

  globalThis.fetch = realFetch;
  console.log(`\nvendor-invoice-extract: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
