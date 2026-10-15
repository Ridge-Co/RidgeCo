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
    m = path.match(/^\/values\/([A-Za-z_]+):append/);
    if (method === 'POST' && m) { const tab = T(m[1]); if (h.dropAppend === m[1]) return {}; for (const row of body.values) { let vals = row.slice(); if (h.corrupt) vals = h.corrupt(m[1], vals, tab.headers); tab.rows.push(vals); } if (h.corrupt && h.corruptOnce) h.corrupt = null; return {}; }
    throw new Error('fake sheets: unhandled ' + method + ' ' + path);
  };
  const ensureColumns = async (env, tab, cols) => { const tb = T(tab); for (const c of cols) if (!tb.headers.includes(c)) tb.headers.push(c); };
  const fetch = async (url, opts) => {
    if (h.net) { const r = await h.net(url, opts); if (r) return r; }
    const m = String(url).match(/\/values\/([A-Za-z_]+)$/);
    if (m) { const tb = T(m[1]); return { status: 200, json: async () => ({ values: tb.headers.length ? [tb.headers].concat(tb.rows.filter(Boolean)) : [] }) }; }
    if (String(url).includes('alt=media')) return { ok: h.driveOk !== false, body: h.driveOk === false ? null : 'BYTES', status: 200 };
    throw new Error('fake fetch: ' + url);
  };
  const factory = new Function('h', 'sheetsRequest', 'ensureColumns', 'fetch', 'col', 'bytesToB64', `
    const json = (data, status = 200) => ({ status, body: data });
    const CORS = {}; const env0 = {};
    const isStaging = () => true;
    const getAccessToken = async () => 'tok';
    const findOrCreateFolder = async () => ({ id: 'folder1' });
    const uploadFileToDrive = async (tok, buf) => h.driveFail ? {} : ({ id: 'drv' + (++h.tok), size: h.driveSize != null ? h.driveSize : buf.byteLength });
    const inspRandToken = (n) => 'tk' + (++h.tok) + 'x'.repeat(Math.max(6, (n || 6)));
    const routeAI = async (env, job) => { h.calls.push('AI ' + job.type + ' customerFacing=' + job.customerFacing); if (h.ai instanceof Error) throw h.ai; return { result: typeof h.ai === 'function' ? h.ai(job) : h.ai, model_used: 'claude-test' }; };
    const gmailSendEmail = async (env, o) => { h.mail.push(o); return h.staged === false ? { sent: true } : { staged: true, sent: false }; };
    const logTelemetry = async (env, r) => { h.telemetry.push(r); };
    ${block}
    return { fiBrandScrape, fiParseBrandHtml, fiColorsFromCss, fiPickBrandColors, fiSafeUrl, fiFetchLimited, fiSniffImage, fiNormalizeEquipment, fiValidateEquipment, fiValidateVoiceNotes, FI_EQUIP_KINDS, fiEquipFields, fiTranscribe, fiTranscribeJson, fiAudioMime, fiRouteNotes, fiNormalizeRoute, fiBuildRoutePrompt, fiReadLabel, fiTypesList, fiTypesSave, fiTypesTouch, fiTypeClean, FI_TYPE_SEED, FI_TABS, FI_BRAND_HEADERS, fiBrandContactLine, fiBuildEmail, fiSave, fiPublish, fiReport, fiPhotoUpload, fiPhotoView, fiBrandSave, fiEmailReport, fiStructure, fiSummarize, fiList, fiGetInspection, fiRoute, fiNormalizeIssue, fiNormalizeIssues, fiExtractJson, fiValidateDoc, fiFingerprint, fiTradeRollup, fiPublishChecks, fiSerialize, fiChunk, fiJoinRow, fiBuildStructurePrompt, fiPhotoIds, fiIsAdmin, FI_DATA_CHUNK };
  `);
  const env = { WORKER_SECRET: 'sek', HUB_TEST_TOKEN: 'tst', SHEET_ID: 'S', DRIVE_PROPERTIES_ROOT: 'root' };
  return { h, env, ...factory(h, sheetsRequest, ensureColumns, fetch, new Function('return ' + grab('col'))(), new Function('return ' + grab('bytesToB64'))()) };
}

