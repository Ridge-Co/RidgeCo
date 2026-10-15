// Field Inspection (Oct 15 2026) — runs the REAL FI block from worker.js (between FI-BLOCK-START/END) against an in-memory
// Sheets/Drive/AI/Gmail fake (test/_fi-world.mjs). Covers the silent-failure classes: write read-back, stale writes,
// un-publish on edit, AI failure/bad output, photo verification, publish gates, brand switch, staging-token guard.
import fs from 'fs';
import { world, grab } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// ═══ FI-BLOCK-START'), src.indexOf('// ═══ FI-BLOCK-END'));
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 300) : ''); } };

const mkDoc = (over = {}) => Object.assign({
  v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, pre1978: true, overall: { condition: 'fair', notes: 'ok' },
  areas: [
    { id: 'a1', name: 'Kitchen', condition: 'poor', issues: [{ id: 'i1', title: 'Leak under sink', trade: 'plumbing', severity: 'urgent', recommended_fix: 'Replace trap', photo_ids: ['ph_aaaaaa'] }] },
    { id: 'a2', name: 'Living Room', condition: 'nothing_to_do', issues: [] },
    { id: 'a3', name: 'Exterior Rear', condition: 'fair', issues: [{ id: 'i2', title: 'Trash stored on porch', trade: 'tenant_action', severity: 'low', tenant_action: true }] },
  ] }, over);
const ID = 'fi_test_0001', TID = 'TEST-fi_0001';
const body = (r) => r.body;

// ── pure helpers ──
{
  const w = world();
  const n = w.fiNormalizeIssue({ title: 'x', trade: 'Drywall / Paint', severity: 'SEVERE!!' });
  t('trade slug-normalized', n && n.trade === 'drywall_paint', n);
  t('bad severity -> medium', n && n.severity === 'medium');
  t('unknown trade -> general', w.fiNormalizeIssue({ title: 'x', trade: 'wizardry' }).trade === 'general');
  t('tenant trade sets tenant_action', w.fiNormalizeIssue({ title: 'x', trade: 'tenant_action' }).tenant_action === true);
  t('empty title dropped', w.fiNormalizeIssue({ title: '  ' }) === null);
  t('non-array issues -> null', w.fiNormalizeIssues('nope') === null);
  t('extractJson handles fences', w.fiExtractJson('```json\n{"a":1}\n```').a === 1);
  t('extractJson handles chatter', w.fiExtractJson('Sure! {"a":2} hope that helps').a === 2);
  t('extractJson garbage -> null', w.fiExtractJson('no json here') === null);
  t('valid doc ok', w.fiValidateDoc(mkDoc()).ok);
  t('missing address rejected', !w.fiValidateDoc(mkDoc({ property: {} })).ok);
  t('duplicate area ids rejected', !w.fiValidateDoc(mkDoc({ areas: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }] })).ok);
  t('bad severity on issue rejected', !w.fiValidateDoc(mkDoc({ areas: [{ id: 'a', name: 'x', issues: [{ id: 'i', title: 't', trade: 'plumbing', severity: 'meh' }] }] })).ok);
  const d1 = mkDoc(), d2 = mkDoc(); d2.areas[0].issues[0].title = 'Changed';
  t('fingerprint stable', w.fiFingerprint(d1) === w.fiFingerprint(mkDoc()));
  t('fingerprint changes with issue text', w.fiFingerprint(d1) !== w.fiFingerprint(d2));
  const ro = w.fiTradeRollup(d1);
  t('rollup sorted by worst severity', ro[0].trade === 'plumbing' && ro[0].worst === 'urgent' && ro.length === 2, ro);
  t('excluded areas skipped in rollup', w.fiTradeRollup(mkDoc({ areas: [{ id: 'a', name: 'x', excluded: true, issues: [{ id: 'i', title: 't', trade: 'plumbing', severity: 'low' }] }] })).length === 0);
  const ser = w.fiSerialize({ s: 'café 🏠 ' + 'é'.repeat(100000) });
  t('serialize is ASCII only', /^[\x00-\x7f]*$/.test(ser));
  t('chunk roundtrip exact', JSON.parse(w.fiChunk(ser).join('')).s.endsWith('é') && w.fiChunk(ser).join('') === ser);
  t('prompt flags pre-1978', w.fiBuildStructurePrompt({ address: 'x', pre1978: true, dictation: 'peeling paint', area_name: 'Kitchen' }).includes('BUILT BEFORE 1978'));
  const pc = w.fiPublishChecks(mkDoc(), []);
  t('missing photos block publish', pc.blocks.some(x => x.code === 'photos_missing'), pc);
  const pd = mkDoc(); pd.areas[1].pending_text = 'left sink drips';
  t('pending dictation blocks publish', w.fiPublishChecks(pd, ['ph_aaaaaa']).blocks.some(x => x.code === 'dictation_pending'));
  const pn = mkDoc(); pn.areas[1].condition = 'not_inspected';
  const pcn = w.fiPublishChecks(pn, ['ph_aaaaaa']);
  t('uninspected area is a warning not a block', pcn.blocks.length === 0 && pcn.warnings.some(x => x.code === 'areas_not_inspected'), pcn);
  t('overall condition required', w.fiPublishChecks(mkDoc({ overall: {} }), ['ph_aaaaaa']).blocks.some(x => x.code === 'overall_missing'));
}

// ── save / verify / stale / unpublish ──
{
  const w = world();
  let r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc(), meta: { client_name: 'Premier', inspector: 'Brett' } });
  t('first save ok rev 1', r.status === 200 && r.body.ok && r.body.rev === 1, r);
  t('report token issued', /^tk/.test(r.body.report_token));
  const tok = r.body.report_token;
  t('row persisted with 1 data chunk', w.h.tabs.FI_Inspections.rows.length === 1);
  r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc() });
  t('stale base_rev -> 409 stale, nothing overwritten', r.status === 409 && r.body.error === 'stale' && r.body.server_rev === 1, r);
  t('stale write did not bump rev', w.h.tabs.FI_Inspections.rows[0][w.h.tabs.FI_Inspections.headers.indexOf('Rev')] === '1');
  r = await w.fiSave(w.env, { id: ID, base_rev: 0, force: true, doc: mkDoc() });
  t('force overrides stale', r.status === 200 && r.body.rev === 2, r);
  r = await w.fiSave(w.env, { id: ID, base_rev: 2, doc: mkDoc(), meta: { brand_id: 'nope' } });
  t('unknown brand rejected', r.status === 400 && r.body.error === 'bad_brand', r);
  r = await w.fiSave(w.env, { id: ID, base_rev: 2, doc: { v: 1, areas: 'x' } });
  t('invalid doc rejected 400', r.status === 400 && r.body.error === 'invalid_doc');
  r = await w.fiSave(w.env, { id: 'x', base_rev: 0, doc: mkDoc() });
  t('bad id rejected', r.status === 400 && r.body.error === 'bad_id');
  const big = mkDoc(); big.areas[0].issues[0].detail = 'x'.repeat(w.FI_DATA_CHUNK * 8 + 10);
  r = await w.fiSave(w.env, { id: ID, base_rev: 2, doc: big });
  t('oversized doc -> 413 not silent truncation', r.status === 413 && r.body.error === 'too_large', r);
  // read-back verify catches a sheet that drops data
  w.h.corruptOnce = true;
  w.h.corrupt = (tab, vals, headers) => { if (tab === 'FI_Inspections') { const i = headers.indexOf('Data_1'); vals[i] = vals[i].slice(0, 20); } return vals; };
  r = await w.fiSave(w.env, { id: ID, base_rev: 2, doc: mkDoc({ overall: { condition: 'good' } }) });
  t('corrupted write -> 500 verify_failed (never ok:true)', r.status === 500 && r.body.error === 'verify_failed' && r.body.ok === false, r);
  const rb = r.body;
  const retry = await w.fiSave(w.env, { id: ID, base_rev: 2, doc: mkDoc() });
  t('failed save rolled back so retry with same base_rev works', rb.rolled_back === true && retry.status === 200 && retry.body.rev === 3, [rb, retry.body]);
  // publish gates
  w.h.tabs.FI_Photos = w.h.tabs.FI_Photos || { headers: [], rows: [] };
  let p = await w.fiPublish(w.env, { id: ID, rev: 3 });
  t('publish blocked while photo not uploaded', p.status === 409 && p.body.error === 'blocked' && p.body.blocks[0].code === 'photos_missing', p);
  // upload photo
  const pr = (mime, n) => ({ headers: { get: k => (k === 'Content-Type' ? mime : '') }, arrayBuffer: async () => new ArrayBuffer(n) });
  const u = (q) => new URL('https://x/fi/photo?' + q);
  let up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('inspection_id=' + ID + '&photo_id=ph_aaaaaa'));
  t('photo upload ok', up.status === 200 && up.body.ok && up.body.bytes === 100, up);
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('inspection_id=' + ID + '&photo_id=ph_aaaaaa'));
  t('photo upload idempotent', up.body.existing === true && w.h.tabs.FI_Photos.rows.length === 1, up);
  up = await w.fiPhotoUpload(w.env, pr('text/html', 5), u('inspection_id=' + ID + '&photo_id=ph_bbbbbb'));
  t('non-image rejected 415', up.status === 415);
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('inspection_id=fi_unsaved_99&photo_id=ph_cccccc'));
  t('photo for unsaved inspection -> 409 visible', up.status === 409 && up.body.error === 'inspection_not_saved', up);
  w.h.driveSize = 7;
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('inspection_id=' + ID + '&photo_id=ph_dddddd'));
  t('drive byte-count mismatch -> 502, no row', up.status === 502 && up.body.error === 'drive_size_mismatch' && w.h.tabs.FI_Photos.rows.length === 1, up);
  w.h.driveSize = null; w.h.driveFail = true;
  up = await w.fiPhotoUpload(w.env, pr('image/jpeg', 100), u('inspection_id=' + ID + '&photo_id=ph_eeeeee'));
  t('drive failure -> 502 visible', up.status === 502 && up.body.error === 'drive_upload', up);
  w.h.driveFail = false;
  // pending text / warnings
  const dpend = mkDoc(); dpend.areas[1].pending_text = 'x';
  r = await w.fiSave(w.env, { id: ID, base_rev: 3, doc: dpend }); const rev3 = r.body.rev;
  p = await w.fiPublish(w.env, { id: ID, rev: rev3 });
  t('pending dictation blocks publish via API', p.status === 409 && p.body.blocks.some(x => x.code === 'dictation_pending'), p);
  const dunin = mkDoc(); dunin.areas[1].condition = 'not_inspected';
  r = await w.fiSave(w.env, { id: ID, base_rev: rev3, doc: dunin }); const rev4 = r.body.rev;
  p = await w.fiPublish(w.env, { id: ID, rev: rev4 });
  t('warnings need explicit ack', p.status === 409 && p.body.error === 'needs_ack', p);
  p = await w.fiPublish(w.env, { id: ID, rev: rev4 - 1 });
  t('publish of stale rev refused', p.status === 409 && p.body.error === 'stale', p);
  p = await w.fiPublish(w.env, { id: ID, rev: rev4, ack_warnings: true });
  t('publish ok after ack', p.status === 200 && p.body.status === 'published' && p.body.report_url.includes('inspection-report.html?r=' + tok), p);
  // report visibility
  const url = new URL('https://x/fi/report?r=' + tok);
  const anon = { headers: { get: () => '' } }, adm = { headers: { get: k => (k === 'X-Auth-Token' ? 'sek' : '') } };
  let rep = await w.fiReport(w.env, anon, url);
  t('published report visible to anonymous token holder', rep.status === 200 && rep.body.ok && !rep.body.preview, rep);
  t('report strips internal fields', !JSON.stringify(rep.body.doc).includes('pending_text') && rep.body.photo_ids.includes('ph_aaaaaa'));
  t('wrong token 404', (await w.fiReport(w.env, anon, new URL('https://x/fi/report?r=nopenopenope'))).status === 404);
  // summary acceptance gate
  const dsum = mkDoc(); dsum.areas[1].condition = 'good'; dsum.summary = { overall: 'AI TEXT', accepted: false, fp: w.fiFingerprint(dsum) };
  r = await w.fiSave(w.env, { id: ID, base_rev: rev4, doc: dsum }); const rev5 = r.body.rev;
  rep = await w.fiReport(w.env, adm, url);
  t('edit after publish un-published the report', r.body.unpublished === true && rep.body.preview === true, r.body);
  rep = await w.fiReport(w.env, anon, url);
  t('un-published report hidden from public with friendly message', rep.status === 403 && rep.body.error === 'not_published', rep);
  rep = await w.fiReport(w.env, adm, url);
  t('unaccepted AI summary never shown', !rep.body.doc.summary);
  dsum.summary.accepted = true;
  r = await w.fiSave(w.env, { id: ID, base_rev: rev5, doc: dsum }); const rev6 = r.body.rev;
  rep = await w.fiReport(w.env, adm, url);
  t('accepted + fresh summary shown', rep.body.doc.summary && rep.body.doc.summary.overall === 'AI TEXT');
  dsum.areas[0].issues[0].title = 'Edited after summary';
  r = await w.fiSave(w.env, { id: ID, base_rev: rev6, doc: dsum });
  rep = await w.fiReport(w.env, adm, url);
  t('stale-fingerprint summary dropped', !rep.body.doc.summary);
  // brand switch re-skins without touching the doc
  const bs = await w.fiBrandSave(w.env, { name: 'Premier Property Management', primary_color: '#0b5d3b', tagline: 'Baltimore', contact_line: '410-555-0100' });
  t('brand save ok + verified', bs.status === 200 && bs.body.brand.name.startsWith('Premier'), bs);
  const before = JSON.stringify(rep.body.doc);
  r = await w.fiSave(w.env, { id: ID, base_rev: r.body.rev, doc: dsum, meta: { brand_id: bs.body.brand.id } });
  rep = await w.fiReport(w.env, adm, url);
  t('brand switch changes report brand only', rep.body.brand.name.startsWith('Premier') && rep.body.brand.primary_color === '#0b5d3b' && JSON.stringify(rep.body.doc) === before, rep.body.brand);
  t('default brand untouched', (await w.fiList(w.env)).body.brands.some(x => x.is_default && x.name === 'Ridge Co'));
  // brand validation
  t('bad color rejected', (await w.fiBrandSave(w.env, { name: 'X', primary_color: 'red' })).status === 400);
  t('non-image logo rejected', (await w.fiBrandSave(w.env, { name: 'X', primary_color: '#112233', logo_data: 'data:text/html;base64,AAA' })).status === 400);
  t('huge logo rejected 413', (await w.fiBrandSave(w.env, { name: 'X', primary_color: '#112233', logo_data: 'data:image/png;base64,' + 'A'.repeat(43000) })).status === 413);
  const d2 = await w.fiBrandSave(w.env, { name: 'Second Default', primary_color: '#112233', is_default: true });
  const lst = (await w.fiList(w.env)).body.brands;
  t('exactly one default brand after switching default', d2.status === 200 && lst.filter(x => x.is_default).length === 1 && lst.find(x => x.is_default).name === 'Second Default', lst.map(x => [x.name, x.is_default]));
  t('default brand cannot be deactivated', (await w.fiBrandSave(w.env, { id: d2.body.brand.id, name: 'Second Default', primary_color: '#112233', active: false })).status === 400);
  // missing brand falls back and is flagged
  r = await w.fiSave(w.env, { id: ID, base_rev: r.body.rev, doc: dsum, meta: { brand_id: bs.body.brand.id } });
  await w.fiBrandSave(w.env, { id: bs.body.brand.id, name: 'Premier Property Management', primary_color: '#0b5d3b', active: false });
  rep = await w.fiReport(w.env, adm, url);
  t('inactive brand -> fallback flagged', rep.body.brand_fallback === true && rep.body.brand.is_default === true);
  // email: preview first, publish required
  let em = await w.fiEmailReport(w.env, adm, { id: ID, to: 'a@b.com' });
  t('email blocked until published', em.status === 409 && em.body.error === 'not_published', em);
  r = await w.fiSave(w.env, { id: ID, base_rev: r.body.rev, doc: dsum }); // already same hash → stays as is
  const cur = await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID));
  p = await w.fiPublish(w.env, { id: ID, rev: cur.body.inspection.rev, ack_warnings: true });
  t('republished', p.status === 200, p);
  em = await w.fiEmailReport(w.env, adm, { id: ID, to: 'a@b.com' });
  t('email preview does not send', em.body.preview === true && w.h.mail.length === 0 && em.body.html.includes('inspection-report.html?r='), em);
  em = await w.fiEmailReport(w.env, adm, { id: ID, to: 'bad' });
  t('bad email rejected', em.status === 400);
  em = await w.fiEmailReport(w.env, adm, { id: ID, to: 'a@b.com', preview: false });
  t('send reports staged honestly', em.body.ok && em.body.staged === true && em.body.sent === false && w.h.tabs.FI_Email_Log.rows.length === 1, em);
  const ga = await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + ID));
  t('GET inspection round-trips doc', ga.body.ok && ga.body.doc.areas.length === 3);
  t('missing inspection 404', (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=fi_nothere_1'))).status === 404);
  t('photo proxy: wrong token 404', (await w.fiPhotoView(w.env, new URL('https://x/fi/photo/view?r=bad&p=ph_aaaaaa'))).status === 404);
  const pv = await w.fiPhotoView(w.env, new URL('https://x/fi/photo/view?r=' + tok + '&p=ph_aaaaaa'));
  t('photo proxy streams with token', pv.status === 200);
  t('fiIsAdmin accepts staging test token, rejects junk', w.fiIsAdmin(w.env, { headers: { get: () => 'tst' } }, new URL('https://x/')) && !w.fiIsAdmin(w.env, { headers: { get: () => 'zzz' } }, new URL('https://x/')));
}

// ── AI endpoints ──
{
  const w = world();
  w.h.ai = new Error('boom');
  let r = await w.fiStructure(w.env, { area_name: 'Kitchen', dictation: 'leak under sink' });
  t('AI throw -> 502 ai_failed, visible', r.status === 502 && r.body.error === 'ai_failed' && r.body.ok === false, r);
  w.h.ai = 'I cannot do that';
  r = await w.fiStructure(w.env, { area_name: 'Kitchen', dictation: 'leak under sink' });
  t('AI non-JSON -> 502 ai_bad_output', r.status === 502 && r.body.error === 'ai_bad_output', r);
  w.h.ai = '{"issues":"nope"}';
  r = await w.fiStructure(w.env, { area_name: 'Kitchen', dictation: 'x' });
  t('AI wrong shape -> 502', r.status === 502, r);
  w.h.ai = '```json\n{"issues":[{"title":"Leak under sink","trade":"Plumbing","severity":"urgent","recommended_fix":"Replace P-trap","fix_source":"inspector"},{"title":""}],"area_condition":"poor","area_summary":"Active leak."}\n```';
  r = await w.fiStructure(w.env, { area_name: 'Kitchen', dictation: 'x' });
  t('AI good output normalized', r.body.ok && r.body.issues.length === 1 && r.body.issues[0].trade === 'plumbing' && r.body.area_condition === 'poor', r);
  t('structure pinned customer-facing (Claude tier)', w.h.calls.some(c => c === 'AI fi_structure customerFacing=true'));
  r = await w.fiStructure(w.env, { area_name: 'Kitchen', dictation: '   ' });
  t('empty dictation 400', r.status === 400);
  w.h.ai = '{"overall":"Home is in fair shape.","trades":{"plumbing":"One visit.","hvac":"not in data"},"priorities":[{"title":"Fix leak","why":"Water damage"}]}';
  r = await w.fiSummarize(w.env, { doc: mkDoc() });
  t('summary keeps only trades present', r.body.ok && r.body.summary.trades.plumbing && !r.body.summary.trades.hvac && r.body.summary.fp === w.fiFingerprint(mkDoc()), r.body);
  r = await w.fiSummarize(w.env, { doc: mkDoc({ areas: [{ id: 'a', name: 'x', issues: [] }] }) });
  t('no-issue doc gets a deterministic summary without calling AI', r.body.ok && r.body.summary.model === 'none');
  w.h.ai = new Error('down');
  r = await w.fiSummarize(w.env, { doc: mkDoc() });
  t('summary AI failure visible 502', r.status === 502 && r.body.error === 'ai_failed');
  // route wrapper converts throws into a visible error and never ok:true
  const boom = await w.fiRoute(w.env, 'x', async () => { throw new Error('kaput'); });
  t('fiRoute: exception -> 500 ok:false + telemetry', boom.status === 500 && boom.body.ok === false && w.h.telemetry.length === 1, boom);
}

// ── staging token guard ──
{
  const guardSrc = grab('hubTestWriteAllowed', true);
  const f = new Function('fetchTab', 'isTestRecord', 'findQueueMatch', 'OPS_QUEUE_TAB', 'isTestWO', 'return ' + guardSrc)(async (e, tab) => (tab === 'FI_Brands' ? [{ ID: 'brand_real', Name: 'Ridge Co' }, { ID: 'brand_t', Name: 'TEST-x' }] : []), async () => false, () => null, 'Q', async () => false);
  const ok = async (p, b) => { const r = await f({}, p, b); return !!(r && typeof r === 'object' ? r.ok : r); };
  t('guard: TEST- inspection save allowed', await ok('/fi/save', { id: 'TEST-abc123' }));
  t('guard: real inspection save denied', !(await ok('/fi/save', { id: 'fi_real_123' })));
  t('guard: real inspection publish denied', !(await ok('/fi/publish', { id: 'fi_real_123' })));
  t('guard: real inspection email denied', !(await ok('/fi/email-report', { id: 'fi_real_123' })));
  t('guard: structure/summarize allowed (no writes)', (await ok('/fi/structure', {})) && (await ok('/fi/summarize', {})));
  t('guard: TEST- new brand allowed', await ok('/fi/brand/save', { name: 'TEST-Brand' }));
  t('guard: non-TEST brand denied', !(await ok('/fi/brand/save', { name: 'Premier' })));
  t('guard: TEST brand cannot be default', !(await ok('/fi/brand/save', { name: 'TEST-B', is_default: true })));
  t('guard: cannot rewrite real brand even with TEST- name', !(await ok('/fi/brand/save', { id: 'brand_real', name: 'TEST-x' })));
  t('guard: can update TEST brand', await ok('/fi/brand/save', { id: 'brand_t', name: 'TEST-x' }));
}

// ── wiring in worker.js ──
{
  t('PUBLIC_PATHS has the two public routes', /'\/fi\/report','\/fi\/photo\/view'\]/.test(src));
  for (const p of ['/fi/list', '/fi/inspection', '/fi/report', '/fi/photo/view', '/fi/save', '/fi/publish', '/fi/structure', '/fi/summarize', '/fi/brand/save', '/fi/email-report', '/fi/photo'])
    t('route wired: ' + p, src.includes("path === '" + p + "'"));
  const wk = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  t('NO CRON preserved', /crons\s*=\s*\[\s*\]/.test(wk));
  t('worker block has no swallowing catch', !/catch\s*\(\w*\)\s*\{\s*\}/.test(block));
}

console.log(`fi-field-inspection: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
