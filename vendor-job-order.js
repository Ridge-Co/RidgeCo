/* vendor-job-order.js — the order of a job in the vendor portal (Nov 17 2026, Brett's ask).
   The order: accept -> schedule -> work -> mark COMPLETE -> invoice. Three things live here:
     1. Complete first. Billing opens only after the job is Complete. A vendor who reaches billing early is asked
        "Is the job finished?" and can mark it Complete and carry on in one tap. After they mark Complete they are
        asked whether to send the invoice now (a nudge, not a wall).
     2. What a bill needs, shown in bold red BEFORE the vendor submits so nobody learns they are missing something
        after the work is done: a short description of what was done, at least 1 AFTER photo on the job, and a picture
        of every receipt that is to be paid back.
     3. On Hold needs a reason from a short list plus the date the vendor expects to be back (no more silent holds).
   The pure helpers (top of the IIFE) are tested on their own by test/vendor-job-order.test.mjs; the page code below
   them uses the portal's globals (t, esc, api, session, LANG, window._wos ...) at CALL time only.
   Client-side only for now: the Worker does not yet refuse a bill that skips these rules (separate, approved step).
   Spanish for every string here lives in vendor-i18n.js (test/vendor-spanish.test.mjs scans this file too). */
var JobOrder = (function () {
  'use strict';

  // ── pure helpers ───────────────────────────────────────────────────────────────────────────
  // Stored hold text is always English (the Hub and Ridge Co read it); the vendor sees it through t().
  var HOLD_REASONS = [
    { code: 'part',     en: 'Waiting on a part or material' },
    { code: 'tenant',   en: 'Tenant is not home or I cannot reach them' },
    { code: 'access',   en: 'I cannot get in (key, code or gate)' },
    { code: 'approval', en: 'Waiting for approval from Ridge Co or the owner' },
    { code: 'other',    en: 'Other reason (explain below)' }
  ];
  var MIN_DESC = 10;   // characters of "what did you do" (after trimming); stops a lone dash or "ok"

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(isoDate, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || ''); if (!m) return '';
    var d = new Date(+m[1], +m[2] - 1, +m[3] + n); return iso(d);
  }
  function validDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }
  function reasonLabel(code) {
    for (var i = 0; i < HOLD_REASONS.length; i++) if (HOLD_REASONS[i].code === code) return HOLD_REASONS[i].en;
    return '';
  }
  // f = { code, detail, back }. Returns { ok, errors: ['reason'|'other'|'date'|'past'] } (first error is shown).
  function checkHold(f, today) {
    var errors = [];
    if (!reasonLabel(f && f.code)) errors.push('reason');
    else if (f.code === 'other' && String(f.detail || '').trim().length < 3) errors.push('other');
    if (!validDate(f && f.back)) errors.push('date');
    else if (today && f.back < today) errors.push('past');
    return { ok: errors.length === 0, errors: errors };
  }
  // The one string saved in Work_Orders.Hold_Reason. The Hub reads "expected back YYYY-MM-DD" out of it to flag late holds.
  function holdText(f) {
    var s = reasonLabel(f.code);
    var detail = String(f.detail || '').replace(/\s+/g, ' ').trim();
    if (detail) s += ' — ' + detail;
    return s + ' — expected back ' + f.back;
  }
  // s = { jobDone, afterPhotos (number, or null when unknown), description, receipts: [{ n, amount, pay, hasImage }] }
  // Returns the list of what is still missing: { key: 'complete'|'after'|'desc'|'receipt', n? }.
  // An unknown photo count never blocks (a failed read must not stop a vendor from being paid).
  function missingForBill(s) {
    var out = [];
    if (!s.jobDone) out.push({ key: 'complete' });
    if (s.afterPhotos !== null && s.afterPhotos !== undefined && !(s.afterPhotos > 0)) out.push({ key: 'after' });
    if (String(s.description || '').replace(/\s+/g, ' ').trim().length < MIN_DESC) out.push({ key: 'desc' });
    (s.receipts || []).forEach(function (r) {
      if (r.pay === 'reimburse' && r.amount > 0 && !r.hasImage) out.push({ key: 'receipt', n: r.n });
    });
    return out;
  }

  // ── page code ──────────────────────────────────────────────────────────────────────────────
  var _after = {};   // wo id -> number of AFTER photos (undefined = not loaded yet, null = could not tell)

  function woById(woId) {
    var l = window._wos || [];
    for (var i = 0; i < l.length; i++) if (String(l[i].ID) === String(woId)) return l[i];
    return null;
  }
  // Complete or later. Fails open (true) if the status list did not load, so a missing script never blocks billing.
  function isDone(status) {
    if (typeof WOStatus === 'undefined') return true;
    return WOStatus.inSet('DONE_THROUGH_PAID', status);
  }
  function hasBill(woId) { return !!(window._vendorBillCache && window._vendorBillCache[woId]); }
  function billNeedsComplete(woId) {
    var w = woById(woId);
    return !!w && !hasBill(woId) && !isDone(w.Status);
  }

  function loadAfter(woId) {
    if (_after[woId] !== undefined) return Promise.resolve(_after[woId]);
    return api('GET', '/attachments?wo_id=' + encodeURIComponent(woId)).then(function (items) {
      if (!Array.isArray(items)) return null;
      var n = items.filter(function (f) { return f.Active !== 'FALSE' && String(f.File_Type || '').toLowerCase() === 'after'; }).length;
      _after[woId] = n;
      return n;
    }).catch(function () { return null; });
  }
  // loadPortalAttachments tells us the real count whenever the card's photo section refreshes.
  function setAfter(woId, n) { _after[woId] = n; refreshBillPanel(); }

  function needText(item) {
    if (item.key === 'complete') return t('Mark the job Complete first');
    if (item.key === 'after') return t('Add at least 1 AFTER photo of the finished work');
    if (item.key === 'desc') return t('Write what you did (a short description)');
    if (item.key === 'receipt') return t('Upload the receipt picture for reimbursed receipt #') + item.n;
    if (item.key === 'invoice') return t('Send your invoice');
    return '';
  }
  function needsHtml(list) {
    return '<div style="background:#fdecea;border:2px solid #b42318;border-radius:8px;padding:12px;margin:10px 0;color:#b42318">' +
      '<div style="font-weight:bold;font-size:13px;letter-spacing:.03em;margin-bottom:6px">⚠ ' + esc(t('To get paid, you still need:')) + '</div>' +
      list.map(function (it) { return '<div style="font-weight:bold;font-size:13px;line-height:1.5">✗ ' + esc(needText(it)) + '</div>'; }).join('') +
      '</div>';
  }

  function billState() {
    var woId = window._billWOId, w = woById(woId), receipts = [];
    for (var i = 1; i <= (window._receiptCount || 0); i++) {
      var amtEl = document.getElementById('r-amt-' + i);
      if (!amtEl) continue;                                   // row was removed
      receipts.push({ n: i, amount: parseFloat(amtEl.value) || 0, pay: (window._receiptPay || {})[i], hasImage: !!(window._uploadedPhotos || {})[i] });
    }
    return {
      jobDone: !w || hasBill(woId) || isDone(w.Status),
      afterPhotos: _after[woId] === undefined ? null : _after[woId],
      description: (document.getElementById('bill-invdesc') || {}).value || '',
      receipts: receipts
    };
  }
  function billMissing() { return missingForBill(billState()); }

  // The bold red box at the top of the bill window. Calling it with no argument just redraws it.
  function refreshBillPanel() {
    var el = document.getElementById('bill-needs-panel');
    var m = document.getElementById('modal-vendor-bill');
    if (!el || !window._billWOId || !m || m.style.display === 'none') return;   // only while the bill window is open
    if (_after[window._billWOId] === undefined) loadAfter(window._billWOId).then(function () { refreshBillPanel(); });
    var list = billMissing();
    el.innerHTML = list.length ? needsHtml(list)
      : '<div style="background:#eaf6ee;border:1px solid var(--accent2);border-radius:8px;padding:10px 12px;margin:10px 0;color:var(--accent2);font-weight:bold;font-size:13px">✓ ' + esc(t('Your invoice has everything it needs.')) + '</div>';
  }

  // On the collapsed-or-open job card: a Complete job with no invoice yet says so, in red.
  function cardNeeds(woId, idx) {
    var wrap = document.getElementById('bill-summary-' + idx), w = woById(woId);
    if (!wrap || !w || w.Status !== 'Complete' || hasBill(woId)) return;
    loadAfter(woId).then(function (n) {
      if (hasBill(woId) || w.Status !== 'Complete') return;
      var list = [{ key: 'invoice' }];
      if (n === 0) list.push({ key: 'after' });
      wrap.innerHTML = needsHtml(list) +
        '<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">' + esc(t('Your invoice needs what you did, 1 after photo, and a picture of every receipt you want paid back.')) + '</div>';
    });
  }

  // ── overlays ───────────────────────────────────────────────────────────────────────────────
  function closeOverlay() { var o = document.getElementById('jo-overlay'); if (o) o.remove(); }
  function overlay(inner) {
    closeOverlay();
    var d = document.createElement('div');
    d.id = 'jo-overlay';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:400;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto';
    d.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;width:100%;max-width:440px;padding:18px;margin:auto">' + inner + '</div>';
    document.body.appendChild(d);
    return d;
  }
  var BTN = 'min-height:46px;border-radius:8px;font-family:var(--font);font-size:14px;font-weight:bold;cursor:pointer;padding:10px 14px;';

  // Complete first: billing was opened before the job is Complete.
  function askComplete(woId, vendorName) {
    overlay(
      '<div style="font-size:16px;font-weight:bold;color:var(--text);margin-bottom:8px">' + esc(t('Is the job finished?')) + '</div>' +
      '<div style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:14px">' + esc(t('Invoices can only be sent after the job is marked Complete.')) + '</div>' +
      '<div id="jo-msg"></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<button type="button" id="jo-yes" style="' + BTN + 'border:none;background:var(--accent2);color:#fff">' + esc(t('Yes, mark it Complete and continue')) + '</button>' +
        '<button type="button" id="jo-no" style="' + BTN + 'border:1px solid var(--border);background:var(--surface2);color:var(--muted)">' + esc(t('Not yet')) + '</button>' +
      '</div>');
    document.getElementById('jo-no').onclick = closeOverlay;
    document.getElementById('jo-yes').onclick = function () { doComplete(woId, vendorName); };
  }
  function doComplete(woId, vendorName) {
    var yes = document.getElementById('jo-yes'), msg = document.getElementById('jo-msg');
    if (yes) { yes.disabled = true; yes.textContent = t('Marking complete…'); }
    api('/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_id: woId, status: 'Complete', notes: 'Marked complete from the invoice screen.', updated_by: session.vendor_name, updated_by_role: 'vendor', vendor_id: session.vendor_id, lang: LANG })
    }).then(function (data) {
      if (data && data.success) {
        var w = woById(woId); if (w) w.Status = 'Complete';
        closeOverlay();
        if (typeof loadWorkOrders === 'function') loadWorkOrders();
        _openBillModalGated(woId, vendorName);
      } else {
        if (yes) { yes.disabled = false; yes.textContent = t('Yes, mark it Complete and continue'); }
        if (msg) msg.innerHTML = '<div style="color:var(--danger);font-size:12.5px;font-weight:bold;margin-bottom:10px">⚠ ' + esc((data && data.error) || t('Could not mark the job complete. Try again.')) + '</div>';
      }
    }).catch(function () {
      if (yes) { yes.disabled = false; yes.textContent = t('Yes, mark it Complete and continue'); }
      if (msg) msg.innerHTML = '<div style="color:var(--danger);font-size:12.5px;font-weight:bold;margin-bottom:10px">⚠ ' + esc(t('Could not mark the job complete. Try again.')) + '</div>';
    });
  }

  // Gentle nudge right after the vendor marks the job Complete.
  function nudgeInvoice(woId) {
    var w = woById(woId); if (w) w.Status = 'Complete';
    var later = function () { closeOverlay(); if (typeof currentTab !== 'undefined' && currentTab === 'open' && typeof loadWorkOrders === 'function') loadWorkOrders(); };
    if (hasBill(woId)) { later(); return; }
    overlay(
      '<div style="font-size:16px;font-weight:bold;color:var(--text);margin-bottom:12px">✅ ' + esc(t('Job complete. Send your invoice now?')) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<button type="button" id="jo-now" style="' + BTN + 'border:none;background:var(--accent2);color:#fff">💰 ' + esc(t('Send invoice now')) + '</button>' +
        '<button type="button" id="jo-later" style="' + BTN + 'border:1px solid var(--border);background:var(--surface2);color:var(--muted)">' + esc(t('Later')) + '</button>' +
      '</div>');
    document.getElementById('jo-later').onclick = later;
    document.getElementById('jo-now').onclick = function () { closeOverlay(); if (typeof loadWorkOrders === 'function') loadWorkOrders(); openBillModal(woId, session.vendor_name); };
  }

  // On Hold: reason + the day the vendor expects to be back.
  function openHold(woId, idx) {
    var today = iso(new Date());
    var rows = HOLD_REASONS.map(function (r) {
      return '<label style="display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:7px;cursor:pointer;min-height:44px;color:var(--text);font-size:14px;letter-spacing:0;text-transform:none;background:var(--surface2)">' +
        '<input type="radio" name="jo-hold-reason" value="' + r.code + '" style="width:20px;height:20px;flex:none;margin:0"><span>' + esc(t(r.en)) + '</span></label>';
    }).join('');
    var chip = function (days, label) {
      return '<button type="button" class="jo-chip" data-days="' + days + '" style="' + BTN + 'min-height:40px;padding:6px 12px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:13px">' + esc(t(label)) + '</button>';
    };
    overlay(
      '<div style="font-size:16px;font-weight:bold;color:var(--text);margin-bottom:10px">' + esc(t('Why is the job on hold?')) + '</div>' + rows +
      '<div style="font-size:12px;color:var(--muted);margin:10px 0 4px">' + esc(t('Details — required if you pick Other')) + '</div>' +
      '<textarea id="jo-hold-detail" style="width:100%;min-height:56px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:13px;padding:9px;border-radius:6px;resize:vertical"></textarea>' +
      '<div style="font-size:12px;color:var(--muted);margin:10px 0 6px">' + esc(t('When will you be back?')) + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + chip(1, 'Tomorrow') + chip(3, 'In 3 days') + chip(7, 'In 1 week') + '</div>' +
      '<input type="date" id="jo-hold-back" min="' + today + '" style="width:100%;min-height:44px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:14px;padding:9px;border-radius:6px">' +
      '<div id="jo-msg" style="margin-top:10px"></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
        '<button type="button" id="jo-save" style="' + BTN + 'border:none;background:var(--warn);color:#fff">' + esc(t('Put on hold')) + '</button>' +
        '<button type="button" id="jo-cancel" style="' + BTN + 'border:1px solid var(--border);background:var(--surface2);color:var(--muted)">' + esc(t('Cancel')) + '</button>' +
      '</div>');
    Array.prototype.forEach.call(document.querySelectorAll('#jo-overlay .jo-chip'), function (b) {
      b.onclick = function () { document.getElementById('jo-hold-back').value = addDays(today, +b.getAttribute('data-days')); };
    });
    document.getElementById('jo-cancel').onclick = closeOverlay;
    document.getElementById('jo-save').onclick = function () { saveHold(woId, idx, today); };
  }
  function saveHold(woId, idx, today) {
    var picked = document.querySelector('#jo-overlay input[name="jo-hold-reason"]:checked');
    var f = { code: picked ? picked.value : '', detail: document.getElementById('jo-hold-detail').value, back: document.getElementById('jo-hold-back').value };
    var chk = checkHold(f, today), msg = document.getElementById('jo-msg');
    var say = function (s) { msg.innerHTML = '<div style="color:#b42318;font-size:13px;font-weight:bold">⚠ ' + esc(s) + '</div>'; };
    if (!chk.ok) {
      say({ reason: t('Pick a reason.'), other: t('Explain the reason in the details box.'), date: t('Pick the date you expect to be back.'), past: t('That date has already passed. Pick today or a later day.') }[chk.errors[0]]);
      return;
    }
    var btn = document.getElementById('jo-save');
    btn.disabled = true; btn.textContent = t('Saving…'); msg.innerHTML = '';
    var notes = ((document.getElementById('notes-' + idx) || {}).value || '').trim();
    api('/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wo_id: woId, status: 'On Hold', hold_reason: holdText(f), notes: notes, updated_by: session.vendor_name, updated_by_role: 'vendor', vendor_id: session.vendor_id, lang: LANG })
    }).then(function (data) {
      if (data && data.success) {
        closeOverlay();
        var w = woById(woId); if (w) { w.Status = 'On Hold'; w.Hold_Reason = holdText(f); }
        showActionMsg(idx, esc(t('✓ On Hold — expected back')) + ' ' + esc(f.back), 'success');
        setTimeout(function () { if (typeof loadWorkOrders === 'function') loadWorkOrders(); }, 1500);
      } else {
        btn.disabled = false; btn.textContent = t('Put on hold');
        say((data && data.error) || t('Could not save the hold. Try again.'));
      }
    }).catch(function () { btn.disabled = false; btn.textContent = t('Put on hold'); say(t('Could not save the hold. Try again.')); });
  }

  return {
    HOLD_REASONS: HOLD_REASONS, MIN_DESC: MIN_DESC,
    addDays: addDays, validDate: validDate, checkHold: checkHold, holdText: holdText, missingForBill: missingForBill,
    billNeedsComplete: billNeedsComplete, billMissing: billMissing, refreshBillPanel: refreshBillPanel, cardNeeds: cardNeeds, setAfter: setAfter,
    askComplete: askComplete, nudgeInvoice: nudgeInvoice, openHold: openHold, closeOverlay: closeOverlay
  };
})();
