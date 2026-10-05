// Send & Track vendor/property/owner enrichment (Oct 5 2026) — pure join, source-sliced from worker.js
// the same way test/vendor-onboarding.test.mjs does. No Sheets / QuickBooks calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'worker.js'), 'utf8');
function slice(startMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, 'missing ' + startMarker);
  let depth = 0, i = src.indexOf('{', a);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(a, i + 1);
}
const arHubContextIndex = new Function(slice('function arHubContextIndex(t)') + '\nreturn arHubContextIndex;')();

const tabs = () => ({
  owners: [{ ID: '1', First_Name: 'Ann', Last_Name: 'Lee', Company: 'Lee LLC' }, { ID: '2', First_Name: 'Bo', Last_Name: '' }],
  props: [{ ID: '10', Address: '928 N Calvert St', Owner_ID: '1' }, { ID: '11', Address: '5 Main St', Owner_ID: '2' }],
  wos: [{ ID: '1117', Property_ID: '10' }, { ID: '1118', Property_ID: '10' }, { ID: '1200', Property_ID: '11' }],
  bills: [{ ID: '50', Vendor_Name: 'Eddie Smith', WO_ID: '1117' }, { ID: '51', Vendor_Name: 'Cesar Diaz', WO_ID: '1118' }],
  vendors: [{ ID: '7', Name: 'Scope Vendor', Company: 'SV Inc' }, { ID: '8', Name: '', Company: 'Co Only' }],
  scopes: [{ ID: '3', Vendor_ID: '7', Property_ID: '11', WO_ID: '1200' }, { ID: '4', Vendor_ID: '8', Property_ID: '', WO_ID: '' }],
  irs: [
    { ID: '1', Bill_ID: '50', WO_ID: '1117', QB_Invoice_ID: '900', Active: 'TRUE' },
    { ID: '2', Bill_ID: '50', WO_ID: '1117', QB_Invoice_ID: '901', Active: 'TRUE' },   // combined invoice 901 = bill 50 + 51
    { ID: '3', Bill_ID: '51', WO_ID: '1118', QB_Invoice_ID: '901', Active: 'TRUE' },
    { ID: '4', Bill_ID: '51', WO_ID: '1118', QB_Invoice_ID: '902', Active: 'FALSE' },  // voided review row must not link
    { ID: '5', Bill_ID: '51', WO_ID: '1118', QB_Invoice_ID: '', Active: 'TRUE' },      // never sent
  ],
  milestones: [{ ID: '1', Scope_ID: '3', QB_Invoice_ID: '910', Active: 'TRUE' }, { ID: '2', Scope_ID: '3', QB_Invoice_ID: '911', Active: 'FALSE' }],
  sigs: [{ ID: '1', Scope_ID: '4', QB_Invoice_ID: '920', QB_Final_Invoice_ID: '921', Active: 'TRUE' }],
});

test('invoice from a vendor bill resolves vendor, WO, property, owner', () => {
  const r = arHubContextIndex(tabs())('900');
  assert.deepEqual(r.vendors, ['Eddie Smith']);
  assert.deepEqual(r.wo_ids, ['1117']);
  assert.equal(r.property_id, '10');
  assert.equal(r.property_address, '928 N Calvert St');
  assert.equal(r.owner_id, '1');
  assert.equal(r.owner_name, 'Ann Lee / Lee LLC');   // same formula as irBillContext in index.html
});

test('combined invoice lists every vendor, sorted', () => {
  const r = arHubContextIndex(tabs())('901');
  assert.deepEqual(r.vendors, ['Cesar Diaz', 'Eddie Smith']);
  assert.deepEqual(r.wo_ids.sort(), ['1117', '1118']);
});

test('inactive review rows and rows with no QB invoice id never link', () => {
  const look = arHubContextIndex(tabs());
  assert.deepEqual(look('902').vendors, []);
  assert.equal(look('902').owner_id, '');
  assert.deepEqual(look('').vendors, []);
});

test('scope-proposal milestone and signature invoices resolve via Scopes', () => {
  const look = arHubContextIndex(tabs());
  const m = look('910');
  assert.deepEqual(m.vendors, ['Scope Vendor']);
  assert.equal(m.property_address, '5 Main St');
  assert.equal(m.owner_name, 'Bo');
  assert.deepEqual(look('911').vendors, []);                       // inactive milestone
  assert.deepEqual(look('920').vendors, ['Co Only']);              // falls back to Company when Name blank
  assert.deepEqual(look('921').vendors, ['Co Only']);              // final-balance invoice too
});

test('unknown invoice returns empty fields, never throws; empty input tolerated', () => {
  const look = arHubContextIndex(tabs());
  assert.deepEqual(look('nope'), { vendors: [], wo_ids: [], property_id: '', property_address: '', owner_id: '', owner_name: '' });
  assert.deepEqual(arHubContextIndex({})('1').vendors, []);
  assert.deepEqual(arHubContextIndex()('1').vendors, []);
});

test('arInvoices wires the join in and reports a failed join instead of hiding it', () => {
  const body = slice('async function arInvoices(env, url)');
  assert.match(body, /arHubContextIndex\(/);
  assert.match(body, /enrich_error/);
  assert.match(body, /logTelemetry\(env/);                         // failure is logged, not swallowed
});
