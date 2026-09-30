import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(kind, name) {
  const i = src.indexOf(kind + ' ' + name + '(');
  assert.ok(i >= 0, name + ' not found');
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i - (kind === 'async function' ? 0 : 0), k + 1); } }
}
const MAX = 120;
function build(cfg, staging = true, setLog = []) {
  const body = 'const UI_TEST_MAX_MINUTES=' + MAX + ';' +
    grab('async function', 'uiTestWindowOpen') + ';' + grab('async function', 'uiTestWindowHandler') +
    ';return {uiTestWindowOpen, uiTestWindowHandler};';
  return new Function('fetchConfig', 'isStaging', 'json', 'setConfigKey', body)(
    async () => cfg, () => staging, (o, s) => ({ o, s: s || 200 }), async (_e, b) => { setLog.push(b); return { success: true }; });
}
const soon = (m) => new Date(Date.now() + m * 60000).toISOString();
test('window closed when unset / past / garbage', async () => {
  for (const v of [undefined, '', 'nope', new Date(Date.now() - 1000).toISOString()])
    assert.equal(await build({ ui_test_mode_until: v }).uiTestWindowOpen({}), false, String(v));
});
test('window open when within max, closed when hand-edited far in the future', async () => {
  assert.equal(await build({ ui_test_mode_until: soon(30) }).uiTestWindowOpen({}), true);
  assert.equal(await build({ ui_test_mode_until: soon(120) }).uiTestWindowOpen({}), true);
  assert.equal(await build({ ui_test_mode_until: soon(24 * 60) }).uiTestWindowOpen({}), false);
});
test('handler: refuses on non-staging, refuses wrong token, clamps minutes, can close', async () => {
  const env = { HUB_TEST_TOKEN: 'T', WORKER_SECRET: 'S' };
  const req = (t) => ({ headers: { get: () => t } });
  let log = [];
  let h = build({}, false, log).uiTestWindowHandler;
  assert.equal((await h(env, {}, req('T'), { minutes: 60 })).s, 404);
  log = []; h = build({}, true, log).uiTestWindowHandler;
  assert.equal((await h(env, {}, req('__staging_ui_test__'), { minutes: 60 })).s, 401, 'sentinel cannot open its own window');
  assert.equal((await h(env, {}, req(''), { minutes: 60 })).s, 401);
  assert.equal(log.length, 0);
  let r = await h(env, {}, req('T'), { minutes: 9999 });
  assert.equal(r.o.open, true);
  assert.ok(Date.parse(log[0].value) - Date.now() <= MAX * 60000 + 1000);
  r = await h(env, {}, req('T'), { minutes: 0 });
  assert.equal(r.o.open, false); assert.equal(log[1].value, '');
  r = await h(env, {}, req('T'), {}); assert.equal(r.o.open, true);
});
test('auth gate: sentinel only after the token check, staging-gated, window-gated', () => {
  const g = src.indexOf('const _uiTestOk');
  assert.ok(g > 0);
  const blk = src.slice(g, g + 500);
  assert.match(blk, /_tok === UI_TEST_SENTINEL[\s\S]*isStaging\(env, url\)[\s\S]*await uiTestWindowOpen\(env\)/);
  assert.match(src, /!_hubTestOk && !_scoutOk/, 'gate still short-circuits on _hubTestOk');
  assert.match(src, /if \(path === '\/staging\/ui-test-window'\) return true;/);
});
test('page: testmode only on staging worker, sentinel never persisted', () => {
  const i = html.indexOf("__staging_ui_test__");
  assert.ok(i > 0);
  const blk = html.slice(i - 400, i + 900);
  assert.match(blk, /WORKER\.indexOf\('staging'\) !== -1/);
  assert.match(blk, /testmode=1/);
  assert.ok(!/setItem\([^)]*__staging_ui_test__/.test(html));
  assert.ok(!/localStorage\.setItem\(SECRET_KEY, AUTH_TOKEN\)/.test(blk));
});
