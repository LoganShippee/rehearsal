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
  clearInterval(SP_PLAY.timer); SP_PLAY.timer = null; cancelAnimationFrame(SP_PLAY.raf);
  try { SP_PLAY.master && SP_PLAY.master.disconnect(); } catch { }
  const ctl = SP_PLAY.ctl; SP_PLAY.master = null; SP_PLAY.ctl = null;
  if (ctl) { ctl.playing = false; ctl.updateBar(); ctl.hidePlayhead(); }
}
function spDefaults(st) {
  st.tempo ??= 100; st.countIn ??= 1; st.metronome ??= false; st.pitches ??= 'none';
  st.loop ||= { on: false, a: 0, b: 0 }; st.speed ||= { on: false, start: 70, step: 5 }; st.parts ||= {}; st.zoom ??= 0.8;
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
// the focused line plays out; other voices drop way down, accompaniment a little less
function spLineVol(ctl, i) {
  const st = ctl.st, L = ctl.sc.lines[i], base = st.parts[i]?.vol ?? 1;
  const F = spFoc(st).filter(f => ctl.sc.lines[f]); if (!F.length) return base;
  return base * (F.includes(i) ? 1.3 : L.acc ? 0.35 : 0.2);
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
function spPlay(ctl) {
  spStop();
  const { sc, st } = ctl, c = ac(); c.resume && c.resume();
  SP_ACTIVE = ctl;
  const master = c.createGain(); master.gain.value = 0.9; master.connect(musicOut(c));
  const gains = sc.lines.map((_, i) => { const g = c.createGain(); g.gain.value = spLineVol(ctl, i); g.connect(master); return g; });
  Object.assign(SP_PLAY, { ctl, master });
  ctl.gains = gains; ctl.playing = true; ctl.iter = 0; ctl.updateBar();
  let R = spRange(ctl), iter = 0;
  const factor = () => (Number(st.tempo) || 100) / 100 * (st.speed.on ? Math.min(1, ((Number(st.speed.start) || 70) + (Number(st.speed.step) || 5) * iter) / 100) : 1);
  const secPerQ = q => 60 / spBpmAt(sc, q) / factor();
  // count-in, and starting pitches (each part that's playing, from its first note in the range).
  // Returns how long it lasts; used at the start and (optionally) before every repeat of the loop.
  const countIn = (t0, first) => {
    const p0 = sc.perf.find(m => m.start <= R.a + 1e-9 && R.a < m.start + m.len), m0 = (p0 && sc.measures[p0.w]) || sc.measures[0];
    const compound = m0.bt === 8 && m0.beats % 3 === 0 && m0.beats > 3, bu = compound ? 1.5 : 4 / m0.bt, nb = compound ? m0.beats / 3 : m0.beats;
    const beatSec = bu * secPerQ(R.a);
    let bars = Number(st.countIn) || 0; if (st.pitches !== 'none' && !bars) bars = 1;
    if (!first && !bars) return 0;
    for (let k = 0; k < bars * nb; k++) spClick(master, t0 + k * beatSec, k % nb === 0);
    if (st.pitches !== 'none') {
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
  const t0 = c.currentTime + 0.15;
  const walker = { q: R.a, t: t0 + countIn(t0, true) };
  ctl.marks = [{ t: c.currentTime, q: R.a, hold: true }, { t: walker.t, q: R.a }];
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
    const nr = spRange(ctl);                                     // loop range / loop on-off can change while playing
    if (nr.a !== R.a || nr.b !== R.b || nr.loop !== R.loop) {
      R = nr;
      if (walker.q < R.a - 1e-9 || walker.q >= R.b - 1e-9) { walker.q = R.a; ctl.marks.push({ t: walker.t, q: R.a, jump: true }); }
      si = firstIdx(walker.q);
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
          const len = Math.min(e.q + e.dur, R.b) - e.q;
          spPianoNote(ctl.gains[e.line], Math.max(now, walker.t), e.midi, len * sp * 0.97);
        }
        if (s.beat && st.metronome) spClick(master, Math.max(now, walker.t), s.beat.accent);
        si++;
      } else {
        walker.t += (R.b - walker.q) * secPerQ(walker.q); walker.q = R.b; ctl.marks.push({ t: walker.t, q: R.b });
        if (R.loop) {
          iter++; walker.q = R.a; si = firstIdx(R.a); ctl.iter = iter;
          ctl.marks.push({ t: walker.t, q: R.a, jump: true, hold: true });
          if (st.countEvery) { walker.t += countIn(walker.t, false); ctl.marks.push({ t: walker.t, q: R.a }); }   // count in again
        }
        else ending = walker.t;
      }
    }
    if (ctl.marks.length > 400) ctl.marks = ctl.marks.filter(m => m.t > now - 2).concat([]);
    if (ending && now > ending + 0.3) spStop();
  };
  step(); SP_PLAY.timer = setInterval(step, 25);
  const frame = () => { if (SP_PLAY.ctl !== ctl) return; ctl.drawPlayhead(spHeardTime(c)); SP_PLAY.raf = requestAnimationFrame(frame); };
  SP_PLAY.raf = requestAnimationFrame(frame);
}

// ---------- UI
function spApplyAll() { Object.values(SP_CACHE).forEach(c => c.root?.isConnected && c.applyCtl?.()); }
// Score practice bar: the same movable bar and standard order as sight reading
// (what's on the page → playing it → what's written on the music → tools)
const SP_BARCFG = { key: 'spBar', ctl: true, defaults: ['file', 'play', 'tempo', 'metronome', 'loop', 'range', 'spots', 'nums', 'solfege', 'counts', 'layout', 'gap', 'tabs', 'zoom', 'settings'], groups: ['play', 'nums'] };
const SP_CACHE = {};
function mountScore(host, st, onChange0, key) {
  spDefaults(st);
  // every change is also remembered per score, so reopening or switching back restores it
  const onChange = () => { try { (S.scoreSettings ||= {})[st.fileId] = JSON.parse(JSON.stringify(st)); } catch { } onChange0 && onChange0(); };
  const ck = key || st.fileId;
  const cached = SP_CACHE[ck];
  if (cached && cached.st === st && cached.root) {             // re-attach the already-drawn score
    host.innerHTML = ''; host.appendChild(cached.root); cached.host = host; cached.relayout(); cached.fillFiles?.(); return cached;
  }
  if (cached && SP_PLAY.ctl === cached) spStop();
  const root = document.createElement('div'); root.className = 'sp-root';
  const BAR = {
    file: () => `<span class="sp-grp"><select class="sp-file" data-spk="file" title="Switch score"></select><button data-sp="addscore" title="Add a score file (MusicXML / MuseScore)">＋</button></span>`,
    play: () => `<button data-sp="play" class="sp-primary">${IC('ico:play')} Play</button>`,
    tempo: () => `<span class="sp-step" title="Tempo (beats per minute). The small number is the speed compared with the score."><button data-sp="tempo-step" data-d="-5" title="Slower">−</button><output class="sp-bpm"></output><button data-sp="tempo-step" data-d="5" title="Faster">+</button></span>`,
    metronome: () => `<button data-sp="metro" title="Metronome clicks while playing">${IC('ico:metro')} Metronome</button>`,
    loop: () => `<button data-sp="loop" title="Loop the selected measures (click or drag on the music to choose them)">${IC('ico:repeat')} <span class="sp-looplbl">Loop</span></button>`,
    range: () => `<span class="sp-range">m. <input type="number" min="1" data-spk="from" title="First measure"> – <input type="number" min="1" data-spk="to" title="Last measure"></span>`,
    spots: () => `<button data-sp="spots" title="Rehearsal list: saved spots to step through">${IC('ico:agenda')} Spots</button>`,
    nums: () => `<button data-sp="nums" title="Number every measure">${IC('ico:hash')} Measure #</button>`,
    solfege: () => `<button data-sp="lbl" data-v="solfege" title="Solfege syllables above the notes (movable do)">${IC('ico:music')} Solfege</button>`,
    counts: () => `<button data-sp="lbl" data-v="counts" title="Rhythm counting above the notes (1 e & a)">${IC('ico:list')} Counts</button>`,
    layout: () => `<button data-sp="layout" title="Switch between scrolling down the page and one long line scrolling sideways"></button>`,
    tabs: () => `<button data-sp="tabs" title="Keep a Scores tab on the class screen of the classes you choose">${IC('ico:layers')} Classes</button>`,
    zoom: () => `<span class="sp-zoom"><button data-sp="zoom" data-d="-0.1" title="Smaller">${IC('ico:zoomout')}</button><button data-sp="zoom" data-d="0.1" title="Bigger">${IC('ico:zoomin')}</button></span>`,
    settings: () => `<button data-sp="settings" title="Settings: count-in, voices, speed-up, and which buttons show here">${IC('ico:sliders')} Settings</button>`,
  };
  root.innerHTML = `<div class="sp-top">${mbarHTML(SP_BARCFG, BAR)}</div>
    <div class="sp-custom" hidden></div>
    <div class="sp-tabs sp-custom" hidden></div>
    <div class="sp-spots" hidden></div>
    <div class="sp-choir" hidden></div>
    <div class="sp-settings" hidden></div>
    <div class="sp-hint"></div>
    <div class="sp-score"><div class="sp-osmd"></div><div class="sp-ov"><div class="sp-sel"></div><div class="sp-lbls"></div><div class="sp-ph" hidden></div></div></div>`;
  host.innerHTML = ''; host.appendChild(root);
  const $q = s => root.querySelector(s);
  const ctl = { st, host, root, sc: null, osmd: null, playing: false, marks: [], startAt: 0, iter: 0, pick: null };
  SP_CACHE[ck] = ctl;
  const status = msg => { $q('.sp-hint').textContent = msg || ''; };
  const mNum = i => ctl.sc?.measures[i]?.num ?? String(i + 1);
  const mIdx = txt => { const M = ctl.sc?.measures || []; const i = M.findIndex(m => m.num === String(txt).trim()); return i >= 0 ? i : Math.max(0, Math.min(M.length - 1, (parseInt(txt) || 1) - 1)); };
  const SP_CTLS = [
    ['Top bar', [['file', 'Score list'], ['play', 'Play'], ['tempo', 'Tempo'], ['metronome', 'Metronome'], ['loop', 'Loop'], ['range', 'Measure range boxes'], ['layout', 'Down / Sideways'], ['nums', 'Measure #'], ['solfege', 'Solfege'], ['counts', 'Counts'], ['spots', 'Spots'], ['tabs', 'Classes (tab)'], ['zoom', 'Size − ＋']]],
    ['Choir row', [['focus', 'Focus buttons'], ['pitches', 'Starting pitch buttons'], ['colour', 'Colour parts'], ['show', 'Show (staves)']]],
    ['Settings', [['countin', 'Count-in'], ['countevery', 'Count in every repeat'], ['startpitch', 'Starting pitches'], ['solminor', 'Minor: do- / la-based'], ['speedup', 'Speed up each repeat'], ['mixer', 'Parts & volumes'], ['sync', 'Sound / playhead sync'], ['help', 'Help text']]],
  ];
  ctl.applyCtl = () => {
    const hid = new Set(S.settings.spHidden ?? ['help', 'range']);
    root.querySelectorAll('[data-ctl]').forEach(el => { el.hidden = hid.has(el.dataset.ctl); });
    const ch = $q('.sp-choir');                                      // hide the choir row if everything in it is hidden
    if (ch && ctl.sc) ch.classList.toggle('sp-empty', ['focus', 'pitches', 'colour', 'show'].every(k => hid.has(k)));
    mbarLayout($q('.sp-top'), SP_BARCFG);
  };
  // the bar's buttons can be dragged anywhere, like sight reading (saved for every score)
  ctl.rebuildBar = () => {
    $q('.sp-top').innerHTML = mbarHTML(SP_BARCFG, BAR);
    ctl.fillFiles?.(); ctl.updateBar?.(); ctl.applyCtl();
  };
  const barDrag = mbarDrag(root, SP_BARCFG, '.sp-top', () => ctl.rebuildBar());
  root.addEventListener('pointerdown', e => barDrag.down(e));
  { let t; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => mbarLayout($q('.sp-top'), SP_BARCFG), 60); }).observe(root); }
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
      st.zoom = +zz.toFixed(2); onChange(); ctl.osmd.zoom = st.zoom; ctl.lastW = 0; ctl.relayout();
      const k = st.zoom / A.z0;                                        // keep the spot under the fingers where it was
      sc.scrollLeft = (A.sx + A.px) * k - A.px; sc.scrollTop = (A.sy + A.py) * k - A.py;
    }, 220);
  };
  root.__zoomBy = ctl.zoomBy;                                          // the Mac app's trackpad pinch (app.js → __pinch)
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
    const hid = new Set(S.settings.spHidden ?? ['help', 'range']);
    box.innerHTML = `<div class="sp-spots-head"><b>${IC('ico:eye')} Buttons to show</b><span class="sp-sp"></span><button data-sp="custom-all">Show all</button><button data-sp="custom" class="sp-primary">Done</button></div>
      <div class="sp-cust-cols">${SP_CTLS.map(([h, items]) => `<div><div class="sp-lbl">${h}</div>${items.map(([k, l]) => `<label class="srchk"><input type="checkbox" data-ctlbox="${k}" ${hid.has(k) ? '' : 'checked'}> ${l}</label>`).join('')}</div>`).join('')}</div>
      <div class="sp-note">Applies to every score. Settings always stays. Drag any button on the bar to move it. <button data-sp="barreset">Reset layout</button></div>`;
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
        <button data-sp="spot-add" class="sp-primary" title="Save the current loop, focus part and tempo as a spot">＋ Save current loop</button></div>
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
    onChange(); ctl.updateBar(); ctl.drawSel(); ctl.drawChoir(); ctl.paint(); ctl.drawSpots();
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
    const f = $q('[data-spk="from"]'), t = $q('[data-spk="to"]');
    if (document.activeElement !== f) f.value = mNum(Math.min(st.loop.a, st.loop.b));
    if (document.activeElement !== t) t.value = mNum(Math.max(st.loop.a, st.loop.b));
    const bpm = ctl.sc ? Math.round(spBpmAt(ctl.sc, ctl.sc.measures[Math.min(st.loop.a, st.loop.b)]?.start || 0) * st.tempo / 100) : '';
    const ramp = st.speed.on && ctl.playing ? ` · ramp ${Math.min(100, (+st.speed.start || 70) + (+st.speed.step || 5) * (ctl.iter || 0))}%` : '';
    $q('.sp-bpm').innerHTML = `${bpm || st.tempo + '%'}<small>${bpm ? 'BPM · ' + st.tempo + '%' : 'tempo'}${ramp}</small>`;
    $q('[data-sp="metro"]').classList.toggle('on', !!st.metronome);
    const open = st.settingsOpen !== false; root.classList.toggle('sp-closed', !open); $q('[data-sp="settings"]').classList.toggle('on', open);
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
      <label data-ctl="startpitch">Starting pitches <select data-spk="pitches">${opt('none', st.pitches, 'None')}${opt('mine', st.pitches, 'Parts that are playing')}${opt('all', st.pitches, 'All parts (chord)')}</select></label>
      <span class="sp-grp" data-ctl="speedup"><label class="srchk"><input type="checkbox" data-spk="speedOn" ${st.speed.on ? 'checked' : ''}> Speed up each repeat</label>
      <label>start at <input type="number" min="30" max="100" step="5" data-spk="speedStart" value="${st.speed.start}">%</label>
      <label>+<input type="number" min="1" max="25" data-spk="speedStep" value="${st.speed.step}">% per loop</label></span>
    </div>
    <div class="sp-parts" data-ctl="mixer">${(ctl.sc?.lines || []).map((p, i) => `<label class="sp-part"><input type="checkbox" data-sppart="${i}" ${st.parts[i]?.on === false ? '' : 'checked'}> <span>${esc(p.name)}</span>
      <input type="range" min="0" max="1.5" step="0.05" data-spvol="${i}" value="${st.parts[i]?.vol ?? 1}" title="Volume"></label>`).join('')}</div>
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
  const spCount = (dq, m) => {
    const compound = m.bt === 8 && m.beats % 3 === 0 && m.beats > 3, bu = compound ? 1.5 : 4 / m.bt;
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
            const txt = st.labels === 'solfege' ? spSyl(pc, m) : spCount(dq, m);
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
    const w = $q('.sp-score').clientWidth; if (!w || w === ctl.lastW) { BOX = boxes(); ctl.drawSel(); ctl.drawLabels(); return; }
    ctl.lastW = w;
    try { ctl.osmd.render(); } catch { }
    BOX = boxes(); ctl.drawSel(); ctl.tagNotes(); ctl.drawLabels();
  };
  // ----- events
  root.addEventListener('pointerdown', () => { SP_ACTIVE = ctl; window.__spaceTarget = 'sp'; });
  root.addEventListener('click', e => {
    if (root.__noClick && e.target.closest('.sp-top')) { e.stopPropagation(); return; }   // that was a drag
    const b = e.target.closest('[data-sp]');
    if (b) {
      e.stopPropagation(); SP_ACTIVE = ctl;
      const k = b.dataset.sp;
      if (k === 'play') { if (ctl.playing) spStop(); else if (ctl.sc) spPlay(ctl); }
      if (k === 'tempo-step') { st.tempo = Math.max(30, Math.min(150, st.tempo + Number(b.dataset.d))); ctl.updateBar(); onChange(); }
      if (k === 'metro') { st.metronome = !st.metronome; onChange(); ctl.updateBar(); }
      if (k === 'loop') { st.loop.on = !st.loop.on; ctl.pick = null; onChange(); ctl.updateBar(); ctl.drawSel(); }
      if (k === 'zoom') { st.zoom = Math.max(0.3, Math.min(2.5, +(st.zoom + Number(b.dataset.d)).toFixed(2))); onChange(); if (ctl.osmd) { ctl.osmd.zoom = st.zoom; ctl.lastW = 0; ctl.relayout(); } }
      if (k === 'focus') {
        if (b.dataset.i === '') st.focus = null;
        else { const F = new Set(spFoc(st)), i = +b.dataset.i; F.has(i) ? F.delete(i) : F.add(i); st.focus = F.size ? [...F].sort((x, y) => x - y) : null; } onChange(); ctl.drawChoir(); ctl.paint(); ctl.drawLabels(); if ((st.view || 'all') === 'focus') ctl.applyView(); }
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
    if (el.dataset.spvol != null) { const i = +el.dataset.spvol; (st.parts[i] ||= {}).vol = Number(el.value); onChange(); }
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
      const hid = new Set(S.settings.spHidden ?? ['help']); el.checked ? hid.delete(el.dataset.ctlbox) : hid.add(el.dataset.ctlbox);
      S.settings.spHidden = [...hid]; save(); spApplyAll(); return;
    }
    else if (k === 'solMinor') { S.settings.solMinor = el.value; save(); ctl.drawLabels(); return; }
    else if (k === 'view') { st.view = el.value; onChange(); ctl.applyView(); return; }
    else if (k === 'countIn') st.countIn = Number(el.value);
    else if (k === 'metronome') st.metronome = el.checked;
    else if (k === 'countEvery') st.countEvery = el.checked;
    else if (k === 'pitches') st.pitches = el.value;
    else if (k === 'speedOn') st.speed.on = el.checked;
    else if (k === 'speedStart') st.speed.start = Math.max(30, Math.min(100, Number(el.value) || 70));
    else if (k === 'speedStep') st.speed.step = Math.max(1, Math.min(25, Number(el.value) || 5));
    else if (el.dataset.sppart != null) { (st.parts[+el.dataset.sppart] ||= {}).on = el.checked; ctl.paint(); }
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
      status('Drawing the music…');
      await spLoadScript('vendor/osmd.min.js');
      const O = window.opensheetmusicdisplay;
      ctl.osmd = new O.OpenSheetMusicDisplay($q('.sp-osmd'), { autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawCredits: false, drawingParameters: 'compacttight', followCursor: false, renderSingleHorizontalStaffline: st.layout === 'h' });
      ctl.applyNums(); ctl.applySpacing();
      { const R = ctl.osmd.EngravingRules; if (R) { R.PageTopMargin = 1; R.TitleTopDistance = 1; } }
      await ctl.osmd.load(xml);
      ctl.osmd.zoom = st.zoom; ctl.drawChoir();
      if (st.settingsOpen !== false) { const sp = $q('.sp-settings'); sp.hidden = false; sp.innerHTML = settingsHTML(); }
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
  if (e.code !== 'Space' || e.repeat || window.__spaceTarget === 'sr' || !SP_ACTIVE || !SP_ACTIVE.root.isConnected || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
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
