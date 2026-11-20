'use strict';
/* Rehearsal PDF viewer (Mozilla PDF.js): one page at a time or scrolling, fit page / fit width,
   and pinch-zoom that stays sharp (pages are re-drawn at the zoomed resolution). Its own controls
   sit outside the zoomed area, so they never move when you zoom. ✏️ Annotate draws on the pages
   (pen, highlighter, eraser); the marks are kept with the file until erased or cleared. */
const PDFJS = window.pdfjsLib;
if (PDFJS) PDFJS.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
const PDF_DOCS = {};
const pdfDoc = src => (PDF_DOCS[src] ||= PDFJS.getDocument({ url: src }).promise);
let PDF_ACTIVE = null;          // the viewer page-turn keys act on
const PDF_PEN = { tool: 'pen', color: '#e5484d', size: 1 };   // shared by every PDF viewer

// opts (optional): key (the file, so every viewer of it shares marks), ink() → { page: [strokes] },
// saveInk(), saveCopy(blob) to store an annotated copy, name (for the copy)
function mountPdf(host, src, st, onChange, opts = {}) {
  if (!PDFJS) { host.innerHTML = '<div class="res-fallback">PDF viewer missing.</div>'; return; }
  st.page ||= 1; st.mode ||= 'page'; st.fit ||= 'page';
  const canInk = !!opts.ink;
  host.innerHTML = `<div class="pdfv"><div class="pdfv-view"><div class="pdfv-pages"></div></div>
    ${canInk ? '<div class="pdfv-abar" hidden></div>' : ''}
    <div class="pdfv-bar">
      <button data-pdf="prev" title="Previous page (Page Up)">${IC('ico:chevleft')}</button><span class="pdfv-num">…</span><button data-pdf="next" title="Next page (Page Down)">${IC('ico:play')}</button>
      <span class="pdfv-sep"></span>
      <button data-pdf="fit" title="Fit the whole page / fit the width"></button>
      <button data-pdf="mode" title="One page at a time / scroll through all pages"></button>
      <button data-pdf="two" title="Show two pages side by side (1–2, 3–4, …)"></button>
      ${canInk ? `<span class="pdfv-sep"></span><button data-pdf="annot" title="Draw on this PDF (marks are kept until you erase or clear them)">${IC('ico:pen')} Annotate</button>` : ''}
    </div></div>`;
  const view = host.querySelector('.pdfv-view'), pages = host.querySelector('.pdfv-pages'), abar = host.querySelector('.pdfv-abar');
  let doc = null, res = 1, token = 0, annot = false;
  const undo = [];
  const ink = () => opts.ink();
  const ctl = {
    host, st, key: opts.key,
    go(n) {
      if (!doc) return;
      if (st.two && Math.abs(n - st.page) === 1) n = pairStart(st.page) + (n > st.page ? 2 : -2);   // turn a whole spread
      if (st.two) n = pairStart(Math.max(1, Math.min(doc.numPages, n)));
      const p = Math.max(1, Math.min(doc.numPages, n)); if (p === st.page && st.mode === 'page') return; st.page = p; onChange(); if (st.mode === 'page') draw(); else host.querySelector(`[data-pg="${p}"]`)?.scrollIntoView({ block: 'start' }); bar(); },
    setRes(z) { const r = Math.min(4, Math.max(1, Math.round(z * 2) / 2)); if (r !== res) { res = r; draw(); } },
    redrawInk() { for (const w of pages.querySelectorAll('.pdfv-pw')) inkPage(w); },
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
    host.querySelector('[data-pdf="annot"]')?.classList.toggle('on', annot);
  };
  // the annotation tools (shown while Annotate is on)
  const abarRender = () => {
    if (!abar) return;
    abar.hidden = !annot; if (!annot) return;
    const has = Object.values(ink()).some(a => a?.length);
    abar.innerHTML = `${[['pen', 'ico:pen', 'Pen'], ['hl', 'ico:highlight', 'Highlighter'], ['erase', 'ico:erase', 'Eraser (touch a mark to remove it)']].map(([t, ic, l]) => `<button data-pdfa="tool" data-v="${t}" class="${PDF_PEN.tool === t ? 'on' : ''}" title="${l}">${IC(ic)}</button>`).join('')}
      <span class="pdfv-sep"></span>
      ${PDF_INK_COLORS.map(c => `<button data-pdfa="color" data-v="${c}" class="sw ${PDF_PEN.color === c ? 'on' : ''}" style="--c:${c}" title="Colour"></button>`).join('')}
      <span class="pdfv-sep"></span>
      ${PDF_INK_SIZES.map((_, i) => `<button data-pdfa="size" data-v="${i}" class="sz ${PDF_PEN.size === i ? 'on' : ''}" title="${['Thin', 'Medium', 'Thick'][i]}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join('')}
      <span class="pdfv-sep"></span>
      <button data-pdfa="undo" title="Undo" ${undo.length ? '' : 'disabled'}>${IC('ico:undo')}</button>
      <button data-pdfa="clearpage" title="Erase every mark on this page" ${ink()[st.page]?.length ? '' : 'disabled'}>Clear page</button>
      <button data-pdfa="clearall" title="Erase the marks on every page" ${has ? '' : 'disabled'}>Clear all</button>
      ${opts.saveCopy ? `<button data-pdfa="copy" title="Save a new PDF with the marks made permanent (the original stays as it is)" ${has ? '' : 'disabled'}>${IC('ico:save')} Save copy</button>` : ''}
      <button data-pdfa="done" title="Stop annotating">Done</button>`;
  };
  // draw the saved marks of one page into its overlay
  const inkPage = w => {
    const svg = w.querySelector('svg.pdfv-ink'); if (!svg) return;
    const n = +w.dataset.pg, W = +svg.dataset.w, H = +svg.dataset.h;
    svg.innerHTML = (ink()[n] || []).map(s => pdfStrokeSVG(s, W, H)).join('');
  };
  const changed = () => { opts.saveInk && opts.saveInk(); abarRender(); for (const h of document.querySelectorAll('.pdf-host')) if (h !== host && h.__pdf?.key && h.__pdf.key === opts.key) h.__pdf.redrawInk(); };
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
      const cw = Math.floor(base.width * scale), ch = Math.floor(base.height * scale);
      c.style.width = cw + 'px'; c.style.height = ch + 'px'; c.className = 'pdfv-page';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; if (my !== token) return;
      // each page sits in a wrapper with its marks on top (an SVG in the page's own units)
      const w = document.createElement('div'); w.className = 'pdfv-pw'; w.dataset.pg = n;
      w.style.width = cw + 'px'; w.style.height = ch + 'px';
      w.appendChild(c);
      if (canInk) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'pdfv-ink'); svg.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`); svg.setAttribute('preserveAspectRatio', 'none');
        svg.dataset.w = base.width; svg.dataset.h = base.height;
        w.appendChild(svg); inkPage(w);
      }
      frag.appendChild(w);
    }
    pages.replaceChildren(frag);
    pages.classList.toggle('scroll', st.mode !== 'page');
    pages.classList.toggle('two', !!st.two);
    view.style.overflowY = 'auto';
    if (st.mode !== 'page' && st.page > 1) host.querySelector(`[data-pg="${st.page}"]`)?.scrollIntoView({ block: 'start' });
    bar(); abarRender();
  };
  host.addEventListener('click', e => {
    const a = e.target.closest('[data-pdfa]');
    if (a) {
      e.stopPropagation(); const k = a.dataset.pdfa, I = ink();
      if (k === 'tool') PDF_PEN.tool = a.dataset.v;
      if (k === 'color') { PDF_PEN.color = a.dataset.v; if (PDF_PEN.tool === 'erase') PDF_PEN.tool = 'pen'; }
      if (k === 'size') PDF_PEN.size = +a.dataset.v;
      if (k === 'undo') {
        const u = undo.pop(); if (u) { if (u.add) { const arr = I[u.page] || []; const i = arr.indexOf(u.add); if (i >= 0) arr.splice(i, 1); } if (u.restore) for (const [p, arr] of Object.entries(u.restore)) I[p] = arr; }
        changed(); ctl.redrawInk(); return;
      }
      if (k === 'clearpage' && I[st.page]?.length) {
        const pgs = st.two && st.mode === 'page' ? [st.page, st.page + 1] : [st.page];
        const restore = {}; for (const p of pgs) if (I[p]?.length) { restore[p] = I[p]; delete I[p]; }
        undo.push({ restore }); changed(); ctl.redrawInk(); return;
      }
      if (k === 'clearall' && confirm('Erase all the marks on every page of this PDF?')) {
        const restore = {}; for (const p of Object.keys(I)) { restore[p] = I[p]; delete I[p]; }
        undo.push({ restore }); changed(); ctl.redrawInk(); return;
      }
      if (k === 'copy' && doc) {
        a.disabled = true;
        pdfBurn(doc, I, (n, t) => { a.textContent = `Saving ${n}/${t}…`; })
          .then(blob => opts.saveCopy(blob))
          .catch(err => alert('Could not save the copy: ' + (err.message || err)))
          .finally(() => abarRender());
        return;
      }
      if (k === 'done') { annot = false; host.querySelector('.pdfv').classList.remove('annot'); bar(); }
      abarRender(); return;
    }
    const b = e.target.closest('[data-pdf]'); if (!b) return; e.stopPropagation();
    PDF_ACTIVE = ctl;
    const k = b.dataset.pdf;
    if (k === 'prev') ctl.go(st.page - 1);
    if (k === 'next') ctl.go(st.page + 1);
    if (k === 'fit') { st.fit = st.fit === 'page' ? 'width' : 'page'; onChange(); draw(); }
    if (k === 'two') { st.two = !st.two; onChange(); draw(); }
    if (k === 'mode') { st.mode = st.mode === 'page' ? 'scroll' : 'page'; onChange(); draw(); }
    if (k === 'annot') { annot = !annot; host.querySelector('.pdfv').classList.toggle('annot', annot); bar(); abarRender(); }
  });
  host.addEventListener('pointerdown', () => { PDF_ACTIVE = ctl; });
  // drawing on a page
  if (canInk) {
    let cur = null;
    const at = (e, svg) => { const r = svg.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)]; };
    const eraseAt = (n, p, ar) => {
      const arr = ink()[n]; if (!arr?.length) return false;
      const keep = arr.filter(s => !s.pts.some((q, i) => pdfSegDist(p, q, s.pts[i + 1] || q, ar) < Math.max(0.012, s.w)));
      if (keep.length === arr.length) return false;
      (cur.removed ||= arr.slice()); ink()[n] = keep; return true;
    };
    pages.addEventListener('pointerdown', e => {
      const svg = e.target.closest?.('svg.pdfv-ink'); if (!annot || !svg || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      const w = svg.parentElement, n = +w.dataset.pg, W = +svg.dataset.w, H = +svg.dataset.h, ar = H / W, p = at(e, svg);
      try { svg.setPointerCapture(e.pointerId); } catch { }
      if (PDF_PEN.tool === 'erase') { cur = { erase: true, n, svg, w, ar }; if (eraseAt(n, p, ar)) inkPage(w); return; }
      const hl = PDF_PEN.tool === 'hl';
      const s = { t: PDF_PEN.tool, c: hl ? (PDF_PEN.color === '#e5484d' ? '#f2c230' : PDF_PEN.color) : PDF_PEN.color, w: PDF_INK_SIZES[PDF_PEN.size] * (hl ? 4 : 1), pts: [p] };
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'g'); svg.appendChild(el);
      cur = { s, n, svg, w, el, W, H };
      el.innerHTML = pdfStrokeSVG(s, W, H);
    });
    pages.addEventListener('pointermove', e => {
      if (!cur) return;
      const p = at(e, cur.svg);
      if (cur.erase) { if (eraseAt(cur.n, p, cur.ar)) inkPage(cur.w); return; }
      const last = cur.s.pts[cur.s.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0015) return;
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) cur.s.pts.push(at(ev, cur.svg));
      cur.el.innerHTML = pdfStrokeSVG(cur.s, cur.W, cur.H);
    });
    const up = () => {
      if (!cur) return;
      const c = cur; cur = null;
      if (c.erase) { if (c.removed) { undo.push({ restore: { [c.n]: c.removed } }); changed(); } return; }
      (ink()[c.n] ||= []).push(c.s); undo.push({ page: c.n, add: c.s }); changed();
    };
    pages.addEventListener('pointerup', up); pages.addEventListener('pointercancel', up);
  }
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

// ============================================================ annotations
// Pen / highlighter marks drawn right on the PDF. They're kept for each PDF file (every tab or window
// showing that file sees them) until erased or cleared, stored as strokes in page coordinates (0–1),
// so they stay in place at any zoom, fit or layout. "Save a copy" makes a new PDF with the marks burned in.
const PDF_INK_COLORS = ['#e5484d', '#1f6feb', '#1a7f37', '#111111', '#f2c230'];
const PDF_INK_SIZES = [0.0025, 0.005, 0.009];                 // stroke width as a share of the page width
const pdfStrokeSVG = (s, W, H) => {
  const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] * W).toFixed(1)} ${(p[1] * H).toFixed(1)}`).join('') + (s.pts.length === 1 ? 'l0.01 0' : '');
  return `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${(s.w * W).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${s.t === 'hl' ? ' class="hl"' : ''}/>`;
};
function pdfStrokeCanvas(ctx, s, W, H) {
  ctx.save();
  ctx.strokeStyle = s.c; ctx.lineWidth = s.w * W; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.t === 'hl') { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; }
  ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0] * W, p[1] * H) : ctx.moveTo(p[0] * W, p[1] * H));
  if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * W + 0.01, s.pts[0][1] * H);
  ctx.stroke(); ctx.restore();
}
// distance from point p to segment ab (all in page units)
function pdfSegDist(p, a, b, ar) {
  const ax = a[0], ay = a[1] * ar, bx = b[0], by = b[1] * ar, px = p[0], py = p[1] * ar;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
// A new PDF of every page as a picture with its marks drawn on (text in it is no longer selectable).
async function pdfBurn(doc, pagesInk, onStep) {
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onStep && onStep(n, doc.numPages);
    const page = await doc.getPage(n), base = page.getViewport({ scale: 1 });
    const k = Math.min(2.5, 3000 / Math.max(base.width, base.height));     // ~180 dpi, capped for huge pages
    const vp = page.getViewport({ scale: k }), c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    for (const s of pagesInk[n] || []) pdfStrokeCanvas(ctx, s, c.width, c.height);
    const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88))).arrayBuffer());
    out.push({ w: +base.width.toFixed(2), h: +base.height.toFixed(2), pw: c.width, ph: c.height, jpg });
  }
  // a minimal PDF: one JPEG image per page, filling the page
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${out.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${out.length} >>`));
  out.forEach((p, i) => {
    const P = 3 + 3 * i, cs = `q ${p.w} 0 0 ${p.h} 0 0 cm /Im0 Do Q`;
    obj(P, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /XObject << /Im0 ${P + 2} 0 R >> >> /Contents ${P + 1} 0 R >>`));
    obj(P + 1, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(P + 2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`); push(p.jpg); push('\nendstream'); });
  });
  const xref = len, count = 3 + 3 * out.length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n` + Array.from({ length: count - 1 }, (_, i) => String(offs[i + 1]).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
// Page Up / Page Down (and most page-turn pedals) turn pages of the PDF you used last.
document.addEventListener('keydown', e => {
  if (!PDF_ACTIVE || !PDF_ACTIVE.host.isConnected || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (e.key === 'PageDown') { e.preventDefault(); PDF_ACTIVE.go(PDF_ACTIVE.st.page + 1); }
  if (e.key === 'PageUp') { e.preventDefault(); PDF_ACTIVE.go(PDF_ACTIVE.st.page - 1); }
});
window.mountPdf = mountPdf;
