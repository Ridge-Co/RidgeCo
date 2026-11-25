// Queue #231 slice (a): internal notes never reach an external view (bid-group copies carry Admin_Notes / Owner_Notes / Entry_Notes).
// Runs the REAL stripInternalNotes extracted from worker.js, and checks enrichWO is wired to it.
import fs from 'fs';
import assert from 'assert';
import test from 'node:test';
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grabFn(sig) {
  const s = wsrc.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig);
  const open = wsrc.indexOf('{', wsrc.indexOf(')', s));
  let d = 0, i = open;
  for (; i < wsrc.length; i++) { if (wsrc[i] === '{') d++; else if (wsrc[i] === '}') { d--; if (!d) break; } }
  return wsrc.slice(s, i + 1);
}
const stripInternalNotes = new Function(grabFn('function stripInternalNotes(') + '\nreturn stripInternalNotes;')();
const row = () => ({ ID: 'WO-1', Description: 'Leaky tap', Admin_Notes: 'tenant is behind on rent', Owner_Notes: 'owner wants cheapest', Entry_Notes: 'dog in unit', Vendor_Admin_Notes: 'call before arriving', WO_Contact_Name: 'Pat Doe', tenant_name: 'Pat Doe', tenant_record_name: 'Pat Doe' });

test('every vendor, tenant and shared view loses Admin_Notes and Owner_Notes, keeps Vendor_Admin_Notes', () => {
  for (const opts of [{ vendorView: true }, { tenantView: true }, { sharedView: true }, { viewingVendorId: '7' }]) {
    const r = stripInternalNotes(row(), opts, false);
    assert.ok(!('Admin_Notes' in r) && !('Owner_Notes' in r), JSON.stringify(opts));
    assert.strictEqual(r.Vendor_Admin_Notes, 'call before arriving');
    assert.strictEqual(r.Entry_Notes, 'dog in unit');
    assert.strictEqual(r.tenant_name, 'Pat Doe');
  }
});
test('a vendor who has not accepted loses Entry_Notes and the tenant name', () => {
  const r = stripInternalNotes(row(), { vendorView: true }, true);
  assert.ok(!('Entry_Notes' in r) && !('WO_Contact_Name' in r));
  assert.strictEqual(r.tenant_name, ''); assert.strictEqual(r.tenant_record_name, '');
  assert.strictEqual(r.Description, 'Leaky tap');
});
test('a vendor who accepted keeps Entry_Notes and the tenant name', () => {
  const r = stripInternalNotes(row(), { vendorView: true }, false);
  assert.strictEqual(r.Entry_Notes, 'dog in unit'); assert.strictEqual(r.tenant_name, 'Pat Doe');
});
test('the owner route is left to the owner allow-list (admin preview keeps the whole row)', () => {
  const r = stripInternalNotes(row(), { ownerView: true }, false);
  assert.strictEqual(r.Admin_Notes, 'tenant is behind on rent');
});
test('the admin path (no external flag) is untouched', () => {
  const r = stripInternalNotes(row(), {}, false);
  assert.strictEqual(r.Admin_Notes, 'tenant is behind on rent'); assert.strictEqual(r.Owner_Notes, 'owner wants cheapest');
});
test('enrichWO runs every view through it, before the money strip', () => {
  assert.ok(/stripInternalNotes\(base, opts, accessGated\);[^\n]*\n  return stripExternalMoney\(base, opts\);/.test(wsrc));
});
