'use strict';
// Classroom display widgets: Calendar, Progress, YouTube, and Recorder (loaded after app.js).
// ============================================================ calendar & progress windows
const WIDGETS = { cal: { title: 'Calendar', icon: 'ico:events' }, prog: { title: 'Progress', icon: 'ico:gauge' }, rec: { title: 'Recorder', icon: 'ico:mic' }, yt: { title: 'YouTube', icon: 'ico:youtube' }, piano: { title: 'Piano & Warm-up', icon: 'ico:piano' }, solboard: { title: 'Solfege board', icon: 'ico:ladder' } };
const WG_RENDER = k => ({ cal: renderCal, prog: renderProg, rec: renderRec, yt: renderYt, piano: typeof renderPiano === 'function' ? renderPiano : null, solboard: typeof renderSolBoard === 'function' ? renderSolBoard : null })[k];
const widgetHost = (kind, cls = '', extra = '') => `<div class="wg-host ${cls}" data-wg="${kind}"${extra ? ' ' + extra : ''}></div>`;
function mountWidgets(root = document) { for (const h of root.querySelectorAll('.wg-host')) WG_RENDER(h.dataset.wg)?.(h); }
// Re-render keeps each widget's scroll position (rebuilding the HTML would otherwise jump to the top).
function refreshWidgets(kind) { document.querySelectorAll(`.wg-host[data-wg="${kind}"]`).forEach(h => keepScroll(h, () => WG_RENDER(kind)(h))); }
function refreshRhythmCounts() {
  if (typeof SP_CACHE !== 'undefined') for (const c of Object.values(SP_CACHE)) c.drawLabels?.();
  if (typeof refreshWidgets === 'function') refreshWidgets('piano');
  if (typeof mountSightHosts === 'function') {
    for (const h of document.querySelectorAll('.sr-host')) {
      const sel = h.querySelector('select[data-k="rhythmSystem"]'); if (sel) sel.value = S.settings.rhythmSystem || 'numbers';
    }
    // re-render open sight-reading hosts cleanly
    for (const h of document.querySelectorAll('[data-sr-win]')) { const w = findWin(h.dataset.srWin); if (w?.sr) mountSight(h, w.sr, () => save()); }
    for (const h of document.querySelectorAll('[data-sr-res]')) { const r = findRes(h.dataset.srRes); if (r?.sight) mountSight(h, r.sight, () => save()); }
  }
}
function keepScroll(h, fn) {
  const inner = [...h.querySelectorAll('*')].filter(x => x.scrollTop > 0).map(x => [x.className, x.scrollTop]);
  const top = h.scrollTop, left = h.scrollLeft;
  fn();
  h.scrollTop = top; h.scrollLeft = left;
  for (const [c, t] of inner) { try { const x = c && typeof c === 'string' && h.querySelector('.' + c.trim().split(/\s+/).map(CSS.escape).join('.')); if (x) x.scrollTop = t; } catch { } }
}

// Re-render every open copy of a widget, keeping the cursor in the field you were typing in.
function refreshWidgetsKeep(kind) {
  const a = document.activeElement, host = a?.closest?.('.wg-host');
  const key = host && a.dataset?.f ? { f: a.dataset.f, id: a.closest('[data-id]')?.dataset.id, s: a.selectionStart } : null;
  refreshWidgets(kind);
  if (!key) return;
  const sel = `[data-f="${key.f}"]`, el = [...host.querySelectorAll(sel)].find(x => (x.closest('[data-id]')?.dataset.id) === key.id);
  if (el) { el.focus({ preventScroll: true }); try { if (key.s != null) el.setSelectionRange(key.s, key.s); } catch {} }
}
const CAL_COLORS = ['#e5484d', '#f2994a', '#f2c230', '#2fbf5b', '#3b9eff', '#a970ff', '#e05fae'];
const calDays = () => (S.calDays ||= {});
const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Month view: click a day to change its bell schedule, colour and label it, and add events, birthdays,
 *  announcements and the on-screen note. */
function renderCal(h) {
  const t = now(), off = h.__off || 0, cls = currentClass();
  const first = new Date(t.getFullYear(), t.getMonth() + off, 1), month = first.getMonth();
  const start = new Date(first); start.setDate(1 - first.getDay());
  const last = new Date(first.getFullYear(), month + 1, 0), weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  const todayK = dateKey(t), sel = h.__sel;
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dateKey(d), tmpl = templateFor(d), special = k in S.overrides, mark = calDays()[k];
    const hide = S.settings.calHide || {};
    const evs = eventsOn(d, cls || undefined).filter(e => !hide[e.kind || 'event']), note = cls?.screenNotes?.[k]?.trim();
    cells += `<div class="cal-d ${d.getMonth() !== month ? 'out' : ''} ${k === todayK ? 'today' : ''} ${tmpl ? '' : 'off'} ${k === sel ? 'sel' : ''}" data-day="${k}"
      ${mark?.color ? `style="--mark:${mark.color}"` : ''}>
      <div class="cal-n">${d.getDate()}</div>
      ${mark?.label ? `<div class="cal-lb">${esc(mark.label)}</div>` : ''}
      ${special ? `<div class="cal-sp">${esc(tmpl ? tmpl.name : 'No school')}</div>` : ''}
      ${evs.map(e => `<div class="cal-ev ${e.kind || ''}">${IC(EVENT_ICON[e.kind] || 'ico:events')}${esc(eventLabel(e) || '(untitled)')}${e.time ? ` <small>${fmtHM(e.time)}</small>` : ''}</div>`).join('')}
      ${note ? `<div class="cal-ev note">${IC('ico:notes')}${esc(note.split('\n')[0])}</div>` : ''}</div>`;
  }
  h.innerHTML = `<div class="cal ${sel ? 'has-day' : ''}"><div class="cal-month">
    <div class="cal-top"><button data-cal="-1" title="Previous month">‹</button><b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button data-cal="1" title="Next month">›</button>
      <span class="grow"></span><span class="cal-show" title="Choose what shows on the month (the day panel still lists everything)">${[['announcement', 'Announcements'], ['event', 'Events'], ['birthday', 'Birthdays']].map(([kd, l]) => `<button data-calhide="${kd}" class="${(S.settings.calHide || {})[kd] ? '' : 'on'}">${IC(EVENT_ICON[kd])} ${l}</button>`).join('')}</span>${off ? '<button data-cal="0">Today</button>' : ''}</div>
    <div class="cal-grid" style="grid-template-rows: auto repeat(${weeks}, minmax(0, 1fr))">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="cal-w">${w}</div>`).join('')}${cells}</div>
    <div class="cal-key">Click a day to add events or change it. Grey days have no school.</div></div>
    ${sel ? calDayPanel(sel, cls) : ''}</div>`;

  h.onclick = e => {
    const hb = e.target.closest('[data-calhide]');
    if (hb) { e.stopPropagation(); const hd = (S.settings.calHide ||= {}), kd = hb.dataset.calhide; hd[kd] = !hd[kd]; save(); return refreshWidgetsKeep('cal'); }
    const b = e.target.closest('[data-cal], [data-day], [data-cd]'); if (!b) return; e.stopPropagation();
    if (b.dataset.cal != null) { const v = Number(b.dataset.cal); h.__off = v ? off + v : 0; return renderCal(h); }
    if (b.dataset.day) { h.__sel = h.__sel === b.dataset.day ? null : b.dataset.day; return renderCal(h); }
    const k = h.__sel, act = b.dataset.cd, id = b.closest('[data-id]')?.dataset.id;
    if (act === 'close') { h.__sel = null; return renderCal(h); }
    if (act === 'step') { const d = parseKey(k); d.setDate(d.getDate() + Number(b.dataset.n)); h.__sel = dateKey(d); h.__off = (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth(); return renderCal(h); }
    if (act === 'color') { const m = calDays()[k] ||= {}; if (b.dataset.c) m.color = b.dataset.c; else delete m.color; if (!m.color && !m.label) delete calDays()[k]; }
    if (act === 'add') {
      const kind = b.dataset.kind;
      S.events.push({ id: uid(), kind, date: k, title: '', time: '', yearly: kind === 'birthday', classes: cls && kind !== 'birthday' ? [cls.id] : [] });
      const id2 = S.events.at(-1).id; calChanged(h); h.querySelector(`[data-id="${id2}"] [data-f="title"]`)?.focus(); return;
    }
    if (act === 'del') {
      const ev = S.events.find(x => x.id === id);
      if (ev && evRepeat(ev) && !confirm(`Remove “${ev.title || 'this'}” on every day it repeats? (Use “Skip this day” to remove just one day.)`)) return;
      S.events = S.events.filter(x => x.id !== id);
    }
    if (act === 'skip') { const ev = S.events.find(x => x.id === id); if (ev) (ev.skip ||= []).push(k); }
    calChanged(h);
  };
  h.onchange = e => {
    const el = e.target, f = el.dataset.f; if (!f) return;
    const k = h.__sel, ev = S.events.find(x => x.id === el.closest('[data-id]')?.dataset.id);
    if (f === 'tmpl') { if (el.value === '') delete S.overrides[k]; else S.overrides[k] = el.value; }
    else if (f === 'label') { const m = calDays()[k] ||= {}; m.label = el.value.trim(); if (!m.label) delete m.label; if (!m.color && !m.label) delete calDays()[k]; }
    else if (f === 'note') { if (!cls) return; const n = (cls.screenNotes ||= {}); if (el.value.trim()) n[k] = el.value; else delete n[k]; }
    else if (ev && f === 'who') ev.classes = el.value ? [el.value] : [];
    else if (ev && f === 'repeat') { ev.repeat = el.value; ev.yearly = el.value === 'yearly'; }
    else if (ev && f === 'until') { if (el.value) ev.until = el.value; else delete ev.until; }
    else if (ev) ev[f] = el.value;
    calChanged(h);
  };
}
function calChanged(h) { save(); P.sideKey = P.stageKey = ''; $('#p-title') && ($('#p-title')._h = ''); refreshWidgetsKeep('cal'); }
function calDayPanel(k, cls) {
  const d = parseKey(k), usual = S.templates.find(x => x.id === S.weekdays[d.getDay()]);
  const cur = k in S.overrides ? S.overrides[k] : '', mark = calDays()[k] || {};
  const evs = eventsOn(d, cls || undefined);
  const kindSel = e => `<select data-f="kind">${[['event', 'Event'], ['announcement', 'Announcement'], ['birthday', 'Birthday']].map(([v, l]) => `<option value="${v}" ${e.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const whoSel = e => `<select data-f="who" title="Who sees it"><option value="">All classes</option>${S.classes.map(c => `<option value="${c.id}" ${e.classes?.[0] === c.id && e.classes.length === 1 ? 'selected' : ''}>${esc(c.name)} only</option>`).join('')}</select>`;
  return `<div class="cal-day">
    <div class="cal-dh"><button data-cd="step" data-n="-1" title="Previous day">‹</button><b>${DAYNAMES[d.getDay()]}, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><button data-cd="step" data-n="1" title="Next day">›</button>
      <span class="grow"></span><button data-cd="close" title="Close">${IC('ico:close')}</button></div>
    <label class="cal-f"><span>Bell schedule</span><select data-f="tmpl">
      <option value="" ${cur === '' ? 'selected' : ''}>Usual (${esc(usual ? usual.name : 'no school')})</option>
      ${S.templates.map(x => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      <option value="none" ${cur === 'none' ? 'selected' : ''}>No school</option></select></label>
    <label class="cal-f"><span>Label</span><input data-f="label" value="${esc(mark.label || '')}" placeholder="e.g. Concert, Field trip, Exam week"></label>
    <div class="cal-f"><span>Colour</span><div class="cal-sw"><button data-cd="color" data-c="" class="${mark.color ? '' : 'on'}" title="None">∅</button>${CAL_COLORS.map(c => `<button data-cd="color" data-c="${c}" style="background:${c}" class="${mark.color === c ? 'on' : ''}"></button>`).join('')}</div></div>
    <div class="cal-sec">Events</div>
    ${evs.map(e => `<div class="cal-evrow" data-id="${e.id}">
      <div class="cal-er1">${IC(EVENT_ICON[e.kind] || 'ico:events')}<input data-f="title" value="${esc(e.title)}" placeholder="${e.kind === 'birthday' ? 'Name' : 'What'}"><button data-cd="del" title="Remove">${IC('ico:trash')}</button></div>
      <div class="cal-er2">${kindSel(e)}<input type="time" data-f="time" value="${e.time || ''}" title="Time (optional)">${whoSel(e)}${repeatSel(e, 'data-f="repeat"')}</div>
      ${evRepeat(e) ? `<div class="cal-er2"><label title="Last day it repeats (empty = forever)">until <input type="date" data-f="until" value="${e.until || ''}"></label>${e.date !== k ? `<button data-cd="skip" title="Take only this day out of the series">Skip this day</button>` : ''}</div>` : ''}</div>`).join('')
      || '<div class="cal-none">Nothing on this day.</div>'}
    <div class="cal-adds"><button data-cd="add" data-kind="event">${IC('ico:plus')} Event</button><button data-cd="add" data-kind="announcement">${IC('ico:plus')} Announcement</button><button data-cd="add" data-kind="birthday">${IC('ico:plus')} Birthday</button></div>
    ${cls ? `<div class="cal-sec">Note on screen for ${esc(cls.name)}</div><textarea data-f="note" rows="2" placeholder="Shows under the announcement that day">${esc(cls.screenNotes?.[k] || '')}</textarea>` : ''}
  </div>`;
}

/** Pieces (or anything) with a traffic light, steps to check off and notes on what still needs doing. */
const PROG = { green: 'Concert ready', yellow: 'Still working', red: "Haven't started" };
const progLabel = (cls, k) => cls?.progLabels?.[k] || PROG[k];
const agoText = ts => { if (!ts) return ''; const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'updated today' : d === 1 ? 'updated yesterday' : `updated ${d} days ago`; };
function renderProg(h) {
  const cls = currentClass();
  if (!cls) { h.innerHTML = '<div class="prog"><div class="prog-empty">Progress is kept for each class. Show a class first (Class picker in the toolbar).</div></div>'; return; }
  const items = (cls.progress ||= []), count = k => items.filter(i => i.status === k).length, L = k => esc(progLabel(cls, k));
  const keepTop = h.scrollTop;
  const lights = it => ['red', 'yellow', 'green'].map(k => `<button class="pick ${k} ${it.status === k ? 'on' : ''}" data-pg="set" data-s="${k}"><i class="light ${k}"></i>${L(k)}</button>`).join('');
  h.innerHTML = `<div class="prog">
    <div class="prog-top">${['green', 'yellow', 'red'].map(k => `<span class="prog-sum"><i class="light ${k}"></i>${L(k)} <b>${count(k)}</b></span>`).join('')}
      <span class="grow"></span><button data-pg="side" class="${cls.sideProgress ? 'on' : ''}" title="Show this list in the class's side panel">Side panel</button><button data-pg="labels" class="${h.__labels ? 'on' : ''}" title="Rename the three colours">Labels</button><button class="prog-add" data-pg="add">${IC('ico:plus')} Add</button></div>
    ${h.__labels ? `<div class="prog-labels">${['red', 'yellow', 'green'].map(k => `<label><i class="light ${k}"></i><input data-f="lbl-${k}" value="${esc(cls.progLabels?.[k] || '')}" placeholder="${esc(PROG[k])}"></label>`).join('')}</div>` : ''}
    <div class="prog-list">${items.map((it, i) => {
      const steps = it.steps || [], done = steps.filter(s => s.done).length, open = it.open !== false;
      return `<div class="prog-item ${it.status}" data-id="${it.id}">
      <button class="light ${it.status}" data-pg="pick" title="Change colour"></button>
      <div class="prog-main">
        <div class="prog-row"><input class="prog-title" data-f="title" value="${esc(it.title)}" placeholder="Piece or task">
          <button class="prog-st ${it.status}" data-pg="pick" title="Change colour">${L(it.status)} ▾</button>
          <span class="prog-tools"><button data-pg="up" title="Move up" ${i ? '' : 'disabled'}>${IC('ico:up')}</button><button data-pg="down" title="Move down" ${i < items.length - 1 ? '' : 'disabled'}>${IC('ico:down')}</button><button data-pg="del" title="Remove">${IC('ico:trash')}</button></span></div>
        ${h.__pick === it.id ? `<div class="prog-pick">${lights(it)}</div>` : ''}
        <div class="prog-meta">${steps.length ? `<button class="prog-tog" data-pg="toggle">${open ? '▾' : '▸'} ${done}/${steps.length} steps</button><span class="prog-bar"><i style="width:${Math.round(done / steps.length * 100)}%"></i></span>` : ''}<span class="prog-ago">${agoText(it.updated)}</span></div>
        ${open ? `<div class="prog-steps">${steps.map(s => `<div class="prog-step ${s.done ? 'done' : ''}" data-sid="${s.id}">
            <button class="pg-chk ${s.done ? 'on' : ''}" data-pg="check" title="${s.done ? 'Mark not done' : 'Mark done'}">${s.done ? IC('ico:check') : ''}</button>
            <input data-f="step" data-sid="${s.id}" value="${esc(s.text)}" placeholder="Step, e.g. learn notes mm. 1–24"><button class="prog-sx" data-pg="sdel" title="Remove step">${IC('ico:close')}</button></div>`).join('')}
          <button class="prog-addstep" data-pg="addstep">${IC('ico:plus')} Step</button></div>
          <textarea class="prog-notes" data-f="notes" rows="1" placeholder="Notes: what still needs to be done…">${esc(it.notes || '')}</textarea>` : ''}
        ${steps.length && done === steps.length && it.status !== 'green' ? `<div class="prog-hint">All steps are checked off. <button data-pg="set" data-s="green">Mark “${L('green')}”</button></div>` : ''}
      </div></div>`; }).join('')
      || `<div class="prog-empty">Nothing yet. Press ＋ Add for each piece you're working on, add the steps it needs and check them off as you go. Click the light to change its colour.</div>`}</div></div>`;
  h.querySelectorAll('.prog-notes').forEach(fitNotes);
  h.scrollTop = keepTop;
  const touch = it => { if (it) it.updated = Date.now(); };
  h.onclick = e => {
    const b = e.target.closest('[data-pg]'); if (!b) return; e.stopPropagation();
    const id = b.closest('[data-id]')?.dataset.id, it = items.find(i => i.id === id), sid = b.closest('[data-sid]')?.dataset.sid;
    const act = b.dataset.pg;
    if (act === 'add') { const n = { id: uid(), title: '', status: 'red', notes: '', steps: [], updated: Date.now() }; items.push(n); save(); renderProg(h); h.querySelector(`[data-id="${n.id}"] .prog-title`)?.focus(); refreshOthers(h); return; }
    if (act === 'labels') { h.__labels = !h.__labels; return renderProg(h); }
    if (act === 'side') { cls.sideProgress = !cls.sideProgress; save(); P.sideKey = ''; return refreshWidgets('prog'); }
    if (act === 'pick') { h.__pick = h.__pick === id ? null : id; return renderProg(h); }
    if (!it) return;
    if (act === 'set') { it.status = b.dataset.s; h.__pick = null; touch(it); }
    if (act === 'toggle') it.open = it.open === false;
    if (act === 'up' || act === 'down') { const i = items.indexOf(it), j = i + (act === 'up' ? -1 : 1); if (j >= 0 && j < items.length) [items[i], items[j]] = [items[j], items[i]]; }
    if (act === 'del' && !(!it.title && !it.notes && !it.steps?.length || confirm(`Remove “${it.title || 'this item'}”?`))) return;
    if (act === 'del') items.splice(items.indexOf(it), 1);
    if (act === 'addstep') {
      const s = { id: uid(), text: '', done: false }; (it.steps ||= []).push(s); it.open = true; touch(it);
      save(); renderProg(h); h.querySelector(`[data-sid="${s.id}"] input`)?.focus({ preventScroll: true }); refreshOthers(h); return;
    }
    const st = it.steps?.find(s => s.id === sid);
    if (act === 'check' && st) { st.done = !st.done; touch(it); if (st.done && it.status === 'red') it.status = 'yellow'; }
    if (act === 'sdel' && st) it.steps.splice(it.steps.indexOf(st), 1);
    save(); refreshWidgetsKeep('prog');
  };
  h.oninput = e => {
    const f = e.target.dataset.f; if (!f) return;
    if (f.startsWith('lbl-')) { const k = f.slice(4), lb = (cls.progLabels ||= {}); if (e.target.value.trim()) lb[k] = e.target.value; else delete lb[k]; save(); return; }
    const it = items.find(i => i.id === e.target.closest('[data-id]')?.dataset.id); if (!it) return;
    if (f === 'step') { const s = it.steps?.find(x => x.id === e.target.dataset.sid); if (s) s.text = e.target.value; }
    else it[f] = e.target.value;
    if (f === 'notes') fitNotes(e.target);
    touch(it); save();
  };
  h.onchange = e => { if (e.target.dataset.f) refreshWidgetsKeep('prog'); };
  h.onkeydown = e => {
    if (e.key !== 'Enter' || e.target.dataset.f !== 'step') return;
    e.preventDefault(); e.target.closest('.prog-item')?.querySelector('[data-pg="addstep"]')?.click();
  };
}
// other open copies of the same widget (a pinned one and a window, say)
const refreshOthers = h => document.querySelectorAll(`.wg-host[data-wg="${h.dataset.wg}"]`).forEach(x => x !== h && WG_RENDER(x.dataset.wg)(x));
function fitNotes(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

// ---------- YouTube window: paste a link, keep recently watched videos, make playlists and switch between them
const ytData = () => (S.yt ||= { recent: [], lists: [], last: null });
function ytParse(raw) {
  const t = String(raw || '').trim(); if (!t) return null;
  if (/^[\w-]{11}$/.test(t)) return { id: t };
  let u; try { u = new URL(/^https?:/.test(t) ? t : 'https://' + t); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|music)\./, ''), start = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '0') || 0;
  if (h === 'youtu.be') return { id: u.pathname.slice(1, 12), start };
  if (h !== 'youtube.com' && h !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v'), sh = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/), list = u.searchParams.get('list');
  if (v || sh) return { id: v || sh[1], start, ...(list ? { list } : {}) };
  if (list) return { list };
  return null;
}
const ytKey = v => v.id || 'list:' + v.list;
const ytThumb = v => v.id ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : '';
async function ytTitle(v) {
  try { const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(v.id ? 'https://www.youtube.com/watch?v=' + v.id : 'https://www.youtube.com/playlist?list=' + v.list)}`); if (r.ok) return (await r.json()).title || ''; } catch { }
  return '';
}
function ytRemember(v) {
  const d = ytData(), k = ytKey(v);
  d.recent = [{ ...v, at: Date.now() }, ...d.recent.filter(x => ytKey(x) !== k)].slice(0, 30);
  d.last = { ...v };
  if (!v.title) ytTitle(v).then(t => { if (!t) return; for (const x of [...d.recent, ...d.lists.flatMap(l => l.items)]) if (ytKey(x) === k) x.title = t; if (d.last && ytKey(d.last) === k) d.last.title = t; save(); refreshWidgets('yt'); });
  save();
}
function ytPlay(h, v, listId = null) {
  h.__cur = { ...v }; h.__list = listId;
  ytRemember(v);
  const src = v.id
    ? `https://www.youtube.com/embed/${v.id}?rel=0&autoplay=1&enablejsapi=1&playsinline=1${v.start ? '&start=' + v.start : ''}${v.list ? '&list=' + encodeURIComponent(v.list) : ''}`
    : `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(v.list)}&autoplay=1&enablejsapi=1`;
  const box = h.querySelector('.yt-player');
  if (box) { box.innerHTML = `<iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; ytListen(box.firstElementChild); }
  renderYtSide(h);
}
// ask the player to report its state, so a playlist moves on when a video ends
function ytListen(f) { f.addEventListener('load', () => { const ping = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch { } }; ping(); setTimeout(ping, 800); }); }
window.addEventListener('message', e => {
  if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin || 'http://x').hostname)) return;
  let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  const ended = (d?.event === 'onStateChange' && d.info === 0) || (d?.event === 'infoDelivery' && d.info?.playerState === 0);
  if (!ended) return;
  for (const h of document.querySelectorAll('.wg-host[data-wg="yt"]')) if (h.querySelector('.yt-player iframe')?.contentWindow === e.source && h.__list && h.__auto !== false) ytStep(h, 1);
});
function ytStep(h, dir) {
  const l = ytData().lists.find(x => x.id === h.__list); if (!l?.items.length) return;
  const i = l.items.findIndex(x => ytKey(x) === ytKey(h.__cur || {})), j = i + dir;
  if (j < 0 || j >= l.items.length) return toast(dir > 0 ? 'That was the last video in the playlist.' : 'This is the first video.');
  ytPlay(h, l.items[j], l.id);
}
function renderYt(h) {
  const d = ytData();
  if (!h.querySelector('.yt')) {
    h.innerHTML = `<div class="yt"><form class="yt-bar"><input data-yt-url placeholder="Search YouTube, or paste a link…" enterkeyhint="search"><button>${IC('ico:play')} Go</button><button type="button" data-yt="side" title="Search results, recent and playlists">${IC('ico:scroll')}</button></form>
      <div class="yt-main"><div class="yt-player"></div><div class="yt-side"></div></div></div>`;
    h.querySelector('form').onsubmit = e => {
      e.preventDefault(); const inp = h.querySelector('[data-yt-url]'), raw = inp.value.trim(); if (!raw) return;
      const v = ytParse(raw);
      if (v) { inp.value = ''; return ytPlay(h, v, null); }
      ytSearch(h, raw);
    };
    h.onclick = e => ytClick(h, e);
    h.onchange = e => {
      if (e.target.dataset.yt === 'pick') { h.__tab = 'list'; h.__showList = e.target.value; h.__sel = null; renderYtSide(h); }
      if (e.target.dataset.yt === 'auto') { h.__auto = e.target.checked; }
      if (e.target.dataset.yt === 'chk') { ytToggleSel(h, e.target.closest('[data-k]')?.dataset.k, e.target.checked); }
    };
    h.onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.yt === 'newname') { e.preventDefault(); h.querySelector('[data-yt="pnew"]')?.click(); } };
    if (d.last && !h.__cur) { h.__cur = { ...d.last }; const box = h.querySelector('.yt-player'); box.innerHTML = `<button class="yt-resume" data-yt="resume">${d.last.id ? `<img src="${ytThumb(d.last)}" alt="">` : ''}<span>${IC('ico:play')} ${esc(d.last.title || 'Play the last video')}</span></button>`; }
    else if (!d.last) h.querySelector('.yt-player').innerHTML = `<div class="yt-empty">${IC('ico:youtube')}<div>Search or paste a YouTube link above.<br><small>Videos you play are kept under Recent. Make playlists to switch between them in class.</small></div></div>`;
  }
  h.querySelector('.yt').classList.toggle('side-off', !!h.__sideOff);
  renderYtSide(h);
}
// Search YouTube from the window (Mac app: through Rehearsal's own helper; browser/iPad: opens YouTube's search)
async function ytSearch(h, q) {
  if (!HAS_SERVER) {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    native('openExternal', { url }) || window.open(url, '_blank');
    return toast('Search opened in YouTube. Copy the video’s link and paste it here.', 4000);
  }
  h.__tab = 'search'; h.__results = null; h.__q = q; h.__sel = null; h.__sideOff = false; renderYt(h);
  try {
    const r = await fetch('/api/ytsearch?q=' + encodeURIComponent(q), { headers: { 'X-Token': TOKEN } });
    const list = r.ok ? await r.json() : [];
    if (h.__q !== q) return;                                    // a newer search replaced this one
    h.__results = list.map(x => ({ id: x.id, title: x.title, len: x.len, ch: x.ch }));
  } catch { h.__results = []; }
  renderYtSide(h);
}
// the videos shown in the side panel's current tab
function ytTabItems(h) {
  const d = ytData(), tab = h.__tab || 'recent';
  if (tab === 'search') return h.__results || [];
  if (tab === 'recent') return d.recent;
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  return show ? show.items : [];
}
function ytToggleSel(h, k, on) {
  if (!k) return; const s = (h.__sel ||= new Set());
  if (on ?? !s.has(k)) s.add(k); else s.delete(k);
  renderYtSide(h);
}
function renderYtSide(h) {
  const side = h.querySelector('.yt-side'); if (!side) return;
  const d = ytData(), tab = h.__tab || 'recent', cur = h.__cur, curK = cur && ytKey(cur);
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  const sel = h.__sel, selMode = !!sel, inList = tab === 'list';
  const keepTop = side.querySelector('.yt-list')?.scrollTop || 0;
  const item = (v, i) => {
    const k = ytKey(v), on = sel?.has(k);
    return `<div class="yt-item ${k === curK && (!inList || h.__list === show?.id) ? 'cur' : ''} ${on ? 'sel' : ''}" data-k="${esc(k)}" data-i="${i}">
      ${selMode ? `<label class="yt-chk" title="Select"><input type="checkbox" data-yt="chk" ${on ? 'checked' : ''}></label>` : ''}
      <button class="yt-th" data-yt="${selMode ? 'tsel' : 'play'}">${v.id ? `<img src="${ytThumb(v)}" alt="" loading="lazy">` : IC('ico:youtube')}${v.len ? `<i class="yt-len">${esc(v.len)}</i>` : ''}</button>
      <button class="yt-t" data-yt="${selMode ? 'tsel' : 'play'}">${esc(v.title || (v.id ? 'Video ' + v.id : 'YouTube playlist'))}${v.ch ? `<small>${esc(v.ch)}</small>` : ''}</button>
      ${selMode ? '' : `<span class="yt-acts">${inList ? `<button data-yt="up" title="Move up" aria-label="Move up">${IC('ico:up')}</button><button data-yt="add1" title="Add to another playlist" aria-label="Add to another playlist">${IC('ico:plus')}</button><button data-yt="rm1" title="Remove from playlist" aria-label="Remove from playlist">${IC('ico:close')}</button>`
        : `<button data-yt="add1" title="Add to a playlist" aria-label="Add to a playlist">${IC('ico:plus')}</button>${tab === 'recent' ? `<button data-yt="rm1" title="Remove from Recent" aria-label="Remove from Recent">${IC('ico:close')}</button>` : ''}`}</span>`}</div>`;
  };
  const items = ytTabItems(h);
  const listBody = tab === 'search'
    ? (h.__results == null ? '<div class="yt-none">Searching…</div>' : items.map(item).join('') || '<div class="yt-none">No videos found. Try other words.</div>')
    : tab === 'recent' ? items.map(item).join('') || '<div class="yt-none">Nothing yet.</div>'
    : show ? items.map(item).join('') || '<div class="yt-none">Empty. Add videos with ＋ from Search or Recent.</div>' : '<div class="yt-none">No playlists yet. Press ＋ New.</div>';
  const n = sel?.size || 0;
  side.innerHTML = `
    <div class="yt-tabs">${h.__results || tab === 'search' ? `<button data-yt="tab" data-v="search" class="${tab === 'search' ? 'on' : ''}" title="${esc(h.__q || '')}">Search</button>` : ''}<button data-yt="tab" data-v="recent" class="${tab === 'recent' ? 'on' : ''}">Recent</button><button data-yt="tab" data-v="list" class="${tab === 'list' ? 'on' : ''}">Playlists</button></div>
    ${h.__list && cur ? `<div class="yt-now">${IC('ico:play')} <span>${esc(d.lists.find(l => l.id === h.__list)?.name || '')}</span><button data-yt="prev" title="Previous">${IC('ico:chevleft')}</button><button data-yt="next" title="Next">${IC('ico:chevright')}</button><label title="Play the next video when one ends"><input type="checkbox" data-yt="auto" ${h.__auto !== false ? 'checked' : ''}> auto</label></div>` : ''}
    ${cur && !selMode ? `<button class="yt-addcur" data-yt="addcur">${IC('ico:plus')} Add this video to a playlist</button>` : ''}
    ${inList ? `<div class="yt-lhead">${d.lists.length ? `<select data-yt="pick">${d.lists.map(l => `<option value="${l.id}" ${l === show ? 'selected' : ''}>${esc(l.name)} (${l.items.length})</option>`).join('')}</select>` : ''}<button data-yt="lnew">${IC('ico:plus')} New</button>${show ? `<button data-yt="lplayall" title="Play from the start">${IC('ico:play')}</button><button data-yt="lren" title="Rename">${IC('ico:edit')}</button><button data-yt="ldel" title="Delete playlist">${IC('ico:trash')}</button>` : ''}</div>` : ''}
    ${tab === 'search' && h.__q ? `<div class="yt-q">Results for “${esc(h.__q)}”</div>` : ''}
    ${items.length ? `<div class="yt-selbar">${selMode
      ? `<button data-yt="selall">${n === items.length ? 'None' : 'All'}</button><span class="grow">${n} selected</span><button data-yt="seladd" ${n ? '' : 'disabled'}>${IC('ico:plus')} Add to playlist</button>${tab !== 'search' ? `<button data-yt="selrm" ${n ? '' : 'disabled'} title="${inList ? 'Remove from this playlist' : 'Remove from Recent'}">${IC('ico:trash')}</button>` : ''}<button data-yt="seldone">Done</button>`
      : `<span class="grow"></span><button data-yt="selon" title="Select several videos to add or remove them together">${IC('ico:check')} Select</button>${tab === 'recent' ? '<button data-yt="rclear">Clear recent</button>' : ''}`}</div>` : ''}
    <div class="yt-list">${listBody}</div>
    ${h.__picker ? ytPickerHTML(h) : ''}`;
  const L = side.querySelector('.yt-list'); if (L) L.scrollTop = keepTop;
  if (h.__picker && h.__picker.focusNew) { h.__picker.focusNew = false; side.querySelector('[data-yt="newname"]')?.focus(); }
}
// "Add to playlist": pick an existing playlist (✓ = already has all of them) or type a name for a new one
function ytPickerHTML(h) {
  const d = ytData(), vs = h.__picker.items, ks = vs.map(ytKey);
  const has = l => ks.every(k => l.items.some(x => ytKey(x) === k));
  return `<div class="yt-picker"><div class="yt-pk-head"><b>Add ${vs.length === 1 ? 'this video' : vs.length + ' videos'} to…</b><button data-yt="pclose" title="Close">${IC('ico:close')}</button></div>
    <div class="yt-pk-list">${d.lists.map(l => `<button data-yt="padd" data-l="${l.id}" class="${has(l) ? 'has' : ''}"><span>${esc(l.name)}</span><small>${l.items.length}</small>${has(l) ? IC('ico:check') : ''}</button>`).join('') || '<div class="yt-none">No playlists yet: make one below.</div>'}</div>
    <div class="yt-pk-new"><input data-yt="newname" placeholder="New playlist name…"><button data-yt="pnew">${IC('ico:plus')} Create</button></div></div>`;
}
function ytAddTo(h, l, vs) {
  let added = 0;
  for (const v of vs) { if (l.items.some(x => ytKey(x) === ytKey(v))) continue; const n = { ...v }; delete n.at; l.items.push(n); added++; }
  for (const v of vs) if (!v.title) ytTitle(v).then(t => { if (!t) return; for (const x of l.items) if (ytKey(x) === ytKey(v)) x.title = t; save(); refreshWidgets('yt'); });
  h.__picker = null; h.__sel = null; save();
  toast(added ? `Added ${added === 1 ? '1 video' : added + ' videos'} to “${l.name}”.` : `Already in “${l.name}”.`);
  refreshWidgets('yt');
}
function ytClick(h, e) {
  const b = e.target.closest('[data-yt]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return; e.stopPropagation();
  const d = ytData(), act = b.dataset.yt, row = b.closest('[data-i]'), i = row ? +row.dataset.i : -1, tab = h.__tab || 'recent';
  const show = d.lists.find(l => l.id === (h.__showList || h.__list)) || d.lists[0];
  const items = ytTabItems(h), v = i >= 0 ? items[i] : null;
  const selected = () => items.filter(x => h.__sel?.has(ytKey(x)));
  if (act === 'side') { h.__sideOff = !h.__sideOff; return renderYt(h); }
  if (act === 'resume') return ytPlay(h, d.last, null);
  if (act === 'tab') { h.__tab = b.dataset.v; h.__sel = null; h.__picker = null; return renderYtSide(h); }
  if (act === 'play' && v) return ytPlay(h, v, tab === 'list' ? show.id : null);
  if (act === 'tsel' && v) return ytToggleSel(h, ytKey(v));
  if (act === 'lplayall' && show?.items.length) return ytPlay(h, show.items[0], show.id);
  if (act === 'prev' || act === 'next') return ytStep(h, act === 'next' ? 1 : -1);
  // selecting several
  if (act === 'selon') { h.__sel = new Set(); h.__picker = null; return renderYtSide(h); }
  if (act === 'seldone') { h.__sel = null; h.__picker = null; return renderYtSide(h); }
  if (act === 'selall') { h.__sel = h.__sel?.size === items.length ? new Set() : new Set(items.map(ytKey)); return renderYtSide(h); }
  // add to a playlist (one video, the playing one, or the selection)
  if (act === 'addcur' && h.__cur) { h.__picker = { items: [h.__cur] }; return renderYtSide(h); }
  if (act === 'add1' && v) { h.__picker = { items: [v] }; return renderYtSide(h); }
  if (act === 'seladd') { const vs = selected(); if (vs.length) h.__picker = { items: vs }; return renderYtSide(h); }
  if (act === 'pclose') { h.__picker = null; return renderYtSide(h); }
  if (act === 'padd' && h.__picker) { const l = d.lists.find(x => x.id === b.dataset.l); if (l) ytAddTo(h, l, h.__picker.items); return; }
  if (act === 'pnew' && h.__picker) {
    const inp = h.querySelector('[data-yt="newname"]'), name = inp?.value.trim();
    if (!name) { h.__picker.focusNew = true; renderYtSide(h); return toast('Type a name for the new playlist.'); }
    let l = d.lists.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) d.lists.push(l = { id: uid(), name, items: [] });
    return ytAddTo(h, l, h.__picker.items);
  }
  // remove
  if (act === 'rm1' && v) { if (tab === 'list' && show) show.items.splice(i, 1); else if (tab === 'recent') d.recent.splice(i, 1); }
  if (act === 'selrm') {
    const ks = new Set(selected().map(ytKey)); if (!ks.size) return;
    if (tab === 'list' && show) show.items = show.items.filter(x => !ks.has(ytKey(x)));
    else if (tab === 'recent') d.recent = d.recent.filter(x => !ks.has(ytKey(x)));
    h.__sel = new Set();
  }
  if (act === 'rclear' && d.recent.length) {
    const prev = d.recent.slice(); d.recent = [];
    undoToast('Cleared recent videos.', () => { d.recent = prev; save(); refreshWidgets('yt'); });
  }
  // playlists
  if (act === 'lnew') { h.__tab = 'list'; h.__picker = null; const n = prompt('Name for the new playlist:', ''); if (!n?.trim()) return renderYtSide(h); const l = { id: uid(), name: n.trim(), items: [] }; d.lists.push(l); h.__showList = l.id; }
  if (act === 'lren' && show) { const n = prompt('Rename the playlist:', show.name); if (n?.trim()) show.name = n.trim(); }
  if (act === 'ldel' && show && confirm(`Delete the playlist “${show.name}”? (The videos stay in Recent.)`)) { d.lists = d.lists.filter(l => l !== show); h.__showList = null; if (h.__list === show.id) h.__list = null; }
  if (act === 'up' && show && i > 0) [show.items[i - 1], show.items[i]] = [show.items[i], show.items[i - 1]];
  save(); refreshWidgets('yt');
}

// ---------- recorder: record the group, listen back, then save it or delete it
// REC = the recording in progress; PLAY = what the player at the top of the window is showing.
const REC = { state: 'idle' };   // idle | countin | rec | stopping | review
const PLAY = { au: null, view: null };   // view: null | 'review' | 'saved' | 'compare'
const fmtSec = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const recMime = () => !window.MediaRecorder ? '' : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
const recElapsed = () => REC.state !== 'rec' ? 0 : (REC.acc || 0) + (REC.paused ? 0 : Date.now() - REC.t0);
const recDefaultName = () => { const c = currentClass(), d = now(); return `${c ? c.name + ' ' : ''}${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
const recOpts = () => (S.settings.rec ||= { count: 'none', tempo: 0, beats: 0, aec: false });
const refreshRec = () => document.querySelectorAll('.wg-host[data-wg="rec"]').forEach(renderRec);
const recHosts = () => [...document.querySelectorAll('.wg-host[data-wg="rec"]')];
const playAu = () => { if (!PLAY.au) { const a = PLAY.au = new Audio(); a.preservesPitch = a.webkitPreservesPitch = true; a.onplay = a.onpause = a.onended = () => recHosts().forEach(h => { const b = h.querySelector('[data-rc="pp"]'); if (b) b.innerHTML = IC(a.paused ? 'ico:play' : 'ico:pause'); }); } return PLAY.au; };
// tempo for the count-in: what you typed, else the open Metronome's, else 100 / 4
function recTempo() { const o = recOpts(), m = winList().find(w => w.kind === 'metro')?.mu; return { tempo: o.tempo || m?.tempo || 100, beats: o.beats || m?.beats || 4 }; }

// --- mic level check (before recording)
async function recMeter(on) {
  if (!on) { REC.meter?.stream.getTracks().forEach(t => t.stop()); REC.meter = null; return refreshRec(); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const an = ac().createAnalyser(); an.fftSize = 1024; ac().createMediaStreamSource(stream).connect(an); ac().resume();
    REC.meter = { stream, an, openedAt: Date.now() }; refreshRec();
    const buf = new Float32Array(an.fftSize);
    const loop = () => {
      if (!REC.meter || REC.meter.an !== an) return;
      if (!recHosts().length) return recMeter(false);
      an.getFloatTimeDomainData(buf); let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
      const pct = Math.min(100, Math.round(Math.pow(pk, 0.6) * 100));
      recHosts().forEach(h => { const b = h.querySelector('.rec-lvl i'); if (b) { b.style.width = pct + '%'; b.className = pk > 0.95 ? 'clip' : pk > 0.5 ? 'hot' : ''; } const t = h.querySelector('.rec-lvl-t'); if (t) t.textContent = pk > 0.95 ? 'Too loud: move the device back' : pk < 0.02 ? 'Very quiet' : 'Good level'; });
      requestAnimationFrame(loop);
    };
    loop();
  } catch { toast('Rehearsal needs the microphone. Allow it and try again.'); }
}

// --- recording
const REC_WARM_MS = 1200;   // how long a freshly opened microphone gets to reach its level before recording
async function recBegin() {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return toast('Recording is not supported here.');
  playAu().pause(); closePlayer();
  const o = recOpts();
  let stream, openedAt;
  // A microphone that has just been switched on starts quiet and takes a moment to reach its level
  // (the device and macOS settle its gain). Reuse the stream from "Check mic level" when we can, and
  // otherwise let a new one warm up before recording starts, so the first notes aren't too soft.
  if (REC.meter && !o.aec && REC.meter.stream.getAudioTracks().some(t => t.readyState === 'live')) { stream = REC.meter.stream; openedAt = REC.meter.openedAt || 0; REC.meter = null; }
  else {
    if (REC.meter) recMeter(false);
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: !!o.aec, noiseSuppression: false, autoGainControl: false } }); }
    catch { return toast('Rehearsal needs the microphone to record. Allow it and try again.'); }
    openedAt = Date.now();
  }
  if (ac().state !== 'running') await ac().resume();
  REC.stream = stream;
  const warm = Math.max(0, openedAt + REC_WARM_MS - Date.now()) / 1000;   // seconds still needed
  if (o.count === 'none') {
    if (warm <= 0.05) return recGo();
    REC.state = 'countin'; REC.warm = true; refreshRec();
    REC.countT = setTimeout(() => { REC.warm = false; if (REC.state === 'countin') recGo(); }, warm * 1000);
    return;
  }
  // count-in: one bar of clicks, then recording starts (the click can keep going with "count + click");
  // if the mic still needs to warm up, the count-in starts a little later so recording begins after it
  const { tempo, beats } = recTempo(), c = ac(), beat = 60 / tempo, t0 = c.currentTime + Math.max(0.15, warm - beats * beat);
  REC.warm = false;
  for (let i = 0; i < beats; i++) metClick(t0 + i * beat, i === 0 ? 'down' : 'beat');
  REC.state = 'countin'; REC.count = beats; refreshRec();
  for (let i = 0; i < beats; i++) setTimeout(() => { REC.count = beats - i; recHosts().forEach(h => { const n = h.querySelector('.rec-count b'); if (n) { n.textContent = i + 1; n.classList.remove('hit'); void n.offsetWidth; n.classList.add('hit'); } }); }, (t0 - c.currentTime + i * beat) * 1000);
  REC.countT = setTimeout(() => { if (REC.state !== 'countin') return; recGo(); if (o.count === 'click') recClick(t0 + beats * beat, beat, beats); }, (t0 - c.currentTime + beats * beat) * 1000 - 30);
}
function recClick(next, beat, beats) {
  let i = 0; const c = ac();
  REC.clickT = setInterval(() => {
    if (REC.state !== 'rec') return clearInterval(REC.clickT);
    while (next < c.currentTime + 0.12) { if (!REC.paused) metClick(next, i % beats === 0 ? 'down' : 'beat'); next += beat; i++; }
  }, 25);
}
function recGo() {
  const stream = REC.stream, mime = recMime(), mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mr.onstop = () => recFinished(new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' }));
  const an = ac().createAnalyser(); an.fftSize = 2048; ac().createMediaStreamSource(stream).connect(an);
  Object.assign(REC, { state: 'rec', mr, an, live: [], marks: [], t0: Date.now(), acc: 0, paused: false, name: recDefaultName() });
  mr.start(1000); refreshRec(); recTick();
}
function recTick() {
  if (REC.state !== 'rec') return;
  if (!REC.paused) {
    const buf = new Float32Array(REC.an.fftSize); REC.an.getFloatTimeDomainData(buf);
    let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
    REC.live.push(pk); if (REC.live.length > 600) REC.live.shift();
  }
  recHosts().forEach(h => {
    const t = h.querySelector('.rec-time'); if (t) t.textContent = fmtSec(recElapsed() / 1000);
    const c = h.querySelector('canvas.rec-live-wave'); if (c) drawWave(c, REC.live, null, true);
  });
  requestAnimationFrame(recTick);
}
function recPause() {
  if (REC.state !== 'rec') return;
  if (REC.paused) { REC.mr.resume(); REC.t0 = Date.now(); REC.paused = false; }
  else { REC.mr.pause(); REC.acc += Date.now() - REC.t0; REC.paused = true; }
  refreshRec();
}
function recMark() { if (REC.state !== 'rec') return; REC.marks.push({ t: recElapsed() / 1000 }); refreshRec(); toast(`Marked ${fmtSec(recElapsed() / 1000)}`); }
function recStop() {
  if (REC.state === 'countin') { clearTimeout(REC.countT); REC.stream?.getTracks().forEach(t => t.stop()); REC.state = 'idle'; return refreshRec(); }
  if (REC.state !== 'rec') return;
  REC.dur = recElapsed() / 1000; REC.state = 'stopping'; clearInterval(REC.clickT);
  REC.mr.stop(); REC.stream.getTracks().forEach(t => t.stop()); refreshRec();
}
async function recFinished(blob) {
  REC.state = 'review'; REC.blob = blob;
  await openPlayer({ view: 'review', blob, dur: REC.dur, marks: REC.marks.slice(), name: REC.name });
}
function recDiscard() { for (const k of Object.keys(REC)) delete REC[k]; REC.state = 'idle'; closePlayer(); refreshRec(); }

// --- the player (review a new take, or open a saved recording)
async function decodePeaks(blob, n = 500) {
  const buf = await ac().decodeAudioData(await blob.arrayBuffer()), d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), peaks = [];
  for (let i = 0; i < n; i++) { let pk = 0; for (let j = i * step, e = Math.min(d.length, j + step); j < e; j++) pk = Math.max(pk, Math.abs(d[j])); peaks.push(pk); }
  return { buf, peaks, dur: buf.duration };
}
const miniPeaks = (peaks, n = 60) => Array.from({ length: n }, (_, i) => { const a = Math.floor(i * peaks.length / n), b = Math.max(a + 1, Math.floor((i + 1) * peaks.length / n)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, peaks[j] || 0); return Math.round(m * 100) / 100; });
async function recBlob(rec) { return memBlobs[rec.fileId] || new Blob([await (await fetch(fileDirectURL(rec.fileId))).arrayBuffer()], { type: S.files[rec.fileId]?.mime || 'audio/mp4' }); }
async function openPlayer(o) {
  const au = playAu(); au.pause();
  if (PLAY.url) URL.revokeObjectURL(PLAY.url);
  Object.assign(PLAY, { view: o.view, rec: o.rec || null, blob: o.blob, url: URL.createObjectURL(o.blob), dur: o.dur || 0, peaks: null, buf: null, loop: null, trim: null, marks: o.marks || [], name: o.name, sel: null });
  au.src = PLAY.url; au.playbackRate = PLAY.rate || 1;
  refreshRec();
  try { const r = await decodePeaks(o.blob); Object.assign(PLAY, { peaks: r.peaks, buf: r.buf, dur: r.dur }); if (o.rec && !o.rec.peaks) { o.rec.peaks = miniPeaks(r.peaks); o.rec.dur ||= r.dur; save(); } }
  catch { PLAY.peaks = REC.live?.slice() || []; }
  refreshRec(); playerTick();
}
function closePlayer() { PLAY.au?.pause(); if (PLAY.url) URL.revokeObjectURL(PLAY.url); Object.assign(PLAY, { view: null, url: null, blob: null, rec: null, cmp: null, buf: null }); }
async function openSaved(rec, play = true) {
  if (REC.state === 'review') return toast('Save or delete the new recording first.');
  try { await openPlayer({ view: 'saved', rec, blob: await recBlob(rec), dur: rec.dur, marks: (rec.marks || []).slice(), name: rec.name }); }
  catch { return toast('Could not open this recording.'); }
  if (play) playAu().play().catch(() => { });
}
// keep the waveform, time and A–B loop going while it plays
function playerTick() {
  const au = PLAY.au; if (!PLAY.view || !au) return;
  if (PLAY.loop && !au.paused && au.currentTime >= PLAY.loop[1]) au.currentTime = PLAY.loop[0];
  const tEnd = PLAY.trim ? PLAY.trim[1] : PLAY.dur;
  if (PLAY.trim && !au.paused && au.currentTime >= tEnd) { au.pause(); au.currentTime = PLAY.trim[0]; }
  recHosts().forEach(h => {
    const c = h.querySelector('canvas.rec-pwave'); if (c) drawPlayer(c);
    const t = h.querySelector('.rec-ptime'); if (t) t.textContent = `${fmtSec(au.currentTime)} / ${fmtSec(PLAY.dur || au.duration || 0)}`;
  });
  requestAnimationFrame(playerTick);
}
function drawPlayer(c) {
  const au = PLAY.au, d = PLAY.dur || 1;
  drawWave(c, PLAY.peaks || [], au ? au.currentTime / d : 0);
  const g = c.getContext('2d'), W = c.width, H = c.height, dpr = devicePixelRatio || 1, acc = getComputedStyle(c).getPropertyValue('--accent').trim() || '#f2c230';
  const shade = (a, b, col) => { g.globalAlpha = 1; g.fillStyle = col; g.fillRect(a / d * W, 0, (b - a) / d * W, H); };
  const sel = PLAY.sel || PLAY.loop;
  if (sel) { shade(sel[0], sel[1], 'rgba(255,255,255,.12)'); g.fillStyle = acc; g.fillRect(sel[0] / d * W - dpr, 0, 2 * dpr, H); g.fillRect(sel[1] / d * W - dpr, 0, 2 * dpr, H); }
  if (PLAY.trim) { shade(0, PLAY.trim[0], 'rgba(0,0,0,.45)'); shade(PLAY.trim[1], d, 'rgba(0,0,0,.45)'); }
  g.fillStyle = '#ff6b6b'; g.font = `700 ${10 * dpr}px system-ui`;
  PLAY.marks.forEach((m, i) => { const x = m.t / d * W; g.fillRect(x - dpr / 2, 0, dpr, H); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 9 * dpr, 4 * dpr); g.lineTo(x, 8 * dpr); g.fill(); g.fillText(String(i + 1), x + 3 * dpr, 18 * dpr); });
  if (au) { g.fillStyle = getComputedStyle(c).color; g.globalAlpha = .9; g.fillRect(au.currentTime / d * W - dpr, 0, 2 * dpr, H); g.globalAlpha = 1; }
}
/** peaks 0..1; live = newest on the right; prog = 0..1 played. */
function drawWave(c, peaks, prog, live) {
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (!r.width) return;
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const g = c.getContext('2d'), W = c.width, H = c.height, bw = 3 * dpr, gap = 2 * dpr, n = Math.floor(W / (bw + gap));
  g.clearRect(0, 0, W, H); g.globalAlpha = 1;
  const col = getComputedStyle(c).color, acc = getComputedStyle(c).getPropertyValue('--accent').trim() || '#f2c230';
  const src = peaks || [], data = live ? src.slice(-n) : Array.from({ length: n }, (_, i) => { const a = Math.floor(i * src.length / n), b = Math.max(a + 1, Math.floor((i + 1) * src.length / n)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, src[j] || 0); return m; });
  const max = live ? 0.5 : Math.max(0.05, ...data);
  data.forEach((v, i) => {
    const h = Math.max(2 * dpr, Math.min(1, v / max) * (H - 4 * dpr)), x = live ? W - (data.length - i) * (bw + gap) : i * (bw + gap);
    g.fillStyle = prog != null && i / n <= prog ? acc : col; g.globalAlpha = prog != null && i / n > prog ? 0.45 : 0.9;
    g.beginPath(); g.roundRect ? g.roundRect(x, (H - h) / 2, bw, h, bw / 2) : g.rect(x, (H - h) / 2, bw, h); g.fill();
  });
  g.globalAlpha = 1;
}
const miniWave = p => !p?.length ? '' : `<svg class="rec-mini" viewBox="0 0 ${p.length * 3} 20" preserveAspectRatio="none">${p.map((v, i) => { const h = Math.max(1.5, Math.min(1, v / Math.max(0.05, ...p)) * 18); return `<rect x="${i * 3}" y="${(20 - h) / 2}" width="2" height="${h}" rx="1"/>`; }).join('')}</svg>`;

// 16-bit mono WAV of part of a decoded recording (used when you trim before saving)
function encodeWav(buf, a, b) {
  const sr = buf.sampleRate, s0 = Math.floor(a * sr), s1 = Math.min(buf.length, Math.floor(b * sr)), n = Math.max(0, s1 - s0), ch = buf.numberOfChannels;
  const out = new DataView(new ArrayBuffer(44 + n * 2)), str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) { let v = 0; for (const c of chans) v += c[s0 + i]; v = Math.max(-1, Math.min(1, v / ch)); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}
async function recSave(name, addTab) {
  name = (name || '').trim() || recDefaultName();
  let blob = REC.blob, dur = PLAY.dur || REC.dur || 0, marks = PLAY.marks.slice(), peaks = PLAY.peaks || [];
  if (PLAY.trim && PLAY.buf) {
    const [a, b] = PLAY.trim; blob = encodeWav(PLAY.buf, a, b); dur = b - a;
    marks = marks.filter(m => m.t >= a && m.t <= b).map(m => ({ ...m, t: m.t - a }));
    const n = peaks.length; peaks = peaks.slice(Math.floor(a / PLAY.dur * n), Math.ceil(b / PLAY.dur * n));
  }
  const type = blob.type.split(';')[0], ext = /wav/.test(type) ? 'wav' : /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
  let fileId;
  try { fileId = await storeFile(new File([blob], `${name}.${ext}`, { type })); }
  catch { return toast('Could not save the recording.'); }
  const cls = currentClass();
  (S.recordings ||= []).unshift({ id: uid(), fileId, name, date: Date.now(), dur, classId: cls?.id || '', marks, peaks: miniPeaks(peaks) });
  if (addTab && cls) { cls.resources.push({ id: uid(), title: name, fileId }); P.stageKey = ''; }
  save(); toast(addTab && cls ? `Saved “${name}” and added it as a tab in ${cls.name}.` : `Saved “${name}”.`);
  recDiscard();
}
async function recExport(rec) {
  const m = S.files[rec.fileId]; if (!m) return toast('This recording is missing.');
  if (native('saveFile', { id: rec.fileId, name: m.name })) return;
  try {
    const blob = await recBlob(rec), file = new File([blob], m.name, { type: m.mime });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: rec.name });
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = m.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { if (e?.name !== 'AbortError') toast('Could not export the recording.'); }
}
// A/B compare: the same moment in two takes
async function cmpShow(which) {
  const c = PLAY.cmp; if (!c) return;
  const au = playAu(), t = au.currentTime, playing = !au.paused, rec = c[which];
  c.which = which;
  try { await openPlayer({ view: 'compare', rec, blob: await recBlob(rec), dur: rec.dur, marks: (rec.marks || []).slice(), name: rec.name }); } catch { return toast('Could not open the recording.'); }
  PLAY.cmp = c;
  const go = () => { au.currentTime = Math.min(t, (PLAY.dur || 1) - 0.05); if (playing) au.play().catch(() => { }); };
  if (au.readyState >= 1) go(); else au.addEventListener('loadedmetadata', go, { once: true });
  refreshRec();
}

function renderRec(h) {
  const cls = currentClass(), list = (S.recordings ||= []), st = REC.state, o = recOpts(), au = playAu();
  const isToday = r => dateKey(new Date(r.date)) === dateKey(new Date());
  const row = r => `<div class="rec-item ${PLAY.rec?.id === r.id ? 'cur' : ''} ${PLAY.cmpPick === r.id ? 'pick' : ''}" data-rid="${r.id}">
      <button class="rec-play" data-rc="open" title="Play">${IC(PLAY.rec?.id === r.id && !au.paused ? 'ico:pause' : 'ico:play')}</button>
      <div class="rec-info"><input data-rc-name value="${esc(r.name)}"><span>${new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${fmtSec(r.dur)}${r.marks?.length ? ` · ${r.marks.length} mark${r.marks.length > 1 ? 's' : ''}` : ''}${r.classId && r.classId !== cls?.id ? ' · ' + esc(S.classes.find(c => c.id === r.classId)?.name || '') : ''}</span></div>
      ${miniWave(r.peaks)}
      <span class="rec-acts"><button data-rc="cmp" title="Compare with another recording">A/B</button>
      <button data-rc="export" title="${IS_NATIVE ? `Save a copy to your ${DEVICE}` : 'Share or save a copy'}">${IC('ico:external')}</button>
      ${cls ? `<button data-rc="tab" title="Add as a tab in ${esc(cls.name)}">${IC('ico:pin')}</button>` : ''}
      <button data-rc="del" title="Delete">${IC('ico:trash')}</button></span></div>`;
  const today = list.filter(isToday), older = list.filter(r => !isToday(r));
  const player = () => {
    const c = PLAY.cmp;
    return `<div class="rec-player-card ${PLAY.view}">
      ${PLAY.view === 'review' ? '<div class="rec-q">Keep this recording?</div>' : PLAY.view === 'compare' ? `<div class="rec-cmp"><span class="me-seg"><button data-rc="cmpA" class="${c.which === 'a' ? 'on' : ''}">A · ${esc(c.a.name)}</button><button data-rc="cmpB" class="${c.which === 'b' ? 'on' : ''}">B · ${esc(c.b.name)}</button></span><span class="grow"></span><button data-rc="close" title="Close">${IC('ico:close')}</button></div>` : `<div class="rec-ph"><b>${esc(PLAY.name || '')}</b><span class="grow"></span><button data-rc="close" title="Close">${IC('ico:close')}</button></div>`}
      <div class="rec-player"><button class="rec-play big" data-rc="pp" title="Play / pause (Space)">${IC(au.paused ? 'ico:play' : 'ico:pause')}</button>
        <canvas class="rec-wave rec-pwave" title="Click to jump · drag to loop a section"></canvas></div>
      <div class="rec-ctl"><span class="rec-ptime">0:00 / ${fmtSec(PLAY.dur)}</span>
        <select data-rc-rate title="Playback speed">${[[0.5, '0.5×'], [0.75, '0.75×'], [1, '1×']].map(([v, l]) => `<option value="${v}" ${(PLAY.rate || 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button data-rc="markp" title="Add a marker here">${IC('ico:pin')} Mark</button>
        ${PLAY.loop ? `<button data-rc="unloop" class="on">${IC('ico:repeat')} ${fmtSec(PLAY.loop[0])}–${fmtSec(PLAY.loop[1])} ×</button>` : '<span class="rec-hint">Drag on the waveform to loop a section</span>'}
        ${PLAY.view === 'review' && PLAY.loop && PLAY.buf ? `<button data-rc="trim" title="Keep only the looped section when you save">Trim to this</button>` : ''}
        ${PLAY.trim ? `<button data-rc="untrim" class="on">Trimmed ${fmtSec(PLAY.trim[0])}–${fmtSec(PLAY.trim[1])} · undo</button>` : ''}</div>
      ${PLAY.marks.length ? `<div class="rec-marks">${PLAY.marks.map((m, i) => `<span class="rec-mk"><button data-rc="mjump" data-i="${i}">${i + 1} · ${fmtSec(m.t)}${m.label ? ' ' + esc(m.label) : ''}</button><button class="x" data-rc="mdel" data-i="${i}" title="Remove">${IC('ico:close')}</button></span>`).join('')}</div>` : ''}
      ${PLAY.view === 'review' ? `<label class="rec-name">Name <input data-rc-newname value="${esc(REC.name || '')}"></label>
        ${cls ? `<label class="rec-tab"><input type="checkbox" data-rc-addtab> Also add it as a tab in ${esc(cls.name)}</label>` : ''}
        <div class="rec-btns"><button class="danger" data-rc="discard">${IC('ico:trash')} Delete</button><button class="primary" data-rc="save">${IC('ico:check')} Save</button></div>` : ''}
    </div>`;
  };
  let top;
  if (st === 'countin') top = `<div class="rec-live rec-count"><div>${REC.warm ? 'Getting the microphone ready…' : 'Get ready…'}</div><b>${REC.warm ? '…' : 1}</b><button data-rc="stop">Cancel</button></div>`;
  else if (st === 'rec' || st === 'stopping') top = `<div class="rec-live ${REC.paused ? 'paused' : ''}">
      <div class="rec-status"><i class="rec-dot"></i>${REC.paused ? 'Paused' : 'Recording'}${REC.marks?.length ? ` <span class="rec-nm">${REC.marks.length} mark${REC.marks.length > 1 ? 's' : ''}</span>` : ''} <b class="rec-time">${fmtSec(recElapsed() / 1000)}</b></div>
      <canvas class="rec-wave rec-live-wave"></canvas>
      <div class="rec-btns"><button data-rc="mark" title="Drop a marker here to find it later (M)">${IC('ico:pin')} Mark</button><span class="grow"></span><button data-rc="pause">${IC(REC.paused ? 'ico:play' : 'ico:pause')} ${REC.paused ? 'Resume' : 'Pause'}</button><button class="rec-stop" data-rc="stop">${IC('ico:stop')} Stop</button></div></div>`;
  else if (PLAY.view) top = player();
  else {
    const { tempo, beats } = recTempo();
    top = `<div class="rec-idle"><button class="rec-big" data-rc="start" title="Start recording"><i></i></button>
      <div class="rec-opts">
        <label>Start <select data-rc-opt="count"><option value="none" ${o.count === 'none' ? 'selected' : ''}>Right away</option><option value="count" ${o.count === 'count' ? 'selected' : ''}>After a count-in</option><option value="click" ${o.count === 'click' ? 'selected' : ''}>Count-in + click</option></select></label>
        ${o.count !== 'none' ? `<label><input type="number" data-rc-opt="tempo" value="${tempo}" min="30" max="240"> BPM</label><label><input type="number" data-rc-opt="beats" value="${beats}" min="1" max="12"> beats</label>` : ''}
        ${o.count === 'click' ? `<label class="mu-chk" title="Uses echo cancellation to remove the click Rehearsal plays. It can make the music sound a little thinner."><input type="checkbox" data-rc-opt="aec" ${o.aec ? 'checked' : ''}> Keep the click out of the recording</label>` : ''}
        ${o.count !== 'none' ? metVolSlider('Click volume') : ''}
      </div>
      <div class="rec-meter">${REC.meter ? `<span class="rec-lvl"><i></i></span><span class="rec-lvl-t"></span><button data-rc="meter" class="on">Stop check</button>` : `<button data-rc="meter">${IC('ico:mic')} Check mic level</button>`}</div></div>`;
  }
  h.innerHTML = `<div class="rec">${top}
    <div class="rec-list">${list.length ? '' : '<div class="rec-lh">Saved recordings</div><div class="rec-none">None yet.</div>'}
      ${today.length ? `<div class="rec-lh">Today</div>${today.map(row).join('')}` : ''}
      ${older.length ? `<div class="rec-lh">Earlier</div>${older.map(row).join('')}` : ''}</div></div>`;
  if (PLAY.view) requestAnimationFrame(() => { const c = h.querySelector('canvas.rec-pwave'); if (c) drawPlayer(c); });

  h.onpointerdown = () => { window.__spaceTarget = 'rec'; };
  h.onfocusin = () => { window.__spaceTarget = 'rec'; };
  if (REC.state !== 'idle' || PLAY.view || !window.__spaceTarget) window.__spaceTarget = 'rec';
  // drag on the waveform = loop that section; click = jump there
  const pw = h.querySelector('canvas.rec-pwave');
  if (pw) pw.onpointerdown = e => {
    const r = pw.getBoundingClientRect(), d = PLAY.dur || 0; if (!d) return;
    const at = x => Math.max(0, Math.min(d, (x - r.left) / r.width * d)), x0 = e.clientX, a = at(x0);
    pw.setPointerCapture(e.pointerId);
    pw.onpointermove = ev => { if (Math.abs(ev.clientX - x0) > 4) { const b = at(ev.clientX); PLAY.sel = [Math.min(a, b), Math.max(a, b)]; drawPlayer(pw); } };
    pw.onpointerup = ev => {
      pw.onpointermove = pw.onpointerup = null;
      if (PLAY.sel && PLAY.sel[1] - PLAY.sel[0] > 0.3) { PLAY.loop = PLAY.sel; au.currentTime = PLAY.loop[0]; au.play().catch(() => { }); }
      else au.currentTime = at(ev.clientX);
      PLAY.sel = null; refreshRec();
    };
  };
  h.onclick = async e => {
    const b = e.target.closest('[data-rc]'); if (!b) return; e.stopPropagation();
    const act = b.dataset.rc, rec = list.find(r => r.id === b.closest('[data-rid]')?.dataset.rid);
    if (act === 'start') return recBegin();
    if (act === 'meter') return recMeter(!REC.meter);
    if (act === 'pause') return recPause();
    if (act === 'stop') return recStop();
    if (act === 'mark') return recMark();
    if (act === 'pp') { au.paused ? au.play().catch(() => { }) : au.pause(); return; }
    if (act === 'close') { closePlayer(); return refreshRec(); }
    if (act === 'markp') { PLAY.marks.push({ t: au.currentTime }); PLAY.marks.sort((x, y) => x.t - y.t); }
    if (act === 'mjump') { au.currentTime = PLAY.marks[+b.dataset.i].t; au.play().catch(() => { }); return; }
    if (act === 'mdel') PLAY.marks.splice(+b.dataset.i, 1);
    if (act === 'unloop') PLAY.loop = null;
    if (act === 'trim') { PLAY.trim = PLAY.loop; PLAY.loop = null; au.currentTime = PLAY.trim[0]; }
    if (act === 'untrim') PLAY.trim = null;
    if (['markp', 'mdel'].includes(act) && PLAY.rec) { PLAY.rec.marks = PLAY.marks.slice(); save(); }
    if (['markp', 'mdel', 'unloop', 'trim', 'untrim'].includes(act)) return refreshRec();
    if (act === 'cmpA' || act === 'cmpB') return cmpShow(act === 'cmpA' ? 'a' : 'b');
    if (act === 'save') return recSave(h.querySelector('[data-rc-newname]')?.value, h.querySelector('[data-rc-addtab]')?.checked);
    if (act === 'discard') { if (confirm('Delete this recording? It can\'t be undone.')) recDiscard(); return; }
    if (!rec) return;
    if (act === 'open') { if (PLAY.rec?.id === rec.id) { au.paused ? au.play().catch(() => { }) : au.pause(); return refreshRec(); } return openSaved(rec); }
    if (act === 'export') return recExport(rec);
    if (act === 'cmp') {
      if (REC.state === 'review') return toast('Save or delete the new recording first.');
      if (!PLAY.cmpPick || PLAY.cmpPick === rec.id) { PLAY.cmpPick = PLAY.cmpPick === rec.id ? null : rec.id; if (PLAY.cmpPick) toast('Now press A/B on the recording to compare it with.'); return refreshRec(); }
      const a = list.find(r => r.id === PLAY.cmpPick); PLAY.cmpPick = null; if (!a) return;
      PLAY.cmp = { a, b: rec, which: 'a' }; au.currentTime = 0; return cmpShow('a');
    }
    if (act === 'tab' && cls) { if (cls.resources.some(r => r.fileId === rec.fileId)) return toast(`It's already a tab in ${cls.name}.`); cls.resources.push({ id: uid(), title: rec.name, fileId: rec.fileId }); P.stageKey = ''; save(); return toast(`Added “${rec.name}” as a tab in ${cls.name}.`); }
    if (act === 'del') {
      if (!confirm(`Delete “${rec.name}”? It can't be undone.`)) return;
      if (PLAY.rec?.id === rec.id || PLAY.cmp?.a === rec || PLAY.cmp?.b === rec) closePlayer();
      S.recordings = list.filter(r => r !== rec);
      if (!S.classes.some(c => c.resources.some(r => r.fileId === rec.fileId))) deleteFile(rec.fileId);
      save(); refreshRec();
    }
  };
  h.onchange = e => {
    const el = e.target;
    if (el.dataset.rcRate != null) { PLAY.rate = +el.value; au.playbackRate = PLAY.rate; return; }
    if (el.dataset.rcOpt) { const k = el.dataset.rcOpt; o[k] = el.type === 'checkbox' ? el.checked : k === 'count' ? el.value : Math.max(1, +el.value || 0); save(); return refreshRec(); }
    if (el.dataset.rcName == null) return;
    const rec = list.find(r => r.id === el.closest('[data-rid]')?.dataset.rid); if (rec) { rec.name = el.value.trim() || rec.name; save(); }
  };
  h.oninput = e => { if (e.target.dataset.rcNewname != null) REC.name = e.target.value; };
}
// keys while the Recorder is open: M = mark (while recording), Space = play / pause the player
document.addEventListener('keydown', e => {
  if (VIEW !== 'present' || !recHosts().length || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('#bug-modal, #wn-modal, #av-cal, .tour-card')) return;
  if ((e.key === 'm' || e.key === 'M') && REC.state === 'rec') { e.preventDefault(); recMark(); }
  else if (e.key === ' ' && PLAY.view && window.__spaceTarget === 'rec') { e.preventDefault(); const au = playAu(); au.paused ? au.play().catch(() => { }) : au.pause(); }
});
