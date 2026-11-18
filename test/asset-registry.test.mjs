// Asset registry, Phase 1 (queue #145, Nov 16 2026). Runs the REAL asset block + the REAL FI normalizer/prompt text out of worker.js against an in-memory Sheets fake.
// Run: node test/asset-registry.test.mjs
import fs from 'fs';
import { aiCreditGuardPrelude } from './_ai-credit-guard.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };
function grab(name, isAsync = false) {
  const i = src.indexOf((isAsync ? 'async ' : '') + 'function ' + name + '('); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function line(prefix) { const i = src.indexOf(prefix); if (i < 0) throw new Error('missing ' + prefix); return src.slice(i, src.indexOf('\n', i)); }
function obj(prefix) { const i = src.indexOf(prefix); const e = src.indexOf('\n};', i) + 3; return src.slice(i, e); }
const a = src.indexOf('// ═══ ASSET-BLOCK-START'), b = src.indexOf('// ═══ ASSET-BLOCK-END');
t('asset block markers exist', a > 0 && b > a);
const block = src.slice(a, b);

function world() {
  const h = { tabs: {}, calls: [], writes: [], ai: null, tele: [], seq: 0 };
  const T = n => (h.tabs[n] = h.tabs[n] || { headers: [], rows: [] });
  const rowsOf = tab => { if (!h.tabs[tab]) { const e = new Error('Sheets API error on GET /values/' + tab + ': Unable to parse range: ' + tab); throw e; } const tb = h.tabs[tab]; return tb.rows.map(r => { const o = {}; tb.headers.forEach((k, i) => { o[k] = r[i] == null ? '' : String(r[i]); }); return o; }); };
  const fetchTab = async (env, tab) => { h.calls.push('GET ' + tab); if (h.readFail === tab) throw new Error('Sheets API error on GET /values/' + tab + ': boom'); return rowsOf(tab); };
  const ensureTab = async (env, name, headers) => { h.writes.push('ensureTab ' + name); if (!h.tabs[name]) h.tabs[name] = { headers: headers.slice(), rows: [] }; };
  const ensureColumns = async (env, tab, cols) => { h.writes.push('ensureColumns ' + tab); const tb = T(tab); for (const c of cols) if (!tb.headers.includes(c)) tb.headers.push(c); };
  const addRow = async (env, tab, o) => {
    h.writes.push('addRow ' + tab); if (h.addFail) return { ok: false, status: 500, json: async () => ({ error: 'x' }) };
    const id = String(++h.seq); const tb = T(tab);
    if (h.addSilentDrop) return { ok: true, status: 200, json: async () => ({ success: true, id }) };   // "success" but nothing stored
    tb.rows.push(tb.headers.map(k => k === 'ID' ? id : k === 'Active' ? 'TRUE' : (h.addCorrupt && k === 'Model') ? 'WRONG' : (o[k] === undefined ? '' : String(o[k]))));
    return { ok: true, status: 200, json: async () => ({ success: true, id }) };
  };
  const json = (data, status = 200) => ({ status, ok: status < 300, body: data, json: async () => data });
  const routeAI = async (env, job) => { h.calls.push('AI ' + job.type + ' src=' + job.source); h.lastJob = job; if (h.ai instanceof Error) throw h.ai; return { result: typeof h.ai === 'function' ? h.ai(job) : h.ai, model_used: 'claude-test' }; };
  const logTelemetry = async (env, r) => { if (h.teleFail) throw new Error('tele down'); h.tele.push(r); };
  const invalidateTabCache = () => {};
  const f = new Function('h', 'fetchTab', 'ensureTab', 'ensureColumns', 'addRow', 'json', 'routeAI', 'logTelemetry', 'invalidateTabCache', `
    const fiContractorize = s => s;
    ${aiCreditGuardPrelude()}
    ${grab('sheetsQuotaBusyError')}
    ${grab('isMissingTabError')}
    ${grab('fiErr')}
    ${grab('fiStr')}
    ${grab('fiClean')}
    ${grab('fiExtractJson')}
    ${obj('const FI_EQUIP_KINDS')}
    ${line('const FI_EQUIP_COMMON')}
    ${grab('fiEquipFields')}
    ${grab('fiEquipMax')}
    ${grab('fiNormalizeEquipment')}
    ${line('const FI_LABEL_SYSTEM')}
    ${block}
    return { assetReadNameplate, assetSave, assetList, assetRoute, assetFindDuplicate, ASSET_HEADERS };
  `);
  return Object.assign({ h, env: {} }, f(h, fetchTab, ensureTab, ensureColumns, addRow, json, routeAI, logTelemetry, invalidateTabCache));
}
const seed = w => {
  w.h.tabs.Properties = { headers: ['ID', 'Address'], rows: [['10', 'TEST-1 Main St'], ['11', 'TEST-2 Oak St']] };
  w.h.tabs.Units = { headers: ['ID', 'Property_ID', 'Unit_Label'], rows: [['20', '10', 'A'], ['21', '11', 'B']] };
};
const PLATE = JSON.stringify({ readable: true, kind: 'dishwasher', brand: 'Bosch', model: 'SHE53T52UC', serial: 'FD-1234 56789', year: '2019', notes: '120V 60Hz' });
const IMG = Buffer.from('fakejpegbytes').toString('base64');
const url = q => new URL('https://x/assets/list' + q);

// ── 1. read-nameplate: proposes only, writes nothing ──
{
  const w = seed0(); function seed0() { const x = world(); seed(x); return x; }
  w.h.ai = PLATE;
  const r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg', property_id: '10', unit_id: '20' });
  t('read-nameplate: ok + found + normalized equipment', r.status === 200 && r.body.ok && r.body.found && r.body.equipment.kind === 'dishwasher' && r.body.equipment.model === 'SHE53T52UC', r.body);
  t('read-nameplate: tags the AI call source asset-registry, type fi_read_label (same pipeline)', w.h.calls.includes('AI fi_read_label src=asset-registry'), w.h.calls);
  t('read-nameplate: ZERO writes (no addRow, no ensureTab, no ensureColumns)', w.h.writes.length === 0, w.h.writes);
  t('read-nameplate: tab absent is fine, duplicate_check done, no duplicate', r.body.duplicate_check === 'done' && r.body.duplicate_of === null, r.body);
  t('read-nameplate: image passed through as base64 with its mime', w.h.lastJob.media.source.data === IMG && w.h.lastJob.media.source.media_type === 'image/jpeg');
  t('read-nameplate: telemetry row written', w.h.tele.some(x => x.Job_Type === 'asset_registry' && x.Skill_Or_Endpoint === '/assets/read-nameplate' && x.Success === 'TRUE'), w.h.tele);
}
// ── 2. read-nameplate rejects and AI failure paths ──
{
  const w = world(); seed(w);
  let r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'application/pdf' });
  t('bad mime -> 400 bad_mime', r.status === 400 && r.body.error === 'bad_mime', r.body);
  r = await w.assetReadNameplate(w.env, { mime: 'image/png' });
  t('missing photo -> 400', r.status === 400 && r.body.error === 'photo_missing', r.body);
  r = await w.assetReadNameplate(w.env, { image_base64: 'A'.repeat(Math.ceil(4.6 * 1024 * 1024 / 0.75)), mime: 'image/png' });
  t('over 4.5 MB -> 413', r.status === 413 && r.body.error === 'photo_too_large', r.body);
  t('a data: URL prefix is accepted', (await (async () => { w.h.ai = PLATE; return w.assetReadNameplate(w.env, { image_base64: 'data:image/jpeg;base64,' + IMG, mime: 'image/jpeg' }); })()).body.found === true);
  const err = new Error('credit'); err.code = 'ai_credit_paused'; w.h.ai = err;
  r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg' });
  t('AI credit paused -> typed 503 ai_credit_paused (not 500)', r.status === 503 && r.body.error === 'ai_credit_paused' && r.body.paused === true, r.body);
  w.h.ai = new Error('upstream exploded');
  r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg' });
  t('AI throws -> 502 ai_failed', r.status === 502 && r.body.error === 'ai_failed', r.body);
  w.h.ai = 'not json at all';
  r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg' });
  t('non-JSON AI answer -> 502 ai_bad_output', r.status === 502 && r.body.error === 'ai_bad_output', r.body);
  w.h.ai = JSON.stringify({ readable: false });
  r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg' });
  t('unreadable plate -> ok found:false', r.status === 200 && r.body.found === false, r.body);
  t('none of the failures wrote anything', w.h.writes.length === 0, w.h.writes);
  w.h.ai = PLATE; w.h.tabs.Asset_Registry = { headers: ['ID', 'Property_ID', 'Unit_ID', 'Kind', 'Serial', 'Active'], rows: [] }; w.h.readFail = 'Asset_Registry';
  r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg', property_id: '10', unit_id: '20' });
  t('registry read fails during duplicate check -> still returns the reading, says duplicate_check:failed', r.status === 200 && r.body.found && r.body.duplicate_check === 'failed', r.body);
  w.h.teleFail = true; w.h.readFail = null;
  r = await w.assetReadNameplate(w.env, { image_base64: IMG, mime: 'image/jpeg' });
  t('telemetry failure never breaks the call (best-effort)', r.status === 200 && r.body.found, r.body);
}
// ── 3. save: validation, creation, read-back ──
{
  const w = world(); seed(w);
  const eq = { kind: 'dishwasher', brand: 'Bosch', model: 'SHE53T52UC', serial: 'FD-1234 56789', year: '2019', notes: 'x', bogus: 'ignored', not_a_field: 'zzz' };
  let r = await w.assetSave(w.env, { property_id: '10', unit_id: '20', equipment: eq, confirmed_by: 'Brett' });
  t('save: ok with id and row', r.status === 200 && r.body.ok && r.body.id === '1' && r.body.row.Model === 'SHE53T52UC' && r.body.row.Serial === 'FD-1234 56789', r.body);
  t('save: tab was created with the exact headers, no PII columns', JSON.stringify(w.h.tabs.Asset_Registry.headers) === JSON.stringify(w.ASSET_HEADERS) && !w.ASSET_HEADERS.some(c => /phone|email|pin|code|tenant|owner_name|^name$/i.test(c) && c !== 'Name'), w.h.tabs.Asset_Registry.headers);
  t('save: ensureTab is called for the NEW tab only, and no other tab is ever written', w.h.writes.filter(x => /^ensureTab|^ensureColumns|^addRow/.test(x)).every(x => x.endsWith('Asset_Registry')), w.h.writes);
  t('save: Properties and Units untouched', JSON.stringify(w.h.tabs.Properties.rows) === JSON.stringify([['10', 'TEST-1 Main St'], ['11', 'TEST-2 Oak St']]) && w.h.tabs.Units.rows.length === 2);
  t('save: stamped Source/Confirmed_By/Confirmed_At/Active', r.body.row.Source === 'nameplate_ocr' && r.body.row.Confirmed_By === 'Brett' && !!r.body.row.Confirmed_At && r.body.row.Active === 'TRUE', r.body.row);
  t('save: unknown fields from the client are dropped', !JSON.stringify(r.body.row).includes('zzz'), r.body.row);
  t('save: warranty columns exist and are empty (so #249 needs no schema change)', r.body.row.Warranty_Start === '' && r.body.row.Warranty_Months === '');
  t('save: telemetry ok row', w.h.tele.some(x => x.Skill_Or_Endpoint === '/assets/save' && x.Success === 'TRUE'));
  // duplicate
  r = await w.assetSave(w.env, { property_id: '10', unit_id: '20', equipment: { kind: 'dishwasher', brand: 'bosch', serial: 'fd123456789' } });
  t('save: same Unit+Kind+normalized serial -> 409 duplicate, nothing added', r.status === 409 && r.body.error === 'duplicate' && r.body.duplicate_of.id === '1' && w.h.tabs.Asset_Registry.rows.length === 1, r.body);
  r = await w.assetSave(w.env, { property_id: '10', unit_id: '20', equipment: { kind: 'dishwasher', brand: 'Bosch', serial: 'fd123456789' }, allow_duplicate: true });
  t('save: allow_duplicate:true saves it', r.status === 200 && w.h.tabs.Asset_Registry.rows.length === 2, r.body);
  r = await w.assetSave(w.env, { property_id: '10', unit_id: '20', equipment: { kind: 'range', brand: 'GE', serial: 'fd123456789' } });
  t('save: same serial but a different Kind is not a duplicate', r.status === 200, r.body);
  r = await w.assetSave(w.env, { property_id: '11', unit_id: '21', equipment: { kind: 'dishwasher', brand: 'Bosch', serial: 'FD-1234 56789' } });
  t('save: same serial in ANOTHER unit is not a duplicate', r.status === 200, r.body);
  // validation: nothing written
  const before = JSON.stringify(w.h.tabs.Asset_Registry.rows);
  r = await w.assetSave(w.env, { property_id: '999', equipment: { kind: 'range', brand: 'GE' } });
  t('unknown property -> 404, nothing written', r.status === 404 && r.body.error === 'property_not_found' && JSON.stringify(w.h.tabs.Asset_Registry.rows) === before, r.body);
  r = await w.assetSave(w.env, { property_id: '10', unit_id: '999', equipment: { kind: 'range', brand: 'GE' } });
  t('unknown unit -> 404', r.status === 404 && r.body.error === 'unit_not_found', r.body);
  r = await w.assetSave(w.env, { property_id: '10', unit_id: '21', equipment: { kind: 'range', brand: 'GE' } });
  t('unit of a different property -> 400 mismatch', r.status === 400 && r.body.error === 'unit_property_mismatch' && JSON.stringify(w.h.tabs.Asset_Registry.rows) === before, r.body);
  r = await w.assetSave(w.env, { equipment: { kind: 'range', brand: 'GE' } });
  t('missing property_id -> 400', r.status === 400, r.body);
  r = await w.assetSave(w.env, { property_id: '10', equipment: { kind: 'range' } });
  t('nothing worth saving -> 400 empty', r.status === 400 && r.body.error === 'empty', r.body);
  t('a property-level asset (no unit) saves', (await w.assetSave(w.env, { property_id: '10', equipment: { kind: 'water_heater', brand: 'Rheem', capacity: '50 gal' }, source: 'manual' })).body.row.Source === 'manual');
}
// ── 4. save: the write is verified, never assumed (rules 6/19) ──
{
  const w = world(); seed(w);
  w.h.addSilentDrop = true;
  let r = await w.assetSave(w.env, { property_id: '10', equipment: { kind: 'range', brand: 'GE', model: 'JB1' } });
  t('"success" from addRow but nothing stored -> ok:false 502 not_confirmed', r.status === 502 && r.body.ok === false && r.body.error === 'not_confirmed', r);
  w.h.addSilentDrop = false; w.h.addCorrupt = true;
  r = await w.assetSave(w.env, { property_id: '10', equipment: { kind: 'range', brand: 'GE', model: 'JB1' } });
  t('stored row differs from what was sent -> ok:false', r.status === 502 && r.body.ok === false, r);
  w.h.addCorrupt = false; w.h.addFail = true;
  r = await w.assetSave(w.env, { property_id: '10', equipment: { kind: 'range', brand: 'GE', model: 'JB1' } });
  t('addRow failure -> ok:false 502 not_saved', r.status === 502 && r.body.error === 'not_saved', r.body);
  t('every failed save logged Success=FALSE telemetry', w.h.tele.filter(x => x.Skill_Or_Endpoint === '/assets/save' && x.Success === 'FALSE').length === 3, w.h.tele);
}
// ── 5. list ──
{
  const w = world(); seed(w);
  let r = await w.assetList(w.env, url(''));
  t('list on a missing tab = empty list, not an error', r.status === 200 && r.body.ok && r.body.count === 0 && Array.isArray(r.body.assets), r.body);
  t('list never creates the tab', !w.h.tabs.Asset_Registry && !w.h.writes.length, w.h.writes);
  await w.assetSave(w.env, { property_id: '10', unit_id: '20', equipment: { kind: 'range', brand: 'GE' } });
  await w.assetSave(w.env, { property_id: '10', unit_id: '20', equipment: { kind: 'dishwasher', brand: 'Bosch' } });
  await w.assetSave(w.env, { property_id: '11', unit_id: '21', equipment: { kind: 'dryer', brand: 'LG' } });
  w.h.tabs.Asset_Registry.rows[2][w.h.tabs.Asset_Registry.headers.indexOf('Active')] = 'FALSE';
  r = await w.assetList(w.env, url('?property_id=10&unit_id=20'));
  t('list filters by property+unit and sorts by Kind', r.body.count === 2 && r.body.assets[0].Kind === 'dishwasher' && r.body.assets[1].Kind === 'range', r.body);
  r = await w.assetList(w.env, url(''));
  t('list hides Active=FALSE rows', r.body.count === 2 && !r.body.assets.some(x => x.Kind === 'dryer'), r.body);
  // route wrapper
  w.h.readFail = 'Asset_Registry';
  r = await w.assetRoute(w.env, 'list', () => w.assetList(w.env, url('')));
  t('a real read error becomes a typed 500 with telemetry, never an empty list', r.status === 500 && r.body.ok === false && r.body.error === 'internal' && w.h.tele.some(x => x.Success === 'FALSE' && /route_error/.test(x.Notes)), r.body);
  w.h.readFail = null;
  w.h.readFail = 'Asset_Registry'; w.h.tabs.Asset_Registry.rows.length = 0;
  let threw = null; try { await w.assetRoute(w.env, 'x', async () => { throw new Error('Sheets API error on GET /values/X: Quota exceeded for quota metric read requests per minute'); }); } catch (e) { threw = e; }
  t('a read-quota error is rethrown so the Hub-wide calm 429 handles it', !!threw);
}
// ── 6. the prompt is the field-inspection prompt (no drift) ──
{
  const fi = src.slice(src.indexOf('async function fiReadLabel('), src.indexOf('// ── Round 3 (Oct 15 2026)'));
  const grabPrompt = s => s.match(/const prompt = (`[\s\S]*?`);\n/)[1].replace(/\s+/g, ' ');
  t('asset prompt text equals fiReadLabel prompt text', grabPrompt(fi) === grabPrompt(block), 'differs');
}
// ── 7. auth tripwires: admin-only by omission ──
{
  const paths = ['/assets/read-nameplate', '/assets/save', '/assets/list'];
  const pub = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf('];', src.indexOf('const PUBLIC_PATHS = [')));
  const roles = src.slice(src.indexOf('const ROLE_SCOPES = {'), src.indexOf('\n};', src.indexOf('const ROLE_SCOPES = {')));
  const prod = src.match(/const HUB_PROD_WRITE_PATHS = \[[^\]]*\]/)[0];
  const testRead = src.match(/const HUB_TEST_READ_PATHS = \[[^\]]*\]/);
  for (const p of paths) {
    t(p + ' not in PUBLIC_PATHS', !pub.includes("'" + p + "'"));
    t(p + ' not in ROLE_SCOPES (tenant/owner/vendor get 403)', !roles.includes("'" + p + "'"));
    t(p + ' not in HUB_PROD_WRITE_PATHS', !prod.includes("'" + p + "'"));
    t(p + ' is routed exactly once', src.split("path === '" + p + "'").length === 2);
  }
  t('HUB_TEST_WRITE_PATHS does not list the asset write routes (staging test token cannot write registry rows)', !/HUB_TEST_WRITE_PATHS\s*=\s*\[[^\]]*\/assets\//.test(src));
  t('the asset block never reads or writes a contact/PII column', !/Phone|Email|\bPIN\b|Tenants|Owners|Vendors/.test(block.replace(/no tenant\/owner\/vendor name, phone, email, PIN or code[^\n]*/i, '').replace(/\/\/[^\n]*/g, '')), 'PII word in code');
  t('the block uses ensureTab only for ASSET_TAB', (block.match(/ensureTab\(env, ([A-Z_a-z']+)/g) || []).every(x => /ASSET_TAB/.test(x)));
  t('no cron, no SMS, no QuickBooks in the block', !/sendSMS|qb[A-Z]|scheduled\(|crons/.test(block.replace(/\/\/[^\n]*/g, '')));
  t('the existing fiNormalizeEquipment / FI_EQUIP_KINDS are untouched (still the same single definitions)', src.split('function fiNormalizeEquipment(').length === 2 && src.split('const FI_EQUIP_KINDS = {').length === 2);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
