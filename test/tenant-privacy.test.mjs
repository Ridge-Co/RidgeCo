// A former tenant's phone must not reach a vendor. Run against the live worker source.
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
const { isTenantCurrent, currentTenantForDispatch } = new Function(
  grab('isTenantCurrent') + '\n' + grab('currentTenantForDispatch') +
  '\nreturn { isTenantCurrent, currentTenantForDispatch };')();

let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n);} };

const live   = { ID:'1', First_Name:'Ann',  Phone:'410-555-0001', Active:'TRUE' };
const gone   = { ID:'2', First_Name:'Bob',  Phone:'410-555-0002', Active:'FALSE', Move_Out_Date:'2026-01-15' };
const dated  = { ID:'3', First_Name:'Cara', Phone:'410-555-0003', Active:'TRUE',  Move_Out_Date:'2026-01-15' };
const future = { ID:'4', First_Name:'Dan',  Phone:'410-555-0004', Active:'TRUE',  Move_Out_Date:'2099-01-01' };
const junk   = { ID:'5', First_Name:'Eve',  Phone:'410-555-0005', Active:'TRUE',  Move_Out_Date:'not-a-date' };

t('a current tenant is current', isTenantCurrent(live)===true);
t('inactive is not current', isTenantCurrent(gone)===false);
t('past move-out is not current, even while Active', isTenantCurrent(dated)===false);
t('future move-out is still current', isTenantCurrent(future)===true);
t('unparseable date does not silently exclude', isTenantCurrent(junk)===true);
t('missing tenant is not current', isTenantCurrent(null)===false);
t('object with no ID is not current', isTenantCurrent({})===false);

const tenants=[live,gone,dated];
// the unit pointer wins when set
t('dispatch gets the current unit tenant', currentTenantForDispatch(tenants,{Tenant_ID:'1'},{Tenant_ID:'2'})===live);
// a stale unit pointer must not leak
t('stale unit pointer yields nobody', currentTenantForDispatch(tenants,{Tenant_ID:'2'},{})===null);
// the WO's historical tenant must not leak either
t('historical WO tenant yields nobody', currentTenantForDispatch(tenants,{},{Tenant_ID:'3'})===null);
// falls back to the WO tenant when the unit is vacant
t('vacant unit falls back to the WO tenant', currentTenantForDispatch(tenants,{Tenant_ID:''},{Tenant_ID:'1'})===live);
t('nobody anywhere yields null', currentTenantForDispatch(tenants,{},{})===null);

// the two vendor-facing phone fields must both be gated
t('tenant_phone is gated on tenantIsFormer', /tenant_phone:.*tenantIsFormer/.test(src));
t('tenant_record_phone is gated too', /tenant_record_phone:.*tenantIsFormer/.test(src));
t('tenantIsFormer is computed from isTenantCurrent', /tenantIsFormer\s*=\s*!!tenant\.ID\s*&&\s*!isTenantCurrent\(tenant\)/.test(src));
t('nearby-wos phone is gated', /tenant_phone:\s*isTenantCurrent\(t\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
