// Listen for messages from the app to trigger data caching
self.addEventListener('message', async (event) => {
  if (event.data && event.data.action === 'cacheData') {
    // Try to fetch and cache latest places/events JSON
    const cache = await caches.open('roam-ang-api-v1');
    try {
      const places = await fetch('https://api.npoint.io/779d46d666ced3d99e31');
      if (places.ok) await cache.put('https://api.npoint.io/779d46d666ced3d99e31', places.clone());
    } catch(e){}
    try {
      const events = await fetch('https://api.npoint.io/0305f0de662a57a9f3a8');
      if (events.ok) await cache.put('https://api.npoint.io/0305f0de662a57a9f3a8', events.clone());
    } catch(e){}
  }
});
// Simple service worker for offline caching of app shell and API data
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('roam-ang-cache-v1').then(cache =>
      cache.addAll([
        '/',
        '/index.html',
        '/manifest.json',
        '/titlelogo-192.webp',
        '/titlelogo-512.webp',
        '/titlelogo.webp',
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
