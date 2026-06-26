// ==========================================
// CHIPTUNES FANTASY - OFFLINE SERVICE WORKER
// ==========================================

const CACHE_NAME = 'chiptunes-fantasy-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(clients.claim());
});

// Leitet Anfragen an das Netzwerk weiter und bietet Fallbacks
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => {
            return caches.match(e.request);
        })
    );
});