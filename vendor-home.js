/* vendor-home.js — the new vendor home list (UI overhaul Phase 1a, Nov 18 2026). Plan: claude/ui-ux-overhaul-plan-nov11.md section 4.1 and 4.2.
   What it does, only when the new layout is switched ON for this vendor:
     1. Three tabs with counts (To do / Waiting to be paid / Paid) instead of five, all worked out from ONE load of the vendor's jobs
        and bills (the old tabs each re-fetched).
     2. Each job card says what to do next and has ONE big button for it (Accept job, Pick a day, Start job, Mark complete, Resume job,
        Send invoice, See what is needed).
     3. A tap that can text a tenant or owner (accept, start, complete, resume) waits 5 seconds behind a Sending / Undo bar first.
     4. A tap that did not save never looks saved: the card shows "Not saved, tap to retry" and keeps it (device storage) until it works
        or the vendor cancels it. Nothing is ever re-sent on its own.
     5. The six per-card requests (photos, estimate, nearby, time, receipts, invoice summary) load when a card is opened, not for every card.
   Switch: session.new_layout (set by the Worker from the vendor's record; not built yet) or ?newlayout=1 on the link; ?newlayout=0 turns it back off.
   OFF by default, so merging this changes nothing any vendor sees. The old layout stays in vendor.html untouched; turning the switch off is the rollback.
   INTERFACE ONLY: every status change still goes through the page's own submitStatus / acceptWO / openBillModal, so the checklist gate, the
   Complete-before-billing rule (vendor-job-order.js), max price, double-tap latch and session-expiry handling are the same code as before.
   Vendor-facing text goes through t(); Spanish lives in vendor-i18n.js (test/vendor-spanish.test.mjs scans this file). */
var VendorHome = (function () {
  'use strict';

  var UNDO_MS = 5000;
  var FAILED_KEY = 'rc_vh_failed';
  var FAILED_MAX_AGE_MS = 12 * 3600 * 1000;   // a failed tap is forgotten after 12 hours; it is never re-sent automatically
  var TODO_ORDER = ['new', 'working', 'scheduled', 'accepted', 'hold', 'finished'];
  var HEADINGS = {
    new: 'New: please accept or decline',
    working: 'Scheduled and in progress', scheduled: 'Scheduled and in progress', accepted: 'Scheduled and in progress', hold: 'Scheduled and in progress',
    finished: 'Finished: send your invoice'
  };
  // Statuses whose change texts a tenant or owner (the server decides the text; the vendor only gets the safety delay).
  var NOTIFYING = { accept: 1, start: 1, complete: 1, resume: 1 };

  // ── pure helpers (tested on their own by test/vendor-home.test.mjs) ─────────────────────────
  function lc(s) { return String(s || '').toLowerCase(); }
  function isTrue(v) { return v === true || String(v || '').toUpperCase() === 'TRUE'; }

  // Is the new layout on? sessionObj = the login session; search = location.search; store = localStorage-like (may throw/be absent).
  function enabled(sessionObj, search, store) {
    var m = /[?&]newlayout=([01])(?:&|$)/.exec(search || '');
    if (m) {
      try { if (store) store.setItem('rc_vnew', m[1]); } catch (e) { var _x = e; } // silent-ok: storage blocked, the link flag still applies this visit
      return m[1] === '1';
    }
    var saved = null;
    try { saved = store ? store.getItem('rc_vnew') : null; } catch (e) { saved = null; } // silent-ok: storage blocked, falls back to the session flag
    if (saved === '0') return false;
    if (saved === '1') return true;
    return !!(sessionObj && isTrue(sessionObj.new_layout));
  }

  function billsByWO(bills) {
    var by = {};
    (bills || []).forEach(function (b) { if (b && b.WO_ID) (by[b.WO_ID] = by[b.WO_ID] || []).push(b); });
    return by;
  }

  // One word for where a job is, from the vendor's point of view.
  function groupOf(wo, billsForWO) {
    var st = lc(wo && wo.Status);
    if (st === 'cancelled' || st === 'canceled' || st === 'declined' || st === 'void' || st === 'closed') return 'closed';
    if (st === 'paid') return 'paid';
    var bills = billsForWO || [];
    if (bills.length) {
      var pending = bills.some(function (b) { return String(b.Pending_Info || '').toUpperCase() === 'TRUE'; });
      return pending ? 'needsinfo' : 'waiting';
    }
    if (st === 'invoiced') return 'waiting';
    if (st === 'complete' || st === 'pending invoice') return 'finished';
    if (st === 'on hold') return 'hold';
    if (st === 'in progress') return 'working';
    if (st === 'accepted') return String((wo && wo.Scheduled_Date) || '').trim() ? 'scheduled' : 'accepted';
    return 'new';   // New, Assigned, Estimate Requested, or anything not yet accepted, and every gated job
  }
  function tabOf(group) {
    if (group === 'paid') return 'paid';
    if (group === 'waiting' || group === 'needsinfo') return 'waiting';
    if (group === 'closed') return '';
    return 'todo';
  }
  // The ONE button on a card. key is what tap() runs; label is English (shown through t()).
  function nextAction(group) {
    switch (group) {
      case 'new':       return { key: 'accept',   label: 'Accept job' };
      case 'accepted':  return { key: 'pickday',  label: 'Pick a day' };
      case 'scheduled': return { key: 'start',    label: 'Start job' };
      case 'working':   return { key: 'complete', label: 'Mark complete' };
      case 'hold':      return { key: 'resume',   label: 'Resume job' };
      case 'finished':  return { key: 'invoice',  label: 'Send invoice' };
      case 'needsinfo': return { key: 'invoice',  label: 'See what is needed' };
      default:          return null;
    }
  }
  function safeToTap(key) { return !NOTIFYING[key]; }   // true = no one is told, so it runs at once; false = 5 second Undo first

  function priRank(wo) { var r = { urgent: 0, high: 1, normal: 2, low: 3 }[lc(wo && wo.Priority) || 'normal']; return r === undefined ? 2 : r; }
  // To do order: new jobs first, then work in hand, then finished-but-unbilled; urgent first inside each; stable otherwise.
  function sortTodo(wos, by) {
    by = by || {};
    return (wos || []).map(function (w, i) { return { w: w, i: i, g: TODO_ORDER.indexOf(groupOf(w, by[w.ID])) }; })
      .sort(function (a, b) { return (a.g - b.g) || (priRank(a.w) - priRank(b.w)) || (a.i - b.i); })
      .map(function (x) { return x.w; });
  }
  // Waiting tab: anything that needs something from the vendor first (red), then the rest.
  function sortWaiting(wos, by) {
    by = by || {};
    return (wos || []).map(function (w, i) { return { w: w, i: i, g: groupOf(w, by[w.ID]) === 'needsinfo' ? 0 : 1 }; })
      .sort(function (a, b) { return (a.g - b.g) || (a.i - b.i); }).map(function (x) { return x.w; });
  }
  function headingFor(group) { return HEADINGS[group] || ''; }

  // Counts for the tabs, from the data already loaded.
  function split(wos, bills) {
    var by = billsByWO(bills), out = { todo: [], waiting: [], paid: [], by: by };
    (wos || []).forEach(function (w) {
      var tab = tabOf(groupOf(w, by[w.ID]));
      if (tab) out[tab].push(w);
    });
    out.todo = sortTodo(out.todo, by);
    out.waiting = sortWaiting(out.waiting, by);
    return out;
  }
  function counts(sp) { return { todo: sp.todo.length, waiting: sp.waiting.length, paid: sp.paid.length, needsinfo: sp.waiting.filter(function (w) { return groupOf(w, sp.by[w.ID]) === 'needsinfo'; }).length }; }

  // Failed taps kept on the device. Pure: takes and returns the stored object.
  function pruneFailed(obj, now) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) { var f = obj[k]; if (f && f.key && now - (f.at || 0) < FAILED_MAX_AGE_MS) out[k] = f; });
    return out;
  }

  // ── page code (uses the page's globals at CALL time only) ───────────────────────────────────
  var _on = false, _data = null;
  var SKIP = { skipped: true };   // a tap that did nothing on purpose (Undo, or the checklist said not yet): never counted as a failed save

  function on() { return _on; }
  function init(sessionObj) {
    var store = null; try { store = window.localStorage; } catch (e) { store = null; /* silent-ok: storage blocked */ }
    _on = enabled(sessionObj, window.location.search, store);
    if (!_on) return false;
    currentTab = 'todo';
    buildTabs(); moveNoWoButtons(); return true;
  }

  // "Something without a work order?" goes below the list with clearer labels (plan 4.1). Same buttons, same handlers and permission flags.
  function moveNoWoButtons() {
    var a = document.getElementById('btnSubmitStandaloneBill'), b = document.getElementById('btnLogOneOffJob'), list = document.getElementById('woList');
    if (!a || !b || !list || !list.parentNode || document.getElementById('vhNoWo')) return;
    var box = document.createElement('div'); box.id = 'vhNoWo'; box.className = 'vh-nowo';
    var h = document.createElement('div'); h.className = 'vh-group'; h.textContent = t('Something without a work order?');
    box.appendChild(h);
    var row = document.createElement('div'); row.className = 'vh-nowo-row';
    row.appendChild(a); row.appendChild(b);
    box.appendChild(row);
    list.parentNode.insertBefore(box, list.nextSibling);
    var an = a.querySelector('[data-i18n]'); if (an) an.textContent = t('Bill for work that has no work order');
    var bn = b.querySelector('[data-i18n]'); if (bn) bn.textContent = t('Log a job I did without a work order');
  }

  function readFailed() {
    try { return pruneFailed(JSON.parse(window.localStorage.getItem(FAILED_KEY) || '{}'), Date.now()); }
    catch (e) { console.error('[VendorHome] failed-taps list unreadable', e); return {}; }
  }
  function writeFailed(obj) {
    try { window.localStorage.setItem(FAILED_KEY, JSON.stringify(obj)); }
    catch (e) { console.error('[VendorHome] could not keep the failed tap on this device', e); } // silent-ok: the card still shows Not saved this visit
  }
  function setFailed(woId, key) { var f = readFailed(); f[woId] = { key: key, at: Date.now() }; writeFailed(f); }
  function clearFailed(woId) { var f = readFailed(); delete f[woId]; writeFailed(f); }

  // One load feeds all three tabs. Returns the list for the tab asked for (or the current one).
  function fetchAll() {
    return Promise.all([
      apiList('/vendor-workorders?vendor_id=' + session.vendor_id + '&include_closed=true'),
      apiList('/vendor-bills?vendor_id=' + session.vendor_id)
    ]).then(function (r) {
      var sp = split(r[0] || [], r[1] || []);
      sp.paid.sort(function (a, b) { return comparePaidDate(a, b, true); });
      _data = sp;
      renderTabs();
      return sp;
    });
  }
  function listFor(tab) {
    return fetchAll().then(function (sp) { return tab === 'paid' ? sp.paid : tab === 'waiting' ? sp.waiting : sp.todo; });
  }
  function regroup(list) { var by = _data ? _data.by : {}; return currentTab === 'waiting' ? sortWaiting(list, by) : currentTab === 'todo' ? sortTodo(list, by) : list; }
  function groupForWO(wo) { return groupOf(wo, _data ? _data.by[wo.ID] : []); }

  function buildTabs() {
    var old = document.querySelector('.tabs');
    if (old) old.style.display = 'none';
    if (document.getElementById('vhTabs')) return;
    var bar = document.createElement('div');
    bar.id = 'vhTabs'; bar.className = 'vh-tabs'; bar.setAttribute('role', 'tablist');
    [['todo', 'To do'], ['waiting', 'Waiting to be paid'], ['paid', 'Paid']].forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'vh-tab'; b.id = 'vhTab-' + x[0]; b.setAttribute('role', 'tab');
      b.setAttribute('data-tab', x[0]);
      b.innerHTML = '<span class="vh-tab-label">' + esc(t(x[1])) + '</span> <span class="vh-count" id="vhCount-' + x[0] + '"></span>';
      b.onclick = function () { switchTab(x[0]); };
      bar.appendChild(b);
    });
    if (old && old.parentNode) old.parentNode.insertBefore(bar, old);
    syncTabs();
  }
  function renderTabs() {
    if (!_data) return;
    var c = counts(_data);
    ['todo', 'waiting', 'paid'].forEach(function (k) {
      var el = document.getElementById('vhCount-' + k); if (!el) return;
      el.textContent = c[k] ? '(' + c[k] + ')' : '';
      el.className = 'vh-count' + (k === 'waiting' && c.needsinfo ? ' vh-count-red' : '');
    });
    syncTabs();
  }
  function syncTabs() {
    ['todo', 'waiting', 'paid'].forEach(function (k) {
      var b = document.getElementById('vhTab-' + k); if (!b) return;
      b.className = 'vh-tab' + (currentTab === k ? ' active' : '');
      b.setAttribute('aria-selected', currentTab === k ? 'true' : 'false');
    });
    var filters = document.getElementById('vhFilterBtn');
    if (!filters) addFiltersButton();
  }
  // Trade / priority / sort tuck behind one Filters button (plan 4.1). The same three selects keep their ids and handlers.
  function addFiltersButton() {
    var sel = document.getElementById('vFilterTrade'); if (!sel || !sel.parentNode) return;
    var row = sel.parentNode; row.style.display = 'none'; row.id = 'vhFilterRow';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'vhFilterBtn'; btn.className = 'vh-filter-btn'; btn.textContent = t('Filters');
    btn.onclick = function () { var show = row.style.display === 'none'; row.style.display = show ? 'flex' : 'none'; btn.setAttribute('aria-expanded', show ? 'true' : 'false'); };
    btn.setAttribute('aria-expanded', 'false');
    var anchor = document.getElementById('woSearch'); var holder = anchor && anchor.parentNode;
    if (holder && holder.parentNode) holder.parentNode.insertBefore(btn, row);
  }

  function emptyMessage(tab) {
    if (tab === 'todo') return 'Nothing is waiting on you. You are all caught up.';
    if (tab === 'waiting') return 'No invoices are waiting to be paid.';
    return 'No paid jobs yet.';
  }

  function headingHtml(group) { var h = headingFor(group); return h ? '<div class="vh-group">' + esc(t(h)) + '</div>' : ''; }

  // The strip under a card's header: next-step line + the one big button.
  function actionHtml(wo, idx) {
    var g = groupForWO(wo), a = nextAction(g), failed = readFailed()[wo.ID];
    var line = '';
    if (g === 'needsinfo') line = '<div class="vh-line vh-red">' + esc(t('Something is needed before this can be paid.')) + '</div>';
    else if (g === 'waiting') {
      var bs = (_data && _data.by[wo.ID]) || [], last = bs[bs.length - 1] || {};
      line = '<div class="vh-line">' + esc(t('Invoice sent. Waiting for review.')) + (last.Total ? ' $' + parseFloat(last.Total).toFixed(2) : '') + '</div>';
    } else if (g === 'paid') line = '<div class="vh-line">' + esc(t('Paid')) + (paidDateOf(wo) ? ' ' + esc(fmtPaidDate(paidDateOf(wo))) : '') + '</div>';
    else if (wo.Scheduled_Date && g !== 'finished') line = '<div class="vh-line">' + esc(t('Scheduled')) + ': ' + esc(wo.Scheduled_Date) + '</div>';
    var btn = '';
    if (a) {
      var retry = failed && failed.key === a.key;
      btn = '<button type="button" class="vh-btn' + (retry ? ' vh-btn-retry' : '') + '" id="vh-btn-' + idx + '" onclick="VendorHome.tap(\'' + String(wo.ID).replace(/'/g, '') + '\',\'' + a.key + '\')">' + esc(t(retry ? 'Not saved, tap to retry' : a.label)) + '</button>';
      if (g === 'new') btn += '<button type="button" class="vh-btn-2" onclick="VendorHome.decline(\'' + String(wo.ID).replace(/'/g, '') + '\')">' + esc(t('Decline')) + '</button>';
    }
    if (!line && !btn) return '';
    return '<div class="vh-act" id="vh-act-' + idx + '">' + line + (btn ? '<div class="vh-btns">' + btn + '</div>' : '') + '<div class="vh-note" id="vh-note-' + idx + '" aria-live="polite"></div></div>';
  }

  function idxOf(woId) {
    var w = window._wos || [];
    for (var i = 0; i < w.length; i++) if (w[i].ID === woId) return i;
    return -1;
  }
  function note(idx, msg, kind) { var el = document.getElementById('vh-note-' + idx); if (el) el.innerHTML = msg ? '<span class="' + (kind || '') + '">' + esc(msg) + '</span>' : ''; }

  // Open a card and scroll to a part of it (used when Mark complete is blocked by the checklist).
  function openCard(idx) {
    var card = document.getElementById('card-' + idx); if (!card) return;
    if (!card.classList.contains('expanded')) toggleCard(idx);
    var target = document.getElementById('cl-msg-' + idx) || card;   // the checklist's message line is the last row of the checklist
    try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { target.scrollIntoView(); /* silent-ok: older browser without options */ }
  }

  // The Sending / Undo bar. fn runs after 5 seconds, or at once if the page is hidden; Undo cancels it. Resolves true if it ran.
  function holdThenSend(label, fn) {
    return new Promise(function (resolve) {
      var old = document.getElementById('vhUndo'); if (old && old.parentNode) old.parentNode.removeChild(old);
      var bar = document.createElement('div');
      bar.id = 'vhUndo'; bar.className = 'vh-undo'; bar.setAttribute('role', 'status');
      bar.innerHTML = '<span>' + esc(t(label)) + '</span><button type="button" class="vh-undo-btn">' + esc(t('Undo')) + '</button>';
      document.body.appendChild(bar);
      var done = false;
      function finish(run) {
        if (done) return; done = true;
        clearTimeout(timer); document.removeEventListener('visibilitychange', onHide);
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        if (run) { resolve(fn()); } else { resolve(SKIP); }
      }
      function onHide() { if (document.hidden) finish(true); }
      var timer = setTimeout(function () { finish(true); }, UNDO_MS);
      document.addEventListener('visibilitychange', onHide);
      bar.querySelector('.vh-undo-btn').onclick = function () { finish(false); };
    });
  }

  // The status the page should post for each one-tap key. Posting itself is the page's own submitStatus.
  var STATUS_FOR = { start: 'In Progress', resume: 'In Progress', complete: 'Complete' };

  // Mark complete is refused while the checklist has open items; the job opens at the checklist. Checked BEFORE the Undo bar, so nothing says Sending when it is not.
  function checklistBlocks(woId) {
    var idx = idxOf(woId); if (idx < 0) return false;
    var g = checklistGate(idx);
    if (g.ok) return false;
    note(idx, g.msg, 'vh-warn'); openCard(idx); return true;
  }
  function runStatus(woId, key) {
    var idx = idxOf(woId); if (idx < 0) return Promise.resolve(SKIP);
    if (key === 'complete' && checklistBlocks(woId)) return Promise.resolve(SKIP);
    window._pendingStatus = window._pendingStatus || {};
    window._pendingStatus[idx] = STATUS_FOR[key];
    note(idx, t('Saving…'), '');
    return Promise.resolve(submitStatus(woId, idx));
  }
  function runAccept(woId) {
    var idx = idxOf(woId); if (idx < 0) return Promise.resolve(SKIP);
    note(idx, t('Saving…'), '');
    return Promise.resolve(acceptWO(woId, idx));
  }

  function afterResult(woId, idx, key, ok) {
    if (ok) { clearFailed(woId); note(idx, t('Saved'), 'vh-ok'); setTimeout(function () { loadWorkOrders(); }, 700); return; }
    setFailed(woId, key);
    var b = document.getElementById('vh-btn-' + idx);
    if (b) { b.classList.add('vh-btn-retry'); b.textContent = t('Not saved, tap to retry'); b.disabled = false; }
    note(idx, t('Not saved. Check your signal, then tap the button again.'), 'vh-err');
  }

  // The one entry point for a card button. Named so a future voice or push action can call it too: VendorHome.tap('WO-1298', 'start').
  function tap(woId, key) {
    var idx = idxOf(woId);
    if (key === 'pickday') { openSchedModal('modalSched', woId); return Promise.resolve(true); }
    if (key === 'invoice') { openBillModal(woId); return Promise.resolve(true); }
    var btn = document.getElementById('vh-btn-' + idx);
    if (key === 'complete' && checklistBlocks(woId)) return Promise.resolve(false);
    var release = claimSubmit('vh:' + woId, btn, t('Saving…'));
    if (!release) return Promise.resolve(false);   // second tap while one is running
    var run = function () { return (key === 'accept' ? runAccept(woId) : runStatus(woId, key)); };
    var go = safeToTap(key) ? Promise.resolve(run()) : holdThenSend(key === 'accept' ? 'Accepting… the tenant may be told.' : 'Sending… the owner or tenant may be told.', run);
    return go.then(function (ok) {
      release();
      if (ok === SKIP) { note(idx, '', ''); return false; }   // Undo tapped or blocked: nothing was sent, so nothing to retry
      afterResult(woId, idx, key, ok === true);
      return ok === true;
    }).catch(function (e) {
      release(); console.error('[VendorHome.tap]', woId, key, e); afterResult(woId, idx, key, false); return false;
    });
  }
  // Decline stays a deliberate, separate button; the reason box is the page's existing one.
  function decline(woId) { var idx = idxOf(woId); if (idx >= 0) declineWO(woId, idx); }

  // Panels load when a card is opened, not for every card on the list.
  var _loaded = {};
  function ensureLoaded(idx) {
    var wos = window._wos || [], wo = wos[idx]; if (!wo) return;
    var key = wo.ID + ':' + idx; if (_loaded[key]) return; _loaded[key] = true;
    loadPortalAttachments(wo.ID); loadEstimateWidget(wo.ID, idx); loadVendorNearbyWOs(wo.ID, idx);
    loadVendorTimeTracking(wo.ID, idx); loadVendorReceipts(wo.ID, idx); loadVendorBillSummary(wo.ID, idx);
  }
  function resetLoaded() { _loaded = {}; }

  return {
    // pure
    enabled: enabled, billsByWO: billsByWO, groupOf: groupOf, tabOf: tabOf, nextAction: nextAction, safeToTap: safeToTap,
    sortTodo: sortTodo, sortWaiting: sortWaiting, headingFor: headingFor, split: split, counts: counts, pruneFailed: pruneFailed,
    UNDO_MS: UNDO_MS, TODO_ORDER: TODO_ORDER,
    // page
    on: on, init: init, listFor: listFor, syncTabs: syncTabs, emptyMessage: emptyMessage, headingHtml: headingHtml, actionHtml: actionHtml,
    groupForWO: groupForWO, regroup: regroup, tap: tap, decline: decline, holdThenSend: holdThenSend, ensureLoaded: ensureLoaded, resetLoaded: resetLoaded, openCard: openCard
  };
})();
