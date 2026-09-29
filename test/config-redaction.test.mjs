// GET /config used to return every Config-sheet key in plaintext -- including admin_password,
// Twilio_Recovery_Code and QB_REFRESH_TOKEN -- to anything holding the read-only production token
// (HUB_PROD_RO_TOKEN) or the staging test token (HUB_TEST_TOKEN). These pin the fix:
//   isSecretConfigKey / redactConfigForToken -- known + pattern-matched secret keys are hidden, the key
//     stays present, non-secret keys (app_name, twilio_phone, Access_Trade_Defaults, ...) pass through,
//     and a secret's value pasted into another key is masked too;
//   isConfigRedactionPlaceholder -- the write guard on /config/set so a masked value can't overwrite a real one;
//   scrubResponseForProdReadToken -- the read-only prod token additionally never sees login PINs;
//   source-level -- the /config route goes through getConfig, which applies the redactor for every caller,
//     setConfigKey refuses the placeholder, and internal fetchConfig() reads stay unredacted.
// All values below are obviously fake.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

const a = src.indexOf('const CONFIG_SECRET_KEYS');
const b = src.indexOf('function _utf8B64url');
if (a < 0 || b < 0 || b < a) throw new Error('helper block not found');
const block = src.slice(a, b);
const H = new Function('CORS', block + '\nreturn { isSecretConfigKey, redactConfigForToken, isConfigRedactionPlaceholder, scrubSecretsDeep, scrubResponseForProdReadToken, CONFIG_SECRET_PLACEHOLDER };')({});
const { isSecretConfigKey, redactConfigForToken, isConfigRedactionPlaceholder, scrubSecretsDeep, scrubResponseForProdReadToken, CONFIG_SECRET_PLACEHOLDER } = H;

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const HID = '(set — hidden)';
ok(CONFIG_SECRET_PLACEHOLDER === HID, 'placeholder keeps the existing "(set — hidden)" convention');

// --- key classification
for (const k of ['admin_password', 'Twilio_Recovery_Code', 'QB_REFRESH_TOKEN', 'GMAIL_REFRESH_TOKEN', 'ADMIN_PASSWORD',
  'stripe_api_key', 'X-API-KEY', 'twilio_auth', 'webhook_secret', 'some_token', 'signing_key', 'private_key', 'db_credentials',
  'backup_code', 'owner_pin', 'gmail_password', 'recovery_email_token'])
  ok(isSecretConfigKey(k) === true, k + ' is secret');
for (const k of ['app_name', 'twilio_phone', 'pricing_config', 'US_HOLIDAYS', 'Access_Trade_Defaults', 'admin_phone', 'worker_url',
  'app_version', 'failure_alert_enabled', 'dead_man_switch_enabled', 'receipt_recon_failures', 'GMAIL_TOKEN_UPDATED', 'Key', '', null, undefined])
  ok(isSecretConfigKey(k) === false, String(k) + ' is not secret');

// --- redaction
const cfg = {
  Key: 'Value', app_name: 'Maintenance Hub', twilio_phone: '(555) 010-0000',
  admin_password: 'fake-admin-pass-123456', Twilio_Recovery_Code: 'FAKERECOVERY000000', QB_REFRESH_TOKEN: 'fake-rt-000000000',
  GMAIL_REFRESH_TOKEN: 'fake-gm-000000000', custom_api_key: 'fake-key-111111', empty_secret: '', Access_Trade_Defaults: '{"HVAC":"TRUE"}',
  pricing_config: '{"tiers":[1]}', GMAIL_TOKEN_UPDATED: '2026-09-22T00:00:00Z',
  Gemini_Context_Snapshot: 'notes ... the password is fake-admin-pass-123456 ... end',
  short_secret: 'abc',
};
const before = JSON.stringify(cfg);
const r = redactConfigForToken(cfg, {});
ok(JSON.stringify(cfg) === before, 'input object is not mutated');
for (const k of ['admin_password', 'Twilio_Recovery_Code', 'QB_REFRESH_TOKEN', 'GMAIL_REFRESH_TOKEN', 'custom_api_key'])
  ok(k in r && r[k] === HID, k + ' key kept, value hidden');
ok(r.empty_secret === '', 'empty secret stays empty (nothing to hide)');
ok(r.short_secret === HID, 'short secret still hidden');
ok(r.app_name === 'Maintenance Hub' && r.twilio_phone === '(555) 010-0000' && r.Key === 'Value', 'plain keys unchanged');
ok(r.Access_Trade_Defaults === cfg.Access_Trade_Defaults && r.pricing_config === cfg.pricing_config, 'JSON config keys unchanged');
ok(r.GMAIL_TOKEN_UPDATED === '2026-09-22T00:00:00Z', 'timestamp key is not treated as a secret');
ok(!r.Gemini_Context_Snapshot.includes('fake-admin-pass-123456') && r.Gemini_Context_Snapshot.includes('(hidden)'), 'secret value embedded in another key is masked');
ok(!JSON.stringify(r).match(/fake-(admin|rt|gm|key)|FAKERECOVERY/), 'no fake secret value survives anywhere in the output');
ok(Object.keys(r).length === Object.keys(cfg).length, 'every key stays present');
ok(JSON.stringify(redactConfigForToken({})) === '{}' && JSON.stringify(redactConfigForToken(null)) === '{}' && JSON.stringify(redactConfigForToken('x')) === '{}', 'empty / non-object input ⇒ {}');
const odd = redactConfigForToken({ a_token: 12345, b_secret: null, c_password: undefined, d_secret: false, e_secret: 0, note: 5 });
ok(odd.a_token === HID && odd.b_secret === '' && odd.c_password === '' && odd.d_secret === '' && odd.note === 5, 'non-string values handled (number set ⇒ hidden, null/undefined/false ⇒ empty, plain number kept)');
const twice = redactConfigForToken(r);
ok(twice.admin_password === HID && twice.Gemini_Context_Snapshot === r.Gemini_Context_Snapshot, 'redacting an already-redacted object is stable');

// --- placeholder write guard
ok(isConfigRedactionPlaceholder('(hidden)') && isConfigRedactionPlaceholder(HID) && isConfigRedactionPlaceholder('  (hidden) ') && isConfigRedactionPlaceholder('(set - hidden)'), 'all placeholder spellings recognised');
ok(!isConfigRedactionPlaceholder('real-value') && !isConfigRedactionPlaceholder('') && !isConfigRedactionPlaceholder(null) && !isConfigRedactionPlaceholder(undefined) && !isConfigRedactionPlaceholder(42), 'real / empty / non-string values are not placeholders');

// --- prod read-only token: PIN + named secrets scrubbed deep
const sc = scrubSecretsDeep([{ ID: 'V1', Name: 'Fake Vendor', PIN: '0000', pin: '', nested: { PIN: 1234, admin_password: 'fake-pass-000000', ok: 'yes' } }], 0);
ok(sc[0].PIN === HID && sc[0].pin === '' && sc[0].nested.PIN === HID && sc[0].nested.admin_password === HID, 'PIN and named secrets scrubbed deep; empty stays empty');
ok(sc[0].ID === 'V1' && sc[0].Name === 'Fake Vendor' && sc[0].nested.ok === 'yes', 'other fields untouched');
const mk = (tok, method = 'GET') => new Request('https://x.test/vendors', { method, headers: tok ? { 'X-Auth-Token': tok } : {} });
const jres = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
const env = { HUB_PROD_RO_TOKEN: 'ro-fake-token', WORKER_SECRET: 'admin-fake-secret', HUB_TEST_TOKEN: 'test-fake-token' };
let res = await scrubResponseForProdReadToken(mk('ro-fake-token'), env, jres([{ PIN: '9999', Name: 'A' }]));
ok(JSON.parse(await res.text())[0].PIN === HID && res.status === 200, 'prod RO token: PIN scrubbed');
res = await scrubResponseForProdReadToken(mk('admin-fake-secret'), env, jres([{ PIN: '9999' }]));
ok(JSON.parse(await res.text())[0].PIN === '9999', 'admin secret: response untouched');
res = await scrubResponseForProdReadToken(mk('test-fake-token'), env, jres([{ PIN: '9999' }]));
ok(JSON.parse(await res.text())[0].PIN === '9999', 'staging test token: PIN response untouched (test data)');
res = await scrubResponseForProdReadToken(mk('ro-fake-token', 'POST'), env, jres([{ PIN: '9999' }]));
ok(JSON.parse(await res.text())[0].PIN === '9999', 'non-GET untouched');
res = await scrubResponseForProdReadToken(mk('ro-fake-token'), env, new Response('plain PIN 9999', { headers: { 'Content-Type': 'text/plain' } }));
ok((await res.text()) === 'plain PIN 9999', 'non-JSON untouched');
res = await scrubResponseForProdReadToken(mk('ro-fake-token'), {}, jres([{ PIN: '9999' }]));
ok(JSON.parse(await res.text())[0].PIN === '9999', 'no RO token configured ⇒ passthrough');
res = await scrubResponseForProdReadToken(mk('ro-fake-token'), env, new Response('{not json', { headers: { 'Content-Type': 'application/json' } }));
ok(res.status === 500, 'unparseable JSON to the RO token fails closed');

// --- source-level: route, handler, write guard, internal reads
ok(/if \(path === '\/config'\)\s+return await getConfig\(env\);/.test(src), 'GET /config route -> getConfig');
function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const getConfigSrc = grab('getConfig');
ok(/redactConfigForToken\(config\)/.test(getConfigSrc), 'getConfig applies redactConfigForToken to the response');
ok(!/return json\(config\)/.test(getConfigSrc), 'getConfig never returns the raw config object');
const fetchConfigSrc = grab('fetchConfig');
ok(!/redact/i.test(fetchConfigSrc), 'internal fetchConfig() stays unredacted (Worker code still reads real secrets)');
const setSrc = grab('setConfigKey');
ok(/isConfigRedactionPlaceholder\(value\)/.test(setSrc) && setSrc.indexOf('isConfigRedactionPlaceholder') < setSrc.indexOf("sheetsRequest(env, 'GET'"), 'setConfigKey refuses the placeholder before touching the sheet');
ok(/export default \{[\s\S]*scrubResponseForProdReadToken\(request, env, await _hubWorkerCore\.fetch/.test(src), 'export default wraps the core fetch with the prod-token scrubber');
ok(/async scheduled\(event, env, ctx\) \{ return await _hubWorkerCore\.scheduled/.test(src), 'cron scheduled() still delegated');
ok(!/config\[k\] = '\(set/.test(src), 'old GMAIL-only masking loop is gone (replaced by the general redactor)');
ok(/BUILD_VERSION = '2026-09-29\.1-config-secret-redaction'/.test(src), 'BUILD_VERSION bumped');

console.log('config-redaction: ' + n + ' assertions passed');
