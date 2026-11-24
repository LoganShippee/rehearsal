// fakegrade.mjs: produce the app's REAL grading feedback (report card + coloured notes on the music)
// from a SYNTHETIC performance, because the headless browser's fake microphone is just a beep.
//
// HOW IT WORKS (no app code is edited; it only uses the app's own globals from page.evaluate):
//   grStart() (web/grade.js) normally fills the global `GR` with a take (count-in, mic frames) and a timer
//   later calls grStop(true). grStop is the real pipeline: grAnalyze(frames, exp, q, T0, end, ...) ->
//   host.__grResult + host.__grRedraw() (coloured notes) -> grShowCard() (the #gr-card report with Rhythm/Pitch %).
//   So instead of grStart we fill GR by hand with the SAME fields grStart sets, with frames we invent,
//   then call grStop(true). Everything the viewer sees is produced by the real code.
//
// NEEDS: the Sight Reading stage showing a 1-line example (the widget host is the element that owns
//   `__timeline`, found from the [data-sr="grade"] button). Sight Reading's  host.__timeline  gives the notes;
//   grExpected(timeline, shift) turns it into the graded notes (exactly what grStart does).
//   For the Score Practice stage (data-sp="grade") the same GR fields apply but the expected notes / host /
//   timeline come from score.js: call fakeGradeWith(R, {hostSel, exp, q, tl, meta}) (see below) with those.
//
// STATE TOUCHED: S.settings.gradeStrictRhythm/Pitch set to 50 (Standard), global GR (fields set, then grStop resets them), GR_RECENT (adds one entry), host.__grResult,
//   adds #gr-card to <body>, mark classes on the notes. Clean up with  clearFakeGrade(R)  (clicks nothing;
//   removes card + marks the same way the card's "Exit Grade" button does).
//
// The synthetic singer: notes at the written pitch (octave-shifted by 0, which grading allows), steady loudness
// with a short gap between notes so every attack is detected, pitch read every ~40 ms.
//   mistakes 'few'  : 1 note late (~110 ms), 1 note early (~100 ms), 1 note ~60 cents flat  -> about 90% / 85%
//   mistakes 'some' : 2 late, 1 early, 2 flat, 1 wrong pitch (+2 semitones)                  -> about 60-75%
import { sleep } from './lib.mjs';

export async function fakeGradeWith(R, { hostSel = '[data-sr="grade"]', mistakes = 'few', hold = 0 } = {}) {
  const info = await R.page.evaluate((hostSel, mistakes) => {
    const btn = document.querySelector(hostSel);
    let host = btn; while (host && !host.__timeline) host = host.parentElement;
    if (!host) return { err: 'no host with __timeline' };
    const tl = host.__timeline;
    // the sizes below assume the "Standard" strictness (50); the demo browser's default is more forgiving (25)
    S.settings.gradeStrictRhythm = 50; S.settings.gradeStrictPitch = 50;
    // read tempo from the app state when we can (only used for the "listen back" take info)
    const exp = grExpected(tl, 0);
    if (!exp.length) return { err: 'nothing to grade' };
    const q = 0.5, T0 = 1000, last = exp[exp.length - 1], end = T0 + (last.t + last.len) * q + 0.8;
    const n = exp.length;
    // choose which notes get which mistake (spread out, never the first note: it anchors the pitch key)
    const at = f => Math.max(1, Math.min(n - 1, Math.round(f * n)));
    const late = new Map(), flat = new Map(), wrong = new Map();
    // sizes are chosen to just exceed the default "Standard" leeway (+-100 ms, +-60 cents) so they show as early/late / wrong pitch
    if (mistakes === 'some') { late.set(at(.3), .19); late.set(at(.75), .17); late.set(at(.5), -.16); flat.set(at(.4), .8); flat.set(at(.85), .85); wrong.set(at(.62), 2); }
    else { late.set(at(.45), .19); late.set(at(.8), -.16); flat.set(at(.6), .8); }
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - .5; };
    const frames = []; let poll = 0; const gradePitch = exp.some(e => e.midi != null);
    const shiftOf = i => late.get(i) || 0;
    for (let t = T0 - 0.3; t <= end; t += 0.01) {
      let rms = 0.0015 + 0.0005 * Math.abs(rnd()), f = -1;
      for (let i = 0; i < n; i++) {
        const e = exp[i], a = T0 + e.t * q + shiftOf(i), b = T0 + (e.t + e.len) * q + shiftOf(i) - 0.07;   // small gap = a clear attack
        if (t >= a && t < b) {
          rms = 0.08 + 0.01 * rnd();
          if (e.midi != null && poll % 4 === 0) { const m = e.midi + (flat.has(i) ? -flat.get(i) : 0) + (wrong.get(i) || 0) + 0.08 * rnd(); f = 440 * Math.pow(2, (m - 69) / 12); }
          break;
        }
      }
      poll++; frames.push({ t, rms, f });
    }
    // the same fields grStart() sets
    Object.assign(GR, { on: true, input: 'mic', c: null, taps: null, an: null, rec: null, meta: { mode: 'sight', settings: { tempo: 120, ts: '4/4' } }, frames, host, exp, q, T0, end, btn, lat: null, gradePitch, tl, idleHTML: null, retry: null, onFinish: null, trimEarlyStop: false, mic: null });
    return { n, gradePitch };
  }, hostSel, mistakes);
  if (info.err) throw new Error('fakeGrade: ' + info.err);
  await R.page.evaluate(() => grStop(true));
  await sleep(500);
  if (hold) await sleep(hold);
  return info;
}

// Sight Reading entry point (the usual one).
export const fakeGradeSight = (R, opts = {}) => fakeGradeWith(R, { hostSel: '[data-sr="grade"]', mistakes: opts.mistakes || 'few', hold: opts.hold || 0 });

// Remove the report card and the coloured marks (what "Exit Grade" does).
export async function clearFakeGrade(R) {
  await R.page.evaluate(() => {
    document.getElementById('gr-card')?.remove();
    document.querySelectorAll('[data-sr="grade"],[data-sp="grade"]').forEach(b => { let h = b; while (h && !h.__timeline && !h.__grResult) h = h.parentElement; if (h) { h.__grResult = null; h.__grRedraw?.(); } });
    if (typeof grClearMarks === 'function') document.querySelectorAll('[data-sr="grade"]').forEach(b => { let h = b; while (h && !h.__timeline) h = h.parentElement; h && grClearMarks(h); });
  });
}

// ---------------------------------------------------------------------------------------------
// SCORE PRACTICE / STUDENT RUNNER: the real Grade button (data-sp=grade, or #hw-sp-grade in the student
// portal) is clicked by the scene with a visible click. spGradeStart then builds GR itself (expected notes
// of the soloed vocal part over the loop, T0/end, host, meta, timeline). We only wait until GR is armed,
// stop its real mic timer, replace the (beep) mic frames with a synthetic singer, and call the real grStop(true).
// Result: real #gr-card + real coloured notes / measure chips on the score. trimEarlyStop is off so the whole
// range is graded even though we finish immediately. Clean up with clearFakeGrade(R) (+ score marks below).
// mistakes 'few' = 1 late, 1 early, 1 flat; 'some' = more. Never the first note (it anchors the key).
export async function fakeFinishScoreTake(R, { mistakes = 'few', hold = 0, timeout = 15000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const ok = await R.page.evaluate(() => typeof GR !== 'undefined' && GR.on && GR.exp && GR.exp.length && GR.T0 && GR.input === 'mic');
    if (ok) break;
    if (Date.now() - t0 > timeout) throw new Error('fakeFinishScoreTake: grading never armed');
    await sleep(60);
  }
  const info = await R.page.evaluate(mistakes => {
    clearInterval(GR.timer);                      // stop the real (beep) sampling
    const exp = GR.exp, q = GR.q, T0 = GR.T0, end = GR.end, n = exp.length;
    const at = f => Math.max(1, Math.min(n - 1, Math.round(f * n)));
    const late = new Map(), flat = new Map(), wrong = new Map();
    // sizes just beyond the strictness the runner/app uses (read from the live settings), so they show as misses
    const sp = typeof grStrictnessSpec === 'function' ? grStrictnessSpec() : null;
    const ms = sp ? Math.max(.12, (sp.rhythmMs || 100) / 1000 + .06) : .19, cents = sp ? Math.max(.8, (sp.pitchCents || 60) / 100 + .25) : .85;
    if (mistakes === 'some') { late.set(at(.3), ms); late.set(at(.75), ms); late.set(at(.5), -ms); flat.set(at(.4), cents); flat.set(at(.85), cents); wrong.set(at(.62), 2); }
    else { late.set(at(.45), ms); late.set(at(.8), -ms); flat.set(at(.6), cents); }
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - .5; };
    const frames = []; let poll = 0;
    for (let t = T0 - 0.3; t <= end; t += 0.01) {
      let rms = 0.0015 + 0.0005 * Math.abs(rnd()), f = -1;
      for (let i = 0; i < n; i++) {
        const e = exp[i], a = T0 + e.t * q + (late.get(i) || 0), b = T0 + (e.t + e.len) * q + (late.get(i) || 0) - 0.07;
        if (t >= a && t < b) {
          rms = 0.08 + 0.01 * rnd();
          if (e.midi != null && poll % 4 === 0) { const m = e.midi - (flat.get(i) || 0) + (wrong.get(i) || 0) + 0.08 * rnd(); f = 440 * Math.pow(2, (m - 69) / 12); }
          break;
        }
      }
      poll++; frames.push({ t, rms, f });
    }
    GR.frames = frames; GR.lat = null; GR.trimEarlyStop = false;
    grStop(true);
    return { n, strict: sp };
  }, mistakes);
  await sleep(500);
  if (hold) await sleep(hold);
  return info;
}

// Remove the report card and the coloured marks on a Score Practice stage (what "Exit Grade" does).
export async function clearScoreGrade(R) {
  await R.page.evaluate(() => {
    document.getElementById('gr-card')?.remove();
    document.querySelectorAll('.score-host, [data-sp="grade"]').forEach(h => { let x = h; while (x && !x.__grResult) x = x.parentElement; if (x) { x.__grResult = null; x.__grRedraw?.(); } });
    document.querySelectorAll('.gr-chips-wrap,.gr-chips').forEach(x => x.remove());
  });
}

// ---------------------------------------------------------------------------------------------
// SCORE PRACTICE (and the student portal runner, which uses the same score grading)
// Here the real button handler is `spGradeStart(ctl, btn, mode)` (web/score.js; hw-student.js wraps it).
// It needs the microphone, so we swap the page's global `spGradeStart` for a stand-in that does exactly what
// the real one does at the end of a take: fill the global `GR` with the same fields (expected notes from
// spExpectedNotes for the part + measure range being graded, a synthetic sung take) and call grStop(true), which
// runs the real analysis, colours the notes (host.__grRedraw -> ctl.drawGradeMarks) and shows the real report card.
// Then a visible click on the real Grade / "Sing it" button shows the real feedback.
//   armFakeScoreGrade(R, {mistakes, takeMs})  -> installs the stand-in (call before the visible click)
//   disarmFakeScoreGrade(R)                   -> restores the original handler
//   clearFakeScoreGrade(R)                    -> removes the card + coloured marks, restores the handler
// The button shows "Stop & grade" for takeMs, then the result appears. Sets strictness to Standard (50).
export async function armFakeScoreGrade(R, { mistakes = 'few', takeMs = 700 } = {}) {
  await R.page.evaluate((mistakes, takeMs) => {
    if (!window.__origSpGradeStart) window.__origSpGradeStart = window.spGradeStart;
    // student portal: a take with no audio would be dropped as "Nothing was heard"; there is no recording here, so keep it
    if (typeof window.hwTakeIsEmpty === 'function' && !window.__origTakeEmpty) { window.__origTakeEmpty = window.hwTakeIsEmpty; window.hwTakeIsEmpty = () => false; }
    window.spGradeStart = async function (ctl, btn) {
      if (GR.on) { grStop(true); return; }
      if (typeof spStop === 'function') spStop();
      const { sc, st, host } = ctl;
      S.settings.gradeStrictRhythm = 50; S.settings.gradeStrictPitch = 50;
      const lineIdx = spGradeLine(ctl), line = sc.lines[lineIdx], Rg = spGradeRange(ctl);
      const exp = spExpectedNotes(ctl, lineIdx, Rg, 0);
      if (!exp.length) return;
      const fac = (Number(st.tempo) || 100) / 100, q = 60 / spBpmAt(sc, Rg.a) / fac;
      const T0 = 1000, last = exp[exp.length - 1], end = T0 + (last.t + last.len) * q + 0.8, n = exp.length;
      const at = f => Math.max(1, Math.min(n - 1, Math.round(f * n)));
      const late = new Map(), flat = new Map(), wrong = new Map();
      if (mistakes === 'some') { late.set(at(.3), .19); late.set(at(.75), .17); late.set(at(.5), -.16); flat.set(at(.4), .8); flat.set(at(.85), .85); wrong.set(at(.62), 2); }
      else { late.set(at(.45), .3); late.set(at(.8), -.26); flat.set(at(.6), .8); wrong.set(at(.3), 2); }   // score tempo is slower: bigger slips so they show
      let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - .5; };
      const frames = []; let poll = 0;
      for (let t = T0 - 0.3; t <= end; t += 0.01) {
        let rms = 0.0015 + 0.0005 * Math.abs(rnd()), f = -1;
        for (let i = 0; i < n; i++) {
          const e = exp[i], sh = late.get(i) || 0, a = T0 + e.t * q + sh, b = T0 + (e.t + e.len) * q + sh - 0.07;
          if (t >= a && t < b) {
            rms = 0.08 + 0.01 * rnd();
            if (e.midi != null && poll % 4 === 0) { const m = e.midi - (flat.get(i) || 0) + (wrong.get(i) || 0) + 0.08 * rnd(); f = 440 * Math.pow(2, (m - 69) / 12); }
            break;
          }
        }
        poll++; frames.push({ t, rms, f });
      }
      const p0 = sc.perf.find(m => m.start <= Rg.a + 1e-9 && Rg.a < m.start + m.len), m0 = (p0 && sc.measures[p0.w]) || sc.measures[0];
      const rangeLabel = (exp[0].bar === last.bar) ? `m. ${exp[0].bar}` : `m. ${exp[0].bar}–${last.bar}`;
      const tl = exp.map(e => ({ t: e.t, len: e.len, midi: e.midi, rest: false }));
      const histKey = `${st.fileId}|${lineIdx}|${Rg.a.toFixed(2)}-${Rg.b.toFixed(2)}`;
      ctl.grHistByKey ||= {}; tl.grHist = (ctl.grHistByKey[histKey] ||= []);
      const meta = { mode: 'solfege', partName: line?.name || 'Score', modeLabel: `${line?.name || 'Score'} (${rangeLabel})`, fileId: st.fileId, lineIdx, range: Rg,
        settings: { ts: `${m0.beats}/${m0.bt}`, tempo: st.tempo, effBpm: Math.round(spBpmAt(sc, Rg.a) * fac), gradeVoice: 'written', countIn: 1, metronome: false }, beatSec: q, countBeats: 0, t0: T0, avDelay: 0 };
      document.getElementById('gr-card')?.remove();
      host.__grResult = null; ctl.drawGradeMarks?.();
      const idleHTML = btn ? btn.innerHTML : null;
      Object.assign(GR, { on: true, input: 'mic', c: null, taps: null, an: null, rec: null, meta, frames, host, exp, q, T0, end, btn, lat: null, gradePitch: true, tl, idleHTML, retry: null,
        onFinish: () => { ctl._paintPlayhead = null; ctl.hideCountOverlay?.(); ctl.hidePlayhead?.(); ctl.updateBar?.(); }, trimEarlyStop: false, mic: null });
      if (btn) { btn.innerHTML = IC('ico:stop') + ' Stop & grade <i class="gr-lvl" aria-hidden="true"></i>'; btn.classList.add('on'); }
      setTimeout(() => { if (GR.on && GR.host === host) grStop(true); }, takeMs);
    };
  }, mistakes, takeMs);
}
export const disarmFakeScoreGrade = R => R.page.evaluate(() => { if (window.__origSpGradeStart) { window.spGradeStart = window.__origSpGradeStart; window.__origSpGradeStart = null; } });
export async function clearFakeScoreGrade(R) {
  await R.page.evaluate(() => {
    if (typeof GR !== 'undefined' && GR.on) grStop(false);
    document.getElementById('gr-card')?.remove();
    document.querySelectorAll('.sp-root').forEach(r => { const h = r.parentElement; if (h) { h.__grResult = null; h.__grRedraw?.(); } });
    if (window.__origSpGradeStart) { window.spGradeStart = window.__origSpGradeStart; window.__origSpGradeStart = null; }
    if (window.__origTakeEmpty) { window.hwTakeIsEmpty = window.__origTakeEmpty; window.__origTakeEmpty = null; }
  });
}
