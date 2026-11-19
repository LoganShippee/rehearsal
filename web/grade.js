// ---------- Grading: listen to the microphone while the student performs a sight-reading example,
// then compare what was heard with the written rhythm (and pitch class for solfege).
// Works on one-line examples. Pure analysis (grAnalyze) is separate from the microphone code.

const GR = { on: false, stream: null, an: null, buf: null, poll: 0, frames: [], timer: null, host: null, exp: null, q: 0, T0: 0, end: 0, gradePitch: false, btn: null };
const GR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
// Pitch reading for singing: sung range only (about E2–C6), and only frames that are clearly a pitch.
const GR_PITCH_OPTS = { minHz: 70, maxHz: 1100, minClarity: 0.6 };
// Pitch is read at any level the loudness detector would count as singing. A fixed level is wrong
// here: built-in Mac mics often peak around 0.01–0.03, and the tuner's 0.012 hid most of a take.
// Noise is kept out by the clarity check instead.
const GR_MIN_RMS = 0.0015;
const grName = m => m == null ? '' : GR_NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

// Expected sounding notes from the example's timeline (quarter-note units from bar 1).
// Voice choices for grading: the written pitch is moved by whole octaves so the report names the
// notes the singer actually sings. Pitch is compared by pitch class, so the octave never makes a note wrong.
const GR_VOICES = [['written', 'Soprano / alto (as written)'], ['tenor', 'Tenor (1 octave lower)'], ['bass', 'Bass (1 octave lower)'], ['lowbass', 'Low bass (2 octaves lower)']];
const GR_VOICE_SHIFT = { written: 0, tenor: -12, bass: -12, lowbass: -24 };
// Only for treble clef: bass clef is already written at the pitch a bass sings, and moving it down
// again made the starting tone too low for laptop speakers to play (C2 = 65 Hz).
const grVoiceShift = st => { const o = st[st.mode] || {}; return o.clef === 'bass' ? 0 : GR_VOICE_SHIFT[o.gradeVoice] ?? 0; };
// a starting tone the speakers can actually play: never below G2 (98 Hz)
const grCueMidi = m => { while (m < 43) m += 12; return m; };

function grExpected(timeline, shift = 0) {
  const M = timeline.geo?.measures || [];
  const barOf = t => { let bi = 0; M.forEach((m, i) => { if (m.t0 <= t + 1e-6) bi = i; }); return bi; };
  const exp = []; let lastBar = -1, idxInBar = 0;
  for (const e of timeline) {
    if (e.rest || e.tiedFrom) continue;                        // only attacks are graded
    const bar = barOf(e.t);
    idxInBar = bar === lastBar ? idxInBar + 1 : 1; lastBar = bar;
    exp.push({ t: e.t, len: e.len, midi: e.midi == null ? null : e.midi + shift, bar: bar + 1, idx: idxInBar });
  }
  return exp;
}

// Detection (steps 1–2d): turns microphone readings into heard notes {t, end, midi}.
function grDetect(late, q, end) {
  // Pitch readings far outside the singer's range are not singing (a metronome click that leaks
  // through reads as a high note around A♭5): readings more than 14 semitones from the middle of
  // everything sung are dropped.
  {
    const ms = late.filter(fr => fr.f > 0).map(fr => 69 + 12 * Math.log2(fr.f / 440)).sort((x, y) => x - y);
    if (ms.length >= 5) {
      const c = ms[ms.length >> 1];
      late = late.map(fr => fr.f > 0 && Math.abs(69 + 12 * Math.log2(fr.f / 440) - c) > 14 ? { ...fr, f: -1 } : fr);
    }
    // Octave slips: low voices sometimes read exactly an octave off for a moment (E2 among E3s).
    // A reading 12 semitones from the readings around it (±0.3 s) is moved into their octave.
    const P = late.filter(fr => fr.f > 0).map(fr => ({ t: fr.t, m: 69 + 12 * Math.log2(fr.f / 440) }));
    const fixed = new Map();
    P.forEach(r => {
      const near = P.filter(o => o !== r && Math.abs(o.t - r.t) <= 0.3).map(o => o.m).sort((x, y) => x - y);
      if (near.length < 3) return;
      const c = near[near.length >> 1], k = Math.round((c - r.m) / 12);
      if (k !== 0 && Math.abs(r.m + 12 * k - c) < 0.7) fixed.set(r.t, r.m + 12 * k);
    });
    if (fixed.size) late = late.map(fr => fixed.has(fr.t) ? { ...fr, f: 440 * Math.pow(2, (fixed.get(fr.t) - 69) / 12) } : fr);
  }
  // 1. loudness threshold from the quiet part of the recording
  const sorted = late.map(fr => fr.rms).sort((a, b) => a - b);
  const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 0;
  // "loudest" is the 95th percentile, so one cough or bumped mic doesn't raise the threshold for everything
  const peak = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  // above the room's own noise (twice its quiet level), or a fraction of the singer's loudest moment;
  // never more than half of it, so soft singing in a noisier room still counts
  const thr = Math.min(Math.max(0.002, floor * 2, peak * 0.15), Math.max(0.002, peak * 0.5));
  // 2. onsets and sounding segments (with hysteresis and a short refractory time).
  // Loudness is smoothed over 30 ms so single noisy readings don't start or end notes.
  const env = late.map((fr, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - 1); j <= Math.min(late.length - 1, i + 1); j++) { s += late[j].rms; k++; } return s / k; });
  const det = []; let active = false, onT = 0, quietT = null, lastOn = -1;
  let top = 0, dipMin = Infinity, dipT = null, dipN = 0;       // re-attack tracking while a note sounds
  const close = endT => det.push({ t: onT, end: endT, midi: null });
  late.forEach((fr, i) => {
    const e = env[i];
    const loud = active ? e > thr * 0.5 : e > thr;
    if (!active && loud && fr.t - lastOn > 0.08) { active = true; onT = fr.t; lastOn = fr.t; quietT = null; top = e; dipMin = Infinity; dipT = null; dipN = 0; return; }
    if (!active) return;
    // A repeated note sung without a full stop ("do do", or a short break) still dips in loudness
    // at the consonant and then comes back: at least 20 ms below 70% of the note's average level,
    // then a rise of 1.5×, starts a new note. The average (not the loudest moment) is used so the
    // normal wobble of a held note (tremolo, vibrato) doesn't count as a new note.
    if (e < top * 0.7) { dipN++; if (e < dipMin) { dipMin = e; dipT = fr.t; } }
    else {
      if (dipT !== null && dipN >= 2 && e > thr && e > dipMin * 1.5 && fr.t - lastOn > 0.08) {
        close(dipT); onT = fr.t; lastOn = fr.t; quietT = null; top = e; dipMin = Infinity; dipT = null; dipN = 0; return;
      }
      dipMin = Infinity; dipT = null; dipN = 0;
      top += (e - top) * 0.15;                                  // the note's running average level
    }
    if (!loud) { if (quietT === null) quietT = fr.t; else if (fr.t - quietT > 0.05) { active = false; close(quietT); quietT = null; } }
    else quietT = null;
  });
  if (active) close(end);
  // 2b. sung notes usually flow into each other with no quiet gap, so the loudness detector finds
  // only one onset per phrase. Also start a new note when the sung pitch leaves the current note and
  // settles on a new one for about 120 ms (three agreeing readings, 40 ms apart). The note starts
  // where the pitch first left, so a scoop into the new note is part of it rather than an extra note.
  const mid = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pOn = []; let curMs = [], curTs = [], run = [], departT = null;
  for (const fr of late) {
    if (!(fr.f > 0)) continue;
    const m = 69 + 12 * Math.log2(fr.f / 440);
    if (!curMs.length) { curMs.push(m); curTs.push(fr.t); continue; }
    if (Math.abs(m - mid(curMs.slice(-12))) > 0.5) {   // compared with the note's settled pitch, so a slow glide into the next note still counts
      if (departT === null) departT = fr.t;
      if (run.length && Math.abs(m - mid(run.map(r => r.m))) > 0.5) run = [];   // still moving (a scoop): wait for it to settle
      run.push({ t: fr.t, m });
      if (run.length >= 3) {
        const mm = mid(run.map(r => r.m));
        // a slide of less than a semitone in the first quarter second of a note is a scoop into that
        // note, not a new note (otherwise a scooped first note was graded by its flat start)
        const lastOn = Math.max(-Infinity, ...det.filter(d => d.t <= departT).map(d => d.t), ...pOn.filter(p => p.t <= departT).map(p => p.t));
        const small = departT - lastOn < Math.min(0.35, 0.45 * q) && Math.abs(mm - mid(curMs.slice(-12))) < 1.0;
        if (!small) pOn.push({ t: departT, midi: mm, pitchOnly: true });
        curMs = run.map(r => r.m); curTs = run.map(r => r.t); run = []; departT = null;
      }
    } else { run = []; departT = null; curMs.push(m); curTs.push(fr.t); }
  }
  for (const p of pOn) {
    const near = det.findIndex(d => Math.abs(d.t - p.t) < 0.1);
    if (near >= 0) det[near].midi = p.midi; else det.push({ t: p.t, end: p.t, midi: p.midi, pitchOnly: true });
  }
  det.sort((a, b) => a.t - b.t);
  // 2c. each heard note's pitch: median of its steady middle, skipping the scoop at the start and the
  // slide into the next note. Short notes fall back to the whole note, then to the reading found above.
  det.forEach((d, i) => {
    const stop = Math.min(i + 1 < det.length ? det[i + 1].t : end, d.end > d.t ? d.end : end);
    const dur = stop - d.t;
    const pick = (a, b) => late.filter(fr => fr.f > 0 && fr.t >= a && fr.t < b).map(fr => 69 + 12 * Math.log2(fr.f / 440));
    let ms = pick(d.t + Math.min(0.12, 0.3 * dur), stop - Math.min(0.04, 0.15 * dur));
    if (ms.length < 2) ms = pick(d.t, stop);
    if (ms.length >= 2 || (ms.length === 1 && d.midi == null)) d.midi = mid(ms);
  });
  // 2d. joins: a note that starts only because the pitch moved (no new attack in the loudness) is
  // joined to the note before it when (a) that note was short and the move was under a semitone (a
  // scoop into the note: it takes the later, settled pitch), or (b) both settle on the same pitch
  // (a wobble in the middle of a held note).
  for (let k = det.length - 1; k > 0; k--) {
    const a = det[k - 1], b = det[k];
    if (!b.pitchOnly || a.midi == null || b.midi == null) continue;
    const scoop = b.t - a.t < Math.min(0.35, 0.45 * q) && Math.abs(b.midi - a.midi) < 1.0;
    const wobble = Math.abs(b.midi - a.midi) < 0.4;
    if (scoop || wobble) { if (scoop) a.midi = b.midi; a.end = Math.max(a.end, b.end); det.splice(k, 1); }
  }
  return { late, env, floor, peak, thr, det };
}

// Space-bar taps: each tap (audio-clock seconds) is a heard note with no pitch. Taps more than a
// little before the first beat belong to the count-in and are ignored.
function grTapDetect(taps, q, T0, end) {
  const lo = T0 - Math.min(0.25, 0.5 * q);
  const det = taps.filter(t => t >= lo && t <= end).sort((a, b) => a - b).map(t => ({ t, end: t, midi: null, tap: true }));
  return { late: [], env: [], floor: 0, peak: 0, thr: 0, det };
}

// Pure analysis: frames = [{t (seconds), rms, f (Hz or -1)}] from the microphone.
// Returns the rhythm and pitch results, one entry per expected note, and the notes played that were not written.
// lat (seconds, optional): the expected delay between a written beat and hearing it sung on time
// (speaker delay + the Sound / playhead sync setting). Without it, any steady lateness is forgiven.
// taps (optional): space-bar tap times instead of microphone frames (rhythm only).
function grAnalyze(frames, exp, q, T0, end, gradePitch, lat = null, taps = null) {
  if (taps) gradePitch = false;
  const { late, env, floor, peak, thr, det } = taps ? grTapDetect(taps, q, T0, end) : grDetect(frames.filter(fr => fr.t >= T0 - 0.1 && fr.t <= end), q, end);
  const mid = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  // 3. timing offset: median gap between each written note and the nearest heard onset
  // Every offset from a little early to well late is tried; the one that lines up the most written
  // notes with a heard onset wins (ties go to the smaller offset). Taking the nearest onset
  // instead can lock onto the note before or after when the singer is steadily late.
  // Timing is always measured against the singer's own steady pulse: speaker and mic delays differ
  // from Mac to Mac and from take to take, so comparing with a fixed delay gave inconsistent scores.
  const base = 0, hit = Math.max(0.05, Math.min(0.08, 0.2 * q));
  const nearest = c => exp.map(e => { let b = null; for (const d of det) { const g = d.t - (T0 + e.t * q + c); if (Math.abs(g) <= hit && (b === null || Math.abs(g) < Math.abs(b))) b = g; } return b; }).filter(g => g !== null);
  let bestC = base, bestN = -1;
  for (let c = -0.15; c <= 0.8 + 1e-9; c += 0.01) {
    const k = nearest(c).length;
    if (k > bestN || (k === bestN && Math.abs(c - base) < Math.abs(bestC - base))) { bestN = k; bestC = c; }
  }
  const diffs = nearest(bestC);
  const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const heardOffset = bestC + med(diffs);
  const offset = heardOffset, latUsed = false;
  // 4. match each written note to one heard onset, closest first, within a window
  const used = new Set(); const notes = [];
  for (const e of exp) {
    const target = T0 + e.t * q + offset, tol = Math.max(0.06, Math.min(0.25 * q, 0.4 * e.len * q));
    const win = Math.max(tol, 0.5 * e.len * q, 0.25 * q);
    let bj = -1, bd = Infinity;
    det.forEach((d, j) => { if (used.has(j)) return; const g = Math.abs(d.t - target); if (g <= win && g < bd) { bd = g; bj = j; } });
    const n = { bar: e.bar, idx: e.idx, written: e.midi, status: 'missed', errMs: null, cents: null, match: null };
    if (bj >= 0) { used.add(bj); n.match = det[bj]; n.errMs = Math.round((det[bj].t - target) * 1000); n.status = Math.abs(det[bj].t - target) <= tol ? 'ok' : 'timing'; }
    notes.push(n);
  }
  // 4b. guided split: a written note that matched nothing, while the note before it was still
  // sounding, is looked for inside that note: where the sung pitch moves by the written step
  // (e.g. F down to E). A smooth glide between close notes has no clear jump to find otherwise,
  // and the two notes were graded as one (the first one wrong, the second "not heard").
  if (gradePitch) {
    const pitched = late.filter(fr => fr.f > 0).map(fr => ({ t: fr.t, m: 69 + 12 * Math.log2(fr.f / 440) }));
    notes.forEach((n, i) => {
      // also retried for a note matched only loosely (outside the on-time margin): a split inside
      // the note before it, closer to where this note is written, is the better match
      if ((n.match && n.status !== 'timing') || i === 0 || exp[i].midi == null || exp[i - 1].midi == null) return;
      const p = notes[i - 1].match; if (!p || p.midi == null || p === n.match) return;
      const e = exp[i], target = T0 + e.t * q + offset, tol = Math.max(0.06, Math.min(0.25 * q, 0.4 * e.len * q));
      // search up to the next sung note that matched a written one (leftover sounds don't stop it)
      const matchedLater = new Set(notes.slice(i + 1).map(x => x.match).filter(Boolean));
      const win = Math.max(tol, 0.5 * e.len * q, 0.25 * q), nextOn = det.find(d => d.t > p.t + 1e-6 && matchedLater.has(d))?.t ?? end;
      const split = t => {
        if (n.match && Math.abs(t - target) >= Math.abs(n.match.t - target)) return;   // not better than what it has
        const before = pitched.filter(r => r.t > p.t + 0.08 && r.t < t - 0.02).map(r => r.m);
        const after = pitched.filter(r => r.t >= t + 0.04 && r.t < Math.min(nextOn, t + 0.4)).map(r => r.m);
        const nd = { t, end: p.end > t ? p.end : end, midi: after.length ? mid(after) : p.midi, guided: true };
        p.end = t; if (before.length >= 2) p.midi = mid(before);
        det.push(nd); det.sort((a, b) => a.t - b.t);
        n.match = nd; n.errMs = Math.round((t - target) * 1000); n.status = Math.abs(t - target) <= tol ? 'ok' : 'timing';
      };
      // the same pitch again: the singer re-sings it with a consonant, so the loudness dips and
      // comes back. The deepest dip near where the note is written (at most 80% of the note's level)
      // marks the new note; a note held through without a dip stays one note.
      if (e.midi === exp[i - 1].midi) {
        const lo = Math.max(p.t + 0.12, target - win), hi = Math.min(nextOn, target + win);
        const span = late.map((fr, k) => [fr, env[k]]).filter(([fr]) => fr.t >= p.t + 0.08 && fr.t <= hi);
        const level = mid(span.map(([, v]) => v)), inWin = span.filter(([fr]) => fr.t >= lo);
        if (!inWin.length) return;
        const [dipFr, dipV] = inWin.reduce((a, b) => b[1] < a[1] ? b : a);
        const back = inWin.find(([fr, v]) => fr.t > dipFr.t && v >= dipV + 0.5 * (level - dipV));
        if (dipV <= 0.85 * level && back) { split(back[0].t); return; }
        // no dip at all: the two were sung joined (do-o instead of do-do). If the voice is clearly on
        // that pitch where the note is written, the note was sung; it is marked "joined" so the
        // singer knows to re-sing it, not "not heard".
        const at = pitched.filter(r => Math.abs(r.t - target) <= Math.max(0.12, tol)).map(r => r.m);
        if (at.length >= 2 && Math.abs(mid(at) - p.midi) < 0.5 && (p.end > target || nextOn > target + tol)) {
          const nd = { t: target, end: p.end > target ? p.end : end, midi: mid(at), joined: true };
          det.push(nd); det.sort((a, b) => a.t - b.t);
          n.match = nd; n.errMs = 0; n.status = 'ok'; n.joined = true;
        }
        return;
      }
      // where, inside the previous note, the sung pitch moves furthest in the written direction
      // (median of the 3 readings before vs. the 3 after). Half steps are often sung narrow
      // (an F just above an E), so a move of a quarter semitone or more is enough.
      const step = e.midi - exp[i - 1].midi, dir = Math.sign(step);
      const cand = pitched.filter(r => r.t >= Math.max(p.t + 0.1, target - win) && r.t <= Math.min(nextOn, target + win));
      let bestK = -1, bestMove = 0;
      // Compared over 3 readings (~0.12 s) and over 5 (~0.2 s) each side: a narrow step sung with a
      // wobble (a flat fa into a sharp mi, only ~35¢ apart) shows clearly only over the longer stretch.
      for (const w of [3, 5]) for (let k = w; k + w <= cand.length; k++) {
        const move = (mid(cand.slice(k, k + w).map(r => r.m)) - mid(cand.slice(k - w, k).map(r => r.m))) * dir;
        if (move > bestMove) { bestMove = move; bestK = k; }
      }
      if (bestK >= 0 && bestMove >= Math.max(0.25, 0.3 * Math.abs(step))) split(cand[bestK].t);
    });
  }
  // 4c. a written note still unmatched, with a sung note nearby that matched nothing (up to about
  // a beat and a quarter away, and in order between its neighbours): the note was sung, just early
  // or late. It is marked as a timing error with how far off it was, not as "not heard".
  {
    const used = new Set(notes.filter(n => n.match).map(n => n.match));
    notes.forEach((n, i) => {
      if (n.match) return;
      const e = exp[i], target = T0 + e.t * q + offset, reach = Math.max(1.25 * q, 0.6 * e.len * q);
      const lo = notes.slice(0, i).reverse().find(x => x.match)?.match.t ?? -Infinity;
      const hi = notes.slice(i + 1).find(x => x.match)?.match.t ?? Infinity;
      // prefer a sung note whose pitch fits this written note (by the step from the note before),
      // so an early note isn't confused with the scoop into the next one
      const pi = notes.slice(0, i).map((x, k) => [x, k]).reverse().find(([x, k]) => x.match?.midi != null && exp[k].midi != null);
      const want = pi && e.midi != null ? pi[0].match.midi + (e.midi - exp[pi[1]].midi) : null;
      const fits = d => want == null || d.midi == null ? false : Math.abs(d.midi - want) < 0.6;
      let best = null;
      for (const d of det) {
        if (used.has(d) || d.t <= lo || d.t >= hi || Math.abs(d.t - target) > reach) continue;
        if (!best || fits(d) && !fits(best) || fits(d) === fits(best) && Math.abs(d.t - target) < Math.abs(best.t - target)) best = d;
      }
      if (best) { used.add(best); n.match = best; n.errMs = Math.round((best.t - target) * 1000); n.status = 'timing'; }
    });
  }
  // 4d. settling in: a pitch change of under a semitone that matched nothing, in the first half of a
  // written note, is that note settling after a scoop. The note takes the settled pitch.
  {
    const used = new Set(notes.filter(n => n.match).map(n => n.match));
    notes.forEach((n, i) => {
      const a = n.match; if (!a || a.midi == null) return;
      const half = 0.5 * exp[i].len * q;
      const b = det.find(d => !used.has(d) && d.pitchOnly && d.t > a.t && d.t - a.t <= half && d.midi != null && Math.abs(d.midi - a.midi) < 1.0);
      if (b) { a.midi = b.midi; det.splice(det.indexOf(b), 1); }
    });
  }
  // 5. pitch: one common shift (any key, any octave) is allowed, so only the relative pitches count.
  // The shift includes the octave, so a leap sung to the wrong octave is marked, not passed.
  if (gradePitch) {
    const fold = x => ((x + 6) % 12 + 12) % 12 - 6;
    const raw = [];
    notes.forEach((n, i) => { if (n.match && n.match.midi != null && exp[i].midi != null) raw.push(n.match.midi - exp[i].midi); });
    // not rounded to a whole semitone: singing a whole example 40¢ below the starting tone is a
    // fine key to sing in, and rounding it pushed half the notes past the ±50¢ limit
    // The key the singer used. The first note is sung from the starting tone, so it sets the key,
    // unless clearly more notes agree on another one (2+ more, and at least half of all notes:
    // e.g. a scooped first note). Taking the most common offset alone could pick a key nobody sang
    // in: a melody sung all on C was graded as if sung in D or E.
    let cls = 0;
    if (raw.length) {
      const fr = raw.map(fold), count = c => fr.filter(x => Math.abs(fold(x - c)) <= 0.6).length;
      let best = fr[0], bestN = count(fr[0]);
      const firstN = bestN;
      for (const c of fr) { const k = count(c); if (k > bestN) { bestN = k; best = c; } }
      if (!(bestN >= firstN + 2 && bestN >= fr.length / 2)) best = fr[0];
      const agree = fr.filter(x => Math.abs(fold(x - best)) <= 0.6).map(x => best + fold(x - best));
      cls = med(agree);
    }
    const shift = cls + 12 * (raw.length ? med(raw.map(d => Math.round((d - cls) / 12))) : 0);
    // Singers often sink (or rise) slowly over an example. Each note is heard against where the last
    // few correct notes were, so slow drift isn't counted as wrong notes; it's reported once instead.
    // Only correct notes move the reference, so a wrong note (or a wrong passage) can't pull it along.
    let ref = 0; const okR = [];
    notes.forEach((n, i) => {
      if (!n.match || exp[i].midi == null) return;
      if (n.match.midi == null) { n.pitch = 'none'; if (n.status === 'ok') n.status = 'pitch'; return; }
      const r = n.match.midi - exp[i].midi - shift, rf = fold(r - ref) + ref;   // residual, in semitones
      n.cents = Math.round((rf - ref) * 100);
      n.sungAs = grName(n.match.midi - shift - ref);                  // the note heard, in the written key
      n.octave = Math.round((r - rf) / 12);
      n.pitch = Math.abs(rf - ref) > 0.75 ? 'wrong' : n.octave ? 'octave' : 'ok';   // a wrong note is ~100¢ off; within 75¢ it's the right note, maybe out of tune (shown on the card)
      if (n.pitch !== 'wrong') { okR.push(rf); if (okR.length >= 3) ref = med(okR.slice(-3)); }   // one note can't move it
      if (n.status === 'ok' && n.pitch !== 'ok') n.status = 'pitch';
    });
    var driftCents = okR.length >= 4 ? Math.round((med(okR.slice(-3)) - med(okR.slice(0, 3))) * 100) : null;
  }
  const N = exp.length || 1;
  const rhythmOk = notes.filter(n => n.status === 'ok' || n.status === 'pitch').length;
  const pitchOk = gradePitch ? notes.filter(n => n.status === 'ok').length : null;
  const extra = det.length - notes.filter(n => n.match).length;
  const span = taps ? (taps.length ? Math.max(...taps) - Math.min(...taps) : 0) : frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
  return {
    rhythmPct: Math.round(100 * rhythmOk / N),
    pitchPct: gradePitch ? Math.round(100 * pitchOk / N) : null,
    offsetMs: Math.round((latUsed ? heardOffset - lat : offset) * 1000), latUsed, extra, notes, total: N, driftCents: gradePitch ? driftCents : null,
    input: taps ? 'tap' : 'mic', T0, q, offsetSec: offset,
    det, diag: { frames: taps ? taps.length : frames.length, span: span.toFixed(1), peak: peak.toFixed(3), floor: floor.toFixed(4), thr: thr.toFixed(3), heard: det.length }
  };
}

// The report card: a short summary, with the full list of what was graded behind "Details".
function grCardHTML(res, gradePitch) {
  const word = ms => ms > 0 ? `${ms} ms late` : ms < 0 ? `${-ms} ms early` : 'on time';
  const d = res.diag, tap = res.input === 'tap';
  const head = d.heard === 0
    ? (tap ? `<b>No taps heard.</b> <span class="gr-sub">After the count-in, press the space bar at the start of each note.</span>`
      : `<b>No notes heard.</b> <span class="gr-sub">Clap or play louder, or move closer to the mic. Check the mic in System Settings → Sound.</span>`)
    : `<b>Rhythm ${res.rhythmPct}%</b>${gradePitch ? ` · <b>Pitch ${res.pitchPct}%</b>` : ''}
       <span class="gr-sub">${d.heard} ${tap ? 'tap' : 'note'}${d.heard > 1 ? 's' : ''} ${tap ? 'counted' : 'heard'} · ${res.latUsed ? `overall ${word(res.offsetMs).replace(/ms late$/, 'ms behind the beat').replace(/ms early$/, 'ms ahead of the beat')}` : `average timing ${word(res.offsetMs)}`}${res.extra > 0 ? ` · ${res.extra} extra` : ''}${Math.abs(res.driftCents ?? 0) >= 25 ? ` · went ${Math.abs(res.driftCents)}¢ ${res.driftCents < 0 ? 'flat' : 'sharp'} by the end` : ''}</span>`;
  const rows = res.notes.map(n => {
    const where = `bar ${n.bar}, note ${n.idx}${gradePitch && n.written != null ? ` (${grName(n.written)})` : ''}`;
    const status = n.joined ? '✓ joined (re-sing it)' : n.status === 'timing' ? (n.errMs < 0 ? 'early' : 'late') : { ok: '✓ on time', missed: tap ? 'no tap' : 'not heard', pitch: 'pitch' }[n.status];
    const timing = n.errMs == null ? '—' : word(n.errMs);
    const pitch = !gradePitch || n.written == null ? '—' : n.pitch === 'ok' ? (Math.abs(n.cents) >= 40 ? `✓ ${Math.abs(n.cents)}¢ ${n.cents < 0 ? 'flat' : 'sharp'}` : '✓') : n.pitch === 'none' ? 'no clear pitch' : n.pitch === 'octave' ? `wrong octave (${n.octave > 0 ? 'too high' : 'too low'})` : n.pitch === 'wrong' ? `sang ${n.sungAs.replace(/-?\d+$/, '')} (${n.cents > 0 ? '+' : ''}${n.cents}¢)` : '—';
    return `<tr class="gr-${n.status}"><td>${where}</td><td>${status}</td><td>${timing}</td>${gradePitch ? `<td>${pitch}</td>` : ''}</tr>`;
  }).join('');
  return `<div class="gr-head">${head}</div>
    <details class="gr-details"><summary>What was graded</summary>
      <table class="gr-table"><thead><tr><th>Note</th><th>Result</th><th>Timing</th>${gradePitch ? '<th>Pitch</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
      ${tap ? `<div class="gr-sub">Space bar: ${d.frames} tap${d.frames === 1 ? '' : 's'} (taps during the count-in are not counted).</div>`
        : `<div class="gr-sub">Mic check: ${d.frames} readings over ${d.span} s · peak level ${d.peak} · quiet level ${d.floor} · threshold ${d.thr}${res.logId ? ` · saved as ${res.logId}` : ''}</div>`}
      <div class="gr-sub">Timing is checked against your own steady beat, so a steady delay from the speakers${tap ? '' : ' or mic'} doesn't count against you.</div>
    </details>
    <div class="gr-sub">${tap ? 'Tap once at the start of each note (a held or tied note gets one tap). Rests get no tap.' : 'Practice feedback, not a grade. Headphones and a quiet room give the best result.'}</div>`;
}

// hist: every attempt on this example so far (kept on the timeline, so a new example starts fresh)
function grShowCard(res, gradePitch, hist = [], host = null) {
  document.getElementById('gr-card')?.remove();
  const card = document.createElement('div');
  card.id = 'gr-card'; card.className = 'gr-card';
  const past = hist.map((h, i) => `${i + 1}: ${h.pitchPct != null ? `rhythm ${h.rhythmPct}% · pitch ${h.pitchPct}%` : `${h.rhythmPct}%`}${h.tap ? ' (tap)' : ''}`).join('  ·  ');
  const G = host?.__grResult;
  const legend = G && res.diag.heard > 0 ? `<div class="gr-legend"><span class="gr-sub">On the music:</span>
      <span><i class="gr-dot ok"></i>on time</span><span><i class="gr-dot timing"></i>early / late</span><span><i class="gr-dot missed"></i>${res.input === 'tap' ? 'no tap' : 'not heard'}</span>${gradePitch ? '<span><i class="gr-dot pitch"></i>wrong pitch</span>' : ''}<span><i class="gr-dot extra"></i>extra</span>
      <button class="gr-marks">${G.hidden ? 'Show marks' : 'Hide marks'}</button></div>` : '';
  card.innerHTML = `<button class="gr-x" title="Close (the marks on the music stay until you press New or grade again)" aria-label="Close">${IC('ico:close')}</button>${grCardHTML(res, gradePitch)}${legend}
    ${G?.take && res.diag.heard > 0 && host.__listen ? `<div class="gr-listen-row"><button class="gr-listen" title="Hear your ${res.input === 'tap' ? 'taps' : 'recording'} lined up with the music, with the playhead and these marks">${IC('ico:play')} Listen back</button>
      <select class="gr-mix" title="What to hear"><option value="both">with the example</option><option value="rec">${res.input === 'tap' ? 'taps' : 'recording'} only</option></select></div>` : ''}
    <div class="gr-again-row"><button class="gr-again">${IC(res.input === 'tap' ? 'ico:keyboard' : 'ico:mic')} Try again</button>${past ? `<span class="gr-sub">Attempts: ${past}</span>` : ''}</div>`;
  card.querySelector('.gr-x').onclick = () => card.remove();
  const mk = card.querySelector('.gr-marks');
  if (mk) mk.onclick = () => { G.hidden = !G.hidden; mk.textContent = G.hidden ? 'Show marks' : 'Hide marks'; host.__grRedraw?.(); };
  card.querySelector('.gr-again').onclick = () => { if (typeof srStop === 'function') srStop(); card.remove(); GR.retry && GR.retry(); };
  const lb = card.querySelector('.gr-listen');
  if (lb) lb.onclick = () => grListen(host, card.querySelector('.gr-mix')?.value || 'both', lb);
  document.body.appendChild(card);
}

// Sounds go through GR.out, so stopping early silences clicks that are already scheduled.
const grOut = c => GR.out || c.destination;
function grClick(c, time, accent, gain = 1) {
  const os = c.createOscillator(), g = c.createGain();
  os.frequency.value = accent ? 3200 : 2500;
  g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.22 * gain, time + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
  os.connect(g).connect(grOut(c)); os.start(time); os.stop(time + 0.04);
}

// A plain sung-reference tone for the count-in cue (same timbre as the playback tone).
function grTone(c, time, midi, dur) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  for (const [type, mul, amp] of [['triangle', 1, .35], ['sine', 2, .08], ['sine', 3, .03]]) {
    const os = c.createOscillator(), g = c.createGain();
    os.type = type; os.frequency.value = f * mul;
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(amp, time + 0.01);
    g.gain.exponentialRampToValueAtTime(amp * 0.35, time + Math.min(0.4, dur * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.95);
    os.connect(g).connect(grOut(c)); os.start(time); os.stop(time + dur);
  }
}

// ---------- Troubleshooting log: every attempt saves the raw mic audio (.wav) and what the grader saw
// (.json) into the app's files folder (~/Library/Application Support/ClassPilot/files/grlog…),
// so a take that was graded wrongly can be replayed and the grader fixed against real singing.
function grWav(chunks, sr) {
  const n = chunks.reduce((s, a) => s + a.length, 0), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44; for (const a of chunks) for (let i = 0; i < a.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, a[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
function grSaveLog(rec, meta, frames, res) {
  try {
    if (typeof HAS_SERVER === 'undefined' || !HAS_SERVER || !rec) return null;
    if (typeof S === 'undefined' || !S.settings?.saveGradeRecordings) return null;   // only when troubleshooting is on (Settings)
    const d = new Date(), p = x => String(x).padStart(2, '0');
    const id = `grlog${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const summary = { rhythmPct: res.rhythmPct, pitchPct: res.pitchPct, offsetMs: res.offsetMs, latUsed: res.latUsed, extra: res.extra, driftCents: res.driftCents, diag: res.diag,
      notes: res.notes.map(n => ({ bar: n.bar, idx: n.idx, written: n.written, status: n.status, pitch: n.pitch, cents: n.cents, errMs: n.errMs, heardT: n.match?.t, heardMidi: n.match?.midi })) };
    const json = JSON.stringify({ v: 1, when: d.toISOString(), ...meta, sampleRate: rec.sr, marks: rec.marks, frames, result: summary });
    const post = (suffix, body) => fetch(`/api/file?id=${id}${suffix}`, { method: 'POST', headers: { 'X-Token': TOKEN }, body });
    Promise.all([post('w', grWav(rec.chunks, rec.sr)), post('j', json)])
      .then(() => fetch('/api/purge-grlogs?keep=20', { method: 'POST', headers: { 'X-Token': TOKEN } })).catch(() => { });
    return id;
  } catch { return null; }
}

// ---------- The microphone stays open between takes.
// Opening the Mac's mic makes macOS reset its audio: for about 3.5 s the mic hears almost nothing,
// then the signal drops out for a moment and comes back at full level, and the speakers glitch at
// that moment. Opened per take, that landed in the first measure every time (a deaf first note and
// a stutter). So the mic is opened once, the first count-in waits until it is really listening,
// and it closes after 2 minutes without a take.
const GR_MIC_IDLE = 120000, GR_MIC_MAX_WAIT = 4500;
// Mic graph in a given audio context: low-pass + analyser for grading, and the raw signal for the
// troubleshooting recording (and, while starting, for spotting the moment macOS finishes switching).
function grMicGraph(mic, c) {
  const src = c.createMediaStreamSource(mic.stream), an = c.createAnalyser();
  const lp1 = c.createBiquadFilter(), lp2 = c.createBiquadFilter();
  // low-pass: singing is kept, the high metronome ticks (2.5–3.2 kHz) are turned way down
  for (const f of [lp1, lp2]) { f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.7; }
  an.fftSize = 2048; src.connect(lp1).connect(lp2).connect(an);
  const sp = c.createScriptProcessor(4096, 1, 1), mute = c.createGain(); mute.gain.value = 0;
  sp.onaudioprocess = e => {
    const d = e.inputBuffer.getChannelData(0);
    if (!mic.liveAt) {
      // the switch: at least 20 ms of exact silence, after the mic has delivered sound for 0.8 s
      // (it also delivers a little silence right when it opens; that is not the switch)
      let run = 0, best = 0, any = false;
      for (let i = 0; i < d.length; i++) { if (d[i] === 0) { run++; if (run > best) best = run; } else { run = 0; any = true; } }
      if (mic.heard >= 0.8 * c.sampleRate && best >= 0.02 * c.sampleRate) mic.liveAt = performance.now() + 300;
      if (any) mic.heard += d.length;
    }
    const rec = GR.rec; if (GR.on && rec && mic.c === c) { rec.marks.push([rec.n, c.currentTime]); rec.chunks.push(new Float32Array(d)); rec.n += d.length; }
  };
  src.connect(sp); sp.connect(mute).connect(c.destination);
  Object.assign(mic, { c, src, an, sp });
}
// Opens the mic (or reuses the open one). The first time, it listens through the app's sound engine
// until macOS has finished switching, then moves grading to a sound engine of its own made after the
// switch: the app's engine plays its next few seconds late and then races to catch up (the first
// measure came out uneven and the first note looked late), a new one starts on time.
async function grMic() {
  const m = GR.mic;
  if (m && m.ready && m.stream.getAudioTracks().every(t => t.readyState === 'live')) { clearTimeout(m.idle); return m; }
  grMicClose();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const mic = { stream, openedAt: performance.now(), liveAt: null, heard: 0, idle: 0, ready: false, own: false };
  grMicGraph(mic, ac());
  GR.mic = mic;
  return mic;
}
function grMicClose() {
  const m = GR.mic; if (!m) return;
  clearTimeout(m.idle);
  try { m.sp.disconnect(); m.src.disconnect(); } catch { }
  m.stream.getTracks().forEach(t => t.stop());
  if (m.own) try { m.c.close(); } catch { }
  GR.mic = null;
}
// waits until the mic is really listening, then gives grading its own sound engine
// (only the first take after opening the mic waits)
async function grMicReady(m, btn) {
  if (m.ready) return;
  const until = () => m.liveAt ?? m.openedAt + GR_MIC_MAX_WAIT;
  if (btn) btn.innerHTML = IC('ico:mic') + ' Mic starting…';
  while (performance.now() < until()) await new Promise(r => setTimeout(r, 50));
  try {
    const AC = window.AudioContext || window.webkitAudioContext, c = new AC();
    await c.resume();
    try { m.sp.disconnect(); m.src.disconnect(); } catch { }
    grMicGraph(m, c); m.own = true;
    srKeepAwake(c);
    await new Promise(r => setTimeout(r, 400));                 // let the new engine settle
  } catch { /* keep using the app's sound engine */ }
  m.ready = true;
}

function grStop(show = true) {
  if (!GR.on) return;
  clearInterval(GR.timer);
  try { GR.out?.disconnect(); } catch { }
  GR.out = null;
  if (GR.mic) { clearTimeout(GR.mic.idle); GR.mic.idle = setTimeout(grMicClose, GR_MIC_IDLE); }
  const frames = GR.frames, exp = GR.exp, btn = GR.btn, rec = GR.rec, tap = GR.input === 'tap', taps = GR.taps;
  GR.on = false; GR.frames = []; GR.an = null; GR.rec = null; GR.taps = null;
  GR.quietUntil = performance.now() + 1500;                   // a last tap just after the end doesn't start playback
  if (btn) { btn.innerHTML = IC('ico:mic') + (GR.gradeLabelMenu ? ' Grade ▾' : ' Grade'); btn.classList.remove('on'); }
  if (!show || !exp || !exp.length) return;
  const res = grAnalyze(frames, exp, GR.q, GR.T0, GR.end, GR.gradePitch, GR.lat, tap ? taps : null);
  if (!tap) res.logId = grSaveLog(rec, { ...GR.meta, exp, q: GR.q, T0: GR.T0, end: GR.end, lat: GR.lat, gradePitch: GR.gradePitch }, frames, res);
  const tl = GR.tl, host = GR.host;
  if (tl) { tl.grHist = tl.grHist || []; tl.grHist.push({ rhythmPct: res.rhythmPct, pitchPct: res.pitchPct, tap }); }
  // the result is kept on the widget so the marks are drawn again whenever the music is redrawn
  // the take itself (the mic recording, or the taps) is kept for listening back against the example
  const take = { rec: tap ? null : rec, frames, taps: tap ? taps : null, T0: GR.T0, q: GR.q, end: GR.end, offsetSec: res.offsetSec, tempo: GR.meta?.settings?.tempo };
  if (host && tl) { host.__grResult = { res, sig: grSig(tl), hidden: false, take }; host.__grRedraw?.(); }
  grShowCard(res, GR.gradePitch && !tap, tl?.grHist || [], host);
}

// Button handler: starts a count-in and records; pressing again stops early and grades what was heard.
// input: 'mic' (sing / clap into the microphone) or 'tap' (space bar, rhythm only, no microphone)
async function grStart(host, st, timeline, btn, input = 'mic') {
  if (GR.on) { grStop(true); return; }
  if (GR.starting) return;                                     // already getting ready (a second press does nothing)
  if ((timeline.parts || 1) > 1) return toast('Grading works on one-line examples. Turn off the Harmony or Canon parts first.');
  const exp = grExpected(timeline, grVoiceShift(st));
  if (!exp.length) return toast('There is nothing to grade in this example.');
  const tap = input === 'tap';
  GR.gradeLabelMenu = st.mode === 'rhythm';                  // the button shows ▾ (a menu) only for rhythm
  GR.starting = true;
  let mic, c0;
  try {
    c0 = ac(); await c0.resume();
    if (c0.state !== 'running') return toast(`Sound is not running yet. Press ${tap ? 'Tap' : 'Grade'} again.`);
    if (!tap) {
      try { mic = await grMic(); } catch (e) { return toast('Microphone not available: ' + e.message); }
      await grMicReady(mic, btn);
      await mic.c.resume();
    }
  } finally { GR.starting = false; }
  const o = st[st.mode] || {};
  const [beats, kind] = SR_METERS[o.ts] || [4, 'simple'];
  const beatQ = kind === 'compound' ? 1.5 : 1, q = 60 / o.tempo / beatQ, beatSec = q * beatQ;
  const c = tap ? c0 : mic.c;                                  // grading's own sound engine (see grMic); taps use the app's
  document.getElementById('gr-card')?.remove();
  host.__grResult = null; grClearMarks(host);
  srKeepAwake(c);
  GR.out = c.createGain(); GR.out.connect(c.destination);
  const t0 = c.currentTime + 0.3;
  // Count-in: the Count-in setting (at least 1 bar, so the singer hears the tempo)
  const cueMode = st.mode === 'solfege' ? (o.countPitch ?? 'do') : 'none';
  const bars = Math.max(1, Number(o.countIn ?? 1) || 0), countBeats = beats * bars;
  for (let b = 0; b < countBeats; b++) grClick(c, t0 + b * beatSec, b % beats === 0);
  // Solfege count-in: the same starting-pitch cue as playback ("hear do · start on …")
  let cue = null;
  if (st.mode === 'solfege' && st.ex?.solfege && !tap) {
    const sp = d => srSpell(o.key, o.scale, d, o.clef);
    const first = sp(st.ex.solfege.pitches[0] ?? 0), barSec = beats * beatSec, shift = grVoiceShift(st);
    if (cueMode === 'start') grTone(c, t0, grCueMidi(first.midi + shift), barSec * 0.95);
    else if (cueMode === 'chord') [0, 2, 4].forEach((d, i) => grTone(c, t0 + i * Math.min(beatSec, barSec / 3) * 0.5, grCueMidi(sp(d).midi + shift), barSec * 0.95));
    else if (cueMode !== 'none') grTone(c, t0, grCueMidi(sp(0).midi + shift), barSec * 0.95);
    cue = { heard: cueMode === 'start' ? first.syl : cueMode === 'chord' ? 'do – mi – sol' : cueMode === 'none' ? null : 'do', start: first.syl };
  }
  const T0 = t0 + countBeats * beatSec;
  const last = exp[exp.length - 1];
  const end = T0 + (last.t + last.len) * q + 0.8;
  // Metronome while performing (the Metronome button), softer than the count-in, like playback
  if (o.metronome) {
    const total = last.t + last.len;
    for (let b = 0; b * beatQ < total - 1e-6; b++) grClick(c, T0 + b * beatSec, b % beats === 0, 0.5);
  }
  // The mic goes through a low-pass filter: singing is kept, but the high metronome ticks
  // (2.5–3.2 kHz) are turned way down so they aren't heard as sung notes.
  const an = tap ? null : mic.an;
  // raw (unfiltered) mic audio for the troubleshooting log; marks map sample numbers to audio-clock time
  const rec = tap ? null : { sr: c.sampleRate, chunks: [], marks: [], n: 0 };
  const meta = { mode: st.mode, settings: Object.fromEntries(['ts', 'tempo', 'key', 'scale', 'clef', 'gradeVoice', 'countIn', 'countPitch', 'metronome'].map(k => [k, o[k]])), beatSec, countBeats, t0, avDelay: (typeof S !== 'undefined' ? S.settings?.avDelay : null) ?? null };
  // Delay between a scheduled beat and the student hearing it: speaker buffer + Sound / playhead sync setting.
  let lat = null;
  try {
    const dl = Number(S.settings?.avDelay), outLat = Math.max(0, c.currentTime - srHeard0(c));
    lat = outLat + (isFinite(dl) ? dl : 150) / 1000;
    if (!isFinite(lat)) lat = null;
  } catch { lat = null; }
  Object.assign(GR, { on: true, input, c, taps: tap ? [] : null, an, rec, meta, buf: new Float32Array(2048), poll: 0, frames: [], host, exp, q, T0, end, btn, lat, gradePitch: !tap && timeline.some(e => e.midi != null), tl: timeline, retry: () => grStart(host, st, timeline, btn, input) });
  btn.innerHTML = IC('ico:stop') + (tap ? ' Stop (tapping)' : ' Stop & grade'); btn.classList.add('on');
  if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();   // so Space taps, not clicks
  // Show the count-in numbers and the playhead while the student performs (same display as playback).
  // Positions are in quarter-note units from bar 1; the count-in sits at negative positions.
  const gClock = {
    anchorT: t0, anchorPos: -countBeats * beatQ, q, beatQ, beats, countBeats, countLen: countBeats * beatQ,
    cue, start: 0, fromM: 0, alive: () => GR.on,
    pos(now) { return this.anchorPos + (now - this.anchorT) / this.q; },
    timeAt(pos) { return this.anchorT + (pos - this.anchorPos) * this.q; },
    // the playhead follows grading's own sound engine
    heard() { const dl = Number(typeof S !== 'undefined' ? S.settings?.avDelay : NaN); return srHeard0(c) - (isFinite(dl) ? dl : 150) / 1000; },
  };
  srAnimate(host, { ...st, playhead: st.playhead && st.playhead !== 'off' ? st.playhead : 'beat' }, () => timeline, gClock);
  GR.timer = setInterval(() => {
    const now = c.currentTime;
    if (tap) { if (now > GR.end) grStop(true); return; }
    const { an, buf } = GR; if (!an) return;
    if (now > GR.end) { grStop(true); return; }
    an.getFloatTimeDomainData(buf);
    // loudness over the newest 20 ms (at least one full cycle of a low voice, so it doesn't flicker)
    const W = Math.min(buf.length, Math.round(c.sampleRate * 0.02));
    let s = 0; for (let i = buf.length - W; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / W);
    const f = (GR.poll++ % 4 === 0) ? muDetectPitch(buf, c.sampleRate, GR_MIN_RMS, GR_PITCH_OPTS).f : -1;   // pitch about every 40 ms
    GR.frames.push({ t: now, rms, f });
  }, 10);
}

// ---------- Space-bar tapping (rhythm only)
// A tap's time on the audio clock: the moment of sound that was coming out of the speakers when the
// key went down, so taps compare with the count-in and metronome clicks the student heard.
function grTapTime(c, e) {
  const nowP = performance.now();
  let p = e && e.timeStamp; if (!(p > nowP - 1000 && p <= nowP + 5)) p = nowP;   // some browsers use another clock
  try { const ts = c.getOutputTimestamp && c.getOutputTimestamp(); if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (p - ts.performanceTime) / 1000; } catch { }
  return c.currentTime - (c.outputLatency || c.baseLatency || 0) - (nowP - p) / 1000;
}
// a short flash where the playhead is, so the student sees each tap land
function grTapFlash() {
  const staff = GR.host?.querySelector('.sr-staff'); if (!staff) return;
  const ph = staff.querySelector('.sr-ph'), f = document.createElement('div');
  f.className = 'gr-tapflash';
  if (ph && ph.style.display !== 'none' && ph.style.left) Object.assign(f.style, { left: ph.style.left, top: ph.style.top, height: ph.style.height });
  else f.classList.add('corner');
  staff.appendChild(f); setTimeout(() => f.remove(), 450);
}
// While grading (mic or tap) is getting ready or running, and for a moment after it ends, Space never
// plays the example: it is caught here before the Play / Stop shortcut. During a Tap take it is the tap.
const grOwnsSpace = () => GR.on || GR.starting || performance.now() < (GR.quietUntil || 0);
if (typeof window !== 'undefined' && window.addEventListener) {
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !grOwnsSpace()) return;
  if (e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
  if (!GR.on || GR.input !== 'tap' || e.repeat || !GR.taps) return;
  GR.taps.push(grTapTime(GR.c, e)); grTapFlash();
}, true);
window.addEventListener('keyup', e => {
  if (e.code === 'Space' && grOwnsSpace()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
}

// ---------- The report drawn on the music
// Each written note is coloured by its result. A lane just above the staff shows when each note
// was heard (a dot) against where it is written (a small tick); a line joins them when it was early
// or late. Sounds or taps that match no note are small grey crosses; a missed note gets a red ring.
// Kept on the widget and redrawn with the music; it disappears when the example changes.
const grSig = tl => tl.filter(e => !e.rest && !e.tiedFrom).map(e => e.t.toFixed(3) + ':' + (e.midi ?? '')).join(',');
const GR_MARK_CLS = ['gr-n-ok', 'gr-n-timing', 'gr-n-missed', 'gr-n-pitch'];
function grClearMarks(host) {
  host.querySelectorAll('.gr-ov, .gr-chips').forEach(x => x.remove());
  host.querySelectorAll(GR_MARK_CLS.map(c => '.' + c).join(',')).forEach(x => x.classList.remove(...GR_MARK_CLS));
}
function grDrawMarks(host, tl) {
  grClearMarks(host);
  const G = host.__grResult;
  if (!G || !tl?.geo) return;
  // a different example now: this take can't be listened to any more, so it's thrown away
  if ((tl.parts || 1) > 1 || grSig(tl) !== G.sig) { if (!GR.on) { host.__grResult = null; if (typeof srStop === 'function' && SR_PLAY.extra?.length) srStop(); } return; }
  const staff = host.querySelector('.sr-staff'), svg = staff?.querySelector('svg'); if (!svg) return;
  // a small button on the music to clear (or bring back) the marks, even after the card is closed
  const chip = document.createElement('button');
  chip.className = 'gr-marks-chip'; chip.dataset.grchip = '1';
  chip.innerHTML = G.hidden ? 'Show grading marks' : `${IC('ico:close')} Clear marks`;
  chip.title = G.hidden ? 'Show the last grading on the music' : 'Remove the grading marks from the music';
  chip.onclick = e => { e.stopPropagation(); if (G.hidden) G.hidden = false; else { host.__grResult = null; if (SR_PLAY.extra?.length) srStop(); document.getElementById('gr-card')?.remove(); } grDrawMarks(host, tl); const mk = document.querySelector('#gr-card .gr-marks'); if (mk) mk.textContent = host.__grResult?.hidden === false ? 'Hide marks' : 'Show marks'; };
  const chips = document.createElement('div'); chips.className = 'gr-chips gr-marks-chip-row';
  // listen back stays here after the report is closed, for as long as this example is shown
  if (G.take && host.__listen && G.res.diag?.heard > 0) {
    const lb = document.createElement('button'); lb.className = 'gr-marks-chip gr-listen'; lb.dataset.grchip = '1';
    const playing = !!SR_PLAY.extra?.length;
    lb.innerHTML = playing ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Listen back'; if (playing) { lb.classList.add('on'); lb.dataset.idle = IC('ico:play') + ' Listen back'; }
    lb.onclick = e => { e.stopPropagation(); grListen(host, document.querySelector('#gr-card .gr-mix')?.value || 'both', lb); };
    chips.appendChild(lb);
  }
  chips.appendChild(chip); staff.appendChild(chips);
  if (G.hidden) return;
  const res = G.res, geo = tl.geo, NS = 'http://www.w3.org/2000/svg';
  const atk = tl.filter(e => !e.rest && !e.tiedFrom);
  if (atk.length !== res.notes.length || !geo.measures.length) return;
  const mk = (tag, a, parent) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); parent.appendChild(n); return n; };
  // the lane sits above the highest note (stems included), but no more than 30 above the staff
  let up = 0; for (const m of geo.measures) for (const k of m.knots) if (k[2] != null) up = Math.max(up, m.y0 + 18 - k[2]);
  const rise = Math.min(Math.max(up, 4), 30) + 10, laneY = m => m.y0 + 18 - rise;
  const M = geo.measures, last = M[M.length - 1];
  const mAt = pos => M.find(m => pos >= m.t0 - 1e-6 && pos < m.t1 - 1e-6) || (pos < M[0].t0 ? M[0] : last);
  const xAt = (m, pos) => {
    const K = m.knots; let i = 0; while (i < K.length - 2 && pos >= K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1] || a, f = b[0] > a[0] ? (pos - a[0]) / (b[0] - a[0]) : 0;
    return Math.max(m.x0 - 10, Math.min(m.x1 + 10, a[1] + f * (b[1] - a[1])));
  };
  const g = mk('g', { class: 'gr-ov' }, svg);
  for (const m of M) mk('line', { x1: m.x0 + 6, x2: m.x1 - 6, y1: laneY(m), y2: laneY(m), class: 'gr-lane' }, g);
  res.notes.forEach((n, i) => {
    const e = atk[i], m = mAt(e.t), x = xAt(m, e.t), y = laneY(m);
    const pitchBad = n.pitch && n.pitch !== 'ok';
    const cls = !n.match ? 'missed' : pitchBad ? 'pitch' : n.status === 'timing' ? 'timing' : 'ok';
    if (e.el?.classList) {
      e.el.classList.add('gr-n-' + cls);
      const bh = e.el.getAttribute?.('data-bh'); if (bh) document.getElementById(bh)?.classList.add('gr-n-' + cls);
    }
    mk('line', { x1: x, x2: x, y1: y - 6, y2: y + 6, class: 'gr-tick' }, g);   // where the note is written
    if (!n.match) { mk('circle', { cx: x, cy: e.y ?? (m.y0 + m.y1) / 2, r: 11, class: 'gr-ring' }, g); return; }
    const tcls = n.status === 'timing' ? 'timing' : 'ok';
    // a little early or late stays on the note's own measure (an early first note of a line must not
    // jump to the end of the line above)
    const hp = e.t + (n.errMs || 0) / 1000 / res.q, hm = hp > m.t0 - 0.75 && hp < m.t1 + 0.75 ? m : mAt(hp), hx = xAt(hm, hp), hy = laneY(hm);
    if (hm === m && Math.abs(hx - x) > 1.5) mk('line', { x1: x, x2: hx, y1: y, y2: y, class: 'gr-off ' + tcls }, g);
    mk('circle', { cx: hx, cy: hy, r: 5, class: 'gr-dot ' + tcls }, g);
    const lbl = n.pitch === 'wrong' && n.sungAs ? n.sungAs.replace(/-?\d+$/, '') : n.pitch === 'octave' ? (n.octave > 0 ? 'oct ↑' : 'oct ↓') : n.pitch === 'none' ? '?' : n.joined ? 'joined' : '';
    if (lbl) mk('text', { x: hx, y: hy - 9, 'text-anchor': 'middle', class: 'gr-lbl' + (n.joined && !pitchBad ? ' soft' : '') }, g).textContent = lbl;
  });
  // sounds / taps that belong to no written note
  const used = new Set(res.notes.map(n => n.match).filter(Boolean)), total = last.t1;
  for (const d of res.det || []) {
    if (used.has(d)) continue;
    const p = (d.t - res.T0 - res.offsetSec) / res.q; if (!(p > -1 && p < total + 1)) continue;
    const m = mAt(p), x = xAt(m, p), y = laneY(m);
    mk('path', { d: `M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`, class: 'gr-extra' }, g);
  }
}

// ---------- Listen back: the take played against the example, in sync, with the playhead.
// The singer's steady delay (speakers, mic, reaction) is taken out, so what you hear is how each
// note sat against perfect timing. The mic recording is the raw (unfiltered) audio of the take.
// The recording's sample clock vs. the grader's audio clock: a straight-line fit of the marks, plus
// the small fixed lag between them (about one audio block, ~90 ms), found by lining up the
// recording's loudness with the loudness the grader saw.
function grTakeAudio(take) {
  if (take.audio) return take.audio;
  const rec = take.rec; if (!rec || !rec.chunks.length || rec.marks.length < 2) return null;
  const n = rec.n, x = new Float32Array(n); let o = 0; for (const a of rec.chunks) { x.set(a, o); o += a.length; }
  const M = rec.marks, k = M.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [sm, t] of M) { sx += t; sy += sm; sxx += t * t; sxy += t * sm; }
  const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx) || rec.sr, icpt = (sy - slope * sx) / k;
  const sq = new Float64Array(n + 1); for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  const W = Math.round(rec.sr * 0.02), rmsAt = e => (e < W || e > n) ? 0 : Math.sqrt((sq[e] - sq[e - W]) / W);
  const F = take.frames.filter(f => f.t > take.T0 && f.t < take.end), fr = F.map(f => f.rms);
  const mean = a => a.reduce((p, c) => p + c, 0) / (a.length || 1), mf = mean(fr);
  let lag = 0.09, bestR = -2;
  if (F.length > 20) for (let L = -0.3; L <= 0.3001; L += 0.005) {
    const ar = F.map(f => rmsAt(Math.round(icpt + slope * (f.t + L)))), ma = mean(ar);
    let num = 0, da = 0, db = 0; for (let i = 0; i < F.length; i++) { const p = fr[i] - mf, q = ar[i] - ma; num += p * q; da += p * p; db += q * q; }
    const r = num / Math.sqrt(da * db || 1); if (r > bestR) { bestR = r; lag = L; }
  }
  let peak = 0; for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
  take.audio = { x, sr: rec.sr, sampleAt: t => icpt + slope * (t + lag), gain: Math.max(1, Math.min(30, 0.6 / (peak || 1))), lag };
  return take.audio;
}
function grListen(host, mix, btn) {
  const G = host.__grResult, take = G?.take; if (!take || !host.__listen) return;
  if (btn?.classList.contains('on')) { srStop(); return; }      // pressed again: stop
  if (GR.on) return;
  const A = take.rec ? grTakeAudio(take) : null;
  if (take.rec && !A) return toast('The recording of this take is not available.');
  const c = ac(); c.resume && c.resume();
  const clock = host.__listen(take.tempo);                       // the example from bar 1, at the tempo you performed
  if (!clock) return;
  if (mix === 'rec' && SR_PLAY.master) SR_PLAY.master.gain.value = 0;   // keep the playhead, mute the example
  const out = c.createGain(); out.connect(c.destination);
  SR_PLAY.extra = [out];
  const when0 = clock.timeAt(0);                                // when bar 1, beat 1 sounds
  if (A) {
    const lead = 0.3, buf = c.createBuffer(1, A.x.length, A.sr); buf.getChannelData(0).set(A.x);
    const src = c.createBufferSource(); src.buffer = buf; out.gain.value = A.gain * (mix === 'rec' ? 1 : 0.85);
    src.connect(out);
    let off = A.sampleAt(take.T0 + take.offsetSec - lead) / A.sr, when = when0 - lead;
    if (off < 0) { when -= off; off = 0; }
    src.start(Math.max(c.currentTime, when), off); SR_PLAY.extra.push(src);
  } else if (take.taps) {
    for (const t of take.taps) {                                 // each tap as a short wood click
      const at = when0 + (t - take.T0 - take.offsetSec); if (at < c.currentTime) continue;
      const os = c.createOscillator(), g = c.createGain();
      os.type = 'square'; os.frequency.value = 1800;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      os.connect(g).connect(out); os.start(at); os.stop(at + 0.06);
    }
  }
  if (btn) { btn.dataset.idle = btn.innerHTML; btn.innerHTML = IC('ico:stop') + ' Stop'; btn.classList.add('on'); }
}
