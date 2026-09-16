// Live canary for the vendor-file-view proxy (rule 142 follow-up, Sept 2 2026). Sibling to
// scripts/selftest-invoice.mjs and the same contract: exit 0 = all checks passed, exit 1 = at
// least one failed.
//
// WHY THIS EXISTS: the fix for "vendor taps a receipt, gets a blank/black page" routes
// receipt/bill/invoice files through a new GET /vendor-file/view proxy instead of a direct
// drive.google.com link, because those files are deliberately never made anyone-with-link
// shareable (rule 13). That was verified against a real, live Attachments row and real Drive
// permissions, not guessed:
//   1. Confirms the premise — the target file has NO "anyone"/domain-public Drive permission,
//      so the OLD code path (a direct drive.google.com URL) really would 404/blank for a
//      vendor with no Google login.
//   2. Calls GET /selftest/vendor-file-view (worker.js) — which runs the EXACT SAME
//      Attachments-row lookup + Drive alt=media fetch as the real GET /vendor-file/view a
//      vendor's browser hits, just reporting JSON instead of streaming bytes — and checks the
//      response is a real, non-empty file with a plausible content-type and byte signature.
//
// A pass here means the actual byte-stream works end to end against a real logged Attachment,
// independent of ever needing a live vendor PIN session (which CI/this script has no way to
// obtain) or a browser.
//
// Usage:
//   SELFTEST_TOKEN=... SELFTEST_WO_ID=WO-1234 SELFTEST_FILE_ID=1AbC...xyz \
//     node scripts/selftest-vendor-file-view.mjs [base-url]
//
// SELFTEST_WO_ID / SELFTEST_FILE_ID must be a real WO_ID + Drive_File_ID pair already logged
// in the Attachments tab (File_Type receipt/bill/invoice) — e.g. copy one from a vendor's
// recent upload. There is no synthetic fixture for this one: it is deliberately testing
// against real production data, because the bug it guards was a real-data-only failure (a
// synthetic file the script itself uploads would need to go through the exact same
// unshared-by-design path to be a meaningful test, and this script has no Sheets write access
// to create that row safely).

const BASE = process.argv[2] || process.env.SELFTEST_BASE || 'https://maintenance-hub.brett-2f8.workers.dev';
const TOKEN = process.env.SELFTEST_TOKEN || '';
const WO_ID = process.env.SELFTEST_WO_ID || '';
const FILE_ID = process.env.SELFTEST_FILE_ID || '';

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ' — ' + detail : ''}`); }
};

if (!TOKEN) {
  console.error('SELFTEST_TOKEN is not set.\n' +
    'Set it as a GitHub Secret and as a Worker secret of the same name in the Cloudflare\n' +
    'dashboard (wrangler.toml keeps keep_vars = true, so a deploy will not wipe it). It is\n' +
    'shared with the OCR canary — no new secret needed if that one is already configured.');
  process.exit(1);
}
if (!WO_ID || !FILE_ID) {
  console.error('SELFTEST_WO_ID and SELFTEST_FILE_ID are required — a real WO_ID + Drive_File_ID\n' +
    'pair for a logged receipt/bill/invoice Attachment. Grab one from the Attachments tab or a\n' +
    'vendor\'s recent upload.');
  process.exit(1);
}

// Recognizable byte signatures for the file types this endpoint actually serves (JPEG, PNG,
// PDF). Anything else still counts as a pass on byte_length/content_type — this is a bonus
// check, not a whitelist of allowed types.
const SIGNATURES = [
  { name: 'JPEG', hex: 'ffd8ff' },
  { name: 'PNG',  hex: '89504e47' },
  { name: 'PDF',  hex: '25504446' },
];

async function main() {
  console.log(`Live vendor-file-view canary against ${BASE}`);
  console.log(`wo_id=${WO_ID}  file_id=${FILE_ID}\n`);

  // Step 1: confirm the file is genuinely NOT public — this is the premise the whole fix rests
  // on. If this ever starts succeeding, the sharing policy changed and the proxy may no longer
  // be the right fix (or rule 13 broke).
  console.log('GET https://drive.google.com/thumbnail?id=... (unauthenticated, no cookies)');
  try {
    const thumbResp = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(FILE_ID)}&sz=w150`, { redirect: 'manual' });
    const ct = thumbResp.headers.get('content-type') || '';
    const isRealImage = thumbResp.status === 200 && /^image\//.test(ct);
    t('file is NOT publicly viewable (confirms rule 13 / the bug premise)', !isRealImage,
      isRealImage ? `got 200 ${ct} — this file IS public, the proxy fix does not apply to it` : `got ${thumbResp.status} ${ct}`);
  } catch (e) {
    t('public-thumbnail check ran', false, String(e && e.message));
  }
  console.log('');

  // Step 2: the actual proxy, exercised through its SELFTEST_TOKEN-gated twin.
  console.log(`GET /selftest/vendor-file-view?wo_id=${WO_ID}&file_id=${FILE_ID}`);
  let status, body;
  try {
    const resp = await fetch(`${BASE}/selftest/vendor-file-view?wo_id=${encodeURIComponent(WO_ID)}&file_id=${encodeURIComponent(FILE_ID)}&token=${encodeURIComponent(TOKEN)}`);
    status = resp.status;
    try { body = await resp.json(); } catch (_) { body = null; }
  } catch (e) {
    t('endpoint reachable', false, String(e && e.message));
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  if (status === 503) { t('SELFTEST_TOKEN configured on the Worker', false, 'Worker returned 503 — add the secret in the Cloudflare dashboard'); }
  else if (status === 401) { t('SELFTEST_TOKEN matches the Worker', false, 'Worker returned 401 — the CI secret and the Worker secret differ'); }
  else {
    t('endpoint responds 200', status === 200, `got ${status}${body && body.error ? ' — ' + body.error : ''}`);
  }
  if (status !== 200 || !body) {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }

  t('Drive fetch succeeded (viewInternalFile\'s own success flag)', body.success === true, JSON.stringify(body));
  t('response has real bytes', (body.byte_length || 0) > 0, `byte_length=${body.byte_length}`);
  t('content-type looks like a file, not an error page', /^(image|application)\//.test(body.content_type || ''), `got ${JSON.stringify(body.content_type)}`);

  const sig = SIGNATURES.find(s => (body.first_bytes_hex || '').toLowerCase().startsWith(s.hex));
  if (sig) console.log(`       (byte signature matches ${sig.name})`);
  else console.log(`       (first bytes: ${body.first_bytes_hex} — no known signature match, not necessarily a failure)`);
  console.log(`       (${body.ms}ms)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nA failure here means a vendor tapping this receipt right now would still see a');
    console.log('blank/black page. Check viewInternalFile in worker.js (Attachments-row lookup, Drive');
    console.log('access token, alt=media fetch) before assuming it is a flake.');
  }
  process.exit(fail ? 1 : 0);
}
main();
