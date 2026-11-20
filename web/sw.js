// Rehearsal in a browser (iPad Home Screen): keeps an offline copy of the app.
// Network first, so a new release is used as soon as there's a connection; the saved copy is used
// when offline. Only Rehearsal's own files are cached; classes and library files live elsewhere
// (browser storage / IndexedDB) and are never touched here.
const CACHE = 'rehearsal-app';
const FILES = ['./', 'index.html', 'styles.css', 'icons.js', 'sight.js', 'music.js', 'grade.js', 'app.js', 'score.js',
  'pdfview.js', 'version.json', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'vendor/vexflow.js', 'vendor/osmd.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/piano.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => { })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
