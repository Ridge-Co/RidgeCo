// Queue #117 phase 1 (Nov 24 2026): move-in vs move-out comparison in the field inspection app. Read-only: two inspections and one photo read, nothing written.
import fs from 'fs';
import assert from 'node:assert';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
function grab(name, text = src) {
  const i = text.indexOf((text.includes('async function ' + name + '(') ? 'async function ' : 'function ') + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = text.indexOf('{', text.indexOf(')', i));
  for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (!d) break; } }
  return text.slice(i, j + 1);
}
const pure = ['fiAreaKey', 'fiCompareSide', 'fiCompareDocs'];
const P = new Function(pure.map(n => grab(n)).join('\n') + '\nreturn { ' + pure.join(', ') + ' };')();

const A = (id, name, extra) => Object.assign({ id, name, photo_ids: [], issues: [] }, extra || {});
const dates = { p1: '2025-01-05T10:00:00Z', p2: '2026-11-20T09:00:00Z', p3: '2026-11-20T09:05:00Z' };

test('areas pair by normalized name; one-sided areas are returned, never dropped', () => {
  const inDoc = { areas: [A('a1', 'Kitchen', { photo_ids: ['p1'] }), A('a2', 'Garage')] };
  const outDoc = { areas: [A('b1', 'kitchen.', { photo_ids: ['p2', 'p3'], issues: [{ id: 'i1', title: 'Cracked tile', trade: 'flooring', severity: 'medium', photo_ids: ['p3'] }] }), A('b2', 'Bath 1')] };
  const r = P.fiCompareDocs(inDoc, outDoc, dates);
  assert.deepStrictEqual(r.pairs.map(p => [p.name, !!p.in, !!p.out]), [['kitchen.', true, true], ['Bath 1', false, true], ['Garage', true, false]]);
  assert.deepStrictEqual(r.counts, { paired: 1, only_move_in: 1, only_move_out: 1 });
  const k = r.pairs[0];
  assert.deepStrictEqual(k.in.photos, [{ id: 'p1', date: '2025-01-05' }]);
  assert.deepStrictEqual(k.out.photos.map(p => p.id), ['p2', 'p3'], 'an issue photo already on the area is not listed twice');
  assert.strictEqual(k.out.issues[0].title, 'Cracked tile');
});

test('two areas with the same name in one inspection are both kept (#2), and excluded areas are left out', () => {
  const r = P.fiCompareDocs({ areas: [A('a1', 'Bedroom'), A('a2', 'Bedroom'), A('a3', 'Attic', { excluded: true })] }, { areas: [A('b1', 'Bedroom'), A('b2', 'Bedroom')] }, {});
  assert.deepStrictEqual(r.pairs.map(p => p.key), ['bedroom', 'bedroom#2']);
  assert.ok(r.pairs.every(p => p.in && p.out));
  assert.strictEqual(r.counts.only_move_in, 0);
});

// ---- the route, with the sheet faked ----
function route(opts) {
  const fakes = {
    json: (o, status) => ({ body: o, status: status || 200 }),
    fiErr: (status, error, message) => ({ body: { ok: false, error, message }, status }),
    FI_ID_RE: /^[A-Za-z0-9_-]{6,64}$/,
    fiEnsureTabs: async () => {},
    fiFindInspection: async (env, id) => ({ row: opts.rows[id] ? { o: opts.rows[id].o } : null }),
    fiJoinRow: o => o.__doc,
    fiDupKey: (a, d) => String(a || '').toLowerCase().split(/\s+/).slice(0, 3).join(' ') + '|' + d,
    fiReadFresh: async () => ({ rows: [{ o: { ID: 'photo01', Created_At: '2026-11-20T09:00:00Z', Active: 'TRUE' } }] }),
    fiPhotoIds: doc => [].concat(...(doc.areas || []).map(a => a.photo_ids || [])),
  };
  const f = new Function(...Object.keys(fakes), pure.concat(['fiCompare']).map(n => grab(n)).join('\n') + '\nreturn fiCompare;');
  return f(...Object.values(fakes));
}
const row = (id, type, doc, extra) => ({ o: Object.assign({ ID: id, Inspection_Type: type, Property_ID: 'P1', Address: '12 Main St', Inspection_Date: type === 'move_in' ? '2025-01-05' : '2026-11-20', Report_Token: 'tok-' + id, __doc: JSON.stringify(doc) }, extra || {}) });
const url = (a, b) => new URL('https://x/fi/compare?move_in=' + a + '&move_out=' + b);
const mi = 'movein001', mo = 'moveout01';

test('route: happy path returns both tokens, dates and pairs; photo dates come from one FI_Photos read', async () => {
  const fiCompare = route({ rows: { [mi]: row(mi, 'move_in', { areas: [A('a1', 'Kitchen', { photo_ids: ['photo01'] })], property: { id: 'P1' } }), [mo]: row(mo, 'move_out', { areas: [A('b1', 'Kitchen')], property: { id: 'P1' } }) } });
  const r = await fiCompare({}, url(mi, mo));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.move_in.token, 'tok-' + mi); assert.strictEqual(r.body.move_out.date, '2026-11-20');
  assert.strictEqual(r.body.pairs[0].in.photos[0].date, '2026-11-20'); assert.strictEqual(r.body.order_warning, '');
});

test('route: refuses bad ids, wrong types, other properties, other units; warns when dates are backwards', async () => {
  const good = { areas: [], property: { id: 'P1', unit_label: 'A' } };
  const base = { [mi]: row(mi, 'move_in', good), [mo]: row(mo, 'move_out', good) };
  assert.strictEqual((await route({ rows: base })({}, url('x', mo))).body.error, 'bad_id');
  assert.strictEqual((await route({ rows: base })({}, url(mo, mo))).body.error, 'bad_id');
  assert.strictEqual((await route({ rows: { [mo]: base[mo] } })({}, url(mi, mo))).status, 404);
  assert.strictEqual((await route({ rows: { ...base, [mi]: row(mi, 'periodic', good) } })({}, url(mi, mo))).body.error, 'not_move_in');
  assert.strictEqual((await route({ rows: { ...base, [mo]: row(mo, 'periodic', good) } })({}, url(mi, mo))).body.error, 'not_move_out');
  assert.strictEqual((await route({ rows: { ...base, [mi]: row(mi, 'move_in', { areas: [], property: { id: 'P2' } }, { Property_ID: 'P2' }) } })({}, url(mi, mo))).body.error, 'different_property');
  assert.strictEqual((await route({ rows: { ...base, [mi]: row(mi, 'move_in', { areas: [], property: { id: 'P1', unit_label: 'B' } }) } })({}, url(mi, mo))).body.error, 'different_unit');
  const back = await route({ rows: { ...base, [mi]: row(mi, 'move_in', good, { Inspection_Date: '2027-01-01' }) } })({}, url(mi, mo));
  assert.match(back.body.order_warning, /after the move-out/);
  assert.strictEqual((await route({ rows: { ...base, [mi]: { o: { ID: mi, Inspection_Type: 'move_in', Property_ID: 'P1', __doc: '{not json' } } } })({}, url(mi, mo))).body.error, 'corrupt_doc');
});

test('wiring: admin GET route, no write helper in the compare code, phone screen has the real states', () => {
  assert.ok(src.includes("path === '/fi/compare'"));
  const body = grab('fiCompare') + grab('fiCompareDocs') + grab('fiCompareSide');
  assert.ok(!/addRow|updateRow|fiWriteRow|ensureColumns|ensureTab|appendRow/.test(body), 'the compare code must not write');
  assert.ok(!/'\/fi\/compare'/.test(src.slice(src.indexOf("'/str/c/page'"), src.indexOf("'/str/c/page'") + 400)), 'compare is not a public path');
  for (const s of ['Compare with move-in', 'No move-in inspection on file for this address', 'Photo could not be loaded', 'Retry', 'Not inspected at move-in', 'Not inspected at move-out', "S.view==='compare'", 'min-height:44px', 'font-size:16px', '@media(min-width:700px){.cmp']) assert.ok(page.includes(s), s);
});
