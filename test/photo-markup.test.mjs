// Queue #163 (Nov 22 2026): photo markup Phase 1 (tenant request flow). Run: node test/photo-markup.test.mjs
import fs from 'node:fs';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const src = fs.readFileSync(new URL('photo-markup.js', root), 'utf8');
const tenant = fs.readFileSync(new URL('tenant.html', root), 'utf8');
const worker = fs.readFileSync(new URL('worker.js', root), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const m = require('../photo-markup.js');

ok(!/https?:\/\//.test(src), 'no external URL in photo-markup.js');
ok(!/\beval\s*\(|new Function\s*\(|XMLHttpRequest|fetch\s*\(/.test(src), 'no eval, no network call');
ok(!/catch\s*\(\w*\)\s*\{\s*\}/.test(src), 'no empty catch');
ok(typeof m.open === 'function' && typeof m.fitSize === 'function' && typeof m.markedName === 'function', 'exports present');
const ek = Object.keys(m.strings.en).sort().join(), sk = Object.keys(m.strings.es).sort().join();
ok(ek === sk, 'EN and ES strings have the same keys');
ok(Object.values(m.strings.es).every(v => v.trim()), 'no empty Spanish string');
// size cap
ok(JSON.stringify(m.fitSize(4000, 3000)) === JSON.stringify({ w: 2560, h: 1920, scale: 0.64 }), 'long side capped at 2560');
ok(m.fitSize(1000, 800).w === 1000 && m.fitSize(1000, 800).scale === 1, 'small photo is never upscaled');
ok(m.fitSize(3000, 6000).h === 2560, 'portrait capped on the long side');
ok(m.fitSize(0, 5).w === 0, 'bad size gives zero, not NaN');
ok(m.markedName('IMG_1.HEIC') === 'marked-IMG_1.jpg' && m.markedName('marked-a.jpg') === 'marked-a.jpg', 'marked copy name pairs with its original, no double prefix');
// tenant wiring
ok(tenant.includes('<script src="photo-markup.js"></script>'), 'tenant.html loads photo-markup.js');
const sub = tenant.slice(tenant.indexOf('function submitNewRequest'));
ok(sub.indexOf("uploadTenantPhotoEx(srFiles[i], woId, '', '')") > -1, 'the original uploads first, with no marked_from');
ok(sub.indexOf("uploadTenantPhotoEx(srFiles[i]") < sub.indexOf('uploadTenantPhotoEx(mf, woId, \'\', res.fileId)'), 'marked copy uploads after the original and carries its id');
ok(sub.includes('failedMarked++') && sub.includes('marked-up cop'), 'a failed marked copy is counted and shown to the tenant');
ok(sub.includes('if (!res.ok) { failedUploads++'), 'a failed original is still counted as before');
ok(tenant.includes("fd.append('marked_from', markedFrom)"), 'marked_from is sent as a form field');
ok(/function srMarkUp[\s\S]*rcMarkup\.open\(srFiles\[i\]/.test(tenant), 'markup always starts from the original file');
ok(!/capture="(environment|camera)"/.test(tenant), 'no capture attribute added');
ok(!/<label[^>]*>[^<]*<input type="file"/.test(tenant), 'UI_QA grep: no label-wrapped file input');
// worker
const fn = worker.slice(worker.indexOf('async function handlePhotoUploadClean'), worker.indexOf('// ── WO HELPERS'));
ok(fn.includes("formData.get('marked_from')") && fn.includes('Marked_From'), 'worker reads marked_from and writes Marked_From');
ok(fn.includes("ensureColumns(env, 'Attachments', ['Marked_From'])") && !/ensureTab/.test(fn), 'additive column via ensureColumns, never ensureTab');
ok(fn.includes('[A-Za-z0-9_-]{5,120}'), 'marked_from must be a plain id shape');
ok(fn.includes('upload_photo_attachment_row_failed') && fn.includes('upload_photo_wo_folder_link_failed'), 'the two former silent catches now log telemetry');
ok(!/catch\(\w+\)\s*\{\s*\/\*[^*]*\*\/\s*\}/.test(fn), 'no swallowing catch left in handlePhotoUploadClean');
console.log(n + ' checks passed');
