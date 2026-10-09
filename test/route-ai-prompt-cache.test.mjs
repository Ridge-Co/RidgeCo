// Ops_Build_Queue #89 (Oct 9 2026) — routeAI prompt-caching plumbing. Runs the REAL routeAI /
// callClaude / callGemini source (sliced out of worker.js) in a VM with a mocked fetch, asserting:
// legacy jobs build byte-identical requests, cache_control only on large static prefixes (ordered
// before media), cache reads priced 0.1x / writes 1.25x, tokens_in includes cached tokens, Gemini
// puts the stable prefix first. Run from the repo root: node test/route-ai-prompt-cache.test.mjs
import fs from 'fs'; import vm from 'vm'; import assert from 'assert';
const src = fs.readFileSync('worker.js','utf8');
const a = src.indexOf('const MODEL_REGISTRY = {'), b = src.indexOf('// GET /model-registry');
assert(a>0 && b>a);
const section = src.slice(a,b);
const telemetry=[]; const calls=[];
let nextResp;
const ctx = { console, JSON, Date, Math, Error, String, Number, Promise, Array, Object,
  logTelemetry: async (env, rec)=>{ telemetry.push(rec); },
  fetch: async (url, opts)=>{ calls.push({url, body: JSON.parse(opts.body)}); const r = nextResp(url); return { ok: r.ok!==false, status: r.status||200, json: async()=>r.json }; } };
vm.createContext(ctx); vm.runInContext(section + '\n;globalThis.routeAI=routeAI;globalThis.callClaude=callClaude;', ctx);
const env = { ANTHROPIC_API_KEY:'k', GEMINI_API_KEY:'g' };
const claudeOK = (usage)=>({json:{content:[{text:'{"a":1}'}], usage}});
let pass=0; const t=(n,f)=>f().then(()=>{pass++;console.log('PASS',n)},e=>{console.log('FAIL',n,e.message);process.exitCode=1});

await t('legacy job (no cache fields): request shape unchanged, tokens_in==input_tokens', async()=>{
  calls.length=0; telemetry.length=0; nextResp=()=>claudeOK({input_tokens:500,output_tokens:100});
  const media={type:'image',source:{type:'base64',media_type:'image/jpeg',data:'AAA'}};
  const r=await ctx.routeAI(env,{type:'receipt_parse',moneyFacing:true,media,prompt:'P',maxTokens:700});
  const body=calls[0].body;
  assert.deepStrictEqual(body.messages[0].content,[media,{type:'text',text:'P'}]);
  assert.strictEqual(body.system,undefined); assert.strictEqual(JSON.stringify(body).includes('cache_control'),false);
  assert.strictEqual(r.tokens_in,500); assert.strictEqual(r.cache_read,0);
  const expect=(500/1000*0.003)+(100/1000*0.015); assert(Math.abs(Number(telemetry[0].Est_Cost)-expect)<1e-6, telemetry[0].Est_Cost+' vs '+expect);
  assert.strictEqual(telemetry[0].Notes,'pinned');
});
await t('legacy text-only job sends bare string', async()=>{
  calls.length=0; nextResp=()=>claudeOK({input_tokens:10,output_tokens:5});
  await ctx.routeAI(env,{type:'tenant_message',prompt:'hello'});
  assert.strictEqual(calls[0].body.messages[0].content,'hello');
});
await t('large cachePrefix+system: breakpoints set, media after prefix, prompt last', async()=>{
  calls.length=0; nextResp=()=>claudeOK({input_tokens:200,cache_creation_input_tokens:3000,cache_read_input_tokens:0,output_tokens:100});
  const media={type:'image',source:{}}; const big='x'.repeat(5000);
  await ctx.routeAI(env,{type:'estimate_markup',prompt:'Q',media,cachePrefix:big,system:big});
  const b=calls[0].body, c=b.messages[0].content;
  assert.strictEqual(c.length,3); assert.deepStrictEqual(c[0].cache_control,{type:'ephemeral'}); assert.deepStrictEqual(c[1],media); assert.strictEqual(c[2].text,'Q');
  assert(Array.isArray(b.system)&&b.system[0].cache_control.type==='ephemeral');
});
await t('small cachePrefix: no cache_control marker, still ordered first', async()=>{
  calls.length=0; nextResp=()=>claudeOK({input_tokens:50,output_tokens:5});
  await ctx.routeAI(env,{type:'estimate_markup',prompt:'Q',cachePrefix:'short',system:'sys'});
  const b=calls[0].body; assert.strictEqual(JSON.stringify(b).includes('cache_control'),false);
  assert.strictEqual(b.system,'sys'); assert.strictEqual(b.messages[0].content[0].text,'short');
});
await t('cache read priced at 0.1x, cache write at 1.25x, totals include cached tokens, Notes logged', async()=>{
  calls.length=0; telemetry.length=0; nextResp=()=>claudeOK({input_tokens:200,cache_creation_input_tokens:1000,cache_read_input_tokens:4000,output_tokens:100});
  const r=await ctx.routeAI(env,{type:'estimate_markup',prompt:'Q',cachePrefix:'x'.repeat(5000)});
  assert.strictEqual(r.tokens_in,5200); assert.strictEqual(r.cache_read,4000); assert.strictEqual(r.cache_write,1000);
  const p=0.003; const expect=(200/1000*p)+(4000/1000*p*0.1)+(1000/1000*p*1.25)+(100/1000*0.015);
  assert(Math.abs(Number(telemetry[0].Est_Cost)-expect)<1e-6, telemetry[0].Est_Cost+' vs '+expect);
  assert(/cache_read=4000 cache_write=1000/.test(telemetry[0].Notes), telemetry[0].Notes);
});
await t('Gemini: cachePrefix first in text, systemInstruction set, cached tokens reported, cost unchanged formula', async()=>{
  calls.length=0; telemetry.length=0;
  nextResp=()=>({json:{candidates:[{content:{parts:[{text:'{"ok":1}'}]}}],usageMetadata:{promptTokenCount:3000,candidatesTokenCount:50,cachedContentTokenCount:2500}}});
  const r=await ctx.routeAI(env,{type:'items_summarize',prompt:'Q',schema:true,cachePrefix:'PFX',system:'SYS'});
  const b=calls[0].body; assert.strictEqual(b.contents[0].parts[0].text,'PFX\n\nQ'); assert.strictEqual(b.systemInstruction.parts[0].text,'SYS');
  assert.strictEqual(r.cache_read,2500); assert.strictEqual(r.tier_used,'CHEAP');
  const expect=(3000/1000*0.0003)+(50/1000*0.0025); assert(Math.abs(Number(telemetry[0].Est_Cost)-expect)<1e-6);
});
await t('Gemini legacy job body unchanged', async()=>{
  calls.length=0; nextResp=()=>({json:{candidates:[{content:{parts:[{text:'ok'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2}}});
  await ctx.routeAI(env,{type:'items_summarize',prompt:'Q'});
  assert.deepStrictEqual(calls[0].body,{contents:[{parts:[{text:'Q'}]}]});
});
console.log('passed',pass);
