// Vendor "Additional work" frontend checks (Sep 30 2026) — structural source checks on
// vendor.html and index.html, same convention as cap-036-batch2-ui.test.mjs. The Worker side
// (/wo/additional-work/*) is covered by the backend tests; this pins the UI contract.
import fs from 'fs';
import assert from 'node:assert';
const vendor = fs.readFileSync(new URL('../vendor.html', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function grabFn(html, name) {
  const sig = 'function ' + name + '(';
  const start = html.indexOf(sig);
  if (start < 0) throw new Error('missing ' + name);
  const open = html.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (!depth) break; } }
  return html.slice(start, i + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── vendor.html: entry button + gating ──
{
  ok(vendor.includes("esc(t('Found something else?'))"), 'job card renders a translated "Found something else?" button');
  ok(vendor.includes("openAddonModal(\\'' + wo.ID + '\\')"), 'button opens the modal for that WO');
  const card = vendor.slice(vendor.indexOf('<div class="action-title">ESTIMATE</div>'));
  ok(card.indexOf('awEligible(wo)') > 0 && card.indexOf('awEligible(wo)') < card.indexOf('UPDATE STATUS'), 'the gated button sits right after the ESTIMATE block, before UPDATE STATUS');
  const g = grabFn(vendor, 'awEligible');
  ok(g.includes("'estimate'") && g.includes("'addon'"), 'hidden for estimate-type WOs and for add-on children');
  ok(g.includes('Parent_WO_ID'), 'hidden for anything with a parent');
  for (const s of ["'estimate requested'", "'complete'", "'invoiced'", "'paid'", "'cancelled'", "'voided'"]) ok(g.includes(s), 'status gate includes ' + s);
  ok(vendor.includes('if (wos.some(awEligible)) loadVendorAddons();') && !/loadVendorAddons\(wo\.ID/.test(vendor), 'submitted add-ons are loaded ONCE per render (not per card), and only when some card is eligible');
  const lva = grabFn(vendor, 'loadVendorAddons');
  ok(lva.includes("'/wo/additional-work')") && !lva.includes('parent_wo_id='), 'the single call sends no parent_wo_id (worker returns the signed-in vendor\'s rows only)');
  ok(lva.includes('a.parent_wo_id') && lva.includes('renderVendorAddons(wo.ID, idx)') && lva.includes('awEligible(wo)'), 'rows are distributed to each eligible card by parent_wo_id');
  ok(grabFn(vendor, 'withdrawAddon').includes('loadVendorAddons();'), 'withdraw refreshes with the same single call');
}
// ── vendor.html: modal + flow ──
{
  ok(vendor.includes('id="modal-addon"') && /class="modal-overlay" id="modal-addon"/.test(vendor), 'modal uses the .modal-overlay convention so isVendorBusy() pauses auto-refresh');
  const sub = grabFn(vendor, 'awSubmit');
  ok(sub.includes("claimSubmit('addon:' + st.parentId"), 'submit is double-tap guarded with claimSubmit');
  ok(sub.includes("'/wo/additional-work/start'") && sub.includes("'/wo/additional-work/submit'"), 'calls start then submit');
  ok(sub.includes('if (st.childId) { startP = Promise.resolve(); }'), 'retry reuses the existing child_wo_id and does NOT call /start again');
  ok(sub.includes('missing_items'), 'handles missing_items from /submit');
  ok(sub.indexOf("'/wo/additional-work/start'") < sub.indexOf('awUploadAll(st)') && sub.indexOf('awUploadAll(st)') < sub.indexOf("'/wo/additional-work/submit'"), 'order: start -> upload photos -> submit');
  const up = grabFn(vendor, 'awUploadAll');
  ok(up.includes("'before'") && up.includes('addonItem: st.itemIdx[i]') && up.includes('if (f.done) return;'), "photos upload as 'before' with the item index, skipping ones already uploaded");
  const v = grabFn(vendor, 'awValid');
  ok(v.includes('!it.text.trim()') && v.includes('!it.files.length') && v.includes('awParseAmount'), 'validation: text + >=1 photo per item + amount');
  ok(grabFn(vendor, 'awParseAmount').includes('n > 0'), 'amount must be > 0');
  ok(grabFn(vendor, 'awUpdateSubmit').includes('btn.disabled = _aw.busy || !v.ok'), 'submit disabled until valid');
  ok(vendor.includes('accept="image/*" capture="environment"') && vendor.includes('accept="image/*" multiple'), 'camera + gallery pickers');
  ok(vendor.includes('The tenant told me about this') && vendor.includes('Total for all of this extra work') && vendor.includes('Add another item'), 'modal strings present');
  ok(vendor.includes("'/wo/additional-work/withdraw'") && vendor.includes("api('GET', '/wo/additional-work')"), 'withdraw + list endpoints used');
  ok(grabFn(vendor, 'awStatusInfo').includes('canWithdraw: true') && grabFn(vendor, 'awStatusInfo').includes("s === 'approved'"), 'status chips map approved / needs info / declined / pending; withdraw allowed only while open');
}
// ── vendor.html: addon_item passed ONLY when present ──
{
  const up = grabFn(vendor, '_uploadOneFile');
  ok(up.includes('opts && opts.addonItem !== undefined && opts.addonItem !== null'), 'addon_item guarded by presence check');
  ok(up.includes('logBody.addon_item = opts.addonItem;') && (up.match(/addon_item/g) || []).length === 1, 'addon_item is set in exactly one guarded place');
  ok(!/wo_id: woId, file_id: fileData\.id[^}]*addon_item/.test(up), 'addon_item is not in the literal log-attachment body');
  ok(vendor.includes('function _uploadOneFile(file, card, woId, propAddr, fileType, folderInfo, attempt, opts)'), 'extra arg is an optional trailing opts');
  ok(vendor.includes("_uploadOneFile(file, cards[i], woId, propAddr, fileType, folderInfo)"), 'portalUploadFiles call is unchanged');
}
// ── vendor.html: i18n ──
{
  const es = vendor.slice(vendor.indexOf('var ES = {'), vendor.indexOf('function t(key)'));
  for (const k of ['Found something else?', 'FOUND SOMETHING ELSE?', 'Add another item', 'Total for all of this extra work', 'The tenant told me about this', 'Take photo', 'Add from gallery',
    'Awaiting review', 'Approved - go ahead', 'Needs info', 'Declined', 'Withdraw', 'Send to Ridge Co', 'Try again', 'This item needs at least one photo.']) {
    ok(es.includes("'" + k.replace(/'/g, "\\'") + "':"), 'ES entry for ' + k);
  }
  ok(vendor.includes('data-i18n="FOUND SOMETHING ELSE?"'), 'modal title uses data-i18n');
}
// ── index.html ──
{
  for (const f of ['loadHubAdditionalWork', 'renderHubAdditionalWork', 'awAdminApprove', 'awAdminPush', 'awAdminNotifyOwner', 'awNoticeSend', 'awOnChildChanged', 'awExtraBadgeHTML']) grabFn(admin, f);
  ok(true, 'admin functions exist');
  ok(admin.includes("loadHubAdditionalWork(_woIdForPhoto, _db);"), 'loader is called from the setTimeout loader list');
  const start = admin.indexOf('function addBtn(label,cls,fn)');
  const end = admin.indexOf("openModal('modal-wo-detail');", start);
  const block = admin.slice(start, end);
  ok(start > 0 && end > start, 'addBtn block located');
  ok(!/additional|awAdmin|aw-admin|AdditionalWork/i.test(block), 'NOTHING new was added inside the addBtn(...) block');
  const card = grabFn(admin, 'awAdminCard');
  ok(card.includes('awAdminApprove(') && card.includes('awAdminPush(') && card.includes('awAdminNotifyOwner(') && card.includes('estimateNeedsInfoUI(') && card.includes('estimateDeclineUI('), 'all five actions present');
  ok(card.includes('Approve — go ahead now') && card.includes('Approve &amp; send to proposal') && card.includes('Notify owner (no price)'), 'button labels');
  ok(grabFn(admin, 'awAdminApprove').includes('confirm(') && grabFn(admin, 'awAdminApprove').includes("$' + amt"), 'approve confirms with the amount');
  ok(grabFn(admin, 'awAdminApprove').includes('approveEstimateUI(childId)'), 'approve reuses approveEstimateUI with the child id');
  ok(grabFn(admin, 'awAdminPush').includes('openPushToScopeUI(childId, true)'), 'push reuses openPushToScopeUI with approve_first');
  const no = grabFn(admin, 'awAdminNotifyOwner'), ns = grabFn(admin, 'awNoticeSend');
  ok(no.includes('preview: true') && !no.includes('preview: false'), 'notify opens with preview:true only');
  ok(ns.includes('preview: false') && ns.includes('_awNotice.sending'), 'send happens only from the confirm button, double-tap guarded');
  ok(grabFn(admin, 'renderHubAdditionalWork').includes("holder.style.display = 'none'"), 'section hidden when there are no add-ons');
  ok(grabFn(admin, 'refreshHubEstimateView').includes('awOnChildChanged(woId)'), 'estimate refresh on a child re-renders the parent section');
  ok(admin.includes('id="modal-aw-notice"'), 'owner-notice modal exists');
  ok(admin.includes('Part of ') && admin.includes('wo.Parent_WO_ID'), 'child WO links back to its parent');
}
console.log('vendor-additional-work-ui: ' + n + ' checks passed');
