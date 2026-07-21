const CACHE_PREFIX = 'live-vive-el-arte-public-';
const CACHE = `${CACHE_PREFIX}v11`;
const SHELL = ['./', './index.html', './styles.css?v=6', './public.css?v=6', './public.js?v=6', './app.js?v=6', './ticket.js?v=6', './assets/icon.svg', './assets/social-live.svg', './Boleta%202.jpeg', './boleta%201.jpeg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.searchParams.has('boleta') || url.pathname.includes('/admin/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => caches.open(CACHE).then((cache) => cache.match('./index.html')))
    );
    return;
  }
  const ext = url.pathname.split('.').pop();
  if (ext === 'css' || ext === 'js') {
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      }))
    );
    return;
  }
  if (SHELL.some((path) => new URL(path, self.location).href === url.href)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
