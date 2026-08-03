// ensureColumns must place new headers past the widest row, and write single cells.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
function grab(name){
  let i = src.indexOf('async function '+name+'(');
  if(i<0) i = src.indexOf('function '+name+'(');
  if(i<0) throw new Error('missing '+name);
  let d=0,j=src.indexOf('{',i);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1);
}
function grabCol(){
  const i = src.indexOf('function col(index)');
  let d=0,j=src.indexOf('{',i);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1);
}
const { ensureColumns } = new Function('sheetsRequest',
  grabCol() + '\n' + grab('ensureColumns') + '\nreturn { ensureColumns };')(
  async (env, method, path, body) => { calls.push({method, path, body}); return stub; });

let calls=[], stub={};
let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n);} };

// existing column -> no write at all
calls=[]; stub={ values: [['ID','Name','In_House'],['1','x','TRUE']] };
await ensureColumns({}, 'Vendors', ['In_House']);
t('already present writes nothing', calls.length===1 && calls[0].method==='GET');

// missing column -> single-cell batchUpdate, never a bare-range POST
calls=[]; stub={ values: [['ID','Name'],['1','x']] };
await ensureColumns({}, 'Vendors', ['In_House']);
const w = calls.find(c=>c.method!=='GET');
t('writes via values:batchUpdate', w && w.path==='/values:batchUpdate');
t('never POSTs a bare range', !calls.some(c=>c.method==='POST' && /\/values\/[^:]+$/.test(c.path.split('?')[0])));
t('single cell only', w && w.body.data.length===1 && w.body.data[0].values[0].length===1);
t('lands in column C', w && w.body.data[0].range==='Vendors!C1');

// a blank-header column with data underneath must NOT be overwritten
calls=[]; stub={ values: [['ID','Name'],['1','x','secret-data']] };
await ensureColumns({}, 'Vendors', ['In_House']);
const w2 = calls.find(c=>c.method!=='GET');
t('skips past data hiding under a blank header', w2 && w2.body.data[0].range==='Vendors!D1');

// two missing columns get distinct cells
calls=[]; stub={ values: [['ID'],['1']] };
await ensureColumns({}, 'Invoice_Review', ['QB_Bill_To','QB_In_House']);
const w3 = calls.find(c=>c.method!=='GET');
t('two columns, two cells', w3 && w3.body.data.length===2);
t('and they do not collide', w3 && w3.body.data[0].range!==w3.body.data[1].range);

// empty tab
calls=[]; stub={ values: [] };
await ensureColumns({}, 'New_Tab', ['A']);
const w4 = calls.find(c=>c.method!=='GET');
t('empty tab writes at column A', w4 && w4.body.data[0].range==='New_Tab!A1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
