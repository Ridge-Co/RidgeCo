// Every trade the Hub offers must resolve to a QuickBooks account, or book to General
// deliberately rather than by accident.
import fs from 'fs';
const worker = fs.readFileSync('worker.js','utf8');
const html   = fs.readFileSync('index.html','utf8');
function grab(src, name){
  let i = src.indexOf('function '+name+'(');
  if(i<0) throw new Error('missing '+name);
  let d=0,j=src.indexOf(')',i); j=src.indexOf('{',j);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1);
}
function grabConst(src, name){
  const i = src.indexOf('const '+name+' = {');
  let d=0,j=src.indexOf('{',i);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1)+';';
}
const { resolveTrade, QB_TRADE_MAP } = new Function(
  grabConst(worker,'QB_TRADE_ALIASES') + '\n' + grabConst(worker,'QB_TRADE_MAP') + '\n' +
  grab(worker,'resolveTrade') + '\nreturn { resolveTrade, QB_TRADE_MAP };')();

const TRADES = JSON.parse(html.match(/var TRADES = (\[[^\]]+\]);/)[1]);

let pass=0,fail=0;
const t=(n,c,got)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n, got!==undefined?('got '+JSON.stringify(got)):'');} };

// the bug that prompted this
t('"Electric" no longer silently books to General', resolveTrade('Electric').name==='Electrical', resolveTrade('Electric'));
t('and it is flagged as an alias, not a clean match', resolveTrade('Electric').via==='Electric');
t('"Electrical" matches outright', resolveTrade('Electrical').name==='Electrical' && !resolveTrade('Electrical').via);

// every trade the Hub can produce must land somewhere real
TRADES.forEach(function(tr){
  const r = resolveTrade(tr);
  t('Hub trade "'+tr+'" resolves to a mapped account', !!QB_TRADE_MAP[r.name], r);
});
t('every Hub trade is a clean match, not a fallback',
  TRADES.every(function(tr){ return resolveTrade(tr).matched; }),
  TRADES.filter(function(tr){ return !resolveTrade(tr).matched; }));

// legacy spellings still resolve so old rows keep working
t('"Other" books to General deliberately', resolveTrade('Other').name==='General' && resolveTrade('Other').matched);
t('case-only difference still resolves', resolveTrade('plumbing').name==='Plumbing');
t('unknown trade falls back and says so', resolveTrade('Underwater Basketweaving').matched===false);
t('blank trade falls back', resolveTrade('').name==='General' && resolveTrade('').matched===false);


// ── The invariant that just broke: every trade select must offer every canonical trade,
// and no select may still carry a hardcoded list that has drifted from TRADES.
const selects = [...html.matchAll(/<select id="([a-z-]*trade[a-z-]*)"[^>]*>([\s\S]*?)<\/select>/g)]
  .map(m => ({ id: m[1], body: m[2] }))
  .filter(x => x.id !== 'trade-access-val');   // that one picks YES/NO, not a trade
t('found the trade selects', selects.length >= 5, selects.map(x=>x.id));
selects.forEach(function(sel){
  const hardcoded = [...sel.body.matchAll(/<option[^>]*>([^<]+)<\/option>/g)]
    .map(m => m[1].trim())
    .filter(v => v && !/^(select|all trades)/i.test(v));
  t('select #' + sel.id + ' has no stale hardcoded trades', hardcoded.length === 0, hardcoded);
});

// tradeOptions must keep a value it doesn't recognise, or an edit form blanks the trade
const tradeOptionsSrc = html.slice(html.indexOf('function tradeOptions('));
t('tradeOptions carries an unknown selected value',
  /TRADES\.indexOf\(sel\) === -1/.test(tradeOptionsSrc.slice(0, 800)));

// the two forms that write back must be populated from the one list
const pop = html.slice(html.indexOf('function populateTradeControls('), html.indexOf('function populateTradeControls(') + 900);
t('the edit-WO select is populated from TRADES', /ewo-trade/.test(pop));
t('the edit-vendor select is populated from TRADES', /ev-trade/.test(pop));

// access defaults must survive the rename
t('access defaults fall back to the resolved trade name',
  /tradeDefault = tradeDefaults\[resolvedName\]/.test(worker));
t('and resolve the config KEYS too, since his rules are saved under the old spelling',
  /resolveTrade\(kk\)\.name === resolvedName/.test(worker));

// a trade sharing the General account must still say so
t('a trade with no dedicated account still warns',
  /has no dedicated QuickBooks account yet/.test(worker));


// ── Every portal that can CREATE or FILTER a work order must speak the same vocabulary.
// Two dialects means the Hub's trade filter silently returns nothing for jobs a tenant or
// owner submitted, and vice versa.
['submit.html','owner-submit.html','owner.html','vendor.html'].forEach(function(f){
  const src = fs.readFileSync(f,'utf8');
  const stale = [...src.matchAll(/<option>([^<]+)<\/option>/g)]
    .map(m => m[1].trim())
    .filter(v => /^(Electric|Other)$/.test(v));
  t(f + ' has no stale trade spellings', stale.length === 0, stale);
  TRADES.forEach(function(tr){
    if (src.indexOf('<option>Plumbing</option>') === -1) return;   // file has no trade list
    t(f + ' offers "' + tr + '"', src.indexOf('<option>'+tr+'</option>') !== -1);
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
