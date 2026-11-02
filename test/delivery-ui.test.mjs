// Delivery UI pieces (Oct 23 2026, delivery watcher Phase 0/1): source-structure checks.
//   - command-center.html  "Today's deliveries" card
//   - index.html           WO detail "Create delivery" button
//   - deliveries.html      Needs Review / Cancelled / Source badge / driver note / duplicate Order # warning
// The headless-browser pass lives in test/manual-verify-delivery-ui.mjs (same split as the other UI features).
// Run: node --test test/delivery-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const cc = read('command-center.html');
const idx = read('index.html');
const dl = read('deliveries.html');
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
// grab a top-level `function name(` body by brace counting
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

test('every inline <script> block in the three pages parses (node --check equivalent)', () => {
  for (const [name, html] of [['command-center.html', cc], ['index.html', idx], ['deliveries.html', dl]]) {
    const blocks = inlineScripts(html);
    assert.ok(blocks.length >= 1, name + ' has inline scripts');
    blocks.forEach((b, i) => { assert.doesNotThrow(() => new vm.Script(b, { filename: name + '#' + i }), name + ' script #' + i + ' has a syntax error'); });
  }
});

// ───────────── command-center.html ─────────────
test('command center: Today\'s deliveries card reads the existing GET /deliveries, no new endpoint', () => {
  assert.ok(/getJSON\('\/deliveries'\)/.test(cc), 'uses the shared getJSON (same auth header + error text as the other cards)');
  assert.equal((cc.match(/\/deliveries/g) || []).length >= 1, true);
  assert.ok(!/\/deliveries\/today|\/deliveries\?today/.test(cc), 'no new endpoint');
  assert.ok(cc.includes('id="deliv-card"') || cc.includes("id=\"deliv-card\"") || cc.includes("id='deliv-card'") || cc.includes('deliv-card'), 'card has the deliv-card id');
  assert.ok(cc.includes('href="deliveries.html"'), 'links to deliveries.html');
});

test('command center: loadDeliveries never swallows a failure (the card shows it)', () => {
  const body = grab(cc, 'loadDeliveries');
  assert.ok(!/catch\s*\(\s*\w*\s*\)\s*\{\s*(return\s+null\s*;?)?\s*\}/.test(body), 'no empty catch / return null');
  assert.ok(/ok\s*:\s*false/.test(body) && /error/.test(body), 'returns {ok:false, error} on failure');
});

test('command center: deliveries card is escaped, uses ET "today" from the server, hides when nothing to show', () => {
  const body = grab(cc, 'deliveriesCard');
  assert.ok(/h\(/.test(body), 'dynamic strings go through h()');
  assert.ok(/\.today/.test(cc.slice(cc.indexOf('function loadDeliveries'))), 'uses the server-computed ET today');
  assert.ok(/return\s*''/.test(body), 'returns empty string (card hidden) when nothing today');
  assert.ok(/encodeURIComponent/.test(body), 'WO ids are URL-encoded in hrefs');
  assert.ok(/data-kind=/.test(body), 'card kind (today / review-only / error) is explicit');
  assert.ok(!/innerHTML\s*\+?=\s*[^;]*\b(d|x|r)\.(notes|address|delivery_address|order_number)\b(?![^;]*h\()/.test(body), 'no raw field concatenation');
});

test('command center: deliveries fetch is concurrent (not a serial extra round trip) and wired into render', () => {
  assert.ok(/const\s+delP\s*=\s*loadDeliveries\(\)/.test(cc), 'started alongside the other best-effort loaders');
  assert.ok(/deliveries\s*:\s*await delP/.test(cc), 'result passed to render');
  assert.ok(/deliveriesCard\(d\.deliveries\)/.test(cc), 'render calls deliveriesCard');
});

// ───────────── index.html ─────────────
test('index: WO detail has a Create delivery button that opens deliveries.html?wo_id=&property_id=', () => {
  assert.ok(/addBtn\(\s*'🚚 Create delivery'/.test(idx), 'button added to the WO detail actions');
  const body = grab(idx, 'deliveryCreateUrl');
  assert.ok(body.includes('deliveries.html?'), 'targets deliveries.html');
  assert.ok(body.includes('wo_id=') && body.includes('property_id='), 'carries wo_id and property_id');
  assert.ok((body.match(/encodeURIComponent/g) || []).length >= 2, 'values are URL-encoded');
});

test('index: deliveryCreateUrl builds the right URL (pure function, run in a sandbox)', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(grab(idx, 'deliveryCreateUrl'), ctx);
  const u = (wo) => ctx.deliveryCreateUrl(wo);
  assert.equal(u({ ID: 'WO-1', Property_ID: 'P1' }), 'deliveries.html?wo_id=WO-1&property_id=P1');
  assert.equal(u({ ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U9' }), 'deliveries.html?wo_id=WO-1&property_id=P1&unit_id=U9');
  assert.equal(u({ ID: 'WO-1' }), 'deliveries.html?wo_id=WO-1');
  assert.equal(u({ ID: 'WO 1&x=2', Property_ID: 'P#1' }), 'deliveries.html?wo_id=WO%201%26x%3D2&property_id=P%231');
});

test('index: the edit is surgical (no page-wide rewrite)', () => {
  assert.ok(idx.length > 1000000, 'index.html still intact');
  assert.equal((idx.match(/Create delivery/g) || []).length >= 1, true);
});

// ───────────── deliveries.html ─────────────
test('deliveries: status dropdown has Needs Review and Cancelled', () => {
  const m = dl.match(/<select id="df-status">([\s\S]*?)<\/select>/);
  assert.ok(m, 'status select exists');
  assert.ok(m[1].includes('Needs Review') && m[1].includes('Cancelled'));
});

test('deliveries: Needs Review bucket is first, Cancelled has a bucket, Source badge and driver note exist', () => {
  const b = grab(dl, 'bucket');
  assert.ok(/Needs Review/.test(b) && /'review'/.test(b), 'bucket() routes Needs Review to review');
  assert.ok(/Cancelled/.test(b), 'bucket() knows Cancelled');
  const r = grab(dl, 'render');
  assert.ok(r.indexOf('review') > -1 && r.indexOf('review') < r.indexOf('groups.today'), 'review section is emitted before Today');
  assert.ok(dl.includes('src-badge') && dl.includes('data-src'), 'source badge');
  assert.ok(dl.includes('driver-note') && /Driver calls Brett/i.test(dl), 'driver-calls note keyed on Delivery_Notes text');
  assert.ok(!dl.includes('Ridge Co (Brett) receives'), 'on-site contact is shown as stored, not hardcoded');
});

test('deliveries: edit form round-trips values that are not in the dropdowns (no blanking Onsite_Contact / Status)', () => {
  assert.ok(dl.includes('function setSel'), 'helper that adds a missing option');
  const e = grab(dl, 'openEdit');
  assert.ok(/setSel\(\s*'df-onsite'/.test(e) && /setSel\(\s*'df-status'/.test(e));
  assert.ok(/<option value="brett">/.test(dl), 'brett is a first-class on-site option');
});

test('deliveries: duplicate Order # warning runs before the add POST and never lets the check fail silently', () => {
  const s = grab(dl, 'saveD');
  const conf = s.indexOf('confirm(');
  const add = s.indexOf("api('POST','/delivery/add'");
  const dis = s.indexOf('btn.disabled=true');
  assert.ok(conf > -1 && add > conf, 'confirm happens before /delivery/add');
  assert.ok(dis > conf || s.indexOf('return') > conf, 'cancelling leaves the button enabled');
  assert.ok(dl.includes('function dupOrder'), 'dupOrder helper');
  assert.ok(/DELS_OK/.test(s), 'if the list never loaded the user is told duplicates could not be checked');
  const d = grab(dl, 'normOrder');
  assert.ok(/toUpperCase/.test(d) && /\[\^A-Z0-9\]/.test(d), 'order numbers compare case- and dash-insensitively');
});

test('deliveries: existing behavior kept (store dropdown, address prefill, relay endpoint)', () => {
  assert.ok(dl.includes('onStoreSelectChange') && dl.includes('KNOWN_STORES'));
  assert.ok(dl.includes('if(p && !addr.value) addr.value=p.Address'));
  assert.ok(dl.includes("api('POST','/delivery/relay'"));
  assert.ok(dl.includes('PREFILL = { wo_id:qs(\'wo_id\')'));
});

test('no dynamic string reaches innerHTML unescaped in the deliveries.html card code', () => {
  for (const fn of ['dcard', 'contactLabel', 'srcBadge', 'driverNote', 'statusPill', 'section']) {
    const body = grab(dl, fn).replace(/esc\((?:[^()]|\([^()]*\))*\)/g, 'ESC');   // drop every esc(...) call
    // what is left may only use d.* in tests / lookups (followed by ? || && ) , ] or compared), never concatenated into markup
    const left = [...body.matchAll(/\b(?:d|dup)\.(notes|order_number|store|delivery_address|linked_wo_ids|source|status|item_type|make_model|tenant_name|expected_date|expected_window|onsite_contact|id)\b(?!\s*[?|&),\]=!]|\.)/g)].map((m) => body.slice(m.index - 15, m.index + 35));
    assert.deepEqual(left, [], fn + ' concatenates a raw field: ' + JSON.stringify(left));
  }
});

// (A one-time PR-scope guard for PR #431 lived here. It diffed against main and so failed on every later branch
// that touches worker.js; removed once #431 merged.)
