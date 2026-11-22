// Ops_Build_Queue #151 (Nov 22 2026) — AI house facts (Phase 1). Runs the REAL aiHouseFacts* / aiCacheTest source (sliced from worker.js) in a VM.
// Run from the repo root: node test/ai-house-facts.test.mjs
import fs from 'fs'; import vm from 'vm'; import assert from 'assert';
const src = fs.readFileSync('worker.js', 'utf8');
const a = src.indexOf('const AI_HOUSE_FACTS_TTL_MS'), b = src.indexOf('// GET|POST /admin/items-summarize-test');
assert(a > 0 && b > a);
const telemetry = []; let tabReads = 0, routeCalls = [], routeImpl;
const ctx = { console, JSON, Date, Math, Error, String, Number, Promise, Array, Object, Set, Map, RegExp,
  WOStatus: { statuses: ['New', 'Assigned', 'Complete'] }, ROUTE_AI_CACHE_MIN_CHARS: 4096,
  schedErrText: (e) => String((e && e.message) || e),
  json: (o, s) => ({ status: s || 200, body: o }),
  logTelemetry: async (env, r) => { telemetry.push(r); },
  fetchTabs: async () => { tabReads++; return [
    [{ ID: 'P2', Address: '2 Oak St', City: 'Town' }, { ID: 'P1', Address: '1 Elm St' }, { ID: 'P3', Address: 'Gone St', Active: 'FALSE' }],
    [{ Property_ID: 'P1', Unit_Label: '2B' }, { Property_ID: 'P1', Unit_Label: '1A' }],
    [{ ID: 'V1', Name: 'Acme Plumbing', Trades: 'Plumbing, HVAC' }]]; },
  fetchConfig: async () => ({ AI_House_Policy: ctx.__policy || '' }),
  routeAI: async (env, job) => { routeCalls.push(job); return routeImpl(job); } };
vm.createContext(ctx); vm.runInContext(src.slice(a, b) + '\n;Object.assign(globalThis,{aiHouseFactsHits,aiHouseFactsText,aiHouseFacts,aiHouseFactsSafe,aiCacheTest,reset(){_aiHouseFactsMemo=null}});', ctx);
let pass = 0; const t = (n, f) => f().then(() => { pass++; console.log('PASS', n); }, e => { console.log('FAIL', n, e.message); process.exitCode = 1; });

await t('hits scan: phone, email, code, dollar, rate words', async () => {
  assert.strictEqual(JSON.stringify(ctx.aiHouseFactsHits('call 555-123-4567')), '["a phone number"]');
  assert(ctx.aiHouseFactsHits('a@b.com').includes('an email address'));
  assert(ctx.aiHouseFactsHits('lockbox code 4821').includes('an access code or PIN'));
  assert(ctx.aiHouseFactsHits('$5').includes('a dollar sign'));
  assert(ctx.aiHouseFactsHits('markup is high').length === 1);
  assert.strictEqual(ctx.aiHouseFactsHits('1 Elm St, units 1A, 2B').length, 0);
});
await t('text is sorted, stable, skips inactive, lists units and trades', async () => {
  const d = { properties: [{ ID: 'P2', Address: '2 Oak' }, { ID: 'P1', Address: '1 Elm' }, { ID: 'P3', Address: 'X', Active: 'FALSE' }], units: [{ Property_ID: 'P1', Unit_Label: '2B' }, { Property_ID: 'P1', Unit_Label: '1A' }], vendors: [{ ID: 'V1', Name: 'Acme', Trades: 'Plumbing; HVAC' }] };
  const x = ctx.aiHouseFactsText(d), y = ctx.aiHouseFactsText(JSON.parse(JSON.stringify(d)));
  assert.strictEqual(x, y);
  assert(x.indexOf('P1: 1 Elm') < x.indexOf('P2: 2 Oak'));
  assert(x.includes('(units: 1A, 2B)') && !x.includes('X')); assert(x.includes('HVAC, Plumbing'));
  assert.strictEqual(ctx.aiHouseFactsHits(x).length, 0);
});
await t('empty data still builds', async () => { assert(ctx.aiHouseFactsText({}).includes('(none)')); });
await t('aiHouseFacts memoises the sheet read', async () => {
  ctx.reset(); tabReads = 0; const r1 = await ctx.aiHouseFacts({}); const r2 = await ctx.aiHouseFacts({});
  assert.strictEqual(tabReads, 1); assert.strictEqual(r1.memo, false); assert.strictEqual(r2.memo, true); assert.strictEqual(r1.text, r2.text);
});
await t('a policy with a phone number is refused; Safe logs and returns error, never throws', async () => {
  ctx.reset(); ctx.__policy = 'call 555-123-4567'; telemetry.length = 0;
  await assert.rejects(ctx.aiHouseFacts({}), /refused/);
  const s = await ctx.aiHouseFactsSafe({}, 'test'); assert.strictEqual(s.text, ''); assert(/phone/.test(s.error));
  assert.strictEqual(telemetry[0].Job_Type, 'ai_house_facts'); assert.strictEqual(telemetry[0].Success, 'FALSE');
  ctx.__policy = '';
});
await t('cache test: hit on call 2 reports HIT, prefix passed both times', async () => {
  ctx.reset(); routeCalls = []; let n = 0; routeImpl = async () => ({ tokens_in: 10, tokens_out: 1, cache_write: n++ ? 0 : 900, cache_read: n > 1 ? 900 : 0, model_used: 'm' });
  const r = await ctx.aiCacheTest({}, {}); assert.strictEqual(r.body.ok, true); assert.strictEqual(r.body.verdict, 'cache HIT on call 2');
  assert.strictEqual(routeCalls.length, 2); assert(routeCalls[0].cachePrefix === routeCalls[1].cachePrefix && routeCalls[0].cachePrefix.length > 50);
  assert.strictEqual(routeCalls[0].tier, 'REASON');
});
await t('cache test: no hit gives a plain reason mentioning the 4096 minimum', async () => {
  ctx.reset(); routeImpl = async () => ({ tokens_in: 10, tokens_out: 1, cache_write: 0, cache_read: 0 });
  const r = await ctx.aiCacheTest({}, { tier: 'CHEAP' }); assert(/4096/.test(r.body.verdict)); assert.strictEqual(routeCalls.at(-1).tier, 'CHEAP');
});
await t('cache test: credit pause returns paused, no second call', async () => {
  ctx.reset(); routeCalls = []; routeImpl = async () => { const e = new Error('paused'); e.name = 'AiCreditPausedError'; throw e; };
  const r = await ctx.aiCacheTest({}, {}); assert.strictEqual(r.body.paused, true); assert.strictEqual(routeCalls.length, 1);
});
await t('cache test: provider error returns 502 with the reason', async () => {
  ctx.reset(); routeImpl = async () => { throw new Error('boom'); };
  const r = await ctx.aiCacheTest({}, {}); assert.strictEqual(r.status, 502); assert(/boom/.test(r.body.error));
});
await t('route is wired and gated with the other admin routes', async () => {
  const i = src.indexOf("path === '/admin/ai-cache-test'"); assert(i > 0 && Math.abs(i - src.indexOf("path === '/admin/items-summarize-test'")) < 300);
});
console.log(pass + ' passed');
