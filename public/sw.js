const CACHE = 'shiri-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./','./icon.svg']))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shiri-') && k !== CACHE).map(k => caches.delete(k))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
