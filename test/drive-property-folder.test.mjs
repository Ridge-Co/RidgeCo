// Queue #115 Phase 1: drivePropertyFolder against a fake Drive + fake Sheets (stored id, first use, address mismatch, fallback, failed save, stale id).
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let pass = 0, fail = 0; const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };

function world(opts = {}) {
  const w = { folders: [{ id: 'F-old', name: '12 Main St', parent: 'ROOT', trashed: false }], telemetry: [], soft: [], searches: [], created: [], saved: [], gets: [],
    wos: [{ ID: 'W1', WO_ID: '1234', Property_ID: 'P1' }, { ID: 'W2', WO_ID: '9999', Property_ID: 'PX' }],
    props: [{ ID: 'P1', Address: '12 Main Street', Drive_Folder_ID: opts.storedId || '', Drive_Folder_URL: opts.storedUrl || '' }, { ID: 'P3', Address: '', Drive_Folder_ID: '' }], failSave: !!opts.failSave, staleStatus: opts.staleStatus };
  const env = {};
  const fetchTabs = async () => [w.wos, w.props];
  const findWO = (wos, id) => wos.find(x => String(x.WO_ID) === String(id) || String(x.ID) === String(id));
  const findDriveFolder = async (token, name, parent) => { w.searches.push(name); return w.folders.find(f => f.name === name && f.parent === parent && !f.trashed) || null; };
  const createDriveFolder = async (token, name, parent) => { const f = { id: 'F-new' + (w.created.length + 1), name, parent, trashed: false, webViewLink: 'https://drive.google.com/drive/folders/F-new' + (w.created.length + 1) }; w.created.push(name); w.folders.push(f); return f; };
  const findOrCreateFolder = async (t, n, p) => (await findDriveFolder(t, n, p)) || (await createDriveFolder(t, n, p));
  const logTelemetry = async (e, r) => { w.telemetry.push(r); };
  const softFail = async (e, where, err) => { w.soft.push(where); return { ok: false }; };
  const ensureColumns = async () => {};
  const updateRowVerified = async (e, tab, id, fields) => { if (w.failSave) throw new Error('sheet down'); w.saved.push({ tab, id, fields }); const p = w.props.find(x => x.ID === id); Object.assign(p, fields); return p; };
  const fetchStub = async (url) => { w.gets.push(url); const id = decodeURIComponent(url.split('/files/')[1].split('?')[0]); const f = w.folders.find(x => x.id === id);
    if (w.staleStatus) return { ok: false, status: w.staleStatus, json: async () => ({}) };
    return f ? { ok: true, status: 200, json: async () => ({ id: f.id, trashed: f.trashed, mimeType: 'application/vnd.google-apps.folder', webViewLink: 'https://drive.google.com/drive/folders/' + f.id }) } : { ok: false, status: 404, json: async () => ({}) }; };
  const fn = new Function('fetchTabs', 'findWO', 'findDriveFolder', 'createDriveFolder', 'findOrCreateFolder', 'logTelemetry', 'softFail', 'ensureColumns', 'updateRowVerified', 'fetch',
    grab('drivePropertyFolder') + '\nreturn drivePropertyFolder;')(fetchTabs, findWO, findDriveFolder, createDriveFolder, findOrCreateFolder, logTelemetry, softFail, ensureColumns, updateRowVerified, fetchStub);
  return { w, env, run: o => fn(env, 'tok', 'ROOT', o) };
}

{ // stored id: zero name searches
  const x = world({ storedId: 'F-old', storedUrl: 'https://drive.google.com/drive/folders/F-old' });
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('stored id is used', r.id === 'F-old' && r.source === 'stored', r);
  t('stored id: zero name searches, nothing created, nothing saved', x.w.searches.length === 0 && x.w.created.length === 0 && x.w.saved.length === 0, x.w);
}
{ // first use finds the older folder named by the browser spelling, and stores its id (no second folder)
  const x = world();
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('address mismatch reuses the existing folder (no duplicate)', r.id === 'F-old' && x.w.created.length === 0, { r, created: x.w.created });
  t('first use stores the id and url on the property', x.w.saved.length === 1 && x.w.saved[0].tab === 'Properties' && x.w.saved[0].fields.Drive_Folder_ID === 'F-old' && /drive\.google\.com/.test(x.w.saved[0].fields.Drive_Folder_URL), x.w.saved);
  const r2 = await x.run({ woId: '1234', fallbackAddr: 'totally different spelling' });
  t('second use does not search by name again and returns the same folder', r2.id === 'F-old' && x.w.searches.length === 2 && x.w.created.length === 0, x.w.searches);
}
{ // nothing exists: creates exactly one, named by the SHEET address
  const x = world(); x.w.folders.length = 0;
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('creates one folder named by the Properties-tab address', x.w.created.length === 1 && x.w.created[0] === '12 Main Street' && r.id.startsWith('F-new'), x.w.created);
}
{ // unresolvable WO falls back and logs
  const x = world();
  const r = await x.run({ woId: 'nope', fallbackAddr: '12 Main St' });
  t('unresolvable WO falls back to the browser address', r.id === 'F-old' && r.source === 'fallback', r);
  t('fallback logs exactly one drive_folder_fallback row', x.w.telemetry.filter(r => r.Job_Type === 'drive_folder_fallback').length === 1 && x.w.telemetry[0].Success === 'FALSE', x.w.telemetry);
  t('fallback saves nothing on any property', x.w.saved.length === 0);
}
{ // WO points at a property that is not on the tab
  const x = world(); const r = await x.run({ woId: '9999', fallbackAddr: '12 Main St' });
  t('missing property row falls back and says why', r.source === 'fallback' && /not on the Properties tab/.test(x.w.telemetry[0].Notes), x.w.telemetry);
}
{ // property with no address
  const x = world(); const r = await x.run({ propertyId: 'P3', fallbackAddr: '12 Main St' });
  t('property with no address falls back', r.source === 'fallback' && /has no address/.test(x.w.telemetry[0].Notes), x.w.telemetry);
}
{ // failed id save never fails the upload, and is logged
  const x = world({ failSave: true });
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('a failed id save still returns the folder', r.id === 'F-old', r);
  t('a failed id save is logged', x.w.telemetry.some(r => r.Job_Type === 'drive_folder_id_not_saved' && /sheet down/.test(r.Notes)), x.w.telemetry);
}
{ // stale stored id (404) is re-found by address and replaced
  const x = world({ storedId: 'F-gone' });
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('a stale stored id does not stop the upload', r.id === 'F-old', r);
  t('a stale id is logged and replaced', x.w.telemetry.some(r => r.Job_Type === 'drive_folder_stale') && x.w.saved.length === 1 && x.w.saved[0].fields.Drive_Folder_ID === 'F-old', { t: x.w.telemetry, s: x.w.saved });
}
{ // trashed stored folder
  const x = world({ storedId: 'F-old' }); x.w.folders[0].trashed = true; x.w.folders.push({ id: 'F-live', name: '12 Main Street', parent: 'ROOT', trashed: false });
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('a trashed stored folder is replaced by the live one', r.id === 'F-live', r);
}
{ // Drive check itself errors (500): falls through to the address lookup
  const x = world({ storedId: 'F-old', staleStatus: 500 });
  const r = await x.run({ woId: '1234', fallbackAddr: '12 Main St' });
  t('a failing check falls back to the address lookup', r.id === 'F-old' && x.w.telemetry.some(r => r.Job_Type === 'drive_folder_stale'), x.w.telemetry);
}
// static
const body = grab('drivePropertyFolder');
t('no swallowing catches in the helper', !/catch\s*\(\w*\)\s*\{\s*\}/.test(body) && !/catch\s*\(_\)/.test(body));
t('uses ensureColumns by name and a verified write for the stored id', /ensureColumns\(env, 'Properties', \['Drive_Folder_ID', 'Drive_Folder_URL'\]\)/.test(body) && /updateRowVerified\(env, 'Properties'/.test(body));
t('never shares a folder', !/driveShareAnyone/.test(body));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
