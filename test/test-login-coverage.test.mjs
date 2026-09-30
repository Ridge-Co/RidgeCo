import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const src = fs.readFileSync(new URL('worker.js', root), 'utf8');
// Static pages that never talk to the Hub: exempt. Everything else MUST load the test-login shim.
const STATIC = new Set(['eula.html', 'privacy-policy.html', 'privacy.html', 'terms.html']);
const isStatic = (f) => STATIC.has(f) || /^proposal-.*\.html$/.test(f);

test('every non-static *.html page loads test-login.js first in <head>', () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html') && !isStatic(f));
  assert.ok(pages.length > 20, 'expected many pages, got ' + pages.length);
  const missing = [];
  for (const f of pages) {
    const h = fs.readFileSync(new URL(f, root), 'utf8');
    const head = h.slice(0, h.indexOf('</head>') > 0 ? h.indexOf('</head>') : 4000);
    const at = head.indexOf('src="test-login.js"');
    const firstInline = head.search(/<script(?![^>]*\bsrc=)[^>]*>/);
    if (at < 0 || (firstInline >= 0 && firstInline < at)) missing.push(f);
  }
  assert.deepEqual(missing, [], 'add <script src="test-login.js"></script> right after <head> in: ' + missing.join(', '));
});

test('test-login.js is inert without ?testmode=1 and holds no secret', () => {
  const js = fs.readFileSync(new URL('test-login.js', root), 'utf8');
  assert.ok(js.includes("getItem('mh_testmode') === '1'") && js.includes('if (!on) return;'));
  assert.ok(!/WORKER_SECRET|HUB_TEST_TOKEN/.test(js.replace(/\/\*[\s\S]*?\*\//, '')));
});

test('worker: stg sessions are refused off staging; mint route + guard entries exist', () => {
  assert.ok(src.includes('if (_session.stg && !isStaging(env, url)) return json({ error: \'Unauthorized\' }, 401);'));
  assert.ok(src.includes("if (path === '/staging/ui-test-session') return await uiTestSessionHandler(env, url, body);"));
  assert.ok(src.includes("{ role, id, stg: 1 }"));
  for (const p of ['/wo/share-link', '/log-attachment', '/create-upload-session']) {
    const i = src.indexOf('const _WO_KEYED');
    assert.ok(i > 0 && src.indexOf("'" + p + "'", i) > i, p + ' missing from WO guard list');
  }
  assert.ok(src.includes('upload must target a TEST- work order'));
});

test('worker: guard stays default-deny (ends with return false)', () => {
  const i = src.indexOf('async function hubTestWriteAllowed');
  const end = src.indexOf('\n}\n', i);
  assert.match(src.slice(end - 40, end + 3), /return false;\s*\n}/);
});
