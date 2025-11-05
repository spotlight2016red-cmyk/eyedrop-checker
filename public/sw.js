const CACHE = 'eyedrop-cache-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/vite.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(res => res || fetch(e.request))
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification?.data || {};
  const targetUrl = d.slot && d.date ? `/?slot=${encodeURIComponent(d.slot)}&date=${encodeURIComponent(d.date)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      let handled = false;
      for (const client of clientList) {
        // 既存タブがあれば遷移＋フォーカス
        if ('navigate' in client) {
          client.navigate(targetUrl);
        }
        // 追加: バックアップとしてメッセージも送る（同一タブで状態更新用）
        try { 
          client.postMessage({ type: 'from-notification', slot: d.slot, date: d.date });
          // localStorageフラグも立てる指示
          if (d.slot && d.date) {
            client.postMessage({ type: 'set-notif-flag', slot: d.slot, date: d.date });
          }
        } catch (e) {}
        if ('focus' in client) {
          handled = true;
          return client.focus();
        }
      }
      if (!handled && self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});


