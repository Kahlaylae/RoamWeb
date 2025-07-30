// Simple service worker for offline caching of app shell and API data
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('roam-ang-cache-v1').then(cache =>
      cache.addAll([
        '/',
        '/index.html',
        '/manifest.json',
        '/titlelogo-192.png',
        '/titlelogo-512.png',
        '/titlelogo.png',
        '/WebLogo.webp',
        '/herovideo.mp4'
      ])
    )
  );
});
self.addEventListener('fetch', event => {
  if (event.request.url.includes('npoint.io')) {
    event.respondWith(
      caches.open('roam-ang-api-v1').then(cache =>
        fetch(event.request)
          .then(response => {
            cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cache.match(event.request))
      )
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(response => response || fetch(event.request))
    );
  }
});
