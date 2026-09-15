// Rule 179: driveShareAnyone's failures only ever said "404, file not found" — but Google Drive
// returns 404 for a file the caller has ZERO visibility into just as often as for one that's
// truly gone (it hides existence rather than returning 403), so that alone can't tell "deleted"
// apart from "wrong access". /admin/drive-file-check calls files.get directly per ID (read-only,
// never writes) and reports what Drive itself says. These tests pin: found vs not-found
// classification, trashed detection, real error passthrough, and the 50-ID/empty-input guards.
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

function makeSandbox(fakeFetch) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  const factory = new Function(
    'getAccessToken', 'json',
    grab('adminDriveFileCheck') + '\nreturn { adminDriveFileCheck };'
  );
  const built = factory(async () => 'fake-token', (data) => ({ __json: true, data }));
  return { built, restore: () => { globalThis.fetch = realFetch; } };
}

(async () => {
  // ── 1. A found, non-trashed file ──
  {
    const { built, restore } = makeSandbox(async (url) => ({
      ok: true,
      json: async () => ({ id: 'file-A', name: 'photo.jpg', trashed: false, driveId: null, parents: ['folder-1'], owners: [{ emailAddress: 'brett-os-sheets@brettos-502323.iam.gserviceaccount.com' }] }),
    }));
    const r = (await built.adminDriveFileCheck({}, { file_ids: ['file-A'] })).data;
    restore();
    t('found file reports found:true', r.results[0].found === true, r.results[0]);
    t('found file reports trashed:false', r.results[0].trashed === false);
    t('found file carries the name', r.results[0].name === 'photo.jpg');
  }

  // ── 2. A trashed file — still "found" but flagged, since sharing it is meaningless ──
  {
    const { built, restore } = makeSandbox(async () => ({
      ok: true,
      json: async () => ({ id: 'file-B', name: 'old.jpg', trashed: true, driveId: null, parents: [], owners: [] }),
    }));
    const r = (await built.adminDriveFileCheck({}, { file_ids: ['file-B'] })).data;
    restore();
    t('trashed file still reports found:true', r.results[0].found === true);
    t('trashed file is flagged trashed:true', r.results[0].trashed === true);
  }

  // ── 3. A genuine 404 — distinguishable from a permission-flavored 404 by the error message ──
  {
    const { built, restore } = makeSandbox(async () => ({
      ok: false, status: 404,
      json: async () => ({ error: { message: 'File not found: file-C.' } }),
    }));
    const r = (await built.adminDriveFileCheck({}, { file_ids: ['file-C'] })).data;
    restore();
    t('missing file reports found:false', r.results[0].found === false);
    t('missing file carries the real status', r.results[0].status === 404);
    t('missing file carries Drive\'s real error text', /File not found/.test(r.results[0].error));
  }

  // ── 4. A real network/exception failure doesn't crash the whole batch ──
  {
    const { built, restore } = makeSandbox(async () => { throw new Error('network blip'); });
    const r = (await built.adminDriveFileCheck({}, { file_ids: ['file-D'] })).data;
    restore();
    t('a thrown error is caught per-file, not fatal to the batch', r.ok === true && r.results[0].found === false);
    t('the thrown error message is surfaced', /network blip/.test(r.results[0].error));
  }

  // ── 5. Mixed batch: multiple IDs each get their own independent verdict ──
  {
    const responses = {
      'ok-1': { ok: true, json: async () => ({ id: 'ok-1', name: 'a.jpg', trashed: false }) },
      'gone-1': { ok: false, status: 404, json: async () => ({ error: { message: 'File not found: gone-1.' } }) },
    };
    const { built, restore } = makeSandbox(async (url) => {
      const id = url.match(/files\/([^?]+)\?/)[1];
      return responses[id];
    });
    const r = (await built.adminDriveFileCheck({}, { file_ids: ['ok-1', 'gone-1'] })).data;
    restore();
    t('mixed batch checks both ids', r.checked === 2, r.checked);
    t('mixed batch: first is found', r.results.find(x => x.id === 'ok-1').found === true);
    t('mixed batch: second is not found', r.results.find(x => x.id === 'gone-1').found === false);
  }

  // ── 6. Input guards ──
  {
    const { built, restore } = makeSandbox(async () => ({ ok: true, json: async () => ({}) }));
    const empty = (await built.adminDriveFileCheck({}, { file_ids: [] })).data;
    const missing = (await built.adminDriveFileCheck({}, {})).data;
    const many = Array.from({ length: 60 }, (_, i) => `f-${i}`);
    const capped = (await built.adminDriveFileCheck({}, { file_ids: many })).data;
    restore();
    t('empty file_ids errors instead of silently no-op', empty.error !== undefined);
    t('missing file_ids errors', missing.error !== undefined);
    t('a 60-id request is capped at 50', capped.checked === 50, capped.checked);
  }

  console.log(`\ndrive-file-check: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
