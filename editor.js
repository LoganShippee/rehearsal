'use strict';
// Setup editor tabs, automation timeline, notes/print, events, library, tutorials, settings & updates (loaded after app.js).
// ============================================================ EDITOR
const TABS = [['classes', 'Classes'], ['homework', 'Homework'], ['planning', 'Planning'], ['library', 'Library'], ['tutorials', 'Tutorials'], ['settings', 'Settings']];
// "Planning" holds what used to be four tabs. The one you used last is remembered on this device.
const PLAN_SUBS = [['schedule', 'Bell schedule'], ['routines', 'Daily routines'], ['notes', 'Notes & print'], ['events', 'Events']];
let PLAN_SUB = (() => { try { const v = localStorage.getItem('rehearsal-plan-tab'); return PLAN_SUBS.some(s => s[0] === v) ? v : 'schedule'; } catch { return 'schedule'; } })();
function planningTab() {
  const bar = `<div class="set-tabs" role="tablist">${PLAN_SUBS.map(([k, v]) => `<button type="button" role="tab" class="set-tab ${PLAN_SUB === k ? 'on' : ''}" aria-selected="${PLAN_SUB === k}" data-action="plan-sub" data-sub="${k}">${v}</button>`).join('')}</div>`;
  return bar + ({ schedule: scheduleTab, routines: routinesTab, notes: notesTab, events: eventsTab }[PLAN_SUB])();
}
// Before import/reset replaces everything: keep the old data (a spare copy in the browser, if it fits) and return an undo.
function keepOldData() {
  const old = JSON.stringify(S);
  try { localStorage.setItem('rehearsal-pre-reset', old); } catch { }
  return () => { S = JSON.parse(old); save(); renderEditor(); };
}
function renderEditor() {
  // a focused field that is about to be rebuilt can throw when it loses focus mid-rebuild
  try { const a = document.activeElement; if (a && a !== document.body && $('#e-main')?.contains(a)) a.blur(); } catch { }
  setTimeout(loadBackups, 0);                         // fills the backup list if Settings is showing
  const scroll = $('#e-main')?.scrollTop || 0;
  app().innerHTML = `<div class="editor">
    <header class="e-top"><button class="brand" data-action="tab" data-tab="settings" title="Rehearsal ${esc(WEB_VERSION)} — click for updates and Settings"><img class="brand-ico" src="icon-192.png" alt="" width="26" height="26"> Rehearsal <span class="ver">${esc(WEB_VERSION)}</span></button>
      <nav class="tabs">${TABS.map(([k, v]) => `<button class="tab ${TAB === k ? 'on' : ''}" data-action="tab" data-tab="${k}">${v}</button>`).join('')}</nav>
      <button class="btn primary" data-action="present">${IC('ico:play')} Present</button></header>
    <div class="e-main" id="e-main"><div class="e-wrap">${tabHTML()}</div></div></div>`;
  $('#e-main').scrollTop = scroll;
  if (TAB === 'homework' && typeof window.HW_TEACHER?.mount === 'function') window.HW_TEACHER.mount($('#hw-teacher-root'));
  if (TAB === 'settings' && typeof window.HW_TEACHER?.mountSettingsCard === 'function') window.HW_TEACHER.mountSettingsCard($('#hw-settings-card'));
}
function tabHTML() {
  switch (TAB) {
    case 'classes': return classesTab();
    case 'homework': return typeof window.HW_TEACHER?.renderTab === 'function' ? window.HW_TEACHER.renderTab() : '<div class="card"><div class="empty">Online Homework could not load.</div></div>';
    case 'planning': return planningTab();
    case 'library': return libraryTab();
    case 'tutorials': return helpTutorialsCard();
    case 'settings': return settingsTab();
  }
  return '';
}
window.__openHomeworkTab = () => { TAB = 'homework'; VIEW === 'edit' ? renderEditor() : go('edit'); };

// ---------- classes
function classesTab() {
  if (!SEL_CLASS || !S.classes.find(c => c.id === SEL_CLASS)) SEL_CLASS = S.classes[0]?.id || null;
  const cls = S.classes.find(c => c.id === SEL_CLASS);
  const list = `<div class="card"><div class="card-head"><h3>Classes</h3><span class="grow"></span><button class="btn small ic-btn" data-action="class-add">${IC('ico:plus')} Add</button></div>
    <div class="list">${S.classes.map(c => `<div class="list-item ${c.id === SEL_CLASS ? 'on' : ''}" data-action="class-sel" data-id="${c.id}"><span class="swatch" style="background:${c.theme.bg}"></span><span class="grow">${esc(c.name)}<br><span class="small muted">${esc(c.subtitle)}</span></span><span class="look-tag" title="Change this class's colours and background (Look, below)">✎ Change look</span></div>`).join('') || '<div class="empty">No classes yet.</div>'}</div></div>`;
  if (!cls) return `<div class="split">${list}<div class="card"><div class="empty">Add a class to get started.</div></div></div>`;
  const i = S.classes.indexOf(cls), base = `classes.${i}`;
  const th = cls.theme;
  const detail = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="card">
      <div class="card-head"><h2>Class details</h2><span class="grow"></span><button class="btn small" data-action="class-preview">${IC('ico:play')} Preview on screen</button><button class="btn small" data-action="clip-open">${IC('ico:clip')} Copy / paste</button><button class="btn small" data-action="icons-open">${IC('ico:icons')} Icons</button><button class="btn small" data-action="class-dup">Duplicate</button><button class="btn small danger" data-action="class-del">Delete</button></div>
      <div class="row"><label class="fld grow"><span>Name</span><input data-bind="${base}.name" data-rerender-blur value="${esc(cls.name)}"></label>
      <label class="fld grow"><span>Subtitle (period, room…)</span><input data-bind="${base}.subtitle" value="${esc(cls.subtitle)}"></label></div>
    </div>
    <div class="card"><h2>Look</h2><p class="desc">Each class gets its own colors so students instantly know which class they're in.</p>
      <div class="themes">${THEMES.map((t, k) => `<span class="theme-chip ${t.bg === th.bg && t.accent === th.accent ? 'on' : ''}" style="background:${t.bg};color:${t.text}" data-action="theme" data-k="${k}">${t.name} <span style="color:${t.accent}">●</span></span>`).join('')}</div>
      ${window.LOOKS?.rowHTML(cls) || ''}
      <div class="row" style="margin-top:12px">
        <label class="fld"><span>Background</span><input type="color" data-bind="${base}.theme.bg" data-rerender value="${th.bg}"></label>
        <label class="fld"><span>Accent</span><input type="color" data-bind="${base}.theme.accent" data-rerender value="${th.accent}"></label>
        <label class="fld"><span>Text</span><input type="color" data-bind="${base}.theme.text" data-rerender value="${th.text || '#ffffff'}"></label>
        <label class="fld"><span>Class title</span><input type="color" data-bind="${base}.theme.titleText" data-rerender value="${th.titleText || th.text || '#ffffff'}"></label>
        <label class="fld"><span>Clock</span><input type="color" data-bind="${base}.theme.clockText" data-rerender value="${th.clockText || th.text || '#ffffff'}"></label>
        ${th.titleText || th.clockText ? `<button class="btn small" data-action="theme-text-reset" style="align-self:flex-end">Match text</button>` : ''}
        <label class="fld grow"><span>Background image URL (optional)</span><input data-bind="${base}.theme.image" data-rerender value="${esc(th.image && !th.image.startsWith('file:') && !th.image.startsWith('bg:') ? th.image : '')}" placeholder="https://…"></label>
        <button class="btn small" data-action="theme-image" style="align-self:flex-end">Use a picture…</button>
        ${th.image ? `<button class="btn small" data-action="theme-image-clear" style="align-self:flex-end">Remove picture</button>` : ''}
      </div>
      <div class="lp-bgs" style="margin-top:8px"><span class="lp-lbl">Rehearsal backgrounds</span>${BACKGROUNDS.map(([k, n]) => `<button type="button" class="lp-bg ${th.image === 'bg:' + k ? 'on' : ''}" data-action="theme-bg" data-bg="${k}" title="${n}" aria-label="${n}" style="background-image:url(backgrounds/${k}.svg)"></button>`).join('')}</div>
      <div class="preview-strip" style="margin-top:12px;background-color:${th.bg};color:${th.text};${th.image ? `background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url('${esc(themeImgURL(th.image))}')` : ''}"><b style="font-size:20px;color:${th.titleText || th.text || '#fff'}">${esc(cls.name)}</b><span style="background:${th.accent};color:${th.bg};padding:3px 10px;border-radius:99px;font-weight:700;font-size:12px">Current step</span><b style="font-size:16px;color:${th.clockText || th.text || '#fff'}">10:15 AM</b></div>
    </div>
    <div class="card"><div class="card-head"><h2>Agenda</h2><span class="grow"></span><button class="btn small ic-btn" data-action="agenda-add">${IC('ico:plus')} Step</button></div>
      <p class="desc">Steps show on the side of the screen. Add minutes and the agenda moves forward on its own during class. Leave minutes blank to move it yourself (or with an automation).</p>
      ${cls.agenda.map((a, k) => `<div class="agenda-row"><span class="muted">${k + 1}.</span><input data-bind="${base}.agenda.${k}.text" value="${esc(a.text)}" placeholder="Step"><input type="number" min="0" data-type="num" data-bind="${base}.agenda.${k}.min" value="${a.min || ''}" placeholder="—"><span class="muted small">min</span><button class="iconbtn" data-action="agenda-del" data-k="${k}">${IC('ico:close')}</button></div>`).join('') || '<div class="empty">No steps yet.</div>'}
      ${cls.agenda.some(a => a.min) ? `<div class="small muted">Total: ${cls.agenda.reduce((s, a) => s + (Number(a.min) || 0), 0)} min</div>` : ''}
    </div>
    <div class="card"><h2>Warm-up question</h2><p class="desc">Shown big on the screen when no resource is selected.</p>
      <label class="chk" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input type="checkbox" data-bind="${base}.hideWarmup" ${cls.hideWarmup ? 'checked' : ''}> Hide the warm-up tab for this class</label>
      <label class="chk" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input type="checkbox" data-bind="${base}.sideProgress" ${cls.sideProgress ? 'checked' : ''}> Show the Progress tracker in the side panel</label>
      <textarea rows="3" data-bind="${base}.warmup" placeholder="What do you notice? What do you wonder?">${esc(cls.warmup)}</textarea></div>
    <div class="card"><div class="card-head"><h2>Resources</h2><span class="grow"></span>
        ${IS_NATIVE ? '<button class="btn small primary" data-action="drive-browse">Browse Google Drive…</button>' : ''}
        <button class="btn small ic-btn" data-action="res-add-url">${IC('ico:plus')} Link</button><button class="btn small ic-btn" data-action="res-add-file">${IC('ico:plus')} File (PDF, image, video, audio)</button></div>
      <p class="desc">Google Slides, Docs, Sheets, Forms, Drive files, YouTube, Canva or any web page, plus PDFs and images from your ${DEVICE}. They appear as tabs on the Present screen.</p>
      ${cls.resources.map((r, k) => `<div class="res-item"><span class="res-ico" style="font-size:18px">${resIcon(r) === '-' ? '' : IC(resIcon(r))}</span>
        <div class="row" style="gap:6px"><input class="grow" data-bind="${base}.resources.${k}.title" value="${esc(r.title)}" placeholder="Title">
        ${r.filesBrowser ? `<span class="pill">${IC('ico:folder')} Files browser</span>` : r.widget ? `<span class="pill">${IC(WIDGETS[r.widget.kind].icon)} ${WIDGETS[r.widget.kind].title}</span>` : r.music ? `<span class="pill">${IC(kindIcon(r.music.kind))} ${r.music.kind === 'tuner' ? 'Tuner & drone' : 'Metronome'}</span>` : r.sight ? `<span class="pill">${IC('ico:sight')} Sight-reading (${r.sight.mode})</span>` : r.score ? `<span class="pill">${IC('ico:score')} ${esc(r.score.name || S.files[r.score.fileId]?.name || 'Score')}</span>` : r.url != null ? `<input class="grow" data-bind="${base}.resources.${k}.url" value="${esc(r.url)}" placeholder="https://…" style="flex:2">` : `<span class="pill">${esc(S.files[r.fileId]?.name || 'missing file')}</span>`}
        ${resKind(r) === 'slides' || resKind(r) === 'doc' ? `<select data-bind="${base}.resources.${k}.mode" title="How it appears"><option value="embed" ${r.mode !== 'edit' ? 'selected' : ''}>Presenter view</option><option value="edit" ${r.mode === 'edit' ? 'selected' : ''}>Editor view</option></select>` : ''}</div>
        <span class="row" style="gap:2px"><button class="iconbtn" data-action="res-move" data-k="${k}" data-d="-1">${IC('ico:up')}</button><button class="iconbtn" data-action="res-move" data-k="${k}" data-d="1">${IC('ico:down')}</button><button class="iconbtn" data-action="res-del" data-k="${k}">${IC('ico:close')}</button></span></div>`).join('') || '<div class="empty">No resources yet.</div>'}
    </div>
    ${timelineCard(cls, i)}
    <div class="card"><h2>Roster</h2><p class="desc">One name per line. Used by the randomizer and group maker.</p>
      <textarea rows="6" data-type="lines" data-bind="${base}.roster" placeholder="Avery&#10;Jordan&#10;…">${esc(cls.roster.join('\n'))}</textarea></div>
  </div>`;
  return `<div class="split">${list}${detail}</div>`;
}

function autoRow(a, path, cls, k, kind) {
  const when = kind === 'class'
    ? `<input type="number" min="0" step="0.5" data-type="num" data-bind="${path}.offset" value="${a.offset ?? 0}"> min
       <select data-bind="${path}.anchor"><option value="start" ${a.anchor !== 'end' ? 'selected' : ''}>after start</option><option value="end" ${a.anchor === 'end' ? 'selected' : ''}>before end</option></select>`
    : `<input type="time" data-bind="${path}.time" value="${a.time || ''}">
       <div class="row" style="gap:3px">${DAYS_SHORT.map((d, di) => `<button class="btn small ${(a.days || []).includes(di) ? 'primary' : ''}" data-action="routine-day" data-k="${k}" data-d="${di}" style="padding:2px 6px">${d[0]}</button>`).join('')}</div>`;
  return `<div class="auto-row">
    <input type="checkbox" ${a.enabled !== false ? 'checked' : ''} data-bind="${path}.enabled" title="On/off">
    <div class="auto-when">${when}</div>
    <div class="auto-fields"><label class="fld"><span>Do this</span><select data-bind="${path}.action" data-rerender>${Object.entries(ACTION_TYPES).map(([v, l]) => `<option value="${v}" ${a.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${actionFields(a, path, cls)}</div>
    <button class="iconbtn" data-action="${kind === 'class' ? 'auto-del' : 'routine-del'}" data-k="${k}">${IC('ico:close')}</button></div>`;
}
function actionFields(a, base, cls) {
  const f = (label, html, wide = false) => `<label class="fld ${wide ? 'wide' : ''}"><span>${label}</span>${html}</label>`;
  const txt = (k, ph = '') => `<input data-bind="${base}.${k}" value="${esc(a[k] ?? '')}" placeholder="${esc(ph)}">`;
  const num = (k, step = 1, w = 80) => `<input type="number" min="0" step="${step}" data-type="num" data-bind="${base}.${k}" value="${a[k] ?? ''}" style="width:${w}px">`;
  const snd = k => `<select data-bind="${base}.${k}">${soundOptions(a[k] || 'chime')}</select>`;
  switch (a.action) {
    case 'message': return f('Message', txt('text', 'What should the screen say?'), true) + f('Seconds', num('seconds'));
    case 'timer': return f('Label', txt('label', 'e.g. Warm-up')) + f('Minutes', num('minutes', 0.5)) + f('End sound', snd('sound')) + f('Then show', txt('endMessage', "Time's up!"), true) +
      `<label class="chk"><input type="checkbox" data-bind="${base}.stopMusic" ${a.stopMusic ? 'checked' : ''}> Stop music at end</label>`;
    case 'sound': return f('Sound', snd('sound')) + `<button class="btn small" data-action="test-sound" data-s="${esc(a.sound || 'chime')}" style="align-self:flex-end">${IC('ico:play')} Test</button>`;
    case 'musicStart': {
      const af = audioFiles();
      if (!af.length) return `<div class="small muted" style="align-self:center">Add music files in the Library tab first.</div>`;
      return f('Music', `<select data-bind="${base}.fileId"><option value="">Choose…</option>${af.map(([id, x]) => `<option value="${id}" ${a.fileId === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) + f('Volume %', num('volume', 5)) +
        `<label class="chk"><input type="checkbox" data-bind="${base}.loop" ${a.loop !== false ? 'checked' : ''}> Loop</label>`;
    }
    case 'resource': return cls ? f('Resource', `<select data-bind="${base}.resourceId"><option value="">Choose…</option>${cls.resources.map(r => `<option value="${r.id}" ${a.resourceId === r.id ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>`) : '<div class="small muted">Shows a resource of the current class.</div>';
    case 'agenda': return cls ? f('Step', `<select data-type="num" data-bind="${base}.step">${cls.agenda.map((x, i) => `<option value="${i}" ${Number(a.step) === i ? 'selected' : ''}>${i + 1}. ${esc(x.text)}</option>`).join('')}</select>`) : f('Step #', num('step'));
    case 'signal': return f('Text', txt('text', 'Silent'), true) + f('Color', `<input type="color" data-bind="${base}.color" value="${a.color || '#e63946'}">`);
    default: return '';
  }
}

// ---------- schedule
function scheduleTab() {
  const opts = (sel, extra = '') => `${extra}${S.templates.map(t => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
  const today = new Date();
  const days = [...Array(14)].map((_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return d; });
  const ovs = Object.entries(S.overrides).sort(([a], [b]) => a.localeCompare(b));
  return `
  <div class="card"><h2>Weekly pattern</h2><p class="desc">Which bell schedule runs on each day of the week.</p>
    <div class="week">${DAYS_SHORT.map((d, i) => `<label class="fld"><span>${d}</span><select data-bind="weekdays.${i}" data-rerender>${opts(S.weekdays[i], `<option value="">No school</option>`)}</select></label>`).join('')}</div></div>
  <div class="card"><div class="card-head"><h2>Special days</h2><span class="grow"></span><button class="btn small" data-action="ov-add">+ Add date</button></div>
    <p class="desc">Early release, assemblies, holidays — swap in a different bell schedule (or no school) for one date.</p>
    ${ovs.length ? `<table class="tbl"><tr><th>Date</th><th>Schedule</th><th></th></tr>${ovs.map(([k, v]) => `<tr><td><input type="date" value="${esc(k)}" data-action-change="ov-date" data-old="${esc(k)}"> <span class="small muted">${longDate(parseKey(k))}</span></td><td><select data-bind="overrides.${k}" data-rerender>${opts(v, `<option value="none" ${v === 'none' ? 'selected' : ''}>No school</option>`)}</select></td><td style="width:30px"><button class="iconbtn" data-action="ov-del" data-k="${k}">${IC('ico:close')}</button></td></tr>`).join('')}</table>` : '<div class="empty">No special days.</div>'}
  </div>
  <div class="card"><h2>Next two weeks</h2>
    <div class="days14">${days.map(d => { const t = templateFor(d); return `<div class="day-cell ${dateKey(d) === dateKey(today) ? 'today' : ''}"><b>${DAYS_SHORT[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}</b>${t ? esc(t.name) : '<span class="muted">—</span>'}</div>`; }).join('')}</div></div>
  ${S.templates.map((t, ti) => `<div class="card">
    <div class="card-head"><input data-bind="templates.${ti}.name" value="${esc(t.name)}" style="font-weight:700;font-size:15px"><span class="grow"></span>
      <button class="btn small" data-action="tpl-dup" data-k="${ti}">Duplicate</button><button class="btn small danger" data-action="tpl-del" data-k="${ti}">Delete</button></div>
    <table class="tbl"><tr><th>Class</th><th style="width:150px">Starts</th><th style="width:150px">Ends</th><th style="width:30px"></th></tr>
    ${t.periods.map((p, pi) => {
      const bad = p.start && p.end && p.start >= p.end;
      return `<tr class="${bad ? 'per-bad' : ''}"><td><select data-bind="templates.${ti}.periods.${pi}.classId">${S.classes.map(c => `<option value="${c.id}" ${p.classId === c.id ? 'selected' : ''}>${esc(c.name)}${c.subtitle ? ' · ' + esc(c.subtitle) : ''}</option>`).join('')}</select>${bad ? '<div class="per-err">End time must be after start time (check AM/PM)</div>' : ''}</td>
      <td><input type="time" data-bind="templates.${ti}.periods.${pi}.start" data-rerender value="${p.start}"></td><td><input type="time" data-bind="templates.${ti}.periods.${pi}.end" data-rerender value="${p.end}"></td>
      <td><button class="iconbtn" data-action="per-del" data-k="${ti}" data-p="${pi}">${IC('ico:close')}</button></td></tr>`;
    }).join('')}</table>
    <button class="btn small" style="margin-top:8px" data-action="per-add" data-k="${ti}">+ Period</button></div>`).join('')}
  <button class="btn" data-action="tpl-add" style="align-self:flex-start">+ New bell schedule</button>`;
}

// ---------- routines
function routinesTab() {
  return `<div class="card"><div class="card-head"><h2>Daily routines</h2><span class="grow"></span><button class="btn small" data-action="routine-add">+ Add routine</button></div>
    <p class="desc">Things that happen at a set clock time, whatever class is on — morning music, lunch reminders, end-of-day announcements.</p>
    ${S.routines.map((r, k) => autoRow(r, `routines.${k}`, null, k, 'routine')).join('') || '<div class="empty">No routines yet.</div>'}
    <label class="chk" style="margin-top:10px"><span class="small muted">Routines only run on days that have a bell schedule if you tick “school days only” here:</span></label>
    ${S.routines.map((r, k) => `<label class="chk small" style="margin-right:12px"><input type="checkbox" data-bind="routines.${k}.schoolDaysOnly" ${r.schoolDaysOnly ? 'checked' : ''}> #${k + 1} school days only</label>`).join('')}
  </div>`;
}

// ============================================================ automation timeline (Classes tab)
// A class period laid out left→right. Lanes: Agenda, Messages, Timers, Sound & music, Screen.
// Drag an event to move it, drag its right-edge handle to change how long it lasts, drag a chip
// from the palette (or double-click a lane) to add one, click to select and edit details.
const TL_LANES = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'msg', label: 'Messages', types: ['message'], def: 'message' },
  { key: 'timer', label: 'Timers', types: ['timer'], def: 'timer' },
  { key: 'audio', label: 'Sound & music', types: ['sound', 'musicStart', 'musicStop'], def: 'sound' },
  { key: 'screen', label: 'Screen', types: ['resource', 'warmup', 'agenda', 'signal', 'clearSignal'], def: 'signal' },
];
const TL_PALETTE = [
  ['message', `${IC('ico:message')} Message`], ['timer', `${IC('ico:timer')} Timer`], ['sound', `${IC('ico:bell')} Sound`], ['musicStart', `${IC('ico:music')} Music`], ['musicStop', `${IC('ico:stop')} Stop music`],
  ['resource', `${IC('ico:image')} Resource`], ['warmup', `${IC('ico:warmup')} Warm-up`], ['agenda', `${IC('ico:agenda')} Agenda step`], ['signal', `${IC('ico:signal')} Signal`], ['clearSignal', `${IC('ico:close')} Clear signal`],
];
const TL_SNAP = 0.25;              // quarter-minute (15 s) steps
let TL_SEL = null;                 // automation id, or 'ag:<index>'
let TL = null;                     // active drag
const laneOf = type => TL_LANES.find(l => l.types && l.types.includes(type))?.key || 'screen';
const tlSnap = m => Math.round(m / TL_SNAP) * TL_SNAP;
const fmtMin = m => { const s = Math.round(m * 60), mm = Math.floor(s / 60), ss = s % 60; return ss ? `${mm}:${pad(ss)}` : `${mm} min`; };

/** How long this class's period is (longest on any bell schedule), plus a start time for clock labels. */
function classPeriod(cls) {
  let best = null;
  for (const t of S.templates) for (const p of t.periods) {
    if (p.classId !== cls.id || !p.start || !p.end) continue;
    const len = (atTime(new Date(), p.end) - atTime(new Date(), p.start)) / 60000;
    if (len > 0 && (!best || len > best.len)) best = { len, start: p.start };
  }
  return best || { len: 50, start: '' };
}
const tlDur = a => a.action === 'timer' ? (Number(a.minutes) || 1) : (a.action === 'musicStart' || a.action === 'signal') ? (Number(a.minutes) || 0) : 0;
const tlStart = (a, D) => a.anchor === 'end' ? D - (Number(a.offset) || 0) : (Number(a.offset) || 0);
function tlSetStart(a, t, D) { t = clamp(tlSnap(t), 0, D); a.offset = a.anchor === 'end' ? +(D - t).toFixed(2) : +t.toFixed(2); }
function tlLabel(a, cls) {
  switch (a.action) {
    case 'message': return (a.text || 'Message');
    case 'timer': return `${a.label || 'Timer'} · ${fmtMin(Number(a.minutes) || 1)}`;
    case 'sound': return (BUILTIN_SOUNDS[a.sound] || S.files[(a.sound || '').slice(5)]?.name || 'Sound');
    case 'musicStart': return (S.files[a.fileId]?.name || 'Music') + (a.minutes ? '' : ' →');
    case 'musicStop': return 'Stop music';
    case 'resource': return (cls.resources.find(r => r.id === a.resourceId)?.title || 'Resource');
    case 'warmup': return 'Warm-up';
    case 'agenda': return (cls.agenda[Number(a.step) || 0]?.text || `Step ${(Number(a.step) || 0) + 1}`);
    case 'signal': return (a.text || 'Signal');
    case 'clearSignal': return 'Clear signal';
  }
  return a.action;
}
/** Agenda steps as back-to-back blocks; steps without minutes share whatever time is left. */
function tlAgendaBlocks(cls, D) {
  const set = cls.agenda.reduce((s, x) => s + (Number(x.min) || 0), 0);
  const unset = cls.agenda.filter(x => !(Number(x.min) > 0)).length;
  const share = unset ? Math.max(1, (D - set) / unset) : 0;
  let t = 0;
  return cls.agenda.map((x, k) => { const len = Number(x.min) > 0 ? Number(x.min) : share; const b = { k, t, len, guess: !(Number(x.min) > 0), text: x.text }; t += len; return b; });
}
/** Put overlapping events of one lane on separate rows (markers count their label's width). */
function tlRows(items, D, cls) {
  const minPerPx = D / 760;   // approx. track width; good enough for spacing labels
  for (const it of items) {
    if (it.d > 0) { it.s = it.t; it.e = it.t + it.d; continue; }
    const w = Math.min(220, 7 * tlLabel(it.a, cls).length + 30) * minPerPx;
    it.flip = it.t > D * 0.7;
    it.s = it.flip ? it.t - w : it.t; it.e = it.flip ? it.t : it.t + w;
  }
  const rows = [];
  for (const it of [...items].sort((a, b) => a.s - b.s)) {
    let r = rows.findIndex(end => end <= it.s + 0.01);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = it.e; it.row = r;
  }
  return Math.max(1, rows.length);
}

function timelineCard(cls, ci) {
  const per = classPeriod(cls), D = per.len;
  const pct = m => (clamp(m, 0, D) / D * 100).toFixed(3) + '%';
  const step = D <= 30 ? 5 : D <= 70 ? 5 : D <= 120 ? 10 : 15;
  let ruler = '';
  for (let m = 0; m < D - step * 1.1; m += step) {
    const clock = per.start ? fmtHM(addMin(per.start, Math.round(m))) : '';
    ruler += `<div class="tl-tick" style="left:${pct(m)}"><span>${m === 0 ? 'Start' : m + 'm'}${clock ? `<em>${clock}</em>` : ''}</span></div>`;
  }
  ruler += `<div class="tl-tick end" style="left:100%"><span>End${per.start ? `<em>${fmtHM(addMin(per.start, Math.round(D)))}</em>` : ''}</span></div>`;

  const lanes = TL_LANES.map(L => {
    let body = '', rowsN = 1;
    if (L.key === 'agenda') {
      body = tlAgendaBlocks(cls, D).map(b => `<div class="tl-ev tl-ag ${b.guess ? 'guess' : ''} ${TL_SEL === 'ag:' + b.k ? 'sel' : ''}" data-tl-ag="${b.k}" style="left:${pct(b.t)};width:${pct(b.len)};top:4px"
          title="${esc(b.text)} — ${b.guess ? 'no length set (sharing leftover time)' : fmtMin(b.len)}"><span>${b.k + 1}. ${esc(b.text || 'Step')}</span><i class="tl-h" data-tl-handle="ag:${b.k}"></i></div>`).join('')
        || `<div class="tl-empty">Add agenda steps below to see them here.</div>`;
    } else {
      const items = cls.automations.map((a, k) => ({ a, k, t: tlStart(a, D), d: tlDur(a) })).filter(x => laneOf(x.a.action) === L.key);
      rowsN = tlRows(items, D, cls);
      body = items.map(({ a, t, d, row, flip }) => {
        const bar = d > 0, canGrow = ['timer', 'musicStart', 'signal'].includes(a.action);
        return `<div class="tl-ev ${bar ? 'bar' : 'mark'} ${!bar && flip ? 'flip' : ''} ${a.enabled === false ? 'off' : ''} ${TL_SEL === a.id ? 'sel' : ''} k-${a.action}" data-tl-id="${a.id}"
          style="left:${pct(t)};${bar ? `width:${pct(d)};` : ''}top:${4 + row * 30}px" title="${esc(tlLabel(a, cls))} — ${a.anchor === 'end' ? fmtMin(Number(a.offset) || 0) + ' before end' : fmtMin(Number(a.offset) || 0) + ' after start'}">
          <span>${esc(tlLabel(a, cls))}</span>${canGrow ? `<i class="tl-h" data-tl-handle="${a.id}" title="Drag to change how long it lasts"></i>` : ''}</div>`;
      }).join('');
    }
    return `<div class="tl-lane" data-tl-lane="${L.key}" style="height:${8 + rowsN * 30}px"><div class="tl-lane-label">${L.label}</div><div class="tl-track" data-tl-track="${L.key}">${body}</div></div>`;
  }).join('');

  const allOff = cls.automations.length > 0 && cls.automations.every(a => a.enabled === false);
  return `<div class="card"><div class="card-head"><h2>Automations timeline</h2><span class="grow"></span>${allOff ? `<button class="btn small primary" data-action="tl-enable-all" data-ci="${ci}">All off — Turn all on</button>` : ''}<span class="small muted">${fmtMin(D)} period${per.start ? ' · starts ' + fmtHM(per.start) : ''}</span></div>
    <p class="desc">Drag an event to move it. Drag its right edge to make it longer or shorter. Drag a chip onto the timeline, or double-click a lane, to add one. Click an event to edit it, and press Delete to remove it.</p>
    <div class="tl-palette">${TL_PALETTE.map(([t, l]) => `<span class="tl-chip k-${t}" data-tl-new="${t}">${l}</span>`).join('')}</div>
    <div class="tl" data-tl-class="${ci}" data-tl-d="${D}" style="--tickw:${(step / D * 100).toFixed(4)}%">
      <div class="tl-ruler"><div class="tl-lane-label"></div><div class="tl-track">${ruler}</div></div>
      ${lanes}
    </div>
    ${tlDetails(cls, ci, D)}
  </div>`;
}

function tlDetails(cls, ci, D) {
  if (TL_SEL && TL_SEL.startsWith('ag:')) {
    const k = +TL_SEL.slice(3), st = cls.agenda[k]; if (!st) return '';
    return `<div class="tl-details"><b>Agenda step ${k + 1}</b>
      <label class="fld wide"><span>Step</span><input data-rerender-blur data-bind="classes.${ci}.agenda.${k}.text" value="${esc(st.text)}"></label>
      <label class="fld"><span>Minutes</span><input type="number" min="0" data-type="num" data-rerender-blur data-bind="classes.${ci}.agenda.${k}.min" value="${st.min || ''}" style="width:80px"></label>
      <button class="btn small danger" data-action="agenda-del" data-k="${k}">Remove step</button></div>`;
  }
  const k = cls.automations.findIndex(a => a.id === TL_SEL);
  if (k < 0) return `<div class="tl-details muted small">Select an event to edit its details.</div>`;
  const a = cls.automations[k], path = `classes.${ci}.automations.${k}`;
  const fields = actionFields(a, path, cls).replace(/data-bind=/g, 'data-rerender-blur data-bind=');
  const grow = ['musicStart', 'signal'].includes(a.action)
    ? `<label class="fld"><span>Lasts (min, 0 = until stopped)</span><input type="number" min="0" step="0.5" data-type="num" data-rerender-blur data-bind="${path}.minutes" value="${a.minutes || 0}" style="width:90px"></label>` : '';
  return `<div class="tl-details">
    <label class="chk"><input type="checkbox" data-rerender data-bind="${path}.enabled" ${a.enabled !== false ? 'checked' : ''}> On</label>
    <label class="fld"><span>Do this</span><select data-rerender data-bind="${path}.action">${Object.entries(ACTION_TYPES).map(([v, l]) => `<option value="${v}" ${a.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="fld"><span>When</span><span class="row" style="gap:4px"><input type="number" min="0" step="0.25" data-type="num" data-rerender-blur data-bind="${path}.offset" value="${a.offset ?? 0}" style="width:70px"> min
      <select data-rerender data-bind="${path}.anchor"><option value="start" ${a.anchor !== 'end' ? 'selected' : ''}>after start</option><option value="end" ${a.anchor === 'end' ? 'selected' : ''}>before end</option></select></span></label>
    ${fields}${grow}
    <span class="grow"></span>
    <button class="btn small" data-action="tl-dup">Duplicate</button><button class="btn small danger" data-action="tl-del">Delete</button>
  </div>`;
}

function tlNewEvent(type, t, cls, D) {
  const a = { id: uid(), enabled: true, action: type, anchor: t > D / 2 ? 'end' : 'start', offset: 0 };
  ({
    message: () => Object.assign(a, { text: 'New message', seconds: 8 }),
    timer: () => Object.assign(a, { label: 'Timer', minutes: 3, sound: 'bell', endMessage: '' }),
    sound: () => Object.assign(a, { sound: 'chime' }),
    musicStart: () => Object.assign(a, { fileId: audioFiles()[0]?.[0] || '', volume: 70, loop: true, minutes: 0 }),
    resource: () => Object.assign(a, { resourceId: cls.resources[0]?.id || '' }),
    agenda: () => Object.assign(a, { step: 0 }),
    signal: () => Object.assign(a, { text: 'Silent', color: '#e63946', minutes: 0 }),
  }[type] || (() => { }))();
  tlSetStart(a, t, D);
  cls.automations.push(a); TL_SEL = a.id; save(); tlRerender();
}

// ---------- pointer handling
function tlCtx(el) {
  const tl = el.closest('.tl'); if (!tl) return null;
  const cls = S.classes[+tl.dataset.tlClass], D = +tl.dataset.tlD;
  const track = tl.querySelector('.tl-lane .tl-track').getBoundingClientRect();
  return { tl, cls, D, x0: track.left, ppm: track.width / D };
}
document.addEventListener('pointerdown', e => {
  if ((VIEW !== 'edit' && !P.autoDrawer) || e.button !== 0) return;
  const chip = e.target.closest('[data-tl-new]');
  if (chip) {
    e.preventDefault();
    const ghost = chip.cloneNode(true); ghost.classList.add('tl-ghost'); document.body.appendChild(ghost);
    TL = { mode: 'new', type: chip.dataset.tlNew, ghost, ctx: tlCtx($('.tl')) };
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    return;
  }
  const h = e.target.closest('[data-tl-handle]'), ev = e.target.closest('[data-tl-id], [data-tl-ag]');
  if (!h && !ev) return;
  const ctx = tlCtx(e.target); if (!ctx) return;
  e.preventDefault();
  const el = (h || ev).closest('.tl-ev');
  if (h) {
    const id = h.dataset.tlHandle;
    if (id.startsWith('ag:')) {
      const b = tlAgendaBlocks(ctx.cls, ctx.D)[+id.slice(3)];
      TL = { mode: 'ag', k: b.k, len0: b.len, sx: e.clientX, el, ctx };
    } else {
      const a = ctx.cls.automations.find(x => x.id === id);
      TL = { mode: 'grow', a, d0: tlDur(a), t0: tlStart(a, ctx.D), sx: e.clientX, el, ctx };
    }
  } else if (ev.dataset.tlAg != null) {
    TL_SEL = 'ag:' + ev.dataset.tlAg; TL = { mode: 'click', el, ctx };
  } else {
    const a = ctx.cls.automations.find(x => x.id === ev.dataset.tlId);
    TL = { mode: 'move', a, t0: tlStart(a, ctx.D), sx: e.clientX, moved: false, el, ctx };
  }
  el.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!TL) return;
  const { ctx } = TL;
  if (TL.mode === 'new') {
    TL.ghost.style.left = e.clientX + 'px'; TL.ghost.style.top = e.clientY + 'px';
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl');
    TL.ghost.classList.toggle('ok', !!over);
    return;
  }
  const dm = (e.clientX - (TL.sx ?? e.clientX)) / ctx.ppm;
  const pct = m => (m / ctx.D * 100) + '%';
  if (TL.mode === 'move') {
    if (Math.abs(e.clientX - TL.sx) > 3) TL.moved = true;
    const t = clamp(tlSnap(TL.t0 + dm), 0, ctx.D - Math.min(tlDur(TL.a), ctx.D));
    TL.t = t; TL.el.style.left = pct(t);
    TL.el.dataset.tip = fmtMin(t);
  } else if (TL.mode === 'grow') {
    const d = clamp(tlSnap(TL.d0 + dm), TL.a.action === 'timer' ? TL_SNAP : 0, ctx.D - TL.t0);
    TL.d = d; TL.el.classList.toggle('bar', d > 0); TL.el.style.width = d > 0 ? pct(d) : '';
    TL.el.dataset.tip = d > 0 ? fmtMin(d) : 'until stopped';
  } else if (TL.mode === 'ag') {
    const len = Math.max(1, Math.round(TL.len0 + dm));
    TL.len = len; TL.el.style.width = pct(len); TL.el.dataset.tip = len + ' min';
  }
});
document.addEventListener('pointerup', e => {
  if (!TL) return;
  const d = TL; TL = null;
  d.el?.classList.remove('dragging');
  if (d.mode === 'new') {
    d.ghost.remove();
    const tl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl');
    if (tl && d.ctx) { const t = (e.clientX - d.ctx.x0) / d.ctx.ppm; tlNewEvent(d.type, clamp(t, 0, d.ctx.D), d.ctx.cls, d.ctx.D); }
    return;
  }
  if (d.mode === 'move') {
    TL_SEL = d.a.id;
    if (d.moved && d.t != null) tlSetStart(d.a, d.t, d.ctx.D);
  } else if (d.mode === 'grow' && d.d != null) {
    d.a.minutes = +d.d.toFixed(2); TL_SEL = d.a.id;
  } else if (d.mode === 'ag' && d.len != null) {
    d.ctx.cls.agenda[d.k].min = d.len; TL_SEL = 'ag:' + d.k;
  }
  save(); tlRerender();
});
document.addEventListener('dblclick', e => {
  if (VIEW !== 'edit' && !P.autoDrawer) return;
  const track = e.target.closest('[data-tl-track]'); if (!track || e.target.closest('.tl-ev')) return;
  const L = TL_LANES.find(l => l.key === track.dataset.tlTrack); if (!L?.def) return;
  const ctx = tlCtx(track); if (!ctx) return;
  tlNewEvent(L.def, (e.clientX - ctx.x0) / ctx.ppm, ctx.cls, ctx.D);
});
document.addEventListener('keydown', e => {
  if ((VIEW !== 'edit' || TAB !== 'classes') && !P.autoDrawer) return; if (!TL_SEL || TL_SEL.startsWith('ag:')) return;
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); A['tl-del'](); }
});

// ---------- notes & print
let NOTE_CLASS = null, NOTE_DATE = dateKey(new Date());
function notesTab() {
  if (!NOTE_CLASS || !S.classes.find(c => c.id === NOTE_CLASS)) NOTE_CLASS = S.classes[0]?.id;
  const cls = S.classes.find(c => c.id === NOTE_CLASS);
  if (!cls) return '<div class="card"><div class="empty">Add a class first.</div></div>';
  const i = S.classes.indexOf(cls);
  const dates = Object.keys(cls.notes).filter(k => cls.notes[k]?.trim()).sort().reverse();
  return `<div class="card"><h2>Class notes</h2><p class="desc">Lesson notes for each class and day. Print them, save as PDF, or make a sub plan.</p>
    <div class="row"><select data-action-change="note-class">${S.classes.map(c => `<option value="${c.id}" ${c.id === NOTE_CLASS ? 'selected' : ''}>${esc(c.name)}${c.subtitle ? ' · ' + esc(c.subtitle) : ''}</option>`).join('')}</select>
      <button class="btn small" data-action="note-shift" data-d="-1">‹</button><input type="date" value="${NOTE_DATE}" data-action-change="note-date"><button class="btn small" data-action="note-shift" data-d="1">›</button>
      <button class="btn small" data-action="note-today">Today</button><span class="grow"></span>
      <button class="btn small" data-action="print-note">${IC('ico:print')} Print this note</button></div>
    <div style="margin-top:6px" class="small muted">${longDate(parseKey(NOTE_DATE))}${templateFor(parseKey(NOTE_DATE)) ? ' · ' + esc(templateFor(parseKey(NOTE_DATE)).name) : ' · no school'}</div>
    <textarea class="notes-area" style="margin-top:8px" data-bind="classes.${i}.notes.${NOTE_DATE}" placeholder="Objectives, materials, what you covered, reminders for next time…">${esc(cls.notes[NOTE_DATE] || '')}</textarea>
    <label class="fld" style="margin-top:10px"><span>Notes on screen this day (students see these on the Present screen, under Today)</span><textarea rows="3" data-bind="classes.${i}.screenNotes.${NOTE_DATE}" placeholder="Bring your folder, concert dress, …">${esc((cls.screenNotes || {})[NOTE_DATE] || '')}</textarea></label>
    ${dates.length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:6px">Days with notes</div><div class="note-dates">${dates.slice(0, 40).map(d => `<button class="btn small ${d === NOTE_DATE ? 'primary' : ''}" data-action="note-go" data-d="${d}">${d}</button>`).join('')}</div></div>` : ''}
  </div>
  <div class="card"><h2>Print & export</h2>
    <div class="row" style="margin-bottom:12px"><span class="small">Notes for <b>${esc(cls.name)}</b> from</span><input type="date" id="pr-from" value="${dates[dates.length - 1] || NOTE_DATE}"><span class="small">to</span><input type="date" id="pr-to" value="${dates[0] || NOTE_DATE}"><button class="btn" data-action="print-range">${IC('ico:print')} Print notes</button></div>
    <div class="row"><span class="small">Sub plan for</span><input type="date" id="sub-date" value="${NOTE_DATE}"><button class="btn primary" data-action="print-sub">${IC('ico:print')} Print sub plan</button>
      <span class="small muted">Includes the bell schedule, every class's agenda, warm-up, notes and roster.</span></div>
    <label class="fld" style="margin-top:12px"><span>Standing info for subs (procedures, helpful students, where things are)</span><textarea rows="4" data-bind="settings.subInfo">${esc(S.settings.subInfo)}</textarea></label>
    <p class="small muted" style="margin-bottom:0">Tip: in the print window, choose “Save as PDF” to share it.</p>
  </div>`;
}
function printHTML(title, html) {
  $('#print-area').innerHTML = `<h1>${esc(title)}</h1>${html}`;
  if (!native('print')) window.print();
}
function noteBlock(cls, k) {
  return `<h2>${esc(cls.name)}${cls.subtitle ? ' · ' + esc(cls.subtitle) : ''} — ${longDate(parseKey(k))}</h2><div class="blk">${esc(cls.notes[k] || '(no notes)')}</div>`;
}
function printSub(k) {
  const d = parseKey(k), periods = periodsFor(d);
  let h = `<div class="meta">${longDate(d)}, ${d.getFullYear()} · ${esc(templateFor(d)?.name || 'No bell schedule')}</div>`;
  if (S.settings.subInfo) h += `<h2>Important info</h2><div class="blk">${esc(S.settings.subInfo)}</div>`;
  const evs = eventsOn(d); if (evs.length) h += `<h2>Today</h2><ul>${evs.map(e => `<li>${esc(eventLabel(e))}${e.time ? ' — ' + fmtHM(e.time) : ''}</li>`).join('')}</ul>`;
  h += `<h2>Schedule</h2><ul>${periods.map(p => `<li>${fmtHM(p.start)}–${fmtHM(p.end)}: ${esc(p.cls?.name || '?')}${p.cls?.subtitle ? ' (' + esc(p.cls.subtitle) + ')' : ''}</li>`).join('') || '<li>No classes</li>'}</ul>`;
  for (const p of periods) {
    const c = p.cls; if (!c) continue;
    h += `<h2>${fmtHM(p.start)} · ${esc(c.name)}${c.subtitle ? ' — ' + esc(c.subtitle) : ''}</h2>`;
    if (c.warmup) h += `<div class="blk"><b>Warm-up:</b> ${esc(c.warmup)}</div>`;
    if (c.agenda.length) h += `<div class="blk"><b>Agenda:</b><ol>${c.agenda.map(a => `<li>${esc(a.text)}${a.min ? ` (${a.min} min)` : ''}</li>`).join('')}</ol></div>`;
    h += `<div class="blk"><b>Plan / notes:</b>\n${esc(c.notes[k] || '(none)')}</div>`;
    if (c.roster.length) h += `<div class="blk"><b>Roster (${c.roster.length}):</b> ${c.roster.map(esc).join(', ')}</div>`;
  }
  printHTML('Substitute Plan', h);
}

// ---------- events
function eventsTab() {
  const list = [...S.events].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return `<div class="card"><div class="card-head"><h2>Events & birthdays</h2><span class="grow"></span>
      <button class="btn small ic-btn" data-action="ev-add" data-kind="birthday">${IC('ico:plus')} Birthday</button><button class="btn small ic-btn" data-action="ev-add" data-kind="announcement">${IC('ico:plus')} Announcement</button><button class="btn small ic-btn" data-action="ev-add" data-kind="event">${IC('ico:plus')} Event</button>
      <button class="btn small" data-action="ev-ics">Import calendar (.ics)…</button></div>
    <p class="desc">Today's events show on the Present screen — for all classes, or only the classes you tick under "Show in". Add a time to pop it up full-screen at that moment (birthdays get confetti). Tip: in Google Calendar, use Settings → Import & export → Export to get an .ics file.</p>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><tr><th style="width:130px">Type</th><th style="width:150px">Date</th><th>Title / name</th><th style="width:120px">Pop-up time</th><th style="width:170px">Repeats</th><th style="width:170px">Show in</th><th style="width:30px"></th></tr>
    ${list.map(e => { const k = S.events.indexOf(e); return `<tr><td><select data-bind="events.${k}.kind"><option value="birthday" ${e.kind === 'birthday' ? 'selected' : ''}>Birthday</option><option value="announcement" ${e.kind === 'announcement' ? 'selected' : ''}>Announcement</option><option value="event" ${e.kind === 'event' ? 'selected' : ''}>Event</option></select></td>
      <td><input type="date" data-bind="events.${k}.date" value="${e.date || ''}"></td><td><input data-ev-id="${e.id}" data-bind="events.${k}.title" value="${esc(e.title)}"></td>
      <td><input type="time" data-bind="events.${k}.time" value="${e.time || ''}"></td><td>${repeatSel(e, `data-ev-repeat="${e.id}"`)}${evRepeat(e) && evRepeat(e) !== 'yearly' ? `<div class="small muted" style="margin-top:3px">until <input type="date" data-bind="events.${k}.until" value="${e.until || ''}" title="Last day (empty = forever)"></div>` : ''}</td>
      <td><details class="ev-cls"><summary>${esc(evWhere(e))}</summary><label><input type="checkbox" data-ev-all="${e.id}" ${!e.classes?.length ? 'checked' : ''}> All classes</label>
        ${S.classes.map(c => `<label><input type="checkbox" data-ev-cls="${e.id}" data-c="${c.id}" ${e.classes?.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</details></td>
      <td><button class="iconbtn" data-action="ev-del" data-k="${k}">${IC('ico:close')}</button></td></tr>`; }).join('')}</table></div>` : '<div class="empty">No events yet.</div>'}
    ${S.events.length > 1 ? '<button class="btn small danger" style="margin-top:10px" data-action="ev-clear-past">Remove past one-time events</button>' : ''}
  </div>`;
}
function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT') { if (ev && ev.date && ev.title) out.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(':'); if (i < 0) continue;
      const key = l.slice(0, i).split(';')[0], val = l.slice(i + 1);
      if (key === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ');
      if (key === 'DTSTART') {
        const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/); if (!m) continue;
        if (m[4] && val.endsWith('Z')) { const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])); ev.date = dateKey(d); ev.time = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
        else { ev.date = `${m[1]}-${m[2]}-${m[3]}`; if (m[4]) ev.time = `${m[4]}:${m[5]}`; }
      }
    }
  }
  return out;
}

// ---------- library
function libraryTab() {
  const files = Object.entries(S.files).sort((a, b) => (b[1].added || 0) - (a[1].added || 0));
  const usedBy = id => S.classes.filter(c => c.resources.some(r => r.fileId === id) || c.theme.image === 'file:' + id || c.automations.some(a => a.fileId === id || a.sound === 'file:' + id)).map(c => c.name).concat((S.savedLooks || []).filter(l => l.theme.image === 'file:' + id).map(l => 'Look: ' + l.name));
  return `<div class="card"><div class="card-head"><h2>Library</h2><span class="grow"></span><button class="btn small primary" data-action="lib-add">+ Add files…</button></div>
    <p class="desc">Music for transitions, sound effects, PDFs and pictures, stored on this ${DEVICE}. Music files can be used by “Start music” automations and as timer sounds.</p>
    ${files.length ? `<table class="tbl"><tr><th></th><th>Name</th><th>Type</th><th>Size</th><th>Used by</th><th></th></tr>${files.map(([id, f]) => `<tr><td style="width:30px">${f.mime.startsWith('audio/') ? IC('ico:audio') : f.mime === 'application/pdf' ? IC('ico:file') : f.mime.startsWith('image/') ? IC('ico:image') : f.mime.startsWith('video/') ? IC('ico:video') : IC('ico:attach')}</td>
      <td>${esc(f.name)}</td><td class="muted">${esc(f.mime)}</td><td class="muted">${(f.size / 1048576).toFixed(1)} MB</td><td class="muted small">${esc(usedBy(id).join(', ') || '—')}</td>
      <td style="width:110px">${f.mime.startsWith('audio/') ? `<button class="iconbtn" data-action="test-sound" data-s="file:${id}">${IC('ico:play')}</button><button class="iconbtn" data-action="music-stop-ed">${IC('ico:stop')}</button>` : ''}<button class="iconbtn" data-action="lib-del" data-id="${id}">${IC('ico:trash')}</button></td></tr>`).join('')}</table>` : '<div class="empty">Nothing here yet.</div>'}
  </div>`;
}

// ---------- Help & Tutorials feature guide (Settings + live interactive spotlight walkthroughs)
function tourEnsureTempWin(id, spec, sz = { x: 0.22, y: 0.08, w: 0.58, h: 0.78 }) {
  const list = winList();
  let w = list.find(x => x.id === id);
  if (!w) {
    w = { id, z: topZ(list) + 1, ...sz, ...spec, __tourTemp: true };
    list.push(w);
    WIN.sig = '';
    renderWins(context(now()), true);
  }
  return w;
}
function tourRemoveTempWins() {
  let changed = false;
  for (const k of Object.keys(S.windows || {})) {
    const before = S.windows[k].length;
    S.windows[k] = S.windows[k].filter(w => !w.__tourTemp);
    if (S.windows[k].length !== before) changed = true;
  }
  if (changed) { WIN.sig = ''; renderWins(context(now()), true); }
}
function tourFindOrOpenScore() {
  const cls = currentClass(), ctx = context(now());
  const scoreRes = cls?.resources?.find(r => r.score);
  if (scoreRes) {
    P.stageSel[ctx.key] = scoreRes.id; P.stageKey = ''; tick();
    return;
  }
  const scoreFile = Object.entries(S.files || {}).find(([id, f]) => f && !f.hiddenScore && typeof spIsScoreName === 'function' && spIsScoreName(f.name || ''));
  if (scoreFile) {
    const [fid, f] = scoreFile;
    const saved = S.scoreSettings?.[fid];
    tourEnsureTempWin('__tour_score', { kind: 'score', score: saved ? JSON.parse(JSON.stringify(saved)) : { fileId: fid, name: f.name } });
  } else {
    tourEnsureTempWin('__tour_score', { kind: 'score', score: { name: 'Score Practice' } });
  }
}
function tourClosePopovers() {
  if (P.winMenu) { P.winMenu = false; P.appPick = null; renderWinMenu(); }
  if (P.tools.timer) { delete P.tools.timer; renderTools(); }
  if (P.dockMore) { P.dockMore = false; renderDock(); }
  document.querySelectorAll('.sp-grmenu').forEach(el => el.remove());
  $('#bug-modal[data-tour-demo="1"]')?.remove();
}
const FEATURE_GUIDES = [
  {
    id: 'score',
    cat: 'Music',
    icon: 'ico:score',
    title: 'Score Practice, Voice Mixer & Vocal Recording',
    summary: 'Open MusicXML or MuseScore files, loop measures, play starting pitches for each part, record sung tracks, and grade parts note by note.',
    tips: [
      'Click a measure to start there, or drag across measures to set a loop.',
      'Click the bell icon next to any part for its starting pitch, or use Low → high and Chord.',
      'Click Record vocals to record a part either silently (no headphones) or with selected parts in headphones.',
    ],
    steps: [
      {
        setup: () => { tourClosePopovers(); tourFindOrOpenScore(); },
        delay: 140,
        sel: '.sp-top', fallback: '.score-host',
        title: 'Score Practice Bar',
        body: 'Pick a score, press Play, change tempo, or click a measure (or drag across measures) to set a start point or loop. Voices and Grade open from this bar too.',
      },
      {
        setup: () => {
          tourClosePopovers(); tourFindOrOpenScore();
          const voicesBtn = $('[data-sp="voices"]');
          if (voicesBtn && $('.sp-voices')?.hidden) voicesBtn.click();
        },
        delay: 120,
        sel: '.sp-voices:not([hidden])', fallback: '.sp-top',
        title: 'Voice Parts & Starting Pitches',
        body: 'Each part has a starting-pitch bell, volume slider, Focus, Solo, and a Sung/MIDI switch once recorded. Use All, Low → high, or Chord at the top to give pitches.',
      },
      {
        setup: () => {
          tourClosePopovers(); tourFindOrOpenScore();
          const voicesBtn = $('[data-sp="voices"]');
          if (voicesBtn && $('.sp-voices')?.hidden) voicesBtn.click();
          setTimeout(() => { const rb = $('[data-sp="rec-menu"]'); if (rb && !$('.sp-recmenu')) rb.click(); }, 60);
        },
        delay: 170,
        sel: '.sp-recmenu', fallback: '[data-sp="rec-menu"]',
        title: 'Record Vocals',
        body: 'Pick the part to record. Choose Silent Recording to mute playback after the count-in, or Headphones Recording and check whichever parts (including the part you are recording) and Click track you want to hear.',
      },
      {
        setup: () => {
          tourClosePopovers(); tourFindOrOpenScore();
          const gb = $('[data-sp="grade-menu"]');
          if (gb && !$('.sp-grmenu')) gb.click();
        },
        delay: 130,
        sel: '.sp-grmenu', fallback: '[data-sp="grade"]',
        title: 'Grading a Part',
        body: 'Choose which part to grade and your octave shift, then pick Microphone (Pitch & Rhythm), Microphone (Rhythm only), or Space bar (Tap rhythm). Results appear on the notes.',
      },
    ],
  },
  {
    id: 'sight',
    cat: 'Music',
    icon: 'ico:sight',
    title: 'Sight Reading & Grading',
    summary: 'Generate rhythm or solfege examples and grade them with the microphone or space bar.',
    tips: [
      'Click New to generate another example, or open Settings to change keys, rhythms, and range.',
      'After grading, click Listen back to hear your recording lined up with the example.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          const cls = currentClass(), ctx = context(now());
          const sr = cls?.resources?.find(r => r.sight);
          if (sr) { P.stageSel[ctx.key] = sr.id; P.stageKey = ''; tick(); }
          else tourEnsureTempWin('__tour_sr', { kind: 'sight', sr: srDefaults() });
        },
        delay: 140,
        sel: '.sr-top', fallback: '.sr-host',
        title: 'Sight Reading Controls',
        body: 'Switch between Rhythm and Solfege, adjust the tempo, click New for a fresh example, or press Play to hear it.',
      },
      {
        setup: () => {
          tourClosePopovers();
          if (!$('.sr-host')) tourEnsureTempWin('__tour_sr', { kind: 'sight', sr: srDefaults() });
        },
        delay: 90,
        sel: '[data-sr="grade"]', fallback: '.sr-host',
        title: 'Grade & Listen Back',
        body: 'Click Grade to sing, or tap the space bar along with the example. When finished, use Listen back to review your take.',
      },
    ],
  },
  {
    id: 'extapps',
    cat: 'Workspace',
    icon: 'ico:app',
    title: 'External Apps & Floating Agenda Bar',
    summary: 'Switch to another app on your computer while Rehearsal stays on top as a small agenda bar, or pin apps as workspace tabs.',
    tips: [
      'Open ＋ Open and click External Apps to see other open apps on your computer.',
      'Click Pin on an app to keep a tab for it in your main tab bar.',
      'Drag the edges of the floating agenda bar to resize it, and click Rehearsal when you want to come back.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          P.winMenu = true;
          P.appPick = IS_NATIVE ? 'loading' : { windows: [] };
          renderWinMenu(); renderDock();
          if (IS_NATIVE) native('listAppWindows');
        },
        delay: 140,
        sel: '.win-menu', fallback: '[data-dock-id="window"]',
        title: 'Opening External Apps',
        body: 'Open ＋ Open and click External Apps to list other open apps. Click an app to switch to it with Rehearsal floating on top, or click Pin to add it to your tabs.',
      },
      {
        setup: () => { tourClosePopovers(); },
        delay: 80,
        sel: '.tab-ext-app', fallback: '#stage-tabs',
        title: 'Pinned App Tabs',
        body: 'Pinned apps show up in this tab bar alongside your class tabs. Click a pinned app tab anytime to switch straight to it.',
      },
    ],
  },
  {
    id: 'web',
    cat: 'Workspace',
    icon: 'ico:web',
    title: 'Web Pages, Google Slides & Drawing',
    summary: 'Open websites and Google files in class tabs, run Google Slides in slideshow mode, and draw on top of pages.',
    tips: [
      'Google Docs, Sheets, Drive, and Search open in full browser mode so signing in works normally.',
      'Click Draw on page in the URL bar when you want to write over a webpage.',
      'On Google Slides tabs, click Slideshow to present slides inside Rehearsal.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          const cls = currentClass(), ctx = context(now());
          const wr = cls?.resources?.find(r => r.url);
          if (wr) { P.stageSel[ctx.key] = wr.id; P.stageKey = ''; tick(); }
          else tourEnsureTempWin('__tour_web', { kind: 'web', url: 'https://www.google.com', native: false });
        },
        delay: 120,
        sel: '#stage-webbar:not([hidden])', fallback: '.win[data-win="__tour_web"] .win-bar',
        title: 'Address Bar & Draw on Page',
        body: 'Type a web address or Google search here. Slides tabs include a Slideshow button, and Draw on page lets you write over a webpage.',
      },
      {
        setup: () => {
          tourClosePopovers();
          P.ink.on = true; P.ink.blank = false; P.ink.interact = false;
          updateInkUI(); renderDock();
        },
        delay: 90,
        sel: '.ink-bar', fallback: '[data-dock-id="annotate"]',
        title: 'Drawing Tools',
        body: 'Use Annotate in the toolbar to pick pen, highlighter, arrows, shapes, or eraser over anything on screen. Click the close button on this bar to stop drawing.',
      },
    ],
  },
  {
    id: 'timers',
    cat: 'Classroom',
    icon: 'ico:timer',
    title: 'Timers',
    summary: 'Start preset or custom timers, move and resize them on screen, or expand a timer to fill the workspace.',
    tips: [
      'Drag a running timer anywhere on screen, and drag the bottom-right corner to resize it.',
      'Click End under the timer name to stop and remove a timer.',
      'Click the maximize button in the top-right corner of a timer to fill the workspace while keeping the header and toolbar visible.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          P.timers = P.timers.filter(t => !t.__tourTemp); renderTimers();
          P.tools.timer = { x: 48, y: 112 };
          renderTools(); placeTool('timer', false); renderDock();
        },
        delay: 100,
        sel: '.tool[data-toolwin="timer"]', fallback: '[data-dock-id="timer"]',
        title: 'Starting a Timer',
        body: 'Click Timer in the toolbar to start a preset (30 sec, 1, 2, 3, 5, 10, or 15 min), or set a custom length, name, and sound and press Start.',
      },
      {
        setup: () => {
          tourClosePopovers();
          let tm = P.timers.find(t => t.id === '__tour_tm');
          if (!tm) {
            tm = { id: '__tour_tm', label: 'Demo Timer', total: 180000, endAt: Date.now() + 180000, pausedLeft: 180000, sound: 'bell', muted: true, full: false, __tourTemp: true };
            P.timers.push(tm);
          }
          tm.full = false;
          renderTimers();
        },
        delay: 100,
        sel: '.p-timer[data-tid="__tour_tm"]', fallback: '#p-timers',
        title: 'Moving & Resizing a Timer',
        body: 'Drag a running timer anywhere on screen, or drag its bottom-right corner to resize it. Use End under the timer name to stop it, or maximize in the top-right corner.',
      },
      {
        setup: () => {
          tourClosePopovers();
          let tm = P.timers.find(t => t.id === '__tour_tm');
          if (!tm) {
            tm = { id: '__tour_tm', label: 'Demo Timer', total: 180000, endAt: Date.now() + 180000, pausedLeft: 180000, sound: 'bell', muted: true, full: true, __tourTemp: true };
            P.timers.push(tm);
          } else tm.full = true;
          renderTimers();
        },
        delay: 100,
        sel: '.p-timer[data-tid="__tour_tm"] .tm-bar', fallback: '.p-timer[data-tid="__tour_tm"]',
        title: 'Full Workspace Timer',
        body: 'Maximizing fills the workspace area below the header so your class title, toolbar, and clock stay visible. Click the top-right restore button to shrink it back, or End to finish.',
      },
    ],
  },
  {
    id: 'files',
    cat: 'Workspace',
    icon: 'ico:folder',
    title: 'Files Browser & Pinning Files',
    summary: 'Search and filter your audio, PDFs, scores, images, and videos. Open files inside Files, pin the Files browser as a tab, or pin individual files as their own tabs.',
    tips: [
      'Click any file to open it inside the Files browser, then use ← Files to go back.',
      'Click Pin on a file (or Pin as own tab while viewing it) to give that file its own tab in the current class.',
      'Click the trash icon on any file to delete it from your library.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          tourEnsureTempWin('__tour_files', { kind: 'files' }, { x: 0.24, y: 0.08, w: 0.52, h: 0.78 });
        },
        delay: 120,
        sel: '.win[data-win="__tour_files"] .fb-top', fallback: '.win[data-win="__tour_files"]',
        title: 'Search & Filter Files',
        body: 'Type to search by file name, filter by Audio, PDF, Scores, Images, or Video, or click + Add files (or drag files in) to import new ones.',
      },
      {
        setup: () => {
          tourClosePopovers();
          tourEnsureTempWin('__tour_files', { kind: 'files' }, { x: 0.24, y: 0.08, w: 0.52, h: 0.78 });
        },
        delay: 90,
        sel: '.win[data-win="__tour_files"] .fb-list', fallback: '.win[data-win="__tour_files"]',
        title: 'Open, Pin, or Delete Files',
        body: 'Click a file to view or play it right inside Files. Use Pin to add a single file as its own class tab, or click the trash button to delete a file from your library.',
      },
      {
        setup: () => {
          tourClosePopovers();
          tourEnsureTempWin('__tour_files', { kind: 'files' }, { x: 0.24, y: 0.08, w: 0.52, h: 0.78 });
        },
        delay: 90,
        sel: '.win[data-win="__tour_files"] [data-action="win-pin"]', fallback: '.win[data-win="__tour_files"] .win-bar',
        title: 'Pin the Files Browser',
        body: 'Click the pin icon in the title bar (or Pin tab inside Files) to pin the Files browser itself as a tab in the current class.',
      },
    ],
  },
  {
    id: 'edit',
    cat: 'Classroom',
    icon: 'ico:edit',
    title: 'Quick Edit & Agenda',
    summary: 'Edit the class title, warm-up, and agenda right on the Present screen, and drag agenda items to reorder them.',
    tips: [
      'Click Quick edit in the toolbar to edit directly on screen without opening Setup.',
      'Use ‹ › on the Agenda card (or the Left/Right arrow keys) to move through steps.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          P.editMode = true; P.sideKey = ''; P.stageKey = '';
          renderDock(); tick();
        },
        delay: 120,
        sel: '#p-side', fallback: '[data-dock-id="editmode"]',
        title: 'Editing the Agenda on Screen',
        body: 'With Quick edit on, click agenda items to change the text or minutes, add or remove items, or drag them into a new order.',
      },
      {
        setup: () => {
          tourClosePopovers();
          P.editMode = true; P.sideKey = ''; P.stageKey = '';
          renderDock(); tick();
        },
        delay: 80,
        sel: '#p-title', fallback: '.p-head',
        title: 'Editing the Class Header',
        body: 'You can also edit the class name, subtitle, and warm-up right here. Click Quick edit again in the toolbar when you are done.',
      },
    ],
  },
  {
    id: 'bug',
    cat: 'Support',
    icon: 'ico:warn',
    title: 'Reporting a Bug',
    summary: 'Press ⌘⇧B (or open ⋯ → Report a bug) to capture a screenshot and explain what went wrong.',
    tips: [
      'Uncheck "Include screenshot" if student names are visible on screen.',
      'You can also save the report as an HTML file with Save File… if you are offline.',
    ],
    steps: [
      {
        setup: () => {
          tourClosePopovers();
          window.__bugReportOpen({ screenshot: '', os: navigator.platform || 'Desktop', version: WEB_VERSION || '', logTail: '', tourDemo: true });
        },
        delay: 110,
        sel: '.bug-card', fallback: '#p-dock .dock-more',
        title: 'Report a Bug (⌘⇧B)',
        body: 'Open ⋯ → Report a bug or press ⌘⇧B (Ctrl+Shift+B) from any screen. Rehearsal takes a screenshot automatically, lets you write what happened, and attaches your app version and OS.',
      },
    ],
  },
];
function helpTutorialsCard() {
  const q = (P.helpSearch || '').trim().toLowerCase();
  const list = FEATURE_GUIDES.filter(g => !q || (g.title + ' ' + g.summary + ' ' + g.cat + ' ' + g.tips.join(' ')).toLowerCase().includes(q));
  return `<div class="card help-card" id="settings-help">
    <div class="card-head">
      <h2>Tutorials</h2>
      <span class="grow"></span>
      <button class="btn small" data-action="whats-new">${IC('ico:book')} What's New</button>
      <button class="btn small primary" data-action="tour-replay">${IC('ico:play')} Full Tour</button>
      <button class="btn small" data-action="bug-report">${IC('ico:warn')} Report a Bug</button>
    </div>
    <p class="desc">Pick a feature below for quick notes, or click <b>Show me</b> to open it on the Present screen and walk through the controls.</p>
    <input class="help-search" data-help-search placeholder="Search tutorials (timer, grading, files, vocals, slides)…" value="${esc(P.helpSearch || '')}">
    <div class="help-grid">
      ${list.length ? list.map(g => `<details class="help-item" ${q ? 'open' : ''}>
        <summary>
          <span class="help-ic">${IC(g.icon)}</span>
          <span class="help-meta"><b>${esc(g.title)}</b><small>${esc(g.summary)}</small></span>
          <span class="help-cat">${esc(g.cat)}</span>
        </summary>
        <div class="help-body">
          <ul>${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          <div class="help-acts">
            <button class="btn small primary" data-action="feature-tour" data-fid="${g.id}">Show me →</button>
          </div>
        </div>
      </details>`).join('') : '<div class="empty">No matching tutorials found.</div>'}
    </div>
  </div>`;
}

// ---------- settings
function settingsTab() {
  const sim = S.settings.sim;
  // Each card is built here as before; web/settings.js (SETTINGS_UI) arranges them into the Features and Setup & backup tabs.
  const cards = {
  coffee: `${COFFEE_URL ? `<div class="card coffee"><h2>Support Rehearsal</h2><p class="desc">Rehearsal is free. If it saves you time in class, you can buy me a coffee. Thank you!</p>
    <button class="btn coffee-btn" data-action="open-external" data-url="${COFFEE_URL}">${IC('ico:coffee')} Buy me a coffee</button></div>` : ''}`,
  updates: updatesCard(),
  cloud: typeof window.HWSYNC?.renderCard === 'function' ? window.HWSYNC.renderCard() : '',
  homework: typeof window.HW_TEACHER?.renderSettingsCard === 'function' ? window.HW_TEACHER.renderSettingsCard() : '',
  present: `<div class="card"><h2>Present screen</h2>
    <label class="fld"><span>Before-school welcome message</span><textarea rows="2" data-bind="settings.welcome">${esc(S.settings.welcome)}</textarea></label>
    <label class="fld" style="margin-top:10px"><span>After-school message</span><input data-bind="settings.afterSchool" value="${esc(S.settings.afterSchool)}"></label>
    <div class="row" style="margin-top:12px"><label class="chk"><input type="checkbox" data-bind="settings.use24h" ${S.settings.use24h ? 'checked' : ''}> 24-hour clock</label>
      <label class="chk"><input type="checkbox" data-bind="settings.showSeconds" ${S.settings.showSeconds ? 'checked' : ''}> Show seconds</label>
      <span class="small muted">Toolbar size, labels and shrinking: ⋯ → Customize toolbar on the Present screen.</span></div></div>`,
  test: `<div class="card"><h2>Test mode</h2><p class="desc">Pretend it's a different time so you can watch your automations run. The Present screen shows a red TEST TIME badge while this is on.</p>
    <div class="row"><label class="chk"><input type="checkbox" data-action-change="sim-on" ${sim.on ? 'checked' : ''}> Pretend the time is</label><input type="time" value="${sim.time}" data-action-change="sim-time">
    <span class="small muted">Tip: set it to a minute before a class starts.</span></div></div>`,
  drive: `${IS_NATIVE ? `<div class="card"><h2>Google Drive</h2><p class="desc">“Browse Google Drive…” (in a class's Resources) opens Drive in its own window. Sign in there once with your school account, exactly like in Safari. Open a file, then click <b>Use this file</b>.</p>
    <button class="btn" data-action="drive-open">Open Google Drive window</button>
    <p class="small muted">If a Google file shows “You need access” or a sign-in page on the Present screen, use the <b>Drive window</b> button on that tab instead. It always works because it's the same as Drive itself.</p></div>` : ''}`,
  bookmarks: bookmarksCard(),
  grading: `<div class="card"><h2>Sight-reading grading</h2><p class="desc">While you grade, the take is kept in memory so you can listen back to it. It's thrown away when you make a new example or grade again.</p>
    <div style="margin:8px 0 10px">${typeof grStrictnessSlider === 'function' ? grStrictnessSlider(80) : ''}</div>
    ${HAS_SERVER ? `<label class="chk"><input type="checkbox" data-action-change="grlog-toggle" ${S.settings.saveGradeRecordings ? 'checked' : ''}> Also save the last 20 takes on this Mac for troubleshooting the grader</label>
    <p class="small muted">Off unless you turn it on. Turning it off deletes any saved takes.</p>` : ''}</div>`,
  backups: `${HAS_SERVER ? `<div class="card"><h2>Automatic backups</h2><p class="desc">Each day you use Rehearsal it keeps a dated copy of your classes, tabs, agendas and settings (the newest 30). If something goes missing, restore an earlier day here. Restoring first saves what you have now, so you can always undo it.</p>
    <div class="row"><button class="btn" data-action="backup-now">Back up now</button><span class="grow"></span></div>
    <div id="backup-list" class="backup-list"><div class="small muted">Loading…</div></div></div>` : ''}`,
  sound: `<div class="card"><h2>Sound and playhead sync</h2><p class="desc">Music volume sets how loud sight reading and scores play. If the moving playhead (sight reading, scores) is ahead of or behind the sound on this ${DEVICE}, calibrate it: tap along with 8 clicks and Rehearsal measures the delay. Bluetooth speakers usually need more. Kept separately on each device.</p>
    <div class="row"><span style="width:9em">Playhead delay</span><input type="range" min="-200" max="600" step="10" value="${avDelayMs()}" data-action-input="av-delay" style="flex:1;max-width:320px"><b class="av-val">${avDelayMs()} ms</b><button class="btn" data-action="av-cal">Calibrate…</button></div>
    <div class="row" style="margin-top:8px"><span style="width:9em">Music volume</span><input type="range" min="0.5" max="3" step="0.1" value="${musicVol()}" data-action-input="music-vol" style="flex:1;max-width:320px"><b>${Math.round(musicVol() * 100)}%</b><button class="btn" data-action="vol-test">Test</button><button class="btn" data-action="audio-reset" title="Restart the sound engine without reopening Rehearsal (useful if audio glitches after switching speakers or sleeping)">Reset sound</button></div>
    <div class="row" style="margin-top:8px"><span style="width:9em">Metronome volume</span><input type="range" min="0" max="2" step="0.05" value="${metVol()}" data-metvol style="flex:1;max-width:320px"><b class="mv-v">${Math.round(metVol() * 100)}%</b></div></div>`,
  rhythm: `<div class="row" style="margin-top:8px"><span style="width:9em">Rhythm counts</span><select data-action-change="rhythm-sys">${(typeof RHYTHM_SYSTEMS !== 'undefined' ? RHYTHM_SYSTEMS : [['numbers', 'Numbers (1 e & a)']]).map(([v, l]) => `<option value="${v}" ${(S.settings.rhythmSystem || 'numbers') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="small muted">Used in Sight Reading, Score Practice, and Warm-up notation.</span></div>`,
  backup: `<div class="card"><h2>Backup</h2><p class="desc">Your classes and settings are saved on this ${DEVICE} automatically. Export a backup file to move them to another Mac or the web version in any browser (Import backup there). Library files (music, PDFs, pictures) aren't in the backup file, so add them again on the other device.</p>
    <div class="row"><button class="btn" data-action="export">Export backup…</button><button class="btn" data-action="import">Import backup…</button><span class="grow"></span><button class="btn danger" data-action="reset">Start over with the template</button></div></div>`,
  };
  // without settings.js, show every card in one column, in the original order
  if (window.SETTINGS_UI) return window.SETTINGS_UI.render(cards);
  const { rhythm, sound, ...rest } = cards;
  return Object.values(rest).join('\n') + sound.replace(/<\/div>$/, rhythm + '</div>');
}
// your Buy Me a Coffee page (shown in Settings when set)
const COFFEE_URL = 'https://buymeacoffee.com/loganshippee';

// ---------- updates (the Mac app checks GitHub; see native/updater.swift)
let UPD = { state: 'idle' }, WEB_VERSION = '';
fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => { if (v) { WEB_VERSION = v.version; settleUpdate(); refreshUpdateUI(); noteUpdated(); document.querySelectorAll('.brand .ver').forEach(el => { el.textContent = WEB_VERSION; }); } }).catch(() => { });
// After an update (Mac restart, or the iPad loading a new release), say so once.
function noteUpdated() {
  let last = null; try { last = localStorage.getItem('rehearsal-version'); localStorage.setItem('rehearsal-version', WEB_VERSION); } catch { return; }
  if (!last || last === WEB_VERSION) return;
  const b = document.createElement('div'); b.className = 'upd-banner upd-done';
  b.innerHTML = `<span>${IC('ico:good')} Updated to Rehearsal <b>${esc(WEB_VERSION)}</b>.</span><button class="btn small" data-action="upd-done-close">OK</button>`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 12000);
}
function updateStatusText() {
  const u = UPD, v = u.version ? ` ${esc(u.version)}` : '';
  return {
    off: 'Automatic updates are not set up in this copy.',
    idle: IS_NATIVE ? 'Rehearsal checks for updates when it opens and every few hours.' : 'Rehearsal checks for updates when it opens and every few hours. Press Check for updates to look now.',
    checking: 'Checking for updates…',
    none: 'You have the newest version.',
    downloading: `Downloading version${v}…`,
    'web-ready': IS_NATIVE ? `Version${v} is ready. It's used the next time Rehearsal opens, or restart it now.` : `Version${v} is ready. Reload to start using it.`,
    app: u.manual ? `Version${v} is available. Rehearsal can't replace itself where it is, so the download page was opened: drag the new Rehearsal into Applications.` : `Version${v} is available. Installing it reopens Rehearsal.`,
    installing: `Installing version${v}… Rehearsal will reopen.`,
    error: esc(u.message || 'Something went wrong.'),
  }[u.state] || '';
}
// the status as a coloured badge: busy (spinner), up to date (green), restart / install needed (amber), problem (red)
function updateBadge() {
  const st = UPD.state, txt = updateStatusText(); if (!txt) return '';
  const kind = { checking: 'busy', downloading: 'busy', installing: 'busy', none: 'ok', 'web-ready': 'todo', app: 'todo', error: 'bad' }[st] || 'info';
  const icon = { busy: '<span class="upd-spin"></span>', ok: IC('ico:good'), todo: IC('ico:warn'), bad: IC('ico:warn'), info: '' }[kind];
  const head = { none: 'Up to date. ', 'web-ready': IS_NATIVE ? 'Restart needed. ' : 'Reload needed. ', app: 'Install needed. ' }[st] || '';
  return `<div class="upd-status upd-${kind}" id="upd-status">${icon}<span><b>${head}</b>${txt}</span></div>`;
}
function updatesCard() {
  const u = UPD;
  if (!IS_NATIVE) return `<div class="card" id="upd-card"><h2>Updates</h2>
    <p class="desc">Version <b>${esc(WEB_VERSION || '?')}</b>. The newest version loads whenever Rehearsal is opened with an internet connection. Your classes and files are never touched.</p>
    <div class="row"><button class="btn" data-action="upd-check" ${u.state === 'checking' ? 'disabled' : ''}>${u.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>
      ${u.state === 'web-ready' ? '<button class="btn primary" data-action="upd-apply">Reload now</button>' : ''}</div>
    ${updateBadge()}</div>`;
  return `<div class="card" id="upd-card"><h2>Updates</h2>
    <p class="desc">Version <b>${esc(WEB_VERSION || u.current || '?')}</b>. Updates are downloaded from GitHub and checked against Rehearsal's signature before they're used. Your classes and files are never touched.</p>
    <div class="row"><button class="btn" data-action="upd-check" ${['off', 'checking', 'downloading', 'installing'].includes(u.state) ? 'disabled' : ''}>${u.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>
      ${u.state === 'web-ready' ? '<button class="btn primary" data-action="upd-apply">Restart now</button>' : ''}
      ${u.state === 'app' && !u.manual ? '<button class="btn primary" data-action="upd-install">Install and reopen</button>' : ''}</div>
    ${updateBadge()}
    ${u.notes && (u.state === 'web-ready' || u.state === 'app') ? `<div class="small muted" style="margin-top:8px;white-space:pre-wrap">${esc(u.notes)}</div>` : ''}</div>`;
}
function refreshUpdateUI() {
  const card = document.getElementById('upd-card');
  if (card) card.outerHTML = updatesCard();
  // a small banner when an update is ready (once per version)
  document.querySelector('.upd-banner:not(.upd-done)')?.remove();
  if ((UPD.state === 'web-ready' || UPD.state === 'app') && UPD.version && UPD.dismissed !== UPD.version) {
    const b = document.createElement('div'); b.className = 'upd-banner';
    b.innerHTML = UPD.state === 'web-ready'
      ? `<span>Rehearsal <b>${esc(UPD.version)}</b> is ready.</span><button class="btn small primary" data-action="upd-apply">${IS_NATIVE ? 'Restart now' : 'Reload now'}</button><button class="btn small" data-action="upd-later">Later</button>`
      : `<span>Rehearsal <b>${esc(UPD.version)}</b> is available.</span><button class="btn small primary" data-action="upd-install">Install and reopen</button><button class="btn small" data-action="upd-later">Later</button>`;
    document.body.appendChild(b);
  }
}
// iPad / browser: compare the version online with the one running; the service worker fetches new files on reload
const verNewer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function webUpdateCheck(manual) {
  if (IS_NATIVE) return;
  if (!WEB_VERSION) { if (manual) { UPD = { ...UPD, state: 'error', message: "This copy has no version number (it wasn't built by release.sh)." }; refreshUpdateUI(); } return; }
  if (manual) { UPD = { ...UPD, state: 'checking' }; refreshUpdateUI(); }
  WEB_CHECKED = Date.now();
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0;
    const v = await r.json();
    if (verNewer(v.version, WEB_VERSION)) UPD = { ...UPD, state: 'web-ready', version: v.version };
    else if (manual) UPD = { ...UPD, state: 'none' };
  } catch { if (manual) UPD = { ...UPD, state: 'error', message: "Couldn't check for updates. Check the internet connection and try again." }; }
  refreshUpdateUI();
}
// A Home Screen app left open isn't reloaded when you switch back to it, so check when it comes back on screen
// (at most every 10 minutes) and every 4 hours while it stays open.
let WEB_CHECKED = Date.now();
if (!IS_NATIVE) {
  setInterval(() => webUpdateCheck(false), 4 * 3600 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - WEB_CHECKED > 10 * 60 * 1000) webUpdateCheck(false);
  });
}
window.__updateState = st => { const dismissed = UPD.dismissed; UPD = { ...st, dismissed }; settleUpdate(); refreshUpdateUI(); };
// The Mac app can still remember "ready, restart" after the page has already switched to that version: once the
// version running is the one that was waiting, it's done.
function settleUpdate() {
  if (UPD.state === 'web-ready' && UPD.version && WEB_VERSION && !verNewer(UPD.version, WEB_VERSION)) UPD = { ...UPD, state: 'none', version: '' };
}

function backupLabel(n) {
  const m = n.match(/data-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?(-manual)?/); if (!m) return n;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (m[4] ? ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '') + (m[7] ? ' (made by you / before a restore)' : ' (start of the day)');
}
async function loadBackups() {
  const box = $('#backup-list'); if (!box || !HAS_SERVER) return;
  try {
    const list = await (await fetch('/api/backups', { headers: { 'X-Token': TOKEN } })).json();
    box.innerHTML = list.length ? list.map(b => `<div class="backup-row"><span>${esc(backupLabel(b.name))}</span><span class="small muted">${Math.max(1, Math.round(b.size / 1024))} KB</span><button class="btn small" data-action="backup-restore" data-name="${esc(b.name)}">Restore</button></div>`).join('')
      : '<div class="small muted">No backups yet — the first one is made the next time you change something (or press Back up now).</div>';
  } catch { box.innerHTML = '<div class="small muted">Backups are only available in the Mac app.</div>'; }
}
