'use strict';
/* Rehearsal PDF viewer (Mozilla PDF.js): one page at a time or scrolling, fit page / fit width,
   and pinch-zoom that stays sharp (pages are re-drawn at the zoomed resolution). Its own controls
   sit outside the zoomed area, so they never move when you zoom. */
const PDFJS = window.pdfjsLib;
if (PDFJS) PDFJS.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
const PDF_DOCS = {};
const pdfDoc = src => (PDF_DOCS[src] ||= PDFJS.getDocument({ url: src }).promise);
let PDF_ACTIVE = null;          // the viewer page-turn keys act on

function mountPdf(host, src, st, onChange) {
  if (!PDFJS) { host.innerHTML = '<div class="res-fallback">PDF viewer missing.</div>'; return; }
  st.page ||= 1; st.mode ||= 'page'; st.fit ||= 'page';
  host.innerHTML = `<div class="pdfv"><div class="pdfv-view"><div class="pdfv-pages"></div></div>
    <div class="pdfv-bar">
      <button data-pdf="prev" title="Previous page (Page Up)">${IC('ico:chevleft')}</button><span class="pdfv-num">…</span><button data-pdf="next" title="Next page (Page Down)">${IC('ico:play')}</button>
      <span class="pdfv-sep"></span>
      <button data-pdf="fit" title="Fit the whole page / fit the width"></button>
      <button data-pdf="mode" title="One page at a time / scroll through all pages"></button>
      <button data-pdf="two" title="Show two pages side by side (1–2, 3–4, …)"></button>
    </div></div>`;
  const view = host.querySelector('.pdfv-view'), pages = host.querySelector('.pdfv-pages');
  let doc = null, res = 1, token = 0;
  const ctl = {
    host, st,
    go(n) {
      if (!doc) return;
      if (st.two && Math.abs(n - st.page) === 1) n = pairStart(st.page) + (n > st.page ? 2 : -2);   // turn a whole spread
      if (st.two) n = pairStart(Math.max(1, Math.min(doc.numPages, n)));
      const p = Math.max(1, Math.min(doc.numPages, n)); if (p === st.page && st.mode === 'page') return; st.page = p; onChange(); if (st.mode === 'page') draw(); else host.querySelector(`[data-pg="${p}"]`)?.scrollIntoView({ block: 'start' }); bar(); },
    setRes(z) { const r = Math.min(4, Math.max(1, Math.round(z * 2) / 2)); if (r !== res) { res = r; draw(); } },
  };
  const pairStart = n => n - ((n - 1) % 2);          // 1–2, 3–4, …
  host.__pdf = ctl;
  if (!PDF_ACTIVE || !PDF_ACTIVE.host.isConnected) PDF_ACTIVE = ctl;
  const bar = () => {
    const two = st.two && doc && st.mode === 'page' && st.page < doc.numPages;
    host.querySelector('.pdfv-num').textContent = doc ? `${two ? st.page + '–' + (st.page + 1) : st.page} / ${doc.numPages}` : '…';
    const tb = host.querySelector('[data-pdf="two"]'); tb.innerHTML = IC('ico:book') + ' 2 pages'; tb.classList.toggle('on', !!st.two);
    host.querySelector('[data-pdf="fit"]').textContent = st.fit === 'page' ? '⤢ Fit width' : '⤡ Fit page';
    host.querySelector('[data-pdf="mode"]').innerHTML = st.mode === 'page' ? IC('ico:scroll') + ' Scroll' : IC('ico:rect') + ' One page';
  };
  const draw = async () => {
    if (!doc) return;
    const my = ++token, W = view.clientWidth, H = view.clientHeight; if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (st.two && st.mode === 'page') st.page = pairStart(st.page);
    const list = st.mode === 'page' ? (st.two ? [st.page, st.page + 1].filter(n => n <= doc.numPages) : [st.page]) : Array.from({ length: Math.min(doc.numPages, 60) }, (_, i) => i + 1);
    const frag = document.createDocumentFragment();
    for (const n of list) {
      const page = await doc.getPage(n); if (my !== token) return;
      const base = page.getViewport({ scale: 1 });
      const cols = st.two ? 2 : 1, gap = st.two ? 12 : 0;
      const fitW = (W - 16 - gap) / cols / base.width, fitP = Math.min(fitW, (H - 16) / base.height);
      const scale = st.mode === 'page' && st.fit === 'page' ? fitP : fitW;
      const vp = page.getViewport({ scale: scale * dpr * res });
      const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(base.width * scale) + 'px'; c.style.height = Math.floor(base.height * scale) + 'px';
      c.dataset.pg = n; c.className = 'pdfv-page';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; if (my !== token) return;
      frag.appendChild(c);
    }
    pages.replaceChildren(frag);
    pages.classList.toggle('scroll', st.mode !== 'page');
    pages.classList.toggle('two', !!st.two);
    view.style.overflowY = 'auto';
    if (st.mode !== 'page' && st.page > 1) host.querySelector(`[data-pg="${st.page}"]`)?.scrollIntoView({ block: 'start' });
    bar();
  };
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-pdf]'); if (!b) return; e.stopPropagation();
    PDF_ACTIVE = ctl;
    const k = b.dataset.pdf;
    if (k === 'prev') ctl.go(st.page - 1);
    if (k === 'next') ctl.go(st.page + 1);
    if (k === 'fit') { st.fit = st.fit === 'page' ? 'width' : 'page'; onChange(); draw(); }
    if (k === 'two') { st.two = !st.two; onChange(); draw(); }
    if (k === 'mode') { st.mode = st.mode === 'page' ? 'scroll' : 'page'; onChange(); draw(); }
  });
  host.addEventListener('pointerdown', () => { PDF_ACTIVE = ctl; });
  // in scroll mode, keep the page counter in step with what's on screen
  view.addEventListener('scroll', () => {
    if (st.mode === 'page') return;
    const top = view.getBoundingClientRect().top + 40;
    const cur = [...pages.children].find(c => c.getBoundingClientRect().bottom > top);
    if (cur && +cur.dataset.pg !== st.page) { st.page = +cur.dataset.pg; bar(); clearTimeout(view._t); view._t = setTimeout(onChange, 500); }
  });
  let rt = null;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(draw, 150); }).observe(view);
  pdfDoc(src).then(d => { doc = d; st.page = Math.min(st.page, d.numPages); PDF_ACTIVE ||= ctl; draw(); })
    .catch(err => { host.innerHTML = `<div class="res-fallback">Couldn't open this PDF (${esc(err.message || err)}).</div>`; });
  bar();
}
// Page Up / Page Down (and most page-turn pedals) turn pages of the PDF you used last.
document.addEventListener('keydown', e => {
  if (!PDF_ACTIVE || !PDF_ACTIVE.host.isConnected || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (e.key === 'PageDown') { e.preventDefault(); PDF_ACTIVE.go(PDF_ACTIVE.st.page + 1); }
  if (e.key === 'PageUp') { e.preventDefault(); PDF_ACTIVE.go(PDF_ACTIVE.st.page - 1); }
});
window.mountPdf = mountPdf;
