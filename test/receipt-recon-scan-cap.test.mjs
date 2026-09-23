// Offline test for the Receipt Reconciler scan batch cap (Sep 22 2026).
// Run: node test/receipt-recon-scan-cap.test.mjs
// Extracts the REAL receiptReconScan from worker.js and runs it against fakes for Drive, Sheets,
// OCR and the matcher, so it can't drift from what ships. Checks: a 23-file drop is worked down
// 8 per Hub tap (5 per cron call), `remaining` is reported, nothing is scanned twice, and the
// cap is clamped to 1..10.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

function extractFn(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}

function extractSync(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
const helpers = new Function(`const RECEIPT_RECON_MIN_DATE_DEFAULT = '2026-07-01'; ${extractSync('receiptReconCutoff')}; ${extractSync('receiptBeforeCutoff')}; ${extractSync('receiptCutoffNote')}; ${extractSync('_rcNorm')}; ${extractSync('receiptReconGmailIdFromDescription')}; ${extractSync('receiptReconEntrySource')}; ${extractSync('receiptReconFindRescanMatches')}; return { receiptReconCutoff, receiptBeforeCutoff, receiptCutoffNote, _rcNorm, receiptReconGmailIdFromDescription, receiptReconEntrySource, receiptReconFindRescanMatches };`)();

function world(nFiles, cfg = {}, dateFor = () => '2026-09-10') {
  const queue = [];
  const files = Array.from({ length: nFiles }, (_, k) => ({ id: 'f' + k, name: 'r' + k + '.pdf', mimeType: 'application/pdf', webViewLink: '' }));
  let downloads = 0, cur = null;
  const deps = {
    fetchConfig: async () => cfg,
    getAccessToken: async () => 'tok',
    ensureTab: async () => {}, ensureColumns: async () => {},
    fetch: async () => ({ json: async () => ({ files }) }),
    fetchTab: async () => queue.slice(),
    receiptCustomerCards: async () => ({}),
    fetchTabs: async () => [[], [], []],
    driveDownload: async (tok, id) => { downloads++; cur = id; return { bytes: new ArrayBuffer(1), mime: 'application/pdf' }; },
    receiptExtract: async (env, bytes, mime) => { if (cfg.__bad && cfg.__bad.has(cur)) throw new Error('Could not process image'); return { vendor: 'Home Depot', total: 12.34, date: dateFor(cur), items: [] }; },
    receiptSuggestCore: () => ({ verdict: 'review' }),
    addRow: async (env, tab, row) => { queue.push(row); },
    setConfigKey: async (env, { key, value }) => { cfg[key] = value; },
    json: (o) => o,
    ...helpers,
    RECEIPT_RECON_QUEUE_HEADERS: [], RECEIPT_RECON_FOLDER_ID_DEFAULT: 'FOLDER',
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, `return (${extractFn('receiptReconScan')});`)(...names.map(n => deps[n]));
  return { scan: (b) => fn({}, b), queue, get downloads() { return downloads; } };
}

{
  const w = world(23);
  const r1 = await w.scan({});
  ok(r1.scanned === 8 && r1.remaining === 15, `Hub tap 1: 8 scanned, 15 remaining (got ${r1.scanned}/${r1.remaining})`);
  const r2 = await w.scan({});
  ok(r2.scanned === 8 && r2.remaining === 7, 'Hub tap 2: next 8, 7 remaining');
  const r3 = await w.scan({});
  ok(r3.scanned === 7 && r3.remaining === 0, 'Hub tap 3: last 7, 0 remaining');
  const r4 = await w.scan({});
  ok(r4.scanned === 0 && r4.remaining === 0, 'tap 4: nothing new');
  ok(w.queue.length === 23 && new Set(w.queue.map(q => q.Source_File_ID)).size === 23, 'all 23 queued exactly once');
  ok(w.downloads === 23, 'each file downloaded/OCRed exactly once');
}
{
  const w = world(12);
  const r = await w.scan({ max: 5 });
  ok(r.scanned === 5 && r.remaining === 7, 'cron call (max 5): 5 scanned, 7 remaining');
}
{
  ok((await world(30).scan({ max: 50 })).scanned === 10, 'max clamped to 10');
  ok((await world(30).scan({ max: -3 })).scanned === 8, 'nonsense max falls back to default 8');
  ok((await world(30, { receipt_recon_scan_batch: '3' }).scan({})).scanned === 3, 'Config receipt_recon_scan_batch overrides the default');
  ok((await world(30).scan(undefined)).scanned === 8, 'no body (old callers) still works');
}
{
  const r = await world(4).scan({});
  ok(r.scanned === 4 && r.remaining === 0, 'small drop: all scanned, remaining 0');
}
{
  // Unreadable file (Sep 22 2026, recon_smoke_test.png): retried 3 times, then skipped for good.
  const cfg = { __bad: new Set(['f0']) };
  const w = world(3, cfg);
  let r = await w.scan({});
  ok(r.scanned === 2 && r.errors.length === 1 && r.stuck.length === 0, 'bad file: attempt 1 errors, others still scanned');
  r = await w.scan({}); r = await w.scan({});
  ok(r.stuck.length === 1 && r.stuck[0] === 'r0.pdf', 'after 3 failed attempts it is reported as stuck');
  const before = w.downloads;
  r = await w.scan({});
  ok(w.downloads === before && r.scanned === 0 && r.errors === undefined && r.stuck.length === 1, '4th scan does not touch it again (no wasted OCR call)');
  ok(JSON.parse(cfg.receipt_recon_failures).f0.attempts === 3, 'failure count kept in Config');
}
{
  // Date cutoff (Sep 22 2026): receipts dated before 2026-07-01 go straight to Skipped with a note.
  const dates = { f0: '2023-09-25', f1: '2025-06-15', f2: '2026-06-30', f3: '2026-07-01', f4: '', f5: '2026-09-04' };
  const w = world(6, {}, id => dates[id]);
  const r = await w.scan({});
  const byId = Object.fromEntries(w.queue.map(q => [q.Source_File_ID, q]));
  ok(r.skipped_before_cutoff === 3 && r.cutoff === '2026-07-01', 'three pre-July-1 receipts reported as skipped (got ' + r.skipped_before_cutoff + ')');
  ok(['f0','f1','f2'].every(k => byId[k].Status === 'skipped' && /before the 2026-07-01 cutoff/.test(byId[k].Notes)), '2023, 2025 and Jun 30 2026 queued as skipped with the cutoff note');
  ok(byId.f3.Status === 'pending' && byId.f5.Status === 'pending', 'Jul 1 and later stay pending');
  ok(byId.f4.Status === 'pending', 'receipt with no readable date stays pending (never hidden)');
  const w2 = world(2, { receipt_recon_min_date: '2025-01-01' }, id => ({ f0: '2025-06-15', f1: '2024-12-31' })[id]);
  await w2.scan({});
  ok(w2.queue.find(q => q.Source_File_ID === 'f0').Status === 'pending' && w2.queue.find(q => q.Source_File_ID === 'f1').Status === 'skipped', 'Config receipt_recon_min_date moves the cutoff');
  const w3 = world(1, { receipt_recon_min_date: 'garbage' }, () => '2026-06-01');
  await w3.scan({});
  ok(w3.queue[0].Status === 'skipped', 'a bad Config value falls back to 2026-07-01');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
