// Queue #261 Phase 1 (Nov 20 2026): turn inspection findings into work orders, only when Brett asks, grouped his way.
// Runs the REAL FI block from worker.js against the in-memory Sheets/Drive fake (test/_fi-world.mjs).
// Run: node test/fi-wo-convert.test.mjs
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 800) : ''); } };
const ID = 'fi_wotest00001';
function mkDoc(over) {
  return Object.assign({
    v: 1, date: '2026-11-18', property: { id: 'P1', address: '3572 Dudley Ave, Baltimore, MD 21213' }, owner: { id: 'O1', name: 'Owner One' }, overall: { condition: 'fair' },
    areas: [
      { id: 'a1', name: 'Kitchen', condition: 'fair', issues: [
        { id: 'is_k1', title: 'Leak under sink', trade: 'plumbing', severity: 'high', detail: 'Drips', recommended_fix: 'Replace trap', photo_ids: ['ph_1', 'ph_2'], wo: true },
        { id: 'is_k2', title: 'Faucet drips', trade: 'plumbing', severity: 'medium', detail: '', recommended_fix: 'Replace cartridge', photo_ids: [] },
        { id: 'is_k3', title: 'Dead outlet', trade: 'electrical', severity: 'medium', detail: '', recommended_fix: '', photo_ids: ['ph_3'] }] },
      { id: 'a2', name: 'Bath', condition: 'poor', issues: [
        { id: 'is_b1', title: 'Toilet runs', trade: 'plumbing', severity: 'low', detail: '', recommended_fix: 'New flapper', photo_ids: [] },
        { id: 'is_b2', title: 'Tenant: clear the tub', trade: 'tenant_action', severity: 'info', detail: '', recommended_fix: '', photo_ids: [] }] },
      { id: 'a3', name: 'Shed', condition: 'poor', excluded: true, issues: [{ id: 'is_s1', title: 'Rotten door', trade: 'carpentry', severity: 'low', detail: '', recommended_fix: '', photo_ids: [] }] },
    ],
  }, over || {});
}
async function seed(doc) {
  const w = world(); await w.fiList(w.env);
  const r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: doc || mkDoc() });
  for (const p of ['ph_1', 'ph_2', 'ph_3']) w.h.tabs.FI_Photos.rows.push([p, ID, 'drv_' + p, 'image/jpeg', '1000', '2026-11-18T10:00:00Z', 'TRUE']);
  w.h.tabs.Work_Orders = { headers: ['ID', 'Property_ID', 'Unit_ID', 'Trade', 'Description', 'Type', 'Priority', 'Checklist', 'Vendor_ID'], rows: [] };
  w.h.tabs.Vendors = { headers: ['ID', 'Name', 'Active'], rows: [['V1', 'Pipes Inc', 'TRUE'], ['V2', 'Gone Co', 'FALSE']] };
  return { w, rev: r.body.rev };
}
const withGroups = async (w, rev, groups) => {
  const cur = JSON.parse((await w.fiFindInspection(w.env, ID)).row ? w.fiJoinRow((await w.fiFindInspection(w.env, ID)).row.o) : '{}');
  cur.wo_groups = groups; const r = await w.fiSave(w.env, { id: ID, base_rev: rev, doc: cur }); if (!r.body.ok) throw new Error('seed groups: ' + JSON.stringify(r.body)); return r.body.rev;
};

// ── 1. validator ──
{
  const w = world(); const d = (m) => { const x = mkDoc(); m(x); return w.fiValidateDoc(x); };
  t('wo_id / wo_group / wo_groups are accepted', d(x => { x.areas[0].issues[0].wo_id = 'WO-1234'; x.areas[0].issues[0].wo_group = 'g1'; x.wo_groups = [{ key: 'g1', title: 'A', vendor_id: 'V1', issue_ids: ['is_k1'], wo_id: 'WO-1234', created_at: 'x' }]; }).ok);
  t('wo_id over 20 rejected', !d(x => { x.areas[0].issues[0].wo_id = 'W'.repeat(21); }).ok);
  t('wo_group must be a string', !d(x => { x.areas[0].issues[0].wo_group = 5; }).ok);
  t('more than 60 groups rejected', !d(x => { x.wo_groups = Array.from({ length: 61 }, (_, i) => ({ key: 'g' + i, issue_ids: [] })); }).ok);
  t('duplicate group key rejected', !d(x => { x.wo_groups = [{ key: 'g1', issue_ids: [] }, { key: 'g1', issue_ids: [] }]; }).ok);
  t('bad group key rejected', !d(x => { x.wo_groups = [{ key: 'bad key!', issue_ids: [] }]; }).ok);
  t('oversized title rejected', !d(x => { x.wo_groups = [{ key: 'g1', title: 'x'.repeat(121), issue_ids: [] }]; }).ok);
  t('issue_ids must be a list of strings', !d(x => { x.wo_groups = [{ key: 'g1', issue_ids: [1] }]; }).ok && !d(x => { x.wo_groups = [{ key: 'g1', issue_ids: 'is_k1' }]; }).ok);
  t('wo_groups must be an array', !d(x => { x.wo_groups = {}; }).ok);
}

// ── 2. collect + the three arrangements ──
{
  const w = world(), c = w.fiWoCollect(mkDoc());
  t('flagged item comes first', c.items[0].id === 'is_k1', c.items.map(i => i.id));
  t('tenant-action and excluded-area items go to the tray, not the list', c.tray.map(i => i.id).sort().join() === 'is_b2,is_s1' && !c.items.some(i => ['is_b2', 'is_s1'].includes(i.id)), c);
  t('tray says why', c.tray.find(i => i.id === 'is_b2').tray_reason === 'tenant_action' && c.tray.find(i => i.id === 'is_s1').tray_reason === 'area_excluded');
  const one = w.fiWoAutoGroups(c.items, 'one', mkDoc());
  t('"all on one" = one group with every convertible item', one.length === 1 && one[0].issue_ids.length === 4, one);
  const rel = w.fiWoAutoGroups(c.items, 'related', mkDoc());
  t('"related" groups same trade, singles stay alone', rel.length === 2 && rel.some(g => g.issue_ids.length === 3 && g.issue_ids.includes('is_k1') && g.issue_ids.includes('is_b1')) && rel.filter(g => g.issue_ids.length === 1).length === 1, rel);
  t('group titles are all different (the duplicate guard would swallow a twin)', new Set(rel.map(g => g.title.toLowerCase())).size === rel.length);
  t('"I\'ll pick" starts empty', w.fiWoAutoGroups(c.items, 'pick', mkDoc()).length === 0);
  t('unknown mode returns null', w.fiWoAutoGroups(c.items, 'zzz', mkDoc()) === null);
  const multi = mkDoc(); multi.areas[0].section = 'U1'; multi.areas[1].section = 'U2';
  const rm = w.fiWoAutoGroups(w.fiWoCollect(multi).items, 'related', multi);
  t('multi-unit: same trade in different units is NOT merged', rm.length === 3 && rm.some(g => g.issue_ids.join() === 'is_b1'), rm.map(g => g.issue_ids));
}

// ── 3. payload builder ──
{
  const w = world(), doc = mkDoc(), c = w.fiWoCollect(doc), byId = new Map(c.items.map(i => [i.id, i]));
  const b = w.fiWoBuildPayload(doc, { key: 'g1', title: 'Kitchen plumbing', issue_ids: ['is_k1', 'is_k2'] }, byId, { id: ID, date: '2026-11-18' });
  const p = b.payload;
  t('payload: trade mapped, priority from worst severity, type inspection', p.trade === 'Plumbing' && p.priority === 'high' && p.type === 'inspection', p);
  t('payload: description has the group title and the inspection date', /Kitchen plumbing/.test(p.description) && /2026-11-18/.test(p.description), p.description);
  t('payload: nobody is notified', p.tenant_visible === false && p.tenant_notify_created === false && p.tenant_notify_updates === false && p.owner_notify_override === 'off', p);
  const cl = JSON.parse(p.checklist);
  t('payload: one checklist line per item in the Hub checklist shape', cl.length === 2 && cl.every(l => typeof l.t === 'string' && l.done === false) && cl[0].t === 'Kitchen: Leak under sink - Replace trap', cl);
  t('payload: property from the inspection', p.property_id === 'P1');
  const doc2 = mkDoc(); doc2.areas[0].issues[1].recommended_fix = 'Lockbox code 4821 is on the door';
  const b2 = w.fiWoBuildPayload(doc2, { key: 'g1', title: 'X', issue_ids: ['is_k2'] }, new Map(w.fiWoCollect(doc2).items.map(i => [i.id, i])), { id: ID });
  t('payload: an access code never reaches the checklist', !/4821|lockbox/i.test(b2.payload.checklist), b2.payload.checklist);
  const lo = w.fiWoBuildPayload(doc, { key: 'g2', title: 'Low', issue_ids: ['is_b1'] }, byId, {});
  t('payload: low severity is normal priority', lo.payload.priority === 'normal');
  const mu = mkDoc(); mu.areas[0].section = 'U1'; mu.areas[1].section = 'U2';
  const bm = w.fiWoBuildPayload(mu, { key: 'g3', title: 'Both', issue_ids: ['is_k1', 'is_b1'] }, new Map(w.fiWoCollect(mu).items.map(i => [i.id, i])), {});
  t('payload: items in two units make a building-level work order with a warning', bm.payload.unit_id === '' && bm.warnings.some(x => /more than one unit/.test(x)), bm);
  const bu = w.fiWoBuildPayload(mu, { key: 'g4', title: 'One unit', issue_ids: ['is_k1'] }, new Map(w.fiWoCollect(mu).items.map(i => [i.id, i])), {});
  t('payload: items all in one unit use that unit', bu.payload.unit_id === 'U1');
}

// ── 4. plan: arranges and previews, writes nothing ──
{
  const { w, rev } = await seed();
  const before = JSON.stringify(w.h.tabs.FI_Inspections.rows);
  const a = await w.fiWoPlan(w.env, { id: ID, rev, arrange: 'related' });
  t('plan: arrange returns groups', a.body.ok && a.body.arranged && a.body.groups.length === 2 && a.body.convertible === 4 && a.body.tray === 2, a.body);
  t('plan: arrange saves nothing and creates nothing', JSON.stringify(w.h.tabs.FI_Inspections.rows) === before && !w.h.woCreates);
  t('plan: bad mode is a 400', (await w.fiWoPlan(w.env, { id: ID, rev, arrange: 'zzz' })).status === 400);
  t('plan: no groups yet is a clear 400', (await w.fiWoPlan(w.env, { id: ID, rev })).body.error === 'no_groups');
  t('plan: stale rev is a 409', (await w.fiWoPlan(w.env, { id: ID, rev: rev + 5, arrange: 'one' })).status === 409);
  const rev2 = await withGroups(w, rev, [{ key: 'g1', title: 'Kitchen plumbing', vendor_id: 'V1', issue_ids: ['is_k1', 'is_k2'] }, { key: 'g2', title: 'Outlet', vendor_id: 'V2', issue_ids: ['is_k3'] }, { key: 'g3', title: 'Empty', issue_ids: [] }]);
  const p = await w.fiWoPlan(w.env, { id: ID, rev: rev2 });
  t('plan: previews each work order with vendor name and photo count', p.body.ok && p.body.plan.length === 3 && p.body.plan[0].vendor_name === 'Pipes Inc' && p.body.plan[0].photo_count === 2 && p.body.plan[0].checklist.length === 2, p.body);
  t('plan: says no texts are sent', p.body.no_texts === true && /No texts/.test(p.body.note));
  t('plan: inactive vendor and empty group are warned about', p.body.plan[1].warnings.some(x => /not active/.test(x)) && p.body.plan[2].skip === true, p.body.plan);
  t('plan: writes nothing', !w.h.woCreates && !w.h.assigns && !w.h.attachments);
  const nop = world(); await nop.fiList(nop.env); const d = mkDoc(); delete d.property.id; const r0 = await nop.fiSave(nop.env, { id: ID, base_rev: 0, doc: d });
  t('plan: an inspection with no Hub property is told to link one', (await nop.fiWoPlan(nop.env, { id: ID, rev: r0.body.rev, arrange: 'one' })).body.error === 'no_property');
}

// ── 5. create ──
{
  const { w, rev } = await seed();
  // publish first so we can prove conversion does not un-publish the customer's report
  const pub = await w.fiPublish(w.env, { id: ID, rev }).catch(e => ({ err: e }));
  const rev2 = await withGroups(w, rev, [
    { key: 'g1', title: 'Kitchen plumbing', vendor_id: 'V1', issue_ids: ['is_k1', 'is_k2'] },
    { key: 'g2', title: 'Plumbing other', vendor_id: '', issue_ids: ['is_b1'] },
    { key: 'g3', title: 'Outlet', vendor_id: '', issue_ids: ['is_k3'] }]);
  const statusBefore = w.h.tabs.FI_Inspections.rows[0][w.h.tabs.FI_Inspections.headers.indexOf('Status')];
  t('create: the report really was published before converting (so the next check is not vacuous)', statusBefore === 'published', { statusBefore, pub: pub && (pub.body || pub.err && String(pub.err)) });
  const r = await w.fiWoCreate(w.env, { id: ID, rev: rev2 });
  t('create: ok, three created, none failed', r.body.ok && r.body.created === 3 && r.body.failed === 0, r.body);
  t('create: two groups with the same trade got different descriptions', new Set(w.h.woCreates.map(c => c.description)).size === 3);
  const wo = w.h.tabs.Work_Orders, ix = (n) => wo.headers.indexOf(n);
  t('create: Source_Ref is stamped on every work order', wo.rows.every((row, i) => row[ix('Source_Ref')] === 'fi:' + ID + ':g' + (i + 1)), wo.rows);
  t('create: the chosen vendor is assigned with notify:false and notify_tenant:false', w.h.assigns.length === 1 && w.h.assigns[0].vendor_id === 'V1' && w.h.assigns[0].notify === false && w.h.assigns[0].notify_tenant === false, w.h.assigns);
  t('create: no text, email or push was sent to anyone', w.h.sms.length === 0 && w.h.mail.length === 0 && (w.h.multi || []).length === 0, { sms: w.h.sms, mail: w.h.mail });
  t('create: photos attached (original when there is one, else the copy)', w.h.attachments.length === 3 && w.h.attachments.every(a => /^drv_ph_/.test(a.file_id)), w.h.attachments);
  const rec = JSON.parse(w.fiJoinRow((await w.fiFindInspection(w.env, ID)).row.o));
  t('create: work order numbers are written back to the items and groups', rec.areas[0].issues[0].wo_id === 'WO-1001' && rec.wo_groups[0].wo_id === 'WO-1001' && rec.areas[0].issues[2].wo_id === 'WO-1003', rec.wo_groups);
  const row2 = w.h.tabs.FI_Inspections.rows[0], st = row2[w.h.tabs.FI_Inspections.headers.indexOf('Status')];
  t('create: saving the numbers does not un-publish the report', st === statusBefore, { statusBefore, st });
  t('create: the response carries the new rev', r.body.recorded === true && r.body.rev > rev2);
  // press Create again: nothing doubles
  const again = await w.fiWoCreate(w.env, { id: ID, rev: r.body.rev });
  t('create twice: no second set of work orders', again.body.ok && w.h.woCreates.length === 3 && wo.rows.length === 3 && again.body.created === 0 && again.body.existing === 3, again.body);
  t('create twice: no second set of attachments or assignments', w.h.attachments.length === 3 && w.h.assigns.length === 1);
}
{ // partial failure and retry
  const { w, rev } = await seed();
  const rev2 = await withGroups(w, rev, [{ key: 'g1', title: 'One', issue_ids: ['is_k1'] }, { key: 'g2', title: 'Two', issue_ids: ['is_k3'] }]);
  let n = 0; w.h.woFail = () => (++n === 2 ? 'sheet exploded' : undefined);
  const r = await w.fiWoCreate(w.env, { id: ID, rev: rev2 });
  t('partial: one created, one failed, and it says which and why', r.body.created === 1 && r.body.failed === 1 && r.body.results[1].status === 'failed' && /sheet exploded/.test(r.body.results[1].error) && /Try the rest again/.test(r.body.message), r.body);
  t('partial: the one that worked is recorded on the inspection', r.body.recorded === true);
  w.h.woFail = undefined;
  const r2 = await w.fiWoCreate(w.env, { id: ID, rev: r.body.rev });
  t('retry: only the missing one is made', r2.body.created === 1 && r2.body.existing === 1 && w.h.tabs.Work_Orders.rows.length === 2, r2.body);
}
{ // stamp does not land, assign fails, attach fails, stale rev, group over a missing item
  const { w, rev } = await seed();
  const rev2 = await withGroups(w, rev, [{ key: 'g1', title: 'One', vendor_id: 'V1', issue_ids: ['is_k1'] }]);
  w.h.stampFail = true; w.h.assignFail = 'Vendor has no phone'; w.h.attachFail = true;
  const r = await w.fiWoCreate(w.env, { id: ID, rev: rev2 });
  t('stamp not saved: it is reported and not recorded as done', r.body.results[0].unlinked === true && r.body.results[0].warnings.some(x => /did not save/.test(x)) && r.body.recorded === false, r.body);
  const { w: w2, rev: rv } = await seed(); const rv2 = await withGroups(w2, rv, [{ key: 'g1', title: 'One', vendor_id: 'V1', issue_ids: ['is_k1'] }]);
  w2.h.assignFail = 'Vendor has no phone'; w2.h.attachFail = true;
  const r2 = await w2.fiWoCreate(w2.env, { id: ID, rev: rv2 });
  t('assign and photo failures are warnings on a work order that still exists', r2.body.created === 1 && r2.body.results[0].warnings.some(x => /Vendor not assigned/.test(x)) && r2.body.results[0].warnings.some(x => /photo/.test(x)), r2.body.results[0]);
  t('stale rev: 409 and nothing created', (await w2.fiWoCreate(w2.env, { id: ID, rev: 1 })).status === 409 && w2.h.woCreates.length === 1);
  const { w: w3, rev: r3 } = await seed(); const r32 = await withGroups(w3, r3, [{ key: 'g1', title: 'Gone', issue_ids: ['is_nope'] }]);
  const x3 = await w3.fiWoCreate(w3.env, { id: ID, rev: r32 });
  t('a group whose items are gone is skipped, not created empty', x3.body.results[0].status === 'skipped' && !w3.h.woCreates);
  const { w: w4, rev: r4 } = await seed(); w4.h.woFail = 'down';
  const r42 = await withGroups(w4, r4, [{ key: 'g1', title: 'One', issue_ids: ['is_k1'] }]);
  const x4 = await w4.fiWoCreate(w4.env, { id: ID, rev: r42 });
  t('all fail: nothing is recorded and the failure is shown', x4.body.failed === 1 && x4.body.recorded === false && !JSON.parse(w4.fiJoinRow((await w4.fiFindInspection(w4.env, ID)).row.o)).wo_groups[0].wo_id);
}

// ── 5b. vendor picker list ──
{
  const { w } = await seed(); const v = (await w.fiWoVendors(w.env)).body;
  t('vendor list: active vendors only, id + name + trade only', v.ok && v.vendors.length === 1 && v.vendors[0].id === 'V1' && Object.keys(v.vendors[0]).sort().join() === 'id,name,trade', v);
  t('vendor route is wired', /path === '\/fi\/wo\/vendors'\)\s+return await fiRoute\(env, 'wo-vendors', \(\) => fiWoVendors\(env\)\)/.test(src));
}

// ── 6. the customer never sees work orders; saving never converts; wiring ──
{
  const w = world(), d = mkDoc(); d.wo_groups = [{ key: 'g1', title: 'X', issue_ids: ['is_k1'], wo_id: 'WO-1' }]; d.areas[0].issues[0].wo_id = 'WO-1'; d.areas[0].issues[0].wo_group = 'g1';
  const scrubbed = w.fiScrubDocForReport ? w.fiScrubDocForReport(JSON.parse(JSON.stringify(d))) : null;
  t('public report scrub drops wo_groups, wo_id and wo_group', scrubbed && !/WO-1|wo_group|wo_id/.test(JSON.stringify(scrubbed)), scrubbed && JSON.stringify(scrubbed).slice(0, 300));
  const { w: w2, rev } = await seed();
  await w2.fiSave(w2.env, { id: ID, base_rev: rev, doc: mkDoc({ overall: { condition: 'good' } }) });
  t('saving or publishing an inspection never creates a work order', !w2.h.woCreates);
  t('routes are wired through fiRoute', /path === '\/fi\/wo\/plan'\)\s+return await fiRoute\(env, 'wo-plan', \(\) => fiWoPlan\(env, body\)\)/.test(src) && /path === '\/fi\/wo\/create'\)\s+return await fiRoute\(env, 'wo-create', \(\) => fiWoCreate\(env, body\)\)/.test(src));
  t('staging write gate: only TEST- inspections may plan or create', /path === '\/fi\/wo\/plan' \|\| path === '\/fi\/wo\/create'\) return String\(\(body && body\.id\) \|\| ''\)\.startsWith\('TEST-'\)/.test(src));
  t('assignVendor is only ever called with notify:false in this feature', (src.match(/assignVendor\(env, \{ wo_id: r\.wo_id[^}]*\}/g) || []).every(s => /notify: false, notify_tenant: false/.test(s)) && (src.match(/assignVendor\(env, \{ wo_id: r\.wo_id/g) || []).length === 1);
  t('Source_Ref column is added with ensureColumns, never a tab', /ensureColumns\(env, 'Work_Orders', \['Source_Ref'\]\)/.test(src));
  t('create is sequential (no Promise.all over work orders)', !/Promise\.all\([^)]*fiWoBuildPayload/.test(src));
}
console.log(`fi-wo-convert: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
