// Ridge Co push notifications panel (Nov 5 2026). One script, included by the admin, tenant, owner and vendor pages.
// It adds a small bell button once the person is signed in. The panel lets them turn push on for THIS device (Android, iPhone, Chromebook or a Windows/desktop
// computer), and switch each of THEIR OWN devices on or off, test it, or remove it. It reads the page's own globals: WORKER (worker address) and SECRET (portal
// session token) or AUTH_TOKEN (admin). Nothing is sent anywhere until the person taps "Turn on".
(function(){
  'use strict';
  var LS_HIDE = 'rp_hide_fab';
  var PLATFORM_NAME = { android: 'Android phone', iphone: 'iPhone', chromebook: 'Chromebook', desktop: 'Windows / desktop computer' };
  var state = { open: false, devices: null, endpoint: '', busy: false, msg: '', bad: false, key: '' };
  var fab, panel;

  function base(){ return String(window.WORKER || '').replace(/\/+$/, ''); }
  function token(){ return String(window.AUTH_TOKEN || window.SECRET || ''); }
  function detectPlatform(){
    var ua = navigator.userAgent || '';
    if (/CrOS/.test(ua)) return 'chromebook';
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iphone';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }
  function standalone(){ return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function supported(){ return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function b64uToBytes(s){ s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  function api(method, path, body){
    return fetch(base() + path, { method: method, headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token() }, body: body ? JSON.stringify(body) : undefined })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok || j.ok === false) { var e = new Error(j.message || j.error || ('Request failed (' + r.status + ')')); e.status = r.status; throw e; } return j; }); });
  }
  function el(tag, attrs, kids){
    var e = document.createElement(tag);
    for (var k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function(c){ if (c) e.appendChild(c); });
    return e;
  }
  var BTN = 'min-height:44px;min-width:44px;padding:8px 14px;border-radius:8px;border:1px solid #253562;background:#fff;color:#253562;font-size:15px;cursor:pointer';
  var BTN_GO = 'min-height:44px;padding:10px 16px;border-radius:8px;border:0;background:#253562;color:#fff;font-size:16px;font-weight:600;cursor:pointer;width:100%';

  function currentSub(){
    if (!supported()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration().then(function(reg){ return reg ? reg.pushManager.getSubscription() : null; }).catch(function(){ return null; });
  }
  function refresh(){
    return currentSub().then(function(sub){
      state.endpoint = sub ? sub.endpoint : '';
      return api('GET', '/push/devices' + (state.endpoint ? '?endpoint=' + encodeURIComponent(state.endpoint) : ''));
    }).then(function(j){ state.devices = j.devices || []; }).catch(function(e){ state.msg = 'Could not load your devices: ' + e.message; state.bad = true; state.devices = state.devices || []; }).then(render);
  }
  function say(msg, bad){ state.msg = msg; state.bad = !!bad; render(); }
  function enableHere(){
    if (state.busy) return;
    state.busy = true; say('Turning on…');
    var reg;
    navigator.serviceWorker.register('sw.js').then(function(){ return navigator.serviceWorker.ready; })
      .then(function(r){ reg = r; return Notification.requestPermission(); })
      .then(function(p){ if (p !== 'granted') throw new Error(p === 'denied' ? 'Notifications are blocked for this site in your browser settings. Allow them for this site, then try again.' : 'You did not allow notifications.'); return api('GET', '/push/vapid-key'); })
      .then(function(k){ return reg.pushManager.getSubscription().then(function(old){ return old ? old.unsubscribe().then(function(){ return k; }) : k; }); })
      .then(function(k){ return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(k.key) }); })
      .then(function(sub){ var j = sub.toJSON(); return api('POST', '/push/subscribe', { subscription: { endpoint: j.endpoint, keys: j.keys }, platform: detectPlatform() }); })
      .then(function(){ state.busy = false; state.msg = 'Notifications are on for this device.'; state.bad = false; return refresh(); })
      .catch(function(e){ state.busy = false; say(e.message || 'Could not turn notifications on.', true); });
  }
  function setEnabled(d, on){ api('POST', '/push/device', { id: d.id, enabled: on }).then(function(){ return refresh(); }).catch(function(e){ say(e.message, true); }); }
  function removeDev(d){
    var here = d.this_device;
    api('POST', '/push/remove', { id: d.id }).then(function(){ return here ? currentSub().then(function(s){ return s && s.unsubscribe(); }) : null; }).then(function(){ return refresh(); }).catch(function(e){ say(e.message, true); });
  }
  function testDev(d){ say('Sending a test…'); api('POST', '/push/test', d ? { id: d.id } : {}).then(function(j){ say(j.sent + ' sent' + (j.failed ? ', ' + j.failed + ' failed' : '') + '. It should appear in a few seconds.', j.failed > 0 && !j.sent); }).catch(function(e){ say(e.message, true); }); }

  function hereBlock(){
    var p = detectPlatform(), name = PLATFORM_NAME[p], box = el('div', { style: 'border:1px solid #d0d5e0;border-radius:10px;padding:12px;margin:10px 0;background:#f6f8fc' });
    box.appendChild(el('div', { text: 'This device: ' + name, style: 'font-weight:600;margin-bottom:6px' }));
    var already = (state.devices || []).some(function(d){ return d.this_device; });
    if (!supported()) {
      box.appendChild(el('div', { text: p === 'iphone' && !standalone() ? 'On iPhone, push only works from the Home Screen. Tap the Share button, choose Add to Home Screen, then open Ridge Co from that new icon and come back here.' : 'This browser does not support push notifications. Try Chrome, Edge, Firefox or Safari (iPhone: add this page to the Home Screen first).' }));
    } else if (p === 'iphone' && !standalone()) {
      box.appendChild(el('div', { text: 'On iPhone, push only works from the Home Screen. Tap the Share button, choose Add to Home Screen, then open Ridge Co from that new icon and come back here.' }));
    } else if (Notification.permission === 'denied') {
      box.appendChild(el('div', { text: 'Notifications are blocked for this site in your browser settings. Allow them for this site, then reload this page.' }));
    } else if (already) {
      box.appendChild(el('div', { text: 'Notifications are on for this device.', style: 'color:#166534' }));
    } else {
      box.appendChild(el('button', { text: 'Turn on notifications on this device', style: BTN_GO, onclick: enableHere }));
    }
    return box;
  }
  function deviceRow(d){
    var row = el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid #e5e8f0;padding:10px 0' });
    var info = el('div', { style: 'flex:1;min-width:150px' }, [
      el('div', { text: (d.label || PLATFORM_NAME[d.platform]) + (d.this_device ? ' (this device)' : ''), style: 'font-weight:600' }),
      el('div', { text: d.last_error ? 'Last problem: ' + d.last_error : (d.last_success_at ? 'Last delivered ' + new Date(d.last_success_at).toLocaleString() : 'Nothing delivered yet'), style: 'font-size:12px;color:#555' })
    ]);
    var cb = el('input', { type: 'checkbox', 'aria-label': 'Receive notifications on ' + (d.label || PLATFORM_NAME[d.platform]), style: 'width:22px;height:22px' });
    cb.checked = !!d.enabled; cb.addEventListener('change', function(){ setEnabled(d, cb.checked); });
    var sw = el('label', { style: 'display:flex;align-items:center;gap:6px;min-height:44px;font-size:14px' }, [cb, el('span', { text: 'On' })]);
    row.appendChild(info); row.appendChild(sw);
    row.appendChild(el('button', { text: 'Test', style: BTN, onclick: function(){ testDev(d); } }));
    row.appendChild(el('button', { text: 'Remove', style: BTN, onclick: function(){ removeDev(d); } }));
    return row;
  }
  function render(){
    if (!panel) return;
    panel.innerHTML = '';
    var head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [ el('h2', { text: 'Notifications', style: 'margin:0;font-size:20px' }), el('button', { text: 'Close', style: BTN, onclick: function(){ state.open = false; panel.style.display = 'none'; } }) ]);
    panel.appendChild(head);
    panel.appendChild(el('p', { text: 'Get messages as push notifications instead of texts. Turn it on for each phone or computer you use, and switch off any device you do not want buzzing.', style: 'margin:8px 0;font-size:14px;color:#333' }));
    panel.appendChild(hereBlock());
    if (state.msg) panel.appendChild(el('div', { text: state.msg, role: 'status', style: 'margin:8px 0;padding:8px 10px;border-radius:8px;font-size:14px;' + (state.bad ? 'background:#fdecec;color:#8a1c1c' : 'background:#e8f5ec;color:#166534') }));
    var list = state.devices;
    if (list === null) panel.appendChild(el('div', { text: 'Loading your devices…' }));
    else if (!list.length) panel.appendChild(el('div', { text: 'No devices yet.', style: 'color:#555;font-size:14px' }));
    else { panel.appendChild(el('div', { text: 'Your devices', style: 'font-weight:600;margin-top:10px' })); list.forEach(function(d){ panel.appendChild(deviceRow(d)); }); if (list.length > 1) panel.appendChild(el('button', { text: 'Send a test to all my devices', style: BTN + ';margin-top:8px', onclick: function(){ testDev(null); } })); }
  }
  function openPanel(){
    if (!panel) { panel = el('div', { role: 'dialog', 'aria-label': 'Notifications', style: 'position:fixed;left:12px;right:12px;bottom:70px;max-width:460px;max-height:75vh;overflow:auto;background:#fff;color:#111;border:1px solid #c9cfdd;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;z-index:2147483000;font-family:inherit' }); document.body.appendChild(panel); }
    state.open = true; panel.style.display = 'block'; state.msg = ''; render(); refresh();
  }
  function showFab(){
    if (fab) return;
    fab = el('button', { text: '🔔', 'aria-label': 'Notification settings', title: 'Notification settings', style: 'position:fixed;left:12px;bottom:12px;width:48px;height:48px;min-width:48px;min-height:48px;border-radius:24px;border:1px solid #253562;background:#fff;font-size:22px;line-height:1;cursor:pointer;z-index:2147482999;box-shadow:0 2px 8px rgba(0,0,0,.2);padding:0', onclick: function(){ if (state.open) { state.open = false; panel.style.display = 'none'; } else openPanel(); } });
    document.body.appendChild(fab);
  }
  // The bell appears only once the person is signed in (the page sets its session token after PIN / access-code login) and the page has a worker address.
  var tries = 0;
  var t = setInterval(function(){
    tries++;
    if (base() && token()) { clearInterval(t); try { if (localStorage.getItem(LS_HIDE) !== '1') showFab(); } catch (e) { showFab(); } }
    else if (tries > 7200) clearInterval(t);
  }, 1000);
  window.RidgePush = { open: openPanel, platform: detectPlatform };
})();
