// Oct 19 2026 - Brett: nothing the AI writes may say "licensed contractor / licensed electrician / qualified ..." - the repair is done by "an appropriate contractor".
// Runs the REAL FI block from worker.js against the in-memory fake (test/_fi-world.mjs). Covers: the pure sanitizer, every AI output path
// (structure, summary, route normalizer), the issue-type catalog, the report endpoint (AI-written text only), and the prompt rules.
import { world } from './_fi-world.mjs';
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };
const BAD = /\b(?:licen[sc]ed|certified|qualified|registered)\b|\bhave an? (?:electrician|hvac contractor|plumber|structural professional)\b|pest control/i;

// ── pure sanitizer ──
{
  const w = world(), f = w.fiContractorize;
  const cases = [
    ['Have a licensed electrician inspect the panel.', 'Have an appropriate contractor inspect the panel.'],
    ['Licensed contractors should replace the roof.', 'Appropriate contractors should replace the roof.'],
    ['Recommend a licensed and insured plumber.', 'Recommend an appropriate contractor.'],
    ['Have an electrician inspect the outlet.', 'Have an appropriate contractor inspect the outlet.'],
    ['Have an HVAC contractor evaluate the system.', 'Have an appropriate contractor evaluate the system.'],
    ['Have a structural professional assess the crack.', 'Have an appropriate contractor assess the crack.'],
    ['Call pest control to treat.', 'Call an appropriate contractor to treat.'],
    ['Hire a qualified roofer.', 'Hire an appropriate contractor.'],
    ['Repair by a certified HVAC technician.', 'Repair by an appropriate contractor.'],
    ['Contact a licensed professional.', 'Contact an appropriate contractor.'],
    ["the licensed electrician's report", "the appropriate contractor's report"],
    ['Use professional-grade caulk.', 'Use professional-grade caulk.'],
    ['Have the contractor fix it.', 'Have the contractor fix it.'],
    ['Replace the GFCI outlet.', 'Replace the GFCI outlet.'],
    ['', ''],
  ];
  for (const [i, o] of cases) { t('sanitize: ' + i, f(i) === o, f(i)); t('idempotent: ' + i, f(f(i)) === f(i)); }
  t('null/undefined safe', f(null) === '' && f(undefined) === '');
  t('does not throw on huge text', f('licensed electrician '.repeat(5000)).length > 0);
}

// ── AI structure endpoint ──
{
  const w = world();
  w.h.ai = JSON.stringify({ issues: [{ title: 'Panel double-tapped', trade: 'electrical', severity: 'high', detail: 'Breaker 4 is double-tapped.', likely_cause: 'Past modifications', recommended_fix: 'Have a licensed electrician correct the panel.', fix_source: 'suggested' }], area_condition: 'poor', area_summary: 'Needs a qualified contractor.' });
  const r = await w.fiStructure(w.env, { area_name: 'Electrical Panel', dictation: 'double tapped breaker' });
  t('structure ok', r.status === 200 && r.body.ok, r);
  t('structure issue wording', r.body.issues[0].recommended_fix === 'Have an appropriate contractor correct the panel.', r.body.issues[0]);
  t('structure area_summary wording', r.body.area_summary === 'Needs an appropriate contractor.', r.body.area_summary);
  t('no licensed wording anywhere in structure output', !BAD.test(JSON.stringify(r.body)), r.body);
}

// ── AI summary endpoint ──
{
  const w = world();
  const doc = { v: 1, property: { address: '1 A St' }, overall: { condition: 'fair' }, areas: [{ id: 'a1', name: 'Panel', condition: 'poor', issues: [{ id: 'i1', title: 'Double tap', trade: 'electrical', severity: 'high', recommended_fix: 'Fix' }] }] };
  w.h.ai = JSON.stringify({ overall: 'Hire a licensed electrician soon.', trades: { electrical: 'One visit by a qualified electrician covers all items.' }, priorities: [{ title: 'Call a licensed contractor', why: 'Safety; a certified electrician should look.' }] });
  const r = await w.fiSummarize(w.env, { doc });
  t('summary ok', r.status === 200 && r.body.ok, r);
  t('summary wording', r.body.summary.overall === 'Hire an appropriate contractor soon.' && r.body.summary.trades.electrical === 'One visit by an appropriate contractor covers all items.' && r.body.summary.priorities[0].title === 'Call an appropriate contractor', r.body.summary);
  t('no licensed wording anywhere in summary output', !BAD.test(JSON.stringify(r.body.summary)), r.body.summary);
}

// ── route normalizer (voice notes sorted by AI) ──
{
  const w = world();
  const n = w.fiNormalizeIssue({ title: 'Outlet dead', trade: 'electrical', severity: 'medium', detail: 'Needs a licensed electrician.', recommended_fix: 'Hire a certified electrician.', likely_cause: 'Call a qualified electrician if it persists' });
  t('normalizeIssue wording (used by route + structure)', n.detail === 'Needs an appropriate contractor.' && n.recommended_fix === 'Hire an appropriate contractor.' && !BAD.test(JSON.stringify(n)), n);
}

// ── catalog ──
{
  const w = world();
  const r = await w.fiTypesList(w.env);
  t('catalog loads', r.status === 200 && r.body.types.length > 20, r.status);
  t('no licensed/trade-hire wording in any catalog entry', !r.body.types.some(x => BAD.test(x.detail + ' ' + x.likely_cause + ' ' + x.recommended_fix + ' ' + x.name)), r.body.types.filter(x => BAD.test(x.recommended_fix)).map(x => x.recommended_fix));
  t('seed text itself is clean', !w.FI_TYPE_SEED.some(l => BAD.test(l)), w.FI_TYPE_SEED.filter(l => BAD.test(l)));
  // a legacy catalog row saved with the old wording is cleaned on the way out
  const o = w.fiTypeOut({ ID: 'x', Name: 'Panel', Recommended_Fix: 'Have an electrician correct the panel', Detail: 'licensed electrician needed', Likely_Cause: '' });
  t('legacy row cleaned on output', o.recommended_fix === 'Have an appropriate contractor correct the panel' && o.detail === 'appropriate contractor needed', o);
}

// ── report endpoint: AI-written text cleaned, inspector's own words untouched ──
{
  const w = world(), ID = 'fi_test_0002';
  const doc = { v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, owner: { id: 'O1', name: 'Premier' }, overall: { condition: 'fair', notes: 'ok' },
    areas: [
      { id: 'a1', name: 'Panel', condition: 'poor', issues: [{ id: 'i1', title: 'Double tap', trade: 'electrical', severity: 'high', detail: 'Needs a licensed electrician.', recommended_fix: 'Have an HVAC contractor look.', ai: true }] },
      { id: 'a2', name: 'Kitchen', condition: 'fair', issues: [{ id: 'i2', title: 'Leak', trade: 'plumbing', severity: 'low', recommended_fix: 'Inspector wrote: licensed plumber Joe', }] },
    ] };
  let r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc, meta: { client_name: 'Premier', inspector: 'Brett' } });
  t('save ok', r.status === 200 && r.body.ok, r);
  const tok = r.body.report_token;
  let p = await w.fiPublish(w.env, { id: ID, rev: r.body.rev, ack_warnings: true });
  t('publish ok', p.status === 200, p);
  const rep = await w.fiReport(w.env, { headers: { get: () => '' } }, new URL('https://x/fi/report?r=' + tok));
  t('report ok', rep.status === 200 && rep.body.ok, rep);
  const a = rep.body.doc.areas;
  t('AI issue text cleaned at report time', a[0].issues[0].detail === 'Needs an appropriate contractor.' && a[0].issues[0].recommended_fix === 'Have an appropriate contractor look.', a[0].issues[0]);
  t("inspector's own (non-AI) text left exactly as written", a[1].issues[0].recommended_fix === 'Inspector wrote: licensed plumber Joe', a[1].issues[0]);
  // stored doc unchanged (cleaning is on the way out only)
  const g = await w.fiGetInspection(w.env, new URL('https://x/fi/get?id=' + ID));
  t('stored doc not rewritten by report view', JSON.stringify(g.body).includes('licensed electrician'), g.status);
}

// ── prompts carry the rule ──
{
  const w = world();
  for (const [n, p] of [['structure', w.FI_STRUCTURE_SYSTEM], ['summary', w.FI_SUMMARY_SYSTEM], ['route', w.FI_ROUTE_SYSTEM]]) {
    t(n + ' prompt says "appropriate contractor"', /an appropriate contractor/.test(p));
    t(n + ' prompt forbids licensed/trade wording', /never write "licensed"/i.test(p));
  }
}

console.log(`fi-contractor-wording: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
