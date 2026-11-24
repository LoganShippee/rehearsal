// My looks: save a class's colours + background picture under a name and reuse it on other classes.
// Saved looks live in S.savedLooks (part of the main data, so backups and Export include them).
// Loaded after app.js; app.js calls LOOKS.rowHTML(cls) inside the Look panel and the Setup Look card.
window.LOOKS = (() => {
  // everything that makes up a "look" (not the class name or its steps)
  const KEYS = ['bg', 'accent', 'text', 'titleText', 'clockText', 'image', 'dim', 'panel', 'sideLinked', 'sideFont', 'sidePanel'];
  const list = () => (S.savedLooks ||= []);
  const snap = th => { const o = {}; for (const k of KEYS) if (th[k] !== undefined && th[k] !== '') o[k] = th[k]; return o; };
  const apply = (th, look) => { for (const k of KEYS) delete th[k]; Object.assign(th, look.theme); th.image ||= ''; };
  const clsById = id => S.classes.find(c => c.id === id);
  // readable label colour for a chip, whatever the look's own colours are
  const ink = hex => { const n = parseInt(String(hex || '#000').replace('#', '').padEnd(6, '0').slice(0, 6), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150 ? '#111' : '#fff'; };

  function rowHTML(cls) {
    if (!cls) return '';
    const chips = list().map(l => {
      const t = l.theme;
      return `<span class="lk-chip" title="Use “${esc(l.name)}” on ${esc(cls.name)}">
        <button type="button" class="lk-apply" data-lk="apply" data-id="${l.id}" data-cls="${cls.id}" style="background:${esc(t.bg)};color:${ink(t.bg)}">${esc(l.name)} <i style="color:${esc(t.accent)}">●</i></button><button type="button" class="lk-all" data-lk="all" data-id="${l.id}" title="Use on all classes">All</button><button type="button" class="lk-x" data-lk="del" data-id="${l.id}" title="Delete this saved look" aria-label="Delete ${esc(l.name)}">✕</button></span>`;
    }).join('');
    return `<div class="lp-looks"><span class="lp-lbl">My looks</span>${chips}<button type="button" class="lk-save" data-lk="save" data-cls="${cls.id}">＋ Save this look</button></div>`;
  }

  // redraw whichever screen the look is being edited on
  function refresh(cls) {
    if (typeof VIEW !== 'undefined' && VIEW === 'edit') { renderEditor(); return; }
    if (cls) { applyTheme($('#present'), cls.theme); P.sideKey = P.stageKey = P.layoutKey = ''; }
    renderLook();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-lk]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const act = b.dataset.lk, look = list().find(l => l.id === b.dataset.id), cls = clsById(b.dataset.cls);
    if (act === 'save') {
      if (!cls) return;
      const name = (prompt('Name for this look (for example “Concert Choir”):', cls.name) || '').trim();
      if (!name) return;
      list().push({ id: uid(), name: name.slice(0, 40), theme: snap(cls.theme) });
      save(); refresh(cls); toast(`Saved “${name}”. Find it under My looks.`);
    } else if (act === 'apply' && look && cls) {
      apply(cls.theme, look); save(); refresh(cls);
    } else if (act === 'all' && look) {
      if (!confirm(`Use “${look.name}” on all ${S.classes.length} classes? Their colours and pictures will change.`)) return;
      for (const c of S.classes) apply(c.theme, look);
      save(); refresh(S.classes.find(c => c.id === SEL_CLASS) || S.classes[0]);
    } else if (act === 'del' && look) {
      if (!confirm(`Delete the saved look “${look.name}”? Classes already using it keep their colours.`)) return;
      S.savedLooks = list().filter(l => l !== look);
      save(); refresh(null);
    }
  }, true);

  return { rowHTML, list };
})();
