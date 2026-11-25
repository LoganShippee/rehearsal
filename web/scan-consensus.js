'use strict';
/* Rehearsal Scan & Fix — Cross-Part Consensus & Multi-Run OMR Comparison.
   Zero external dependencies: runs identically in browsers and macOS JavaScriptCore (jsc). */

const SF_CONSENSUS_NON_VOCAL_RE = /\b(piano|pno|keyboard|keys|organ|accomp|harp|guitar|reductio|reduction|bass\s*clarinet|bassoon|baritone\s*sax(?:ophone)?|trumpet|trombone|euphonium|tuba|flute|piccolo|oboe|clarinet|sax(?:ophone)?|horn|mallets|percussion|violin|viola|cello|contrabass|drum)\b/i;

function sfConsensusWeight(rule, fallback) {
  if (typeof SF_FLAG_WEIGHTS !== 'undefined' && SF_FLAG_WEIGHTS && SF_FLAG_WEIGHTS[rule] != null) {
    return SF_FLAG_WEIGHTS[rule];
  }
  return fallback;
}

function sfConsensusRuleEnabled(opts, rule) {
  if (!opts || !opts.rules) return true;
  if (Array.isArray(opts.rules)) return opts.rules.includes(rule);
  if (typeof opts.rules === 'object') return opts.rules[rule] !== false;
  return true;
}

function sfConsensusPartHasNote(part) {
  for (const m of (part && part.measures) || []) {
    for (const e of m.entries || []) {
      if (e.kind === 'note' && !e.isRest) return true;
    }
  }
  return false;
}

function sfConsensusConcertFifths(part, measure) {
  const raw = (measure && measure.key && isFinite(measure.key.fifths)) ? Number(measure.key.fifths) : 0;
  const tr = (measure && measure.activeTranspose) || (part && part.transpose);
  const chrom = (tr && isFinite(tr.chromatic)) ? Number(tr.chromatic) : 0;
  if (!chrom) return raw;
  // Transpose written key to concert key around the circle of fifths
  let f = (raw + chrom * 7) % 12;
  if (f > 6) f -= 12;
  if (f < -6) f += 12;
  return f;
}

function sfConsensusFirstNoteId(measure, voice) {
  for (const e of (measure && measure.entries) || []) {
    if (e.kind === 'note' && !e.isRest && (!voice || (e.voice || '1') === voice)) {
      return e.id || null;
    }
  }
  return null;
}

function sfConsensusNoteLyricText(entry) {
  if (!entry) return '';
  if (Array.isArray(entry.lyrics) && entry.lyrics.length) {
    const l0 = entry.lyrics.find(l => Number(l.number) === 1) || entry.lyrics[0];
    return l0 && l0.text ? String(l0.text) : '';
  }
  if (typeof sfGetNoteLyric === 'function') {
    return String(sfGetNoteLyric(entry, 1) || '');
  }
  return '';
}

function sfAnalyzeCrossPartConsensus(model, opts) {
  const options = opts || {};
  const parts = (model && model.parts) || [];
  const findings = [];

  const activeParts = [];
  for (let pi = 0; pi < parts.length; pi++) {
    if (sfConsensusPartHasNote(parts[pi])) {
      activeParts.push({ pi, part: parts[pi] });
    }
  }
  if (activeParts.length < 2) return { findings };

  // 1. Measure count mismatch across non-empty parts
  const lengths = activeParts.map(p => (p.part.measures || []).length);
  const minLen = Math.min.apply(null, lengths);
  const maxLen = Math.max.apply(null, lengths);

  if (minLen !== maxLen && sfConsensusRuleEnabled(options, 'cross_part_measure_count')) {
    const lenCounts = {};
    for (const l of lengths) lenCounts[l] = (lenCounts[l] || 0) + 1;
    let majorityLen = maxLen;
    let bestCount = -1;
    for (const k of Object.keys(lenCounts)) {
      if (lenCounts[k] > bestCount) {
        bestCount = lenCounts[k];
        majorityLen = Number(k);
      }
    }
    const miFlag = Math.max(0, minLen - 1);
    const mismatchParts = activeParts.filter(p => (p.part.measures || []).length !== majorityLen);
    const targets = mismatchParts.length ? mismatchParts : [activeParts[0]];
    for (const t of targets) {
      const len = (t.part.measures || []).length;
      const m = (t.part.measures || [])[Math.min(miFlag, Math.max(0, len - 1))];
      findings.push({
        measureIndex: miFlag,
        rule: 'cross_part_measure_count',
        severity: 'high',
        weight: sfConsensusWeight('cross_part_measure_count', 0.40),
        partIndex: t.pi,
        voice: '1',
        noteId: sfConsensusFirstNoteId(m, '1'),
        message: `${t.part.name || ('Part ' + (t.pi + 1))} has ${len} measures while other parts have ${majorityLen}.`
      });
    }
  }

  // 2. Per-measure key/time signature & homophonic rhythm/lyric checks
  for (let mi = 0; mi < maxLen; mi++) {
    const present = [];
    for (const ap of activeParts) {
      const m = (ap.part.measures || [])[mi];
      if (m) present.push({ pi: ap.pi, part: ap.part, measure: m });
    }
    if (present.length < 2) continue;

    // 2a. Time & Key signature disagreement
    if (sfConsensusRuleEnabled(options, 'cross_part_signature_mismatch')) {
      const timeEntries = present.filter(p => p.measure.time && p.measure.time.beats && p.measure.time.beatType);
      if (timeEntries.length >= 2) {
        const tCounts = {};
        for (const p of timeEntries) {
          const tk = `${p.measure.time.beats}/${p.measure.time.beatType}`;
          tCounts[tk] = (tCounts[tk] || 0) + 1;
        }
        const sortedT = Object.keys(tCounts).sort((a, b) => tCounts[b] - tCounts[a]);
        const majT = sortedT[0];
        if (sortedT.length > 1 && tCounts[majT] > timeEntries.length / 2) {
          for (const p of timeEntries) {
            const tk = `${p.measure.time.beats}/${p.measure.time.beatType}`;
            if (tk !== majT) {
              findings.push({
                measureIndex: mi,
                rule: 'cross_part_signature_mismatch',
                severity: 'high',
                weight: sfConsensusWeight('cross_part_signature_mismatch', 0.35),
                partIndex: p.pi,
                voice: '1',
                noteId: sfConsensusFirstNoteId(p.measure, '1'),
                message: `${p.part.name || ('Part ' + (p.pi + 1))} has time signature ${tk} while other parts are in ${majT}.`
              });
            }
          }
        }
      }

      const keyEntries = present.filter(p => p.measure.key && isFinite(p.measure.key.fifths));
      if (keyEntries.length >= 2) {
        const kCounts = {};
        for (const p of keyEntries) {
          const kf = String(sfConsensusConcertFifths(p.part, p.measure));
          kCounts[kf] = (kCounts[kf] || 0) + 1;
        }
        const sortedK = Object.keys(kCounts).sort((a, b) => kCounts[b] - kCounts[a]);
        const majK = sortedK[0];
        if (sortedK.length > 1 && kCounts[majK] > keyEntries.length / 2) {
          for (const p of keyEntries) {
            const kf = String(sfConsensusConcertFifths(p.part, p.measure));
            if (kf !== majK) {
              findings.push({
                measureIndex: mi,
                rule: 'cross_part_signature_mismatch',
                severity: 'high',
                weight: sfConsensusWeight('cross_part_signature_mismatch', 0.35),
                partIndex: p.pi,
                voice: '1',
                noteId: sfConsensusFirstNoteId(p.measure, '1'),
                message: `${p.part.name || ('Part ' + (p.pi + 1))} has concert key signature (${kf} fifths) while other parts have (${majK} fifths).`
              });
            }
          }
        }
      }
    }

    // 2b. Homophonic rhythm & lyric disagreement across vocal parts
    const vocalActive = [];
    for (const p of present) {
      if (SF_CONSENSUS_NON_VOCAL_RE.test(p.part.name || '')) continue;
      const v1Notes = [];
      for (const e of p.measure.entries || []) {
        if (e.isGrace || e.isChord) continue;
        if ((e.voice || '1') !== '1') continue;
        if (e.kind === 'note' && !e.isRest) v1Notes.push(e);
      }
      if (v1Notes.length < 2) continue; // exclude whole-measure rests and held single-note pedals
      const rhythmKey = v1Notes.map(e => String(Math.round((e.durationQ || 0) * 1000) / 1000)).join(',');
      const rawLyrics = v1Notes.map(e => sfConsensusNoteLyricText(e).toLowerCase().replace(/[^a-z0-9]/g, ''));
      const hasLyrics = rawLyrics.some(t => t.length > 0);
      const lyricKey = hasLyrics ? rawLyrics.join(' ') : null;
      vocalActive.push({ pi: p.pi, part: p.part, measure: p.measure, firstNote: v1Notes[0], rhythmKey, lyricKey });
    }

    if (vocalActive.length >= 3) {
      if (sfConsensusRuleEnabled(options, 'cross_part_rhythm_mismatch')) {
        const rCounts = {};
        for (const v of vocalActive) rCounts[v.rhythmKey] = (rCounts[v.rhythmKey] || 0) + 1;
        const sortedR = Object.keys(rCounts).sort((a, b) => rCounts[b] - rCounts[a]);
        const majR = sortedR[0];
        const majCount = rCounts[majR];
        if (majCount >= 2 && majCount / vocalActive.length >= 0.6 && majCount < vocalActive.length) {
          for (const v of vocalActive) {
            if (v.rhythmKey !== majR) {
              findings.push({
                measureIndex: mi,
                rule: 'cross_part_rhythm_mismatch',
                severity: 'medium',
                weight: sfConsensusWeight('cross_part_rhythm_mismatch', 0.25),
                partIndex: v.pi,
                voice: '1',
                noteId: v.firstNote ? v.firstNote.id : null,
                message: `${v.part.name || ('Part ' + (v.pi + 1))} rhythm differs from the other vocal parts in this measure.`
              });
            }
          }
        }
      }

      const lyricVocal = vocalActive.filter(v => v.lyricKey !== null);
      if (lyricVocal.length >= 3 && sfConsensusRuleEnabled(options, 'cross_part_lyric_mismatch')) {
        const lCounts = {};
        for (const v of lyricVocal) lCounts[v.lyricKey] = (lCounts[v.lyricKey] || 0) + 1;
        const sortedL = Object.keys(lCounts).sort((a, b) => lCounts[b] - lCounts[a]);
        const majL = sortedL[0];
        const majCount = lCounts[majL];
        if (majCount >= 2 && majCount / lyricVocal.length >= 0.6 && majCount < lyricVocal.length) {
          for (const v of lyricVocal) {
            if (v.lyricKey !== majL) {
              findings.push({
                measureIndex: mi,
                rule: 'cross_part_lyric_mismatch',
                severity: 'low',
                weight: sfConsensusWeight('cross_part_lyric_mismatch', 0.20),
                partIndex: v.pi,
                voice: '1',
                noteId: v.firstNote ? v.firstNote.id : null,
                message: `${v.part.name || ('Part ' + (v.pi + 1))} lyrics differ from the other vocal parts in this measure.`
              });
            }
          }
        }
      }
    }
  }

  return { findings };
}

function sfConsensusMeasureSignature(measure) {
  const sigParts = [];
  const readParts = [];
  for (const e of (measure && measure.entries) || []) {
    if (e.isGrace) continue;
    const dur = Math.round((e.durationQ || 0) * 1000) / 1000;
    if (e.kind === 'rest' || e.isRest) {
      sigParts.push(`R:${dur}`);
      readParts.push(`rest(${dur})`);
    } else if (e.kind === 'note') {
      const hasPitch = e.step && isFinite(e.octave);
      const alt = e.alter || 0;
      const pitchStr = hasPitch ? `${e.step}${alt}${e.octave}` : String(e.midi || '?');
      const altSym = alt === 1 ? '#' : (alt === -1 ? 'b' : '');
      const readPitch = hasPitch ? `${e.step}${altSym}${e.octave}` : String(e.midi || '?');
      sigParts.push(`${pitchStr}:${dur}`);
      readParts.push(`${readPitch}(${dur})`);
    }
  }
  return { sig: sigParts.join('|'), readable: readParts.join(', ') || 'empty' };
}

function sfCompareOcrRuns(models, opts) {
  const runs = Array.isArray(models) ? models.filter(Boolean) : [];
  if (runs.length < 2) {
    return {
      findings: [],
      summary: { runCount: runs.length, differingMeasures: 0, measureCountMismatch: false }
    };
  }

  const findings = [];
  let measureCountMismatch = false;
  const differingSet = new Set();

  const primary = runs[0];
  const runPartCounts = runs.map(m => {
    const ps = m.parts || [];
    return ps.reduce((mx, p) => Math.max(mx, (p.measures || []).length), 0);
  });
  const minRunMeasures = Math.min.apply(null, runPartCounts);
  const maxRunMeasures = Math.max.apply(null, runPartCounts);

  if (minRunMeasures !== maxRunMeasures) {
    measureCountMismatch = true;
    const miFlag = Math.max(0, minRunMeasures - 1);
    const countsDesc = runPartCounts.map((c, idx) => `Run ${idx + 1}: ${c}`).join(', ');
    const m0 = primary.parts && primary.parts[0] && primary.parts[0].measures && primary.parts[0].measures[miFlag];
    findings.push({
      measureIndex: miFlag,
      rule: 'multi_run_measure_count',
      severity: 'high',
      weight: sfConsensusWeight('multi_run_measure_count', 0.45),
      partIndex: 0,
      voice: '1',
      noteId: sfConsensusFirstNoteId(m0, '1'),
      message: `Multiple scan runs disagree on measure count (${countsDesc}).`
    });
  }

  const numParts = Math.min.apply(null, runs.map(r => (r.parts || []).length));
  for (let pi = 0; pi < numParts; pi++) {
    const partLens = runs.map(r => ((r.parts[pi] && r.parts[pi].measures) || []).length);
    const minPM = Math.min.apply(null, partLens);
    for (let mi = 0; mi < minPM; mi++) {
      const sigs = runs.map(r => sfConsensusMeasureSignature(r.parts[pi].measures[mi]));
      const uniqueSigs = new Set(sigs.map(s => s.sig));
      if (uniqueSigs.size <= 1) continue;

      differingSet.add(`${pi}:${mi}`);
      const counts = {};
      const readableBySig = {};
      for (const s of sigs) {
        counts[s.sig] = (counts[s.sig] || 0) + 1;
        if (!readableBySig[s.sig]) readableBySig[s.sig] = s.readable;
      }
      const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const majSig = sorted[0];
      const majCount = counts[majSig];
      const primarySig = sigs[0].sig;

      let suggestion;
      if (majCount >= 2) {
        suggestion = `Most scans read: ${readableBySig[majSig]}`;
      } else {
        const alt = sigs.slice(1).find(s => s.sig !== primarySig) || sigs[1];
        suggestion = `Alternate scan read: ${alt.readable}`;
      }

      const pm = primary.parts[pi].measures[mi];
      findings.push({
        measureIndex: mi,
        rule: 'multi_run_disagreement',
        severity: 'medium',
        weight: sfConsensusWeight('multi_run_disagreement', 0.30),
        partIndex: pi,
        voice: '1',
        noteId: sfConsensusFirstNoteId(pm, '1'),
        suggestion,
        message: `Scan runs disagree on measure ${(pm && pm.number) || (mi + 1)}. ${suggestion}.`
      });
    }
  }

  return {
    findings,
    summary: {
      runCount: runs.length,
      differingMeasures: differingSet.size,
      measureCountMismatch
    }
  };
}

if (typeof window !== 'undefined') {
  window.sfAnalyzeCrossPartConsensus = sfAnalyzeCrossPartConsensus;
  window.sfCompareOcrRuns = sfCompareOcrRuns;
}
