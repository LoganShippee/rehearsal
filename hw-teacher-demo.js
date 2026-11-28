'use strict';
/* Rehearsal Online Homework — Teacher Local Preview / Demo Mode Backend.
   Loaded right before web/hw-teacher-api.js; implements the full in-browser
   demo DB (persisted in localStorage['rehearsal-hw-teacher-demo-v1']) so ?demo=1
   works identically without a live homework server. */

(function () {
  const DEMO_DB_KEY = 'rehearsal-hw-teacher-demo-v1';
  const DEMO_OFFLINE_KEY = 'rehearsal-hw-teacher-demo-offline';
  const DEMO_HANDOFFS_KEY = 'rehearsal-hw-demo-handoffs-v1';

  let memDemoOffline = false;
  let memDemoDb = null;

  function create(ctx) {
    const {
      getToken,
      isEphemeral,
      setSession,
      clearSession,
      isOffline,
      offlineErr,
      loadCache,
      saveCache,
      clearCache,
      buildPreviewPortalUrl,
      triggerDownload,
      buildGradebookCsvString,
      clone,
      generateCode6,
      normalizeEmail,
      makeId,
      randomHandoffHex,
      DAY_MS,
      DEFAULT_SOFT_CAP,
      PREVIEW_DRAFT_KEY,
    } = ctx;

    function getDemoOffline() {
      try {
        return sessionStorage.getItem(DEMO_OFFLINE_KEY) === '1';
      } catch {
        return memDemoOffline;
      }
    }

    function setDemoOffline(flag) {
      memDemoOffline = !!flag;
      try {
        if (flag) sessionStorage.setItem(DEMO_OFFLINE_KEY, '1');
        else sessionStorage.removeItem(DEMO_OFFLINE_KEY);
      } catch { }
      return getDemoOffline();
    }

    // ---------- Synthesized 5-Note C-Major Scale PCM WAV Generator (for Local Preview Audio)
    function createScaleWavBlob() {
      const sampleRate = 22050;
      const freqs = [261.63, 293.66, 329.63, 349.23, 392.00]; // C4 D4 E4 F4 G4
      const noteSec = 0.42;
      const noteSamples = Math.floor(sampleRate * noteSec);
      const totalSamples = noteSamples * freqs.length;
      const dataBytes = totalSamples * 2;
      const buffer = new ArrayBuffer(44 + dataBytes);
      const view = new DataView(buffer);

      function writeAscii(offset, str) {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      }

      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + dataBytes, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);       // PCM chunk size
      view.setUint16(20, 1, true);        // PCM format
      view.setUint16(22, 1, true);        // mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, dataBytes, true);

      const fadeSamples = Math.floor(sampleRate * 0.025);
      let offset = 44;
      for (let n = 0; n < freqs.length; n++) {
        const f = freqs[n];
        for (let i = 0; i < noteSamples; i++) {
          let env = 1;
          if (i < fadeSamples) env = i / fadeSamples;
          else if (i > noteSamples - fadeSamples) env = (noteSamples - i) / fadeSamples;
          const t = i / sampleRate;
          const sig =
            0.75 * Math.sin(2 * Math.PI * f * t) +
            0.18 * Math.sin(2 * Math.PI * f * 2 * t) +
            0.07 * Math.sin(2 * Math.PI * f * 3 * t);
          const sample = Math.max(-1, Math.min(1, sig * env * 0.42));
          view.setInt16(offset, Math.round(sample * 32767), true);
          offset += 2;
        }
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    // ---------- Rich Local Preview Mode (persisted in localStorage['rehearsal-hw-teacher-demo-v1'])
    function computeDemoPlan(teacher, now) {
      const t = teacher || {};
      const status = t.planStatus || 'trialing';
      const softCap = Number(t.studentSoftCap || DEFAULT_SOFT_CAP);

      if (status === 'trialing') {
        const endsAt = Number(t.trialEndsAt || (now + 24 * DAY_MS));
        if (endsAt > now) {
          return {
            status: 'trialing',
            canWrite: true,
            readOnly: false,
            inGrace: false,
            trialEndsAt: endsAt,
            daysLeft: Math.max(1, Math.ceil((endsAt - now) / DAY_MS)),
            studentSoftCap: softCap,
          };
        }
        return {
          status: 'expired',
          canWrite: false,
          readOnly: true,
          inGrace: false,
          trialEndsAt: endsAt,
          daysLeft: 0,
          studentSoftCap: softCap,
          reason: 'Your 30-day free trial has ended. Your gradebook is in read-only mode — upgrade to create new assignments or accept submissions.',
        };
      }

      if (status === 'active' || status === 'po_active') {
        const endsAt = t.planEndsAt ? Number(t.planEndsAt) : null;
        return {
          status,
          canWrite: true,
          readOnly: false,
          inGrace: false,
          planEndsAt: endsAt,
          poReference: t.poReference || null,
          daysLeft: endsAt ? Math.max(1, Math.ceil((endsAt - now) / DAY_MS)) : null,
          studentSoftCap: softCap,
        };
      }

      if (status === 'past_due') {
        const graceEnds = Number(t.graceEndsAt || (now + 4 * DAY_MS));
        if (graceEnds > now) {
          const graceDaysLeft = Math.max(1, Math.ceil((graceEnds - now) / DAY_MS));
          return {
            status: 'past_due',
            canWrite: true,
            readOnly: false,
            inGrace: true,
            graceEndsAt: graceEnds,
            graceDaysLeft,
            studentSoftCap: softCap,
            warning: `Payment issue — ${graceDaysLeft} day${graceDaysLeft === 1 ? '' : 's'} left in your grace period. Update billing to avoid read-only mode.`,
          };
        }
        return {
          status: 'expired',
          canWrite: false,
          readOnly: true,
          inGrace: false,
          graceEndsAt: graceEnds,
          daysLeft: 0,
          studentSoftCap: softCap,
          reason: 'Your payment grace period ended. Your gradebook is in read-only mode until billing is updated.',
        };
      }

      return {
        status: status === 'canceled' ? 'canceled' : 'expired',
        canWrite: false,
        readOnly: true,
        inGrace: false,
        daysLeft: 0,
        studentSoftCap: softCap,
        reason: status === 'canceled'
          ? 'Your plan is inactive. You can still view grades, play saved audio, export CSVs, and delete data.'
          : 'Your 30-day free trial has ended. Your gradebook is in read-only mode — upgrade to create new assignments or accept submissions.',
      };
    }

    function createDemoSightExcerpts() {
      const H = { id: 'h', ev: [['h', 2]] };
      const Q = { id: 'q', ev: [['q', 1]] };
      const W = { id: 'w', ev: [['w', 4]] };
      const EE = { id: 'ee', ev: [['8', 0.5], ['8', 0.5]] };
      const QR = { id: 'qr', ev: [['q', 1, 1]] };
      const HR = { id: 'hr', ev: [['h', 2, 1]] };
      return {
        solfegeEx: {
          solfege: {
            rhythm: [[H, H], [Q, Q, H], [H, H], [W]],
            pitches: [0, 1, 2, 3, 4, 3, 2, 0],
          },
        },
        rhythmEx: {
          rhythm: [[Q, QR, H], [Q, EE, H], [H, HR], [W]],
        },
      };
    }

    function buildDemoNotes(statuses) {
      const pitches = ['C4', 'D4', 'E4', 'F4', 'G4', 'F4', 'E4', 'C4'];
      const bars = [1, 1, 2, 2, 2, 3, 3, 4];
      const wrongNames = ['D4', 'F#4', 'F4', 'E4', 'A4', 'G4', 'D4', 'D4'];
      return statuses.map((st, i) => {
        const bar = bars[i] || (Math.floor(i / 4) + 1);
        const idx = i;
        const pitch = pitches[i % pitches.length];
        let cents = 4;
        let errMs = 18;
        let sungAs = null;
        if (st === 'timing') {
          cents = 9;
          errMs = i % 2 === 0 ? 128 : -118;
        } else if (st === 'pitch') {
          cents = i % 2 === 0 ? 58 : -54;
          errMs = 22;
          sungAs = wrongNames[i % wrongNames.length];
        } else if (st === 'wrong') {
          cents = 145;
          errMs = 95;
          sungAs = wrongNames[i % wrongNames.length];
        } else if (st === 'missed') {
          cents = null;
          errMs = null;
        }
        const out = { bar, idx, status: st, pitch, cents, errMs };
        if (sungAs) out.sungAs = sungAs;
        return out;
      });
    }

    function makeDemoResultPayload(notes, inputMode, rmsPeak, expectsPitch) {
      const total = notes.length;
      const rOk = notes.filter(n => n.status === 'ok' || n.status === 'pitch').length;
      const rHalf = notes.filter(n => n.status === 'timing').length;
      const rhythmPct = Math.max(0, Math.min(100, Math.round(((rOk + 0.5 * rHalf) / total) * 100)));
      let pitchPct = null;
      let overallPct = rhythmPct;
      if (expectsPitch) {
        const pOk = notes.filter(n => n.status === 'ok').length;
        pitchPct = Math.max(0, Math.min(100, Math.round((pOk / total) * 100)));
        overallPct = Math.max(0, Math.min(100, Math.round((rhythmPct + pitchPct) / 2)));
      }
      return {
        overallPct,
        rhythmPct,
        pitchPct,
        resultsJson: {
          serverOverallPct: overallPct,
          serverRhythmPct: rhythmPct,
          serverPitchPct: pitchPct,
          expectsPitch,
          engineRhythmPct: rhythmPct,
          enginePitchPct: pitchPct,
          strictness: { rhythm: 50, pitch: 50 },
          offsetMs: 14,
          driftCents: 6,
          extra: 0,
          rmsPeak,
          inputMode,
          noteCount: total,
          notes,
        },
      };
    }

    function createFreshDemoDb() {
      const now = Date.now();
      const clsId = 'cls_demo_1';

      const n1 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'ok', 'timing', 'ok', 'ok', 'ok', 'ok', 'ok']),
        'mic_pitch_rhythm', 0.24, true
      );
      const n2 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'pitch', 'ok', 'timing', 'ok', 'ok', 'missed', 'ok']),
        'mic_pitch_rhythm', 0.19, true
      );
      const n3 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'ok', 'ok', 'ok', 'timing', 'ok', 'ok', 'ok']),
        'mic_pitch_rhythm', 0.004, true
      );
      const n4 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'wrong', 'timing', 'missed', 'pitch', 'ok', 'timing', 'missed']),
        'mic_pitch_rhythm', 0.14, true
      );
      const n5 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'ok', 'ok', 'timing', 'ok', 'ok', 'ok', 'ok']),
        'tap', 0, false
      );
      const n6 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'timing', 'ok', 'timing', 'ok', 'ok', 'timing', 'ok']),
        'tap', 0, false
      );
      const n7 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'ok', 'pitch', 'ok', 'ok', 'ok', 'ok', 'timing']),
        'mic_pitch_rhythm', 0.28, true
      );
      const n8 = makeDemoResultPayload(
        buildDemoNotes(['ok', 'pitch', 'timing', 'wrong', 'ok', 'pitch', 'ok', 'ok']),
        'mic_pitch_rhythm', 0.21, true
      );

      return {
        teacher: {
          id: 'tch_demo_rivera',
          email: 'ms.rivera@oakridge.edu',
          name: 'Ms. Rivera',
          hasGoogle: true,
          planStatus: 'trialing',
          trialEndsAt: now + 24 * DAY_MS,
          planEndsAt: null,
          graceEndsAt: null,
          studentSoftCap: DEFAULT_SOFT_CAP,
          poReference: null,
          createdAt: now - 6 * DAY_MS,
        },
        pendingEmailCodes: {},
        sessions: {},
        classes: [
          {
            id: clsId,
            name: 'Concert Choir — Period 2',
            joinCode: 'K7M-4P2',
            locked: false,
            archivedAt: null,
            createdAt: now - 6 * DAY_MS,
            updatedAt: now - DAY_MS,
          },
        ],
        students: [
          {
            id: 'stu_maya',
            classId: clsId,
            displayName: 'Maya Lin',
            email: 'maya.lin@oakridge.edu',
            part: 'Soprano',
            hasGoogle: true,
            hasCode: true,
            codePlain: 'H7P-9KM',
            codeLocked: false,
            codeCooldownUntil: null,
            archivedAt: null,
            lastActiveAt: now - 3 * 60 * 60 * 1000,
            createdAt: now - 5 * DAY_MS,
            updatedAt: now - 3 * 60 * 60 * 1000,
          },
          {
            id: 'stu_jordan',
            classId: clsId,
            displayName: 'Jordan Ortiz',
            email: 'jordan.ortiz@oakridge.edu',
            part: 'Tenor',
            hasGoogle: false,
            hasCode: true,
            codePlain: 'M4R-8TX',
            codeLocked: false,
            codeCooldownUntil: null,
            archivedAt: null,
            lastActiveAt: now - 5 * 60 * 60 * 1000,
            createdAt: now - 5 * DAY_MS,
            updatedAt: now - 5 * 60 * 60 * 1000,
          },
          {
            id: 'stu_priya',
            classId: clsId,
            displayName: 'Priya Patel',
            email: 'priya.patel@oakridge.edu',
            part: 'Alto',
            hasGoogle: true,
            hasCode: true,
            codePlain: 'P9W-3KN',
            codeLocked: false,
            codeCooldownUntil: null,
            archivedAt: null,
            lastActiveAt: now - 8 * 60 * 60 * 1000,
            createdAt: now - 5 * DAY_MS,
            updatedAt: now - 8 * 60 * 60 * 1000,
          },
          {
            id: 'stu_devon',
            classId: clsId,
            displayName: 'Devon Brooks',
            email: 'devon.brooks@oakridge.edu',
            part: 'Bass',
            hasGoogle: false,
            hasCode: true,
            codePlain: 'C6V-2YF',
            codeLocked: true,
            codeCooldownUntil: null,
            archivedAt: null,
            lastActiveAt: now - 2 * DAY_MS,
            createdAt: now - 5 * DAY_MS,
            updatedAt: now - DAY_MS,
          },
        ],
        assignments: [
          {
            id: 'asgn_true_sr',
            classId: clsId,
            title: 'True Sight-Reading Check #1',
            instructions: 'Study the 4-measure melody during the 30-second countdown. Your microphone starts automatically at 0:00.',
            type: 'sight',
            mode: 'true_sight_read',
            config: {
              studySeconds: 30,
              countingSystem: 'numbers',
              strictness: { rhythm: 50, pitch: 50 },
              srState: {
                mode: 'solfege',
                show: false,
                showCounts: false,
                playhead: 'beat',
                solfege: {
                  key: 'C',
                  scale: 'major',
                  clef: 'treble',
                  range: 'do-sol',
                  leap: 'step',
                  ts: '4/4',
                  measures: 4,
                  tempo: 80,
                  metronome: true,
                  measureNums: true,
                  startDo: true,
                  cells: ['q', 'h', 'w'],
                  showCounts: false,
                },
                ex: createDemoSightExcerpts().solfegeEx,
              },
            },
            hasScoreFile: false,
            scoreFilename: null,
            scoreBytes: 0,
            dueAt: now + 3 * DAY_MS,
            maxAttempts: 1,
            gradePolicy: 'best',
            published: true,
            archivedAt: null,
            createdAt: now - 4 * DAY_MS,
            updatedAt: now - 4 * DAY_MS,
          },
          {
            id: 'asgn_rhythm_drill',
            classId: clsId,
            title: 'Rhythm Tap Drill',
            instructions: 'Practice quarter and eighth-note patterns using Spacebar or Tap. Up to 3 attempts.',
            type: 'sight',
            mode: 'practice',
            config: {
              studySeconds: 0,
              countingSystem: 'numbers',
              strictness: { rhythm: 50, pitch: 50 },
              srState: {
                mode: 'rhythm',
                show: true,
                showCounts: true,
                playhead: 'beat',
                rhythm: {
                  ts: '4/4',
                  measures: 4,
                  tempo: 84,
                  metronome: true,
                  measureNums: true,
                  sound: 'clap',
                  cells: ['q', 'h', 'ee', 'qr', 'hr', 'w'],
                  showCounts: true,
                },
                ex: createDemoSightExcerpts().rhythmEx,
              },
            },
            hasScoreFile: false,
            scoreFilename: null,
            scoreBytes: 0,
            dueAt: now + 5 * DAY_MS,
            maxAttempts: 3,
            gradePolicy: 'best',
            published: true,
            archivedAt: null,
            createdAt: now - 3 * DAY_MS,
            updatedAt: now - 3 * DAY_MS,
          },
          {
            id: 'asgn_score_vocal',
            classId: clsId,
            title: 'Vocal Part Check-In',
            instructions: 'Select your voice part, take your starting pitch, and record measures 1–8 into the microphone.',
            type: 'score',
            mode: 'practice',
            config: {
              gradeMode: 'mic',
              countingSystem: 'numbers',
              strictness: { rhythm: 50, pitch: 50 },
              spState: {
                name: 'Vocal Part Check-In',
                gradeMode: 'mic',
                tempo: 84,
                solfege: false,
                counts: false,
                focus: 0,
                zoom: 0.85,
              },
            },
            hasScoreFile: true,
            scoreFilename: 'Vocal-Part-Check-In.musicxml',
            scoreBytes: 18420,
            dueAt: now + 7 * DAY_MS,
            maxAttempts: null,
            gradePolicy: 'best',
            published: true,
            archivedAt: null,
            createdAt: now - 2 * DAY_MS,
            updatedAt: now - 2 * DAY_MS,
          },
          {
            id: 'asgn_audio_scale',
            classId: clsId,
            title: '5-Note Major Scale Warm-Up',
            instructions: 'Sing do-re-mi-fa-sol on "ah" with steady breath support after the count-in.',
            type: 'audio',
            mode: 'practice',
            config: {
              countIn: true,
              bpm: 84,
              prompt: 'Sing a 5-note C-major scale (do-re-mi-fa-sol) on "ah" after the 4-beat count-in.',
              strictness: { rhythm: 50, pitch: 50 },
            },
            hasScoreFile: false,
            scoreFilename: null,
            scoreBytes: 0,
            dueAt: now + 4 * DAY_MS,
            maxAttempts: 3,
            gradePolicy: 'last',
            published: true,
            archivedAt: null,
            createdAt: now - DAY_MS,
            updatedAt: now - DAY_MS,
          },
        ],
        submissions: [
          // Maya Lin — True Sight-Read (clean high score)
          {
            id: 'sub_maya_sr_1',
            assignmentId: 'asgn_true_sr',
            classId: clsId,
            studentId: 'stu_maya',
            attemptNum: 1,
            attemptStartId: 'att_demo_1',
            overallPct: n1.overallPct,
            rhythmPct: n1.rhythmPct,
            pitchPct: n1.pitchPct,
            resultsJson: n1.resultsJson,
            integrityFlags: [],
            durationSec: 12.4,
            expectedSec: 12.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 87 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 2 * DAY_MS,
          },
          // Priya Patel — True Sight-Read (good score)
          {
            id: 'sub_priya_sr_1',
            assignmentId: 'asgn_true_sr',
            classId: clsId,
            studentId: 'stu_priya',
            attemptNum: 1,
            attemptStartId: 'att_demo_2',
            overallPct: n2.overallPct,
            rhythmPct: n2.rhythmPct,
            pitchPct: n2.pitchPct,
            resultsJson: n2.resultsJson,
            integrityFlags: [],
            durationSec: 11.8,
            expectedSec: 12.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 88 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: 'Nice pitch center on measure 2!',
            gradedAt: now - DAY_MS,
            submittedAt: now - DAY_MS - 3600000,
          },
          // Jordan Ortiz — True Sight-Read (amber flags: low_rms_high_score & true_sight_read_overtime)
          {
            id: 'sub_jordan_sr_1',
            assignmentId: 'asgn_true_sr',
            classId: clsId,
            studentId: 'stu_jordan',
            attemptNum: 1,
            attemptStartId: 'att_demo_3',
            overallPct: n3.overallPct,
            rhythmPct: n3.rhythmPct,
            pitchPct: n3.pitchPct,
            resultsJson: n3.resultsJson,
            integrityFlags: ['low_rms_high_score', 'true_sight_read_overtime'],
            durationSec: 12.1,
            expectedSec: 12.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 88 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 20 * 3600 * 1000,
          },
          // Devon Brooks — True Sight-Read (needs practice, low score)
          {
            id: 'sub_devon_sr_1',
            assignmentId: 'asgn_true_sr',
            classId: clsId,
            studentId: 'stu_devon',
            attemptNum: 1,
            attemptStartId: 'att_demo_4',
            overallPct: n4.overallPct,
            rhythmPct: n4.rhythmPct,
            pitchPct: n4.pitchPct,
            resultsJson: n4.resultsJson,
            integrityFlags: [],
            durationSec: 11.2,
            expectedSec: 12.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 86 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: 'Let us review measures 1–2 together before Friday.',
            gradedAt: now - DAY_MS,
            submittedAt: now - 2 * DAY_MS,
          },
          // Maya Lin — Rhythm Tap Drill (2 attempts showing improvement)
          {
            id: 'sub_maya_rhy_1',
            assignmentId: 'asgn_rhythm_drill',
            classId: clsId,
            studentId: 'stu_maya',
            attemptNum: 1,
            attemptStartId: null,
            overallPct: n6.overallPct,
            rhythmPct: n6.rhythmPct,
            pitchPct: null,
            resultsJson: n6.resultsJson,
            integrityFlags: [],
            durationSec: 11.4,
            expectedSec: 11.4,
            audioAvailable: false,
            audioMime: null,
            audioBytes: 0,
            audioExpiresAt: null,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 2 * DAY_MS,
          },
          {
            id: 'sub_maya_rhy_2',
            assignmentId: 'asgn_rhythm_drill',
            classId: clsId,
            studentId: 'stu_maya',
            attemptNum: 2,
            attemptStartId: null,
            overallPct: n5.overallPct,
            rhythmPct: n5.rhythmPct,
            pitchPct: null,
            resultsJson: n5.resultsJson,
            integrityFlags: [],
            durationSec: 11.5,
            expectedSec: 11.4,
            audioAvailable: false,
            audioMime: null,
            audioBytes: 0,
            audioExpiresAt: null,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: 'Solid subdivision on beat 3!',
            gradedAt: now - DAY_MS,
            submittedAt: now - DAY_MS - 7200000,
          },
          // Jordan Ortiz — Rhythm Tap Drill
          {
            id: 'sub_jordan_rhy_1',
            assignmentId: 'asgn_rhythm_drill',
            classId: clsId,
            studentId: 'stu_jordan',
            attemptNum: 1,
            attemptStartId: null,
            overallPct: n6.overallPct,
            rhythmPct: n6.rhythmPct,
            pitchPct: null,
            resultsJson: n6.resultsJson,
            integrityFlags: [],
            durationSec: 11.1,
            expectedSec: 11.4,
            audioAvailable: false,
            audioMime: null,
            audioBytes: 0,
            audioExpiresAt: null,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 18 * 3600 * 1000,
          },
          // Maya Lin — Vocal Part Check-In (2 attempts)
          {
            id: 'sub_maya_score_1',
            assignmentId: 'asgn_score_vocal',
            classId: clsId,
            studentId: 'stu_maya',
            attemptNum: 1,
            attemptStartId: null,
            overallPct: n8.overallPct,
            rhythmPct: n8.rhythmPct,
            pitchPct: n8.pitchPct,
            resultsJson: n8.resultsJson,
            integrityFlags: [],
            durationSec: 16.0,
            expectedSec: 16.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 89 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 16 * 3600 * 1000,
          },
          {
            id: 'sub_maya_score_2',
            assignmentId: 'asgn_score_vocal',
            classId: clsId,
            studentId: 'stu_maya',
            attemptNum: 2,
            attemptStartId: null,
            overallPct: n7.overallPct,
            rhythmPct: n7.rhythmPct,
            pitchPct: n7.pitchPct,
            resultsJson: n7.resultsJson,
            integrityFlags: [],
            durationSec: 16.2,
            expectedSec: 16.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 89 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 14 * 3600 * 1000,
          },
          // Priya Patel — Vocal Part Check-In
          {
            id: 'sub_priya_score_1',
            assignmentId: 'asgn_score_vocal',
            classId: clsId,
            studentId: 'stu_priya',
            attemptNum: 1,
            attemptStartId: null,
            overallPct: n2.overallPct,
            rhythmPct: n2.rhythmPct,
            pitchPct: n2.pitchPct,
            resultsJson: n2.resultsJson,
            integrityFlags: [],
            durationSec: 15.6,
            expectedSec: 16.0,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 89 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 10 * 3600 * 1000,
          },
          // Priya Patel — 5-Note Major Scale Warm-Up (UNGRADED audio-only submission)
          {
            id: 'sub_priya_audio_1',
            assignmentId: 'asgn_audio_scale',
            classId: clsId,
            studentId: 'stu_priya',
            attemptNum: 1,
            attemptStartId: null,
            overallPct: null,
            rhythmPct: null,
            pitchPct: null,
            resultsJson: null,
            integrityFlags: [],
            durationSec: 2.1,
            expectedSec: null,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 89 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: null,
            teacherComment: '',
            gradedAt: null,
            submittedAt: now - 6 * 3600 * 1000,
          },
          // Maya Lin — 5-Note Major Scale Warm-Up (teacher-graded audio submission)
          {
            id: 'sub_maya_audio_1',
            assignmentId: 'asgn_audio_scale',
            classId: clsId,
            studentId: 'stu_maya',
            attemptNum: 1,
            attemptStartId: null,
            overallPct: null,
            rhythmPct: null,
            pitchPct: null,
            resultsJson: null,
            integrityFlags: [],
            durationSec: 2.1,
            expectedSec: null,
            audioAvailable: true,
            audioMime: 'audio/wav',
            audioBytes: 88244,
            audioExpiresAt: now + 89 * DAY_MS,
            audioDeletedAt: null,
            teacherOverridePct: 95,
            teacherComment: 'Warm, centered tone on "ah"!',
            gradedAt: now - 2 * 3600 * 1000,
            submittedAt: now - 5 * 3600 * 1000,
          },
        ],
      };
    }

    function backfillDemoExcerpts(db) {
      if (!db || !Array.isArray(db.assignments)) return false;
      let changed = false;
      const { solfegeEx, rhythmEx } = createDemoSightExcerpts();
      for (const a of db.assignments) {
        const sr = a?.config?.srState;
        if (a.id === 'asgn_true_sr' && sr && (!sr.ex || !sr.ex.solfege)) {
          sr.ex = clone(solfegeEx);
          changed = true;
        } else if (a.id === 'asgn_rhythm_drill' && sr && (!sr.ex || !sr.ex.rhythm)) {
          sr.ex = clone(rhythmEx);
          changed = true;
        }
      }
      return changed;
    }

    function loadDemoDb() {
      if (memDemoDb) return memDemoDb;
      try {
        const raw = localStorage.getItem(DEMO_DB_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.teacher && Array.isArray(parsed.classes) && Array.isArray(parsed.assignments)) {
            memDemoDb = parsed;
            if (backfillDemoExcerpts(memDemoDb)) saveDemoDb();
            return memDemoDb;
          }
        }
      } catch { }
      memDemoDb = createFreshDemoDb();
      saveDemoDb();
      return memDemoDb;
    }

    function saveDemoDb() {
      if (!memDemoDb) return;
      try { localStorage.setItem(DEMO_DB_KEY, JSON.stringify(memDemoDb)); } catch { }
    }

    function demoErr(status, code, error, extra) {
      return { ok: false, status, code, error, ...(extra || {}) };
    }

    // Same plan shape the live server sends, with the beta flag included.
    function demoPublicPlan(t, now) {
      return { ...computeDemoPlan(t, now), beta: !!t.beta };
    }

    function formatDemoTeacherPublic(db) {
      const t = db.teacher;
      const plan = demoPublicPlan(t, Date.now());
      return {
        id: t.id,
        email: t.email,
        name: t.name || '',
        hasGoogle: !!t.hasGoogle,
        plan,
        createdAt: t.createdAt,
      };
    }

    function demoAuth(db) {
      const tok = getToken();
      if (!tok) return null;
      const sess = db.sessions && db.sessions[tok];
      if (!sess || sess.expiresAt <= Date.now()) {
        if (sess) {
          delete db.sessions[tok];
          saveDemoDb();
        }
        return null;
      }
      return { token: tok, sess, teacher: db.teacher, plan: computeDemoPlan(db.teacher, Date.now()) };
    }

    function assertDemoWritable(auth) {
      if (auth.plan.canWrite) return null;
      return demoErr(
        402,
        'PLAN_READ_ONLY',
        auth.plan.reason || 'Your Online Homework plan is in read-only mode.',
        { plan: auth.plan }
      );
    }

    function demoEffectiveScore(sub) {
      if (sub.teacherOverridePct !== null && sub.teacherOverridePct !== undefined) {
        return Number(sub.teacherOverridePct);
      }
      if (sub.overallPct !== null && sub.overallPct !== undefined) {
        return Number(sub.overallPct);
      }
      return null;
    }

    function demoPickGraded(subs, policy) {
      if (!subs || !subs.length) return null;
      if (policy === 'last') return subs[subs.length - 1];
      let best = null;
      let bestScore = -1;
      for (const s of subs) {
        const sc = demoEffectiveScore(s);
        if (sc !== null && sc >= bestScore) {
          bestScore = sc;
          best = s;
        }
      }
      return best || subs[subs.length - 1];
    }

    // Every demo class has one test student (no sign-in code). Made on demand so older saved demo data gets one too.
    function ensureDemoTestStudent(db, classId) {
      let test = db.students.find(s => s.classId === classId && s.isTest);
      if (!test) {
        const now = Date.now();
        test = {
          id: 'stu_test_' + classId,
          classId,
          displayName: 'Test Student',
          email: null,
          part: '',
          hasGoogle: false,
          hasCode: false,
          codePlain: null,
          codeLocked: false,
          codeCooldownUntil: null,
          archivedAt: null,
          lastActiveAt: null,
          createdAt: now,
          updatedAt: now,
          isTest: true,
        };
        db.students.push(test);
        saveDemoDb();
      }
      return test;
    }

    function demoFormatClass(db, c) {
      const studentCount = db.students.filter(s => s.classId === c.id && !s.archivedAt && !s.isTest).length;
      const assignmentCount = db.assignments.filter(a => a.classId === c.id && !a.archivedAt).length;
      const submissionCount = db.submissions.filter(sub => sub.classId === c.id).length;
      return {
        id: c.id,
        name: c.name,
        joinCode: c.joinCode,
        locked: !!c.locked,
        archivedAt: c.archivedAt ?? null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        studentCount,
        assignmentCount,
        submissionCount,
      };
    }

    function demoFormatStudent(db, s) {
      const subs = db.submissions.filter(sub => sub.studentId === s.id);
      const maxSubAt = subs.reduce((m, x) => Math.max(m, x.submittedAt || 0), 0) || null;
      const lastActiveAt = s.lastActiveAt && maxSubAt
        ? Math.max(s.lastActiveAt, maxSubAt)
        : (s.lastActiveAt || maxSubAt || null);
      return {
        id: s.id,
        displayName: s.displayName,
        email: s.email || null,
        part: s.part || '',
        hasGoogle: !!s.hasGoogle,
        hasCode: !!s.hasCode,
        codeLocked: !!s.codeLocked,
        codeCooldownUntil: s.codeCooldownUntil && s.codeCooldownUntil > Date.now() ? s.codeCooldownUntil : null,
        archivedAt: s.archivedAt ?? null,
        isTest: !!s.isTest,
        submissionCount: subs.length,
        lastActiveAt,
      };
    }

    function demoFormatAssignment(db, a, includeStats) {
      const out = {
        id: a.id,
        classId: a.classId,
        title: a.title,
        instructions: a.instructions || '',
        type: a.type,
        mode: a.mode,
        config: clone(a.config || {}),
        hasScoreFile: !!a.hasScoreFile,
        scoreFilename: a.scoreFilename || null,
        scoreBytes: Number(a.scoreBytes || 0),
        dueAt: a.dueAt ?? null,
        maxAttempts: a.maxAttempts ?? null,
        gradePolicy: a.gradePolicy || 'best',
        published: !!a.published,
        archivedAt: a.archivedAt ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
      if (includeStats) {
        const subs = db.submissions.filter(s => s.assignmentId === a.id);
        const uniqueIds = new Set(subs.map(s => s.studentId));
        const scored = subs.map(demoEffectiveScore).filter(v => v !== null);
        out.submissionCount = subs.length;
        out.uniqueStudentCount = uniqueIds.size;
        out.avgPct = scored.length ? Math.round(scored.reduce((acc, v) => acc + v, 0) / scored.length) : null;
      }
      return out;
    }

    function demoBuildGradebook(db, classId) {
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return null;
      const now = Date.now();

      const students = db.students
        .filter(s => s.classId === classId && !s.archivedAt && !s.isTest)
        .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));

      const assignments = db.assignments
        .filter(a => a.classId === classId && !a.archivedAt)
        .sort((a, b) => ((a.dueAt || a.createdAt) - (b.dueAt || b.createdAt)) || (a.createdAt - b.createdAt));

      const subs = db.submissions
        .filter(s => s.classId === classId)
        .sort((a, b) => (a.submittedAt - b.submittedAt) || (a.attemptNum - b.attemptNum));

      const byPair = new Map();
      for (const s of subs) {
        const key = `${s.studentId}:${s.assignmentId}`;
        let arr = byPair.get(key);
        if (!arr) { arr = []; byPair.set(key, arr); }
        arr.push(s);
      }

      const studentRows = students.map(st => {
        const cells = {};
        let scoreSum = 0;
        let scoreCount = 0;
        for (const a of assignments) {
          const list = byPair.get(`${st.id}:${a.id}`) || [];
          if (!list.length) {
            cells[a.id] = {
              status: 'missing',
              score: null,
              attempts: 0,
              hasFlags: false,
              submissionId: null,
              submittedAt: null,
              audioAvailable: false,
              overridden: false,
            };
            continue;
          }
          const chosen = demoPickGraded(list, a.gradePolicy);
          const score = demoEffectiveScore(chosen);
          if (score !== null) {
            scoreSum += score;
            scoreCount++;
          }
          const hasFlags = list.some(x => (x.integrityFlags || []).length > 0);
          const chosenFlags = chosen.integrityFlags || [];
          const audioAvailable = !!(
            chosen.audioAvailable &&
            !chosen.audioDeletedAt &&
            (!chosen.audioExpiresAt || chosen.audioExpiresAt > now)
          );
          cells[a.id] = {
            status: score === null ? 'submitted' : 'graded',
            score,
            overallPct: chosen.overallPct,
            rhythmPct: chosen.rhythmPct,
            pitchPct: chosen.pitchPct,
            teacherOverridePct: chosen.teacherOverridePct,
            overridden: chosen.teacherOverridePct !== null && chosen.teacherOverridePct !== undefined,
            attempts: list.length,
            hasFlags,
            flagCount: chosenFlags.length,
            submissionId: chosen.id,
            submittedAt: chosen.submittedAt,
            audioAvailable,
            hasComment: !!chosen.teacherComment,
          };
        }
        return {
          id: st.id,
          displayName: st.displayName,
          email: st.email || null,
          part: st.part || '',
          averagePct: scoreCount ? Math.round(scoreSum / scoreCount) : null,
          cells,
        };
      });

      return {
        ok: true,
        class: { id: cls.id, name: cls.name, joinCode: cls.joinCode },
        assignments: assignments.map(a => ({
          id: a.id,
          title: a.title,
          type: a.type,
          mode: a.mode,
          dueAt: a.dueAt,
          maxAttempts: a.maxAttempts,
          gradePolicy: a.gradePolicy,
          published: !!a.published,
        })),
        students: studentRows,
      };
    }

    function demoActiveStudentCount(db) {
      const activeClasses = new Set(db.classes.filter(c => !c.archivedAt).map(c => c.id));
      return db.students.filter(s => activeClasses.has(s.classId) && !s.archivedAt && !s.isTest).length;
    }

    function setDemoPlan(status) {
      const db = loadDemoDb();
      const now = Date.now();
      const next = String(status || '').trim();
      if (next === 'trialing') {
        db.teacher.planStatus = 'trialing';
        db.teacher.trialEndsAt = now + 24 * DAY_MS;
        db.teacher.graceEndsAt = null;
        db.teacher.planEndsAt = null;
      } else if (next === 'active' || next === 'po_active') {
        db.teacher.planStatus = next;
        db.teacher.planEndsAt = now + 30 * DAY_MS;
        db.teacher.graceEndsAt = null;
      } else if (next === 'past_due') {
        db.teacher.planStatus = 'past_due';
        db.teacher.graceEndsAt = now + 4 * DAY_MS;
      } else if (next === 'expired' || next === 'canceled') {
        db.teacher.planStatus = next;
        db.teacher.trialEndsAt = now - DAY_MS;
        db.teacher.graceEndsAt = null;
        db.teacher.planEndsAt = null;
      } else {
        return demoErr(400, 'INVALID_PLAN', 'Unknown plan status.');
      }
      saveDemoDb();
      return {
        ok: true,
        teacher: formatDemoTeacherPublic(db),
        plan: computeDemoPlan(db.teacher, now),
      };
    }

    function resetDemoData() {
      const prevToken = getToken();
      const wasEphemeral = isEphemeral();
      memDemoDb = createFreshDemoDb();
      if (prevToken) {
        memDemoDb.sessions[prevToken] = {
          createdAt: Date.now(),
          expiresAt: Date.now() + 30 * DAY_MS,
          ephemeral: wasEphemeral,
        };
      }
      setDemoOffline(false);
      saveDemoDb();
      clearCache();
      return { ok: true, reset: true };
    }

    function loadDemoHandoffs() {
      try {
        return JSON.parse(localStorage.getItem(DEMO_HANDOFFS_KEY) || '{}') || {};
      } catch {
        return {};
      }
    }

    function saveDemoHandoffs(map) {
      try { localStorage.setItem(DEMO_HANDOFFS_KEY, JSON.stringify(map || {})); } catch { }
    }

    function requireDemoSession(db) {
      const auth = demoAuth(db);
      if (!auth) return { err: demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.') };
      return { auth };
    }

    return {
      getDemoOffline,
      setDemoOffline,
      setDemoPlan,
      resetDemoData,

      async emailStart({ email }) {
        if (isOffline()) return offlineErr('Connect to the internet to request a sign-in code.');
        const norm = normalizeEmail(email);
        if (!norm) return demoErr(400, 'INVALID_EMAIL', 'Enter a valid email address.');
        const db = loadDemoDb();
        const devCode = '482913';
        db.pendingEmailCodes[norm] = { code: devCode, expiresAt: Date.now() + 10 * 60 * 1000 };
        saveDemoDb();
        return { ok: true, sent: true, expiresInSec: 600, devCode };
      },

      async emailVerify({ email, code, ephemeral = false, name = '' }) {
        if (isOffline()) return offlineErr('Connect to the internet to verify your sign-in code.');
        const norm = normalizeEmail(email);
        const cleanCode = String(code || '').replace(/\s+/g, '');
        if (!norm || !/^\d{6}$/.test(cleanCode)) {
          return demoErr(400, 'INVALID_INPUT', 'Enter your email and the 6-digit code.');
        }
        const db = loadDemoDb();
        const pending = db.pendingEmailCodes[norm];
        if (!pending || pending.expiresAt <= Date.now()) {
          return demoErr(401, 'CODE_EXPIRED', 'That code expired or was already used. Request a fresh code.');
        }
        if (pending.code !== cleanCode) {
          return demoErr(401, 'INVALID_CODE', 'Incorrect code. Check your email and try again.');
        }
        delete db.pendingEmailCodes[norm];

        if (norm !== 'ms.rivera@oakridge.edu') {
          db.teacher.email = norm;
          if (name && name.trim()) db.teacher.name = name.trim().slice(0, 120);
          else if (!db.teacher.name) db.teacher.name = norm.split('@')[0];
        } else if (name && name.trim()) {
          db.teacher.name = name.trim().slice(0, 120);
        }

        const now = Date.now();
        const ttl = ephemeral ? 12 * 60 * 60 * 1000 : 30 * DAY_MS;
        const token = 'demo_tch_' + Math.random().toString(36).slice(2, 12);
        db.sessions[token] = { createdAt: now, expiresAt: now + ttl, ephemeral: !!ephemeral };
        saveDemoDb();
        setSession(token, !!ephemeral);
        return {
          ok: true,
          token,
          expiresAt: now + ttl,
          ephemeral: !!ephemeral,
          teacher: formatDemoTeacherPublic(db),
        };
      },

      async oauthHandoffStart({ ephemeral = false } = {}) {
        if (isOffline()) return offlineErr('Connect to the internet to start browser sign-in.');
        const now = Date.now();
        const state = 'ho_' + randomHandoffHex(12);
        const pollSecret = randomHandoffHex(16);
        const map = loadDemoHandoffs();
        for (const k of Object.keys(map)) {
          if (!map[k] || (map[k].expiresAt && map[k].expiresAt <= now)) delete map[k];
        }
        map[state] = {
          state,
          pollSecret,
          ephemeral: !!ephemeral,
          status: 'pending',
          expiresAt: now + 60 * 1000,
          createdAt: now,
        };
        saveDemoHandoffs(map);
        return { ok: true, state, pollSecret, expiresInSec: 60 };
      },

      async oauthHandoffPoll({ state, pollSecret, ephemeral = false } = {}) {
        if (isOffline()) return offlineErr('You are offline.');
        const now = Date.now();
        const map = loadDemoHandoffs();
        const entry = map[state];
        if (!entry || entry.expiresAt <= now || entry.status === 'claimed') {
          return demoErr(410, 'HANDOFF_EXPIRED', 'Sign-in handoff expired.');
        }
        if (entry.pollSecret !== pollSecret) {
          return demoErr(401, 'UNAUTHORIZED', 'Unauthorized poll.');
        }
        if (entry.status !== 'complete') {
          return { ok: true, status: 'pending' };
        }

        const db = loadDemoDb();
        db.teacher.hasGoogle = true;
        const useEphemeral = !!(entry.ephemeral || ephemeral);
        const ttl = useEphemeral ? 12 * 60 * 60 * 1000 : 30 * DAY_MS;
        const token = 'demo_hotch_' + Math.random().toString(36).slice(2, 12);
        db.sessions[token] = { createdAt: now, expiresAt: now + ttl, ephemeral: useEphemeral };
        saveDemoDb();

        entry.status = 'claimed';
        saveDemoHandoffs(map);
        setSession(token, useEphemeral);
        return {
          ok: true,
          status: 'complete',
          token,
          teacher: formatDemoTeacherPublic(db),
        };
      },

      async googleAuth({ ephemeral = false }) {
        if (isOffline()) return offlineErr('Connect to the internet to sign in with Google.');
        const db = loadDemoDb();
        db.teacher.hasGoogle = true;
        const now = Date.now();
        const ttl = ephemeral ? 12 * 60 * 60 * 1000 : 30 * DAY_MS;
        const token = 'demo_gtch_' + Math.random().toString(36).slice(2, 12);
        db.sessions[token] = { createdAt: now, expiresAt: now + ttl, ephemeral: !!ephemeral };
        saveDemoDb();
        setSession(token, !!ephemeral);
        return {
          ok: true,
          token,
          expiresAt: now + ttl,
          ephemeral: !!ephemeral,
          teacher: formatDemoTeacherPublic(db),
        };
      },

      async getMe() {
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const teacher = formatDemoTeacherPublic(db);
        const activeStudentCount = demoActiveStudentCount(db);
        const overSoftCap = activeStudentCount > (teacher.plan.studentSoftCap || DEFAULT_SOFT_CAP);
        const out = {
          ok: true,
          teacher,
          activeStudentCount,
          overSoftCap,
          ephemeral: !!auth.sess.ephemeral,
        };
        const cache = loadCache();
        cache.me = {
          teacher: out.teacher,
          activeStudentCount: out.activeStudentCount,
          overSoftCap: out.overSoftCap,
          ephemeral: out.ephemeral,
        };
        saveCache(cache);
        if (isOffline()) out.offline = true;
        return out;
      },

      async logout() {
        const db = loadDemoDb();
        const tok = getToken();
        if (tok && db.sessions[tok]) {
          delete db.sessions[tok];
          saveDemoDb();
        }
        clearSession();
        clearCache();
        return { ok: true };
      },

      async logoutAll() {
        if (isOffline()) return offlineErr('Connect to the internet to sign out all devices.');
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        db.sessions = {};
        saveDemoDb();
        clearSession();
        clearCache();
        return { ok: true, signedOutAllDevices: true };
      },

      async billingCheckout() {
        if (isOffline()) return offlineErr();
        return demoErr(
          400,
          'DEMO_MODE',
          'Stripe Checkout requires a live homework server. Use the Plan State preview buttons below to test Trialing, Active, Past-Due, and Expired modes.'
        );
      },

      async billingPortal() {
        if (isOffline()) return offlineErr();
        return demoErr(
          400,
          'DEMO_MODE',
          'Billing Portal requires a live homework server. Use the Plan State preview buttons below to test plan states.'
        );
      },

      async startTrial() {
        const db = loadDemoDb();
        db.teacher.planStatus = 'trialing';
        db.teacher.trialEndsAt = Date.now() + 30 * DAY_MS;
        saveDemoDb();
        return { ok: true, plan: demoPublicPlan(db.teacher, Date.now()) };
      },

      async redeemBeta(code) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const entered = String(code || '').trim().toUpperCase();
        if (entered !== 'BETA-DEMO-01') {
          return demoErr(400, 'BETA_INVALID', 'That beta code isn’t valid.');
        }
        const now = Date.now();
        db.teacher.planStatus = 'po_active';
        db.teacher.beta = true;
        db.teacher.poReference = 'Beta: Demo';
        db.teacher.planEndsAt = now + 90 * DAY_MS;
        db.teacher.graceEndsAt = null;
        saveDemoDb();
        return { ok: true, plan: demoPublicPlan(db.teacher, now) };
      },

      async listClasses(includeArchived = false) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        if (isOffline()) {
          const cache = loadCache();
          if (cache.classes) {
            const list = includeArchived ? cache.classes : cache.classes.filter(c => !c.archivedAt);
            return { ok: true, fromCache: true, offline: true, classes: clone(list) };
          }
        }
        const classes = db.classes
          .filter(c => includeArchived || !c.archivedAt)
          .sort((a, b) => (!!a.archivedAt - !!b.archivedAt) || (b.createdAt - a.createdAt))
          .map(c => demoFormatClass(db, c));
        const cache = loadCache();
        cache.classes = db.classes.map(c => demoFormatClass(db, c));
        saveCache(cache);
        return { ok: true, classes };
      },

      async createClass({ name, locked = false }) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;

        const cleanName = String(name || '').trim().slice(0, 120);
        if (!cleanName) return demoErr(400, 'INVALID_NAME', 'Enter a class name.');
        const used = new Set(db.classes.map(c => c.joinCode));
        const now = Date.now();
        const cls = {
          id: makeId('cls'),
          name: cleanName,
          joinCode: generateCode6(used),
          locked: !!locked,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        db.classes.unshift(cls);
        saveDemoDb();
        return { ok: true, class: demoFormatClass(db, cls) };
      },

      async updateClass(classId, patch) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');

        const p = patch || {};
        const needsWritable = p.name !== undefined || p.locked !== undefined || p.rotateJoinCode === true || (p.archived !== undefined && !p.archived);
        if (needsWritable) {
          const blocked = assertDemoWritable(auth);
          if (blocked) return blocked;
        }

        const now = Date.now();
        if (p.name !== undefined) {
          const cleanName = String(p.name || '').trim().slice(0, 120);
          if (!cleanName) return demoErr(400, 'INVALID_NAME', 'Class name cannot be empty.');
          cls.name = cleanName;
        }
        if (p.locked !== undefined) cls.locked = !!p.locked;
        if (p.archived !== undefined) cls.archivedAt = p.archived ? (cls.archivedAt || now) : null;
        if (p.rotateJoinCode === true) {
          const used = new Set(db.classes.map(c => c.joinCode));
          cls.joinCode = generateCode6(used);
        }
        cls.updatedAt = now;
        saveDemoDb();
        const out = { ok: true, class: demoFormatClass(db, cls) };
        if (p.archived) out.sessionsRevoked = 0;
        return out;
      },

      async deleteClass(classId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const idx = db.classes.findIndex(c => c.id === classId);
        if (idx < 0) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        db.classes.splice(idx, 1);
        db.students = db.students.filter(s => s.classId !== classId);
        db.assignments = db.assignments.filter(a => a.classId !== classId);
        db.submissions = db.submissions.filter(sub => sub.classId !== classId);
        db.practiceTracks = (db.practiceTracks || []).filter(t => t.classId !== classId);
        saveDemoDb();
        return { ok: true, deleted: true, classId, deletedR2Objects: 0 };
      },

      async openTestStudent() {
        return { ok: true, token: 'demo-test-student' };
      },

      async listStudents(classId, includeArchived = false) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        if (isOffline()) {
          const cache = loadCache();
          const entry = cache.studentsByClass[classId];
          if (entry) {
            const list = includeArchived ? entry.students : (entry.students || []).filter(s => !s.archivedAt);
            return { ok: true, fromCache: true, offline: true, class: clone(entry.class), students: clone(list) };
          }
        }
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        ensureDemoTestStudent(db, classId);
        const students = db.students
          .filter(s => s.classId === classId && (includeArchived || !s.archivedAt))
          .sort((a, b) => (!!b.isTest - !!a.isTest) || (!!a.archivedAt - !!b.archivedAt) || a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()))
          .map(s => demoFormatStudent(db, s));
        const formattedCls = demoFormatClass(db, cls);
        const cache = loadCache();
        cache.studentsByClass[classId] = {
          class: formattedCls,
          students: db.students.filter(s => s.classId === classId).map(s => demoFormatStudent(db, s)),
          updatedAt: Date.now(),
        };
        saveCache(cache);
        return { ok: true, class: formattedCls, students };
      },

      async addStudents(classId, list, generateCode = true) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        if (!list.length) return demoErr(400, 'INVALID_INPUT', 'Add at least one student.');
        if (list.length > 250) return demoErr(400, 'TOO_MANY_STUDENTS', 'You can add up to 250 students at a time.');

        const used = new Set(db.students.filter(s => s.classId === classId && s.codePlain).map(s => s.codePlain));
        const now = Date.now();
        const createdStudents = [];
        const generatedCodes = [];

        for (let i = 0; i < list.length; i++) {
          const item = list[i] || {};
          const displayName = String(item.displayName !== undefined ? item.displayName : (item.name || '')).trim().slice(0, 120);
          if (!displayName) return demoErr(400, 'INVALID_NAME', `Student #${i + 1} needs a name.`);
          let email = null;
          if (item.email !== undefined && item.email !== null && String(item.email).trim() !== '') {
            email = normalizeEmail(item.email);
            if (!email) return demoErr(400, 'INVALID_EMAIL', `Invalid email address for ${displayName}.`);
          }
          const part = String(item.part || '').trim().slice(0, 80);
          const wantCode = item.generateCode !== undefined ? item.generateCode !== false : (generateCode !== false);
          const codePlain = wantCode ? generateCode6(used) : null;
          const row = {
            id: makeId('stu'),
            classId,
            displayName,
            email,
            part,
            hasGoogle: false,
            hasCode: !!codePlain,
            codePlain,
            codeLocked: false,
            codeCooldownUntil: null,
            archivedAt: null,
            lastActiveAt: null,
            createdAt: now,
            updatedAt: now,
          };
          db.students.push(row);
          createdStudents.push(demoFormatStudent(db, row));
          if (codePlain) {
            generatedCodes.push({ studentId: row.id, displayName, part, code: codePlain });
          }
        }
        saveDemoDb();
        return { ok: true, students: createdStudents, generatedCodes, count: createdStudents.length };
      },

      async updateStudent(classId, studentId, patch) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const stu = db.students.find(s => s.id === studentId && s.classId === classId);
        if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');

        const p = patch || {};
        const needsWritable = p.displayName !== undefined || p.email !== undefined || p.part !== undefined || (p.archived !== undefined && !p.archived);
        if (needsWritable) {
          const blocked = assertDemoWritable(auth);
          if (blocked) return blocked;
        }

        const now = Date.now();
        if (p.displayName !== undefined) {
          const dn = String(p.displayName || '').trim().slice(0, 120);
          if (!dn) return demoErr(400, 'INVALID_NAME', 'Student name cannot be empty.');
          stu.displayName = dn;
        }
        if (p.email !== undefined) {
          if (p.email === null || String(p.email).trim() === '') stu.email = null;
          else {
            const em = normalizeEmail(p.email);
            if (!em) return demoErr(400, 'INVALID_EMAIL', 'Enter a valid email address.');
            stu.email = em;
          }
        }
        if (p.part !== undefined) stu.part = String(p.part || '').trim().slice(0, 80);
        if (p.archived !== undefined) stu.archivedAt = p.archived ? (stu.archivedAt || now) : null;
        stu.updatedAt = now;
        saveDemoDb();
        const out = { ok: true, student: demoFormatStudent(db, stu) };
        if (p.archived) out.sessionsRevoked = 0;
        return out;
      },

      async deleteStudent(classId, studentId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const idx = db.students.findIndex(s => s.id === studentId && s.classId === classId);
        if (idx < 0) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');
        db.students.splice(idx, 1);
        db.submissions = db.submissions.filter(sub => !(sub.studentId === studentId && sub.classId === classId));
        saveDemoDb();
        return { ok: true, deleted: true, studentId, deletedR2Objects: 0 };
      },

      async listStudentCodes() {
        return { ok: true, codes: {} };
      },

      async regenerateStudentCode(classId, studentId, revokeSessions = true) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const stu = db.students.find(s => s.id === studentId && s.classId === classId);
        if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');
        if (stu.isTest) return demoErr(400, 'TEST_STUDENT', 'The test student does not have a sign-in code.');

        const used = new Set(db.students.filter(s => s.classId === classId && s.codePlain).map(s => s.codePlain));
        const newCode = generateCode6(used);
        stu.hasCode = true;
        stu.codePlain = newCode;
        stu.codeLocked = false;
        stu.codeCooldownUntil = null;
        stu.updatedAt = Date.now();
        saveDemoDb();
        return {
          ok: true,
          studentId: stu.id,
          displayName: stu.displayName,
          part: stu.part || '',
          code: newCode,
          sessionsRevoked: revokeSessions !== false,
        };
      },

      async regenerateClassCodes(classId, opts = {}) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');

        const filterIds = Array.isArray(opts?.studentIds) && opts.studentIds.length ? new Set(opts.studentIds) : null;
        const targets = db.students
          .filter(s => s.classId === classId && !s.archivedAt && !s.isTest && (!filterIds || filterIds.has(s.id)))
          .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));
        const used = new Set();
        const now = Date.now();
        const generatedCodes = [];
        for (const st of targets) {
          const newCode = generateCode6(used);
          st.hasCode = true;
          st.codePlain = newCode;
          st.codeLocked = false;
          st.codeCooldownUntil = null;
          st.updatedAt = now;
          generatedCodes.push({
            studentId: st.id,
            displayName: st.displayName,
            part: st.part || '',
            code: newCode,
          });
        }
        saveDemoDb();
        return {
          ok: true,
          classId,
          generatedCodes,
          count: generatedCodes.length,
          sessionsRevoked: opts?.revokeSessions !== false,
        };
      },

      async revokeStudentSessions(classId, studentId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const stu = db.students.find(s => s.id === studentId && s.classId === classId);
        if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');
        return { ok: true, studentId, revokedCount: 1 };
      },

      async revokeClassSessions(classId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const count = db.students.filter(s => s.classId === classId && !s.archivedAt && !s.isTest).length;
        return { ok: true, classId, revokedCount: count };
      },

      async listAssignments(classId, includeArchived = false) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        if (isOffline()) {
          const cache = loadCache();
          const entry = cache.assignmentsByClass[classId];
          if (entry) {
            const list = includeArchived ? entry.assignments : (entry.assignments || []).filter(a => !a.archivedAt);
            return { ok: true, fromCache: true, offline: true, assignments: clone(list) };
          }
        }
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const assignments = db.assignments
          .filter(a => a.classId === classId && (includeArchived || !a.archivedAt))
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(a => demoFormatAssignment(db, a, true));
        const cache = loadCache();
        cache.assignmentsByClass[classId] = {
          assignments: db.assignments.filter(a => a.classId === classId).map(a => demoFormatAssignment(db, a, true)),
          updatedAt: Date.now(),
        };
        saveCache(cache);
        return { ok: true, assignments };
      },

      async createAssignment(classId, body) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const cls = db.classes.find(c => c.id === classId && !c.archivedAt);
        if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found or archived.');

        const d = body || {};
        const title = String(d.title || '').trim().slice(0, 200);
        if (!title) return demoErr(400, 'INVALID_TITLE', 'Assignment title is required.');
        const type = String(d.type || '').trim();
        if (!['sight', 'score', 'audio'].includes(type)) {
          return demoErr(400, 'INVALID_TYPE', 'Assignment type must be sight, score, or audio.');
        }
        let mode = d.mode ? String(d.mode).trim() : 'practice';
        if (!['practice', 'true_sight_read'].includes(mode)) {
          return demoErr(400, 'INVALID_MODE', 'Assignment mode must be practice or true_sight_read.');
        }
        if (type !== 'sight') mode = 'practice';

        const cfg = clone(d.config && typeof d.config === 'object' ? d.config : {});
        const rs = cfg.strictness && typeof cfg.strictness === 'object' ? cfg.strictness : {};
        cfg.strictness = {
          rhythm: Number.isFinite(Number(rs.rhythm)) ? Math.max(0, Math.min(100, Math.round(Number(rs.rhythm)))) : 50,
          pitch: Number.isFinite(Number(rs.pitch)) ? Math.max(0, Math.min(100, Math.round(Number(rs.pitch)))) : 50,
        };
        if (mode === 'true_sight_read') {
          const ss = Number(cfg.studySeconds);
          cfg.studySeconds = Number.isFinite(ss) ? Math.max(15, Math.min(60, Math.round(ss))) : 30;
        }

        const now = Date.now();
        const maxAttempts = d.maxAttempts !== undefined && d.maxAttempts !== null && d.maxAttempts !== ''
          ? Math.floor(Number(d.maxAttempts))
          : (mode === 'true_sight_read' ? 1 : null);
        const dueAt = d.dueAt ? Math.round(Number(d.dueAt)) : null;

        const row = {
          id: makeId('asgn'),
          classId,
          title,
          instructions: String(d.instructions || '').trim().slice(0, 4000),
          type,
          mode,
          config: cfg,
          hasScoreFile: false,
          scoreFilename: null,
          scoreBytes: 0,
          dueAt,
          maxAttempts,
          gradePolicy: d.gradePolicy === 'last' ? 'last' : 'best',
          published: d.published === undefined ? true : !!d.published,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        db.assignments.unshift(row);
        saveDemoDb();
        return { ok: true, assignment: demoFormatAssignment(db, row, false) };
      },

      async updateAssignment(assignmentId, patch) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const row = db.assignments.find(a => a.id === assignmentId);
        if (!row) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

        const p = patch || {};
        const nonArchiveKeys = Object.keys(p).filter(k => k !== 'archived');
        const isArchiveOnly = nonArchiveKeys.length === 0 && p.archived === true;
        if (!isArchiveOnly) {
          const blocked = assertDemoWritable(auth);
          if (blocked) return blocked;
        }

        const now = Date.now();
        if (p.title !== undefined) {
          const t = String(p.title || '').trim().slice(0, 200);
          if (!t) return demoErr(400, 'INVALID_TITLE', 'Assignment title cannot be empty.');
          row.title = t;
        }
        if (p.instructions !== undefined) row.instructions = String(p.instructions || '').trim().slice(0, 4000);
        if (p.mode !== undefined) {
          row.mode = row.type === 'sight' && p.mode === 'true_sight_read' ? 'true_sight_read' : 'practice';
        }
        if (p.config !== undefined) row.config = clone(p.config || {});
        if (p.dueAt !== undefined) row.dueAt = p.dueAt ? Math.round(Number(p.dueAt)) : null;
        if (p.maxAttempts !== undefined) {
          row.maxAttempts = (p.maxAttempts === null || p.maxAttempts === '') ? null : Math.floor(Number(p.maxAttempts));
        }
        if (p.gradePolicy !== undefined) row.gradePolicy = p.gradePolicy === 'last' ? 'last' : 'best';
        if (p.published !== undefined) row.published = !!p.published;
        if (p.archived !== undefined) row.archivedAt = p.archived ? (row.archivedAt || now) : null;
        row.updatedAt = now;
        saveDemoDb();
        return { ok: true, assignment: demoFormatAssignment(db, row, false) };
      },

      async deleteAssignment(assignmentId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const idx = db.assignments.findIndex(a => a.id === assignmentId);
        if (idx < 0) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
        db.assignments.splice(idx, 1);
        db.submissions = db.submissions.filter(s => s.assignmentId !== assignmentId);
        saveDemoDb();
        return { ok: true, deleted: true, id: assignmentId };
      },

      async uploadAssignmentScore(assignmentId, { blob, baseName, lower }) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const row = db.assignments.find(a => a.id === assignmentId);
        if (!row) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
        if (row.type !== 'score') {
          return demoErr(400, 'NOT_SCORE_ASSIGNMENT', 'Score files can only be uploaded to Score Practice assignments.');
        }
        const now = Date.now();
        const mime = lower.endsWith('.mxl') ? 'application/vnd.recordare.musicxml' : 'application/xml; charset=utf-8';
        row.hasScoreFile = true;
        row.scoreFilename = baseName;
        row.scoreBytes = blob.size;
        row.updatedAt = now;
        saveDemoDb();
        return {
          ok: true,
          assignmentId,
          scoreFilename: baseName,
          scoreBytes: blob.size,
          contentType: mime,
          updatedAt: now,
        };
      },

      async listPracticeTracks(classId, includeArchived = false) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const tracks = (db.practiceTracks || [])
          .filter(t => t.classId === classId && (includeArchived || !t.archivedAt))
          .sort((a, b) => b.createdAt - a.createdAt);
        return { ok: true, tracks: JSON.parse(JSON.stringify(tracks)) };
      },

      async uploadPracticeTrack(classId, { blob, baseName }, cleanTitle) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        if (!db.classes.find(c => c.id === classId)) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        db.practiceTracks ||= [];
        if (db.practiceTracks.filter(t => t.classId === classId && !t.archivedAt).length >= 40) {
          return demoErr(409, 'TRACK_LIMIT_REACHED', 'This class already has 40 practice tracks. Archive or delete one to add another.');
        }
        const track = {
          id: makeId('pt'), classId, title: cleanTitle, scoreFilename: baseName,
          scoreBytes: blob.size, createdAt: Date.now(), archivedAt: null,
        };
        db.practiceTracks.push(track);
        saveDemoDb();
        return { ok: true, track: JSON.parse(JSON.stringify(track)) };
      },

      async updatePracticeTrack(trackId, patch) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const t = (db.practiceTracks || []).find(x => x.id === trackId);
        if (!t) return demoErr(404, 'TRACK_NOT_FOUND', 'Practice track not found.');
        const p = patch || {};
        if (p.title !== undefined) {
          const nt = String(p.title || '').trim().slice(0, 120);
          if (!nt) return demoErr(400, 'INVALID_TITLE', 'Practice track name is required.');
          t.title = nt;
        }
        if (p.archived !== undefined) t.archivedAt = p.archived ? (t.archivedAt || Date.now()) : null;
        saveDemoDb();
        return { ok: true, track: JSON.parse(JSON.stringify(t)) };
      },

      async deletePracticeTrack(trackId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const list = db.practiceTracks || [];
        const idx = list.findIndex(x => x.id === trackId);
        if (idx < 0) return demoErr(404, 'TRACK_NOT_FOUND', 'Practice track not found.');
        list.splice(idx, 1);
        saveDemoDb();
        return { ok: true, deleted: true, id: trackId };
      },

      async downloadAssignmentScore(assignmentId) {
        const db = loadDemoDb();
        const a = db.assignments.find(x => x.id === assignmentId);
        const xml = a?.config?.demoXml || (typeof HW_SAMPLE_MUSICXML !== 'undefined' ? HW_SAMPLE_MUSICXML : '');
        if (!xml) return demoErr(404, 'SCORE_NOT_FOUND', 'No score file for this assignment.');
        return { ok: true, blob: new Blob([xml], { type: 'application/xml' }), filename: a?.scoreFilename || 'Score.musicxml' };
      },

      async createAssignmentPreview(assignmentId) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const row = db.assignments.find(a => a.id === assignmentId);
        if (!row) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
        const cls = db.classes.find(c => c.id === row.classId) || { id: row.classId, name: 'Demo Class', joinCode: '' };
        const key = makeId('prv');
        const now = Date.now();
        let map = {};
        try {
          map = JSON.parse(localStorage.getItem(PREVIEW_DRAFT_KEY) || '{}') || {};
        } catch { map = {}; }
        const cutoff = now - DAY_MS;
        const freshEntries = Object.entries(map)
          .filter(([, v]) => v && Number(v.savedAt || 0) > cutoff)
          .sort((a, b) => Number(b[1].savedAt || 0) - Number(a[1].savedAt || 0))
          .slice(0, 9);
        const nextMap = Object.fromEntries(freshEntries);
        nextMap[key] = {
          savedAt: now,
          class: {
            id: cls.id,
            name: cls.name,
            joinCode: cls.joinCode,
            teacherName: db.teacher?.name || 'Teacher',
            acceptingSubmissions: true,
          },
          assignment: clone(row),
        };
        try {
          localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify(nextMap));
        } catch {
          return demoErr(500, 'PREVIEW_STORE_FAILED', 'Could not prepare local preview.');
        }
        const token = `demo:${key}`;
        return {
          ok: true,
          previewToken: token,
          expiresAt: now + 2 * 60 * 60 * 1000,
          assignmentId: row.id,
          previewUrl: buildPreviewPortalUrl(token, { demo: true }),
        };
      },

      async getGradebook(classId) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        if (isOffline()) {
          const cache = loadCache();
          const entry = cache.gradebookByClass[classId];
          if (entry) {
            return {
              ok: true,
              fromCache: true,
              offline: true,
              class: clone(entry.class),
              assignments: clone(entry.assignments),
              students: clone(entry.students),
            };
          }
        }
        const gb = demoBuildGradebook(db, classId);
        if (!gb) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
        const cache = loadCache();
        cache.gradebookByClass[classId] = {
          class: clone(gb.class),
          assignments: clone(gb.assignments),
          students: clone(gb.students),
          updatedAt: Date.now(),
        };
        saveCache(cache);
        return gb;
      },

      async downloadGradebookCsv(classId, assignmentId) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        let gb;
        let subsForAsgn;
        if (isOffline()) {
          const cache = loadCache();
          gb = cache.gradebookByClass[classId] || demoBuildGradebook(db, classId);
          subsForAsgn = assignmentId ? cache.submissionsByAsgn[assignmentId]?.submissions : null;
        } else {
          gb = demoBuildGradebook(db, classId);
          subsForAsgn = assignmentId
            ? db.submissions.filter(s => s.assignmentId === assignmentId)
            : null;
        }
        if (!gb) {
          return offlineErr('Gradebook is not cached for offline CSV export yet. Open the gradebook while online first.');
        }
        const built = buildGradebookCsvString(gb, assignmentId, subsForAsgn);
        if (!built) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found in gradebook.');
        triggerDownload(built.csv, built.filename, 'text/csv;charset=utf-8');
        return { ok: true, filename: built.filename, fromCache: isOffline() };
      },

      async listSubmissions(assignmentId) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        if (isOffline()) {
          const cache = loadCache();
          const entry = cache.submissionsByAsgn[assignmentId];
          if (entry) {
            return {
              ok: true,
              fromCache: true,
              offline: true,
              assignment: clone(entry.assignment),
              submissions: clone(entry.submissions),
            };
          }
        }
        const asgn = db.assignments.find(a => a.id === assignmentId);
        if (!asgn) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

        const now = Date.now();
        const stuById = new Map(db.students.map(s => [s.id, s]));
        const rows = db.submissions
          .filter(s => s.assignmentId === assignmentId)
          .sort((a, b) => (b.submittedAt - a.submittedAt) || (b.attemptNum - a.attemptNum))
          .map(s => {
            const st = stuById.get(s.studentId);
            const audioAvailable = !!(
              s.audioAvailable &&
              !s.audioDeletedAt &&
              (!s.audioExpiresAt || s.audioExpiresAt > now)
            );
            return {
              id: s.id,
              assignmentId: s.assignmentId,
              classId: s.classId,
              studentId: s.studentId,
              studentName: st?.displayName || 'Student',
              studentEmail: st?.email || null,
              studentPart: st?.part || '',
              attemptNum: s.attemptNum,
              attemptStartId: s.attemptStartId || null,
              overallPct: s.overallPct,
              rhythmPct: s.rhythmPct,
              pitchPct: s.pitchPct,
              effectivePct: demoEffectiveScore(s),
              resultsJson: clone(s.resultsJson || null),
              integrityFlags: clone(s.integrityFlags || []),
              durationSec: s.durationSec,
              expectedSec: s.expectedSec,
              audioAvailable,
              audioMime: s.audioMime || null,
              audioBytes: s.audioBytes || 0,
              audioExpiresAt: s.audioExpiresAt || null,
              audioDeletedAt: s.audioDeletedAt || null,
              teacherOverridePct: s.teacherOverridePct,
              teacherComment: s.teacherComment || '',
              gradedAt: s.gradedAt || null,
              submittedAt: s.submittedAt,
            };
          });

        const assignmentSummary = {
          id: asgn.id,
          classId: asgn.classId,
          title: asgn.title,
          type: asgn.type,
          mode: asgn.mode,
          gradePolicy: asgn.gradePolicy,
        };
        const cache = loadCache();
        cache.submissionsByAsgn[assignmentId] = {
          assignment: assignmentSummary,
          submissions: rows,
          updatedAt: Date.now(),
        };
        saveCache(cache);
        return { ok: true, assignment: assignmentSummary, submissions: rows };
      },

      async gradeSubmission(submissionId, { teacherOverridePct, teacherComment } = {}) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { auth, err } = requireDemoSession(db);
        if (err) return err;
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
        const sub = db.submissions.find(s => s.id === submissionId);
        if (!sub) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');

        let changed = false;
        if (teacherOverridePct !== undefined) {
          if (teacherOverridePct === null || teacherOverridePct === '') {
            sub.teacherOverridePct = null;
          } else {
            const num = Number(teacherOverridePct);
            if (!Number.isInteger(num) || num < 0 || num > 100) {
              return demoErr(400, 'INVALID_OVERRIDE', 'Grade override must be a whole number from 0 to 100.');
            }
            sub.teacherOverridePct = num;
          }
          changed = true;
        }
        if (teacherComment !== undefined) {
          sub.teacherComment = String(teacherComment == null ? '' : teacherComment).trim().slice(0, 2000);
          changed = true;
        }
        if (!changed) {
          return demoErr(400, 'NO_CHANGES', 'Provide teacherOverridePct and/or teacherComment to update.');
        }
        sub.gradedAt = Date.now();
        saveDemoDb();
        return {
          ok: true,
          submission: {
            id: sub.id,
            overallPct: sub.overallPct,
            rhythmPct: sub.rhythmPct,
            pitchPct: sub.pitchPct,
            teacherOverridePct: sub.teacherOverridePct,
            effectivePct: demoEffectiveScore(sub),
            teacherComment: sub.teacherComment || '',
            gradedAt: sub.gradedAt,
          },
        };
      },

      async deleteSubmissionAudio(submissionId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const sub = db.submissions.find(s => s.id === submissionId);
        if (!sub) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
        const now = Date.now();
        sub.audioAvailable = false;
        sub.audioDeletedAt = sub.audioDeletedAt || now;
        saveDemoDb();
        return {
          ok: true,
          submissionId: sub.id,
          audioDeleted: true,
          audioDeletedAt: sub.audioDeletedAt,
        };
      },

      async deleteSubmission(submissionId) {
        if (isOffline()) return offlineErr();
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const idx = db.submissions.findIndex(s => s.id === submissionId);
        if (idx < 0) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
        db.submissions.splice(idx, 1);
        saveDemoDb();
        return { ok: true, deleted: true, submissionId };
      },

      async fetchSubmissionAudioUrl(submissionId) {
        const db = loadDemoDb();
        const { err } = requireDemoSession(db);
        if (err) return err;
        const sub = db.submissions.find(s => s.id === submissionId);
        if (!sub) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
        const now = Date.now();
        if (!sub.audioAvailable || sub.audioDeletedAt || (sub.audioExpiresAt && sub.audioExpiresAt <= now)) {
          return demoErr(410, 'AUDIO_EXPIRED', 'This audio recording has expired or been deleted.');
        }
        const wavBlob = createScaleWavBlob();
        const url = URL.createObjectURL(wavBlob);
        return {
          ok: true,
          url,
          mime: 'audio/wav',
          revoke: function () {
            try { URL.revokeObjectURL(url); } catch { }
          },
        };
      },
    };
  }

  if (typeof window !== 'undefined') {
    window.HW_TEACHER_DEMO = { create };
  }
})();
