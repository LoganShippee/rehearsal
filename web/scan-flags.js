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
  rhythm_density_anomaly: 0.25,
  tenor_octave_clef: 0.45,
  vocal_leap: 0.30,
  vocal_leap_check: 0.15,
  lyric_missing_syllable: 0.20,
  lyric_broken_hyphen: 0.25,
  lyric_unknown_word: 0.18,
  voice_crossing: 0.30,
  cross_part_measure_count: 0.40,
  cross_part_signature_mismatch: 0.35,
  cross_part_rhythm_mismatch: 0.25,
  cross_part_lyric_mismatch: 0.20,
  multi_run_measure_count: 0.45,
  multi_run_disagreement: 0.30
};

// ---------- Choir Voice Ranges & Modular Choir Rules
const SF_CHOIR_RANGES = {
  soprano: { min: 60, max: 81, label: 'Soprano' }, // C4-A5
  alto:    { min: 55, max: 74, label: 'Alto' },    // G3-D5
  tenor:   { min: 48, max: 67, label: 'Tenor' },   // C3-G4 (sounding)
  bass:    { min: 40, max: 62, label: 'Bass' }     // E2-D4
};

const SF_NON_CHOIR_PART_RE = /\b(bass\s*clarinet|bassoon|baritone\s*sax(?:ophone)?|piano|pno|keyboard|keys|organ|accomp|harp|guitar|reductio|reduction|trumpet|trombone|euphonium|tuba|flute|piccolo|oboe|clarinet|sax(?:ophone)?|horn|mallets|percussion|violin|viola|cello|contrabass|drum)\b/i;

function sfGetChoirVoiceRange(voiceKey) {
  return SF_CHOIR_RANGES[voiceKey] || null;
}

function sfDetectChoirPart(partName, measure0) {
  const name = String(partName || '').trim();
  if (!name) return null;
  if (SF_NON_CHOIR_PART_RE.test(name)) return null;

  // Shared staves first
  if (/\b(?:s\s*[/&+,-]?\s*a|sop(?:rano)?\s*[/&+,-]?\s*alt(?:o)?|women|female|treble\s*choir)\b/i.test(name)) {
    return 'soprano_alto';
  }
  if (/\b(?:t\s*[/&+,-]?\s*b|ten(?:or)?\s*[/&+,-]?\s*bas(?:s)?|men|male)\b/i.test(name)) {
    return 'tenor_bass';
  }

  // Single voice parts
  if (/^(?:s|sop\.?|sopr\.?|sopran|soprano)(?:\s*\d+)?$/i.test(name) || /\bsop(?:rano|ran|r)?\b/i.test(name)) {
    return 'soprano';
  }
  if (/^(?:a|alt\.?|alto)(?:\s*\d+)?$/i.test(name) || /\b(?:alto|alt\.?)\b/i.test(name)) {
    return 'alto';
  }
  if (/^(?:t|ten\.?|tenor|tenore)(?:\s*\d+)?$/i.test(name) || /\b(?:tenore|tenor|ten\.?)\b/i.test(name)) {
    return 'tenor';
  }
  if (/^(?:b|bas\.?|basso|bass|bar\.?|baritone)(?:\s*\d+)?$/i.test(name) || /\b(?:basso|bass|baritone)\b/i.test(name)) {
    return 'bass';
  }
  if (/\b(?:voice|vocal|choir|choral|sing(?:er|ers)?|cantus|chorus)\b/i.test(name)) {
    return 'voice_generic';
  }
  return null;
}

function sfRuleTenorOctaveClef(part, pi, choirKey, addFinding) {
  if (choirKey !== 'tenor') return false;
  const clefs0 = (part && part.measures && part.measures[0] && part.measures[0].clefs) || [];
  if (clefs0.some(c => c.sign === 'G' && c.octaveChange === -1)) return false;
  const pitched = [];
  for (const m of (part && part.measures) || []) {
    for (const e of m.entries || []) {
      if (e.kind === 'note' && !e.isRest && !e.isCue && !e.spoken && isFinite(e.midi)) {
        pitched.push(e);
      }
    }
  }
  if (pitched.length < 5) return false;
  let highCount = 0;
  for (const e of pitched) {
    const sMidi = (e.soundingMidi != null && isFinite(e.soundingMidi)) ? e.soundingMidi : e.midi;
    if (sMidi > 67 && sMidi <= 81) highCount++;
  }
  if (highCount / pitched.length >= 0.65) {
    addFinding(0, {
      rule: 'tenor_octave_clef',
      severity: 'high',
      weight: SF_FLAG_WEIGHTS.tenor_octave_clef,
      partIndex: pi,
      voice: '1',
      noteId: pitched[0].id,
      partLevel: true,
      suggestedFix: 'octave_down_part',
      message: 'Tenor part looks an octave too high — shift the whole part down an octave.'
    });
    return true;
  }
  return false;
}

function sfRuleChoirVoiceRange(part, pi, choirKey, addFinding) {
  const measures = (part && part.measures) || [];
  let effectiveKey = choirKey;
  if (effectiveKey === 'bass') {
    const voiceIds = new Set();
    let hasSimultaneous = false;
    for (const m of measures) {
      const onsetCounts = {};
      for (const e of m.entries || []) {
        if (e.kind !== 'note' || e.isRest || e.isCue || e.spoken || !isFinite(e.midi)) continue;
        voiceIds.add(e.voice || '1');
        const ok = Math.round((e.onsetQ || 0) * 1000);
        onsetCounts[ok] = (onsetCounts[ok] || 0) + 1;
        if (onsetCounts[ok] > 1) hasSimultaneous = true;
      }
    }
    if (voiceIds.size > 1 || hasSimultaneous) {
      effectiveKey = 'tenor_bass';
    }
  }
  if (effectiveKey === 'soprano_alto' || effectiveKey === 'tenor_bass') {
    const upperKey = effectiveKey === 'soprano_alto' ? 'soprano' : 'tenor';
    const lowerKey = effectiveKey === 'soprano_alto' ? 'alto' : 'bass';
    const upperRange = SF_CHOIR_RANGES[upperKey];
    const lowerRange = SF_CHOIR_RANGES[lowerKey];

    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      const byOnset = {};
      for (const e of m.entries || []) {
        if (e.kind !== 'note' || e.isRest || e.isCue || e.spoken || !isFinite(e.midi)) continue;
        const ok = Math.round((e.onsetQ || 0) * 1000);
        (byOnset[ok] || (byOnset[ok] = [])).push(e);
      }
      for (const ok of Object.keys(byOnset)) {
        const group = byOnset[ok].slice().sort((a, b) => {
          const ma = (a.soundingMidi != null ? a.soundingMidi : a.midi);
          const mb = (b.soundingMidi != null ? b.soundingMidi : b.midi);
          return ma - mb;
        });
        if (group.length === 1) {
          const e = group[0];
          const sMidi = e.soundingMidi != null ? e.soundingMidi : e.midi;
          if (sMidi < lowerRange.min || sMidi > upperRange.max) {
            const dir = sMidi < lowerRange.min ? 'below' : 'above';
            addFinding(mi, {
              rule: 'out_of_range',
              severity: 'high',
              weight: SF_FLAG_WEIGHTS.out_of_range,
              partIndex: pi,
              voice: e.voice || '1',
              noteId: e.id,
              message: `${sfFormatMidiNote(sMidi)} is ${dir} the ${upperRange.label}/${lowerRange.label} range.`
            });
          }
        } else {
          const lo = group[0];
          const hi = group[group.length - 1];
          const loMidi = lo.soundingMidi != null ? lo.soundingMidi : lo.midi;
          const hiMidi = hi.soundingMidi != null ? hi.soundingMidi : hi.midi;
          if (loMidi < lowerRange.min || loMidi > lowerRange.max) {
            const dir = loMidi < lowerRange.min ? 'below' : 'above';
            addFinding(mi, {
              rule: 'out_of_range',
              severity: 'high',
              weight: SF_FLAG_WEIGHTS.out_of_range,
              partIndex: pi,
              voice: lo.voice || '1',
              noteId: lo.id,
              message: `${sfFormatMidiNote(loMidi)} is ${dir} the practical ${lowerRange.label} range.`
            });
          }
          if (hiMidi < upperRange.min || hiMidi > upperRange.max) {
            const dir = hiMidi < upperRange.min ? 'below' : 'above';
            addFinding(mi, {
              rule: 'out_of_range',
              severity: 'high',
              weight: SF_FLAG_WEIGHTS.out_of_range,
              partIndex: pi,
              voice: hi.voice || '1',
              noteId: hi.id,
              message: `${sfFormatMidiNote(hiMidi)} is ${dir} the practical ${upperRange.label} range.`
            });
          }
        }
      }
    }
    return;
  }

  const range = sfGetChoirVoiceRange(effectiveKey);
  if (!range) return;
  for (let mi = 0; mi < measures.length; mi++) {
    for (const e of measures[mi].entries || []) {
      if (e.kind !== 'note' || e.isRest || e.isCue || e.spoken || !isFinite(e.midi)) continue;
      const sMidi = e.soundingMidi != null ? e.soundingMidi : e.midi;
      if (sMidi < range.min || sMidi > range.max) {
        const dir = sMidi < range.min ? 'below' : 'above';
        addFinding(mi, {
          rule: 'out_of_range',
          severity: 'high',
          weight: SF_FLAG_WEIGHTS.out_of_range,
          partIndex: pi,
          voice: e.voice || '1',
          noteId: e.id,
          message: `${sfFormatMidiNote(sMidi)} is ${dir} the practical ${range.label} range.`
        });
      }
    }
  }
}

function sfRuleVocalLeaps(part, pi, addFinding) {
  const measures = (part && part.measures) || [];
  const prevByStaffVoice = {};
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];
    const beats = (m.time && m.time.beats) || 4;
    const bt = (m.time && m.time.beatType) || 4;
    const expectedQ = beats * 4 / bt;
    for (const e of m.entries || []) {
      if (e.isGrace) continue;
      const key = `${e.staff || 1}:${e.voice || '1'}`;
      if (e.kind === 'rest') {
        if (e.measureRest || (e.durationQ || 0) >= expectedQ - 0.01) {
          prevByStaffVoice[key] = null;
        }
        continue;
      }
      if (e.kind !== 'note' || e.isRest || e.isChord || e.spoken || !isFinite(e.midi)) continue;
      const prev = prevByStaffVoice[key];
      if (prev && isFinite(prev.midi)) {
        const leap = Math.abs(e.midi - prev.midi);
        if (leap > 12) {
          addFinding(mi, {
            rule: 'vocal_leap',
            severity: 'high',
            weight: SF_FLAG_WEIGHTS.vocal_leap,
            partIndex: pi,
            voice: e.voice || '1',
            noteId: e.id,
            message: `Large vocal jump (${leap} semitones, ${sfFormatMidiNote(prev.midi)} to ${sfFormatMidiNote(e.midi)}).`
          });
        } else if (leap === 6 || leap === 10 || leap === 11) {
          addFinding(mi, {
            rule: 'vocal_leap_check',
            severity: 'low',
            weight: SF_FLAG_WEIGHTS.vocal_leap_check,
            partIndex: pi,
            voice: e.voice || '1',
            noteId: e.id,
            message: `Check this leap (${sfFormatMidiNote(prev.midi)} to ${sfFormatMidiNote(e.midi)}).`
          });
        }
      }
      prevByStaffVoice[key] = e;
    }
  }
}

function sfExtractEntryPrimaryLyric(e) {
  if (Array.isArray(e.lyrics) && e.lyrics.length) {
    return e.lyrics[0];
  }
  if (typeof sfGetNoteLyric === 'function') {
    const txt = sfGetNoteLyric(e, 1);
    if (txt) {
      const hasDash = txt.endsWith('-');
      return { text: hasDash ? txt.slice(0, -1) : txt, syllabic: hasDash ? 'begin' : 'single', extend: false };
    }
  }
  return null;
}

function sfRuleLyricChecks(part, pi, addFinding, opts) {
  const options = opts || {};
  const checkMissing = options.checkMissing !== false;
  const checkBrokenHyphen = options.checkBrokenHyphen !== false;
  const checkUnknownWord = options.checkUnknownWord !== false;

  const measures = (part && part.measures) || [];
  // Choose primary vocal voice (prefer '1', else first voice with lyrics)
  let primaryVoice = '1';
  let hasV1Lyrics = false;
  let firstLyricVoice = null;
  for (const m of measures) {
    for (const e of m.entries || []) {
      if (e.kind === 'note' && !e.isRest && sfExtractEntryPrimaryLyric(e)) {
        const v = e.voice || '1';
        if (v === '1') hasV1Lyrics = true;
        if (!firstLyricVoice) firstLyricVoice = v;
      }
    }
  }
  if (!hasV1Lyrics && firstLyricVoice) primaryVoice = firstLyricVoice;
  if (!hasV1Lyrics && !firstLyricVoice) return;

  // Flatten timeline across voices per (measure, staff, onset) so shared staves
  // where lyrics alternate between voice 1 and voice 2 merge cleanly.
  const seq = [];
  for (let mi = 0; mi < measures.length; mi++) {
    const byStaff = {};
    for (const e of measures[mi].entries || []) {
      if ((e.kind !== 'note' && e.kind !== 'rest') || e.isGrace || e.isChord) continue;
      const st = e.staff || 1;
      (byStaff[st] || (byStaff[st] = [])).push(e);
    }
    const staffKeys = Object.keys(byStaff).sort((a, b) => Number(a) - Number(b));
    for (const st of staffKeys) {
      const byOnset = {};
      for (const e of byStaff[st]) {
        const ok = Math.round((e.onsetQ || 0) * 1000);
        (byOnset[ok] || (byOnset[ok] = [])).push(e);
      }
      const onsetKeys = Object.keys(byOnset).sort((a, b) => Number(a) - Number(b));
      for (const ok of onsetKeys) {
        const group = byOnset[ok];
        const pitched = group.filter(e => e.kind === 'note' && !e.isRest);
        if (pitched.length > 0) {
          const withLyric = pitched.filter(e => !!sfExtractEntryPrimaryLyric(e));
          const pool = withLyric.length > 0 ? withLyric : pitched;
          pool.sort((a, b) => {
            const va = a.voice || '1';
            const vb = b.voice || '1';
            if (va === primaryVoice && vb !== primaryVoice) return -1;
            if (vb === primaryVoice && va !== primaryVoice) return 1;
            return Number(va) - Number(vb);
          });
          seq.push({ mi, e: pool[0] });
        } else {
          // Only rests at this onset: include if primaryVoice (or any voice) has a >=1 beat or measureRest
          const rest = group.find(e => (e.voice || '1') === primaryVoice) || group[0];
          if (rest) seq.push({ mi, e: rest });
        }
      }
    }
  }

  let openHyphen = null;
  let inSlur = false;
  let prevHadExtend = false;
  let sawTextInPhrase = false;

  for (let i = 0; i < seq.length; i++) {
    const { mi, e } = seq[i];
    if (e.kind === 'rest' || e.isRest) {
      if ((e.durationQ || 0) >= 1 - 1e-6 || e.measureRest) {
        if (openHyphen && checkBrokenHyphen) {
          addFinding(openHyphen.mi, {
            rule: 'lyric_broken_hyphen',
            severity: 'medium',
            weight: SF_FLAG_WEIGHTS.lyric_broken_hyphen,
            partIndex: pi,
            voice: primaryVoice,
            noteId: openHyphen.e.id,
            message: `Hyphenated syllable "${openHyphen.textParts.join('')}-" is never finished before the rest.`
          });
        }
        openHyphen = null;
        sawTextInPhrase = false;
        prevHadExtend = false;
        inSlur = false;
      }
      continue;
    }

    const extra = e.extraXml || '';
    const slurStarts = /<slur\b[^>]*type=["']start["']/.test(extra);
    const slurStops = /<slur\b[^>]*type=["']stop["']/.test(extra);
    const wasInSlur = inSlur || slurStarts;

    const lyr = sfExtractEntryPrimaryLyric(e);
    if (lyr && lyr.text) {
      const syl = lyr.syllabic || 'single';
      const txt = lyr.text.trim();
      sawTextInPhrase = true;

      if (syl === 'begin') {
        if (openHyphen && checkBrokenHyphen) {
          addFinding(openHyphen.mi, {
            rule: 'lyric_broken_hyphen',
            severity: 'medium',
            weight: SF_FLAG_WEIGHTS.lyric_broken_hyphen,
            partIndex: pi,
            voice: primaryVoice,
            noteId: openHyphen.e.id,
            message: `Hyphenated syllable "${openHyphen.textParts.join('')}-" was not finished.`
          });
        }
        openHyphen = { mi, e, textParts: [txt] };
      } else if (syl === 'middle') {
        if (openHyphen) openHyphen.textParts.push(txt);
        else openHyphen = { mi, e, textParts: [txt] };
      } else if (syl === 'end') {
        const fullWord = openHyphen ? (openHyphen.textParts.join('') + txt) : txt;
        openHyphen = null;
        const lettersOnly = fullWord.replace(/[^a-zA-Zäöüßéèêàâîïôûùç]/g, '');
        if (checkUnknownWord && lettersOnly.length >= 3 && typeof sfIsKnownChoirWord === 'function' && !sfIsKnownChoirWord(fullWord)) {
          addFinding(mi, {
            rule: 'lyric_unknown_word',
            severity: 'low',
            weight: SF_FLAG_WEIGHTS.lyric_unknown_word,
            partIndex: pi,
            voice: primaryVoice,
            noteId: e.id,
            message: `Check lyric word "${fullWord}" (possible OCR typo).`
          });
        }
      } else {
        if (openHyphen && checkBrokenHyphen) {
          addFinding(openHyphen.mi, {
            rule: 'lyric_broken_hyphen',
            severity: 'medium',
            weight: SF_FLAG_WEIGHTS.lyric_broken_hyphen,
            partIndex: pi,
            voice: primaryVoice,
            noteId: openHyphen.e.id,
            message: `Hyphenated syllable "${openHyphen.textParts.join('')}-" was not finished.`
          });
          openHyphen = null;
        }
        const lettersOnly = txt.replace(/[^a-zA-Zäöüßéèêàâîïôûùç]/g, '');
        if (checkUnknownWord && lettersOnly.length >= 3 && typeof sfIsKnownChoirWord === 'function' && !sfIsKnownChoirWord(txt)) {
          addFinding(mi, {
            rule: 'lyric_unknown_word',
            severity: 'low',
            weight: SF_FLAG_WEIGHTS.lyric_unknown_word,
            partIndex: pi,
            voice: primaryVoice,
            noteId: e.id,
            message: `Check lyric word "${txt}" (possible OCR typo).`
          });
        }
      }
      prevHadExtend = !!lyr.extend;
    } else {
      // Untexted pitched note
      const isTiedStop = Array.isArray(e.ties) && e.ties.includes('stop');
      if (checkMissing && sawTextInPhrase && !isTiedStop && !wasInSlur && !prevHadExtend) {
        // Check if another texted note follows in the same phrase before a rest >= 1 beat
        let hasLaterTextInPhrase = false;
        for (let k = i + 1; k < seq.length; k++) {
          const ne = seq[k].e;
          if (ne.kind === 'rest' || ne.isRest) {
            if ((ne.durationQ || 0) >= 1 - 1e-6 || ne.measureRest) break;
            continue;
          }
          if (sfExtractEntryPrimaryLyric(ne)) { hasLaterTextInPhrase = true; break; }
        }
        if (openHyphen || hasLaterTextInPhrase) {
          addFinding(mi, {
            rule: 'lyric_missing_syllable',
            severity: 'medium',
            weight: SF_FLAG_WEIGHTS.lyric_missing_syllable,
            partIndex: pi,
            voice: primaryVoice,
            noteId: e.id,
            message: 'Missing lyric syllable on note inside texted phrase.'
          });
        }
      }
      if (!isTiedStop && !wasInSlur) prevHadExtend = false;
    }

    if (slurStarts && !slurStops) inSlur = true;
    if (slurStops) inSlur = false;
  }

  if (openHyphen && checkBrokenHyphen) {
    addFinding(openHyphen.mi, {
      rule: 'lyric_broken_hyphen',
      severity: 'medium',
      weight: SF_FLAG_WEIGHTS.lyric_broken_hyphen,
      partIndex: pi,
      voice: primaryVoice,
      noteId: openHyphen.e.id,
      message: `Hyphenated syllable "${openHyphen.textParts.join('')}-" is never finished.`
    });
  }
}

function sfRuleVoiceCrossing(part, pi, choirKey, addFinding) {
  if (choirKey !== 'soprano_alto' && choirKey !== 'tenor_bass') return;
  const measures = (part && part.measures) || [];
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];
    const byOnset = {};
    for (const e of m.entries || []) {
      if (e.kind !== 'note' || e.isRest || e.spoken || !isFinite(e.midi)) continue;
      const ok = Math.round((e.onsetQ || 0) * 1000);
      (byOnset[ok] || (byOnset[ok] = [])).push(e);
    }

    let crossAttacks = 0;
    let crossBeats = 0;
    let wideSpread = false;
    let firstCrossingNote = null;

    for (const ok of Object.keys(byOnset)) {
      const group = byOnset[ok];
      const byVoice = {};
      for (const e of group) {
        const v = e.voice || '1';
        if (!byVoice[v]) byVoice[v] = e;
      }
      const vKeys = Object.keys(byVoice).sort((a, b) => Number(a) - Number(b));
      if (vKeys.length < 2) continue;
      const upper = byVoice[vKeys[0]];
      const lower = byVoice[vKeys[1]];
      if (upper.midi < lower.midi) {
        crossAttacks++;
        crossBeats += Math.min(upper.durationQ || 0, lower.durationQ || 0);
        if (!firstCrossingNote) firstCrossingNote = upper;
      }
      if (Math.abs(upper.midi - lower.midi) > 12) {
        wideSpread = true;
        if (!firstCrossingNote) firstCrossingNote = upper;
      }
    }

    if (crossAttacks >= 3 || crossBeats >= 2 - 1e-6 || wideSpread) {
      addFinding(mi, {
        rule: 'voice_crossing',
        severity: 'high',
        weight: SF_FLAG_WEIGHTS.voice_crossing,
        partIndex: pi,
        voice: (firstCrossingNote && firstCrossingNote.voice) || '1',
        noteId: firstCrossingNote ? firstCrossingNote.id : null,
        message: 'Voices cross or drift over an octave apart on this shared staff — check part assignment.'
      });
    }
  }
}

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

  const isRuleEnabled = ruleName => {
    if (!options.rules) return true;
    if (Array.isArray(options.rules)) return options.rules.includes(ruleName);
    if (typeof options.rules === 'object') return options.rules[ruleName] !== false;
    return true;
  };

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const measures = part.measures || [];
    const instKey = (options.instrument && options.instrument !== 'auto' && SF_INSTRUMENT_RANGES[options.instrument])
      ? options.instrument
      : sfDetectInstrument(part.name);
    const choirKey = (!options.instrument || options.instrument === 'auto')
      ? sfDetectChoirPart(part.name, measures[0])
      : null;

    let suppressNoteRangeForTenor = false;
    if (choirKey && isRuleEnabled('tenor_octave_clef')) {
      suppressNoteRangeForTenor = sfRuleTenorOctaveClef(part, pi, choirKey, addFinding);
    }
    if (choirKey && !suppressNoteRangeForTenor && isRuleEnabled('out_of_range')) {
      sfRuleChoirVoiceRange(part, pi, choirKey, addFinding);
    }
    const leapCheckOn = Array.isArray(options.rules)
      ? options.rules.includes('vocal_leap_check')
      : !!(options.rules && typeof options.rules === 'object' && options.rules.vocal_leap_check === true);
    if (choirKey && (isRuleEnabled('vocal_leap') || leapCheckOn)) {
      sfRuleVocalLeaps(part, pi, (mi, f) => {
        if (f.rule === 'vocal_leap_check' ? leapCheckOn : isRuleEnabled(f.rule)) addFinding(mi, f);
      });
    }
    if (choirKey && (isRuleEnabled('lyric_missing_syllable') || isRuleEnabled('lyric_broken_hyphen') || isRuleEnabled('lyric_unknown_word'))) {
      sfRuleLyricChecks(part, pi, addFinding, {
        checkMissing: isRuleEnabled('lyric_missing_syllable'),
        checkBrokenHyphen: isRuleEnabled('lyric_broken_hyphen'),
        checkUnknownWord: isRuleEnabled('lyric_unknown_word')
      });
    }
    if (choirKey && isRuleEnabled('voice_crossing')) {
      sfRuleVoiceCrossing(part, pi, choirKey, addFinding);
    }

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
          if (isRuleEnabled('duration_mismatch')) {
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
      }

      // ----- Rule 2: accidental_anomaly (only double accidentals or written accidental contradicting pitch <alter>)
      const accToAlter = {
        sharp: 1,
        flat: -1,
        natural: 0,
        'double-sharp': 2,
        'flat-flat': -2,
        'double-flat': -2
      };
      for (const e of entries) {
        if (e.kind !== 'note' || e.isRest || e.spoken || !e.step || !isFinite(e.octave)) continue;
        if (!e.accidental) continue;
        const curAlt = Number(e.alter) || 0;
        const expectedAlt = Object.prototype.hasOwnProperty.call(accToAlter, e.accidental)
          ? accToAlter[e.accidental]
          : null;
        let reason = null;
        if (Math.abs(curAlt) >= 2 || e.accidental === 'double-sharp' || e.accidental === 'flat-flat' || e.accidental === 'double-flat') {
          reason = `Unusual double accidental (${e.accidental}) on ${e.step}${e.octave}.`;
        } else if (expectedAlt !== null && curAlt !== expectedAlt) {
          reason = `Accidental (${e.accidental}) disagrees with pitch alteration on ${e.step}${e.octave}.`;
        }
        if (reason && isRuleEnabled('accidental_anomaly')) {
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
      }

      // ----- Rule 3: out_of_range (skip if handled by choir voice range / tenor octave clef)
      if (!choirKey && isRuleEnabled('out_of_range')) {
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

          if ((tooDense || tooSparse) && isRuleEnabled('rhythm_density_anomaly')) {
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
          if (leap > 24 && isRuleEnabled('implausible_leap')) {
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

  if (typeof sfAnalyzeCrossPartConsensus === 'function') {
    const crossReport = sfAnalyzeCrossPartConsensus(model, options);
    for (const f of (crossReport && crossReport.findings) || []) {
      addFinding(f.measureIndex, f);
    }
  }
  if (options.alternateModels && options.alternateModels.length && typeof sfCompareOcrRuns === 'function') {
    const runReport = sfCompareOcrRuns([model].concat(options.alternateModels), options);
    for (const f of (runReport && runReport.findings) || []) {
      addFinding(f.measureIndex, f);
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
