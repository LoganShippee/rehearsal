'use strict';
/* Rehearsal score practice: open a MusicXML (.mxl / .musicxml) or MuseScore (.mscz / .mscx) file,
   see the real notation (OpenSheetMusicDisplay, bundled), and practise with a piano playback:
   loop a range of measures, pick which parts play (with volume), tempo slider, count-in, metronome,
   starting pitches and a gradual speed-up on each repeat. MuseScore files are converted once with the
   MuseScore installed on this Mac. */

const SP_SCRIPTS = {};
function spLoadScript(src) {
  return (SP_SCRIPTS[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  }));
}
const spIsScoreName = n => /\.(mxl|musicxml|xml|mscz|mscx)$/i.test(n || '');

// ---------- reading the file
function spUnzip(buf) {
  const dv = new DataView(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nl)); p += 46 + nl + el + cl;
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    out[name] = { method, data: new Uint8Array(buf, lho + 30 + lnl + lel, csize) };
  }
  return out;
}
async function spInflate(e) {
  if (e.method === 0) return e.data;
  const s = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function spMxlToXml(buf) {
  const z = spUnzip(buf), dec = async n => new TextDecoder().decode(await spInflate(z[n]));
  let root = null;
  if (z['META-INF/container.xml']) {
    const c = new DOMParser().parseFromString(await dec('META-INF/container.xml'), 'application/xml');
    root = c.querySelector('rootfile')?.getAttribute('full-path');
  }
  root ||= Object.keys(z).find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith('META-INF'));
  if (!root || !z[root]) throw new Error('no music found in this .mxl file');
  return dec(root);
}
// Returns MusicXML text for a stored file; MuseScore files are converted once and the result is kept.
// every score file kept in Rehearsal (converted copies of MuseScore files are hidden)
function spLibrary() {
  const all = Object.entries(S.files || {}).filter(([, f]) => spIsScoreName(f.name) && !f.derived && !f.hiddenScore);
  const base = n => n.replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '').trim().toLowerCase();
  const ms = new Set(all.filter(([, f]) => /\.(mscz|mscx)$/i.test(f.name)).map(([, f]) => base(f.name)));
  return all.filter(([, f]) => !(/\.(musicxml|xml)$/i.test(f.name) && ms.has(base(f.name))))
    .map(([id, f]) => ({ id, name: f.name.replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '').trim(), added: f.added || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const SP_XML = {};             // parsed files kept in memory, so switching back is instant
async function spGetXml(st, status) {
  if (SP_XML[st.fileId]) return SP_XML[st.fileId];
  const xml = await spGetXml0(st, status); SP_XML[st.fileId] = xml; return xml;
}
async function spGetXml0(st, status) {
  const tryId = async id => {
    const url = fileDirectURL(id); if (!url) return null;
    const r = await fetch(url); if (!r.ok) return null; return r.arrayBuffer();
  };
  if (st.xmlId && S.files[st.xmlId]) { const b = await tryId(st.xmlId); if (b) return new TextDecoder().decode(b); }
  const name = (S.files[st.fileId]?.name || st.name || '').toLowerCase();
  if (/\.(mscz|mscx)$/.test(name)) {
    if (!HAS_SERVER) throw new Error('MuseScore files can only be opened in the Rehearsal app');
    status('Converting with MuseScore… (about 20 seconds, only the first time)');
    const r = await fetch(`/api/convert?id=${st.fileId}&ext=${name.endsWith('.mscx') ? 'mscx' : 'mscz'}`, { headers: { 'X-Token': TOKEN } });
    if (!r.ok) throw new Error((await r.text()) || 'MuseScore could not convert this file');
    const xml = await r.text();
    try {
      const f = new File([xml], name.replace(/\.(mscz|mscx)$/, '.musicxml'), { type: 'application/xml' });
      st.xmlId = await storeFile(f); if (S.files[st.xmlId]) S.files[st.xmlId].derived = true; save();
    } catch { }
    return xml;
  }
  const buf = await tryId(st.fileId); if (!buf) throw new Error('this file is missing');
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x50 && head[1] === 0x4b) return spMxlToXml(buf);   // "PK" = zipped .mxl
  return new TextDecoder().decode(buf);
}

// ---------- MusicXML -> timed notes (quarter-note units)
const SP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function spParse(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('this file is not valid MusicXML');
  if (doc.documentElement.tagName === 'score-timewise') throw new Error('timewise MusicXML is not supported — re-export from MuseScore');
  const info = [...doc.querySelectorAll('part-list > score-part')].map(sp => ({ id: sp.getAttribute('id'), name: (sp.querySelector('part-name')?.textContent || '').trim() }));
  const partEls = [...doc.documentElement.children].filter(e => e.tagName === 'part');
  const parts = partEls.map((p, i) => ({ id: p.getAttribute('id'), name: info.find(x => x.id === p.getAttribute('id'))?.name || `Part ${i + 1}` }));
  const measures = [], events = [], tempos = [];
  const num = (el, sel) => Number(el.querySelector(sel)?.textContent);
  const staves = [];
  partEls.forEach((part, pi) => {
    let div = 1, q = 0, trans = 0, beats = 4, bt = 4, fifths = 0, mode = 'major', modeGiven = false, ending = null; const open = {}; staves[pi] = 1;
    [...part.children].filter(m => m.tagName === 'measure').forEach((m, mi) => {
      const mStart = pi === 0 || !measures[mi] ? q : measures[mi].start;
      let pos = 0, maxPos = 0, lastStart = 0; const rp = { fwd: false, back: 0, ending: null };
      for (const el of m.children) {
        const t = el.tagName;
        if (t === 'attributes') {
          if (el.querySelector('divisions')) div = num(el, 'divisions') || div;
          if (el.querySelector('staves')) staves[pi] = Math.max(staves[pi], num(el, 'staves') || 1);
          const tr = el.querySelector('transpose'); if (tr) trans = (num(tr, 'chromatic') || 0) + 12 * (num(tr, 'octave-change') || 0);
          const ky = el.querySelector('key'); if (ky && ky.querySelector('fifths')) { fifths = num(ky, 'fifths') || 0; const md = ky.querySelector('mode')?.textContent.trim(); mode = md || 'major'; modeGiven = !!md && /major|minor/i.test(md); }
          const ti = el.querySelector('time'); if (ti && ti.querySelector('beats')) { beats = parseInt(ti.querySelector('beats').textContent) || 4; bt = num(ti, 'beat-type') || 4; }
        } else if (t === 'direction' || t === 'sound') {
          const s = t === 'sound' ? el : el.querySelector('sound');
          const bpm = Number(s?.getAttribute('tempo'));
          if (bpm > 0 && pi === 0) tempos.push({ q: mStart + pos, bpm });
        } else if (t === 'barline' && pi === 0) {
          const r = el.querySelector('repeat'), en = el.querySelector('ending');
          if (r && r.getAttribute('direction') === 'forward') rp.fwd = true;
          if (r && r.getAttribute('direction') === 'backward') rp.back = parseInt(r.getAttribute('times')) || 2;
          if (en) {
            const nums = (en.getAttribute('number') || '1').split(/[,\s]+/).map(Number).filter(n => n > 0);
            if (en.getAttribute('type') === 'start') ending = nums;
            rp.ending = ending || nums;
            if (/stop|discontinue/.test(en.getAttribute('type') || '')) rp.endClose = true;
          }
        } else if (t === 'backup') pos -= num(el, 'duration') / div || 0;
        else if (t === 'forward') { pos += num(el, 'duration') / div || 0; maxPos = Math.max(maxPos, pos); }
        else if (t === 'note') {
          if (el.querySelector('grace')) continue;
          const chord = !!el.querySelector(':scope > chord'), d = (num(el, ':scope > duration') || 0) / div;
          const start = chord ? lastStart : pos;
          if (!chord) { lastStart = pos; pos += d; }
          maxPos = Math.max(maxPos, pos);
          const p = el.querySelector(':scope > pitch');
          if (!p || el.querySelector(':scope > cue')) continue;
          const midi = (num(p, 'octave') + 1) * 12 + SP_PC[p.querySelector('step').textContent.trim()] + (num(p, 'alter') || 0) + trans;
          const ties = [...el.querySelectorAll(':scope > tie')].map(x => x.getAttribute('type'));
          const at = mStart + start, prev = open[midi];
          if (ties.includes('stop') && prev && Math.abs(prev.q + prev.dur - at) < 1e-3) {
            prev.dur += d; if (!ties.includes('start')) delete open[midi]; continue;
          }
          const ev = { part: pi, voice: (el.querySelector(':scope > voice')?.textContent || '1').trim(), midi: Math.round(midi), q: at, dur: d, m: mi };
          events.push(ev);
          if (ties.includes('start')) open[midi] = ev; else delete open[midi];
        }
      }
      if (pi === 0) {
        const nominal = beats * 4 / bt;
        measures[mi] = { start: mStart, len: maxPos > 1e-6 ? maxPos : nominal, num: m.getAttribute('number') || String(mi + 1), beats, bt, fifths, mode, modeGiven,
          repFwd: rp.fwd, repBack: rp.back, ending: rp.ending || ending };
        if (rp.endClose) ending = null;
      }
      q = mStart + (measures[mi]?.len ?? maxPos);
    });
  });
  events.sort((a, b) => a.q - b.q);
  // Lines you can focus on / give pitches for. Accompaniment (piano etc.) stays one line; a vocal part
  // written with two voices on one staff (e.g. "Soprano/Alto") is split into its two voices.
  const ACC = /piano|pno|keyboard|keys|organ|accomp|harp|guitar|synth|celest/i;
  const lines = [];
  parts.forEach((p, pi) => {
    // accompaniment = a grand staff (piano) or a clearly instrumental name; single-staff parts are voices even
    // when MuseScore calls them "Piano 1" (common when a choir score was set up with piano sounds)
    const acc = staves[pi] > 1 || /accomp|organ|guitar|harp|synth|celest|bass guitar|drum/i.test(p.name);
    const evs = events.filter(e => e.part === pi);
    const counts = {}; evs.forEach(e => counts[e.voice] = (counts[e.voice] || 0) + 1);
    const vs = Object.keys(counts).filter(v => counts[v] > evs.length * 0.1).sort();
    if (!acc && vs.length >= 2) {
      const names = p.name.split(/\s*(?:\/|&|,|\band\b)\s*/i).filter(Boolean);
      vs.forEach((v, k) => lines.push({ part: pi, voice: v, acc: false, name: names.length === vs.length ? names[k] : `${p.name} ${k === 0 ? 'upper' : k === vs.length - 1 ? 'lower' : k + 1}` }));
      evs.forEach(e => { const k = vs.indexOf(e.voice); e.line = lines.length - vs.length + (k < 0 ? 0 : k); });
    } else { lines.push({ part: pi, voice: null, acc, name: p.name }); evs.forEach(e => e.line = lines.length - 1); }
  });
  parts.forEach((p, pi) => p.acc = lines.some(l => l.part === pi && l.acc));
  if (!tempos.length || tempos[0].q > 0) tempos.unshift({ q: 0, bpm: tempos[0]?.bpm || 100 });
  // beats (for count-in / metronome): compound meters click the dotted beat
  const beatList = [];
  for (const m of measures) {
    const compound = m.bt === 8 && m.beats % 3 === 0 && m.beats > 3;
    const bu = compound ? 1.5 : 4 / m.bt;
    for (let k = 0, x = m.start; x < m.start + m.len - 1e-6; k++, x += bu) beatList.push({ q: x, accent: k === 0 });
  }
  const total = measures.length ? measures[measures.length - 1].start + measures[measures.length - 1].len : 0;
  spDetectModes(measures, events);
  const sc = { parts, lines, measures, events, tempos, beats: beatList, total };
  spPerformance(sc);
  return sc;
}
// The file usually says only the key signature, not major or minor. For each stretch of music in one
// key signature, decide from the notes: a raised leading tone of the relative minor (F♯ in G minor),
// and starting / ending on the minor tonic in the bass mean minor. (A <mode> in the file always wins.)
function spDetectModes(M, E) {
  let i = 0;
  while (i < M.length) {
    let j = i; while (j + 1 < M.length && M[j + 1].fifths === M[i].fifths) j++;
    const fileMode = M[i].modeGiven ? M[i].mode : null;
    let mode = fileMode;
    if (!mode) {
      const maj = (((M[i].fifths || 0) * 7) % 12 + 12) % 12, min = (maj + 9) % 12, lt = (min + 11) % 12;
      const ev = E.filter(e => e.m >= i && e.m <= j);
      const w = new Array(12).fill(0); let tot = 0;
      for (const e of ev) { w[e.midi % 12] += e.dur; tot += e.dur; }
      const lowAt = q => { const at = ev.filter(e => Math.abs(e.q - q) < 1e-6); return at.length ? Math.min(...at.map(e => e.midi)) % 12 : -1; };
      const q0 = ev.length ? Math.min(...ev.map(e => e.q)) : 0, q1 = ev.length ? Math.max(...ev.map(e => e.q)) : 0;
      let score = 0;
      if (tot && w[lt] / tot > 0.015) score += 2;
      if (w[min] > w[maj]) score += 1; else score -= 1;
      const f = lowAt(q0), l = lowAt(q1);
      if (f === min) score += 1; if (f === maj) score -= 1;
      if (l === min) score += 1.5; if (l === maj) score -= 1.5;
      mode = score >= 2 ? 'minor' : 'major';
    }
    for (let k = i; k <= j; k++) M[k].mode = mode;
    i = j + 1;
  }
}
// Written measures -> the order they're played: back to the start at a repeat sign (:||, or the
// last forward repeat ||:), skipping endings that aren't for this time through (1st / 2nd endings).
function spUnroll(M) {
  const order = []; let i = 0, start = 0, pass = 1, guard = 0; const done = new Set();
  while (i < M.length && guard++ < 20000) {
    const m = M[i];
    if (m.repFwd && i !== start) { start = i; pass = 1; }
    if (m.ending && !m.ending.includes(pass)) { i++; continue; }
    order.push(i);
    if (m.repBack && !done.has(i)) {
      if (pass < m.repBack) { pass++; i = start; continue; }
      done.add(i); start = i + 1; pass = 1;
    } else if (m.ending && !(M[i + 1]?.ending)) { start = i + 1; pass = 1; }   // last ending finished
    i++;
  }
  return order;
}
function spPerformance(sc) {
  const M = sc.measures, order = spUnroll(M);
  const byM = M.map(() => []); for (const e of sc.events) (byM[e.m] ||= []).push(e);
  const perf = [], pevents = [], pbeats = [], ptempos = []; let q = 0;
  order.forEach((w, k) => {
    const m = M[w], off = q - m.start;
    perf.push({ w, start: q, len: m.len });
    for (const e of byM[w] || []) pevents.push({ ...e, q: e.q + off, pm: k });
    for (const b of sc.beats) if (b.q >= m.start - 1e-9 && b.q < m.start + m.len - 1e-9) pbeats.push({ ...b, q: b.q + off });
    for (const t of sc.tempos) if (t.q >= m.start - 1e-9 && t.q < m.start + m.len - 1e-9) ptempos.push({ ...t, q: t.q + off });
    q += m.len;
  });
  if (!ptempos.length || ptempos[0].q > 0) ptempos.unshift({ q: 0, bpm: sc.tempos[0]?.bpm || 100 });
  Object.assign(sc, { perf, pevents, pbeats, ptempos, ptotal: q, hasRepeats: order.length !== M.length || order.some((w, k) => w !== k) });
}
const spBpmAt = (sc, q) => { const T = sc.ptempos || sc.tempos; let b = T[0].bpm; for (const t of T) { if (t.q <= q + 1e-9) b = t.bpm; else break; } return b; };
const spKey = q => Math.round(q * 10080);

// ---------- piano
const SP_PIANO = { buffers: {}, loading: null };
const SP_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const spNoteName = midi => { const m = Math.max(21, Math.min(108, midi)); return SP_NAMES[m % 12] + (Math.floor(m / 12) - 1); };
async function spPianoReady(midis) {
  await spLoadScript('vendor/piano.js');
  const font = window.MIDI?.Soundfont?.acoustic_grand_piano; if (!font) throw new Error('piano sound missing');
  const c = ac();
  await Promise.all([...new Set(midis.map(spNoteName))].map(async n => {
    if (SP_PIANO.buffers[n] || !font[n]) return;
    const b = await (await fetch(font[n])).arrayBuffer();
    const buf = await new Promise((res, rej) => c.decodeAudioData(b, res, rej));
    const d = buf.getChannelData(0); let i = 0, peak = 0;
    for (let k = 0; k < Math.min(d.length, buf.sampleRate * 0.3); k++) peak = Math.max(peak, Math.abs(d[k]));
    while (i < d.length && Math.abs(d[i]) < peak * 0.05) i++;
    buf.lead = Math.max(0, i / buf.sampleRate - 0.003);           // mp3s start with a little silence
    SP_PIANO.buffers[n] = buf;
  }));
}
function spPianoNote(dest, time, midi, dur, vel = 0.8) {
  const c = ac(), buf = SP_PIANO.buffers[spNoteName(midi)]; if (!buf) return;
  const src = c.createBufferSource(), g = c.createGain();
  src.buffer = buf;
  const shift = midi - Math.max(21, Math.min(108, midi)); if (shift) src.playbackRate.value = Math.pow(2, shift / 12);
  g.gain.setValueAtTime(vel, time);
  g.gain.setTargetAtTime(0, time + Math.max(0.05, dur), 0.07);           // let go of the key
  src.connect(g).connect(dest); src.start(time, buf.lead || 0); src.stop(time + Math.max(0.05, dur) + 0.6);
}
function spClick(dest, time, accent) {
  const v = metVol(); if (v < 0.002) return;                      // the metronome's own volume
  const c = ac(), os = c.createOscillator(), g = c.createGain();
  os.type = 'sine'; os.frequency.value = accent ? 3200 : 2500;
  g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime((accent ? 0.3 : 0.2) * v, time + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
  os.connect(g).connect(dest); os.start(time); os.stop(time + 0.04);
}

// ---------- hold a chord (for tuning)
const SP_HOLD = { out: null, oscs: [] };
function spHoldStop() {
  const c = ac(), h = SP_HOLD; if (!h.out) return;
  const g = h.out; try { g.gain.setTargetAtTime(0, c.currentTime, 0.08); } catch { }
  const os = h.oscs; setTimeout(() => { os.forEach(o => { try { o.stop(); } catch { } }); try { g.disconnect(); } catch { } }, 600);
  h.out = null; h.oscs = [];
}
// q: position in quarters; build: add the notes one at a time from the bottom
function spHoldChord(ctl, q, build) {
  const { sc, st } = ctl, c = ac(); c.resume && c.resume();
  spHoldStop();
  const sounding = sc.events.filter(e => e.q <= q + 1e-6 && q < e.q + e.dur - 1e-6 && !sc.lines[e.line]?.acc && st.parts[e.line]?.on !== false
    && (st.focus == null || true));
  const notes = [...new Set(sounding.map(e => e.midi))].sort((a, b) => a - b);
  if (!notes.length) { toast('No voices are singing at that spot.'); return; }
  const out = c.createGain(); out.gain.value = 0.0001; out.connect(musicOut(c));
  out.gain.setTargetAtTime(0.5 / Math.sqrt(notes.length), c.currentTime, 0.05);
  SP_HOLD.out = out;
  notes.forEach((m, k) => {
    const f = 440 * Math.pow(2, (m - 69) / 12), t = c.currentTime + (build ? k * 0.9 : 0);
    const g = c.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(1, t, 0.04); g.connect(out);
    for (const [type, mul, amp] of [['triangle', 1, 0.7], ['sine', 2, 0.18], ['sine', 3, 0.06]]) {
      const os = c.createOscillator(), og = c.createGain(); os.type = type; os.frequency.value = f * mul; og.gain.value = amp;
      os.connect(og).connect(g); os.start(t); SP_HOLD.oscs.push(os);
    }
  });
  const names = notes.map(spNoteName).join(' · ');
  toast(`Holding ${names} — click another spot, or Hold chord to stop.${build ? '' : ' (Shift-click to build it up from the bottom)'}`, 3500);
}

// ---------- Idempotent CSS injection for Score Practice Vocal Recording & Looper Grading
function spInjectVoiceGradeCSS() {
  if (typeof document === 'undefined' || !document.head || document.getElementById('sp-voice-grade-css')) return;
  const s = document.createElement('style');
  s.id = 'sp-voice-grade-css';
  s.textContent = `
    /* Score Practice Looper Grading: note-by-note OSMD SVG color feedback */
    .sp-osmd .gr-n-ok path, .sp-osmd .gr-n-ok rect, .sp-osmd .gr-n-ok polygon { fill: #1b7a2a !important; stroke: #1b7a2a !important; opacity: 1 !important; }
    .sp-osmd .gr-n-timing path, .sp-osmd .gr-n-timing rect, .sp-osmd .gr-n-timing polygon { fill: #d9822b !important; stroke: #d9822b !important; opacity: 1 !important; }
    .sp-osmd .gr-n-pitch path, .sp-osmd .gr-n-pitch rect, .sp-osmd .gr-n-pitch polygon { fill: #7b3fbf !important; stroke: #7b3fbf !important; opacity: 1 !important; }
    .sp-osmd .gr-n-missed path, .sp-osmd .gr-n-missed rect, .sp-osmd .gr-n-missed polygon { fill: #c62828 !important; stroke: #c62828 !important; opacity: 1 !important; }

    /* Score overlay grading marks & floating action chips */
    .sp-grov { position: absolute; left: 0; top: 0; right: 0; height: 0; pointer-events: none; z-index: 4; }
    .sp-grov svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
    .sp-grov .gr-lane { stroke: #c9ccd6; stroke-width: 1; stroke-dasharray: 2 4; }
    .sp-grov .gr-tick { stroke: #8a90a2; stroke-width: 1.5; }
    .sp-grov .gr-dot { stroke: #fff; stroke-width: 1.5; }
    .sp-grov .gr-dot.ok { fill: #1b7a2a; }
    .sp-grov .gr-dot.timing { fill: #d9822b; }
    .sp-grov .gr-off { stroke-width: 3; stroke-linecap: round; }
    .sp-grov .gr-off.ok { stroke: #1b7a2a; }
    .sp-grov .gr-off.timing { stroke: #d9822b; }
    .sp-grov .gr-ring { fill: none; stroke: #c62828; stroke-width: 2; stroke-dasharray: 4 3; }
    .sp-grov .gr-extra { stroke: #8a90a2; stroke-width: 2; stroke-linecap: round; }
    .sp-grov text.gr-lbl { fill: #7b3fbf; font: bold 11.5px -apple-system, system-ui, Arial, sans-serif; }
    .sp-grov text.gr-lbl.soft { fill: #8a90a2; font-weight: normal; font-style: italic; }
    .sp-score .gr-chips { position: sticky; top: 8px; float: right; margin: 6px 12px 0 0; z-index: 12; display: inline-flex; gap: 6px; flex-wrap: wrap; pointer-events: auto; }

    /* Count-in & live recording/grading banner on the score */
    .sp-count { position: sticky; top: 14px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 32px); margin: 0 auto; z-index: 15; pointer-events: none;
      background: rgba(24, 28, 38, 0.9); color: #fff; border: 1.5px solid var(--accent, #e76f51); border-radius: 14px; padding: 8px 18px; text-align: center; box-shadow: 0 10px 28px rgba(0,0,0,.28); }
    .sp-count-n { font-size: 36px; font-weight: 800; line-height: 1.05; font-variant-numeric: tabular-nums; color: var(--accent, #ffd166); }
    .sp-count.one .sp-count-n { transform: scale(1.08); }
    .sp-count-cue { font-size: 13px; opacity: .92; margin-top: 2px; }
    .sp-count.rec-live { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; }
    .sp-rec-dot { width: 10px; height: 10px; border-radius: 50%; background: #e5484d; display: inline-block; animation: sprecpulse 1s infinite; }
    @keyframes sprecpulse { 50% { opacity: .25; transform: scale(.85); } }

    /* Grade split button & options menu */
    .sp-grade-ctl { display: inline-flex; align-items: stretch; gap: 0 !important; }
    .sp-top .sp-grade-ctl > button[data-sp="grade"] { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .sp-top .sp-grade-ctl > button[data-sp="grade-menu"] { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; padding: 0 6px !important; min-width: 22px; }
    .sp-grmenu { position: fixed; z-index: 9100; width: min(310px, calc(100vw - 20px)); display: flex; flex-direction: column; gap: 6px; padding: 10px;
      background: #ffffff; color: #1d2330; border: 1px solid #d3d9e6; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.25); font-size: 13px; }
    .sp-grmenu .sp-grm-sec { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #6b7385; margin-top: 2px; }
    .sp-grmenu select { width: 100%; background: #f7f9fc; color: #1d2330; border: 1px solid #cfd6e3; border-radius: 7px; padding: 5px 8px; font-size: 13px; font-weight: 600; }
    .sp-grmenu .sp-grm-btn { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 7px 9px; border: 1px solid #e1e6f0; border-radius: 8px; background: #fff; color: #1d2330; cursor: pointer; font-size: 13px; }
    .sp-grmenu .sp-grm-btn:hover { background: #eef4ff; border-color: #3b6cf6; }
    .sp-grmenu .sp-grm-btn.last { border-color: #3b6cf6; background: #f4f8ff; }
    .sp-grmenu .sp-grm-btn small { display: block; color: #636b7d; font-size: 11.5px; font-weight: 400; }
    .sp-grmenu label.sp-grm-chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #333a48; cursor: pointer; padding: 2px 2px; }

    /* Voice parts & Vocal Recording mixer strip (.sp-voices) and settings mixer (.sp-parts) */
    .sp-voices { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 10px; border-bottom: 1px solid var(--line, rgba(0,0,0,.12));
      background: color-mix(in srgb, var(--text, #1d2330) 4%, transparent); color: var(--text, #1d2330); flex: 0 0 auto; }
    .sp-voices[hidden] { display: none !important; }
    .sp-voices-head { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .75; margin-right: 2px; }
    .sp-parts { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
    .sp-part { display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, var(--text, #1d2330) 6%, transparent);
      border: 1px solid var(--line, rgba(0,0,0,.15)); border-radius: 9px; padding: 3px 8px; font-size: 12.5px; transition: border-color .15s, background .15s; }
    .sp-part.is-sung { border-color: color-mix(in srgb, var(--accent, #e76f51) 65%, var(--line, transparent)); background: color-mix(in srgb, var(--accent, #e76f51) 12%, transparent); }
    .sp-part.is-rec { border-color: #e5484d; background: rgba(229, 72, 77, 0.14); }
    .sp-part-lbl { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; font-weight: 600; white-space: nowrap; }
    .sp-part input[type=range] { width: 64px; cursor: pointer; }
    .sp-vrec-btn, .sp-vdel-btn, .sp-vfoc-btn { border: 1px solid var(--line, rgba(0,0,0,.18)); background: color-mix(in srgb, var(--text, #1d2330) 8%, transparent);
      color: var(--text, #1d2330); border-radius: 7px; padding: 2px 7px !important; height: 24px !important; font-size: 11.5px !important; font-weight: 600;
      cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; line-height: 1; }
    .sp-vrec-btn:hover, .sp-vdel-btn:hover, .sp-vfoc-btn:hover { background: color-mix(in srgb, var(--text, #1d2330) 16%, transparent); }
    .sp-vrec-btn.rec-on { background: #e5484d !important; color: #fff !important; border-color: #e5484d !important; animation: sprecpulse 1s infinite; }
    .sp-vfoc-btn.on { background: var(--accent, #e76f51) !important; color: var(--bg, #fff) !important; border-color: transparent !important; }
    .sp-vdel-btn { padding: 2px 5px !important; opacity: .8; }
    .sp-vdel-btn:hover { opacity: 1; background: rgba(229, 72, 77, 0.2); border-color: #e5484d; }
    .sp-vsrc-seg { display: inline-flex; border: 1px solid var(--line, rgba(0,0,0,.2)); border-radius: 7px; overflow: hidden; height: 24px; box-sizing: border-box; }
    .sp-vsrc-seg button { border: 0 !important; border-radius: 0 !important; padding: 0 7px !important; height: 100% !important; font-size: 11px !important; font-weight: 700;
      background: transparent; color: var(--text, #1d2330); opacity: .7; cursor: pointer; }
    .sp-vsrc-seg button + button { border-left: 1px solid var(--line, rgba(0,0,0,.18)) !important; }
    .sp-vsrc-seg button.on { background: var(--accent, #e76f51) !important; color: var(--bg, #fff) !important; opacity: 1; }
    .sp-vsrc-seg button:disabled { opacity: .35; cursor: default; }
    .sp-vmeta { font-size: 10.5px; opacity: .72; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .sp-vopts { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; opacity: .88; margin-left: auto; flex-wrap: wrap; }
    .sp-vopts label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
  `;
  document.head.appendChild(s);
}

// ---------- Sung-Voice Audio Recording & IndexedDB Persistence (16-bit PCM WAV + Float32 AudioBuffer)
const SP_VOCAL_MEM = new Map(); // in-memory cache keyed by `${fileId}:${lineIdx}`
let SP_VOCAL_IDB = null;
function spVocalIdbOpen() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  return SP_VOCAL_IDB ||= new Promise((res, rej) => {
    try {
      const r = indexedDB.open('rehearsal-vocals', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('vocals')) r.result.createObjectStore('vocals'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function spVocalIdbDo(mode, fn) {
  const db = await spVocalIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('vocals', mode), req = fn(tx.objectStore('vocals'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
function spEncodeWav(samples, sr) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buf;
}
function spDecodeWavToFloat32(wavBuf) {
  const v = new DataView(wavBuf);
  const sr = v.getUint32(24, true) || 48000;
  const dataBytes = Math.max(0, wavBuf.byteLength - 44);
  const n = dataBytes >> 1;
  const out = new Float32Array(n);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) out[i] = v.getInt16(o, true) / 32768;
  return { samples: out, sampleRate: sr };
}
function spToAudioBuffer(c, samples, sr) {
  const buf = c.createBuffer(1, Math.max(1, samples.length), sr);
  buf.getChannelData(0).set(samples);
  return buf;
}
async function spSaveVocalRec(fileId, lineIdx, recObj) {
  if (!fileId) return;
  const key = `${fileId}:${lineIdx}`;
  const stored = {
    key,
    fileId,
    lineIdx,
    recordedBpm: recObj.recordedBpm,
    recordedTempoPct: recObj.recordedTempoPct,
    startBeat: recObj.startBeat,
    endBeat: recObj.endBeat,
    startMeasure: recObj.startMeasure,
    endMeasure: recObj.endMeasure,
    loopWasOn: !!recObj.loopWasOn,
    sampleRate: recObj.sampleRate,
    durationSec: recObj.durationSec,
    wavBuf: recObj.wavBuf,
    createdAt: recObj.createdAt || Date.now(),
  };
  SP_VOCAL_MEM.set(key, { ...stored, audioBuffer: recObj.audioBuffer });
  try { await spVocalIdbDo('readwrite', st => st.put(stored, key)); } catch { }
}
async function spDeleteVocalRec(ctl, lineIdx) {
  const { st } = ctl, key = `${st.fileId}:${lineIdx}`;
  if (ctl.vocalRecs) delete ctl.vocalRecs[lineIdx];
  SP_VOCAL_MEM.delete(key);
  try { await spVocalIdbDo('readwrite', s => s.delete(key)); } catch { }
  if (st.parts[lineIdx]) st.parts[lineIdx].source = 'midi';
  ctl.onChange?.();
  ctl.refreshVoicesUI?.();
}
async function spLoadVocalRecs(ctl) {
  const { sc, st } = ctl;
  if (!sc || !st?.fileId) return;
  ctl.vocalRecs ||= {};
  let anyLoaded = false;
  for (let i = 0; i < sc.lines.length; i++) {
    const key = `${st.fileId}:${i}`;
    let rec = SP_VOCAL_MEM.get(key);
    if (!rec) {
      try { rec = await spVocalIdbDo('readonly', s => s.get(key)); } catch { rec = null; }
    }
    if (rec && rec.wavBuf) {
      if (!rec.audioBuffer) {
        try {
          const { samples, sampleRate } = spDecodeWavToFloat32(rec.wavBuf);
          rec.audioBuffer = spToAudioBuffer(ac(), samples, sampleRate);
        } catch { }
      }
      if (rec.audioBuffer) {
        ctl.vocalRecs[i] = rec;
        SP_VOCAL_MEM.set(key, rec);
        (st.parts[i] ||= {}).source ??= 'sung';
        anyLoaded = true;
      }
    }
  }
  if (anyLoaded) ctl.refreshVoicesUI?.();
}
function spIsLineSung(ctl, lineIdx) {
  const rec = ctl?.vocalRecs?.[lineIdx];
  if (!rec || !rec.audioBuffer) return false;
  return (ctl.st?.parts?.[lineIdx]?.source ?? 'sung') === 'sung';
}
function spStopVocalNodes(ctl) {
  if (!ctl?.vocalNodes?.length) return;
  for (const n of ctl.vocalNodes) {
    try { n.src.stop(); } catch { }
    try { n.src.disconnect(); n.vg.disconnect(); } catch { }
  }
  ctl.vocalNodes = [];
}

// ---------- Active Vocal Recording State
const SP_VREC = { on: false, starting: false, ctl: null, lineIdx: -1, c: null, src: null, sp: null, mute: null, chunks: [], marks: [], n: 0, T0: 0, endT: 0, R: null, recordedBpm: 100 };

function spStopVocalRec(saveTake = true) {
  if (!SP_VREC.on) return;
  const { ctl, lineIdx, c, chunks, marks, n, T0, endT, R, recordedBpm } = SP_VREC;
  SP_VREC.on = false;
  try { SP_VREC.sp?.disconnect(); SP_VREC.src?.disconnect(); SP_VREC.mute?.disconnect(); } catch { }
  SP_VREC.sp = null; SP_VREC.src = null; SP_VREC.mute = null;
  if (typeof GR !== 'undefined' && GR.mic && typeof grMicClose === 'function') {
    clearTimeout(GR.mic.idle);
    GR.mic.idle = setTimeout(grMicClose, typeof GR_MIC_IDLE !== 'undefined' ? GR_MIC_IDLE : 120000);
  }
  if (SP_PLAY.ctl === ctl && ctl?.playing) {
    clearInterval(SP_PLAY.timer); SP_PLAY.timer = null; cancelAnimationFrame(SP_PLAY.raf);
    try { SP_PLAY.master && SP_PLAY.master.disconnect(); } catch { }
    spStopVocalNodes(ctl);
    SP_PLAY.master = null; SP_PLAY.ctl = null;
    ctl.playing = false; ctl.hidePlayhead();
  }
  ctl?.hideCountOverlay?.();
  if (saveTake && ctl && c && n > 0 && R) {
    const sr = c.sampleRate;
    const raw = new Float32Array(n);
    let o = 0;
    for (const a of chunks) { raw.set(a, o); o += a.length; }
    // Map audio-clock time -> sample index using linear regression on (contextTime, sampleEnd)
    let sampleAt = t => (t - (marks[0]?.[1] || T0)) * sr;
    if (marks.length >= 2) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0; const k = marks.length;
      for (const [sm, t] of marks) { sx += t; sy += sm; sxx += t * t; sxy += t * sm; }
      const denom = k * sxx - sx * sx;
      const slope = Math.abs(denom) > 1e-9 ? (k * sxy - sx * sy) / denom : sr;
      const icpt = (sy - slope * sx) / k;
      sampleAt = t => icpt + slope * t;
    }
    const latSec = Math.max(0, Math.min(0.35, spAvDelay()));
    const s0 = Math.max(0, Math.min(raw.length - 1, Math.round(sampleAt(T0 + latSec))));
    const actualEndT = Math.min(c.currentTime, endT || c.currentTime);
    const expectedSamples = Math.max(Math.round(sr * 0.25), Math.round(((R.b - R.a) * 60 / (recordedBpm || 100)) * sr));
    const s1 = Math.max(s0 + 1, Math.min(raw.length, s0 + expectedSamples, Math.round(sampleAt(actualEndT + latSec)) + Math.round(sr * 0.08)));
    const trimmed = raw.slice(s0, s1);
    if (trimmed.length >= Math.round(sr * 0.15)) {
      let peak = 0;
      for (let i = 0; i < trimmed.length; i++) { const v = Math.abs(trimmed[i]); if (v > peak) peak = v; }
      // Gentle gain normalization so quiet built-in laptop mics sit nicely next to MIDI piano while keeping part volume slider at 100%
      const normGain = (peak > 0.003 && peak < 0.3) ? Math.min(4.5, 0.42 / peak) : 1;
      const fadeIn = Math.min(Math.round(sr * 0.006), trimmed.length >> 2);
      const fadeOut = Math.min(Math.round(sr * 0.012), trimmed.length >> 2);
      for (let i = 0; i < trimmed.length; i++) {
        let g = normGain;
        if (i < fadeIn) g *= i / (fadeIn || 1);
        else if (i >= trimmed.length - fadeOut) g *= (trimmed.length - 1 - i) / (fadeOut || 1);
        trimmed[i] = Math.max(-1, Math.min(1, trimmed[i] * g));
      }
      const wavBuf = spEncodeWav(trimmed, sr);
      const audioBuffer = spToAudioBuffer(c, trimmed, sr);
      const st = ctl.st;
      const recObj = {
        fileId: st.fileId,
        lineIdx,
        recordedBpm,
        recordedTempoPct: Number(st.tempo) || 100,
        startBeat: R.a,
        endBeat: R.b,
        startMeasure: st.loop.on ? Math.min(st.loop.a, st.loop.b) : 0,
        endMeasure: st.loop.on ? Math.max(st.loop.a, st.loop.b) : Math.max(0, (ctl.sc?.measures?.length || 1) - 1),
        loopWasOn: !!st.loop.on,
        sampleRate: sr,
        durationSec: trimmed.length / sr,
        wavBuf,
        audioBuffer,
        createdAt: Date.now(),
      };
      (ctl.vocalRecs ||= {})[lineIdx] = recObj;
      (st.parts[lineIdx] ||= {}).source = 'sung';
      spSaveVocalRec(st.fileId, lineIdx, recObj);
      ctl.onChange?.();
      const pName = ctl.sc?.lines[lineIdx]?.name || `Part ${lineIdx + 1}`;
      toast(`Recorded ${pName} — now playing your Sung voice instead of MIDI.`);
    } else {
      toast('Recording was too short — sing after the count-in.');
    }
  }
  SP_VREC.chunks = []; SP_VREC.marks = []; SP_VREC.n = 0; SP_VREC.ctl = null;
  ctl?.updateBar?.();
  ctl?.refreshVoicesUI?.();
}

async function spStartVocalRec(ctl, lineIdx) {
  if (SP_VREC.on && SP_VREC.ctl === ctl && SP_VREC.lineIdx === lineIdx) { spStopVocalRec(true); return; }
  if (SP_VREC.starting) return;
  if (SP_VREC.on) spStopVocalRec(false);
  if (typeof GR !== 'undefined' && GR.on && typeof grStop === 'function') grStop(false);
  if (SP_PLAY.ctl) spStop();
  const { sc, st } = ctl;
  if (!sc || !sc.lines[lineIdx]) return;
  SP_VREC.starting = true;
  let stream = null;
  try {
    const c = ac();
    await Promise.race([c.resume().catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    await spPianoReady(sc.events.map(e => e.midi));
    if (typeof grMic === 'function') {
      const m = await grMic();
      stream = m.stream;
      // Wait briefly if the mic was just opened on macOS so the initial audio switch doesn't clip beat 1
      if (!m.ready && !(typeof GR_IOS !== 'undefined' && GR_IOS)) {
        const waitUntil = () => m.liveAt ?? (m.openedAt + 1200);
        while (performance.now() < waitUntil()) await new Promise(r => setTimeout(r, 40));
        m.ready = true;
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    }
  } catch (e) {
    SP_VREC.starting = false;
    return toast('Microphone not available: ' + (e.message || e));
  }
  SP_VREC.starting = false;
  const c = ac();
  if (typeof srKeepAwake === 'function') srKeepAwake(c);
  const src = c.createMediaStreamSource(stream);
  const sp = c.createScriptProcessor(4096, 1, 1);
  const mute = c.createGain(); mute.gain.value = 0;
  src.connect(sp); sp.connect(mute).connect(c.destination);
  const R = spRange(ctl);
  const recordedBpm = spBpmAt(sc, R.a) * ((Number(st.tempo) || 100) / 100);
  Object.assign(SP_VREC, {
    on: true, ctl, lineIdx, c, src, sp, mute,
    chunks: [], marks: [], n: 0, T0: 0, endT: 0, R, recordedBpm,
  });
  sp.onaudioprocess = e => {
    if (!SP_VREC.on) return;
    const d = e.inputBuffer.getChannelData(0);
    SP_VREC.marks.push([SP_VREC.n + d.length, c.currentTime]);
    SP_VREC.chunks.push(new Float32Array(d));
    SP_VREC.n += d.length;
  };
  ctl.refreshVoicesUI?.();
  spPlay(ctl, {
    recordingLine: lineIdx,
    forceCountIn: Math.max(1, Number(st.countIn) || 1),
    noLoop: true,
  });
}

// ---------- the player
const SP_PLAY = { ctl: null, timer: null, raf: 0, master: null };
// the audio-clock time of the sound reaching your ears right now
function spAvDelay() { return avDelayMs() / 1000; }
function spHeardTime(c) {
  return spHeardRaw(c) - spAvDelay();
}
function spHeardRaw(c) {
  try { const ts = c.getOutputTimestamp && c.getOutputTimestamp(); if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000; } catch { }
  return c.currentTime - (c.outputLatency || c.baseLatency || 0);
}
let SP_ACTIVE = null;          // the score Space bar plays/stops
function spStop() {
  if (SP_VREC.on) {
    spStopVocalRec(true);
    spHoldStop();
    if (typeof grStopListen === 'function') grStopListen();
    return;
  }
  clearInterval(SP_PLAY.timer); SP_PLAY.timer = null; cancelAnimationFrame(SP_PLAY.raf);
  try { SP_PLAY.master && SP_PLAY.master.disconnect(); } catch { }
  const ctl = SP_PLAY.ctl; SP_PLAY.master = null; SP_PLAY.ctl = null;
  if (ctl) {
    spStopVocalNodes(ctl);
    ctl.playing = false; ctl.hideCountOverlay?.(); ctl.updateBar(); ctl.hidePlayhead();
  }
  spHoldStop();
  if (typeof grStopListen === 'function') grStopListen();
}
function spDefaults(st) {
  st.tempo ??= 100; st.countIn ??= 1; st.metronome ??= false; st.pitches ??= 'none';
  st.loop ||= { on: false, a: 0, b: 0 }; st.speed ||= { on: false, start: 70, step: 5 }; st.parts ||= {}; st.zoom ??= 0.8;
  st.voicesOpen ??= true; st.recGuide ??= true; st.recSelfGuide ??= false;
  return st;
}
function spRange(ctl) {
  const { sc, st } = ctl, M = sc.measures, P = sc.perf;
  if (st.loop.on && M.length) {
    const a = Math.max(0, Math.min(st.loop.a, st.loop.b, M.length - 1)), b = Math.min(M.length - 1, Math.max(st.loop.a, st.loop.b));
    // the shortest stretch of the performance from measure a to measure b — so a loop over
    // "m. 5–10" takes the 2nd ending if 10 is in it, and "m. 7–8" plays just the 1st ending
    let best = null;
    P.forEach((pa, ja) => {
      if (pa.w !== a) return;
      for (let jb = ja; jb < P.length; jb++) if (P[jb].w === b) { if (!best || jb - ja < best[1] - best[0]) best = [ja, jb]; break; }
    });
    if (best) return { a: P[best[0]].start, b: P[best[1]].start + P[best[1]].len, loop: true };
    return { a: M[a].start, b: M[b].start + M[b].len, loop: true, written: true };
  }
  const from = Math.max(0, Math.min(ctl.startAt || 0, M.length - 1)), j = P.findIndex(x => x.w === from);
  return { a: j >= 0 ? P[j].start : 0, b: sc.ptotal, loop: false };
}
// focus can be several lines; stored as an array (older saves have a single number)
const spFoc = st => st.focus == null ? [] : Array.isArray(st.focus) ? st.focus : [st.focus];
// the focused line plays out; other voices drop way down, accompaniment a little less; muted parts drop to 0
function spLineVol(ctl, i) {
  const st = ctl.st, L = ctl.sc.lines[i];
  if (st.parts[i]?.on === false) return 0;
  const base = st.parts[i]?.vol ?? 1;
  const F = spFoc(st).filter(f => ctl.sc.lines[f]); if (!F.length) return base;
  return base * (F.includes(i) ? 1.3 : L?.acc ? 0.35 : 0.2);
}
function spFirstNotes(sc, li, R) {
  const E = sc.pevents || sc.events;
  const e = E.find(ev => ev.line === li && ev.q >= R.a - 1e-9 && ev.q < R.b); if (!e) return [];
  return E.filter(ev => ev.line === li && Math.abs(ev.q - e.q) < 1e-6).map(ev => ev.midi);
}
// give a starting pitch now: one line, or every vocal line together / one after another (low to high)
async function spGivePitch(ctl, which) {
  const { sc } = ctl, c = ac(); c.resume && c.resume();
  await spPianoReady(sc.events.map(e => e.midi));
  const R = spRange(ctl), out = c.createGain(); out.gain.value = 0.9; out.connect(musicOut(c));
  const t = c.currentTime + 0.05, vocal = sc.lines.map((L, i) => i).filter(i => !sc.lines[i].acc);
  if (which === 'together') vocal.forEach(i => spFirstNotes(sc, i, R).forEach(m => spPianoNote(out, t, m, 2.2, 0.6)));
  else if (which === 'order') {
    const order = vocal.map(i => ({ i, low: Math.min(...spFirstNotes(sc, i, R), 999) })).filter(x => x.low < 999).sort((a, b) => a.low - b.low);
    order.forEach((x, k) => spFirstNotes(sc, x.i, R).forEach(m => spPianoNote(out, t + k * 0.9, m, 0.85 + (order.length - k - 1) * 0.9 + 1.2, 0.6)));
  } else spFirstNotes(sc, +which, R).forEach(m => spPianoNote(out, t, m, 1.8, 0.7));
}
// Integrate seconds between two quarter-note positions across any score tempo changes
function spTimeBetweenQ(sc, qA, qB, fac = 1) {
  if (qB <= qA + 1e-9) return 0;
  const T = sc.ptempos || sc.tempos || [{ q: 0, bpm: 100 }];
  let cur = qA, sec = 0;
  for (let i = 0; i < T.length && cur < qB - 1e-9; i++) {
    const nextQ = i + 1 < T.length ? T[i + 1].q : Infinity;
    if (nextQ <= cur + 1e-9) continue;
    const segEnd = Math.min(qB, nextQ);
    if (segEnd > cur) {
      sec += (segEnd - cur) * (60 / (T[i].bpm * (fac || 1)));
      cur = segEnd;
    }
  }
  return sec;
}
function spPlay(ctl, playOpts = null) {
  if (typeof GR !== 'undefined' && GR.on && typeof grStop === 'function') grStop(false);
  if (SP_VREC.on && playOpts?.recordingLine == null) spStopVocalRec(false);
  spHoldStop();
  if (SP_PLAY.ctl) {
    clearInterval(SP_PLAY.timer); SP_PLAY.timer = null; cancelAnimationFrame(SP_PLAY.raf);
    try { SP_PLAY.master && SP_PLAY.master.disconnect(); } catch { }
    spStopVocalNodes(SP_PLAY.ctl);
    SP_PLAY.master = null; SP_PLAY.ctl = null;
  }
  const { sc, st } = ctl, c = ac(); c.resume && c.resume();
  if (typeof srKeepAwake === 'function') srKeepAwake(c);
  SP_ACTIVE = ctl;
  const master = c.createGain(); master.gain.value = 0.9; master.connect(musicOut(c));
  const gains = sc.lines.map((_, i) => { const g = c.createGain(); g.gain.value = spLineVol(ctl, i); g.connect(master); return g; });
  Object.assign(SP_PLAY, { ctl, master });
  ctl.gains = gains; ctl.vocalNodes = []; ctl.playing = true; ctl.iter = 0; ctl.updateBar();
  let R = playOpts?.range ? { ...playOpts.range } : spRange(ctl), iter = 0;
  if (playOpts?.noLoop) R.loop = false;
  const factorAt = it => {
    const basePct = Number(playOpts?.tempoPct || st.tempo) || 100;
    const ramp = (!playOpts?.tempoPct && !playOpts?.recordingLine && st.speed.on)
      ? Math.min(1, ((Number(st.speed.start) || 70) + (Number(st.speed.step) || 5) * it) / 100)
      : 1;
    return (basePct / 100) * ramp;
  };
  const factor = () => factorAt(iter);
  const secPerQ = q => 60 / spBpmAt(sc, q) / factor();
  let countMeta = null;
  // count-in, and starting pitches (each part that's playing, from its first note in the range).
  // Returns how long it lasts; used at the start and (optionally) before every repeat of the loop.
  const countIn = (t0, first) => {
    if (playOpts?.noCountIn) return 0;
    const p0 = sc.perf.find(m => m.start <= R.a + 1e-9 && R.a < m.start + m.len), m0 = (p0 && sc.measures[p0.w]) || sc.measures[0];
    const compound = m0.bt === 8 && m0.beats % 3 === 0 && m0.beats > 3, bu = compound ? 1.5 : 4 / m0.bt, nb = compound ? m0.beats / 3 : m0.beats;
    const beatSec = bu * secPerQ(R.a);
    let bars = playOpts?.forceCountIn != null ? Number(playOpts.forceCountIn) : (Number(st.countIn) || 0);
    if ((st.pitches !== 'none' || playOpts?.recordingLine != null) && !bars) bars = 1;
    if (!first && !bars) return 0;
    for (let k = 0; k < bars * nb; k++) spClick(master, t0 + k * beatSec, k % nb === 0);
    if (playOpts?.recordingLine != null) {
      const recLi = playOpts.recordingLine;
      const firsts = spFirstNotes(sc, recLi, R);
      [...new Set(firsts)].forEach(mi => spPianoNote(master, t0, mi, nb * beatSec * 0.95, 0.6));
      countMeta = { t0, endT: t0 + bars * nb * beatSec, nb, beatSec, totalBeats: bars * nb, lineName: sc.lines[recLi]?.name || 'Voice', firstNote: firsts[0] != null ? grName(firsts[0]) : null };
    } else if (st.pitches !== 'none') {
      const firsts = [];
      sc.lines.forEach((L, li) => {
        if (L.acc && st.pitches !== 'all') return;
        if (st.pitches === 'mine' && (st.parts[li]?.on === false || (spFoc(st).length && !spFoc(st).includes(li)))) return;
        firsts.push(...spFirstNotes(sc, li, R));
      });
      [...new Set(firsts)].forEach(mi => spPianoNote(master, t0, mi, nb * beatSec * 0.95, 0.55));
    }
    return bars * nb * beatSec;
  };
  const leadSec = playOpts?.leadSec ?? 0.15;
  const t0 = c.currentTime + leadSec;
  const countDur = countIn(t0, true);
  const pass0StartT = t0 + countDur;
  const walker = { q: R.a, t: pass0StartT };
  ctl.marks = [{ t: c.currentTime, q: R.a, hold: true }, { t: walker.t, q: R.a }];
  if (playOpts?.recordingLine != null && SP_VREC.on) {
    SP_VREC.T0 = pass0StartT;
    SP_VREC.endT = pass0StartT + spTimeBetweenQ(sc, R.a, R.b, factorAt(0));
  }
  // Schedule sung-voice AudioBufferSourceNodes for a pass over [passStartBeat, passEndBeat] starting at passStartTime
  const scheduleVocalPass = (passStartBeat, passEndBeat, passStartTime, passIter) => {
    if (playOpts?.ignoreVocalRecs) return;
    spStopVocalNodes(ctl);
    const curFac = factorAt(passIter);
    sc.lines.forEach((_, li) => {
      if (playOpts?.recordingLine === li) return;
      if (playOpts?.recordingLine != null && st.recGuide === false) return;
      if (!spIsLineSung(ctl, li)) return;
      const rec = ctl.vocalRecs?.[li];
      if (!rec || !rec.audioBuffer) return;
      const segStartBeat = Math.max(passStartBeat, rec.startBeat ?? 0);
      const segEndBeat = Math.min(passEndBeat, rec.endBeat ?? sc.ptotal);
      if (segEndBeat <= segStartBeat + 1e-6) return;
      const currentBpm = spBpmAt(sc, segStartBeat) * curFac;
      const recBpm = rec.recordedBpm || 100;
      const playbackRate = Math.max(0.25, Math.min(4, currentBpm / recBpm));
      const delaySec = spTimeBetweenQ(sc, passStartBeat, segStartBeat, curFac);
      let whenSec = passStartTime + delaySec;
      let offsetSec = (segStartBeat - (rec.startBeat ?? 0)) * 60 / recBpm;
      let durBufSec = (segEndBeat - segStartBeat) * 60 / recBpm;
      if (whenSec < c.currentTime) {
        const lateWall = c.currentTime - whenSec;
        offsetSec += lateWall * playbackRate;
        durBufSec -= lateWall * playbackRate;
        whenSec = c.currentTime;
      }
      if (offsetSec < 0) {
        const earlyWall = -offsetSec / playbackRate;
        whenSec += earlyWall;
        durBufSec += offsetSec;
        offsetSec = 0;
      }
      if (durBufSec <= 0.01 || offsetSec >= rec.audioBuffer.duration - 0.01) return;
      durBufSec = Math.min(durBufSec, rec.audioBuffer.duration - offsetSec);
      const wallDur = durBufSec / playbackRate;
      const src = c.createBufferSource(), vg = c.createGain();
      src.buffer = rec.audioBuffer;
      src.playbackRate.setValueAtTime(playbackRate, whenSec);
      vg.gain.setValueAtTime(0.0001, whenSec);
      vg.gain.linearRampToValueAtTime(1, whenSec + Math.min(0.008, wallDur * 0.25));
      if (wallDur > 0.03) {
        vg.gain.setValueAtTime(1, whenSec + wallDur - 0.012);
        vg.gain.linearRampToValueAtTime(0.0001, whenSec + wallDur);
      }
      // Route directly through this voice part's existing GainNode (controlled by volume slider, mute, solo/focus)
      src.connect(vg).connect(ctl.gains[li]);
      src.start(whenSec, offsetSec, durBufSec);
      ctl.vocalNodes.push({ src, vg, li });
    });
  };
  scheduleVocalPass(R.a, R.b, pass0StartT, 0);
  const vocalSigOf = () => `${playOpts?.tempoPct || st.tempo}|${R.a}|${R.b}|${R.loop}|${sc.lines.map((_, i) => spIsLineSung(ctl, i) ? 1 : 0).join(',')}`;
  let lastVocalSig = vocalSigOf();
  // Estimate the current quarter-note beat at audio time `now` from ctl.marks
  const beatAtTime = nowT => {
    const M = ctl.marks;
    if (!M || !M.length) return R.a;
    let i = M.length - 1; while (i > 0 && M[i].t > nowT) i--;
    const a = M[i], b = M[i + 1];
    return a.hold || !b || b.jump ? a.q : a.q + (b.q - a.q) * Math.max(0, Math.min(1, (nowT - a.t) / ((b.t - a.t) || 1)));
  };
  // what happens at each position: notes, metronome beats, tempo changes
  const byQ = new Map(); const at = q => { const k = spKey(q); if (!byQ.has(k)) byQ.set(k, { q, evs: [], beat: null }); return byQ.get(k); };
  for (const e of sc.pevents) at(e.q).evs.push(e);
  for (const b of sc.pbeats) at(b.q).beat = b;
  for (const t of sc.ptempos) at(t.q);
  const stops = [...byQ.values()].sort((x, y) => x.q - y.q);
  const firstIdx = q => { let i = 0; while (i < stops.length && stops[i].q < q - 1e-9) i++; return i; };
  let si = firstIdx(R.a), ending = 0;
  const step = () => {
    const now = c.currentTime, horizon = now + 0.15;
    if (!playOpts?.range) {
      const nr = spRange(ctl);                                   // loop range / loop on-off can change while playing
      if (playOpts?.noLoop) nr.loop = false;
      if (nr.a !== R.a || nr.b !== R.b || nr.loop !== R.loop) {
        R = nr;
        if (walker.q < R.a - 1e-9 || walker.q >= R.b - 1e-9) { walker.q = R.a; ctl.marks.push({ t: walker.t, q: R.a, jump: true }); }
        si = firstIdx(walker.q);
      }
    }
    const curSig = vocalSigOf();
    if (curSig !== lastVocalSig) {
      lastVocalSig = curSig;
      const curQ = beatAtTime(now);
      if (curQ >= R.a - 1e-6 && curQ < R.b - 1e-6 && now >= pass0StartT - 1e-3) {
        scheduleVocalPass(curQ, R.b, now, iter);
      }
    }
    ctl.gains.forEach((g, i) => { const v = spLineVol(ctl, i); if (Math.abs(g.gain.value - v) > 1e-3) g.gain.setTargetAtTime(v, now, 0.03); });
    let guard = 0;
    while (walker.t < horizon && !ending && guard++ < 500) {
      const s = stops[si];
      if (s && s.q < R.b - 1e-9) {
        walker.t += (s.q - walker.q) * secPerQ(walker.q); walker.q = s.q; ctl.marks.push({ t: walker.t, q: s.q });
        const sp = secPerQ(s.q);
        for (const e of s.evs) {
          if (st.parts[e.line]?.on === false) continue;
          if (playOpts?.recordingLine != null) {
            if (e.line === playOpts.recordingLine) {
              if (!st.recSelfGuide) continue;
              const len = Math.min(e.q + e.dur, R.b) - e.q;
              spPianoNote(ctl.gains[e.line], Math.max(now, walker.t), e.midi, len * sp * 0.97, 0.22);
              continue;
            }
            if (st.recGuide === false) continue;
          }
          // Skip MIDI notes when this part is in Sung mode with a valid recording
          if (!playOpts?.ignoreVocalRecs && spIsLineSung(ctl, e.line)) continue;
          const len = Math.min(e.q + e.dur, R.b) - e.q;
          spPianoNote(ctl.gains[e.line], Math.max(now, walker.t), e.midi, len * sp * 0.97);
        }
        if (s.beat && st.metronome && !playOpts?.noMetro) spClick(master, Math.max(now, walker.t), s.beat.accent);
        si++;
      } else {
        walker.t += (R.b - walker.q) * secPerQ(walker.q); walker.q = R.b; ctl.marks.push({ t: walker.t, q: R.b });
        if (R.loop && !playOpts?.noLoop) {
          iter++; walker.q = R.a; si = firstIdx(R.a); ctl.iter = iter;
          ctl.marks.push({ t: walker.t, q: R.a, jump: true, hold: true });
          if (st.countEvery) { walker.t += countIn(walker.t, false); ctl.marks.push({ t: walker.t, q: R.a }); }   // count in again
          scheduleVocalPass(R.a, R.b, walker.t, iter);
        }
        else ending = walker.t;
      }
    }
    if (ctl.marks.length > 400) ctl.marks = ctl.marks.filter(m => m.t > now - 2).concat([]);
    if (ending && now > ending + 0.3) spStop();
  };
  step(); SP_PLAY.timer = setInterval(step, 25);
  const frame = () => {
    if (SP_PLAY.ctl !== ctl) return;
    const heard = spHeardTime(c);
    ctl.drawPlayhead(heard);
    if (countMeta && playOpts?.recordingLine != null) {
      if (heard < countMeta.endT) {
        const bi = Math.max(0, Math.floor((heard - countMeta.t0) / countMeta.beatSec + 1e-6));
        const bNum = (bi % countMeta.nb) + 1;
        ctl.showCountOverlay?.(String(bNum), `Sing <b>${esc(countMeta.lineName)}</b>${countMeta.firstNote ? ` · start on <b>${countMeta.firstNote}</b>` : ''}`, bNum === 1);
      } else {
        ctl.showRecOverlay?.(`Recording <b>${esc(countMeta.lineName)}</b>…`);
      }
    }
    SP_PLAY.raf = requestAnimationFrame(frame);
  };
  SP_PLAY.raf = requestAnimationFrame(frame);
  const q0 = 60 / spBpmAt(sc, R.a) / factorAt(0);
  return {
    when0: pass0StartT,
    q: q0,
    master,
    timeAt(pos) { return pass0StartT + pos * q0; },
  };
}

// ---------- Score Practice Looper Grading (Sight-Reading-equivalent grading on any voice part & measure range)
function spGradeLine(ctl) {
  const { sc, st } = ctl;
  if (!sc || !sc.lines.length) return 0;
  if (st.gradeLine != null && sc.lines[st.gradeLine]) return +st.gradeLine;
  const F = spFoc(st).filter(i => sc.lines[i]);
  if (F.length) {
    const fVocal = F.find(i => !sc.lines[i].acc);
    return fVocal != null ? fVocal : F[0];
  }
  const firstVocal = sc.lines.findIndex(L => !L.acc);
  return firstVocal >= 0 ? firstVocal : 0;
}
function spGradeRange(ctl) {
  const { sc, st } = ctl;
  if (!sc) return { a: 0, b: 0, loop: false };
  if (st.loop.on && sc.measures.length) return spRange(ctl);
  return { a: 0, b: sc.ptotal, loop: false };
}
function spExpectedNotes(ctl, lineIdx, R, shift = 0) {
  const { sc, st } = ctl;
  if (!sc) return [];
  const fac = (Number(st.tempo) || 100) / 100;
  const q0 = 60 / spBpmAt(sc, R.a) / fac;
  const raw = (sc.pevents || sc.events)
    .filter(e => e.line === lineIdx && e.q >= R.a - 1e-6 && e.q < R.b - 1e-6)
    .sort((a, b) => a.q - b.q || b.midi - a.midi);
  // Deduplicate simultaneous chord notes in the same voice line (keep highest note at each attack time)
  const dedup = [];
  for (const e of raw) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(e.q - prev.q) < 1e-3) continue;
    dedup.push(e);
  }
  const exp = [];
  let lastPm = -1, idxInBar = 0;
  for (const e of dedup) {
    const pm = e.pm ?? e.m;
    idxInBar = pm === lastPm ? idxInBar + 1 : 1;
    lastPm = pm;
    const tSec = spTimeBetweenQ(sc, R.a, e.q, fac);
    const endQ = Math.min(e.q + e.dur, R.b);
    const durSec = Math.max(0.04, spTimeBetweenQ(sc, e.q, endQ, fac));
    const perfM = sc.perf?.[pm];
    const dq = perfM ? (e.q - perfM.start) : (e.q - (sc.measures[e.m]?.start || 0));
    const barNum = Number(sc.measures[e.m]?.num) || (e.m + 1);
    exp.push({
      t: tSec / q0,
      len: durSec / q0,
      midi: e.midi == null ? null : e.midi + shift,
      writtenMidi: e.midi,
      bar: barNum,
      idx: idxInBar,
      m: e.m,
      pm,
      dq,
      pq: e.q,
      dur: e.dur,
      line: lineIdx,
    });
  }
  return exp;
}
async function spGradeStart(ctl, btn, inputOverride = null) {
  if (typeof GR === 'undefined') return toast('Grading engine not loaded.');
  if (GR.on) { grStop(true); return; }
  if (GR.starting) return;
  if (SP_VREC.on) spStopVocalRec(false);
  if (SP_PLAY.ctl) spStop();
  spHoldStop();
  const { sc, st, host } = ctl;
  if (!sc) return;
  const lineIdx = spGradeLine(ctl);
  const line = sc.lines[lineIdx];
  const R = spGradeRange(ctl);
  const shift = (typeof GR_VOICE_SHIFT !== 'undefined' ? GR_VOICE_SHIFT[st.gradeVoice || 'written'] : 0) || 0;
  const exp = spExpectedNotes(ctl, lineIdx, R, shift);
  if (!exp.length) return toast(`No notes found for ${line?.name || 'this part'} in the selected measure range.`);
  const mode = inputOverride || st.gradeMode || 'mic'; // 'mic' (pitch+rhythm), 'rhythm' (mic rhythm only), 'tap' (spacebar rhythm)
  const tap = mode === 'tap';
  const gradePitch = mode === 'mic';
  GR.starting = true;
  let mic = null, c0 = null;
  try {
    c0 = ac();
    await grResume(c0);
    if (c0.state !== 'running') return toast('Sound is not running yet. Press Grade again.');
    if (!tap) {
      try { mic = await grMic(); } catch (e) { return toast('Microphone not available: ' + e.message); }
      await grMicReady(mic, btn);
      await grResume(mic.c);
    }
  } finally { GR.starting = false; }
  await spPianoReady(sc.events.map(e => e.midi)).catch(() => {});
  const c = tap ? c0 : mic.c;
  document.getElementById('gr-card')?.remove();
  host.__grResult = null;
  ctl.drawGradeMarks?.();
  if (typeof srKeepAwake === 'function') srKeepAwake(c);
  GR.out = c.createGain();
  GR.out.connect(musicOut(c));

  const fac = (Number(st.tempo) || 100) / 100;
  const q0 = 60 / spBpmAt(sc, R.a) / fac;
  const p0 = sc.perf.find(m => m.start <= R.a + 1e-9 && R.a < m.start + m.len), m0 = (p0 && sc.measures[p0.w]) || sc.measures[0];
  const compound = m0.bt === 8 && m0.beats % 3 === 0 && m0.beats > 3, bu = compound ? 1.5 : 4 / m0.bt, nb = compound ? m0.beats / 3 : m0.beats;
  const beatSec = bu * q0;
  const bars = Math.max(1, Number(st.countIn) || 1), countBeats = bars * nb;
  const t0 = c.currentTime + 0.3;
  for (let b = 0; b < countBeats; b++) grClick(c, t0 + b * beatSec, b % nb === 0);
  const firstMidi = exp[0].midi;
  if (!tap && firstMidi != null) {
    grTone(c, t0, grCueMidi(firstMidi), bars * nb * beatSec * 0.92);
  }
  const T0 = t0 + countBeats * beatSec;
  const last = exp[exp.length - 1];
  const end = T0 + (last.t + last.len) * q0 + 0.8;
  // Schedule metronome clicks while performing if Metronome is active
  if (st.metronome) {
    for (const b of sc.pbeats) {
      if (b.q >= R.a - 1e-6 && b.q < R.b - 1e-6) {
        const dt = spTimeBetweenQ(sc, R.a, b.q, fac);
        grClick(c, T0 + dt, b.accent, 0.5);
      }
    }
  }
  // Optional quiet guide of other parts during grading (when st.gradeGuide is enabled)
  if (st.gradeGuide && !tap) {
    for (const e of sc.pevents) {
      if (e.line === lineIdx || st.parts[e.line]?.on === false) continue;
      if (e.q < R.a - 1e-6 || e.q >= R.b - 1e-6) continue;
      const dt = spTimeBetweenQ(sc, R.a, e.q, fac);
      const durSec = spTimeBetweenQ(sc, e.q, Math.min(e.q + e.dur, R.b), fac);
      grTone(c, T0 + dt, e.midi, Math.max(0.05, durSec * 0.9), 0.12);
    }
  }
  // Build playhead marks on clock `c` so the score playhead glides smoothly across the measures while grading
  const marks = [{ t: c.currentTime, q: R.a, hold: true }, { t: T0, q: R.a }];
  const stopQs = [...new Set(sc.pevents.filter(e => e.q >= R.a - 1e-6 && e.q <= R.b + 1e-6).map(e => e.q).concat([R.b]))].sort((a, b) => a - b);
  for (const sq of stopQs) marks.push({ t: T0 + spTimeBetweenQ(sc, R.a, sq, fac), q: sq });
  ctl.marks = marks;

  // Persist attempt history per (score, line, range)
  const histKey = `${st.fileId}|${lineIdx}|${R.a.toFixed(2)}-${R.b.toFixed(2)}`;
  ctl.grHistByKey ||= {};
  const tl = exp.map(e => ({ t: e.t, len: e.len, midi: e.midi, rest: false }));
  tl.grHist = (ctl.grHistByKey[histKey] ||= []);

  const mStartNum = sc.measures[st.loop.on ? Math.min(st.loop.a, st.loop.b) : 0]?.num || '1';
  const mEndNum = sc.measures[st.loop.on ? Math.max(st.loop.a, st.loop.b) : sc.measures.length - 1]?.num || String(sc.measures.length);
  const rangeLabel = mStartNum === mEndNum ? `m. ${mStartNum}` : `m. ${mStartNum}–${mEndNum}`;
  const effBpm = Math.round(spBpmAt(sc, R.a) * fac);
  const meta = {
    mode: gradePitch ? 'solfege' : 'rhythm',
    modeLabel: `${line?.name || 'Score'} (${rangeLabel})`,
    fileId: st.fileId,
    lineIdx,
    range: R,
    settings: { ts: `${m0.beats}/${m0.bt}`, tempo: st.tempo, effBpm, gradeVoice: st.gradeVoice || 'written', countIn: bars, metronome: !!st.metronome },
    beatSec, countBeats, t0, avDelay: avDelayMs(),
  };
  let lat = null;
  try {
    const outLat = Math.max(0, c.currentTime - spHeardRaw(c));
    lat = outLat + spAvDelay();
    if (!isFinite(lat)) lat = null;
  } catch { lat = null; }

  const rec = tap ? null : { sr: c.sampleRate, chunks: [], marks: [], n: 0 };
  const idleHTML = btn ? btn.innerHTML : null;
  let gradeRaf = 0;
  const onFinish = () => {
    cancelAnimationFrame(gradeRaf);
    ctl.hideCountOverlay?.();
    ctl.hidePlayhead?.();
    ctl.updateBar?.();
  };
  Object.assign(GR, {
    on: true,
    input: tap ? 'tap' : 'mic',
    c,
    taps: tap ? [] : null,
    an: tap ? null : mic.an,
    rec,
    meta,
    buf: new Float32Array(2048),
    poll: 0,
    frames: [],
    host,
    exp,
    q: q0,
    T0,
    end,
    btn,
    idleHTML,
    onFinish,
    lat,
    gradePitch,
    tl,
    retry: () => spGradeStart(ctl, btn, mode),
  });
  if (btn) {
    btn.innerHTML = IC('ico:stop') + (tap ? ' Stop (tapping)' : ' Stop & grade');
    btn.classList.add('on');
  }
  if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();

  const startNoteLbl = firstMidi != null ? grName(firstMidi) : null;
  const animFrame = () => {
    if (!GR.on || GR.host !== host) return;
    const heard = spHeardTime(c);
    ctl.drawPlayhead(heard);
    if (heard < T0) {
      const bi = Math.max(0, Math.floor((heard - t0) / beatSec + 1e-6));
      const bNum = (bi % nb) + 1;
      ctl.showCountOverlay?.(String(bNum), `Grade <b>${esc(line?.name || 'Part')}</b> (${rangeLabel})${!tap && startNoteLbl ? ` · start on <b>${startNoteLbl}</b>` : tap ? ' · tap Space on each note' : ''}`, bNum === 1);
    } else {
      ctl.hideCountOverlay?.();
    }
    gradeRaf = requestAnimationFrame(animFrame);
  };
  gradeRaf = requestAnimationFrame(animFrame);

  GR.timer = setInterval(() => {
    const now = c.currentTime;
    if (tap) { if (now > GR.end) grStop(true); return; }
    const { an, buf } = GR; if (!an) return;
    if (now > GR.end) { grStop(true); return; }
    an.getFloatTimeDomainData(buf);
    const W = Math.min(buf.length, Math.round(c.sampleRate * 0.02));
    let s = 0; for (let i = buf.length - W; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / W);
    const f = (GR.poll++ % 4 === 0) ? muDetectPitch(buf, c.sampleRate, GR_MIN_RMS, GR_PITCH_OPTS).f : -1;
    GR.frames.push({ t: now, rms, f });
  }, 10);
}
function spListenGrade(ctl, tempo, opts) {
  const G = ctl.host?.__grResult;
  if (!ctl.sc || !G) return null;
  const R = G.range || spGradeRange(ctl);
  return spPlay(ctl, {
    range: R,
    tempoPct: tempo || ctl.st.tempo || 100,
    noCountIn: true,
    leadSec: 0.35,
    noMetro: !!opts?.noMetro,
    noLoop: true,
    ignoreVocalRecs: true,
  });
}

// ---------- UI
function spApplyAll() { Object.values(SP_CACHE).forEach(c => c.root?.isConnected && c.applyCtl?.()); }
// Score practice bar: the same movable bar and standard order as sight reading
// (what's on the page → playing it → what's written on the music → tools)
const SP_BARCFG = { key: 'spBar', ctl: true, defaults: ['file', 'play', 'tempo', 'metronome', 'loop', 'range', 'spots', 'grade', 'voices', 'nums', 'solfege', 'counts', 'layout', 'gap', 'tabs', 'zoom', 'settings'], groups: ['play', 'nums', 'grade'], breaks: ['nums'] };
const SP_CACHE = {};
function mountScore(host, st, onChange0, key) {
  spInjectVoiceGradeCSS();
  spDefaults(st);
  // every change is also remembered per score, so reopening or switching back restores it
  const onChange = () => { try { (S.scoreSettings ||= {})[st.fileId] = JSON.parse(JSON.stringify(st)); } catch { } onChange0 && onChange0(); };
  const ck = key || st.fileId;
  const cached = SP_CACHE[ck];
  if (cached && cached.st === st && cached.root) {             // re-attach the already-drawn score
    host.innerHTML = ''; host.appendChild(cached.root); cached.host = host;
    host.__grRedraw = () => cached.drawGradeMarks?.();
    host.__listen = (tempo, opts) => spListenGrade(cached, tempo, opts);
    host.__listenStop = () => spStop();
    cached.relayout(); cached.fillFiles?.(); return cached;
  }
  if (cached && SP_PLAY.ctl === cached) spStop();
  const root = document.createElement('div'); root.className = 'sp-root';
  const BAR = {
    file: () => `<span class="sp-grp" data-ctl="file"><select class="sp-file" data-spk="file" title="Switch score"></select><button data-sp="addscore" title="Add a score file (MusicXML / MuseScore)" aria-label="Add a score file">${IC('ico:plus')}</button></span>`,
    play: () => `<button data-sp="play" data-ctl="play" class="sp-primary">${IC('ico:play')} Play</button>`,
    tempo: () => `<span class="sp-step" data-ctl="tempo" title="Tempo (beats per minute)"><button data-sp="tempo-step" data-d="-5" title="Slower" aria-label="Slower">${IC('ico:minus')}</button><output class="sp-bpm"></output><button data-sp="tempo-step" data-d="5" title="Faster" aria-label="Faster">${IC('ico:plus')}</button></span>`,
    metronome: () => `<button data-sp="metro" data-ctl="metronome" title="Metronome clicks while playing">${IC('ico:metro')} Metronome</button>`,
    loop: () => `<button data-sp="loop" data-ctl="loop" title="Loop the selected measures (click or drag on the music to choose them)">${IC('ico:repeat')} <span class="sp-looplbl">Loop</span></button>`,
    range: () => `<span class="sp-range" data-ctl="range">m. <input type="number" min="1" data-spk="from" title="First measure"> – <input type="number" min="1" data-spk="to" title="Last measure"></span>`,
    spots: () => `<button data-sp="spots" data-ctl="spots" title="Rehearsal list: saved spots to step through">${IC('ico:agenda')} Spots</button>`,
    grade: () => `<span class="sp-grp sp-grade-ctl" data-ctl="grade"><button data-sp="grade" title="Grade your performance of the selected voice part over the active loop (or full score)">${IC('ico:mic')} <span class="sp-grlbl">Grade</span></button><button data-sp="grade-menu" title="Choose which voice part to grade and grading mode" aria-label="Grading options">▾</button></span>`,
    voices: () => `<button data-sp="voices" data-ctl="voices" title="Voice parts mixer: per-part volume, Focus/Solo, Record sung voice (🎤 Rec), and Sung vs MIDI toggle">${IC('ico:users')} <span class="sp-voicelbl">Voices</span></button>`,
    nums: () => `<button data-sp="nums" data-ctl="nums" title="Number every measure">${IC('ico:hash')} Measure #</button>`,
    solfege: () => `<button data-sp="lbl" data-v="solfege" data-ctl="solfege" title="Solfege syllables above the notes (movable do)">${IC('ico:music')} Solfege</button>`,
    counts: () => `<button data-sp="lbl" data-v="counts" data-ctl="counts" title="Rhythm counting above the notes">${IC('ico:list')} Counts</button>`,
    layout: () => `<button data-sp="layout" data-ctl="layout" title="Switch between scrolling down the page and one long line scrolling sideways"></button>`,
    tabs: () => `<button data-sp="tabs" data-ctl="tabs" title="Keep a Scores tab on the class screen of the classes you choose">${IC('ico:layers')} Classes</button>`,
    zoom: () => `<span class="sp-zoom" data-ctl="zoom"><button data-sp="zoom" data-d="-0.1" title="Smaller">${IC('ico:minus')}</button><button type="button" class="tb-zpct" data-sp="zoom-reset" title="Reset zoom to 100%">100%</button><button data-sp="zoom" data-d="0.1" title="Bigger">${IC('ico:plus')}</button></span>`,
    settings: () => `<button data-sp="settings" title="Settings: count-in, voices, speed-up, and which buttons show here">${IC('ico:sliders')} Settings</button>`,
  };
  const spBarHTML = () => `<div class="sp-top">
      ${BAR.file()}<span class="tb-div" aria-hidden="true"></span>${BAR.play()}${BAR.tempo()}${BAR.metronome()}${BAR.loop()}${BAR.range()}${BAR.spots()}${BAR.grade()}${typeof GR_RECENT !== 'undefined' && GR_RECENT.length ? `<button data-sp="grrecent" title="View recent grading attempts">${IC('ico:agenda')} Recent (${GR_RECENT.length})</button>` : ''}${BAR.voices()}
      <span class="sr-sp"></span>
      ${BAR.tabs()}${BAR.settings()}
    </div>
    <div class="sp-sub">
      <span class="tb-lbl" data-subgrp="show">Show</span>${BAR.nums()}${BAR.solfege()}${BAR.counts()}
      <span class="tb-div" data-subgrp="layout" aria-hidden="true"></span>
      <span class="tb-lbl" data-subgrp="layout">Layout</span>${BAR.layout()}
      <span class="sr-sp"></span>
      <span class="tb-lbl" data-subgrp="zoom">Zoom</span>${BAR.zoom()}
    </div>`;
  root.innerHTML = `${spBarHTML()}
    <div class="sp-custom" hidden></div>
    <div class="sp-tabs sp-custom" hidden></div>
    <div class="sp-spots" hidden></div>
    <div class="sp-voices" hidden></div>
    <div class="sp-choir" hidden></div>
    <div class="sp-settings" hidden></div>
    <div class="sp-hint"></div>
    <div class="sp-score"><div class="sp-osmd"></div><div class="sp-ov"><div class="sp-sel"></div><div class="sp-lbls"></div><div class="sp-grov"></div><div class="sp-ph" hidden></div></div></div>`;
  host.innerHTML = ''; host.appendChild(root);
  const $q = s => root.querySelector(s);
  const ctl = { st, host, root, sc: null, osmd: null, playing: false, marks: [], startAt: 0, iter: 0, pick: null, vocalRecs: {}, vocalNodes: [], onChange };
  SP_CACHE[ck] = ctl;
  host.__grRedraw = () => ctl.drawGradeMarks?.();
  host.__listen = (tempo, opts) => spListenGrade(ctl, tempo, opts);
  host.__listenStop = () => spStop();
  const status = msg => { $q('.sp-hint').textContent = msg || ''; };
  const mNum = i => ctl.sc?.measures[i]?.num ?? String(i + 1);
  const mIdx = txt => { const M = ctl.sc?.measures || []; const i = M.findIndex(m => m.num === String(txt).trim()); return i >= 0 ? i : Math.max(0, Math.min(M.length - 1, (parseInt(txt) || 1) - 1)); };
  const SP_CTLS = [
    ['Top bar', [['file', 'Score list'], ['play', 'Play'], ['tempo', 'Tempo'], ['metronome', 'Metronome'], ['loop', 'Loop'], ['range', 'Measure range boxes'], ['spots', 'Spots'], ['grade', 'Grade'], ['voices', 'Voices & vocal recording'], ['tabs', 'Classes (tab)']]],
    ['Display strip', [['nums', 'Measure #'], ['solfege', 'Solfege'], ['counts', 'Counts'], ['layout', 'Down / Sideways'], ['zoom', 'Zoom − ＋']]],
    ['Choir row', [['focus', 'Focus buttons'], ['pitches', 'Starting pitch buttons'], ['colour', 'Colour parts'], ['show', 'Show (staves)']]],
    ['Settings', [['countin', 'Count-in'], ['countevery', 'Count in every repeat'], ['startpitch', 'Starting pitches'], ['solminor', 'Minor: do- / la-based'], ['speedup', 'Speed up each repeat'], ['mixer', 'Parts & volumes'], ['sync', 'Sound / playhead sync'], ['help', 'Help text']]],
  ];
  const SP_DEFAULT_HIDDEN = ['help', 'range'];
  ctl.applyCtl = () => {
    const hid = new Set(S.settings.spHidden ?? SP_DEFAULT_HIDDEN);
    root.querySelectorAll('[data-ctl]').forEach(el => { el.hidden = hid.has(el.dataset.ctl); });
    const ch = $q('.sp-choir');                                      // hide the choir row if everything in it is hidden
    if (ch && ctl.sc) ch.classList.toggle('sp-empty', ['focus', 'pitches', 'colour', 'show'].every(k => hid.has(k)));
    const sub = $q('.sp-sub');
    if (sub) {
      const showHid = ['nums', 'solfege', 'counts'].every(k => hid.has(k));
      const layHid = hid.has('layout');
      const zoomHid = hid.has('zoom');
      sub.querySelectorAll('[data-subgrp="show"]').forEach(el => { el.hidden = showHid; });
      sub.querySelectorAll('[data-subgrp="layout"]').forEach(el => { el.hidden = layHid; });
      sub.querySelectorAll('[data-subgrp="zoom"]').forEach(el => { el.hidden = zoomHid; });
      sub.hidden = showHid && layHid && zoomHid;
    }
  };
  ctl.rebuildBar = () => {
    ctl.fillFiles?.(); ctl.updateBar?.(); ctl.applyCtl();
  };
  // Zoom the music around the pointer: pinch (trackpad, iPad) or ⌘ / Ctrl + scroll. Two-finger scroll moves around it.
  // While the fingers move, the drawn music is scaled; when they pause it is redrawn sharp at the new size.
  ctl.zoomBy = (f, cx, cy) => {
    const sc = $q('.sp-score'), layers = [$q('.sp-osmd'), $q('.sp-ov')]; if (!ctl.osmd || !sc) return;
    const z0 = ctl.zPending ?? st.zoom, z = Math.max(0.3, Math.min(2.5, z0 * f)); if (Math.abs(z - z0) < 1e-3) return;
    ctl.zPending = z;
    const r = sc.getBoundingClientRect();
    ctl.zAnchor ||= { px: cx - r.left, py: cy - r.top, sx: sc.scrollLeft, sy: sc.scrollTop, z0: st.zoom };
    const a = ctl.zAnchor;
    layers.forEach(el => { if (!el) return; el.style.transformOrigin = `${a.sx + a.px}px ${a.sy + a.py}px`; el.style.transform = `scale(${z / a.z0})`; });
    clearTimeout(ctl.zT);
    ctl.zT = setTimeout(() => {
      const A = ctl.zAnchor, zz = ctl.zPending; ctl.zAnchor = ctl.zPending = null;
      layers.forEach(el => { if (el) el.style.transform = ''; });
      st.zoom = +zz.toFixed(2); ctl.updateBar(); onChange(); ctl.osmd.zoom = st.zoom; ctl.lastW = 0; ctl.relayout();
      const k = st.zoom / A.z0;                                        // keep the spot under the fingers where it was
      sc.scrollLeft = (A.sx + A.px) * k - A.px; sc.scrollTop = (A.sy + A.py) * k - A.py;
    }, 220);
  };
  root.__zoomBy = ctl.zoomBy;                                          // the Mac app's trackpad pinch (app.js → __pinch)
  root.__zoomToggle = () => { st.zoom = Math.abs((st.zoom || 1) - 1) > 0.03 ? 1 : 1.3; ctl.updateBar(); onChange(); if (ctl.osmd) { ctl.osmd.zoom = st.zoom; ctl.lastW = 0; ctl.relayout(); } };
  { const sc = $q('.sp-score');
    sc.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); ctl.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); }, { passive: false });
    let gs = 1;                                                        // Safari / iPad pinch
    sc.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
    sc.addEventListener('gesturechange', e => { e.preventDefault(); ctl.zoomBy(e.scale / gs, e.clientX, e.clientY); gs = e.scale; });
    sc.addEventListener('gestureend', e => e.preventDefault()); }
  // which classes always have a Scores tab
  ctl.drawTabs = () => {
    const box = $q('.sp-tabs'); if (box.hidden) return;
    box.innerHTML = `<div class="sp-spots-head"><b>${IC('ico:layers')} Scores tab in these classes</b><span class="sp-sp"></span><button data-sp="tabs" class="sp-primary">Done</button></div>
      <div class="sp-cust-cols"><div>${S.classes.map(c => `<label class="srchk"><input type="checkbox" data-tabcls="${c.id}" ${c.resources.some(r => r.scoreTab) ? 'checked' : ''}> ${esc(c.name)}${c.subtitle ? ` <span class="sp-note">${esc(c.subtitle)}</span>` : ''}</label>`).join('')}</div></div>
      <div class="sp-note">Each ticked class gets a ${IC('ico:score')} Scores tab on its class screen. It opens to the last score used there; switch scores with the list at the top.</div>`;
  };
  ctl.drawCustom = () => {
    const box = $q('.sp-custom'); if (box.hidden) return;
    const hid = new Set(S.settings.spHidden ?? SP_DEFAULT_HIDDEN);
    box.innerHTML = `<div class="sp-spots-head"><b>${IC('ico:eye')} Buttons to show</b><span class="sp-sp"></span><button data-sp="custom-all">Show all</button><button data-sp="custom" class="sp-primary">Done</button></div>
      <div class="sp-cust-cols">${SP_CTLS.map(([h, items]) => `<div><div class="sp-lbl">${h}</div>${items.map(([k, l]) => `<label class="srchk"><input type="checkbox" data-ctlbox="${k}" ${hid.has(k) ? '' : 'checked'}> ${l}</label>`).join('')}</div>`).join('')}</div>
      <div class="sp-note">Applies to every score. Settings always stays.</div>`;
  };
  const short = n => n.length > 14 ? n.slice(0, 13) + '…' : n;
  // ----- score list: switch scores inside this widget; each score keeps its own loop, spots, focus, tempo
  ctl.fillFiles = () => {
    const sel = $q('.sp-file'), lib = spLibrary();
    if (st.fileId && !lib.some(x => x.id === st.fileId) && S.files[st.fileId]) lib.unshift({ id: st.fileId, name: (S.files[st.fileId].name || 'Score').replace(/\.(mxl|musicxml|xml|mscz|mscx)$/i, '') });
    sel.innerHTML = lib.map(x => `<option value="${x.id}" ${x.id === st.fileId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
      + (lib.length > 1 ? '<option value="__remove">Remove this score from the list</option>' : '');
  };
  ctl.switchTo = id => {
    if (!id || id === st.fileId) return;
    if (typeof GR !== 'undefined' && GR.on && typeof grStop === 'function') grStop(false);
    if (SP_VREC.on && SP_VREC.ctl === ctl) spStopVocalRec(false);
    if (SP_PLAY.ctl === ctl) spStop();
    spHoldStop();
    (S.scoreSettings ||= {})[st.fileId] = JSON.parse(JSON.stringify(st));
    const saved = S.scoreSettings[id];
    for (const k of Object.keys(st)) delete st[k];
    Object.assign(st, saved ? JSON.parse(JSON.stringify(saved)) : { fileId: id, name: S.files[id]?.name });
    S.settings.lastScore = id; onChange();
    delete SP_CACHE[ck];
    mountScore(ctl.host, st, onChange0, key);              // the player on screen now (it may have moved since it was first opened)
    if (typeof WIN !== 'undefined') WIN.sig = '';               // window title follows
  };
  ctl.addScore = async () => {
    const fs = await pickFile('.mxl,.musicxml,.xml,.mscz,.mscx', true); if (!fs.length) return;
    let last = null;
    for (const f of fs) { if (!spIsScoreName(f.name)) continue; last = await storeFile(f); }
    save(); if (last) ctl.switchTo(last);
  };
  ctl.removeScore = () => {
    const lib = spLibrary(), cur = st.fileId, other = lib.find(x => x.id !== cur);
    if (!other || !confirm('Remove this score from the list? (Pinned tabs that use it keep working.)')) return;
    if (S.files[cur]) S.files[cur].hiddenScore = true;
    ctl.switchTo(other.id);
  };
  ctl.partMixerHTML = (compact = false) => {
    const sc = ctl.sc; if (!sc) return '';
    return sc.lines.map((p, i) => {
      const rec = ctl.vocalRecs?.[i], hasRec = !!(rec && rec.audioBuffer);
      const srcMode = hasRec ? (st.parts[i]?.source ?? 'sung') : 'midi';
      const isRecThis = SP_VREC.on && SP_VREC.ctl === ctl && SP_VREC.lineIdx === i;
      const isFoc = spFoc(st).includes(i);
      const on = st.parts[i]?.on !== false;
      const vol = st.parts[i]?.vol ?? 1;
      const recRangeLbl = hasRec
        ? `${rec.startMeasure === rec.endMeasure ? 'm.' + mNum(rec.startMeasure) : 'm.' + mNum(rec.startMeasure) + '–' + mNum(rec.endMeasure)} · ${Math.round(rec.recordedBpm)} BPM`
        : '';
      return `<div class="sp-part ${srcMode === 'sung' ? 'is-sung' : ''} ${isRecThis ? 'is-rec' : ''}" data-partrow="${i}">
        <label class="sp-part-lbl" title="Mute / unmute ${esc(p.name)}">
          <input type="checkbox" data-sppart="${i}" ${on ? 'checked' : ''}>
          ${p.acc ? IC('ico:score') : `<i class="sp-dot" style="background:${ctl.lineColor(i)}"></i>`}
          <span>${esc(compact ? short(p.name) : p.name)}</span>
        </label>
        <input type="range" min="0" max="1.5" step="0.05" data-spvol="${i}" value="${vol}" title="Volume for ${esc(p.name)} (${Math.round(vol * 100)}%)">
        <button type="button" class="sp-vfoc-btn ${isFoc ? 'on' : ''}" data-sp="focus" data-i="${i}" title="Focus / Solo ${esc(p.name)}: focused parts play louder, others softer">Solo</button>
        <button type="button" class="sp-vrec-btn ${isRecThis ? 'rec-on' : ''}" data-sp="vrec" data-line="${i}" title="${isRecThis ? 'Stop recording ' + esc(p.name) : (hasRec ? 'Re-record ' : 'Record ') + 'your sung voice for ' + esc(p.name) + ' over the active loop/range'}">${isRecThis ? '⏹ Stop' : '🎤 Rec'}</button>
        <span class="sp-vsrc-seg" role="group" aria-label="Audio source for ${esc(p.name)}">
          <button type="button" data-sp="vsrc" data-line="${i}" data-src="sung" class="${srcMode === 'sung' ? 'on' : ''}" ${hasRec ? '' : 'disabled'} title="${hasRec ? 'Play recorded Sung voice for ' + esc(p.name) + ' (' + esc(recRangeLbl) + ')' : 'Record a vocal take (🎤 Rec) first to enable Sung mode'}">Sung</button>
          <button type="button" data-sp="vsrc" data-line="${i}" data-src="midi" class="${srcMode === 'midi' ? 'on' : ''}" title="Play MIDI piano notes for ${esc(p.name)}">MIDI</button>
        </span>
        ${hasRec ? `<span class="sp-vmeta" title="Recorded range &amp; tempo">${esc(recRangeLbl)}</span><button type="button" class="sp-vdel-btn" data-sp="vdel" data-line="${i}" title="Delete sung recording for ${esc(p.name)} and revert to MIDI">🗑</button>` : ''}
      </div>`;
    }).join('');
  };
  ctl.drawVoices = () => {
    const box = $q('.sp-voices'), sc = ctl.sc;
    if (!box || !sc) return;
    box.hidden = !st.voicesOpen;
    if (box.hidden) return;
    box.innerHTML = `<span class="sp-voices-head">${IC('ico:users')} Voices</span>
      <button type="button" class="sp-vfoc-btn ${!spFoc(st).length ? 'on' : ''}" data-sp="focus" data-i="" title="Reset Focus so all active parts play at normal volume">All</button>
      <div class="sp-parts">${ctl.partMixerHTML(true)}</div>
      <span class="sp-vopts">
        <label title="Play the other active parts while recording a vocal part so you stay in time and tune"><input type="checkbox" data-spk="recGuide" ${st.recGuide !== false ? 'checked' : ''}> Guide parts</label>
        <label title="Also play a quiet piano guide of the part being recorded"><input type="checkbox" data-spk="recSelfGuide" ${st.recSelfGuide ? 'checked' : ''}> Self-guide</label>
      </span>`;
  };
  ctl.refreshVoicesUI = () => {
    ctl.drawVoices();
    ctl.drawChoir();
    const s = $q('.sp-settings');
    if (s && !s.hidden) s.innerHTML = settingsHTML();
    ctl.updateBar();
    ctl.paint();
  };
  ctl.showCountOverlay = (beatStr, cueHTML, isOne) => {
    const scEl = $q('.sp-score'); if (!scEl) return;
    let cnt = scEl.querySelector('.sp-count');
    if (!cnt || cnt.classList.contains('rec-live')) {
      cnt?.remove();
      cnt = document.createElement('div');
      cnt.className = 'sp-count';
      scEl.prepend(cnt);
    }
    if (cnt.dataset.n !== beatStr) {
      cnt.dataset.n = beatStr;
      cnt.innerHTML = `<div class="sp-count-n">${esc(beatStr)}</div>${cueHTML ? `<div class="sp-count-cue">${cueHTML}</div>` : ''}`;
      cnt.classList.toggle('one', !!isOne);
    }
  };
  ctl.showRecOverlay = html => {
    const scEl = $q('.sp-score'); if (!scEl) return;
    let cnt = scEl.querySelector('.sp-count');
    if (!cnt || !cnt.classList.contains('rec-live')) {
      cnt?.remove();
      cnt = document.createElement('div');
      cnt.className = 'sp-count rec-live';
      scEl.prepend(cnt);
    }
    const want = `<i class="sp-rec-dot"></i><span class="sp-count-cue">${html}</span>`;
    if (cnt.innerHTML !== want) cnt.innerHTML = want;
  };
  ctl.hideCountOverlay = () => { $q('.sp-score .sp-count')?.remove(); };

  ctl.closeGradeMenu = () => {
    root.querySelector('.sp-grmenu')?.remove();
    if (ctl.__grMenuAway) document.removeEventListener('pointerdown', ctl.__grMenuAway, true);
  };
  ctl.openGradeMenu = btn => {
    ctl.closeGradeMenu();
    const sc = ctl.sc; if (!sc) return;
    const curLi = spGradeLine(ctl);
    const curName = sc.lines[curLi]?.name || 'Selected part';
    const curMode = st.gradeMode || 'mic';
    const voices = typeof GR_VOICES !== 'undefined' ? GR_VOICES : [['written', 'Soprano / alto (as written)'], ['tenor', 'Tenor (1 octave lower)'], ['bass', 'Bass (1 octave lower)'], ['lowbass', 'Low bass (2 octaves lower)']];
    const r = btn.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'sp-grmenu';
    m.innerHTML = `
      <div class="sp-grm-sec">Voice / Part to grade</div>
      <select data-spk="gradeLine">${sc.lines.map((L, i) => `<option value="${i}" ${i === curLi ? 'selected' : ''}>${esc(L.name)}${L.acc ? ' (Accomp.)' : ''}</option>`).join('')}</select>
      <div class="sp-grm-sec">Voice / Octave shift</div>
      <select data-spk="gradeVoice">${voices.map(([v, l]) => `<option value="${v}" ${(st.gradeVoice || 'written') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label class="sp-grm-chk"><input type="checkbox" data-spk="gradeGuide" ${st.gradeGuide ? 'checked' : ''}> Play other parts softly while grading</label>
      <div class="sp-grm-sec">Start Grading</div>
      <button type="button" class="sp-grm-btn ${curMode === 'mic' ? 'last' : ''}" data-sp="gradego" data-v="mic">${IC('ico:mic')}<span><b>Microphone (Pitch &amp; Rhythm)</b><small>Sing ${esc(curName)} into the mic</small></span></button>
      <button type="button" class="sp-grm-btn ${curMode === 'rhythm' ? 'last' : ''}" data-sp="gradego" data-v="rhythm">${IC('ico:hand')}<span><b>Microphone (Rhythm only)</b><small>Clap or sing rhythm only</small></span></button>
      <button type="button" class="sp-grm-btn ${curMode === 'tap' ? 'last' : ''}" data-sp="gradego" data-v="tap">${IC('ico:keyboard')}<span><b>Space bar (Tap rhythm)</b><small>Tap each note on the Space bar</small></span></button>`;
    Object.assign(m.style, { left: Math.max(8, Math.min(r.left, innerWidth - 320)) + 'px', top: r.bottom + 6 + 'px' });
    root.appendChild(m);
    ctl.__grMenuAway = ev => { if (!m.contains(ev.target) && !btn.contains(ev.target)) ctl.closeGradeMenu(); };
    document.addEventListener('pointerdown', ctl.__grMenuAway, true);
  };

  ctl.drawGradeMarks = () => {
    const grov = $q('.sp-grov'), scEl = $q('.sp-score');
    if (grov) grov.innerHTML = '';
    scEl?.querySelectorAll('.gr-chips').forEach(x => x.remove());
    const markCls = typeof GR_MARK_CLS !== 'undefined' ? GR_MARK_CLS : ['gr-n-ok', 'gr-n-timing', 'gr-n-missed', 'gr-n-pitch'];
    root.querySelectorAll(markCls.map(c => '.' + c).join(',')).forEach(x => x.classList.remove(...markCls));
    const G = host.__grResult;
    if (!G || !ctl.sc || !ctl.osmd) return;
    if (G.fileId && G.fileId !== st.fileId) {
      if (!(typeof GR !== 'undefined' && GR.on)) host.__grResult = null;
      return;
    }
    // Floating action chips at top-right of the score: Report, Listen back, Retry, Show/Hide marks, Exit Grade
    const chips = document.createElement('div');
    chips.className = 'gr-chips gr-marks-chip-row';
    const rep = document.createElement('button');
    rep.className = 'gr-marks-chip'; rep.dataset.grchip = '1';
    rep.innerHTML = `${IC('ico:agenda')} Report`;
    rep.title = 'Reopen the grading report for this take';
    rep.onclick = e => { e.stopPropagation(); if (typeof grShowCard === 'function') grShowCard(G.res, !!G.gradePitch, G.hist || [], host); };
    chips.appendChild(rep);

    if (G.take && G.res?.diag?.heard > 0 && typeof grListen === 'function') {
      const lb = document.createElement('button');
      lb.className = 'gr-marks-chip gr-listen'; lb.dataset.grchip = '1';
      const playing = !!(typeof GR !== 'undefined' && GR.listenNodes?.length);
      lb.innerHTML = playing ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Listen back';
      if (playing) { lb.classList.add('on'); lb.dataset.idle = IC('ico:play') + ' Listen back'; }
      lb.onclick = e => { e.stopPropagation(); grListen(host, document.querySelector('#gr-card .gr-mix')?.value || 'both', lb); };
      chips.appendChild(lb);
    }

    const retryBtn = document.createElement('button');
    retryBtn.className = 'gr-marks-chip'; retryBtn.dataset.grchip = '1';
    retryBtn.innerHTML = `${IC('ico:mic')} Retry`;
    retryBtn.title = 'Record and grade another take';
    retryBtn.onclick = e => {
      e.stopPropagation();
      if (typeof grStopListen === 'function') grStopListen();
      spStop();
      document.getElementById('gr-card')?.remove();
      const fn = G.retry || (typeof GR !== 'undefined' && GR.retry);
      if (fn) fn(); else spGradeStart(ctl, $q('[data-sp="grade"]'));
    };
    chips.appendChild(retryBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'gr-marks-chip'; toggleBtn.dataset.grchip = '1';
    toggleBtn.innerHTML = G.hidden ? 'Show marks' : 'Hide marks';
    toggleBtn.onclick = e => {
      e.stopPropagation();
      G.hidden = !G.hidden;
      ctl.drawGradeMarks();
      const mk = document.querySelector('#gr-card .gr-marks');
      if (mk) mk.textContent = G.hidden ? 'Show marks' : 'Hide marks';
    };
    chips.appendChild(toggleBtn);

    const exitBtn = document.createElement('button');
    exitBtn.className = 'gr-marks-chip'; exitBtn.dataset.grchip = '1';
    exitBtn.innerHTML = `${IC('ico:close')} Exit Grade`;
    exitBtn.title = 'Clear grading marks from the score and close the report';
    exitBtn.onclick = e => {
      e.stopPropagation();
      if (typeof grStopListen === 'function') grStopListen();
      spStop();
      host.__grResult = null;
      document.getElementById('gr-card')?.remove();
      ctl.drawGradeMarks();
    };
    chips.appendChild(exitBtn);
    scEl?.prepend(chips);

    if (G.hidden || !grov) return;
    const svg = $q('.sp-osmd svg'); if (!svg) return;
    const ov = $q('.sp-ov').getBoundingClientRect(), sr = svg.getBoundingClientRect();
    const bx = sr.left - ov.left, by = sr.top - ov.top, u = U();
    const insts = ctl.osmd.Sheet?.Instruments || [], ML = ctl.osmd.GraphicSheet?.MeasureList || [];
    const NS = 'http://www.w3.org/2000/svg';
    const osvg = document.createElementNS(NS, 'svg');
    osvg.setAttribute('width', Math.max(10, Math.ceil(sr.width + bx + 40)));
    osvg.setAttribute('height', Math.max(10, Math.ceil(sr.height + by + 40)));
    const mk = (tag, a) => { const el = document.createElementNS(NS, tag); for (const k in a) el.setAttribute(k, a[k]); osvg.appendChild(el); return el; };

    const res = G.res, exp = G.exp || [];
    const targetPart = ctl.sc.lines[G.lineIdx ?? spGradeLine(ctl)]?.part ?? 0;
    const drawnMeasures = new Set();

    res.notes.forEach((n, i) => {
      const e = exp[i]; if (!e) return;
      const pitchBad = n.pitch && n.pitch !== 'ok';
      const cls = !n.match ? 'missed' : pitchBad ? 'pitch' : n.status === 'timing' ? 'timing' : 'ok';
      const staffs = ML[e.m] || [];
      let noteX = null, noteY = null, laneY = null;
      for (const gm of staffs) {
        if (!gm || gm.ParentStaff?.ParentInstrument?.Visible === false) continue;
        const pi = insts.indexOf(gm.ParentStaff?.ParentInstrument);
        for (const se of gm.staffEntries || []) {
          const tq = (se.relInMeasureTimestamp?.RealValue ?? NaN) * 4;
          if (!isFinite(tq) || Math.abs(tq - e.dq) > 0.08) continue;
          for (const gve of se.graphicalVoiceEntries || []) {
            const vid = String(gve.parentVoiceEntry?.ParentVoice?.VoiceId ?? '1');
            let li = ctl.sc.lines.findIndex(L => L.part === pi && L.voice === vid);
            if (li < 0) li = ctl.sc.lines.findIndex(L => L.part === pi);
            if (li !== e.line && pi !== targetPart) continue;
            const gnotes = (gve.notes || []).filter(gn => gn.sourceNote && !gn.sourceNote.isRest?.());
            if (!gnotes.length) continue;
            for (const gn of gnotes) {
              const svgEl = gn.getSVGGElement?.();
              if (svgEl?.classList) svgEl.classList.add('gr-n-' + cls);
            }
            const gn0 = gnotes[gnotes.length - 1];
            const ax = gn0.PositionAndShape?.AbsolutePosition?.x ?? se.PositionAndShape?.AbsolutePosition?.x;
            const ay = gn0.PositionAndShape?.AbsolutePosition?.y ?? se.PositionAndShape?.AbsolutePosition?.y;
            const sy = gm.ParentStaffLine?.PositionAndShape?.AbsolutePosition?.y ?? gm.PositionAndShape?.AbsolutePosition?.y ?? ay;
            if (isFinite(ax)) noteX = bx + ax * u;
            if (isFinite(ay)) noteY = by + ay * u;
            if (isFinite(sy)) laneY = by + (sy - 1.35) * u;
          }
        }
      }
      // Fallback to measure box interpolation if OSMD graphical entry wasn't matched directly
      const box = BOX[e.m];
      if (noteX == null && box) {
        const mLen = ctl.sc.measures[e.m]?.len || 4;
        noteX = box.x + 12 + (e.dq / mLen) * Math.max(10, box.w - 20);
      }
      if (laneY == null && box) laneY = box.y - 10;
      if (noteY == null && box) noteY = box.y + box.h * 0.35;
      if (noteX == null || laneY == null) return;

      if (box && !drawnMeasures.has(e.m)) {
        drawnMeasures.add(e.m);
        mk('line', { x1: box.x + 6, x2: box.x + box.w - 6, y1: laneY, y2: laneY, class: 'gr-lane' });
      }
      mk('line', { x1: noteX, x2: noteX, y1: laneY - 5, y2: laneY + 5, class: 'gr-tick' });
      if (!n.match) {
        mk('circle', { cx: noteX, cy: noteY, r: 10, class: 'gr-ring' });
        return;
      }
      const tcls = n.status === 'timing' ? 'timing' : 'ok';
      const pxPerQ = box ? Math.max(18, Math.min(70, box.w / (ctl.sc.measures[e.m]?.len || 4))) : 32;
      const dx = Math.max(-28, Math.min(28, ((n.errMs || 0) / 1000 / (res.q || 0.5)) * pxPerQ));
      const hx = noteX + dx;
      if (Math.abs(dx) > 1.5) mk('line', { x1: noteX, x2: hx, y1: laneY, y2: laneY, class: 'gr-off ' + tcls });
      mk('circle', { cx: hx, cy: laneY, r: 4.5, class: 'gr-dot ' + tcls });
      const lbl = n.pitch === 'wrong' && n.sungAs ? n.sungAs.replace(/-?\d+$/, '') : n.pitch === 'octave' ? (n.octave > 0 ? 'oct ↑' : 'oct ↓') : n.pitch === 'none' ? '?' : n.joined ? 'joined' : '';
      if (lbl) {
        const tx = mk('text', { x: hx, y: laneY - 8, 'text-anchor': 'middle', class: 'gr-lbl' + (n.joined && !pitchBad ? ' soft' : '') });
        tx.textContent = lbl;
      }
    });
    grov.appendChild(osvg);
  };

  ctl.drawChoir = () => {
    const box = $q('.sp-choir'), sc = ctl.sc; if (!sc) return;
    let vocal = sc.lines.map((L, i) => ({ L, i })).filter(x => !x.L.acc);
    if (!vocal.length) vocal = sc.lines.map((L, i) => ({ L, i }));          // no voices found: offer every part
    box.hidden = false;
    // piano / accompaniment can be focused too (e.g. Alto + Piano)
    const focusable = vocal.concat(sc.lines.map((L, i) => ({ L, i })).filter(x => x.L.acc));
    const opt = (v, l) => `<option value="${v}" ${(st.view || 'all') === v ? 'selected' : ''}>${l}</option>`;
    box.innerHTML = `<span class="sp-grp" data-ctl="focus"><span class="sp-lbl" title="Tap one or more parts">Focus</span><button data-sp="focus" data-i="" class="${!spFoc(st).length ? 'on' : ''}" title="Everyone at normal volume">All</button>${focusable.map(({ L, i }) => `<button data-sp="focus" data-i="${i}" class="${spFoc(st).includes(i) ? 'on' : ''}" title="Tap to add/remove ${esc(L.name)}: focused parts are loud, the rest soft">${L.acc ? IC('ico:score') : `<i class="sp-dot" style="background:${ctl.lineColor(i)}"></i>`}${esc(short(L.name))}</button>`).join('')}</span>
      <span class="sp-grp" data-ctl="pitches"><span class="sp-lbl">Pitches</span>${vocal.map(({ L, i }) => `<button data-sp="pitch" data-w="${i}" title="Play ${esc(L.name)}'s first note">${IC('ico:bell')} ${esc(short(L.name))}</button>`).join('')}<button data-sp="pitch" data-w="order" title="Each section's first note, lowest first">Low → high</button><button data-sp="pitch" data-w="together" title="All sections' first notes at once">Together</button></span>
      <label class="sp-colt" data-ctl="colour"><input type="checkbox" data-spk="colorParts" ${st.colorParts !== false ? 'checked' : ''}> Colour parts</label>
      <span class="sp-grp" data-ctl="show"><span class="sp-lbl">Show</span><select data-spk="view">${opt('all', 'All staves')}${opt('voices', 'Voices only')}${opt('focus', 'Focus part only')}</select></span>`;
    ctl.applyCtl?.();
  };
  // hide staves for projecting (piano, other parts) — the remaining music draws bigger
  ctl.applyView = () => {
    const o = ctl.osmd, sc = ctl.sc; if (!o || !sc) return;
    const v = st.view || 'all', fps = spFoc(st).map(f => sc.lines[f]?.part).filter(x => x != null);
    const want = sc.parts.map((p, i) => v === 'all' || (v === 'voices' && !p.acc) || (v === 'focus' && (fps.length ? fps.includes(i) : !p.acc)));
    if (!want.some(Boolean)) want.fill(true);
    let changed = false;
    (o.Sheet?.Instruments || []).forEach((ins, i) => { const w = want[i] ?? true; if (ins.Visible !== w) { ins.Visible = w; changed = true; } });
    if (changed) { ctl.lastW = 0; ctl.relayout(); }
  };
  ctl.drawSpots = () => {
    const box = $q('.sp-spots'); if (box.hidden) return;
    const list = st.spots || [];
    box.innerHTML = `<div class="sp-spots-head"><b>${IC('ico:agenda')} Rehearsal spots</b><span class="sp-sp"></span>
        <button data-sp="spot-step" data-d="-1" title="Previous spot">${IC('ico:chevleft')}</button><button data-sp="spot-step" data-d="1" title="Next spot">${IC('ico:chevright')}</button>
        <button data-sp="spot-add" class="sp-primary" title="Save the current loop, focus part and tempo as a spot">${IC('ico:plus')} Save current loop</button></div>
      ${list.length ? `<ol class="sp-spot-list">${list.map(x => `<li class="${x.id === ctl.curSpot ? 'cur' : ''} ${x.done ? 'done' : ''}">
          <button data-sp="spot-done" data-id="${x.id}" class="sp-tick" title="Mark as learned">${x.done ? '✓' : ''}</button>
          <button data-sp="spot-go" data-id="${x.id}" class="sp-spot-name" title="Load this spot">${esc(x.name)}</button>
          <button data-sp="spot-play" data-id="${x.id}" title="Load and play">${IC('ico:play')}</button>
          ${x.id === ctl.curSpot ? `<button data-sp="spot-save" data-id="${x.id}" title="Replace with the current loop, focus and tempo">⟳</button>` : ''}
          <button data-sp="spot-del" data-id="${x.id}" title="Remove">${IC('ico:close')}</button></li>`).join('')}</ol>`
      : '<div class="sp-note">Set a loop (and a focus part / tempo if you like), then “Save current loop”. Step through the list during rehearsal with the previous and next buttons, and tick spots off as they’re learned.</div>'}`;
  };
  ctl.goSpot = (i, play) => {
    const x = (st.spots || [])[i]; if (!x) return;
    ctl.curSpot = x.id;
    Object.assign(st.loop, { on: true, a: x.a, b: x.b }); st.focus = x.focus == null ? null : spFoc({ focus: x.focus }).slice(); st.tempo = x.tempo;
    onChange(); ctl.updateBar(); ctl.drawSel(); ctl.drawChoir(); ctl.drawVoices(); ctl.paint(); ctl.drawSpots();
    if ((st.view || 'all') === 'focus') ctl.applyView();
    const r = BOX[x.a], sc = $q('.sp-score'); if (r) { sc.scrollTop = Math.max(0, r.y - 20); sc.scrollLeft = Math.max(0, r.x - 40); }
    if (play) spPlay(ctl); else if (ctl.playing) spPlay(ctl);
  };
  ctl.updateBar = () => {
    $q('[data-sp="play"]').innerHTML = ctl.playing ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Play';
    $q('[data-sp="loop"]').classList.toggle('on', !!st.loop.on);
    $q('[data-sp="layout"]').innerHTML = st.layout === 'h' ? IC('ico:movehoriz') + ' Sideways' : IC('ico:movevert') + ' Down';

    $q('[data-sp="nums"]').classList.toggle('on', !!st.nums);
    root.querySelectorAll('[data-sp="lbl"]').forEach(b => b.classList.toggle('on', st.labels === b.dataset.v));
    if (ctl.sc) {
      const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'], keys = [];
      ctl.sc.measures.forEach((m, i) => { const prev = ctl.sc.measures[i - 1]; if (!prev || prev.fifths !== m.fifths || prev.mode !== m.mode) {
        const maj = (((m.fifths || 0) * 7) % 12 + 12) % 12, minor = /minor/i.test(m.mode); keys.push(`m. ${m.num}: ${NAMES[minor ? (maj + 9) % 12 : maj]} ${minor ? 'minor' : 'major'}`); } });
      const sb = $q('[data-sp="lbl"][data-v="solfege"]'); if (sb) sb.title = 'Solfege (movable do; minor is do-based)\nKeys: ' + keys.join(' · ');
    }
    const gBtn = $q('[data-sp="grade"]');
    if (gBtn && !(typeof GR !== 'undefined' && GR.on && GR.host === host)) {
      const gli = ctl.sc ? spGradeLine(ctl) : 0;
      const gName = ctl.sc && ctl.sc.lines.length > 1 ? short(ctl.sc.lines[gli]?.name || '') : '';
      gBtn.innerHTML = `${IC('ico:mic')} <span class="sp-grlbl">Grade${gName ? ': ' + esc(gName) : ''}</span>`;
      gBtn.classList.remove('on');
    }
    const vBtn = $q('[data-sp="voices"]');
    if (vBtn) {
      vBtn.classList.toggle('on', !!st.voicesOpen);
      const sungN = ctl.sc ? ctl.sc.lines.filter((_, i) => spIsLineSung(ctl, i)).length : 0;
      const vLbl = vBtn.querySelector('.sp-voicelbl');
      if (vLbl) vLbl.textContent = sungN > 0 ? `Voices (${sungN} Sung)` : 'Voices';
    }
    const f = $q('[data-spk="from"]'), t = $q('[data-spk="to"]');
    if (document.activeElement !== f) f.value = mNum(Math.min(st.loop.a, st.loop.b));
    if (document.activeElement !== t) t.value = mNum(Math.max(st.loop.a, st.loop.b));
    const bpm = ctl.sc ? Math.round(spBpmAt(ctl.sc, ctl.sc.measures[Math.min(st.loop.a, st.loop.b)]?.start || 0) * st.tempo / 100) : '';
    const ramp = st.speed.on && ctl.playing ? ` · ${Math.min(100, (+st.speed.start || 70) + (+st.speed.step || 5) * (ctl.iter || 0))}%` : '';
    const bpmEl = $q('.sp-bpm');
    if (bpmEl) {
      bpmEl.innerHTML = bpm ? `<b>${bpm}</b><small>BPM</small>` : `<b>${st.tempo}%</b>`;
      bpmEl.title = bpm ? `${bpm} BPM (${st.tempo}% of score tempo${ramp})` : `${st.tempo}% tempo${ramp}`;
    }
    const zEl = $q('.sp-zoom .tb-zpct');
    if (zEl) zEl.textContent = `${Math.round((st.zoom || 1) * 100)}%`;
    $q('[data-sp="metro"]').classList.toggle('on', !!st.metronome);
    const open = !!st.settingsOpen; root.classList.toggle('sp-closed', !open); $q('[data-sp="settings"]').classList.toggle('on', open);
    const la = Math.min(st.loop.a, st.loop.b), lb = Math.max(st.loop.a, st.loop.b);
    $q('.sp-looplbl').textContent = st.loop.on ? (la === lb ? `Loop m. ${mNum(la)}` : `Loop m. ${mNum(la)}–${mNum(lb)}`) : 'Loop';
    if (!ctl.pick && ctl.sc) { status(''); $q('.sp-score').title = 'Click a measure to select it · Shift-click or drag to select more · ' + (st.loop.on ? 'the selection loops' : 'Play starts at the selection; turn on Loop to repeat it'); }
  };
  const settingsHTML = () => {
    const opt = (v, cur, l) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
    return `<div class="sp-form">
      <label data-ctl="countin">Count-in <select data-spk="countIn">${opt(0, st.countIn, 'None')}${opt(1, st.countIn, '1 bar')}${opt(2, st.countIn, '2 bars')}</select></label>
      <label class="srchk" data-ctl="countevery"><input type="checkbox" data-spk="countEvery" ${st.countEvery ? 'checked' : ''}> Count in before every repeat</label>
      <label data-ctl="solminor" title="How minor keys are sung">Minor <select data-spk="solMinor">${opt('do', S.settings.solMinor || 'do', 'do-based (do = tonic)')}${opt('la', S.settings.solMinor || 'do', 'la-based (la = tonic)')}</select></label>
      <label data-ctl="rhysys" title="Syllables used when Counts is turned on">Counts <select data-spk="rhythmSystem">${(typeof RHYTHM_SYSTEMS !== 'undefined' ? RHYTHM_SYSTEMS : [['numbers', 'Numbers (1 e & a)']]).map(([v, l]) => opt(v, S.settings.rhythmSystem || 'numbers', l)).join('')}</select></label>
      <label data-ctl="startpitch">Starting pitches <select data-spk="pitches">${opt('none', st.pitches, 'None')}${opt('mine', st.pitches, 'Parts that are playing')}${opt('all', st.pitches, 'All parts (chord)')}</select></label>
      <span class="sp-grp" data-ctl="speedup"><label class="srchk"><input type="checkbox" data-spk="speedOn" ${st.speed.on ? 'checked' : ''}> Speed up each repeat</label>
      <label>start at <input type="number" min="30" max="100" step="5" data-spk="speedStart" value="${st.speed.start}">%</label>
      <label>+<input type="number" min="1" max="25" data-spk="speedStep" value="${st.speed.step}">% per loop</label></span>
    </div>
    <div class="sp-parts" data-ctl="mixer">${ctl.partMixerHTML(false)}</div>
    <div data-ctl="mixer">${metVolSlider()}</div>
    <div class="sr-sync sp-sync" data-ctl="sync" title="If the playhead is ahead of or behind the sound on this device, slide this, or press Calibrate and tap along with 8 clicks.">Playhead sync <span><input type="range" min="-200" max="600" step="10" value="${avDelayMs()}" data-action-input="av-delay"><b class="av-v">${avDelayMs()} ms</b><button type="button" data-action="av-cal">Calibrate…</button></span></div>
    <div><button data-sp="custom">${IC('ico:eye')} Buttons to show…</button></div>
    <div class="sp-note" data-ctl="help">Speed-up starts at that percentage of the tempo slider and adds the step each time the loop repeats, until it reaches the full tempo. Repeat signs and 1st / 2nd endings are followed (D.C. / D.S. / Coda are not yet).</div>`;
  };
  // ----- geometry from the drawn score
  const U = () => 10 * (ctl.osmd?.zoom || 1);
  const boxes = () => {
    const ML = ctl.osmd?.GraphicSheet?.MeasureList || [], out = [];
    const svg = $q('.sp-osmd svg, .sp-osmd canvas'), ov = $q('.sp-ov').getBoundingClientRect();
    const sr = svg ? svg.getBoundingClientRect() : ov, base = { x: sr.left - ov.left, y: sr.top - ov.top };
    ML.forEach((staffs, i) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const gm of staffs || []) {
        const ps = gm?.PositionAndShape; if (!ps || gm.ParentStaff?.ParentInstrument?.Visible === false) continue;
        const ax = ps.AbsolutePosition.x, ay = ps.AbsolutePosition.y;
        const bl = ps.BorderLeft ?? 0, br = ps.BorderRight ?? ps.Size.width, bt = ps.BorderTop ?? 0, bb = ps.BorderBottom ?? ps.Size.height;
        x0 = Math.min(x0, ax + bl); x1 = Math.max(x1, ax + br); y0 = Math.min(y0, ay + Math.min(bt, -1)); y1 = Math.max(y1, ay + Math.max(bb, 5));
      }
      // where each beat-position in this measure is drawn (first notehead at that time, any staff)
      const kn = new Map();
      for (const gm of staffs || []) {
        if (!gm || gm.ParentStaff?.ParentInstrument?.Visible === false) continue;
        for (const se of gm.staffEntries || []) {
          const tq = (se.relInMeasureTimestamp?.RealValue ?? NaN) * 4, sx = se.PositionAndShape?.AbsolutePosition?.x;
          if (!isFinite(tq) || !isFinite(sx)) continue;
          const k = Math.round(tq * 1000); kn.set(k, Math.min(kn.get(k) ?? 1e9, sx));
        }
      }
      const knots = [...kn.entries()].map(([k, x]) => [k / 1000, base.x + x * U()]).sort((a, b) => a[0] - b[0]);
      let st0 = 1e9, sb0 = -1e9;
      for (const gm of staffs || []) {
        if (!gm || gm.ParentStaff?.ParentInstrument?.Visible === false) continue;
        const sy = gm.ParentStaffLine?.PositionAndShape?.AbsolutePosition?.y ?? gm.PositionAndShape.AbsolutePosition.y;
        st0 = Math.min(st0, sy); sb0 = Math.max(sb0, sy + 4);
      }
      out[i] = x1 > x0 ? { x: base.x + x0 * U(), y: base.y + y0 * U(), w: (x1 - x0) * U(), h: (y1 - y0) * U(), knots,
        sysTop: base.y + st0 * U(), sysBot: base.y + sb0 * U() } : null;
    });
    return out;
  };
  let BOX = [];
  ctl.drawSel = () => {
    const sel = $q('.sp-sel'); sel.innerHTML = '';
    if (!BOX.length) return;
    sel.classList.toggle('off', !st.loop.on);                       // selected but not looping: lighter
    const a = Math.min(st.loop.a, st.loop.b), b = Math.max(st.loop.a, st.loop.b);
    // one even band per line of music (rounded ends where the selection starts / stops)
    const groups = [];
    for (let i = a; i <= b; i++) {
      const r = BOX[i]; if (!r) continue;
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.top - r.sysTop) < 2 && r.x >= g.right - 2) { g.right = r.x + r.w; g.last = i; }
      else groups.push({ left: r.x, right: r.x + r.w, top: r.sysTop, bot: r.sysBot, first: i, last: i });
    }
    const pad = 1.4 * U();
    groups.forEach((g, k) => {
      const d = document.createElement('i');
      d.className = (g.first === a ? 'start ' : '') + (g.last === b ? 'end' : '');
      Object.assign(d.style, { left: g.left - 3 + 'px', top: g.top - pad + 'px', width: g.right - g.left + 6 + 'px', height: g.bot - g.top + pad * 2 + 'px' });
      if (k === 0) { const t = document.createElement('b'); t.textContent = a === b ? `m. ${mNum(a)}` : `m. ${mNum(a)}–${mNum(b)}`; if (st.loop.on) t.textContent = t.textContent; d.appendChild(t); }
      sel.appendChild(d);
    });
  };
  ctl.hidePlayhead = () => { $q('.sp-ph').hidden = true; };
  ctl.drawPlayhead = now => {
    const M = ctl.marks; if (!M.length || !ctl.sc) return;
    let i = M.length - 1; while (i > 0 && M[i].t > now) i--;
    const a = M[i], b = M[i + 1];
    const q = a.hold || !b || b.jump ? a.q : a.q + (b.q - a.q) * Math.max(0, Math.min(1, (now - a.t) / ((b.t - a.t) || 1)));
    const P = ctl.sc.perf, ms = ctl.sc.measures;
    let pi = P.findIndex(m => q >= m.start - 1e-9 && q < m.start + m.len - 1e-9); if (pi < 0) pi = P.length - 1;
    const mi = P[pi].w, r = BOX[mi], ph = $q('.sp-ph'); if (!r) { ph.hidden = true; return; }
    const m = ms[mi], dq = q - P[pi].start;
    let x;
    const K = r.knots || [];
    if (K.length) {
      // glide from note to note: between two drawn notes, and from the last note to the bar line
      let j = 0; while (j < K.length - 1 && dq >= K[j + 1][0]) j++;
      const [qa, xa] = K[j], [qb, xb] = K[j + 1] || [m.len, r.x + r.w - 4];
      x = dq <= qa ? xa : xa + (xb - xa) * Math.max(0, Math.min(1, (dq - qa) / ((qb - qa) || 1)));
    } else { const f = Math.max(0, Math.min(1, dq / (m.len || 1))), pad = Math.min(14, r.w * 0.08); x = r.x + pad + f * (r.w - pad * 1.5); }
    ph.hidden = false; Object.assign(ph.style, { transform: `translate(${x}px, ${r.y}px)`, height: r.h + 'px' });
    const sc = $q('.sp-score');                                     // keep the playhead in view
    if (r.y < sc.scrollTop + 10 || r.y + r.h > sc.scrollTop + sc.clientHeight - 10) sc.scrollTop = Math.max(0, r.y - sc.clientHeight * 0.25);
    if (x < sc.scrollLeft + 30 || x > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3);
    if (ctl.lastIter !== ctl.iter) { ctl.lastIter = ctl.iter; ctl.updateBar(); }
  };
  const SP_COLORS = ['#1f6fd1', '#1a9a5a', '#c2410c', '#8b3fc7', '#b8860b', '#0e7490', '#be185d', '#4d7c0f'];
  ctl.lineColor = i => SP_COLORS[i % SP_COLORS.length];
  // tag every drawn note with the line (part / voice) it belongs to
  ctl.tagNotes = () => {
    const o = ctl.osmd, sc = ctl.sc; if (!o || !sc) return;
    const insts = o.Sheet?.Instruments || [];
    for (const staffs of o.GraphicSheet?.MeasureList || []) for (const gm of staffs || []) {
      if (!gm) continue;
      const pi = insts.indexOf(gm.ParentStaff?.ParentInstrument);
      for (const se of gm.staffEntries || []) for (const gve of se.graphicalVoiceEntries || []) {
        const vid = String(gve.parentVoiceEntry?.ParentVoice?.VoiceId ?? '1');
        let li = sc.lines.findIndex(L => L.part === pi && L.voice === vid);
        if (li < 0) li = sc.lines.findIndex(L => L.part === pi);
        for (const n of gve.notes || []) { const g = n.getSVGGElement?.(); if (g && li >= 0) g.setAttribute('data-line', li); }
      }
    }
    ctl.paint();
  };
  // colour what you're hearing: playing parts in their colour (the focused one strongest), muted parts grey
  ctl.paint = () => {
    const sc = ctl.sc; if (!sc) return;
    const on = st.colorParts !== false;
    $q('.sp-osmd').classList.toggle('sp-colored', on);
    for (const g of root.querySelectorAll('.sp-osmd [data-line]')) {
      const i = +g.getAttribute('data-line'), L = sc.lines[i];
      if (!on || !L) { g.style.removeProperty('--c'); g.style.opacity = ''; continue; }
      const muted = st.parts[i]?.on === false, F = spFoc(st), dim = F.length && !F.includes(i);
      g.style.setProperty('--c', muted ? '#9aa0ad' : L.acc ? '#333a48' : ctl.lineColor(i));
      g.style.opacity = muted ? '0.35' : dim ? '0.55' : '';
    }
  };
  ctl.applySpacing = () => {
    const R = ctl.osmd?.EngravingRules; if (!R) return false;
    R.__base ||= { s: R.StaffDistance, b: R.BetweenStaffDistance, m: R.MinimumDistanceBetweenSystems, vm: R.VoiceSpacingMultiplierVexflow ?? 0.85, va: R.VoiceSpacingAddendVexflow ?? 3, ks: R.MinSkyBottomDistBetweenStaves ?? 1, ky: R.MinSkyBottomDistBetweenSystems ?? 1 };
    // wider note spacing while labels are shown, so syllables / counts don't crowd
    R.VoiceSpacingMultiplierVexflow = st.labels ? R.__base.vm * 1.45 : R.__base.vm;
    R.VoiceSpacingAddendVexflow = st.labels ? R.__base.va + 2.5 : R.__base.va;
    const multi = ctl.sc?.lines.some((L, i) => !L.acc && L.voice && ctl.sc.lines.some((M, j) => j !== i && M.part === L.part));
    const extra = st.labels ? (multi ? 5.6 : 3.8) : 0;
    // staves are spaced by what's actually on them (notes, lyrics): add the label room to that gap too
    R.MinSkyBottomDistBetweenStaves = R.__base.ks + extra; R.MinSkyBottomDistBetweenSystems = R.__base.ky + extra;
    const want = [R.__base.s + extra, R.__base.b + extra, R.__base.m + extra];
    const cur = [R.StaffDistance, R.BetweenStaffDistance, R.MinimumDistanceBetweenSystems];
    const spacingChanged = R.__lastLbl !== !!st.labels; R.__lastLbl = !!st.labels;
    if (want.every((v, i) => Math.abs(v - cur[i]) < 1e-6) && !spacingChanged) return false;
    [R.StaffDistance, R.BetweenStaffDistance, R.MinimumDistanceBetweenSystems] = want;
    return true;
  };
  ctl.applyNums = () => {
    const o = ctl.osmd; if (!o) return;
    try { o.setOptions({ drawMeasureNumbers: true, measureNumberInterval: st.nums ? 1 : 1000 }); } catch { }
    const R = o.EngravingRules; if (R) { R.RenderMeasureNumbersOnlyAtSystemStart = !st.nums; R.MeasureNumberLabelHeight = st.nums ? 1.6 : R.MeasureNumberLabelHeight; }
  };
  // solfege (movable do; minor is do-based like the sight-reading widget) and rhythm counts, above the notes
  const SOL_UP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
  const SOL_MIN = ['do', 'di', 're', 'me', 'mi', 'fa', 'fi', 'sol', 'le', 'la', 'te', 'ti'];
  const spSyl = (pc, m) => {
    const minor = /minor/i.test(m.mode || '') && S.settings.solMinor !== 'la', tonic = (((m.fifths || 0) * 7) % 12 + 12 + (minor ? 9 : 0)) % 12;
    return (minor ? SOL_MIN : SOL_UP)[(pc - tonic + 12) % 12];
  };
  const spCount = (dq, m, dur = 1) => {
    const compound = m.bt === 8 && m.beats % 3 === 0 && m.beats > 3, bu = compound ? 1.5 : 4 / m.bt;
    const sys = typeof rhythmSys === 'function' ? rhythmSys() : (S.settings?.rhythmSystem || 'numbers');
    if (sys !== 'numbers' && typeof rhythmSyllable === 'function') {
      const p = compound ? dq : (bu === 1 ? dq : dq / bu);
      return rhythmSyllable(p, compound ? 'compound' : 'simple', false, dur, null, 0, sys);
    }
    const beat = Math.floor(dq / bu + 1e-6), f = dq / bu - beat, n = String(beat + 1), near = x => Math.abs(f - x) < 0.02;
    if (near(0)) return n;
    if (compound) return near(1 / 3) ? 'la' : near(2 / 3) ? 'li' : near(1 / 6) || near(0.5) || near(5 / 6) ? 'ta' : '·';
    if (bu === 1 || bu === 0.5) {
      if (near(0.5)) return '&';
      if (near(0.25)) return 'e';
      if (near(0.75)) return 'a';
      if (near(1 / 3)) return 'trip';
      if (near(2 / 3)) return 'let';
    }
    return '·';
  };
  ctl.drawLabels = () => {
    const box = $q('.sp-lbls'); box.innerHTML = '';
    const o = ctl.osmd, sc = ctl.sc; if (!o || !sc || !st.labels) return;
    const insts = o.Sheet?.Instruments || [], F = spFoc(st).filter(f => !sc.lines[f]?.acc);
    let want = F.length ? new Set(F) : new Set(sc.lines.map((L, i) => i).filter(i => !sc.lines[i].acc));
    if (!want.size) want = new Set(spFoc(st).length ? spFoc(st) : sc.lines.map((L, i) => i));
    const svg = $q('.sp-osmd svg'); if (!svg) return;
    const ov = $q('.sp-ov').getBoundingClientRect(), sr = svg.getBoundingClientRect(), bx = sr.left - ov.left, by = sr.top - ov.top, u = U();
    const items = [], tops = new Map();
    (o.GraphicSheet?.MeasureList || []).forEach((staffs, mi) => {
      const m = sc.measures[mi]; if (!m) return;
      for (const gm of staffs || []) {
        if (!gm || gm.ParentStaff?.ParentInstrument?.Visible === false) continue;
        const pi = insts.indexOf(gm.ParentStaff?.ParentInstrument);
        const ps = gm.PositionAndShape, ay = ps.AbsolutePosition.y;
        // bottom of this staff on this line, including notes below it and the lyrics
        const sl = gm.ParentStaffLine?.PositionAndShape;
        const bot = sl ? sl.AbsolutePosition.y + Math.max(sl.BorderBottom ?? 4, 4) : ay + Math.max(ps.BorderBottom ?? 4, 4);
        const gkey = (gm.ParentStaff?.idInMusicSheet ?? pi) + '|' + Math.round(ay);
        tops.set(gkey, Math.max(tops.get(gkey) ?? -1e9, bot));
        for (const se of gm.staffEntries || []) {
          const dq = (se.relInMeasureTimestamp?.RealValue ?? 0) * 4;
          for (const gve of se.graphicalVoiceEntries || []) {
            const vid = String(gve.parentVoiceEntry?.ParentVoice?.VoiceId ?? '1');
            let li = sc.lines.findIndex(L => L.part === pi && L.voice === vid); if (li < 0) li = sc.lines.findIndex(L => L.part === pi);
            if (li < 0 || !want.has(li)) continue;
            const notes = (gve.notes || []).filter(n => n.sourceNote && !n.sourceNote.isRest?.() && n.sourceNote.Pitch);
            if (!notes.length) continue;
            // a chord: label its top note; tied continuations get no label
            const sn = notes[notes.length - 1].sourceNote;
            if (sn.NoteTie && sn.NoteTie.StartNote !== sn) continue;
            const pc = ((sn.Pitch.FundamentalNote ?? 0) + Math.round(sn.Pitch.AccidentalHalfTones ?? 0) + 120) % 12;
            const dur = (sn.Length?.RealValue ?? 0.25) * 4;
            const txt = st.labels === 'solfege' ? spSyl(pc, m) : spCount(dq, m, dur);
            const nx = notes[notes.length - 1].PositionAndShape?.AbsolutePosition?.x ?? se.PositionAndShape.AbsolutePosition.x;
            items.push({ gkey, li, x: nx, txt });
          }
        }
      }
    });
    // one tidy row per staff line (two voices on one staff get two rows)
    const rowOf = new Map();
    for (const it of items) {
      const r = rowOf.get(it.gkey) || []; if (!r.includes(it.li)) r.push(it.li); rowOf.set(it.gkey, r);
    }
    const frag = document.createDocumentFragment(), fs = Math.max(9, Math.min(18, 1.45 * u));
    items.sort((p, q) => p.gkey < q.gkey ? -1 : p.gkey > q.gkey ? 1 : p.li - q.li || p.x - q.x);
    const lastEnd = new Map();
    for (const it of items) {
      const rows = rowOf.get(it.gkey), row = rows.indexOf(it.li);
      const px = bx + it.x * u, half = it.txt.length * fs * 0.3 + 2, k = it.gkey + '|' + it.li;
      const prev = lastEnd.get(k) || { end: -1e9, drop: 0 };
      const drop = px - half < prev.end + 2 && !prev.drop ? 1 : 0;      // would touch the previous label: drop half a line
      lastEnd.set(k, { end: px + half, drop });
      const y = (tops.get(it.gkey) + 0.5 + row * 1.8 + drop * 1.15) * u + by;
      const d = document.createElement('span'); d.textContent = it.txt;
      d.style.cssText = `left:${px}px;top:${y}px;font-size:${fs}px;color:${st.colorParts !== false ? ctl.lineColor(it.li) : '#1d2330'}`;
      frag.appendChild(d);
    }
    box.appendChild(frag);
  };
  ctl.relayout = () => {
    if (!ctl.osmd) return;
    const w = $q('.sp-score').clientWidth;
    if (!w || w === ctl.lastW) { BOX = boxes(); ctl.drawSel(); ctl.drawLabels(); ctl.drawGradeMarks(); return; }
    ctl.lastW = w;
    try { ctl.osmd.render(); } catch { }
    BOX = boxes(); ctl.drawSel(); ctl.tagNotes(); ctl.drawLabels(); ctl.drawGradeMarks();
  };
  // ----- events
  root.addEventListener('pointerdown', () => { SP_ACTIVE = ctl; window.__spaceTarget = 'sp'; });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-sp]');
    if (b) {
      e.stopPropagation(); SP_ACTIVE = ctl;
      const k = b.dataset.sp;
      if (k === 'play') { if (ctl.playing) spStop(); else if (ctl.sc) spPlay(ctl); }
      if (k === 'tempo-step') { st.tempo = Math.max(30, Math.min(150, st.tempo + Number(b.dataset.d))); ctl.updateBar(); onChange(); }
      if (k === 'metro') { st.metronome = !st.metronome; onChange(); ctl.updateBar(); }
      if (k === 'loop') { st.loop.on = !st.loop.on; ctl.pick = null; onChange(); ctl.updateBar(); ctl.drawSel(); }
      if (k === 'zoom') { st.zoom = Math.max(0.3, Math.min(2.5, +(st.zoom + Number(b.dataset.d)).toFixed(2))); ctl.updateBar(); onChange(); if (ctl.osmd) { ctl.osmd.zoom = st.zoom; ctl.lastW = 0; ctl.relayout(); } }
      if (k === 'zoom-reset') { st.zoom = 1; ctl.updateBar(); onChange(); if (ctl.osmd) { ctl.osmd.zoom = st.zoom; ctl.lastW = 0; ctl.relayout(); } }
      if (k === 'focus') {
        if (b.dataset.i === '') st.focus = null;
        else { const F = new Set(spFoc(st)), i = +b.dataset.i; F.has(i) ? F.delete(i) : F.add(i); st.focus = F.size ? [...F].sort((x, y) => x - y) : null; }
        onChange(); ctl.refreshVoicesUI(); ctl.drawLabels(); if ((st.view || 'all') === 'focus') ctl.applyView();
      }
      if (k === 'voices') { st.voicesOpen = !st.voicesOpen; onChange(); ctl.drawVoices(); ctl.updateBar(); return; }
      if (k === 'vrec') { spStartVocalRec(ctl, +b.dataset.line); return; }
      if (k === 'vsrc') {
        const li = +b.dataset.line, src = b.dataset.src;
        if (src === 'sung' && !ctl.vocalRecs?.[li]?.audioBuffer) { toast('Record your sung voice first (🎤 Rec).'); return; }
        (st.parts[li] ||= {}).source = src;
        onChange(); ctl.refreshVoicesUI();
        return;
      }
      if (k === 'vdel') { spDeleteVocalRec(ctl, +b.dataset.line); return; }
      if (k === 'grade') {
        ctl.closeGradeMenu();
        spGradeStart(ctl, $q('[data-sp="grade"]'), st.gradeMode || 'mic');
        return;
      }
      if (k === 'grade-menu') {
        if (typeof GR !== 'undefined' && (GR.on || GR.starting)) { ctl.closeGradeMenu(); grStop(true); return; }
        root.querySelector('.sp-grmenu') ? ctl.closeGradeMenu() : ctl.openGradeMenu(b);
        return;
      }
      if (k === 'gradego') {
        const v = b.dataset.v;
        st.gradeMode = v; onChange();
        ctl.closeGradeMenu();
        spGradeStart(ctl, $q('[data-sp="grade"]'), v);
        return;
      }
      if (k === 'grrecent') { if (typeof grShowRecent === 'function') grShowRecent(host); return; }
      if (k === 'pitch') spGivePitch(ctl, b.dataset.w);
      if (k === 'layout') {
        st.layout = st.layout === 'h' ? 'v' : 'h'; onChange(); ctl.updateBar();
        if (ctl.osmd) { ctl.osmd.setOptions({ renderSingleHorizontalStaffline: st.layout === 'h' }); $q('.sp-score').scrollTo(0, 0); ctl.lastW = 0; ctl.relayout(); }
      }
      if (k === 'nums') { st.nums = !st.nums; onChange(); ctl.updateBar(); if (ctl.osmd) { ctl.applyNums(); ctl.lastW = 0; ctl.relayout(); } }
      if (k === 'lbl') { st.labels = st.labels === b.dataset.v ? null : b.dataset.v; onChange(); ctl.updateBar(); if (ctl.applySpacing()) { ctl.lastW = 0; ctl.relayout(); } else ctl.drawLabels(); }
      if (k === 'hold') { ctl.holdMode = !ctl.holdMode; if (!ctl.holdMode) spHoldStop(); ctl.updateBar(); }
      if (k === 'addscore') { ctl.addScore(); return; }
      if (k === 'tabs') { const t = $q('.sp-tabs'); t.hidden = !t.hidden; ctl.drawTabs(); return; }
      if (k === 'custom') { const c = $q('.sp-custom'); c.hidden = !c.hidden; ctl.drawCustom(); }
      if (k === 'barreset') { mbarReset(SP_BARCFG); ctl.rebuildBar(); return; }
      if (k === 'custom-all') { S.settings.spHidden = []; save(); ctl.drawCustom(); spApplyAll(); }
      if (k === 'spots') { const sp = $q('.sp-spots'); sp.hidden = !sp.hidden; ctl.drawSpots(); }
      if (k === 'spot-add') {
        const a = Math.min(st.loop.a, st.loop.b), bb = Math.max(st.loop.a, st.loop.b), L = spFoc(st).map(f => ctl.sc?.lines[f]?.name).filter(Boolean).join(' + ') || null;
        const def = `m. ${mNum(a)}–${mNum(bb)}${L ? ' · ' + L : ''}${st.tempo !== 100 ? ' · ' + st.tempo + '%' : ''}`;
        const name = prompt('Name this spot:', def); if (name == null) return;
        (st.spots ||= []).push({ id: Math.random().toString(36).slice(2, 9), name: name.trim() || def, a, b: bb, focus: spFoc(st).length ? [...spFoc(st)] : null, tempo: st.tempo, done: false });
        onChange(); ctl.drawSpots();
      }
      if (k === 'spot-go') ctl.goSpot(st.spots.findIndex(x => x.id === b.dataset.id), false);
      if (k === 'spot-play') ctl.goSpot(st.spots.findIndex(x => x.id === b.dataset.id), true);
      if (k === 'spot-step') { const cur = st.spots.findIndex(x => x.id === ctl.curSpot); ctl.goSpot(Math.max(0, Math.min(st.spots.length - 1, cur + Number(b.dataset.d))), ctl.playing); }
      if (k === 'spot-done') { const x = st.spots.find(y => y.id === b.dataset.id); if (x) { x.done = !x.done; onChange(); ctl.drawSpots(); } }
      if (k === 'spot-del') { st.spots = st.spots.filter(y => y.id !== b.dataset.id); onChange(); ctl.drawSpots(); }
      if (k === 'spot-save') { const x = st.spots.find(y => y.id === b.dataset.id); if (x) { Object.assign(x, { a: Math.min(st.loop.a, st.loop.b), b: Math.max(st.loop.a, st.loop.b), focus: spFoc(st).length ? [...spFoc(st)] : null, tempo: st.tempo }); onChange(); ctl.drawSpots(); toast('Spot updated'); } }
      if (k === 'settings') { const s = $q('.sp-settings'); s.hidden = !s.hidden; st.settingsOpen = !s.hidden; onChange(); if (!s.hidden) s.innerHTML = settingsHTML(); else $q('.sp-custom').hidden = true; ctl.applyCtl(); ctl.updateBar(); }
      return;
    }
    // clicking the music: choose where to play from / the loop's first and last measure
    const sc = e.target.closest('.sp-score'); if (!sc || !BOX.length) return;
    e.stopPropagation(); SP_ACTIVE = ctl;
    const r = $q('.sp-ov').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const i = BOX.findIndex(bx => bx && x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h); if (i < 0) return;
    if (ctl.holdMode) {
      // which moment in the measure was clicked: the last drawn note at or before the click
      const K = BOX[i].knots || []; let dq = 0; for (const [kq, kx] of K) if (kx <= x + 6) dq = kq;
      spHoldChord(ctl, ctl.sc.measures[i].start + dq, e.shiftKey || e.altKey);
      return;
    }
    if (ctl.dragged) { ctl.dragged = false; return; }              // a drag already chose the measures
    ctl.selectTo(i, e.shiftKey);
  });
  // click = select one measure, Shift-click = extend to here, drag across measures = select them all
  ctl.selectTo = (i, extend) => {
    if (extend && ctl.anchor != null) { st.loop.a = Math.min(ctl.anchor, i); st.loop.b = Math.max(ctl.anchor, i); }
    else { ctl.anchor = i; st.loop.a = st.loop.b = i; }
    ctl.startAt = Math.min(st.loop.a, st.loop.b); ctl.pick = null;
    onChange(); ctl.updateBar(); ctl.drawSel();
    if (ctl.playing) spPlay(ctl);
  };
  const measureAt = e => {
    const r = $q('.sp-ov').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return BOX.findIndex(bx => bx && x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h);
  };
  let drag = null;
  $q('.sp-score').addEventListener('pointerdown', e => {
    if (e.button !== 0 || ctl.holdMode || !BOX.length) return;
    const i = measureAt(e); if (i < 0) return;
    drag = { from: e.shiftKey && ctl.anchor != null ? ctl.anchor : i, last: i, x: e.clientX, y: e.clientY };
  });
  $q('.sp-score').addEventListener('pointermove', e => {
    if (!drag || !(e.buttons & 1)) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    const i = measureAt(e); if (i < 0 || i === drag.last) return;
    drag.last = i; ctl.dragged = true; ctl.anchor = drag.from;
    ctl.selectTo(i, true);
  });
  window.addEventListener('pointerup', () => { drag = null; });
  root.addEventListener('input', e => {
    const el = e.target, k = el.dataset.spk;
    if (k === 'avDelay') { setAvDelay(Number(el.value)); el.nextElementSibling.textContent = el.value + ' ms'; return; }
    if (el.dataset.spvol != null) {
      const i = +el.dataset.spvol, v = Number(el.value);
      (st.parts[i] ||= {}).vol = v;
      root.querySelectorAll(`input[data-spvol="${i}"]`).forEach(inp => { if (inp !== el) inp.value = v; });
      onChange();
    }
  });
  root.addEventListener('change', e => {
    const el = e.target, k = el.dataset.spk;
    if (k === 'from' || k === 'to') { const i = mIdx(el.value); if (k === 'from') st.loop.a = i; else st.loop.b = i; if (st.loop.a > st.loop.b) [st.loop.a, st.loop.b] = [st.loop.b, st.loop.a]; st.loop.on = true; ctl.pick = null; }
    else if (k === 'file') {
      if (el.value === '__add') { el.value = st.fileId; ctl.addScore(); return; }
      if (el.value === '__remove') { el.value = st.fileId; ctl.removeScore(); return; }
      ctl.switchTo(el.value); return;
    }
    else if (el.dataset.tabcls) {
      const c = S.classes.find(x => x.id === el.dataset.tabcls); if (!c) return;
      if (el.checked && !c.resources.some(r => r.scoreTab)) c.resources.push({ id: Math.random().toString(36).slice(2, 12), title: 'Scores', scoreTab: true, score: { fileId: st.fileId, name: st.name || S.files[st.fileId]?.name } });
      if (!el.checked) c.resources = c.resources.filter(r => !r.scoreTab);
      save(); if (typeof P !== 'undefined') P.stageKey = '';
      return;
    }
    else if (el.dataset.ctlbox) {
      const hid = new Set(S.settings.spHidden ?? SP_DEFAULT_HIDDEN); el.checked ? hid.delete(el.dataset.ctlbox) : hid.add(el.dataset.ctlbox);
      S.settings.spHidden = [...hid]; save(); spApplyAll(); return;
    }
    else if (k === 'solMinor') { S.settings.solMinor = el.value; save(); ctl.drawLabels(); return; }
    else if (k === 'rhythmSystem') { S.settings.rhythmSystem = el.value; save(); ctl.drawLabels(); if (typeof refreshRhythmCounts === 'function') refreshRhythmCounts(); return; }
    else if (k === 'view') { st.view = el.value; onChange(); ctl.applyView(); return; }
    else if (k === 'countIn') st.countIn = Number(el.value);
    else if (k === 'metronome') st.metronome = el.checked;
    else if (k === 'countEvery') st.countEvery = el.checked;
    else if (k === 'pitches') st.pitches = el.value;
    else if (k === 'speedOn') st.speed.on = el.checked;
    else if (k === 'speedStart') st.speed.start = Math.max(30, Math.min(100, Number(el.value) || 70));
    else if (k === 'speedStep') st.speed.step = Math.max(1, Math.min(25, Number(el.value) || 5));
    else if (k === 'gradeLine') { st.gradeLine = Number(el.value); onChange(); ctl.updateBar(); return; }
    else if (k === 'gradeVoice') { st.gradeVoice = el.value; onChange(); return; }
    else if (k === 'gradeGuide') { st.gradeGuide = el.checked; onChange(); return; }
    else if (k === 'recGuide') { st.recGuide = el.checked; onChange(); return; }
    else if (k === 'recSelfGuide') { st.recSelfGuide = el.checked; onChange(); return; }
    else if (el.dataset.sppart != null) {
      const i = +el.dataset.sppart;
      (st.parts[i] ||= {}).on = el.checked;
      root.querySelectorAll(`input[data-sppart="${i}"]`).forEach(chk => { if (chk !== el) chk.checked = el.checked; });
      ctl.paint();
    }
    else if (k === 'colorParts') { st.colorParts = el.checked; ctl.paint(); }
    else return;
    onChange(); ctl.updateBar(); ctl.drawSel();
  });
  let rt = null;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => ctl.relayout(), 200); }).observe($q('.sp-score'));
  // ----- load
  (async () => {
    try {
      status('Opening the score…');
      const xml = await spGetXml(st, status);
      ctl.sc = spParse(xml);
      if (!ctl.sc.measures.length) throw new Error('no measures found');
      await spLoadVocalRecs(ctl);
      status('Drawing the music…');
      await spLoadScript('vendor/osmd.min.js');
      const O = window.opensheetmusicdisplay;
      ctl.osmd = new O.OpenSheetMusicDisplay($q('.sp-osmd'), { autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawCredits: false, drawingParameters: 'compacttight', followCursor: false, renderSingleHorizontalStaffline: st.layout === 'h' });
      ctl.applyNums(); ctl.applySpacing();
      { const R = ctl.osmd.EngravingRules; if (R) { R.PageTopMargin = 1; R.TitleTopDistance = 1; } }
      await ctl.osmd.load(xml);
      ctl.osmd.zoom = st.zoom; ctl.drawChoir(); ctl.drawVoices();
      if (st.settingsOpen) { const sp = $q('.sp-settings'); sp.hidden = false; sp.innerHTML = settingsHTML(); }
      ctl.updateBar();
      ctl.applyCtl();   // controls shown unless you hide them
      if ((st.view || 'all') !== 'all') ctl.applyView(); else { ctl.lastW = 0; ctl.relayout(); }
      status('Loading the piano…');
      await spPianoReady(ctl.sc.events.map(e => e.midi));
      ctl.updateBar();
    } catch (err) {
      status('Error: ' + (err.message || err));
    }
  })();
  ctl.fillFiles(); S.settings.lastScore = st.fileId; ctl.applyCtl();
  ctl.startAt = Math.min(st.loop.a, st.loop.b) || 0;
  ctl.updateBar();
  return ctl;
}
// Space bar plays / stops the score you used last (unless you're typing).
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || (window.__spaceTarget && window.__spaceTarget !== 'sp') || !SP_ACTIVE || !SP_ACTIVE.root.isConnected || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
  if (SP_ACTIVE.playing) spStop(); else if (SP_ACTIVE.sc) spPlay(SP_ACTIVE);
});
// ---------- warm-up in the background, so the Scores tab opens fast
// A few seconds after the app opens (and when the class changes) quietly load the notation library and
// piano, read the scores this class uses, and draw this class's score tab off-screen so it's ready.
let SP_WARM_KEY = '';
async function spPrewarm() {
  try {
    if (typeof context !== 'function' || typeof S === 'undefined') return;
    const ctx = context(now()), cls = ctx.mode === 'class' ? ctx.cls : null;
    const key = (cls?.id || '') + '|' + (S.settings.lastScore || '');
    if (key === SP_WARM_KEY) return; SP_WARM_KEY = key;
    const tabs = cls ? cls.resources.filter(r => r.score) : [];
    const ids = [...new Set([...tabs.map(r => r.score.fileId), S.settings.lastScore].filter(id => id && S.files[id]))];
    if (!ids.length) return;
    await spLoadScript('vendor/osmd.min.js');
    for (const id of ids.slice(0, 4)) {
      const st = tabs.find(r => r.score.fileId === id)?.score || { fileId: id, name: S.files[id]?.name };
      if (/\.(mscz|mscx)$/i.test(S.files[id].name) && !(st.xmlId && S.files[st.xmlId])) continue;   // don't start a MuseScore conversion unasked
      const xml = await spGetXml(st, () => { });
      await spPianoReady(spParse(xml).events.map(e => e.midi));
    }
    // draw the first score tab of this class off-screen, at the size the stage will show it
    const r = tabs[0], k = r && 'r' + r.id + 's';
    if (r && !SP_CACHE[k]) {
      const sc = document.querySelector('#stage-content'), w = sc?.clientWidth || 1000, h = sc?.clientHeight || 700;
      const host = document.createElement('div');
      host.className = 'score-host'; host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: w + 'px', height: h + 'px', visibility: 'hidden' });
      document.body.appendChild(host);
      mountScore(host, r.score, () => save(), k);
      setTimeout(() => { if (host.isConnected && !host.contains(SP_CACHE[k]?.root)) host.remove(); }, 60000);
    }
  } catch { }
}
setTimeout(spPrewarm, 2500);
setInterval(spPrewarm, 30000);
window.mountScore = mountScore;
window.spIsScoreName = spIsScoreName;
window.spLibrary = spLibrary;
if (typeof mountSightHosts === 'function') mountSightHosts();
