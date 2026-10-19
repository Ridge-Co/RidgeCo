// Shared in-memory Sheets/Drive/AI/Gmail fake that runs the REAL FI block from worker.js (used by the unit test and the UI harness).
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const a = src.indexOf('// ═══ FI-BLOCK-START'), b = src.indexOf('// ═══ FI-BLOCK-END');
if (a < 0 || b < 0) throw new Error('FI block markers missing');
const block = src.slice(a, b);
export function grab(name, isAsync = false) {
  const needle = (isAsync ? 'async ' : '') + 'function ' + name + '(';
  const i = src.indexOf(needle); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
export function world() {
  const h = { tabs: {}, calls: [], ai: null, mail: [], driveSize: null, corrupt: null, telemetry: [], tok: 0 };
  const T = (n) => (h.tabs[n] = h.tabs[n] || { headers: [], rows: [] });
  const sheetsRequest = async (env, method, path, body) => {
    h.calls.push(method + ' ' + path);
    if (method === 'GET' && path.startsWith('?fields')) return { sheets: Object.keys(h.tabs).map(title => ({ properties: { title } })) };
    if (path === ':batchUpdate') { for (const r of body.requests) T(r.addSheet.properties.title); return {}; }
    let m = path.match(/^\/values\/([A-Za-z_]+)!A(\d+):/);
    if (method === 'PUT' && m) {
      const tab = T(m[1]), n = Number(m[2]); let vals = body.values[0].slice();
      if (h.corrupt) { vals = h.corrupt(m[1], vals, tab.headers); if (h.corruptOnce) h.corrupt = null; }
      tab.rows[n - 2] = vals; return {};
    }
    m = path.match(/^\/values\/([A-Za-z_]+)!([A-Z]+)(\d+)\?/);
    if (method === 'PUT' && m) {
      const tab = T(m[1]), n = Number(m[3]); let ci = 0; for (const ch of m[2]) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1;
      if (!tab.rows[n - 2]) throw new Error('fake sheets: single-cell PUT to missing row ' + n);
      while (tab.rows[n - 2].length <= ci) tab.rows[n - 2].push('');
      tab.rows[n - 2][ci] = body.values[0][0]; return {};
    }
    m = path.match(/^\/values\/([A-Za-z_]+):append/);
    if (method === 'POST' && m) { const tab = T(m[1]); if (h.dropAppend === m[1]) return {}; for (const row of body.values) { let vals = row.slice(); if (h.corrupt) vals = h.corrupt(m[1], vals, tab.headers); tab.rows.push(vals); } if (h.corrupt && h.corruptOnce) h.corrupt = null; return {}; }
    throw new Error('fake sheets: unhandled ' + method + ' ' + path);
  };
  const ensureColumns = async (env, tab, cols) => { const tb = T(tab); for (const c of cols) if (!tb.headers.includes(c)) tb.headers.push(c); };
  const fetch = async (url, opts) => {
    if (h.net) { const r = await h.net(url, opts); if (r) return r; }
    const m = String(url).match(/\/values\/([A-Za-z_]+)$/);
    if (m) { const tb = T(m[1]); return { status: 200, json: async () => ({ values: tb.headers.length ? [tb.headers].concat(tb.rows.filter(Boolean)) : [] }) }; }
    if (String(url).includes('/drive/v3/drives/')) return { ok: !h.notShared, status: h.notShared ? 404 : 200, json: async () => ({}) };
    if (String(url).startsWith('https://www.googleapis.com/drive/v3/files') && !String(url).includes('alt=media')) {
      const u = new URL(url), d = (h.drive = h.drive || { folders: [], files: {}, seq: 0, patches: 0 }); (h.driveIdSeen = h.driveIdSeen || []).push(new URL(url).searchParams.get('driveId') || '');
      const R = (status, data) => ({ ok: status < 300, status, json: async () => data });
      const mid = u.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
      if (h.driveListFail && !mid && (!opts || !opts.method)) return R(500, { error: { message: 'drive list down' } });
      if (!mid && (!opts || !opts.method)) {
        const q = u.searchParams.get('q') || '';
        if (!/name=/.test(q)) { const par0 = q.match(/'([^']+)' in parents/)[1]; return R(200, { files: Object.keys(d.files).filter(id => d.files[id].parents.includes(par0)).map(id => ({ id })) }); }
        const nm = JSON.parse(q.match(/name=("(?:[^"\\]|\\.)*")/)[1]), par = q.match(/'([^']+)' in parents/)[1];
        return R(200, { files: d.folders.filter(f => f.name === nm && f.parent === par && !f.trashed).map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime, webViewLink: 'https://drive.google.com/drive/folders/' + f.id })) });
      }
      if (!mid && opts.method === 'POST') {
        const b = JSON.parse(opts.body); const f = { id: 'fold' + (++d.seq), name: b.name, parent: b.parents[0], createdTime: String(1000 + d.seq) }; d.folders.push(f);
        return R(200, { id: f.id, name: f.name, webViewLink: 'https://drive.google.com/drive/folders/' + f.id });
      }
      if (mid && (!opts || !opts.method)) { const f = d.files[mid[1]]; return f ? R(200, { id: mid[1], parents: f.parents.slice() }) : R(404, { error: { message: 'not found' } }); }
      if (mid && opts.method === 'PATCH') {
        const f = d.files[mid[1]]; if (!f) return R(404, { error: { message: 'not found' } });
        d.patches++; if (h.drivePatchNoop) return R(200, { id: mid[1], parents: f.parents.slice() });
        const add = u.searchParams.get('addParents'), rm = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
        f.parents = f.parents.filter(x => !rm.includes(x)); if (add && !f.parents.includes(add)) f.parents.push(add);
        return R(200, { id: mid[1], parents: f.parents.slice() });
      }
    }
    if (String(url).includes('alt=media')) return { ok: h.driveOk !== false, body: h.driveOk === false ? null : 'BYTES', status: 200 };
    throw new Error('fake fetch: ' + url);
  };
  const factory = new Function('h', 'sheetsRequest', 'ensureColumns', 'fetch', 'col', 'bytesToB64', `
    const json = (data, status = 200) => ({ status, body: data });
    const CORS = {}; const env0 = {};
    const isStaging = () => true;
    const getAccessToken = async () => 'tok';
    const findOrCreateFolder = async () => ({ id: 'folder1' });
    const uploadFileToDrive = async (tok, buf, name, mime, folderId, sharedId) => { (h.uploads = h.uploads || []).push({ name, folderId, sharedId }); if (h.driveFail || (h.driveFailFolder && folderId === h.driveFailFolder)) return {}; const id = 'drv' + (++h.tok); (h.drive = h.drive || { folders: [], files: {}, seq: 0, patches: 0 }).files[id] = { parents: [folderId] }; return { id, size: h.driveSize != null ? h.driveSize : buf.byteLength }; };
    const resp = (o, status = 200) => ({ status, ok: status < 300, clone() { return this; }, json: async () => o });
    const addObj = (tab, obj) => { const tb = h.tabs[tab] = h.tabs[tab] || { headers: [], rows: [] }; for (const k of Object.keys(obj)) if (!tb.headers.includes(k)) tb.headers.push(k); tb.rows.push(tb.headers.map(k => obj[k] == null ? '' : String(obj[k]))); };
    const rowsOf = (tab) => { const tb = h.tabs[tab] || { headers: [], rows: [] }; return tb.rows.filter(Boolean).map(r => { const o = {}; tb.headers.forEach((k, i) => { o[k] = r[i] == null ? '' : String(r[i]); }); return o; }); };
    const fetchTab = async (env, tab) => rowsOf(tab);
    const addRow = async (env, tab, obj) => { const id = (tab === 'Properties' ? 'NP' : tab === 'Units' ? 'NU' : 'NR') + (++h.tok); h.added = (h.added || []).concat([{ tab, obj }]); if (h.dropAdd !== tab) addObj(tab, Object.assign({ ID: id }, obj)); return resp({ id }); };
    const addOwnerWithQBSync = async (env, obj) => { const id = 'NO' + (++h.tok); h.added = (h.added || []).concat([{ tab: 'Owners', obj }]); if (h.dropAdd !== 'Owners') addObj('Owners', Object.assign({ ID: id }, obj)); return resp({ id }); };
    const unitAddWithDupeCheck = async (env, obj) => { const id = 'NU' + (++h.tok); if (h.dropAdd !== 'Units') addObj('Units', Object.assign({ ID: id }, obj)); return resp(h.unitFail ? {} : { id }); };
    const findSimilarProperties = async (env, address, city) => { const n = String(address).toLowerCase().replace(/[^a-z0-9]/g, ''); return rowsOf('Properties').filter(p => p.Active !== 'FALSE' && String(p.Address).toLowerCase().replace(/[^a-z0-9]/g, '') === n).map(p => ({ id: p.ID, address: p.Address })); };
    const ownerOnboardInferMarket = () => 'Baltimore';
    const inspRandToken = (n) => 'tk' + (++h.tok) + 'x'.repeat(Math.max(6, (n || 6)));
    const routeAI = async (env, job) => { h.calls.push('AI ' + job.type + ' customerFacing=' + job.customerFacing); if (h.ai instanceof Error) throw h.ai; return { result: typeof h.ai === 'function' ? h.ai(job) : h.ai, model_used: 'claude-test' }; };
    const gmailSendEmail = async (env, o) => { h.mail.push(o); return h.staged === false ? { sent: true } : { staged: true, sent: false }; };
    const logTelemetry = async (env, r) => { h.telemetry.push(r); };
    ${block}
    return { fiContractorize, fiScrubDocForReport, fiNormalizeSummary, fiTypeOut, FI_STRUCTURE_SYSTEM, FI_SUMMARY_SYSTEM, FI_ROUTE_SYSTEM, fiOwnerName, fiNormName, fiStreetOf, fiFolderSafe, fiInspFolderName, fiDirectory, fiPropertyCreate, fiDriveFindFolders, fiDriveEnsureFolder, fiWriteCells, fiInspectionFolder, fiFolderOrganize, fiDriveChildIds, fiFindInspection, fiReadFresh, FI_INSP_HEADERS, fiBrandScrape, fiParseBrandHtml, fiColorsFromCss, fiPickBrandColors, fiSafeUrl, fiFetchLimited, fiSniffImage, fiNormalizeEquipment, fiValidateEquipment, fiValidateVoiceNotes, FI_EQUIP_KINDS, fiEquipFields, fiTranscribe, fiTranscribeJson, FI_TRANSCRIBE_SYSTEM, fiAudioMime, fiRouteNotes, fiNormalizeRoute, fiBuildRoutePrompt, fiReadLabel, fiTypesList, fiTypesSave, fiTypesTouch, fiTypeClean, FI_TYPE_SEED, FI_TABS, FI_BRAND_HEADERS, fiBrandContactLine, fiBuildEmail, fiSave, fiPublish, fiReport, fiPhotoUpload, fiPhotoView, fiBrandSave, fiEmailReport, fiStructure, fiSummarize, fiList, fiGetInspection, fiRoute, fiNormalizeIssue, fiNormalizeIssues, fiExtractJson, fiValidateDoc, fiFingerprint, fiTradeRollup, fiPublishChecks, fiSerialize, fiChunk, fiJoinRow, fiBuildStructurePrompt, fiPhotoIds, fiIsAdmin, FI_DATA_CHUNK };
  `);
  const env = { WORKER_SECRET: 'sek', HUB_TEST_TOKEN: 'tst', SHEET_ID: 'S', DRIVE_PROPERTIES_ROOT: 'root' };
  return { h, env, ...factory(h, sheetsRequest, ensureColumns, fetch, new Function('return ' + grab('col'))(), new Function('return ' + grab('bytesToB64'))()) };
}

