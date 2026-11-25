'use strict';
/* Rehearsal Scan & Fix — Auto-Flagging Consistency Engine & Verification Save Gate.
   Zero external dependencies: runs identically in browsers and macOS JavaScriptCore (jsc).
   Designed to run alongside web/scan-model.js (with self-contained fallbacks if loaded standalone). */

// ---------- Concert Band Practical Written Ranges (MIDI min/max)
const SF_INSTRUMENT_RANGES = {
  piccolo: {
    min: 62, max: 96, label: 'Piccolo',
    aliases: /\b(piccolo|picc\.?)\b/i
  },
  flute: {
    min: 60, max: 96, label: 'Flute',
    aliases: /\b(flute|fl\.?|flauti?)\b/i
  },
  oboe: {
    min: 58, max: 91, label: 'Oboe',
    aliases: /\b(oboe|ob\.?)\b/i
  },
  bassoon: {
    min: 34, max: 72, label: 'Bassoon',
    aliases: /\b(bassoon|bsn\.?|fagott?o?)\b/i
  },
  bass_clarinet: {
    min: 52, max: 84, label: 'Bass Clarinet',
    aliases: /\b(bass\s*clarinet|b\.?\s*cl\.?|bs\.?\s*cl\.?)\b/i
  },
  clarinet: {
    min: 52, max: 91, label: 'Bb Clarinet',
    aliases: /\b(clarinet|cl\.?|bb\s*cl\.?)\b/i
  },
  bari_sax: {
    min: 57, max: 89, label: 'Baritone Saxophone',
    aliases: /\b(bari(?:tone)?\s*sax(?:ophone)?|eb\s*bari)\b/i
  },
  tenor_sax: {
    min: 58, max: 89, label: 'Tenor Saxophone',
    aliases: /\b(tenor\s*sax(?:ophone)?|t\.?\s*sax)\b/i
  },
  alto_sax: {
    min: 58, max: 89, label: 'Alto Saxophone',
    aliases: /\b(alto\s*sax(?:ophone)?|a\.?\s*sax|eb\s*alto)\b/i
  },
  trumpet: {
    min: 54, max: 84, label: 'Bb Trumpet',
    aliases: /\b(trumpet|tpt\.?|trp\.?|cornet|cnt\.?|flugelhorn)\b/i
  },
  french_horn: {
    min: 48, max: 81, label: 'French Horn',
    aliases: /\b(french\s*horn|f\s*horn|horn\s*in\s*f|horn|hn\.?|hrn\.?)\b/i
  },
  trombone: {
    min: 40, max: 70, label: 'Trombone',
    aliases: /\b(trombone|tbn\.?|trb\.?)\b/i
  },
  euphonium: {
    min: 40, max: 70, label: 'Euphonium / Baritone',
    aliases: /\b(euphonium|euph\.?|baritone\s*(?:b\.?c\.?|t\.?c\.?|horn)?|bar\.?)\b/i
  },
  tuba: {
    min: 28, max: 65, label: 'Tuba',
    aliases: /\b(tuba|sousaphone|basses?)\b/i
  },
  mallets: {
    min: 60, max: 96, label: 'Mallet Percussion',
    aliases: /\b(mallets?|bells|glockenspiel|xylophone|marimba|vibraphone|chimes)\b/i
  },
  auto: {
    min: 48, max: 84, label: 'Auto (by clef)',
    aliases: null
  }
};

// Specificity order so compound names (bass clarinet, bari sax, piccolo) match before base names
const SF_DETECT_ORDER = [
  'piccolo', 'flute', 'oboe', 'bassoon',
  'bass_clarinet', 'clarinet',
  'bari_sax', 'tenor_sax', 'alto_sax',
  'trumpet', 'french_horn', 'trombone', 'euphonium', 'tuba', 'mallets'
];

function sfDetectInstrument(partName) {
  const name = String(partName || '').trim();
  if (!name) return 'auto';
  for (const key of SF_DETECT_ORDER) {
    const info = SF_INSTRUMENT_RANGES[key];
    if (info && info.aliases && info.aliases.test(name)) return key;
  }
  return 'auto';
}

const SF_FLAG_WEIGHTS = {
  duration_mismatch: 0.45,
  out_of_range: 0.35,
  implausible_leap: 0.30,
  accidental_anomaly: 0.25,
  rhythm_density_anomaly: 0.25
};

const SF_FLAG_NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function sfFormatMidiNote(midi) {
  if (!isFinite(midi)) return '?';
  const m = Math.round(midi);
  return SF_FLAG_NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

function sfFlagsKeyAlter(fifths, step) {
  if (typeof sfKeyAlterForStep === 'function') return sfKeyAlterForStep(fifths, step);
  const f = Math.trunc(Number(fifths) || 0);
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  if (f > 0) { const i = sharps.indexOf(step); return (i >= 0 && i < f) ? 1 : 0; }
  if (f < 0) { const i = flats.indexOf(step); return (i >= 0 && i < -f) ? -1 : 0; }
  return 0;
}

function sfClefFallbackRange(measure, staff) {
  const clefs = (measure && measure.clefs) || [];
  const clef = clefs.find(c => c.number === staff) || clefs[0] || { sign: 'G', line: 2, octaveChange: 0 };
  const shift = 12 * (clef.octaveChange || 0);
  if (clef.sign === 'F') return { min: 33 + shift, max: 67 + shift, label: 'Bass clef' };
  if (clef.sign === 'C') return { min: 45 + shift, max: 79 + shift, label: 'C clef' };
  return { min: 55 + shift, max: 88 + shift, label: 'Treble clef' };
}

function sfMedian(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return (sorted.length % 2 === 1) ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sfFormatBeats(val) {
  const rounded = Math.round(val * 100) / 100;
  return String(rounded);
}

// ---------- Consistency Engine (All 5 Rules)
function sfAnalyzeFlags(model, opts) {
  const options = opts || {};
  const parts = (model && model.parts) || [];
  let maxMeasures = 0;
  for (const p of parts) {
    if (p.measures && p.measures.length > maxMeasures) maxMeasures = p.measures.length;
  }

  const perMeasure = [];
  for (let mi = 0; mi < maxMeasures; mi++) {
    const firstPartM = parts[0] && parts[0].measures && parts[0].measures[mi];
    perMeasure.push({
      measureIndex: mi,
      measureNumber: (firstPartM && firstPartM.number) || String(mi + 1),
      findings: [],
      noteIds: []
    });
  }

  function addFinding(mi, finding) {
    const bucket = perMeasure[mi];
    if (!bucket) return;
    bucket.findings.push(finding);
    if (finding.noteId && !bucket.noteIds.includes(finding.noteId)) {
      bucket.noteIds.push(finding.noteId);
    }
  }

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const measures = part.measures || [];
    const instKey = (options.instrument && options.instrument !== 'auto' && SF_INSTRUMENT_RANGES[options.instrument])
      ? options.instrument
      : sfDetectInstrument(part.name);

    // Precompute pitched non-chord note counts for Rule 4 (rhythm_density_anomaly)
    const densityMeta = measures.map(m => {
      const beats = (m.time && m.time.beats) || 4;
      const bt = (m.time && m.time.beatType) || 4;
      const expectedQ = beats * 4 / bt;
      const pitched = (m.entries || []).filter(e => e.kind === 'note' && !e.isRest && !e.isChord && !e.isGrace);
      const rests = (m.entries || []).filter(e => e.kind === 'rest' && !e.isGrace);
      const count = pitched.length;
      const isWholeBarRest = count === 0 && (
        rests.length === 0 ||
        rests.some(r => r.measureRest || (r.type === 'whole' && !r.dots)) ||
        rests.reduce((acc, r) => acc + (r.durationQ || 0), 0) >= expectedQ - 0.01
      );
      const isWholeNoteCadence = count === 1 && (pitched[0].durationQ || 0) >= expectedQ - 0.01;
      // Clean phrase ending: all pitched notes are >= 1 quarter beat and a voice sums cleanly to expectedQ
      let hasCompleteVoice = false;
      const vSums = {};
      for (const e of m.entries || []) {
        if ((e.kind !== 'note' && e.kind !== 'rest') || e.isGrace || e.isChord) continue;
        const vid = e.voice || '1';
        vSums[vid] = (vSums[vid] || 0) + (e.durationQ || 0);
      }
      for (const vid of Object.keys(vSums)) {
        if (Math.abs(vSums[vid] - expectedQ) <= 0.01) {
          hasCompleteVoice = true;
          break;
        }
      }
      const allNotesAtLeastQuarter = count > 0 && pitched.every(e => (e.durationQ || 0) >= 1 - 1e-6);
      const isCleanPhraseEnding = allNotesAtLeastQuarter && hasCompleteVoice;
      return { count, pitched, expectedQ, isWholeBarRest, isWholeNoteCadence, isCleanPhraseEnding };
    });

    // Track previous non-chord pitched note per voice across barlines for Rule 5 (implausible_leap)
    const prevByVoice = {};

    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      const entries = m.entries || [];
      const beats = (m.time && m.time.beats) || 4;
      const bt = (m.time && m.time.beatType) || 4;
      const expectedQ = beats * 4 / bt;
      const isPickup = (mi === 0 || m.implicit || m.number === '0');
      const fifths = (m.key && m.key.fifths) || 0;

      // ----- Rule 1: duration_mismatch
      const voices = {};
      for (const e of entries) {
        if (e.kind === 'forward' && e.voice) {
          const v = (voices[e.voice] || (voices[e.voice] = { staff: e.staff || 1, sumQ: 0, maxEndQ: 0, hasForward: false, items: [] }));
          if (e.staff) v.staff = e.staff;
          v.hasForward = true;
          v.maxEndQ = Math.max(v.maxEndQ, (e.onsetQ || 0) + (e.durationQ || 0));
          continue;
        }
        if ((e.kind !== 'note' && e.kind !== 'rest') || e.isGrace || e.isChord) continue;
        const vid = e.voice || '1';
        const v = (voices[vid] || (voices[vid] = { staff: e.staff || 1, sumQ: 0, maxEndQ: 0, hasForward: false, items: [] }));
        if (e.staff) v.staff = e.staff;
        v.sumQ += (e.durationQ || 0);
        v.maxEndQ = Math.max(v.maxEndQ, (e.onsetQ || 0) + (e.durationQ || 0));
        v.items.push(e);
      }

      const staffComplete = new Set();
      for (const vid of Object.keys(voices)) {
        const v = voices[vid];
        if (!v.items.length) continue;
        const isWholeRestBar = v.items.length === 1 && v.items[0].isRest && (
          v.items[0].measureRest || (v.items[0].type === 'whole' && !v.items[0].dots)
        );
        const actualQ = v.hasForward ? v.maxEndQ : v.sumQ;
        if (isWholeRestBar || Math.abs(actualQ - expectedQ) <= 0.01) {
          staffComplete.add(v.staff || 1);
        }
      }

      for (const vid of Object.keys(voices)) {
        const v = voices[vid];
        if (!v.items.length) continue;
        // Whole-measure rest convention (a single <rest measure="yes"/> or single whole rest fills any meter)
        const isWholeRestBar = v.items.length === 1 && v.items[0].isRest && (
          v.items[0].measureRest || (v.items[0].type === 'whole' && !v.items[0].dots)
        );
        if (isWholeRestBar) continue;

        const actualQ = v.hasForward ? v.maxEndQ : v.sumQ;
        const diff = actualQ - expectedQ;
        const badPickup = isPickup && diff > 0.01;
        const badNormal = !isPickup && (diff > 0.01 || (diff < -0.01 && !staffComplete.has(v.staff || 1)));
        if (badPickup || badNormal) {
          const actualBeats = actualQ * bt / 4;
          const lastItem = v.items[v.items.length - 1];
          addFinding(mi, {
            rule: 'duration_mismatch',
            severity: 'high',
            weight: SF_FLAG_WEIGHTS.duration_mismatch,
            partIndex: pi,
            voice: vid,
            noteId: lastItem ? lastItem.id : null,
            message: `Measure ${m.number} adds up to ${sfFormatBeats(actualBeats)} beats instead of ${beats}.`
          });
        }
      }

      // ----- Rule 2: accidental_anomaly
      const accState = {}; // key: `${staff}:${step}:${octave}` -> { activeAlter, explicitCount }
      for (const e of entries) {
        if (e.kind !== 'note' || e.isRest || e.spoken || !e.step || !isFinite(e.octave)) continue;
        const key = `${e.staff || 1}:${e.step}:${e.octave}`;
        const keyAlt = sfFlagsKeyAlter(fifths, e.step);
        const st = accState[key] || (accState[key] = { activeAlter: keyAlt, explicitCount: 0 });
        const curAlt = Number(e.alter) || 0;

        if (e.accidental) {
          let reason = null;
          if (Math.abs(curAlt) >= 2 || e.accidental === 'double-sharp' || e.accidental === 'flat-flat' || e.accidental === 'double-flat') {
            reason = `Unusual double accidental (${e.accidental}) on ${e.step}${e.octave}.`;
          } else if (st.explicitCount === 0 && curAlt === keyAlt) {
            reason = `Redundant ${e.accidental} on ${e.step}${e.octave} already matches the key signature.`;
          } else if (st.explicitCount > 0 && curAlt === st.activeAlter) {
            reason = `Repeated ${e.accidental} on ${e.step}${e.octave} in the same measure.`;
          } else if (fifths <= -2 && curAlt > 0 && e.accidental === 'sharp') {
            reason = `Sharp on ${e.step}${e.octave} clashes with a flat key signature (${Math.abs(fifths)} flats).`;
          } else if (fifths >= 2 && curAlt < 0 && e.accidental === 'flat') {
            reason = `Flat on ${e.step}${e.octave} clashes with a sharp key signature (${fifths} sharps).`;
          }
          if (reason) {
            addFinding(mi, {
              rule: 'accidental_anomaly',
              severity: 'medium',
              weight: SF_FLAG_WEIGHTS.accidental_anomaly,
              partIndex: pi,
              voice: e.voice || '1',
              noteId: e.id,
              message: reason
            });
          }
          st.activeAlter = curAlt;
          st.explicitCount++;
        } else {
          st.activeAlter = curAlt;
        }
      }

      // ----- Rule 3: out_of_range
      for (const e of entries) {
        if (e.kind !== 'note' || e.isRest || e.isCue || e.spoken || !isFinite(e.midi)) continue;
        const range = (instKey !== 'auto' && SF_INSTRUMENT_RANGES[instKey])
          ? SF_INSTRUMENT_RANGES[instKey]
          : sfClefFallbackRange(m, e.staff || 1);
        if (e.midi < range.min || e.midi > range.max) {
          const dir = e.midi < range.min ? 'below' : 'above';
          addFinding(mi, {
            rule: 'out_of_range',
            severity: 'high',
            weight: SF_FLAG_WEIGHTS.out_of_range,
            partIndex: pi,
            voice: e.voice || '1',
            noteId: e.id,
            message: `${sfFormatMidiNote(e.midi)} is ${dir} the practical ${range.label} range.`
          });
        }
      }

      // ----- Rule 4: rhythm_density_anomaly
      if (measures.length >= 3) {
        const curMeta = densityMeta[mi];
        const neighborCounts = [];
        for (let d = -2; d <= 2; d++) {
          if (d === 0) continue;
          const nj = mi + d;
          if (nj >= 0 && nj < measures.length) {
            neighborCounts.push(densityMeta[nj].count);
          }
        }
        if (neighborCounts.length >= 2) {
          const med = sfMedian(neighborCounts);
          const tooDense = med > 0 && curMeta.count >= 8 && curMeta.count >= 3 * med;
          const tooSparse = med >= 8 && curMeta.count > 0 && curMeta.count <= 0.25 * med &&
            !curMeta.isWholeBarRest && !curMeta.isWholeNoteCadence && !curMeta.isCleanPhraseEnding;

          if (tooDense || tooSparse) {
            const firstNote = curMeta.pitched[0] || null;
            addFinding(mi, {
              rule: 'rhythm_density_anomaly',
              severity: 'medium',
              weight: SF_FLAG_WEIGHTS.rhythm_density_anomaly,
              partIndex: pi,
              voice: (firstNote && firstNote.voice) || '1',
              noteId: firstNote ? firstNote.id : null,
              message: tooDense
                ? `Measure ${m.number} has ${curMeta.count} notes (much denser than nearby measures).`
                : `Measure ${m.number} has only ${curMeta.count} note(s) compared to dense nearby measures.`
            });
          }
        }
      }

      // ----- Rule 5: implausible_leap (> 24 semitones between consecutive non-chord notes in same part & voice)
      for (const e of entries) {
        if (e.isGrace) continue;
        const vid = e.voice || '1';
        if (e.kind === 'rest') {
          // A full-measure rest resets phrasing; short rests don't mask OMR octave glitches
          if (e.measureRest || (e.durationQ || 0) >= expectedQ - 0.01) {
            prevByVoice[vid] = null;
          }
          continue;
        }
        if (e.kind !== 'note' || e.isRest || e.isChord || e.spoken || !isFinite(e.midi)) continue;
        const prev = prevByVoice[vid];
        if (prev && isFinite(prev.midi)) {
          const leap = Math.abs(e.midi - prev.midi);
          if (leap > 24) {
            addFinding(mi, {
              rule: 'implausible_leap',
              severity: 'high',
              weight: SF_FLAG_WEIGHTS.implausible_leap,
              partIndex: pi,
              voice: vid,
              noteId: e.id,
              message: `Large jump of ${leap} semitones (${sfFormatMidiNote(prev.midi)} to ${sfFormatMidiNote(e.midi)}).`
            });
          }
        }
        prevByVoice[vid] = e;
      }
    }
  }

  let flaggedCount = 0;
  let confSum = 0;
  const measuresOut = perMeasure.map(bucket => {
    let penalty = 0;
    let hasHigh = false;
    for (const f of bucket.findings) {
      penalty += f.weight || 0.25;
      if (f.severity === 'high') hasHigh = true;
    }
    const confidence = Math.max(0, Math.round((1 - Math.min(1, penalty)) * 100) / 100);
    const flagged = bucket.findings.length > 0;
    const level = !flagged ? 'clean' : ((confidence <= 0.55 || hasHigh) ? 'high' : 'medium');
    if (flagged) flaggedCount++;
    confSum += confidence;
    return {
      measureIndex: bucket.measureIndex,
      measureNumber: bucket.measureNumber,
      confidence,
      level,
      flagged,
      findings: bucket.findings,
      noteIds: bucket.noteIds
    };
  });

  const overallConfidence = measuresOut.length
    ? Math.round((confSum / measuresOut.length) * 100) / 100
    : 1;

  return {
    measures: measuresOut,
    flaggedCount,
    overallConfidence
  };
}

// ---------- Verification Save Gate
function sfFindingsSignature(findings) {
  if (!findings || !findings.length) return '';
  return findings.map(f => `${f.rule}:${f.noteId || ''}:${f.message || ''}`).sort().join('|');
}

class SfSaveGate {
  constructor(flagReport) {
    this._records = new Map();
    const list = (flagReport && flagReport.measures) || [];
    for (const m of list) {
      this._records.set(m.measureIndex, {
        measureIndex: m.measureIndex,
        measureNumber: m.measureNumber || String(m.measureIndex + 1),
        flagged: !!m.flagged,
        currentlyFlagged: !!m.flagged,
        visited: false,
        status: m.flagged ? 'pending' : 'clean',
        confidence: typeof m.confidence === 'number' ? m.confidence : 1,
        level: m.level || (m.flagged ? 'medium' : 'clean'),
        findings: (m.findings || []).slice(),
        _sig: sfFindingsSignature(m.findings),
        visitedAt: null,
        resolvedAt: null
      });
    }
  }

  _ensure(measureIndex) {
    if (!this._records.has(measureIndex)) {
      this._records.set(measureIndex, {
        measureIndex,
        measureNumber: String(measureIndex + 1),
        flagged: false,
        currentlyFlagged: false,
        visited: false,
        status: 'clean',
        confidence: 1,
        level: 'clean',
        findings: [],
        _sig: '',
        visitedAt: null,
        resolvedAt: null
      });
    }
    return this._records.get(measureIndex);
  }

  visitMeasure(measureIndex) {
    const rec = this._ensure(measureIndex);
    rec.visited = true;
    if (!rec.visitedAt) rec.visitedAt = new Date().toISOString();
    return this.getMeasureState(measureIndex);
  }

  confirmMeasure(measureIndex) {
    const rec = this._ensure(measureIndex);
    const now = new Date().toISOString();
    rec.visited = true;
    if (!rec.visitedAt) rec.visitedAt = now;
    if (rec.flagged || rec.currentlyFlagged) {
      rec.status = 'confirmed';
      rec.resolvedAt = now;
    }
    return this.getMeasureState(measureIndex);
  }

  markFixed(measureIndex) {
    const rec = this._ensure(measureIndex);
    const now = new Date().toISOString();
    rec.visited = true;
    if (!rec.visitedAt) rec.visitedAt = now;
    rec.status = 'fixed';
    rec.resolvedAt = now;
    return this.getMeasureState(measureIndex);
  }

  syncFlags(newFlagReport, editedMeasureIndex) {
    const list = (newFlagReport && newFlagReport.measures) || [];
    const now = new Date().toISOString();

    for (const m of list) {
      const mi = m.measureIndex;
      const sig = sfFindingsSignature(m.findings);
      const existing = this._records.get(mi);

      if (!existing) {
        this._records.set(mi, {
          measureIndex: mi,
          measureNumber: m.measureNumber || String(mi + 1),
          flagged: !!m.flagged,
          currentlyFlagged: !!m.flagged,
          visited: mi === editedMeasureIndex,
          status: m.flagged ? 'pending' : 'clean',
          confidence: typeof m.confidence === 'number' ? m.confidence : 1,
          level: m.level || (m.flagged ? 'medium' : 'clean'),
          findings: (m.findings || []).slice(),
          _sig: sig,
          visitedAt: mi === editedMeasureIndex ? now : null,
          resolvedAt: null
        });
        continue;
      }

      const prevSig = existing._sig;
      const wasCurrentlyFlagged = existing.currentlyFlagged;
      existing.measureNumber = m.measureNumber || existing.measureNumber;
      existing.confidence = typeof m.confidence === 'number' ? m.confidence : 1;
      existing.level = m.level || (m.flagged ? 'medium' : 'clean');
      existing.findings = (m.findings || []).slice();
      existing._sig = sig;

      if (m.flagged) {
        if (!wasCurrentlyFlagged) {
          // Newly introduced flag on a previously clean or fixed measure -> re-block save!
          existing.flagged = true;
          existing.currentlyFlagged = true;
          existing.status = 'pending';
          existing.resolvedAt = null;
          if (mi !== editedMeasureIndex) {
            existing.visited = false;
            existing.visitedAt = null;
          }
        } else if (mi === editedMeasureIndex && sig !== prevSig) {
          // Edited measure still has new/different flags -> require fresh confirmation or fix
          existing.status = 'pending';
          existing.resolvedAt = null;
        }
      } else {
        existing.currentlyFlagged = false;
        if (wasCurrentlyFlagged) {
          if (mi === editedMeasureIndex || existing.visited) {
            existing.flagged = true;
            existing.visited = true;
            if (!existing.visitedAt) existing.visitedAt = now;
            existing.status = 'fixed';
            existing.resolvedAt = now;
          } else {
            // Cleared indirectly without visiting (e.g. neighbor density stabilized)
            existing.flagged = false;
            existing.status = 'clean';
            existing.resolvedAt = null;
          }
        }
      }
    }
  }

  getMeasureState(measureIndex) {
    const rec = this._records.get(measureIndex);
    if (!rec) return null;
    return {
      measureIndex: rec.measureIndex,
      measureNumber: rec.measureNumber,
      flagged: rec.flagged,
      currentlyFlagged: rec.currentlyFlagged,
      visited: rec.visited,
      status: rec.status,
      confidence: rec.confidence,
      level: rec.level,
      findings: rec.findings.slice(),
      visitedAt: rec.visitedAt,
      resolvedAt: rec.resolvedAt
    };
  }

  getUnresolvedMeasures() {
    const unresolved = [];
    for (const rec of this._records.values()) {
      if (!rec.flagged && !rec.currentlyFlagged) continue;
      const resolved = rec.visited && (rec.status === 'confirmed' || rec.status === 'fixed');
      if (!resolved) unresolved.push(rec.measureIndex);
    }
    unresolved.sort((a, b) => a - b);
    return unresolved;
  }

  canSave() {
    return this.getUnresolvedMeasures().length === 0;
  }

  exportLog() {
    const out = [];
    const sorted = [...this._records.values()].sort((a, b) => a.measureIndex - b.measureIndex);
    for (const rec of sorted) {
      if (!rec.flagged && !rec.currentlyFlagged) continue;
      out.push({
        measureIndex: rec.measureIndex,
        measureNumber: rec.measureNumber,
        flagged: true,
        currentlyFlagged: rec.currentlyFlagged,
        visited: rec.visited,
        status: rec.status,
        confidence: rec.confidence,
        level: rec.level,
        findings: rec.findings.slice(),
        visitedAt: rec.visitedAt,
        resolvedAt: rec.resolvedAt
      });
    }
    return out;
  }
}
