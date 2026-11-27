'use strict';
// Present screen quick-edit, tab folders, copy/paste, icons/look/auto panels, window snap & native holes (loaded after app.js).
// ============================================================ edit in place (Present screen)
// ✏ "Edit here" in the toolbar turns this on. Text commits when you click away or press Return
// (Shift+Return for a new line in the warm-up); Escape cancels.
const ieClass = () => { const c = context(now()); return c.mode === 'class' ? c : null; };
const ieFocused = sel => { const a = document.activeElement, el = $(sel); return !!(a && el && el.contains(a) && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))); };
function ieSide(ctx, step, evs) {
  const cls = ctx.cls, today = dateKey(now());
  const agenda = `<ol class="agenda editing">${cls.agenda.map((a, i) => `<li class="${i === step ? 'cur' : ''}" data-ag-row="${i}">
      <div class="ag-top"><span class="n" data-action="ag-cur" data-i="${i}" title="Make this the current step">${i + 1}</span>
      <span class="ag-text" contenteditable="true" data-ie="agenda" data-i="${i}">${esc(a.text)}</span></div>
      <div class="ag-meta"><span class="ag-grip" data-ag-drag="${i}" title="Drag to reorder">≡</span>
      <label class="ag-minw"><input class="ag-min" type="number" min="0" max="240" data-ie-min="${i}" value="${a.min || ''}" placeholder="0" title="Minutes"><span>min</span></label>
      <button class="ag-x" data-action="ag-del" data-i="${i}" title="Remove step" aria-label="Remove step">${IC('ico:close')}</button></div></li>`).join('')}</ol>
    <button class="ie-add" data-action="ag-add">${IC('ico:plus')} Add step</button>`;
  const todays = evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ` <span style="opacity:.7">${fmtHM(e.time)}</span>` : ''} <span class="ev-where">${e.classes?.length ? '· this class' : '· all classes'}</span><button class="ag-x" data-action="ie-ev-del" data-id="${e.id}" title="Remove">${IC('ico:close')}</button></li>`).join('');
  return `
    <div class="p-card ie-card"><h4>${IC('ico:quickedit')} Editing ${esc(cls.name)} <button class="ie-done" data-action="edit-mode">Done</button></h4>
      <div class="ie-btns"><button data-action="look-open">${IC('ico:look')} Look & background</button><button data-action="auto-open">${IC('ico:auto')} Automations</button><button data-action="clip-open">${IC('ico:clip')} Copy / paste</button><button data-action="icons-open">${IC('ico:icons')} Icons</button>${ctx.cls.hideWarmup ? `<button data-action="warmup-show">${IC('ico:warmup')} Show warm-up tab</button>` : ''}</div>
      <div class="ie-tip">Click any text to change it.</div></div>
    <div class="p-card"><h4>Agenda <span class="mini-btns"><button data-action="agenda-prev">‹</button><button data-action="agenda-next">›</button></span></h4>${agenda}</div>
    <div class="p-card"><h4>Today</h4><ul class="ev-list">${todays || '<li style="opacity:.6">Nothing today.</li>'}</ul>
      <div class="ie-ev"><select data-ie-evkind><option value="announcement">Announcement</option><option value="birthday">Birthday</option><option value="event">Event</option></select>
        <input data-ie-evtext placeholder="Announcement or name…"><input type="time" data-ie-evtime title="Pop up at (optional)">
        <select data-ie-evwho title="Which classes see it"><option value="this">This class</option><option value="all">All classes</option></select>
        ${repeatSel({}, 'data-ie-evrep')}
        <button data-action="ie-ev-add">Add</button></div></div>
    <div class="p-card"><h4>${IC('ico:notes')} Notes on screen <span style="opacity:.6;text-transform:none;letter-spacing:0">(students see these)</span></h4>
      <textarea class="ie-notes" data-ie-pubnotes rows="3" placeholder="Reminders for students: bring your folder, concert dress, …">${esc((cls.screenNotes || {})[today] || (cls.screenNotes || {})._sticky || '')}</textarea>
      <label class="chk small" style="margin-top:6px"><input type="checkbox" data-action-change="ie-sticky-note" ${cls.screenNotes?._sticky != null ? 'checked' : ''}> Keep showing until cleared (don't hide tomorrow)</label></div>
    <div class="p-card"><h4>${IC('ico:notes')} Private teacher notes <span class="mini-btns"><button type="button" data-action="ie-priv-toggle">${P.showPrivNotes ? 'Hide' : 'Show'}</button></span></h4>
      ${P.showPrivNotes
        ? `<textarea class="ie-notes" data-ie-notes rows="5" placeholder="What you covered, reminders for next time…">${esc(cls.notes[today] || '')}</textarea>`
        : `<div class="ie-tip" style="opacity:.75">Hidden so private notes don't appear on a projector. Click <b>Show</b> (or edit in Setup → Notes).</div>`}</div>`;
}
function ieTitle(ctx, tmplName, testChip) {
  const cls = ctx.cls, p = ctx.period;
  return `<div class="t1" contenteditable="true" data-ie="name">${esc(cls.name)}</div>
    <div class="t2"><span contenteditable="true" data-ie="subtitle" class="ie-sub" data-ph="Subtitle (period, room…)">${esc(cls.subtitle || '')}</span>
      ${testChip}
      ${p ? `<span class="ie-times" title="Changes this period on the ${tmplName} bell schedule"><input type="time" data-ie-time="start" value="${p.start}"> – <input type="time" data-ie-time="end" value="${p.end}"></span>` : ''}</div>`;
}
// events: how often they repeat (Setup → Events)
document.addEventListener('change', e => {
  const id = e.target.dataset?.evRepeat; if (!id) return;
  const ev = S.events.find(x => x.id === id); if (!ev) return;
  ev.repeat = e.target.value; ev.yearly = ev.repeat === 'yearly'; save(); P.sideKey = ''; renderEditor();
});
// events: which classes see them
document.addEventListener('change', e => {
  const el = e.target, id = el.dataset?.evCls || el.dataset?.evAll; if (!id) return;
  const ev = S.events.find(x => x.id === id); if (!ev) return;
  if (el.dataset.evAll) { if (el.checked) ev.classes = []; }
  else { const set = new Set(ev.classes || []); el.checked ? set.add(el.dataset.c) : set.delete(el.dataset.c); ev.classes = [...set]; }
  const box = el.closest('details'); save();
  box.querySelector('summary').textContent = evWhere(ev);
  box.querySelector('[data-ev-all]').checked = !ev.classes.length;
  if (!ev.classes.length) box.querySelectorAll('[data-ev-cls]').forEach(x => x.checked = false);
});
// ---------- double-click an agenda step (any time) to change its text
document.addEventListener('dblclick', e => {
  if (VIEW !== 'present' || P.editMode) return;
  const li = e.target.closest('#p-side ol.agenda:not(.editing) > li'); if (!li) return;
  const c = ieClass(); if (!c) return;
  const i = [...li.parentElement.children].indexOf(li), step = c.cls.agenda[i]; if (!step) return;
  const span = li.querySelector('span:not(.n):not(.m)'); if (!span) return;
  const before = step.text;
  span.contentEditable = 'true'; span.classList.add('ag-live'); span.focus();
  const r = document.createRange(); r.selectNodeContents(span); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const done = keep => {
    span.removeEventListener('keydown', key); span.removeEventListener('blur', blur);
    const t = span.textContent.trim();
    if (keep && t && t !== before) { step.text = t; save(); }
    span.contentEditable = 'false'; P.sideKey = '';
  };
  const key = ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); span.blur(); }
    if (ev.key === 'Escape') { ev.preventDefault(); span.textContent = before; done(false); span.blur(); }
  };
  const blur = () => done(true);
  span.addEventListener('keydown', key); span.addEventListener('blur', blur);
});
// ---------- commit edits
document.addEventListener('focusout', e => {
  const el = e.target; if (!el.dataset || !el.dataset.ie || VIEW !== 'present') return;
  const c = ieClass(); if (!c) return;
  const cls = c.cls, v = el.innerText.replace(/\u00a0/g, ' ').trim();
  if (el.dataset.ie === 'name') { if (v) cls.name = v; }
  else if (el.dataset.ie === 'subtitle') cls.subtitle = v;
  else if (el.dataset.ie === 'warmup') cls.warmup = el.innerText.trim();
  else if (el.dataset.ie === 'agenda') { const a = cls.agenda[+el.dataset.i]; if (a) a.text = v || a.text; }
  save(); P.sideKey = P.stageKey = ''; $('#p-title') && ($('#p-title')._h = '');
});
document.addEventListener('keydown', e => {
  const el = e.target; if (!el.dataset?.ie) return;
  if (e.key === 'Enter' && !(e.shiftKey && el.dataset.ie === 'warmup')) { e.preventDefault(); el.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); P.sideKey = P.stageKey = ''; $('#p-title')._h = ''; el.dataset.ie = ''; el.blur(); }
});
document.addEventListener('change', e => {
  const el = e.target, c = ieClass(); if (!c || VIEW !== 'present') return;
  if (el.dataset.ieMin != null) { const a = c.cls.agenda[+el.dataset.ieMin]; if (a) { a.min = Number(el.value) || 0; save(); P.sideKey = ''; } }
  if (el.dataset.ieTime && c.period && c.template) {
    const p = c.template.periods.find(x => x.id === c.period.id); if (!p || !el.value) return;
    const next = { ...p, [el.dataset.ieTime]: el.value };
    if (next.start >= next.end) { toast('The end time has to be after the start.'); P.sideKey = ''; $('#p-title')._h = ''; return; }
    Object.assign(p, next); save(); $('#p-title')._h = ''; toast(`Updated ${c.template.name}: ${fmtHM(p.start)}–${fmtHM(p.end)}`);
  }
});
let ieNotesT = null;
let iePubT = null;
document.addEventListener('input', e => {
  if (e.target.dataset?.iePubnotes == null) return;
  const c = ieClass(); if (!c) return;
  const k = dateKey(now()), v = e.target.value;
  clearTimeout(iePubT); iePubT = setTimeout(() => { const n = (c.cls.screenNotes ||= {}); if (v.trim()) { n[k] = v; if (n._sticky != null) n._sticky = v; } else { delete n[k]; if (n._sticky != null) n._sticky = ''; } save(); }, 400);
});
document.addEventListener('input', e => {
  if (e.target.dataset?.ieNotes == null) return;
  const c = ieClass(); if (!c) return;
  const k = dateKey(now()), v = e.target.value;
  clearTimeout(ieNotesT); ieNotesT = setTimeout(() => { if (v.trim()) c.cls.notes[k] = v; else delete c.cls.notes[k]; save(); }, 400);
});
// ---------- drag agenda rows to reorder
let AGDRAG = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-ag-drag]'); if (!h || VIEW !== 'present') return;
  e.preventDefault();
  document.activeElement?.blur?.();   // finish any typing first so the list can refresh
  AGDRAG = { from: +h.dataset.agDrag, to: +h.dataset.agDrag, row: h.closest('li') };
  AGDRAG.row.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!AGDRAG) return;
  const rows = $$('[data-ag-row]');
  let to = rows.findIndex(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
  if (to < 0) to = rows.length - 1; else if (to > AGDRAG.from) to--;
  AGDRAG.to = to;
  rows.forEach((r, i) => r.classList.toggle('drop-before', i === (to >= AGDRAG.from ? to + 1 : to) && i !== AGDRAG.from));
});
document.addEventListener('pointerup', () => {
  if (!AGDRAG) return;
  const { from, to } = AGDRAG; AGDRAG = null;
  const c = ieClass();
  if (c && from !== to) { const a = c.cls.agenda; const [m] = a.splice(from, 1); a.splice(to, 0, m); save(); }
  P.sideKey = '';
});
// ---------- tab folders: a folder is one tab with a drop-down of its tabs
function stageTabsHTML(cls, res) {
  const out = [], seen = new Set(), groups = cls.groups || [];
  for (const r of cls.resources) {
    const g = r.group && groups.find(x => x.id === r.group);
    if (!g) {
      out.push(`<span class="tabwrap" draggable="true" data-tab-id="${r.id}"><button class="${res === r ? 'on' : ''}" data-action="stage" data-id="${r.id}" title="Double-click to rename · drag onto another tab to make a folder">${tabIcon(r)}${esc(r.title || 'Resource')}</button><button class="tab-x" data-action="res-remove" data-id="${r.id}" title="Remove from this class">${IC('ico:close')}</button></span>`);
      continue;
    }
    if (seen.has(g.id)) continue; seen.add(g.id);
    const cur = cls.resources.find(x => x.group === g.id && x === res);
    out.push(`<span class="tabwrap tabgroup" draggable="true" data-group-id="${g.id}"><button class="${cur ? 'on' : ''} ${P.groupMenu === g.id ? 'open' : ''}" data-action="tab-group" data-id="${g.id}" title="Folder — click to choose a tab · double-click to rename">${iconOn('tabs') ? icoSp(g.icon || 'ico:folder') : ''}${esc(g.name)}${cur ? `<span class="tg-cur"> · ${esc(cur.title || '')}</span>` : ''} <span class="tg-caret">▾</span></button></span>`);
  }
  return out.join('');
}
function renderGroupMenu() {
  $('#group-menu')?.remove();
  const c = ieClass(); if (!P.groupMenu || !c) return;
  const cls = c.cls, g = (cls.groups || []).find(x => x.id === P.groupMenu); if (!g) { P.groupMenu = null; return; }
  const btn = $(`.stage-tabs [data-action="tab-group"][data-id="${g.id}"]`); if (!btn) return;
  const sel = P.stageSel[c.key];
  const m = document.createElement('div'); m.id = 'group-menu'; m.className = 'group-menu';
  m.innerHTML = cls.resources.filter(r => r.group === g.id).map(r => `<div class="gm-row ${sel === r.id ? 'on' : ''}">
      <button class="gm-open" data-action="stage" data-id="${r.id}">${tabIcon(r)}${esc(r.title || 'Tab')}</button>
      <button class="gm-x" data-action="group-out" data-id="${r.id}" title="Take out of the folder">${IC('ico:out')}</button></div>`).join('')
    + `<hr><button class="gm-act" data-action="group-rename" data-id="${g.id}">${IC('ico:annotate')} Rename folder</button><button class="gm-act" data-action="group-dissolve" data-id="${g.id}">${IC('ico:folderOpen')} Unfold (keep the tabs)</button>`;
  $('#present').appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.left = clamp(r.left, 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = r.bottom + 6 + 'px';
}
document.addEventListener('pointerdown', e => {
  if (P.groupMenu && !e.target.closest?.('#group-menu, [data-action="tab-group"]')) { P.groupMenu = null; renderGroupMenu(); P.stageKey = ''; }
}, true);
function tidyGroups(cls) {
  cls.groups = (cls.groups || []).filter(g => cls.resources.filter(r => r.group === g.id).length >= 1);
  for (const r of cls.resources) if (r.group && !cls.groups.some(g => g.id === r.group)) delete r.group;
}
// ---------- drag class tabs: onto the middle of a tab = make a folder, onto a folder = put it in, near an edge = reorder
document.addEventListener('dragstart', e => {
  const t = e.target.closest?.('.stage-tabs .tabwrap[draggable="true"]'); if (!t) return;
  e.dataTransfer.setData('text/plain', t.dataset.tabId || 'g:' + t.dataset.groupId); e.dataTransfer.effectAllowed = 'move'; t.classList.add('dragging');
});
document.addEventListener('dragover', e => {
  const t = e.target.closest?.('.stage-tabs .tabwrap'); if (!t) return;
  e.preventDefault();
  const r = t.getBoundingClientRect(), mid = Math.abs(e.clientX - (r.left + r.width / 2)) < r.width * 0.28;
  $$('.stage-tabs .tabwrap.drop-in').forEach(x => x !== t && x.classList.remove('drop-in'));
  t.classList.toggle('drop-in', mid || !!t.dataset.groupId);
});
document.addEventListener('dragleave', e => { const t = e.target.closest?.('.stage-tabs .tabwrap'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-in'); });
document.addEventListener('drop', e => {
  const t = e.target.closest?.('.stage-tabs .tabwrap'); if (!t) return;
  e.preventDefault(); t.classList.remove('drop-in');
  const c = ieClass(); if (!c) return;
  const cls = c.cls, list = cls.resources, id = e.dataTransfer.getData('text/plain');
  const rect = t.getBoundingClientRect(), mid = Math.abs(e.clientX - (rect.left + rect.width / 2)) < rect.width * 0.28;
  const moveAfter = (items, anchorIdx) => { for (const it of items) list.splice(list.indexOf(it), 1); const at = Math.min(list.length, anchorIdx); list.splice(at, 0, ...items); };
  if (id.startsWith('g:')) {                                          // moving a whole folder
    const items = list.filter(r => r.group === id.slice(2)); if (!items.length) return;
    const targetFirst = t.dataset.groupId ? list.find(r => r.group === t.dataset.groupId) : list.find(r => r.id === t.dataset.tabId);
    if (!targetFirst || items.includes(targetFirst)) return;
    for (const it of items) list.splice(list.indexOf(it), 1);
    list.splice(list.indexOf(targetFirst), 0, ...items);
  } else {
    const r = list.find(x => x.id === id); if (!r) return;
    if (t.dataset.groupId) {                                          // into a folder
      r.group = t.dataset.groupId;
      const last = list.filter(x => x.group === r.group && x !== r).pop();
      list.splice(list.indexOf(r), 1); list.splice(last ? list.indexOf(last) + 1 : list.length, 0, r);
    } else {
      const target = list.find(x => x.id === t.dataset.tabId); if (!target || target === r) return;
      if (mid) {                                                      // onto a tab: make (or join) a folder
        let gid = target.group;
        if (!gid) {
          gid = uid();
          const k1 = resKind(target), k2 = resKind(r);
          const NAMES = { pdf: 'PDFs', youtube: 'Videos', video: 'Videos', image: 'Pictures', web: 'Links', score: 'Scores', sight: 'Sight reading', slides: 'Slides', doc: 'Docs', sheet: 'Sheets' };
          (cls.groups ||= []).push({ id: gid, name: k1 === k2 && NAMES[k1] ? NAMES[k1] : 'Folder' });
          target.group = gid;
        }
        r.group = gid;
        list.splice(list.indexOf(r), 1); list.splice(list.indexOf(target) + 1, 0, r);
      } else {                                                        // near an edge: just reorder (and leave a folder)
        delete r.group;
        list.splice(list.indexOf(r), 1); list.splice(list.indexOf(target) + (e.clientX > rect.left + rect.width / 2 ? 1 : 0), 0, r);
      }
    }
  }
  tidyGroups(cls); save(); P.stageKey = '';
});
document.addEventListener('dragend', () => $$('.tabwrap.dragging').forEach(x => x.classList.remove('dragging')));
// Double-click a pinned tab, or a window's title, to rename it right there (Enter saves, Esc cancels).
function renameInline(anchor, current, commit) {
  const r = anchor.getBoundingClientRect(), inp = document.createElement('input');
  inp.className = 'rename-inline'; inp.value = current;
  Object.assign(inp.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(140, r.width + 40) + 'px', height: r.height + 'px' });
  document.body.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = keep => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (keep && v && v !== current) commit(v); };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
document.addEventListener('dblclick', e => {
  if (VIEW !== 'present') return;
  const gb = e.target.closest('.stage-tabs [data-action="tab-group"]');
  if (gb) {
    const c = ieClass(), g = (c?.cls.groups || []).find(x => x.id === gb.dataset.id); if (!g) return;
    e.preventDefault(); P.groupMenu = null; renderGroupMenu();
    renameInline(gb, g.name, v => { g.name = v; save(); P.stageKey = ''; });
    return;
  }
  const b = e.target.closest('.stage-tabs [data-action="stage"]');
  if (b && b.dataset.id !== 'warmup') {
    const c = ieClass(), r = c?.cls.resources.find(x => x.id === b.dataset.id); if (!r) return;
    e.preventDefault();
    renameInline(b, r.title || '', v => { r.title = v; save(); P.stageKey = ''; WIN.sig = ''; });
    return;
  }
  const t = e.target.closest('.win-bar .win-title'); if (!t) return;
  const w = findWin(t.closest('.win')?.dataset.win); if (!w) return;
  e.preventDefault(); e.stopPropagation();
  const r = winRes(w);
  renameInline(t, winTitle(w), v => { if (r) { r.title = v; P.stageKey = ''; } else w.customTitle = v; save(); WIN.sig = ''; });
}, true);
// ---------- copy / paste class items between classes: pinned tabs (with their folders), agenda, warm-up,
// look, Progress tracker, notes on screen, automations and side panel settings. Lists can be added to or replace
// what the class already has.
const clipClass = () => VIEW === 'present' ? ieClass()?.cls : selClass();
// the things that can be copied, besides tabs; `list` ones can be added to the end or replace what's there
const CLIP_KINDS = [
  { k: 'agenda', label: 'Agenda', ico: 'ico:agenda', list: true, has: c => c.agenda.length, n: c => c.agenda.length, unit: 'step' },
  { k: 'warmup', label: 'Warm-up question', ico: 'ico:warmup', has: c => !!c.warmup },
  { k: 'progress', label: 'Progress tracker', ico: 'ico:check', list: true, has: c => (c.progress || []).length, n: c => (c.progress || []).length, unit: 'piece' },
  { k: 'screenNotes', label: 'Notes on screen', ico: 'ico:notes', list: true, has: c => Object.values(c.screenNotes || {}).some(v => v && v.trim()), n: c => Object.values(c.screenNotes || {}).filter(v => v && v.trim()).length, unit: 'day' },
  { k: 'automations', label: 'Automations', ico: 'ico:auto', list: true, has: c => (c.automations || []).length, n: c => (c.automations || []).length, unit: 'automation' },
  { k: 'side', label: 'Side panel settings (width, progress in side panel)', ico: 'ico:agenda', has: () => true },
  { k: 'look', label: 'Look (theme, colours, picture)', ico: 'ico:look', has: () => true },
];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function clipSel(cls) {
  if (!P.clipSel || P.clipSel.cls !== cls.id) {
    P.clipSel = { cls: cls.id, tabs: new Set(cls.resources.map(r => r.id)) };
    for (const d of CLIP_KINDS) P.clipSel[d.k] = d.k !== 'look' && d.k !== 'side' && !!d.has(cls);
  }
  return P.clipSel;
}
function clipSummary(c) {
  const p = [];
  if (c.tabs?.length) p.push(plural(c.tabs.length, 'tab'));
  if (c.agenda) p.push(`agenda (${plural(c.agenda.length, 'step')})`);
  if (c.warmup != null) p.push('warm-up');
  if (c.progress) p.push(`progress (${plural(c.progress.items.length, 'piece')})`);
  if (c.screenNotes) p.push(`notes on screen (${plural(Object.keys(c.screenNotes).length, 'day')})`);
  if (c.automations) p.push(plural(c.automations.length, 'automation'));
  if (c.side) p.push('side panel settings');
  if (c.theme) p.push('look');
  return p.join(', ');
}
// what the copied item conflicts with in this class (shown as Add / Replace choices)
function clipConflicts(cls, c) {
  const out = [];
  if (c.tabs?.length && cls.resources.length) out.push({ k: 'tabs', label: 'Pinned tabs', have: plural(cls.resources.length, 'tab') });
  if (c.agenda && cls.agenda.length) out.push({ k: 'agenda', label: 'Agenda', have: plural(cls.agenda.length, 'step') });
  if (c.progress && (cls.progress || []).length) out.push({ k: 'progress', label: 'Progress tracker', have: plural(cls.progress.length, 'piece') });
  if (c.screenNotes && Object.values(cls.screenNotes || {}).some(v => v && v.trim())) out.push({ k: 'screenNotes', label: 'Notes on screen', have: 'some days', addLabel: 'Keep both (copied days win)' });
  if (c.automations && (cls.automations || []).length) out.push({ k: 'automations', label: 'Automations', have: plural(cls.automations.length, 'automation') });
  return out;
}
function renderClip() {
  $('#clip-panel')?.remove();
  if (!P.clipOpen) return;
  const cls = clipClass(); P.clipFor = cls?.id || null;
  const p = document.createElement('div'); p.id = 'clip-panel'; p.className = 'look-panel clip-panel';
  if (!cls) {
    p.innerHTML = `<div class="dc-head"><b>${IC('ico:clip')} Copy / paste</b><span class="grow"></span><button class="iconbtn pop-x" data-action="clip-open" title="Close" aria-label="Close">${IC('ico:close')}</button></div><div class="dc-note">Show a class first (Class picker in the toolbar), then copy or paste its items.</div>`;
    document.body.appendChild(p); return;
  }
  const s = clipSel(cls), C = S.clip;
  const chk = (k, label, on, extra = '') => `<label class="cp-item"><input type="checkbox" data-clip="${k}" ${extra} ${on ? 'checked' : ''}> ${label}</label>`;
  const modes = (P.clipMode ||= {});
  const conf = C ? clipConflicts(cls, C) : [];
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:clip')} Copy / paste — ${esc(cls.name)}</b><span class="grow"></span><button class="iconbtn pop-x" data-action="clip-open" title="Close" aria-label="Close">${IC('ico:close')}</button></div>
    <div class="cp-h">Copy from this class</div>
    <div class="cp-list">
      ${cls.resources.map(r => chk('tab', `${icoSp(resIcon(r))}${esc(r.title || 'Tab')}`, s.tabs.has(r.id), `data-id="${r.id}"`)).join('') || '<div class="dc-note">No pinned tabs.</div>'}
      ${CLIP_KINDS.map(d => chk(d.k, `${IC(d.ico)} ${d.label}${d.n ? ` <span class="muted">(${plural(d.n(cls), d.unit)})</span>` : ''}`, s[d.k], d.has(cls) ? '' : 'disabled')).join('')}
    </div>
    <div class="lp-row"><button data-action="clip-all">Select all</button><button data-action="clip-none">None</button><span class="grow"></span><button class="cp-go" data-action="clip-copy">${IC('ico:clip')} Copy</button></div>
    <div class="cp-h">Paste into this class</div>
    ${C ? `<div class="dc-note">Copied from <b>${esc(C.from)}</b>: ${esc(clipSummary(C)) || 'nothing'}.${C.theme ? ' The look replaces this class’s look.' : ''}${C.warmup != null ? ' The warm-up replaces this class’s warm-up.' : ''}${C.side ? ' Side panel settings replace this class’s.' : ''}</div>
      ${conf.length ? `<div class="cp-modes">${conf.map(x => `<div class="cp-mode"><span><b>${x.label}</b> <span class="muted">(this class has ${x.have})</span></span>
        <label><input type="radio" name="cpm-${x.k}" data-clip-mode="${x.k}" value="add" ${modes[x.k] !== 'replace' ? 'checked' : ''}> ${x.addLabel || 'Add to the end'}</label>
        <label><input type="radio" name="cpm-${x.k}" data-clip-mode="${x.k}" value="replace" ${modes[x.k] === 'replace' ? 'checked' : ''}> Replace</label></div>`).join('')}</div>` : ''}
      <div class="lp-row"><button class="cp-go" data-action="clip-paste">${IC('ico:clip')} Paste</button></div>`
      : `<div class="dc-note">Nothing copied yet. Tick what you want above and press Copy, then switch to another class and paste.</div>`}`;
  document.body.appendChild(p);
  p.addEventListener('change', e => {
    const m = e.target.dataset.clipMode; if (m) { modes[m] = e.target.value; return; }
    const k = e.target.dataset.clip; if (!k) return;
    if (k === 'tab') e.target.checked ? s.tabs.add(e.target.dataset.id) : s.tabs.delete(e.target.dataset.id);
    else s[k] = e.target.checked;
  });
}
function clipSelectAll(on) {
  const c = clipClass(); if (!c) return;
  P.clipSel = { cls: c.id, tabs: new Set(on ? c.resources.map(r => r.id) : []) };
  for (const d of CLIP_KINDS) P.clipSel[d.k] = on && !!d.has(c);
  renderClip();
}
function clipCopy() {
  const cls = clipClass(); if (!cls) return;
  const s = clipSel(cls), clone = o => JSON.parse(JSON.stringify(o));
  const tabs = cls.resources.filter(r => s.tabs.has(r.id)).map(clone);
  const gids = new Set(tabs.map(r => r.group).filter(Boolean));
  const notes = Object.fromEntries(Object.entries(cls.screenNotes || {}).filter(([, v]) => v && v.trim()));
  const c = {
    from: cls.name,
    tabs, groups: (cls.groups || []).filter(g => gids.has(g.id)).map(clone),
    agenda: s.agenda && cls.agenda.length ? clone(cls.agenda) : null,
    warmup: s.warmup && cls.warmup ? cls.warmup : null,
    progress: s.progress && (cls.progress || []).length ? { items: clone(cls.progress), labels: cls.progLabels ? clone(cls.progLabels) : null } : null,
    screenNotes: s.screenNotes && Object.keys(notes).length ? notes : null,
    automations: s.automations && (cls.automations || []).length ? clone(cls.automations) : null,
    side: s.side ? { layout: cls.layout ? clone(cls.layout) : null, sideProgress: !!cls.sideProgress, sideProgOpen: !!cls.sideProgOpen } : null,
    theme: s.look ? clone(cls.theme) : null,
  };
  if (!clipSummary(c)) return toast('Tick at least one thing to copy.');
  S.clip = c; P.clipMode = {}; save(); renderClip();
  toast(`Copied ${clipSummary(c)} from ${cls.name}. Switch class and press Paste.`, 3500);
}
function clipPaste() {
  const cls = clipClass(), c = S.clip; if (!cls || !c) return;
  const clone = o => JSON.parse(JSON.stringify(o)), mode = k => (P.clipMode || {})[k] === 'replace' ? 'replace' : 'add';
  const resMap = {};
  if (c.tabs?.length) {
    // folders come along with their tabs (matched by name if this class already has one)
    const gmap = {};
    if (mode('tabs') === 'replace') { cls.resources = []; cls.groups = []; }
    for (const g of c.groups || []) {
      const have = (cls.groups ||= []).find(x => x.name === g.name);
      if (have) gmap[g.id] = have.id; else { const n = { ...clone(g), id: uid() }; cls.groups.push(n); gmap[g.id] = n.id; }
    }
    for (const r of c.tabs) {
      const n = { ...clone(r), id: uid() }; resMap[r.id] = n.id;
      if (n.group) { if (gmap[n.group]) n.group = gmap[n.group]; else delete n.group; }
      cls.resources.push(n);
    }
  }
  if (c.agenda) { const steps = clone(c.agenda).map(a => (a.id ? { ...a, id: uid() } : a)); cls.agenda = mode('agenda') === 'replace' ? steps : cls.agenda.concat(steps); }
  if (c.warmup != null) cls.warmup = c.warmup;
  if (c.progress) {
    const items = clone(c.progress.items).map(it => ({ ...it, id: uid(), steps: (it.steps || []).map(st => ({ ...st, id: uid() })) }));
    cls.progress = mode('progress') === 'replace' ? items : (cls.progress || []).concat(items);
    if (c.progress.labels) cls.progLabels = clone(c.progress.labels);
  }
  if (c.screenNotes) cls.screenNotes = mode('screenNotes') === 'replace' ? clone(c.screenNotes) : { ...(cls.screenNotes || {}), ...clone(c.screenNotes) };
  if (c.automations) {
    const autos = clone(c.automations).map(a => {
      const n = { ...a, id: uid() };
      if (n.resourceId) n.resourceId = resMap[n.resourceId] || (cls.resources.some(r => r.id === n.resourceId) ? n.resourceId : '');
      return n;
    });
    cls.automations = mode('automations') === 'replace' ? autos : (cls.automations || []).concat(autos);
  }
  if (c.side) {
    if (c.side.layout) cls.layout = clone(c.side.layout); else delete cls.layout;
    cls.sideProgress = c.side.sideProgress; cls.sideProgOpen = c.side.sideProgOpen;
  }
  if (c.theme) cls.theme = clone(c.theme);
  save(); P.stageKey = P.sideKey = P.layoutKey = ''; WIN.sig = '';
  if (VIEW !== 'present') renderEditor(); else applySide(cls);
  renderClip(); toast(`Pasted ${clipSummary(c)} into ${cls.name}.`, 3000);
}
// ---------- icons panel: which emojis show, and which ones
function renderIcons() {
  $('#icons-panel')?.remove();
  if (!P.iconsOpen) return;
  const ic = icoCfg(), cls = VIEW === 'present' ? ieClass()?.cls : selClass();
  const emojiHint = IS_MAC_OS ? '⌃⌘Space' : 'Win + .';
  const inp = (path, val, def) => `<input class="ic-in" data-ic="${path}" value="${esc(val ?? '')}" placeholder="${esc(ICL(def))}" maxlength="8" title="Type or pick an emoji (${emojiHint}). Leave empty for the default; type - for none.">`;
  const KN = { slides: 'Google Slides', doc: 'Google Doc', sheet: 'Google Sheet', form: 'Google Form', drive: 'Drive file', youtube: 'YouTube', canva: 'Canva', web: 'Web page', pdf: 'PDF', image: 'Picture', video: 'Video', audio: 'Audio', file: 'Other file', sight: 'Sight reading', score: 'Score', warmup: 'Warm-up' };
  const sw = (k, l) => `<label><input type="checkbox" data-icshow="${k}" ${iconOn(k) ? 'checked' : ''}> ${l}</label>`;
  const p = document.createElement('div'); p.id = 'icons-panel'; p.className = 'look-panel icons-panel';
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:icons')} Icons</b><span class="grow"></span><button data-action="icons-reset">Reset all</button><button class="iconbtn pop-x" data-action="icons-open" title="Close" aria-label="Close">${IC('ico:close')}</button></div>
    <div class="ic-sw"><b>Show emojis on</b> ${sw('tabs', 'Tabs')} ${sw('dock', 'Toolbar')} ${sw('win', 'Window titles')} ${sw('events', 'Announcements')}</div>
    <div class="dc-note">Click a box and type or pick an emoji (${emojiHint}). Empty = the default shown in grey; type <b>-</b> for no icon.</div>
    <div class="ic-grid">
      ${cls && cls.resources.length ? `<div><h5>${esc(cls.name)}'s tabs</h5>${cls.resources.map(r => `<label>${inp('res.' + r.id, r.icon, kindIcon(resKind(r)))} ${esc(r.title || 'Tab')}</label>`).join('')}</div>` : ''}
      <div><h5>Tab types</h5>${Object.entries(KN).map(([k, l]) => `<label>${inp('kind.' + k, ic.kind?.[k], k === 'warmup' ? 'ico:warmup' : KIND_ICON[k])} ${l}</label>`).join('')}</div>
      <div><h5>Toolbar</h5>${Object.entries(DOCK_ITEMS).filter(([, it]) => !it.sep).map(([id, it]) => `<label>${inp('dock.' + id, ic.dock?.[id], it.icon)} ${esc(it.label)}</label>`).join('')}</div>
      <div><h5>Announcements</h5>${Object.entries({ announcement: 'Announcement', birthday: 'Birthday', event: 'Event' }).map(([k, l]) => `<label>${inp('event.' + k, ic.event?.[k], EVENT_ICON[k])} ${l}</label>`).join('')}</div>
    </div>`;
  (VIEW === 'present' ? $('#present') : document.body).appendChild(p);
  const apply = () => { save(); P.stageKey = ''; P.sideKey = ''; WIN.sig = ''; if (VIEW === 'present') { renderDock(); renderWins(context(now()), true); } else renderEditor(); };
  p.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.icshow) { (ic.show ||= {})[el.dataset.icshow] = el.checked; apply(); return; }
    const path = el.dataset.ic; if (!path) return;
    const [grp, key] = path.split('.'), v = el.value.trim();
    if (grp === 'res') { const r = findRes(key); if (r) { if (v) r.icon = v; else delete r.icon; } }
    else { const g = (ic[grp] ||= {}); if (v) g[key] = v; else delete g[key]; }
    apply();
  });
}
// ---------- look & background panel
function renderLook() {
  $('#look-panel')?.remove();
  const c = ieClass(); if (!P.lookOpen || !c) return;
  const th = c.cls.theme, img = th.image ? (th.image.startsWith('file:') ? S.files[th.image.slice(5)]?.name || 'picture' : th.image.startsWith('bg:') ? '' : 'web picture') : '';
  const p = document.createElement('div'); p.id = 'look-panel'; p.className = 'look-panel';
  p.innerHTML = `<div class="dc-head"><b>${IC('ico:look')} Look — ${esc(c.cls.name)}</b><span class="grow"></span><button class="iconbtn pop-x" data-action="look-open" title="Close" aria-label="Close">${IC('ico:close')}</button></div>
    <div class="lp-themes">${THEMES.map((t, k) => `<button class="lp-theme ${t.bg === th.bg && t.accent === th.accent ? 'on' : ''}" style="background:${t.bg};color:${t.text}" data-action="look-theme" data-k="${k}">${t.name} <span style="color:${t.accent}">●</span></button>`).join('')}</div>
    ${window.LOOKS?.rowHTML(c.cls) || ''}
    <div class="lp-row"><label>Background <input type="color" data-look="bg" value="${th.bg}"></label><label>Accent <input type="color" data-look="accent" value="${th.accent}"></label><label>Text <input type="color" data-look="text" value="${th.text || '#ffffff'}"></label></div>
    <div class="lp-row"><label>Class title <input type="color" data-look="titleText" value="${th.titleText || th.text || '#ffffff'}"></label><label>Clock <input type="color" data-look="clockText" value="${th.clockText || th.text || '#ffffff'}"></label>${th.titleText || th.clockText ? `<button type="button" data-action="look-text-reset">Match text</button>` : ''}</div>
    <div class="lp-row"><button data-action="look-pic">${IC('ico:image')} ${img ? 'Change picture…' : 'Use a picture…'}</button>${img || th.image?.startsWith('bg:') ? `<button data-action="look-pic-clear">Remove picture</button>` : ''}</div>
    <div class="lp-row lp-bgs"><span class="lp-lbl">Rehearsal backgrounds</span>${BACKGROUNDS.map(([k, n]) => `<button type="button" class="lp-bg ${th.image === 'bg:' + k ? 'on' : ''}" data-action="look-bg" data-bg="${k}" title="${n}" aria-label="${n}" style="background-image:url(backgrounds/${k}.svg)"></button>`).join('')}</div>
    <label class="lp-dim">Dim background <input type="range" min="0" max="0.85" step="0.05" data-look="dim" value="${th.dim ?? 0.25}"><span>${Math.round((th.dim ?? 0.25) * 100)}%</span></label>
    <label class="lp-dim" data-for="panel">Panel background <input type="range" min="0" max="1" step="0.05" data-look="panel" value="${th.panel ?? 0.1}"><span>${Math.round((th.panel ?? 0.1) * 100)}%</span></label>
    <label class="chk lp-link"><input type="checkbox" data-look-link ${th.sideLinked !== false ? 'checked' : ''}> Side panel matches the other panels</label>
    ${th.sideLinked === false ? `<label class="lp-dim">Side panel text size <input type="range" min="0.6" max="2" step="0.05" data-look="sideFont" value="${th.sideFont ?? 1}"><span>${Math.round((th.sideFont ?? 1) * 100)}%</span></label>
    <label class="lp-dim">Side panel background <input type="range" min="0" max="1" step="0.05" data-look="sidePanel" value="${th.sidePanel ?? th.panel ?? 0.1}"><span>${Math.round((th.sidePanel ?? th.panel ?? 0.1) * 100)}%</span></label>` : ''}
    <div class="dc-note">Dimming darkens the picture; a more solid panel background makes the agenda, Today panel and tabs easier to read over a busy picture. Untick “Side panel matches” to give the side panel its own text size and background.</div>`;
  $('#present').appendChild(p);
  const host = p;
  const NUM = ['dim', 'panel', 'sideFont', 'sidePanel'];
  host.addEventListener('input', e => {
    const k = e.target.dataset.look; if (!k) return;
    th[k] = NUM.includes(k) ? Number(e.target.value) : e.target.value;
    if (NUM.includes(k)) e.target.nextElementSibling.textContent = Math.round(th[k] * 100) + '%';
    applyTheme($('#present'), th);
    save();
  });
  host.addEventListener('change', e => {
    if (!e.target.matches('[data-look-link]')) return;
    if (e.target.checked) delete th.sideLinked;
    else { th.sideLinked = false; th.sideFont ??= 1; th.sidePanel ??= th.panel ?? 0.1; }
    save(); renderLook();
  });
}
// ---------- automations drawer (reuses the Edit screen's timeline)
function renderAutoDrawer() {
  $('#auto-drawer')?.remove();
  const c = ieClass(); if (!P.autoDrawer || !c) return;
  const ci = S.classes.indexOf(c.cls); SEL_CLASS = c.cls.id;
  const d = document.createElement('div'); d.id = 'auto-drawer'; d.className = 'auto-drawer';
  d.innerHTML = `<div class="ad-head"><b>${IC('ico:auto')} Automations — ${esc(c.cls.name)}</b><span class="grow"></span><button class="iconbtn pop-x" data-action="auto-open" title="Close" aria-label="Close">${IC('ico:close')}</button></div>${timelineCard(c.cls, ci)}`;
  $('#present').appendChild(d);
}
const tlRerender = () => { if (VIEW === 'edit') renderEditor(); else renderAutoDrawer(); };

// ---------- snap one window to part of the screen (▦ button on each window)
const SNAP_G = 0.006;   // small gap between snapped windows
const SNAPS = [
  ['Left half', 0, 0, .5, 1], ['Right half', .5, 0, .5, 1], ['Top half', 0, 0, 1, .5], ['Bottom half', 0, .5, 1, .5],
  ['Top left', 0, 0, .5, .5], ['Top right', .5, 0, .5, .5], ['Bottom left', 0, .5, .5, .5], ['Bottom right', .5, .5, .5, .5],
  ['Left third', 0, 0, 1 / 3, 1], ['Middle third', 1 / 3, 0, 1 / 3, 1], ['Right third', 2 / 3, 0, 1 / 3, 1], ['Fill', 0, 0, 1, 1],
  ['Left two-thirds', 0, 0, 2 / 3, 1], ['Right two-thirds', 1 / 3, 0, 2 / 3, 1],
];
function snapIcon([, x, y, w, h]) {
  return `<svg viewBox="0 0 30 20" width="30" height="20"><rect x=".5" y=".5" width="29" height="19" rx="3" fill="none" stroke="currentColor" opacity=".45"/>
    <rect x="${1.5 + x * 27}" y="${1.5 + y * 17}" width="${w * 27}" height="${h * 17}" rx="2" fill="currentColor"/></svg>`;
}
function renderSnapMenu() {
  $('#snap-host')?.remove();
  if (!P.snapFor) return;
  const btn = $(`.win[data-win="${P.snapFor}"] [data-action="win-snap"]`); if (!btn) { P.snapFor = null; return; }
  const r = btn.getBoundingClientRect();
  const host = document.createElement('div'); host.id = 'snap-host'; host.className = 'snap-menu';
  host.innerHTML = SNAPS.map((s, i) => `<button data-action="win-snap-to" data-i="${i}" title="${s[0]}" aria-label="${s[0]}">${snapIcon(s)}<span>${s[0]}</span></button>`).join('');
  $('#present').appendChild(host);
  const hw = host.offsetWidth;
  host.style.left = clamp(r.right - hw, 8, innerWidth - hw - 8) + 'px';
  host.style.top = r.bottom + 6 + 'px';
}
function snapWindow(w, i) {
  const [, x, y, sw, sh] = SNAPS[i];
  const g = SNAP_G;
  w.max = false;
  w.x = x + (x > 0 ? g / 2 : 0); w.y = y + (y > 0 ? g / 2 : 0);
  w.w = sw - (x > 0 ? g / 2 : 0) - (x + sw < 0.999 ? g / 2 : 0);
  w.h = sh - (y > 0 ? g / 2 : 0) - (y + sh < 0.999 ? g / 2 : 0);
  bringToFront(w);
  if (w.kind === 'app') {
    // Resize the REAL app window to fit the spot (you asked for it), then the frame follows 1:1.
    const L = $('#p-wins').getBoundingClientRect();
    const bar = $(`.win[data-win="${w.id}"] .win-bar`)?.getBoundingClientRect().height || 33;
    native('webCmd', { id: w.id, action: 'resize', width: Math.round(w.w * L.width - 4), height: Math.round(w.h * L.height - bar - 4) });
  }
  save(); applyWinGeom();
}

// Tell the native side where full-browser windows are, and cut matching holes in the page.
const rectOf = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
// Real browser / app views live *under* the page. Each one shows through a hole cut only in the
// page layers that are BELOW it (background, stage, lower windows). Windows stacked above it stay
// solid and paint over it, so overlapping windows look and click like normal desktop windows.
// the pinned tab on the stage, when it's a web page (any = even if it isn't in full-browser mode)
function stageNativeRes(any) {
  const c = context(now()); if (c.mode !== 'class' || !c.cls) return null;
  const r = c.cls.resources.find(x => x.id === P.stageSel[c.key]);
  return r && r.url && (any || isNativeWeb(r)) ? r : null;
}
function syncNative() {
  const items = [];
  if (VIEW === 'present' && !P.companion) for (const el of $$('.win.native')) {
    const w = findWin(el.dataset.win); if (!w) continue;
    const r = rectOf(el.querySelector('.win-body'));
    if (r[2] > 0 && r[3] > 0) items.push(w.kind === 'app'
      ? { id: w.id, z: w.z || 0, kind: 'app', windowID: w.windowID || 0, bundleId: w.bundleId, title: w.title || '', rect: r }
      : { id: w.id, z: w.z || 0, url: winTargetURL(w) || 'about:blank', rect: r });
  }
  const sr = VIEW === 'present' && !P.companion ? stageNativeRes() : null, sce = sr && $('#stage-content .stage-native') && $('#stage-content');
  let stageRect = null;
  if (sce) {
    const r = rectOf(sce);
    if (r[2] > 0 && r[3] > 0) {
      stageRect = r;
      (P.keepNative ||= new Set()).add(sr.id);
      const item = { id: 'stage-' + sr.id, z: -1, url: resTargetURL(sr), rect: r };
      if (P.forceStageUrl === sr.id) { item.forceUrl = true; P.forceStageUrl = null; }
      items.push(item);
    }
  }
  // full-browser tabs you've opened stay alive (hidden) when you switch tabs, so videos keep playing
  if (VIEW === 'present' && !P.companion && P.keepNative) for (const id of [...P.keepNative]) {
    if (sr && id === sr.id && stageRect) continue;
    const r = findRes(id);
    if (!r || !isNativeWeb(r) || !r.url) { P.keepNative.delete(id); continue; }
    items.push({ id: 'stage-' + id, z: -2, url: resTargetURL(r), rect: stageRect || [0, 0, 10, 10], hidden: true });
  }
  items.sort((a, b) => a.z - b.z);   // the native side stacks its views in this order
  const drawing = P.ink.on && !P.ink.interact;
  const pass = !drawing && !P.overlay && !WIN.drag;
  const holes = pass ? items.filter(i => !i.hidden).map(i => [...i.rect, i.z]) : [];
  let blockers = [];
  if (pass && items.length) {
    const TOP = 1e9;
    blockers = $$('.tool, .p-timer, .p-dock:not(.hidden), .p-signal.on, .win-menu, .snap-menu, .bm-menu, .web-mode-menu, .dock-custom, .sound-chip, .toast, .group-menu, .look-panel, .auto-drawer, .rename-inline, .ink-bar').map(el => [...rectOf(el), TOP]);
    for (const el of $$('.win')) {
      const w = findWin(el.dataset.win); if (!w) continue;
      // an embedded window blocks with its whole frame; a native one only with its title bar
      const part = el.classList.contains('native') ? el.querySelector('.win-bar') : el;
      blockers.push([...rectOf(part), w.z || 0]);
    }
  }
  const msg = JSON.stringify({ items, holes, blockers });
  if (msg !== WIN.lastSync) { WIN.lastSync = msg; if (IS_NATIVE) native('webSync', JSON.parse(msg)); }
  const shown = items.filter(i => !i.hidden);
  $('#present')?.classList.toggle('has-native', shown.length > 0);
  cutHoles(shown);
  syncDockedApp(false);
}
// Split overlapping rectangles into non-overlapping strips so even-odd cutting never re-fills overlaps.
function disjointRects(rects) {
  if (rects.length < 2) return rects;
  const xs = [...new Set(rects.flatMap(r => [r[0], r[0] + r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap(r => [r[1], r[1] + r[3]]))].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j < ys.length - 1; j++) {
    let run = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      const hit = rects.some(r => cx > r[0] && cx < r[0] + r[2] && cy > r[1] && cy < r[1] + r[3]);
      if (hit) { if (run) run[2] = xs[i + 1] - run[0]; else run = [xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]]; }
      else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out;
}
function cutHoles(items) {
  const targets = [
    [$('#p-bg'), -Infinity, ''],
    [$('#p-body'), -Infinity, ''],
    [$('#p-stage'), -Infinity, ''],
    [$('#stage-content'), -Infinity, ''],
    ...$$('#p-body .sp-paper, #p-body .sp-score, #p-body .sr-staff, #p-body .pdfv-pages, #p-body .p-side, #p-body iframe, #p-body video, #p-body img.res, #p-body .wg-host, #p-body .mu-host, #p-body .aud-host').map(el => [el, -Infinity, '']),
  ];
  for (const el of $$('.win')) {
    const w = findWin(el.dataset.win);
    if (w) {
      targets.push([el, w.z || 0, w.id]);
      for (const sub of el.querySelectorAll('iframe, video, .sp-paper, .sp-score, .sr-staff, .pdfv-pages')) targets.push([sub, w.z || 0, w.id]);
    }
  }
  const sig = JSON.stringify(items.map(i => [i.rect, i.z])) + targets.map(([el, z]) => el ? rectOf(el) + ':' + z : '').join(';');
  // redo it if anything changed, or if a layer was rebuilt (a fresh element has no cut-out yet)
  if (sig === WIN.cutSig && targets.every(([el]) => !el || el._cutSig === sig)) return; WIN.cutSig = sig;
  for (const [el, z, id] of targets) {
    if (!el) continue;
    el._cutSig = sig;
    const above = disjointRects(items.filter(i => i.z > z && i.id !== id).map(i => i.rect));
    // A window's drop shadow paints outside its own box, i.e. on top of a real browser/app view
    // stacked above it. Drop the shadow on any window that sits under one.
    if (el.classList.contains('win')) el.style.boxShadow = above.length ? 'none' : '';
    if (!above.length) { el.style.clipPath = ''; continue; }
    const e = el.getBoundingClientRect();
    let d = `M0 0 H${e.width} V${e.height} H0 Z`;
    for (const [x, y, w, h] of above) d += ` M${x - e.left} ${y - e.top} h${w} v${h} h${-w} Z`;
    el.style.clipPath = `path(evenodd, "${d}")`;
  }
}
function renderWinMenu() {
  const host = $('#win-menu-host'); if (!host) return;
  if (!P.winMenu) { host.innerHTML = ''; return; }
  const cls = currentClass();
  const lib = Object.entries(S.files).filter(([, f]) => !f.hiddenScore);
  const list = winList();
  const tile = (act, icon, label, extra = '') => `<button class="wm-tile" data-action="${act}" ${extra}>${IC(icon)}<span>${label}</span></button>`;
  const item = (act, id, icon, name) => `<button data-action="${act}" data-id="${id}" data-q="${esc(name.toLowerCase())}">${icoSp(icon)}${esc(name)}</button>`;
  const open = (P.wmOpen ||= { cls: true, lib: false });
  const sec = (key, title, n, body) => `<details class="wm-sec" data-sec="${key}" ${open[key] ? 'open' : ''}><summary>${title}<span class="wm-n">${n}</span></summary><div class="wm-items">${body}</div></details>`;
  const many = (cls ? cls.resources.length + 1 : 0) + lib.length > 8;
  const openTools = (dockCfg().inOpen || []).map(id => [id, DOCK_ITEMS[id]]).filter(([, it]) => it && it.act);
  host.innerHTML = `<div class="win-menu">
    <div class="wm-head">Music</div>
    <div class="wm-grid wm-music">
      ${tile('wm-sight', 'ico:sight', 'Sight reading')}
      ${tile('wm-dash', 'ico:sight', 'Rhythm Rush', 'title="Sight-reading rhythm game (touch & keyboard)"')}
      ${tile('wm-rocket', 'ico:sight', 'Solfege Rocket', 'title="Solfege singing space game (microphone & keyboard)"')}
      ${tile('wm-score', 'ico:score', 'Score practice', 'title="MusicXML / MuseScore"')}
      ${tile('wm-scan', 'ico:scan', 'Scan & fix', 'title="Scan a PDF or photo into MusicXML and fix mistakes"')}
      ${tile('wm-piano', 'ico:piano', 'Piano')}
      ${tile('wm-solboard', 'ico:ladder', 'Solfege board')}
      ${tile('open-music', 'ico:tuner', 'Tuner', 'data-kind="tuner"')}
      ${tile('open-music', 'ico:metro', 'Metronome', 'data-kind="metro"')}
      ${tile('wm-rec', 'ico:mic', 'Recorder')}
    </div>
    <div class="wm-head">Class</div>
    <div class="wm-grid">
      ${tile('wm-cal', 'ico:events', 'Calendar')}
      ${tile('wm-prog', 'ico:gauge', 'Progress')}
      ${tile('wm-yt', 'ico:youtube', 'YouTube')}
    </div>
    ${openTools.length ? `<div class="wm-head">Tools</div>
    <div class="wm-grid">
      ${openTools.map(([id, it]) => {
        const on = it.tool ? !!P.tools[it.tool] : !!it.on?.();
        return `<button class="wm-tile ${on ? 'on' : ''}" data-action="${it.act}" ${it.tool ? `data-tool="${it.tool}"` : ''} ${it.kind ? `data-kind="${it.kind}"` : ''}>${IC(icoCfg().dock?.[id] ?? it.icon)}<span>${esc(it.label)}</span></button>`;
      }).join('')}
    </div>` : ''}
    <div class="wm-head">Open</div>
    <div class="wm-grid">
      ${tile('wm-web', 'ico:web', 'Web page')}
      ${tile('wm-files', 'ico:folder', 'Files', 'title="Search and open any audio, PDF, score, image, or video — pin individual files anytime"')}
      ${tile('wm-file', 'ico:file', 'Import…', `title="Pick a new PDF, audio, score, picture or video from this ${DEVICE}"`)}
      ${IS_NATIVE ? tile('wm-apps', 'ico:app', 'External Apps', 'title="Switch to another app with Rehearsal floating on top"') : ''}
    </div>
    ${IS_NATIVE ? appPickerHTML() : ''}
    ${many ? `<input class="wm-search" placeholder="Search tabs and files…" data-wm-search>` : ''}
    ${cls ? sec('cls', esc(cls.name) + ' tabs', cls.resources.length + 1, `<button data-action="wm-warmup" data-q="warm-up">${icoSp('ico:warmup')}Warm-up question</button>${cls.resources.map(r => item('wm-res', r.id, resIcon(r), r.title || 'Resource')).join('')}`) : ''}
    ${lib.length ? sec('lib', 'Library', lib.length, lib.map(([id, f]) => item('wm-lib', id, KIND_ICON[resKind({ fileId: id })], f.name)).join('')) : ''}
    <div class="wm-none" hidden>Nothing matches.</div>
    ${list.length ? `<div class="wm-foot"><button data-action="win-tile">${IC('ico:tile')} Tile</button><button data-action="wm-closeall">${IC('ico:close')} Close all</button></div>` : ''}
  </div>`;
  const menu = host.firstElementChild;
  menu.querySelectorAll('details.wm-sec').forEach(d => d.addEventListener('toggle', () => { if (!menu.classList.contains('searching')) open[d.dataset.sec] = d.open; }));
  menu.querySelector('[data-wm-search]')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase(); menu.classList.toggle('searching', !!q); let hits = 0;
    menu.querySelectorAll('details.wm-sec').forEach(d => {
      let n = 0; d.querySelectorAll('[data-q]').forEach(b => { const ok = !q || b.dataset.q.includes(q); b.hidden = !ok; n += ok; });
      d.hidden = !!q && !n; d.open = q ? n > 0 : !!open[d.dataset.sec]; hits += n;
    });
    menu.querySelector('.wm-none').hidden = !q || hits > 0;
  });
  let btn = $('#p-dock [data-action="win-menu"]'); const m = host.firstElementChild;
  if (!btn || !btn.offsetWidth) btn = $('#p-dock .dock-more');     // the Window button is in the ⋯ menu: open under ⋯
  if (btn && m) {
    const r = btn.getBoundingClientRect(), vert = $('#p-dock')?.classList.contains('vertical');
    if (vert) {                                    // toolbar on a side: open beside it
      m.style.maxHeight = innerHeight - 16 + 'px';
      const right = r.left < innerWidth / 2;
      m.style.left = (right ? r.right + 8 : r.left - m.offsetWidth - 8) + 'px';
      m.style.top = clamp(r.top + r.height / 2 - m.offsetHeight / 2, 8, innerHeight - m.offsetHeight - 8) + 'px';
    } else {
      const below = r.top < innerHeight / 2;      // toolbar at the bottom: open upward
      m.style.maxHeight = (below ? innerHeight - r.bottom - 16 : r.top - 16) + 'px';
      m.style.top = (below ? r.bottom + 8 : r.top - 8 - m.offsetHeight) + 'px';
      m.style.left = clamp(r.left + r.width / 2 - m.offsetWidth / 2, 8, innerWidth - m.offsetWidth - 8) + 'px';
    }
  }
  if (m) for (const d of m.querySelectorAll('details.wm-sec')) d.addEventListener('toggle', () => renderWinMenuPos?.());
}
function renderWinMenuPos() { if (P.winMenu) { const m = $('#win-menu-host')?.firstElementChild; if (!m) return; const r = m.getBoundingClientRect(); if (r.bottom > innerHeight - 8) m.style.top = Math.max(8, innerHeight - 8 - m.offsetHeight) + 'px'; } }

// ---------- side panel ↔ stage divider (per class)
function applySide(cls) {
  const body = $('#p-body'); if (!body || !cls) return;
  const L = cls.layout || {}, collapsed = !!L.collapsed && P.tour == null;
  const frac = clamp(L.side ?? 0.22, 0.1, 0.6);
  body.classList.toggle('side-collapsed', collapsed);
  body.style.gridTemplateColumns = collapsed ? '0px 1.4em minmax(0, 1fr)' : `${(frac * 100).toFixed(2)}% 1.4em minmax(0, 1fr)`;
  const btn = $('#p-split .p-split-btn'); if (btn) btn.textContent = collapsed ? '›' : '‹';
  WIN.cutSig = '';
}
let SPLIT = null;
document.addEventListener('pointerdown', e => {
  const sp = e.target.closest('#p-split'); if (!sp || e.target.closest('button') || VIEW !== 'present') return;
  const cls = context(now()).cls; if (!cls) return;
  e.preventDefault();
  SPLIT = { cls, rect: $('#p-body').getBoundingClientRect() };
  $('#p-body').classList.add('resizing');
});
document.addEventListener('pointermove', e => {
  if (!SPLIT) return;
  const { cls, rect } = SPLIT;
  cls.layout = { ...(cls.layout || {}), collapsed: false, side: clamp((e.clientX - rect.left) / rect.width, 0.1, 0.6) };
  applySide(cls);
});
document.addEventListener('pointerup', () => {
  if (!SPLIT) return;
  SPLIT = null; $('#p-body')?.classList.remove('resizing'); save();
});
document.addEventListener('dblclick', e => {
  if (VIEW === 'present' && e.target.closest('#p-split')) A['side-toggle']();
});
