'use strict';
/* Rehearsal Scan & Fix — Upload, OMR job polling, split original/score review,
   docked MuseScore/Flat-style notation bar, 1-click Eraser, inline lyric/text editing,
   pixel-locked re-renders, continuous spPlay() playback, and verified save gate. */

(function () {
  const DEFAULT_INSTRUMENTS = [
    ['auto', 'Auto-detect (all parts)'],
    ['choir', 'Choir / Vocal (SATB)'],
    ['flute', 'Flute'],
    ['piccolo', 'Piccolo'],
    ['oboe', 'Oboe'],
    ['bassoon', 'Bassoon'],
    ['clarinet', 'Bb Clarinet'],
    ['bass_clarinet', 'Bb Bass Clarinet'],
    ['alto_sax', 'Eb Alto Saxophone'],
    ['tenor_sax', 'Bb Tenor Saxophone'],
    ['bari_sax', 'Eb Baritone Saxophone'],
    ['trumpet', 'Bb Trumpet'],
    ['french_horn', 'F Horn'],
    ['trombone', 'Trombone'],
    ['euphonium', 'Euphonium / Baritone'],
    ['tuba', 'Tuba'],
    ['mallets', 'Mallets / Bells']
  ];

  const DURATIONS = [
    ['whole', 'Whole'],
    ['half', 'Half'],
    ['quarter', 'Quarter'],
    ['eighth', '8th'],
    ['16th', '16th']
  ];

  const DUR_LABELS = {
    whole: 'Whole',
    half: 'Half',
    quarter: 'Quarter',
    eighth: '8th',
    '16th': '16th',
    '32nd': '32nd'
  };

  const ACCIDENTALS = [
    ['natural', '♮'],
    ['sharp', '♯'],
    ['flat', '♭'],
    ['none', 'Key']
  ];

  function hEsc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function iconHtml(name, fallback) {
    if (typeof IC === 'function') {
      const s = IC('ico:' + name);
      if (s) return s;
    }
    return fallback || '';
  }

  function showToast(msg, ms) {
    if (typeof toast === 'function') toast(msg, ms);
  }

  function getInstrumentList() {
    if (typeof SF_INSTRUMENT_RANGES !== 'undefined' && SF_INSTRUMENT_RANGES) {
      return DEFAULT_INSTRUMENTS.map(([k, label]) => [k, SF_INSTRUMENT_RANGES[k]?.label || label]);
    }
    return DEFAULT_INSTRUMENTS;
  }

  function formatSpokenCuesWarning(cues) {
    if (!Array.isArray(cues) || !cues.length) return '';
    const words = cues.map(c => c && c.text ? c.text : String(c || '')).filter(Boolean).slice(0, 6);
    if (!words.length) return '';
    return `Spoken choir cues detected in PDF (${words.join(', ')}) — Audiveris often misses X-noteheads; check those spots and tap Spoken ✕.`;
  }

  function formatDurationMs(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  }

  function formatNotePitch(entry) {
    if (!entry) return 'Note';
    if (entry.isRest) return 'Rest';
    const accMap = { '-2': '♭♭', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
    const alt = accMap[String(entry.alter || 0)] || '';
    return `${entry.step || ''}${alt}${entry.octave != null ? entry.octave : ''}`;
  }

  function friendlyStage(stage, status) {
    if (status === 'queued') return 'Waiting in line…';
    if (stage === 'preparing') return 'Preparing page…';
    if (stage === 'omr' || stage === 'scanning' || status === 'processing') return 'Reading music notation…';
    if (stage === 'validating') return 'Checking extracted notes…';
    if (stage === 'completed') return 'Done';
    return 'Scanning sheet music…';
  }

  function slugFileName(title) {
    const clean = String(title || 'Scanned Score')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || 'Scanned Score';
  }

  async function previewMidiNote(midi) {
    if (!isFinite(midi) || midi <= 0) return;
    if (typeof spPianoReady !== 'function' || typeof spPianoNote !== 'function' || typeof ac !== 'function') return;
    try {
      const ctx = ac();
      if (ctx.state === 'suspended' && ctx.resume) await ctx.resume();
      await spPianoReady([midi]);
      const dest = typeof musicOut === 'function' ? musicOut(ctx) : ctx.destination;
      spPianoNote(dest, ctx.currentTime + 0.01, midi, 0.32, 0.72);
    } catch { }
  }

  function mountScanFix(host, winState = {}, onChange = () => {}) {
    if (!host) return;
    if (host.__sfMounted && host.querySelector('.sf-root')) return;
    if (host.__sfCleanup) {
      try { host.__sfCleanup(); } catch { }
    }
    host.__sfMounted = true;

    const client = window.SCAN_CLIENT;
    const state = {
      screen: 'upload', // 'upload' | 'scanning' | 'error' | 'review'
      layout: (typeof window !== 'undefined' && window.innerWidth < 900) ? 'score' : 'split',
      scoreLayout: winState.scoreLayout || 'v',
      mode: 'select', // 'select' | 'erase'
      eraserMode: false,
      health: null,
      instrument: winState.instrument || 'auto',
      scanMode: winState.scanMode || 'full',
      title: winState.title || '',
      file: null,
      fileKind: null, // 'image' | 'pdf'
      fileObjectUrl: '',
      pdfDoc: null,
      pdfPage: 1,
      pdfTotalPages: 0,
      origZoom: 1,
      uploadHash: '',
      jobId: '',
      pollAbort: null,
      scanStage: '',
      scanDetail: '',
      scanProgress: 0,
      scanElapsedMs: 0,
      scanCurrentPage: null,
      scanTotalPages: null,
      cacheBanner: '',
      scanWarning: '',
      errorTitle: '',
      errorMsg: '',
      model: null,
      alternateModels: [],
      dirty: false,
      history: null,
      flagReport: null,
      saveGate: null,
      playbackScore: null,
      tapMap: null,
      osmd: null,
      measureBoxes: [],
      staffBoxes: [],
      partBoxes: {}, // key `${partIndex}:${measureIndex}` -> { x, y, w, h }
      staffMeasureBoxes: {}, // key `${partIndex}:${staff}:${measureIndex}` -> { x, y, w, h, clefSign }
      selectedNoteId: null,
      selectedDirId: null,
      selectedTieId: null,
      selectedLyricNoteId: null,
      selectedHeaderText: null,
      selectedPartIndex: 0,
      selectedStaff: 1,
      selectedParts: [0],
      selectedStaves: [{ partIndex: 0, staff: 1 }],
      activeMeasure: 0,
      copyRange: null, // { partIndex, anchor, start, end }
      clipboard: null,
      drawerOpen: false,
      drawerTab: 'flags',
      playingMeasure: -1,
      inlineEditor: null, // { kind: 'lyric' | 'dir', targetId, measureIndex, partIndex }
      saving: false,
      savedFileId: null,
      savedName: '',
      destroyed: false
    };

    const sfCtl = {
      host,
      root: null,
      sc: null,
      st: {
        tempo: 100,
        countIn: 0,
        metronome: false,
        pitches: 'none',
        playhead: 'beat',
        loop: { on: false, a: 0, b: 0 },
        speed: { on: false, start: 70, step: 5 },
        parts: {}
      },
      playing: false,
      marks: [],
      startAt: 0,
      updateBar() {
        if (!sfCtl.playing) state.playingMeasure = -1;
        const playBtn = host.querySelector('#sf-play-btn');
        if (playBtn) {
          playBtn.innerHTML = sfCtl.playing
            ? `${iconHtml('stop', '■')} Stop`
            : `${iconHtml('play', '▶')} Play`;
          playBtn.classList.toggle('primary', sfCtl.playing);
        }
        updateMeasureOverlays();
      },
      drawPlayhead(heard) {
        const M = sfCtl.marks;
        const ph = host.querySelector('#sf-ph');
        const scrollEl = host.querySelector('#sf-score-scroll');
        if (!M.length || !sfCtl.sc || !ph) return;
        let i = M.length - 1;
        while (i > 0 && M[i].t > heard) i--;
        const a = M[i], b = M[i + 1];
        const q = a.hold || !b || b.jump
          ? a.q
          : a.q + (b.q - a.q) * Math.max(0, Math.min(1, (heard - a.t) / ((b.t - a.t) || 1)));
        const P = sfCtl.sc.perf || [];
        const ms = sfCtl.sc.measures || [];
        if (!P.length || !ms.length) { ph.hidden = true; return; }
        let pi = P.findIndex(m => q >= m.start - 1e-9 && q < m.start + m.len - 1e-9);
        if (pi < 0) pi = P.length - 1;
        const mi = P[pi].w;
        const r = state.measureBoxes[mi];
        if (!r) { ph.hidden = true; return; }
        const m = ms[mi];
        const dq = Math.max(0, Math.min(m.len || 1, q - P[pi].start));
        const pad = Math.min(14, r.w * 0.08);
        const f = Math.max(0, Math.min(1, dq / (m.len || 1)));
        const x = r.x + pad + f * Math.max(8, r.w - pad * 1.5);
        ph.hidden = false;
        ph.style.left = `${x.toFixed(1)}px`;
        ph.style.top = `${Math.max(4, r.y - 4).toFixed(1)}px`;
        ph.style.height = `${Math.max(36, r.h + 8).toFixed(1)}px`;
        if (state.playingMeasure !== mi) {
          state.playingMeasure = mi;
          host.querySelectorAll('.sf-m-wash.sf-m-playing').forEach(el => el.classList.remove('sf-m-playing'));
          host.querySelector(`.sf-m-wash[data-sf-m="${mi}"]`)?.classList.add('sf-m-playing');
          if (scrollEl) {
            if (state.scoreLayout === 'h') {
              const viewLeft = scrollEl.scrollLeft;
              const viewRight = viewLeft + scrollEl.clientWidth;
              if (r.x < viewLeft + 36 || r.x + r.w > viewRight - 36) {
                scrollEl.scrollTo({ left: Math.max(0, r.x - 68), behavior: 'smooth' });
              }
            } else {
              const viewTop = scrollEl.scrollTop;
              const viewBot = viewTop + scrollEl.clientHeight;
              if (r.y < viewTop + 36 || r.y + r.h > viewBot - 36) {
                scrollEl.scrollTo({ top: Math.max(0, r.y - 68), behavior: 'smooth' });
              }
            }
          }
        }
      },
      hidePlayhead() {
        const ph = host.querySelector('#sf-ph');
        if (ph) ph.hidden = true;
        state.playingMeasure = -1;
        host.querySelectorAll('.sf-m-wash.sf-m-playing').forEach(el => el.classList.remove('sf-m-playing'));
      },
      hideCountOverlay() {}
    };

    host.classList.add('sf-host');

    function cleanupMedia() {
      if (state.fileObjectUrl) {
        try { URL.revokeObjectURL(state.fileObjectUrl); } catch { }
        state.fileObjectUrl = '';
      }
      state.pdfDoc = null;
      state.pdfPage = 1;
      state.pdfTotalPages = 0;
    }

    function stopPlayback() {
      if (sfCtl.playing && typeof spStop === 'function') {
        try { spStop(); } catch { }
      }
      sfCtl.playing = false;
      state.playingMeasure = -1;
      sfCtl.hidePlayhead();
      updateMeasureOverlays();
    }

    async function refreshHealth() {
      if (!client) return;
      state.health = await client.checkHealth(3000);
      if (!state.destroyed && state.screen === 'upload') renderUpload();
    }

    function healthBadgeHTML() {
      const h = state.health;
      if (!h) return `<span class="sf-health-pill"><span class="sf-health-dot"></span>Checking scan server…</span>`;
      if (h.ok && h.engineAvailable) {
        const ocrHint = h.ocrAvailable === false
          ? `<div class="sf-ocr-hint">Lyrics/text OCR needs Tesseract tessdata</div>`
          : '';
        return `<div class="sf-health-wrap"><span class="sf-health-pill ready"><span class="sf-health-dot"></span>Scan server ready</span>${ocrHint}</div>`;
      }
      if (h.ok && !h.engineAvailable) return `<span class="sf-health-pill warn"><span class="sf-health-dot"></span>Audiveris not found</span>`;
      return `<span class="sf-health-pill off"><span class="sf-health-dot"></span>Scan server offline</span>`;
    }

    // ---------- Upload screen
    function renderUpload() {
      const instOpts = getInstrumentList().map(([k, label]) =>
        `<option value="${hEsc(k)}" ${state.instrument === k ? 'selected' : ''}>${hEsc(label)}</option>`
      ).join('');
      const baseUrl = client ? client.getBaseUrl() : 'http://127.0.0.1:8788';
      const srvWarn = state.health && !state.health.ok
        ? `<div class="sf-banner warn"><span>Start the local scan service (<span class="sf-code-hint">tools/omr-service/run.sh</span>) to scan PDFs or photos, or open an existing MusicXML file below.</span></div>`
        : (state.health && state.health.ok && !state.health.engineAvailable)
          ? `<div class="sf-banner warn"><span>The scan server is running, but Audiveris 5.x was not found on this machine.</span></div>`
          : '';

      host.innerHTML = `<div class="sf-root">
        ${srvWarn}
        <div class="sf-center">
          <div class="sf-card">
            <div class="sf-card-head">
              <div>
                <h2>Scan &amp; fix sheet music</h2>
                <p class="sf-sub">Upload a photo or PDF of a band or choir score. Rehearsal turns it into editable music, flags suspicious measures, and lets you hear every bar before saving.</p>
              </div>
              ${healthBadgeHTML()}
            </div>

            <div class="sf-drop" id="sf-drop" tabindex="0" role="button" aria-label="Choose a PDF or photo to scan">
              <div class="sf-drop-ico">${iconHtml('scan', '📷')}</div>
              <div class="sf-drop-title">Drop a PDF or photo here, or click to choose</div>
              <div class="sf-drop-hint">Works best with clear, flat PDFs or evenly lit photos (PDF, PNG, JPG, WebP, TIFF)</div>
              <input type="file" id="sf-file-in" accept="application/pdf,image/*" hidden>
            </div>

            <div class="sf-mode-row">
              <span class="sf-mode-lbl">What to scan</span>
              <div class="sf-mode-seg" role="group" aria-label="What to scan">
                <button type="button" class="sf-mode-btn ${state.scanMode === 'full' ? 'on' : ''}" data-sf-scanmode="full" title="Notes, lyrics, dynamics &amp; markings">
                  <strong>Full score</strong>
                  <span>Notes, lyrics &amp; markings</span>
                </button>
                <button type="button" class="sf-mode-btn ${state.scanMode === 'notes-lyrics' ? 'on' : ''}" data-sf-scanmode="notes-lyrics" title="Notes, rhythms, ties &amp; lyrics (skips extra markings)">
                  <strong>Notes &amp; lyrics</strong>
                  <span>Skips extra markings</span>
                </button>
                <button type="button" class="sf-mode-btn ${state.scanMode === 'notes-only' ? 'on' : ''}" data-sf-scanmode="notes-only" title="Fastest — skips OCR &amp; lyrics">
                  <strong>Notes only</strong>
                  <span>Fastest — skips OCR &amp; lyrics</span>
                </button>
              </div>
            </div>

            <div class="sf-form-row">
              <label class="sf-field">
                <span>Instrument (for range check)</span>
                <select id="sf-inst-in">${instOpts}</select>
              </label>
              <label class="sf-field">
                <span>Piece title (optional)</span>
                <input type="text" id="sf-title-in" placeholder="e.g. Stars &amp; Stripes — Trumpet 1" value="${hEsc(state.title)}">
              </label>
            </div>

            <div class="sf-or-row">
              <span class="sf-sub" style="margin:0">Already have a MusicXML file?</span>
              <button type="button" class="sf-btn" id="sf-open-xml">${iconHtml('file', '')} Open MusicXML to fix…</button>
              <input type="file" id="sf-xml-in" accept=".mxl,.musicxml,.xml,application/xml,text/xml" hidden>
            </div>

            <details class="sf-srv-details">
              <summary>Scan server address</summary>
              <div class="sf-srv-box">
                <div class="sf-srv-row">
                  <input type="url" id="sf-srv-url" value="${hEsc(baseUrl)}" placeholder="http://127.0.0.1:8788">
                  <button type="button" class="sf-btn" id="sf-srv-save">Save &amp; check</button>
                  <button type="button" class="sf-btn" id="sf-srv-reset">Reset</button>
                </div>
                <div>Runs Audiveris 5.x locally as a separate CLI process. Set <span class="sf-code-hint">?omrApi=…</span> or save an address here.</div>
              </div>
            </details>
          </div>
        </div>
      </div>`;

      const drop = host.querySelector('#sf-drop');
      const fileIn = host.querySelector('#sf-file-in');
      const xmlIn = host.querySelector('#sf-xml-in');
      const instIn = host.querySelector('#sf-inst-in');
      const titleIn = host.querySelector('#sf-title-in');

      instIn.addEventListener('change', () => { state.instrument = instIn.value; });
      titleIn.addEventListener('input', () => { state.title = titleIn.value; });
      host.querySelectorAll('[data-sf-scanmode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.scanMode = btn.dataset.sfScanmode || 'full';
          winState.scanMode = state.scanMode;
          if (typeof onChange === 'function') onChange();
          host.querySelectorAll('[data-sf-scanmode]').forEach(b => b.classList.toggle('on', b === btn));
        });
      });

      drop.addEventListener('click', () => fileIn.click());
      drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); }
      });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('drag');
        const f = e.dataTransfer?.files?.[0];
        if (f) handlePickedInput(f);
      });
      fileIn.addEventListener('change', () => {
        const f = fileIn.files?.[0];
        if (f) handlePickedInput(f);
      });

      host.querySelector('#sf-open-xml').addEventListener('click', () => xmlIn.click());
      xmlIn.addEventListener('change', () => {
        const f = xmlIn.files?.[0];
        if (f) openExistingMusicXmlFile(f);
      });

      host.querySelector('#sf-srv-save').addEventListener('click', () => {
        if (!client) return;
        const val = host.querySelector('#sf-srv-url').value;
        client.setBaseUrl(val);
        refreshHealth();
      });
      host.querySelector('#sf-srv-reset').addEventListener('click', () => {
        if (!client) return;
        client.resetBaseUrl();
        refreshHealth();
      });
    }

    async function handlePickedInput(file) {
      if (/\.(mxl|musicxml|xml)$/i.test(file.name || '')) {
        await openExistingMusicXmlFile(file);
        return;
      }
      await startScanUpload(file);
    }

    async function openExistingMusicXmlFile(file) {
      try {
        cleanupMedia();
        state.file = file;
        state.fileKind = null;
        state.jobId = '';
        state.cacheBanner = '';
        const buf = await file.arrayBuffer();
        state.uploadHash = client ? await client.hashBytes(buf) : '';
        const head = new Uint8Array(buf, 0, 2);
        const input = (head[0] === 0x50 && head[1] === 0x4b)
          ? new Uint8Array(buf)
          : new TextDecoder().decode(buf);
        const model = await sfParseScoreInput(input);
        if (!state.title) state.title = model.workTitle || file.name.replace(/\.(mxl|musicxml|xml)$/i, '');
        enterReview(model, '', '');
      } catch (err) {
        showErrorScreen('Could not open MusicXML', err?.message || 'That file does not look like valid MusicXML.');
      }
    }

    async function loadOriginalFilePreview(file) {
      cleanupMedia();
      state.file = file;
      if (!file) return;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      state.fileKind = isPdf ? 'pdf' : 'image';
      state.origZoom = 1;
      state.fileObjectUrl = URL.createObjectURL(file);
      if (isPdf && window.pdfjsLib) {
        try {
          if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
          }
          const ab = await file.arrayBuffer();
          state.pdfDoc = await window.pdfjsLib.getDocument({ data: ab }).promise;
          state.pdfPage = 1;
          state.pdfTotalPages = state.pdfDoc.numPages || 1;
        } catch {
          state.pdfDoc = null;
        }
      }
    }

    async function startScanUpload(file) {
      if (!client) {
        showErrorScreen('Scan client unavailable', 'Reload the page and try again.');
        return;
      }
      await loadOriginalFilePreview(file);
      if (!state.title) {
        state.title = (file.name || 'Scanned Score').replace(/\.[^.]+$/, '');
      }

      const buf = await file.arrayBuffer();
      state.uploadHash = await client.hashBytes(buf);

      const localHit = client.getLocalCache(state.uploadHash);
      if (localHit && localHit.musicxml) {
        try {
          const model = sfParseMusicXml(localHit.musicxml);
          if (localHit.instrument && state.instrument === 'auto') state.instrument = localHit.instrument;
          if (localHit.title) state.title = localHit.title;
          enterReview(model, 'Loaded your previously verified copy from this browser.', '');
          return;
        } catch { }
      }

      state.screen = 'scanning';
      state.scanStage = 'Uploading…';
      state.scanDetail = 'Sending your file to the scan server…';
      state.scanProgress = 5;
      state.scanElapsedMs = 0;
      state.scanCurrentPage = null;
      state.scanTotalPages = state.pdfTotalPages || null;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      state.pollAbort = ctrl;
      renderScanning();

      const startAt = Date.now();
      const created = await client.createJob(file, {
        instrument: state.instrument,
        title: state.title,
        scanMode: state.scanMode,
        signal: ctrl?.signal
      });

      if (!created.ok) {
        if (created.aborted) {
          state.screen = 'upload';
          renderUpload();
          return;
        }
        showErrorScreen(
          created.unreachable ? 'Scan server not reachable' : 'Could not start scan',
          created.error || 'Please check that the scan server is running and try again.'
        );
        return;
      }

      state.jobId = created.jobId;
      winState.jobId = created.jobId;
      winState.title = state.title;
      winState.instrument = state.instrument;
      if (typeof onChange === 'function') onChange();
      if (created.status === 'completed' && created.cacheHit) {
        const doneJob = await client.getJob(created.jobId, ctrl?.signal);
        if (doneJob.ok && (doneJob.correctedMusicxml || doneJob.rawMusicxml)) {
          const xml = doneJob.correctedMusicxml || doneJob.rawMusicxml;
          const model = sfParseMusicXml(xml);
          const effectiveMode = doneJob?.scanMode || state.scanMode || 'full';
          if (typeof sfFilterScoreByMode === 'function' && effectiveMode !== 'full') {
            sfFilterScoreByMode(model, effectiveMode);
          }
          const warnParts = [];
          if (doneJob.warning) warnParts.push(doneJob.warning);
          else if (Array.isArray(doneJob.skippedPages) && doneJob.skippedPages.length) warnParts.push(`Skipped unreadable page(s): ${doneJob.skippedPages.join(', ')}`);
          const cueWarn = formatSpokenCuesWarning(doneJob.detectedSpokenCues);
          if (cueWarn) warnParts.push(cueWarn);
          enterReview(model, 'Instant match — loaded previously verified scan from the server.', warnParts.join(' '), doneJob.pdfTextMeta, { alternateRuns: doneJob.alternateRuns });
          pollAlternateRunsInBackground(doneJob);
          return;
        }
      }

      const job = await client.pollJob(created.jobId, {
        signal: ctrl?.signal,
        onProgress: (j, elapsed) => {
          const rawP = Number(j.progress);
          const pct = Number.isFinite(rawP)
            ? (rawP > 0 && rawP <= 1 ? Math.round(rawP * 100) : Math.round(rawP))
            : (j.status === 'processing' ? 35 : 10);
          state.scanStage = friendlyStage(j.stage, j.status);
          state.scanDetail = j.stageDetail || state.scanStage;
          state.scanProgress = Math.max(5, Math.min(98, pct));
          state.scanElapsedMs = elapsed || (Date.now() - startAt);
          if (j.currentPage != null) state.scanCurrentPage = Number(j.currentPage);
          if (j.totalPages != null) state.scanTotalPages = Number(j.totalPages);
          if (!state.destroyed && state.screen === 'scanning') updateScanningDOM();
        }
      });

      state.pollAbort = null;
      if (state.destroyed) return;
      if (!job.ok || job.status === 'failed') {
        if (job.aborted) {
          state.screen = 'upload';
          renderUpload();
          return;
        }
        showErrorScreen(
          'Could not read sheet music from this scan',
          job.error || 'Please try again with a flatter, evenly lit page or a cleaner PDF.'
        );
        return;
      }

      const xml = job.correctedMusicxml || job.rawMusicxml;
      if (!xml) {
        showErrorScreen('Empty scan result', 'No usable music notation was returned. Try a clearer page.');
        return;
      }
      try {
        const model = sfParseMusicXml(xml);
        const effectiveMode = job?.scanMode || state.scanMode || 'full';
        if (typeof sfFilterScoreByMode === 'function' && effectiveMode !== 'full') {
          sfFilterScoreByMode(model, effectiveMode);
        }
        const banner = job.cacheHit ? 'Instant match — loaded previously verified scan.' : '';
        const warnParts = [];
        if (job.warning) warnParts.push(job.warning);
        else if (Array.isArray(job.skippedPages) && job.skippedPages.length) warnParts.push(`Skipped unreadable page(s): ${job.skippedPages.join(', ')}`);
        const cueWarn = formatSpokenCuesWarning(job.detectedSpokenCues);
        if (cueWarn) warnParts.push(cueWarn);
        enterReview(model, banner, warnParts.join(' '), job.pdfTextMeta, { alternateRuns: job.alternateRuns });
        pollAlternateRunsInBackground(job);
      } catch (err) {
        showErrorScreen('Could not read extracted MusicXML', err?.message || 'Try scanning a single clean page.');
      }
    }

    // ---------- Scanning progress screen
    function renderScanning() {
      const pagePill = state.scanTotalPages && state.scanTotalPages > 1
        ? `<span class="sf-page-pill" id="sf-scan-pages">${state.scanCurrentPage ? `Page ${state.scanCurrentPage} of ${state.scanTotalPages}` : `${state.scanTotalPages} pages`}</span>`
        : `<span class="sf-page-pill" id="sf-scan-pages" hidden></span>`;
      host.innerHTML = `<div class="sf-root">
        <div class="sf-center">
          <div class="sf-card">
            <div class="sf-card-head">
              <div>
                <h2>Scanning sheet music…</h2>
                <p class="sf-sub">${hEsc(state.file?.name || 'Uploaded page')}</p>
              </div>
              <button type="button" class="sf-btn" id="sf-scan-cancel">Cancel</button>
            </div>
            <div class="sf-prog-track"><div class="sf-prog-fill" id="sf-scan-fill" style="width:${state.scanProgress}%"></div></div>
            <div class="sf-prog-detail">
              <span id="sf-scan-detail">${hEsc(state.scanDetail || state.scanStage)}</span>
              <span class="sf-prog-nums">
                ${pagePill}
                <span id="sf-scan-pct">${state.scanProgress}%</span>
                <span>·</span>
                <span id="sf-scan-elapsed">${formatDurationMs(state.scanElapsedMs)}</span>
              </span>
            </div>
          </div>
        </div>
      </div>`;
      host.querySelector('#sf-scan-cancel').addEventListener('click', () => {
        if (state.pollAbort) state.pollAbort.abort();
        state.screen = 'upload';
        renderUpload();
      });
    }

    function updateScanningDOM() {
      const det = host.querySelector('#sf-scan-detail');
      const fl = host.querySelector('#sf-scan-fill');
      const pct = host.querySelector('#sf-scan-pct');
      const el = host.querySelector('#sf-scan-elapsed');
      const pg = host.querySelector('#sf-scan-pages');
      if (det) det.textContent = state.scanDetail || state.scanStage;
      if (fl) fl.style.width = `${state.scanProgress}%`;
      if (pct) pct.textContent = `${state.scanProgress}%`;
      if (el) el.textContent = formatDurationMs(state.scanElapsedMs);
      if (pg) {
        if (state.scanTotalPages && state.scanTotalPages > 1) {
          pg.hidden = false;
          pg.textContent = state.scanCurrentPage
            ? `Page ${state.scanCurrentPage} of ${state.scanTotalPages}`
            : `${state.scanTotalPages} pages`;
        } else {
          pg.hidden = true;
        }
      }
    }

    // ---------- Error screen
    function showErrorScreen(title, msg) {
      state.screen = 'error';
      state.errorTitle = title;
      state.errorMsg = msg;
      host.innerHTML = `<div class="sf-root">
        <div class="sf-center">
          <div class="sf-card sf-err-card">
            <div class="sf-err-title">${iconHtml('warn', '⚠')}<span>${hEsc(title)}</span></div>
            <p class="sf-sub" style="margin:0;color:var(--sf-text)">${hEsc(msg)}</p>
            <ul class="sf-err-tips">
              <li>Flatten the page and avoid shadows or skewed angles.</li>
              <li>Scan one clear part or page at a time (at least 200–300 DPI for PDFs).</li>
              <li>Make sure the local scan server (<span class="sf-code-hint">tools/omr-service/run.sh</span>) is running.</li>
            </ul>
            <div class="sf-or-row" style="border-top:none;padding-top:4px">
              <button type="button" class="sf-btn primary" id="sf-err-back">Try another file</button>
              ${state.file ? `<button type="button" class="sf-btn" id="sf-err-retry">Retry scan</button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
      host.querySelector('#sf-err-back').addEventListener('click', () => {
        state.screen = 'upload';
        renderUpload();
      });
      host.querySelector('#sf-err-retry')?.addEventListener('click', () => {
        if (state.file) startScanUpload(state.file);
      });
    }

    function parseAlternateRunModels(alternateRuns) {
      if (!Array.isArray(alternateRuns) || !alternateRuns.length) return [];
      const out = [];
      for (const run of alternateRuns) {
        if (run?.status === 'completed' && run?.rawMusicxml) {
          try {
            const parsed = sfParseMusicXml(run.rawMusicxml);
            if (parsed) out.push(parsed);
          } catch { /* ignore malformed alternate */ }
        }
      }
      return out;
    }

    function pollAlternateRunsInBackground(job) {
      if (!client || !job?.jobId || !job.multiRun || job.multiRun === 'off') return;
      const runs = Array.isArray(job.alternateRuns) ? job.alternateRuns : [];
      if (!runs.some(r => r?.status === 'pending' || r?.status === 'processing')) return;
      const targetJobId = job.jobId;
      let lastCompletedCount = runs.filter(r => r?.status === 'completed').length;
      let attempts = 0;

      const tick = async () => {
        if (state.destroyed || state.jobId !== targetJobId || state.screen !== 'review' || attempts >= 6) return;
        attempts += 1;
        try {
          const updated = await client.getJob(targetJobId);
          if (state.destroyed || state.jobId !== targetJobId || state.screen !== 'review') return;
          if (updated.ok && Array.isArray(updated.alternateRuns)) {
            const completedCount = updated.alternateRuns.filter(r => r?.status === 'completed').length;
            if (completedCount > lastCompletedCount) {
              lastCompletedCount = completedCount;
              state.alternateModels = parseAlternateRunModels(updated.alternateRuns);
              analyzeAndSyncGate(undefined);
              updateTopBarState();
              renderFlagStrip();
              updateMeasureOverlays();
              if (state.drawerOpen) renderDrawer();
            }
            if (!updated.alternateRuns.some(r => r?.status === 'pending' || r?.status === 'processing')) return;
          }
        } catch { /* ignore background poll error */ }
        if (attempts < 6 && !state.destroyed && state.jobId === targetJobId && state.screen === 'review') {
          setTimeout(tick, 3000);
        }
      };
      setTimeout(tick, 3000);
    }

    // ---------- Review & Fix workspace
    function analyzeAndSyncGate(editedMeasureIndex) {
      const inst = (state.instrument === 'auto' || state.instrument === 'choir')
        ? sfDetectInstrument(state.model.parts?.[0]?.name || '')
        : state.instrument;
      state.flagReport = sfAnalyzeFlags(state.model, { instrument: inst, alternateModels: state.alternateModels || [] });
      if (!state.saveGate) {
        state.saveGate = new SfSaveGate(state.flagReport);
      } else {
        state.saveGate.syncFlags(state.flagReport, editedMeasureIndex);
      }
      state.playbackScore = sfModelToPlaybackScore(state.model);
      sfCtl.sc = state.playbackScore;
    }

    function enterReview(model, cacheBanner, scanWarning, pdfTextMeta, opts) {
      state.screen = 'review';
      state.model = model;
      state.alternateModels = parseAlternateRunModels(opts?.alternateRuns);
      state.dirty = !(opts && opts.clean);
      state.mode = 'select';
      state.eraserMode = false;
      state.drawerOpen = false;
      if (state.instrument === 'auto' && model.parts?.[0]?.name) {
        const detected = sfDetectInstrument(model.parts[0].name);
        if (detected && detected !== 'auto') state.instrument = detected;
      }
      if (!state.title) state.title = model.workTitle || 'Scanned Score';

      const autoNotes = [];
      if (pdfTextMeta?.lyricVocabulary?.length && typeof sfCleanOcrLyrics === 'function') {
        const ocrRes = sfCleanOcrLyrics(model, pdfTextMeta.lyricVocabulary);
        if (ocrRes?.fixedCount > 0) {
          autoNotes.push(`Auto-cleaned ${ocrRes.fixedCount} OCR lyric typo${ocrRes.fixedCount === 1 ? '' : 's'}`);
        }
      }
      if (Array.isArray(model.autoRepairs) && model.autoRepairs.length > 0) {
        autoNotes.push(`aligned ${model.autoRepairs.length} signature${model.autoRepairs.length === 1 ? '' : 's'}`);
      }
      const combinedBanner = [cacheBanner, autoNotes.length ? autoNotes.join(' · ') + '.' : ''].filter(Boolean).join(' · ');

      state.history = new SfHistory(model, 100);
      state.saveGate = null;
      state.selectedNoteId = null;
      state.selectedDirId = null;
      state.selectedTieId = null;
      state.selectedHeaderText = null;
      state.selectedPartIndex = 0;
      state.selectedStaff = 1;
      state.selectedParts = [0];
      state.selectedStaves = [{ partIndex: 0, staff: 1 }];
      state.activeMeasure = 0;
      state.copyRange = { partIndex: 0, anchor: 0, start: 0, end: 0 };
      state.clipboard = null;
      state.inlineEditor = null;
      state.savedFileId = null;
      state.cacheBanner = combinedBanner;
      state.scanWarning = scanWarning || '';
      analyzeAndSyncGate(undefined);
      renderReviewShell();
      renderOriginalPane();
      renderOsmdScore(false);
    }

    function renderReviewShell() {
      const instOpts = getInstrumentList().map(([k, label]) =>
        `<option value="${hEsc(k)}" ${state.instrument === k ? 'selected' : ''}>${hEsc(label)}</option>`
      ).join('');
      const authMissing = client && client.isMemberSignInRequired(state.health) && !client.getMemberAuth().token;

      host.innerHTML = `<div class="sf-root ${state.mode === 'erase' ? 'is-eraser' : ''}">
        <div class="sf-bar">
          <button type="button" class="sf-btn" id="sf-new-scan" title="Start over with another file">New scan</button>
          <input type="text" class="sf-title-in" id="sf-rev-title" value="${hEsc(state.title)}" placeholder="Piece title">
          <select class="sf-inst-sel" id="sf-rev-inst" title="Instrument for range checking">${instOpts}</select>
          <button type="button" class="sf-btn" id="sf-play-btn" title="Play or stop from selected measure (Space)">${iconHtml('play', '▶')} Play</button>
          <button type="button" class="sf-btn" id="sf-layout-btn" title="Switch between scrolling down the page and one long line scrolling sideways">${state.scoreLayout === 'h' ? `${iconHtml('movehoriz', '↔')} Sideways` : `${iconHtml('movevert', '↕')} Down`}</button>
          <div class="sf-seg" role="group" aria-label="View layout">
            <button type="button" class="sf-btn-split ${state.layout === 'split' ? 'on' : ''}" data-sf-layout="split">Split</button>
            <button type="button" class="${state.layout === 'score' ? 'on' : ''}" data-sf-layout="score">Score</button>
            <button type="button" class="${state.layout === 'original' ? 'on' : ''}" data-sf-layout="original">Original</button>
          </div>
          <button type="button" class="sf-btn icon" id="sf-undo" title="Undo (Cmd/Ctrl+Z)">${iconHtml('undo', '↶')}</button>
          <button type="button" class="sf-btn icon" id="sf-redo" title="Redo (Cmd/Ctrl+Shift+Z)">${iconHtml('redo', '↷')}</button>
          <div class="sf-flag-group">
            <button type="button" class="sf-btn sf-flag-nav" id="sf-flag-prev" title="Previous flagged or fixed measure">‹</button>
            <button type="button" class="sf-btn" id="sf-flag-pill" title="Open Flags &amp; Fixes review drawer">Flags</button>
            <button type="button" class="sf-btn sf-flag-nav" id="sf-flag-next" title="Next flagged or fixed measure">›</button>
            <button type="button" class="sf-btn warn" id="sf-next-flag">Next flagged →</button>
          </div>
          <div class="sf-spacer"></div>
          <button type="button" class="sf-btn primary" id="sf-save-btn">Save to Library</button>
        </div>

        <div class="sf-editbar" id="sf-editbar" aria-label="Notation editing toolbar"></div>

        ${state.cacheBanner ? `<div class="sf-banner info" id="sf-cache-banner"><span>${hEsc(state.cacheBanner)}</span><div class="sf-banner-acts">${state.file ? `<button type="button" class="sf-btn" id="sf-rescan-btn">Re-scan fresh</button>` : ''}<button type="button" class="sf-btn" id="sf-cache-dismiss">Dismiss</button></div></div>` : ''}
        ${state.scanWarning ? `<div class="sf-banner warn" id="sf-warn-banner"><span>${hEsc(state.scanWarning)}</span><div class="sf-banner-acts"><button type="button" class="sf-btn" id="sf-warn-dismiss">Dismiss</button></div></div>` : ''}
        ${authMissing ? `<div class="sf-banner auth" id="sf-auth-banner"><span>Sign in as a teacher or student to save verified scores to your Library.</span><div class="sf-banner-acts"><button type="button" class="sf-btn primary" id="sf-signin-btn">Sign in</button></div></div>` : ''}
        <div class="sf-banner success" id="sf-saved-banner" hidden>
          <span id="sf-saved-msg">Saved verified score to Library.</span>
          <div class="sf-banner-acts">
            <button type="button" class="sf-btn primary" id="sf-open-practice">Open in Score Practice</button>
          </div>
        </div>

        <div class="sf-workspace" id="sf-workspace" data-layout="${hEsc(state.layout)}">
          <section class="sf-pane sf-orig-pane" aria-label="Original uploaded scan">
            <div class="sf-pane-head">
              <span>Original scan</span>
              <div class="sf-banner-acts" id="sf-orig-ctrls"></div>
            </div>
            <div class="sf-orig-view" id="sf-orig-view"></div>
          </section>

          <section class="sf-pane sf-score-pane" aria-label="Interactive score to fix">
            <div class="sf-flag-strip" id="sf-flag-strip"></div>
            <div class="sf-drawer" id="sf-drawer" hidden></div>
            <div class="sf-score-scroll" id="sf-score-scroll">
              <div class="sf-score-stage" id="sf-score-stage">
                <div class="sf-osmd" id="sf-osmd"></div>
                <div class="sf-ov" id="sf-ov"></div>
                <div class="sf-ph" id="sf-ph" hidden></div>
                <div class="sf-inline-pill" id="sf-inline-pill" hidden></div>
              </div>
            </div>
          </section>
        </div>
      </div>`;

      sfCtl.root = host.querySelector('.sf-root');
      if (sfCtl.root) {
        sfCtl.root.addEventListener('pointerdown', () => {
          window.__spaceTarget = 'sf';
        });
      }
      window.__spaceTarget = 'sf';

      bindReviewEvents();
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
    }

    function renderEditBar() {
      const bar = host.querySelector('#sf-editbar');
      if (!bar || !state.model) return;

      const noteFound = state.selectedNoteId ? sfFindEntry(state.model, state.selectedNoteId) : null;
      const dirFound = state.selectedDirId ? sfFindEntry(state.model, state.selectedDirId) : null;
      const tieFound = state.selectedTieId ? sfFindEntry(state.model, state.selectedTieId) : null;
      const lyrFound = state.selectedLyricNoteId ? sfFindEntry(state.model, state.selectedLyricNoteId) : null;
      const hasHeaderTexts = typeof sfGetHeaderTexts === 'function' && sfGetHeaderTexts(state.model).length > 0;
      const e = noteFound?.entry || null;
      const d = dirFound?.entry || null;
      const hasNote = !!e;
      const isPitched = !!(e && !e.isRest);
      const isRest = !!(e && e.isRest);

      let selText = `m. ${state.activeMeasure + 1} · Tap a note`;
      const cr = state.copyRange;
      const rangeSpan = cr && cr.end > cr.start ? `m. ${cr.start + 1}–${cr.end + 1}` : null;
      if (rangeSpan) {
        selText = `${rangeSpan} (selected)`;
      } else if (state.selectedHeaderText) {
        selText = `Header · ${state.selectedHeaderText}`;
      } else if (tieFound) {
        selText = `Tie · m. ${tieFound.measureIndex + 1} (${formatNotePitch(tieFound.entry)})`;
      } else if (lyrFound) {
        const lt = typeof sfGetNoteLyric === 'function' ? sfGetNoteLyric(lyrFound.entry, 1) : '';
        selText = `Lyric · m. ${lyrFound.measureIndex + 1}${lt ? ' · ' + lt : ''}`;
      } else if (e) {
        const durName = DUR_LABELS[e.type] || e.type || '';
        selText = e.isRest
          ? `m. ${noteFound.measureIndex + 1} · Rest${durName ? ' · ' + durName : ''}`
          : e.spoken
            ? `m. ${noteFound.measureIndex + 1} · Spoken${durName ? ' · ' + durName : ''}`
            : `m. ${noteFound.measureIndex + 1} · ${formatNotePitch(e)}${durName ? ' · ' + durName : ''}`;
      } else if (d) {
        const txt = typeof sfGetDirectionText === 'function' ? sfGetDirectionText(d) : '';
        const kindLbl = d.markingKind === 'dynamic'
          ? `Dynamic${d.markingValue ? ' (' + d.markingValue + ')' : ''}`
          : d.markingKind === 'tempo'
            ? 'Tempo'
            : d.markingKind === 'vocal'
              ? 'Vocal'
              : d.markingKind === 'expression'
                ? 'Marking'
                : 'Text';
        selText = `m. ${dirFound.measureIndex + 1} · ${kindLbl}${txt ? ' · ' + txt : ''}`;
      }

      const isSpoken = !!(isPitched && e.spoken);

      const isTied = !!(isPitched && Array.isArray(e.ties) && e.ties.includes('start'));
      const canTie = !!(isPitched && typeof sfCanTieNext === 'function' && sfCanTieNext(state.model, state.selectedNoteId));
      const tieEnabled = isTied || canTie;
      const tieTitle = tieEnabled
        ? 'Tie or untie with the next note of the same pitch (T)'
        : 'Next note in this voice is a different pitch or missing';

      const clip = state.clipboard;
      const curTime = typeof sfGetEffectiveTimeSig === 'function'
        ? sfGetEffectiveTimeSig(state.model, state.activeMeasure || 0)
        : { beats: 4, beatType: 4, explicit: false };
      const curTempo = typeof sfGetMeasureTempo === 'function'
        ? sfGetMeasureTempo(state.model, state.activeMeasure || 0)
        : { bpm: 100, beatUnit: 'quarter', beatUnitDot: false, label: '', explicit: false };
      const tempoSym = (curTempo.beatUnit === 'half' ? '𝅗𝅥' : curTempo.beatUnit === 'eighth' ? '♪' : '♩') + (curTempo.beatUnitDot ? '.' : '');
      const curKey = typeof sfGetEffectiveKeySig === 'function'
        ? sfGetEffectiveKeySig(state.model, state.activeMeasure || 0)
        : { fifths: 0, mode: 'major', explicit: false };
      const keyLbls = { '-7': '7♭ C♭', '-6': '6♭ G♭', '-5': '5♭ D♭', '-4': '4♭ A♭', '-3': '3♭ E♭', '-2': '2♭ B♭', '-1': '1♭ F', '0': '0 C', '1': '1♯ G', '2': '2♯ D', '3': '3♯ A', '4': '4♯ E', '5': '5♯ B', '6': '6♯ F♯', '7': '7♯ C♯' };
      const clipRange = clip
        ? (clip.endMeasureIndex > clip.startMeasureIndex ? `m. ${clip.startMeasureIndex + 1}–${clip.endMeasureIndex + 1}` : `m. ${clip.startMeasureIndex + 1}`)
        : '';
      const pasteLabel = clip ? `Paste (${clip.mode === 'rhythm' ? 'Rhythm' : 'All'})` : 'Paste';
      const pasteTitle = clip
        ? `Paste ${clip.mode === 'rhythm' ? 'rhythm' : 'all'} from ${clipRange} (⌘V)`
        : 'Copy a measure first (⌘C or ⌘⇧C)';

      const numParts = state.model.parts?.length || 1;
      const allStaves = [];
      for (let pi = 0; pi < numParts; pi++) {
        const ns = Math.max(1, state.model.parts?.[pi]?.staves || 1);
        for (let s = 1; s <= ns; s++) allStaves.push({ partIndex: pi, staff: s });
      }
      const totalStaves = allStaves.length;
      const selStaves = (state.selectedStaves && state.selectedStaves.length
        ? state.selectedStaves
        : [{ partIndex: state.selectedPartIndex || 0, staff: state.selectedStaff || 1 }])
        .filter(s => s.partIndex >= 0 && s.partIndex < numParts && s.staff >= 1 && s.staff <= Math.max(1, state.model.parts?.[s.partIndex]?.staves || 1));
      if (!selStaves.length) selStaves.push({ partIndex: 0, staff: 1 });

      const partNameOf = (pi) => state.model.parts?.[pi]?.name || `Part ${pi + 1}`;
      const staffLabelOf = (pi, staff) => {
        const ns = Math.max(1, state.model.parts?.[pi]?.staves || 1);
        if (ns <= 1) return partNameOf(pi);
        const box = state.staffMeasureBoxes[`${pi}:${staff}:${state.activeMeasure || 0}`];
        const clef = box?.clefSign || (staff === 2 ? 'F' : 'G');
        const sub = clef === 'F' ? 'Bass' : clef === 'G' ? 'Treble' : `Staff ${staff}`;
        return `${partNameOf(pi)} (${sub})`;
      };

      const isAllStaves = totalStaves > 1 && selStaves.length === totalStaves;
      const isMulti = selStaves.length > 1;
      const uniquePartsInSel = [...new Set(selStaves.map(s => s.partIndex))];
      const scopeLabel = isAllStaves
        ? `All ${totalStaves} staves`
        : selStaves.length === 1
          ? `1 staff: ${staffLabelOf(selStaves[0].partIndex, selStaves[0].staff)}`
          : uniquePartsInSel.length === 1
            ? `${selStaves.length} staves: ${partNameOf(uniquePartsInSel[0])}`
            : `${selStaves.length} staves`;
      const scopeTitle = totalStaves > 1
        ? (isAllStaves ? 'Click to narrow to 1 staff (or Cmd/Ctrl+click staves to toggle)' : 'Click to select all staves (or Cmd/Ctrl+click staves to toggle)')
        : 'Single-staff score';

      const clearTitle = isMulti
        ? `Clear ${selStaves.length} selected staves in m. ${(state.activeMeasure || 0) + 1}`
        : `Clear only ${staffLabelOf(selStaves[0].partIndex, selStaves[0].staff)} in m. ${(state.activeMeasure || 0) + 1}`;

      bar.innerHTML = `
        <div class="sf-eb-grp">
          <button type="button" class="sf-ebtn ${state.mode === 'select' ? 'on' : ''}" data-sf-mode="select" title="Select and edit notes (Esc)">Select</button>
          <button type="button" class="sf-ebtn eraser ${state.mode === 'erase' ? 'on' : ''}" data-sf-mode="erase" title="1-click Eraser: click any note, rest, lyric, or text to remove it (E)">${iconHtml('erase', '⌫')} Erase</button>
          <div class="sf-sel-pill">
            <button type="button" class="sf-sel-nav" data-sf-nav="-1" title="Previous note or rest (←)" ${!state.model.parts?.length ? 'disabled' : ''}>‹</button>
            <button type="button" class="sf-sel-nav" data-sf-nav="1" title="Next note or rest (→)" ${!state.model.parts?.length ? 'disabled' : ''}>›</button>
          </div>
        </div>

        <div class="sf-eb-grp">
          <button type="button" class="sf-ebtn" data-sf-ed="toggle-rest" ${!hasNote ? 'disabled' : ''} title="Convert Note ↔ Rest (R)">Note↔Rest</button>
          <button type="button" class="sf-ebtn" data-sf-ed="stack" ${!isPitched ? 'disabled' : ''} title="Stack chord note above selection (Shift+A..G)">+ Stack</button>
          <button type="button" class="sf-ebtn" data-sf-ed="ins-note" ${!hasNote ? 'disabled' : ''} title="Insert a note after selection">+ Note</button>
          <button type="button" class="sf-ebtn" data-sf-ed="ins-rest" ${!hasNote ? 'disabled' : ''} title="Insert a rest after selection">+ Rest</button>
        </div>

        <div class="sf-eb-grp">
          <button type="button" class="sf-ebtn" data-sf-ed="step" data-v="-1" ${!isPitched ? 'disabled' : ''} title="Step down (↓)">↓</button>
          <button type="button" class="sf-ebtn" data-sf-ed="step" data-v="1" ${!isPitched ? 'disabled' : ''} title="Step up (↑)">↑</button>
          <button type="button" class="sf-ebtn" data-sf-ed="oct" data-v="-1" ${!isPitched ? 'disabled' : ''} title="Octave down (Shift+↓)">−8va</button>
          <button type="button" class="sf-ebtn" data-sf-ed="oct" data-v="1" ${!isPitched ? 'disabled' : ''} title="Octave up (Shift+↑)">+8va</button>
          ${ACCIDENTALS.map(([val, lbl]) => {
            const on = isPitched && ((val === 'none' && !e.accidental && (e.alter || 0) === 0) || e.accidental === val);
            return `<button type="button" class="sf-ebtn ${on ? 'on' : ''}" data-sf-ed="acc" data-v="${val}" ${!isPitched ? 'disabled' : ''}>${lbl}</button>`;
          }).join('')}
          <button type="button" class="sf-ebtn" data-sf-ed="respell" ${!isPitched ? 'disabled' : ''} title="Respell enharmonic (♯↔♭)">♯↔♭</button>
        </div>

        <div class="sf-eb-grp">
          ${DURATIONS.map(([val, lbl]) =>
            `<button type="button" class="sf-ebtn ${hasNote && e.type === val ? 'on' : ''}" data-sf-ed="dur" data-v="${val}" ${!hasNote ? 'disabled' : ''}>${lbl}</button>`
          ).join('')}
          <button type="button" class="sf-ebtn ${hasNote && e.dots ? 'on' : ''}" data-sf-ed="dot" ${!hasNote ? 'disabled' : ''} title="Toggle dot (.)">Dot ·</button>
          <button type="button" class="sf-ebtn ${isSpoken ? 'on' : ''}" data-sf-ed="spoken" ${!isPitched ? 'disabled' : ''} title="Toggle Spoken / X-notehead (X)">Spoken ✕</button>
          <button type="button" class="sf-ebtn ${isTied ? 'on' : ''}" data-sf-ed="tie" ${!tieEnabled ? 'disabled' : ''} title="${hEsc(tieTitle)}">${iconHtml('tie', '⌒')} Tie</button>
        </div>

        <div class="sf-eb-grp">
          <button type="button" class="sf-ebtn" data-sf-ed="lyric" ${!isPitched ? 'disabled' : ''} title="Add or edit lyric under selected note (L)">Lyric</button>
          <button type="button" class="sf-ebtn" data-sf-ed="text" title="Add or edit expression, dynamic, or direction text">Text</button>
          <button type="button" class="sf-ebtn danger" data-sf-ed="del" ${!(hasNote || d || tieFound || lyrFound || state.selectedHeaderText) ? 'disabled' : ''} title="Remove selected item (Delete / Backspace)">Delete</button>
          <button type="button" class="sf-ebtn danger" data-sf-ed="clear-bar" title="${hEsc(clearTitle)}">Clear</button>
          ${hasHeaderTexts ? '<button type="button" class="sf-ebtn danger" data-sf-ed="clear-header" title="Remove all page-1 titles, credits, and composer text">Clear header</button>' : ''}
        </div>

        <div class="sf-eb-grp">
          <button type="button" class="sf-ebtn" data-sf-ed="copy-all" title="Copy all notes, rhythm, lyrics, and markings from selected measure(s) (⌘C)">Copy all</button>
          <button type="button" class="sf-ebtn" data-sf-ed="copy-rhythm" title="Copy only the rhythm from selected measure(s) — keeps target pitches when pasting (⌘⇧C)">Copy rhythm</button>
          <button type="button" class="sf-ebtn ${clip ? 'on' : ''}" data-sf-ed="paste" ${!clip ? 'disabled' : ''} title="${hEsc(pasteTitle)}">Paste</button>
          <button type="button" class="sf-ebtn" id="sf-meter-btn" title="Change time signature for this bar or from here on">${curTime.beats}/${curTime.beatType} ▾</button>
          <button type="button" class="sf-ebtn" id="sf-tempo-btn" title="Set tempo marking (BPM) at this measure">${hEsc(`${tempoSym}=${curTempo.bpm}`)} ▾</button>
          <button type="button" class="sf-ebtn" id="sf-key-btn" title="Change key signature at this measure">${hEsc(keyLbls[String(curKey.fifths)] || '0 C')} ▾</button>
        </div>

        <div class="sf-sel-readout">
          <span class="sf-sel-lbl" title="${hEsc(selText)}">${hEsc(selText)}</span>
          ${totalStaves > 1 ? `<button type="button" class="sf-scope-pill ${isMulti ? 'multi' : ''}" id="sf-scope-toggle" title="${hEsc(scopeTitle)}">${hEsc(scopeLabel)}</button>` : ''}
        </div>
      `;

      bar.querySelectorAll('[data-sf-mode]').forEach((btn) => {
        btn.addEventListener('click', () => setToolMode(btn.dataset.sfMode));
      });
      bar.querySelector('#sf-scope-toggle')?.addEventListener('click', () => {
        if (totalStaves <= 1) return;
        if (state.selectedStaves.length === totalStaves) {
          state.selectedStaves = [{ partIndex: state.selectedPartIndex || 0, staff: state.selectedStaff || 1 }];
          state.selectedParts = [state.selectedPartIndex || 0];
        } else {
          state.selectedStaves = allStaves;
          state.selectedParts = Array.from({ length: numParts }, (_, i) => i);
        }
        renderEditBar();
        updateMeasureOverlays();
      });
      bar.querySelectorAll('[data-sf-nav]').forEach((btn) => {
        btn.addEventListener('click', () => stepSelection(Number(btn.dataset.sfNav)));
      });
      bar.querySelectorAll('[data-sf-ed]').forEach((btn) => {
        btn.addEventListener('click', () => applyToolbarEdit(btn.dataset.sfEd, btn.dataset.v));
      });
      bar.querySelector('#sf-meter-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleMeterPopover(ev.currentTarget);
      });
      bar.querySelector('#sf-tempo-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleTempoPopover(ev.currentTarget);
      });
      bar.querySelector('#sf-key-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleKeyPopover(ev.currentTarget);
      });
    }

    function closeBarPopovers(rootEl) {
      if (typeof rootEl?.__sfCloseBarPop === 'function') {
        rootEl.__sfCloseBarPop();
      }
      rootEl?.querySelectorAll('.sf-meter-pop, .sf-tempo-pop, .sf-key-pop').forEach(el => el.remove());
    }

    function bindBarPopoverLifecycle(rootEl, pop, anchorBtn) {
      const closePop = () => {
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onPopKey, true);
        if (pop.parentNode) pop.remove();
        if (rootEl.__sfCloseBarPop === closePop) rootEl.__sfCloseBarPop = null;
      };
      const onDocDown = (e) => {
        if (!pop.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) closePop();
      };
      const onPopKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
      };
      rootEl.__sfCloseBarPop = closePop;
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onPopKey, true);
      return closePop;
    }

    function applyMeterChange(mi, beats, beatType, thisBarOnly) {
      if (typeof sfSetMeasureTimeSig !== 'function' || !state.model) return;
      const b = Math.max(1, Math.min(32, Math.round(Number(beats) || 4)));
      const btRaw = Math.round(Number(beatType) || 4);
      const bt = [1, 2, 4, 8, 16, 32].includes(btRaw) ? btRaw : 4;
      const working = sfCloneModel(state.model);
      if (!sfSetMeasureTimeSig(working, mi, b, bt, { thisBarOnly: !!thisBarOnly })) return;
      commitModelChange(`Meter ${b}/${bt}`, working, mi, undefined, false);
      showToast(`Set m. ${mi + 1} to ${b}/${bt}${thisBarOnly ? ' (this bar only)' : ''}.`);
    }

    function removeMeterChange(mi) {
      if (typeof sfRemoveMeasureTimeSig !== 'function' || !state.model) return;
      const working = sfCloneModel(state.model);
      if (!sfRemoveMeasureTimeSig(working, mi)) return;
      commitModelChange('Remove meter change', working, mi, undefined, false);
      showToast(`Removed meter change at m. ${mi + 1}.`);
    }

    function toggleMeterPopover(anchorBtn) {
      const rootEl = host.querySelector('.sf-root') || host;
      const wasOpen = !!rootEl.querySelector('.sf-meter-pop');
      closeBarPopovers(rootEl);
      if (wasOpen) return;
      if (!state.model || typeof sfGetEffectiveTimeSig !== 'function') return;

      const mi = state.activeMeasure || 0;
      const cur = sfGetEffectiveTimeSig(state.model, mi);
      const presets = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/2', '3/8', '6/8', '9/8', '12/8'];

      const pop = document.createElement('div');
      pop.className = 'sf-meter-pop';
      pop.innerHTML = `
        <div class="sf-meter-head">Time signature · m. ${mi + 1}</div>
        ${mi > 0 ? `<label class="sf-meter-scope"><input type="checkbox" id="sf-meter-baronly" checked> This bar only (m. ${mi + 1})</label>` : ''}
        <div class="sf-meter-grid">
          ${presets.map(p => {
            const on = p === `${cur.beats}/${cur.beatType}`;
            return `<button type="button" class="sf-ebtn ${on ? 'on' : ''}" data-sf-mp="${p}">${p}</button>`;
          }).join('')}
        </div>
        <div class="sf-meter-custom">
          <input type="number" id="sf-meter-beats" min="1" max="32" value="${cur.beats}" aria-label="Beats per measure">
          <span>/</span>
          <input type="number" id="sf-meter-type" min="1" max="32" value="${cur.beatType}" aria-label="Beat unit">
          <button type="button" class="sf-btn sf-btn-primary" id="sf-meter-apply">Apply</button>
        </div>
        ${mi > 0 && cur.explicit ? '<button type="button" class="sf-btn sf-btn-danger sf-meter-rem" id="sf-meter-remove">Remove change</button>' : ''}
      `;

      const rRoot = rootEl.getBoundingClientRect();
      const rBtn = anchorBtn.getBoundingClientRect();
      pop.style.top = `${Math.max(8, rBtn.bottom - rRoot.top + 6)}px`;
      pop.style.left = `${Math.max(8, Math.min(rRoot.width - 256, rBtn.left - rRoot.left))}px`;
      rootEl.appendChild(pop);

      const closePop = bindBarPopoverLifecycle(rootEl, pop, anchorBtn);

      const isBarOnly = () => !!(pop.querySelector('#sf-meter-baronly')?.checked);
      pop.querySelectorAll('[data-sf-mp]').forEach((b) => {
        b.addEventListener('click', () => {
          const [bts, bty] = b.dataset.sfMp.split('/').map(Number);
          closePop();
          applyMeterChange(mi, bts, bty, isBarOnly());
        });
      });
      pop.querySelector('#sf-meter-apply')?.addEventListener('click', () => {
        const bts = Number(pop.querySelector('#sf-meter-beats')?.value || 4);
        const bty = Number(pop.querySelector('#sf-meter-type')?.value || 4);
        closePop();
        applyMeterChange(mi, bts, bty, isBarOnly());
      });
      pop.querySelector('#sf-meter-remove')?.addEventListener('click', () => {
        closePop();
        removeMeterChange(mi);
      });
    }

    function toggleTempoPopover(anchorBtn) {
      const rootEl = host.querySelector('.sf-root') || host;
      const wasOpen = !!rootEl.querySelector('.sf-tempo-pop');
      closeBarPopovers(rootEl);
      if (wasOpen) return;
      if (!state.model || typeof sfGetMeasureTempo !== 'function') return;

      const mi = state.activeMeasure || 0;
      const cur = sfGetMeasureTempo(state.model, mi);
      let selUnit = cur.beatUnit || 'quarter';
      let selDot = !!cur.beatUnitDot;
      const presets = [60, 72, 84, 96, 108, 120, 132, 144];
      const units = [
        { unit: 'quarter', dot: false, lbl: '♩' },
        { unit: 'quarter', dot: true, lbl: '♩.' },
        { unit: 'half', dot: false, lbl: '𝅗𝅥' },
        { unit: 'eighth', dot: false, lbl: '♪' }
      ];

      const pop = document.createElement('div');
      pop.className = 'sf-tempo-pop';
      pop.innerHTML = `
        <div class="sf-meter-head">Tempo · m. ${mi + 1}</div>
        <div class="sf-tempo-bpm">
          <button type="button" class="sf-ebtn" data-sf-tbpm="-5">−5</button>
          <input type="number" id="sf-tempo-bpm" min="20" max="300" value="${cur.bpm}" aria-label="Beats per minute">
          <button type="button" class="sf-ebtn" data-sf-tbpm="5">+5</button>
        </div>
        <div class="sf-meter-grid">
          ${presets.map(p => `<button type="button" class="sf-ebtn ${p === cur.bpm ? 'on' : ''}" data-sf-tp="${p}">${p}</button>`).join('')}
        </div>
        <div class="sf-tempo-units">
          ${units.map((u, idx) => {
            const on = u.unit === selUnit && u.dot === selDot;
            return `<button type="button" class="sf-ebtn ${on ? 'on' : ''}" data-sf-tu="${idx}">${u.lbl}</button>`;
          }).join('')}
        </div>
        <input type="text" class="sf-tempo-lbl" id="sf-tempo-lbl" value="${hEsc(cur.label || '')}" placeholder="Optional marking (e.g. Slowly, Allegro)">
        <div class="sf-tempo-chips">
          ${['Slowly', 'Moderato', 'Allegro'].map(c => `<button type="button" class="sf-ebtn" data-sf-tc="${c}">${c}</button>`).join('')}
        </div>
        <div class="sf-tempo-acts">
          <button type="button" class="sf-btn sf-btn-primary" id="sf-tempo-apply">Apply</button>
          ${cur.explicit ? '<button type="button" class="sf-btn sf-btn-danger" id="sf-tempo-remove">Remove tempo</button>' : ''}
        </div>
      `;

      const rRoot = rootEl.getBoundingClientRect();
      const rBtn = anchorBtn.getBoundingClientRect();
      pop.style.top = `${Math.max(8, rBtn.bottom - rRoot.top + 6)}px`;
      pop.style.left = `${Math.max(8, Math.min(rRoot.width - 270, rBtn.left - rRoot.left))}px`;
      rootEl.appendChild(pop);

      const closePop = bindBarPopoverLifecycle(rootEl, pop, anchorBtn);
      const bpmIn = pop.querySelector('#sf-tempo-bpm');
      const lblIn = pop.querySelector('#sf-tempo-lbl');

      pop.querySelectorAll('[data-sf-tbpm]').forEach((b) => {
        b.addEventListener('click', () => {
          const next = Math.max(20, Math.min(300, Math.round(Number(bpmIn.value || 100) + Number(b.dataset.sfTbpm))));
          bpmIn.value = String(next);
        });
      });
      pop.querySelectorAll('[data-sf-tp]').forEach((b) => {
        b.addEventListener('click', () => {
          bpmIn.value = b.dataset.sfTp;
          pop.querySelectorAll('[data-sf-tp]').forEach(x => x.classList.toggle('on', x === b));
        });
      });
      pop.querySelectorAll('[data-sf-tu]').forEach((b) => {
        b.addEventListener('click', () => {
          const u = units[Number(b.dataset.sfTu)];
          if (!u) return;
          selUnit = u.unit;
          selDot = u.dot;
          pop.querySelectorAll('[data-sf-tu]').forEach(x => x.classList.toggle('on', x === b));
        });
      });
      pop.querySelectorAll('[data-sf-tc]').forEach((b) => {
        b.addEventListener('click', () => { lblIn.value = b.dataset.sfTc; });
      });
      pop.querySelector('#sf-tempo-apply')?.addEventListener('click', () => {
        if (typeof sfSetMeasureTempo !== 'function') return;
        const bpm = Math.max(20, Math.min(300, Math.round(Number(bpmIn.value) || 100)));
        const label = (lblIn.value || '').trim();
        const working = sfCloneModel(state.model);
        if (sfSetMeasureTempo(working, mi, bpm, { beatUnit: selUnit, beatUnitDot: selDot, label })) {
          commitModelChange(`Tempo ${bpm} BPM`, working, mi, undefined, false);
          showToast(`Set m. ${mi + 1} tempo to ${bpm} BPM.`);
        }
        closePop();
      });
      pop.querySelector('#sf-tempo-remove')?.addEventListener('click', () => {
        if (typeof sfRemoveMeasureTempo !== 'function') return;
        const working = sfCloneModel(state.model);
        if (sfRemoveMeasureTempo(working, mi)) {
          commitModelChange('Remove tempo', working, mi, undefined, false);
          showToast(`Removed tempo at m. ${mi + 1}.`);
        }
        closePop();
      });
    }

    function toggleKeyPopover(anchorBtn) {
      const rootEl = host.querySelector('.sf-root') || host;
      const wasOpen = !!rootEl.querySelector('.sf-key-pop');
      closeBarPopovers(rootEl);
      if (wasOpen) return;
      if (!state.model || typeof sfGetEffectiveKeySig !== 'function') return;

      const mi = state.activeMeasure || 0;
      const cur = sfGetEffectiveKeySig(state.model, mi);
      const flats = [[-7, '7♭ C♭'], [-6, '6♭ G♭'], [-5, '5♭ D♭'], [-4, '4♭ A♭'], [-3, '3♭ E♭'], [-2, '2♭ B♭'], [-1, '1♭ F']];
      const sharps = [[1, '1♯ G'], [2, '2♯ D'], [3, '3♯ A'], [4, '4♯ E'], [5, '5♯ B'], [6, '6♯ F♯'], [7, '7♯ C♯']];

      const pop = document.createElement('div');
      pop.className = 'sf-key-pop';
      pop.innerHTML = `
        <div class="sf-meter-head">Key signature · m. ${mi + 1}</div>
        <div class="sf-key-grid">
          ${flats.map(([f, lbl]) => `<button type="button" class="sf-ebtn ${cur.fifths === f ? 'on' : ''}" data-sf-kf="${f}">${lbl}</button>`).join('')}
        </div>
        <button type="button" class="sf-ebtn sf-key-zero ${cur.fifths === 0 ? 'on' : ''}" data-sf-kf="0">0 C / Am</button>
        <div class="sf-key-grid">
          ${sharps.map(([f, lbl]) => `<button type="button" class="sf-ebtn ${cur.fifths === f ? 'on' : ''}" data-sf-kf="${f}">${lbl}</button>`).join('')}
        </div>
        <label class="sf-meter-scope"><input type="checkbox" id="sf-key-match" checked> Match unmarked notes to new key</label>
        ${mi > 0 && cur.explicit ? '<button type="button" class="sf-btn sf-btn-danger sf-meter-rem" id="sf-key-remove">Remove change</button>' : ''}
      `;

      const rRoot = rootEl.getBoundingClientRect();
      const rBtn = anchorBtn.getBoundingClientRect();
      pop.style.top = `${Math.max(8, rBtn.bottom - rRoot.top + 6)}px`;
      pop.style.left = `${Math.max(8, Math.min(rRoot.width - 280, rBtn.left - rRoot.left))}px`;
      rootEl.appendChild(pop);

      const closePop = bindBarPopoverLifecycle(rootEl, pop, anchorBtn);

      pop.querySelectorAll('[data-sf-kf]').forEach((b) => {
        b.addEventListener('click', () => {
          if (typeof sfSetMeasureKeySig !== 'function') return;
          const fifths = Number(b.dataset.sfKf);
          const updateUnmarkedPitches = !!pop.querySelector('#sf-key-match')?.checked;
          const working = sfCloneModel(state.model);
          if (sfSetMeasureKeySig(working, mi, fifths, { updateUnmarkedPitches })) {
            commitModelChange(`Key ${b.textContent}`, working, mi, undefined, false);
            showToast(`Set m. ${mi + 1} key to ${b.textContent}.`);
          }
          closePop();
        });
      });
      pop.querySelector('#sf-key-remove')?.addEventListener('click', () => {
        if (typeof sfRemoveMeasureKeySig !== 'function') return;
        const working = sfCloneModel(state.model);
        if (sfRemoveMeasureKeySig(working, mi)) {
          commitModelChange('Remove key change', working, mi, undefined, false);
          showToast(`Removed key change at m. ${mi + 1}.`);
        }
        closePop();
      });
    }

    function setToolMode(mode) {
      state.mode = mode === 'erase' ? 'erase' : 'select';
      state.eraserMode = state.mode === 'erase';
      const root = host.querySelector('.sf-root');
      if (root) {
        root.classList.toggle('is-eraser', state.mode === 'erase');
      }
      if (state.mode !== 'select') closeInlineEditor();
      renderEditBar();
    }

    function bindReviewEvents() {
      host.querySelector('#sf-new-scan').addEventListener('click', () => {
        stopPlayback();
        state.jobId = '';
        winState.jobId = null;
        if (typeof onChange === 'function') onChange();
        state.screen = 'upload';
        renderUpload();
      });

      const titleIn = host.querySelector('#sf-rev-title');
      titleIn.addEventListener('input', () => {
        state.title = titleIn.value;
        state.dirty = true;
        winState.title = state.title;
        if (state.model) state.model.workTitle = state.title;
        if (typeof onChange === 'function') onChange();
      });

      const instSel = host.querySelector('#sf-rev-inst');
      instSel.addEventListener('change', () => {
        state.instrument = instSel.value;
        winState.instrument = state.instrument;
        if (typeof onChange === 'function') onChange();
        analyzeAndSyncGate(undefined);
        updateTopBarState();
        renderFlagStrip();
        updateMeasureOverlays();
      });

      host.querySelectorAll('[data-sf-layout]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.layout = btn.dataset.sfLayout;
          const ws = host.querySelector('#sf-workspace');
          if (ws) ws.dataset.layout = state.layout;
          host.querySelectorAll('[data-sf-layout]').forEach(b => b.classList.toggle('on', b.dataset.sfLayout === state.layout));
          setTimeout(() => {
            if (state.osmd) {
              try { state.osmd.render(); } catch { }
              rebuildTapMapAndOverlays();
            }
          }, 40);
        });
      });

      host.querySelector('#sf-play-btn').addEventListener('click', toggleContinuousPlayback);
      host.querySelector('#sf-layout-btn').addEventListener('click', () => {
        state.scoreLayout = state.scoreLayout === 'h' ? 'v' : 'h';
        winState.scoreLayout = state.scoreLayout;
        if (typeof onChange === 'function') onChange();
        const btn = host.querySelector('#sf-layout-btn');
        if (btn) {
          btn.innerHTML = state.scoreLayout === 'h'
            ? `${iconHtml('movehoriz', '↔')} Sideways`
            : `${iconHtml('movevert', '↕')} Down`;
        }
        if (state.osmd) {
          state.osmd.setOptions({ renderSingleHorizontalStaffline: state.scoreLayout === 'h' });
          const scrollEl = host.querySelector('#sf-score-scroll');
          if (scrollEl) scrollEl.scrollTo(0, 0);
          renderOsmdScore(false);
        }
      });
      host.querySelector('#sf-undo').addEventListener('click', doUndo);
      host.querySelector('#sf-redo').addEventListener('click', doRedo);
      host.querySelector('#sf-flag-prev').addEventListener('click', () => stepAllFlags(-1));
      host.querySelector('#sf-flag-next').addEventListener('click', () => stepAllFlags(1));
      host.querySelector('#sf-flag-pill').addEventListener('click', () => {
        state.drawerOpen = !state.drawerOpen;
        renderDrawer();
      });
      host.querySelector('#sf-next-flag').addEventListener('click', jumpToNextFlagged);
      host.querySelector('#sf-save-btn').addEventListener('click', handleSaveToLibrary);

      host.querySelector('#sf-cache-dismiss')?.addEventListener('click', () => {
        const b = host.querySelector('#sf-cache-banner');
        if (b) b.remove();
      });
      host.querySelector('#sf-warn-dismiss')?.addEventListener('click', () => {
        const b = host.querySelector('#sf-warn-banner');
        if (b) b.remove();
      });
      host.querySelector('#sf-rescan-btn')?.addEventListener('click', () => {
        if (!state.file || !client) return;
        client.clearLocalCache();
        startScanUpload(state.file);
      });
      host.querySelector('#sf-signin-btn')?.addEventListener('click', () => {
        if (typeof window.HWSYNC?.openSignIn === 'function') window.HWSYNC.openSignIn();
        else if (typeof toast === 'function') toast('Sign in from Settings or the top-right account button.');
      });
      host.querySelector('#sf-open-practice')?.addEventListener('click', () => {
        if (!state.savedFileId || typeof addWindow !== 'function') return;
        addWindow({ kind: 'score', score: { fileId: state.savedFileId, name: state.savedName || 'Scanned Score.mxl' } }, { w: 0.72, h: 0.84 });
      });

      const scrollEl = host.querySelector('#sf-score-scroll');
      scrollEl.addEventListener('click', (e) => {
        if (e.target.closest('.sf-m-bar') || e.target.closest('.sf-inline-pill')) return;
        handleScoreClick(e);
      });
      scrollEl.addEventListener('dblclick', (e) => {
        if (state.eraserMode || e.target.closest('.sf-m-bar') || e.target.closest('.sf-inline-pill')) return;
        const lyrEl = e.target.closest('[data-sf-lyric]');
        if (lyrEl) {
          selectNote(lyrEl.dataset.sfLyric);
          openInlineLyricEditor(lyrEl.dataset.sfLyric);
          return;
        }
        const dirEl = e.target.closest('[data-sf-dir]');
        if (dirEl) {
          selectDirection(dirEl.dataset.sfDir);
          openInlineTextEditor(dirEl.dataset.sfDir);
        }
      });

      const onKey = (e) => {
        if (state.destroyed || state.screen !== 'review') return;
        if (!host.isConnected) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
        if (document.querySelector('#bug-modal, #wn-modal, #av-cal, #sr-ws-modal, #gr-card, .modal:not([hidden])')) return;

        if (e.code === 'Space' && !e.repeat && window.__spaceTarget === 'sf') {
          e.preventDefault();
          if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
          toggleContinuousPlayback();
          return;
        }

        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) doRedo();
          else doUndo();
          return;
        }
        if (mod && e.key.toLowerCase() === 'c') {
          const sel = window.getSelection?.();
          if (sel && String(sel).length > 0) return;
          e.preventDefault();
          doCopyMeasures(e.shiftKey ? 'rhythm' : 'all');
          return;
        }
        if (mod && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          doPasteMeasures();
          return;
        }
        if (mod) return;

        if (e.key === 'Escape') {
          if (state.inlineEditor) closeInlineEditor();
          else if (state.mode !== 'select') setToolMode('select');
          else clearSelection();
          return;
        }

        const k = e.key.toLowerCase();
        if (k === 'e') { e.preventDefault(); setToolMode(state.mode === 'erase' ? 'select' : 'erase'); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepSelection(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepSelection(1); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (!state.selectedNoteId) return;
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          if (e.shiftKey) applyToolbarEdit('oct', dir);
          else if (e.altKey) applyToolbarEdit('semi', dir);
          else applyToolbarEdit('step', dir);
          return;
        }
        if (/^[a-g]$/.test(k) && !e.altKey) {
          if (!state.selectedNoteId) return;
          e.preventDefault();
          if (e.shiftKey) applyToolbarEdit('stack-letter', k.toUpperCase());
          else applyToolbarEdit('letter', k.toUpperCase());
          return;
        }
        if (k === 'r') { if (state.selectedNoteId) { e.preventDefault(); applyToolbarEdit('toggle-rest'); } return; }
        if (k === 'x') { if (state.selectedNoteId) { e.preventDefault(); applyToolbarEdit('spoken'); } return; }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          if (state.selectedNoteId || state.selectedDirId || state.selectedTieId || state.selectedLyricNoteId || state.selectedHeaderText) {
            e.preventDefault();
            applyToolbarEdit('del', e.shiftKey ? 'hard' : '');
          } else if (state.selectedStaves?.length) {
            e.preventDefault();
            applyToolbarEdit('clear-bar');
          }
          return;
        }
        const numDur = { '7': 'whole', '6': 'half', '5': 'quarter', '4': 'eighth', '3': '16th' }[e.key];
        if (numDur) { if (state.selectedNoteId) { e.preventDefault(); applyToolbarEdit('dur', numDur); } return; }
        if (e.key === '.') { if (state.selectedNoteId) { e.preventDefault(); applyToolbarEdit('dot'); } return; }
        if (k === 't') { if (state.selectedNoteId) { e.preventDefault(); applyToolbarEdit('tie'); } return; }
        if (k === 'l') { if (state.selectedNoteId) { e.preventDefault(); openInlineLyricEditor(state.selectedNoteId); } return; }
      };
      document.addEventListener('keydown', onKey);
      host.__sfCleanup = () => {
        state.destroyed = true;
        host.__sfMounted = false;
        stopPlayback();
        if (state.pollAbort) state.pollAbort.abort();
        document.removeEventListener('keydown', onKey);
        cleanupMedia();
      };
    }

    // ---------- Original Scan Pane (Image or PDF.js)
    async function renderOriginalPane() {
      const ctrls = host.querySelector('#sf-orig-ctrls');
      const view = host.querySelector('#sf-orig-view');
      if (!ctrls || !view) return;

      if (!state.file && !state.jobId) {
        ctrls.innerHTML = '';
        view.innerHTML = `<div class="sf-orig-empty">Opened directly from MusicXML — no original page image was uploaded.</div>`;
        return;
      }

      if (state.fileKind === 'pdf' && state.pdfDoc) {
        ctrls.innerHTML = `
          <button type="button" class="sf-btn" id="sf-pdf-prev" ${state.pdfPage <= 1 ? 'disabled' : ''}>‹</button>
          <span>Page ${state.pdfPage} / ${state.pdfTotalPages}</span>
          <button type="button" class="sf-btn" id="sf-pdf-next" ${state.pdfPage >= state.pdfTotalPages ? 'disabled' : ''}>›</button>
          <button type="button" class="sf-btn" id="sf-orig-zout">−</button>
          <span>${Math.round(state.origZoom * 100)}%</span>
          <button type="button" class="sf-btn" id="sf-orig-zin">+</button>
        `;
        view.innerHTML = `<canvas class="sf-orig-media" id="sf-orig-canvas"></canvas>`;
        ctrls.querySelector('#sf-pdf-prev').addEventListener('click', () => {
          if (state.pdfPage > 1) { state.pdfPage--; view.scrollTop = 0; renderOriginalPane(); }
        });
        ctrls.querySelector('#sf-pdf-next').addEventListener('click', () => {
          if (state.pdfPage < state.pdfTotalPages) { state.pdfPage++; view.scrollTop = 0; renderOriginalPane(); }
        });
        ctrls.querySelector('#sf-orig-zout').addEventListener('click', () => {
          state.origZoom = Math.max(0.6, +(state.origZoom - 0.2).toFixed(2));
          renderOriginalPane();
        });
        ctrls.querySelector('#sf-orig-zin').addEventListener('click', () => {
          state.origZoom = Math.min(2.6, +(state.origZoom + 0.2).toFixed(2));
          renderOriginalPane();
        });

        try {
          const page = await state.pdfDoc.getPage(state.pdfPage);
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const baseW = Math.max(260, view.clientWidth - 28);
          const vp1 = page.getViewport({ scale: 1 });
          const scale = (baseW / vp1.width) * state.origZoom;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = view.querySelector('#sf-orig-canvas');
          if (!canvas) return;
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = Math.floor(vp.width / dpr) + 'px';
          canvas.style.height = Math.floor(vp.height / dpr) + 'px';
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        } catch {
          view.innerHTML = `<div class="sf-orig-empty">Could not render this PDF page.</div>`;
        }
        return;
      }

      const src = state.fileObjectUrl || (state.jobId && client ? client.originalUrl(state.jobId) : '');
      ctrls.innerHTML = `
        <button type="button" class="sf-btn" id="sf-orig-zout">−</button>
        <span>${Math.round(state.origZoom * 100)}%</span>
        <button type="button" class="sf-btn" id="sf-orig-zin">+</button>
      `;
      view.innerHTML = `<img class="sf-orig-media" src="${hEsc(src)}" alt="Original scanned sheet music" style="width:${Math.round(state.origZoom * 100)}%;max-width:none">`;
      ctrls.querySelector('#sf-orig-zout').addEventListener('click', () => {
        state.origZoom = Math.max(0.6, +(state.origZoom - 0.2).toFixed(2));
        renderOriginalPane();
      });
      ctrls.querySelector('#sf-orig-zin').addEventListener('click', () => {
        state.origZoom = Math.min(2.6, +(state.origZoom + 0.2).toFixed(2));
        renderOriginalPane();
      });
    }

    // ---------- Pixel-Locked OSMD rendering + tap map + measure overlays
    async function renderOsmdScore(preservePixelLock = true, anchorMeasureIdx = null) {
      const osmdHost = host.querySelector('#sf-osmd');
      const scrollEl = host.querySelector('#sf-score-scroll');
      if (!osmdHost || !scrollEl) return;

      const anchorM = anchorMeasureIdx != null ? anchorMeasureIdx : (state.activeMeasure || 0);
      const prevScrollTop = scrollEl.scrollTop;
      const prevScrollLeft = scrollEl.scrollLeft;
      const prevHostH = osmdHost.offsetHeight;
      const prevHostW = osmdHost.offsetWidth;
      const oldBoxTop = preservePixelLock ? (state.measureBoxes[anchorM]?.y ?? null) : null;
      const oldBoxLeft = preservePixelLock ? (state.measureBoxes[anchorM]?.x ?? null) : null;

      if (preservePixelLock && prevHostH > 0) {
        osmdHost.style.minHeight = prevHostH + 'px';
        if (prevHostW > 0) osmdHost.style.minWidth = prevHostW + 'px';
      }

      try {
        if (typeof spLoadScript === 'function') await spLoadScript('vendor/osmd.min.js');
        const O = window.opensheetmusicdisplay;
        if (!O || !O.OpenSheetMusicDisplay) {
          osmdHost.innerHTML = '<div class="sf-orig-empty" style="color:#333">Score renderer is not available.</div>';
          return;
        }
        if (!state.osmd) {
          osmdHost.innerHTML = '';
          state.osmd = new O.OpenSheetMusicDisplay(osmdHost, {
            autoResize: false,
            backend: 'svg',
            drawTitle: true,
            drawSubtitle: true,
            drawComposer: true,
            drawLyricist: true,
            drawCredits: true,
            drawPartNames: true,
            drawPartAbbreviations: true,
            drawLyrics: true,
            drawingParameters: 'compacttight',
            followCursor: false,
            renderSingleHorizontalStaffline: state.scoreLayout === 'h'
          });
          if (state.osmd.EngravingRules) {
            state.osmd.EngravingRules.PageTopMargin = 6;
            state.osmd.EngravingRules.TitleTopDistance = 2;
            state.osmd.EngravingRules.MinSkyBottomDistBetweenSystems = 4.5;
            state.osmd.EngravingRules.MinimumDistanceBetweenSystems = 9;
          }
        }
        const xml = sfExportMusicXml(state.model);
        await state.osmd.load(xml);
        state.osmd.render();
      } catch (err) {
        osmdHost.style.minHeight = '';
        osmdHost.style.minWidth = '';
        osmdHost.innerHTML = `<div class="sf-orig-empty" style="color:#b91c1c">Could not draw score: ${hEsc(err?.message || 'invalid MusicXML')}</div>`;
        return;
      }

      rebuildTapMapAndOverlays();

      if (preservePixelLock) {
        if (state.scoreLayout === 'h') {
          scrollEl.scrollTop = prevScrollTop;
          const newBoxLeft = state.measureBoxes[anchorM]?.x ?? null;
          if (oldBoxLeft != null && newBoxLeft != null) {
            scrollEl.scrollLeft = Math.max(0, prevScrollLeft + (newBoxLeft - oldBoxLeft));
          } else {
            scrollEl.scrollLeft = prevScrollLeft;
          }
        } else {
          scrollEl.scrollLeft = prevScrollLeft;
          const newBoxTop = state.measureBoxes[anchorM]?.y ?? null;
          if (oldBoxTop != null && newBoxTop != null) {
            const deltaY = newBoxTop - oldBoxTop;
            scrollEl.scrollTop = Math.max(0, prevScrollTop + deltaY);
          } else {
            scrollEl.scrollTop = prevScrollTop;
          }
        }
        requestAnimationFrame(() => {
          osmdHost.style.minHeight = '';
          osmdHost.style.minWidth = '';
        });
      }

      if (state.inlineEditor) positionInlinePill();
    }

    function rebuildTapMapAndOverlays() {
      if (!state.osmd || !state.model) return;
      const osmdHost = host.querySelector('#sf-osmd');
      const ML = state.osmd.GraphicSheet?.MeasureList || [];
      const insts = state.osmd.Sheet?.Instruments || [];
      state.tapMap = sfBuildTapMap(state.model, ML, insts, osmdHost);
      applyFlaggedNoteClasses();
      applySelectionHighlight();
      updateMeasureOverlays();
    }

    function applyFlaggedNoteClasses() {
      const osmdHost = host.querySelector('#sf-osmd');
      if (!osmdHost || !state.flagReport) return;
      osmdHost.querySelectorAll('.sf-note-flagged').forEach(el => el.classList.remove('sf-note-flagged'));
      const flaggedIds = new Set();
      for (const m of state.flagReport.measures || []) {
        if (m.flagged) for (const id of m.noteIds || []) flaggedIds.add(id);
      }
      for (const id of flaggedIds) {
        const el = osmdHost.querySelector(`[data-sf-note="${CSS.escape(id)}"]`);
        if (el) el.classList.add('sf-note-flagged');
      }
    }

    function applySelectionHighlight() {
      const osmdHost = host.querySelector('#sf-osmd');
      if (!osmdHost) return;
      osmdHost.querySelectorAll('.sf-note-selected, .sf-lyric-selected, .sf-dir-selected, .sf-tie-selected')
        .forEach(el => el.classList.remove('sf-note-selected', 'sf-lyric-selected', 'sf-dir-selected', 'sf-tie-selected'));
      if (state.selectedNoteId) {
        const el = osmdHost.querySelector(`[data-sf-note="${CSS.escape(state.selectedNoteId)}"]`);
        if (el) el.classList.add('sf-note-selected');
      }
      if (state.selectedDirId) {
        const el = osmdHost.querySelector(`[data-sf-dir="${CSS.escape(state.selectedDirId)}"]`);
        if (el) el.classList.add('sf-dir-selected');
      }
      if (state.selectedTieId) {
        const el = osmdHost.querySelector(`[data-sf-tie="${CSS.escape(state.selectedTieId)}"]`);
        if (el) el.classList.add('sf-tie-selected');
      }
      if (state.selectedLyricNoteId) {
        const el = osmdHost.querySelector(`[data-sf-lyric="${CSS.escape(state.selectedLyricNoteId)}"]`);
        if (el) el.classList.add('sf-lyric-selected');
      }
      if (state.selectedHeaderText) {
        osmdHost.querySelectorAll('[data-sf-header]').forEach((el) => {
          if (el.dataset.sfHeaderText === state.selectedHeaderText) el.classList.add('sf-header-selected');
        });
      }
    }

    function hitTestNoteId(e) {
      const direct = e.target.closest('[data-sf-note]');
      if (direct) return direct.dataset.sfNote;
      const osmdHost = host.querySelector('#sf-osmd');
      if (!osmdHost) return null;
      const nodes = osmdHost.querySelectorAll('[data-sf-note]');
      let bestId = null;
      let bestDist = 24;
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        const d = Math.hypot(dx, dy);
        if (d <= bestDist) {
          bestDist = d;
          bestId = node.dataset.sfNote;
        }
      }
      return bestId;
    }

    function updateMeasureOverlays() {
      const ov = host.querySelector('#sf-ov');
      const osmdHost = host.querySelector('#sf-osmd');
      if (!ov || !osmdHost || !state.osmd) return;

      const svg = osmdHost.querySelector('svg');
      if (!svg) { ov.innerHTML = ''; return; }
      const sr = svg.getBoundingClientRect();
      const or = ov.getBoundingClientRect();
      const bx = sr.left - or.left;
      const by = sr.top - or.top;
      const U = 10 * (state.osmd.zoom || 1);
      const ML = state.osmd.GraphicSheet?.MeasureList || [];
      const flagByM = new Map((state.flagReport?.measures || []).map(m => [m.measureIndex, m]));

      const svgInkBoxes = [];
      for (const node of svg.querySelectorAll('text, path, rect, line')) {
        if (node.closest('[data-sf-note]')) continue;
        const r = node.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;
        svgInkBoxes.push({
          left: r.left - or.left,
          right: r.right - or.left,
          top: r.top - or.top,
          bottom: r.bottom - or.top
        });
      }

      let html = '';
      state.staffBoxes = [];
      state.partBoxes = {};
      state.staffMeasureBoxes = {};
      ML.forEach((staffs, mi) => {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, pillTop = 1e9;
        let staffIdxInMeasure = 0;
        for (let partIdx = 0; partIdx < (state.model?.parts?.length || 0); partIdx++) {
          const part = state.model.parts[partIdx];
          const numStaves = Math.max(1, part.staves || 1);
          const mModel = part.measures?.[mi];
          let px0 = 1e9, py0 = 1e9, px1 = -1e9, py1 = -1e9;
          for (let s = 1; s <= numStaves; s++) {
            const gm = staffs?.[staffIdxInMeasure++];
            const ps = gm?.PositionAndShape;
            if (!ps) continue;
            const ax = ps.AbsolutePosition.x, ay = ps.AbsolutePosition.y;
            const bl = ps.BorderLeft ?? 0, br = ps.BorderRight ?? ps.Size.width;
            const bt = ps.BorderTop ?? 0, bb = ps.BorderBottom ?? ps.Size.height;
            px0 = Math.min(px0, ax + bl);
            px1 = Math.max(px1, ax + br);
            py0 = Math.min(py0, ay + Math.min(bt, -1));
            py1 = Math.max(py1, ay + Math.max(bb, 5));
            const clefObj = mModel?.clefs?.find(c => (c.staff || 1) === s) || mModel?.clefs?.[0];
            const clefSign = clefObj?.sign || (s === 2 && numStaves > 1 ? 'F' : 'G');
            const sBox = {
              x: bx + (ax + bl) * U,
              y: by + (ay + Math.min(bt, -1)) * U,
              w: Math.max(24, (br - bl) * U),
              h: Math.max(36, (Math.max(bb, 5) - Math.min(bt, -1)) * U),
              clefSign
            };
            state.staffMeasureBoxes[`${partIdx}:${s}:${mi}`] = sBox;
            state.staffBoxes.push({
              partIndex: partIdx,
              measureIndex: mi,
              staff: s,
              x: sBox.x,
              w: sBox.w,
              staffTopY: by + ay * U,
              lineSpacingPx: U,
              clefSign,
              clefLine: clefObj?.line || (s === 2 && numStaves > 1 ? 4 : 2),
              keyFifths: mModel?.key?.fifths || 0
            });
          }
          if (px1 > px0) {
            state.partBoxes[`${partIdx}:${mi}`] = {
              x: bx + px0 * U,
              y: by + py0 * U,
              w: Math.max(24, (px1 - px0) * U),
              h: Math.max(36, (py1 - py0) * U)
            };
          }
        }
        for (const gm of staffs || []) {
          const ps = gm?.PositionAndShape;
          if (!ps) continue;
          const ax = ps.AbsolutePosition.x, ay = ps.AbsolutePosition.y;
          const bl = ps.BorderLeft ?? 0, br = ps.BorderRight ?? ps.Size.width;
          const bt = ps.BorderTop ?? 0, bb = ps.BorderBottom ?? ps.Size.height;
          x0 = Math.min(x0, ax + bl);
          x1 = Math.max(x1, ax + br);
          y0 = Math.min(y0, ay + Math.min(bt, -1));
          y1 = Math.max(y1, ay + Math.max(bb, 5));
          pillTop = Math.min(pillTop, ay + Math.min(bt, -1.6));
          const slPs = gm.ParentStaffLine?.PositionAndShape;
          if (slPs) pillTop = Math.min(pillTop, slPs.AbsolutePosition.y + (slPs.BorderTop ?? -2.5));
          const sysPs = gm.ParentMusicSystem?.PositionAndShape;
          if (sysPs) pillTop = Math.min(pillTop, sysPs.AbsolutePosition.y + (sysPs.BorderTop ?? -2.5));
        }
        if (x1 <= x0) return;

        const left = bx + x0 * U;
        const top = by + y0 * U;
        const width = Math.max(24, (x1 - x0) * U);
        const height = Math.max(36, (y1 - y0) * U);
        state.measureBoxes[mi] = { x: left, y: top, w: width, h: height };

        let highestInkY = Math.min(top, by + pillTop * U);
        for (const ib of svgInkBoxes) {
          if (ib.right < left - 4 || ib.left > left + width + 4) continue;
          if (ib.bottom >= top - 64 && ib.top <= top + 6 && ib.top >= top - 64) {
            highestInkY = Math.min(highestInkY, ib.top);
          }
        }

        const fm = flagByM.get(mi);
        const gate = state.saveGate?.getMeasureState(mi);
        const isResolved = fm?.flagged && gate && (gate.status === 'confirmed' || gate.status === 'fixed');
        const clsList = ['sf-m-wash'];
        if (fm?.flagged) {
          if (isResolved) clsList.push('resolved');
          else clsList.push(fm.level === 'high' ? 'high' : 'med');
        }
        if (state.playingMeasure === mi) clsList.push('sf-m-playing');

        if (clsList.length > 1) {
          html += `<div class="${clsList.join(' ')}" data-sf-m="${mi}" style="left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px"></div>`;
        }

        const selStaves = state.selectedStaves && state.selectedStaves.length
          ? state.selectedStaves
          : [{ partIndex: state.selectedPartIndex || 0, staff: state.selectedStaff || 1 }];
        const isActiveM = state.activeMeasure === mi;
        const isRangeM = state.copyRange && mi >= state.copyRange.start && mi <= state.copyRange.end;
        if (isActiveM || isRangeM) {
          for (const s of selStaves) {
            const sb = state.staffMeasureBoxes[`${s.partIndex}:${s.staff}:${mi}`]
              || state.partBoxes[`${s.partIndex}:${mi}`]
              || { x: left, y: top, w: width, h: height };
            const pCls = ['sf-m-wash'];
            if (isRangeM) pCls.push('sf-m-range');
            if (isActiveM) pCls.push('active');
            html += `<div class="${pCls.join(' ')}" style="left:${sb.x.toFixed(1)}px;top:${sb.y.toFixed(1)}px;width:${sb.w.toFixed(1)}px;height:${sb.h.toFixed(1)}px"></div>`;
          }
        }

        let badgeHtml = '';
        if (fm?.flagged) {
          const confPct = Math.round((fm.confidence ?? 0.5) * 100);
          const count = fm.findings?.length || 1;
          const bCls = isResolved ? 'resolved' : (fm.level === 'high' ? 'high' : 'med');
          const txt = isResolved ? '✓ Checked' : `⚑ ${count} (${confPct}%)`;
          badgeHtml = `<button type="button" class="sf-m-badge ${bCls}" data-sf-badge="${mi}" title="Inspect flagged measure ${mi + 1}">${txt}</button>`;
        }

        const isPlaying = state.playingMeasure === mi;
        const barTop = Math.max(4, highestInkY - 26);
        html += `<div class="sf-m-bar" style="left:${left.toFixed(1)}px;top:${barTop.toFixed(1)}px">
          <button type="button" class="sf-m-play ${isPlaying ? 'playing' : ''}" data-sf-play="${mi}" title="Play measure ${mi + 1}">${isPlaying ? '■' : '▶'} ${mi + 1}</button>
          ${badgeHtml}
        </div>`;
      });

      ov.innerHTML = html;
      ov.querySelectorAll('[data-sf-play]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mi = Number(btn.dataset.sfPlay);
          if ((state.model?.parts?.length || 1) > 1) {
            state.selectedParts = Array.from({ length: state.model.parts.length }, (_, i) => i);
          }
          playSingleMeasure(mi);
        });
      });
      ov.querySelectorAll('[data-sf-badge]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          focusMeasure(Number(btn.dataset.sfBadge));
        });
      });
    }

    function focusMeasure(mi, selectAllParts = false) {
      state.activeMeasure = mi;
      sfCtl.startAt = mi;
      if (selectAllParts && (state.model?.parts?.length || 1) > 1) {
        state.selectedParts = Array.from({ length: state.model.parts.length }, (_, i) => i);
      }
      if (state.saveGate) state.saveGate.visitMeasure(mi);
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      updateMeasureOverlays();

      const ov = host.querySelector('#sf-ov');
      const scrollEl = host.querySelector('#sf-score-scroll');
      const bar = ov?.querySelector(`[data-sf-play="${mi}"]`)?.closest('.sf-m-bar');
      if (bar && scrollEl) {
        const top = parseFloat(bar.style.top || '0');
        scrollEl.scrollTo({ top: Math.max(0, top - 64), behavior: 'smooth' });
      }
    }

    function stepAllFlags(dir) {
      const log = state.saveGate?.exportLog() || [];
      const list = log.map(x => x.measureIndex).sort((a, b) => a - b);
      if (!list.length) {
        showToast('No flagged measures in this score.');
        return;
      }
      let target;
      if (dir > 0) {
        const next = list.find(m => m > state.activeMeasure);
        target = next != null ? next : list[0];
      } else {
        const prev = [...list].reverse().find(m => m < state.activeMeasure);
        target = prev != null ? prev : list[list.length - 1];
      }
      focusMeasure(target);
    }

    function renderDrawer() {
      const drawer = host.querySelector('#sf-drawer');
      if (!drawer) return;
      drawer.hidden = !state.drawerOpen;
      if (!state.drawerOpen) return;

      const log = state.saveGate?.exportLog() || [];
      const flagByM = new Map((state.flagReport?.measures || []).map(m => [m.measureIndex, m]));
      const meterSuggs = typeof sfSuggestTimeSigChanges === 'function' ? sfSuggestTimeSigChanges(state.model) : [];
      const meterSuggByM = new Map(meterSuggs.map(s => [s.measureIndex, s]));
      const histStack = state.history?.stack || [];
      const histIdx = state.history?.index ?? 0;

      const flagsHtml = log.length
        ? log.map((entry) => {
            const mi = entry.measureIndex;
            const fm = flagByM.get(mi);
            const ms = meterSuggByM.get(mi);
            const findings = fm?.findings || entry.findings || [];
            const reason = findings.map(f => f.message || f.code).join(' · ') || 'Checked';
            const hints = [...new Set(findings.map(f => f.suggestion).filter(Boolean))];
            const stCls = entry.status === 'fixed' ? 'fixed' : entry.status === 'confirmed' ? 'confirmed' : 'pending';
            const stLbl = entry.status === 'fixed' ? 'Fixed ✓' : entry.status === 'confirmed' ? 'Confirmed ✓' : 'Needs check';
            const msLabel = ms ? (ms.label || `Set m. ${mi + 1} to ${ms.beats}/${ms.beatType}${ms.thisBarOnly ? ' (1 bar)' : ''}`) : '';
            return `<div class="sf-drawer-row ${mi === state.activeMeasure ? 'cur' : ''}" data-sf-dfm="${mi}">
              <span><b>m. ${mi + 1}</b> — ${hEsc(reason)}${hints.map(h => `<div class="sf-flag-hint">${hEsc(h)}</div>`).join('')}</span>
              <span class="sf-banner-acts">
                ${ms ? `<button type="button" class="sf-btn sf-btn-primary" data-sf-setmeter="${mi}" data-beats="${ms.beats}" data-btype="${ms.beatType}" data-baronly="${ms.thisBarOnly ? '1' : '0'}">${hEsc(msLabel)}</button>` : ''}
                <span class="sf-drawer-status ${stCls}">${stLbl}</span>
                ${entry.status === 'confirmed' ? `<button type="button" class="sf-btn" data-sf-recheck="${mi}">Re-check</button>` : ''}
              </span>
            </div>`;
          }).join('')
        : `<div class="sf-drawer-row"><span>No flagged measures in this score.</span></div>`;

      const fixesHtml = histStack.length > 1
        ? histStack.map((item, idx) => {
            if (idx === 0) return '';
            const cur = idx === histIdx;
            return `<div class="sf-drawer-row ${cur ? 'cur' : ''}" data-sf-hist="${idx}">
              <span>${hEsc(item.label || 'Edit')}</span>
              <span class="sf-drawer-status ${cur ? 'confirmed' : 'fixed'}">${cur ? 'Current' : idx < histIdx ? 'Applied' : 'Undone'}</span>
            </div>`;
          }).join('')
        : `<div class="sf-drawer-row"><span>No edits made yet in this session.</span></div>`;

      drawer.innerHTML = `
        <div class="sf-drawer-head">
          <div class="sf-seg">
            <button type="button" class="${state.drawerTab === 'flags' ? 'on' : ''}" data-sf-dtab="flags">Flags (${log.length})</button>
            <button type="button" class="${state.drawerTab === 'fixes' ? 'on' : ''}" data-sf-dtab="fixes">Fixes (${Math.max(0, histStack.length - 1)})</button>
          </div>
          <button type="button" class="sf-btn" id="sf-drawer-close">Close</button>
        </div>
        <div class="sf-drawer-list">
          ${state.drawerTab === 'flags' ? flagsHtml : fixesHtml}
        </div>
      `;

      drawer.querySelector('#sf-drawer-close').addEventListener('click', () => {
        state.drawerOpen = false;
        renderDrawer();
      });
      drawer.querySelectorAll('[data-sf-dtab]').forEach((b) => {
        b.addEventListener('click', () => { state.drawerTab = b.dataset.sfDtab; renderDrawer(); });
      });
      drawer.querySelectorAll('[data-sf-setmeter]').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          applyMeterChange(
            Number(b.dataset.sfSetmeter),
            Number(b.dataset.beats),
            Number(b.dataset.btype),
            b.dataset.baronly === '1'
          );
          renderDrawer();
        });
      });
      drawer.querySelectorAll('[data-sf-recheck]').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const mi = Number(b.dataset.sfRecheck);
          const gateEntry = state.saveGate?.states?.get(mi);
          if (gateEntry) { gateEntry.status = 'pending'; gateEntry.visited = false; }
          updateTopBarState();
          renderFlagStrip();
          updateMeasureOverlays();
          renderDrawer();
        });
      });
      drawer.querySelectorAll('[data-sf-dfm]').forEach((row) => {
        row.addEventListener('click', () => focusMeasure(Number(row.dataset.sfDfm)));
      });
      drawer.querySelectorAll('[data-sf-hist]').forEach((row) => {
        row.addEventListener('click', () => {
          const targetIdx = Number(row.dataset.sfHist);
          while ((state.history?.index ?? 0) > targetIdx && state.history?.canUndo()) doUndo();
          while ((state.history?.index ?? 0) < targetIdx && state.history?.canRedo()) doRedo();
          renderDrawer();
        });
      });
    }

    // ---------- Flag & History Drawer Helpers

    function scheduleSpokenClicks(playRet, sc, qFrom, qTo) {
      if (!playRet?.master || !sc?.spokenEvents?.length || typeof spTimeBetweenQ !== 'function') return;
      const ctx = playRet.master.context;
      if (!ctx) return;
      const inRange = sc.spokenEvents.filter(ev => ev.q >= qFrom - 1e-6 && ev.q < qTo - 1e-6);
      for (const ev of inRange) {
        const dt = spTimeBetweenQ(sc, qFrom, ev.q, 1);
        const t = playRet.when0 + dt;
        if (!isFinite(t) || t < ctx.currentTime - 0.05) continue;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1150, t);
        osc.frequency.exponentialRampToValueAtTime(520, t + 0.035);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        osc.connect(g).connect(playRet.master);
        osc.start(t);
        osc.stop(t + 0.055);
      }
    }

    // ---------- Continuous & measure-level piano playback (borrows web/score.js spPlay / spStop)
    async function toggleContinuousPlayback() {
      if (sfCtl.playing) {
        stopPlayback();
        return;
      }
      const sc = sfCtl.sc || state.playbackScore;
      if (!sc || (!sc.events?.length && !sc.spokenEvents?.length)) {
        showToast('No notes to play in this score.');
        return;
      }
      if (typeof spPianoReady !== 'function' || typeof spPlay !== 'function') {
        showToast('Piano playback is unavailable.');
        return;
      }
      try {
        await spPianoReady((sc.events || []).map(e => e.midi));
        if (state.destroyed) return;
        sfCtl.sc = state.playbackScore;
        sfCtl.startAt = Math.max(0, state.activeMeasure || 0);
        const ret = spPlay(sfCtl, { noCountIn: true, noMetro: true });
        const startM = sc.measures?.[sfCtl.startAt];
        scheduleSpokenClicks(ret, sc, startM ? startM.start : 0, sc.ptotal || sc.total || 0);
      } catch {
        stopPlayback();
      }
    }

    async function playSingleMeasure(mi) {
      if (sfCtl.playing && state.playingMeasure === mi) {
        stopPlayback();
        return;
      }
      stopPlayback();
      const sc = state.playbackScore;
      if (!sc) return;
      const m = sc.measures?.[mi];
      const evs = (sc.events || []).filter(e => e.m === mi);
      const spk = (sc.spokenEvents || []).filter(e => e.m === mi);
      if (!m || (!evs.length && !spk.length)) {
        showToast(`Measure ${mi + 1} has no notes to play.`);
        return;
      }
      if (typeof spPianoReady !== 'function' || typeof spPlay !== 'function') {
        showToast('Piano playback is unavailable.');
        return;
      }

      state.activeMeasure = mi;
      sfCtl.startAt = mi;
      state.playingMeasure = mi;
      try {
        await spPianoReady(evs.map(e => e.midi));
        if (state.destroyed) return;
        sfCtl.sc = state.playbackScore;
        const ret = spPlay(sfCtl, { range: { a: m.start, b: m.start + m.len, loop: false }, noCountIn: true, noMetro: true });
        scheduleSpokenClicks(ret, sc, m.start, m.start + m.len);
      } catch {
        stopPlayback();
      }
    }

    // ---------- Flag strip + Save Gate
    function renderFlagStrip() {
      const strip = host.querySelector('#sf-flag-strip');
      if (!strip || !state.flagReport) return;

      const unresolved = state.saveGate?.getUnresolvedMeasures() || [];
      const activeFlag = (state.flagReport.measures || []).find(m => m.measureIndex === state.activeMeasure && m.flagged);
      const gateState = state.saveGate?.getMeasureState(state.activeMeasure);

      if (activeFlag) {
        const isConfirmed = gateState && (gateState.status === 'confirmed' || gateState.status === 'fixed');
        const reasons = (activeFlag.findings || []).map(f => `<li>${hEsc(f.message || f.code)}</li>`).join('');
        const hasDurMismatch = (activeFlag.findings || []).some(f => f.code === 'duration_mismatch');
        const suggestions = (hasDurMismatch && typeof sfSuggestRhythmFixes === 'function')
          ? sfSuggestRhythmFixes(state.model, state.flagReport)
              .filter(s => s.measureIndex === state.activeMeasure)
              .slice(0, 2)
          : [];
        const fixBtns = suggestions.map((s, idx) =>
          `<button type="button" class="sf-btn" data-sf-autofix="${idx}" title="Apply 1-click rhythm fix (undoable with ⌘Z)">Auto-fix: ${hEsc(s.label)}</button>`
        ).join('');
        strip.className = 'sf-flag-strip';
        strip.innerHTML = `
          <div class="sf-flag-strip-reasons">
            <div class="sf-flag-strip-title">Measure ${state.activeMeasure + 1} — ${Math.round((activeFlag.confidence ?? 0.5) * 100)}% confidence</div>
            <ul class="sf-flag-strip-list">${reasons}</ul>
          </div>
          <div class="sf-banner-acts">
            ${fixBtns}
            <button type="button" class="sf-btn ${isConfirmed ? 'good' : 'primary'}" id="sf-confirm-measure">
              ${isConfirmed ? '✓ Confirmed' : 'Looks right (Confirm)'}
            </button>
          </div>`;
        strip.querySelectorAll('[data-sf-autofix]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const s = suggestions[Number(btn.dataset.sfAutofix)];
            if (!s || typeof sfApplyRhythmFix !== 'function') return;
            const working = sfCloneModel(state.model);
            const res = sfApplyRhythmFix(working, s);
            if (!res?.ok || !res?.changed) return;
            commitModelChange('Auto-fix rhythm', working, state.activeMeasure, res.entryId || state.selectedNoteId, false);
          });
        });
        strip.querySelector('#sf-confirm-measure').addEventListener('click', () => {
          if (!state.saveGate) return;
          state.saveGate.visitMeasure(state.activeMeasure);
          state.saveGate.confirmMeasure(state.activeMeasure);
          updateTopBarState();
          renderFlagStrip();
          updateMeasureOverlays();
        });
        return;
      }

      if (unresolved.length > 0) {
        strip.className = 'sf-flag-strip';
        strip.innerHTML = `
          <div class="sf-flag-strip-reasons">
            <div class="sf-flag-strip-title">${unresolved.length} flagged measure${unresolved.length === 1 ? '' : 's'} need review before saving</div>
            <div>Tap any highlighted measure or press <b>Next flagged →</b> to inspect and confirm it.</div>
          </div>`;
        return;
      }

      strip.className = 'sf-flag-strip clean';
      strip.innerHTML = `<div class="sf-flag-strip-reasons"><div class="sf-flag-strip-title">All measures checked — ready to save to your Library.</div></div>`;
    }

    function updateTopBarState() {
      const undoBtn = host.querySelector('#sf-undo');
      const redoBtn = host.querySelector('#sf-redo');
      const nextBtn = host.querySelector('#sf-next-flag');
      const saveBtn = host.querySelector('#sf-save-btn');
      if (undoBtn) undoBtn.disabled = !state.history?.canUndo();
      if (redoBtn) redoBtn.disabled = !state.history?.canRedo();

      const unresolved = state.saveGate?.getUnresolvedMeasures() || [];
      const totalFlags = state.saveGate?.exportLog()?.length || 0;
      const pillBtn = host.querySelector('#sf-flag-pill');
      if (pillBtn) {
        pillBtn.textContent = totalFlags
          ? (unresolved.length ? `${unresolved.length} left · ${totalFlags} total` : `${totalFlags} checked ✓`)
          : '0 flags';
      }
      if (nextBtn) {
        nextBtn.textContent = 'Next flag →';
        nextBtn.title = unresolved.length ? `Jump to next flagged measure (${unresolved.length} left)` : 'All flagged measures checked';
        nextBtn.className = unresolved.length ? 'sf-btn warn' : 'sf-btn good';
      }
      if (saveBtn) {
        const canSave = !!state.saveGate?.canSave() && !state.saving;
        saveBtn.disabled = !canSave;
        saveBtn.textContent = state.saving ? 'Saving…' : 'Save';
        saveBtn.title = unresolved.length
          ? `${unresolved.length} flagged measure(s) still need review before saving`
          : 'Save verified score to Library';
      }
      if (state.drawerOpen) renderDrawer();
    }

    function jumpToNextFlagged() {
      const unresolved = state.saveGate?.getUnresolvedMeasures() || [];
      const allFlagged = (state.flagReport?.measures || []).filter(m => m.flagged).map(m => m.measureIndex);
      const list = unresolved.length ? unresolved : allFlagged;
      if (!list.length) {
        showToast('No flagged measures remaining.');
        return;
      }
      const next = list.find(m => m > state.activeMeasure);
      const target = next != null ? next : list[0];
      focusMeasure(target);
    }

    // ---------- Selection, 1-click Eraser, & Direct Editing
    function clearSelection() {
      state.selectedNoteId = null;
      state.selectedDirId = null;
      state.selectedTieId = null;
      state.selectedHeaderText = null;
      state.selectedLyricNoteId = null;
      applySelectionHighlight();
      renderEditBar();
    }

    function updateCopyRange(partIndex, measureIndex, extendShift) {
      if (extendShift && state.copyRange && state.copyRange.partIndex === partIndex) {
        const a = state.copyRange.anchor;
        state.copyRange = {
          partIndex,
          anchor: a,
          start: Math.min(a, measureIndex),
          end: Math.max(a, measureIndex)
        };
      } else {
        state.copyRange = {
          partIndex,
          anchor: measureIndex,
          start: measureIndex,
          end: measureIndex
        };
      }
    }

    function applyStaffSelection(partIndex, staff, toggleCmd) {
      const n = state.model?.parts?.length || 1;
      const pi = Math.max(0, Math.min(n - 1, partIndex || 0));
      const ns = Math.max(1, state.model?.parts?.[pi]?.staves || 1);
      const st = Math.max(1, Math.min(ns, staff || 1));
      state.selectedPartIndex = pi;
      state.selectedStaff = st;
      if (toggleCmd) {
        const cur = new Map((state.selectedStaves || []).map(x => [`${x.partIndex}:${x.staff}`, x]));
        const k = `${pi}:${st}`;
        if (cur.has(k)) {
          if (cur.size > 1) cur.delete(k);
        } else {
          cur.set(k, { partIndex: pi, staff: st });
        }
        state.selectedStaves = [...cur.values()].sort((a, b) => a.partIndex - b.partIndex || a.staff - b.staff);
      } else {
        state.selectedStaves = [{ partIndex: pi, staff: st }];
      }
      state.selectedParts = [...new Set(state.selectedStaves.map(x => x.partIndex))].sort((a, b) => a - b);
    }

    function selectNote(noteId, shiftKey = false, cmdKey = false) {
      const found = sfFindEntry(state.model, noteId);
      if (!found) return;
      state.selectedNoteId = noteId;
      state.selectedDirId = null;
      state.selectedTieId = null;
      state.selectedHeaderText = null;
      state.selectedLyricNoteId = null;
      applyStaffSelection(found.partIndex, found.entry.staff || 1, cmdKey);
      state.activeMeasure = found.measureIndex;
      sfCtl.startAt = found.measureIndex;
      updateCopyRange(found.partIndex, found.measureIndex, shiftKey);
      if (state.saveGate) state.saveGate.visitMeasure(found.measureIndex);
      applySelectionHighlight();
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      updateMeasureOverlays();
    }

    function selectDirection(dirId, shiftKey = false, cmdKey = false) {
      const found = sfFindEntry(state.model, dirId);
      if (!found) return;
      state.selectedDirId = dirId;
      state.selectedNoteId = null;
      state.selectedTieId = null;
      state.selectedLyricNoteId = null;
      applyStaffSelection(found.partIndex, found.entry.staff || 1, cmdKey);
      state.activeMeasure = found.measureIndex;
      sfCtl.startAt = found.measureIndex;
      updateCopyRange(found.partIndex, found.measureIndex, shiftKey);
      if (state.saveGate) state.saveGate.visitMeasure(found.measureIndex);
      applySelectionHighlight();
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      updateMeasureOverlays();
    }

    function selectTie(tieNoteId, shiftKey = false, cmdKey = false) {
      const found = sfFindEntry(state.model, tieNoteId);
      if (!found) return;
      state.selectedTieId = tieNoteId;
      state.selectedNoteId = null;
      state.selectedDirId = null;
      state.selectedLyricNoteId = null;
      applyStaffSelection(found.partIndex, found.entry.staff || 1, cmdKey);
      state.activeMeasure = found.measureIndex;
      sfCtl.startAt = found.measureIndex;
      updateCopyRange(found.partIndex, found.measureIndex, shiftKey);
      if (state.saveGate) state.saveGate.visitMeasure(found.measureIndex);
      applySelectionHighlight();
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      updateMeasureOverlays();
    }

    function selectLyric(noteId, shiftKey = false, cmdKey = false) {
      const found = sfFindEntry(state.model, noteId);
      if (!found) return;
      state.selectedLyricNoteId = noteId;
      state.selectedNoteId = noteId;
      state.selectedDirId = null;
      state.selectedTieId = null;
      state.selectedHeaderText = null;
      state.selectedHeaderText = null;
      applyStaffSelection(found.partIndex, found.entry.staff || 1, cmdKey);
      state.activeMeasure = found.measureIndex;
      sfCtl.startAt = found.measureIndex;
      updateCopyRange(found.partIndex, found.measureIndex, shiftKey);
      if (state.saveGate) state.saveGate.visitMeasure(found.measureIndex);
      applySelectionHighlight();
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      updateMeasureOverlays();
    }

    function stepSelection(dir) {
      if (!state.model?.parts?.length) return;
      let targetId = null;
      if (state.selectedNoteId && typeof sfGetAdjacentEntryId === 'function') {
        targetId = sfGetAdjacentEntryId(state.model, state.selectedNoteId, dir);
      } else {
        const m = state.model.parts[state.selectedPartIndex]?.measures?.[state.activeMeasure];
        const first = m?.entries?.find(e => e.kind === 'note' || e.kind === 'rest');
        targetId = first?.id || null;
      }
      if (!targetId) return;
      selectNote(targetId);
      const scrollEl = host.querySelector('#sf-score-scroll');
      const box = state.measureBoxes[state.activeMeasure];
      if (scrollEl && box) {
        const vt = scrollEl.scrollTop;
        const vb = vt + scrollEl.clientHeight;
        if (box.y < vt + 30 || box.y + box.h > vb - 30) {
          scrollEl.scrollTo({ top: Math.max(0, box.y - 68), behavior: 'smooth' });
        }
      }
    }

    function selectHeaderText(text) {
      if (!text) return;
      state.selectedNoteId = null;
      state.selectedDirId = null;
      state.selectedTieId = null;
      state.selectedLyricNoteId = null;
      state.selectedHeaderText = text;
      applySelectionHighlight();
      renderEditBar();
    }

    function eraseHeaderText(text) {
      if (!text || typeof sfRemoveHeaderText !== 'function') return;
      const working = sfCloneModel(state.model);
      if (!sfRemoveHeaderText(working, text)) return;
      state.selectedHeaderText = null;
      commitModelChange('Remove header text', working, state.activeMeasure, undefined, false);
      showToast('Removed header text.');
    }

    function clearAllHeaderTexts() {
      if (typeof sfClearHeaderCredits !== 'function' || !state.model) return;
      const working = sfCloneModel(state.model);
      const count = sfClearHeaderCredits(working, { includeTitle: true });
      if (!count) return;
      state.selectedHeaderText = null;
      commitModelChange('Clear header', working, state.activeMeasure, undefined, false);
      showToast('Cleared header text.');
    }

    function handleScoreClick(e) {
      const cmdKey = !!(e.metaKey || e.ctrlKey);
      const hdrEl = e.target.closest('[data-sf-header]');
      if (hdrEl) {
        const hdrText = hdrEl.dataset.sfHeaderText || hdrEl.textContent?.trim() || '';
        if (state.eraserMode) {
          eraseHeaderText(hdrText);
        } else {
          closeInlineEditor();
          selectHeaderText(hdrText);
        }
        return;
      }

      if (state.eraserMode && typeof sfGetHeaderTexts === 'function') {
        const txtEl = e.target.closest('svg text, svg tspan');
        const osmdEl = host.querySelector('#sf-osmd');
        if (txtEl && osmdEl && !txtEl.closest('[data-sf-lyric], [data-sf-dir]')) {
          const rect = txtEl.getBoundingClientRect();
          const osmdRect = osmdEl.getBoundingClientRect();
          if (rect.top - osmdRect.top < 360) {
            const raw = (txtEl.closest('text')?.textContent || txtEl.textContent || '').replace(/\s+/g, ' ').trim();
            if (raw) {
              const hdrs = sfGetHeaderTexts(state.model);
              const match = hdrs.find(h => {
                const ht = (h.text || '').replace(/\s+/g, ' ').trim();
                return ht && (ht === raw || ht.includes(raw) || raw.includes(ht));
              });
              if (match) {
                eraseHeaderText(match.text);
                return;
              }
            }
          }
        }
      }
      const tieEl = e.target.closest('[data-sf-tie]');
      if (tieEl) {
        const tieId = tieEl.dataset.sfTie;
        if (state.eraserMode) {
          eraseTie(tieId);
        } else {
          closeInlineEditor();
          selectTie(tieId, e.shiftKey, cmdKey);
        }
        return;
      }

      const dirEl = e.target.closest('[data-sf-dir]');
      if (dirEl) {
        const dirId = dirEl.dataset.sfDir;
        if (state.eraserMode) {
          eraseDirection(dirId);
        } else {
          closeInlineEditor();
          selectDirection(dirId, e.shiftKey, cmdKey);
        }
        return;
      }

      const lyrEl = e.target.closest('[data-sf-lyric]');
      if (lyrEl) {
        const noteId = lyrEl.dataset.sfLyric;
        if (state.eraserMode) {
          eraseLyric(noteId);
        } else {
          closeInlineEditor();
          selectLyric(noteId, e.shiftKey, cmdKey);
        }
        return;
      }

      const hitId = hitTestNoteId(e);
      if (hitId) {
        if (state.eraserMode) {
          eraseEntryById(hitId, false);
        } else {
          closeInlineEditor();
          selectNote(hitId, e.shiftKey, cmdKey);
        }
        return;
      }

      const stage = host.querySelector('#sf-score-stage');
      if (stage && state.staffBoxes.length) {
        const sr = stage.getBoundingClientRect();
        const px = e.clientX - sr.left;
        const py = e.clientY - sr.top;
        let hitStaff = null;
        let bestD = 1e9;
        for (const sb of state.staffBoxes) {
          if (px < sb.x - 8 || px > sb.x + sb.w + 8) continue;
          const margin = 4 * sb.lineSpacingPx;
          if (py < sb.staffTopY - margin || py > sb.staffTopY + 4 * sb.lineSpacingPx + margin) continue;
          const d = Math.abs(py - (sb.staffTopY + 2 * sb.lineSpacingPx));
          if (d < bestD) { bestD = d; hitStaff = sb; }
        }
        if (hitStaff) {
          applyStaffSelection(hitStaff.partIndex, hitStaff.staff, cmdKey);
          state.activeMeasure = hitStaff.measureIndex;
          updateCopyRange(hitStaff.partIndex, hitStaff.measureIndex, e.shiftKey);
          closeInlineEditor();
          clearSelection();
          updateMeasureOverlays();
          return;
        }
      }

      closeInlineEditor();
      clearSelection();
    }

    function commitModelChange(label, working, measureIdx, nextSelectId, shouldPreview) {
      state.history.push(label, working);
      state.model = state.history.current();
      state.dirty = true;
      if (nextSelectId !== undefined) state.selectedNoteId = nextSelectId;
      if (state.selectedNoteId && !sfFindEntry(state.model, state.selectedNoteId)) state.selectedNoteId = null;
      if (state.selectedDirId && !sfFindEntry(state.model, state.selectedDirId)) state.selectedDirId = null;

      analyzeAndSyncGate(measureIdx);
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      renderOsmdScore(true, measureIdx);

      if (shouldPreview && state.selectedNoteId) {
        const updated = sfFindEntry(state.model, state.selectedNoteId);
        if (updated && !updated.entry.isRest && updated.entry.soundingMidi) {
          previewMidiNote(updated.entry.soundingMidi);
        }
      }
    }

    function eraseTie(tieNoteId) {
      const found = sfFindEntry(state.model, tieNoteId);
      if (!found || typeof sfRemoveTie !== 'function') return;
      const working = sfCloneModel(state.model);
      const res = sfRemoveTie(working, tieNoteId);
      if (!res?.ok || !res?.changed) return;
      state.selectedTieId = null;
      commitModelChange('Remove tie', working, found.measureIndex, res.entry?.id || tieNoteId, false);
    }

    function eraseDirection(dirId) {
      const found = sfFindEntry(state.model, dirId);
      if (!found) return;
      const working = sfCloneModel(state.model);
      const res = typeof sfEditDirectionText === 'function'
        ? sfEditDirectionText(working, dirId, '')
        : { ok: false, changed: false };
      if (!res.ok || !res.changed) return;
      state.selectedDirId = null;
      commitModelChange('Erase text', working, found.measureIndex, undefined, false);
    }

    function eraseLyric(noteId) {
      const found = sfFindEntry(state.model, noteId);
      if (!found) return;
      const working = sfCloneModel(state.model);
      const res = typeof sfSetNoteLyric === 'function'
        ? sfSetNoteLyric(working, noteId, '')
        : { ok: false, changed: false };
      if (!res.ok || !res.changed) return;
      commitModelChange('Erase lyric', working, found.measureIndex, noteId, false);
    }

    function eraseEntryById(entryId, hard) {
      const found = sfFindEntry(state.model, entryId);
      if (!found) return;
      const working = sfCloneModel(state.model);
      const res = typeof sfRemoveEntry === 'function'
        ? sfRemoveEntry(working, entryId, { hard: !!hard })
        : sfDeleteOrMakeRest(working, entryId, hard ? 'delete' : 'rest');
      if (!res.ok || !res.changed) return;
      const nextId = sfFindEntry(working, entryId) ? entryId : null;
      commitModelChange('Remove item', working, found.measureIndex, nextId, false);
    }

    function doCopyMeasures(mode) {
      if (!state.model || typeof sfCopyMeasures !== 'function') return;
      const cr = state.copyRange || {
        partIndex: state.selectedPartIndex || 0,
        start: state.activeMeasure || 0,
        end: state.activeMeasure || 0
      };
      const selStaves = state.selectedStaves && state.selectedStaves.length
        ? state.selectedStaves
        : [{ partIndex: cr.partIndex, staff: state.selectedStaff || 1 }];
      const primary = selStaves[0];
      const partObj = state.model.parts?.[primary.partIndex];
      const isGrand = (partObj?.staves || 1) > 1;
      const samePartStaves = selStaves.filter(s => s.partIndex === primary.partIndex);
      const copyStaff = (isGrand && samePartStaves.length === 1 && selStaves.length === 1) ? primary.staff : null;

      const clip = sfCopyMeasures(state.model, primary.partIndex, cr.start, cr.end, mode === 'rhythm' ? 'rhythm' : 'all', copyStaff);
      if (!clip) {
        showToast('Select a measure to copy.');
        return;
      }
      state.clipboard = clip;
      renderEditBar();
      const rangeStr = cr.end > cr.start ? `m. ${cr.start + 1}–${cr.end + 1}` : `m. ${cr.start + 1}`;
      const partName = partObj?.name || `Part ${primary.partIndex + 1}`;
      const staffNote = clip.staff ? ` (${clip.staffLabel || 'Staff ' + clip.staff})` : '';
      showToast(`Copied ${mode === 'rhythm' ? 'rhythm' : 'all'} from ${rangeStr} (${partName}${staffNote})`);
    }

    function doPasteMeasures() {
      if (!state.model || !state.clipboard || typeof sfPasteMeasures !== 'function') return;
      const selStaves = state.selectedStaves && state.selectedStaves.length
        ? state.selectedStaves
        : [{ partIndex: state.selectedPartIndex || 0, staff: state.selectedStaff || 1 }];
      const primary = selStaves[0];
      const partIdx = primary.partIndex;
      const targetPart = state.model.parts?.[partIdx];
      const singleStaffSelected = selStaves.length === 1;
      const targetStaff = (targetPart && (targetPart.staves || 1) > 1 && singleStaffSelected) ? primary.staff : null;
      const measureIdx = state.activeMeasure || 0;
      const working = sfCloneModel(state.model);
      const res = sfPasteMeasures(working, state.clipboard, partIdx, measureIdx, targetStaff);
      if (!res || !res.ok || !res.changed) {
        showToast('Nothing to paste here.');
        return;
      }
      state.selectedDirId = null;
      commitModelChange(
        state.clipboard.mode === 'rhythm' ? 'Paste rhythm' : 'Paste measures',
        working,
        measureIdx,
        res.firstEntryId || null,
        false
      );
    }

    function applyToolbarEdit(act, val) {
      if (!state.model) return;

      if (act === 'copy-all') { doCopyMeasures('all'); return; }
      if (act === 'copy-rhythm') { doCopyMeasures('rhythm'); return; }
      if (act === 'paste') { doPasteMeasures(); return; }

      if (act === 'clear-bar') {
        if (typeof sfClearPartMeasure !== 'function') return;
        const working = sfCloneModel(state.model);
        const targets = state.selectedStaves && state.selectedStaves.length
          ? state.selectedStaves
          : [{ partIndex: state.selectedPartIndex || 0, staff: state.selectedStaff || 1 }];
        let anyChanged = false;
        let firstEntryId = null;
        for (const s of targets) {
          const isGrand = (working.parts?.[s.partIndex]?.staves || 1) > 1;
          const res = sfClearPartMeasure(working, s.partIndex, state.activeMeasure || 0, isGrand ? s.staff : null);
          if (res.ok && res.changed) {
            anyChanged = true;
            if (!firstEntryId && res.entry?.id) firstEntryId = res.entry.id;
          }
        }
        if (!anyChanged) return;
        state.selectedDirId = null;
        commitModelChange(
          targets.length > 1 ? `Clear ${targets.length} staves` : 'Clear measure',
          working,
          state.activeMeasure || 0,
          firstEntryId,
          false
        );
        return;
      }

      if (act === 'lyric') {
        if (state.selectedNoteId) openInlineLyricEditor(state.selectedNoteId);
        return;
      }

      if (act === 'text') {
        openInlineTextEditor(state.selectedDirId || null);
        return;
      }

      if (act === 'clear-header') {
        clearAllHeaderTexts();
        return;
      }

      if (act === 'del') {
        if (state.selectedHeaderText) {
          eraseHeaderText(state.selectedHeaderText);
        } else if (state.selectedTieId) {
          eraseTie(state.selectedTieId);
        } else if (state.selectedLyricNoteId) {
          eraseLyric(state.selectedLyricNoteId);
          state.selectedLyricNoteId = null;
        } else if (state.selectedDirId) {
          eraseDirection(state.selectedDirId);
        } else if (state.selectedNoteId) {
          eraseEntryById(state.selectedNoteId, val === 'hard');
        }
        return;
      }

      if (!state.selectedNoteId) return;
      const found = sfFindEntry(state.model, state.selectedNoteId);
      if (!found) return;

      const working = sfCloneModel(state.model);
      const targetId = state.selectedNoteId;
      const measureIdx = found.measureIndex;
      let res = { ok: false, changed: false };
      let label = 'Edit';
      let nextSelectId = targetId;
      let shouldPreview = false;

      if (act === 'toggle-rest') {
        if (found.entry.isRest) {
          res = typeof sfRestToNote === 'function' ? sfRestToNote(working, targetId) : { ok: false, changed: false };
          label = 'Rest to note';
          shouldPreview = true;
        } else {
          res = sfDeleteOrMakeRest(working, targetId, 'rest');
          label = 'Make rest';
        }
      } else if (act === 'spoken') {
        if (typeof sfToggleSpoken !== 'function') return;
        res = sfToggleSpoken(working, targetId);
        label = 'Toggle spoken';
      } else if (act === 'stack' || act === 'stack-letter') {
        if (typeof sfStackChordNote !== 'function') return;
        res = sfStackChordNote(working, targetId, act === 'stack-letter' ? { letter: val } : undefined);
        label = 'Stack chord note';
        if (res.entry?.id) nextSelectId = res.entry.id;
        shouldPreview = true;
      } else if (act === 'ins-note' || act === 'ins-rest') {
        if (typeof sfInsertAfter !== 'function') return;
        res = sfInsertAfter(working, targetId, act === 'ins-rest' ? 'rest' : 'note');
        label = act === 'ins-rest' ? 'Insert rest' : 'Insert note';
        if (res.entry?.id) nextSelectId = res.entry.id;
        shouldPreview = act === 'ins-note';
      } else if (act === 'step') {
        res = sfEditPitchDiatonic(working, targetId, Number(val));
        label = 'Change pitch step';
        shouldPreview = true;
      } else if (act === 'semi') {
        res = sfEditPitchSemitone(working, targetId, Number(val));
        label = 'Change pitch semitone';
        shouldPreview = true;
      } else if (act === 'oct') {
        if (typeof sfEditPitchOctave !== 'function') return;
        res = sfEditPitchOctave(working, targetId, Number(val));
        label = 'Change octave';
        shouldPreview = true;
      } else if (act === 'letter') {
        if (typeof sfSetPitchLetter !== 'function') return;
        res = sfSetPitchLetter(working, targetId, val);
        label = 'Set pitch letter';
        shouldPreview = true;
      } else if (act === 'acc') {
        res = sfToggleAccidental(working, targetId, val);
        label = 'Change accidental';
        shouldPreview = true;
      } else if (act === 'respell') {
        if (typeof sfRespellEnharmonic !== 'function') return;
        res = sfRespellEnharmonic(working, targetId);
        label = 'Respell enharmonic';
        shouldPreview = true;
      } else if (act === 'dur') {
        const curDots = found.entry.dots > 0;
        res = sfEditDuration(working, targetId, val, curDots);
        label = 'Change duration';
      } else if (act === 'dot') {
        res = sfToggleDot(working, targetId);
        label = 'Toggle dot';
      } else if (act === 'tie') {
        res = typeof sfToggleTie === 'function' ? sfToggleTie(working, targetId) : { ok: false, changed: false };
        label = 'Toggle tie';
      }

      if (!res.ok || !res.changed) return;
      commitModelChange(label, working, measureIdx, nextSelectId, shouldPreview);
    }

    // ---------- Inline Lyric & Direction Text Editor
    function openInlineLyricEditor(noteId) {
      const found = sfFindEntry(state.model, noteId);
      if (!found || found.entry.isRest) return;
      state.inlineEditor = {
        kind: 'lyric',
        targetId: noteId,
        measureIndex: found.measureIndex,
        partIndex: found.partIndex
      };
      renderInlinePill(typeof sfGetNoteLyric === 'function' ? sfGetNoteLyric(found.entry, 1) : '', 'Type lyric…');
    }

    function openInlineTextEditor(dirId) {
      const found = dirId ? sfFindEntry(state.model, dirId) : null;
      const initial = found && typeof sfGetDirectionText === 'function' ? sfGetDirectionText(found.entry) : '';
      state.inlineEditor = {
        kind: 'dir',
        targetId: dirId || null,
        measureIndex: found ? found.measureIndex : (state.activeMeasure || 0),
        partIndex: found ? found.partIndex : (state.selectedPartIndex || 0)
      };
      renderInlinePill(initial, 'e.g. mf, rit., dolce…');
    }

    function renderInlinePill(initialValue, placeholder) {
      const pill = host.querySelector('#sf-inline-pill');
      if (!pill || !state.inlineEditor) return;
      pill.hidden = false;
      pill.innerHTML = `
        <input type="text" id="sf-inline-in" value="${hEsc(initialValue)}" placeholder="${hEsc(placeholder)}" autocomplete="off" spellcheck="false">
        <button type="button" class="primary" id="sf-inline-ok">OK</button>
        <button type="button" id="sf-inline-cancel">✕</button>
      `;
      positionInlinePill();

      const input = pill.querySelector('#sf-inline-in');
      const commitAndAdvance = (advanceDir) => {
        const val = input.value;
        const ed = state.inlineEditor;
        if (!ed) return;
        if (ed.kind === 'lyric' && typeof sfSetNoteLyric === 'function') {
          const working = sfCloneModel(state.model);
          const cleanVal = advanceDir && val.endsWith(' ') ? val.trimEnd() : val;
          sfSetNoteLyric(working, ed.targetId, cleanVal, { verse: 1 });
          if (advanceDir && typeof sfGetAdjacentEntryId === 'function') {
            let nextId = sfGetAdjacentEntryId(working, ed.targetId, advanceDir);
            while (nextId) {
              const nf = sfFindEntry(working, nextId);
              if (nf && !nf.entry.isRest) break;
              nextId = sfGetAdjacentEntryId(working, nextId, advanceDir);
            }
            if (nextId) {
              const nf = sfFindEntry(working, nextId);
              state.inlineEditor = {
                kind: 'lyric',
                targetId: nextId,
                measureIndex: nf.measureIndex,
                partIndex: nf.partIndex
              };
              commitModelChange('Edit lyric', working, ed.measureIndex, nextId, false);
              setTimeout(() => {
                if (state.inlineEditor?.kind === 'lyric') {
                  const curF = sfFindEntry(state.model, nextId);
                  renderInlinePill(curF && typeof sfGetNoteLyric === 'function' ? sfGetNoteLyric(curF.entry, 1) : '', 'Type lyric…');
                }
              }, 20);
              return;
            }
          }
          closeInlineEditor();
          commitModelChange('Edit lyric', working, ed.measureIndex, ed.targetId, false);
        } else if (ed.kind === 'dir') {
          const working = sfCloneModel(state.model);
          let res;
          if (ed.targetId && typeof sfEditDirectionText === 'function') {
            res = sfEditDirectionText(working, ed.targetId, val);
          } else if (val.trim() && typeof sfAddDirectionText === 'function') {
            const noteF = state.selectedNoteId ? sfFindEntry(working, state.selectedNoteId) : null;
            res = sfAddDirectionText(working, ed.partIndex, ed.measureIndex, val, {
              onsetQ: noteF?.entry?.onsetQ ?? 0,
              staff: noteF?.entry?.staff ?? 1,
              placement: 'above'
            });
          } else {
            closeInlineEditor();
            return;
          }
          closeInlineEditor();
          if (res?.ok && res?.changed) {
            state.selectedDirId = res.entry?.id || null;
            commitModelChange('Edit text', working, ed.measureIndex, undefined, false);
          }
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commitAndAdvance(0);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeInlineEditor();
        } else if (state.inlineEditor?.kind === 'lyric' && (e.key === ' ' || e.key === '-')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === '-') input.value = input.value.replace(/-*$/, '') + '-';
          commitAndAdvance(e.shiftKey ? -1 : 1);
        }
      });
      pill.querySelector('#sf-inline-ok').addEventListener('click', () => commitAndAdvance(0));
      pill.querySelector('#sf-inline-cancel').addEventListener('click', closeInlineEditor);

      setTimeout(() => {
        input.focus();
        input.select();
      }, 10);
    }

    function positionInlinePill() {
      const pill = host.querySelector('#sf-inline-pill');
      const stage = host.querySelector('#sf-score-stage');
      if (!pill || !stage || !state.inlineEditor) return;

      const sr = stage.getBoundingClientRect();
      let left = 24;
      let top = 40;

      if (state.inlineEditor.kind === 'lyric' && state.inlineEditor.targetId) {
        const el = host.querySelector(`#sf-osmd [data-sf-note="${CSS.escape(state.inlineEditor.targetId)}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          left = r.left - sr.left - 12;
          top = r.bottom - sr.top + 8;
        }
      } else {
        const dirEl = state.inlineEditor.targetId
          ? host.querySelector(`#sf-osmd [data-sf-dir="${CSS.escape(state.inlineEditor.targetId)}"]`)
          : null;
        if (dirEl) {
          const r = dirEl.getBoundingClientRect();
          left = r.left - sr.left;
          top = Math.max(4, r.top - sr.top - 38);
        } else {
          const box = state.measureBoxes[state.inlineEditor.measureIndex];
          if (box) {
            left = box.x + 8;
            top = Math.max(4, box.y - 34);
          }
        }
      }

      left = Math.max(8, Math.min(stage.clientWidth - 230, left));
      pill.style.left = `${Math.round(left)}px`;
      pill.style.top = `${Math.round(top)}px`;
    }

    function closeInlineEditor() {
      state.inlineEditor = null;
      const pill = host.querySelector('#sf-inline-pill');
      if (pill) pill.hidden = true;
    }

    function doUndo() {
      if (!state.history?.canUndo()) return;
      closeInlineEditor();
      state.selectedTieId = null;
      state.model = state.history.undo();
      state.dirty = true;
      if (state.selectedNoteId && !sfFindEntry(state.model, state.selectedNoteId)) state.selectedNoteId = null;
      if (state.selectedDirId && !sfFindEntry(state.model, state.selectedDirId)) state.selectedDirId = null;
      analyzeAndSyncGate(undefined);
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      renderOsmdScore(true, state.activeMeasure);
    }

    function doRedo() {
      if (!state.history?.canRedo()) return;
      closeInlineEditor();
      state.selectedTieId = null;
      state.model = state.history.redo();
      state.dirty = true;
      if (state.selectedNoteId && !sfFindEntry(state.model, state.selectedNoteId)) state.selectedNoteId = null;
      if (state.selectedDirId && !sfFindEntry(state.model, state.selectedDirId)) state.selectedDirId = null;
      analyzeAndSyncGate(undefined);
      updateTopBarState();
      renderEditBar();
      renderFlagStrip();
      renderOsmdScore(true, state.activeMeasure);
    }

    // ---------- Verified Save to Library
    async function handleSaveToLibrary() {
      if (!state.saveGate?.canSave()) {
        showToast('Please check and confirm every flagged measure before saving.');
        jumpToNextFlagged();
        return false;
      }
      if (client && client.isMemberSignInRequired(state.health) && !client.getMemberAuth().token) {
        showToast('Please sign in as a teacher or student to save verified scores.');
        if (typeof window.HWSYNC?.openSignIn === 'function') window.HWSYNC.openSignIn();
        return false;
      }
      if (typeof storeFile !== 'function') {
        showToast('Library storage is unavailable.');
        return false;
      }

      state.saving = true;
      updateTopBarState();

      try {
        const cleanTitle = slugFileName(state.title || state.model.workTitle);
        state.model.workTitle = cleanTitle;
        const correctedXml = sfExportMusicXml(state.model);
        const mxlBytes = sfExportMxl(state.model);
        const flaggedLog = state.saveGate.exportLog();
        const confirmedAt = new Date().toISOString();

        if (state.jobId && client) {
          const confirmRes = await client.confirmJob(state.jobId, {
            correctedXml,
            correctedMxlBase64: client.uint8ToBase64(mxlBytes),
            title: cleanTitle,
            instrument: state.instrument,
            flaggedLog,
            confirmedAt
          });
          if (!confirmRes.ok && !confirmRes.unreachable) {
            if (confirmRes.status === 401) {
              showToast('Sign in required to confirm and save this scan.');
              state.saving = false;
              updateTopBarState();
              return false;
            }
            if (confirmRes.errorCode === 'UNRESOLVED_FLAGS') {
              showToast('Some flagged measures still need confirmation.');
              state.saving = false;
              updateTopBarState();
              return false;
            }
          }
        }

        const fileName = `${cleanTitle}.mxl`;
        const fileObj = new File([mxlBytes], fileName, { type: 'application/vnd.recordare.musicxml' });
        const fileId = await storeFile(fileObj);
        if (typeof S !== 'undefined' && S.files && S.files[fileId]) {
          S.files[fileId].scanVerified = true;
          S.files[fileId].scanInstrument = state.instrument;
          S.files[fileId].scanConfirmedAt = confirmedAt;
          if (typeof save === 'function') save();
        }

        if (state.uploadHash && client) {
          client.setLocalCache(state.uploadHash, {
            title: cleanTitle,
            instrument: state.instrument,
            musicxml: correctedXml,
            confirmedAt
          });
        }

        if (typeof SP_XML !== 'undefined' && SP_XML && winState.sourceFileId) {
          delete SP_XML[winState.sourceFileId];
        }
        state.savedFileId = fileId;
        state.savedName = fileName;
        state.dirty = false;
        const banner = host.querySelector('#sf-saved-banner');
        const msg = host.querySelector('#sf-saved-msg');
        if (msg) msg.textContent = `Saved verified "${fileName}" to your Library.`;
        if (banner) banner.hidden = false;
        showToast(`Saved "${fileName}" to your Library.`);
        onChange();
        return true;
      } catch (err) {
        showToast(err?.message || 'Could not save score to Library.');
        return false;
      } finally {
        state.saving = false;
        updateTopBarState();
      }
    }

    async function restoreFromJobId(jobId) {
      if (!client || !jobId) { renderUpload(); return; }
      state.screen = 'scanning';
      state.jobId = jobId;
      state.scanStage = 'Restoring scan…';
      state.scanDetail = 'Loading your previous scan…';
      state.scanProgress = 25;
      renderScanning();

      const job = await client.getJob(jobId);
      if (state.destroyed) return;
      if (!job.ok) {
        state.jobId = '';
        winState.jobId = null;
        if (typeof onChange === 'function') onChange();
        state.screen = 'upload';
        renderUpload();
        return;
      }

      if (job.title && !state.title) state.title = job.title;
      if (job.instrument && state.instrument === 'auto') state.instrument = job.instrument;
      if (job.uploadHash) state.uploadHash = job.uploadHash;

      if (job.status === 'queued' || job.status === 'processing') {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        state.pollAbort = ctrl;
        const startAt = Date.now();
        const done = await client.pollJob(jobId, {
          signal: ctrl?.signal,
          onProgress: (j, elapsed) => {
            const rawP = Number(j.progress);
            const pct = Number.isFinite(rawP)
              ? (rawP > 0 && rawP <= 1 ? Math.round(rawP * 100) : Math.round(rawP))
              : 35;
            state.scanStage = friendlyStage(j.stage, j.status);
            state.scanDetail = j.stageDetail || state.scanStage;
            state.scanProgress = Math.max(5, Math.min(98, pct));
            state.scanElapsedMs = elapsed || (Date.now() - startAt);
            if (j.currentPage != null) state.scanCurrentPage = Number(j.currentPage);
            if (j.totalPages != null) state.scanTotalPages = Number(j.totalPages);
            if (!state.destroyed && state.screen === 'scanning') updateScanningDOM();
          }
        });
        state.pollAbort = null;
        if (state.destroyed) return;
        if (!done.ok || done.status === 'failed') {
          winState.jobId = null;
          if (typeof onChange === 'function') onChange();
          showErrorScreen('Could not read sheet music from this scan', done.error || 'Please try again.');
          return;
        }
        return finishRestoredJob(done);
      }

      if (job.status === 'failed') {
        winState.jobId = null;
        if (typeof onChange === 'function') onChange();
        state.screen = 'upload';
        renderUpload();
        return;
      }

      await finishRestoredJob(job);
    }

    async function finishRestoredJob(job) {
      const xml = job.correctedMusicxml || job.rawMusicxml;
      if (!xml) {
        winState.jobId = null;
        if (typeof onChange === 'function') onChange();
        state.screen = 'upload';
        renderUpload();
        return;
      }
      if (job.mimeType === 'application/pdf' && window.pdfjsLib && client) {
        state.fileKind = 'pdf';
        try {
          if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
          }
          const resp = await fetch(client.originalUrl(job.jobId));
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            state.pdfDoc = await window.pdfjsLib.getDocument({ data: ab }).promise;
            state.pdfPage = 1;
            state.pdfTotalPages = state.pdfDoc.numPages || 1;
          }
        } catch { state.pdfDoc = null; }
      } else {
        state.fileKind = 'image';
      }
      try {
        const model = sfParseMusicXml(xml);
        const effectiveMode = job?.scanMode || state.scanMode || 'full';
        if (typeof sfFilterScoreByMode === 'function' && effectiveMode !== 'full') {
          sfFilterScoreByMode(model, effectiveMode);
        }
        const warnParts = [];
        if (job.warning) warnParts.push(job.warning);
        else if (Array.isArray(job.skippedPages) && job.skippedPages.length) warnParts.push(`Skipped unreadable page(s): ${job.skippedPages.join(', ')}`);
        const cueWarn = formatSpokenCuesWarning(job.detectedSpokenCues);
        if (cueWarn) warnParts.push(cueWarn);
        enterReview(model, '', warnParts.join(' '), job.pdfTextMeta, { alternateRuns: job.alternateRuns });
        pollAlternateRunsInBackground(job);
      } catch {
        winState.jobId = null;
        if (typeof onChange === 'function') onChange();
        state.screen = 'upload';
        renderUpload();
      }
    }

    async function loadFromLibraryFileId(fileId) {
      try {
        const fMeta = typeof S !== 'undefined' && S.files?.[fileId];
        if (!fMeta) { renderUpload(); return; }
        let input;
        if (typeof spGetXml === 'function') {
          input = await spGetXml({ fileId, name: fMeta.name }, () => {});
        } else if (typeof fileDirectURL === 'function') {
          const url = fileDirectURL(fileId);
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Could not load score file');
          const ab = await resp.arrayBuffer();
          const head = new Uint8Array(ab, 0, 2);
          input = (head[0] === 0x50 && head[1] === 0x4b) ? new Uint8Array(ab) : new TextDecoder().decode(ab);
        }
        const model = await sfParseScoreInput(input);
        if (!state.title) state.title = model.workTitle || (fMeta.name || 'Score').replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '');
        enterReview(model, '', '', null, { clean: true });
      } catch (err) {
        showErrorScreen('Could not open score from Library', err?.message || 'Unable to parse this score.');
      }
    }

    function requestClose(onProceedClose) {
      if (typeof onProceedClose !== 'function') return;
      if (!state.dirty || state.screen !== 'review' || !state.model) {
        onProceedClose();
        return;
      }
      const rootEl = host.querySelector('.sf-root') || host;
      const existing = rootEl.querySelector('.sf-close-modal');
      if (existing) existing.remove();

      const canSave = !!state.saveGate?.canSave();
      const remaining = state.saveGate?.remainingCount?.() || 0;
      const title = state.title || state.model.workTitle || 'this score';
      const msgText = canSave
        ? `You have unsaved changes to "${title}". Save to your Library before closing?`
        : `You have unsaved changes to "${title}" (${remaining} flagged measure${remaining === 1 ? '' : 's'} still need a quick check before saving).`;

      const modal = document.createElement('div');
      modal.className = 'sf-close-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'sf-close-title');
      modal.innerHTML = `<div class="sf-close-card">
        <h3 id="sf-close-title">Save before closing?</h3>
        <p class="sf-close-msg">${hEsc(msgText)}</p>
        <div class="sf-close-actions">
          ${canSave
            ? '<button type="button" class="sf-btn sf-btn-primary" data-sf-close="save">Save &amp; close</button>'
            : '<button type="button" class="sf-btn sf-btn-primary" data-sf-close="review">Review flags</button>'}
          <button type="button" class="sf-btn sf-btn-danger" data-sf-close="discard">Close without saving</button>
          <button type="button" class="sf-btn" data-sf-close="cancel">Cancel</button>
        </div>
      </div>`;

      const dismiss = () => {
        document.removeEventListener('keydown', onKey, true);
        if (modal.parentNode) modal.remove();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        }
      };
      document.addEventListener('keydown', onKey, true);

      modal.addEventListener('click', async (e) => {
        if (e.target === modal) { dismiss(); return; }
        const btn = e.target.closest('[data-sf-close]');
        if (!btn) return;
        const act = btn.dataset.sfClose;
        if (act === 'cancel') {
          dismiss();
        } else if (act === 'discard') {
          dismiss();
          onProceedClose();
        } else if (act === 'review') {
          dismiss();
          jumpToNextFlagged();
        } else if (act === 'save') {
          modal.querySelectorAll('button').forEach(b => { b.disabled = true; });
          const ok = await handleSaveToLibrary();
          dismiss();
          if (ok) onProceedClose();
        }
      });

      rootEl.appendChild(modal);
      const primaryBtn = modal.querySelector('[data-sf-close="save"], [data-sf-close="review"]');
      if (primaryBtn) primaryBtn.focus();
    }

    host.__sfRequestClose = requestClose;

    if (winState.sourceFileId && typeof S !== 'undefined' && S.files?.[winState.sourceFileId]) {
      loadFromLibraryFileId(winState.sourceFileId);
    } else if (winState.jobId && client) {
      restoreFromJobId(winState.jobId);
    } else {
      renderUpload();
    }
    refreshHealth();
  }

  if (typeof window !== 'undefined') window.mountScanFix = mountScanFix;
  else if (typeof globalThis !== 'undefined') globalThis.mountScanFix = mountScanFix;
  if (typeof mountSightHosts === 'function') mountSightHosts();
})();
