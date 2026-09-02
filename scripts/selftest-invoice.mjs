// Live OCR canary for the vendor invoice auto-read (Sept 1 2026). Sibling to
// scripts/smoke-staging.mjs (B-141) and the same contract: exit 0 = all checks passed,
// exit 1 = at least one failed, so CI can gate on it.
//
// WHY THIS EXISTS, and why the other tests don't cover it: every other check on the invoice
// auto-read stubs the model. test/vendor-invoice-extract.test.mjs pins the parsing, the
// fail-open behaviour, the auth boundary and PAT-031 routing; the Playwright pass pins the
// form pre-fill. Both stub the Claude call, so both would stay green while the model silently
// stopped reading invoices — a deprecated model id, a changed response shape, a prompt that
// drifts. This is the ONE check that makes a real vision call end to end, against a known
// invoice with known values. If this goes red, a vendor's amount is about to come back wrong.
//
// The Worker holds ANTHROPIC_API_KEY; it never comes near this script or CI. All this sends is
// a synthetic fixture and the SELFTEST_TOKEN.
//
// Usage: SELFTEST_TOKEN=... node scripts/selftest-invoice.mjs [base-url]
// Add a fixture by dropping <name>.jpg (or .png/.pdf) + <name>.expected.json into
// test/fixtures/ — no Worker or workflow change needed. Good ones to add: a phone photo at an
// angle, a handwritten total, a PDF, an invoice with no invoice number at all.
import fs from 'fs';
import path from 'path';

const BASE = process.argv[2] || process.env.SELFTEST_BASE || 'https://maintenance-hub.brett-2f8.workers.dev';
const TOKEN = process.env.SELFTEST_TOKEN || '';
const DIR = new URL('../test/fixtures/', import.meta.url).pathname;
const MIME = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ' — ' + detail : ''}`); }
};

if (!TOKEN) {
  console.error('SELFTEST_TOKEN is not set.\n' +
    'Set it as a GitHub Secret (repo → Settings → Secrets and variables → Actions) and as a\n' +
    'Worker secret of the same name in the Cloudflare dashboard. wrangler.toml keeps\n' +
    'keep_vars = true, so a deploy will not wipe it.');
  process.exit(1);
}

const fixtures = fs.readdirSync(DIR)
  .filter(f => MIME[path.extname(f).toLowerCase()])
  .map(f => ({ file: f, expected: path.join(DIR, path.basename(f, path.extname(f)) + '.expected.json') }))
  .filter(x => fs.existsSync(x.expected));

if (!fixtures.length) { console.error(`No fixtures with a matching .expected.json in ${DIR}`); process.exit(1); }

async function main() {
  console.log(`Live OCR canary against ${BASE}`);
  console.log(`${fixtures.length} fixture(s)\n`);

  for (const { file, expected } of fixtures) {
    const want = JSON.parse(fs.readFileSync(expected, 'utf8'));
    const b64 = fs.readFileSync(path.join(DIR, file)).toString('base64');
    console.log(`POST /selftest/invoice-extract  (${file})`);

    let status, body;
    try {
      const resp = await fetch(`${BASE}/selftest/invoice-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, image_b64: b64, mime: MIME[path.extname(file).toLowerCase()] }),
      });
      status = resp.status;
      try { body = await resp.json(); } catch (_) { body = null; }
    } catch (e) {
      t('endpoint reachable', false, String(e && e.message));
      continue;
    }

    if (status === 503) { t('SELFTEST_TOKEN configured on the Worker', false, 'Worker returned 503 — add the secret in the Cloudflare dashboard'); continue; }
    if (status === 401) { t('SELFTEST_TOKEN matches the Worker', false, 'Worker returned 401 — the CI secret and the Worker secret differ'); continue; }
    t('responds 200', status === 200, `got ${status}`);
    if (status !== 200 || !body) continue;

    // A canary that reports success while the model is unreachable is worse than no canary:
    // invoiceExtract fails OPEN by design, so an empty result is not automatically a pass.
    t('model actually read it (not a fail-open blank)', body.read_ok === true, body.error_flag || 'read_ok false');
    if (!body.read_ok) continue;

    const ex = body.extract || {};
    t(`amount = ${want.amount}`, ex.amount === want.amount, `got ${JSON.stringify(ex.amount)}`);
    t(`invoice_number = ${want.invoice_number}`, ex.invoice_number === want.invoice_number, `got ${JSON.stringify(ex.invoice_number)}`);
    t(`invoice_date = ${want.invoice_date}`, ex.invoice_date === want.invoice_date, `got ${JSON.stringify(ex.invoice_date)}`);
    if (want.vendor_name_contains) {
      t(`vendor_name contains "${want.vendor_name_contains}"`,
        String(ex.vendor_name || '').toLowerCase().includes(want.vendor_name_contains.toLowerCase()),
        `got ${JSON.stringify(ex.vendor_name)}`);
    }
    // PAT-031: money-facing must stay on Claude. A silent re-route to the cheap tier is exactly
    // the kind of drift this canary is here to catch.
    t('routed to a Claude model (PAT-031)', /claude/i.test(String(body.model || '')), `got ${JSON.stringify(body.model)}`);
    console.log(`       (${body.model}, ${body.ms}ms)`);
    console.log('');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nA failure here means a vendor submitting an invoice right now would get a wrong or');
    console.log('blank amount pre-filled. Check the model id in MODEL_REGISTRY and the prompt in');
    console.log('invoiceExtract (worker.js) before assuming it is a flake.');
  }
  process.exit(fail ? 1 : 0);
}
main();
