// Prove the ambiguity fix on the exact shapes the reviewer flagged.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
function grab(name){
  const i = src.indexOf('function '+name+'(');
  if(i<0) throw new Error('missing '+name);
  let d=0,j=src.indexOf('{',i);const s=j;
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1);
}
const { qbNormName, qbMatchEntity } = new Function(
  grab('qbNormName') + '\n' + grab('qbMatchEntity') + '\nreturn { qbNormName, qbMatchEntity };')();

let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n);} };

const QB=[{id:'12',name:'Smith Inc',email:''},{id:'45',name:'Smith Properties LLC',email:''}];
const m1=qbMatchEntity(QB,'Smith Co','');
t('two LLCs under one family name -> ambiguous', m1 && m1.confidence==='ambiguous');
t('ambiguous carries both candidates', m1 && m1.candidates.length===2);

// order must not change the verdict
const m1r=qbMatchEntity([...QB].reverse(),'Smith Co','');
t('verdict is order-independent', m1r.confidence==='ambiguous');

// shared owner email across unrelated LLCs must NOT be strong
const EM=[{id:'70',name:'Calvert Street Holdings LLC',email:'owner@x.com'},
          {id:'71',name:'Goldszmidt Properties LLC',email:'owner@x.com'}];
const m2=qbMatchEntity(EM,'Bmore Management','owner@x.com');
t('shared email across unrelated names is not auto-actable', m2 && m2.confidence!=='strong' && m2.confidence!=='exact');

// the real case from Brett's screenshot: one clean match
const G=[{id:'99',name:'Goldszmidt Properties LLC',email:''}];
const m3=qbMatchEntity(G,'Goldszmidt Properties','');
t('single suffix-only match is strong (suggested, not auto)', m3 && m3.confidence==='strong');

// exact still wins outright
const E=[{id:'5',name:'Allen George',email:''},{id:'6',name:'Allen George Landscaping',email:''}];
const m4=qbMatchEntity(E,'Allen George','');
t('exact name match is unambiguous', m4 && m4.confidence==='exact' && m4.id==='5');

// two identical DisplayNames in QB -> never guess
const D=[{id:'1',name:'ACME',email:''},{id:'2',name:'acme',email:''}];
t('duplicate exact names -> ambiguous', qbMatchEntity(D,'ACME','').confidence==='ambiguous');

// email corroborated by name is strong
const C=[{id:'8',name:'Smith LLC',email:'s@x.com'}];
t('email + matching name is strong', qbMatchEntity(C,'Smith Inc','s@x.com').confidence==='strong');

t('no match returns null', qbMatchEntity(QB,'Totally Different Co','')===null);
t('blank name returns null', qbMatchEntity(QB,'','')===null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
