'use strict';
/* Rehearsal Online Homework — Assign Homework Slide-Over Drawer.
   Supports creating & editing Sight Reading (Practice & True Sight-Read),
   Score Practice (MusicXML auto-extraction & upload), and Audio-Only
   assignments, with inline teacher sign-in when unauthenticated so
   carried-over Sight Reading / Score Practice payloads are never lost. */

(function () {
  const DRAWER_ID = 'hw-assign-drawer';
  const MAX_SCORE_BYTES = 10 * 1024 * 1024;
  const MUSESCORE_WARN =
    "MuseScore (.mscz) files aren't supported directly online. In MuseScore, choose File -> Export -> MusicXML (.mxl or .musicxml) and upload that file.";

  const RHY_SYSTEMS = typeof RHYTHM_SYSTEMS !== 'undefined'
    ? RHYTHM_SYSTEMS
    : [
        ['numbers', 'Numbers (1 e & a)'],
        ['kodaly', 'Kodály (ta ti-ti)'],
        ['takadimi', 'Takadimi (ta ta-di)'],
      ];

  const SIGHT_RANGES = {
    'do-mi': 'do – mi',
    'do-sol': 'do – sol',
    'do-la': 'do – la',
    octave: 'do – high do',
    'lowsol-sol': 'low sol – sol',
    'lowsol-do': 'low sol – high do',
    'lowla-mi2': 'low la – high mi',
  };

  let D = null; // Active drawer state; null when closed

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const clone = obj => (obj == null ? obj : JSON.parse(JSON.stringify(obj)));

  function notify(msg) {
    if (typeof toast === 'function') toast(msg);
  }

  function api() {
    return window.HW_TEACHER_API || null;
  }

  function getSrDefaults() {
    if (typeof srDefaults === 'function') return srDefaults();
    return {
      mode: 'solfege',
      show: false,
      settingsOpen: false,
      playhead: 'beat',
      rhythm: { ts: '4/4', measures: 4, tempo: 80, metronome: true, measureNums: true, sound: 'clap', cells: ['q', 'h', 'ee', 'qr', 'w'], showCounts: false },
      solfege: { key: 'C', scale: 'major', clef: 'treble', range: 'do-sol', leap: 'step', ts: '4/4', measures: 4, tempo: 72, metronome: true, measureNums: true, startDo: true, cells: ['q', 'h', 'w'], showCounts: false },
      ex: {},
    };
  }

  function getSavedPresets() {
    return typeof srSavedPresets === 'function' ? srSavedPresets() : [];
  }

  function strictLabel(lv) {
    return lv <= 15 ? 'Very Forgiving' : lv <= 38 ? 'Forgiving' : lv <= 62 ? 'Standard' : lv <= 85 ? 'Strict' : 'Very Strict';
  }

  function computeStrictSpec(rLv, pLv, tempo) {
    if (typeof grStrictnessSpec === 'function') {
      return grStrictnessSpec({ rhythm: rLv, pitch: pLv }, tempo);
    }
    const r = Math.max(0, Math.min(100, Number(rLv ?? 50)));
    const p = Math.max(0, Math.min(100, Number(pLv ?? 50)));
    const bpm = Math.max(30, Math.min(240, Number(tempo) || 80));
    const q = 60 / bpm;
    const rhythmMs = Math.round(r <= 50 ? 250 - (r / 50) * 150 : 100 - ((r - 50) / 50) * 85);
    const rhythmSec = rhythmMs / 1000;
    const pitchCents = Math.round(p <= 50 ? 95 - (p / 50) * 55 : 40 - ((p - 50) / 50) * 35);
    const beatPct = Math.round((rhythmSec / q) * 100);
    const rhythmLabel = strictLabel(r);
    const pitchLabel = strictLabel(p);
    return {
      rhythmLevel: Math.round(r),
      pitchLevel: Math.round(p),
      rhythmLabel,
      pitchLabel,
      rhythmMs,
      pitchCents,
      beatPct,
      label: rhythmLabel === pitchLabel ? rhythmLabel : `R: ${rhythmLabel} · P: ${pitchLabel}`,
    };
  }

  function toDateTimeLocal(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (!Number.isFinite(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDateTimeLocal(str) {
    if (!str || !String(str).trim()) return null;
    const t = new Date(str).getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function sightEffectiveMode(sr) {
    if (!sr) return 'solfege';
    if (sr.mode === 'build') return sr.build?.kind === 'rhythm' ? 'rhythm' : 'solfege';
    if (sr.mode === 'solfege' && sr.solRhythm) return 'rhythm';
    return sr.mode === 'rhythm' ? 'rhythm' : 'solfege';
  }

  function buildSightSummary(sr) {
    if (!sr) return 'Sight Reading';
    const parts = [];
    if (sr.mode === 'build') {
      const b = sr.build || {};
      const kind = b.kind === 'rhythm' ? 'Rhythm' : 'Solfege';
      parts.push(`Mode: Custom Built (${kind})`);
      if (b.kind !== 'rhythm') {
        parts.push(`Key: ${String(b.key || 'C').replace('b', '♭')} ${b.scale || 'major'}`);
        parts.push(`Clef: ${b.clef === 'bass' ? 'Bass' : 'Treble'}`);
      }
      parts.push(`Meter: ${b.ts || '4/4'}`);
      if (b.tempo) parts.push(`Tempo: ${b.tempo} BPM`);
      return parts;
    }
    const eff = sightEffectiveMode(sr);
    const o = sr[sr.mode] || sr.solfege || sr.rhythm || {};
    if (eff === 'rhythm') {
      parts.push('Mode: Rhythm');
      parts.push(`Meter: ${o.ts || '4/4'}`);
      parts.push(`Measures: ${o.measures || 4}`);
      parts.push(`Tempo: ${o.tempo || 80} BPM`);
    } else {
      parts.push('Mode: Solfege');
      parts.push(`Key: ${String(o.key || 'C').replace('b', '♭')} ${o.scale || 'major'}`);
      parts.push(`Clef: ${o.clef === 'bass' ? 'Bass' : 'Treble'}`);
      parts.push(`Meter: ${o.ts || '4/4'}`);
      parts.push(`Measures: ${o.measures || 4}`);
      parts.push(`Tempo: ${o.tempo || 72} BPM`);
      if (o.range) parts.push(`Range: ${SIGHT_RANGES[o.range] || o.range}`);
    }
    return parts;
  }

  function defaultSightTitle(sr) {
    if (!sr) return 'Sight-Reading Practice';
    const eff = sightEffectiveMode(sr);
    if (sr.mode === 'build') {
      return `Custom ${eff === 'rhythm' ? 'Rhythm' : 'Solfege'} Sight-Reading`;
    }
    const o = sr[sr.mode] || {};
    if (eff === 'rhythm') {
      return `Rhythm Sight-Reading (${o.ts || '4/4'}, ${o.measures || 4}m)`;
    }
    const k = String(o.key || 'C').replace('b', '♭');
    return `Solfege Sight-Reading (${k} ${o.scale || 'major'}, ${o.ts || '4/4'})`;
  }

  function currentStrictTempo() {
    if (!D) return 80;
    if (D.type === 'sight') {
      const sr = D.srState || {};
      const o = sr[sr.mode] || sr.solfege || sr.rhythm || {};
      return Number(o.tempo || 80);
    }
    if (D.type === 'score') {
      const pct = Number(D.scoreTempoPct || 100);
      const base = Number(D.scoreOrigBpm || 84);
      return Math.round(base * (pct / 100));
    }
    return Number(D.audioBpm || 84);
  }

  function createBaseState(opts = {}) {
    const rSys = (typeof S !== 'undefined' && S?.settings?.rhythmSystem) || 'numbers';
    return {
      open: true,
      opts: opts || {},
      pickerMode: false,
      editId: null,
      editHasScoreFile: false,
      existingScoreFilename: null,
      type: 'sight', // 'sight' | 'score' | 'audio'
      classId: opts?.classId || '',
      classes: [],
      classesLoaded: false,
      plan: null,
      loadingMeta: false,
      submitting: false,
      error: '',
      newClassOpen: false,
      newClassName: '',
      creatingClass: false,

      // Shared assignment metadata
      title: '',
      titleTouched: false,
      instructions: '',
      dueAtStr: '',
      maxAttemptsStr: '',
      gradePolicy: 'best',
      published: true,

      // Sight Reading state
      srState: getSrDefaults(),
      selectedPresetId: '',
      assignMode: 'practice', // 'practice' | 'true_sight_read'
      studySeconds: 30,
      showSolfege: false,
      showCounts: false,
      countingSystem: rSys,
      strictness: { rhythm: 50, pitch: 50 },

      // Score Practice state
      scoreFile: null, // { blob, filename, size, source }
      scoreLoading: false,
      scoreLoadError: '',
      msczWarn: false,
      scoreParts: [], // [{ index, name, acc }]
      scoreMeasuresCount: 0,
      scoreMeasureNums: [],
      scoreOrigBpm: 0,
      scoreFocus: '', // '' for all or String(index)
      scoreFromMeasure: '',
      scoreToMeasure: '',
      scoreTempoPct: 100,
      scoreGradeMode: 'mic',
      scoreSolfege: false,
      scoreCounts: false,
      scoreBaseSpState: null,

      // Audio-Only state
      audioPrompt: '',
      audioCountIn: true,
      audioBpm: 84,

      // Inline sign-in state (preserved across auth without losing payload)
      auth: {
        step: 'email', // 'email' | 'code'
        email: '',
        name: '',
        code: '',
        ephemeral: false,
        devCode: '',
        busy: false,
        error: '',
      },
    };
  }

  // ---------- Score Extraction Helpers
  function resetScoreSelection() {
    if (!D) return;
    D.scoreFile = null;
    D.scoreLoadError = '';
    D.msczWarn = false;
  }

  async function extractScoreFromFileId(fileId, xmlIdHint, fallbackName) {
    if (!D || !fileId) return;
    const filesMap = (typeof S !== 'undefined' && S?.files) ? S.files : {};
    const fileMeta = filesMap[fileId] || {};
    const origName = fileMeta.name || fallbackName || 'Score.musicxml';
    const isMscz = /\.(mscz|mscx)$/i.test(origName);

    D.scoreLoading = true;
    D.scoreLoadError = '';
    D.msczWarn = false;
    D.scoreFile = null;
    render();

    try {
      let blob = null;
      let outName = origName;

      if (isMscz) {
        const xmlId = xmlIdHint || (typeof S !== 'undefined' && S?.scoreSettings?.[fileId]?.xmlId) || null;
        if (xmlId && filesMap[xmlId]) {
          outName = origName.replace(/\.(mscz|mscx)$/i, '.musicxml');
          if (typeof memBlobs !== 'undefined' && memBlobs[xmlId]) {
            blob = memBlobs[xmlId];
          } else if (typeof fileDirectURL === 'function') {
            const url = fileDirectURL(xmlId);
            if (url) {
              const r = await fetch(url);
              if (r.ok) blob = new Blob([await r.arrayBuffer()], { type: 'application/xml' });
            }
          }
        } else if (typeof SP_XML !== 'undefined' && SP_XML[fileId]) {
          outName = origName.replace(/\.(mscz|mscx)$/i, '.musicxml');
          blob = new Blob([SP_XML[fileId]], { type: 'application/xml' });
        } else {
          D.msczWarn = true;
          D.scoreLoading = false;
          render();
          return;
        }
      } else {
        if (typeof memBlobs !== 'undefined' && memBlobs[fileId]) {
          blob = memBlobs[fileId];
        } else if (typeof fileDirectURL === 'function') {
          const url = fileDirectURL(fileId);
          if (url) {
            const r = await fetch(url);
            if (r.ok) {
              const ab = await r.arrayBuffer();
              const mime = /\.mxl$/i.test(origName) ? 'application/vnd.recordare.musicxml' : 'application/xml';
              blob = new Blob([ab], { type: mime });
            }
          }
        }
      }

      if (!D) return;
      if (!blob || !blob.size) {
        D.scoreLoadError = 'Could not read the active score file. Choose a MusicXML (.mxl or .musicxml) file below.';
      } else if (blob.size > MAX_SCORE_BYTES) {
        D.scoreLoadError = 'Active score file exceeds the 10 MB online limit. Choose a smaller MusicXML file below.';
      } else {
        D.scoreFile = { blob, filename: outName, size: blob.size, source: 'active' };
      }
    } catch (err) {
      if (D) D.scoreLoadError = err?.message || 'Could not read score file.';
    }
    if (D) {
      D.scoreLoading = false;
      render();
    }
  }

  function handleManualScoreFile(file) {
    if (!D || !file) return;
    D.error = '';
    D.scoreLoadError = '';
    D.msczWarn = false;

    const name = String(file.name || '').trim();
    const lower = name.toLowerCase();
    if (lower.endsWith('.mscz') || lower.endsWith('.mscx')) {
      D.scoreFile = null;
      D.msczWarn = true;
      render();
      return;
    }
    if (!/\.(mxl|musicxml|xml)$/i.test(lower)) {
      D.scoreFile = null;
      D.scoreLoadError = 'Please choose a MusicXML file (.mxl, .musicxml, or .xml).';
      render();
      return;
    }
    if (file.size === 0) {
      D.scoreFile = null;
      D.scoreLoadError = 'Selected score file is empty.';
      render();
      return;
    }
    if (file.size > MAX_SCORE_BYTES) {
      D.scoreFile = null;
      D.scoreLoadError = 'Score file is too large (10 MB maximum).';
      render();
      return;
    }

    D.scoreFile = { blob: file, filename: name, size: file.size, source: 'upload' };
    if (!D.titleTouched && !D.editId) {
      D.title = name.replace(/\.(mxl|musicxml|xml)$/i, '').trim() || 'Score Practice';
    }
    render();
  }

  // ---------- Data Loading (Classes & Plan)
  async function loadTeacherContext() {
    const a = api();
    if (!D || !a || !a.getToken()) return;
    D.loadingMeta = true;
    render();
    try {
      const [meRes, clsRes] = await Promise.all([
        a.getMe().catch(() => null),
        a.listClasses(false).catch(() => null),
      ]);
      if (!D) return;
      if (meRes?.ok && meRes.plan) D.plan = meRes.plan;
      if (clsRes?.ok && Array.isArray(clsRes.classes)) {
        D.classes = clsRes.classes.filter(c => !c.archivedAt);
        D.classesLoaded = true;
        if (!D.classId || !D.classes.some(c => c.id === D.classId)) {
          D.classId = D.classes[0]?.id || '';
        }
        if (!D.classes.length && !D.editId) {
          D.newClassOpen = true;
        }
      }
    } catch {
      // Keep UI usable even if metadata fetch hiccups
    }
    if (D) {
      D.loadingMeta = false;
      render();
    }
  }

  // ---------- Keyboard / Backdrop Lifecycle
  function onDocKeyDownCapture(e) {
    if (!D) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      close();
    }
  }

  function ensureMount() {
    let el = document.getElementById(DRAWER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = DRAWER_ID;
    el.className = 'hwt-drawer-backdrop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Assign Online Homework');

    // Stop key events inside inputs/textareas/selects (and Space/arrows) from triggering
    // Sight Reading, Score Practice, or Present screen shortcuts.
    const stopKeys = e => {
      if (e.key === 'Escape') return;
      if (e.type === 'keydown' && e.key === 'Enter') {
        const inpKey = e.target?.dataset?.hwtInput;
        if (inpKey === 'auth-email' || inpKey === 'auth-name') {
          e.preventDefault(); e.stopPropagation();
          handleAction('auth-send');
          return;
        }
        if (inpKey === 'auth-code') {
          e.preventDefault(); e.stopPropagation();
          handleAction('auth-verify');
          return;
        }
        if (inpKey === 'newClassName') {
          e.preventDefault(); e.stopPropagation();
          handleAction('create-class');
          return;
        }
      }
      const inField = !!e.target?.closest?.('input,textarea,select,[contenteditable="true"]');
      if (inField || e.code === 'Space' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.stopPropagation();
      }
    };
    el.addEventListener('keydown', stopKeys);
    el.addEventListener('keyup', stopKeys);

    el.addEventListener('click', e => {
      if (e.target === el) {
        close();
        return;
      }
      const btn = e.target.closest('[data-hwt]');
      if (!btn) return;
      e.stopPropagation();
      handleAction(btn.dataset.hwt, btn, e);
    });

    el.addEventListener('change', e => {
      const ctl = e.target.closest('[data-hwt-change]');
      if (!ctl) return;
      e.stopPropagation();
      handleChange(ctl.dataset.hwtChange, ctl, e);
    });

    el.addEventListener('input', e => {
      const ctl = e.target.closest('[data-hwt-input]');
      if (!ctl) return;
      e.stopPropagation();
      handleInput(ctl.dataset.hwtInput, ctl, e);
    });

    document.body.appendChild(el);
    document.addEventListener('keydown', onDocKeyDownCapture, true);
    return el;
  }

  function close() {
    document.removeEventListener('keydown', onDocKeyDownCapture, true);
    document.getElementById(DRAWER_ID)?.remove();
    D = null;
  }

  // ---------- Actions & Form Handlers
  async function handleAction(act, btn) {
    if (!D) return;
    const a = api();

    if (act === 'close') {
      close();
      return;
    }

    if (act === 'auth-send') {
      if (!a) {
        D.auth.error = 'Online Homework API is not loaded.';
        render();
        return;
      }
      const email = String(D.auth.email || '').trim();
      if (!email || !email.includes('@')) {
        D.auth.error = 'Enter your teacher email address.';
        render();
        return;
      }
      D.auth.busy = true;
      D.auth.error = '';
      render();
      const res = await a.emailStart({ email });
      if (!D) return;
      D.auth.busy = false;
      if (!res?.ok) {
        D.auth.error = res?.error || 'Could not send sign-in code.';
        render();
        return;
      }
      D.auth.step = 'code';
      D.auth.devCode = res.devCode || '';
      D.auth.code = res.devCode || '';
      render();
      return;
    }

    if (act === 'auth-use-dev') {
      if (D.auth.devCode) {
        D.auth.code = D.auth.devCode;
        await handleAction('auth-verify', btn);
      }
      return;
    }

    if (act === 'auth-back') {
      D.auth.step = 'email';
      D.auth.code = '';
      D.auth.devCode = '';
      D.auth.error = '';
      render();
      return;
    }

    if (act === 'auth-verify') {
      if (!a) return;
      const code = String(D.auth.code || '').replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) {
        D.auth.error = 'Enter the 6-digit code.';
        render();
        return;
      }
      D.auth.busy = true;
      D.auth.error = '';
      render();
      const res = await a.emailVerify({
        email: D.auth.email.trim(),
        code,
        ephemeral: !!D.auth.ephemeral,
        name: D.auth.name.trim(),
      });
      if (!D) return;
      D.auth.busy = false;
      if (!res?.ok) {
        D.auth.error = res?.error || 'Invalid or expired code.';
        render();
        return;
      }
      if (res.plan) D.plan = res.plan;
      notify('Signed in to Online Homework.');
      await loadTeacherContext();
      return;
    }

    if (act === 'pick-type') {
      const nextType = btn.dataset.type;
      if (nextType === 'sight' || nextType === 'score' || nextType === 'audio') {
        D.type = nextType;
        D.pickerMode = false;
        D.error = '';
        if (nextType === 'sight') {
          if (!D.titleTouched) D.title = defaultSightTitle(D.srState);
        } else if (nextType === 'score') {
          if (!D.titleTouched) D.title = D.scoreFile?.filename?.replace(/\.(mxl|musicxml|xml)$/i, '') || 'Score Practice';
        } else if (nextType === 'audio') {
          if (!D.titleTouched) D.title = 'Audio Recording Check-In';
        }
        render();
      }
      return;
    }

    if (act === 'back-picker') {
      D.pickerMode = true;
      D.error = '';
      render();
      return;
    }

    if (act === 'toggle-new-class') {
      D.newClassOpen = !D.newClassOpen;
      D.error = '';
      render();
      return;
    }

    if (act === 'create-class') {
      if (!a) return;
      const name = String(D.newClassName || '').trim();
      if (!name) {
        D.error = 'Enter a name for the new class.';
        render();
        return;
      }
      D.creatingClass = true;
      D.error = '';
      render();
      const res = await a.createClass({ name, locked: false });
      if (!D) return;
      D.creatingClass = false;
      if (!res?.ok) {
        D.error = res?.error || 'Could not create class.';
        render();
        return;
      }
      const created = res.class || res.cls;
      if (created) {
        D.classes.unshift(created);
        D.classId = created.id;
      }
      D.newClassName = '';
      D.newClassOpen = false;
      notify(`Created class “${name}”.`);
      render();
      return;
    }

    if (act === 'assign-mode') {
      const nextMode = btn.dataset.mode === 'true_sight_read' ? 'true_sight_read' : 'practice';
      if (D.assignMode !== nextMode) {
        D.assignMode = nextMode;
        if (nextMode === 'true_sight_read') {
          D.maxAttemptsStr = '1';
          D.showSolfege = false;
          if (D.srState) D.srState.show = false;
        }
        render();
      }
      return;
    }

    if (act === 'study-sec') {
      const sec = Number(btn.dataset.sec || 30);
      D.studySeconds = [15, 30, 45, 60].includes(sec) ? sec : 30;
      render();
      return;
    }

    if (act === 'submit') {
      await submitDrawer();
    }
  }

  function applyPresetById(pid) {
    if (!D) return;
    D.selectedPresetId = pid;
    if (!pid) {
      render();
      return;
    }
    const preset = getSavedPresets().find(p => p.id === pid);
    if (!preset?.data) {
      render();
      return;
    }
    const base = getSrDefaults();
    const targetMode = preset.mode === 'rhythm' ? 'rhythm' : 'solfege';
    D.srState = {
      ...base,
      mode: targetMode,
      show: D.assignMode === 'true_sight_read' ? false : !!D.showSolfege,
      solRhythm: false,
      [targetMode]: { ...base[targetMode], ...clone(preset.data) },
      ex: {},
    };
    if (preset.data.showCounts != null) {
      D.showCounts = !!preset.data.showCounts;
    }
    D.srState.showCounts = !!D.showCounts;
    if (D.srState[targetMode]) D.srState[targetMode].showCounts = !!D.showCounts;
    if (!D.titleTouched && !D.editId) {
      D.title = preset.name || defaultSightTitle(D.srState);
    }
    render();
  }

  function handleChange(key, el) {
    if (!D) return;
    if (key === 'auth-ephemeral') {
      D.auth.ephemeral = !!el.checked;
      return;
    }
    if (key === 'classId') {
      D.classId = el.value;
      return;
    }
    if (key === 'gradePolicy') {
      D.gradePolicy = el.value === 'last' ? 'last' : 'best';
      return;
    }
    if (key === 'published') {
      D.published = !!el.checked;
      return;
    }
    if (key === 'sr-preset') {
      applyPresetById(el.value);
      return;
    }
    if (key === 'showSolfege') {
      D.showSolfege = !!el.checked;
      if (D.srState) D.srState.show = D.showSolfege;
      return;
    }
    if (key === 'showCounts') {
      D.showCounts = !!el.checked;
      if (D.srState) {
        D.srState.showCounts = D.showCounts;
        if (D.srState[D.srState.mode]) D.srState[D.srState.mode].showCounts = D.showCounts;
      }
      return;
    }
    if (key === 'countingSystem') {
      D.countingSystem = el.value || 'numbers';
      return;
    }
    if (key === 'score-lib-pick') {
      const fid = el.value;
      if (!fid) return;
      const meta = (typeof S !== 'undefined' && S?.files?.[fid]) ? S.files[fid] : null;
      if (!D.titleTouched && !D.editId && meta?.name) {
        D.title = meta.name.replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '').trim() || 'Score Practice';
      }
      extractScoreFromFileId(fid, S?.scoreSettings?.[fid]?.xmlId || null, meta?.name || 'Score.musicxml');
      return;
    }
    if (key === 'score-file') {
      const file = el.files?.[0];
      if (file) handleManualScoreFile(file);
      el.value = '';
      return;
    }
    if (key === 'score-focus') {
      D.scoreFocus = el.value;
      return;
    }
    if (key === 'score-gradeMode') {
      D.scoreGradeMode = el.value || 'mic';
      return;
    }
    if (key === 'score-solfege') {
      D.scoreSolfege = !!el.checked;
      return;
    }
    if (key === 'score-counts') {
      D.scoreCounts = !!el.checked;
      return;
    }
    if (key === 'audio-countIn') {
      D.audioCountIn = !!el.checked;
    }
  }

  function updateStrictnessReadout() {
    if (!D) return;
    const tempo = currentStrictTempo();
    const sp = computeStrictSpec(D.strictness.rhythm, D.strictness.pitch, tempo);
    const root = document.getElementById(DRAWER_ID);
    if (!root) return;
    const rLbl = root.querySelector('[data-hwt-strict-r]');
    const pLbl = root.querySelector('[data-hwt-strict-p]');
    if (rLbl) rLbl.textContent = `${sp.rhythmLabel} (±${sp.rhythmMs} ms · ±${sp.beatPct}% beat)`;
    if (pLbl) pLbl.textContent = `${sp.pitchLabel} (±${sp.pitchCents}¢)`;
  }

  function handleInput(key, el) {
    if (!D) return;
    if (key === 'auth-email') { D.auth.email = el.value; return; }
    if (key === 'auth-name') { D.auth.name = el.value; return; }
    if (key === 'auth-code') { D.auth.code = el.value; return; }
    if (key === 'newClassName') { D.newClassName = el.value; return; }
    if (key === 'title') { D.title = el.value; D.titleTouched = true; return; }
    if (key === 'instructions') { D.instructions = el.value; return; }
    if (key === 'dueAt') { D.dueAtStr = el.value; return; }
    if (key === 'maxAttempts') { D.maxAttemptsStr = el.value; return; }
    if (key === 'strict-rhythm') {
      D.strictness.rhythm = Math.max(0, Math.min(100, Number(el.value) || 0));
      updateStrictnessReadout();
      return;
    }
    if (key === 'strict-pitch') {
      D.strictness.pitch = Math.max(0, Math.min(100, Number(el.value) || 0));
      updateStrictnessReadout();
      return;
    }
    if (key === 'score-from') { D.scoreFromMeasure = el.value; return; }
    if (key === 'score-to') { D.scoreToMeasure = el.value; return; }
    if (key === 'score-tempo-pct') {
      const pct = Math.max(40, Math.min(200, Number(el.value) || 100));
      D.scoreTempoPct = pct;
      const bpmEl = document.getElementById(DRAWER_ID)?.querySelector('[data-hwt-input="score-tempo-bpm"]');
      if (bpmEl && D.scoreOrigBpm > 0) {
        bpmEl.value = String(Math.round(D.scoreOrigBpm * (pct / 100)));
      }
      updateStrictnessReadout();
      return;
    }
    if (key === 'score-tempo-bpm') {
      const bpm = Math.max(20, Math.min(300, Number(el.value) || 84));
      if (D.scoreOrigBpm > 0) {
        D.scoreTempoPct = Math.max(40, Math.min(200, Math.round((bpm / D.scoreOrigBpm) * 100)));
        const pctEl = document.getElementById(DRAWER_ID)?.querySelector('[data-hwt-input="score-tempo-pct"]');
        if (pctEl) pctEl.value = String(D.scoreTempoPct);
      }
      updateStrictnessReadout();
      return;
    }
    if (key === 'audio-prompt') { D.audioPrompt = el.value; return; }
    if (key === 'audio-bpm') { D.audioBpm = Math.max(30, Math.min(240, Number(el.value) || 84)); }
  }

  // ---------- Payload Builders & Save
  function resolveMeasureIndex(numStr, fallbackIdx) {
    const clean = String(numStr || '').trim();
    if (!clean) return fallbackIdx;
    if (Array.isArray(D?.scoreMeasureNums) && D.scoreMeasureNums.length) {
      const found = D.scoreMeasureNums.findIndex(n => String(n) === clean);
      if (found >= 0) return found;
    }
    const parsed = parseInt(clean, 10);
    if (!Number.isFinite(parsed)) return fallbackIdx;
    const maxIdx = D?.scoreMeasuresCount ? D.scoreMeasuresCount - 1 : 9999;
    return Math.max(0, Math.min(maxIdx, parsed - 1));
  }

  function buildAssignmentPayload() {
    const title = String(D.title || '').trim();
    const instructions = String(D.instructions || '').trim();
    const dueAt = fromDateTimeLocal(D.dueAtStr);
    const maxRaw = String(D.maxAttemptsStr || '').trim();
    const maxAttempts = maxRaw === '' ? null : Math.max(1, Math.min(1000, Math.floor(Number(maxRaw))));
    const gradePolicy = D.gradePolicy === 'last' ? 'last' : 'best';
    const published = !!D.published;

    if (D.type === 'sight') {
      const sr = clone(D.srState || getSrDefaults());
      if (sr.build) {
        sr.build.hist = [];
        sr.build.sel = null;
      }
      const mode = D.assignMode === 'true_sight_read' ? 'true_sight_read' : 'practice';
      sr.show = mode === 'true_sight_read' ? false : !!D.showSolfege;
      sr.showCounts = !!D.showCounts;
      if (sr[sr.mode]) sr[sr.mode].showCounts = !!D.showCounts;
      const config = {
        studySeconds: mode === 'true_sight_read' ? D.studySeconds : 0,
        countingSystem: D.countingSystem || 'numbers',
        strictness: {
          rhythm: Math.round(D.strictness.rhythm),
          pitch: Math.round(D.strictness.pitch),
        },
        srState: sr,
      };
      return { title, instructions, type: 'sight', mode, dueAt, maxAttempts, gradePolicy, published, config };
    }

    if (D.type === 'score') {
      const baseSp = clone(D.scoreBaseSpState || {});
      delete baseSp.fileId;
      delete baseSp.xmlId;
      const fromRaw = String(D.scoreFromMeasure || '').trim();
      const toRaw = String(D.scoreToMeasure || '').trim();
      let loop = { on: false, a: 0, b: 0 };
      if (fromRaw || toRaw) {
        const aIdx = resolveMeasureIndex(fromRaw || toRaw, 0);
        const bIdx = resolveMeasureIndex(toRaw || fromRaw, aIdx);
        loop = { on: true, a: Math.min(aIdx, bIdx), b: Math.max(aIdx, bIdx) };
      }
      const focusVal = D.scoreFocus === '' ? null : Number(D.scoreFocus);
      const tempoPct = Math.max(40, Math.min(200, Math.round(Number(D.scoreTempoPct) || 100)));
      const gradeMode = ['mic', 'rhythm', 'tap'].includes(D.scoreGradeMode) ? D.scoreGradeMode : 'mic';
      const spState = {
        ...baseSp,
        name: title,
        gradeMode,
        tempo: tempoPct,
        origBpm: D.scoreOrigBpm || baseSp.origBpm || 0,
        solfege: !!D.scoreSolfege,
        counts: !!D.scoreCounts,
        focus: Number.isFinite(focusVal) ? focusVal : null,
        loop,
        zoom: baseSp.zoom ?? 0.85,
      };
      if (D.scoreParts?.length) spState.partNames = clone(D.scoreParts);
      if (D.scoreMeasuresCount) spState.measuresCount = D.scoreMeasuresCount;
      if (D.scoreMeasureNums?.length) spState.measureNums = clone(D.scoreMeasureNums);

      const config = {
        gradeMode,
        countingSystem: D.countingSystem || 'numbers',
        strictness: {
          rhythm: Math.round(D.strictness.rhythm),
          pitch: Math.round(D.strictness.pitch),
        },
        spState,
      };
      return { title, instructions, type: 'score', mode: 'practice', dueAt, maxAttempts, gradePolicy, published, config };
    }

    // Audio-Only
    const prompt = String(D.audioPrompt || '').trim() || instructions;
    const config = {
      prompt,
      countIn: !!D.audioCountIn,
      bpm: Math.max(30, Math.min(240, Math.round(Number(D.audioBpm) || 84))),
      strictness: { rhythm: 50, pitch: 50 },
    };
    return { title, instructions, type: 'audio', mode: 'practice', dueAt, maxAttempts, gradePolicy, published, config };
  }

  async function submitDrawer() {
    const a = api();
    if (!D || !a) return;
    if (a.isOffline() || D.plan?.readOnly) {
      D.error = a.isOffline()
        ? 'You are currently offline. Reconnect to save assignments.'
        : (D.plan?.reason || 'Your plan is in read-only mode.');
      render();
      return;
    }

    const title = String(D.title || '').trim();
    if (!title) {
      D.error = 'Enter an assignment title.';
      render();
      return;
    }
    if (!D.editId && !D.classId) {
      D.error = 'Choose or create a class first.';
      render();
      return;
    }
    const maxRaw = String(D.maxAttemptsStr || '').trim();
    if (maxRaw !== '') {
      const m = Number(maxRaw);
      if (!Number.isFinite(m) || m < 1 || m > 1000) {
        D.error = 'Max attempts must be blank (unlimited) or between 1 and 1000.';
        render();
        return;
      }
    }
    if (D.type === 'score') {
      if (D.scoreLoading) {
        D.error = 'Still reading the score file — please wait a moment.';
        render();
        return;
      }
      if (D.msczWarn) {
        D.error = MUSESCORE_WARN;
        render();
        return;
      }
      if (!D.scoreFile && !D.editHasScoreFile) {
        D.error = 'Attach a MusicXML (.mxl, .musicxml, or .xml) score file first.';
        render();
        return;
      }
    }

    D.submitting = true;
    D.error = '';
    render();

    const payload = buildAssignmentPayload();
    let res;
    if (D.editId) {
      res = await a.updateAssignment(D.editId, {
        title: payload.title,
        instructions: payload.instructions,
        mode: payload.mode,
        config: payload.config,
        dueAt: payload.dueAt,
        maxAttempts: payload.maxAttempts,
        gradePolicy: payload.gradePolicy,
        published: payload.published,
      });
    } else {
      res = await a.createAssignment(D.classId, payload);
    }

    if (!D) return;
    if (!res?.ok || !res.assignment) {
      D.submitting = false;
      D.error = res?.error || 'Could not save assignment.';
      render();
      return;
    }

    let saved = res.assignment;
    if (D.type === 'score' && D.scoreFile?.blob) {
      const upRes = await a.uploadAssignmentScore(saved.id, D.scoreFile.blob, D.scoreFile.filename);
      if (!D) return;
      if (!upRes?.ok) {
        // Assignment record now exists; switch drawer into edit mode so retry uploads without duplicating.
        D.editId = saved.id;
        D.submitting = false;
        D.error = upRes?.error || 'Assignment created, but uploading the score file failed. Fix the file and click Save Changes.';
        render();
        return;
      }
      if (upRes.assignment) saved = upRes.assignment;
    }

    const onSaved = D.opts?.onSaved;
    const wasEdit = !!D.editId;
    close();

    try {
      if (typeof onSaved === 'function') onSaved(saved);
      if (typeof window.HW_TEACHER?.onAssignmentSaved === 'function' && onSaved !== window.HW_TEACHER.onAssignmentSaved) {
        window.HW_TEACHER.onAssignmentSaved(saved);
      }
    } catch { }
    notify(wasEdit ? 'Assignment updated.' : 'Assignment created.');
  }

  // ---------- Rendering
  function renderSignInBody() {
    const au = D.auth;
    const summaryLine = D.type === 'sight'
      ? buildSightSummary(D.srState).join(' · ')
      : D.type === 'score'
        ? `Score Practice${D.scoreFile?.filename ? ` · ${D.scoreFile.filename}` : ''}`
        : 'Audio-Only Recording';

    return `
      <div class="hwt-summary-box">
        <strong>Ready to assign after sign-in</strong>
        <div class="small muted">${esc(summaryLine)}</div>
      </div>
      <div class="hwt-auth-card" style="margin:0;padding:16px">
        <h3 style="margin:0">Sign in to Online Homework</h3>
        <p class="small muted" style="margin:0">Your ${D.type === 'score' ? 'score and settings' : 'exercise and settings'} stay right here while you sign in.</p>
        ${au.error ? `<div class="hwt-banner warn">${esc(au.error)}</div>` : ''}
        ${au.step === 'email' ? `
          <div class="hwt-field-grid">
            <label class="fld"><span>Teacher email</span><input type="email" data-hwt-input="auth-email" value="${esc(au.email)}" placeholder="teacher@school.edu" autocomplete="email"></label>
            <label class="fld"><span>Your name (optional)</span><input type="text" data-hwt-input="auth-name" value="${esc(au.name)}" placeholder="Ms. Rivera"></label>
          </div>
          <label class="chk">
            <input type="checkbox" data-hwt-change="auth-ephemeral" ${au.ephemeral ? 'checked' : ''}>
            <span>Shared / classroom computer (sign out when browser closes)</span>
          </label>
          <div>
            <button type="button" class="btn primary" data-hwt="auth-send" ${au.busy ? 'disabled' : ''}>${au.busy ? 'Sending code…' : 'Send 6-Digit Sign-In Code'}</button>
          </div>
        ` : `
          <p class="small" style="margin:0">Enter the 6-digit code sent to <strong>${esc(au.email)}</strong>.</p>
          ${au.devCode ? `
            <div class="hwt-devcode">
              <span class="small">Preview code: <code>${esc(au.devCode)}</code></span>
              <button type="button" class="btn small" data-hwt="auth-use-dev">Use preview code ${esc(au.devCode)}</button>
            </div>
          ` : ''}
          <div class="hwt-field-grid">
            <label class="fld" style="grid-column:1 / -1"><span>6-digit code</span><input type="text" inputmode="numeric" maxlength="6" data-hwt-input="auth-code" value="${esc(au.code)}" placeholder="123456"></label>
          </div>
          <div class="row">
            <button type="button" class="btn primary" data-hwt="auth-verify" ${au.busy ? 'disabled' : ''}>${au.busy ? 'Signing in…' : 'Verify & Continue'}</button>
            <button type="button" class="btn" data-hwt="auth-back" ${au.busy ? 'disabled' : ''}>Use different email</button>
          </div>
        `}
      </div>
    `;
  }

  function renderPlanBanners() {
    const a = api();
    const out = [];
    if (a?.isOffline?.()) {
      out.push('<div class="hwt-banner offline">Offline mode — reconnect to the internet to create or edit assignments.</div>');
    } else if (D.plan?.readOnly) {
      out.push(`<div class="hwt-banner readonly">${esc(D.plan.reason || 'Your Online Homework plan is in read-only mode. Upgrade in Setup → Homework → Account & Plan to create or edit assignments.')}</div>`);
    } else if (D.plan?.inGrace && D.plan.warning) {
      out.push(`<div class="hwt-banner warn">${esc(D.plan.warning)}</div>`);
    }
    return out.join('');
  }

  function renderPickerBody() {
    return `
      <p class="small muted">Choose the type of homework assignment to create:</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button type="button" class="btn" style="text-align:left;padding:12px" data-hwt="pick-type" data-type="sight">
          <strong>Sight Reading</strong>
          <div class="small muted">Use your saved Sight-Reading presets or default Solfege / Rhythm settings (Practice or True Sight-Read timer).</div>
        </button>
        <button type="button" class="btn" style="text-align:left;padding:12px" data-hwt="pick-type" data-type="score">
          <strong>Score Practice</strong>
          <div class="small muted">Upload a MusicXML (.mxl or .musicxml) score or pick one from your Rehearsal library.</div>
        </button>
        <button type="button" class="btn" style="text-align:left;padding:12px" data-hwt="pick-type" data-type="audio">
          <strong>Audio-Only Recording</strong>
          <div class="small muted">Give students a singing or speaking prompt with optional 4-beat count-in and metronome.</div>
        </button>
      </div>
    `;
  }

  function renderStrictnessSliders(tempo, rhythmOnlyNote) {
    const sp = computeStrictSpec(D.strictness.rhythm, D.strictness.pitch, tempo);
    return `
      <div class="hwt-strict-box">
        <div class="hwt-strict-row">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
            <label for="hwt-sr-r"><strong>Rhythm strictness</strong></label>
            <span class="small muted" data-hwt-strict-r>${esc(sp.rhythmLabel)} (±${sp.rhythmMs} ms · ±${sp.beatPct}% beat)</span>
          </div>
          <input id="hwt-sr-r" type="range" min="0" max="100" step="1" data-hwt-input="strict-rhythm" value="${D.strictness.rhythm}">
        </div>
        <div class="hwt-strict-row">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
            <label for="hwt-sr-p"><strong>Pitch strictness</strong></label>
            <span class="small muted" data-hwt-strict-p>${esc(sp.pitchLabel)} (±${sp.pitchCents}¢)</span>
          </div>
          <input id="hwt-sr-p" type="range" min="0" max="100" step="1" data-hwt-input="strict-pitch" value="${D.strictness.pitch}">
          ${rhythmOnlyNote ? '<div class="small muted">Pitch is not graded in Rhythm-only mode.</div>' : ''}
        </div>
      </div>
    `;
  }

  function renderSightSection() {
    const sr = D.srState || getSrDefaults();
    const presets = getSavedPresets();
    const eff = sightEffectiveMode(sr);
    const isTrue = D.assignMode === 'true_sight_read';
    const isRhythmOnly = eff === 'rhythm';
    const summary = buildSightSummary(sr);
    const tempo = Number((sr[sr.mode] || sr.solfege || sr.rhythm || {}).tempo || 80);

    return `
      <div class="hwt-summary-box">
        <strong>Exercise settings</strong>
        <div class="small">${summary.map(esc).join(' · ')}</div>
      </div>

      <div class="hwt-field-grid">
        <label class="fld" style="grid-column:1 / -1">
          <span>Saved preset</span>
          <select data-hwt-change="sr-preset">
            <option value="" ${!D.selectedPresetId ? 'selected' : ''}>${presets.length ? 'Current settings (or choose a saved preset…)' : 'Current settings (no saved presets yet)'}</option>
            ${presets.map(p => `<option value="${esc(p.id)}" ${D.selectedPresetId === p.id ? 'selected' : ''}>${esc(p.name)} (${p.mode === 'rhythm' ? 'Rhythm' : 'Solfege'})</option>`).join('')}
          </select>
        </label>

        <div class="fld" style="grid-column:1 / -1">
          <span>Assignment mode</span>
          <div class="row">
            <button type="button" class="btn small ${!isTrue ? 'primary' : ''}" data-hwt="assign-mode" data-mode="practice">Practice</button>
            <button type="button" class="btn small ${isTrue ? 'primary' : ''}" data-hwt="assign-mode" data-mode="true_sight_read">True Sight-Read</button>
          </div>
          <div class="small muted">${isTrue ? 'Excerpt stays hidden until the student starts their study timer, then auto-records at 0:00.' : 'Students can preview the music and practice before submitting.'}</div>
        </div>

        ${isTrue ? `
          <div class="fld" style="grid-column:1 / -1">
            <span>Study timer before auto-record</span>
            <div class="row">
              ${[15, 30, 45, 60].map(sec => `<button type="button" class="btn small ${D.studySeconds === sec ? 'primary' : ''}" data-hwt="study-sec" data-sec="${sec}">${sec}s</button>`).join('')}
            </div>
          </div>
        ` : ''}

        <div class="row" style="grid-column:1 / -1;gap:14px">
          ${!isRhythmOnly ? `
            <label class="chk">
              <input type="checkbox" data-hwt-change="showSolfege" ${D.showSolfege ? 'checked' : ''}>
              <span>Show Solfege syllables</span>
            </label>
          ` : ''}
          <label class="chk">
            <input type="checkbox" data-hwt-change="showCounts" ${D.showCounts ? 'checked' : ''}>
            <span>Show Rhythm counts</span>
          </label>
        </div>

        <label class="fld" style="grid-column:1 / -1">
          <span>Counting system</span>
          <select data-hwt-change="countingSystem">
            ${RHY_SYSTEMS.map(([v, l]) => `<option value="${esc(v)}" ${D.countingSystem === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </label>
      </div>

      ${renderStrictnessSliders(tempo, isRhythmOnly)}
    `;
  }

  function renderScoreSection() {
    const lib = typeof spLibrary === 'function' ? spLibrary() : [];
    const origBpm = D.scoreOrigBpm || 0;
    const liveBpm = origBpm > 0 ? Math.round(origBpm * ((Number(D.scoreTempoPct) || 100) / 100)) : '';
    const isTapOrRhy = D.scoreGradeMode === 'rhythm' || D.scoreGradeMode === 'tap';

    return `
      <div class="hwt-summary-box">
        <strong>Score file (.mxl / .musicxml)</strong>
        <div class="small">
          ${D.scoreLoading
            ? 'Reading score file…'
            : D.scoreFile
              ? `${esc(D.scoreFile.filename)} (${formatBytes(D.scoreFile.size)})`
              : D.editHasScoreFile
                ? `Uploaded: ${esc(D.existingScoreFilename || 'Score.musicxml')} (choose a new file below to replace)`
                : 'No MusicXML file selected yet.'}
        </div>
      </div>

      ${D.msczWarn ? `<div class="hwt-mscz-warn">${esc(MUSESCORE_WARN)}</div>` : ''}
      ${D.scoreLoadError ? `<div class="hwt-banner warn">${esc(D.scoreLoadError)}</div>` : ''}

      <div class="hwt-field-grid">
        ${!D.scoreFile && lib.length ? `
          <label class="fld" style="grid-column:1 / -1">
            <span>Use a score from Rehearsal</span>
            <select data-hwt-change="score-lib-pick">
              <option value="">Choose a score…</option>
              ${lib.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}
            </select>
          </label>
        ` : ''}

        <label class="fld" style="grid-column:1 / -1">
          <span>${D.scoreFile || D.editHasScoreFile ? 'Replace MusicXML file (.mxl, .musicxml, .xml)' : 'Upload MusicXML file (.mxl, .musicxml, .xml)'}</span>
          <input type="file" accept=".mxl,.musicxml,.xml" data-hwt-change="score-file">
          <span class="small muted">Max 10 MB. MuseScore (.mscz) files must be exported to MusicXML first.</span>
        </label>

        ${D.scoreParts.length ? `
          <label class="fld" style="grid-column:1 / -1">
            <span>Voice part focus</span>
            <select data-hwt-change="score-focus">
              <option value="" ${D.scoreFocus === '' ? 'selected' : ''}>All parts (student chooses)</option>
              ${D.scoreParts.map(p => `<option value="${p.index}" ${String(D.scoreFocus) === String(p.index) ? 'selected' : ''}>${esc(p.name)}${p.acc ? ' (Accomp.)' : ''}</option>`).join('')}
            </select>
          </label>
        ` : ''}

        <label class="fld">
          <span>From measure (optional)</span>
          <input type="number" min="1" data-hwt-input="score-from" value="${esc(D.scoreFromMeasure)}" placeholder="All">
        </label>
        <label class="fld">
          <span>To measure (optional)</span>
          <input type="number" min="1" data-hwt-input="score-to" value="${esc(D.scoreToMeasure)}" placeholder="End">
        </label>

        <label class="fld">
          <span>Tempo (%)</span>
          <input type="number" min="40" max="200" data-hwt-input="score-tempo-pct" value="${esc(D.scoreTempoPct)}">
        </label>
        <label class="fld">
          <span>Tempo (BPM)${origBpm ? ` · orig ${origBpm}` : ''}</span>
          <input type="number" min="20" max="300" data-hwt-input="score-tempo-bpm" value="${esc(liveBpm)}" placeholder="${origBpm ? '' : 'Score default'}" ${origBpm ? '' : 'disabled'}>
        </label>

        <label class="fld" style="grid-column:1 / -1">
          <span>Grading mode</span>
          <select data-hwt-change="score-gradeMode">
            <option value="mic" ${D.scoreGradeMode === 'mic' ? 'selected' : ''}>Microphone (Pitch + Rhythm)</option>
            <option value="rhythm" ${D.scoreGradeMode === 'rhythm' ? 'selected' : ''}>Microphone (Rhythm only)</option>
            <option value="tap" ${D.scoreGradeMode === 'tap' ? 'selected' : ''}>Tap Rhythm (Space / Touch)</option>
          </select>
        </label>

        <div class="row" style="grid-column:1 / -1;gap:14px">
          <label class="chk">
            <input type="checkbox" data-hwt-change="score-solfege" ${D.scoreSolfege ? 'checked' : ''}>
            <span>Show Solfege</span>
          </label>
          <label class="chk">
            <input type="checkbox" data-hwt-change="score-counts" ${D.scoreCounts ? 'checked' : ''}>
            <span>Show Counts</span>
          </label>
        </div>

        <label class="fld" style="grid-column:1 / -1">
          <span>Counting system</span>
          <select data-hwt-change="countingSystem">
            ${RHY_SYSTEMS.map(([v, l]) => `<option value="${esc(v)}" ${D.countingSystem === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </label>
      </div>

      ${renderStrictnessSliders(liveBpm || 84, isTapOrRhy)}
    `;
  }

  function renderAudioSection() {
    return `
      <div class="hwt-field-grid">
        <label class="fld" style="grid-column:1 / -1">
          <span>Recording prompt</span>
          <textarea rows="3" data-hwt-input="audio-prompt" placeholder="e.g. Sing a 5-note major scale on “ah” with steady breath support.">${esc(D.audioPrompt)}</textarea>
        </label>
        <label class="chk" style="align-self:end;padding-bottom:6px">
          <input type="checkbox" data-hwt-change="audio-countIn" ${D.audioCountIn ? 'checked' : ''}>
          <span>4-beat count-in</span>
        </label>
        <label class="fld">
          <span>Metronome BPM</span>
          <input type="number" min="30" max="240" data-hwt-input="audio-bpm" value="${esc(D.audioBpm)}">
        </label>
      </div>
    `;
  }

  function renderSharedFields(blocked) {
    const clsName = D.classes.find(c => c.id === D.classId)?.name || 'Class';
    return `
      <div class="hwt-field-grid">
        ${D.editId ? `
          <label class="fld" style="grid-column:1 / -1">
            <span>Class</span>
            <input type="text" value="${esc(clsName)}" disabled>
          </label>
        ` : `
          <div class="fld" style="grid-column:1 / -1">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span class="small muted">Class</span>
              <button type="button" class="btn small" data-hwt="toggle-new-class" ${blocked ? 'disabled' : ''}>${D.newClassOpen ? 'Cancel' : '+ New Class'}</button>
            </div>
            ${D.classes.length ? `
              <select data-hwt-change="classId" style="width:100%">
                ${D.classes.map(c => `<option value="${esc(c.id)}" ${c.id === D.classId ? 'selected' : ''}>${esc(c.name)} (${esc(c.joinCode || '')})</option>`).join('')}
              </select>
            ` : `
              <div class="small muted">${D.loadingMeta ? 'Loading classes…' : 'No classes yet — create your first class below.'}</div>
            `}
            ${D.newClassOpen ? `
              <div class="row" style="margin-top:4px">
                <input type="text" class="grow" data-hwt-input="newClassName" value="${esc(D.newClassName)}" placeholder="e.g. Concert Choir — Period 2">
                <button type="button" class="btn small primary" data-hwt="create-class" ${blocked || D.creatingClass ? 'disabled' : ''}>${D.creatingClass ? 'Creating…' : 'Create'}</button>
              </div>
            ` : ''}
          </div>
        `}

        <label class="fld" style="grid-column:1 / -1">
          <span>Title</span>
          <input type="text" data-hwt-input="title" value="${esc(D.title)}" placeholder="Assignment title">
        </label>

        <label class="fld" style="grid-column:1 / -1">
          <span>Instructions (optional)</span>
          <textarea rows="2" data-hwt-input="instructions" placeholder="Guidance for students…">${esc(D.instructions)}</textarea>
        </label>

        <label class="fld">
          <span>Due date (optional)</span>
          <input type="datetime-local" data-hwt-input="dueAt" value="${esc(D.dueAtStr)}">
        </label>
        <label class="fld">
          <span>Max attempts (blank = unlimited)</span>
          <input type="number" min="1" max="1000" data-hwt-input="maxAttempts" value="${esc(D.maxAttemptsStr)}" placeholder="Unlimited">
        </label>

        <label class="fld">
          <span>Grade policy</span>
          <select data-hwt-change="gradePolicy">
            <option value="best" ${D.gradePolicy === 'best' ? 'selected' : ''}>Best attempt</option>
            <option value="last" ${D.gradePolicy === 'last' ? 'selected' : ''}>Most recent attempt</option>
          </select>
        </label>
        <label class="chk" style="align-self:end;padding-bottom:6px">
          <input type="checkbox" data-hwt-change="published" ${D.published ? 'checked' : ''}>
          <span>Published to students</span>
        </label>
      </div>
    `;
  }

  function render() {
    if (!D) return;
    const backdrop = ensureMount();
    const a = api();
    const signedIn = !!a?.getToken?.();
    const offline = !!a?.isOffline?.();
    const readOnly = !!D.plan?.readOnly;
    const blocked = offline || readOnly;

    const headTitle = !signedIn
      ? 'Sign In to Assign Homework'
      : D.editId
        ? 'Edit Homework Assignment'
        : D.pickerMode
          ? 'New Homework Assignment'
          : D.type === 'sight'
            ? 'Assign Sight Reading'
            : D.type === 'score'
              ? 'Assign Score Practice'
              : 'Assign Audio Recording';

    let bodyHTML = '';
    if (!signedIn) {
      bodyHTML = renderSignInBody();
    } else if (D.pickerMode) {
      bodyHTML = renderPlanBanners() + renderPickerBody();
    } else {
      bodyHTML = `
        ${renderPlanBanners()}
        ${D.error ? `<div class="hwt-banner warn">${esc(D.error)}</div>` : ''}
        ${!D.editId && D.opts?.fromPicker ? `<div style="margin-bottom:8px"><button type="button" class="btn small" data-hwt="back-picker">← Change assignment type</button></div>` : ''}
        ${renderSharedFields(blocked)}
        <hr style="border:none;border-top:1px solid var(--e-line);margin:14px 0">
        ${D.type === 'sight' ? renderSightSection() : D.type === 'score' ? renderScoreSection() : renderAudioSection()}
      `;
    }

    const showSubmit = signedIn && !D.pickerMode;
    const footHTML = `
      <button type="button" class="btn" data-hwt="close">${showSubmit ? 'Cancel' : 'Close'}</button>
      ${showSubmit ? `<button type="button" class="btn primary" data-hwt="submit" ${blocked || D.submitting ? 'disabled' : ''}>${D.submitting ? 'Saving…' : D.editId ? 'Save Changes' : 'Create Assignment'}</button>` : ''}
    `;

    backdrop.innerHTML = `
      <div class="hwt-drawer">
        <div class="hwt-drawer-head">
          <h3 style="margin:0">${esc(headTitle)}</h3>
          <button type="button" class="iconbtn" data-hwt="close" aria-label="Close">✕</button>
        </div>
        <div class="hwt-drawer-body">${bodyHTML}</div>
        <div class="hwt-drawer-foot">${footHTML}</div>
      </div>
    `;
  }

  // ---------- Public Openers
  function openFromSight(st, viewObj, opts = {}) {
    D = createBaseState(opts);
    D.type = 'sight';
    const base = getSrDefaults();
    const src = clone(st || viewObj || base);
    if (src.build) {
      src.build.hist = [];
      src.build.sel = null;
    }
    if (viewObj?.mode === 'rhythm' && src.mode === 'solfege') {
      src.solRhythm = true;
    }
    D.srState = {
      ...base,
      ...src,
      rhythm: { ...base.rhythm, ...(src.rhythm || {}) },
      solfege: { ...base.solfege, ...(src.solfege || {}) },
    };
    D.showSolfege = !!D.srState.show;
    D.showCounts = !!(D.srState[D.srState.mode]?.showCounts ?? D.srState.showCounts);
    D.title = defaultSightTitle(D.srState);
    render();
    loadTeacherContext();
  }

  function openFromScore(ctl, opts = {}) {
    D = createBaseState(opts);
    D.type = 'score';
    const st = ctl?.st || {};
    const sc = ctl?.sc || null;
    D.scoreBaseSpState = clone(st);
    D.scoreTempoPct = Math.max(40, Math.min(200, Math.round(Number(st.tempo) || 100)));
    D.scoreGradeMode = ['mic', 'rhythm', 'tap'].includes(st.gradeMode) ? st.gradeMode : 'mic';
    D.scoreSolfege = !!st.solfege;
    D.scoreCounts = !!st.counts;

    if (sc?.lines) {
      D.scoreParts = sc.lines.map((l, i) => ({ index: i, name: l.name || `Part ${i + 1}`, acc: !!l.acc }));
    }
    if (sc?.measures) {
      D.scoreMeasuresCount = sc.measures.length;
      D.scoreMeasureNums = sc.measures.map((m, i) => m.num ?? String(i + 1));
    }
    if (sc) {
      const startIdx = st.loop?.on ? Math.min(st.loop.a, st.loop.b) : (ctl.startAt || 0);
      if (typeof spBpmAt === 'function') {
        D.scoreOrigBpm = Math.round(spBpmAt(sc, sc.measures[startIdx]?.start || 0)) || 0;
      } else if (sc.tempos?.[0]?.bpm) {
        D.scoreOrigBpm = Math.round(Number(sc.tempos[0].bpm)) || 0;
      }
    }
    if (Array.isArray(st.focus)) D.scoreFocus = st.focus.length ? String(st.focus[0]) : '';
    else if (st.focus != null) D.scoreFocus = String(st.focus);

    if (st.loop?.on) {
      const a = Math.min(st.loop.a, st.loop.b);
      const b = Math.max(st.loop.a, st.loop.b);
      D.scoreFromMeasure = D.scoreMeasureNums[a] || String(a + 1);
      D.scoreToMeasure = D.scoreMeasureNums[b] || String(b + 1);
    }

    const fileMeta = (typeof S !== 'undefined' && S?.files?.[st.fileId]) ? S.files[st.fileId] : null;
    const rawName = fileMeta?.name || st.name || 'Score';
    D.title = rawName.replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '').trim() || 'Score Practice';

    render();
    if (st.fileId) {
      extractScoreFromFileId(st.fileId, st.xmlId || null, rawName);
    }
    loadTeacherContext();
  }

  function openAudio(opts = {}) {
    D = createBaseState(opts);
    D.type = 'audio';
    D.title = 'Audio Recording Check-In';
    D.audioPrompt = '';
    D.audioCountIn = true;
    D.audioBpm = 84;
    render();
    loadTeacherContext();
  }

  function openPicker(opts = {}) {
    D = createBaseState({ ...(opts || {}), fromPicker: true });
    D.pickerMode = true;
    D.type = 'sight';
    D.title = defaultSightTitle(D.srState);
    render();
    loadTeacherContext();
  }

  function openEdit(assignment, opts = {}) {
    if (!assignment) return;
    D = createBaseState({ ...(opts || {}), classId: assignment.classId });
    D.editId = assignment.id;
    D.classId = assignment.classId;
    D.type = assignment.type || 'sight';
    D.title = assignment.title || '';
    D.titleTouched = true;
    D.instructions = assignment.instructions || '';
    D.dueAtStr = toDateTimeLocal(assignment.dueAt);
    D.maxAttemptsStr = assignment.maxAttempts != null ? String(assignment.maxAttempts) : '';
    D.gradePolicy = assignment.gradePolicy === 'last' ? 'last' : 'best';
    D.published = assignment.published !== false;

    const cfg = assignment.config || {};
    D.countingSystem = cfg.countingSystem || D.countingSystem;
    if (cfg.strictness) {
      D.strictness = {
        rhythm: Math.max(0, Math.min(100, Number(cfg.strictness.rhythm ?? 50))),
        pitch: Math.max(0, Math.min(100, Number(cfg.strictness.pitch ?? 50))),
      };
    }

    if (D.type === 'sight') {
      const base = getSrDefaults();
      const incoming = clone(cfg.srState || {});
      const mode = incoming.mode === 'rhythm' ? 'rhythm' : (incoming.mode === 'build' ? 'build' : 'solfege');
      D.srState = {
        ...base,
        ...incoming,
        mode,
        rhythm: { ...base.rhythm, ...(incoming.rhythm || {}) },
        solfege: { ...base.solfege, ...(incoming.solfege || {}) },
      };
      D.assignMode = assignment.mode === 'true_sight_read' ? 'true_sight_read' : 'practice';
      D.studySeconds = [15, 30, 45, 60].includes(Number(cfg.studySeconds)) ? Number(cfg.studySeconds) : 30;
      D.showSolfege = !!D.srState.show;
      D.showCounts = !!(D.srState[D.srState.mode]?.showCounts ?? D.srState.showCounts);
    } else if (D.type === 'score') {
      const sp = clone(cfg.spState || {});
      D.scoreBaseSpState = sp;
      D.editHasScoreFile = !!assignment.hasScoreFile;
      D.existingScoreFilename = assignment.scoreFilename || null;
      D.scoreGradeMode = cfg.gradeMode || sp.gradeMode || 'mic';
      D.scoreTempoPct = Math.max(40, Math.min(200, Math.round(Number(sp.tempo) || 100)));
      D.scoreOrigBpm = Number(sp.origBpm || 0);
      D.scoreSolfege = !!sp.solfege;
      D.scoreCounts = !!sp.counts;
      if (Array.isArray(sp.partNames)) D.scoreParts = clone(sp.partNames);
      if (sp.measuresCount) D.scoreMeasuresCount = Number(sp.measuresCount);
      if (Array.isArray(sp.measureNums)) D.scoreMeasureNums = clone(sp.measureNums);
      if (Array.isArray(sp.focus)) D.scoreFocus = sp.focus.length ? String(sp.focus[0]) : '';
      else if (sp.focus != null) D.scoreFocus = String(sp.focus);
      if (sp.loop?.on) {
        const a = Math.min(sp.loop.a, sp.loop.b);
        const b = Math.max(sp.loop.a, sp.loop.b);
        D.scoreFromMeasure = D.scoreMeasureNums[a] || String(a + 1);
        D.scoreToMeasure = D.scoreMeasureNums[b] || String(b + 1);
      }
    } else {
      D.audioPrompt = cfg.prompt || '';
      D.audioCountIn = cfg.countIn !== false;
      D.audioBpm = Math.max(30, Math.min(240, Number(cfg.bpm || 84)));
    }

    render();
    loadTeacherContext();
  }

  window.HW_TEACHER_DRAWER = {
    openFromSight,
    openFromScore,
    openAudio,
    openEdit,
    openPicker,
    close,
  };
})();
