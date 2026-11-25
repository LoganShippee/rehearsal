'use strict';
// Automated tests for Rehearsal Scan & Fix score model, flags, tap mapper, history, and save gate.
// Runs under macOS JavaScriptCore with zero external dependencies:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/scan-test.js

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    print(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-6);
}

function tryRead(path) {
  try { return readFile(path); } catch (e) { return null; }
}

print('==== scan-test');

// 1. Syntax-check Scan & Fix scripts
const requiredScripts = ['web/scan-model.js', 'web/scan-flags.js'];
const optionalScripts = ['web/scan-client.js', 'web/scan-ui.js'];

for (const f of requiredScripts) {
  const src = tryRead(f);
  check(`required script exists: ${f}`, src !== null);
  if (src !== null) {
    try {
      new Function(src);
      check(`syntax ok: ${f}`, true);
    } catch (e) {
      check(`syntax ok: ${f}`, false, String(e));
    }
  }
}

for (const f of optionalScripts) {
  const src = tryRead(f);
  if (src !== null) {
    try {
      new Function(src);
      check(`syntax ok: ${f}`, true);
    } catch (e) {
      check(`syntax ok: ${f}`, false, String(e));
    }
  }
}

// Load scan-model.js and scan-flags.js into global scope
load('web/scan-model.js');
load('web/scan-flags.js');

// Verify required global API exports
const requiredGlobals = [
  'sfParseMusicXml', 'sfUnzipMxlSync', 'sfParseMxl', 'sfParseScoreInput',
  'sfExportMusicXml', 'sfExportMxl', 'sfModelToPlaybackScore', 'sfFindEntry',
  'sfEditPitchDiatonic', 'sfEditPitchSemitone', 'sfEditDuration', 'sfToggleDot',
  'sfDeleteOrMakeRest', 'sfToggleAccidental', 'sfCanTieNext', 'sfToggleTie', 'sfRemoveTie',
  'sfRestToNote', 'sfSetPitchLetter', 'sfEditPitchOctave', 'sfRespellEnharmonic', 'sfInsertAfter',
  'sfGetNoteLyric', 'sfSetNoteLyric', 'sfAddDirectionText', 'sfGetDirectionText', 'sfEditDirectionText',
  'sfRemoveEntry', 'sfGetAdjacentEntryId',
  'sfNormalizeMusicalMarkings', 'sfClearPartMeasure', 'sfToggleSpoken',
  'sfPartNameAliasMatch', 'sfMergeParts', 'sfMergeSplitParts',
  'sfCopyMeasures', 'sfPasteMeasures',
  'sfStaffStepToPitch', 'sfPlaceNoteAt', 'sfStackChordNote',
  'sfCleanOcrLyrics', 'sfAlignPartSignatures', 'sfSuggestRhythmFixes', 'sfApplyRhythmFix',
  'sfFilterScoreByMode', 'sfGetHeaderTexts', 'sfRemoveHeaderText', 'sfClearHeaderCredits',
  'sfGetEffectiveTimeSig', 'sfSetMeasureTimeSig', 'sfRemoveMeasureTimeSig', 'sfSuggestTimeSigChanges', 'sfAutoInferTimeSigChanges',
  'sfGetMeasureTempo', 'sfSetMeasureTempo', 'sfRemoveMeasureTempo',
  'sfGetEffectiveKeySig', 'sfSetMeasureKeySig', 'sfRemoveMeasureKeySig',
  'sfCloneModel', 'SfHistory', 'sfBuildTapMap',
  'SF_INSTRUMENT_RANGES', 'sfDetectInstrument', 'sfAnalyzeFlags', 'SfSaveGate'
];
for (const g of requiredGlobals) {
  let exists = false;
  try { exists = eval('typeof ' + g) !== 'undefined'; } catch (e) { exists = false; }
  check(`global exported: ${g}`, exists);
}

// Helper to build minimal MusicXML fixtures quickly
function makeXml(measuresBody, opts) {
  const o = opts || {};
  const partName = o.partName || 'Bb Trumpet 1';
  const fifths = o.fifths != null ? o.fifths : 0;
  const beats = o.beats != null ? o.beats : 4;
  const beatType = o.beatType != null ? o.beatType : 4;
  const clefSign = o.clefSign || 'G';
  const clefLine = o.clefLine || (clefSign === 'F' ? 4 : 2);
  const divs = o.divisions || 4;
  const transposeXml = o.transpose
    ? `<transpose><diatonic>${o.transpose.diatonic || 0}</diatonic><chromatic>${o.transpose.chromatic || 0}</chromatic></transpose>`
    : '';
  const attrs = `<attributes><divisions>${divs}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>${clefSign}</sign><line>${clefLine}</line></clef>${transposeXml}</attributes>`;
  const ms = measuresBody.map((body, idx) => {
    const num = (o.firstMeasureNumber != null && idx === 0) ? o.firstMeasureNumber : String(idx + 1);
    const imp = (o.firstImplicit && idx === 0) ? ' implicit="yes"' : '';
    return `<measure number="${num}"${imp}>${idx === 0 ? attrs : ''}${body}</measure>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>${o.title || 'Test'}</work-title></work>
  <part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>
  <part id="P1">${ms}</part>
</score-partwise>`;
}

// =========================================================================
// 2. Parser, Mutations, XML & .mxl ZIP Round-Trip (using real band fixture)
// =========================================================================
const bandXml = tryRead('tests/fixtures/scan-band-part.musicxml');
check('band fixture exists', bandXml !== null && bandXml.length > 500);

const bandModel = sfParseMusicXml(bandXml);
check('band workTitle parsed', bandModel.workTitle === 'March of the Lions');
check('band composer parsed', bandModel.composer === 'Rehearsal Band Fixture');
check('band part count == 1', bandModel.parts.length === 1);
check('band part name parsed', bandModel.parts[0].name === 'Bb Trumpet 1');
check('band transpose parsed (-2 chromatic)', bandModel.parts[0].transpose.chromatic === -2 && bandModel.parts[0].transpose.diatonic === -1);
check('band measure count == 12', bandModel.parts[0].measures.length === 12);
check('band tempo parsed (116)', bandModel.parts[0].measures[0].tempos.length === 1 && bandModel.parts[0].measures[0].tempos[0].bpm === 116);
check('band forward repeat on M5 (idx 4)', bandModel.parts[0].measures[4].repeats.fwd === true);
check('band 1st ending + backward repeat on M8 (idx 7)',
  bandModel.parts[0].measures[7].repeats.back === 2 &&
  Array.isArray(bandModel.parts[0].measures[7].repeats.ending) &&
  bandModel.parts[0].measures[7].repeats.ending[0] === 1 &&
  bandModel.parts[0].measures[7].repeats.endClose === true);
check('band 2nd ending on M9 (idx 8)',
  Array.isArray(bandModel.parts[0].measures[8].repeats.ending) &&
  bandModel.parts[0].measures[8].repeats.ending[0] === 2);

// Check soundingMidi reflects Bb trumpet transposition (-2 semitones)
const m1Notes = bandModel.parts[0].measures[0].entries.filter(e => e.kind === 'note');
check('M1 has 4 notes', m1Notes.length === 4);
check('M1 note 0 written C4=60, sounding Bb3=58', m1Notes[0].midi === 60 && m1Notes[0].soundingMidi === 58);

// Playback score conversion before edits
const bandPlayback = sfModelToPlaybackScore(bandModel);
check('playback score has 12 written measures', bandPlayback.measures.length === 12);
check('playback score has repeats unrolled (15 played bars)', bandPlayback.hasRepeats === true && bandPlayback.perf.length === 15);
check('playback score tempo == 116', bandPlayback.tempos[0].bpm === 116 && bandPlayback.ptempos[0].bpm === 116);
check('playback first event sounding midi == 58', bandPlayback.events[0].midi === 58);

// Test all 6 edit mutations on a cloned model
const edited = sfCloneModel(bandModel);
const n0Id = m1Notes[0].id; // C4 quarter
const n1Id = m1Notes[1].id; // E4 quarter
const n2Id = m1Notes[2].id; // G4 quarter
const n3Id = m1Notes[3].id; // C5 quarter

// 2a. Diatonic step up/down
const rDiaUp = sfEditPitchDiatonic(edited, n0Id, 1);
check('diatonic +1 C4 -> D4', rDiaUp.ok && rDiaUp.changed && rDiaUp.entry.step === 'D' && rDiaUp.entry.octave === 4 && rDiaUp.entry.midi === 62 && rDiaUp.entry.soundingMidi === 60);
const rDiaDown = sfEditPitchDiatonic(edited, n0Id, -2);
check('diatonic -2 D4 -> B3', rDiaDown.ok && rDiaDown.changed && rDiaDown.entry.step === 'B' && rDiaDown.entry.octave === 3 && rDiaDown.entry.midi === 59 && rDiaDown.entry.soundingMidi === 57);

// 2b. Chromatic semitone up/down
const rSemiUp = sfEditPitchSemitone(edited, n1Id, 1);
check('semitone +1 E4 -> F4 (midi 65)', rSemiUp.ok && rSemiUp.changed && rSemiUp.entry.midi === 65 && rSemiUp.entry.step === 'F' && rSemiUp.entry.accidental === null);
const rSemiUp2 = sfEditPitchSemitone(edited, n1Id, 1);
check('semitone +1 F4 -> F#4 (midi 66, sharp)', rSemiUp2.ok && rSemiUp2.changed && rSemiUp2.entry.midi === 66 && rSemiUp2.entry.step === 'F' && rSemiUp2.entry.alter === 1 && rSemiUp2.entry.accidental === 'sharp');
const rSemiDown = sfEditPitchSemitone(edited, n1Id, -1);
check('semitone -1 F#4 -> F4 (midi 65)', rSemiDown.ok && rSemiDown.changed && rSemiDown.entry.midi === 65);

// 2c. Toggle accidental (sharp, flat, natural, none, cycle)
const rAccSharp = sfToggleAccidental(edited, n2Id, 'sharp');
check('accidental sharp on G4 -> G#4 (midi 68)', rAccSharp.ok && rAccSharp.entry.alter === 1 && rAccSharp.entry.accidental === 'sharp' && rAccSharp.entry.midi === 68);
const rAccFlat = sfToggleAccidental(edited, n2Id, 'flat');
check('accidental flat on G4 -> Gb4 (midi 66)', rAccFlat.ok && rAccFlat.entry.alter === -1 && rAccFlat.entry.accidental === 'flat' && rAccFlat.entry.midi === 66);
const rAccNat = sfToggleAccidental(edited, n2Id, 'natural');
check('accidental natural on G4 -> G4 (midi 67)', rAccNat.ok && rAccNat.entry.alter === 0 && rAccNat.entry.accidental === 'natural' && rAccNat.entry.midi === 67);
const rAccNone = sfToggleAccidental(edited, n2Id, 'none');
check('accidental none clears explicit accidental', rAccNone.ok && rAccNone.entry.alter === 0 && rAccNone.entry.accidental === null && rAccNone.entry.midi === 67);
const rAccCycle = sfToggleAccidental(edited, n2Id, 'cycle');
check('accidental cycle none -> sharp', rAccCycle.ok && rAccCycle.entry.accidental === 'sharp' && rAccCycle.entry.alter === 1);

// 2d. Duration change + divisions rescaling + stale beam stripping
// Measure 7 (index 6) has two beamed 8th notes at end; change first beamed 8th to dotted 16th (requires divisions 4 -> 8)
const m7Notes = edited.parts[0].measures[6].entries.filter(e => e.kind === 'note');
const beamed8th = m7Notes[3];
check('M7 note 3 initially has <beam> in extraXml', beamed8th.extraXml.includes('<beam'));
const rDur = sfEditDuration(edited, beamed8th.id, '16th', true);
check('duration change to dotted 16th scales divisions to 8',
  rDur.ok && rDur.changed && edited.parts[0].measures[6].divisions === 8 &&
  rDur.entry.durationDivs === 3 && approx(rDur.entry.durationQ, 0.375) &&
  rDur.entry.type === '16th' && rDur.entry.dots === 1);
check('stale <beam> stripped after duration change', !rDur.entry.extraXml.includes('<beam'));
check('subsequent note onsetQ updated after duration change', approx(m7Notes[4].onsetQ, 3.375));

// 2e. Toggle dot (0 <-> 1)
const rDotOff = sfToggleDot(edited, beamed8th.id);
check('toggle dot 1 -> 0', rDotOff.ok && rDotOff.entry.dots === 0 && approx(rDotOff.entry.durationQ, 0.25));
const rDotOn = sfToggleDot(edited, beamed8th.id);
check('toggle dot 0 -> 1', rDotOn.ok && rDotOn.entry.dots === 1 && approx(rDotOn.entry.durationQ, 0.375));

// 2f. Make rest & delete (including chord base promotion)
const rMakeRest = sfDeleteOrMakeRest(edited, n3Id, 'rest');
check('make rest converts note to rest preserving duration',
  rMakeRest.ok && rMakeRest.changed && rMakeRest.entry.kind === 'rest' &&
  rMakeRest.entry.isRest === true && rMakeRest.entry.midi === null && approx(rMakeRest.entry.durationQ, 1));

// Chord base promotion test
const chordXml = makeXml([
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
  '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
  '<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
  '<note><pitch><step>F</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note>'
]);
const chordModel = sfParseMusicXml(chordXml);
const cNotes = chordModel.parts[0].measures[0].entries.filter(e => e.kind === 'note');
check('chord parsed with 1 base + 2 chord tones', !cNotes[0].isChord && cNotes[1].isChord && cNotes[2].isChord && approx(cNotes[2].onsetQ, 0) && approx(cNotes[3].onsetQ, 1));
const rDelBase = sfDeleteOrMakeRest(chordModel, cNotes[0].id, 'delete');
check('deleting chord base promotes E4 to non-chord base', rDelBase.ok && rDelBase.changed);
const cNotesAfter = chordModel.parts[0].measures[0].entries.filter(e => e.kind === 'note');
check('promoted chord retains E4 (base), G4 (chord), F4 at onsetQ=1',
  cNotesAfter.length === 3 &&
  cNotesAfter[0].step === 'E' && !cNotesAfter[0].isChord && approx(cNotesAfter[0].onsetQ, 0) &&
  cNotesAfter[1].step === 'G' && cNotesAfter[1].isChord && approx(cNotesAfter[1].onsetQ, 0) &&
  cNotesAfter[2].step === 'F' && approx(cNotesAfter[2].onsetQ, 1));

// Delete a note from M10 of edited bandModel
const m10Notes = edited.parts[0].measures[9].entries.filter(e => e.kind === 'note');
const rDelNote = sfDeleteOrMakeRest(edited, m10Notes[1].id, 'delete');
check('delete removes entry and recalculates later onsetQ',
  rDelNote.ok && edited.parts[0].measures[9].entries.filter(e => e.kind === 'note').length === 3 &&
  approx(edited.parts[0].measures[9].entries.filter(e => e.kind === 'note')[1].onsetQ, 1));

// 2g. Export MusicXML + .mxl ZIP -> Re-import and verify EVERYTHING survived
const exportedXml = sfExportMusicXml(edited);
const reXml = sfParseMusicXml(exportedXml);
check('XML round-trip preserves workTitle & composer', reXml.workTitle === 'March of the Lions' && reXml.composer === 'Rehearsal Band Fixture');
check('XML round-trip preserves 12 measures & measure numbers',
  reXml.parts[0].measures.length === 12 && reXml.parts[0].measures[11].number === '12');
check('XML round-trip preserves repeats, endings, tempo, transpose',
  reXml.parts[0].measures[4].repeats.fwd === true &&
  reXml.parts[0].measures[7].repeats.back === 2 &&
  reXml.parts[0].measures[8].repeats.ending[0] === 2 &&
  reXml.parts[0].measures[0].tempos[0].bpm === 116 &&
  reXml.parts[0].transpose.chromatic === -2);
const reM1 = reXml.parts[0].measures[0].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
check('XML round-trip preserves edited pitch, accidental, rest',
  reM1[0].step === 'B' && reM1[0].octave === 3 &&
  reM1[2].step === 'G' && reM1[2].alter === 1 && reM1[2].accidental === 'sharp' &&
  reM1[3].kind === 'rest' && reM1[3].isRest === true);
// Crucial: verify M7 divisions=8 did NOT corrupt M8 durations (M8 must still total 4.0Q!)
const reM7 = reXml.parts[0].measures[6].entries.filter(e => e.kind === 'note');
const reM8 = reXml.parts[0].measures[7].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
const reM8Sum = reM8.reduce((s, e) => s + e.durationQ, 0);
check('XML round-trip preserves M7 dotted 16th (0.375Q) AND M8 stays 4.0Q',
  approx(reM7[3].durationQ, 0.375) && reM7[3].dots === 1 && approx(reM8Sum, 4.0));

// Export .mxl ZIP and verify binary structure + spUnzip compatibility
const mxlBytes = sfExportMxl(edited);
check('.mxl export returns Uint8Array starting with PK',
  mxlBytes instanceof Uint8Array && mxlBytes[0] === 0x50 && mxlBytes[1] === 0x4b && mxlBytes.byteLength > 200);
const unzipped = sfUnzipMxlSync(mxlBytes);
check('.mxl contains META-INF/container.xml and score.musicxml',
  !!unzipped['META-INF/container.xml'] && !!unzipped['score.musicxml'] &&
  unzipped['score.musicxml'].method === 0);
const containerTxt = sfUtf8Decode(unzipped['META-INF/container.xml'].data);
check('container.xml points to score.musicxml', containerTxt.includes('full-path="score.musicxml"'));

// Verify exact compatibility with web/score.js spUnzip byte layout
{
  const buf = mxlBytes.buffer.slice(mxlBytes.byteOffset, mxlBytes.byteOffset + mxlBytes.byteLength);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = sfUtf8Decode(new Uint8Array(buf, p + 46, nl)); p += 46 + nl + el + cl;
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    files[name] = { method, data: new Uint8Array(buf, lho + 30 + lnl + lel, csize) };
  }
  check('score.js spUnzip algorithm extracts both .mxl entries cleanly',
    files['META-INF/container.xml'] && files['score.musicxml'] &&
    sfUtf8Decode(files['score.musicxml'].data).includes('<work-title>March of the Lions</work-title>'));
}

// =========================================================================
// 3. Auto-Flagging Consistency Engine (all 5 rules: positive & negative)
// =========================================================================

// Instrument detection
check('detect Bb Trumpet 1 -> trumpet', sfDetectInstrument('Bb Trumpet 1') === 'trumpet');
check('detect Bass Clarinet -> bass_clarinet (not clarinet)', sfDetectInstrument('Bass Clarinet') === 'bass_clarinet');
check('detect Bb Clarinet 2 -> clarinet', sfDetectInstrument('Bb Clarinet 2') === 'clarinet');
check('detect Baritone Saxophone -> bari_sax', sfDetectInstrument('Baritone Saxophone') === 'bari_sax');
check('detect Tenor Sax -> tenor_sax', sfDetectInstrument('Tenor Sax') === 'tenor_sax');
check('detect Alto Sax -> alto_sax', sfDetectInstrument('Alto Sax 1') === 'alto_sax');
check('detect Piccolo -> piccolo (not flute)', sfDetectInstrument('Piccolo') === 'piccolo');
check('detect Flute 1 -> flute', sfDetectInstrument('Flute 1') === 'flute');
check('detect French Horn -> french_horn', sfDetectInstrument('F Horn 1') === 'french_horn');
check('detect Euphonium -> euphonium', sfDetectInstrument('Euphonium') === 'euphonium');
check('detect Tuba -> tuba', sfDetectInstrument('Tuba') === 'tuba');
check('detect Glockenspiel -> mallets', sfDetectInstrument('Glockenspiel') === 'mallets');
check('detect unknown -> auto', sfDetectInstrument('Voice Part') === 'auto');

// Rule 1: duration_mismatch
{
  // Negative: valid 1-beat anacrusis pickup M0 + exact 4/4 M1 + whole-measure rest M2
  const negDurXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>',
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>'
  ], { firstMeasureNumber: '0', firstImplicit: true });
  const rNeg = sfAnalyzeFlags(sfParseMusicXml(negDurXml), { instrument: 'trumpet' });
  check('Rule 1 NEG: valid pickup + full bar + measure rest -> 0 duration flags',
    rNeg.measures.every(m => !m.findings.some(f => f.rule === 'duration_mismatch')));

  // Negative: whole rest in 3/4 time is valid
  const negWholeRest34 = makeXml([
    '<note><rest/><duration>12</duration><voice>1</voice><type>whole</type></note>',
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note>'
  ], { beats: 3, beatType: 4 });
  const rNeg34 = sfAnalyzeFlags(sfParseMusicXml(negWholeRest34), { instrument: 'trumpet' });
  check('Rule 1 NEG: whole rest in 3/4 -> 0 duration flags',
    rNeg34.measures.every(m => !m.findings.some(f => f.rule === 'duration_mismatch')));

  // Negative: grand-staff polyphonic secondary voice (2 beats) on same staff as complete voice (4 beats)
  const negPolyXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>' +
    '<backup><duration>16</duration></backup>' +
    '<note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>2</voice><type>half</type><staff>1</staff></note>'
  ], { partName: 'Piano' });
  const rPoly = sfAnalyzeFlags(sfParseMusicXml(negPolyXml));
  check('Rule 1 NEG: transient secondary voice on same staff as complete voice -> 0 duration flags',
    !rPoly.measures[0].findings.some(f => f.rule === 'duration_mismatch'));

  // Positive: over-full pickup M0 (5 beats), under-full M1 (3 beats), over-full M2 (5 beats)
  const posDurXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>' +
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>',
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note>',
    '<note><pitch><step>B</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>' +
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>'
  ]);
  const rPos = sfAnalyzeFlags(sfParseMusicXml(posDurXml), { instrument: 'trumpet' });
  check('Rule 1 POS: over-full pickup M0 flagged', rPos.measures[0].findings.some(f => f.rule === 'duration_mismatch'));
  check('Rule 1 POS: under-full M1 flagged', rPos.measures[1].findings.some(f => f.rule === 'duration_mismatch'));
  check('Rule 1 POS: over-full M2 flagged', rPos.measures[2].findings.some(f => f.rule === 'duration_mismatch'));
}

// Rule 2: accidental_anomaly
{
  // Positive A: redundant sharp on F# in G major (fifths=1) on first occurrence
  const posRedundant = makeXml([
    '<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>sharp</accidental></note>' +
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>'
  ], { fifths: 1 });
  const rRed = sfAnalyzeFlags(sfParseMusicXml(posRedundant), { instrument: 'trumpet' });
  check('Rule 2 POS: redundant sharp matching key sig flagged',
    rRed.measures[0].findings.some(f => f.rule === 'accidental_anomaly'));

  // Positive B: repeated identical accidental in same measure
  const posRepeat = makeXml([
    '<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>sharp</accidental></note>' +
    '<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>sharp</accidental></note>'
  ], { fifths: 0 });
  const rRep = sfAnalyzeFlags(sfParseMusicXml(posRepeat), { instrument: 'trumpet' });
  check('Rule 2 POS: repeated identical sharp in same bar flagged',
    rRep.measures[0].findings.filter(f => f.rule === 'accidental_anomaly').length === 1);

  // Positive C: sharp in flat key (fifths=-2) & flat in sharp key (fifths=+2) & double-sharp
  const posClashFlatKey = makeXml([
    '<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><accidental>sharp</accidental></note>'
  ], { fifths: -2 });
  const posClashSharpKey = makeXml([
    '<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><accidental>flat</accidental></note>'
  ], { fifths: 2 });
  const posDouble = makeXml([
    '<note><pitch><step>F</step><alter>2</alter><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><accidental>double-sharp</accidental></note>'
  ], { fifths: 0 });
  check('Rule 2 POS: sharp in Bb major (fifths=-2) flagged',
    sfAnalyzeFlags(sfParseMusicXml(posClashFlatKey), { instrument: 'trumpet' }).measures[0].findings.some(f => f.rule === 'accidental_anomaly'));
  check('Rule 2 POS: flat in D major (fifths=+2) flagged',
    sfAnalyzeFlags(sfParseMusicXml(posClashSharpKey), { instrument: 'trumpet' }).measures[0].findings.some(f => f.rule === 'accidental_anomaly'));
  check('Rule 2 POS: double-sharp flagged',
    sfAnalyzeFlags(sfParseMusicXml(posDouble), { instrument: 'trumpet' }).measures[0].findings.some(f => f.rule === 'accidental_anomaly'));

  // Negative: valid C# followed by C-natural in C major
  const negAcc = makeXml([
    '<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>sharp</accidental></note>' +
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>natural</accidental></note>'
  ], { fifths: 0 });
  check('Rule 2 NEG: C# then C-natural in C major -> 0 accidental flags',
    !sfAnalyzeFlags(sfParseMusicXml(negAcc), { instrument: 'trumpet' }).measures[0].findings.some(f => f.rule === 'accidental_anomaly'));
}

// Rule 3: out_of_range
{
  const posRange = makeXml([
    '<note><pitch><step>G</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>'
  ], { partName: 'Bb Trumpet 1' });
  const rOut = sfAnalyzeFlags(sfParseMusicXml(posRange));
  check('Rule 3 POS: G6 (too high) and C3 (too low) for Trumpet both flagged',
    rOut.measures[0].findings.filter(f => f.rule === 'out_of_range').length === 2);

  const negRange = makeXml([
    '<note><pitch><step>F</step><alter>1</alter><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>sharp</accidental></note>' +
    '<note><pitch><step>C</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>'
  ], { partName: 'Bb Trumpet 1' });
  check('Rule 3 NEG: F#3 and C6 within Bb Trumpet range -> 0 range flags',
    !sfAnalyzeFlags(sfParseMusicXml(negRange)).measures[0].findings.some(f => f.rule === 'out_of_range'));

  // Auto clef-based fallback (Bass clef F4: range 33..67)
  const posBassClef = makeXml([
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ], { partName: 'Mystery Low Part', clefSign: 'F', clefLine: 4 });
  check('Rule 3 POS: auto bass-clef fallback flags C5 (midi 72)',
    sfAnalyzeFlags(sfParseMusicXml(posBassClef), { instrument: 'auto' }).measures[0].findings.some(f => f.rule === 'out_of_range'));
}

// Rule 4: rhythm_density_anomaly
{
  const twoHalfs = '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>';
  const sixteen16ths = Array(16).fill('<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type></note>').join('');
  const posDenseXml = makeXml([twoHalfs, twoHalfs, sixteen16ths, twoHalfs, twoHalfs]);
  const rDense = sfAnalyzeFlags(sfParseMusicXml(posDenseXml), { instrument: 'trumpet' });
  check('Rule 4 POS (dense): 16-note spike surrounded by 2-note bars flagged',
    rDense.measures[2].findings.some(f => f.rule === 'rhythm_density_anomaly'));

  const fourQuarters = Array(4).fill('<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>').join('');
  const eight8ths = Array(8).fill('<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>').join('');
  const halfPhraseEnd = '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><rest/><duration>8</duration><voice>1</voice><type>half</type></note>';
  const sparseEighthDropout = '<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>' +
    '<note><rest/><duration>14</duration><voice>1</voice><type>half</type><dot/><dot/></note>';
  const wholeCadence = '<note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>';
  const wholeRest = '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>';

  const posSparseXml = makeXml([eight8ths, eight8ths, sparseEighthDropout, eight8ths, eight8ths]);
  const rSparse = sfAnalyzeFlags(sfParseMusicXml(posSparseXml), { instrument: 'trumpet' });
  check('Rule 4 POS (sparse): lone 8th-note fragment surrounded by 8-note bars flagged',
    rSparse.measures[2].findings.some(f => f.rule === 'rhythm_density_anomaly'));

  const negPhraseXml4 = makeXml([fourQuarters, fourQuarters, halfPhraseEnd, fourQuarters, fourQuarters]);
  const negPhraseXml8 = makeXml([eight8ths, eight8ths, halfPhraseEnd, eight8ths, wholeRest]);
  check('Rule 4 NEG: 1-note vocal phrase ending (half + half rest) surrounded by 4-note bars NOT flagged',
    !sfAnalyzeFlags(sfParseMusicXml(negPhraseXml4), { instrument: 'trumpet' }).measures[2].findings.some(f => f.rule === 'rhythm_density_anomaly'));
  check('Rule 4 NEG: 1-note vocal phrase ending surrounded by 8-note bars and whole-bar rest NOT flagged',
    !sfAnalyzeFlags(sfParseMusicXml(negPhraseXml8), { instrument: 'trumpet' }).measures[2].findings.some(f => f.rule === 'rhythm_density_anomaly') &&
    !sfAnalyzeFlags(sfParseMusicXml(negPhraseXml8), { instrument: 'trumpet' }).measures[4].findings.some(f => f.rule === 'rhythm_density_anomaly'));

  const negCadenceXml = makeXml([eight8ths, eight8ths, wholeCadence, eight8ths, wholeRest]);
  const rCad = sfAnalyzeFlags(sfParseMusicXml(negCadenceXml), { instrument: 'trumpet' });
  check('Rule 4 NEG: whole-note cadence and whole-bar rest NOT flagged as sparse',
    !rCad.measures[2].findings.some(f => f.rule === 'rhythm_density_anomaly') &&
    !rCad.measures[4].findings.some(f => f.rule === 'rhythm_density_anomaly'));
}

// Rule 5: implausible_leap (> 24 semitones)
{
  // Positive: within measure (C4=60 -> D6=86, 26 semis) and across barline (C4=60 -> Db6=85, 25 semis)
  const posLeapXml = makeXml([
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>D</step><octave>6</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>',
    '<note><pitch><step>D</step><alter>-1</alter><octave>6</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><accidental>flat</accidental></note>'
  ], { partName: 'Flute' });
  const rLeap = sfAnalyzeFlags(sfParseMusicXml(posLeapXml), { instrument: 'flute' });
  check('Rule 5 POS: >24 semitone leap within measure flagged',
    rLeap.measures[0].findings.some(f => f.rule === 'implausible_leap'));
  check('Rule 5 POS: >24 semitone leap across barline flagged',
    rLeap.measures[1].findings.some(f => f.rule === 'implausible_leap'));

  // Negative: exactly 24 semitones (2 octaves C4=60 -> C6=84) is NOT > 24
  const negLeapXml = makeXml([
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>C</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>'
  ], { partName: 'Flute' });
  check('Rule 5 NEG: exactly 24-semitone (2 octave) leap not flagged',
    !sfAnalyzeFlags(sfParseMusicXml(negLeapXml), { instrument: 'flute' }).measures[0].findings.some(f => f.rule === 'implausible_leap'));
}

// Confidence aggregation check
{
  const multiIssueXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    // M2: duration mismatch (0.45) + out of range A6 (0.35) + leap G4->A6=26 > 24 (0.30) -> confidence clamped to 0.0, level 'high'
    '<note><pitch><step>A</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>'
  ], { partName: 'Bb Trumpet 1' });
  const rConf = sfAnalyzeFlags(sfParseMusicXml(multiIssueXml));
  check('confidence aggregation: clean bar == 1.0, level clean',
    rConf.measures[0].confidence === 1 && rConf.measures[0].level === 'clean' && !rConf.measures[0].flagged);
  check('confidence aggregation: multi-flag bar clamped to 0, level high',
    rConf.measures[1].confidence === 0 && rConf.measures[1].level === 'high' && rConf.measures[1].flagged && rConf.flaggedCount === 1);
  check('overallConfidence == 0.5', approx(rConf.overallConfidence, 0.5));
}

// =========================================================================
// 4. Tap-to-Model Mapper (single notes, chords, rests, multi-voice, multi-bar)
// =========================================================================
{
  const tapXml = makeXml([
    // M1: beat 0 = C4+E4 chord (voice 1), beat 1 = quarter rest (voice 1), beat 2 = half G4 (voice 1),
    //     backup 4 beats, beat 0 = whole C3 (voice 2)
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<backup><duration>16</duration></backup>' +
    '<note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type></note>',
    // M2: single whole note A4
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ]);
  const tapModel = sfParseMusicXml(tapXml);
  const inst0 = { IdString: 'P1', Visible: true };
  function mkSvg() {
    const attrs = {};
    return { attrs, setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k]; } };
  }
  function mkGn(opts) {
    const svg = mkSvg();
    return {
      sourceNote: {
        isRest: () => !!opts.isRest,
        // Use real OSMD halfTone = midi - 12 convention!
        Pitch: opts.isRest ? null : { halfTone: opts.midi - 12 },
        Length: { RealValue: opts.durQ / 4 }
      },
      getSVGGElement: () => svg,
      _svg: svg
    };
  }

  const gnC4 = mkGn({ midi: 60, durQ: 1 });
  const gnE4 = mkGn({ midi: 64, durQ: 1 });
  const gnRest = mkGn({ isRest: true, durQ: 1 });
  const gnG4 = mkGn({ midi: 67, durQ: 2 });
  const gnC3 = mkGn({ midi: 48, durQ: 4 });
  const gnA4 = mkGn({ midi: 69, durQ: 4 });

  const mockMeasureList = [
    [{
      ParentStaff: { Id: 1, ParentInstrument: inst0 },
      staffEntries: [
        {
          relInMeasureTimestamp: { RealValue: 0 },
          graphicalVoiceEntries: [
            { parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [gnE4, gnC4] }, // intentionally reversed chord order!
            { parentVoiceEntry: { ParentVoice: { VoiceId: 2 } }, notes: [gnC3] }
          ]
        },
        {
          relInMeasureTimestamp: { RealValue: 0.25 },
          graphicalVoiceEntries: [
            { parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [gnRest] }
          ]
        },
        {
          relInMeasureTimestamp: { RealValue: 0.5 },
          graphicalVoiceEntries: [
            { parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [gnG4] }
          ]
        }
      ]
    }],
    [{
      ParentStaff: { Id: 1, ParentInstrument: inst0 },
      staffEntries: [
        {
          relInMeasureTimestamp: { RealValue: 0 },
          graphicalVoiceEntries: [
            { parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [gnA4] }
          ]
        }
      ]
    }]
  ];

  const tapMap = sfBuildTapMap(tapModel, mockMeasureList, [inst0]);
  check('tapMap maps all 6 notes/rests across 2 measures', tapMap.entries.length === 6 && tapMap.byNoteId.size === 6);

  const m1Ents = tapModel.parts[0].measures[0].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  const m2Ents = tapModel.parts[0].measures[1].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  // Even though gnE4 came before gnC4 in OSMD, pitch matching must assign gnE4 -> E4 and gnC4 -> C4!
  check('tapMap chord tone E4 matched to E4 entry', gnE4._svg.getAttribute('data-sf-note') === m1Ents[1].id);
  check('tapMap chord tone C4 matched to C4 entry', gnC4._svg.getAttribute('data-sf-note') === m1Ents[0].id);
  check('tapMap rest matched to rest entry', gnRest._svg.getAttribute('data-sf-note') === m1Ents[2].id);
  check('tapMap half note G4 matched', gnG4._svg.getAttribute('data-sf-note') === m1Ents[3].id);
  check('tapMap voice 2 C3 matched', gnC3._svg.getAttribute('data-sf-note') === m1Ents[4].id);
  check('tapMap M2 note A4 matched with data-sf-measure=1',
    gnA4._svg.getAttribute('data-sf-note') === m2Ents[0].id && gnA4._svg.getAttribute('data-sf-measure') === '1');
}

// =========================================================================
// 5. Undo / Redo Session Stack (SfHistory)
// =========================================================================
{
  const hModel = sfCloneModel(bandModel);
  const firstNoteId = hModel.parts[0].measures[0].entries.find(e => e.kind === 'note').id;
  const hist = new SfHistory(hModel, 3);
  check('history initial: cannot undo, cannot redo', !hist.canUndo() && !hist.canRedo());

  sfEditPitchDiatonic(hModel, firstNoteId, 1); // C4 -> D4
  hist.push('Pitch +1', hModel);
  sfEditPitchDiatonic(hModel, firstNoteId, 1); // D4 -> E4
  hist.push('Pitch +1', hModel);

  check('history after 2 edits: canUndo, !canRedo', hist.canUndo() && !hist.canRedo());
  const u1 = hist.undo();
  check('undo 1 restores D4', sfFindEntry(u1, firstNoteId).entry.step === 'D' && hist.canRedo());
  const u0 = hist.undo();
  check('undo 2 restores C4', sfFindEntry(u0, firstNoteId).entry.step === 'C' && !hist.canUndo());
  const r1 = hist.redo();
  check('redo 1 restores D4', sfFindEntry(r1, firstNoteId).entry.step === 'D');

  // Pushing a new edit clears the redo branch!
  sfEditPitchDiatonic(r1, firstNoteId, -2); // D4 -> B3
  hist.push('Pitch -2', r1);
  check('new edit after undo clears redo branch', !hist.canRedo() && sfFindEntry(hist.current(), firstNoteId).entry.step === 'B');

  // Max steps cap (maxSteps = 3 -> at most 4 states in stack)
  const mStep = hist.current();
  for (let k = 0; k < 5; k++) {
    sfEditPitchDiatonic(mStep, firstNoteId, 1);
    hist.push('Step ' + k, mStep);
  }
  check('history respects maxSteps cap (length <= maxSteps + 1)', hist.length <= 4);
}

// =========================================================================
// 6. Save Gate (SfSaveGate)
// =========================================================================
{
  // Create a 3-measure score where M0 is clean, M1 has duration_mismatch, M2 has out_of_range
  const gateXml = makeXml([
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note>',
    '<note><pitch><step>G</step><octave>6</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ], { partName: 'Bb Trumpet 1' });
  const gateModel = sfParseMusicXml(gateXml);
  const f0 = sfAnalyzeFlags(gateModel);
  const gate = new SfSaveGate(f0);

  check('gate initially blocks save (unresolved [1, 2])',
    !gate.canSave() && gate.getUnresolvedMeasures().join(',') === '1,2');

  // Visiting M1 alone must NOT unlock it
  gate.visitMeasure(1);
  check('gate still blocks after visitMeasure(1) alone',
    !gate.canSave() && gate.getMeasureState(1).visited === true && gate.getMeasureState(1).status === 'pending');

  // Fix M1 duration -> whole (4 beats) and syncFlags
  const m1Note = gateModel.parts[0].measures[1].entries.find(e => e.kind === 'note');
  sfEditDuration(gateModel, m1Note.id, 'whole', false);
  const f1 = sfAnalyzeFlags(gateModel);
  gate.syncFlags(f1, 1);
  check('gate auto-marks visited edited M1 as fixed, still blocked by M2',
    !gate.canSave() && gate.getMeasureState(1).status === 'fixed' && gate.getUnresolvedMeasures().join(',') === '2');

  // Visit + confirm M2 -> now canSave() MUST be true!
  gate.visitMeasure(2);
  gate.confirmMeasure(2);
  check('gate unlocks after M1 fixed and M2 visited+confirmed',
    gate.canSave() && gate.getUnresolvedMeasures().length === 0 && gate.getMeasureState(2).status === 'confirmed');

  // Verify exportLog structure matches server-side save gate contract
  const log = gate.exportLog();
  check('exportLog has 2 resolved entries with visited=true and status in confirmed/fixed',
    log.length === 2 && log.every(e => e.flagged === true && e.visited === true && (e.status === 'confirmed' || e.status === 'fixed')));

  // Introducing a NEW flag on M0 re-blocks save!
  const m0Note = gateModel.parts[0].measures[0].entries.find(e => e.kind === 'note');
  sfEditDuration(gateModel, m0Note.id, 'quarter', false); // now M0 is under-full! Wait: M0 is pickup (under-full allowed), make it over-full OR edit M1!
  // Let's introduce out_of_range on M0 (C4 -> 3 octaves up -> C7)
  sfEditPitchDiatonic(gateModel, m0Note.id, 21); // C4 -> C7 (midi 96 > 84)
  const f2 = sfAnalyzeFlags(gateModel);
  gate.syncFlags(f2, 0);
  check('gate re-blocks when edit introduces new flag on M0',
    !gate.canSave() && gate.getUnresolvedMeasures().includes(0) && gate.getMeasureState(0).status === 'pending');
}

// =========================================================================
// 7. End-to-End Integration on Real Fixtures (Ode to Joy & Band Trumpet Part)
// =========================================================================
const odeXml = tryRead('web/demo/ode-to-joy.musicxml');
check('ode-to-joy fixture exists', odeXml !== null);

const odeModel = sfParseMusicXml(odeXml);
check('ode-to-joy parsed 2 parts x 16 measures',
  odeModel.parts.length === 2 && odeModel.parts[0].measures.length === 16 && odeModel.parts[1].measures.length === 16);
const odeFlags = sfAnalyzeFlags(odeModel);
check('ode-to-joy has 0 flags and overallConfidence == 1',
  odeFlags.flaggedCount === 0 && odeFlags.overallConfidence === 1);

const bandFlags = sfAnalyzeFlags(bandModel);
check('band fixture has 0 flags and overallConfidence == 1',
  bandFlags.flaggedCount === 0 && bandFlags.overallConfidence === 1);

// E2E workflow: corrupt 2 bars of band fixture -> flag -> fix -> undo/redo -> gate unlocks -> export .mxl -> async re-import -> playback
const e2eModel = sfCloneModel(bandModel);
const e2eNoteM3 = e2eModel.parts[0].measures[2].entries.find(e => e.kind === 'note'); // A4 quarter
const e2eNoteM6 = e2eModel.parts[0].measures[5].entries.find(e => e.kind === 'note'); // F4 quarter
sfEditPitchDiatonic(e2eModel, e2eNoteM3.id, 14); // A4 -> A6 (out of range + leap!)
sfEditDuration(e2eModel, e2eNoteM6.id, 'eighth', false); // under-full M6!

const e2eFlagsBad = sfAnalyzeFlags(e2eModel);
check('E2E detects injected errors in M3 (idx 2) and M6 (idx 5)',
  e2eFlagsBad.flaggedCount === 2 && e2eFlagsBad.measures[2].flagged && e2eFlagsBad.measures[5].flagged);

const e2eGate = new SfSaveGate(e2eFlagsBad);
const e2eHist = new SfHistory(e2eModel);
check('E2E gate blocks save before fixes', !e2eGate.canSave());

// Fix M3
e2eGate.visitMeasure(2);
sfEditPitchDiatonic(e2eModel, e2eNoteM3.id, -14);
e2eHist.push('Fix M3 pitch', e2eModel);
e2eGate.syncFlags(sfAnalyzeFlags(e2eModel), 2);

// Fix M6
e2eGate.visitMeasure(5);
sfEditDuration(e2eModel, e2eNoteM6.id, 'quarter', false);
e2eHist.push('Fix M6 duration', e2eModel);
e2eGate.syncFlags(sfAnalyzeFlags(e2eModel), 5);

check('E2E gate unlocks after both measures fixed', e2eGate.canSave() && e2eGate.getUnresolvedMeasures().length === 0);

// =========================================================================
// 8. Lyrics, Text Metadata, Audiveris Tie Normalization, and sfToggleTie
// =========================================================================
const choirTextXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Choral Hymn</work-title></work>
  <movement-title>Verse One</movement-title>
  <identification>
    <creator type="composer">Jane Doe</creator>
    <creator type="lyricist">John Smith</creator>
  </identification>
  <credit page="1"><credit-words>Commissioned 2026</credit-words></credit>
  <part-list>
    <score-part id="P1">
      <part-name>Soprano</part-name>
      <part-abbreviation>S.</part-abbreviation>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above">
        <direction-type><rehearsal>A</rehearsal></direction-type>
        <direction-type><words>Allegro</words></direction-type>
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type>
        <sound tempo="120"/>
      </direction>
      <direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><slur type="start" number="1"/><tied type="start"/></notations>
        <lyric number="1"><syllabic>begin</syllabic><text>Hal</text></lyric>
        <lyric number="2"><syllabic>single</syllabic><text>Sing</text></lyric>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><tied type="stop"/><slur type="stop" number="1"/></notations>
        <lyric number="1"><syllabic>middle</syllabic><text>le</text><extend/></lyric>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <lyric number="1"><syllabic>end</syllabic><text>lu</text></lyric>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type>
        <notations><fermata type="upright"/></notations>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

const choirModel = sfParseMusicXml(choirTextXml);
const cm1Notes = choirModel.parts[0].measures[0].entries.filter(e => e.kind === 'note');
const cm2Notes = choirModel.parts[0].measures[1].entries.filter(e => e.kind === 'note');

// Audiveris tie normalization on parse (<tied> without <tie> -> populated into entry.ties)
check('Audiveris tie normalized on parse: note 0 has start, note 1 has stop',
  cm1Notes[0].ties.includes('start') && cm1Notes[1].ties.includes('stop'));

// Playback merges the normalized tie (G4 quarter + G4 quarter = 2.0Q)
const choirPlay0 = sfModelToPlaybackScore(choirModel);
check('playback merges Audiveris-normalized tie to 2.0Q',
  choirPlay0.events.length === 5 && approx(choirPlay0.events[0].dur, 2.0));

// Round-trip XML preserves all text, lyrics, directions, credits, part-abbreviation, and non-duplicated <tied>
const choirXmlOut = sfExportMusicXml(choirModel);
check('XML round-trip preserves <work-title>, <movement-title>, <creator>, <credit>, <part-name>, <part-abbreviation>',
  choirXmlOut.includes('<work-title>Choral Hymn</work-title>') &&
  choirXmlOut.includes('<movement-title>Verse One</movement-title>') &&
  choirXmlOut.includes('<creator type="lyricist">John Smith</creator>') &&
  choirXmlOut.includes('<credit-words>Commissioned 2026</credit-words>') &&
  choirXmlOut.includes('<part-name>Soprano</part-name>') &&
  choirXmlOut.includes('<part-abbreviation>S.</part-abbreviation>'));
check('XML round-trip preserves <words>, <rehearsal>, <dynamics>, <metronome>',
  choirXmlOut.includes('<rehearsal>A</rehearsal>') &&
  choirXmlOut.includes('<words font-weight="bold">Allegro</words>') &&
  choirXmlOut.includes('<mf/>') &&
  choirXmlOut.includes('<per-minute>120</per-minute>'));
check('XML round-trip preserves multi-verse <lyric>, <syllabic>, <extend/>, <slur>, <fermata>',
  choirXmlOut.includes('<lyric number="1"><syllabic>begin</syllabic><text>Hal</text></lyric>') &&
  choirXmlOut.includes('<lyric number="2"><syllabic>single</syllabic><text>Sing</text></lyric>') &&
  choirXmlOut.includes('<extend/>') &&
  choirXmlOut.includes('<slur type="start" number="1"/>') &&
  choirXmlOut.includes('<fermata type="upright"/>'));
check('XML round-trip emits <tie type="start"/> without duplicating <tied>',
  choirXmlOut.includes('<tie type="start"/>') &&
  (choirXmlOut.match(/<tied type="start"\/>/g) || []).length === 1 &&
  (choirXmlOut.match(/<tied type="stop"\/>/g) || []).length === 1);

// sfCanTieNext & sfToggleTie tests (intra-measure, across barline, untie, pitch change, undo/redo)
check('sfCanTieNext: G4->G4 is tied', sfCanTieNext(choirModel, cm1Notes[0].id).canTie === true && sfCanTieNext(choirModel, cm1Notes[0].id).isTied === true);
check('sfCanTieNext: G4->A4 cannot tie (different pitch)', sfCanTieNext(choirModel, cm1Notes[1].id).canTie === false);
check('sfCanTieNext: A4(m1 beat 3)->A4(m1 beat 4) intra-measure can tie',
  sfCanTieNext(choirModel, cm1Notes[2].id).canTie === true && sfCanTieNext(choirModel, cm1Notes[2].id).nextId === cm1Notes[3].id);
check('sfCanTieNext: A4(m1 beat 4)->A4(m2 beat 1) across barline can tie',
  sfCanTieNext(choirModel, cm1Notes[3].id).canTie === true && sfCanTieNext(choirModel, cm1Notes[3].id).nextId === cm2Notes[0].id);

const tieHist = new SfHistory(choirModel);
// Toggle tie ON across barline (A4 m1 beat 4 -> A4 m2 beat 1)
const tOn = sfToggleTie(choirModel, cm1Notes[3].id);
tieHist.push('Tie A4 across barline', choirModel);
check('sfToggleTie ON adds start/stop and syncs <tied> while keeping <fermata>',
  tOn.ok && tOn.tied === true &&
  cm1Notes[3].ties.includes('start') && cm2Notes[0].ties.includes('stop') &&
  cm2Notes[0].extraXml.includes('<tied type="stop"/>') && cm2Notes[0].extraXml.includes('<fermata'));

const choirPlayTied = sfModelToPlaybackScore(choirModel);
check('playback merges newly tied A4 across barline (1.0 + 2.0 = 3.0Q)',
  choirPlayTied.events.length === 4 && approx(choirPlayTied.events[2].dur, 3.0));

// Toggle tie OFF on G4->G4 (m1 beat 1 -> beat 2) while preserving <slur>
const tOff = sfToggleTie(choirModel, cm1Notes[0].id);
tieHist.push('Untie G4', choirModel);
check('sfToggleTie OFF removes start/stop and <tied> while preserving <slur>',
  tOff.ok && tOff.tied === false &&
  !cm1Notes[0].ties.includes('start') && !cm1Notes[1].ties.includes('stop') &&
  !cm1Notes[0].extraXml.includes('<tied') && cm1Notes[0].extraXml.includes('<slur'));

// Undo restores G4 tie
const choirUndo = tieHist.undo();
check('SfHistory undo restores G4 tie',
  sfFindEntry(choirUndo, cm1Notes[0].id).entry.ties.includes('start') &&
  sfFindEntry(choirUndo, cm1Notes[1].id).entry.ties.includes('stop'));

// Changing pitch breaks stale tie cleanly
sfEditPitchDiatonic(choirModel, cm1Notes[3].id, 1); // A4 -> B4 (breaks A4->A4 barline tie)
check('pitch change breaks stale tie on both notes',
  !cm1Notes[3].ties.includes('start') && !cm2Notes[0].ties.includes('stop'));

// =========================================================================
// 9. Direct MuseScore-Style Editing (Rest<->Note, Pitch Letter/Octave/Enharmonic,
//    Insert, Lyrics, Direction Text, Remove, Adjacent Nav, Tap-Map Text)
// =========================================================================
{
  const dirXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><rest/><duration>8</duration><voice>1</voice><type>half</type></note>',
    '<note><rest/><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ], { fifths: 1, partName: 'Soprano' }); // G major (F# in key sig)
  const dm = sfParseMusicXml(dirXml);
  const dm0 = dm.parts[0].measures[0].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  const dm1 = dm.parts[0].measures[1].entries.filter(e => e.kind === 'note' || e.kind === 'rest');

  // sfRestToNote: uses previous pitched note (G4)
  const r2n = sfRestToNote(dm, dm0[1].id);
  check('sfRestToNote converts rest to G4 preserving quarter duration',
    r2n.ok && r2n.changed && !r2n.entry.isRest && r2n.entry.step === 'G' && r2n.entry.octave === 4 && approx(r2n.entry.durationQ, 1));

  // sfSetPitchLetter on a rest (dm0[2]) -> converts to F#4 (key sig alter=1, nearest to G4)
  const letRest = sfSetPitchLetter(dm, dm0[2].id, 'F');
  check('sfSetPitchLetter on rest creates F#4 in G major',
    letRest.ok && !letRest.entry.isRest && letRest.entry.step === 'F' && letRest.entry.octave === 4 && letRest.entry.alter === 1);

  // sfSetPitchLetter on a note -> changes to C5 (nearest octave to F#4? F#4=66, C4=60 (dist 6), C5=72 (dist 6); let's check B4)
  const letNote = sfSetPitchLetter(dm, dm0[2].id, 'B');
  check('sfSetPitchLetter on note F#4 -> B4 (nearest octave)',
    letNote.ok && letNote.entry.step === 'B' && letNote.entry.octave === 4 && letNote.entry.alter === 0);

  // sfEditPitchOctave (+1 / -1 and MIDI 21..108 clamp)
  const octUp = sfEditPitchOctave(dm, dm0[2].id, 1);
  check('sfEditPitchOctave +1 B4 -> B5', octUp.ok && octUp.changed && octUp.entry.octave === 5 && octUp.entry.midi === 83);
  const octClamp = sfEditPitchOctave(dm, dm0[2].id, 5); // B10 > 108 -> clamped / unchanged
  check('sfEditPitchOctave clamps above MIDI 108', octClamp.ok && !octClamp.changed && octClamp.entry.octave === 5);
  const octDown = sfEditPitchOctave(dm, dm0[2].id, -1);
  check('sfEditPitchOctave -1 B5 -> B4', octDown.ok && octDown.changed && octDown.entry.octave === 4);

  // sfRespellEnharmonic: F#4 <-> Gb4, E# <-> F, Cb <-> B
  sfToggleAccidental(dm, dm0[0].id, 'sharp'); // G4 -> G#4 (midi 68)
  const resp1 = sfRespellEnharmonic(dm, dm0[0].id);
  check('sfRespellEnharmonic G#4 -> Ab4 preserving midi 68',
    resp1.ok && resp1.changed && resp1.entry.step === 'A' && resp1.entry.alter === -1 && resp1.entry.midi === 68 && resp1.entry.accidental === 'flat');
  const resp2 = sfRespellEnharmonic(dm, dm0[0].id);
  check('sfRespellEnharmonic Ab4 -> G#4 round-trips',
    resp2.ok && resp2.changed && resp2.entry.step === 'G' && resp2.entry.alter === 1 && resp2.entry.midi === 68 && resp2.entry.accidental === 'sharp');

  // sfInsertAfter (note and rest)
  const insNote = sfInsertAfter(dm, dm0[0].id, 'note', { type: 'eighth', step: 'A', octave: 4 });
  check('sfInsertAfter inserts A4 eighth right after first note and updates onsets',
    insNote.ok && insNote.changed && insNote.entry.step === 'A' && approx(insNote.entry.durationQ, 0.5) &&
    approx(insNote.entry.onsetQ, 1.0) && approx(dm0[1].onsetQ, 1.5));

  // sfGetAdjacentEntryId across measure boundary
  const nextInM0 = sfGetAdjacentEntryId(dm, dm0[0].id, 1);
  check('sfGetAdjacentEntryId +1 finds inserted note', nextInM0 === insNote.entry.id);
  const crossForward = sfGetAdjacentEntryId(dm, dm0[2].id, 1);
  check('sfGetAdjacentEntryId +1 crosses barline to M2 rest', crossForward === dm1[0].id);
  const crossBack = sfGetAdjacentEntryId(dm, dm1[0].id, -1);
  check('sfGetAdjacentEntryId -1 crosses barline back to M1 last entry', crossBack === dm0[2].id);

  // sfSetNoteLyric & sfGetNoteLyric (including hyphen & deletion)
  const lyr1 = sfSetNoteLyric(dm, dm0[0].id, 'Glo-');
  check('sfSetNoteLyric sets begin-syllabic hyphenated lyric',
    lyr1.ok && lyr1.lyric === 'Glo-' && sfGetNoteLyric(dm0[0], 1) === 'Glo-' &&
    dm0[0].lyrics && dm0[0].lyrics[0] && dm0[0].lyrics[0].syllabic === 'begin');
  const lyr2 = sfSetNoteLyric(dm, dm0[1].id, 'ry & <joy>');
  check('sfSetNoteLyric XML-escapes special chars',
    lyr2.ok && sfGetNoteLyric(dm0[1], 1) === 'ry & <joy>');

  // sfAddDirectionText / sfGetDirectionText / sfEditDirectionText
  const dirAdd = sfAddDirectionText(dm, 0, 0, 'rit.', { onsetQ: 0, placement: 'above' });
  check('sfAddDirectionText adds direction entry', dirAdd.ok && dirAdd.changed && sfGetDirectionText(dirAdd.entry) === 'rit.');
  const dirEdit = sfEditDirectionText(dm, dirAdd.entry.id, 'poco rit.');
  check('sfEditDirectionText updates words text', dirEdit.ok && sfGetDirectionText(dirEdit.entry) === 'poco rit.');

  // Round-trip lyrics + direction text through .mxl
  const dmMxl = sfExportMxl(dm);
  const dmUnzipped = sfUnzipMxlSync(dmMxl);
  const dmRe = sfParseMusicXml(sfUtf8Decode(dmUnzipped['score.musicxml'].data));
  const dmReNotes = dmRe.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  const dmReDir = dmRe.parts[0].measures[0].entries.find(e => e.kind === 'other' && e.tag === 'direction');
  check('MXL round-trip preserves sfSetNoteLyric and sfAddDirectionText',
    sfGetNoteLyric(dmReNotes[0], 1) === 'Glo-' &&
    sfGetNoteLyric(dmReNotes[2], 1) === 'ry & <joy>' &&
    sfGetDirectionText(dmReDir) === 'poco rit.');

  // Delete lyric & direction text via empty string
  const lyrDel = sfSetNoteLyric(dm, dm0[0].id, '   ');
  check('sfSetNoteLyric empty string removes lyric', lyrDel.ok && lyrDel.changed && sfGetNoteLyric(dm0[0], 1) === '');
  const dirDel = sfEditDirectionText(dm, dirAdd.entry.id, '');
  check('sfEditDirectionText empty string removes direction entry', dirDel.ok && dirDel.changed && !sfFindEntry(dm, dirAdd.entry.id));

  // sfRemoveEntry: note -> rest (soft), rest -> deleted, note -> deleted (hard)
  const remSoft = sfRemoveEntry(dm, dm0[1].id, { hard: false });
  check('sfRemoveEntry soft converts note to rest', remSoft.ok && remSoft.entry && remSoft.entry.isRest === true);
  const remRest = sfRemoveEntry(dm, dm0[1].id);
  check('sfRemoveEntry on rest deletes it', remRest.ok && remRest.entry === null && !sfFindEntry(dm, dm0[1].id));
  const remHard = sfRemoveEntry(dm, insNote.entry.id, { hard: true });
  check('sfRemoveEntry hard on note deletes it', remHard.ok && remHard.entry === null && !sfFindEntry(dm, insNote.entry.id));

  // Tap-map tags rests (data-sf-kind="rest"), lyrics (data-sf-lyric), and direction text (data-sf-dir)
  sfInsertAfter(dm, dm0[0].id, 'rest', { type: 'half' });
  sfSetNoteLyric(dm, dm0[0].id, 'Hal-');
  const dirTap = sfAddDirectionText(dm, 0, 0, 'molto', { onsetQ: 0 });
  function mkBoxSvg(textVal, x, y) {
    const attrs = {};
    return {
      textContent: textVal,
      attrs,
      setAttribute(k, v) { attrs[k] = v; },
      getAttribute(k) { return attrs[k]; },
      getBoundingClientRect() { return { left: x, right: x + 20, top: y, bottom: y + 12, width: 20, height: 12 }; }
    };
  }
  const n0Svg = mkBoxSvg('', 100, 50);
  const r0Svg = mkBoxSvg('', 140, 50);
  const lyrTextEl = mkBoxSvg('Hal', 102, 95);
  const dirTextEl = mkBoxSvg('molto', 105, 20);
  const mockSvgRoot = { querySelectorAll: sel => (sel === 'text' ? [lyrTextEl, dirTextEl] : []) };
  const instP1 = { IdString: 'P1', Visible: true };
  const mockML = [[{
    ParentStaff: { Id: 1, ParentInstrument: instP1 },
    staffEntries: [
      {
        relInMeasureTimestamp: { RealValue: 0 },
        graphicalVoiceEntries: [{
          parentVoiceEntry: { ParentVoice: { VoiceId: 1 } },
          notes: [{ sourceNote: { isRest: () => false, Pitch: { halfTone: dm0[0].midi - 12 }, Length: { RealValue: 0.25 } }, getSVGGElement: () => n0Svg }]
        }]
      },
      {
        relInMeasureTimestamp: { RealValue: 0.25 },
        graphicalVoiceEntries: [{
          parentVoiceEntry: { ParentVoice: { VoiceId: 1 } },
          notes: [{ sourceNote: { isRest: () => true, Length: { RealValue: 0.5 } }, getSVGGElement: () => r0Svg }]
        }]
      }
    ]
  }]];
  sfBuildTapMap(dm, mockML, [instP1], mockSvgRoot);
  check('tapMap sets data-sf-kind on note and rest',
    n0Svg.getAttribute('data-sf-kind') === 'note' && r0Svg.getAttribute('data-sf-kind') === 'rest');
  check('tapMap tags lyric <text> with data-sf-lyric',
    lyrTextEl.getAttribute('data-sf-lyric') === dm0[0].id);
  check('tapMap tags direction <text> with data-sf-dir',
    dirTextEl.getAttribute('data-sf-dir') === dirTap.entry.id);
}

// =========================================================================
// 10. Musical Markings Normalization, Clear Part Measure, and Spoken Choir Notes
// =========================================================================
{
  const normXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Choir</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><words>m f</words></direction-type></direction>
      <direction placement="above"><direction-type><words>rit.</words></direction-type></direction>
      <direction placement="above"><direction-type><words>spoken</words></direction-type></direction>
      <direction placement="above"><direction-type><words>shout</words></direction-type></direction>
      <direction placement="above"><direction-type><words>Verse 1</words></direction-type></direction>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <lyric number="1"><syllabic>single</syllabic><text>mf</text></lyric>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <lyric number="1"><syllabic>single</syllabic><text>p</text></lyric>
      </note>
      <note>
        <unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched>
        <duration>4</duration><voice>1</voice><type>quarter</type><notehead>x</notehead>
        <lyric number="1"><syllabic>single</syllabic><text>hey,</text></lyric>
      </note>
      <note>
        <pitch><step>C</step><octave>8</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><notehead>x</notehead>
        <lyric number="1"><syllabic>single</syllabic><text>hey!</text></lyric>
      </note>
      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

  const nm = sfParseMusicXml(normXml);
  const dirs = nm.parts[0].measures[0].entries.filter(e => e.kind === 'other' && e.tag === 'direction');
  check('sfNormalizeMusicalMarkings converts "m f" words to <dynamics><mf/></dynamics>',
    dirs[0].markingKind === 'dynamic' && dirs[0].rawXml.includes('<dynamics><mf/></dynamics>'));
  check('sfNormalizeMusicalMarkings marks "rit." as italic tempo',
    dirs[1].markingKind === 'tempo' && dirs[1].rawXml.includes('font-style="italic"'));
  check('sfNormalizeMusicalMarkings marks "spoken" and "shout" as italic vocal',
    dirs[2].markingKind === 'vocal' && dirs[2].rawXml.includes('font-style="italic"') &&
    dirs[3].markingKind === 'vocal' && dirs[3].rawXml.includes('font-style="italic"'));
  check('sfNormalizeMusicalMarkings keeps plain text "Verse 1" as text',
    dirs[4].markingKind === 'text');

  // Unambiguous lyric "mf" rescued into <dynamics><mf/></dynamics>, while single-letter "p" stays lyric
  const nmNotes = nm.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  check('unambiguous lyric "mf" rescued to dynamic direction and removed from lyric',
    sfGetNoteLyric(nmNotes[0], 1) === '' &&
    dirs.some(d => d.markingKind === 'dynamic' && d.rawXml.includes('placement="below"') && d.rawXml.includes('<mf/>')));
  check('ambiguous single-letter lyric "p" preserved as lyric',
    sfGetNoteLyric(nmNotes[1], 1) === 'p');

  // sfAddDirectionText auto-recognizes "pp" as dynamic
  const ppDir = sfAddDirectionText(nm, 0, 0, 'pp', { onsetQ: 1 });
  check('sfAddDirectionText("pp") formats as <dynamics><pp/></dynamics>',
    ppDir.ok && ppDir.entry.markingKind === 'dynamic' && ppDir.entry.rawXml.includes('<dynamics><pp/></dynamics>'));

  // Spoken / unpitched choir notes
  check('unpitched + <notehead>x</notehead> parsed as spoken note (not rest)',
    nmNotes[2].kind === 'note' && !nmNotes[2].isRest && nmNotes[2].spoken === true && nmNotes[2].notehead === 'x' &&
    sfGetNoteLyric(nmNotes[2], 1) === 'hey,');
  check('spoken note C8 is exempt from out_of_range, implausible_leap, and accidental_anomaly',
    sfAnalyzeFlags(nm, { instrument: 'flute' }).flaggedCount === 0);

  // Playback excludes spoken notes from pitched piano events and puts them in spokenEvents
  const nmPlay = sfModelToPlaybackScore(nm);
  check('sfModelToPlaybackScore excludes spoken notes from pitched events and collects spokenEvents',
    nmPlay.events.length === 2 && nmPlay.spokenEvents.length === 2);

  // sfToggleSpoken + .mxl round-trip
  const spOff = sfToggleSpoken(nm, nmNotes[2].id);
  check('sfToggleSpoken turns spoken off', spOff.ok && spOff.spoken === false && nmNotes[2].notehead === null);
  const spOn = sfToggleSpoken(nm, nmNotes[2].id);
  check('sfToggleSpoken turns spoken back on with notehead=x', spOn.ok && spOn.spoken === true && nmNotes[2].notehead === 'x');
  const nmMxl = sfExportMxl(nm);
  const nmRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(nmMxl)['score.musicxml'].data));
  const nmReNotes = nmRe.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  check('MXL round-trip preserves spoken <notehead>x</notehead>',
    nmReNotes[2].spoken === true && nmReNotes[2].notehead === 'x');

  // sfClearPartMeasure (single-staff + undoable + multi-staff)
  const clrHist = new SfHistory(nm);
  const clrRes = sfClearPartMeasure(nm, 0, 0);
  clrHist.push('Clear measure 1', nm);
  const clrEnts = nm.parts[0].measures[0].entries;
  check('sfClearPartMeasure leaves 1 whole-measure rest and preserves attributes & barline',
    clrRes.ok && clrRes.entry && clrRes.entry.measureRest === true &&
    clrEnts.filter(e => e.kind === 'note').length === 0 &&
    clrEnts.filter(e => e.kind === 'rest').length === 1 &&
    clrEnts.some(e => e.isAttributesSlot) &&
    clrEnts.some(e => e.tag === 'barline') &&
    nm.parts[0].measures[0].repeats.back === 2);
  const clrUndo = clrHist.undo();
  check('sfClearPartMeasure is undoable via SfHistory',
    clrUndo.parts[0].measures[0].entries.filter(e => e.kind === 'note').length === 4);

  // Multi-staff piano clear
  const pianoXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
  const pm = sfParseMusicXml(pianoXml);
  sfClearPartMeasure(pm, 0, 0);
  const pmRests = pm.parts[0].measures[0].entries.filter(e => e.kind === 'rest');
  check('sfClearPartMeasure on 2-staff piano creates 1 whole-measure rest per staff',
    pmRests.length === 2 && pmRests[0].staff === 1 && pmRests[1].staff === 2 && sfAnalyzeFlags(pm).flaggedCount === 0);
}

// =========================================================================
// 11. Split-Part Merging (sfPartNameAliasMatch, sfMergeParts, sfMergeSplitParts)
// =========================================================================
{
  check('sfPartNameAliasMatch: "1" <-> "Part 1", "2" <-> "Part 2", "I" <-> "Part I"',
    sfPartNameAliasMatch('1', 'Part 1') &&
    sfPartNameAliasMatch('Part 2.', '2') &&
    sfPartNameAliasMatch('I', 'Part I') &&
    !sfPartNameAliasMatch('1', 'Part 2'));
  check('sfPartNameAliasMatch: choral/band abbreviations',
    sfPartNameAliasMatch('S', 'Soprano') &&
    sfPartNameAliasMatch('Sop 1', 'Soprano 1') &&
    sfPartNameAliasMatch('Tpt 1', 'Trumpet 1') &&
    sfPartNameAliasMatch('Pno', 'Piano') &&
    !sfPartNameAliasMatch('Soprano 1', 'Soprano 2'));

  // Disjoint 5-part split score ("1", "2", "Part 1", "Part 2", "Piano") -> merges into 3 parts!
  const splitXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>1</part-name></score-part>
    <score-part id="P2"><part-name>2</part-name></score-part>
    <score-part id="P3"><part-name>Part 1</part-name></score-part>
    <score-part id="P4"><part-name>Part 2</part-name></score-part>
    <score-part id="P5"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><lyric number="1"><syllabic>single</syllabic><text>La</text></lyric></note>
    </measure>
    <measure number="2">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest measure="yes"/><duration>8</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><lyric number="1"><syllabic>single</syllabic><text>Da</text></lyric></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
  <part id="P4">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P5">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

  const sm = sfParseMusicXml(splitXml);
  check('sfMergeSplitParts collapses 5 disjoint parts into 3 (Part 1, Part 2, Piano)',
    sm.parts.length === 3 &&
    sm.parts[0].name === 'Part 1' &&
    sm.parts[1].name === 'Part 2' &&
    sm.parts[2].name === 'Piano' &&
    sm.mergedParts.length === 2);

  // Verify merged M2 notes + lyrics + divisions rescaling (div 2 -> 4)
  const smP1M2 = sm.parts[0].measures[1].entries.filter(e => e.kind === 'note');
  check('merged Part 1 M2 preserves both notes, lyric "Da", and rescaled durations (2.0Q each)',
    smP1M2.length === 2 &&
    sfGetNoteLyric(smP1M2[0], 1) === 'Da' &&
    approx(smP1M2[0].durationQ, 2.0) &&
    approx(smP1M2[1].durationQ, 2.0));

  // Verify exported XML <part-list> matches model.parts 1-to-1 with no orphaned IDs
  const smExported = sfExportMusicXml(sm);
  const scorePartMatches = smExported.match(/<score-part\b/g) || [];
  check('exported <part-list> has exact 3 <score-part> entries with updated names',
    scorePartMatches.length === 3 &&
    smExported.includes('<part-name>Part 1</part-name>') &&
    smExported.includes('<part-name>Part 2</part-name>') &&
    !smExported.includes('id="P3"') && !smExported.includes('id="P4"'));

  // Round-trip through .mxl
  const smRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(sfExportMxl(sm))['score.musicxml'].data));
  check('.mxl round-trip preserves merged 3-part structure and playback events',
    smRe.parts.length === 3 && sfModelToPlaybackScore(smRe).events.length === 7);

  // Overlapping parts with matching alias ("1" and "Part 1" BOTH have notes in M1) must NEVER auto-merge!
  const overlapXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>1</part-name></score-part>
    <score-part id="P2"><part-name>Part 1</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
  const om = sfParseMusicXml(overlapXml);
  check('overlapping parts with alias names are NEVER auto-merged',
    om.parts.length === 2 && om.mergedParts.length === 0);
}

// =========================================================================
// 12. Measure Copy & Paste ('all' and 'rhythm' modes)
// =========================================================================
{
  const cpXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>quarter</type><dot/><lyric number="1"><syllabic>single</syllabic><text>Joy</text></lyric></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note><rest/><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="3">
      <attributes><divisions>4</divisions></attributes>
      <direction placement="above"><direction-type><words>dolce</words></direction-type></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><lyric number="1"><syllabic>single</syllabic><text>Sing</text></lyric></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>
    </measure>
    <measure number="4">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

  const cm = sfParseMusicXml(cpXml);
  const cpHist = new SfHistory(cm);

  // 'all' mode: copy M1..M2 (div 2) and paste onto M3..M4 (div 4) -> preserves M3 barline & rescales durations
  const clipAll = sfCopyMeasures(cm, 0, 0, 1, 'all');
  check('sfCopyMeasures("all") captures 2 measures',
    clipAll && clipAll.mode === 'all' && clipAll.count === 2 && clipAll.startNumber === '1' && clipAll.endNumber === '2');

  const pasteAllRes = sfPasteMeasures(cm, clipAll, 0, 2);
  cpHist.push('Paste all M1-2 to M3-4', cm);
  const m3Notes = cm.parts[0].measures[2].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  const m3Dirs = cm.parts[0].measures[2].entries.filter(e => e.kind === 'other' && e.tag === 'direction');
  check('sfPasteMeasures("all") copies notes, lyrics, dynamics, rescales divisions, preserves barline',
    pasteAllRes.ok && pasteAllRes.pastedCount === 2 &&
    m3Notes.length === 3 &&
    m3Notes[0].step === 'C' && approx(m3Notes[0].durationQ, 1.5) && sfGetNoteLyric(m3Notes[0], 1) === 'Joy' &&
    m3Notes[2].isRest === true && approx(m3Notes[2].durationQ, 2.0) &&
    m3Dirs.some(d => sfGetDirectionText(d) === 'mf') &&
    cm.parts[0].measures[2].repeats.back === 2);

  // Undo restores original M3 (G4, A4, B4 + dolce + "Sing")
  const cmUndo = cpHist.undo();
  check('paste all is undoable via SfHistory',
    cmUndo.parts[0].measures[2].entries.filter(e => e.kind === 'note')[0].step === 'G');

  // 'rhythm' mode: copy M1 rhythm (dotted quarter + eighth + half rest) onto M3 (which has G4, A4, B4 + "Sing" + "dolce")
  const clipRhy = sfCopyMeasures(cmUndo, 0, 0, 0, 'rhythm');
  check('sfCopyMeasures("rhythm") captures 1 measure rhythm',
    clipRhy && clipRhy.mode === 'rhythm' && clipRhy.count === 1);

  const pasteRhyM3 = sfPasteMeasures(cmUndo, clipRhy, 0, 2);
  const rM3Entries = cmUndo.parts[0].measures[2].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  const rM3Dirs = cmUndo.parts[0].measures[2].entries.filter(e => e.kind === 'other' && e.tag === 'direction');
  check('sfPasteMeasures("rhythm") applies dotted-quarter + eighth + half-rest while preserving target pitches, lyric, and direction',
    pasteRhyM3.ok &&
    rM3Entries.length === 3 &&
    rM3Entries[0].step === 'G' && approx(rM3Entries[0].durationQ, 1.5) && sfGetNoteLyric(rM3Entries[0], 1) === 'Sing' &&
    rM3Entries[1].step === 'A' && approx(rM3Entries[1].durationQ, 0.5) &&
    rM3Entries[2].isRest === true && approx(rM3Entries[2].durationQ, 2.0) &&
    rM3Dirs.some(d => sfGetDirectionText(d) === 'dolce'));

  // 'rhythm' mode onto empty/whole-rest M4 uses fallback pitch (A4 from M3)
  const pasteRhyM4 = sfPasteMeasures(cmUndo, clipRhy, 0, 3);
  const rM4Entries = cmUndo.parts[0].measures[3].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  check('sfPasteMeasures("rhythm") onto rest measure uses fallback pitch',
    pasteRhyM4.ok &&
    rM4Entries.length === 3 &&
    !rM4Entries[0].isRest && approx(rM4Entries[0].durationQ, 1.5) &&
    !rM4Entries[1].isRest && approx(rM4Entries[1].durationQ, 0.5) &&
    rM4Entries[2].isRest === true && approx(rM4Entries[2].durationQ, 2.0));

  // Round-trip pasted score through .mxl
  const cpMxlRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(sfExportMxl(cmUndo))['score.musicxml'].data));
  check('.mxl round-trip preserves rhythm-pasted measure cleanly',
    cpMxlRe.parts[0].measures[2].entries.filter(e => e.kind === 'note').length === 2 &&
    cpMxlRe.parts[0].measures[2].entries.filter(e => e.kind === 'rest').length === 1);
}

// =========================================================================
// 13. Note Input (sfStaffStepToPitch, sfPlaceNoteAt), Chord Stacking, & Grand-Staff <backup> Sync
// =========================================================================
{
  // sfStaffStepToPitch: treble, bass, alto, ledger lines, key sig, accidental override
  const trTop = sfStaffStepToPitch('G', 2, 0, 0);
  const trBot = sfStaffStepToPitch('G', 2, 8, 1); // F# in G major? bottom line is E4 (alter 0); step 2 is D5, step 0 is F#5!
  const trTopG = sfStaffStepToPitch('G', 2, 0, 1);
  const trLedgerAbove = sfStaffStepToPitch('G', 2, -2, 0); // A5
  const baTop = sfStaffStepToPitch('F', 4, 0, -2); // A3 (0)
  const baBot = sfStaffStepToPitch('F', 4, 8, 0); // G2
  const alTop = sfStaffStepToPitch('C', 3, 0, 0); // G4
  const trSharpOv = sfStaffStepToPitch('G', 2, 3, 0, 'sharp'); // C#5

  check('sfStaffStepToPitch treble top line = F5, bottom = E4, ledger -2 = A5',
    trTop.step === 'F' && trTop.octave === 5 && trTop.midi === 77 &&
    trBot.step === 'E' && trBot.octave === 4 &&
    trTopG.alter === 1 && trTopG.midi === 78 &&
    trLedgerAbove.step === 'A' && trLedgerAbove.octave === 5 && trLedgerAbove.midi === 81);
  check('sfStaffStepToPitch bass top=A3, bottom=G2, alto top=G4, override C#5',
    baTop.step === 'A' && baTop.octave === 3 &&
    baBot.step === 'G' && baBot.octave === 2 &&
    alTop.step === 'G' && alTop.octave === 4 &&
    trSharpOv.step === 'C' && trSharpOv.octave === 5 && trSharpOv.alter === 1 && trSharpOv.accidental === 'sharp');

  // sfPlaceNoteAt: split whole-measure rest -> quarter note + half + quarter rests summing to 4/4
  const npXml = makeXml([
    '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>'
  ]);
  const npm = sfParseMusicXml(npXml);
  const npHist = new SfHistory(npm);
  const p1 = sfPlaceNoteAt(npm, { partIndex: 0, measureIndex: 0, step: 'G', octave: 4, alter: 0, type: 'quarter', dots: 0 });
  npHist.push('Place G4 quarter', npm);
  const npEnts = npm.parts[0].measures[0].entries.filter(e => e.kind === 'note' || e.kind === 'rest');
  const npSum = npEnts.reduce((s, e) => s + e.durationQ, 0);
  check('sfPlaceNoteAt splits whole-measure rest into G4 quarter + dotted-half rest (sum 4.0Q)',
    p1.ok && p1.changed && npEnts.length === 2 &&
    npEnts[0].step === 'G' && approx(npEnts[0].durationQ, 1) &&
    npEnts[1].isRest && approx(npEnts[1].durationQ, 3) &&
    approx(npSum, 4.0));

  // Replace existing note pitch
  const pRep = sfPlaceNoteAt(npm, { partIndex: 0, measureIndex: 0, targetEntryId: p1.entry.id, step: 'A', octave: 4, alter: 0, type: 'quarter', dots: 0 });
  check('sfPlaceNoteAt replaces existing note pitch cleanly',
    pRep.ok && pRep.entry.step === 'A' && pRep.entry.midi === 69);

  // Stack chord tones (sfStackChordNote & addChord)
  const st1 = sfStackChordNote(npm, p1.entry.id); // stacks C5 (+2 diatonic steps above A4)
  npHist.push('Stack C5', npm);
  check('sfStackChordNote stacks C5 above A4',
    st1.ok && st1.changed && st1.entry.isChord === true && st1.entry.step === 'C' && st1.entry.octave === 5);
  const st2 = sfPlaceNoteAt(npm, { partIndex: 0, measureIndex: 0, targetEntryId: p1.entry.id, addChord: true, step: 'E', octave: 5, alter: 0, type: 'quarter' });
  check('sfPlaceNoteAt(addChord:true) stacks 3rd tone E5',
    st2.ok && st2.changed && st2.entry.isChord === true && st2.entry.step === 'E' && st2.entry.octave === 5);
  const stDup = sfPlaceNoteAt(npm, { partIndex: 0, measureIndex: 0, targetEntryId: p1.entry.id, addChord: true, step: 'C', octave: 5, alter: 0, type: 'quarter' });
  check('sfPlaceNoteAt(addChord:true) skips duplicate chord pitch',
    stDup.ok && !stDup.changed);

  // Playback emits all 3 stacked MIDI pitches simultaneously
  const npPlay = sfModelToPlaybackScore(npm);
  check('playback emits all 3 stacked chord pitches at q=0',
    npPlay.events.length === 3 && npPlay.events.every(e => approx(e.q, 0)));

  // .mxl round-trip & undo/redo
  const npRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(sfExportMxl(npm))['score.musicxml'].data));
  check('.mxl round-trip preserves 3-note chord and split rest',
    npRe.parts[0].measures[0].entries.filter(e => e.kind === 'note').length === 3 &&
    npRe.parts[0].measures[0].entries.filter(e => e.kind === 'rest').length === 1);
  const npUndo = npHist.undo();
  check('SfHistory undo removes stacked chord',
    npUndo.parts[0].measures[0].entries.filter(e => e.kind === 'note').length === 1);

  // Grand-staff <backup> sync regression test (#69)
  const grandXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
  const gm = sfParseMusicXml(grandXml);
  const gStaff1First = gm.parts[0].measures[0].entries.find(e => e.kind === 'note' && e.staff === 1);
  // Delete 1 quarter note from Staff 1 (Staff 1 total drops 4 -> 3)
  sfDeleteOrMakeRest(gm, gStaff1First.id, 'delete');
  const gmExported = sfExportMusicXml(gm);
  const gmRe = sfParseMusicXml(gmExported);
  const gmBackup = gmRe.parts[0].measures[0].entries.find(e => e.kind === 'backup');
  const gmStaff2 = gmRe.parts[0].measures[0].entries.find(e => e.kind === 'note' && e.staff === 2);
  check('grand-staff <backup> shrinks to match edited Staff 1 total and keeps Staff 2 at onsetQ === 0',
    gmBackup && gmBackup.durationDivs === 3 && gmStaff2 && approx(gmStaff2.onsetQ, 0));

  // Regression tests (#83): sfInsertAfter on blank whole-measure rest starts at beat 1 (onsetQ === 0)
  // AND Piano Staff 2 (bass clef) defaults to D3, NOT B4!
  const blankBarXml = makeXml([
    '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>'
  ]);
  const bbm = sfParseMusicXml(blankBarXml);
  const blankRest = bbm.parts[0].measures[0].entries.find(e => e.kind === 'rest');
  const insBeat1 = sfInsertAfter(bbm, blankRest.id, 'note', { type: 'quarter' });
  const insBeat2 = sfInsertAfter(bbm, insBeat1.entry.id, 'note', { type: 'quarter' });
  check('sfInsertAfter on blank whole-measure rest places note 1 at onsetQ===0 and note 2 at onsetQ===1',
    insBeat1.ok && approx(insBeat1.entry.onsetQ, 0) &&
    insBeat2.ok && approx(insBeat2.entry.onsetQ, 1));

  const pianoBlankXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest measure="yes"/><duration>16</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
  const pbm = sfParseMusicXml(pianoBlankXml);
  const staff2Rest = pbm.parts[0].measures[0].entries.find(e => e.kind === 'rest' && e.staff === 2);
  const insBass = sfInsertAfter(pbm, staff2Rest.id, 'note', { type: 'quarter' });
  check('sfInsertAfter on Piano Staff 2 (bass clef) defaults to D3 at onsetQ===0 (not B4)',
    insBass.ok && insBass.entry.step === 'D' && insBass.entry.octave === 3 && approx(insBass.entry.onsetQ, 0));

  const pbm2 = sfParseMusicXml(pianoBlankXml);
  const staff2Rest2 = pbm2.parts[0].measures[0].entries.find(e => e.kind === 'rest' && e.staff === 2);
  const r2nBass = sfRestToNote(pbm2, staff2Rest2.id);
  check('sfRestToNote on Piano Staff 2 (bass clef) defaults to D3 (not B4)',
    r2nBass.ok && r2nBass.entry.step === 'D' && r2nBass.entry.octave === 3);

  // Grand-staff independent staff Clear / Copy / Paste (#92)
  const grandEditXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
  const gEdit = sfParseMusicXml(grandEditXml);
  const gHist = new SfHistory(gEdit);

  // Clear ONLY Staff 1 (Treble) in M1 -> Staff 2 (Bass C3) stays intact at onsetQ===0
  const clrTreble = sfClearPartMeasure(gEdit, 0, 0, 1);
  gHist.push('Clear Piano Treble M1', gEdit);
  const gM1Treble = gEdit.parts[0].measures[0].entries.filter(e => (e.kind === 'note' || e.kind === 'rest') && e.staff === 1);
  const gM1Bass = gEdit.parts[0].measures[0].entries.filter(e => (e.kind === 'note' || e.kind === 'rest') && e.staff === 2);
  check('sfClearPartMeasure(..., staff=1) clears ONLY Treble and leaves Bass C3 at onsetQ===0',
    clrTreble.ok && gM1Treble.length === 1 && gM1Treble[0].isRest && gM1Treble[0].measureRest &&
    gM1Bass.length === 1 && gM1Bass[0].step === 'C' && gM1Bass[0].octave === 3 && approx(gM1Bass[0].onsetQ, 0));

  // Copy ONLY Treble from M2 and paste ('all') onto M1 Treble -> M1 Bass C3 stays intact!
  const clipTrebleAll = sfCopyMeasures(gEdit, 0, 1, 1, 'all', 1);
  check('sfCopyMeasures(..., "all", staff=1) captures only Treble entries with staffLabel=Treble',
    clipTrebleAll && clipTrebleAll.staff === 1 && clipTrebleAll.staffLabel === 'Treble' && clipTrebleAll.measures[0].entries.length === 3);
  sfPasteMeasures(gEdit, clipTrebleAll, 0, 0, 1);
  gHist.push('Paste Treble M2->M1', gEdit);
  const gM1TrebleAfter = gEdit.parts[0].measures[0].entries.filter(e => (e.kind === 'note' || e.kind === 'rest') && e.staff === 1);
  const gM1BassAfter = gEdit.parts[0].measures[0].entries.filter(e => (e.kind === 'note' || e.kind === 'rest') && e.staff === 2);
  check('sfPasteMeasures(..., staff=1) replaces only Treble and keeps Bass C3 at onsetQ===0',
    gM1TrebleAfter.length === 3 && gM1TrebleAfter[0].step === 'G' &&
    gM1BassAfter.length === 1 && gM1BassAfter[0].step === 'C' && approx(gM1BassAfter[0].onsetQ, 0));

  // Copy ONLY Treble rhythm from M2 (quarter, quarter, half) and paste ('rhythm') onto M1 Bass (targetStaff=2)
  // -> M1 Bass keeps F/C3 pitch, gets quarter-quarter-half rhythm, voice does NOT collide with Treble voice 1, Treble untouched!
  const clipTrebleRhy = sfCopyMeasures(gEdit, 0, 1, 1, 'rhythm', 1);
  sfPasteMeasures(gEdit, clipTrebleRhy, 0, 0, 2);
  const gM1TrebleRhy = gEdit.parts[0].measures[0].entries.filter(e => (e.kind === 'note' || e.kind === 'rest') && e.staff === 1);
  const gM1BassRhy = gEdit.parts[0].measures[0].entries.filter(e => (e.kind === 'note' || e.kind === 'rest') && e.staff === 2);
  check('sfPasteMeasures("rhythm", targetStaff=2) pastes rhythm onto Bass keeping C3, non-colliding voice, and Treble untouched',
    gM1TrebleRhy.length === 3 && gM1TrebleRhy[0].step === 'G' &&
    gM1BassRhy.length === 3 && gM1BassRhy[0].step === 'C' && approx(gM1BassRhy[0].durationQ, 1) &&
    approx(gM1BassRhy[2].durationQ, 2) && approx(gM1BassRhy[0].onsetQ, 0) &&
    gM1BassRhy[0].voice !== gM1TrebleRhy[0].voice);

  // .mxl round-trip & undo
  const gRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(sfExportMxl(gEdit))['score.musicxml'].data));
  const gReBass = gRe.parts[0].measures[0].entries.filter(e => e.kind === 'note' && e.staff === 2);
  check('.mxl round-trip preserves independent grand-staff paste with Bass at onsetQ===0',
    gReBass.length === 3 && approx(gReBass[0].onsetQ, 0));
  const gUndo = gHist.undo();
  check('SfHistory undo restores grand-staff state cleanly',
    gUndo.parts[0].measures[0].entries.filter(e => e.kind === 'note' && e.staff === 2).length === 1);
}

// =========================================================================
// 14. OCR Lyric Cleanup, Cross-Part Signature Consensus, & 1-Click Rhythm Auto-Fix
// =========================================================================
{
  // 14a. sfCleanOcrLyrics
  const ocrLyrXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>' +
    '<lyric number="1"><syllabic>single</syllabic><text>ste‘f</text></lyric></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>' +
    '<lyric number="1"><syllabic>single</syllabic><text>Tore</text></lyric></note>' +
    '<note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>' +
    '<lyric number="1"><syllabic>single</syllabic><text>love|</text></lyric></note>' +
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>' +
    '<lyric number="1"><syllabic>single</syllabic><text>I’m</text></lyric></note>'
  ]);
  const olm = sfParseMusicXml(ocrLyrXml);
  const olNotes = olm.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  const cleanRes = sfCleanOcrLyrics(olm, ['monster', 'ster', 'fore', 'love', "I'm"]);
  check('sfCleanOcrLyrics fixes "ste‘f"->"ster", "Tore"->"Fore", "love|"->"love" and normalizes "I’m"->"I\'m"',
    cleanRes.fixedCount === 4 &&
    sfGetNoteLyric(olNotes[0], 1) === 'ster' &&
    sfGetNoteLyric(olNotes[1], 1) === 'Fore' &&
    sfGetNoteLyric(olNotes[2], 1) === 'love' &&
    sfGetNoteLyric(olNotes[3], 1) === "I'm");

  // 14b. sfAlignPartSignatures (concert-pitch outlier fixed; transposing Bb Trumpet preserved!)
  const sigXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Alto</part-name></score-part>
    <score-part id="P3"><part-name>Piano</part-name></score-part>
    <score-part id="P4"><part-name>Bb Trumpet</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
  </measure></part>
  <part id="P2"><measure number="1">
    <attributes><divisions>4</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
  </measure></part>
  <part id="P3"><measure number="1">
    <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
  </measure></part>
  <part id="P4"><measure number="1">
    <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
  </measure></part>
</score-partwise>`;
  const sm = sfParseMusicXml(sigXml);
  check('sfAlignPartSignatures fixes Piano 3/4->4/4 & key 0->-2, preserves Bb Trumpet fifths=0',
    sm.parts[2].measures[0].time.beats === 4 &&
    sm.parts[2].measures[0].key.fifths === -2 &&
    sm.parts[3].measures[0].key.fifths === 0 &&
    sm.autoRepairs.length === 2);

  // 14c. sfSuggestRhythmFixes + sfApplyRhythmFix across all 4 fix kinds (M0 is clean 4/4 so M1 isn't treated as pickup)
  // M1: missing dot (quarter G4 + eighth A4 + half B4 = 3.5 beats -> add dot to G4)
  // M2: extra dot (dotted quarter C5 + quarter D5 + half E5 = 4.5 beats -> remove dot from C5)
  // M3: wrong duration (eighth F4 + quarter G4 + half A4 = 3.5 beats -> change F4 to quarter)
  // M4: trailing rest fill (half G4 + quarter A4 = 3.0 beats -> add quarter rest)
  const rhyXml = makeXml([
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>' +
    '<note><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>',
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><type>quarter</type><dot/></note>' +
    '<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>',
    '<note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>' +
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>',
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>'
  ], { partName: 'Soprano' });
  const rm = sfParseMusicXml(rhyXml);
  const rFlags0 = sfAnalyzeFlags(rm);
  const sugs = sfSuggestRhythmFixes(rm, rFlags0);

  const sAddDot = sugs.find(s => s.measureIndex === 1 && s.kind === 'add_dot');
  const sRemDot = sugs.find(s => s.measureIndex === 2 && s.kind === 'remove_dot');
  const sChgDur = sugs.find(s => s.measureIndex === 3 && s.kind === 'change_duration' && s.newType === 'quarter');
  const sFillRest = sugs.find(s => s.measureIndex === 4 && s.kind === 'fill_rest' && s.restType === 'quarter');

  check('sfSuggestRhythmFixes detects add_dot, remove_dot, change_duration, and fill_rest',
    !!sAddDot && !!sRemDot && !!sChgDur && !!sFillRest);

  check('sfApplyRhythmFix applies all 4 fixes cleanly',
    sfApplyRhythmFix(rm, sAddDot).ok &&
    sfApplyRhythmFix(rm, sRemDot).ok &&
    sfApplyRhythmFix(rm, sChgDur).ok &&
    sfApplyRhythmFix(rm, sFillRest).ok);

  const rFlagsAfter = sfAnalyzeFlags(rm);
  check('all duration_mismatch flags clear completely after applying rhythm auto-fixes',
    rFlagsAfter.measures.every(m => !m.findings.some(f => f.rule === 'duration_mismatch')));
}

// =========================================================================
// 15. Selectable & Deletable Ties (sfRemoveTie + SVG data-sf-tie Tagging)
// =========================================================================
{
  const tieSplitXml = makeXml([
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><tie type="start"/><voice>1</voice><type>half</type><notations><tied type="start"/></notations></note>' +
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>quarter</type><notations><tied type="stop"/></notations></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><type>quarter</type><notations><tied type="start"/></notations></note>',
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration><tie type="stop"/><voice>1</voice><type>whole</type><notations><tied type="stop"/></notations></note>'
  ]);
  const tm = sfParseMusicXml(tieSplitXml);
  const tHist = new SfHistory(tm);
  const tM0 = tm.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  const tM1 = tm.parts[0].measures[1].entries.filter(e => e.kind === 'note');

  // Before removing ties: 2 merged playback events (G4 3.0Q, A4 5.0Q)
  const playBefore = sfModelToPlaybackScore(tm);
  check('tied score initially emits 2 merged playback events', playBefore.events.length === 2);

  // Remove intra-measure tie G4->G4
  const remIntra = sfRemoveTie(tm, tM0[0].id);
  tHist.push('Remove intra-measure tie', tm);
  check('sfRemoveTie removes intra-measure tie and preserves both notes',
    remIntra.ok && remIntra.changed &&
    tM0[0].ties.length === 0 && tM0[1].ties.length === 0 &&
    !tM0[0].extraXml.includes('<tied') && !tM0[1].extraXml.includes('<tied') &&
    approx(tM0[0].durationQ, 2) && approx(tM0[1].durationQ, 1));

  // Remove across-barline tie A4(m0)->A4(m1) by passing the stop note id!
  const remBarline = sfRemoveTie(tm, tM1[0].id);
  check('sfRemoveTie on stop note removes across-barline tie cleanly',
    remBarline.ok && remBarline.changed &&
    tM0[2].ties.length === 0 && tM1[0].ties.length === 0 &&
    !tM0[2].extraXml.includes('<tied') && !tM1[0].extraXml.includes('<tied'));

  // Playback now emits 4 separate events!
  const playAfter = sfModelToPlaybackScore(tm);
  check('playback emits 4 separate untied events after removing both ties',
    playAfter.events.length === 4);

  // .mxl round-trip preserves untied notes
  const tmRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(sfExportMxl(tm))['score.musicxml'].data));
  check('.mxl round-trip preserves untied notes',
    tmRe.parts[0].measures[0].entries.filter(e => e.kind === 'note').every(n => n.ties.length === 0));

  // Undo restores intra-measure tie on G4->G4 (and A4 barline tie before remBarline)
  const tmUndo = tHist.undo();
  const uNotes = tmUndo.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  check('SfHistory undo restores removed tie',
    uNotes[0].ties.includes('start') && uNotes[1].ties.includes('stop'));

  // SVG tie tagging in sfBuildTapMap
  function mkTieMockEl(cls, x, y) {
    const attrs = { class: cls };
    return {
      attrs,
      setAttribute(k, v) { attrs[k] = v; },
      getAttribute(k) { return attrs[k]; },
      getBoundingClientRect() { return { left: x, right: x + 30, top: y, bottom: y + 8, width: 30, height: 8 }; }
    };
  }
  const nG0Svg = mkTieMockEl('vf-stavenote', 100, 60);
  const nG1Svg = mkTieMockEl('vf-stavenote', 150, 60);
  const nA0Svg = mkTieMockEl('vf-stavenote', 200, 55);
  const tieArcSvg = mkTieMockEl('vf-stavetie', 110, 62);
  const slurArcSvg = mkTieMockEl('vf-slur', 110, 50);
  const mockSvg = {
    querySelectorAll: sel => sel === 'text' ? [] : [tieArcSvg, slurArcSvg]
  };
  const instP1 = { IdString: 'P1', Visible: true };
  const mockML = [[{
    ParentStaff: { Id: 1, ParentInstrument: instP1 },
    staffEntries: [
      { relInMeasureTimestamp: { RealValue: 0 }, graphicalVoiceEntries: [{ parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [{ sourceNote: { isRest: () => false, Pitch: { halfTone: 67 - 12 }, Length: { RealValue: 0.5 } }, getSVGGElement: () => nG0Svg }] }] },
      { relInMeasureTimestamp: { RealValue: 0.5 }, graphicalVoiceEntries: [{ parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [{ sourceNote: { isRest: () => false, Pitch: { halfTone: 67 - 12 }, Length: { RealValue: 0.25 } }, getSVGGElement: () => nG1Svg }] }] },
      { relInMeasureTimestamp: { RealValue: 0.75 }, graphicalVoiceEntries: [{ parentVoiceEntry: { ParentVoice: { VoiceId: 1 } }, notes: [{ sourceNote: { isRest: () => false, Pitch: { halfTone: 69 - 12 }, Length: { RealValue: 0.25 } }, getSVGGElement: () => nA0Svg }] }] }
    ]
  }]];
  const tieMap = sfBuildTapMap(tmUndo, mockML, [instP1], mockSvg);
  check('sfBuildTapMap tags .vf-stavetie with data-sf-tie and ignores slurs',
    tieArcSvg.getAttribute('data-sf-tie') === uNotes[0].id &&
    !slurArcSvg.getAttribute('data-sf-tie') &&
    Array.isArray(tieMap.ties) && tieMap.ties.length === 1);

  // Curly-quote lyric + .vf-dynamics SVG tagging (#120)
  sfSetNoteLyric(tmUndo, uNotes[0].id, '\u2018Cause');
  const dynDir = sfAddDirectionText(tmUndo, 0, 0, 'mf', { onsetQ: 0 });
  const curlyLyrSvg = mkTieMockEl('vf-lyric', 100, 95);
  curlyLyrSvg.textContent = "'Cause";
  const vfDynSvg = mkTieMockEl('vf-dynamics', 102, 80);
  const mockSvgDyn = {
    querySelectorAll: sel => sel === 'text' ? [curlyLyrSvg] : (sel.includes('vf-dynamics') ? [vfDynSvg] : [])
  };
  sfBuildTapMap(tmUndo, mockML, [instP1], mockSvgDyn);
  check('sfBuildTapMap matches curly-quote lyric and tags .vf-dynamics with data-sf-dir',
    curlyLyrSvg.getAttribute('data-sf-lyric') === uNotes[0].id &&
    vfDynSvg.getAttribute('data-sf-dir') === dynDir.entry.id);
}

// =========================================================================
// 16. Scan Mode Filtering (sfFilterScoreByMode: full, notes-lyrics, notes-only)
// =========================================================================
{
  const modeXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><words>Allegro</words></direction-type></direction>
      <direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><type>quarter</type>
        <notations><tied type="start"/><slur type="start" number="1"/><articulations><staccato/></articulations><fermata type="upright"/></notations>
        <lyric number="1"><syllabic>single</syllabic><text>Sing</text></lyric>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>quarter</type>
        <notations><tied type="stop"/><slur type="stop" number="1"/></notations>
        <lyric number="1"><syllabic>single</syllabic><text>out</text></lyric>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><notehead>x</notehead>
        <lyric number="1"><syllabic>single</syllabic><text>hey!</text></lyric>
      </note>
    </measure>
  </part>
</score-partwise>`;

  // 'full' mode is a no-op
  const mFull = sfParseMusicXml(modeXml);
  const resFull = sfFilterScoreByMode(mFull, 'full');
  check('sfFilterScoreByMode("full") is a no-op',
    resFull.mode === 'full' && resFull.removedDirections === 0 && resFull.removedLyrics === 0 && resFull.removedNotations === 0);

  // 'notes-lyrics' strips directions, harmony, slur/articulations/fermata, keeps lyrics, ties, and spoken X-notehead
  const mNL = sfParseMusicXml(modeXml);
  const resNL = sfFilterScoreByMode(mNL, 'notes-lyrics');
  const nlNotes = mNL.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  const nlXml = sfExportMusicXml(mNL);
  const nlRe = sfParseMusicXml(nlXml);
  check('sfFilterScoreByMode("notes-lyrics") removes directions/harmony/noisy notations while keeping lyrics, ties, spoken',
    resNL.mode === 'notes-lyrics' &&
    resNL.removedDirections === 3 &&
    resNL.removedLyrics === 0 &&
    resNL.removedNotations >= 4 &&
    nlNotes[0].ties.includes('start') && nlNotes[1].ties.includes('stop') &&
    nlNotes[2].spoken === true &&
    sfGetNoteLyric(nlNotes[0], 1) === 'Sing' &&
    !nlXml.includes('<slur') && !nlXml.includes('<staccato') && !nlXml.includes('<fermata') && !nlXml.includes('<harmony') &&
    nlXml.includes('<tied type="start"/>') && nlRe.parts[0].measures[0].entries.filter(e => e.kind === 'note')[0].ties.includes('start'));

  // 'notes-only' also removes all lyrics while preserving ties and spoken X-notehead
  const mNO = sfParseMusicXml(modeXml);
  const resNO = sfFilterScoreByMode(mNO, 'notes-only');
  const noNotes = mNO.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  const noXml = sfExportMusicXml(mNO);
  check('sfFilterScoreByMode("notes-only") also removes all lyrics while keeping ties and spoken X-notehead',
    resNO.mode === 'notes-only' &&
    resNO.removedDirections === 3 &&
    resNO.removedLyrics === 3 &&
    noNotes[0].ties.includes('start') && noNotes[1].ties.includes('stop') &&
    noNotes[2].spoken === true &&
    !noXml.includes('<lyric') && noXml.includes('<tied type="start"/>'));
}

// =========================================================================
// 17. Header / Credit / Title / Metronome Erasure & Tap-Map Tagging (#141)
// =========================================================================
{
  const hdrXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Messy OMR Title</work-title></work>
  <movement-title>Movement I</movement-title>
  <identification>
    <creator type="composer">Jane Composer</creator>
    <creator type="lyricist">Bob Lyricist</creator>
  </identification>
  <defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults>
  <credit page="1"><credit-words>Page 1 Junk Header</credit-words></credit>
  <credit page="1"><credit-words>Copyright 2026</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>69</per-minute></metronome></direction-type><sound tempo="69"/></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

  const hm = sfParseMusicXml(hdrXml);
  const hTexts = sfGetHeaderTexts(hm);
  check('sfGetHeaderTexts extracts work-title, movement-title, creators, and credits',
    hTexts.length === 6 &&
    hTexts.some(h => h.kind === 'work-title' && h.text === 'Messy OMR Title') &&
    hTexts.some(h => h.kind === 'movement-title' && h.text === 'Movement I') &&
    hTexts.filter(h => h.kind === 'creator').length === 2 &&
    hTexts.filter(h => h.kind === 'credit').length === 2);

  // Remove a single credit by text and work-title by spec, keeping <part-list> & <defaults> intact
  const remCredit = sfRemoveHeaderText(hm, 'Page 1 Junk Header');
  const remTitle = sfRemoveHeaderText(hm, { kind: 'work-title', index: 0, text: 'Messy OMR Title' });
  check('sfRemoveHeaderText removes targeted credit and work-title while keeping part-list & defaults',
    remCredit === true && remTitle === true &&
    hm.workTitle === '' &&
    hm.headerXml.includes('<part-list>') &&
    hm.headerXml.includes('<defaults>') &&
    !hm.headerXml.includes('Page 1 Junk Header') &&
    !hm.headerXml.includes('Messy OMR Title') &&
    hm.headerXml.includes('Copyright 2026'));

  // Clear all remaining header credits/creators/movement-title
  const clearedN = sfClearHeaderCredits(hm, { includeTitle: true });
  const hmExported = sfExportMusicXml(hm);
  const hmRe = sfParseMusicXml(hmExported);
  check('sfClearHeaderCredits removes remaining credits/creators while keeping part-list & defaults, re-parses cleanly',
    clearedN >= 4 &&
    sfGetHeaderTexts(hm).length === 0 &&
    hmExported.includes('<part-list>') &&
    hmExported.includes('<defaults>') &&
    !hmExported.includes('Copyright 2026') &&
    hmRe.parts.length === 1);

  // sfBuildTapMap tags header <text> with data-sf-header and metronome "= 69" with data-sf-dir
  const hm2 = sfParseMusicXml(hdrXml);
  const metroDir = hm2.parts[0].measures[0].entries.find(e => e.kind === 'other' && e.tag === 'direction');
  function mkEl(txt, x, y) {
    const attrs = {};
    return {
      textContent: txt,
      attrs,
      setAttribute(k, v) { attrs[k] = v; },
      getAttribute(k) { return attrs[k]; },
      getBoundingClientRect() { return { left: x, right: x + 40, top: y, bottom: y + 12, width: 40, height: 12 }; }
    };
  }
  const nC5 = mkEl('', 100, 80);
  const metroTxt = mkEl('♩ = 69', 102, 55);
  const hdrTitleTxt = mkEl('Messy OMR Title', 200, 10);
  const hdrCreditTxt = mkEl('Page 1 Junk Header', 50, 15);
  const mockSvgHdr = { querySelectorAll: sel => sel === 'text' ? [metroTxt, hdrTitleTxt, hdrCreditTxt] : [] };
  const instP1 = { IdString: 'P1', Visible: true };
  const mockML = [[{
    ParentStaff: { Id: 1, ParentInstrument: instP1 },
    staffEntries: [{
      relInMeasureTimestamp: { RealValue: 0 },
      graphicalVoiceEntries: [{
        parentVoiceEntry: { ParentVoice: { VoiceId: 1 } },
        notes: [{ sourceNote: { isRest: () => false, Pitch: { halfTone: 72 - 12 }, Length: { RealValue: 1 } }, getSVGGElement: () => nC5 }]
      }]
    }]
  }]];
  sfBuildTapMap(hm2, mockML, [instP1], mockSvgHdr);
  check('sfBuildTapMap tags metronome "= 69" with data-sf-dir and header/credit text with data-sf-header',
    metroTxt.getAttribute('data-sf-dir') === metroDir.id &&
    hdrTitleTxt.getAttribute('data-sf-header') === '1' &&
    hdrCreditTxt.getAttribute('data-sf-header') === '1' &&
    hdrCreditTxt.getAttribute('data-sf-header-text') === 'Page 1 Junk Header');
}

// =========================================================================
// 18. Time Signature Editing, Mid-Score Propagation & Beat-Count Consensus (#143)
// =========================================================================
{
  // 18a. sfGetEffectiveTimeSig, sfSetMeasureTimeSig (thisBarOnly vs forward), sfRemoveMeasureTimeSig
  const tsXml = makeXml([
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    '<note><pitch><step>D</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>' +
    '<note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>',
    '<note><pitch><step>F</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ], { partName: 'Soprano' });
  const tsm = sfParseMusicXml(tsXml);
  check('sfGetEffectiveTimeSig M0 explicit=true 4/4, M1 explicit=false 4/4',
    sfGetEffectiveTimeSig(tsm, 0).explicit === true &&
    sfGetEffectiveTimeSig(tsm, 1).explicit === false &&
    sfGetEffectiveTimeSig(tsm, 1).beats === 4);

  // Suggest 6/4 (1 bar) on M1
  const tsSugs = sfSuggestTimeSigChanges(tsm);
  check('sfSuggestTimeSigChanges detects M1 as 6/4 (1 bar) with thisBarOnly=true',
    tsSugs.length === 1 && tsSugs[0].measureIndex === 1 && tsSugs[0].beats === 6 && tsSugs[0].beatType === 4 && tsSugs[0].thisBarOnly === true);

  // Apply thisBarOnly:true on M1 -> M1 becomes 6/4 (explicit), M2 stays 4/4 (explicit)
  sfSetMeasureTimeSig(tsm, 1, 6, 4, { thisBarOnly: true });
  check('sfSetMeasureTimeSig(thisBarOnly:true) sets M1=6/4 and restores M2=4/4, clearing duration_mismatch',
    sfGetEffectiveTimeSig(tsm, 1).beats === 6 && sfGetEffectiveTimeSig(tsm, 1).explicit === true &&
    sfGetEffectiveTimeSig(tsm, 2).beats === 4 && sfGetEffectiveTimeSig(tsm, 2).explicit === true &&
    sfAnalyzeFlags(tsm).flaggedCount === 0);

  // Remove explicit time sig on M1 -> reverts M1 to 4/4; M0 cannot be removed
  check('sfRemoveMeasureTimeSig(0) returns false, sfRemoveMeasureTimeSig(1) reverts M1 to 4/4',
    sfRemoveMeasureTimeSig(tsm, 0) === false &&
    sfRemoveMeasureTimeSig(tsm, 1) === true &&
    sfGetEffectiveTimeSig(tsm, 1).beats === 4 && sfGetEffectiveTimeSig(tsm, 1).explicit === false);

  // 18b. Mid-score single-staff propagation in sfAlignPartSignatures
  const midPropXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part><score-part id="P2"><part-name>Alto</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note></measure>
    <measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>
  </part>
  <part id="P2">
    <measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note></measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>
  </part>
</score-partwise>`;
  const mpm = sfParseMusicXml(midPropXml);
  check('mid-score explicit 3/4 on P1 M2 propagates to P2 M2 automatically',
    mpm.parts[1].measures[1].time.beats === 3 && mpm.parts[1].measures[1].time.beatType === 4 &&
    sfAnalyzeFlags(mpm).flaggedCount === 0);

  // 18c. High-confidence sfAutoInferTimeSigChanges (>=2 consecutive bars where all >=2 staves agree on 3/4)
  const inferXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part><score-part id="P2"><part-name>Alto</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note></measure>
    <measure number="2"><note><pitch><step>D</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>
    <measure number="3"><note><pitch><step>E</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>
  </part>
  <part id="P2">
    <measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note></measure>
    <measure number="2"><note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>
    <measure number="3"><note><pitch><step>B</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/></note></measure>
  </part>
</score-partwise>`;
  const infm = sfParseMusicXml(inferXml);
  check('sfAutoInferTimeSigChanges infers 3/4 across 2 consecutive unanimous bars',
    infm.parts[0].measures[1].time.beats === 3 &&
    infm.parts[1].measures[2].time.beats === 3 &&
    sfAnalyzeFlags(infm).flaggedCount === 0);
}

// =========================================================================
// 19. Tempo Editor Model Helpers (#152)
// =========================================================================
{
  const tmpXml = makeXml([
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    '<note><pitch><step>D</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ], { partName: 'Soprano' });
  const tm = sfParseMusicXml(tmpXml);

  // Default fallback when no tempo direction exists
  const tDef = sfGetMeasureTempo(tm, 1);
  check('sfGetMeasureTempo defaults to 100 quarter explicit=false',
    tDef.bpm === 100 && tDef.beatUnit === 'quarter' && tDef.beatUnitDot === false && tDef.explicit === false);

  // Set dotted-quarter = 72 ("Slowly") at M0 -> quarterBpm = 108 in playback & XML
  sfSetMeasureTempo(tm, 0, 72, { beatUnit: 'quarter', beatUnitDot: true, label: 'Slowly' });
  const t0 = sfGetMeasureTempo(tm, 0);
  const t1 = sfGetMeasureTempo(tm, 1);
  check('sfSetMeasureTempo sets explicit M0 dotted-quarter=72 and M1 inherits explicit=false',
    t0.bpm === 72 && t0.beatUnit === 'quarter' && t0.beatUnitDot === true && t0.label === 'Slowly' && t0.explicit === true &&
    t1.bpm === 72 && t1.beatUnitDot === true && t1.explicit === false);

  // Playback obeys quarter-note BPM (72 * 1.5 = 108)
  const play0 = sfModelToPlaybackScore(tm);
  check('sfModelToPlaybackScore obeys dotted-quarter=72 as 108 quarter-BPM',
    play0.tempos[0].bpm === 108 && play0.ptempos[0].bpm === 108);

  // Clamping 20..300 and replacing duplicate tempo on M0
  sfSetMeasureTempo(tm, 0, 500, { beatUnit: 'half' });
  check('sfSetMeasureTempo clamps to 300 and replaces existing tempo cleanly',
    sfGetMeasureTempo(tm, 0).bpm === 300 &&
    sfGetMeasureTempo(tm, 0).beatUnit === 'half' &&
    tm.parts[0].measures[0].entries.filter(e => e.tempoBpm > 0).length === 1);

  // Round-trip through .mxl
  const tmRe = sfParseMusicXml(sfUtf8Decode(sfUnzipMxlSync(sfExportMxl(tm))['score.musicxml'].data));
  check('.mxl round-trip preserves set tempo (bpm=300, beatUnit=half)',
    sfGetMeasureTempo(tmRe, 0).bpm === 300 && sfGetMeasureTempo(tmRe, 0).beatUnit === 'half');

  // Remove tempo at M0
  const remOk = sfRemoveMeasureTempo(tm, 0);
  check('sfRemoveMeasureTempo removes tempo and reverts to default 100',
    remOk === true && sfGetMeasureTempo(tm, 0).explicit === false && sfGetMeasureTempo(tm, 0).bpm === 100);
}

// =========================================================================
// 20. Key Signature Editor Helpers (#154)
// =========================================================================
{
  const keyXml = makeXml([
    '<note><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>' +
    '<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental>sharp</accidental></note>',
    '<note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>'
  ], { fifths: 0, partName: 'Soprano' });
  const km = sfParseMusicXml(keyXml);

  check('sfGetEffectiveKeySig M0 explicit=true fifths=0, M1 explicit=false fifths=0',
    sfGetEffectiveKeySig(km, 0).explicit === true && sfGetEffectiveKeySig(km, 0).fifths === 0 &&
    sfGetEffectiveKeySig(km, 1).explicit === false && sfGetEffectiveKeySig(km, 1).fifths === 0);

  // Set Bb major (-2 fifths) at M0 with updateUnmarkedPitches=true:
  // Unmarked B4 -> Bb4 (alter -1), unmarked E5 -> Eb5 (alter -1), while explicit F#4 keeps alter=1!
  sfSetMeasureKeySig(km, 0, -2, { updateUnmarkedPitches: true });
  const kM0Notes = km.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  const kM1Notes = km.parts[0].measures[1].entries.filter(e => e.kind === 'note');
  check('sfSetMeasureKeySig(-2, updateUnmarkedPitches:true) updates unmarked B4->Bb4, E5->Eb5 and preserves explicit F#4',
    sfGetEffectiveKeySig(km, 0).fifths === -2 &&
    kM0Notes[0].alter === -1 && kM0Notes[0].midi === 70 &&
    kM0Notes[1].alter === 1 && kM0Notes[1].accidental === 'sharp' &&
    kM1Notes[0].alter === -1 && kM1Notes[0].midi === 75);

  // Set G major (+1 fifth) at M1 with updateUnmarkedPitches=false -> M1 E5 stays alter=-1
  sfSetMeasureKeySig(km, 1, 1, { updateUnmarkedPitches: false });
  check('sfSetMeasureKeySig(1, updateUnmarkedPitches:false) leaves M1 pitch alters unchanged',
    sfGetEffectiveKeySig(km, 1).explicit === true && sfGetEffectiveKeySig(km, 1).fifths === 1 &&
    kM1Notes[0].alter === -1);

  // Round-trip XML export preserves both M0 (-2) and M1 (+1)
  const kmRe = sfParseMusicXml(sfExportMusicXml(km));
  check('XML round-trip preserves M0 fifths=-2 and M1 fifths=+1',
    sfGetEffectiveKeySig(kmRe, 0).fifths === -2 &&
    sfGetEffectiveKeySig(kmRe, 1).fifths === 1 && sfGetEffectiveKeySig(kmRe, 1).explicit === true);

  // sfRemoveMeasureKeySig: M0 cannot be removed, M1 reverts to M0 (-2)
  check('sfRemoveMeasureKeySig(0) returns false, sfRemoveMeasureKeySig(1) reverts M1 to -2',
    sfRemoveMeasureKeySig(km, 0) === false &&
    sfRemoveMeasureKeySig(km, 1) === true &&
    sfGetEffectiveKeySig(km, 1).explicit === false && sfGetEffectiveKeySig(km, 1).fifths === -2);
}

// =========================================================================
// 21. Structured entry.lyrics Multi-Verse Round-Trip & Data-Loss Check (#170)
// =========================================================================
{
  const multiVerseXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Choir</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <lyric number="1"><syllabic>begin</syllabic><text>A</text></lyric>
        <lyric number="2"><syllabic>middle</syllabic><text>bide</text><extend/></lyric>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type>
        <lyric number="1"><syllabic>end</syllabic><text>men</text><extend type="start"/></lyric>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type>
        <lyric number="part1verse1"><syllabic>single</syllabic><text>Verum</text></lyric>
      </note>
    </measure>
  </part>
</score-partwise>`;

  const mv0 = sfParseMusicXml(multiVerseXml);
  const mv0Notes = mv0.parts[0].measures[0].entries.filter(e => e.kind === 'note');

  // (a) Plain load -> sfExportMusicXml -> re-parse
  const mvReXml = sfExportMusicXml(mv0);
  const mvRe = sfParseMusicXml(mvReXml);
  const mvReNotes = mvRe.parts[0].measures[0].entries.filter(e => e.kind === 'note');
  check('lyrics plain round-trip preserves all verses, syllabic, extend, extendType, and non-numeric number',
    mvReXml.includes('number="1"') &&
    mvReXml.includes('number="2"') &&
    mvReXml.includes('number="part1verse1"') &&
    mvReXml.includes('<extend/>') &&
    mvReXml.includes('<extend type="start"/>') &&
    sfGetNoteLyric(mvReNotes[0], 1) === 'A-' &&
    sfGetNoteLyric(mvReNotes[0], 2) === 'bide-' &&
    sfGetNoteLyric(mvReNotes[1], 1) === 'men' &&
    sfGetNoteLyric(mvReNotes[2], 'part1verse1') === 'Verum');

  // (b) Structured entry.lyrics + edit preservation
  check('entry.lyrics structured array populated on parse',
    Array.isArray(mv0Notes[0].lyrics) &&
    mv0Notes[0].lyrics.length === 2 &&
    mv0Notes[0].lyrics[0].number === '1' &&
    mv0Notes[0].lyrics[0].syllabic === 'begin' &&
    mv0Notes[0].lyrics[1].number === '2' &&
    mv0Notes[0].lyrics[1].syllabic === 'middle' &&
    mv0Notes[0].lyrics[1].extend === true &&
    mv0Notes[1].lyrics[0].extendType === 'start' &&
    mv0Notes[2].lyrics[0].number === 'part1verse1');

  sfSetNoteLyric(mv0, mv0Notes[0].id, 'Praise', { verse: 1 });
  sfSetNoteLyric(mv0, mv0Notes[0].id, 'bide-', { verse: 2 });
  check('sfSetNoteLyric updates verse 1 while preserving verse 2 middle + extend',
    sfGetNoteLyric(mv0Notes[0], 1) === 'Praise' &&
    Array.isArray(mv0Notes[0].lyrics) &&
    mv0Notes[0].lyrics.length === 2 &&
    mv0Notes[0].lyrics[1].syllabic === 'middle' &&
    mv0Notes[0].lyrics[1].extend === true);

  // Make rest clears entry.lyrics, and notes-only filter clears entry.lyrics
  sfDeleteOrMakeRest(mv0, mv0Notes[0].id, 'rest');
  check('sfDeleteOrMakeRest clears entry.lyrics to []',
    Array.isArray(mv0Notes[0].lyrics) && mv0Notes[0].lyrics.length === 0);

  sfFilterScoreByMode(mvRe, 'notes-only');
  check('sfFilterScoreByMode("notes-only") clears entry.lyrics to []',
    mvReNotes.every(n => Array.isArray(n.lyrics) && n.lyrics.length === 0));
}

// Async tests: sfParseMxl + sfParseScoreInput
const e2eMxl = sfExportMxl(e2eModel);
const odeMxl = sfExportMxl(odeModel);
const choirMxl = sfExportMxl(choirUndo);

let asyncDone = false;
Promise.all([
  sfParseMxl(e2eMxl),
  sfParseScoreInput(e2eMxl),
  sfParseScoreInput(exportedXml),
  sfParseScoreInput(odeMxl),
  sfParseMxl(choirMxl)
]).then(([reBandMxl, reAutoMxl, reAutoXml, reOdeMxl, reChoirMxl]) => {
  check('async sfParseMxl round-trips fixed band score cleanly (0 flags)',
    reBandMxl.parts[0].measures.length === 12 && sfAnalyzeFlags(reBandMxl).flaggedCount === 0);
  check('async sfParseScoreInput auto-detects .mxl binary',
    reAutoMxl.workTitle === 'March of the Lions' && reAutoMxl.parts[0].transpose.chromatic === -2);
  check('async sfParseScoreInput auto-detects XML string',
    reAutoXml.workTitle === 'March of the Lions');
  check('async sfParseScoreInput round-trips Ode to Joy .mxl (2 parts, 16 bars, playback intact)',
    reOdeMxl.parts.length === 2 &&
    sfModelToPlaybackScore(reOdeMxl).events.length === sfModelToPlaybackScore(odeModel).events.length);
  const reChoirXml = sfExportMusicXml(reChoirMxl);
  check('async sfParseMxl round-trips lyrics, words, credits, and ties cleanly',
    reChoirMxl.workTitle === 'Choral Hymn' &&
    reChoirXml.includes('<text>Hal</text>') &&
    reChoirXml.includes('Allegro</words>') &&
    reChoirMxl.parts[0].measures[0].entries.filter(e => e.kind === 'note')[3].ties.includes('start') &&
    reChoirMxl.parts[0].measures[1].entries.filter(e => e.kind === 'note')[0].ties.includes('stop'));

  const reBandPlay = sfModelToPlaybackScore(reBandMxl);
  check('E2E re-imported .mxl playback matches original band playback event count',
    reBandPlay.events.length === bandPlayback.events.length &&
    reBandPlay.pevents.length === bandPlayback.pevents.length &&
    reBandPlay.hasRepeats === true);

  asyncDone = true;
}).catch(err => {
  check('async .mxl tests completed without error', false, String(err));
  asyncDone = true;
});

// Drive microtask queue in JSC so async assertions complete before final status & exit code
if (typeof drainMicrotasks === 'function') drainMicrotasks();

print(`scan-test: ${passed} passed, ${failed} failed`);
if (!asyncDone) {
  throw new Error('scan-test async assertions did not complete');
}
if (failed > 0) {
  throw new Error(`scan-test failed (${failed} failures)`);
}
