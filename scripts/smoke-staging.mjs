// B-141 smoke-test harness (autonomy prerequisite #2 — self-verification).
// Curls the staging Worker's PUBLIC_PATHS endpoints and asserts expected JSON
// shape — the machine's stand-in for "Brett taps the app." Deliberately scoped
// to what's actually reachable without an auth token: staging has no seeded
// fixture data yet (that's B-145, golden-path tests, a separate item), and
// the WORKER_SECRET-gated endpoints need either that secret or real records
// to exercise meaningfully — neither exists here. This suite covers what CAN
// be checked today: is staging alive, connected to ITS OWN sheet (not prod's),
// and is every expected tab present. Extend as B-145 lands seeded fixtures.
//
// Usage: node scripts/smoke-staging.mjs [base-url]
// Exit 0 = all checks passed. Exit 1 = at least one failed (CI-friendly).

const BASE = process.argv[2] || 'https://maintenance-hub-staging.brett-2f8.workers.dev';
const STAGING_SHEET_TAIL = '0H6dFY'; // last chars of the staging Sheet_ID (16PCD3tIDatZLhMeHdbeYC-4R4BVNCcZ26iBY90H6dFY)
                                      // guards against staging ever silently pointing at the prod sheet
const EXPECTED_TABS = ['Work_Orders', 'Vendors', 'Invoices', 'Config'];

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

async function get(path) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}cb=${Date.now()}`; // bust any edge cache
  const resp = await fetch(url);
  let body = null;
  try { body = await resp.json(); } catch (_) { /* non-JSON response, leave null */ }
  return { status: resp.status, body };
}

async function main() {
  console.log(`Smoke-testing ${BASE}\n`);

  console.log('GET /health');
  try {
    const { status, body } = await get('/health');
    t('responds 200', status === 200, `got ${status}`);
    t('ok:true', !!(body && body.ok === true));
    t('points at the STAGING sheet, not prod', !!(body && body.sheet_tail === STAGING_SHEET_TAIL), `got sheet_tail=${body && body.sheet_tail}`);
    for (const tab of EXPECTED_TABS) {
      t(`tabs.${tab} present`, !!(body && body.tabs && Object.prototype.hasOwnProperty.call(body.tabs, tab)));
    }
    t('tabs.* are numbers (row counts), not errors', !!(body && body.tabs && Object.values(body.tabs).every(v => typeof v === 'number')));
  } catch (e) { t('reachable at all', false, String(e && e.message || e)); }

  console.log('\nGET /version');
  try {
    const { status, body } = await get('/version');
    t('responds 200', status === 200, `got ${status}`);
    t('returns a version string', !!(body && typeof body.version === 'string' && body.version.length > 0));
  } catch (e) { t('reachable at all', false, String(e && e.message || e)); }

  // NOTE: prod/main is intentionally NOT smoke-tested by this script — it has
  // no /health route (health() only responds meaningfully off the staging
  // hostname's isolated sheet per B-140). Pointing this at maintenance-hub
  // (prod) would just re-confirm the auth gate 401s everything else, which
  // tells us nothing new and risks someone mistaking a prod run for a real
  // staging verification.

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
