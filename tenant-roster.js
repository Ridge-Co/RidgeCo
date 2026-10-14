/* tenant-roster.js - the tenant importer/updater panel (Oct 14 2026, Brett).
 * Shared by owner.html (an owner session) and tenant-roster-admin.html (Brett, picks an owner). One file so the rules can't drift.
 * Every tenant row needs a date: a NEW tenant needs a move-in date, a tenant LEAVING needs a move-out date. The Worker enforces it
 * (this page only helps you get it right) - POST /owner/tenant-roster/preview writes nothing, /apply refuses the whole file if any row is bad.
 * Deliberately shows NO SMS / notification / work-order settings: there are none to choose. The one checkbox is the text-message agreement.
 *
 * TenantRoster.mount(el, { call: function(method, path, body) -> Promise<json>, ownerId: function() -> string|'' , admin: bool })
 */
(function () {
  'use strict';
  var CSS = '' +
    '.tr-box{background:var(--surface,#fff);border:1px solid var(--border,#dfe3e8);border-radius:10px;padding:14px;margin-bottom:14px;color:var(--text,#1c2430)}' +
    '.tr-h{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#6b7684);margin-bottom:8px}' +
    '.tr-muted{color:var(--muted,#6b7684);font-size:12px;line-height:1.5}' +
    '.tr-seg{display:flex;gap:6px;margin:8px 0}' +
    '.tr-seg button{flex:1;padding:10px 6px;border:1px solid var(--border,#dfe3e8);border-radius:8px;background:var(--surface,#fff);color:var(--text,#1c2430);font-weight:600;font-size:13px;cursor:pointer}' +
    '.tr-seg button.on{background:var(--accent,#1d4ed8);color:#fff;border-color:var(--accent,#1d4ed8)}' +
    '.tr-card{border:1px solid var(--border,#dfe3e8);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--surface2,#f7f8fa)}' +
    '.tr-card label{display:block;font-size:11px;color:var(--muted,#6b7684);margin:8px 0 3px;font-weight:600}' +
    '.tr-card input,.tr-card select,.tr-box textarea{width:100%;padding:10px;border:1px solid var(--border,#dfe3e8);border-radius:8px;font-size:15px;background:var(--surface,#fff);color:var(--text,#1c2430);box-sizing:border-box;font-family:inherit}' +
    '.tr-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.tr-btn{padding:11px 14px;border:1px solid var(--border,#dfe3e8);border-radius:8px;background:var(--surface,#fff);color:var(--text,#1c2430);font-weight:700;font-size:14px;cursor:pointer}' +
    '.tr-btn.go{background:var(--accent2,#1a7f4b);border-color:var(--accent2,#1a7f4b);color:#fff}' +
    '.tr-btn.pri{background:var(--accent,#1d4ed8);border-color:var(--accent,#1d4ed8);color:#fff}' +
    '.tr-btn:disabled{opacity:.5}' +
    '.tr-chip{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 7px;border-radius:99px;margin-right:6px;text-transform:uppercase}' +
    '.tr-ok{background:#e7f6ec;color:#1a5c33}.tr-warn{background:#fdf3e0;color:#7a5b12}.tr-bad{background:#fdeceb;color:#8a271b}.tr-same{background:#eef2f7;color:#445}' +
    '.tr-row{border-bottom:1px solid var(--border,#dfe3e8);padding:9px 0;font-size:13px}.tr-row:last-child{border-bottom:none}' +
    '.tr-msg-bad{color:#8a271b;font-size:12px;margin-top:3px}.tr-msg-warn{color:#7a5b12;font-size:12px;margin-top:3px}' +
    '.tr-banner{border-radius:10px;padding:11px 13px;margin:10px 0;font-size:13px;line-height:1.5}' +
    '.tr-banner.ok{background:#e7f6ec;border:1px solid #bfe6cc;color:#1a5c33}.tr-banner.bad{background:#fdeceb;border:1px solid #f3c3bd;color:#8a271b}.tr-banner.warn{background:#fdf3e0;border:1px solid #f0d9a8;color:#7a5b12}' +
    '.tr-cur{font-size:13px;padding:6px 0;border-bottom:1px solid var(--border,#dfe3e8)}.tr-cur small{color:var(--muted,#6b7684)}';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---- CSV ----
  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false, i, c;
    text = String(text || '').replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  var HEAD = {
    property: ['property', 'propertyaddress', 'address', 'street', 'streetaddress'], unit: ['unit', 'unitlabel', 'apt', 'apartment', 'unitnumber'],
    name: ['tenantname', 'name', 'tenant', 'renter', 'rentername', 'fullname'], first: ['firstname', 'first', 'tenantfirstname'], last: ['lastname', 'last', 'tenantlastname'],
    phone: ['phone', 'number', 'tenantphone', 'phonenumber', 'mobile', 'cell', 'cellphone'], email: ['email', 'tenantemail', 'emailaddress'],
    move_in_date: ['moveindate', 'movein', 'moveindt', 'leasestart', 'startdate', 'moveindate'], move_out_date: ['moveoutdate', 'moveout', 'moveoutdt', 'leaseend', 'enddate']
  };
  function csvToRows(text) {
    var grid = parseCsv(text).filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
    if (!grid.length) return { rows: [], note: 'The file is empty.' };
    var heads = grid[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); });
    var idx = {}, k;
    Object.keys(HEAD).forEach(function (key) { for (k = 0; k < heads.length; k++) { if (HEAD[key].indexOf(heads[k]) >= 0 && idx[key] === undefined) idx[key] = k; } });
    if (idx.property === undefined) return { rows: [], note: 'No "Property" (address) column found in the first row of the file.' };
    var out = [], lastProp = '';
    grid.slice(1).forEach(function (r) {
      var g = function (key) { return idx[key] === undefined ? '' : String(r[idx[key]] || '').trim(); };
      var o = { property: g('property'), unit: g('unit'), first_name: g('first'), last_name: g('last'), name: g('name'), phone: g('phone'), email: g('email'), move_in_date: g('move_in_date'), move_out_date: g('move_out_date') };
      var has = o.first_name || o.last_name || o.name || o.phone || o.email || o.move_in_date || o.move_out_date;
      if (!has) { return; }
      if (!o.property) o.property = lastProp; else lastProp = o.property;   // a blank property cell means "same address as the row above"
      out.push(o);
    });
    var note = '';
    if (idx.move_in_date === undefined && idx.move_out_date === undefined) note = 'Your file has no move-in or move-out date columns. Every new tenant needs a move-in date and every tenant leaving needs a move-out date - add them to the file (columns "Move In Date" / "Move Out Date").';
    return { rows: out, note: note };
  }
  function templateCsv() {
    return 'Property,Unit,Tenant Name,Phone,Email,Move In Date,Move Out Date\n' +
      '123 Main St,,Jane Smith,(410) 555-0101,jane@example.com,2026-11-01,\n' +
      '123 Main St,,Old Tenant,(410) 555-0100,,,2026-10-31\n';
  }

  function mount(el, cfg) {
    if (!document.getElementById('tr-css')) { var st = document.createElement('style'); st.id = 'tr-css'; st.textContent = CSS; document.head.appendChild(st); }
    var S = { data: null, mode: 'manual', cards: [], consent: false, csvRows: [], csvNote: '', plan: null, busy: false, banner: '', applied: null };

    function body(extra) { var b = extra || {}; if (cfg.admin) b.owner_id = cfg.ownerId(); return b; }
    function load() {
      if (cfg.admin && !cfg.ownerId()) { S.data = null; render(); return; }
      el.innerHTML = '<div class="tr-muted" style="padding:20px;text-align:center">Loading…</div>';
      cfg.call('GET', '/owner/tenant-roster' + (cfg.admin ? '?owner_id=' + encodeURIComponent(cfg.ownerId()) : ''), null).then(function (d) {
        if (!d || d.error) { S.data = null; S.banner = '<div class="tr-banner bad">Could not load your properties: ' + esc((d && d.error) || 'no response') + '</div>'; }
        else { S.data = d; S.banner = ''; if (!S.cards.length) S.cards.push(newCard()); }
        render();
      }, function (e) { S.data = null; S.banner = '<div class="tr-banner bad">Could not load your properties: ' + esc(e && e.message || e) + '</div>'; render(); });
    }
    function newCard() { return { kind: 'in', property_id: '', unit_id: '', tenant_id: '', first: '', last: '', phone: '', email: '', move_in: '', move_out: '' }; }
    function prop(id) { return (S.data.properties || []).filter(function (p) { return p.id === id; })[0]; }
    function tenantsAt(pid, uid) { return (S.data.tenants || []).filter(function (t) { return t.current && t.property_id === pid && (!uid || t.unit_id === uid); }); }

    function cardsToRows() {
      var rows = [];
      S.cards.forEach(function (c) {
        var p = prop(c.property_id), base = { property_id: c.property_id, unit_id: c.unit_id };
        if (c.kind === 'in') rows.push(Object.assign(base, { first_name: c.first, last_name: c.last, phone: c.phone, email: c.email, move_in_date: c.move_in }));
        else {
          var t = (S.data.tenants || []).filter(function (x) { return x.id === c.tenant_id; })[0];
          var nm = t ? t.name.split(' ') : [];
          if (c.kind === 'out') rows.push(Object.assign(base, { first_name: nm[0] || '', last_name: nm.slice(1).join(' '), phone: t ? t.phone : '', move_out_date: c.move_out }));
          else rows.push(Object.assign(base, { first_name: c.first, last_name: c.last, phone: t ? t.phone : '' }));
        }
        if (!p) rows[rows.length - 1].property_id = c.property_id;   // server reports "not one of your properties"
      });
      return rows;
    }
    function currentRows() { return S.mode === 'manual' ? cardsToRows() : S.csvRows; }

    function cardHtml(c, i) {
      var props = S.data.properties || [], p = prop(c.property_id), units = p ? p.units : [];
      var h = '<div class="tr-card" data-i="' + i + '"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:13px">Change ' + (i + 1) + '</b>' +
        (S.cards.length > 1 ? '<button class="tr-btn" data-act="rm" data-i="' + i + '" style="padding:4px 10px;font-size:12px">Remove</button>' : '') + '</div>' +
        '<label>What is changing?</label><select data-f="kind" data-i="' + i + '">' +
        [['in', 'A new tenant is moving in'], ['out', 'A current tenant is moving out'], ['fix', 'Fix a tenant\'s name']].map(function (o) { return '<option value="' + o[0] + '"' + (c.kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<label>Property</label><select data-f="property_id" data-i="' + i + '"><option value="">Choose a property…</option>' +
        props.map(function (x) { return '<option value="' + esc(x.id) + '"' + (c.property_id === x.id ? ' selected' : '') + '>' + esc(x.address) + '</option>'; }).join('') + '</select>';
      if (units.length) h += '<label>Unit</label><select data-f="unit_id" data-i="' + i + '"><option value="">Choose a unit…</option>' +
        units.map(function (u) { return '<option value="' + esc(u.id) + '"' + (c.unit_id === u.id ? ' selected' : '') + '>' + esc(u.label) + '</option>'; }).join('') + '</select>';
      if (c.kind === 'in') {
        h += '<div class="tr-2"><div><label>First name</label><input data-f="first" data-i="' + i + '" value="' + esc(c.first) + '" autocomplete="off"></div><div><label>Last name</label><input data-f="last" data-i="' + i + '" value="' + esc(c.last) + '" autocomplete="off"></div></div>' +
          '<label>Phone</label><input type="tel" inputmode="tel" data-f="phone" data-i="' + i + '" value="' + esc(c.phone) + '" placeholder="(410) 555-0123">' +
          '<label>Email <span style="font-weight:400">(optional)</span></label><input type="email" data-f="email" data-i="' + i + '" value="' + esc(c.email) + '">' +
          '<label>Move-in date <span style="color:#8a271b">*required</span></label><input type="date" data-f="move_in" data-i="' + i + '" value="' + esc(c.move_in) + '">';
      } else {
        var list = c.property_id ? tenantsAt(c.property_id, c.unit_id) : [];
        h += '<label>Which tenant?</label><select data-f="tenant_id" data-i="' + i + '"><option value="">' + (c.property_id ? (list.length ? 'Choose a tenant…' : 'No current tenants listed here') : 'Choose a property first') + '</option>' +
          list.map(function (t) { return '<option value="' + esc(t.id) + '"' + (c.tenant_id === t.id ? ' selected' : '') + '>' + esc(t.name || t.phone) + '</option>'; }).join('') + '</select>';
        if (c.kind === 'out') h += '<label>Move-out date <span style="color:#8a271b">*required</span></label><input type="date" data-f="move_out" data-i="' + i + '" value="' + esc(c.move_out) + '">' +
          '<div class="tr-muted" style="margin-top:6px">A future date keeps them listed until that day.</div>';
        else h += '<div class="tr-2"><div><label>First name</label><input data-f="first" data-i="' + i + '" value="' + esc(c.first) + '" autocomplete="off"></div><div><label>Last name</label><input data-f="last" data-i="' + i + '" value="' + esc(c.last) + '" autocomplete="off"></div></div>';
      }
      return h + '</div>';
    }

    function planHtml() {
      var P = S.plan; if (!P) return '';
      var chip = { move_in: ['tr-ok', 'New tenant'], move_out: ['tr-ok', 'Moving out'], name_fix: ['tr-ok', 'Name fix'], backfill: ['tr-ok', 'Date added'], unchanged: ['tr-same', 'No change'], already_done: ['tr-same', 'Already done'], error: ['tr-bad', 'Fix this'] };
      var c = P.counts || {};
      var h = '<div class="tr-box" data-plan="1"><div class="tr-h">Check results</div>';
      if (P.errors && P.errors.length) h += '<div class="tr-banner bad">' + P.errors.map(esc).join('<br>') + '</div>';
      h += '<div class="tr-muted" style="margin-bottom:6px">' + (c.move_in || 0) + ' moving in · ' + (c.move_out || 0) + ' moving out' + (c.future_move_out ? ' (' + c.future_move_out + ' on a future date)' : '') + ' · ' + ((c.name_fix || 0) + (c.backfill || 0)) + ' updates · ' + ((c.unchanged || 0) + (c.already_done || 0)) + ' unchanged' + (c.error ? ' · <b style="color:#8a271b">' + c.error + ' to fix</b>' : '') + '</div>';
      (P.rows || []).forEach(function (r) {
        var ch = chip[r.status] || chip.error;
        h += '<div class="tr-row"><span class="tr-chip ' + ch[0] + '">' + ch[1] + '</span>' + esc(r.label) +
          (r.errors || []).map(function (m) { return '<div class="tr-msg-bad">' + esc(m) + '</div>'; }).join('') +
          (r.warnings || []).map(function (m) { return '<div class="tr-msg-warn">' + esc(m) + '</div>'; }).join('') + '</div>';
      });
      if (P.ok) h += '<div class="tr-banner ok">Everything checks out. Nothing has been saved yet.</div><button class="tr-btn go" data-act="apply" style="width:100%"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : 'Save these changes') + '</button>';
      else h += '<div class="tr-banner bad">Nothing was saved. Fix the rows marked above and check again. Every new tenant needs a move-in date; every tenant leaving needs a move-out date.</div>';
      return h + '</div>';
    }

    function appliedHtml() {
      var A = S.applied; if (!A) return '';
      var bad = (A.results || []).filter(function (r) { return !r.applied; });
      var h = '<div class="tr-box"><div class="tr-h">Saved</div>' +
        '<div class="tr-banner ' + (A.ok ? 'ok' : 'bad') + '">' + (A.ok ? 'Done. ' : 'Some rows did NOT save. ') + (A.counts.move_in || 0) + ' moved in, ' + (A.counts.move_out || 0) + ' moved out' +
        (A.counts.future_move_out ? ' (' + A.counts.future_move_out + ' future)' : '') + ', ' + (A.counts.name_fix || 0) + ' updated.</div>';
      bad.forEach(function (r) { h += '<div class="tr-row"><span class="tr-chip tr-bad">Not saved</span>' + esc(r.label) + '<div class="tr-msg-bad">' + esc(r.error) + '</div></div>'; });
      (A.warnings || []).forEach(function (w) { h += '<div class="tr-msg-warn">' + esc(w) + '</div>'; });
      return h + '</div>';
    }

    function currentHtml() {
      var T = S.data.tenants || [];
      if (!T.length) return '<div class="tr-muted">No tenants are listed yet.</div>';
      return (S.data.properties || []).map(function (p) {
        var list = T.filter(function (t) { return t.property_id === p.id && t.current; });
        if (!list.length) return '';
        return '<div style="margin-top:8px"><b style="font-size:13px">' + esc(p.address) + '</b>' + list.map(function (t) {
          var u = t.unit_id ? (p.units.filter(function (x) { return x.id === t.unit_id; })[0] || {}).label : '';
          return '<div class="tr-cur">' + esc(t.name || '(no name)') + (u ? ' · ' + esc(u) : '') + ' <small>' + esc(t.phone) + ' · ' + (t.move_in_date ? 'moved in ' + esc(t.move_in_date) : '<span style="color:#7a5b12">no move-in date</span>') + (t.move_out_date ? ' · leaving ' + esc(t.move_out_date) : '') + '</small></div>';
        }).join('') + '</div>';
      }).join('');
    }

    function render() {
      if (!S.data) { el.innerHTML = S.banner || (cfg.admin ? '<div class="tr-muted" style="padding:16px">Choose an owner above.</div>' : ''); return; }
      var h = S.banner || '';
      h += '<div class="tr-box"><div class="tr-h">Update your tenants</div><div class="tr-muted">Every new tenant needs a <b>move-in date</b> and every tenant who is leaving needs a <b>move-out date</b>. Tenants who are not changing do not need to be listed.</div>' +
        '<div class="tr-seg"><button data-act="mode" data-m="manual" class="' + (S.mode === 'manual' ? 'on' : '') + '">Type it in</button><button data-act="mode" data-m="csv" class="' + (S.mode === 'csv' ? 'on' : '') + '">Upload a file</button></div>';
      if (S.mode === 'manual') {
        h += S.cards.map(cardHtml).join('') + '<button class="tr-btn" data-act="add" style="width:100%;margin-bottom:8px">+ Add another change</button>';
      } else {
        h += '<div class="tr-muted" style="margin-bottom:8px">A spreadsheet saved as CSV with columns: Property, Unit (if the property has units), Tenant Name, Phone, Email, Move In Date, Move Out Date. A blank Property cell means the same address as the row above. <a href="#" data-act="tpl">Download an example</a></div>' +
          '<input type="file" accept=".csv,text/csv,text/plain" data-act="file" style="width:100%;margin-bottom:8px">' +
          '<textarea rows="5" data-f="csvtext" placeholder="…or paste the rows here (include the header row)"></textarea>' +
          (S.csvNote ? '<div class="tr-banner warn">' + esc(S.csvNote) + '</div>' : '') +
          (S.csvRows.length ? '<div class="tr-muted" style="margin-top:6px">' + S.csvRows.length + ' rows read.</div>' : '');
      }
      h += '<label style="display:flex;gap:10px;align-items:flex-start;margin:14px 0 10px;font-size:13px;line-height:1.4;cursor:pointer"><input type="checkbox" data-act="consent" style="width:auto;margin-top:2px"' + (S.consent ? ' checked' : '') + '> <span>The new tenants have agreed to receive maintenance text messages.</span></label>' +
        '<button class="tr-btn pri" data-act="check" style="width:100%"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Checking…' : 'Check my changes') + '</button></div>';
      h += planHtml() + appliedHtml();
      h += '<div class="tr-box"><div class="tr-h">Tenants on file</div>' + currentHtml() + '</div>';
      el.innerHTML = h;
    }

    function check() {
      var rows = currentRows();
      if (!rows.length) { S.banner = '<div class="tr-banner bad">Nothing to check yet - add a change first.</div>'; render(); return; }
      S.busy = true; S.applied = null; S.banner = ''; render();
      cfg.call('POST', '/owner/tenant-roster/preview', body({ rows: rows, consent: S.consent })).then(function (d) {
        S.busy = false;
        if (!d || (d.error && !d.plan)) { S.plan = null; S.banner = '<div class="tr-banner bad">The check could not run: ' + esc((d && d.error) || 'no response') + '</div>'; }
        else S.plan = d.plan;
        render(); var b = el.querySelector('[data-plan]'); if (b && b.scrollIntoView) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, function (e) { S.busy = false; S.banner = '<div class="tr-banner bad">The check could not run: ' + esc(e && e.message || e) + '</div>'; render(); });
    }
    function apply() {
      if (S.busy) return;
      S.busy = true; S.banner = ''; render();
      cfg.call('POST', '/owner/tenant-roster/apply', body({ rows: currentRows(), consent: S.consent })).then(function (d) {
        S.busy = false;
        if (d && d.refused) { S.plan = d.plan; S.banner = '<div class="tr-banner bad">' + esc(d.error) + '</div>'; render(); return; }
        if (!d || (d.error && !d.results)) { S.banner = '<div class="tr-banner bad">Saving failed: ' + esc((d && d.error) || 'no response') + ' Nothing may have been saved - check the list below before trying again.</div>'; render(); return; }
        S.applied = d; S.plan = null; S.cards = [newCard()]; S.csvRows = []; S.csvNote = '';
        cfg.call('GET', '/owner/tenant-roster' + (cfg.admin ? '?owner_id=' + encodeURIComponent(cfg.ownerId()) : ''), null).then(function (nd) { if (nd && !nd.error) S.data = nd; render(); }, function (e) { S.banner = '<div class="tr-banner warn">Saved, but the list could not refresh: ' + esc(e && e.message || e) + '</div>'; render(); });
      }, function (e) { S.busy = false; S.banner = '<div class="tr-banner bad">Saving failed: ' + esc(e && e.message || e) + ' Check the list below before trying again.</div>'; render(); });
    }

    el.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-act]') : null; if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'mode') { S.mode = t.getAttribute('data-m'); S.plan = null; render(); }
      else if (act === 'add') { S.cards.push(newCard()); render(); }
      else if (act === 'rm') { S.cards.splice(+t.getAttribute('data-i'), 1); S.plan = null; render(); }
      else if (act === 'check') check();
      else if (act === 'apply') apply();
      else if (act === 'tpl') {
        ev.preventDefault();
        var blob = new Blob([templateCsv()], { type: 'text/csv' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'tenant-update-example.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
    });
    el.addEventListener('change', function (ev) {
      var t = ev.target, act = t.getAttribute && t.getAttribute('data-act'), f = t.getAttribute && t.getAttribute('data-f'), i = t.getAttribute && t.getAttribute('data-i');
      if (act === 'consent') { S.consent = !!t.checked; S.plan = null; return; }
      if (act === 'file') {
        var file = t.files && t.files[0]; if (!file) return;
        var rd = new FileReader();
        rd.onload = function () { var r = csvToRows(rd.result); S.csvRows = r.rows; S.csvNote = r.note; S.plan = null; render(); };
        rd.onerror = function () { S.csvRows = []; S.csvNote = 'The file could not be read.'; render(); };
        rd.readAsText(file); return;
      }
      if (f && f !== 'csvtext' && i !== null) {
        var c = S.cards[+i]; if (!c) return;
        c[f] = t.value; S.plan = null;
        if (f === 'kind' || f === 'property_id' || f === 'unit_id' || f === 'tenant_id') {
          if (f === 'property_id') { c.unit_id = ''; c.tenant_id = ''; }
          if (f === 'tenant_id' && c.kind === 'fix') { var tt = (S.data.tenants || []).filter(function (x) { return x.id === t.value; })[0]; if (tt) { var nm = tt.name.split(' '); c.first = nm[0] || ''; c.last = nm.slice(1).join(' '); } }
          render();
        }
      }
      if (f === 'csvtext') { var r2 = csvToRows(t.value); S.csvRows = r2.rows; S.csvNote = r2.note; S.plan = null; render(); }
    });
    el.addEventListener('input', function (ev) { var t = ev.target, f = t.getAttribute && t.getAttribute('data-f'), i = t.getAttribute && t.getAttribute('data-i'); if (f && f !== 'csvtext' && i !== null && t.tagName === 'INPUT' && S.cards[+i]) { S.cards[+i][f] = t.value; S.plan = null; } });

    return { reload: function () { S.cards = []; S.plan = null; S.applied = null; load(); } , load: load };
  }
  window.TenantRoster = { mount: mount, csvToRows: csvToRows };
})();
