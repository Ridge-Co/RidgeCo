// Ridge Co service worker. Push notifications ONLY: it caches nothing and answers no fetches, so it can never serve a stale page.
// Lives in the repo root so its scope is the whole site (/RidgeCo/). iPhone needs the page added to the Home Screen before push works at all.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  // Every push MUST show a notification (iPhone and Chrome both cancel push for sites that receive one silently).
  e.waitUntil(self.registration.showNotification(String(d.title || 'Ridge Co'), {
    body: String(d.body || ''),
    tag: d.tag ? String(d.tag) : undefined,
    data: { url: d.url ? String(d.url) : '' }
  }));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var want = (e.notification.data && e.notification.data.url) || '';
  var target = self.registration.scope;
  try { var u = new URL(want, self.registration.scope); if (u.origin === self.location.origin) target = u.href; } catch (err) { /* keep the site root */ }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
    for (var i = 0; i < list.length; i++) { if (list[i].url === target && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(target);
  }));
});
