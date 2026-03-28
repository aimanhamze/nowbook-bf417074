// Push notification service worker (separate from VitePWA's sw)
self.addEventListener('push', (event) => {
  let data = { title: 'הזמנה חדשה!', body: 'יש לך הזמנה חדשה', url: '/dashboard' };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      data: { url: data.url },
      dir: 'rtl',
      lang: 'he',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
