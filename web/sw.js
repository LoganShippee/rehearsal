// Rehearsal's web version (any browser, or installed to a Home Screen / desktop): keeps an offline copy of the app.
// Network first, so a new release is used as soon as there's a connection; the saved copy is used
// when offline. Only Rehearsal's own files are cached; classes and library files live elsewhere
// (browser storage / IndexedDB) and are never touched here.
const CACHE = 'rehearsal-app';
const FILES = ['./', 'index.html', 'styles.css', 'hw-teacher.css', 'icons.js', 'sight.js', 'music.js', 'grade.js', 'app.js', 'looks.js', 'settings.js', 'score.js', 'tools.js',
  'hw-teacher-api.js', 'hw-teacher-drawer.js', 'hw-teacher.js',
  'hw.html', 'hw.css', 'hw-shim.js', 'hw-api.js', 'hw-student.js', 'hw-demo.html', 'hw-oauth.html',
  'privacy.html', 'privacy-sdpc.html', 'it-whitelisting.html',
  'pdfview.js', 'version.json', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png', 'favicon.ico',
  'backgrounds/risers.svg', 'backgrounds/keys.svg', 'backgrounds/staff.svg', 'backgrounds/spotlight.svg', 'backgrounds/waves.svg', 'backgrounds/sunset.svg', 'backgrounds/notes.svg',
  'vendor/vexflow.js', 'vendor/osmd.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/piano.js',
  'vendor/hands/do.png', 'vendor/hands/re.png', 'vendor/hands/mi.png', 'vendor/hands/fa.png', 'vendor/hands/sol.png', 'vendor/hands/la.png', 'vendor/hands/ti.png',
  'vendor/hands/di.png', 'vendor/hands/ri.png', 'vendor/hands/fi.png', 'vendor/hands/si.png', 'vendor/hands/li.png',
  'vendor/hands/ra.png', 'vendor/hands/me.png', 'vendor/hands/se.png', 'vendor/hands/le.png', 'vendor/hands/te.png'];
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
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => {
    if (r) return r;
    const p = url.pathname;
    if (p.endsWith('/hw.html') || p.endsWith('/hw')) return caches.match('hw.html');
    if (p.endsWith('/hw-demo.html') || p.endsWith('/hw-demo') || p.endsWith('/demo')) return caches.match('hw-demo.html');
    if (p === '/' || p.endsWith('/index.html') || !p.split('/').pop().includes('.')) return caches.match('index.html');
    return undefined;
  })));
});
