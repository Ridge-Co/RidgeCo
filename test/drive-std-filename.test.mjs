// Queue #115 Phase 1: the standard Drive file name for NEW uploads (pure), plus pins on how the upload session uses it.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const consts = src.match(/const DRIVE_STD_TYPES[^\n]*\nconst DRIVE_MIME_EXT[^\n]*\n/)[0];
const { driveStdFileName } = new Function(consts + grab('driveStdFileName') + '\nreturn {driveStdFileName};')();
let pass = 0, fail = 0; const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };

const at = (iso) => new Date(iso);
let n = driveStdFileName({ woId: '1234', fileType: 'before', originalName: 'IMG_4821.JPG', mimeType: 'image/jpeg', now: at('2026-11-16T19:15:02Z'), rand: 'k3f9' });
t('format', n === '2026-11-16_WO-1234_before_141502-k3f9.jpg', n);
t('Eastern date across midnight (UTC 02:30 on the 17th is still the 16th in New York)', driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-11-17T04:30:00Z'), rand: 'aaaa' }).startsWith('2026-11-16_'), driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-11-17T04:30:00Z'), rand: 'aaaa' }));
t('summer (EDT) hour', driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-07-04T16:00:00Z'), rand: 'aaaa' }).includes('_120000-'));
t('winter (EST) hour', driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-12-04T17:00:00Z'), rand: 'aaaa' }).includes('_120000-'));
t('DST change day: 2026-11-01 06:30Z is 01:30 EST', driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-11-01T06:30:00Z'), rand: 'aaaa' }).includes('_013000-'));
t('midnight hour is 00, not 24', /_00\d{4}-/.test(driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-11-17T05:05:05Z'), rand: 'aaaa' })), driveStdFileName({ woId: '1', fileType: 'after', originalName: 'a.png', now: at('2026-11-17T05:05:05Z'), rand: 'aaaa' }));
t('extension from the name wins, lowercased', driveStdFileName({ woId: '1', fileType: 'report', originalName: 'Scan.PDF', mimeType: 'image/png', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).endsWith('.pdf'));
t('extension from mime when the name has none', driveStdFileName({ woId: '1', fileType: 'before', originalName: 'image', mimeType: 'image/heic', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).endsWith('.heic'));
t('unknown extension falls back to bin', driveStdFileName({ woId: '1', fileType: 'other', originalName: '', mimeType: 'application/x-weird', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).endsWith('.bin'));
t('no WO id uses "upload"', driveStdFileName({ fileType: 'photo', originalName: 'a.jpg', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).includes('_upload_'));
t('a video sent as "photo" is typed video', driveStdFileName({ woId: '1', fileType: 'photo', originalName: 'a.mov', mimeType: 'video/quicktime', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).includes('_video_'));
t('unknown type becomes other', driveStdFileName({ woId: '1', fileType: 'weird!!', originalName: 'a.jpg', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).includes('_other_'));
const hostile = ['../../x.jpg', '😀😀😀.jpg', 'a'.repeat(300) + '.jpg', 'x/y\\z.jp g', '..', '.hidden'];
for (const h of hostile) { const o = driveStdFileName({ woId: '12/../34', fileType: 'before', originalName: h, mimeType: 'image/jpeg', now: at('2026-11-16T19:00:00Z') }); t('hostile name stays safe: ' + h.slice(0, 12), /^[A-Za-z0-9_.-]+$/.test(o) && o.length < 80 && !o.includes('..'), o); }
t('hostile WO id is cleaned', driveStdFileName({ woId: '12/../34', fileType: 'before', originalName: 'a.jpg', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).includes('_WO-12..34_') === false && !driveStdFileName({ woId: '12/../34', fileType: 'before', originalName: 'a.jpg', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).includes('/'));
t('never carries the original name', !driveStdFileName({ woId: '1', fileType: 'before', originalName: 'Mrs Smith 12 Main St.jpg', now: at('2026-11-16T19:00:00Z'), rand: 'aaaa' }).toLowerCase().includes('smith'));
const same = new Set(Array.from({ length: 200 }, () => driveStdFileName({ woId: '1', fileType: 'before', originalName: 'a.jpg', now: at('2026-11-16T19:00:00Z') })));
t('two uploads in the same second differ (random part)', same.size > 150, same.size);

// Wiring pins on createUploadSession
const cus = grab('createUploadSession');
t('both Drive session bodies use the standard name', (cus.match(/\{name:driveName,parents/g) || []).length === 2 && !/JSON\.stringify\(\{name:fileName/.test(cus));
t('the original name is still returned as file_name (both branches) and drive_name is added', (cus.match(/file_name:fileName,drive_name:driveName/g) || []).length === 2);
t('Fix Check keeps its own name (keep_name)', /keep_name: true, file_name: 'FixCheck-'/.test(src) && /body\.keep_name \? fileName/.test(cus));
t('bills and invoices still go to the internal folder', /_Internal — Vendor Bills/.test(cus) && /fileType === 'invoice' \|\| fileType === 'bill'/.test(cus));
t('NON_SHARE_FILE_TYPES unchanged', /const NON_SHARE_FILE_TYPES = \['receipt','bill','invoice','tax_id_doc'\];/.test(src));
t('body.folder_id is still honoured', /if\(body\.folder_id\)\{woFolder=\{id:body\.folder_id/.test(cus));
t('the property folder is skipped only when a WO folder id came back and it is not a bill', /needsPropFolder = fileType==='invoice' \|\| fileType==='bill' \|\| !body\.folder_id/.test(cus));
const la = grab('logAttachment');
t('logAttachment stores Drive_Name only after ensureColumns, never failing the log', /ensureColumns\(env, 'Attachments', \['Drive_Name'\]\)/.test(la) && /_driveName = ''; await softFail/.test(la) && /Drive_Name:_driveName/.test(la));
t('File_Name still holds the original', /File_Name:body\.file_name\|\|''/.test(la));
t('the shared-link log passes drive_name through', /drive_name: body\.drive_name/.test(grab('woSharedLogAttachment')));
for (const f of ['index.html', 'vendor.html', 'tenant.html', 'owner.html']) t(f + ' passes drive_name to /log-attachment', /wo_folder_url: res\.wo_folder_url, drive_name: res\.drive_name \|\| ''/.test(fs.readFileSync(f, 'utf8')));
t('wo.html passes drive_name', /wo_folder_url:res\.wo_folder_url,drive_name:res\.drive_name\|\|''/.test(fs.readFileSync('wo.html', 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
