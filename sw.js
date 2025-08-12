// کش آفلاین پایه (PWA)
const CACHE = 'clo3d-pro-ai-v1';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./manifest.json'];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e=>{ e.waitUntil(clients.claim()); });
self.addEventListener('fetch', e=>{ e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request))); });
