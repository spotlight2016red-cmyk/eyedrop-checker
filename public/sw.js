const CACHE = 'eyedrop-cache-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/vite.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => {
      // 新しいSWがインストールされたら、すぐにアクティベート
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// SKIP_WAITINGメッセージを受け取ったら、すぐにアクティベート
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin) {
    // アセットファイル（ハッシュ付きJS/CSS）は常にネットワークから取得し、キャッシュしない
    // これにより、ビルド後のファイル名が変わっても正しく取得できる
    if (url.pathname.startsWith('/assets/')) {
      e.respondWith(
        fetch(e.request).catch(() => {
          // ネットワークリクエストが失敗した場合のみキャッシュを返す
          return caches.match(e.request);
        })
      );
    } else {
      // その他のファイルはキャッシュ優先、なければネットワーク
      e.respondWith(
        caches.match(e.request).then(res => res || fetch(e.request).then(response => {
          // 成功したレスポンスをキャッシュに保存（アセットファイル以外）
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => {
              cache.put(e.request, clone);
            });
          }
          return response;
        }))
      );
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification?.data);
  event.notification.close();
  const d = event.notification?.data || {};
  console.log('[SW] Notification data:', d);
  
  // カメラ監視からの通知（動きなし）
  if (d.type === 'camera-no-motion') {
    const targetUrl = '/';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        console.log('[SW] Found clients:', clientList.length);
        let handled = false;
        for (const client of clientList) {
          console.log('[SW] Processing client:', client.url);
          // 既存タブがあれば遷移＋フォーカス
          if ('navigate' in client) {
            console.log('[SW] Navigating to:', targetUrl);
            client.navigate(targetUrl);
          }
          // カメラ監視通知のメッセージを送信
          try { 
            console.log('[SW] Sending camera-no-motion message:', { type: 'camera-no-motion', date: d.date, message: d.message });
            client.postMessage({ type: 'camera-no-motion', date: d.date, message: d.message });
          } catch (e) {
            console.error('[SW] Error sending message:', e);
          }
          if ('focus' in client) {
            console.log('[SW] Focusing client');
            handled = true;
            return client.focus();
          }
        }
        if (!handled && self.clients.openWindow) {
          console.log('[SW] Opening new window:', targetUrl);
          return self.clients.openWindow(targetUrl);
        }
      })
    );
    return;
  }
  
  // 通常のスロット通知（朝/昼/夜）
  const targetUrl = d.slot && d.date ? `/?slot=${encodeURIComponent(d.slot)}&date=${encodeURIComponent(d.date)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      console.log('[SW] Found clients:', clientList.length);
      let handled = false;
      for (const client of clientList) {
        console.log('[SW] Processing client:', client.url);
        // 既存タブがあれば遷移＋フォーカス
        if ('navigate' in client) {
          console.log('[SW] Navigating to:', targetUrl);
          client.navigate(targetUrl);
        }
        // 追加: バックアップとしてメッセージも送る（同一タブで状態更新用）
        try { 
          console.log('[SW] Sending postMessage:', { type: 'from-notification', slot: d.slot, date: d.date });
          client.postMessage({ type: 'from-notification', slot: d.slot, date: d.date });
          // localStorageフラグも立てる指示
          if (d.slot && d.date) {
            console.log('[SW] Sending set-notif-flag:', { type: 'set-notif-flag', slot: d.slot, date: d.date });
            client.postMessage({ type: 'set-notif-flag', slot: d.slot, date: d.date });
          }
        } catch (e) {
          console.error('[SW] Error sending message:', e);
        }
        if ('focus' in client) {
          console.log('[SW] Focusing client');
          handled = true;
          return client.focus();
        }
      }
      if (!handled && self.clients.openWindow) {
        console.log('[SW] Opening new window:', targetUrl);
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});


