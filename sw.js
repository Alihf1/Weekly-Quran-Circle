// Service Worker — حلقة القرآن الاسبوعية
// Strategy: NETWORK-FIRST for code (HTML/JS/CSS) so every online load gets the latest version.
// The cache is only used as an offline fallback. Bump CACHE to purge old copies on activate.
const CACHE = 'quran-circle-v2';
const ASSETS = [
    './',
    './index.html',
    './script.js',
    './style.css',
    './logo.png',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    self.clients.claim();
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
});

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            try {
                const cache = await caches.open(CACHE);
                cache.put(request, response.clone());
            } catch (e) { /* non-cacheable — ignore */ }
        }
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        return cached || caches.match('./index.html');
    }
}

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Never cache Firebase/API traffic — always go to the network
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('firebasestorage.app') ||
        url.hostname.includes('gstatic.com')) {
        return;
    }

    event.respondWith(networkFirst(event.request));
});
