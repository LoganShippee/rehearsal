'use strict';
/* Sight-reading generator for Rehearsal: rhythm (1 e & a counting) and solfege melodies
   (movable do, do-based minor), engraved with VexFlow, with playback and presets. */

const SR_VF = window.Vex && Vex.Flow;

// ---------- rhythm building blocks. Units: quarter note = 1. `len` is in beats of the meter.
const SR_SIMPLE = {
  w: { label: 'Whole note', len: 4, ev: [['w', 4]] },
  hd: { label: 'Dotted half', len: 3, ev: [['hd', 3]] },
  h: { label: 'Half note', len: 2, ev: [['h', 2]] },
  q: { label: 'Quarter', len: 1, ev: [['q', 1]] },
  ee: { label: 'Two eighths', len: 1, ev: [['8', .5], ['8', .5]] },
  qr: { label: 'Quarter rest', len: 1, ev: [['q', 1, 1]] },
  hr: { label: 'Half rest', len: 2, ev: [['h', 2, 1]] },
  qde: { label: 'Dotted quarter + eighth', len: 2, ev: [['qd', 1.5], ['8', .5]] },
  ssss: { label: 'Four sixteenths', len: 1, ev: [['16', .25], ['16', .25], ['16', .25], ['16', .25]] },
  er: { label: 'Eighth rest + eighth', len: 1, ev: [['8', .5, 1], ['8', .5]] },
  syn: { label: 'Syncopation (8–q–8)', len: 2, ev: [['8', .5], ['q', 1], ['8', .5]] },
  ess: { label: 'Eighth + two 16ths', len: 1, ev: [['8', .5], ['16', .25], ['16', .25]] },
  sse: { label: 'Two 16ths + eighth', len: 1, ev: [['16', .25], ['16', .25], ['8', .5]] },
  des: { label: 'Dotted eighth + 16th', len: 1, ev: [['8d', .75], ['16', .25]] },
  trip: { label: 'Eighth-note triplet', len: 1, ev: [['8', 1 / 3], ['8', 1 / 3], ['8', 1 / 3]], tup: 3 },
};
const SR_COMPOUND = {
  dq: { label: 'Dotted quarter', len: 1, ev: [['qd', 1.5]] },
  eee: { label: 'Three eighths', len: 1, ev: [['8', .5], ['8', .5], ['8', .5]] },
  qe: { label: 'Quarter + eighth', len: 1, ev: [['q', 1], ['8', .5]] },
  eq: { label: 'Eighth + quarter', len: 1, ev: [['8', .5], ['q', 1]] },
  dh: { label: 'Dotted half', len: 2, ev: [['hd', 3]] },
  dqr: { label: 'Dotted quarter rest', len: 1, ev: [['qd', 1.5, 1]] },
  desse: { label: 'Dotted 8th–16th–8th', len: 1, ev: [['8d', .75], ['16', .25], ['8', .5]] },
  ssse: { label: 'Four 16ths + eighth', len: 1, ev: [['16', .25], ['16', .25], ['16', .25], ['16', .25], ['8', .5]] },
  six: { label: 'Six sixteenths', len: 1, ev: Array(6).fill(['16', .25]) },
};
const SR_METERS = { '2/4': [2, 'simple'], '3/4': [3, 'simple'], '4/4': [4, 'simple'], '6/8': [2, 'compound'], '9/8': [3, 'compound'], '12/8': [4, 'compound'] };
const SR_MEL_CELLS = ['w', 'hd', 'h', 'q', 'ee', 'qde', 'qr', 'hr', 'ssss', 'syn'];

// ---------- solfege
const SR_KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'];
const SR_LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SR_STEPS = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const SR_SYL = { major: ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'], minor: ['do', 're', 'me', 'fa', 'sol', 'le', 'te'] };
const SR_RANGES = {
  'do-mi': ['do – mi', 0, 2], 'do-sol': ['do – sol', 0, 4], 'do-la': ['do – la', 0, 5], 'octave': ['do – high do', 0, 7],
  'lowsol-sol': ['low sol – sol', -3, 4], 'lowsol-do': ['low sol – high do', -3, 7], 'lowla-mi2': ['low la – high mi', -2, 9],
};
const SR_LEAPS = { step: 'Steps only', third: 'Steps & 3rds', triad: 'Steps & do–mi–sol leaps', fifth: 'Up to a 5th', octave: 'Up to an octave' };

function srDefaults() {
  return {
    mode: 'solfege', show: false, settingsOpen: false, playhead: 'beat',
    rhythm: { ts: '4/4', measures: 4, tempo: 80, metronome: true, sound: 'clap', cells: ['q', 'h', 'ee', 'qr', 'w'], showCounts: false },
    solfege: { key: 'C', scale: 'major', clef: 'treble', range: 'do-sol', leap: 'step', ts: '4/4', measures: 4, tempo: 72, metronome: true, startDo: true, cells: ['q', 'h', 'w'], showCounts: false },
    ex: {},
  };
}
function srSavedPresets() {
  return (typeof S !== 'undefined' && S) ? ((S.settings ||= {}).srPresets ||= []) : [];
}
function srPresetSnapshot(o, mode) {
  const keys = mode === 'rhythm'
    ? ['ts', 'measures', 'tempo', 'metronome', 'sound', 'ties', 'measureNums', 'countIn', 'cells']
    : ['key', 'scale', 'clef', 'range', 'melodyStyle', 'leap', 'parts', 'startDo', 'texture', 'canonDelay', 'partRhythm', 'unison', 'clef2', 'clef3', 'ts', 'measures', 'tempo', 'metronome', 'ties', 'measureNums', 'instrument', 'artic', 'countIn', 'countPitch', 'gradeVoice', 'cells'];
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = Array.isArray(o[k]) ? [...o[k]] : o[k];
  return out;
}
function srPresetMatches(o, p) {
  if (!p?.data) return false;
  for (const [k, v] of Object.entries(p.data)) {
    if (Array.isArray(v)) {
      const cur = Array.isArray(o[k]) ? o[k] : [];
      if (v.length !== cur.length || v.some(x => !cur.includes(x))) return false;
    } else if (String(o[k] ?? '') !== String(v ?? '')) return false;
  }
  return true;
}

const srRand = a => a[Math.floor(Math.random() * a.length)];
const srCellsFor = ts => SR_METERS[ts][1] === 'compound' ? SR_COMPOUND : SR_SIMPLE;

// ---------- generate rhythm (array of measures; each = array of cells {id, ev})
function srGenRhythm(ts, measures, allowed, ties) {
  const [beats, kind] = SR_METERS[ts];
  const table = kind === 'compound' ? SR_COMPOUND : SR_SIMPLE;
  let ids = allowed.filter(id => table[id]);
  if (!ids.length) ids = [kind === 'compound' ? 'dq' : 'q'];
  const out = [];
  for (let m = 0; m < measures; m++) {
    const cells = []; let pos = 0;
    const last = m === measures - 1;
    while (pos < beats) {
      const left = beats - pos;
      let cand = ids.filter(id => {
        const c = table[id]; if (c.len > left) return false;
        if (c.len >= 2 && kind === 'simple' && pos % 2 !== 0) return false;          // long values start on strong beats
        if (c.len === 3 && pos !== 0) return false;
        if (id === 'w' && (pos !== 0 || beats !== 4)) return false;
        if (m === 0 && pos === 0 && c.ev[0][2]) return false;                         // don't open with a rest
        if (last && c.ev.some(e => e[2])) return false;                               // or rest right before the end
        return true;
      });
      // finish the exercise on a long, non-rest value when possible
      if (last && left <= 2) { const end = cand.filter(id => table[id].ev.length === 1 && !table[id].ev[0][2] && table[id].len === left); if (end.length) cand = end; }
      if (!cand.length) cand = [kind === 'compound' ? 'dq' : 'q'];
      const id = srRand(cand); cells.push({ id, ev: table[id].ev, tup: table[id].tup }); pos += table[id].len;
    }
    out.push(cells);
  }
  // tied notes: now and then hold the last note of a measure into the next one
  if (ties) for (let m = 0; m < out.length - 1; m++) {
    const a = out[m][out[m].length - 1], b = out[m + 1][0];
    const aLast = a.ev[a.ev.length - 1], bFirst = b.ev[0];
    if (!aLast[2] && !bFirst[2] && Math.random() < .4) a.tie = true;
  }
  return out;
}

// Rhythm syllable systems: 'numbers' (1 e & a), 'kodaly' (ta ti-ti / tika-tika / syn-co-pa), 'takadimi' (ta ta-di / ta-ka-di-mi / ta-ki-da)
const RHYTHM_SYSTEMS = [
  ['numbers', 'Numbers (1 e & a)'],
  ['kodaly', 'Kodály (ta ti-ti)'],
  ['takadimi', 'Takadimi (ta ta-di)'],
];
const RHY_KODALY_SIMPLE = {
  w: ['ta-a-a-a'], hd: ['ta-a-a'], h: ['ta-a'], q: ['ta'],
  ee: ['ti', 'ti'], qr: ['(sh)'], hr: ['(sh-h)'],
  qde: ['tam', 'ti'], ssss: ['ti', 'ka', 'ti', 'ka'],
  er: ['(ti)', 'ti'], syn: ['syn', 'co', 'pa'],
  ess: ['ti', 'ti', 'ka'], sse: ['ti', 'ka', 'ti'],
  des: ['tim', 'ka'], trip: ['tri', 'o', 'la'],
};
const RHY_KODALY_COMP = {
  dq: ['tam'], dh: ['tam-a'], dqr: ['(sh)'],
  eee: ['ti', 'ti', 'ti'], qe: ['ta', 'ti'], eq: ['ti', 'ta'],
  desse: ['tim', 'ka', 'ti'], ssse: ['ti', 'ka', 'ti', 'ka', 'ti'],
  six: ['ti', 'ka', 'ti', 'ka', 'ti', 'ka'],
};
function rhythmSys() { return (typeof S !== 'undefined' && S.settings?.rhythmSystem) || 'numbers'; }
function rhythmSyllable(p, kind, rest, val = 1, cellId = null, ei = 0, sys = rhythmSys()) {
  const r = x => Math.round(x * 12) / 12;
  if (sys === 'kodaly') {
    const map = kind === 'compound' ? RHY_KODALY_COMP : RHY_KODALY_SIMPLE;
    if (cellId && map[cellId] && map[cellId][ei] != null) return map[cellId][ei];
    if (rest) return val >= 1.9 ? '(sh-h)' : '(sh)';
    if (kind === 'simple') {
      const b = Math.floor(r(p) + 1e-9), f = r(p - b);
      if (f === 0) {
        if (val >= 3.9) return 'ta-a-a-a';
        if (val >= 2.9) return 'ta-a-a';
        if (val >= 1.9) return 'ta-a';
        if (val >= 1.4) return 'tam';
        if (val >= 0.9) return 'ta';
        if (val >= 0.7) return 'tim';
        if (Math.abs(val - 1 / 3) < 0.04) return 'tri';
        return 'ti';
      }
      if (f === .25 || f === .75) return 'ka';
      if (f === .5) return val >= 0.9 ? 'co' : 'ti';
      if (Math.abs(f - 1 / 3) < .02) return 'o';
      if (Math.abs(f - 2 / 3) < .02) return 'la';
      return 'ti';
    } else {
      const e = r(p / .5), sub = r(e % 3);
      if (sub === 0) return val >= 2.8 ? 'tam-a' : val >= 1.4 ? 'tam' : val >= 0.9 ? 'ta' : val >= 0.7 ? 'tim' : 'ti';
      if (sub === 1 || sub === 2) return val >= 0.9 ? 'ta' : 'ti';
      return 'ka';
    }
  }
  if (sys === 'takadimi') {
    if (rest) return '';
    let s;
    if (kind === 'simple') {
      const b = Math.floor(r(p) + 1e-9), f = r(p - b);
      s = f === 0 ? 'ta' : f === .25 ? 'ka' : f === .5 ? 'di' : f === .75 ? 'mi'
        : Math.abs(f - 1 / 3) < .02 ? 'ki' : Math.abs(f - 2 / 3) < .02 ? 'da' : '·';
    } else {
      const e = r(p / .5), sub = r(e % 3);
      s = sub === 0 ? 'ta' : sub === .5 ? 'va' : sub === 1 ? 'ki' : sub === 1.5 ? 'di' : sub === 2 ? 'da' : sub === 2.5 ? 'ma' : '·';
    }
    return s;
  }
  // default: traditional numbers (1 e & a)
  let s;
  if (kind === 'simple') {
    const b = Math.floor(r(p) + 1e-9), f = r(p - b);
    s = f === 0 ? String(b + 1) : f === .5 ? '&' : f === .25 ? 'e' : f === .75 ? 'a' : Math.abs(f - 1 / 3) < .01 ? 'trip' : Math.abs(f - 2 / 3) < .01 ? 'let' : '·';
  } else {
    const e = r(p / .5), ei2 = Math.floor(e + 1e-9), beat = Math.floor(ei2 / 3) + 1, sub = ei2 % 3, half = r(e - ei2) > 0;
    s = half ? 'ta' : sub === 0 ? String(beat) : sub === 1 ? '&' : 'a';
  }
  return rest ? `(${s})` : s;
}
// counting label for a note starting at `p` quarter-units into the measure
function srCount(p, kind, rest, val = 1, cellId = null, ei = 0) {
  return rhythmSyllable(p, kind, rest, val, cellId, ei);
}
window.rhythmSyllable = rhythmSyllable;
window.rhythmSys = rhythmSys;
window.RHYTHM_SYSTEMS = RHYTHM_SYSTEMS;

// ---------- solfege melody on top of a rhythm
function srSpell(key, scale, d, clef) {
  const tonicLetter = key[0].toLowerCase();
  const acc = key.slice(1) === 'b' ? -1 : key.slice(1) === '#' ? 1 : 0;
  const tonicPc = (SR_LETTER_PC[tonicLetter] + acc + 12) % 12;
  const letters = 'cdefgab', Lt = letters.indexOf(tonicLetter);
  const baseOct = clef === 'bass' ? (Lt <= 2 ? 3 : 2) : (Lt <= 4 ? 4 : 3);
  const deg = ((d % 7) + 7) % 7;
  const li = Lt + d, letter = letters[((li % 7) + 7) % 7], oct = baseOct + Math.floor(li / 7);
  const pcTarget = (tonicPc + SR_STEPS[scale][deg]) % 12;
  let diff = (pcTarget - SR_LETTER_PC[letter] + 12) % 12; if (diff > 6) diff -= 12;
  const accStr = diff === 1 ? '#' : diff === 2 ? '##' : diff === -1 ? 'b' : diff === -2 ? 'bb' : '';
  const midi = 12 * (oct + 1) + SR_LETTER_PC[letter] + diff;
  return { key: `${letter}${accStr}/${oct}`, midi, syl: SR_SYL[scale][deg] };
}
function srGenMelody(o) {
  const nM = o.measures;
  const rhythm = srGenRhythm(o.ts, nM, o.cells.filter(id => SR_SIMPLE[id]), o.ties);
  const [, lo, hi] = SR_RANGES[o.range] || SR_RANGES['do-sol'];
  const maxLeap = { step: 1, third: 2, triad: 4, fifth: 4, octave: 7 }[o.leap] || 1;
  const triad = new Set([0, 2, 4, 7, -3, -5, 9]);
  // ---- phrase plan (Patterns): a motif, then the same rhythm and shape a step higher or lower
  // (a sequence), maybe once more, then something new and a cadence. 8+ measures = two phrases:
  // the first ends open (sol / re), the second starts like the first and ends on do.
  // Melody style: 'patterns' = every phrase uses a sequence; 'mixed' (default) = each phrase is a coin
  // toss between a sequence and freely written measures, so not everything is a sequence; 'free' = none.
  const style = o.melodyStyle || 'mixed';
  const patterns = style !== 'free' && nM >= 3;
  const phraseLen = nM >= 8 ? Math.floor(nM / 2) : nM;
  const plan = new Array(nM).fill(null);
  const clone = cells => cells.map(c => ({ ...c, tie: false, ev: c.ev.map(e => e.slice()) }));
  if (patterns) {
    for (let start = 0; start < nM; start += phraseLen) {
      const end = Math.min(start + phraseLen, nM) - 1;              // the phrase's last (cadence) measure
      const seq = style !== 'mixed' || Math.random() < .5;            // mixed: this phrase sequenced or free
      if (start > 0 && (style !== 'mixed' || Math.random() < .5)) plan[start] = { src: 0, echo: true };   // answer phrase begins like the first
      if (seq && start + 1 < end) plan[start + 1] = { src: start };
      if (seq && start + 2 < end && Math.random() < (style === 'mixed' ? .3 : .55)) plan[start + 2] = { src: start };
    }
    for (let m = 0; m < nM - 1; m++) if (plan[m]) rhythm[m] = clone(rhythm[plan[m].src]);
  }
  const slotsByM = rhythm.map(cells => { const a = []; cells.forEach(c => c.ev.forEach(e => { if (!e[2]) a.push(e); })); return a; });
  const total = slotsByM.reduce((n, a) => n + a.length, 0);
  const pitches = [], byM = [];
  const halfCadenceAt = patterns && nM >= 8 ? phraseLen - 1 : -1;   // measure that ends the first phrase
  // one free step of the melody (singable: steps, direction, no wobble, heads home at the end)
  const next = (cur, goal) => {
    const left = total - 1 - pitches.length;
    let cand = [];
    for (let d = lo; d <= hi; d++) {
      const step = Math.abs(d - cur);
      if (step > maxLeap) continue;
      if (o.leap === 'triad' && step > 1 && !(triad.has(cur) && triad.has(d))) continue;
      if (step === 0 && pitches.length >= 2 && pitches[pitches.length - 1] === cur && pitches[pitches.length - 2] === cur) continue;
      if (left <= 3 && Math.abs(d) > left + 1 && Math.abs(d - 7) > left + 1) continue;   // head home toward do
      const p2 = pitches.length >= 2 ? pitches[pitches.length - 2] : null, dir = p2 != null ? Math.sign(cur - p2) : 0, mv = Math.sign(d - cur);
      let w = step === 0 ? .5 : step === 1 ? 4 : step === 2 ? 1.8 : .8;
      if (dir && mv === dir && step <= 2) w *= 1.7;
      if (p2 != null && d === p2 && step > 0) w *= .3;
      if (p2 != null && Math.abs(cur - p2) >= 3 && mv === -Math.sign(cur - p2) && step === 1) w *= 2.2;
      const recent = pitches.slice(-4).filter(x => x === d).length; w *= recent ? 1 / (1 + recent * .7) : 1.3;
      if ((d === lo || d === hi) && mv === dir) w *= .7;
      if (goal && goal.includes(d)) w *= 6;                             // aiming for a phrase ending
      for (let k = 0; k < Math.max(1, Math.round(w * 4)); k++) cand.push(d);
    }
    if (left === 0) { cand = [0, 7].filter(d => d >= lo && d <= hi && Math.abs(d - cur) <= Math.max(maxLeap, 2)); if (!cand.length) cand = [0, 7].filter(d => d >= lo && d <= hi).sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur)).slice(0, 1); }
    if (left === 1) { const pen = [1, -1, 6, 4].filter(d => d >= lo && d <= hi && Math.abs(d - cur) <= Math.max(maxLeap, 2)); if (pen.length) cand = pen; }
    if (!cand.length) cand = [cur > lo ? cur - 1 : cur + 1];
    return srRand(cand);
  };
  let cur = o.startDo || !triad.size ? 0 : srRand([0, 2, 4].filter(x => x >= lo && x <= hi));
  cur = Math.min(Math.max(cur, lo), hi);
  let lastDelta = 0;
  for (let m = 0; m < nM; m++) {
    const n = slotsByM[m].length, pl = plan[m];
    let mine = null;
    if (pl && byM[pl.src] && byM[pl.src].length === n && n > 0 && m < nM - 1) {
      const prevLast = pitches.length ? pitches[pitches.length - 1] : null;
      if (pl.echo) {                                                  // answer phrase: same opening as the first phrase
        const cand = byM[pl.src];
        if (!cand.some(d => d < lo || d > hi) && (prevLast == null || Math.abs(cand[0] - prevLast) <= Math.max(maxLeap, 2))) mine = cand.slice();
      } else {
        // sequence: the previous statement moved by a step (keep going the same way if it was already a sequence)
        const ref = plan[m - 1] && !plan[m - 1].echo && plan[m - 1].src === pl.src ? byM[m - 1] : byM[pl.src];
        const order = lastDelta ? [lastDelta, -lastDelta, 2 * lastDelta] : (Math.random() < .5 ? [1, -1, 2, -2] : [-1, 1, -2, 2]);
        for (const delta of order) {
          const cand = ref.map(d => d + delta);
          if (cand.some(d => d < lo || d > hi)) continue;
          if (prevLast != null && Math.abs(cand[0] - prevLast) > Math.max(maxLeap, 2)) continue;
          if (o.leap === 'triad' && prevLast != null && Math.abs(cand[0] - prevLast) > 1 && !(triad.has(prevLast) && triad.has(cand[0]))) continue;
          mine = cand; lastDelta = delta; break;
        }
      }
    }
    if (mine) { pitches.push(...mine); cur = mine[mine.length - 1]; }
    else {
      lastDelta = 0; mine = [];
      for (let k = 0; k < n; k++) {
        if (pitches.length) {
          const isPhraseEnd = m === halfCadenceAt && k === n - 1;
          cur = next(cur, isPhraseEnd ? [4, 1, -3] : null);         // first phrase ends open on sol or re
        }
        pitches.push(cur); mine.push(cur);
      }
    }
    byM.push(mine);
  }
  return { rhythm, pitches };
}


// ---------- several solfege parts at once: harmony (over a chord progression) or a canon (round)
const SR_CHORDS = { I: [0, 2, 4], ii: [1, 3, 5], IV: [3, 5, 0], V: [4, 6, 1], vi: [5, 0, 2] };
const srMod7 = d => ((d % 7) + 7) % 7;
// every note/rest of a rhythm with its measure, place in the measure and time from the start
function srSlots(rhythm) {
  const out = []; let t = 0;
  rhythm.forEach((cells, m) => { let pos = 0; cells.forEach(c => c.ev.forEach(e => { out.push({ m, pos, t, len: e[1], rest: !!e[2] }); pos += e[1]; t += e[1]; })); });
  return out;
}
function srPartClef(o, p) {
  const c = p > 0 ? o['clef' + (p + 1)] : null;
  if (c) return c;
  if (p === 0) return o.clef;
  return p === 2 || o.clef === 'bass' ? 'bass' : 'treble';
}
// how far (in scale steps) a bass-clef degree sits below the same treble-clef degree, for this key
function srAbsOff(clef, key = 'C') {
  if (clef !== 'bass') return 0;
  const Lt = 'cdefgab'.indexOf(key[0].toLowerCase());
  return ((Lt <= 2 ? 3 : 2) - (Lt <= 4 ? 4 : 3)) * 7;
}
function srGenParts(o) {
  const P = Math.max(1, Math.min(3, Number(o.parts) || 1));
  if (P === 1) return srGenMelody(o);
  return o.texture === 'canon' ? srGenCanon(o, P) : srGenHarmony(o, P);
}
function srGenHarmony(o, P) {
  const top = srGenMelody(o), nM = top.rhythm.length;
  const topClef = srPartClef(o, 0);
  const partSlots = [];
  { const ss = srSlots(top.rhythm); let k = 0; ss.forEach(s => { if (!s.rest) s.a = top.pitches[k++] + srAbsOff(topClef, o.key); }); partSlots.push(ss); }
  // one chord per measure: the one that fits the melody best (long notes and the downbeat count most)
  const chords = [];
  for (let m = 0; m < nM; m++) {
    const ss = partSlots[0].filter(s => s.m === m && !s.rest);
    const names = m === nM - 1 ? ['I'] : Object.keys(SR_CHORDS);
    let best = null;
    for (const n of names) {
      let sc = 0; for (const s of ss) if (SR_CHORDS[n].includes(srMod7(s.a))) sc += s.len * (s.pos === 0 ? 2 : 1);
      sc += ({ I: .6, V: .5, IV: .4, vi: .2, ii: .1 })[n] + Math.random() * .35;
      if (m === nM - 2 && n === 'V') sc += 1.2;                  // V – I at the end
      if (m > 0 && chords[m - 1] === n) sc -= .5;
      if (!best || sc > best.sc) best = { n, sc };
    }
    chords.push(best.n);
  }
  const at = (ss, t) => { const s = ss.find(x => !x.rest && t >= x.t - 1e-6 && t < x.t + x.len - 1e-6); return s ? s.a : null; };
  const allowed = o.cells.filter(id => SR_SIMPLE[id]);
  const calm = allowed.filter(id => ['w', 'hd', 'h', 'q', 'qr', 'hr'].includes(id));
  const parts = [{ rhythm: top.rhythm, pitches: top.pitches, clef: topClef }];
  for (let p = 1; p < P; p++) {
    const clef = srPartClef(o, p), off = srAbsOff(clef, o.key), isBass = p === P - 1 && (P === 3 || clef === 'bass');
    const rhythm = o.partRhythm === 'different' ? srGenRhythm(o.ts, nM, calm.length ? calm : allowed) : top.rhythm;
    const ss = srSlots(rhythm), notes = ss.filter(s => !s.rest);
    // every part keeps to the chosen range (a bass-clef part: the same range in its own, lower octave)
    const [, rlo, rhi] = SR_RANGES[o.range] || SR_RANGES['do-sol'], lo = rlo + off, hi = rhi + off;
    let prev = null, prevUp = null; const hist = [], uniRun = { n: 0 };
    notes.forEach((s, i) => {
      const up = at(partSlots[p - 1], s.t), chord = SR_CHORDS[chords[s.m]], last = i === notes.length - 1;
      const cands = [];
      for (let a = lo; a <= hi; a++) {
        const uni = up != null && a === up;
        if (up != null && a > up) continue;                         // stay below (or on) the part above
        const ct = chord.includes(srMod7(a));
        const third = up != null && [2, 5].includes(srMod7(up - a));
        // sounds well with every part above it right now (3rds, 5ths, 6ths, octaves — no 2nds, 4ths or 7ths)
        let clash = false;
        for (let q = 0; q < p; q++) { const u = at(partSlots[q], s.t); if (u != null && ![0, 2, 4, 5].includes(srMod7(u - a))) clash = true; }
        if (isBass && !ct) continue;
        if (!ct && !(o.partRhythm !== 'different' && third) && !uni) continue;   // unison with the line above is always fine
        if (clash && !last) continue;                                // never a 2nd / 4th / 7th against a part above
        let sc = (ct ? 2 : 0) + (third ? 1 : 0) - (clash ? 6 : 0);
        // unison: singing the same note as the part above (choose how often in ⚙ → Unison)
        const uw = ({ lots: 1.2, some: -.6, none: -12 })[o.unison || 'lots'];
        if (uni) sc += uw;
        // harmony belongs on the long notes, unison on the quick ones
        if (up != null && o.unison !== 'none') {
          const L = s.len;
          if (uni) sc += L <= .5 ? 2.6 : L < 1 ? 1.2 : L >= 2 && !last ? -4 : 0;
          else sc += L >= 2 && !last ? 3 : L <= .5 ? -1.8 : 0;
        }
        if (prev != null) {
          const st = Math.abs(a - prev), p2 = hist.length >= 2 ? hist[hist.length - 2] : null;
          sc -= st * (isBass ? .45 : .9);
          if (st === 1) sc += isBass ? .6 : 1.3;                        // steps sing best
          if (st === 0) sc -= hist.length >= 2 && hist[hist.length - 2] === a ? 3 : (isBass ? .4 : 1.1);   // not the same note over and over
          if (p2 != null && a === p2 && st > 0) sc -= hist.length >= 3 && hist[hist.length - 3] === prev ? 3 : 1.8;   // no back-and-forth (re-do-re-do)
          if (p2 != null && st > 0 && Math.sign(a - prev) === Math.sign(prev - p2)) sc += .5;   // keep a direction
          if (hist.slice(-4).includes(a)) sc -= .3; else sc += .3;      // use more of the range
        }
        if (uni && uniRun.n >= ({ lots: 3, some: 2, none: 0 })[o.unison || 'lots']) sc -= 4;   // don't stay in unison too long
        if (!uni && up != null && uniRun.n === 0 && o.unison !== 'none' && hist.length && hist[hist.length - 1] !== prevUp && (o.unison || 'lots') === 'lots') sc -= .4;   // with 'lots', come back to unison now and then
        if (isBass && srMod7(a) === chord[0]) sc += s.pos === 0 ? 2.5 : 1;
        if (up != null && up - a === 1) sc -= 3;                     // a 2nd apart clashes
        if (prev != null && prevUp != null && up != null) {           // no parallel 5ths / octaves
          const i1 = srMod7(prevUp - prev), i2 = srMod7(up - a);
          const bothUni = prev === prevUp && a === up;                // moving together in unison is fine
          if ((i1 === 0 || i1 === 4) && i1 === i2 && (a !== prev || up !== prevUp) && !bothUni) sc -= 4;
        }
        if (last) sc += srMod7(a) === 0 ? 4 : (isBass ? -10 : chord.includes(srMod7(a)) ? 0 : -5);
        sc += Math.random() * .5;
        cands.push({ a, sc });
      }
      cands.sort((x, y) => y.sc - x.sc);
      // nothing fits below the part above inside the range: take the closest in-range chord tone (or unison)
      let a = cands.length ? cands[0].a : null;
      if (a == null) {
        const pool = []; for (let x = lo; x <= hi; x++) pool.push(x);
        const target = up != null ? up : (prev ?? lo);
        a = up != null && up >= lo && up <= hi ? up                     // sing with the part above
          : pool.filter(x => chord.includes(srMod7(x))).sort((x, y) => Math.abs(x - target) - Math.abs(y - target))[0] ?? Math.max(lo, Math.min(hi, target));
      }
      s.a = a; prev = a; prevUp = up; hist.push(a); uniRun.n = up != null && a === up ? uniRun.n + 1 : 0;
    });
    partSlots.push(ss);
    parts.push({ rhythm, pitches: notes.map(s => s.a - off), clef });
  }
  return { rhythm: parts[0].rhythm, pitches: parts[0].pitches, parts };
}
function srGenCanon(o, P) {
  const delay = Math.max(1, Math.min(2, Number(o.canonDelay) || 1));
  const rhythm = srGenRhythm(o.ts, o.measures, o.cells.filter(id => SR_SIMPLE[id]));
  const [, lo, hi] = SR_RANGES[o.range] || SR_RANGES['do-sol'];
  // a round works when every beat lands on the home chord (do–mi–sol); the notes between just step
  const triad = [-7, -5, -3, 0, 2, 4, 7, 9].filter(d => d >= lo && d <= hi);
  const near = c => triad.reduce((a, b) => Math.abs(b - c) < Math.abs(a - c) ? b : a, triad[0] ?? 0);
  const notes = srSlots(rhythm).filter(s => !s.rest), pitches = [];
  let cur = 0;
  notes.forEach((s, i) => {
    const onBeat = Math.abs(s.pos - Math.round(s.pos)) < 1e-6, nextOnBeat = notes[i + 1] && Math.abs(notes[i + 1].pos - Math.round(notes[i + 1].pos)) < 1e-6;
    let cand;
    if (i === 0) cand = o.startDo ? [0] : triad.filter(d => [0, 2, 4].includes(d));
    else if (i === notes.length - 1) cand = [0, 7].filter(d => d >= lo && d <= hi);
    else if (onBeat) cand = triad.filter(d => Math.abs(d - cur) <= (o.leap === 'step' ? 2 : 4) && d !== cur || Math.abs(d - cur) === 0 && Math.random() < .3);
    else cand = [cur - 1, cur + 1].filter(d => d >= lo && d <= hi && (!nextOnBeat || triad.some(t => Math.abs(t - d) <= 1)));
    if (!cand || !cand.length) cand = [near(cur)];
    cur = srRand(cand.flatMap(d => Math.abs(d - cur) <= 1 ? [d, d, d] : [d]));
    pitches.push(cur);
  });
  const beats = SR_METERS[o.ts][0];
  const restM = () => [{ id: 'rest', ev: [[beats === 4 ? 'w' : beats === 3 ? 'hd' : 'h', beats, 1]] }];
  const total = rhythm.length + delay * (P - 1), parts = [];
  for (let p = 0; p < P; p++) {
    const r = [];
    for (let k = 0; k < delay * p; k++) r.push(restM());
    r.push(...rhythm);
    while (r.length < total) r.push(restM());
    parts.push({ rhythm: r, pitches: pitches.slice(), clef: srPartClef(o, p) });
  }
  return { rhythm: parts[0].rhythm, pitches: parts[0].pitches, parts, canon: delay };
}

// ---------- engraving
// exact centre of a note's head (falls back to its left edge + half width)
function srHeadX(n) {
  try { if (n.getNoteHeadBeginX && n.getNoteHeadEndX) return (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2; } catch { }
  return n.getAbsoluteX() + ((n.getMetrics ? n.getMetrics().noteWidth : 10) || 10) / 2;
}
// how far a note reaches up and down (stem, beam end, head) so the playhead can stop short of it
// Each beamed note gets its own half of the beam (up to halfway to its neighbours), copied into the
// note's group and clipped. It's invisible normally (drawn over the real beam) and lights up with the note.
let SR_CLIP = 0;
function srLight(el, on) {
  if (!el?.classList) return;
  el.classList.toggle('sr-cur', on);
  const bh = el.getAttribute('data-bh'); if (bh) el.ownerDocument.getElementById(bh)?.classList.toggle('sr-cur', on);
}
function srBeamHalves(beam, beamEls) {
  if (!beamEls.length) return;
  const ns = beam.notes || beam.getNotes?.() || [], NS = 'http://www.w3.org/2000/svg';
  const svg = beamEls[0].ownerSVGElement || beamEls[0].closest?.('svg'); if (!svg) return;
  let defs = svg.querySelector('defs'); if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.prepend(defs); }
  ns.forEach((n, i) => {
    const g = n.attrs && n.attrs.el; if (!g) return;
    const x = n.getStemX(), L = i > 0 ? (x + ns[i - 1].getStemX()) / 2 : x - 1, R = i < ns.length - 1 ? (x + ns[i + 1].getStemX()) / 2 : x + 1;
    const id = 'srbh' + (++SR_CLIP), cp = document.createElementNS(NS, 'clipPath'), r = document.createElementNS(NS, 'rect');
    cp.id = id; r.setAttribute('x', L); r.setAttribute('y', -1000); r.setAttribute('width', Math.max(0, R - L)); r.setAttribute('height', 4000);
    cp.appendChild(r); defs.appendChild(cp);
    const wrap = document.createElementNS(NS, 'g'); wrap.setAttribute('clip-path', `url(#${id})`); wrap.setAttribute('class', 'sr-beamhalf');
    beamEls.forEach(b => wrap.appendChild(b.cloneNode(true)));
    wrap.id = id + 'w'; g.setAttribute('data-bh', wrap.id);
    beamEls[beamEls.length - 1].after(wrap);              // on top of the real beam so its colour shows
  });
}
function srNoteExtent(n, stave) {
  try {
    const bb = n.getBoundingBox && n.getBoundingBox();
    if (bb && bb.getH() > 0) return [bb.getY(), bb.getY() + bb.getH()];
  } catch { }
  const y = srHeadY(n, stave);
  return [y - 36, y + 8];
}
function srHeadY(n, stave) {
  try { const ys = n.getYs(); if (ys && ys.length) return ys.reduce((a, b) => a + b, 0) / ys.length; } catch { }
  return stave.getYForLine(2);
}
function srDraw(el, st) {
  el.innerHTML = '';
  if (!SR_VF) { el.innerHTML = '<div class="sr-msg">Music notation library missing.</div>'; return []; }
  const VF = SR_VF;
  const mode = st.mode, o = st[mode], ex = st.ex[mode]; if (!ex) return [];
  const [beats, kind] = SR_METERS[o.ts]; const [num, den] = o.ts.split('/').map(Number);
  // one or more parts, each on its own staff (solfege can have 2–3 parts)
  const parts = mode === 'solfege' && ex.parts && ex.parts.length > 1 ? ex.parts : [{ rhythm: ex.rhythm, pitches: ex.pitches || [], clef: mode === 'rhythm' ? 'percussion' : o.clef }];
  const P = parts.length, measures = parts[0].rhythm, nM = Math.max(...parts.map(p => p.rhythm.length));
  const keySig = mode === 'solfege' ? (o.scale === 'minor' ? o.key + 'm' : o.key) : null;
  // Measure exact header widths: row 0 has clef + key + time; rows 1+ have clef + key (no blank hole after clef).
  let firstW = 90 + (keySig ? 50 : 0) + (P > 1 ? 20 : 0);
  let firstWR = 48 + (keySig ? 50 : 0) + (P > 1 ? 20 : 0);
  try {
    const clef0 = mode === 'rhythm' ? 'percussion' : (parts[0].clef || o.clef);
    const p0 = new VF.Stave(0, 0, 320); p0.addClef(clef0); if (keySig) p0.addKeySignature(keySig); p0.addTimeSignature(o.ts);
    const h0 = p0.getNoteStartX() - p0.getX(); if (h0 > 20) firstW = Math.ceil(h0) + (P > 1 ? 10 : 4);
    const pR = new VF.Stave(0, 0, 320); pR.addClef(clef0); if (keySig) pR.addKeySignature(keySig);
    const hR = pR.getNoteStartX() - pR.getX(); if (hR > 16) firstWR = Math.ceil(hR) + (P > 1 ? 10 : 4);
  } catch { }
  // Natural printed-music measure width (busy measures get enough room for labels)
  let maxNotes = 0;
  for (let i = 0; i < nM; i++) maxNotes = Math.max(maxNotes, ...parts.map(p => (p.rhythm[i] || []).reduce((n, c) => n + c.ev.length, 0)));
  const showLbl = mode === 'rhythm' ? !!st.showCounts : !!st.show;   // rhythm lines show counts; staves show syllables
  const showBlanks = !!st.answerBlanks && !showLbl && !(mode !== 'rhythm' && st.showCounts);
  const needPerNote = (showLbl || st.showCounts || showBlanks) ? (mode === 'solfege' ? 40 : 36) : 26;
  const pOpts = st.__printOpts || null;
  const restW = pOpts?.restW || Math.max(150, maxNotes * needPerNote + 30);
  const extraC = st.showCounts && mode !== 'rhythm' ? (showLbl ? 34 : 20) : 0;
  const extraB = showBlanks ? 26 : 0;
  const partH = (P > 1 ? (showLbl ? 140 : 100) : (showLbl ? 175 : 125)) + extraC + extraB;
  const rowH = P * partH + (P > 1 ? 24 : 0) + (o.measureNums ? 6 : 0);
  // Try 1..6 measures per line and keep the layout that can be drawn biggest in the space we have (or use uniform worksheet layout).
  const CW = Math.max(280, (el.offsetWidth || el.clientWidth) - 24), CH = Math.max(140, (el.offsetHeight || el.clientHeight) - 30);
  let best = null;
  if (pOpts?.per) {
    const p = Math.min(nM, pOpts.per), r = Math.ceil(nM / p), w = firstW + p * restW + 10, h = r * rowH + 20;
    best = { p, w, h, sc: CW / w };
  } else {
    for (let p = 1; p <= Math.min(nM, 6); p++) {
      const r = Math.ceil(nM / p), w = firstW + p * restW + 10, h = r * rowH + 20;
      const sc = Math.min(CW / w, CH / h);
      if (!best || sc > best.sc * 1.02) best = { p, w, h, sc };
    }
  }
  const per = best.p, W = best.w, rows = Math.ceil(nM / per), H = rows * rowH + 20;
  const baseScale = Math.max(0.5, Math.min(best.sc, 3.5));
  el.__baseScale = baseScale; el.__vbW = W; el.__vbH = H;
  const scale = baseScale * (el.__zoom || 1);   // Zoom − / + or trackpad pinch
  const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(W, H);
  const ctx = renderer.getContext();
  const timeline = [];                       // playback events (all parts)
  const geo = { W, measures: [] };           // positions for the playhead
  const rowLabels = {};                      // labels per (line of music, part)
  const rowBlanks = {};                      // blank student answer lines per (line of music, part)
  let grpSeq = 0;                            // unique id per multi-note rhythm cell (for Kodály dashes)
  const pIdx = parts.map(() => 0);           // next pitch for each part
  const tieOpen = parts.map(() => null), tieList = [];   // a tie waiting for its second note, per part
  let t = 0;
  for (let i = 0; i < nM; i++) {
    const mStart = t, firstEv = timeline.length;
    const col = i % per, row = Math.floor(i / per);
    const rowFirstW = row === 0 ? firstW : firstWR;
    const rowRestW = row === 0 ? restW : (firstW + per * restW - firstWR) / per;
    const sx = col === 0 ? 5 : 5 + rowFirstW + col * rowRestW;
    const staves = [], voices = [], allNotes = [], beamsAll = [], tupsAll = [];
    let mLen = 0;
    parts.forEach((part, p) => {
      const clef = mode === 'rhythm' ? 'percussion' : (part.clef || o.clef);
      const stave = new VF.Stave(sx, row * rowH + 10 + p * partH, col === 0 ? rowFirstW + rowRestW : rowRestW);
      if (col === 0) {
        stave.addClef(clef);
        if (keySig) stave.addKeySignature(keySig);
      }
      if (i === 0) stave.addTimeSignature(o.ts);
      if (i === nM - 1) stave.setEndBarType(VF.Barline.type.END);
      stave.setContext(ctx).draw();
      staves.push(stave);
      if (o.measureNums && p === 0) {
        ctx.save(); ctx.setFont('Arial', 13, 'bold'); ctx.setFillStyle('#555b6e');
        const label = String(i + 1);
        let tw = label.length * 7.5; try { const mw = ctx.measureText(label).width; if (mw > 0) tw = mw; } catch { }
        ctx.fillText(label, Math.max(2, stave.getX() - tw / 2), stave.getYForLine(0) - 9);
        ctx.restore();
      }
      const notes = [];
      let pos = 0, tt = mStart;
      for (const c of (part.rhythm[i] || [])) {
        const group = [];
        const cellGrp = c.ev.length > 1 ? ++grpSeq : 0;
        for (let ei = 0; ei < c.ev.length; ei++) {
          const [dur, val, rest] = c.ev[ei];
          let keys = ['b/4'], label = srCount(pos, kind, rest, val, c.id, ei), info = null;
          const tiedIn = !rest && tieOpen[p];                  // the held-over half of a tied note
          if (mode === 'rhythm') keys = ['b/4'];
          else if (!rest) { info = srSpell(o.key, o.scale, part.pitches[pIdx[p]++], clef); if (tiedIn) info = tieOpen[p].info; keys = [info.key]; label = info.syl; }
          else keys = [clef === 'bass' ? 'd/3' : 'b/4'];
          if (tiedIn) label = mode === 'rhythm' ? `(${srCount(pos, kind, false, val, c.id, ei)})` : '';
          const n = new VF.StaveNote({ keys, duration: dur.replace('d', '') + (rest ? 'r' : ''), clef, dots: dur.includes('d') ? 1 : 0, auto_stem: mode !== 'rhythm' });
          if (dur.includes('d')) { if (VF.Dot && VF.Dot.buildAndAttach) VF.Dot.buildAndAttach([n], { all: true }); else n.addDotToAll(); }
          const lk = row + '|' + p;
          const grp = (!rest && !tiedIn && cellGrp) ? cellGrp : 0;
          if (showLbl && (!rest || mode === 'rhythm') && label) (rowLabels[lk] ||= []).push({ n, text: label, rest: !!rest || !!tiedIn, stave, grp, isRhy: mode === 'rhythm' });
          if (st.showCounts && mode !== 'rhythm') {
            const ct = tiedIn ? `(${srCount(pos, kind, false, val, c.id, ei)})` : srCount(pos, kind, rest, val, c.id, ei);
            if (ct) (rowLabels[lk + '|c'] ||= []).push({ n, text: ct, rest: !!rest || !!tiedIn, stave, counts: true, grp, isRhy: true });
          }
          if (showBlanks && (!rest || st.answerBlanksRests) && !tiedIn) {
            (rowBlanks[lk] ||= []).push({ n, stave, rest: !!rest });
          }
          notes.push(n); group.push({ n, dur, rest });
          allNotes.push({ n, pos, val, dotted: dur.includes('d'), text: (showLbl && (!rest || mode === 'rhythm') ? label : '') || (st.showCounts && mode !== 'rhythm' ? srCount(pos, kind, rest, val, c.id, ei) : '') });
          const tev = { t: tt, len: val, rest: !!rest, midi: info ? info.midi : null, n, part: p, stave };
          if (tiedIn) { tev.tiedFrom = true; const h = tieOpen[p].head; h.sound = (h.sound || h.len) + val; tieList.push({ a: tieOpen[p].n, b: n, rowA: tieOpen[p].row, rowB: row }); }
          timeline.push(tev);
          // this note is held into the next one: remember it (a chain of ties keeps the first note as the sound)
          tieOpen[p] = c.tie && ei === c.ev.length - 1 && !rest ? { n, info, row, head: tiedIn ? tieOpen[p].head : tev } : null;
          pos += val; tt += val;
        }
        // beam only runs of neighbouring eighths/16ths (8–q–8 must not be beamed over the quarter)
        let run = [];
        const flush = () => { if (run.length >= 2) beamsAll.push(new VF.Beam(run, mode !== 'rhythm')); run = []; };
        for (const g of group) { if (!g.rest && /^(8|16)/.test(g.dur)) run.push(g.n); else flush(); }
        flush();
        if (c.tup) tupsAll.push(new VF.Tuplet(group.map(g => g.n)));
      }
      mLen = Math.max(mLen, pos);
      const voice = new VF.Voice({ num_beats: num, beat_value: den }).setMode(VF.Voice.Mode.SOFT);
      voice.addTickables(notes);
      if (keySig && VF.Accidental.applyAccidentals) VF.Accidental.applyAccidentals([voice], keySig);
      voices.push(voice);
    });
    const stave0 = staves[0];
    if (P > 1) {                                                     // join the staves into one system
      const top = staves[0], bot = staves[staves.length - 1], C = VF.StaveConnector;
      const con = type => { try { new C(top, bot).setType(type).setContext(ctx).draw(); } catch { } };
      if (col === 0) { con(C.type.BRACKET); con(C.type.SINGLE_LEFT); }
      con(i === nM - 1 ? C.type.BOLD_DOUBLE_RIGHT : C.type.SINGLE_RIGHT);
    }
    // all parts formatted together, so notes at the same moment line up across the staves
    new VF.Formatter().format(voices, stave0.getNoteEndX() - stave0.getNoteStartX() - 12);
    // Natural printed-quality optical spacing: every moment gets room for its label,
    // then remaining space is distributed with a gentle engraving curve (val^0.75).
    {
      const avail = stave0.getNoteEndX() - stave0.getNoteStartX() - 16;
      const byPos = new Map();
      for (const it of allNotes) {
        const k = Math.round(it.pos * 1000);
        const g = byPos.get(k) || { pos: it.pos, need: 0, tcs: new Set() };
        g.need = Math.max(g.need, Math.max(showLbl ? 30 : 24, it.text ? it.text.length * 9 + 14 : 0) + (it.dotted ? 8 : 0));
        const tc = it.n.getTickContext && it.n.getTickContext(); if (tc) g.tcs.add(tc);
        byPos.set(k, g);
      }
      const groups = [...byPos.values()].sort((a, b) => a.pos - b.pos);
      groups.forEach((g, j) => g.val = Math.pow(Math.max(0.125, (groups[j + 1]?.pos ?? mLen) - g.pos), 0.75));
      const totalNeed = groups.reduce((a, g) => a + g.need, 0), dsum = groups.reduce((a, g) => a + g.val, 0) || 1;
      const extra = Math.max(0, avail - totalNeed), squeeze = totalNeed > avail ? avail / totalNeed : 1;
      let x = 8;
      for (const g of groups) { for (const tc of g.tcs) if (tc.setX) tc.setX(x); x += g.need * squeeze + extra * g.val / dsum; }
    }
    voices.forEach((v, p) => v.draw(ctx, staves[p]));
    beamsAll.forEach(b => {
      const root = ctx.svg || el.querySelector('svg'), before = root.childNodes.length;
      b.setContext(ctx).draw();
      srBeamHalves(b, [...root.childNodes].slice(before));
    });
    tupsAll.forEach(tp => tp.setContext(ctx).draw());
    t = mStart + mLen;
    // playhead knots: (time, x, top, bottom) at every moment, across all parts, plus the end of the measure
    const evs = timeline.slice(firstEv);
    const sLast = staves[staves.length - 1], mid = (stave0.getYForLine(0) + sLast.getYForLine(4)) / 2;
    const kmap = new Map();
    for (const e of evs) {
      e.y = srHeadY(e.n, e.stave);
      const [a, b] = srNoteExtent(e.n, e.stave), k = Math.round(e.t * 1000), x = srHeadX(e.n);
      const cur = kmap.get(k);
      if (!cur) kmap.set(k, [e.t, x, a, b]); else { cur[2] = Math.min(cur[2], a); cur[3] = Math.max(cur[3], b); }
    }
    const knots = [...kmap.values()].sort((p, q) => p[0] - q[0]);
    if (knots[0] && knots[0][0] > mStart) knots.unshift([mStart, stave0.getNoteStartX() + 8, mid, mid]);
    knots.push([t, stave0.getNoteEndX() - 4, mid, mid]);
    // Precompute Fritsch-Carlson monotone cubic Hermite tangents for smooth, non-jerky playhead glide across optical engraving
    const knN = knots.length, slopes = new Array(knN).fill(0);
    if (knN >= 2) {
      const ds = [];
      for (let j = 0; j < knN - 1; j++) {
        const dt = knots[j + 1][0] - knots[j][0];
        ds.push(dt > 1e-6 ? Math.max(0, (knots[j + 1][1] - knots[j][1]) / dt) : 0);
      }
      slopes[0] = ds[0]; slopes[knN - 1] = ds[knN - 2];
      for (let j = 1; j < knN - 1; j++) slopes[j] = (ds[j - 1] > 0 && ds[j] > 0) ? (ds[j - 1] + ds[j]) / 2 : 0;
      for (let j = 0; j < knN - 1; j++) {
        if (ds[j] <= 1e-6) { slopes[j] = 0; slopes[j + 1] = 0; continue; }
        const a = slopes[j] / ds[j], b = slopes[j + 1] / ds[j], h = Math.hypot(a, b);
        if (h > 3) { const s = 3 / h; slopes[j] = s * a * ds[j]; slopes[j + 1] = s * b * ds[j]; }
      }
    }
    geo.measures.push({ t0: mStart, t1: t, y0: stave0.getYForLine(0) - 18, y1: sLast.getYForLine(4) + 18, knots, slopes, x0: stave0.getX(), x1: stave0.getX() + stave0.getWidth() });
  }
  for (const tl of tieList) {
    try {
      if (tl.rowA === tl.rowB) new VF.StaveTie({ first_note: tl.a, last_note: tl.b, first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
      else {                                                         // across a line break: two half ties
        new VF.StaveTie({ first_note: tl.a, last_note: null, first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
        new VF.StaveTie({ first_note: null, last_note: tl.b, first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
      }
    } catch { }
  }
  timeline.forEach(e => { e.el = e.n.getAttribute ? e.n.getAttribute('el') : (e.n.attrs && e.n.attrs.el); delete e.n; delete e.stave; });
  timeline.sort((a, b) => a.t - b.t || a.part - b.part);
  timeline.geo = geo;
  timeline.parts = P;
  // Counting / solfege under each staff: keep every syllable aligned on ONE crisp horizontal baseline.
  // If a tight 16th-note run gets crowded, gently scale the font size for that label instead of dropping it to a lower line.
  // In Kodály mode, draw clean hyphens (-) centered between grouped syllables (ti - ti, ti - ka - ti - ka, syn - co - pa).
  const measureText = (txt, sz = 14) => { try { const w = ctx.measureText(txt).width; if (w > 0) return w; } catch { } return txt.length * (sz * 0.54); };
  const useDashes = rhythmSys() === 'kodaly' || rhythmSys() === 'takadimi';
  Object.entries(rowLabels).forEach(([lkey, items]) => {
    const below = lkey.endsWith('|c') && rowLabels[lkey.slice(0, -2)] ? 24 : 0;   // counts go cleanly under syllables
    if (!items.length) return;
    let bottom = items[0].stave.getYForLine(4) + 14;
    for (const { n } of items) {
      const ys = n.getYs ? n.getYs() : [];
      const down = n.getStemDirection && n.getStemDirection() === -1 && !n.isRest?.();
      if (ys.length) bottom = Math.max(bottom, Math.max(...ys) + (down ? 36 : 10));
    }
    const baseY = bottom + 16 + below;
    const cxs = items.map(it => srHeadX(it.n));
    const placed = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx], cx = cxs[idx];
      const leftGap = idx > 0 ? cx - cxs[idx - 1] : 999;
      const rightGap = idx < items.length - 1 ? cxs[idx + 1] - cx : 999;
      const needDash = useDashes && it.isRhy && it.grp && (
        (idx > 0 && items[idx - 1].grp === it.grp) || (idx < items.length - 1 && items[idx + 1].grp === it.grp)
      );
      const maxW = Math.max(14, Math.min(leftGap, rightGap) - (needDash ? 7 : 3));
      let sz = 14;
      ctx.save();
      ctx.setFont('Arial', sz, it.rest ? 'italic' : 'bold');
      let w = measureText(it.text, sz);
      if (w > maxW) {
        sz = Math.max(9.5, Math.floor((sz * (maxW / w)) * 2) / 2);
        ctx.setFont('Arial', sz, it.rest ? 'italic' : 'bold');
        w = measureText(it.text, sz);
      }
      const x = cx - w / 2;
      ctx.setFillStyle(it.counts ? (it.rest ? '#9aa0b0' : '#5a6072') : it.rest ? '#7a8194' : '#1d2330');
      ctx.fillText(it.text, x, baseY);
      ctx.restore();
      placed.push({ it, cx, x, w, sz });
    }
    // Draw group dashes (-) centered between adjacent syllables in the same rhythmic group (Kodály & Takadimi)
    if (useDashes) {
      for (let idx = 1; idx < placed.length; idx++) {
        const a = placed[idx - 1], b = placed[idx];
        if (!a.it.isRhy || !b.it.isRhy || !a.it.grp || a.it.grp !== b.it.grp) continue;
        const aRight = a.x + a.w, bLeft = b.x;
        const midX = (aRight + bLeft) / 2;
        const dsz = Math.min(a.sz, b.sz);
        ctx.save();
        ctx.setFont('Arial', dsz, 'bold');
        ctx.setFillStyle(a.it.counts ? '#5a6072' : '#1d2330');
        const dw = measureText('-', dsz);
        ctx.fillText('-', midX - dw / 2, baseY);
        ctx.restore();
      }
    }
  });
  // Blank student answer lines underneath each note (for printable worksheets when answers are hidden)
  const svg = el.querySelector('svg');
  if (showBlanks && svg) {
    const NS = 'http://www.w3.org/2000/svg';
    Object.values(rowBlanks).forEach(items => {
      if (!items.length) return;
      let bottom = items[0].stave.getYForLine(4) + 14;
      for (const { n } of items) {
        const ys = n.getYs ? n.getYs() : [];
        const down = n.getStemDirection && n.getStemDirection() === -1 && !n.isRest?.();
        if (ys.length) bottom = Math.max(bottom, Math.max(...ys) + (down ? 36 : 10));
      }
      const lineY = bottom + 22;
      const cxs = items.map(it => srHeadX(it.n));
      items.forEach((it, idx) => {
        const cx = cxs[idx];
        const leftGap = idx > 0 ? cx - cxs[idx - 1] : 999;
        const rightGap = idx < items.length - 1 ? cxs[idx + 1] - cx : 999;
        const half = Math.max(6, Math.min(13, Math.min(leftGap, rightGap) * 0.38));
        const ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', (cx - half).toFixed(1));
        ln.setAttribute('x2', (cx + half).toFixed(1));
        ln.setAttribute('y1', lineY.toFixed(1));
        ln.setAttribute('y2', lineY.toFixed(1));
        ln.setAttribute('stroke', it.rest ? '#9aa2b4' : '#3a4252');
        ln.setAttribute('stroke-width', '1.4');
        ln.setAttribute('stroke-linecap', 'round');
        svg.appendChild(ln);
      });
    });
  }
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    Object.assign(svg.style, { width: Math.floor(W * scale) + 'px', height: Math.floor(H * scale) + 'px', display: 'block', margin: '0 auto' });
  }
  return timeline;
}

// ---------- playback
const SR_PLAY = { stopAt: 0, nodes: [], master: null, timer: null };
// ---------- playback instruments
const SR_INSTRUMENTS = [['soft', 'Soft tone'], ['piano', 'Piano'], ['organ', 'Organ'], ['mallet', 'Marimba'], ['none', 'Playhead only (no sound)']];
// partials [wave, multiple, level], attack, envelope ('hold' sustains for the note; 'decay' rings and fades
// like a struck string or bar), sustain level, decay time, vibrato depth, low-pass (× pitch)
const SR_INS = {
  soft: { p: [['triangle', 1, .35], ['sine', 2, .08], ['sine', 3, .03]], atk: .012, env: 'hold', sus: .7 },
  piano: { p: [['sine', 1, .42], ['sine', 2, .12], ['sine', 3, .04], ['sine', 4, .015]], atk: .014, env: 'decay', tc: .6 },
  organ: { p: [['sine', 1, .22], ['sine', 2, .14], ['sine', 3, .07], ['sine', 4, .05], ['sine', 6, .02]], atk: .015, env: 'hold', sus: 1 },
  mallet: { p: [['sine', 1, .45], ['sine', 3.93, .07], ['sine', 9.4, .015]], atk: .002, env: 'decay', tc: .22 },
};
function srVoice(c, dest, time, midi, dur, ins = 'soft', cue = false) {
  const I = SR_INS[ins] || SR_INS.soft, f = 440 * Math.pow(2, (midi - 69) / 12), end = time + dur;
  const rel = Math.min(0.08, dur * 0.25), hold = Math.max(time + I.atk + 0.01, end - rel);
  let out = dest, lp = null;
  if (I.lp) { lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(12000, f * I.lp); lp.Q.value = 0.5; lp.connect(dest); out = lp; }
  let lfo = null, lfoG = null;
  if (I.vib && dur > 0.35 && !cue) {   // vibrato fades in after the start, like a player would
    lfo = c.createOscillator(); lfoG = c.createGain(); lfo.frequency.value = 5.2;
    lfoG.gain.setValueAtTime(0, time); lfoG.gain.setValueAtTime(0, time + 0.2); lfoG.gain.linearRampToValueAtTime(f * I.vib, time + 0.6);
    lfo.connect(lfoG); lfo.start(time); lfo.stop(end + 0.1);
  }
  // count-in pitches always ring and fade (never a held note); slow attacks are kept short there
  const env = cue ? 'decay' : I.env, atk = cue ? Math.min(I.atk, 0.02) : I.atk;
  for (const [type, mul, amp0] of I.p) {
    const os = c.createOscillator(), g = c.createGain(), amp = amp0 * (cue && env !== I.env ? 0.9 : 1);
    os.type = type; os.frequency.value = f * mul;
    if (lfoG) lfoG.connect(os.frequency);
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(amp, time + atk);
    if (env === 'hold') {
      g.gain.setTargetAtTime(amp * I.sus, time + atk, 0.08);
      g.gain.setValueAtTime(amp * I.sus, hold); g.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      // upper partials die away faster; low notes ring longer
      const tc = (I.tc || 0.35) * (cue ? 0.7 : 1) * Math.min(1.6, Math.max(0.6, 300 / f)) / Math.sqrt(mul);
      g.gain.setTargetAtTime(0.0001, time + atk, tc);
      g.gain.setTargetAtTime(0.0001, hold, rel / 3 + 0.005);
    }
    os.connect(g).connect(out); os.start(time); os.stop(end + 0.1);
  }
  if (I.breath && !cue && SR_PLAY.noise && SR_PLAY.noise.sampleRate === c.sampleRate) {   // a little air at the start
    const src = c.createBufferSource(), bf = c.createBiquadFilter(), g = c.createGain();
    src.buffer = SR_PLAY.noise; bf.type = 'bandpass'; bf.frequency.value = Math.min(9000, f * 3); bf.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.05, time + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    src.connect(bf).connect(g).connect(dest); src.start(time, Math.random() * 0.5); src.stop(time + 0.2);
  }
}
function srStop() {
  try { SR_PLAY.master && SR_PLAY.master.disconnect(); } catch { }
  SR_PLAY.master = null; clearInterval(SR_PLAY.timer); SR_PLAY.timer = null;
  for (const n of SR_PLAY.extra || []) { try { n.stop ? n.stop() : n.disconnect(); } catch { } }   // a take being listened back
  SR_PLAY.extra = [];
  document.querySelectorAll('.gr-listen.on').forEach(b => { b.classList.remove('on'); if (b.dataset.idle) b.innerHTML = b.dataset.idle; });
  document.querySelectorAll('.sr [data-sr="play"]').forEach(b => b.innerHTML = IC('ico:play') + ' Play');
}
// macOS puts the sound output to sleep after a short silence, and waking it swallows or bunches up
// the first sounds. After the first Play, a silent sound keeps the output awake while the app is open.
function srKeepAwake(c) {
  if (c.__awake) return;
  try {
    const os = c.createOscillator(), g = c.createGain();
    g.gain.value = 0; os.frequency.value = 20; os.connect(g).connect(c.destination); os.start();
    c.__awake = true;
  } catch { }
}
function srPlay(st, timeline, onEnd) {
  srStop();
  const c = ac(); c.resume && c.resume(); srKeepAwake(c);
  const master = c.createGain(); master.gain.value = (timeline.parts || 1) > 1 ? 0.55 : 0.9; master.connect(musicOut(c)); SR_PLAY.master = master;
  const o = st[st.mode]; const [beats, kind] = SR_METERS[o.ts];
  const beatQ = kind === 'compound' ? 1.5 : 1;                  // tempo counts the beat (dotted quarter in compound)
  const q = 60 / o.tempo / beatQ;                              // seconds per quarter-note unit
  const t0 = c.currentTime + (c.state === 'running' ? 0.25 : 0.4);   // room for the output to start
  // count-in & metronome: a light, high electronic tick (accent on beat 1)
  const click = (time, accent, gain = 1) => {
    gain *= metVol(); if (gain < 0.002) return;                 // the metronome's own volume
    const os = c.createOscillator(), g = c.createGain();
    os.type = 'sine'; os.frequency.value = accent ? 3200 : 2500;
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.22 * gain, time + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    os.connect(g).connect(master); os.start(time); os.stop(time + 0.04);
  };
  if (!SR_PLAY.noise || SR_PLAY.noise.sampleRate !== c.sampleRate) {
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    SR_PLAY.noise = b;
  }
  const noise = (time, dur, type, freq, q, peak) => {
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = SR_PLAY.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(peak, time + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f).connect(g).connect(master); src.start(time, Math.random() * 0.5); src.stop(time + dur + 0.02);
  };
  const clap = (time) => {   // hand clap: three quick bursts + a short room tail
    for (const dt of [0, 0.011, 0.022]) noise(time + dt, 0.02, 'bandpass', 1200, 0.9, 1.0);
    noise(time + 0.03, 0.14, 'bandpass', 1100, 0.7, 0.55);
  };
  const drum = (time) => {   // snare-ish: noise crack + low body
    noise(time, 0.16, 'highpass', 1500, 0.7, 0.7);
    const os = c.createOscillator(), g = c.createGain();
    os.type = 'triangle'; os.frequency.setValueAtTime(220, time); os.frequency.exponentialRampToValueAtTime(140, time + 0.1);
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.9, time + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    os.connect(g).connect(master); os.start(time); os.stop(time + 0.16);
  };
  const block = (time) => {   // woodblock-ish
    const os = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    os.type = 'triangle'; os.frequency.setValueAtTime(900, time); os.frequency.exponentialRampToValueAtTime(600, time + 0.08);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.9, time + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    os.connect(f).connect(g).connect(master); os.start(time); os.stop(time + 0.14);
  };
  // notes use the chosen instrument and note length (read each time, so changes apply right away);
  // count-in pitches are short and fade, so they never ring into the music
  const tone = (time, midi, dur, cue = false) => {
    const oo = st[st.mode] || o;
    if (!cue && oo.instrument === 'none') return;               // "Playhead only": the music is silent, the playhead still moves
    if (!cue && oo.artic === 'detached') dur = Math.max(0.06, Math.min(dur * 0.6, dur - 0.05));
    srVoice(c, master, time, midi, cue ? Math.min(dur, 0.9) : dur, oo.instrument || 'soft', cue);
  };
  // count-in: 0, 1 or 2 bars of clicks (beat 1 accented)
  // Solfege can sound a reference during the count-in: do, the starting note, or the do chord.
  // start at the measure you clicked (count-in and starting pitch are for that measure)
  const M = timeline.geo?.measures || [], fromM = Math.max(0, Math.min(Number(st.startM) || 0, M.length - 1));
  const tStart = M[fromM]?.t0 || 0;
  const firstPitchIdx = timeline.filter(e => !e.rest && !e.part && e.t < tStart - 1e-6).length;   // notes before the start
  const cuePitch = st.mode === 'solfege' ? (o.countPitch ?? 'do') : 'none';
  const bars = Number(o.countIn ?? 1) || (cuePitch !== 'none' ? 1 : 0);   // a pitch cue needs at least one bar
  const beatSec = q * beatQ, countBeats = beats * bars;
  for (let b = 0; b < countBeats; b++) click(t0 + b * beatSec, b % beats === 0, 1.2);
  let cue = null;
  if (cuePitch !== 'none' && st.ex.solfege) {
    const sp = d => srSpell(o.key, o.scale, d, o.clef), first = sp(st.ex.solfege.pitches[firstPitchIdx] ?? st.ex.solfege.pitches[0] ?? 0), barSec = beats * beatSec;
    if (cuePitch === 'start') {
      if ((timeline.parts || 1) > 1) {                         // each part hears its own first note
        for (let pp = 0; pp < timeline.parts; pp++) { const e = timeline.find(x => x.part === pp && !x.rest && x.t >= tStart - 1e-6); if (e) tone(t0 + pp * 0.12, e.midi, beatSec, true); }
      } else tone(t0, first.midi, beatSec, true);
    }
    else if (cuePitch === 'chord') { [0, 2, 4].forEach((d, i) => tone(t0 + i * Math.min(beatSec, barSec / 3) * 0.5, sp(d).midi, beatSec * 1.5, true)); }
    else tone(t0, sp(0).midi, beatSec, true);
    cue = { heard: cuePitch === 'start' ? first.syl : cuePitch === 'chord' ? 'do – mi – sol' : 'do', start: first.syl };
  } else if (st.mode === 'solfege' && st.ex.solfege) {
    cue = { heard: null, start: srSpell(o.key, o.scale, st.ex.solfege.pitches[firstPitchIdx] ?? st.ex.solfege.pitches[0] ?? 0, o.clef).syl };
  }
  const total = timeline.reduce((m, e) => Math.max(m, e.t + e.len), 0);
  const countLen = countBeats * beatQ;                          // count-in length in quarter-note units
  // The clock maps "position in quarter notes" (count-in is negative) to audio time. When the tempo
  // changes mid-play we re-anchor it, so the music speeds up/slows down from where it is.
  const clock = {
    anchorT: t0, anchorPos: tStart - countLen, q, total, beatQ, beats, countBeats, countLen, cue, start: tStart, fromM,
    pos(now) { return this.anchorPos + (now - this.anchorT) / this.q; },
    timeAt(pos) { return this.anchorT + (pos - this.anchorPos) * this.q; },
  };
  const evs = timeline.map(e => ({ t: e.t, len: e.sound || e.len, rest: e.rest || !!e.tiedFrom, midi: e.midi }));
  let nextBeat = Math.ceil(tStart / beatQ - 1e-6), nextEv = evs.findIndex(e => e.t >= tStart - 1e-6);   // count-in clicks were scheduled above
  if (nextEv < 0) nextEv = evs.length;
  // Look ~300 ms ahead every 25 ms, reading the current settings each time: metronome on/off,
  // rhythm sound and tempo all take effect on the next beat — no restart needed. (The look-ahead is
  // long enough that a short pause while the page redraws can't make a note late.)
  SR_PLAY.timer = setInterval(() => {
    if (!SR_PLAY.master) return;
    const now = c.currentTime, oo = st[st.mode] || o;
    const nq = 60 / (Number(oo.tempo) || 80) / beatQ;
    if (Math.abs(nq - clock.q) > 1e-9 && clock.pos(now) > tStart) { const pnow = clock.pos(now); clock.anchorT = now; clock.anchorPos = pnow; clock.q = nq; }
    const horizon = now + 0.3;
    while (nextBeat * beatQ < total - 1e-6 && clock.timeAt(nextBeat * beatQ) < horizon) {
      if (oo.metronome) click(Math.max(now, clock.timeAt(nextBeat * beatQ)), nextBeat % beats === 0, 0.5);
      nextBeat++;
    }
    while (nextEv < evs.length && clock.timeAt(evs[nextEv].t) < horizon) {
      const e = evs[nextEv++]; if (e.rest) continue;
      const at = Math.max(now, clock.timeAt(e.t));
      if (st.mode === 'rhythm') { if (oo.sound !== 'none') ({ clap, drum, woodblock: block }[oo.sound] || clap)(at); } else tone(at, e.midi, e.len * clock.q);
    }
    if (nextEv >= evs.length && clock.pos(now) > total + 0.4) { srStop(); onEnd && onEnd(); }
  }, 25);
  return clock;
}

// ---------- playhead
// the audio-clock time of what you're hearing now (speakers/Bluetooth add delay)
function srHeard() {
  const c = ac(), dl = avDelayMs() / 1000;
  return srHeard0(c) - dl;
}
function srHeard0(c) {
  try { const ts = c.getOutputTimestamp && c.getOutputTimestamp(); if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000; } catch { }
  return c.currentTime - (c.outputLatency || c.baseLatency || 0);
}
function srHidePlayhead(host) {
  host.querySelector('.sr-ph')?.remove();
  host.querySelector('.sr-count')?.remove();
  host.querySelectorAll('.sr-cur').forEach(e => e.classList.remove('sr-cur'));
}
function srAnimate(host, st, getTimeline, clock) {
  // Runs for the whole playback and looks things up fresh every frame, so redrawing the music
  // (toggling counts, measure numbers or the playhead itself) never interrupts it.
  let lastEl = null, lastBeat = -1, prevTq = null;
  const myRun = SR_PLAY.run = (SR_PLAY.run || 0) + 1;        // a restarted playback replaces this loop
  const frame = () => {
    if (SR_PLAY.run !== myRun) return;
    if (!(clock.alive ? clock.alive() : SR_PLAY.master)) { srHidePlayhead(host); return; }
    const staff = host.querySelector('.sr-staff'), svg = staff?.querySelector('svg');
    const tl = getTimeline(), geo = tl && tl.geo;
    if (!staff || !svg || !geo) { requestAnimationFrame(frame); return; }
    let bar = staff.querySelector('.sr-ph');
    if (!bar) { bar = document.createElement('div'); bar.className = 'sr-ph'; staff.appendChild(bar); lastEl = null; }
    const nowT = clock.heard ? clock.heard() : srHeard();
    let cnt = staff.querySelector('.sr-count');
    if (clock.countBeats && clock.pos(nowT) < (clock.start || 0)) {
      if (!cnt) { cnt = document.createElement('div'); cnt.className = 'sr-count'; staff.appendChild(cnt); }
      const bi = Math.max(0, Math.floor((clock.pos(nowT) - (clock.start || 0) + clock.countLen) / clock.beatQ + 1e-6));
      const txt = String((bi % clock.beats) + 1);
      if (cnt.dataset.n !== txt) {
        cnt.dataset.n = txt;
        const c = clock.cue;
        const cueLine = c?.tap
          ? `<div class="sr-count-cue">Wait for count-in, then <b>tap on each note</b></div>`
          : c ? `<div class="sr-count-cue">${c.heard ? `hear <b>${c.heard}</b> · ` : ''}start on <b>${c.start}</b></div>` : '';
        cnt.innerHTML = `<div class="sr-count-n">${txt}</div>${cueLine}`;
        cnt.classList.toggle('one', txt === '1'); cnt.classList.remove('hit'); void cnt.offsetWidth; cnt.classList.add('hit');
      }
    } else if (cnt) cnt.remove();
    const mode = st.playhead ?? 'beat';
    if (mode === 'off') { bar.style.display = 'none'; staff.querySelectorAll('.sr-cur').forEach(e => e.classList.remove('sr-cur')); lastEl = null; requestAnimationFrame(frame); return; }
    bar.classList.toggle('glide', mode === 'notes');
    const sr = svg.getBoundingClientRect(), fr = staff.getBoundingClientRect();
    const k = sr.width / geo.W, ox = sr.left - fr.left, oy = sr.top - fr.top + staff.scrollTop;
    const tq = clock.pos(nowT);                     // quarter-notes since bar 1
    if (!bar.firstChild) bar.innerHTML = '<i class="seg top"></i><i class="seg bot"></i>';
    // Steady playhead: one short mark above and one below, outside the staff and clear of every
    // note in the example, so it never moves up and down (it only travels left to right).
    if (!geo.gap) {
      let up = 0, dn = 0;                                  // how far notes reach past the staff lines
      for (const mm of geo.measures) {
        const lt = mm.y0 + 18, lb = mm.y1 - 18;
        for (const kk of mm.knots) { if (kk[2] != null) up = Math.max(up, lt - kk[2]); if (kk[3] != null) dn = Math.max(dn, kk[3] - lb); }
      }
      dn = Math.min(dn, 40);
      // solfege syllables / counts printed under the staff: the lower mark goes beneath them
      const lines = [...new Set(geo.measures.map(mm => mm.y1 - 18))];
      for (const tx of svg.querySelectorAll('text')) {
        let bb; try { bb = tx.getBBox(); } catch { continue; }
        const cy = bb.y + bb.height / 2;
        // only text that belongs under THIS line — not the next line's measure numbers
        const tops = [...new Set(geo.measures.map(mm => mm.y0 + 18))];
        for (const lb of lines) {
          const nextTop = Math.min(...tops.filter(t => t > lb + 1), Infinity);
          if (cy > lb && cy < Math.min(lb + 70, nextTop - 14)) dn = Math.max(dn, bb.y + bb.height - lb + 2);
        }
      }
      geo.gap = { up: Math.min(up, 40), dn };
    }
    const place = (m, x) => {
      const pad = 6, len = 22;
      const a = m.y0 + 18 - geo.gap.up - pad, b = m.y1 - 18 + geo.gap.dn + pad;   // the clear band
      const y0 = a - len, y1 = b + len;
      bar.style.display = 'block';
      bar.style.left = ox + x * k + 'px';
      bar.style.top = oy + y0 * k + 'px';
      bar.style.height = (y1 - y0) * k + 'px';
      const t = bar.children[0], bt = bar.children[1];
      t.style.height = len * k + 'px';
      bt.style.top = (b - y0) * k + 'px';
      bt.style.height = len * k + 'px';
    };
    if (tq < (clock.start || 0)) {                                                 // count-in: wait at the first note, breathing
      const m0 = geo.measures[clock.fromM || 0] || geo.measures[0], k0 = m0.knots[0]; bar.classList.add('pulse'); place(m0, k0[1], k0[2], k0[3]);
      requestAnimationFrame(frame); return;
    }
    bar.classList.remove('pulse');
    const m = geo.measures.find(mm => tq >= mm.t0 && tq < mm.t1) || geo.measures[geo.measures.length - 1];
    let x, top, bot;
    if (mode === 'notes') {
      let j = 0; while (j < m.knots.length - 2 && tq >= m.knots[j + 1][0] - 1e-6) j++;
      const kn0 = m.knots[j];                                         // the newest note start in any part
      x = kn0[1]; top = kn0[2]; bot = kn0[3];                         // glides (CSS) onto each note
    } else {
      let i = 0; while (i < m.knots.length - 2 && tq >= m.knots[i + 1][0]) i++;
      const [ta, xa] = m.knots[i], [tb, xb] = m.knots[i + 1] || m.knots[i];
      const dt = tb - ta;
      if (dt > 1e-6) {
        const f = Math.max(0, Math.min(1, (tq - ta) / dt)), f2 = f * f, f3 = f2 * f;
        const ma = m.slopes ? m.slopes[i] : (xb - xa) / dt, mb = m.slopes ? m.slopes[i + 1] : (xb - xa) / dt;
        x = (2 * f3 - 3 * f2 + 1) * xa + (f3 - 2 * f2 + f) * dt * ma + (-2 * f3 + 3 * f2) * xb + (f3 - f2) * dt * mb;
      } else x = xa;
      const beat = Math.floor(tq / clock.beatQ + 1e-6);
      if (beat !== lastBeat) { lastBeat = beat; bar.classList.remove('beat'); void bar.offsetWidth; bar.classList.add('beat'); }
    }
    place(m, x, top, bot);
    // each note lights up as it sounds, with a soft ring on the notehead
    if (prevTq == null || tq < prevTq - 0.05) prevTq = tq - 1e-3;   // first frame, or a jump back
    for (const ev of tl) {
      if (ev.rest || ev.tiedFrom || ev.t > tq + 1e-6 || ev.t <= prevTq + 1e-6) continue;
      const mm = geo.measures.find(q => ev.t >= q.t0 - 1e-6 && ev.t < q.t1 - 1e-6), kn = mm?.knots.find(kk => Math.abs(kk[0] - ev.t) < 1e-6);
      if (!kn) continue;
      const ring = document.createElement('div'); ring.className = 'sr-ring';
      ring.style.left = ox + kn[1] * k + 'px'; ring.style.top = oy + (ev.y ?? (mm.y0 + mm.y1) / 2) * k + 'px';
      staff.appendChild(ring); setTimeout(() => ring.remove(), 600);
    }
    prevTq = tq;
    // light every note sounding now (all parts)
    const actI = [], act = [];
    tl.forEach((ev, i) => { if (!ev.rest && tq >= ev.t - 1e-6 && tq < ev.t + ev.len - 1e-6) { actI.push(i); act.push(ev.el); } });
    const akey = actI.join();
    if (akey !== lastEl) { staff.querySelectorAll('.sr-cur').forEach(x => srLight(x, false)); act.forEach(x => srLight(x, true)); lastEl = akey; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- UI
function srSettingsHTML(st, host = null) {
  const o = st[st.mode], m = st.mode;
  const opt = (v, cur, label = v) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const meters = m === 'rhythm' ? Object.keys(SR_METERS) : ['2/4', '3/4', '4/4'];
  const table = m === 'rhythm' ? srCellsFor(o.ts) : Object.fromEntries(SR_MEL_CELLS.map(k => [k, SR_SIMPLE[k]]));
  const presets = srSavedPresets().filter(p => p.mode === m);
  const savingPreset = !!host?.__savingPreset;
  const presetsCard = `<div class="sr-scard sr-scard-pre">
      <div class="sr-scard-bd sr-pre-row">
        <span class="sr-scard-inl">Presets</span>
        ${presets.map(p => `<span class="sr-pre-pill ${srPresetMatches(o, p) ? 'on' : ''}"><button type="button" data-sr="preset-load" data-pid="${esc(p.id)}" title="Apply preset “${esc(p.name)}”">${esc(p.name)}</button><button type="button" class="x" data-sr="preset-del" data-pid="${esc(p.id)}" title="Delete preset" aria-label="Delete preset">${IC('ico:close')}</button></span>`).join('')}
        ${savingPreset
          ? `<span class="sr-pre-form"><input type="text" class="sr-pre-inp" placeholder="Preset name (e.g. Choir Level 1)" maxlength="40"><button type="button" class="sr-pre-ok" data-sr="preset-save-ok">Save</button><button type="button" data-sr="preset-save-cancel">Cancel</button></span>`
          : `<button type="button" class="sr-pre-add" data-sr="preset-save" title="Save all current settings below as a named preset">${IC('ico:plus')} Save preset…</button>`}
        ${!presets.length && !savingPreset ? `<span class="sr-pre-empty">Save your favorite key, meter &amp; rhythm combinations to switch in one click.</span>` : ''}
      </div>
    </div>`;
  const pitchCard = m === 'solfege' ? `<div class="sr-scard">
      <div class="sr-scard-hd">Pitch &amp; Melody</div>
      <div class="sr-scard-bd">
        <label>Key <select data-k="key">${SR_KEYS.map(k => opt(k, o.key, k.replace('b', '♭'))).join('')}</select></label>
        <label>Mode <select data-k="scale">${opt('major', o.scale, 'Major')}${opt('minor', o.scale, 'Minor (do-based)')}</select></label>
        <label>Clef <select data-k="clef">${opt('treble', o.clef, 'Treble')}${opt('bass', o.clef, 'Bass')}</select></label>
        <label>Range <select data-k="range">${Object.entries(SR_RANGES).map(([k, v]) => opt(k, o.range, v[0])).join('')}</select></label>
        <label title="Sequences: a short idea repeated a step higher or lower, then a cadence. Mixed: some phrases use a sequence, others are written freely. Free: no sequences.">Melody <select data-k="melodyStyle">${opt('patterns', o.melodyStyle || 'mixed', 'Sequences')}${opt('mixed', o.melodyStyle || 'mixed', 'Mixed')}${opt('free', o.melodyStyle || 'mixed', 'Free')}</select></label>
        <label>Motion <select data-k="leap">${Object.entries(SR_LEAPS).map(([k, v]) => opt(k, o.leap, v)).join('')}</select></label>
        <label>Parts <select data-k="parts">${opt(1, o.parts || 1, '1 line')}${opt(2, o.parts || 1, '2 parts')}${opt(3, o.parts || 1, '3 parts')}</select></label>
        <label class="srchk"><input type="checkbox" data-k="startDo" ${o.startDo ? 'checked' : ''}> Start on do</label>
        ${(o.parts || 1) > 1 ? `<label>Type <select data-k="texture">${opt('harmony', o.texture || 'harmony', 'Harmony')}${opt('canon', o.texture || 'harmony', 'Canon (round)')}</select></label>
          ${(o.texture || 'harmony') === 'canon' ? `<label>Next part enters after <select data-k="canonDelay">${opt(1, o.canonDelay || 1, '1 measure')}${opt(2, o.canonDelay || 1, '2 measures')}</select></label>`
            : `<label>Rhythm <select data-k="partRhythm">${opt('same', o.partRhythm || 'same', 'Same in every part')}${opt('different', o.partRhythm || 'same', 'Different per part')}</select></label>
               <label>Unison <select data-k="unison">${opt('lots', o.unison || 'lots', 'Lots')}${opt('some', o.unison || 'lots', 'Some')}${opt('none', o.unison || 'lots', 'None')}</select></label>`}
          ${[2, 3].filter(n => n <= o.parts).map(n => `<label>Part ${n} clef <select data-k="clef${n}">${opt('treble', srPartClef(o, n - 1), 'Treble')}${opt('bass', srPartClef(o, n - 1), 'Bass')}</select></label>`).join('')}` : ''}
      </div>
    </div>` : '';
  const meterCard = `<div class="sr-scard">
      <div class="sr-scard-hd">Meter &amp; Counting</div>
      <div class="sr-scard-bd">
        <label>Time <select data-k="ts">${meters.map(v => opt(v, o.ts)).join('')}</select></label>
        <label>Measures <span class="sr-step sr-mstep"><button type="button" data-sr="step" data-f="measures" data-d="-1" title="Fewer" aria-label="Fewer measures">${IC('ico:minus')}</button><input type="number" min="1" max="16" data-k="measures" value="${o.measures}"><button type="button" data-sr="step" data-f="measures" data-d="1" title="More" aria-label="More measures">${IC('ico:plus')}</button></span></label>
        <label title="Syllables used for rhythm counting across Sight Reading, Score Practice, and Warm-ups">Rhythm counts <select data-k="rhythmSystem">${RHYTHM_SYSTEMS.map(([v, l]) => opt(v, rhythmSys(), l)).join('')}</select></label>
        <label class="srchk" title="Sometimes hold a note over the bar line with a tie"><input type="checkbox" data-k="ties" ${o.ties ? 'checked' : ''}> Tied notes</label>
        <label class="srchk" title="Show measure numbers above the staff"><input type="checkbox" data-k="measureNums" ${o.measureNums ? 'checked' : ''}> Measure #</label>
      </div>
    </div>`;
  const playCard = `<div class="sr-scard">
      <div class="sr-scard-hd">Playback &amp; Grading</div>
      <div class="sr-scard-bd">
        ${m === 'solfege' ? `<label>Sound <select data-k="instrument">${SR_INSTRUMENTS.map(([v, l]) => opt(v, o.instrument || 'soft', l)).join('')}</select></label>
          <label title="Full: each note lasts its whole value. Detached: notes are shorter, with a little space between them.">Note length <select data-k="artic">${opt('full', o.artic || 'full', 'Full')}${opt('detached', o.artic || 'full', 'Detached')}</select></label>`
          : `<label>Sound <select data-k="sound">${opt('clap', o.sound || 'clap', 'Clap')}${opt('drum', o.sound, 'Drum')}${opt('woodblock', o.sound, 'Woodblock')}${opt('none', o.sound, 'Playhead only (no sound)')}</select></label>`}
        <label>Count-in <select data-k="countIn">${[[0, 'None'], [1, '1 bar'], [2, '2 bars']].map(([v, l]) => opt(v, o.countIn ?? 1, l)).join('')}</select></label>
        ${m === 'solfege' ? `<label>Count-in pitch <select data-k="countPitch">${[['none', 'Clicks only'], ['do', 'do'], ['start', 'Starting note'], ['chord', 'do–mi–sol']].map(([v, l]) => opt(v, o.countPitch ?? 'do', l)).join('')}</select></label>
          <label title="Treble clef only: the starting pitch and the note names on the report are moved to this octave (bass clef is already at a bass's pitch)">Voice / octave for grading <select data-k="gradeVoice">${GR_VOICES.map(([v, l]) => opt(v, o.gradeVoice ?? 'written', l)).join('')}</select></label>` : ''}
        ${metVolSlider()}
        <div class="sr-sync" title="If the playhead is ahead of or behind the sound on this device, slide this, or press Calibrate and tap along with 8 clicks.">Playhead sync <span><input type="range" min="-200" max="600" step="10" value="${avDelayMs()}" data-action-input="av-delay"><b class="av-v">${avDelayMs()} ms</b><button type="button" data-action="av-cal">Calibrate…</button></span></div>
      </div>
    </div>`;
  const cells = `<div class="sr-scard sr-scard-rhy">
      <div class="sr-scard-bd sr-cells">
        <span class="sr-scard-inl">Rhythms</span>
        ${Object.entries(table).map(([k, c]) => {
          const on = o.cells.includes(k);
          return `<label class="srchk sr-rhy-pill ${on ? 'on' : ''}"><input type="checkbox" data-cell="${k}" ${on ? 'checked' : ''}> ${c.label}</label>`;
        }).join('')}
      </div>
    </div>`;
  return `${presetsCard}<div class="sr-scards ${m === 'rhythm' ? 'is-two' : ''}">${pitchCard}${meterCard}${playCard}</div>${cells}`;
}

// ---------- a rhythm block drawn as music (for buttons and choices), cached
const SR_ICON = {};
function srCellIcon(id, table) {
  const c = table[id]; if (!c || !SR_VF) return '';
  const key = Object.keys(SR_COMPOUND).includes(id) && table === SR_COMPOUND ? 'c:' + id : id;
  if (SR_ICON[key]) return SR_ICON[key];
  try {
    const VF = SR_VF, div = document.createElement('div');
    const dotted = c.ev.some(e => e[0].includes('d'));
    const w = 24 + c.ev.length * 20 + (dotted ? 8 : 0) + (c.ev.length === 1 && c.ev[0][0] === 'w' ? 6 : 0);
    const r = new VF.Renderer(div, VF.Renderer.Backends.SVG); r.resize(w, 66);
    const ctx = r.getContext();
    const stave = new VF.Stave(0, -22, w);
    if (stave.setConfigForLines) stave.setConfigForLines([0, 1, 2, 3, 4].map(i => ({ visible: i === 2 })));   // just one line
    stave.setContext(ctx).draw();
    const notes = c.ev.map(([dur, , rest]) => {
      const n = new VF.StaveNote({ keys: ['b/4'], duration: dur.replace('d', '') + (rest ? 'r' : ''), dots: dur.includes('d') ? 1 : 0, clef: 'percussion', stem_direction: 1 });
      if (dur.includes('d')) { if (VF.Dot && VF.Dot.buildAndAttach) VF.Dot.buildAndAttach([n], { all: true }); else n.addDotToAll(); }
      return n;
    });
    const beams = []; let run = [];
    c.ev.forEach((e, i) => { if (!e[2] && /^(8|16)/.test(e[0])) run.push(notes[i]); else { if (run.length >= 2) beams.push(new VF.Beam(run)); run = []; } });
    if (run.length >= 2) beams.push(new VF.Beam(run));
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
    voice.addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], w - 22);
    voice.draw(ctx, stave);
    beams.forEach(b => b.setContext(ctx).draw());
    if (c.tup) new VF.Tuplet(notes).setContext(ctx).draw();
    const svg = div.querySelector('svg');
    svg.setAttribute('viewBox', `0 0 ${w} 66`); svg.setAttribute('class', 'sr-icon');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    return (SR_ICON[key] = svg.outerHTML);
  } catch { return ''; }
}
// ---------- ✏ Build: make your own example by clicking rhythm blocks, syllables and patterns
const SR_PATTERNS = [[0, 1, 2], [2, 1, 0], [0, 2, 4], [4, 2, 0], [0, -1, 0], [4, 5, 4], [2, 3, 4], [4, 3, 2], [0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [0, 4, 7], [7, 4, 0], [4, 3, 2, 1], [0, 1, 0, -1, 0]];
const SR_BUILD_DEG = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
function srBuildDefaults() {
  return { kind: 'solfege', ts: '4/4', key: 'C', scale: 'major', clef: 'treble', tempo: 80, countIn: 1, countPitch: 'do', metronome: true, measureNums: false, sound: 'clap', items: [], pitches: [], sel: null, hist: [] };
}
// single notes and their rests for the builder (lengths in beats of the meter; values in quarters)
const SR_BUILD_SIMPLE = Object.assign({}, SR_SIMPLE, {
  wr: { label: 'Whole rest', len: 4, ev: [['w', 4, 1]] },
  hdr: { label: 'Dotted half rest', len: 3, ev: [['hd', 3, 1]] },
  qd: { label: 'Dotted quarter', len: 1.5, ev: [['qd', 1.5]] },
  qdr: { label: 'Dotted quarter rest', len: 1.5, ev: [['qd', 1.5, 1]] },
  e8d: { label: 'Dotted eighth', len: .75, ev: [['8d', .75]] },
  e8dr: { label: 'Dotted eighth rest', len: .75, ev: [['8d', .75, 1]] },
  e8: { label: 'Eighth', len: .5, ev: [['8', .5]] },
  e8r: { label: 'Eighth rest', len: .5, ev: [['8', .5, 1]] },
  s16: { label: 'Sixteenth', len: .25, ev: [['16', .25]] },
  s16r: { label: 'Sixteenth rest', len: .25, ev: [['16', .25, 1]] },
});
const SR_BUILD_COMPOUND = Object.assign({}, SR_COMPOUND, {
  dhr: { label: 'Dotted half rest', len: 2, ev: [['hd', 3, 1]] },
  cq: { label: 'Quarter', len: 2 / 3, ev: [['q', 1]] },
  cqr: { label: 'Quarter rest', len: 2 / 3, ev: [['q', 1, 1]] },
  c8: { label: 'Eighth', len: 1 / 3, ev: [['8', .5]] },
  c8r: { label: 'Eighth rest', len: 1 / 3, ev: [['8', .5, 1]] },
  c16: { label: 'Sixteenth', len: 1 / 6, ev: [['16', .25]] },
  c16r: { label: 'Sixteenth rest', len: 1 / 6, ev: [['16', .25, 1]] },
});
// note → its rest, in the order the palette shows them
const SR_BUILD_PAIRS = {
  simple: [['w', 'wr'], ['hd', 'hdr'], ['h', 'hr'], ['qd', 'qdr'], ['q', 'qr'], ['e8d', 'e8dr'], ['e8', 'e8r'], ['s16', 's16r']],
  compound: [['dh', 'dhr'], ['dq', 'dqr'], ['cq', 'cqr'], ['c8', 'c8r'], ['c16', 'c16r']],
};
const SR_BUILD_COMBOS = {
  simple: ['ee', 'ssss', 'ess', 'sse', 'des', 'qde', 'syn', 'trip', 'er'],
  compound: ['eee', 'qe', 'eq', 'desse', 'ssse', 'six'],
};
// the rhythm a solfege click adds (the last block you picked; a rest picks its note)
function srBuildRhythm(b) {
  const t = srBuildTable(b), compound = SR_METERS[b.ts][1] === 'compound';
  return b.lastRhythm && t[b.lastRhythm] ? b.lastRhythm : (compound ? 'dq' : 'q');
}
const srBuildTable = b => SR_METERS[b.ts][1] === 'compound' ? SR_BUILD_COMPOUND : SR_BUILD_SIMPLE;
const srCid = id => String(id).replace(/~$/, '');
const srTied = id => /~$/.test(String(id));
const srBuildCells = b => {                                   // which blocks the palette offers
  const t = srBuildTable(b);
  return Object.keys(t);
};
// the clicked blocks, laid into measures (a block that doesn't fit starts the next measure)
function srBuildMeasures(b) {
  const table = srBuildTable(b), beats = SR_METERS[b.ts][0], out = []; let cur = [], pos = 0;
  b.items.forEach((raw, ii) => {
    const id = srCid(raw), c = table[id]; if (!c) return;
    if (pos + c.len > beats + 1e-6 && cur.length) { out.push(cur); cur = []; pos = 0; }
    cur.push({ id, ev: c.ev, tup: c.tup, item: ii, tie: srTied(raw) }); pos += c.len;
    if (pos >= beats - 1e-6) { out.push(cur); cur = []; pos = 0; }
  });
  if (cur.length) out.push(cur);
  return out;
}
// every note/rest in order: which block it belongs to and (for notes) which pitch it uses
function srBuildEvents(b) {
  const table = srBuildTable(b), out = []; let p = 0;
  b.items.forEach((id, item) => (table[srCid(id)]?.ev || []).forEach(e => out.push({ item, rest: !!e[2], p: e[2] ? null : p++ })));
  return out;
}
// do the blocks fill whole measures? (only the last measure may still be filling up)
function srBuildFits(b, items) {
  const table = srBuildTable(b), beats = SR_METERS[b.ts][0]; let pos = 0;
  for (const raw of items) {
    const c = table[srCid(raw)]; if (!c) continue;
    if (pos + c.len > beats + 1e-6) return false;               // would spill over the bar line
    pos += c.len; if (pos >= beats - 1e-6) pos = 0;
  }
  return true;
}
// beats still open in the measure being filled
function srBuildLeft(b) {
  const table = srBuildTable(b), beats = SR_METERS[b.ts][0]; let pos = 0;
  for (const raw of b.items) { const c = table[srCid(raw)]; if (!c) continue; pos += c.len; if (pos >= beats - 1e-6) pos = 0; }
  return { left: beats - pos, beats, measure: srBuildMeasures(b).length + (pos === 0 ? 1 : 0) };
}
// a single note (or rest) block of a given length, if there is one
function srBuildSingle(b, len, rest) {
  const table = srBuildTable(b);
  return Object.keys(table).find(id => table[id].ev.length === 1 && !!table[id].ev[0][2] === !!rest && Math.abs(table[id].len - len) < 1e-6) || null;
}
// rest blocks that add up to `len` beats (so bar lines stay where they are)
function srBuildRests(b, len) {
  const table = srBuildTable(b), out = []; let left = len;
  const rests = Object.keys(table).filter(id => table[id].ev.length === 1 && table[id].ev[0][2]).sort((x, y) => table[y].len - table[x].len);
  for (const id of rests) while (left >= table[id].len - 1e-6) { out.push(id); left -= table[id].len; }
  return left < 1e-6 ? out : null;
}
function srBuildView(st) {
  const b = (st.build ||= srBuildDefaults());
  const nNotes = srBuildEvents(b).filter(e => !e.rest).length;
  while (b.pitches.length < nNotes) b.pitches.push(b.pitches.length ? b.pitches[b.pitches.length - 1] : 0);
  if (b.pitches.length > nNotes) b.pitches.length = nNotes;
  const ex = { rhythm: srBuildMeasures(b), pitches: b.pitches };
  return { mode: b.kind, show: st.show, showCounts: st.showCounts, playhead: st.playhead, startM: st.startM || 0, [b.kind]: b, ex: { [b.kind]: ex } };
}
function srBuildPush(b) { b.hist.push(JSON.stringify({ items: b.items, pitches: b.pitches, sel: b.sel })); if (b.hist.length > 80) b.hist.shift(); }
function srBuildInsert(b, ids, degs) {
  ids = ids.slice();
  // add blocks after the selected note's block (or at the end); new notes take the given pitches
  // (or carry on from the note before), and the first new note becomes selected
  const table = srBuildTable(b), evs = srBuildEvents(b);
  if (!b.pick && ids.length === 1) {                         // a single long note that doesn't fit: tie it over the bar line
    const c = table[ids[0]], lf = srBuildLeft(b);
    if (c.ev.length === 1 && c.len > lf.left + 1e-9 && lf.left > 0) {
      const x = srBuildSingle(b, lf.left, !!c.ev[0][2]), z = srBuildSingle(b, c.len - lf.left, !!c.ev[0][2]);
      if (x && z) { ids = c.ev[0][2] ? [x, z] : [x + '~', z]; if (degs && degs.length === 1) degs = [degs[0], degs[0]]; }
    }
  }
  const after = b.pick && b.sel != null && evs[b.sel] ? evs[b.sel].item + 1 : b.items.length;   // after the note you clicked, else at the end
  const pBefore = evs.filter(e => e.item < after && !e.rest).length;
  let lastP = pBefore ? b.pitches[pBefore - 1] : 0, newP = [], di = 0;
  for (const id of ids) for (const e of table[srCid(id)].ev) if (!e[2]) { const d = degs && degs[di] != null ? degs[di] : lastP; di++; newP.push(d); lastP = d; }
  const trial = b.items.slice(); trial.splice(after, 0, ...ids);
  if (!srBuildFits(b, trial)) return false;
  b.items.splice(after, 0, ...ids);
  b.pitches.splice(pBefore, 0, ...newP);
  const firstNew = srBuildEvents(b).findIndex(e => e.item === after);
  let sel = null;
  if (firstNew >= 0) {
    const ev2 = srBuildEvents(b), news = []; ev2.forEach((e, i) => { if (e.item >= after && e.item < after + ids.length && !e.rest) news.push(i); });
    sel = degs ? (news[degs.length] ?? null) : (news[0] ?? firstNew);   // the first note still waiting for a syllable
  }
  b.sel = sel;
  b.pick = false;
  return true;
}
function srBuildPanelHTML(st) {
  const b = st.build, table = srBuildTable(b), sol = b.kind === 'solfege', lf = srBuildLeft(b);
  const btn = id => {
    const c = table[id]; if (!c) return '';
    const fitsNow = c.len <= lf.left + 1e-6, splits = c.ev.length === 1 && srBuildSingle(b, lf.left, !!c.ev[0][2]) && srBuildSingle(b, c.len - lf.left, !!c.ev[0][2]);
    const ok = (b.pick && b.sel != null) || fitsNow || splits;
    const tip = c.label + (ok ? (!fitsNow && !(b.pick && b.sel != null) ? ' — will be tied over the bar line' : '') : ' — too long for what is left of this measure');
    return `<button data-sr="badd" class="sb-note ${c.ev.every(e => e[2]) ? 'is-rest' : ''} ${srBuildRhythm(b) === id ? 'current' : ''}" data-id="${id}" title="${esc(tip)}" ${ok ? '' : 'disabled'}>${srCellIcon(id, table) || esc(c.label)}</button>`;
  };
  const syl = d => { const s = SR_SYL[b.scale][((d % 7) + 7) % 7]; return d < 0 ? 'low ' + s : d > 6 ? 'high ' + s : s; };
  const simple = SR_METERS[b.ts][1] === 'simple';
  return `<div class="sr-build">
    <div class="sb-row"><span class="sb-lbl">Edit</span>
      <span class="sr-sp"></span>
      <button data-sr="bundo" ${b.hist.length ? '' : 'disabled'} title="Undo">${IC('ico:undo')} Undo</button>
      <button data-sr="btie" ${b.sel != null ? '' : 'disabled'} title="Tie the selected note to the next note (or remove its tie)">${IC('ico:tie')} Tie</button>
      <button data-sr="bdel" ${b.sel != null ? '' : 'disabled'} title="Delete the selected note's block (Delete key)">${IC('ico:erase')} Delete</button>
      <button data-sr="bclearm" ${b.items.length ? '' : 'disabled'} title="Clear the selected (or last) measure">Clear measure</button>
      <button data-sr="bclear" ${b.items.length ? '' : 'disabled'}>Clear all</button>
      <span class="sb-left">Measure ${lf.measure}: ${lf.left >= lf.beats - 1e-6 ? 'empty' : `${+(lf.left).toFixed(2)} of ${lf.beats} ${SR_METERS[b.ts][1] === 'compound' ? 'dotted-quarter beats' : 'beats'} left`}</span>
    </div>
    <div class="sb-row sb-cells"><span class="sb-lbl">Notes</span>${SR_BUILD_PAIRS[SR_METERS[b.ts][1]].map(pair => btn(pair[0])).join('')}
      <span class="sb-lbl sb-lbl2">Rests</span>${SR_BUILD_PAIRS[SR_METERS[b.ts][1]].map(pair => btn(pair[1])).join('')}</div>
    <div class="sb-row sb-cells"><span class="sb-lbl">Groups</span>${SR_BUILD_COMBOS[SR_METERS[b.ts][1]].filter(id => table[id]).map(btn).join('')}</div>
    ${sol ? `<div class="sb-row sb-syl"><span class="sb-lbl">Solfege</span>${SR_BUILD_DEG.map(d => `<button data-sr="bsyl" data-d="${d}" class="${d === 0 || d === 7 ? 'do' : ''}">${syl(d)}</button>`).join('')}</div>
` : ''}
    <div class="sb-hint">${b.items.length ? (sol ? 'Click a note to select it · a syllable or ↑ ↓ changes it · ← → move · Delete removes · click empty space in a measure to play from there' : 'Click a note to select it; new blocks are added after it. Delete removes its block.') : 'Click a note or rest to start.'}</div>
  </div>`;
}
function srBuildSettingsHTML(st) {
  const b = st.build, opt = (v, cur, label = v) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const meters = Object.keys(SR_METERS);
  return `<div class="sr-scards is-two">
    <div class="sr-scard">
      <div class="sr-scard-hd">Music &amp; Counting</div>
      <div class="sr-scard-bd">
        <label>Time <select data-k="ts">${meters.map(v => opt(v, b.ts)).join('')}</select></label>
        <label>Key <select data-k="key">${SR_KEYS.map(k => opt(k, b.key, k.replace('b', '♭'))).join('')}</select></label>
        <label>Mode <select data-k="scale">${opt('major', b.scale, 'Major')}${opt('minor', b.scale, 'Minor (do-based)')}</select></label>
        <label>Clef <select data-k="clef">${opt('treble', b.clef, 'Treble')}${opt('bass', b.clef, 'Bass')}</select></label>
        <label title="Syllables used for rhythm counting across Sight Reading, Score Practice, and Warm-ups">Rhythm counts <select data-k="rhythmSystem">${RHYTHM_SYSTEMS.map(([v, l]) => opt(v, rhythmSys(), l)).join('')}</select></label>
        <label class="srchk" title="Show measure numbers above the staff"><input type="checkbox" data-k="measureNums" ${b.measureNums ? 'checked' : ''}> Measure #</label>
      </div>
    </div>
    <div class="sr-scard">
      <div class="sr-scard-hd">Playback &amp; Grading</div>
      <div class="sr-scard-bd">
        <label title="Sound for notes with pitch">Sound <select data-k="instrument">${SR_INSTRUMENTS.map(([v, l]) => opt(v, b.instrument || 'soft', l)).join('')}</select></label>
        <label title="Full: each note lasts its whole value. Detached: notes are shorter, with a little space between them.">Note length <select data-k="artic">${opt('full', b.artic || 'full', 'Full')}${opt('detached', b.artic || 'full', 'Detached')}</select></label>
        <label title="Sound when viewing Rhythm only">Rhythm sound <select data-k="sound">${opt('clap', b.sound || 'clap', 'Clap')}${opt('drum', b.sound, 'Drum')}${opt('woodblock', b.sound, 'Woodblock')}${opt('none', b.sound, 'Playhead only (no sound)')}</select></label>
        <label>Count-in <select data-k="countIn">${[[0, 'None'], [1, '1 bar'], [2, '2 bars']].map(([v, l]) => opt(v, b.countIn ?? 1, l)).join('')}</select></label>
        <label>Count-in pitch <select data-k="countPitch">${[['none', 'Clicks only'], ['do', 'do'], ['start', 'Starting note'], ['chord', 'do–mi–sol']].map(([v, l]) => opt(v, b.countPitch ?? 'do', l)).join('')}</select></label>
        <label title="Treble clef only: the starting pitch and the note names on the report are moved to this octave (bass clef is already at a bass's pitch)">Voice / octave for grading <select data-k="gradeVoice">${GR_VOICES.map(([v, l]) => opt(v, b.gradeVoice ?? 'written', l)).join('')}</select></label>
      </div>
    </div>
  </div>`;
}

// the sight-reading bar: items in the order you've arranged (drag to move; "gap" splits left / right)
// ---------- movable button bar, shared by sight reading and score practice ----------
// Each player passes a cfg: { key: where it's saved in S.settings ('srBar' / 'spBar'), defaults: the standard order,
// groups: ids that start a new group, breaks: ids that can start row 2 on medium widths }.
// Dragging previews the exact landing spot + live neighbor shifts before drop, keeps left/right clusters local
// (pushing to one side stops at open space instead of disturbing the opposite side), and anchors items to their
// nearer edge so custom arrangements stay crisp when the window resizes.
const MB_GAP = 6;
const MB_PAD_X = 8;
const MB_PAD_Y = 5;
const mbSet = () => (typeof S !== 'undefined' && S.settings) || null;
function mbarOrder(cfg) {
  const saved = mbSet()?.[cfg.key] || [];
  const order = saved.filter(id => cfg.defaults.includes(id));
  for (const id of cfg.defaults) if (!order.includes(id)) order.splice(Math.min(order.length, cfg.defaults.indexOf(id)), 0, id);
  return order;
}
const mbarPos = cfg => mbSet()?.[cfg.key + 'Pos'] || null;
const mbarRowH = bar => {
  let h = 0;
  bar.querySelectorAll(':scope > [data-bar]').forEach(el => { if (el.dataset.bar !== 'gap' && !el.hidden) h = Math.max(h, el.offsetHeight); });
  return (h || 32) + MB_GAP;
};
// Resolve a saved position record (v2 edge-anchored or legacy fractional) to pixel x at width W.
function mbarDesiredX(p, w, W) {
  const maxX = Math.max(0, W - w);
  if (!p) return maxX;
  if (p.v === 2) {
    const raw = p.a === 'r' ? (W - w - (p.ox || 0)) : (p.ox || 0);
    return Math.max(0, Math.min(maxX, raw));
  }
  return Math.max(0, Math.min(maxX, (p.x ?? 0) * W));
}
// Pure 2D row solver: resolves overlaps locally (stopping at open gaps so pushing one side doesn't shove the other).
// `items` = [{ id, w, x, r, saved }], `pin` = optional { id, x, r } for the actively dragged/dropped item.
// Returns { map: Map(id -> { x, r, w }), maxRow }.
function mbarSolve(items, W, pin = null) {
  const clampX = (x, w) => Math.max(0, Math.min(Math.max(0, W - w), x));
  const work = items.map(it => ({
    id: it.id, w: it.w, saved: it.saved !== false,
    x: pin && it.id === pin.id ? clampX(pin.x, it.w) : clampX(it.x, it.w),
    r: pin && it.id === pin.id ? Math.max(0, Math.min(4, pin.r)) : Math.max(0, Math.min(4, it.r || 0)),
  }));

  const byRow = new Map();
  for (const it of work) { (byRow.get(it.r) || byRow.set(it.r, []).get(it.r)).push(it); }

  const out = new Map();
  let maxRow = 0;

  // Process rows top-to-bottom; any item that physically cannot fit on an overflowing row cascades down
  // to the next row at the SAME x side instead of pushing the opposite side across the toolbar.
  for (let r = 0; r <= 6; r++) {
    const row = byRow.get(r);
    if (!row || !row.length) continue;
    maxRow = Math.max(maxRow, r);
    const overflow = [];
    const pinItem = pin ? row.find(it => it.id === pin.id) : null;

    if (pinItem) {
      const others = row.filter(it => it !== pinItem).sort((a, b) => a.x - b.x);
      const pinC = pinItem.x + pinItem.w / 2;
      const atLeftWall = pinItem.x <= 6;
      const atRightWall = pinItem.x + pinItem.w >= W - 6;
      const lefts = [], rights = [];
      for (const it of others) {
        const c = it.x + it.w / 2;
        if (atLeftWall) rights.push(it);
        else if (atRightWall) lefts.push(it);
        else if (c < pinC) lefts.push(it);
        else rights.push(it);
      }

      // Push right neighbors ONLY as far as they touch — stop at the first free gap!
      let edgeR = pinItem.x + pinItem.w + MB_GAP;
      for (let i = 0; i < rights.length; i++) {
        if (rights[i].x < edgeR) {
          rights[i].x = edgeR;
          edgeR = rights[i].x + rights[i].w + MB_GAP;
        } else break;
      }
      // If right cluster ran past right wall W, compact right cluster inward ONLY against W if it fits;
      // otherwise drop only the overflowing right item(s) cleanly to row r+1 on the right side.
      const keptRights = [];
      for (const it of rights) {
        if (it.x + it.w <= W + 0.5) keptRights.push(it);
        else overflow.push(it);
      }

      // Push left neighbors ONLY as far as they touch — stop at the first free gap!
      let edgeL = pinItem.x - MB_GAP;
      for (let i = lefts.length - 1; i >= 0; i--) {
        if (lefts[i].x + lefts[i].w > edgeL) {
          lefts[i].x = edgeL - lefts[i].w;
          edgeL = lefts[i].x - MB_GAP;
        } else break;
      }
      const keptLefts = [];
      for (const it of lefts) {
        if (it.x >= -0.5) keptLefts.push(it);
        else overflow.push(it);
      }

      for (const it of [...keptLefts, pinItem, ...keptRights]) {
        it.x = clampX(it.x, it.w);
        out.set(it.id, { x: it.x, r, w: it.w });
      }
    } else {
      // Normal row (resize / non-active row): keep items near their desired x, pull right-side cluster into
      // slack if touching W, and only overflow to r+1 if total width genuinely exceeds W.
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const minX = row[i - 1].x + row[i - 1].w + MB_GAP;
        if (row[i].x < minX) row[i].x = minX;
      }
      // If rightmost item exceeds W, pull backwards into any available slack on the row
      if (row.length && row[row.length - 1].x + row[row.length - 1].w > W + 0.5) {
        let rightBound = W;
        for (let i = row.length - 1; i >= 0; i--) {
          const maxAllowed = rightBound - row[i].w;
          if (row[i].x > maxAllowed) row[i].x = maxAllowed;
          rightBound = row[i].x - MB_GAP;
        }
      }
      // If pulling pushed the first item(s) below 0, row is genuinely too wide for W: pack from left and overflow remainder
      if (row.length && row[0].x < -0.5) {
        let cur = 0;
        for (const it of row) {
          if (cur === 0 || cur + it.w <= W + 0.5) {
            it.x = clampX(cur, it.w);
            cur = it.x + it.w + MB_GAP;
            out.set(it.id, { x: it.x, r, w: it.w });
          } else {
            overflow.push(it);
          }
        }
      } else {
        for (const it of row) {
          it.x = clampX(it.x, it.w);
          out.set(it.id, { x: it.x, r, w: it.w });
        }
      }
    }

    if (overflow.length) {
      const next = byRow.get(r + 1) || byRow.set(r + 1, []).get(r + 1);
      for (const it of overflow) {
        it.r = r + 1;
        it.x = clampX(it.x, it.w);
        next.push(it);
      }
    }
  }
  return { map: out, maxRow };
}

// Lay the bar out: each button keeps its saved spot; nothing overlaps.
function mbarLayout(bar, cfg) {
  const pos = mbarPos(cfg); if (!bar) return;
  bar.classList.toggle('sr-free', !!pos);
  if (!pos) { bar.style.height = ''; return; }
  const W = Math.max(120, bar.clientWidth - MB_PAD_X * 2), RH = mbarRowH(bar);
  const items = [...bar.querySelectorAll(':scope > [data-bar]')].filter(el => el.dataset.bar !== 'gap' && !el.hidden);
  items.forEach(el => { el.style.left = '0px'; });                // measure at full intrinsic width
  const spec = items.map(el => {
    const id = el.dataset.bar, p = pos[id], w = el.offsetWidth;
    return { el, id, w, saved: !!p, x: mbarDesiredX(p, w, W), r: p ? (p.r || 0) : 0 };
  });
  const { map, maxRow } = mbarSolve(spec, W, null);
  for (const it of spec) {
    const res = map.get(it.id); if (!res) continue;
    it.el.style.left = MB_PAD_X + res.x + 'px';
    it.el.style.top = MB_PAD_Y + res.r * RH + 'px';
  }
  bar.style.height = MB_PAD_Y * 2 + (maxRow + 1) * RH - MB_GAP + 'px';
}
function mbarHTML(cfg, items) {
  const free = !!mbarPos(cfg);
  return mbarOrder(cfg).map(id => {
    if (id === 'gap') return free ? '' : '<span class="sr-sp" data-bar="gap"></span>';
    const html = items[id] ? items[id]() : ''; if (!html) return '';
    const brk = !free && cfg.breaks?.includes(id) ? '<span class="sr-brk" aria-hidden="true"></span>' : '';
    return `${brk}<span class="sr-bi" data-bar="${id}"${cfg.ctl ? ` data-ctl="${id}"` : ''}${cfg.groups?.includes(id) ? ' data-grp' : ''}>${html}</span>`;
  }).join('');
}
// Dragging with live landing ghost + live neighbor preview (Escape cancels cleanly).
function mbarDrag(host, cfg, barSel, rerender) {
  let d = null;
  const bar = () => host.querySelector(barSel);

  const snapTarget = (rawX, rawY, w, W, RH, snap) => {
    const row = Math.max(0, Math.min(3, Math.round((rawY - MB_PAD_Y) / RH)));
    let x = Math.max(0, Math.min(Math.max(0, W - w), rawX));
    // Snap cleanly to left edge, right edge, or neighbors on the target row
    if (x < 12) x = 0;
    else if (x + w > W - 12) x = Math.max(0, W - w);
    else {
      let snapped = false;
      for (const it of snap) {
        if (it.id === d.id || it.r !== row) continue;
        const L = it.x, R = it.x + it.w;
        if (Math.abs(x - (R + MB_GAP)) < 14) { x = R + MB_GAP; snapped = true; break; }
        if (Math.abs(x + w - (L - MB_GAP)) < 14) { x = L - MB_GAP - w; snapped = true; break; }
      }
      if (!snapped) x = Math.round(x / 8) * 8;
    }
    return { x: Math.max(0, Math.min(Math.max(0, W - w), x)), r: row };
  };

  const applyPreview = (curX, curY) => {
    const { b, W, RH, snap, id, w, h, ghost } = d;
    const tgt = snapTarget(curX, curY, w, W, RH, snap);
    const solved = mbarSolve(snap, W, { id, x: tgt.x, r: tgt.r });
    d.lastSolved = solved;
    const pinRes = solved.map.get(id);
    if (pinRes && ghost) {
      ghost.style.left = MB_PAD_X + pinRes.x + 'px';
      ghost.style.top = MB_PAD_Y + pinRes.r * RH + 'px';
      ghost.style.width = w + 'px';
      ghost.style.height = h + 'px';
    }
    for (const it of snap) {
      if (it.id === id) continue;
      const res = solved.map.get(it.id); if (!res) continue;
      it.el.style.left = MB_PAD_X + res.x + 'px';
      it.el.style.top = MB_PAD_Y + res.r * RH + 'px';
      const moved = Math.abs(res.x - it.x) > 2 || res.r !== it.r;
      it.el.classList.toggle('mb-moved', moved);
    }
    const showRows = Math.max(solved.maxRow + 1, Math.min(4, tgt.r + 1));
    b.style.height = MB_PAD_Y * 2 + showRows * RH - MB_GAP + 'px';
  };

  const cleanup = () => {
    if (!d) return;
    d.ghost?.remove();
    d.b?.classList.remove('show-grid', 'mb-dragging');
    d.b?.querySelectorAll('.mb-moved, .dragging').forEach(el => el.classList.remove('mb-moved', 'dragging'));
    d = null;
  };

  const down = e => {
    const it = e.target.closest?.(`${barSel} > [data-bar]`);
    if (!it || it.dataset.bar === 'gap' || e.button !== 0 || e.target.closest('input, select')) return;
    d = { it, id: it.dataset.bar, x0: e.clientX, y0: e.clientY, moved: false };
  };

  const move = e => {
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;
    if (!d.moved) {
      const b = bar(); if (!b) { d = null; return; }
      const br = b.getBoundingClientRect(), RH = mbarRowH(b), W = Math.max(120, b.clientWidth - MB_PAD_X * 2);
      const els = [...b.querySelectorAll(':scope > [data-bar]')].filter(el => el.dataset.bar !== 'gap' && !el.hidden);
      // Snapshot exact rendered positions before entering free-drag mode so nothing jumps on drag start
      const snap = els.map(el => {
        const er = el.getBoundingClientRect();
        const x = Math.max(0, er.left - br.left - MB_PAD_X);
        const r = Math.max(0, Math.min(3, Math.round((er.top - br.top - MB_PAD_Y) / RH)));
        return { el, id: el.dataset.bar, x, r, w: er.width, h: er.height, saved: true };
      });
      const self = snap.find(s => s.id === d.id);
      if (!self) { d = null; return; }
      // Lock all items to their snapshotted pixel coords before activating live transitions
      b.classList.add('sr-free', 'show-grid');
      for (const s of snap) {
        s.el.style.left = MB_PAD_X + s.x + 'px';
        s.el.style.top = MB_PAD_Y + s.r * RH + 'px';
      }
      b.style.setProperty('--mb-rh', RH + 'px');
      b.style.height = br.height + 'px';
      void b.offsetWidth; // flush initial positions before enabling smooth neighbor glide
      b.classList.add('mb-dragging');
      d.it.classList.add('dragging');
      const ghost = document.createElement('div');
      ghost.className = 'mb-ghost';
      b.appendChild(ghost);
      Object.assign(d, { moved: true, b, br, RH, W, snap, startX: self.x, startY: MB_PAD_Y + self.r * RH, w: self.w, h: self.h, ghost });
    }
    const curX = Math.max(-24, Math.min(d.W - d.w + 24, d.startX + dx));
    const curY = Math.max(0, Math.min(d.RH * 3 + MB_PAD_Y + 16, d.startY + dy));
    d.it.style.left = MB_PAD_X + curX + 'px';
    d.it.style.top = curY + 'px';
    applyPreview(curX, curY);
  };

  const up = () => {
    const g = d;
    if (!g) return;
    if (!g.moved) { d = null; return; }
    host.__noClick = true; setTimeout(() => host.__noClick = false, 60);
    const { W, snap, lastSolved } = g;
    const prevPos = mbarPos(cfg) || {};
    cleanup();
    if (lastSolved) {
      const pos = { ...prevPos };
      // Save every item's solved spot with left/right edge anchoring so resizing stays predictable
      for (const s of snap) {
        const res = lastSolved.map.get(s.id); if (!res) continue;
        const centerFrac = (res.x + s.w / 2) / Math.max(1, W);
        const anchor = (res.x + s.w >= W - 18 || centerFrac >= 0.62) ? 'r' : 'l';
        const ox = anchor === 'r' ? Math.max(0, Math.round(W - (res.x + s.w))) : Math.max(0, Math.round(res.x));
        pos[s.id] = { v: 2, a: anchor, ox, r: res.r };
      }
      const set = mbSet(); if (set) { set[cfg.key + 'Last'] = g.id; set[cfg.key + 'Pos'] = pos; save(); }
    }
    rerender();
  };

  const key = e => {
    if (e.key === 'Escape' && d && d.moved) {
      e.preventDefault();
      cleanup();
      rerender();
    }
  };

  const refs = host.__mbRefs ||= {};
  if (!refs.hooked) {
    refs.hooked = true;
    window.addEventListener('pointermove', e => refs.move?.(e));
    window.addEventListener('pointerup', e => refs.up?.(e));
    window.addEventListener('keydown', e => refs.key?.(e));
  }
  refs.move = move; refs.up = up; refs.key = key;
  return { down };
}
const mbarReset = cfg => { const set = mbSet(); if (set) { delete set[cfg.key]; delete set[cfg.key + 'Pos']; delete set[cfg.key + 'Last']; save(); } };

// Standard layout for both players, left to right: what's on the page → playing it → what's written on the music → tools.
const SR_BARCFG = {
  key: 'srBar',
  defaults: ['tabs', 'new', 'play', 'tempo', 'metro', 'nums', 'show', 'counts', 'rhyonly', 'playhead', 'grade', 'gap', 'save', 'print', 'zoom', 'settings'],
  groups: ['play', 'nums', 'grade'],
  breaks: ['nums'],
};
const SR_BAR_DEFAULT = SR_BARCFG.defaults;
const srBarOrder = () => mbarOrder(SR_BARCFG);
const srBarPos = () => mbarPos(SR_BARCFG);
const srBarLayout = bar => mbarLayout(bar, SR_BARCFG);
const srBarHTML = items => mbarHTML(SR_BARCFG, items);
// a button label that always takes the width of its widest wording, so the bar never jumps
const srTog = (labels, i) => `<span class="sr-tog">${labels.map((l, k) => `<span class="${k === i ? '' : 'h'}">${l}</span>`).join('')}</span>`;
function mountSight(host, st, onChange) {
  if (!st || !st.rhythm) Object.assign(st, srDefaults());
  for (const m of ['rhythm', 'solfege']) if (!st.ex[m]) st.ex[m] = m === 'rhythm' ? { rhythm: srGenRhythm(st.rhythm.ts, st.rhythm.measures, st.rhythm.cells, st.rhythm.ties) } : srGenParts(st.solfege);
  if (st.showCounts === undefined) st.showCounts = st.mode === 'rhythm' ? !!st.show : false;   // older saves
  let timeline = [];
  const curShowCounts = () => {
    const o = st[st.mode];
    return o && o.showCounts != null ? !!o.showCounts : !!st.showCounts;
  };
  const setCurShowCounts = v => {
    if (st[st.mode]) st[st.mode].showCounts = v;
    else st.showCounts = v;
  };
  // what gets drawn / played: the built example, the solfege melody as rhythm only, or the example itself
  const V = () => {
    const sc = curShowCounts();
    if (st.mode === 'build') { const bv = srBuildView(st); bv.showCounts = sc; return bv; }
    if (st.mode === 'solfege' && st.solRhythm && st.ex.solfege) return { mode: 'rhythm', show: st.show, showCounts: sc, playhead: st.playhead ?? 'beat', startM: st.startM || 0, rhythm: st.solfege, ex: { rhythm: { rhythm: (st.ex.solfege.parts?.[0] || st.ex.solfege).rhythm } } };
    return { ...st, showCounts: sc, playhead: st.playhead ?? 'beat' };
  };
  const isBuild = () => st.mode === 'build';
  const summaryChip = () => {
    if (isBuild()) {
      const b = st.build;
      return b.kind === 'rhythm' ? `${b.ts} · Rhythm` : `${b.key.replace('b', '♭')} ${b.scale} · ${b.clef === 'bass' ? 'Bass' : 'Treble'} · ${b.ts}`;
    }
    const o = st[st.mode];
    if (st.mode === 'rhythm') return `${o.ts} · ${o.measures}m`;
    const rng = SR_RANGES[o.range]?.[0] || o.range;
    return `${o.key.replace('b', '♭')} ${o.scale === 'minor' ? 'minor' : 'major'} · ${o.clef === 'bass' ? 'Bass' : 'Treble'} · ${o.ts} · ${rng}`;
  };
  const render = () => {
    if (isBuild()) st.build ||= srBuildDefaults();
    if (st.playhead == null) st.playhead = 'beat';
    const kindNow = isBuild() ? st.build.kind : st.mode === 'solfege' && st.solRhythm ? 'rhythm' : st.mode;
    const multiPart = st.mode === 'solfege' && !st.solRhythm && (st.solfege?.parts || 1) > 1;
    const zoomPct = Math.round((st.zoom || 1) * 100);
    host.innerHTML = `<div class="sr">
      <div class="sr-top">
        <div class="sr-tabs"><button data-sr="mode" data-v="rhythm" class="${st.mode === 'rhythm' ? 'on' : ''}">${IC('ico:hand')} Rhythm</button><button data-sr="mode" data-v="solfege" class="${st.mode === 'solfege' ? 'on' : ''}">${IC('ico:music')} Solfege</button><button data-sr="mode" data-v="build" class="${isBuild() ? 'on' : ''}" title="Build your own example by clicking">${IC('ico:annotate')} Build</button></div>
        <button data-sr="new" ${isBuild() ? 'disabled title="Not used when building"' : ''}>${IC('ico:random')} New</button>
        ${!isBuild() && host.__prevEx ? `<button data-sr="undo-ex" title="Return to previous example">${IC('ico:undo')}</button>` : ''}
        <span class="tb-div" aria-hidden="true"></span>
        <button data-sr="play" class="sr-primary">${SR_PLAY.master ? IC('ico:stop') + ' Stop' : IC('ico:play') + ' Play'}</button>
        <span class="sr-step sr-tempo" title="Tempo (beats per minute): type a number or use − / +"><button type="button" data-sr="step" data-f="tempo" data-d="-5" title="Slower" aria-label="Slower">${IC('ico:minus')}</button><label><input type="number" min="30" max="200" data-k="tempo" value="${st[st.mode].tempo}"><small>BPM</small></label><button type="button" data-sr="step" data-f="tempo" data-d="5" title="Faster" aria-label="Faster">${IC('ico:plus')}</button></span>
        <button data-sr="metro" class="${st[st.mode].metronome ? 'on' : ''}" title="Metronome clicks while playing">${IC('ico:metro')} Metronome</button>
        <button data-sr="grade" ${multiPart ? 'disabled title="Grading works on 1-line examples — switch Parts to 1 line in Settings"' : 'title="Grade a performance of this example: microphone (sing/clap) or tap rhythm (Space / touch)"'}>${IC('ico:mic')} Grade ▾</button>
        ${typeof GR_RECENT !== 'undefined' && GR_RECENT.length ? `<button data-sr="grrecent" title="View recent grading attempts">${IC('ico:agenda')} Recent (${GR_RECENT.length})</button>` : ''}
        <span class="sr-sp"></span>
        ${typeof currentClass === 'function' ? `<button data-sr="save" title="Save this example to the current class as a tab">${IC('ico:save')} Save</button>` : ''}
        <button data-sr="print" title="Print this example or make a worksheet with an answer key">${IC('ico:print')} Worksheet</button>
        <button data-sr="settings" class="${st.settingsOpen ? 'on' : ''}" title="Show or hide the settings${st.mode === 'build' ? ' and building tools' : ''}">${IC('ico:sliders')} Settings</button>
      </div>
      <div class="sr-sub">
        <button type="button" class="sr-sumchip" data-sr="settings" title="Current settings — click to open Settings">${esc(summaryChip())}</button>
        <span class="tb-div" aria-hidden="true"></span>
        <span class="tb-lbl">Show</span>
        ${st.mode === 'rhythm' ? '' : `<button data-sr="show" class="${st.show && kindNow !== 'rhythm' ? 'on' : ''}" ${kindNow === 'rhythm' ? 'disabled title="Turn off Rhythm only to show solfege syllables"' : 'title="Write the solfege syllables under the notes"'}>${IC('ico:music')} Solfege</button>`}
        <button data-sr="counts" class="${curShowCounts() ? 'on' : ''}" title="Write the rhythm counts under the notes">${IC('ico:list')} Counts</button>
        ${st.mode === 'rhythm' ? '' : `<button data-sr="rhyonly" class="${kindNow === 'rhythm' ? 'on' : ''}" title="Show and play just the rhythm (one line)">${IC('ico:hand')} Rhythm only</button>`}
        <span class="tb-div" aria-hidden="true"></span>
        <span class="tb-lbl">Playhead</span>
        <button data-sr="playhead" class="sr-phbtn ${st.playhead && st.playhead !== 'off' ? 'on' : ''}" title="Playhead: moves with the beat, jumps from note to note, or is off. Click to switch.">${srTog([`${IC('ico:playhead')} <b>Beat</b>`, `${IC('ico:playhead')} <b>Note</b>`, `${IC('ico:playhead')} <b>Off</b>`], ({ beat: 0, notes: 1 })[st.playhead] ?? 2)}</button>
        <span class="sr-sp"></span>
        <span class="tb-lbl">Zoom</span>
        <span class="sr-zoom" title="Make the music bigger or smaller (${zoomPct}%) — pinch on trackpad or click % to reset"><button data-sr="zoom" data-d="-1" title="Smaller" ${(st.zoom || 1) <= 0.5 ? 'disabled' : ''}>${IC('ico:minus')}</button><button type="button" class="tb-zpct" data-sr="zoom-reset" title="Reset zoom to 100%">${zoomPct}%</button><button data-sr="zoom" data-d="1" title="Bigger" ${(st.zoom || 1) >= 2.5 ? 'disabled' : ''}>${IC('ico:plus')}</button></span>
      </div>
      ${st.settingsOpen ? `<div class="sr-settings">${isBuild() ? srBuildSettingsHTML(st) : srSettingsHTML(st, host)}</div>` : ''}
      ${isBuild() && st.settingsOpen ? srBuildPanelHTML(st) : ''}
      <div class="sr-staff" title="Click any measure to start playback from there"></div></div>`;
    if (host.__savingPreset) {
      const inp = host.querySelector('.sr-pre-inp');
      if (inp) {
        inp.focus();
        inp.onkeydown = ev => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); host.querySelector('[data-sr="preset-save-ok"]')?.click(); }
          if (ev.key === 'Escape') { ev.preventDefault(); host.__savingPreset = false; render(); }
        };
      }
    }
    const staffEl = host.querySelector('.sr-staff');
    if (staffEl) staffEl.style.zoom = '';
    if (isBuild() && !st.build.items.length) { staffEl.innerHTML = `<div class="sr-msg">${st.settingsOpen ? 'Your example will appear here. Click a note or rest above.' : 'Nothing built yet — press Settings to show the building tools.'}</div>`; timeline = []; return; }
    staffEl.__zoom = st.zoom || 1;
    timeline = srDraw(staffEl, V()); drawFrom(); markSel(); host.__grRedraw();
  };
  let zSaveT = null;
  const applyLiveZoom = nextZ => {
    const z = Math.max(0.5, Math.min(2.5, Math.round(nextZ * 100) / 100));
    if (Math.abs(z - (st.zoom || 1)) < 1e-3) return;
    st.zoom = z;
    const pct = Math.round(z * 100);
    const staffEl = host.querySelector('.sr-staff'), svg = staffEl?.querySelector('svg');
    if (staffEl) {
      staffEl.style.zoom = '';
      staffEl.__zoom = z;
      if (svg && staffEl.__baseScale && staffEl.__vbW && staffEl.__vbH) {
        const sc = staffEl.__baseScale * z;
        svg.style.width = Math.floor(staffEl.__vbW * sc) + 'px';
        svg.style.height = Math.floor(staffEl.__vbH * sc) + 'px';
      }
    }
    const zBox = host.querySelector('.sr-zoom');
    if (zBox) {
      zBox.title = `Make the music bigger or smaller (${pct}%) — pinch on trackpad or click % to reset`;
      const lbl = zBox.querySelector('.tb-zpct'); if (lbl) lbl.textContent = `${pct}%`;
      const minus = zBox.querySelector('[data-d="-1"]'), plus = zBox.querySelector('[data-d="1"]');
      if (minus) minus.disabled = z <= 0.5;
      if (plus) plus.disabled = z >= 2.5;
    }
    drawFrom(); host.__grRedraw?.();
    clearTimeout(zSaveT); zSaveT = setTimeout(() => { onChange && onChange(st); }, 140);
  };
  host.__zoomBy = factor => applyLiveZoom((st.zoom || 1) * factor);
  host.__zoomReset = () => applyLiveZoom(1);
  host.__zoomToggle = () => applyLiveZoom(Math.abs((st.zoom || 1) - 1) > 0.03 ? 1 : 1.5);
  if (!host.__pinchWired) {
    host.__pinchWired = true;
    host.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); e.stopPropagation();
      host.__zoomBy(Math.exp(-e.deltaY * 0.01));
    }, { passive: false });
    let gs = 1;
    host.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
    host.addEventListener('gesturechange', e => { e.preventDefault(); host.__zoomBy(e.scale / gs); gs = e.scale; });
    host.addEventListener('gestureend', e => e.preventDefault());
  }
  // Listen back (from the grade report): the example from bar 1 at the tempo that was performed,
  // with the playhead. Returns the clock so the take can be lined up with it.
  host.__listen = (tempo, opts) => {
    if (!timeline.length) return null;
    const live = new Proxy({}, { get: (_, key) => {
      const v = V();
      if (key === 'startM') return 0;
      if (key === 'playhead') return v.playhead && v.playhead !== 'off' ? v.playhead : 'beat';
      if (key === v.mode) return { ...v[v.mode], ...(tempo ? { tempo } : {}), ...(opts?.noMetro ? { metronome: false } : {}) };
      return v[key];
    } });
    const clock = srPlay(live, timeline, () => srHidePlayhead(host));
    const pb = host.querySelector('[data-sr="play"]'); if (pb) pb.innerHTML = IC('ico:stop') + ' Stop';
    srAnimate(host, live, () => timeline, clock);
    return clock;
  };
  // the last grading, drawn on the music (only while the example is the one that was graded)
  host.__grRedraw = () => { if (typeof grDrawMarks === 'function') grDrawMarks(host, timeline); };
  // Build: the selected note glows
  const markSel = () => {
    if (!isBuild()) return;
    const k = st.build.sel; if (k == null) return;
    const ev = timeline[k]; ev?.el?.classList?.add('sr-sel');
  };
  // the measure playback starts from: a small flag on it; click the music to choose
  const drawFrom = () => {
    const staff = host.querySelector('.sr-staff'), svg = staff?.querySelector('svg'), geo = timeline.geo;
    staff?.querySelector('.sr-from')?.remove();
    if (!staff || !svg || !geo) return;
    const i = Math.min(Number(st.startM) || 0, geo.measures.length - 1); if (i <= 0) return;
    const m = geo.measures[i], sr = svg.getBoundingClientRect(), fr = staff.getBoundingClientRect(), k = sr.width / geo.W;
    const ox = sr.left - fr.left, oy = sr.top - fr.top + staff.scrollTop;
    const f = document.createElement('div'); f.className = 'sr-from';
    f.innerHTML = `<b>${IC('ico:play')} m. ${i + 1}</b>`;
    Object.assign(f.style, { left: ox + m.x0 * k + 'px', top: oy + m.y0 * k + 'px', width: (m.x1 - m.x0) * k + 'px', height: (m.y1 - m.y0) * k + 'px' });
    staff.appendChild(f);
  };
  const measureAtClick = e => {
    const staff = host.querySelector('.sr-staff'), svg = staff?.querySelector('svg'), geo = timeline.geo; if (!svg || !geo) return -1;
    const sr = svg.getBoundingClientRect(), k = sr.width / geo.W, x = (e.clientX - sr.left) / k, y = (e.clientY - sr.top) / k;
    return geo.measures.findIndex(m => x >= m.x0 && x <= m.x1 && y >= m.y0 - 25 && y <= m.y1 + 45);
  };
  const regen = () => {
    if (isBuild()) return;
    const m = st.mode, o = st[m];
    if (st.ex[m]) host.__prevEx = { mode: m, ex: JSON.parse(JSON.stringify(st.ex[m])) };
    st.startM = 0;
    st.ex[m] = m === 'rhythm' ? { rhythm: srGenRhythm(o.ts, o.measures, o.cells, o.ties) } : srGenParts(o);
  };
  const delSel = () => {
    const B = st.build; if (B.sel == null) return;
    const evs = srBuildEvents(B), it = evs[B.sel]?.item; if (it == null) return;
    srBuildPush(B);
    B.pitches = B.pitches.filter((_, pi) => !evs.some(x => x.p === pi && x.item === it));
    if (it > 0) B.items[it - 1] = srCid(B.items[it - 1]);          // nothing to tie into any more
    const len = srBuildTable(B)[srCid(B.items[it])].len, rests = it === B.items.length - 1 ? [] : srBuildRests(B, len);
    B.items.splice(it, 1, ...(rests || []));
    B.sel = Math.min(B.sel, srBuildEvents(B).length - 1); if (B.sel < 0) B.sel = null;
  };
  host.__buildKey = e => {
    if (!isBuild()) return false;
    const B = st.build, evs = srBuildEvents(B);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { if (!evs.length) return true; B.sel = B.sel == null ? 0 : Math.max(0, Math.min(evs.length - 1, B.sel + (e.key === 'ArrowRight' ? 1 : -1))); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && B.sel != null && evs[B.sel] && !evs[B.sel].rest) { srBuildPush(B); const p = evs[B.sel].p; B.pitches[p] = Math.max(-3, Math.min(9, B.pitches[p] + (e.key === 'ArrowUp' ? 1 : -1))); }
    else if (e.key === 'Delete' || e.key === 'Backspace') delSel();
    else if (e.key === 'Escape') B.sel = null;
    else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { const h = B.hist.pop(); if (h) Object.assign(B, JSON.parse(h)); }
    else return false;
    onChange && onChange(st); render(); return true;
  };
  host.onpointerdown = () => { SR_ACTIVE = host; window.__spaceTarget = 'sr'; };
  // Grade opens a small menu: microphone (rhythm + pitch) or the space bar (rhythm only)
  const closeGradeMenu = () => { host.querySelector('.sr-grmenu')?.remove(); document.removeEventListener('pointerdown', host.__grMenuAway, true); };
  const openGradeMenu = btn => {
    closeGradeMenu();
    const last = (typeof S !== 'undefined' && S.settings?.gradeInput) || 'mic';
    const r = btn.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'sr-grmenu';
    m.innerHTML = `<button data-sr="gradego" data-v="mic" class="${last === 'mic' ? 'last' : ''}">${IC('ico:mic')}<span><b>Microphone</b><small>Sing or clap: rhythm${V().mode === 'rhythm' ? '' : ' and pitch'}</small></span></button>
      <button data-sr="gradego" data-v="tap" class="${last === 'tap' ? 'last' : ''}">${IC('ico:keyboard')}<span><b>Tap rhythm (Space / Touch)</b><small>Tap each note: rhythm only, no mic needed</small></span></button>
      ${typeof openAvCal === 'function' ? `<button data-sr="gradecal" class="sr-grm-cal">${IC('ico:settings')}<span><b>Check mic / speaker sync…</b><small>Calibrate if timing feels early or late</small></span></button>` : ''}`;
    Object.assign(m.style, { left: Math.max(8, Math.min(r.left, innerWidth - 268)) + 'px', top: r.bottom + 6 + 'px' });
    host.appendChild(m);
    m.querySelector('.last')?.focus();
    m.onkeydown = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); closeGradeMenu(); btn.focus(); } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); const bs = [...m.querySelectorAll('button')]; bs[(bs.indexOf(document.activeElement) + 1) % bs.length].focus(); } };
    host.__grMenuAway = ev => { if (!m.contains(ev.target) && !btn.contains(ev.target)) closeGradeMenu(); };
    document.addEventListener('pointerdown', host.__grMenuAway, true);
  };
  host.onclick = e => {
    const b = e.target.closest('[data-sr]');
    if (!b) {                                                     // clicked the music: start from that measure
      if (!e.target.closest('.sr-staff')) return;
      if (isBuild()) {
        const k = timeline.findIndex(ev => ev.el && ev.el.contains && ev.el.contains(e.target));
        e.stopPropagation();
        if (k >= 0) { st.build.sel = k; st.build.pick = true; onChange && onChange(st); render(); return; }   // a note: select it
        // empty space in a measure: play from there (like the other tabs)
        const mi = measureAtClick(e); if (mi < 0) { st.build.sel = null; st.build.pick = false; render(); return; }
        st.startM = (Number(st.startM) || 0) === mi ? 0 : mi;
        onChange && onChange(st); drawFrom();
        if (SR_PLAY.master) { srStop(); host.querySelector('[data-sr="play"]')?.click(); }
        return;
      }
      const i = measureAtClick(e); if (i < 0) return;
      e.stopPropagation();
      st.startM = (Number(st.startM) || 0) === i ? 0 : i;          // click the flagged measure again (or measure 1) = from the start
      onChange && onChange(st); drawFrom();
      if (SR_PLAY.master) { srStop(); host.querySelector('[data-sr="play"]')?.click(); }
      return;
    }
    e.stopPropagation();
    const k = b.dataset.sr;
    const B = st.build;
    if (k === 'mode') { srStop(); st.mode = b.dataset.v; st.startM = 0; }
    else if (k === 'bkind') { srStop(); B.kind = b.dataset.v; }

    else if (k === 'badd') { srStop(); B.lastRhythm = b.dataset.id; srBuildPush(B); if (!srBuildInsert(B, [b.dataset.id])) { B.hist.pop(); toast(B.pick ? 'That doesn’t fit there without moving the bar lines — try at the end, or delete a note first.' : 'That’s longer than what’s left of this measure.'); } }
    else if (k === 'bpat') {
      srStop(); srBuildPush(B);
      const pat = SR_PATTERNS[+b.dataset.i];
      if (!srBuildInsert(B, pat.map(() => 'q'), pat)) { B.hist.pop(); toast('That pattern doesn’t fit there without moving the bar lines.'); }
    }
    else if (k === 'bsyl') {
      srStop(); srBuildPush(B);
      const d = Number(b.dataset.d), evs = srBuildEvents(B);
      const ev = B.sel != null ? evs[B.sel] : null;
      if (ev && !ev.rest) {
        B.pitches[ev.p] = d;
        const nx = evs.findIndex((x, i) => i > B.sel && !x.rest);   // on to the next note
        B.sel = nx >= 0 ? nx : null;
      } else {
        let id = srBuildRhythm(B); const t = srBuildTable(B);
        if (t[id].ev.every(e => e[2])) { const pair = SR_BUILD_PAIRS[SR_METERS[B.ts][1]].find(pp => pp[1] === id); id = pair ? pair[0] : (SR_METERS[B.ts][1] === 'compound' ? 'dq' : 'q'); }
        if (!srBuildInsert(B, [id], [d])) { B.hist.pop(); toast('That rhythm doesn’t fit in what’s left of this measure — pick a shorter one.'); }
      }
    }
    else if (k === 'bundo') { const h = B.hist.pop(); if (h) Object.assign(B, JSON.parse(h)); }
    else if (k === 'bdel') delSel();
    else if (k === 'btie') {
      const evs = srBuildEvents(B), ev = evs[B.sel], nx = evs[B.sel + 1];
      const lastOfBlock = ev && (!nx || nx.item !== ev.item);
      if (!ev || ev.rest || !lastOfBlock || !nx || nx.rest) { toast('A tie joins a note to the very next note (the last note of a block to the first of the next).'); return; }
      srBuildPush(B);
      const raw = B.items[ev.item];
      B.items[ev.item] = srTied(raw) ? srCid(raw) : srCid(raw) + '~';
      if (!srTied(raw)) B.pitches[nx.p] = B.pitches[ev.p];
    }
    else if (k === 'bclearm') {
      srBuildPush(B);
      const ms = srBuildMeasures(B), evs = srBuildEvents(B), selItem = B.sel != null ? evs[B.sel]?.item : null;
      const m = ms.find(cells => cells.some(c => c.item === selItem)) || ms[ms.length - 1];
      const drop = new Set(m.map(c => c.item));
      B.pitches = B.pitches.filter((_, pi) => !evs.some(x => x.p === pi && drop.has(x.item)));
      const lastM = m === ms[ms.length - 1], first = Math.min(...drop);
      const rests = lastM ? [] : srBuildRests(B, SR_METERS[B.ts][0]) || [];
      const kept = B.items.filter((_, ii) => !drop.has(ii)); kept.splice(first, 0, ...rests);
      if (first > 0 && kept[first - 1]) kept[first - 1] = srCid(kept[first - 1]);
      B.items = kept; B.sel = null;
    }
    else if (k === 'bclear') { if (!confirm('Clear the whole example?')) return; srBuildPush(B); B.items = []; B.pitches = []; B.sel = null; }
    else if (k === 'preset-save') { host.__savingPreset = true; render(); return; }
    else if (k === 'preset-save-cancel') { host.__savingPreset = false; render(); return; }
    else if (k === 'preset-save-ok') {
      const name = host.querySelector('.sr-pre-inp')?.value.trim();
      if (!name) { host.querySelector('.sr-pre-inp')?.focus(); return; }
      const list = srSavedPresets();
      const existing = list.find(p => p.mode === st.mode && p.name.toLowerCase() === name.toLowerCase());
      const snap = srPresetSnapshot(st[st.mode], st.mode);
      if (existing) existing.data = snap;
      else list.push({ id: typeof uid === 'function' ? uid() : String(Date.now()), name, mode: st.mode, data: snap });
      host.__savingPreset = false;
      if (typeof save === 'function') save();
      if (typeof toast === 'function') toast(`Saved preset “${name}”.`);
    }
    else if (k === 'preset-load') {
      const p = srSavedPresets().find(x => x.id === b.dataset.pid);
      if (p?.data) {
        srStop();
        const o = st[st.mode];
        for (const [pk, pv] of Object.entries(p.data)) o[pk] = Array.isArray(pv) ? [...pv] : pv;
        regen();
      }
    }
    else if (k === 'preset-del') {
      const list = srSavedPresets(), idx = list.findIndex(x => x.id === b.dataset.pid);
      if (idx >= 0 && confirm(`Delete preset “${list[idx].name}”?`)) {
        list.splice(idx, 1);
        if (typeof save === 'function') save();
      }
    }
    else if (k === 'undo-ex') {
      if (host.__prevEx && host.__prevEx.mode === st.mode) {
        srStop();
        st.ex[st.mode] = host.__prevEx.ex;
        host.__prevEx = null;
      }
    }
    else if (k === 'new') { srStop(); regen(); }
    else if (k === 'counts') setCurShowCounts(!curShowCounts());
    else if (k === 'zoom') { applyLiveZoom(Math.round(((st.zoom || 1) + 0.1 * Number(b.dataset.d)) * 10) / 10); return; }
    else if (k === 'zoom-reset') { applyLiveZoom(1); return; }
    else if (k === 'rhyonly') { if (st.mode === 'solfege') st.solRhythm = !st.solRhythm; else if (isBuild()) B.kind = B.kind === 'rhythm' ? 'solfege' : 'rhythm'; }
    else if (k === 'barreset') mbarReset(SR_BARCFG);
    else if (k === 'metro') st[st.mode].metronome = !st[st.mode].metronome;   // live: the next beat follows
    else if (k === 'show') st.show = !st.show;
    else if (k === 'nums') st[st.mode].measureNums = !st[st.mode].measureNums;
    else if (k === 'step') {
      const o = st[st.mode], f = b.dataset.f, lim = f === 'measures' ? [1, 16] : [30, 200];
      o[f] = Math.max(lim[0], Math.min(lim[1], (Number(o[f]) || 0) + Number(b.dataset.d)));
      if (f === 'measures') { srStop(); regen(); }
    }
    else if (k === 'playhead') st.playhead = ({ beat: 'notes', notes: 'off', off: 'beat' })[st.playhead ?? 'beat'];   // Beat → Note → Off
    else if (k === 'grrecent') { if (typeof grShowRecent === 'function') grShowRecent(host); return; }
    else if (k === 'grade') {                                   // a take running: this stops and grades it
      if (GR.on || GR.starting) { closeGradeMenu(); grStart(host, V(), timeline, b); return; }
      host.querySelector('.sr-grmenu') ? closeGradeMenu() : openGradeMenu(b); return;
    }
    else if (k === 'gradego') {                                 // what's on screen (the built example, or rhythm only)
      const v = b.dataset.v, gb = host.querySelector('[data-sr="grade"]'); closeGradeMenu();
      if (typeof S !== 'undefined' && S.settings && S.settings.gradeInput !== v) { S.settings.gradeInput = v; save(); }
      if (gb) grStart(host, V(), timeline, gb, v); return;
    }
    else if (k === 'gradecal') { closeGradeMenu(); if (typeof openAvCal === 'function') openAvCal(); return; }
    else if (k === 'settings') st.settingsOpen = !st.settingsOpen;
    else if (k === 'play') {
      if (SR_PLAY.master) { srStop(); return; }
      if (!timeline.length) return;
      const live = new Proxy({}, { get: (_, key) => V()[key] });   // always the current view
      const clock = srPlay(live, timeline, () => srHidePlayhead(host)); b.innerHTML = IC('ico:stop') + ' Stop';
      srAnimate(host, live, () => timeline, clock); return;
    } else if (k === 'save') {
      const cls = currentClass(); if (!cls) return toast('Show a class first (Class picker in the dock) to save this to it.');
      const copy = JSON.parse(JSON.stringify(st)); copy.settingsOpen = false; copy.show = false;
      if (copy.build) { copy.build.hist = []; copy.build.sel = null; }
      cls.resources.push({ id: uid(), title: isBuild() ? 'My ' + (st.build.kind === 'rhythm' ? 'rhythm' : 'solfege') + ' example' : st.mode === 'rhythm' ? 'Rhythm reading' : 'Solfege reading', sight: copy });
      save(); P.stageKey = ''; toast(`Saved to ${cls.name} — it's now a tab on the class screen.`); return;
    } else if (k === 'print') {
      srOpenWorksheet(st, V()); return;
    }
    onChange && onChange(st); render();
  };
  host.onchange = e => {
    const el = e.target, o = st[st.mode];
    if (el.dataset.cell) {
      const set = new Set(o.cells); el.checked ? set.add(el.dataset.cell) : set.delete(el.dataset.cell); o.cells = [...set];
    } else if (el.dataset.k) {
      const k = el.dataset.k;
      if (k === 'rhythmSystem') {
        if (typeof S !== 'undefined') { (S.settings ||= {}).rhythmSystem = el.value; save(); }
        if (typeof refreshRhythmCounts === 'function') refreshRhythmCounts();
        render(); return;
      }
      o[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? clamp(Number(el.value) || 1, Number(el.min), Number(el.max)) : k === 'countIn' ? Number(el.value) : el.value;
      if (k === 'countIn' && o.countIn === 0 && st.mode === 'solfege') o.countPitch = 'none';
      if (k === 'ts' && st.mode === 'rhythm') {   // switching simple ↔ compound swaps the note choices
        const table = srCellsFor(o.ts); if (!o.cells.some(c => table[c])) o.cells = SR_METERS[o.ts][1] === 'compound' ? ['dq', 'eee', 'qe', 'dh'] : ['q', 'h', 'ee', 'qr'];
      }
    } else return;
    if (isBuild()) {
      if (el.dataset.k === 'ts' && SR_METERS[o.ts][1] !== (o.__kindTs || SR_METERS['4/4'][1]) && o.items.length) { srBuildPush(o); o.items = []; o.pitches = []; o.sel = null; toast('The blocks are different in this meter, so the example was cleared (Undo brings it back).'); }
      o.__kindTs = SR_METERS[o.ts][1];
      srStop(); onChange && onChange(st); render(); return;
    }
    if (!['key', 'scale', 'clef', 'tempo', 'metronome', 'sound', 'measureNums', 'countIn', 'countPitch', 'gradeVoice', 'instrument', 'artic'].includes(el.dataset.k)) { srStop(); regen(); }
    onChange && onChange(st); render();
  };
  // redraw notation when the window is resized
  let rt = null;
  const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { const sv = host.querySelector('.sr-staff'); if (sv && (!isBuild() || st.build?.items.length)) { timeline = srDraw(sv, V()); drawFrom(); markSel(); host.__grRedraw(); } }, 120); });
  ro.observe(host);
  render();
  return st;
}
// Space bar plays / stops the sight-reading example you used last (unless you're typing,
// or you used the score player more recently — then Space is the score player's).
let SR_ACTIVE = null;
// while building: arrows move / re-pitch the selected note, Delete removes it, ⌘Z undoes
// (caught first, so they don't also move the agenda)
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || !SR_ACTIVE || !SR_ACTIVE.isConnected || !SR_ACTIVE.__buildKey || (window.__spaceTarget && window.__spaceTarget !== 'sr')) return;
  if (e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (SR_ACTIVE.__buildKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (window.__spaceTarget && window.__spaceTarget !== 'sr') return;
  if (document.querySelector('.sr-grmenu')) return;            // the Grade menu is open: Space picks the highlighted choice
  let h = SR_ACTIVE && SR_ACTIVE.isConnected ? SR_ACTIVE : null;
  if (!h) h = [...document.querySelectorAll('.sr-host')].find(x => x.offsetParent);   // the one on screen
  if (!h) return;
  const b = h.querySelector('[data-sr="play"]'); if (!b) return;
  e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();   // a focused button would also click
  SR_ACTIVE = h; b.click();
});
window.mountSight = mountSight;
window.srDefaults = srDefaults;

// ---------- Feature 6: Printable Sight-Reading Worksheets & Teacher Answer Keys
function srRenderPrintSVG(viewState) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-9999px;top:0;width:720px;background:#fff;padding:0;margin:0;visibility:hidden;';
  box.__zoom = 0.85;
  document.body.appendChild(box);
  try {
    srDraw(box, viewState);
    const svgs = [...box.querySelectorAll('svg')].map(svg => {
      const w = parseFloat(svg.getAttribute('width')) || 700;
      const h = parseFloat(svg.getAttribute('height')) || 120;
      if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
      return svg.outerHTML;
    });
    return svgs.join('');
  } finally {
    box.remove();
  }
}

function srOpenWorksheet(st, curView) {
  document.getElementById('sr-ws-modal')?.remove();
  const isBuild = st.mode === 'build';
  const kind = curView.mode; // 'rhythm' or 'solfege'
  const cls = typeof currentClass === 'function' ? currentClass() : null;
  const defTitle = `${cls?.name ? cls.name + ' — ' : ''}${kind === 'rhythm' ? 'Rhythm' : 'Solfege'} Sight Reading`;
  const o = curView[kind] || st[kind];
  const metaParts = [o?.ts || '4/4'];
  if (kind === 'solfege' && o) metaParts.push(`${(o.key || 'C').replace('b', '♭')} ${o.scale || 'major'}`);
  const metaLine = metaParts.join(' · ');

  const genOne = () => {
    const nextV = JSON.parse(JSON.stringify(curView));
    if (kind === 'rhythm') {
      const ro = nextV.rhythm;
      nextV.ex = { rhythm: { rhythm: srGenRhythm(ro.ts, ro.measures, ro.cells, ro.ties) } };
    } else {
      nextV.ex = { solfege: srGenParts(nextV.solfege) };
    }
    return nextV;
  };

  let count = isBuild ? 1 : 4;
  const firstView = JSON.parse(JSON.stringify(curView));
  firstView.__fromScreen = true;
  let views = [firstView];
  const syncCount = n => {
    count = n;
    while (views.length < count) views.push(genOne());
    if (views.length > count) views = views.slice(0, count);
  };
  syncCount(count);

  const modal = document.createElement('div');
  modal.id = 'sr-ws-modal'; modal.className = 'av-cal sr-ws-modal';
  modal.innerHTML = `<div class="av-card sr-ws-card sr-ws-wide">
    <div class="sr-ws-top">
      <h3>${IC('ico:print')} Sight-Reading Worksheet</h3>
      <span class="grow"></span>
      ${isBuild ? '' : `<button class="btn small" data-ws="swapall" title="Generate a fresh set of exercises">${IC('ico:reload')} Swap all</button>`}
      <button class="btn small" data-ws="cancel">Cancel</button>
      <button class="btn small primary" data-ws="go">${IC('ico:print')} Print / Save PDF</button>
    </div>
    <div class="sr-ws-opts">
      <label class="fld" style="flex:1 1 200px"><span>Worksheet title</span><input id="ws-title" value="${esc(defTitle)}"></label>
      <label class="fld"><span>Exercises</span><select id="ws-count">
        <option value="1" ${count === 1 ? 'selected' : ''}>This example (1)</option>
        ${isBuild ? '' : `<option value="2" ${count === 2 ? 'selected' : ''}>2 exercises</option><option value="3" ${count === 3 ? 'selected' : ''}>3 exercises</option><option value="4" ${count === 4 ? 'selected' : ''}>4 exercises</option><option value="6" ${count === 6 ? 'selected' : ''}>6 exercises</option>`}
      </select></label>
      <label class="fld"><span>Rhythm counts</span><select id="ws-rhy">${RHYTHM_SYSTEMS.map(([v, l]) => `<option value="${v}" ${rhythmSys() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="sr-ws-checks">
      <label class="chk"><input type="checkbox" id="ws-hdr" checked> Name / Date / Class header</label>
      <label class="chk"><input type="checkbox" id="ws-blanks" checked> Blank answer lines under notes</label>
      <label class="chk"><input type="checkbox" id="ws-blanks-rest" ${kind === 'rhythm' ? 'checked' : ''}> Blank lines under rests</label>
      <label class="chk"><input type="checkbox" id="ws-stu-ans"> Show ${kind === 'rhythm' ? 'counts' : 'solfege'} on student sheet</label>
      <label class="chk"><input type="checkbox" id="ws-key" checked> Add Page 2: Teacher Answer Key</label>
    </div>
    <div class="sr-ws-prev" id="ws-prev"></div>
  </div>`;
  document.body.appendChild(modal);

  const renderSet = (withAns, interactive = false, withBlanks = false, withBlankRests = false) => {
    // Compute ONE shared staff width & measures-per-line across all exercises so every exercise scales identically!
    let wsMaxNotes = 4, wsMaxM = 4;
    for (const v of views) {
      const ex = v.ex?.[kind]; if (!ex) continue;
      const ps = kind === 'solfege' && ex.parts && ex.parts.length > 1 ? ex.parts : [{ rhythm: ex.rhythm || [] }];
      for (const p of ps) {
        wsMaxM = Math.max(wsMaxM, (p.rhythm || []).length);
        for (const m of (p.rhythm || [])) wsMaxNotes = Math.max(wsMaxNotes, (m || []).reduce((n, c) => n + c.ev.length, 0));
      }
    }
    const wsPer = wsMaxM <= 4 ? wsMaxM : (wsMaxM <= 6 ? Math.ceil(wsMaxM / 2) : 4);
    const wsRestW = Math.max(185, Math.min(310, wsMaxNotes * 34 + 28));
    return views.map((v, i) => {
      const copy = JSON.parse(JSON.stringify(v));
      copy.show = kind === 'solfege' ? withAns : false;
      copy.showCounts = kind === 'rhythm' ? withAns : (withAns && !!st.showCounts);
      copy.answerBlanks = !withAns && !!withBlanks;
      copy.answerBlanksRests = !!withBlankRests;
      copy.__printOpts = { per: wsPer, restW: wsRestW };
      const svg = srRenderPrintSVG(copy);
      if (!interactive) {
        return `<div class="blk sr-ws-ex">${views.length > 1 ? `<div class="sr-ws-num">${i + 1}.</div>` : ''}<div class="sr-ws-svg">${svg}</div></div>`;
      }
      return `<div class="sr-ws-item" data-wsi="${i}">
        <div class="sr-ws-ih">
          <b>Exercise ${i + 1}${v.__fromScreen ? ' <span class="muted small">(from screen)</span>' : ''}</b>
          <span class="grow"></span>
          ${!isBuild ? `<button class="btn small" data-ws="swap" data-i="${i}" title="Replace with a newly generated exercise">${IC('ico:reload')} Swap</button>` : ''}
          ${views.length > 1 ? `<button class="btn small" data-ws="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">${IC('ico:up')}</button><button class="btn small" data-ws="down" data-i="${i}" ${i === views.length - 1 ? 'disabled' : ''} title="Move down">${IC('ico:down')}</button>` : ''}
        </div>
        <div class="sr-ws-paper">${svg}</div>
      </div>`;
    }).join('');
  };

  const drawPreview = () => {
    const prev = modal.querySelector('#ws-prev');
    const stuAns = modal.querySelector('#ws-stu-ans').checked;
    const blanks = modal.querySelector('#ws-blanks').checked;
    const blankRests = modal.querySelector('#ws-blanks-rest');
    blankRests.disabled = !blanks || stuAns;
    prev.innerHTML = renderSet(stuAns, true, blanks, blankRests.checked);
  };
  drawPreview();

  const close = () => { document.removeEventListener('keydown', onKey, true); modal.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  modal.addEventListener('change', e => {
    if (e.target.id === 'ws-count') { syncCount(Number(e.target.value) || 1); drawPreview(); }
    else if (e.target.id === 'ws-stu-ans' || e.target.id === 'ws-blanks' || e.target.id === 'ws-blanks-rest') drawPreview();
    else if (e.target.id === 'ws-rhy') {
      if (typeof S !== 'undefined') { (S.settings ||= {}).rhythmSystem = e.target.value; save(); }
      if (typeof refreshRhythmCounts === 'function') refreshRhythmCounts();
      drawPreview();
    }
  });
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-ws="cancel"]')) { close(); return; }
    const b = e.target.closest('[data-ws]'); if (!b) return;
    const act = b.dataset.ws, idx = +b.dataset.i;
    if (act === 'swap') { views[idx] = genOne(); drawPreview(); return; }
    if (act === 'swapall') { views = views.map(() => genOne()); drawPreview(); return; }
    if (act === 'up' && idx > 0) { [views[idx - 1], views[idx]] = [views[idx], views[idx - 1]]; drawPreview(); return; }
    if (act === 'down' && idx < views.length - 1) { [views[idx + 1], views[idx]] = [views[idx], views[idx + 1]]; drawPreview(); return; }
    if (act !== 'go') return;
    const title = modal.querySelector('#ws-title').value.trim() || defTitle;
    const showHdr = modal.querySelector('#ws-hdr').checked;
    const stuAns = modal.querySelector('#ws-stu-ans').checked;
    const blanks = modal.querySelector('#ws-blanks').checked;
    const blankRests = modal.querySelector('#ws-blanks-rest').checked;
    const addKey = modal.querySelector('#ws-key').checked;
    let html = `<div class="meta">${esc(metaLine)}</div>`;
    if (showHdr) html += `<div class="sr-ws-hdr"><span>Name: ___________________________</span><span>Date: _______________</span><span>Class: _______________</span></div>`;
    html += renderSet(stuAns, false, blanks, blankRests);
    if (addKey) {
      html += `<div class="sr-ws-key"><h1>${esc(title)} — Answer Key</h1><div class="meta">${esc(metaLine)}</div>${renderSet(true, false, false, false)}</div>`;
    }
    close();
    if (typeof printHTML === 'function') printHTML(title, html);
  });
}

// If the main app drew windows before this file loaded, mount them now.
if (typeof mountSightHosts === "function") mountSightHosts();
