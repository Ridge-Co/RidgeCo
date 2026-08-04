// Address matching for QuickBooks sub-customers, run against the live worker source.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
function grab(name, kind='function'){
  const needle = kind==='const' ? ('const '+name+' =') : ('function '+name+'(');
  const i = src.indexOf(needle);
  if(i<0) throw new Error('missing '+name);
  let d=0,j=src.indexOf(kind==='const'?'{':'{',i);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1) + (kind==='const'?';':'');
}
const { qbNormAddress, qbMatchAddress, qbUnitLabel, qbUnitDisplayName, qbPropertyDisplayName } = new Function(
  grab('QB_ADDR_WORDS','const') + '\n' + grab('qbNormAddress') + '\n' + grab('qbMatchAddress') + '\n' +
  grab('qbPropertyDisplayName') + '\n' + grab('qbUnitLabel') + '\n' + grab('qbUnitDisplayName') +
  '\nreturn { qbNormAddress, qbMatchAddress, qbUnitLabel, qbUnitDisplayName, qbPropertyDisplayName };')();

let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n);} };

t('St and Street are the same building', qbNormAddress('928 N. Calvert Street')===qbNormAddress('928 N Calvert St'));
t('North and N collapse', qbNormAddress('928 North Calvert St')===qbNormAddress('928 N Calvert St'));
t('Avenue variants collapse', qbNormAddress('12 Maple Avenue')===qbNormAddress('12 Maple Ave'));
t('different numbers stay different', qbNormAddress('930 N Calvert St')!==qbNormAddress('928 N Calvert St'));

// Brett's real case: the property under the right owner
const QB=[
  {id:'100',name:'Goldszmidt Properties LLC',parent_id:'',path:'Goldszmidt Properties LLC'},
  {id:'101',name:'928 N Calvert St',parent_id:'100',path:'Goldszmidt Properties LLC:928 N Calvert St'},
  {id:'200',name:'Casey Property Solutions',parent_id:'',path:'Casey Property Solutions'},
  {id:'201',name:'928 N Calvert St',parent_id:'200',path:'Casey Property Solutions:928 N Calvert St'},
];
const m=qbMatchAddress(QB,'928 N. Calvert Street','100');
t('same address under two owners resolves by parent', m && m.id==='101' && m.confidence==='exact');
const m2=qbMatchAddress(QB,'928 N Calvert St','200');
t('the other owner gets the other one', m2 && m2.id==='201');

// no parent scope -> two equal candidates -> must not guess
const m3=qbMatchAddress(QB,'928 N Calvert St','');
t('unscoped duplicate address is ambiguous', m3 && m3.confidence==='ambiguous' && m3.candidates.length===2);

// a near-miss must not be treated as the same place
const NEAR=[{id:'5',name:'100 Main St Rear',parent_id:'9',path:'X:100 Main St Rear'}];
const m4=qbMatchAddress(NEAR,'100 Main St','9');
t('100 Main St vs 100 Main St Rear is only weak', m4 && m4.confidence==='weak');

t('no candidates returns null', qbMatchAddress([],'928 N Calvert St','100')===null);
t('blank address returns null', qbMatchAddress(QB,'','100')===null);

// unit naming — the label alone, for display
t('bare label gets Apt prefix', qbUnitLabel({Unit_Label:'3R'})==='Apt 3R');
t('already-prefixed label kept as-is', qbUnitLabel({Unit_Label:'Apt 3R'})==='Apt 3R');
t('Unit prefix kept', qbUnitLabel({Unit_Label:'Unit B'})==='Unit B');
t('blank label yields blank', qbUnitLabel({Unit_Label:''})==='');

// ── The QuickBooks NAME must carry the building. DisplayName is unique across the whole
// file, so "Apt 1" is not a name — every property has one, and the second collided with
// the first and got linked to another building's flat.
const lanvale = {Address:'151 W Lanvale St'};
t('the QuickBooks name carries the address',
  qbUnitDisplayName({Unit_Label:'1'}, lanvale)==='151 W Lanvale St Apt 1');
t('two buildings\' Apt 1 are now different names',
  qbUnitDisplayName({Unit_Label:'1'}, lanvale) !== qbUnitDisplayName({Unit_Label:'1'}, {Address:'928 N Calvert St'}));
t('an already-prefixed label is not double-prefixed',
  qbUnitDisplayName({Unit_Label:'Apt 3R'}, lanvale)==='151 W Lanvale St Apt 3R');
t('no property falls back to the bare label rather than nothing',
  qbUnitDisplayName({Unit_Label:'1'}, null)==='Apt 1');
t('a blank label still yields blank', qbUnitDisplayName({Unit_Label:''}, lanvale)==='');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
