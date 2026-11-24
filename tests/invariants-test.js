// App-wide regression & invariant checks (runs under macOS JavaScriptCore, zero dependencies).
// Usage: jsc tests/invariants-test.js
// Guards JS syntax, offline service-worker parity, zoom & scrolling contracts, stacking z-index,
// persistent identifiers, and iPad shell settings so unrelated edits cannot silently break them.

let failures = 0;
let passed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failures++;
    print(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function read(path) {
  try { return readFile(path); } catch (e) { return null; }
}

print('==== invariants-test');

// 1. JS syntax check for every non-vendor script in web/
const jsFiles = [
  'web/icons.js',
  'web/sight.js',
  'web/music.js',
  'web/grade.js',
  'web/pdfview.js',
  'web/app.js',
  'web/looks.js',
  'web/settings.js',
  'web/score.js',
  'web/tools.js',
  'web/sw.js'
];
for (const f of jsFiles) {
  const src = read(f);
  check(`file exists: ${f}`, src !== null);
  if (src !== null) {
    try {
      new Function(src);
      check(`syntax ok: ${f}`, true);
    } catch (e) {
      check(`syntax ok: ${f}`, false, String(e));
    }
  }
}

const indexHtml = read('web/index.html') || '';
const swJs = read('web/sw.js') || '';
const stylesCss = read('web/styles.css') || '';
const appJs = read('web/app.js') || '';
const pdfJs = read('web/pdfview.js') || '';
const sightJs = read('web/sight.js') || '';
const scoreJs = read('web/score.js') || '';
const toolsJs = read('web/tools.js') || '';
const buildSh = read('build.sh') || '';

// 2. Service worker offline cache parity with index.html
{
  const assetRe = /(?:<script\s+src="([^"]+)"|<link\s+rel="stylesheet"\s+href="([^"]+)")/g;
  let m;
  while ((m = assetRe.exec(indexHtml)) !== null) {
    const raw = m[1] || m[2];
    if (/^https?:\/\//.test(raw)) continue;
    const clean = raw.split('?')[0];
    check(`sw.js caches ${clean}`, swJs.includes(`'${clean}'`) || swJs.includes(`"${clean}"`),
      `referenced in web/index.html (${raw}) but missing from FILES in web/sw.js`);
  }
}

// 3. Zoom & Scrolling invariants (the areas most prone to accidental regression)
// 3a. PDF viewer: 2D scroll + 60fps CSS resize + focal-point zoom + sharp re-render
check('PDF CSS: .pdfv-view uses overflow: auto',
  /\.pdfv-view\s*\{[^}]*overflow:\s*auto\s*;/.test(stylesCss));
check('PDF CSS: .pdfv-pages allows 2D growth (min-width: 100% + width: max-content)',
  /\.pdfv-pages\s*\{[^}]*min-width:\s*100%\s*;[^}]*width:\s*max-content\s*;/.test(stylesCss));
check('PDF JS: view.style.overflow = auto (not overflowY-only)',
  pdfJs.includes("view.style.overflow = 'auto';"));
check('PDF JS: applyPdfZoom anchors scroll around pointer and debounces reRenderSharp',
  pdfJs.includes('const reRenderSharp = () =>') &&
  pdfJs.includes('w.dataset.baseW') &&
  pdfJs.includes('view.scrollLeft = Math.max(0, contentX * ratio - px)') &&
  pdfJs.includes('view.scrollTop = Math.max(0, contentY * ratio - py)'));
check('PDF JS: __zoomBy / __zoomToggle forward (x, y) and wheel/gesturechange are wired',
  pdfJs.includes('host.__zoomBy = (factor, x, y)') &&
  pdfJs.includes('host.__zoomToggle = (x, y)') &&
  pdfJs.includes("host.addEventListener('wheel'") &&
  pdfJs.includes("host.addEventListener('gesturechange'"));

// 3b. Unified pinch-zoom router in app.js
check('Pinch router: window.__pinch delegates to Score, Sight, Piano, and PDF before window/stage',
  appJs.includes('window.__pinch = (x, y, mag, phase)') &&
  appJs.includes("const spRoot = hit?.closest('.sp-root')") &&
  appJs.includes("const srHost = hit?.closest('.sr-host')") &&
  appJs.includes("const pnHost = hit?.closest('.pn-seq')") &&
  appJs.includes("const pdfHost = hit?.closest('.pdf-host')") &&
  appJs.includes('pdfHost.__zoomBy(1 + mag, x, y)'));
check('Pinch router: zoomApply guards .sr-host / .sp-root from double CSS scaling',
  appJs.includes("if (box.querySelector('.sr-host, .sp-root')) { st.zoom = 1; st.zx = 0; st.zy = 0; }"));

// 3c. Sight Reading zoom & isolated staff scrollbar
check('Sight Reading CSS: .sr-host and .sr lock outer overflow hidden',
  /\.sr-host\s*\{[^}]*overflow:\s*hidden\s*;/.test(stylesCss) &&
  /\.sr\s*\{[^}]*height:\s*100%\s*;[^}]*max-height:\s*100%\s*;[^}]*overflow:\s*hidden\s*;/.test(stylesCss));
check('Sight Reading CSS: .sr-staff has isolated overflow: auto scrollbar',
  /\.sr-staff\s*\{[^}]*flex:\s*1 1 0\s*;[^}]*overflow:\s*auto\s*;/.test(stylesCss));
check('Sight Reading JS: vector zoom via staffEl.__zoom (not CSS zoom) + pinch listeners',
  sightJs.includes("staffEl.style.zoom = ''") &&
  sightJs.includes('staffEl.__zoom = z') &&
  sightJs.includes('host.__zoomBy =') &&
  sightJs.includes("host.addEventListener('wheel'") &&
  sightJs.includes("host.addEventListener('gesturechange'"));

// 3d. Score Practice zoom & scroll
check('Score Practice CSS: .sp-score keeps overflow: auto',
  /\.sp-score\s*\{[^}]*overflow:\s*auto\s*;/.test(stylesCss));
check('Score Practice JS: ctl.zoomBy + root.__zoomBy + wheel/gesturechange intact',
  scoreJs.includes('ctl.zoomBy = (f, cx, cy)') &&
  scoreJs.includes('root.__zoomBy = ctl.zoomBy') &&
  scoreJs.includes('root.__zoomToggle =') &&
  scoreJs.includes("sc.addEventListener('wheel'") &&
  scoreJs.includes("sc.addEventListener('gesturechange'"));

// 3e. Piano warm-up staff zoom & scroll
check('Piano CSS: .pq-staff-wrap overflow hidden and .pq-staff overflow auto',
  /\.pq-staff-wrap\s*\{[^}]*overflow:\s*hidden\s*;/.test(stylesCss) &&
  /\.pq-staff\s*\{[^}]*overflow:\s*auto\s*;/.test(stylesCss));
check('Piano JS: __pianoZoomBy and wheel listener on .pq-staff-wrap intact',
  toolsJs.includes('h.__pianoZoomBy =') &&
  toolsJs.includes("wrap.addEventListener('wheel'"));

// 4. Present screen stacking / z-index contracts
check('Stacking CSS: .p-head z-index 50',
  /\.p-head\s*\{[^}]*z-index:\s*50\s*;/.test(stylesCss));
check('Stacking CSS: .p-dock z-index 50',
  /\.p-dock\s*\{[^}]*z-index:\s*50\s*;/.test(stylesCss));
check('Stacking CSS: .ink z-index 20',
  /\.ink\s*\{[^}]*z-index:\s*20\s*;/.test(stylesCss));
check('Stacking CSS: .p-wins z-index 6',
  /\.p-wins\s*\{[^}]*z-index:\s*6\s*;/.test(stylesCss));
check('Stacking JS: placeInkBar and INK_UI present',
  appJs.includes('const INK_UI =') && appJs.includes('function placeInkBar()'));

// 5. Persistent identifiers (never rename)
check('Persistent ID: local.rehearsal.app in build.sh',
  buildSh.includes('<string>local.rehearsal.app</string>'));
check('Persistent ID: localStorage key rehearsal in app.js',
  appJs.includes("localStorage.getItem('rehearsal')") &&
  appJs.includes("localStorage.setItem('rehearsal'"));
check('Persistent ID: IndexedDB rehearsal-files in app.js',
  appJs.includes("indexedDB.open('rehearsal-files'"));

// 6. iPad / web shell seam guard
check('iPad shell: viewport-fit=cover and dark html.web overscroll-behavior: none',
  indexHtml.includes('viewport-fit=cover') &&
  indexHtml.includes('html.web { background: #1b2a3d; overscroll-behavior: none; }'));

// 6b. A window snapped to half a screen: the side panel must stack above the stage (with !important, because
// app.js sets the column widths directly on .p-body) instead of squeezing the stage to nothing.
check('Narrow window: side panel stacks above the stage',
  /@media\s*\(max-width:\s*900px\)\s*\{[^}]*\.p-body:not\(\.full\)\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/.test(stylesCss));

// 7. Protected zones manifest is valid JSON
{
  const raw = read('tests/protected-zones.json');
  let ok = false;
  try { const j = JSON.parse(raw); ok = Array.isArray(j.zones) && j.zones.length > 0; } catch (e) {}
  check('Protected zones manifest parses cleanly', ok);
}

print(`invariants: ${passed} passed, ${failures} failed`);
if (failures > 0) {
  throw new Error(`${failures} invariant check(s) failed`);
}
