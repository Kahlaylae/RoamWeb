// PWA Service Worker
// Strategy:
// 1. Cache JSON data (network-first, fallback to cache)
// 2. Lightweight app-shell cache for root document & manifest (stale-while-revalidate)
// 3. No aggressive HTML hijack beyond start_url so navigation stays simple

const DATA_CACHE = 'roam-ang-data-v4';
const SHELL_CACHE = 'roam-ang-shell-v1';
const SHELL_URLS = ['/', '/jsonassets/manifest.json'];
const STATIC_SECTION_URLS = [
  '/',
  '/#placesSection',
  '/#eventsSection',
  '/#favoritesSection',
  '/#downloadSection'
];

// Install: no app-shell precache to avoid path coupling
self.addEventListener('install', (event) => {
  event.waitUntil((async()=>{
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_URLS);
    } catch(_){}
    self.skipWaiting();
  })());
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if(![DATA_CACHE, SHELL_CACHE].includes(k)) return caches.delete(k);
    }));
    self.clients.claim();
  })());
});

// Fetch: only handle JSON assets; everything else passes through to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isRoot = event.request.mode === 'navigate' && url.pathname === '/';
  const isManifest = url.pathname === '/jsonassets/manifest.json';
  const isJson = url.pathname.startsWith('/jsonassets/') && url.pathname.endsWith('.json');
  const isDynamicSitemap = url.pathname === '/dynamic-sitemap.xml';

  if(isDynamicSitemap){
    event.respondWith(buildDynamicSitemap());
    return;
  }

  if(isRoot || isManifest){
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE));
    return;
  }
  if(isJson){
    event.respondWith(networkFirstJson(event.request));
    return;
  }
});

async function staleWhileRevalidate(req, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(resp=>{ if(resp && resp.ok) cache.put(req, resp.clone()); return resp; }).catch(()=>cached);
  return cached || fetchPromise;
}

async function networkFirstJson(req){
  const cache = await caches.open(DATA_CACHE);
  try {
    const resp = await fetch(req, { cache:'no-store' });
    if(resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch(e){
    const cached = await cache.match(req);
    return cached || new Response('[]', { status:200, headers:{'Content-Type':'application/json'} });
  }
}

async function buildDynamicSitemap(){
  try {
    const origin = self.location.origin;
    // Fetch blog content
    let posts = [];
    try {
      const r = await fetch('/jsonassets/content.json', { cache:'no-store' });
      if(r.ok) posts = await r.json();
    } catch(_){ }
    // Build XML
    const today = new Date().toISOString().slice(0,10);
    const urlEntries = [];
    // Sections
    STATIC_SECTION_URLS.forEach((u,i)=>{
      urlEntries.push(xmlUrl(origin + u, today, i===0?'daily':'weekly', i===0?'1.0':'0.8'));
    });
    // Blog index
    urlEntries.push(xmlUrl(origin + '/blog/', today, 'weekly', '0.8'));
    // Blog posts
    posts.forEach(p=>{
      if(!p || !p.url) return;
      urlEntries.push(xmlUrl(origin + p.url.replace(/\/$/,'/') , today, 'monthly', '0.8'));
    });
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urlEntries.join('\n') + '\n</urlset>';
    return new Response(xml, { status:200, headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});
  } catch(e){
    return new Response('<!-- sitemap error -->', { status:500, headers:{'Content-Type':'application/xml'} });
  }
}

function xmlUrl(loc, lastmod, changefreq, priority){
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}
function escapeXml(s){ return String(s).replace(/[&<>"] /g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])||c); }

// Optional: message to warm JSON cache
self.addEventListener('message', async (event) => {
  if (!(event.data && event.data.action === 'cacheData')) return;
  const cache = await caches.open(DATA_CACHE);
  const urls = [
    '/jsonassets/places.json',
    '/jsonassets/events.json',
    '/jsonassets/content.json'
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp.ok) await cache.put(url, resp.clone());
    } catch (_) { /* ignore */ }
  }
});
  ;
