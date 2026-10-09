// Vỉa Hè Sài Gòn service worker: ảnh/nhạc cache-first, trang game network-first, không đụng /api
const V='vhsg-v1791537483';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(V).then(c=>c.addAll(['./','logo.webp']).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
  const asset=/\/a\/|\.webp$|\.mp3$|\.png$|\.woff2$/.test(u.pathname);
  if(asset){e.respondWith(caches.open(V).then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok)c.put(e.request,res.clone());return res}))));return}
  e.respondWith(fetch(e.request).then(res=>{if(res.ok){const cl=res.clone();caches.open(V).then(c=>c.put(e.request,cl))}return res}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./'))))});
