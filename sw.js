const CACHE = 'live-public-shell-v1';
const SHELL = ['./', './index.html', './public.css?v=1', './public.js?v=1', './assets/icon.svg', './assets/social-live.svg', './Boleta%202.jpeg', './boleta%201.jpeg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.searchParams.has('boleta')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  if (SHELL.some((path) => new URL(path, self.location).href === url.href)) event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
