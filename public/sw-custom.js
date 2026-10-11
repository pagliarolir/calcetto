// Service worker dell'app: il motore di Angular (cache, aggiornamenti, push)
// più la gestione dei pulsanti delle notifiche.
importScripts('./ngsw-worker.js');

function appUrl(path) {
  const clean = (path || '/').replace(/^\//, '');
  return new URL(clean, self.registration.scope).href;
}

async function openOrFocus(url) {
  const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) {
    if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
      await c.focus();
      if ('navigate' in c) return c.navigate(url);
      return c;
    }
  }
  return clients.openWindow(url);
}

async function runQuickAction(actionUrl, fallbackUrl) {
  try {
    const res = await fetch(actionUrl, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    await self.registration.showNotification(res.ok ? 'Fatto' : 'Non è andata', {
      body: body.message || (res.ok ? 'Risposta registrata.' : 'Apri l\'app per riprovare.'),
      icon: 'icons/icon-192x192.png',
      badge: 'icons/badge-72x72.png',
      tag: 'quick-action',
      data: { url: fallbackUrl },
    });
  } catch {
    await openOrFocus(appUrl(fallbackUrl));
  }
}

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  const actionUrl = event.action && data.actionUrls && data.actionUrls[event.action];
  event.notification.close();
  if (actionUrl) {
    event.waitUntil(runQuickAction(actionUrl, data.url));
  } else {
    event.waitUntil(openOrFocus(appUrl(data.url)));
  }
});
