const C='bike-v3',A=['./','index.html','style.css','app.js','manifest.json','icon.svg','https://unpkg.com/leaflet@1.9.4/dist/leaflet.css','https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A).catch(()=>{}))));
self.addEventListener('fetch',e=>{
  if(/arcgisonline|cyclosm|opentopomap/.test(e.request.url)){ // cache visited tiles for offline
    e.respondWith(caches.open('tiles').then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(n=>{c.put(e.request,n.clone());return n}))));return;}
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
