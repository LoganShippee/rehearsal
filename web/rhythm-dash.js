

    (() => {
      if (window.self === window.top) {
        document.body.style.background = 'var(--background)';
        document.body.style.padding = '16px';
        document.body.style.maxWidth = '920px';
        document.body.style.margin = '0 auto';
      }
      // ---------- Borrowed from Rehearsal web/sight.js: Rhythm Building Blocks & Counting ----------
      const SR_SIMPLE = {
        w:    { label: 'Whole note',            len: 4, ev: [['w', 4]] },
        hd:   { label: 'Dotted half',           len: 3, ev: [['hd', 3]] },
        h:    { label: 'Half note',             len: 2, ev: [['h', 2]] },
        q:    { label: 'Quarter',               len: 1, ev: [['q', 1]] },
        ee:   { label: 'Two eighths',           len: 1, ev: [['8', 0.5], ['8', 0.5]] },
        qr:   { label: 'Quarter rest',          len: 1, ev: [['q', 1, 1]] },
        hr:   { label: 'Half rest',             len: 2, ev: [['h', 2, 1]] },
        qde:  { label: 'Dotted quarter + 8th',  len: 2, ev: [['qd', 1.5], ['8', 0.5]] },
        ssss: { label: 'Four sixteenths',       len: 1, ev: [['16', 0.25], ['16', 0.25], ['16', 0.25], ['16', 0.25]] },
        er:   { label: 'Eighth rest + 8th',     len: 1, ev: [['8', 0.5, 1], ['8', 0.5]] },
        syn:  { label: 'Syncopation (8–q–8)',   len: 2, ev: [['8', 0.5], ['q', 1], ['8', 0.5]] },
        ess:  { label: 'Eighth + two 16ths',    len: 1, ev: [['8', 0.5], ['16', 0.25], ['16', 0.25]] },
        sse:  { label: 'Two 16ths + eighth',    len: 1, ev: [['16', 0.25], ['16', 0.25], ['8', 0.5]] },
        des:  { label: 'Dotted 8th + 16th',     len: 1, ev: [['8d', 0.75], ['16', 0.25]] },
        trip: { label: 'Eighth-note triplet',   len: 1, ev: [['8', 1 / 3], ['8', 1 / 3], ['8', 1 / 3]], tup: 3 }
      };
      const SR_COMPOUND = {
        dq:    { label: 'Dotted quarter',       len: 1, ev: [['qd', 1.5]] },
        eee:   { label: 'Three eighths',        len: 1, ev: [['8', 0.5], ['8', 0.5], ['8', 0.5]] },
        qe:    { label: 'Quarter + eighth',     len: 1, ev: [['q', 1], ['8', 0.5]] },
        eq:    { label: 'Eighth + quarter',     len: 1, ev: [['8', 0.5], ['q', 1]] },
        dh:    { label: 'Dotted half',          len: 2, ev: [['hd', 3]] },
        dqr:   { label: 'Dotted quarter rest',  len: 1, ev: [['qd', 1.5, 1]] },
        desse: { label: 'Dotted 8th–16th–8th',  len: 1, ev: [['8d', 0.75], ['16', 0.25], ['8', 0.5]] },
        ssse:  { label: 'Four 16ths + eighth',  len: 1, ev: [['16', 0.25], ['16', 0.25], ['16', 0.25], ['16', 0.25], ['8', 0.5]] },
        six:   { label: 'Six sixteenths',       len: 1, ev: Array(6).fill(['16', 0.25]) }
      };
      const SR_METERS = {
        '2/4': [2, 'simple'], '3/4': [3, 'simple'], '4/4': [4, 'simple'],
        '6/8': [2, 'compound'], '9/8': [3, 'compound'], '12/8': [4, 'compound']
      };
      const RHY_KODALY_SIMPLE = {
        w: ['ta-a-a-a'], hd: ['ta-a-a'], h: ['ta-a'], q: ['ta'],
        ee: ['ti', 'ti'], qr: ['(sh)'], hr: ['(sh-h)'],
        qde: ['tam', 'ti'], ssss: ['ti', 'ka', 'ti', 'ka'],
        er: ['(ti)', 'ti'], syn: ['syn', 'co', 'pa'],
        ess: ['ti', 'ti', 'ka'], sse: ['ti', 'ka', 'ti'],
        des: ['tim', 'ka'], trip: ['tri', 'o', 'la']
      };
      const RHY_KODALY_COMP = {
        dq: ['tam'], dh: ['tam-a'], dqr: ['(sh)'],
        eee: ['ti', 'ti', 'ti'], qe: ['ta', 'ti'], eq: ['ti', 'ta'],
        desse: ['tim', 'ka', 'ti'], ssse: ['ti', 'ka', 'ti', 'ka', 'ti'],
        six: ['ti', 'ka', 'ti', 'ka', 'ti', 'ka']
      };

      const SPEED_LEVELS = {
        chill:  { label: 'Chill',  bpm: 72,  inc: 4, max: 144 },
        steady: { label: 'Steady', bpm: 86,  inc: 4, max: 154 },
        brisk:  { label: 'Brisk',  bpm: 102, inc: 5, max: 168 },
        hyper:  { label: 'Hyper',  bpm: 118, inc: 6, max: 180 }
      };

      let currentTs = '4/4';
      let currentRhySys = 'numbers';
      let tiesEnabled = false;
      const selectedSimple = new Set(['q', 'h', 'ee', 'qr', 'qde']);
      const selectedCompound = new Set(['dq', 'eee', 'qe', 'dqr', 'dh']);
      const srCellsFor = (ts) => SR_METERS[ts][1] === 'compound' ? SR_COMPOUND : SR_SIMPLE;
      const activeCellSet = () => SR_METERS[currentTs][1] === 'compound' ? selectedCompound : selectedSimple;

      function meterInfo() {
        const [beats, kind] = SR_METERS[currentTs];
        const beatQ = kind === 'compound' ? 1.5 : 1;
        return { beats, kind, beatQ, barQ: beats * beatQ, subsPerBar: beats * (kind === 'compound' ? 3 : 2) };
      }

      function rhythmSyllable(p, kind, rest, val = 1, cellId = null, ei = 0, sys = currentRhySys) {
        const r = (x) => Math.round(x * 12) / 12;
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
            if (f === 0.25 || f === 0.75) return 'ka';
            if (f === 0.5) return val >= 0.9 ? 'co' : 'ti';
            if (Math.abs(f - 1 / 3) < 0.02) return 'o';
            if (Math.abs(f - 2 / 3) < 0.02) return 'la';
            return 'ti';
          }
          const e = r(p / 0.5), sub = r(e % 3);
          if (sub === 0) return val >= 2.8 ? 'tam-a' : val >= 1.4 ? 'tam' : val >= 0.9 ? 'ta' : val >= 0.7 ? 'tim' : 'ti';
          if (sub === 1 || sub === 2) return val >= 0.9 ? 'ta' : 'ti';
          return 'ka';
        }
        if (sys === 'takadimi') {
          if (rest) return '';
          if (kind === 'simple') {
            const b = Math.floor(r(p) + 1e-9), f = r(p - b);
            return f === 0 ? 'ta' : f === 0.25 ? 'ka' : f === 0.5 ? 'di' : f === 0.75 ? 'mi'
              : Math.abs(f - 1 / 3) < 0.02 ? 'ki' : Math.abs(f - 2 / 3) < 0.02 ? 'da' : '·';
          }
          const e = r(p / 0.5), sub = r(e % 3);
          return sub === 0 ? 'ta' : sub === 0.5 ? 'va' : sub === 1 ? 'ki' : sub === 1.5 ? 'di' : sub === 2 ? 'da' : sub === 2.5 ? 'ma' : '·';
        }
        let s;
        if (kind === 'simple') {
          const b = Math.floor(r(p) + 1e-9), f = r(p - b);
          s = f === 0 ? String(b + 1) : f === 0.5 ? '&' : f === 0.25 ? 'e' : f === 0.75 ? 'a'
            : Math.abs(f - 1 / 3) < 0.01 ? 'trip' : Math.abs(f - 2 / 3) < 0.01 ? 'let' : '·';
        } else {
          const e = r(p / 0.5), ei2 = Math.floor(e + 1e-9), beat = Math.floor(ei2 / 3) + 1, sub = ei2 % 3, half = r(e - ei2) > 0;
          s = half ? 'ta' : sub === 0 ? String(beat) : sub === 1 ? '&' : 'a';
        }
        return rest ? `(${s})` : s;
      }

      let srRandom = Math.random;
      function srSeed(n) {
        if (n == null) { srRandom = Math.random; return; }
        let s = n >>> 0;
        srRandom = () => {
          s = (s + 0x6D2B79F5) >>> 0;
          let t = Math.imul(s ^ (s >>> 15), s | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      const WORLDS = [
        { id: 'w1', num: 1, name: 'Pulse City',          ts: '4/4', bpm: 76,  ties: false, cells: ['q', 'h', 'w', 'qr'],                          desc: 'Quarter, half, whole & rest' },
        { id: 'w2', num: 2, name: 'Eighth Alley',        ts: '4/4', bpm: 84,  ties: false, cells: ['q', 'h', 'ee', 'qr', 'hr'],                   desc: 'Two eighths + half rests' },
        { id: 'w3', num: 3, name: 'Waltz Heights',       ts: '3/4', bpm: 86,  ties: true,  cells: ['q', 'h', 'hd', 'ee', 'qr'],                   desc: '3/4 meter, dotted half & ties' },
        { id: 'w4', num: 4, name: 'Syncopation Station', ts: '4/4', bpm: 88,  ties: false, cells: ['q', 'h', 'ee', 'qr', 'qde', 'er', 'syn'],     desc: 'Dotted ♩♪, 8th rests & syn-co-pa' },
        { id: 'w5', num: 5, name: 'Subdivision Lab',     ts: '4/4', bpm: 82,  ties: false, cells: ['q', 'ee', 'ssss', 'ess', 'sse', 'des', 'qr'], desc: '16ths & dotted 8th-16th' },
        { id: 'w6', num: 6, name: 'Triplet Nebula',      ts: '4/4', bpm: 86,  ties: false, cells: ['q', 'h', 'ee', 'trip', 'qr'],                 desc: 'Eighth-note triplets vs duple' },
        { id: 'w7', num: 7, name: 'Compound Canyon',     ts: '6/8', bpm: 78,  ties: false, cells: ['dq', 'eee', 'qe', 'eq', 'dh', 'dqr', 'desse'],desc: '6/8 compound meter flow' },
        { id: 'w8', num: 8, name: 'Overdrive Summit',    ts: '4/4', bpm: 94,  ties: true,  cells: ['q', 'ee', 'qde', 'syn', 'ssss', 'trip', 'qr'],desc: 'Boss mix + Overdrive climb' }
      ];
      const SKINS = [
        { id: 'classic',   name: 'Classic GD',     stars: 0, fill: '#54f254' },
        { id: 'treble',    name: 'Treble Visor',   stars: 2, fill: '#38bdf8' },
        { id: 'metronome', name: 'Metronome Gold', stars: 5, fill: '#facc15' },
        { id: 'wireframe', name: 'Neon Wireframe', stars: 9, fill: '#c084fc' }
      ];
      const TRAILS = [
        { id: 'spark', name: 'Spark',         stars: 0 },
        { id: 'notes', name: 'Music Notes ♪', stars: 3 },
        { id: 'laser', name: 'Laser Ribbon',  stars: 6 },
        { id: 'prism', name: 'Prism Rainbow', stars: 10 }
      ];
      const BIOMES = ['grid', 'mountains', 'sonar', 'starfield', 'stage'];
      const PROG_KEY = 'rehearsal-rhythm-dash-prog-v1';
      const DEFAULT_BOARDS = {
        weekly: [
          { name: 'Maya R.',   animal: 'Neon Otter',   mode: 'pure',   portals: 6, acc: 98, score: 5120 },
          { name: 'Devon K.',  animal: 'Solar Falcon', mode: 'tricks', portals: 5, acc: 94, score: 3680 },
          { name: 'Chloe T.',  animal: 'Pulse Panda',  mode: 'tricks', portals: 4, acc: 91, score: 2940 },
          { name: 'Samir P.',  animal: 'Tempo Lynx',   mode: 'visual', portals: 4, acc: 89, score: 1820 }
        ],
        w1: [
          { name: 'Noah L.',   animal: 'Beat Badger',  mode: 'pure',   portals: 8, acc: 99, score: 4210 },
          { name: 'Ava M.',    animal: 'Echo Finch',   mode: 'tricks', portals: 7, acc: 96, score: 3180 },
          { name: 'Eli C.',    animal: 'Groove Fox',   mode: 'tricks', portals: 5, acc: 92, score: 2450 },
          { name: 'Zoe H.',    animal: 'Pixel Koala',  mode: 'visual', portals: 4, acc: 90, score: 1590 }
        ],
        w2: [
          { name: 'Maya R.',   animal: 'Neon Otter',   mode: 'pure',   portals: 9, acc: 97, score: 4820 },
          { name: 'Devon K.',  animal: 'Solar Falcon', mode: 'tricks', portals: 7, acc: 94, score: 3410 },
          { name: 'Chloe T.',  animal: 'Pulse Panda',  mode: 'tricks', portals: 6, acc: 91, score: 2890 },
          { name: 'Samir P.',  animal: 'Tempo Lynx',   mode: 'visual', portals: 5, acc: 89, score: 1750 }
        ],
        w3: [
          { name: 'Clara B.',  animal: 'Waltz Swan',   mode: 'pure',   portals: 7, acc: 96, score: 4390 },
          { name: 'Lucas D.',  animal: 'Synth Hawk',   mode: 'tricks', portals: 6, acc: 93, score: 3250 },
          { name: 'Priya S.',  animal: 'Rhythm Owl',   mode: 'tricks', portals: 5, acc: 90, score: 2610 },
          { name: 'Ben W.',    animal: 'Metro Wolf',   mode: 'visual', portals: 4, acc: 88, score: 1640 }
        ],
        w4: [
          { name: 'Devon K.',  animal: 'Solar Falcon', mode: 'pure',   portals: 8, acc: 95, score: 5240 },
          { name: 'Maya R.',   animal: 'Neon Otter',   mode: 'tricks', portals: 7, acc: 94, score: 3890 },
          { name: 'Jordan V.', animal: 'Sync Tiger',   mode: 'tricks', portals: 5, acc: 91, score: 2980 },
          { name: 'Tessa N.',  animal: 'Bass Heron',   mode: 'visual', portals: 4, acc: 87, score: 1840 }
        ],
        w5: [
          { name: 'Maya R.',   animal: 'Neon Otter',   mode: 'pure',   portals: 7, acc: 96, score: 5610 },
          { name: 'Liam G.',   animal: 'Turbo Mink',   mode: 'tricks', portals: 6, acc: 93, score: 4120 },
          { name: 'Chloe T.',  animal: 'Pulse Panda',  mode: 'tricks', portals: 5, acc: 90, score: 3190 },
          { name: 'Samir P.',  animal: 'Tempo Lynx',   mode: 'visual', portals: 4, acc: 86, score: 2010 }
        ],
        w6: [
          { name: 'Clara B.',  animal: 'Waltz Swan',   mode: 'pure',   portals: 7, acc: 97, score: 4980 },
          { name: 'Noah L.',   animal: 'Beat Badger',  mode: 'tricks', portals: 6, acc: 92, score: 3560 },
          { name: 'Ava M.',    animal: 'Echo Finch',   mode: 'tricks', portals: 5, acc: 89, score: 2740 },
          { name: 'Eli C.',    animal: 'Groove Fox',   mode: 'visual', portals: 4, acc: 88, score: 1790 }
        ],
        w7: [
          { name: 'Priya S.',  animal: 'Rhythm Owl',   mode: 'pure',   portals: 8, acc: 96, score: 5380 },
          { name: 'Devon K.',  animal: 'Solar Falcon', mode: 'tricks', portals: 6, acc: 93, score: 3790 },
          { name: 'Lucas D.',  animal: 'Synth Hawk',   mode: 'tricks', portals: 5, acc: 91, score: 2960 },
          { name: 'Zoe H.',    animal: 'Pixel Koala',  mode: 'visual', portals: 4, acc: 87, score: 1880 }
        ],
        w8: [
          { name: 'Maya R.',   animal: 'Neon Otter',   mode: 'pure',   portals: 12, acc: 96, score: 7840 },
          { name: 'Liam G.',   animal: 'Turbo Mink',   mode: 'tricks', portals: 9,  acc: 93, score: 5490 },
          { name: 'Devon K.',  animal: 'Solar Falcon', mode: 'tricks', portals: 8,  acc: 91, score: 4620 },
          { name: 'Jordan V.', animal: 'Sync Tiger',   mode: 'visual', portals: 6,  acc: 88, score: 2850 }
        ],
        custom: [
          { name: 'Chloe T.',  animal: 'Pulse Panda',  mode: 'pure',   portals: 7, acc: 95, score: 4480 },
          { name: 'Ben W.',    animal: 'Metro Wolf',   mode: 'tricks', portals: 6, acc: 92, score: 3320 },
          { name: 'Tessa N.',  animal: 'Bass Heron',   mode: 'tricks', portals: 5, acc: 90, score: 2640 },
          { name: 'Samir P.',  animal: 'Tempo Lynx',   mode: 'visual', portals: 4, acc: 89, score: 1710 }
        ]
      };

      function loadProg() {
        try {
          const raw = localStorage.getItem(PROG_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            if (!p.bestByCat) p.bestByCat = {};
            return p;
          }
        } catch {}
        return { stars: {}, skin: 'classic', trail: 'spark', coopPortals: 342, bestByCat: {} };
      }
      let prog = loadProg();
      function saveProg() {
        try { localStorage.setItem(PROG_KEY, JSON.stringify(prog)); } catch {}
      }
      function totalStarsEarned() {
        return Object.values(prog.stars || {}).reduce((a, b) => a + b, 0);
      }

      function srGenRhythm(ts, measures, allowed, ties) {
        measures = Math.max(1, Math.min(16, Math.round(Number(measures)) || 1));
        const [beats, kind] = SR_METERS[ts];
        const table = kind === 'compound' ? SR_COMPOUND : SR_SIMPLE;
        let ids = allowed.filter((id) => table[id]);
        if (!ids.length) ids = [kind === 'compound' ? 'dq' : 'q'];
        const out = [];
        for (let m = 0; m < measures; m++) {
          const cells = [];
          let pos = 0;
          const last = m === measures - 1;
          while (pos < beats) {
            const left = beats - pos;
            let cand = ids.filter((id) => {
              const c = table[id];
              if (c.len > left) return false;
              if (c.len >= 2 && kind === 'simple' && pos % 2 !== 0) return false;
              if (c.len === 3 && pos !== 0) return false;
              if (id === 'w' && (pos !== 0 || beats !== 4)) return false;
              if (m === 0 && pos === 0 && c.ev[0][2]) return false;
              if (last && c.ev.some((e) => e[2])) return false;
              return true;
            });
            if (last && left <= 2) {
              const end = cand.filter((id) => table[id].ev.length === 1 && !table[id].ev[0][2] && table[id].len === left);
              if (end.length) cand = end;
            }
            if (!cand.length) cand = [kind === 'compound' ? 'dq' : 'q'];
            const id = cand[Math.floor(srRandom() * cand.length)];
            cells.push({ id, ev: table[id].ev, tup: table[id].tup });
            pos += table[id].len;
          }
          out.push(cells);
        }
        if (ties) {
          for (let m = 0; m < out.length - 1; m++) {
            const a = out[m][out[m].length - 1];
            const b = out[m + 1][0];
            const aLast = a.ev[a.ev.length - 1];
            const bFirst = b.ev[0];
            if (!aLast[2] && !bFirst[2] && srRandom() < 0.4) a.tie = true;
          }
        }
        return out;
      }

      // ---------- DOM Refs ----------
      const speedSelect = document.getElementById('speedSelect');
      const rouletteSelect = document.getElementById('rouletteSelect');
      const activeModeBadge = document.getElementById('activeModeBadge');
      const rhythmChips = document.getElementById('rhythmChips');
      const menuToggleBtn = document.getElementById('menuToggleBtn');
      const menuSummary = document.getElementById('menuSummary');
      const menuCaret = document.getElementById('menuCaret');
      const rhythmMenuPanel = document.getElementById('rhythmMenuPanel');
      const tsSelect = document.getElementById('tsSelect');
      const rhySysSelect = document.getElementById('rhySysSelect');
      const tiesToggle = document.getElementById('tiesToggle');
      const presetBar = document.getElementById('presetBar');
      const avOffsetSlider = document.getElementById('avOffsetSlider');
      const avOffsetVal = document.getElementById('avOffsetVal');
      const avCalBtn = document.getElementById('avCalBtn');
      const volSlider = document.getElementById('volSlider');
      const volVal = document.getElementById('volVal');
      const grooveSelect = document.getElementById('grooveSelect');
      const scoreHud = document.getElementById('scoreHud');
      const readMultBadge = document.getElementById('readMultBadge');
      const worldsToggleBtn = document.getElementById('worldsToggleBtn');
      const starsSummary = document.getElementById('starsSummary');
      const boardToggleBtn = document.getElementById('boardToggleBtn');
      const worldsPanel = document.getElementById('worldsPanel');
      const tabWorldsBtn = document.getElementById('tabWorldsBtn');
      const tabSkinsBtn = document.getElementById('tabSkinsBtn');
      const totalStarsLabel = document.getElementById('totalStarsLabel');
      const previewUnlockToggle = document.getElementById('previewUnlockToggle');
      const worldsGrid = document.getElementById('worldsGrid');
      const skinsArea = document.getElementById('skinsArea');
      const skinsRow = document.getElementById('skinsRow');
      const trailsRow = document.getElementById('trailsRow');
      const boardPanel = document.getElementById('boardPanel');
      const boardCatSelect = document.getElementById('boardCatSelect');
      const boardPlayCatBtn = document.getElementById('boardPlayCatBtn');
      const weeklyBtn = document.getElementById('weeklyBtn');
      const privacyToggleBtn = document.getElementById('privacyToggleBtn');
      const privacyLabel = document.getElementById('privacyLabel');
      const coopCountLabel = document.getElementById('coopCountLabel');
      const coopBar = document.getElementById('coopBar');
      const boardRows = document.getElementById('boardRows');
      const readModeBtn = document.getElementById('readModeBtn');
      const readModeLabel = document.getElementById('readModeLabel');
      const playheadBtn = document.getElementById('playheadBtn');
      const playheadLabel = document.getElementById('playheadLabel');
      const longModeBtn = document.getElementById('longModeBtn');
      const longModeLabel = document.getElementById('longModeLabel');
      const restartBtn = document.getElementById('restartBtn');
      const restartLabel = document.getElementById('restartLabel');
      const countsToggle = document.getElementById('countsToggle');
      const playBtn = document.getElementById('playBtn');
      const bpmHud = document.getElementById('bpmHud');
      const accHud = document.getElementById('accHud');
      const streakHud = document.getElementById('streakHud');
      const layerPills = document.getElementById('layerPills');
      const portalHud = document.getElementById('portalHud');
      const timingPip = document.getElementById('timingPip');
      const timingReadout = document.getElementById('timingReadout');
      const statusText = document.getElementById('statusText');
      const notationWrap = document.getElementById('notationWrap');
      const gameCanvas = document.getElementById('gameCanvas');
      const notationCanvas = document.getElementById('notationCanvas');
      const gCtx = gameCanvas.getContext('2d');
      const nCtx = notationCanvas.getContext('2d');

      function getTheme() {
        const cs = getComputedStyle(document.documentElement);
        const val = (n, fb) => cs.getPropertyValue(n).trim() || fb;
        return {
          fg: val('--foreground', '#e5e7eb'),
          muted: val('--muted-foreground', '#9ca3af'),
          card: val('--card', '#18181b'),
          border: val('--card-border', '#27272a'),
          primary: val('--primary', '#3b82f6'),
          primaryFg: val('--primary-foreground', '#ffffff'),
          accent: val('--accent', '#60a5fa'),
          success: val('--success', '#22c55e'),
          warning: val('--warning', '#f59e0b'),
          error: val('--error', '#ef4444')
        };
      }

      // ---------- Web Audio Groove, Limiter Bus & Lookahead SFX ----------
      let audioCtx = null;
      let masterGain = null;
      let masterComp = null;
      let noiseBuffer = null;
      let masterVol = 0.85;
      let avOffsetMs = Number(prog.avOffsetMs || 0);
      let calState = null; // { clicks: number[], taps: number[], timer: number|null }

      function nowClockSec() {
        return audioCtx ? audioCtx.currentTime : performance.now() / 1000;
      }

      function ensureAudio() {
        if (!audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            audioCtx = new AC();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = masterVol;
            masterComp = audioCtx.createDynamicsCompressor();
            masterComp.threshold.value = -10;
            masterComp.knee.value = 12;
            masterComp.ratio.value = 6;
            masterComp.attack.value = 0.003;
            masterComp.release.value = 0.12;
            masterGain.connect(masterComp);
            masterComp.connect(audioCtx.destination);
          }
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        if (audioCtx && !noiseBuffer) {
          noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.25, audioCtx.sampleRate);
          const ch = noiseBuffer.getChannelData(0);
          for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
        }
      }

      function audioDest() {
        return masterGain || (audioCtx && audioCtx.destination);
      }

      function playKick(v = 1, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(46, t0 + 0.1);
        g.gain.setValueAtTime(0.25 * v, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
        osc.connect(g); g.connect(audioDest());
        osc.start(t0); osc.stop(t0 + 0.14);
      }

      function playSnare(at = null) {
        if (!audioCtx || !noiseBuffer) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const src = audioCtx.createBufferSource();
        src.buffer = noiseBuffer;
        const f = audioCtx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1850;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.13, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        src.connect(f); f.connect(g); g.connect(audioDest());
        src.start(t0); src.stop(t0 + 0.09);
      }

      function playHiHat(loud = false, at = null) {
        if (!audioCtx || !noiseBuffer) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const src = audioCtx.createBufferSource();
        src.buffer = noiseBuffer;
        const f = audioCtx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 6000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(loud ? 0.06 : 0.028, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.035);
        src.connect(f); f.connect(g); g.connect(audioDest());
        src.start(t0); src.stop(t0 + 0.04);
      }

      function playClick(accent = false, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(accent ? 1140 : 800, t0);
        osc.frequency.exponentialRampToValueAtTime(accent ? 520 : 390, t0 + 0.04);
        g.gain.setValueAtTime(accent ? 0.17 : 0.09, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.048);
        osc.connect(g); g.connect(audioDest());
        osc.start(t0); osc.stop(t0 + 0.05);
      }

      function playVoiceNote(freq, dur = 0.18, type = 'sine', vol = 0.18, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(g); g.connect(audioDest());
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      }

      function playPortalWarp() {
        if (!audioCtx) return;
        const base = audioCtx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          playVoiceNote(f, 0.18, 'triangle', 0.12, base + i * 0.038);
        });
      }

      function playCrashSfx() {
        playVoiceNote(130, 0.18, 'sawtooth', 0.22);
        playSnare();
      }

      const PROG_ROOTS = [130.81, 98.0, 110.0, 87.31]; // C3, G2, A2, F2
      const PROG_CHORDS = [
        [261.63, 329.63, 392.0], // C maj
        [196.0,  246.94, 293.66], // G maj
        [220.0,  261.63, 329.63], // A min
        [174.61, 220.0,  261.63]  // F maj
      ];
      const ARP_OFFSETS = [2, 2.5, 3, 4, 3, 2.5, 2, 1.5]; // octave/fifth shimmer ratios

      function playBassNote(freq, dur = 0.24, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const f = audioCtx.createBiquadFilter();
        const g = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * 0.5, t0);
        f.type = 'lowpass'; f.frequency.value = 380;
        g.gain.setValueAtTime(0.18, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(f); f.connect(g); g.connect(audioDest());
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      }

      function playChordPad(freqs, dur = 0.34, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        freqs.forEach((freq) => {
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          g.gain.setValueAtTime(0.045, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
          osc.connect(g); g.connect(audioDest());
          osc.start(t0); osc.stop(t0 + dur + 0.02);
        });
      }

      function playArpNote(freq, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.055, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
        osc.connect(g); g.connect(audioDest());
        osc.start(t0); osc.stop(t0 + 0.12);
      }

      function playRide(accent = false, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        [2480, 3690, 5120].forEach((f, idx) => {
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, t0);
          g.gain.setValueAtTime((accent ? 0.024 : 0.014) / (idx + 1), t0);
          g.gain.exponentialRampToValueAtTime(0.0005, t0 + (accent ? 0.16 : 0.09));
          osc.connect(g); g.connect(audioDest());
          osc.start(t0); osc.stop(t0 + 0.18);
        });
      }

      function playTom(freq, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.25, t0);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t0 + 0.11);
        g.gain.setValueAtTime(0.20, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
        osc.connect(g); g.connect(audioDest());
        osc.start(t0); osc.stop(t0 + 0.15);
      }

      function playRhodes(freqs, dur = 0.55, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        freqs.forEach((freq) => {
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          g.gain.setValueAtTime(0.048, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
          osc.connect(g); g.connect(audioDest());
          osc.start(t0); osc.stop(t0 + dur + 0.03);
        });
      }

      function playPowerGuitar(freq, dur = 0.18, at = null) {
        if (!audioCtx) return;
        const t0 = at != null ? Math.max(audioCtx.currentTime, at) : audioCtx.currentTime;
        [freq, freq * 1.498].forEach((f, idx) => {
          const osc = audioCtx.createOscillator();
          const lp = audioCtx.createBiquadFilter();
          const g = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f, t0);
          lp.type = 'lowpass'; lp.frequency.value = 920;
          g.gain.setValueAtTime(idx === 0 ? 0.075 : 0.055, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
          osc.connect(lp); lp.connect(g); g.connect(audioDest());
          osc.start(t0); osc.stop(t0 + dur + 0.02);
        });
      }

      function triggerGroove(subIdx, isCountIn, at = null) {
        const { beats, kind, subsPerBar } = meterInfo();
        const stepsPerBar = subsPerBar;
        const macroSub = kind === 'compound' ? 3 : 2;
        const s = ((subIdx % stepsPerBar) + stepsPerBar) % stepsPerBar;
        if (s % macroSub === 0) {
          beatPulse = s === 0 ? 1.0 : (s === Math.floor(stepsPerBar / 2) ? 0.8 : 0.55);
        }
        if (grooveStyle === 'click' || isCountIn) {
          if (Math.abs(subIdx) % macroSub === 0) playClick(s === 0, at);
        }
        if (grooveStyle === 'click') return;

        const absSub = portalBarOffset * stepsPerBar + subIdx;
        const barIdx = ((Math.floor(absSub / stepsPerBar) % PROG_ROOTS.length) + PROG_ROOTS.length) % PROG_ROOTS.length;
        const root = PROG_ROOTS[barIdx];
        const chord = PROG_CHORDS[barIdx];
        const isStrong = s === 0 || (beats === 4 && s === macroSub * 2);
        const isBackbeat = (beats === 4 && (s === macroSub || s === macroSub * 3))
          || (beats === 3 && s === macroSub * 2)
          || (beats === 2 && s === macroSub);

        if (grooveStyle === 'electro') {
          // GD EDM House: 4-on-the-floor kick, offbeat hats, pumping octave synth bass from beat 1
          if (s % macroSub === 0) { playKick(s === 0 ? 1.0 : 0.85, at); if (s === 0) downbeatPulse = 1.0; }
          if (isBackbeat) playSnare(at);
          if (s % macroSub !== 0) playHiHat(true, at);
          playBassNote(s % macroSub === 0 ? root : root * 2, 0.14, at);
          if (streak >= 5 && isStrong) playChordPad(chord, 0.34, at);
          if (streak >= 10) playArpNote(root * ARP_OFFSETS[s % ARP_OFFSETS.length], at);
          if (streak >= 15 && s % 2 === 0) playVoiceNote(chord[(s / 2) % chord.length] * 2, 0.12, 'sawtooth', 0.04, at);
        } else if (grooveStyle === 'funk') {
          // D-Dorian Slap Funk: syncopated kick, ghost rim, bouncy slap bass riff from beat 1
          const funkRiff = [146.83, 0, 293.66, 174.61, 196.0, 0, 220.0, 261.63];
          const funkChords = [
            [293.66, 349.23, 440.0, 523.25], // Dm7
            [196.0,  246.94, 293.66, 349.23] // G7
          ];
          if (s === 0 || s === macroSub + 1 || s === stepsPerBar - 1) { playKick(s === 0 ? 0.95 : 0.72, at); if (s === 0) downbeatPulse = 1.0; }
          if (isBackbeat) playSnare(at);
          else if (s === stepsPerBar - 2) playClick(false, at);
          playHiHat(s % 2 === 1, at);
          const fNote = funkRiff[s % funkRiff.length];
          if (fNote) playVoiceNote(fNote * 0.5, 0.13, 'sawtooth', 0.10, at);
          if (streak >= 5 && (s === 0 || s === macroSub + 1 || s === stepsPerBar - 1)) {
            playChordPad(funkChords[barIdx % 2], 0.11, at);
          }
          if (streak >= 10 && s === stepsPerBar - 2) playVoiceNote(587.33, 0.12, 'square', 0.05, at);
          if (streak >= 15 && s % 2 === 1) playArpNote(fNote ? fNote * 2 : 440, at);
        } else if (grooveStyle === 'lofi') {
          // Dusty Lo-Fi Chill: warm Rhodes maj7/min9 chords from beat 1 + mellow thump
          const lofiChords = [
            [174.61, 220.0, 261.63, 329.63], // Fmaj7
            [164.81, 196.0, 246.94, 293.66], // Em7
            [146.83, 220.0, 261.63, 329.63], // Dm9
            [130.81, 196.0, 246.94, 329.63]  // Cmaj7
          ];
          if (s === 0) { playKick(0.62, at); downbeatPulse = 0.8; playRhodes(lofiChords[barIdx], 0.75, at); }
          else if (s === stepsPerBar - 1) playKick(0.42, at);
          if (isBackbeat) playVoiceNote(165, 0.10, 'triangle', 0.08, at);
          if (s % 2 === 0) playHiHat(false, at);
          if (streak >= 5 && isStrong) playBassNote(lofiChords[barIdx][0], 0.45, at);
          if (streak >= 10 && s === macroSub + 1) playRhodes(lofiChords[barIdx], 0.45, at);
          if (streak >= 15 && s % 2 === 0) playVoiceNote(lofiChords[barIdx][(s / 2) % 4] * 2, 0.28, 'sine', 0.045, at);
        } else if (grooveStyle === 'rock') {
          // Arena Driving Rock: palm-muted sawtooth power-chord 8ths from beat 1 + heavy snare
          const rockRoots = [82.41, 98.0, 110.0, 123.47]; // E2, G2, A2, B2
          const rRoot = rockRoots[barIdx];
          if (s === 0) { playKick(1.05, at); downbeatPulse = 1.0; }
          else if (isStrong || s === stepsPerBar - 1) playKick(0.88, at);
          if (isBackbeat) playSnare(at);
          playHiHat(true, at);
          playPowerGuitar(rRoot, s % 2 === 0 ? 0.16 : 0.10, at);
          if (streak >= 5 && isStrong) playPowerGuitar(rRoot * 2, 0.28, at);
          if (streak >= 10 && s % 2 === 0) playVoiceNote(rRoot * 4, 0.13, 'sawtooth', 0.045, at);
          if (streak >= 15) playVoiceNote(rRoot * 2 * ARP_OFFSETS[s % ARP_OFFSETS.length], 0.10, 'sawtooth', 0.04, at);
        } else if (grooveStyle === 'march') {
          // Drumline Cadence: marching bass + crisp snare flams + tenor tom fills from beat 1
          const tenorPitch = [220, 185, 155, 130];
          if (s % macroSub === 0) { playKick(s === 0 ? 1.0 : 0.78, at); if (s === 0) downbeatPulse = 1.0; }
          if (isBackbeat || s === stepsPerBar - 1) {
            playSnare(at);
            if (at != null) playSnare(at + 0.032); // crisp drumline flam!
          } else if (s === 1) {
            playClick(false, at);
          }
          if (s >= stepsPerBar - 3) playTom(tenorPitch[s % tenorPitch.length], at);
          if (streak >= 5 && s % macroSub === 0) playBassNote(root, 0.20, at);
          if (streak >= 10 && s === 0) playChordPad([root * 2, root * 2.996, root * 4], 0.28, at);
          if (streak >= 15 && s % macroSub === 0) playVoiceNote(chord[s % chord.length] * 2, 0.14, 'triangle', 0.06, at);
        } else if (grooveStyle === 'chiptune') {
          // 8-Bit NES Chiptune: pure square-wave arpeggio + pulse kick from beat 1
          const chipNotes = [
            [261.63, 329.63, 392.0, 523.25],
            [220.0,  261.63, 329.63, 440.0],
            [174.61, 220.0,  261.63, 349.23],
            [196.0,  246.94, 293.66, 392.0]
          ][barIdx];
          if (s % macroSub === 0) { playVoiceNote(s === 0 ? 110 : 90, 0.07, 'square', 0.09, at); if (s === 0) downbeatPulse = 1.0; }
          if (isBackbeat) playSnare(at);
          playVoiceNote(chipNotes[s % 4], 0.08, 'square', 0.055, at);
          if (streak >= 5 && s % 2 === 0) playVoiceNote(chipNotes[0] * 0.5, 0.14, 'triangle', 0.12, at);
          if (streak >= 10 && s % 2 === 1) playVoiceNote(chipNotes[(s + 1) % 4] * 2, 0.07, 'square', 0.04, at);
          if (streak >= 15) playVoiceNote(chipNotes[(s * 2) % 4] * 2, 0.06, 'square', 0.035, at);
        } else if (grooveStyle === 'jazz') {
          // Acoustic Jazz Swing: metallic ride cymbal + walking upright bass from beat 1 + comped 7ths
          const walkScale = [1, 1.122, 1.26, 1.335, 1.498, 1.335, 1.26, 1.122];
          if (s % macroSub === 0) {
            playRide(s === 0, at);
            playBassNote(root * walkScale[(barIdx * 2 + Math.floor(s / macroSub)) % walkScale.length], 0.34, at);
            if (s === 0) downbeatPulse = 0.85;
          } else if (s % macroSub === macroSub - 1) {
            playRide(false, at); // swung "skip" ride beat
          }
          if (isBackbeat) playHiHat(true, at); // crisp hi-hat chick on 2 & 4
          if (streak >= 5 && (s === 0 || s === stepsPerBar - 1)) playRhodes([...chord, chord[2] * 1.189], 0.36, at);
          if (streak >= 10 && s === macroSub + 1) playRhodes(chord.map((f) => f * 1.5), 0.22, at);
          if (streak >= 15 && s % 2 === 1) playVoiceNote(chord[s % chord.length] * 2, 0.16, 'sine', 0.05, at);
        }
      }

      // ---------- Rhythm-to-Dash Event Converter (uses Rehearsal srGenRhythm) ----------
      const TURBO_SIMPLE_IDS = ['q', 'h', 'ee', 'qr'];
      const TURBO_COMP_IDS = ['dq', 'eee', 'qe', 'dqr'];

      function cellsToDashEvents(measuresArr, startMeasureIdx, startId) {
        const { kind, barQ: mBarQ } = meterInfo();
        const out = [];
        let idCounter = startId;
        let pendingTieTarget = null;

        measuresArr.forEach((cells, localM) => {
          const m = startMeasureIdx + localM;
          let posQ = 0;
          cells.forEach((cell) => {
            const evs = cell.ev;
            const isBeamable = (e) => !e[2] && /^(8|16)/.test(e[0]);
            const beamGroup = new Array(evs.length).fill(null);
            let runStart = -1;
            for (let ei = 0; ei <= evs.length; ei++) {
              if (ei < evs.length && isBeamable(evs[ei])) {
                if (runStart < 0) runStart = ei;
              } else {
                if (runStart >= 0 && ei - runStart >= 2) {
                  for (let k = runStart; k < ei; k++) {
                    beamGroup[k] = k === runStart ? 'start' : k === ei - 1 ? 'end' : 'mid';
                  }
                }
                runStart = -1;
              }
            }

            evs.forEach((ev, ei) => {
              const [durCode, qLen, isRest] = ev;
              const globalBeat = m * mBarQ + posQ;
              const dotted = durCode.includes('d');
              const is16 = durCode.startsWith('16');
              const isTiedIn = !!pendingTieTarget && ei === 0 && !isRest;
              if (isTiedIn) {
                pendingTieTarget.dur += qLen;
                pendingTieTarget.isHold = true;
                pendingTieTarget.tiedToNext = true;
                out.push({
                  id: idCounter++,
                  m,
                  beat: globalBeat,
                  dur: qLen,
                  durCode,
                  kind: 'tied',
                  beam: beamGroup[ei],
                  is16,
                  dot: dotted,
                  trip: cell.tup || 0,
                  isCluster: false,
                  isHold: false,
                  cnt: `(${rhythmSyllable(posQ, kind, false, qLen, cell.id, ei)})`,
                  echoFired: false,
                  result: 'perfect',
                  signedMs: 0,
                  holdHeldQ: 0,
                  restViolated: false,
                  fakeSpike: false,
                  stealthPopup: false,
                  fakeCleared: false,
                  tiedToNext: false
                });
                pendingTieTarget = null;
              } else {
                pendingTieTarget = null;
                const evObj = {
                  id: idCounter++,
                  m,
                  beat: globalBeat,
                  dur: qLen,
                  durCode,
                  kind: isRest ? 'rest' : 'note',
                  beam: beamGroup[ei],
                  is16,
                  dot: dotted,
                  trip: cell.tup || 0,
                  isCluster: !!cell.tup,
                  isHold: !isRest && qLen >= 1.49,
                  obsStyle: qLen < 0.7
                    ? (Math.random() < 0.55 ? 'mini_spike' : 'mini_saw')
                    : ['spike', 'twin', 'saw', 'pillar', 'gap', 'gap'][Math.floor(Math.random() * 6)],
                  glideHazard: Math.random() < 0.5 ? 'spikes' : 'saws',
                  cnt: rhythmSyllable(posQ, kind, !!isRest, qLen, cell.id, ei),
                  echoFired: false,
                  result: null,
                  signedMs: null,
                  holdHeldQ: 0,
                  restViolated: false,
                  fakeSpike: !!isRest && Math.random() < 0.55,
                  stealthPopup: !isRest && qLen < 1.49 && !cell.tup && Math.random() < 0.40,
                  fakeCleared: false,
                  tiedToNext: false
                };
                out.push(evObj);
                if (cell.tie && ei === evs.length - 1 && !isRest) {
                  pendingTieTarget = evObj;
                }
              }
              posQ += qLen;
            });
          });
        });
        // Tag fast repeated notes (< 0.68 beats after previous note) as mid-air GD Jump Orbs
        let prevNote = null;
        let orbChain = 0;
        for (let i = 0; i < out.length; i++) {
          const e = out[i];
          if (e.kind === 'note' && !e.isHold) {
            if (prevNote && (e.beat - prevNote.beat) < 0.68) {
              orbChain += 1;
              e.isAirOrb = true;
              e.orbH = 36 + Math.min(2, orbChain - 1) * 10;
              prevNote.launchesOrb = true;
            } else {
              orbChain = 0;
              e.isAirOrb = false;
              e.orbH = 0;
            }
            prevNote = e;
          } else if (e.kind === 'rest' || e.isHold) {
            prevNote = null;
            orbChain = 0;
          }
        }
        return { events: out, nextId: idCounter };
      }

      function generatePattern(bars = 2, simpleOnly = false) {
        const mi = meterInfo();
        barQ = mi.barQ;
        countInQ = mi.barQ;
        numMeasures = bars;
        totalQ = bars * barQ;
        let allowed = Array.from(activeCellSet());
        if (simpleOnly) {
          const turboList = mi.kind === 'compound' ? TURBO_COMP_IDS : TURBO_SIMPLE_IDS;
          const filtered = allowed.filter((id) => turboList.includes(id));
          allowed = filtered.length ? filtered : turboList;
        }
        const measuresArr = srGenRhythm(currentTs, bars, allowed, tiesEnabled);
        const { events: out } = cellsToDashEvents(measuresArr, 0, 0);

        elevSegments = [];
        let curLevel = 0;
        const stepQ = mi.kind === 'compound' ? 1.5 : 2;
        for (let b = 0; b < totalQ; b += stepQ) {
          if (b > 0) {
            const straddles = out.some((e) => e.beat < b - 0.01 && e.beat + e.dur > b + 0.01);
            const hasJumpBefore = out.some((e) => e.kind === 'note' && !e.isHold && e.beat >= b - 1.05 && e.beat <= b - 0.15);
            if (!straddles) {
              const r = Math.random();
              if (curLevel === 0) curLevel = (hasJumpBefore && r < 0.70) ? 1 : 0;
              else if (curLevel === 3) curLevel = r < 0.70 ? 2 : 3;
              else if (hasJumpBefore) curLevel = r < 0.45 ? curLevel + 1 : r < 0.85 ? curLevel - 1 : curLevel;
              else curLevel = r < 0.60 ? curLevel - 1 : curLevel;
            }
          }
          elevSegments.push({
            startBeat: b,
            endBeat: Math.min(totalQ, b + stepQ),
            level: curLevel,
            floating: curLevel >= 1 && Math.random() < 0.6
          });
        }
        return out;
      }

      function appendStreamMeasures(count = 2) {
        const mi = meterInfo();
        barQ = mi.barQ;
        countInQ = mi.barQ;
        const addedStartBeat = streamNextBar * barQ;
        const measuresArr = srGenRhythm(currentTs, count, Array.from(activeCellSet()), tiesEnabled);
        const { events: added, nextId } = cellsToDashEvents(measuresArr, streamNextBar, streamNextEventId);
        streamNextEventId = nextId;
        events.push(...added);

        const addedEndBeat = (streamNextBar + count) * barQ;
        const stepQ = mi.kind === 'compound' ? 1.5 : 2;
        for (let b = addedStartBeat; b < addedEndBeat; b += stepQ) {
          if (b > 0) {
            const straddles = events.some((e) => e.beat < b - 0.01 && e.beat + e.dur > b + 0.01);
            const hasJumpBefore = events.some((e) => e.kind === 'note' && !e.isHold && e.beat >= b - 1.05 && e.beat <= b - 0.15);
            if (!straddles) {
              const r = Math.random();
              if (streamLastElev === 0) streamLastElev = (hasJumpBefore && r < 0.70) ? 1 : 0;
              else if (streamLastElev === 3) streamLastElev = r < 0.70 ? 2 : 3;
              else if (hasJumpBefore) streamLastElev = r < 0.45 ? streamLastElev + 1 : r < 0.85 ? streamLastElev - 1 : streamLastElev;
              else streamLastElev = r < 0.60 ? streamLastElev - 1 : streamLastElev;
            }
          }
          elevSegments.push({
            startBeat: b,
            endBeat: Math.min(addedEndBeat, b + stepQ),
            level: streamLastElev,
            floating: streamLastElev >= 1 && Math.random() < 0.6
          });
        }

        streamNextBar += count;
        numMeasures = streamNextBar;
        totalQ = streamNextBar * barQ;
      }

      // ---------- State ----------
      let PLAYER_X = 190;
      const ALL_MODES = ['live', 'blind', 'track', 'echo', 'turbo'];
      const OVERDRIVE_MODES = ['live', 'blind', 'track', 'echo'];
      const ELEV_STEP_PX = 20;
      const JUMP_VY = 440;     // consistent GD cube jump velocity (px/s) -> 45px peak
      const GRAVITY = 2150;    // consistent GD gravity (px/s^2)
      let elevSegments = [];
      let barQ = 4;
      let countInQ = 4;
      let numMeasures = 2;
      let totalQ = 8;

      let speedPreset = 'steady';
      let bpm = SPEED_LEVELS.steady.bpm;
      let rouletteSetting = 'random';
      let activePortalMode = 'live';
      let readEnforceMode = 'tricks'; // 'tricks' | 'pure' | 'visual'
      let showPlayhead = true;
      let holdRequired = true;
      const HOLD_END_GRACE_Q = 0.45;
      const DOTTED_Q_GRACE_Q = 0.65;
      const REST_END_GRACE_Q = 0.42;
      function holdGraceQ(ev) {
        return ev && ev.dur <= 1.55 ? DOTTED_Q_GRACE_Q : HOLD_END_GRACE_Q;
      }
      let grooveStyle = 'electro';
      let autoRestartOnMiss = true;
      let autoRestartTimer = null;
      let showCounts = true;

      let phase = 'idle'; // 'idle' | 'echo_listen' | 'countin' | 'live' | 'read_slow' | 'turbo_dash' | 'crashed'
      let events = [];
      let recordedTaps = [];
      let activeTapRec = null;
      let isPointerOrKeyDown = false;
      let liveActiveGlide = null;
      let phaseStartPerf = 0;
      let phaseStartSec = 0;
      let phaseBeat = 0;
      let lastSubStep = -999;
      let portalBarOffset = 0;
      const LOOKAHEAD_SEC = 0.095;
      const PERFECT_MS = 85;
      const MAX_HIT_MS = 148;

      function echoLeadQ() {
        return meterInfo().beatQ * 2;
      }

      function hitWindowQ(curQps, e) {
        const ms = e && e.beat === 0 ? 175 : MAX_HIT_MS;
        return Math.min(0.42, (ms / 1000) * curQps);
      }

      let cubeY = 0;
      let cubeVy = 0;
      let cubeRot = 0;
      let crashInfo = null;
      let screenShake = 0;
      let downbeatPulse = 0;
      let beatPulse = 0;
      let portalFlash = 0;
      const PORTAL_HUES = [222, 290, 168, 18, 258, 195, 332];
      let portalHueIdx = 0;
      let stageHue = PORTAL_HUES[0];
      let targetStageHue = PORTAL_HUES[0];
      let worldScrollBeat = 0;
      let lastTickPerf = 0;
      let musicSubTotal = 0;
      let justWarpedPortal = false;
      let particles = [];
      let shockwaves = [];
      let popups = [];
      let streak = 0;
      let portalsCleared = 0;
      let runPortals = 0;
      let score = 0;
      let readCombo = 0;
      let activeWorldId = 'w2';
      let weeklyChallengeActive = false;
      let isBossPortal = false;
      let biomeIdx = 0;
      let ghostSamples = [];
      let bestGhostSamples = [];
      let boardPrivacyAnimal = false;
      let previewUnlockAll = false;
      let portalsSinceTurbo = 0;
      let overdrivePortals = 0;
      let overdriveBest = 0;
      let cooldownStartPerf = 0;
      let cooldownFromBpm = 86;
      let cubeTrail = [];
      let streamNextBar = 0;
      let streamBarsCleared = 0;
      let streamBestBars = 0;
      let streamLastElev = 0;
      let streamNextEventId = 0;
      let totalHits = 0;
      let totalJudged = 0;
      let rafId = null;

      function qps(mult = 1.0) {
        return (bpm / 60) * mult * meterInfo().beatQ;
      }

      function modeSpeedMult() {
        return activePortalMode === 'turbo' ? 1.45 : 1.0;
      }

      function effectiveBpm() {
        return Math.round(bpm * modeSpeedMult());
      }

      function modeBars() {
        return activePortalMode === 'turbo' ? 4 : activePortalMode === 'echo' ? 1 : 2;
      }

      function isOverdriveRun() {
        return rouletteSetting === 'overdrive';
      }

      function isStreamMode() {
        return activePortalMode === 'stream';
      }

      function initStream() {
        events = [];
        elevSegments = [];
        streamNextBar = 0;
        streamBarsCleared = 0;
        streamLastElev = 0;
        streamNextEventId = 0;
        appendStreamMeasures(4);
      }

      function elevSegmentAt(q) {
        if (q < 0 || q >= totalQ || !elevSegments.length) return null;
        for (let i = 0; i < elevSegments.length; i++) {
          const seg = elevSegments[i];
          if (q >= seg.startBeat && q < seg.endBeat) return seg;
        }
        return null;
      }

      function floorHeightAt(q) {
        const seg = elevSegmentAt(q);
        return seg ? seg.level * ELEV_STEP_PX : 0;
      }

      function overdriveIntensity() {
        const base = SPEED_LEVELS[speedPreset].bpm;
        const delta = Math.max(0, bpm - base);
        if (isOverdriveRun()) return Math.max(0, Math.min(1, delta / 96));
        return Math.max(0, Math.min(0.55, delta / 110));
      }

      function odHue(offset = 0, intensity = overdriveIntensity()) {
        const baseHue = (215 + intensity * 170 + performance.now() * 0.006 + offset) % 360;
        const s = Math.round(58 + intensity * 26);
        const l = Math.round(50 + intensity * 6);
        return `hsl(${Math.round(baseHue)}, ${s}%, ${l}%)`;
      }

      function gdHue(intensity = overdriveIntensity()) {
        return Math.round(((stageHue + intensity * 90 + performance.now() * 0.002) % 360 + 360) % 360);
      }

      function gdSkyTop(intensity = overdriveIntensity(), pulse = 0) {
        const h = gdHue(intensity);
        const l = Math.round(14 + intensity * 6 + pulse * 4);
        return `hsl(${h}, ${Math.round(68 + intensity * 14)}%, ${l}%)`;
      }

      function gdSkyBot(intensity = overdriveIntensity(), pulse = 0) {
        const h = (gdHue(intensity) + 14) % 360;
        const l = Math.round(24 + intensity * 8 + pulse * 6);
        return `hsl(${h}, ${Math.round(74 + intensity * 14)}%, ${l}%)`;
      }

      function gdGroundCol(intensity = overdriveIntensity()) {
        const h = gdHue(intensity);
        return `hsl(${h}, ${Math.round(72 + intensity * 12)}%, 11%)`;
      }

      function rollNextMode() {
        if (isOverdriveRun()) {
          const pool = OVERDRIVE_MODES.filter((m) => m !== activePortalMode);
          return pool[Math.floor(Math.random() * pool.length)];
        }
        if (rouletteSetting !== 'random') return rouletteSetting;
        const canTurbo = portalsSinceTurbo >= 10;
        const pool = ALL_MODES.filter((m) => m !== activePortalMode && (canTurbo || m !== 'turbo'));
        const next = pool[Math.floor(Math.random() * pool.length)];
        portalsSinceTurbo = next === 'turbo' ? 0 : portalsSinceTurbo + 1;
        return next;
      }

      function renderRhythmChips() {
        const t = getTheme();
        const table = srCellsFor(currentTs);
        const sel = activeCellSet();
        rhythmChips.innerHTML = '';
        Object.entries(table).forEach(([id, cell]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          const active = sel.has(id);
          const isRestCell = cell.ev.every((e) => !!e[2]);
          btn.className = 'px-2 py-0.5 rounded border text-[11px] font-medium transition cursor-pointer';
          if (active) {
            btn.style.backgroundColor = t.primary;
            btn.style.color = t.primaryFg;
            btn.style.borderColor = t.primary;
          } else {
            btn.style.backgroundColor = 'transparent';
            btn.style.color = t.muted;
            btn.style.borderColor = t.border;
          }
          btn.textContent = cell.label;
          btn.addEventListener('click', () => {
            btn.blur();
            if (sel.has(id)) {
              const remainingNotes = Object.entries(table).filter(([k, c]) => k !== id && sel.has(k) && c.ev.some((e) => !e[2]));
              if (!remainingNotes.length && !isRestCell) return;
              sel.delete(id);
            } else {
              sel.add(id);
            }
            renderRhythmChips();
            if (phase === 'idle') {
              if (isStreamMode()) initStream();
              else events = generatePattern(modeBars(), activePortalMode === 'turbo');
              drawAll();
            }
          });
          rhythmChips.appendChild(btn);
        });
        menuSummary.textContent = `${currentTs} · ${sel.size} rhythms`;
      }

      function refreshModeBadge() {
        const t = getTheme();
        let label = 'TURBO DASH';
        let col = t.warning;
        if (activePortalMode === 'live') { label = 'LIVE SIGHT'; col = t.primary; }
        else if (activePortalMode === 'blind') { label = 'PURE SIGHT'; col = t.success; }
        else if (activePortalMode === 'track') { label = 'TRACK ONLY'; col = t.fg; }
        else if (activePortalMode === 'echo') { label = 'MEMORY ECHO'; col = t.accent; }
        else if (activePortalMode === 'stream') { label = '∞ STREAM'; col = t.primary; }
        if (isOverdriveRun()) {
          label = `🔥 ${label}`;
          col = overdriveIntensity() > 0.1 ? odHue(0) : t.error;
        }
        activeModeBadge.textContent = label;
        activeModeBadge.style.color = col;
        activeModeBadge.style.borderColor = activePortalMode === 'track' && !isOverdriveRun() ? t.muted : col;
      }

      function updateTimingMeter(signedMs) {
        const t = getTheme();
        if (signedMs === null || !isFinite(signedMs)) {
          timingPip.style.left = 'calc(50% - 4px)';
          timingPip.style.backgroundColor = t.primary;
          timingReadout.textContent = '0 ms';
          timingReadout.style.color = t.muted;
          return;
        }
        const clamped = Math.max(-160, Math.min(160, Math.round(signedMs)));
        const pct = 50 + (clamped / 160) * 44;
        const abs = Math.abs(clamped);
        const col = abs <= 38 ? t.success : abs <= 105 ? t.warning : t.error;
        timingPip.style.left = `calc(${pct.toFixed(1)}% - 4px)`;
        timingPip.style.backgroundColor = col;
        timingReadout.textContent = `${clamped > 0 ? '+' : ''}${clamped} ms`;
        timingReadout.style.color = col;
      }

      function activeBoardCategory() {
        if (weeklyChallengeActive) return 'weekly';
        return activeWorldId || 'custom';
      }

      function recordRunToProg() {
        const cat = activeBoardCategory();
        const acc = totalJudged > 0 ? Math.round((totalHits / totalJudged) * 100) : 100;
        if (!prog.bestByCat) prog.bestByCat = {};
        const prev = prog.bestByCat[cat] || { score: 0, portals: 0, acc: 100, mode: readEnforceMode };
        if (score >= prev.score) {
          prog.bestByCat[cat] = {
            score,
            portals: Math.max(prev.portals || 0, runPortals || portalsCleared),
            acc,
            mode: readEnforceMode
          };
        }
        saveProg();
        renderWorldsUI();
        renderBoardUI();
      }

      function selectWorld(w) {
        activeWorldId = w.id;
        weeklyChallengeActive = false;
        srSeed(null);
        currentTs = w.ts;
        tsSelect.value = w.ts;
        tiesEnabled = !!w.ties;
        tiesToggle.checked = tiesEnabled;
        const sel = activeCellSet();
        sel.clear();
        w.cells.forEach((id) => sel.add(id));
        bpm = w.bpm;
        if (w.id === 'w8') {
          rouletteSetting = 'overdrive';
          rouletteSelect.value = 'overdrive';
        } else if (rouletteSetting === 'overdrive') {
          rouletteSetting = 'random';
          rouletteSelect.value = 'random';
        }
        renderRhythmChips();
        renderWorldsUI();
        renderWorldsUI();
      renderSkinsUI();
      renderBoardUI();
      resetToIdle();
        bpm = w.bpm;
        updateHud();
        statusText.textContent = `World ${w.num}: ${w.name} (${w.ts} · ${w.bpm} BPM) · Press Start or Space`;
      }

      function startWeeklyChallenge() {
        weeklyChallengeActive = true;
        activeWorldId = null;
        const weekNum = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
        srSeed(2026000 + weekNum);
        currentTs = '4/4';
        tsSelect.value = '4/4';
        selectedSimple.clear();
        ['q', 'h', 'ee', 'qr', 'qde', 'syn', 'ssss'].forEach((id) => selectedSimple.add(id));
        rouletteSetting = 'live';
        rouletteSelect.value = 'live';
        readEnforceMode = 'tricks';
        readModeLabel.textContent = 'Tricks';
        renderRhythmChips();
        boardPanel.classList.add('hidden');
        startRun();
        statusText.textContent = `⚡ WEEKLY SEED #${weekNum % 100} — Same rhythm for the whole class!`;
      }

      function renderWorldsUI() {
        const stars = totalStarsEarned();
        starsSummary.textContent = `★${stars}`;
        totalStarsLabel.textContent = `★ ${stars} / ${WORLDS.length * 3}`;
        worldsGrid.innerHTML = '';
        WORLDS.forEach((w) => {
          const earned = prog.stars[w.id] || 0;
          const active = activeWorldId === w.id;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'text-left p-1.5 rounded border transition cursor-pointer ' + (active ? 'border-[var(--primary)] bg-[var(--background)]' : 'border-[var(--border)] hover:border-[var(--primary)]');
          const starStr = [1, 2, 3].map((n) => `<span style="color:${n <= earned ? '#facc15' : '#4b5563'}">★</span>`).join('');
          btn.innerHTML = `<div class="flex items-center justify-between gap-1"><span class="font-bold text-[11px] text-[var(--foreground)]">W${w.num} · ${w.name}</span><span class="text-[11px]">${starStr}</span></div>`
            + `<div class="text-[10px] text-[var(--muted-foreground)] mt-0.5">${w.ts} · ${w.bpm} BPM · ${w.desc}</div>`;
          btn.addEventListener('click', () => { btn.blur(); selectWorld(w); });
          worldsGrid.appendChild(btn);
        });
      }

      function renderSkinsUI() {
        const stars = totalStarsEarned();
        skinsRow.innerHTML = '<span class="text-[var(--muted-foreground)] font-semibold mr-1">Cube Skin:</span>';
        SKINS.forEach((sk) => {
          const unlocked = previewUnlockAll || stars >= sk.stars;
          const on = prog.skin === sk.id;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'px-2 py-0.5 rounded border text-[11px] font-medium transition ' + (unlocked ? 'cursor-pointer' : 'opacity-45 cursor-not-allowed');
          btn.style.borderColor = on ? sk.fill : 'var(--border)';
          btn.style.color = on ? sk.fill : 'var(--foreground)';
          btn.textContent = unlocked ? `${on ? '✓ ' : ''}${sk.name}` : `🔒 ${sk.name} (${sk.stars}★)`;
          if (unlocked) {
            btn.addEventListener('click', () => {
              btn.blur();
              prog.skin = sk.id;
              saveProg();
              renderSkinsUI();
              drawAll();
            });
          }
          skinsRow.appendChild(btn);
        });
        trailsRow.innerHTML = '<span class="text-[var(--muted-foreground)] font-semibold mr-1">Trail:</span>';
        TRAILS.forEach((tr) => {
          const unlocked = previewUnlockAll || stars >= tr.stars;
          const on = prog.trail === tr.id;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'px-2 py-0.5 rounded border text-[11px] font-medium transition ' + (unlocked ? 'cursor-pointer' : 'opacity-45 cursor-not-allowed');
          btn.style.borderColor = on ? 'var(--primary)' : 'var(--border)';
          btn.style.color = on ? 'var(--primary)' : 'var(--foreground)';
          btn.textContent = unlocked ? `${on ? '✓ ' : ''}${tr.name}` : `🔒 ${tr.name} (${tr.stars}★)`;
          if (unlocked) {
            btn.addEventListener('click', () => {
              btn.blur();
              prog.trail = tr.id;
              saveProg();
              renderSkinsUI();
            });
          }
          trailsRow.appendChild(btn);
        });
      }

      function renderBoardUI() {
        const coop = prog.coopPortals || 342;
        coopCountLabel.textContent = `${coop} / 500`;
        coopBar.style.width = `${Math.min(100, (coop / 500) * 100).toFixed(1)}%`;
        privacyLabel.textContent = boardPrivacyAnimal ? 'Animal Avatars' : 'First + Initial';

        const cat = boardCatSelect.value || activeBoardCategory();
        const isCurrentCat = cat === activeBoardCategory();
        const saved = (prog.bestByCat && prog.bestByCat[cat]) || { score: 0, portals: 0, acc: 100, mode: readEnforceMode };
        const liveScore = isCurrentCat ? score : 0;
        const youScore = Math.max(liveScore, saved.score || 0);
        const youPortals = isCurrentCat ? Math.max(runPortals, saved.portals || 0) : (saved.portals || 0);
        const youAcc = isCurrentCat && totalJudged > 0 ? Math.round((totalHits / totalJudged) * 100) : (saved.acc || 100);
        const baseRows = DEFAULT_BOARDS[cat] || DEFAULT_BOARDS.custom;
        const rows = [
          ...baseRows.map((r) => ({ ...r, isYou: false })),
          { name: 'You', animal: 'Rhythm Fox (You)', mode: saved.mode || readEnforceMode, portals: youPortals, acc: youAcc, score: youScore, isYou: true }
        ].sort((a, b) => b.score - a.score);

        boardRows.innerHTML = rows.map((r, idx) => {
          const disp = boardPrivacyAnimal ? r.animal : r.name;
          const badge = r.mode === 'pure'
            ? '<span class="px-1 rounded bg-emerald-500/20 text-emerald-300 font-bold">♪ 2× Pure</span>'
            : r.mode === 'tricks'
              ? '<span class="px-1 rounded bg-sky-500/20 text-sky-300 font-bold">♪ 1.5× Tricks</span>'
              : '<span class="px-1 rounded bg-zinc-500/20 text-zinc-400">Visual</span>';
          return `<div class="flex items-center justify-between py-1 px-1 ${r.isYou ? 'bg-[var(--background)] rounded font-semibold' : ''}">`
            + `<div class="flex items-center gap-2"><span class="font-mono text-[var(--muted-foreground)] w-4">#${idx + 1}</span><span>${disp}</span>${badge}</div>`
            + `<div class="flex items-center gap-3 font-mono tabular-nums"><span class="text-[var(--muted-foreground)]">${r.portals}P · ${r.acc}%</span><span class="text-[var(--warning)] font-bold">${r.score}</span></div>`
            + `</div>`;
        }).join('');
      }

      function updateHud() {
        const t = getTheme();
        const acc = totalJudged > 0 ? Math.round((totalHits / totalJudged) * 100) : 100;
        bpmHud.textContent = String(effectiveBpm());
        accHud.textContent = `${acc}%`;
        streakHud.textContent = String(streak);
        portalHud.textContent = String(portalsCleared);
        scoreHud.textContent = String(score);
        if (readCombo >= 2) {
          readMultBadge.textContent = `READ ×${readCombo}`;
          readMultBadge.classList.remove('hidden');
        } else {
          readMultBadge.classList.add('hidden');
        }

        const thresholds = [0, 5, 10, 15];
        const pills = layerPills.children;
        for (let i = 0; i < pills.length; i++) {
          const active = streak >= thresholds[i];
          pills[i].style.borderColor = active ? (i === 3 ? t.warning : t.success) : t.border;
          pills[i].style.color = active ? (i === 3 ? t.warning : t.success) : t.muted;
          pills[i].style.opacity = active ? '1' : '0.45';
        }
      }

      function resetToIdle() {
        if (autoRestartTimer) { clearTimeout(autoRestartTimer); autoRestartTimer = null; }
        bpm = SPEED_LEVELS[speedPreset].bpm;
        activePortalMode = (rouletteSetting === 'random' || isOverdriveRun()) ? 'live' : rouletteSetting;
        if (isStreamMode()) initStream();
        else events = generatePattern(modeBars(), activePortalMode === 'turbo');
        recordedTaps = [];
        activeTapRec = null;
        liveActiveGlide = null;
        overdrivePortals = 0;
        portalsSinceTurbo = 0;
        cubeTrail = [];
        phase = 'idle';
        phaseBeat = 0;
        cubeY = 0;
        cubeVy = 0;
        cubeRot = 0;
        crashInfo = null;
        screenShake = 0;
        downbeatPulse = 0;
        beatPulse = 0;
        portalFlash = 0;
        portalHueIdx = 0;
        stageHue = PORTAL_HUES[0];
        targetStageHue = PORTAL_HUES[0];
        worldScrollBeat = 0;
        lastTickPerf = 0;
        musicSubTotal = 0;
        portalBarOffset = 0;
        justWarpedPortal = false;
        if (calState && calState.timer) { clearTimeout(calState.timer); calState = null; }
        particles = [];
        shockwaves = [];
        popups = [];
        notationWrap.style.borderColor = '';
        playBtn.textContent = 'Start';
        statusText.textContent = 'Ready · Press Start or Space';
        updateTimingMeter(null);
        refreshModeBadge();
        renderRhythmChips();
        updateHud();
        drawAll();
      }

      function beginPatternRun(now, carryQ = 0, reuseEvents = false, fromPortal = false) {
        if (autoRestartTimer) { clearTimeout(autoRestartTimer); autoRestartTimer = null; }
        const bars = modeBars();
        if (isStreamMode()) {
          if (!reuseEvents || !events.length) {
            initStream();
          } else {
            events.forEach((e) => {
              e.echoFired = false;
              e.result = e.kind === 'tied' ? 'perfect' : null;
              e.signedMs = e.kind === 'tied' ? 0 : null;
              e.holdHeldQ = 0;
              e.holdDismounted = false;
              e.holdOverheld = false;
              e.restViolated = false;
              e.fakeCleared = false;
            });
          }
        } else if (!reuseEvents || numMeasures !== bars) {
          events = generatePattern(bars, activePortalMode === 'turbo');
        } else {
          events.forEach((e) => {
            e.echoFired = false;
            e.result = e.kind === 'tied' ? 'perfect' : null;
            e.signedMs = e.kind === 'tied' ? 0 : null;
            e.holdHeldQ = 0;
            e.holdDismounted = false;
            e.holdOverheld = false;
            e.restViolated = false;
            e.fakeCleared = false;
          });
        }
        recordedTaps = [];
        activeTapRec = null;
        liveActiveGlide = null;
        crashInfo = null;
        justWarpedPortal = fromPortal;
        if (!fromPortal) {
          cubeTrail = [];
          cubeY = 0;
          cubeVy = 0;
          cubeRot = 0;
          if (!['countin', 'live', 'echo_listen'].includes(phase)) {
            worldScrollBeat = 0;
            lastTickPerf = now;
          }
        }
        notationWrap.style.borderColor = '';
        refreshModeBadge();
        updateHud();

        const nowSec = nowClockSec();
        if (activePortalMode === 'echo') {
          phase = 'echo_listen';
          const leadQ = echoLeadQ();
          phaseStartPerf = now - (carryQ / qps(1.0)) * 1000;
          phaseStartSec = nowSec - (carryQ / qps(1.0));
          phaseBeat = -leadQ + carryQ;
          lastSubStep = Math.floor(-leadQ * 2) - 1;
          statusText.textContent = `${isOverdriveRun() ? '🔥 OVERDRIVE · ' : ''}MEMORY ECHO (${bpm} BPM): Listen, then echo right away!`;
        } else if (activePortalMode === 'turbo') {
          phase = 'countin';
          phaseStartPerf = now - (carryQ / qps(modeSpeedMult())) * 1000;
          phaseStartSec = nowSec - (carryQ / qps(modeSpeedMult()));
          phaseBeat = -countInQ + carryQ;
          lastSubStep = Math.floor(-countInQ * 2) - 1;
          statusText.textContent = `TURBO DASH (4 bars @ ${effectiveBpm()} BPM): Simple rhythms, fast tempo!`;
        } else {
          phase = 'countin';
          phaseStartPerf = now - (carryQ / qps(1.0)) * 1000;
          phaseStartSec = nowSec - (carryQ / qps(1.0));
          phaseBeat = -countInQ + carryQ;
          lastSubStep = Math.floor(-countInQ * 2) - 1;
          const prefix = isOverdriveRun() ? `🔥 OVERDRIVE (Best ${overdriveBest}) · ` : '';
          statusText.textContent = activePortalMode === 'blind'
            ? `${prefix}PURE SIGHT (${bpm} BPM): Read the music — track reveals as you pass!`
            : activePortalMode === 'track'
              ? `${prefix}TRACK ONLY (${bpm} BPM): No notation — watch the obstacles!`
              : activePortalMode === 'stream'
                ? `∞ ENDLESS STREAM (${bpm} BPM): One count-in, then nonstop!`
                : `${prefix}LIVE SIGHT (${bpm} BPM): Look ahead during count-in!`;
        }
        if (!rafId) rafId = requestAnimationFrame(tick);
      }

      function startRun() {
        ensureAudio();
        if (calState && calState.timer) { clearTimeout(calState.timer); calState = null; }
        particles = [];
        shockwaves = [];
        popups = [];
        if (phase === 'idle' || phase === 'cooldown') {
          const wObj = activeWorldId ? WORLDS.find((w) => w.id === activeWorldId) : null;
          bpm = wObj ? wObj.bpm : SPEED_LEVELS[speedPreset].bpm;
          overdrivePortals = 0;
        }
        activePortalMode = (rouletteSetting === 'random' || isOverdriveRun()) ? activePortalMode : rouletteSetting;
        playBtn.textContent = 'Stop';
        beginPatternRun(performance.now(), 0, phase === 'crashed');
      }

      function spawnBurst(x, y, color, count = 12) {
        for (let i = 0; i < count; i++) {
          const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
          const spd = 1.4 + Math.random() * 3.0;
          particles.push({
            x, y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 0.8,
            color, life: 1.0
          });
        }
      }

      function triggerCrash(beat, message) {
        const t = getTheme();
        notationWrap.style.borderColor = t.error;
        let crashEv = null;
        let bestD = Infinity;
        for (const ev of events) {
          const d = Math.abs(ev.beat - beat);
          if (d < bestD) { bestD = d; crashEv = ev; }
        }
        crashInfo = { beat, message, event: crashEv };
        screenShake = 1.0;
        streak = 0;
        readCombo = 0;
        runPortals = 0;
        ghostSamples = [];
        spawnBurst(PLAYER_X, 154 - cubeY, '#ffffff', 24);
        shockwaves.push({ x: PLAYER_X, y: 154 - cubeY, r: 10, color: '#ffffff', life: 1.0 });
        playCrashSfx();
        recordRunToProg();

        if (isOverdriveRun()) {
          overdriveBest = Math.max(overdriveBest, overdrivePortals);
          phase = 'cooldown';
          cooldownStartPerf = performance.now();
          cooldownFromBpm = bpm;
          overdrivePortals = 0;
          cubeTrail = [];
          playBtn.textContent = 'Stop';
          statusText.textContent = `${message} · Slowing back down to ${SPEED_LEVELS[speedPreset].bpm} BPM...`;
          updateHud();
          refreshModeBadge();
          if (!rafId) rafId = requestAnimationFrame(tick);
          return;
        }

        phase = 'crashed';
        updateHud();
        playBtn.textContent = 'Retry';
        const lesson = crashEv && crashEv.cnt ? ` (Count: "${crashEv.cnt}")` : '';
        if (autoRestartOnMiss) {
          statusText.textContent = `${message}${lesson} · Retrying...`;
          if (autoRestartTimer) clearTimeout(autoRestartTimer);
          autoRestartTimer = setTimeout(() => {
            autoRestartTimer = null;
            playBtn.textContent = 'Stop';
            beginPatternRun(performance.now(), 0, true);
          }, 1150);
        } else {
          statusText.textContent = `${message}${lesson} · Press Space to retry`;
        }
      }

      function handlePress() {
        ensureAudio();
        isPointerOrKeyDown = true;

        if (calState) {
          const tNow = nowClockSec();
          let bestDiff = Infinity;
          for (const cAt of calState.clicks) {
            const diffMs = (tNow - cAt) * 1000;
            if (Math.abs(diffMs) < Math.abs(bestDiff)) bestDiff = diffMs;
          }
          if (Math.abs(bestDiff) <= 260) {
            calState.taps.push(bestDiff);
            playVoiceNote(660, 0.06, 'sine', 0.14);
            statusText.textContent = `Calibrating audio sync (${calState.taps.length}/4 taps)...`;
          }
          return;
        }

        if (phase === 'idle' || phase === 'crashed') {
          startRun();
          return;
        }

        const adjSec = nowClockSec() - (avOffsetMs / 1000);
        const curQps = qps(modeSpeedMult());
        let curBeat = -countInQ + (adjSec - phaseStartSec) * curQps;

        // Allow instant Beat-1 tap at the very end of echo_listen (zero gap into live echo!)
        let allowImmediateEchoBeatOne = false;
        if (phase === 'echo_listen') {
          const leadQ = echoLeadQ();
          const curEchoBeat = -leadQ + (adjSec - phaseStartSec) * qps(1.0);
          if (curEchoBeat >= totalQ - hitWindowQ(qps(1.0), { beat: 0 })) {
            allowImmediateEchoBeatOne = true;
            curBeat = curEchoBeat - totalQ;
          }
        }

        const allowEarlyBeatOne = (phase === 'countin' && curBeat >= -hitWindowQ(curQps, { beat: 0 }));
        if (phase !== 'live' && !allowEarlyBeatOne && !allowImmediateEchoBeatOne) return;

        const t = getTheme();

        const inRest = events.find(
          (e) => e.kind === 'rest' && curBeat >= e.beat + 0.14 && curBeat <= e.beat + e.dur - Math.min(REST_END_GRACE_Q, e.dur * 0.45)
        );

        // Always match the EARLIEST unjudged note within the ms-based hit window
        let best = null;
        for (const e of events) {
          if (e.kind !== 'note' || e.result !== null) continue;
          const d = Math.abs(e.beat - curBeat);
          const win = hitWindowQ(curQps, e);
          if (d <= win) {
            best = e;
            break;
          }
        }

        if (best) {
          const signedMs = Math.round(((curBeat - best.beat) / curQps) * 1000);
          const errMs = Math.abs(signedMs);
          best.signedMs = signedMs;
          updateTimingMeter(signedMs);
          totalJudged += 1;
          if (errMs <= PERFECT_MS) {
            best.result = 'perfect';
            totalHits += 1;
            streak += 1;
            const rm = (readEnforceMode === 'pure' ? 2.0 : readEnforceMode === 'tricks' ? 1.5 : 1.0) * (showPlayhead ? 1.0 : 1.25);
            const isReadTrick = (readEnforceMode === 'tricks' && activePortalMode !== 'track' && (best.stealthPopup || best.isHold)) || readEnforceMode === 'pure';
            if (isReadTrick) readCombo = Math.min(4, readCombo + 1);
            score += Math.round(100 * rm * (1 + readCombo * 0.25));
            playVoiceNote(587.33, 0.12, 'triangle', 0.19);
            popups.push({ text: isReadTrick && readCombo >= 2 ? `READ ×${readCombo}!` : 'PERFECT', color: isReadTrick && readCombo >= 2 ? '#60efff' : t.success, beat: best.beat, life: 0.9 });
          } else {
            best.result = 'good';
            totalHits += 0.7;
            streak += 1;
            const rm = (readEnforceMode === 'pure' ? 2.0 : readEnforceMode === 'tricks' ? 1.5 : 1.0) * (showPlayhead ? 1.0 : 1.25);
            score += Math.round(60 * rm);
            playVoiceNote(466.16, 0.11, 'triangle', 0.16);
            popups.push({ text: signedMs < 0 ? 'EARLY' : 'LATE', color: t.warning, beat: best.beat, life: 0.9 });
          }

          if (streak === 5 || streak === 10 || streak === 15) {
            const unlockLabel = streak === 5 ? '+BASS!' : streak === 10 ? '+CHORDS!' : '+ARP!';
            popups.push({ text: unlockLabel, color: t.accent, beat: Math.min(totalQ - 0.4, best.beat + 0.35), life: 1.2 });
          }

          if (best.isHold && !holdRequired) {
            best.holdHeldQ = best.dur;
          }

          const curFloor = floorHeightAt(curBeat);
          if (best.isHold) {
            liveActiveGlide = best;
            best.holdDismounted = false;
            best.holdOverheld = false;
            cubeVy = 0;
          } else if (best.isAirOrb || cubeY > curFloor + 8) {
            // Controlled GD mid-air Jump Orb bounce so fast repeated notes stay at orb height
            liveActiveGlide = null;
            cubeVy = cubeY > curFloor + 64 ? 175 : (best.is16 ? 255 : 305);
            shockwaves.push({ x: PLAYER_X, y: 164 - cubeY, r: 9, color: best.is16 ? '#ff5ef7' : '#ffe64d', life: 1.0 });
          } else {
            liveActiveGlide = null;
            cubeVy = JUMP_VY;
          }
          if (best.isCluster && !best.isAirOrb) {
            shockwaves.push({ x: PLAYER_X, y: 140 - curFloor, r: 8, color: '#ffe64d', life: 1.0 });
          }
          spawnBurst(PLAYER_X, 154 - cubeY, best.result === 'perfect' ? '#66ff88' : '#ffe64d', activePortalMode === 'turbo' ? 12 : 9);
          updateHud();
        } else if (inRest) {
          inRest.restViolated = true;
          inRest.result = 'miss';
          totalJudged += 1;
          liveActiveGlide = null;
          cubeVy = JUMP_VY;
          popups.push({ text: 'REST!', color: t.error, beat: curBeat, life: 1.0 });
          const mNum = Math.min(numMeasures, inRest.m + 1);
          if (autoRestartOnMiss || isOverdriveRun()) {
            triggerCrash(curBeat, `Tapped during rest on M${mNum} — stay low!`);
          } else {
            streak = 0;
            playVoiceNote(140, 0.14, 'sawtooth', 0.16);
            updateHud();
          }
        } else {
          playVoiceNote(220, 0.08, 'sine', 0.1);
        }
      }

      function handleRelease() {
        isPointerOrKeyDown = false;
        const adjSec = nowClockSec() - (avOffsetMs / 1000);
        const curBeat = -countInQ + (adjSec - phaseStartSec) * qps(modeSpeedMult());

        if ((phase === 'live' || phase === 'countin') && holdRequired && liveActiveGlide) {
          const safeReleaseBeat = liveActiveGlide.beat + liveActiveGlide.dur - holdGraceQ(liveActiveGlide);
          if (curBeat < safeReleaseBeat) {
            const bad = liveActiveGlide;
            bad.result = 'miss';
            liveActiveGlide = null;
            cubeVy = -220;
            if (autoRestartOnMiss || isOverdriveRun()) {
              triggerCrash(curBeat, `Released hold early on M${bad.m + 1}!`);
            } else {
              streak = 0;
              playVoiceNote(140, 0.14, 'sawtooth', 0.16);
              updateHud();
            }
          } else {
            liveActiveGlide = null;
          }
        }
      }

      function warpToNextPortal(now, carryQ) {
        const t = getTheme();
        portalsCleared += 1;
        runPortals += 1;
        portalFlash = 1.0;
        const rm = (readEnforceMode === 'pure' ? 2.0 : readEnforceMode === 'tricks' ? 1.5 : 1.0) * (showPlayhead ? 1.0 : 1.25);
        const bossMult = isBossPortal ? 2 : 1;
        score += Math.round(250 * rm * bossMult);
        prog.coopPortals = (prog.coopPortals || 342) + 1;
        if (ghostSamples.length > bestGhostSamples.length) {
          bestGhostSamples = ghostSamples.slice();
        }
        ghostSamples = [];

        // Award World 3-Star Mastery (after 4 consecutive portals in a World)
        if (activeWorldId && runPortals >= 4) {
          const acc = totalJudged ? Math.round((totalHits / totalJudged) * 100) : 100;
          let earned = 0;
          if (acc >= 95 && readEnforceMode === 'pure') earned = 3;
          else if (acc >= 92 && (readEnforceMode === 'tricks' || readEnforceMode === 'pure')) earned = 2;
          else if (acc >= 85) earned = 1;
          if (earned > (prog.stars[activeWorldId] || 0)) {
            prog.stars[activeWorldId] = earned;
            popups.push({ text: `★ WORLD ${earned}-STAR!`, color: '#ffd84d', beat: 1.5, life: 1.6 });
          }
        }
        recordRunToProg();

        if (isOverdriveRun()) {
          overdrivePortals += 1;
          overdriveBest = Math.max(overdriveBest, overdrivePortals);
          bpm = Math.min(188, bpm + 6);
          const odCol = odHue(40);
          spawnBurst(PLAYER_X, 124, odCol, 28);
          popups.push({ text: `🔥 OVERDRIVE ${bpm} BPM!`, color: odCol, beat: 1.0, life: 1.4 });
        } else {
          spawnBurst(PLAYER_X, 124, isBossPortal ? '#ffd84d' : t.success, 26);
          const spdCfg = SPEED_LEVELS[speedPreset];
          const prevBpm = bpm;
          if (spdCfg.inc > 0) {
            bpm = Math.min(spdCfg.max, bpm + spdCfg.inc);
          }
          if (isBossPortal) {
            popups.push({ text: `🔥 BOSS CLEARED! 2×`, color: '#ffd84d', beat: 1.0, life: 1.5 });
          } else if (bpm > prevBpm) {
            popups.push({ text: `SPEED UP! ${bpm} BPM`, color: t.warning, beat: 1.0, life: 1.3 });
          }
        }
        playPortalWarp();

        portalBarOffset += numMeasures + 1;
        portalHueIdx = (portalHueIdx + 1) % PORTAL_HUES.length;
        targetStageHue = PORTAL_HUES[portalHueIdx];
        biomeIdx = (biomeIdx + 1) % BIOMES.length;
        isBossPortal = ((portalsCleared + 1) % 4 === 0);
        if (weeklyChallengeActive) {
          weeklyChallengeActive = false;
          srSeed(null);
        }
        activePortalMode = isBossPortal ? 'blind' : rollNextMode();
        beginPatternRun(now, carryQ, false, true);
      }

      // ---------- Continuous Loop ----------
      function tick() {
        const now = performance.now();
        const dtSec = lastTickPerf ? Math.min(0.05, Math.max(0, (now - lastTickPerf) / 1000)) : 0.016;
        lastTickPerf = now;
        const dh = ((targetStageHue - stageHue + 540) % 360) - 180;
        stageHue = (stageHue + dh * Math.min(1, dtSec * 5.5) + 360) % 360;
        if (phase === 'countin' || phase === 'live' || phase === 'echo_listen') {
          worldScrollBeat += dtSec * qps(modeSpeedMult());
        }
        const t = getTheme();

        const nowSec = nowClockSec();
        if (phase === 'echo_listen') {
          const leadQ = echoLeadQ();
          const curQps = qps(1.0);
          phaseBeat = -leadQ + (nowSec - phaseStartSec) * curQps;
          const lookBeat = phaseBeat + LOOKAHEAD_SEC * curQps;
          const targetSub = Math.min(Math.floor(totalQ * 2) - 1, Math.floor(lookBeat * 2 + 0.0001));
          for (let s = lastSubStep + 1; s <= targetSub; s++) {
            lastSubStep = s;
            const at = phaseStartSec + ((s / 2) + leadQ) / curQps;
            triggerGroove(s, s < 0, at);
          }
          if (lookBeat >= 0) {
            for (const e of events) {
              if (e.kind === 'note' && !e.echoFired && lookBeat >= e.beat) {
                e.echoFired = true;
                const at = phaseStartSec + (e.beat + leadQ) / curQps;
                playVoiceNote(e.isHold ? 392 : 466.16, Math.min(0.45, e.dur * 0.35), 'triangle', 0.23, at);
              }
            }
          }
          if (phaseBeat >= totalQ) {
            const carryQ = Math.min(0.2, phaseBeat - totalQ);
            phase = 'live';
            phaseStartPerf = now - ((countInQ + carryQ) / curQps) * 1000;
            phaseStartSec = nowSec - (countInQ + carryQ) / curQps;
            phaseBeat = carryQ;
            lastSubStep = -1;
            notationWrap.style.borderColor = t.accent;
            statusText.textContent = 'MEMORY ECHO — GO! Jump from ear!';
          }
        } else if (phase === 'countin') {
          const curQps = qps(modeSpeedMult());
          phaseBeat = -countInQ + (nowSec - phaseStartSec) * curQps;
          if (cubeY > 0 || cubeVy !== 0) {
            cubeY += cubeVy * dtSec;
            cubeVy -= GRAVITY * dtSec;
            cubeRot += 6.2 * dtSec;
            if (cubeY <= 0) {
              cubeY = 0;
              cubeVy = 0;
              cubeRot = Math.round(cubeRot / (Math.PI / 2)) * (Math.PI / 2);
            }
          }
          if (phaseBeat < 0) {
            const mi = meterInfo();
            const macroSub = mi.kind === 'compound' ? 3 : 2;
            const lookBeat = phaseBeat + LOOKAHEAD_SEC * curQps;
            const targetSub = Math.min(-1, Math.floor(lookBeat * 2 + 0.0001));
            for (let s = lastSubStep + 1; s <= targetSub; s++) {
              if (s < Math.floor(-countInQ * 2)) continue;
              lastSubStep = s;
              const at = phaseStartSec + ((s / 2) + countInQ) / curQps;
              triggerGroove(s, true, at);
              const macro = Math.max(1, Math.min(mi.beats, Math.floor((s + countInQ * 2) / macroSub) + 1));
              const odPrefix = isOverdriveRun() ? `🔥 OVERDRIVE (${bpm} BPM · Portal ${overdrivePortals + 1}) · ` : '';
              if (activePortalMode === 'turbo') {
                statusText.textContent = `⚡ TURBO DASH (4 bars @ ${effectiveBpm()} BPM) · Count in ${macro}`;
              } else if (activePortalMode === 'blind') {
                statusText.textContent = `${odPrefix}PURE SIGHT (${bpm} BPM) · Count in ${macro}`;
              } else if (activePortalMode === 'track') {
                statusText.textContent = `${odPrefix}TRACK ONLY (${bpm} BPM) · Count in ${macro}`;
              } else if (activePortalMode === 'stream') {
                statusText.textContent = `∞ ENDLESS STREAM (${bpm} BPM) · Count in ${macro}`;
              } else {
                statusText.textContent = `${odPrefix}LIVE SIGHT (${bpm} BPM) · Count in ${macro}`;
              }
            }
            if (Math.random() < 0.5) {
              particles.push({
                x: PLAYER_X - 10, y: 136 - cubeY,
                vx: -(1.8 + Math.random() * 1.4), vy: (Math.random() - 0.5) * 0.7,
                color: isOverdriveRun() ? odHue(0) : activePortalMode === 'turbo' ? t.warning : activePortalMode === 'blind' ? t.success : t.primary, life: 0.5
              });
            }
          } else {
            phase = 'live';
            const odPrefix = isOverdriveRun() ? `🔥 OVERDRIVE (${bpm} BPM · Best ${overdriveBest}) · ` : '';
            if (activePortalMode === 'turbo') {
              notationWrap.style.borderColor = t.warning;
              statusText.textContent = `⚡ TURBO DASH (4 bars @ ${effectiveBpm()} BPM) — Go fast!`;
            } else if (activePortalMode === 'blind') {
              notationWrap.style.borderColor = isOverdriveRun() && overdriveIntensity() > 0.05 ? odHue(0) : t.success;
              statusText.textContent = `${odPrefix}PURE SIGHT (${bpm} BPM) — Read the music! Obstacles reveal as you pass!`;
            } else if (activePortalMode === 'track') {
              notationWrap.style.borderColor = isOverdriveRun() && overdriveIntensity() > 0.05 ? odHue(0) : t.border;
              statusText.textContent = `${odPrefix}TRACK ONLY (${bpm} BPM) — No notation! Read the spikes & rails!`;
            } else if (activePortalMode === 'stream') {
              notationWrap.style.borderColor = t.primary;
              statusText.textContent = `∞ ENDLESS STREAM (${bpm} BPM · Bar 1) — Nonstop!`;
            } else {
              notationWrap.style.borderColor = isOverdriveRun() && overdriveIntensity() > 0.05 ? odHue(0) : t.primary;
              statusText.textContent = `${odPrefix}LIVE SIGHT (${bpm} BPM) — Jump on the rhythm!`;
            }
          }
        }

        if (phase === 'live') {
          const curQps = qps(modeSpeedMult());
          phaseBeat = -countInQ + (nowSec - phaseStartSec) * curQps;
          const lookBeat = phaseBeat + LOOKAHEAD_SEC * curQps;
          const targetSub = Math.min(Math.floor(totalQ * 2) - 1, Math.floor(lookBeat * 2 + 0.0001));
          for (let s = lastSubStep + 1; s <= targetSub; s++) {
            lastSubStep = s;
            const at = phaseStartSec + ((s / 2) + countInQ) / curQps;
            triggerGroove(s, false, at);
          }

          for (const e of events) {
            const win = hitWindowQ(curQps, e);
            if (e.kind === 'note' && e.result === null && phaseBeat > e.beat + win) {
              e.result = 'miss';
              totalJudged += 1;
              if (autoRestartOnMiss || isOverdriveRun()) {
                triggerCrash(e.beat + 0.08, `Missed note on M${e.m + 1}`);
                break;
              } else {
                streak = 0;
                playVoiceNote(140, 0.12, 'sawtooth', 0.14);
                updateHud();
              }
            }
            if (readEnforceMode === 'tricks' && activePortalMode !== 'track' && e.kind === 'rest' && e.fakeSpike && !e.restViolated && !e.fakeCleared && phaseBeat >= e.beat + 0.25) {
              e.fakeCleared = true;
              readCombo = Math.min(4, readCombo + 1);
              score += 120 * readCombo;
              spawnBurst(PLAYER_X, 152 - cubeY, '#60efff', 7);
              popups.push({ text: readCombo >= 2 ? `FAKE! READ ×${readCombo}` : 'FAKE!', color: '#60efff', beat: e.beat + 0.25, life: 0.95 });
              updateHud();
            }
          }

          if (phase === 'live') {
            if (!ghostSamples.length || phaseBeat - ghostSamples[ghostSamples.length - 1].b >= 0.08) {
              ghostSamples.push({ b: phaseBeat, y: cubeY, r: cubeRot });
            }
            if (prog.trail !== 'spark' && Math.random() < 0.45) {
              const tCol = prog.trail === 'prism'
                ? `hsl(${Math.round((performance.now() * 0.3) % 360)}, 95%, 65%)`
                : prog.trail === 'laser' ? '#60efff' : '#ffd84d';
              particles.push({
                x: PLAYER_X - 11, y: 154 - cubeY + (Math.random() - 0.5) * 6,
                vx: -(2.4 + Math.random() * 1.2), vy: (Math.random() - 0.5) * 0.5,
                color: tCol, life: 0.55, glyph: prog.trail === 'notes' ? '♪' : null
              });
            }
            const seg = elevSegmentAt(phaseBeat);
            const curFloor = seg ? seg.level * ELEV_STEP_PX : 0;
            const prevY = cubeY;
            if (liveActiveGlide && phaseBeat <= liveActiveGlide.beat + liveActiveGlide.dur - holdGraceQ(liveActiveGlide) && (!holdRequired || isPointerOrKeyDown)) {
              cubeY += ((curFloor + 44) - cubeY) * 0.34;
              cubeVy = 0; cubeRot = 0;
            } else {
              liveActiveGlide = null;
              cubeY += cubeVy * dtSec;
              cubeVy -= GRAVITY * dtSec;
              if (curFloor > 0 && prevY >= curFloor - 10 && cubeY <= curFloor && cubeVy <= 0) {
                cubeY = curFloor; cubeVy = 0;
                cubeRot = Math.round(cubeRot / (Math.PI / 2)) * (Math.PI / 2);
                if (Math.random() < 0.55) {
                  particles.push({
                    x: PLAYER_X - 11, y: 164 - curFloor,
                    vx: -(1.6 + Math.random() * 1.4), vy: -(0.3 + Math.random() * 0.9),
                    color: 'rgba(255,255,255,0.85)', life: 0.35
                  });
                }
              } else if (cubeY <= 0) {
                cubeY = 0; cubeVy = 0;
                cubeRot = Math.round(cubeRot / (Math.PI / 2)) * (Math.PI / 2);
                if (Math.random() < 0.55) {
                  particles.push({
                    x: PLAYER_X - 11, y: 164,
                    vx: -(1.6 + Math.random() * 1.4), vy: -(0.3 + Math.random() * 0.9),
                    color: 'rgba(255,255,255,0.85)', life: 0.35
                  });
                }
              } else if (curFloor > prevY + 10 && cubeY < curFloor - 10 && seg && !seg.floating && (autoRestartOnMiss || isOverdriveRun())) {
                triggerCrash(phaseBeat, `Hit block wall — jump to climb!`);
              } else {
                cubeRot += 6.2 * dtSec;
              }
            }
            cubeY = Math.min(cubeY, 136);

            if (isOverdriveRun()) {
              const od = overdriveIntensity();
              cubeTrail.push({ y: cubeY, rot: cubeRot, col: odHue(15, od), life: 1.0 });
              if (cubeTrail.length > 5) cubeTrail.shift();
              if (Math.random() < od * 0.45) {
                particles.push({
                  x: PLAYER_X - 10, y: 150 - cubeY + (Math.random() - 0.5) * 8,
                  vx: -(2.0 + od * 2.2), vy: (Math.random() - 0.5) * (0.8 + od * 0.8),
                  color: odHue(25, od), life: 0.4 + od * 0.25
                });
              }
              if (od > 0.08) {
                notationWrap.style.borderColor = odHue(0, od);
                refreshModeBadge();
              }
            }

            if (isStreamMode()) {
              if (phaseBeat + barQ * 3 > streamNextBar * barQ) {
                appendStreamMeasures(2);
              }
              events = events.filter((e) => e.m * barQ + barQ > phaseBeat - barQ * 1.5);
              elevSegments = elevSegments.filter((s) => s.endBeat > phaseBeat - barQ * 1.5);
              const barsNow = Math.max(0, Math.floor(phaseBeat / barQ));
              if (barsNow > streamBarsCleared) {
                streamBarsCleared = barsNow;
                streamBestBars = Math.max(streamBestBars, streamBarsCleared);
                portalsCleared += 1;
                if (streamBarsCleared % 2 === 0) {
                  portalBarOffset += numMeasures + 1;
        portalHueIdx = (portalHueIdx + 1) % PORTAL_HUES.length;
                  targetStageHue = PORTAL_HUES[portalHueIdx];
                  const spdCfg = SPEED_LEVELS[speedPreset];
                  if (spdCfg.inc > 0 && bpm < spdCfg.max) {
                    const curBeatExact = phaseBeat;
                    bpm = Math.min(spdCfg.max, bpm + spdCfg.inc);
                    phaseStartPerf = now - ((countInQ + curBeatExact) / qps(1.0)) * 1000;
                    phaseStartSec = nowSec - (countInQ + curBeatExact) / qps(1.0);
                    popups.push({ text: `SPEED UP! ${bpm} BPM`, color: t.warning, beat: phaseBeat + 0.5, life: 1.3 });
                  }
                }
                statusText.textContent = `∞ ENDLESS STREAM (${bpm} BPM · Bar ${streamBarsCleared + 1} · Best ${streamBestBars})`;
                updateHud();
              }
            } else if (phaseBeat >= totalQ) {
              warpToNextPortal(now, Math.min(0.2, phaseBeat - totalQ));
            }
          }
        } else if (phase === 'cooldown') {
          const baseBpm = SPEED_LEVELS[speedPreset].bpm;
          const p = Math.min(1, (now - cooldownStartPerf) / 1150);
          const eased = 1 - Math.pow(1 - p, 2);
          bpm = Math.round(cooldownFromBpm + (baseBpm - cooldownFromBpm) * eased);
          phaseBeat += 0.012 * (1 - p);
          cubeY = Math.max(0, cubeY * 0.88);
          updateHud();
          refreshModeBadge();
          if (p >= 1) {
            bpm = baseBpm;
            beginPatternRun(now, 0, false);
          }
        }

        downbeatPulse *= 0.88;
        beatPulse *= 0.86;
        portalFlash *= 0.88;
        screenShake *= 0.85;
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 0.038;
          if (p.life <= 0) particles.splice(i, 1);
        }
        for (let i = shockwaves.length - 1; i >= 0; i--) {
          const s = shockwaves[i];
          s.r += 4.2; s.life -= 0.06;
          if (s.life <= 0) shockwaves.splice(i, 1);
        }
        for (let i = popups.length - 1; i >= 0; i--) {
          popups[i].life -= 0.04;
          if (popups[i].life <= 0) popups.splice(i, 1);
        }

        drawAll();
        if (['echo_listen', 'countin', 'live', 'cooldown'].includes(phase) || particles.length || shockwaves.length || popups.length || screenShake > 0.02 || portalFlash > 0.02 || beatPulse > 0.02) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = null;
        }
      }

      // ---------- Canvas Rendering ----------
      function prepCanvas(canvas, ctx) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(320, Math.round(rect.width));
        const h = Math.round(rect.height);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w, h };
      }

      function evColor(e, t) {
        if (e.result === 'perfect') return t.success;
        if (e.result === 'good') return t.warning;
        if (e.result === 'miss') return t.error;
        if (phase === 'echo_listen' && e.echoFired) return t.accent;
        return activePortalMode === 'turbo' && phase === 'live' ? t.warning : t.primary;
      }

      function drawGame() {
        const { w, h } = prepCanvas(gameCanvas, gCtx);
        PLAYER_X = Math.round(Math.max(150, Math.min(260, w * 0.27)));
        const t = getTheme();
        gCtx.clearRect(0, 0, w, h);

        gCtx.save();
        if (screenShake > 0.02) {
          gCtx.translate((Math.random() - 0.5) * 9 * screenShake, (Math.random() - 0.5) * 6 * screenShake);
        }

        const groundY = h - 28;
        const isTurboDash = activePortalMode === 'turbo' && phase === 'live';
        const isOverdrive = isOverdriveRun();
        const od = overdriveIntensity();
        const railCol = (isOverdrive && od > 0.08) ? odHue(20, od) : isTurboDash ? '#ffd84d' : '#ffffff';
        const railW = 2.4 + od * 1.4;
        const pxPerQ = isTurboDash ? 128 : isOverdrive ? Math.round(104 + od * 36) : 104;
        const spinAngle = (performance.now() / 1000) * (isTurboDash ? 7.5 : 4.5 + od * 5.5);
        const scrollBeat = phase === 'idle' ? -1.4 : phase === 'echo_listen' ? (phaseBeat - totalQ) : phaseBeat;
        const wx = (q) => PLAYER_X + (q - scrollBeat) * pxPerQ;

        function drawSaw(cx, cy, r, teeth, hubCol) {
          gCtx.save();
          gCtx.translate(cx, cy);
          gCtx.rotate(spinAngle);
          gCtx.fillStyle = '#0b0e18';
          gCtx.beginPath();
          for (let k = 0; k < teeth * 2; k++) {
            const ang = (Math.PI * k) / teeth;
            const rad = k % 2 === 0 ? r + 3.5 : r - 1.5;
            const px = Math.cos(ang) * rad;
            const py = Math.sin(ang) * rad;
            if (k === 0) gCtx.moveTo(px, py);
            else gCtx.lineTo(px, py);
          }
          gCtx.closePath();
          gCtx.fill();
          gCtx.strokeStyle = '#ffffff';
          gCtx.lineWidth = 1.4;
          gCtx.stroke();
          gCtx.fillStyle = hubCol;
          gCtx.beginPath();
          gCtx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
          gCtx.fill();
          gCtx.restore();
        }

        // Authentic dark-rich Geometry Dash sky gradient + slow parallax square tiles + beat pulse
        const skyGrad = gCtx.createLinearGradient(0, 0, 0, groundY);
        skyGrad.addColorStop(0, gdSkyTop(od, beatPulse));
        skyGrad.addColorStop(1, gdSkyBot(od, beatPulse));
        gCtx.fillStyle = skyGrad;
        gCtx.fillRect(0, 0, w, groundY);

        // Dynamic Beat-Synced Biomes (cycles on every portal: Grid -> Mountains -> Sonar -> Starfield -> Stage Lights)
        const biome = BIOMES[biomeIdx % BIOMES.length];
        if (biome === 'grid') {
          const wallTile = 68;
          const wallOff = -(((worldScrollBeat * pxPerQ * 0.16) % wallTile + wallTile) % wallTile);
          gCtx.lineWidth = 1.2;
          for (let wy = groundY - wallTile; wy > -wallTile; wy -= wallTile) {
            for (let wxBg = wallOff - wallTile; wxBg < w + wallTile; wxBg += wallTile) {
              gCtx.fillStyle = 'rgba(0, 0, 0, 0.16)';
              gCtx.fillRect(wxBg + 4, wy + 4, wallTile - 8, wallTile - 8);
              gCtx.strokeStyle = `rgba(255, 255, 255, ${(0.05 + beatPulse * 0.045).toFixed(3)})`;
              gCtx.strokeRect(wxBg + 4, wy + 4, wallTile - 8, wallTile - 8);
            }
          }
          const bgCount = 8;
          const bgSlot = (w + 160) / bgCount;
          const bgShift = ((worldScrollBeat * pxPerQ * 0.08) % bgSlot + bgSlot) % bgSlot;
          gCtx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          for (let bi = -1; bi <= bgCount; bi++) {
            const bxBg = bi * bgSlot - bgShift;
            const baseBH = 22 + ((bi * 37 + 19) % 44);
            const pulseBH = baseBH + beatPulse * (5 + od * 12);
            gCtx.fillRect(bxBg, groundY - pulseBH, bgSlot * 0.62, pulseBH);
          }
        } else if (biome === 'mountains') {
          // Retro synthwave sun + glowing wireframe mountain peaks
          gCtx.save();
          gCtx.fillStyle = 'rgba(255, 210, 90, 0.14)';
          gCtx.beginPath();
          gCtx.arc(w * 0.72, groundY - 46, 32 + beatPulse * 5, 0, Math.PI * 2);
          gCtx.fill();
          const mSlot = 110;
          const mOff = ((worldScrollBeat * pxPerQ * 0.11) % mSlot + mSlot) % mSlot;
          gCtx.fillStyle = 'rgba(0, 0, 0, 0.28)';
          gCtx.strokeStyle = `rgba(255, 255, 255, ${(0.12 + beatPulse * 0.1).toFixed(3)})`;
          gCtx.lineWidth = 1.4;
          for (let mi = -1; mi <= Math.ceil(w / mSlot) + 1; mi++) {
            const mx = mi * mSlot - mOff;
            const mh = 42 + ((mi * 29 + 13) % 34) + beatPulse * 6;
            gCtx.beginPath();
            gCtx.moveTo(mx - 20, groundY);
            gCtx.lineTo(mx + mSlot * 0.5, groundY - mh);
            gCtx.lineTo(mx + mSlot + 20, groundY);
            gCtx.closePath();
            gCtx.fill();
            gCtx.stroke();
          }
          gCtx.restore();
        } else if (biome === 'sonar') {
          // Underwater drifting bubbles + sonar horizon ripples
          gCtx.save();
          for (let bi = 0; bi < 14; bi++) {
            const bx = ((bi * 97 - worldScrollBeat * pxPerQ * 0.22) % (w + 40) + w + 40) % (w + 40) - 20;
            const by = groundY - 12 - (((bi * 31 + performance.now() * 0.025) % (groundY - 24)));
            gCtx.strokeStyle = 'rgba(120, 240, 255, 0.22)';
            gCtx.lineWidth = 1.2;
            gCtx.beginPath();
            gCtx.arc(bx, by, 3 + (bi % 4) * 2, 0, Math.PI * 2);
            gCtx.stroke();
          }
          gCtx.restore();
        } else if (biome === 'starfield') {
          // Deep-space streaking warp stars
          gCtx.save();
          for (let si = 0; si < 26; si++) {
            const sx = ((si * 67 - worldScrollBeat * pxPerQ * (0.18 + (si % 3) * 0.12)) % w + w) % w;
            const sy = 14 + ((si * 43) % (groundY - 26));
            const len = 4 + (si % 3) * 5 + beatPulse * 6;
            gCtx.strokeStyle = `rgba(255, 255, 255, ${(0.18 + (si % 3) * 0.12).toFixed(2)})`;
            gCtx.lineWidth = 1.3;
            gCtx.beginPath();
            gCtx.moveTo(sx, sy);
            gCtx.lineTo(sx - len, sy);
            gCtx.stroke();
          }
          gCtx.restore();
        } else {
          // Concert Hall sweeping beat-synced stage spotlights
          gCtx.save();
          for (let li = 0; li < 4; li++) {
            const lx = (w / 5) * (li + 1);
            const sway = Math.sin(performance.now() * 0.0018 + li * 1.4) * 52;
            const grad = gCtx.createLinearGradient(lx, 0, lx + sway, groundY);
            grad.addColorStop(0, `rgba(255, 255, 255, ${(0.16 + beatPulse * 0.12).toFixed(3)})`);
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            gCtx.fillStyle = grad;
            gCtx.beginPath();
            gCtx.moveTo(lx - 6, 0);
            gCtx.lineTo(lx + 6, 0);
            gCtx.lineTo(lx + sway + 34, groundY);
            gCtx.lineTo(lx + sway - 34, groundY);
            gCtx.closePath();
            gCtx.fill();
          }
          gCtx.restore();
        }
        if (isBossPortal) {
          gCtx.fillStyle = '#ff4d6d';
          gCtx.globalAlpha = 0.06 + beatPulse * 0.08;
          gCtx.fillRect(0, 0, w, groundY);
          gCtx.globalAlpha = 1;
        }

        // Gentle radial beat-pulse rings synced to the groove
        if (od > 0.15 || beatPulse > 0.08) {
          const ringCx = w * 0.64;
          const ringCy = groundY * 0.52;
          const expand = 1 - beatPulse;
          gCtx.strokeStyle = od > 0.12 ? odHue(25, od) : '#ffffff';
          gCtx.lineWidth = 1.6;
          for (let ri = 0; ri < 2; ri++) {
            const rad = 22 + expand * (60 + od * 50) + ri * 28;
            gCtx.globalAlpha = Math.max(0, beatPulse * (0.09 + od * 0.16) * (ri === 0 ? 1 : 0.55));
            gCtx.beginPath();
            gCtx.arc(ringCx, ringCy, rad, 0, Math.PI * 2);
            gCtx.stroke();
          }
        }
        if (portalFlash > 0.03) {
          gCtx.fillStyle = '#ffffff';
          gCtx.globalAlpha = portalFlash * 0.16;
          gCtx.fillRect(0, 0, w, groundY);
        }
        gCtx.globalAlpha = 1;

        if (isTurboDash || od > 0.28) {
          gCtx.lineWidth = 1.4 + od * 0.6;
          gCtx.strokeStyle = isTurboDash ? '#ffd84d' : 'rgba(255,255,255,0.65)';
          gCtx.globalAlpha = isTurboDash ? 0.25 : (0.09 + od * 0.16);
          for (let sy = 32; sy < groundY - 12; sy += 26) {
            const sx = ((sy * 73 - worldScrollBeat * (220 + od * 110)) % w + w) % w;
            gCtx.beginPath();
            gCtx.moveTo(sx, sy);
            gCtx.lineTo(sx - (42 + od * 24), sy);
            gCtx.stroke();
          }
          gCtx.globalAlpha = 1;
        }

        if (phase === 'countin') {
          const mi = meterInfo();
          for (let c = 0; c < mi.beats; c++) {
            const cx = wx(-countInQ + c * mi.beatQ);
            if (cx > -20 && cx < w + 20) {
              gCtx.fillStyle = '#ffe64d';
              gCtx.globalAlpha = 0.85;
              gCtx.font = 'bold 12px ui-monospace, monospace';
              gCtx.textAlign = 'center';
              gCtx.fillText(String(c + 1), cx, groundY - 10);
              gCtx.globalAlpha = 1;
            }
          }
        }

        if (justWarpedPortal && phase === 'countin') {
          const exitPortalX = wx(-countInQ);
          if (exitPortalX > -30 && exitPortalX < w + 30) {
            const epCol = `hsl(${Math.round(stageHue)}, 90%, 66%)`;
            gCtx.strokeStyle = epCol;
            gCtx.lineWidth = 5.5;
            gCtx.globalAlpha = 0.36;
            gCtx.beginPath();
            gCtx.ellipse(exitPortalX, groundY - 25, 9, 24, 0, 0, Math.PI * 2);
            gCtx.stroke();
            gCtx.globalAlpha = 1;
            gCtx.strokeStyle = '#ffffff';
            gCtx.lineWidth = 2;
            gCtx.beginPath();
            gCtx.ellipse(exitPortalX, groundY - 25, 7.5, 22, 0, 0, Math.PI * 2);
            gCtx.stroke();
          }
        }

        const startPortalX = wx(0);
        if (startPortalX > -30 && startPortalX < w + 30) {
          const pCol = activePortalMode === 'turbo' ? '#ffd84d' : '#60efff';
          gCtx.strokeStyle = pCol;
          gCtx.lineWidth = 5;
          gCtx.globalAlpha = 0.35;
          gCtx.beginPath();
          gCtx.ellipse(startPortalX, groundY - 25, 8, 24, 0, 0, Math.PI * 2);
          gCtx.stroke();
          gCtx.globalAlpha = 1;
          gCtx.strokeStyle = '#ffffff';
          gCtx.lineWidth = 2;
          gCtx.beginPath();
          gCtx.ellipse(startPortalX, groundY - 25, 6.5, 22, 0, 0, Math.PI * 2);
          gCtx.stroke();
        }

        const barStart = isStreamMode() ? Math.max(1, Math.floor(scrollBeat / barQ) - 1) : 1;
        const barEnd = isStreamMode() ? Math.ceil((scrollBeat + barQ * 3) / barQ) : numMeasures - 1;
        for (let m = barStart; m <= barEnd; m++) {
          const mx = wx(m * barQ);
          if (mx > -20 && mx < w + 20) {
            gCtx.strokeStyle = 'rgba(255,255,255,0.16)';
            gCtx.lineWidth = 1.2;
            gCtx.beginPath();
            gCtx.moveTo(mx, 24);
            gCtx.lineTo(mx, groundY);
            gCtx.stroke();
          }
        }

        const goalPortalX = wx(totalQ);
        if (!isStreamMode() && goalPortalX > -30 && goalPortalX < w + 30) {
          const endGroundY = groundY - floorHeightAt(totalQ - 0.05);
          const pCol = portalFlash > 0.2 ? '#66ff88' : '#b37dff';
          gCtx.strokeStyle = pCol;
          gCtx.lineWidth = 6;
          gCtx.globalAlpha = 0.38;
          gCtx.beginPath();
          gCtx.ellipse(goalPortalX, endGroundY - 25, 10, 25, 0, 0, Math.PI * 2);
          gCtx.stroke();
          gCtx.globalAlpha = 1;
          gCtx.strokeStyle = '#ffffff';
          gCtx.lineWidth = 2.2;
          gCtx.beginPath();
          gCtx.ellipse(goalPortalX, endGroundY - 25, 8.5, 23, 0, 0, Math.PI * 2);
          gCtx.stroke();
          gCtx.fillStyle = '#ffffff';
          gCtx.font = 'bold 9px system-ui, sans-serif';
          gCtx.textAlign = 'center';
          gCtx.fillText('WARP', goalPortalX, endGroundY - 54);
        }

        // Render Geometry Dash stepped & floating air platforms (dark blocks + white outlines)
        for (let si = 0; si < elevSegments.length; si++) {
          const seg = elevSegments[si];
          if (seg.level <= 0) continue;
          const sx1 = wx(seg.startBeat);
          const sx2 = wx(seg.endBeat);
          if (sx2 < -20 || sx1 > w + 20) continue;
          const topY = groundY - seg.level * ELEV_STEP_PX;
          const slabH = seg.floating ? Math.min(18, groundY - topY) : (groundY - topY);
          const botY = topY + slabH;
          gCtx.save();
          gCtx.fillStyle = 'rgba(8, 12, 26, 0.90)';
          gCtx.fillRect(sx1, topY, sx2 - sx1, slabH);

          gCtx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          gCtx.lineWidth = 1;
          for (let gx = sx1 + 20; gx < sx2 - 4; gx += 20) {
            gCtx.beginPath();
            gCtx.moveTo(gx, topY);
            gCtx.lineTo(gx, botY);
            gCtx.stroke();
          }
          for (let gy = topY + 18; gy < botY - 2; gy += 18) {
            gCtx.beginPath();
            gCtx.moveTo(sx1, gy);
            gCtx.lineTo(sx2, gy);
            gCtx.stroke();
          }

          gCtx.strokeStyle = '#ffffff';
          gCtx.lineWidth = 1.6;
          gCtx.beginPath();
          gCtx.moveTo(sx1, topY);
          gCtx.lineTo(sx1, botY);
          gCtx.moveTo(sx2, topY);
          gCtx.lineTo(sx2, botY);
          if (seg.floating) {
            gCtx.moveTo(sx1, botY);
            gCtx.lineTo(sx2, botY);
          }
          gCtx.stroke();

          if (seg.floating) {
            for (let fx = sx1 + 4; fx <= sx2 - 12; fx += 14) {
              gCtx.fillStyle = '#0b0e18';
              gCtx.beginPath();
              gCtx.moveTo(fx, groundY);
              gCtx.lineTo(fx + 5, groundY - 11);
              gCtx.lineTo(fx + 10, groundY);
              gCtx.closePath();
              gCtx.fill();
              gCtx.strokeStyle = 'rgba(255,255,255,0.85)';
              gCtx.lineWidth = 1.2;
              gCtx.stroke();
            }
          }

          gCtx.strokeStyle = railCol;
          gCtx.lineWidth = railW;
          gCtx.beginPath();
          gCtx.moveTo(sx1, topY);
          gCtx.lineTo(sx2, topY);
          gCtx.stroke();
          gCtx.restore();
        }

        const hideObstacles = (activePortalMode === 'echo' && (phase === 'live' || phase === 'echo_listen' || phase === 'idle'))
          || (activePortalMode === 'blind' && (phase === 'live' || phase === 'countin' || phase === 'idle'))
          || (readEnforceMode === 'pure' && activePortalMode !== 'track' && (phase === 'live' || phase === 'countin' || phase === 'idle'));
        const tricksActive = readEnforceMode === 'tricks' && activePortalMode !== 'track' && !hideObstacles;
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          if (e.kind === 'tied') continue;
          const x = wx(e.beat);
          const xEnd = wx(e.beat + e.dur);
          if (xEnd < -45 || x > w + 45) continue;

          if (hideObstacles) {
            if (e.kind === 'note' && e.result === null) continue;
            if (e.kind === 'rest' && !e.restViolated && (phase !== 'live' || phaseBeat < e.beat + e.dur * 0.7)) continue;
          }
          const evGroundY = groundY - floorHeightAt(e.beat);
          gCtx.save();

          if (e.kind === 'note') {
            if (!e.isHold && tricksActive && e.stealthPopup) {
              const reveal = e.result !== null || (phase === 'live' && phaseBeat >= e.beat - 0.18);
              if (!reveal) {
                // Hidden pop-up obstacle: floor "?" rune for ground notes, or floating "?" for mid-air orbs
                const ry = e.isAirOrb ? Math.max(30, evGroundY - (e.orbH || 34)) : evGroundY;
                gCtx.strokeStyle = 'rgba(96, 239, 255, 0.5)';
                gCtx.lineWidth = 1.6;
                if (e.isAirOrb) {
                  gCtx.beginPath();
                  gCtx.arc(x + 6, ry, 7, 0, Math.PI * 2);
                  gCtx.stroke();
                  gCtx.fillStyle = 'rgba(96, 239, 255, 0.7)';
                  gCtx.font = 'bold 9px system-ui, sans-serif';
                  gCtx.textAlign = 'center';
                  gCtx.fillText('?', x + 6, ry + 3);
                } else {
                  gCtx.beginPath();
                  gCtx.moveTo(x + 7, evGroundY - 1);
                  gCtx.lineTo(x + 19, evGroundY - 1);
                  gCtx.stroke();
                  gCtx.fillStyle = 'rgba(96, 239, 255, 0.65)';
                  gCtx.font = 'bold 9px system-ui, sans-serif';
                  gCtx.textAlign = 'center';
                  gCtx.fillText('?', x + 13, evGroundY - 5);
                }
                gCtx.restore();
                continue;
              }
            }
            const judgedCol = e.result === 'perfect' ? '#66ff88' : e.result === 'good' ? '#ffe64d' : e.result === 'miss' ? '#ff5c6c' : null;
            const col = judgedCol || ((od > 0.12) ? odHue(20, od) : isTurboDash ? '#ffd84d' : '#60efff');
            const bodyFill = judgedCol || '#0b0e18';
            gCtx.fillStyle = col;
            gCtx.beginPath();
            gCtx.arc(x, evGroundY, 3.8, 0, Math.PI * 2);
            gCtx.fill();

            if (isTurboDash || (isOverdrive && od > 0.55)) {
              gCtx.strokeStyle = isOverdrive ? odHue(35, od) : '#ffe64d';
              gCtx.lineWidth = 1.6;
              gCtx.beginPath();
              gCtx.arc(x + 12, evGroundY - 38, 10, 0, Math.PI * 2);
              gCtx.stroke();
            }

            if (e.isHold) {
              const rx1 = x + 8;
              const rx2 = Math.max(rx1 + 28, xEnd - 22);
              const ry = Math.max(30, evGroundY - (isTurboDash ? 50 : 44));

              // Danger zone underneath glide rail (red glow + classic white-outlined GD spikes/saws)
              gCtx.fillStyle = '#ff4d6d';
              gCtx.globalAlpha = 0.2;
              gCtx.fillRect(rx1, evGroundY - 8, rx2 - rx1, 8);
              gCtx.globalAlpha = 1;
              if (e.glideHazard === 'saws') {
                gCtx.strokeStyle = '#ff4d6d';
                gCtx.lineWidth = 2;
                gCtx.beginPath();
                gCtx.moveTo(rx1, evGroundY - 2);
                gCtx.lineTo(rx2, evGroundY - 2);
                gCtx.stroke();
                const sawCount = Math.max(2, Math.floor((rx2 - rx1) / 48));
                for (let sIdx = 0; sIdx < sawCount; sIdx++) {
                  const sxSaw = rx1 + 14 + ((rx2 - rx1 - 28) * (sawCount === 1 ? 0.5 : sIdx / (sawCount - 1)));
                  drawSaw(sxSaw, evGroundY - 9, 8.5, 8, '#ff4d6d');
                }
              } else {
                for (let hx = rx1 + 2; hx <= rx2 - 10; hx += 12) {
                  gCtx.fillStyle = '#0b0e18';
                  gCtx.beginPath();
                  gCtx.moveTo(hx, evGroundY);
                  gCtx.lineTo(hx + 5, evGroundY - 14);
                  gCtx.lineTo(hx + 10, evGroundY);
                  gCtx.closePath();
                  gCtx.fill();
                  gCtx.strokeStyle = '#ff6b81';
                  gCtx.lineWidth = 1.3;
                  gCtx.stroke();
                }
              }

              // Glowing neon hover-bridge / dash rail with safe-release marker (or mist-end fade in Tricks mode)
              const safeX = holdRequired ? Math.max(rx1 + 16, wx(e.beat + e.dur - holdGraceQ(e))) : rx2;
              const mistHold = tricksActive && holdRequired && e.result === null;
              const railEndX = mistHold ? Math.min(safeX, rx1 + Math.max(28, (safeX - rx1) * 0.48)) : safeX;
              let railStroke = col;
              if (mistHold) {
                const grad = gCtx.createLinearGradient(rx1, ry, railEndX, ry);
                grad.addColorStop(0, col);
                grad.addColorStop(0.65, col);
                grad.addColorStop(1, 'rgba(96, 239, 255, 0)');
                railStroke = grad;
              }
              gCtx.save();
              gCtx.lineCap = 'round';
              // Outer neon glow halo
              gCtx.strokeStyle = railStroke;
              gCtx.lineWidth = 10;
              gCtx.globalAlpha = 0.25;
              gCtx.beginPath();
              gCtx.moveTo(rx1, ry);
              gCtx.lineTo(railEndX, ry);
              gCtx.stroke();
              // Main neon rail
              gCtx.lineWidth = 4.5;
              gCtx.globalAlpha = 0.95;
              gCtx.beginPath();
              gCtx.moveTo(rx1, ry);
              gCtx.lineTo(railEndX, ry);
              gCtx.stroke();
              // Crisp white inner core
              if (!mistHold) {
                gCtx.strokeStyle = '#ffffff';
                gCtx.lineWidth = 1.8;
                gCtx.globalAlpha = 0.9;
                gCtx.beginPath();
                gCtx.moveTo(rx1, ry);
                gCtx.lineTo(railEndX, ry);
                gCtx.stroke();
              }
              gCtx.restore();

              // Glowing launch ring at start of rail
              gCtx.save();
              gCtx.strokeStyle = col;
              gCtx.lineWidth = 2.2;
              gCtx.beginPath();
              gCtx.arc(rx1, ry, 6.5, 0, Math.PI * 2);
              gCtx.stroke();
              gCtx.fillStyle = '#ffffff';
              gCtx.beginPath();
              gCtx.arc(rx1, ry, 3, 0, Math.PI * 2);
              gCtx.fill();
              // Forward chevrons (>) along the active dash rail
              gCtx.strokeStyle = col;
              gCtx.lineWidth = 1.6;
              gCtx.globalAlpha = 0.85;
              for (let cx = rx1 + 14; cx < railEndX - 10; cx += 24) {
                gCtx.beginPath();
                gCtx.moveTo(cx - 3, ry - 4);
                gCtx.lineTo(cx + 2, ry);
                gCtx.lineTo(cx - 3, ry + 4);
                gCtx.stroke();
              }
              gCtx.restore();

              if (!mistHold) {
                if (holdRequired && safeX < rx2) {
                  gCtx.strokeStyle = '#66ff88';
                  gCtx.globalAlpha = 0.65;
                  gCtx.setLineDash([3, 3]);
                  gCtx.lineWidth = 3;
                  gCtx.beginPath();
                  gCtx.moveTo(safeX, ry);
                  gCtx.lineTo(rx2, ry);
                  gCtx.stroke();
                  gCtx.setLineDash([]);
                  gCtx.globalAlpha = 1;
                }
                gCtx.fillStyle = holdRequired ? '#66ff88' : '#ffffff';
                gCtx.beginPath();
                gCtx.arc(safeX, ry, 4, 0, Math.PI * 2);
                gCtx.fill();
                if (e.dot) {
                  gCtx.save();
                  gCtx.translate(rx2 - 3, ry);
                  gCtx.rotate(Math.PI / 4);
                  gCtx.fillStyle = '#ffffff';
                  gCtx.fillRect(-4, -4, 8, 8);
                  gCtx.restore();
                }
              }
              gCtx.fillStyle = '#ffffff';
              gCtx.font = 'bold 9px system-ui, sans-serif';
              gCtx.textAlign = 'center';
              gCtx.fillText(mistHold ? 'HOLD · READ' : holdRequired ? 'HOLD ──►' : 'GLIDE', mistHold ? (rx1 + railEndX) / 2 : (rx1 + rx2) / 2, ry - 11);
            } else if (e.isAirOrb || e.isCluster) {
              // Authentic GD Mid-Air Jump Orb over floor spikes (accounts for fast repeated notes!)
              const oy = Math.max(30, evGroundY - (e.orbH || 34));
              const ox = x + 6;
              const orbCol = judgedCol || (e.is16 ? '#ff5ef7' : '#ffe64d');
              // Floor spike bed directly underneath the airborne orb
              for (let hx = x - 6; hx <= x + 16; hx += 11) {
                gCtx.fillStyle = '#0b0e18';
                gCtx.beginPath();
                gCtx.moveTo(hx, evGroundY);
                gCtx.lineTo(hx + 5, evGroundY - 12);
                gCtx.lineTo(hx + 10, evGroundY);
                gCtx.closePath();
                gCtx.fill();
                gCtx.strokeStyle = '#ff6b81';
                gCtx.lineWidth = 1.2;
                gCtx.stroke();
              }
              // Outer neon pulse ring
              gCtx.strokeStyle = orbCol;
              gCtx.lineWidth = 3.5;
              gCtx.globalAlpha = 0.35;
              gCtx.beginPath();
              gCtx.arc(ox, oy, 10.5 + beatPulse * 1.6, 0, Math.PI * 2);
              gCtx.stroke();
              gCtx.globalAlpha = 1;
              // Orb core + crisp GD white ring
              gCtx.fillStyle = orbCol;
              gCtx.beginPath();
              gCtx.arc(ox, oy, 6.2, 0, Math.PI * 2);
              gCtx.fill();
              gCtx.strokeStyle = '#ffffff';
              gCtx.lineWidth = 1.6;
              gCtx.beginPath();
              gCtx.arc(ox, oy, 8.4, 0, Math.PI * 2);
              gCtx.stroke();
            } else if (e.dur < 0.7) {
              const sx = x + 14;
              if (e.obsStyle === 'mini_saw') {
                drawSaw(sx, evGroundY - 8.5, isTurboDash ? 9.5 : 8, 8, col);
              } else {
                const sh = isTurboDash ? 20 : 17;
                gCtx.fillStyle = bodyFill;
                gCtx.beginPath();
                gCtx.moveTo(sx - 6, evGroundY);
                gCtx.lineTo(sx, evGroundY - sh);
                gCtx.lineTo(sx + 6, evGroundY);
                gCtx.closePath();
                gCtx.fill();
                gCtx.strokeStyle = '#ffffff';
                gCtx.lineWidth = 1.5;
                gCtx.stroke();
              }
            } else {
              const sx = x + 18;
              const style = e.obsStyle || 'spike';
              const stepUp = floorHeightAt(e.beat + 0.9) > floorHeightAt(e.beat);
              if (stepUp) {
                // Classic GD Yellow Jump Pad at ledge step-ups
                gCtx.fillStyle = '#ffe64d';
                gCtx.globalAlpha = 0.28;
                gCtx.beginPath();
                gCtx.arc(sx, evGroundY, 13, Math.PI, 0);
                gCtx.fill();
                gCtx.globalAlpha = 1;
                gCtx.fillStyle = judgedCol || '#ffe64d';
                gCtx.beginPath();
                gCtx.ellipse(sx, evGroundY - 2, 11, 5, 0, Math.PI, 0);
                gCtx.fill();
                gCtx.strokeStyle = '#ffffff';
                gCtx.lineWidth = 1.4;
                gCtx.stroke();
              } else if (style === 'gap') {
                // Block-to-block gap jump: recessed spike trench + classic GD stepping block
                const gx1 = x + 6;
                const gx2 = x + 28;
                const bx2 = Math.max(gx2 + 22, xEnd - 4);
                gCtx.fillStyle = '#070a14';
                gCtx.fillRect(gx1, evGroundY - 2, gx2 - gx1, 14);
                gCtx.fillStyle = '#ff4d6d';
                gCtx.beginPath();
                gCtx.moveTo(gx1 + 2, evGroundY + 10);
                gCtx.lineTo(gx1 + 7, evGroundY - 2);
                gCtx.lineTo(gx1 + 12, evGroundY + 10);
                gCtx.moveTo(gx1 + 11, evGroundY + 10);
                gCtx.lineTo(gx1 + 16, evGroundY - 2);
                gCtx.lineTo(gx1 + 21, evGroundY + 10);
                gCtx.closePath();
                gCtx.fill();

                gCtx.fillStyle = 'rgba(8, 12, 26, 0.92)';
                gCtx.fillRect(gx2, evGroundY - 12, bx2 - gx2, 12);
                gCtx.strokeStyle = '#ffffff';
                gCtx.lineWidth = 1.6;
                gCtx.strokeRect(gx2, evGroundY - 12, bx2 - gx2, 12);
                gCtx.strokeStyle = col;
                gCtx.lineWidth = 2.4;
                gCtx.beginPath();
                gCtx.moveTo(gx2, evGroundY - 12);
                gCtx.lineTo(bx2, evGroundY - 12);
                gCtx.stroke();
              } else if (style === 'twin') {
                const sh = isTurboDash ? 24 : 21;
                [sx - 6, sx + 6].forEach((tx) => {
                  gCtx.fillStyle = bodyFill;
                  gCtx.beginPath();
                  gCtx.moveTo(tx - 6.5, evGroundY);
                  gCtx.lineTo(tx, evGroundY - sh);
                  gCtx.lineTo(tx + 6.5, evGroundY);
                  gCtx.closePath();
                  gCtx.fill();
                  gCtx.strokeStyle = '#ffffff';
                  gCtx.lineWidth = 1.5;
                  gCtx.stroke();
                });
              } else if (style === 'saw') {
                drawSaw(sx, evGroundY - 11, isTurboDash ? 11.5 : 10.5, 10, col);
              } else if (style === 'pillar') {
                const pw = 18;
                const ph = isTurboDash ? 22 : 20;
                gCtx.fillStyle = 'rgba(8, 12, 26, 0.92)';
                gCtx.fillRect(sx - pw / 2, evGroundY - ph, pw, ph);
                gCtx.strokeStyle = 'rgba(255,255,255,0.28)';
                gCtx.lineWidth = 1;
                gCtx.strokeRect(sx - pw / 2 + 4, evGroundY - ph + 4, pw - 8, ph - 8);
                gCtx.strokeStyle = judgedCol || '#ffffff';
                gCtx.lineWidth = 1.8;
                gCtx.strokeRect(sx - pw / 2, evGroundY - ph, pw, ph);
              } else {
                const sh = isTurboDash ? 27 : 24;
                gCtx.fillStyle = bodyFill;
                gCtx.beginPath();
                gCtx.moveTo(sx - 9, evGroundY);
                gCtx.lineTo(sx, evGroundY - sh);
                gCtx.lineTo(sx + 9, evGroundY);
                gCtx.closePath();
                gCtx.fill();
                gCtx.strokeStyle = '#ffffff';
                gCtx.lineWidth = 1.7;
                gCtx.stroke();
                gCtx.strokeStyle = 'rgba(255,255,255,0.22)';
                gCtx.lineWidth = 1;
                gCtx.beginPath();
                gCtx.moveTo(sx - 4, evGroundY - 3);
                gCtx.lineTo(sx, evGroundY - sh + 8);
                gCtx.lineTo(sx + 4, evGroundY - 3);
                gCtx.stroke();
              }
            }
          } else if (tricksActive && e.fakeSpike && !e.restViolated) {
            // Fakeout decoy floor spike during a rest: looks real unless you read the rest on the staff!
            const fsx = x + 16;
            const sh = isTurboDash ? 27 : 24;
            gCtx.save();
            gCtx.globalAlpha = e.fakeCleared ? 0.22 : 0.92;
            gCtx.fillStyle = '#0b0e18';
            gCtx.beginPath();
            gCtx.moveTo(fsx - 10, evGroundY);
            gCtx.lineTo(fsx, evGroundY - sh);
            gCtx.lineTo(fsx + 10, evGroundY);
            gCtx.closePath();
            gCtx.fill();
            gCtx.strokeStyle = e.fakeCleared ? '#60efff' : '#ffffff';
            gCtx.lineWidth = 1.6;
            gCtx.stroke();
            if (e.fakeCleared) {
              gCtx.fillStyle = '#60efff';
              gCtx.font = 'bold 8px system-ui, sans-serif';
              gCtx.textAlign = 'center';
              gCtx.fillText('FAKE', fsx, evGroundY - sh - 4);
            }
            gCtx.restore();
          } else {
            const col = e.restViolated ? '#ff5c6c' : (hideObstacles ? '#66ff88' : '#ff4d6d');
            const prevEv = i > 0 ? events[i - 1] : null;
            const afterShortNote = !!(prevEv && prevEv.kind === 'note' && !prevEv.isHold && prevEv.dur <= 0.75 && Math.abs((prevEv.beat + prevEv.dur) - e.beat) < 0.05);
            const restGraceQ = Math.min(REST_END_GRACE_Q, e.dur * 0.45);
            const rx1 = afterShortNote ? wx(e.beat + Math.min(0.30, e.dur * 0.35)) : (x + 4);
            const rx2 = Math.max(rx1 + 14, wx(e.beat + e.dur - restGraceQ));
            const rw = rx2 - rx1;
            const isShortRest = e.dur <= 0.55;
            const ceilY = Math.max(36, evGroundY - (isShortRest ? 52 : 38));
            const blockH = Math.max(12, ceilY - 22);

            // Red hazard underglow beneath the ceiling crusher
            gCtx.fillStyle = col;
            gCtx.globalAlpha = e.restViolated ? 0.30 : 0.14;
            gCtx.fillRect(rx1, ceilY, rw, isShortRest ? 14 : 22);
            gCtx.globalAlpha = 1;

            // Dark heavy GD ceiling crusher block
            gCtx.fillStyle = 'rgba(12, 10, 22, 0.92)';
            gCtx.fillRect(rx1, 22, rw, blockH);

            // Diagonal crimson caution stripes clipped inside the crusher block
            gCtx.save();
            gCtx.beginPath();
            gCtx.rect(rx1 + 1, 23, Math.max(0, rw - 2), Math.max(0, blockH - 2));
            gCtx.clip();
            gCtx.strokeStyle = col;
            gCtx.globalAlpha = 0.28;
            gCtx.lineWidth = 4;
            for (let sx = rx1 - blockH; sx < rx2 + blockH; sx += 12) {
              gCtx.beginPath();
              gCtx.moveTo(sx, 22);
              gCtx.lineTo(sx + blockH, 22 + blockH);
              gCtx.stroke();
            }
            gCtx.restore();

            // Crisp hazard border around the ceiling block
            gCtx.strokeStyle = col;
            gCtx.lineWidth = 1.8;
            gCtx.strokeRect(rx1, 22, rw, blockH);

            // Downward-pointing hazards along ceilY: spinning sawblade(s) or inverted spikes (omit deep spikes on short 8th rests)
            if (!isShortRest) {
              if (e.id % 2 === 1 && rw >= 34) {
                const sawCount = rw >= 76 ? 2 : 1;
                for (let si = 0; si < sawCount; si++) {
                  const sxSaw = rx1 + (rw * (si + 1)) / (sawCount + 1);
                  drawSaw(sxSaw, ceilY + 4, 8.5, 8, col);
                }
              } else {
                for (let sx = rx1 + 6; sx <= rx2 - 6; sx += 12) {
                  gCtx.beginPath();
                  gCtx.moveTo(sx - 5.5, ceilY);
                  gCtx.lineTo(sx + 5.5, ceilY);
                  gCtx.lineTo(sx, ceilY + 13);
                  gCtx.closePath();
                  gCtx.fillStyle = '#070a14';
                  gCtx.fill();
                  gCtx.strokeStyle = col;
                  gCtx.lineWidth = 1.4;
                  gCtx.stroke();
                }
              }
            }

            // Centered REST badge inside the dark block
            const badgeY = Math.max(33, ceilY - 5);
            const badgeW = Math.min(30, Math.max(16, rw - 2));
            gCtx.fillStyle = 'rgba(8, 10, 20, 0.88)';
            gCtx.fillRect((rx1 + rx2) / 2 - badgeW / 2, badgeY - 9, badgeW, 11);
            gCtx.fillStyle = col;
            gCtx.font = rw < 26 ? 'bold 8px system-ui, sans-serif' : 'bold 9px system-ui, sans-serif';
            gCtx.textAlign = 'center';
            gCtx.fillText(rw < 22 ? 'R' : 'REST', (rx1 + rx2) / 2, badgeY);
          }
          gCtx.restore();
        }

        // Authentic scrolling GD ground deck with 28x28 tiles + glowing white horizon
        gCtx.fillStyle = gdGroundCol(od);
        gCtx.fillRect(0, groundY, w, h - groundY);
        const gTile = 28;
        const gOff = -(((worldScrollBeat * pxPerQ) % gTile + gTile) % gTile);
        for (let gx = (PLAYER_X % gTile) + gOff - gTile; gx < w + gTile; gx += gTile) {
          gCtx.fillStyle = 'rgba(0, 0, 0, 0.25)';
          gCtx.fillRect(gx + 3, groundY + 4, gTile - 6, gTile - 7);
          gCtx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          gCtx.lineWidth = 1;
          gCtx.strokeRect(gx + 3, groundY + 4, gTile - 6, gTile - 7);
        }
        gCtx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        gCtx.lineWidth = 6;
        gCtx.beginPath();
        gCtx.moveTo(0, groundY);
        gCtx.lineTo(w, groundY);
        gCtx.stroke();
        gCtx.strokeStyle = '#ffffff';
        gCtx.lineWidth = 2.2;
        gCtx.beginPath();
        gCtx.moveTo(0, groundY);
        gCtx.lineTo(w, groundY);
        gCtx.stroke();

        gCtx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        gCtx.setLineDash([4, 4]);
        gCtx.lineWidth = 1;
        gCtx.beginPath();
        gCtx.moveTo(PLAYER_X, 24);
        gCtx.lineTo(PLAYER_X, groundY);
        gCtx.stroke();
        gCtx.setLineDash([]);

        if (hideObstacles) {
          const fogStart = Math.max(PLAYER_X + 10, phase === 'echo_listen' ? wx(0) - 18 : PLAYER_X + 10);
          if (fogStart < w) {
            const fogTint = activePortalMode === 'echo' ? t.accent : t.success;
            gCtx.save();
            gCtx.beginPath();
            gCtx.rect(fogStart, 22, w - fogStart, groundY - 22);
            gCtx.clip();

            // Soft stepped mist wall so obstacles ahead feel submerged in fog
            gCtx.fillStyle = t.card;
            gCtx.globalAlpha = 0.32;
            gCtx.fillRect(fogStart, 22, w - fogStart, groundY - 22);
            gCtx.globalAlpha = 0.36;
            gCtx.fillRect(fogStart + 26, 22, w - fogStart, groundY - 22);
            gCtx.globalAlpha = 0.28;
            gCtx.fillRect(fogStart + 62, 22, w - fogStart, groundY - 22);

            gCtx.fillStyle = fogTint;
            gCtx.globalAlpha = 0.08;
            gCtx.fillRect(fogStart, 22, w - fogStart, groundY - 22);

            // Drifting fog wisps scrolling leftward across the mist bank
            const drift = performance.now() / 1200;
            const fogSpan = Math.max(120, w - fogStart);
            gCtx.fillStyle = t.muted;
            for (let k = 0; k < 5; k++) {
              const frac = (((k * 0.23 - scrollBeat * 0.14 - drift * 0.08) % 1) + 1) % 1;
              const fx = fogStart + 18 + frac * fogSpan;
              const fy = 40 + ((k * 23) % Math.max(30, groundY - 62)) + Math.sin(drift * 1.4 + k) * 5;
              const rx = 38 + (k % 3) * 14;
              const ry = 13 + (k % 2) * 5;
              gCtx.globalAlpha = 0.16;
              gCtx.beginPath();
              gCtx.ellipse(fx, fy, rx, ry, 0, 0, Math.PI * 2);
              gCtx.fill();
            }

            // Crisp mist-edge curtain right ahead of the cube
            gCtx.strokeStyle = fogTint;
            gCtx.globalAlpha = 0.28;
            gCtx.lineWidth = 3;
            gCtx.beginPath();
            gCtx.moveTo(fogStart + 4, 24);
            gCtx.lineTo(fogStart + 4, groundY - 2);
            gCtx.stroke();
            gCtx.restore();
          }
        }

        if (isOverdrive && od > 0.25 && cubeTrail.length) {
          for (let ti = 0; ti < cubeTrail.length; ti++) {
            const tr = cubeTrail[ti];
            const age = cubeTrail.length - ti;
            const gx = PLAYER_X - age * (5 + od * 3);
            const gy = groundY - 12 - tr.y;
            gCtx.save();
            gCtx.globalAlpha = (0.05 + od * 0.16) * ((ti + 1) / cubeTrail.length);
            gCtx.translate(gx, gy);
            gCtx.rotate(tr.rot);
            gCtx.fillStyle = tr.col;
            gCtx.fillRect(-10, -10, 20, 20);
            gCtx.restore();
          }
        }

        // Personal Best Ghost Runner
        if (phase === 'live' && bestGhostSamples.length > 2) {
          let gs = bestGhostSamples[0];
          for (let gi = 0; gi < bestGhostSamples.length; gi++) {
            if (bestGhostSamples[gi].b <= phaseBeat) gs = bestGhostSamples[gi];
            else break;
          }
          const gy = groundY - 12 - gs.y;
          gCtx.save();
          gCtx.globalAlpha = 0.28;
          gCtx.translate(PLAYER_X, gy);
          gCtx.rotate(gs.r);
          gCtx.strokeStyle = '#60efff';
          gCtx.lineWidth = 1.6;
          gCtx.strokeRect(-11, -11, 22, 22);
          gCtx.fillStyle = '#60efff';
          gCtx.font = 'bold 7px system-ui, sans-serif';
          gCtx.textAlign = 'center';
          gCtx.fillText('PB', 0, -14);
          gCtx.restore();
        }

        const cubeRenderY = groundY - 12 - cubeY;
        if (phase !== 'crashed') {
          if (isOverdrive && od > 0.45) {
            gCtx.save();
            gCtx.strokeStyle = odHue(35, od);
            gCtx.globalAlpha = 0.18 + od * 0.22;
            gCtx.lineWidth = 2;
            gCtx.beginPath();
            gCtx.arc(PLAYER_X, cubeRenderY, 15 + beatPulse * 4, 0, Math.PI * 2);
            gCtx.stroke();
            gCtx.restore();
          }
          gCtx.save();
          gCtx.translate(PLAYER_X, cubeRenderY);
          const skinObj = SKINS.find((s) => s.id === prog.skin) || SKINS[0];
          const baseCol = (isOverdrive && od > 0.08) ? odHue(40, od) : isTurboDash ? '#ffd84d' : phase === 'countin' ? '#60efff' : skinObj.fill;

          if (liveActiveGlide) {
            // GD Rocket / Ship Vehicle mode on Long Holds & Ties!
            gCtx.fillStyle = '#ff9f43';
            gCtx.beginPath();
            gCtx.moveTo(-14, -4);
            gCtx.lineTo(-22 - Math.random() * 6, 0);
            gCtx.lineTo(-14, 4);
            gCtx.closePath();
            gCtx.fill();

            gCtx.fillStyle = baseCol;
            gCtx.beginPath();
            gCtx.moveTo(15, 0);
            gCtx.lineTo(-4, -9);
            gCtx.lineTo(-14, -6);
            gCtx.lineTo(-14, 6);
            gCtx.lineTo(-4, 9);
            gCtx.closePath();
            gCtx.fill();
            gCtx.strokeStyle = '#0b0e18';
            gCtx.lineWidth = 1.8;
            gCtx.stroke();
            // Cockpit canopy
            gCtx.fillStyle = '#5ce1e6';
            gCtx.beginPath();
            gCtx.ellipse(2, -1, 5, 3, 0, 0, Math.PI * 2);
            gCtx.fill();
          } else {
            gCtx.rotate(cubeRot);
            const cs = 22;
            if (skinObj.id === 'wireframe') {
              gCtx.fillStyle = 'rgba(10, 12, 24, 0.85)';
              gCtx.fillRect(-cs / 2, -cs / 2, cs, cs);
              gCtx.strokeStyle = baseCol;
              gCtx.lineWidth = 2.2;
              gCtx.strokeRect(-cs / 2, -cs / 2, cs, cs);
              gCtx.strokeRect(-6, -6, 12, 12);
            } else {
              gCtx.fillStyle = baseCol;
              gCtx.fillRect(-cs / 2, -cs / 2, cs, cs);
              gCtx.strokeStyle = '#0b0e18';
              gCtx.lineWidth = 2;
              gCtx.strokeRect(-cs / 2, -cs / 2, cs, cs);
              if (skinObj.id === 'treble') {
                gCtx.fillStyle = '#0b0e18';
                gCtx.font = 'bold 14px system-ui, sans-serif';
                gCtx.textAlign = 'center';
                gCtx.fillText('♪', 0, 5);
              } else if (skinObj.id === 'metronome') {
                gCtx.fillStyle = '#0b0e18';
                gCtx.beginPath();
                gCtx.moveTo(0, -8);
                gCtx.lineTo(6, 7);
                gCtx.lineTo(-6, 7);
                gCtx.closePath();
                gCtx.fill();
                gCtx.strokeStyle = '#ffffff';
                gCtx.lineWidth = 1.6;
                gCtx.beginPath();
                gCtx.moveTo(0, 6);
                gCtx.lineTo(5, -5);
                gCtx.stroke();
              } else {
                gCtx.fillStyle = '#0b0e18';
                gCtx.fillRect(-7, -6, 5, 5);
                gCtx.fillRect(2, -6, 5, 5);
                gCtx.fillRect(-6, 3, 12, 3.5);
                gCtx.fillStyle = '#5ce1e6';
                gCtx.fillRect(-5.5, -4.5, 2, 2);
                gCtx.fillRect(3.5, -4.5, 2, 2);
              }
            }
          }
          gCtx.restore();
        }

        for (const p of particles) {
          gCtx.globalAlpha = Math.max(0, p.life);
          gCtx.fillStyle = p.color;
          if (p.glyph) {
            gCtx.font = 'bold 12px system-ui, sans-serif';
            gCtx.textAlign = 'center';
            gCtx.fillText(p.glyph, p.x, p.y);
          } else {
            gCtx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
          }
        }
        for (const s of shockwaves) {
          gCtx.globalAlpha = Math.max(0, s.life * 0.75);
          gCtx.strokeStyle = s.color;
          gCtx.lineWidth = 2;
          gCtx.beginPath();
          gCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          gCtx.stroke();
        }
        gCtx.globalAlpha = 1;

        let badge = `${SPEED_LEVELS[speedPreset].label.toUpperCase()} (${bpm} BPM) · PRESS START OR SPACE`;
        let bCol = '#e2e8f0';
        const bossPrefix = isBossPortal ? '🔥 BOSS BAR (2×) · ' : '';
        const odBannerPrefix = isOverdrive ? `🔥 OVERDRIVE · PORTAL ${overdrivePortals + 1} (BEST ${overdriveBest}) · ` : bossPrefix;
        if (phase === 'cooldown') {
          badge = `🔥 HIT! SLOWING DOWN TO ${SPEED_LEVELS[speedPreset].bpm} BPM... (BEST: ${overdriveBest} PORTALS)`;
          bCol = '#ff6b81';
        } else if (phase === 'echo_listen') {
          badge = `${odBannerPrefix}MEMORY ECHO (1 BAR) — LISTEN CLOSELY!`;
          bCol = isOverdrive && od > 0.05 ? odHue(0, od) : '#c084fc';
        } else if (phase === 'countin') {
          const mi = meterInfo();
          const macro = Math.max(1, Math.min(mi.beats, Math.floor((phaseBeat + countInQ) / mi.beatQ) + 1));
          badge = activePortalMode === 'turbo'
            ? `⚡ TURBO DASH (4 BARS @ ${effectiveBpm()} BPM) · COUNT-IN: ${macro}`
            : activePortalMode === 'blind'
              ? `${odBannerPrefix}PURE SIGHT (${bpm} BPM) · COUNT-IN: ${macro}`
              : activePortalMode === 'track'
                ? `${odBannerPrefix}TRACK ONLY (${bpm} BPM) · COUNT-IN: ${macro}`
                : activePortalMode === 'stream'
                  ? `∞ ENDLESS STREAM (${bpm} BPM) · ONE COUNT-IN: ${macro}`
                  : `${odBannerPrefix}LIVE SIGHT (${bpm} BPM) · COUNT-IN: ${macro}`;
          bCol = (isOverdrive && od > 0.05) ? odHue(0, od) : '#ffe64d';
        } else if (phase === 'live') {
          badge = activePortalMode === 'echo'
            ? `${odBannerPrefix}MEMORY ECHO (1 BAR) — JUMP FROM MEMORY!`
            : activePortalMode === 'turbo'
              ? `⚡ TURBO DASH (4 BARS @ ${effectiveBpm()} BPM) — GO FAST!`
              : activePortalMode === 'blind'
                ? `${odBannerPrefix}PURE SIGHT (${bpm} BPM) — TRACK REVEALS BEHIND YOU`
                : activePortalMode === 'track'
                  ? `${odBannerPrefix}TRACK ONLY (${bpm} BPM) — NO NOTATION! JUMP THE OBSTACLES`
                  : activePortalMode === 'stream'
                    ? `∞ ENDLESS STREAM (${bpm} BPM) · BAR ${streamBarsCleared + 1} (BEST ${streamBestBars})`
                    : `${odBannerPrefix}LIVE SIGHT (${bpm} BPM) — JUMP EVERY NOTE ON THE BEAT!`;
          bCol = (isOverdrive && od > 0.08) ? '#ffffff' : activePortalMode === 'echo' ? '#c084fc' : activePortalMode === 'turbo' ? '#ffe64d' : activePortalMode === 'blind' ? '#66ff88' : activePortalMode === 'track' ? '#f8fafc' : '#60efff';
        } else if (phase === 'crashed') {
          badge = `CRASHED! ${crashInfo ? crashInfo.message : ''}`;
          bCol = '#ff6b81';
        }

        gCtx.font = 'bold 11px system-ui, sans-serif';
        const tw = gCtx.measureText(badge).width + 20;
        gCtx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        gCtx.fillRect(w / 2 - tw / 2, 4, tw, 17);
        gCtx.fillStyle = bCol;
        gCtx.textAlign = 'center';
        gCtx.fillText(badge, w / 2, 16);

        gCtx.restore();
      }

      function drawNotation() {
        const { w, h } = prepCanvas(notationCanvas, nCtx);
        const t = getTheme();
        nCtx.clearRect(0, 0, w, h);

        const gateX = 52;
        const portalX = w - 34;
        const spanW = portalX - gateX;
        const isStream = isStreamMode();
        const headX = Math.round(gateX + spanW * 0.22);
        const pxPerQNote = Math.max(58, Math.min(82, spanW / 6.5));
        const scrollQ = phase === 'idle' ? -0.5 : phaseBeat;
        const bx = isStream
          ? (q) => headX + (q - scrollQ) * pxPerQNote
          : (q) => gateX + (q / totalQ) * spanW;
        const staffY = 44;

        const hideNotation = activePortalMode === 'echo' && phase === 'live';
        const revealNotationAsPlayed = activePortalMode === 'track';
        const isEventRevealed = (e) => !revealNotationAsPlayed || (
          e.kind === 'note'
            ? e.result !== null
            : (e.restViolated || (phase === 'live' && phaseBeat >= e.beat + e.dur * 0.7))
        );

        const [tsNum, tsDen] = currentTs.split('/');
        nCtx.fillStyle = t.fg;
        nCtx.fillRect(10, staffY - 9, 2.5, 18);
        nCtx.fillRect(14, staffY - 9, 2.5, 18);
        nCtx.font = 'bold 13px system-ui, sans-serif';
        nCtx.textAlign = 'center';
        nCtx.fillText(tsNum, 28, staffY - 2);
        nCtx.fillText(tsDen, 28, staffY + 12);

        nCtx.strokeStyle = t.border;
        nCtx.lineWidth = 1.5;
        nCtx.beginPath();
        nCtx.moveTo(8, staffY);
        nCtx.lineTo(portalX + 4, staffY);
        nCtx.stroke();

        if (!hideNotation) {
          nCtx.save();
          if (isStream) {
            nCtx.beginPath();
            nCtx.rect(gateX - 6, 0, portalX - gateX + 18, h);
            nCtx.clip();
          }

          if (revealNotationAsPlayed && !events.some(isEventRevealed)) {
            nCtx.fillStyle = t.muted;
            nCtx.font = 'bold 11px system-ui, sans-serif';
            nCtx.textAlign = 'center';
            nCtx.fillText('TRACK ONLY — NOTATION REVEALS AS YOU PLAY', gateX + spanW / 2, staffY - 18);
          }

          const mStart = isStream ? Math.max(0, Math.floor(scrollQ / barQ) - 1) : 0;
          const mEnd = isStream ? Math.ceil((scrollQ + barQ * 3) / barQ) : numMeasures;
          for (let m = mStart; m <= mEnd; m++) {
            const bq = m * barQ;
            const x = (!isStream && bq === 0) ? gateX - 6 : bx(bq);
            if (isStream && (x < gateX - 8 || x > portalX + 10)) continue;
            nCtx.strokeStyle = (!isStream && m === numMeasures) ? t.fg : t.muted;
            nCtx.lineWidth = (!isStream && m === numMeasures) ? 2 : 1.2;
            nCtx.beginPath();
            nCtx.moveTo(x, staffY - 15);
            nCtx.lineTo(x, staffY + 15);
            nCtx.stroke();
          }

          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.beam === 'start') {
              let endIdx = i;
              while (endIdx + 1 < events.length && events[endIdx + 1].beam && events[endIdx + 1].beam !== 'start') {
                endIdx++;
                if (events[endIdx].beam === 'end') break;
              }
              let revEnd = endIdx;
              if (revealNotationAsPlayed) {
                revEnd = -1;
                for (let ri = i; ri <= endIdx; ri++) {
                  if (isEventRevealed(events[ri])) revEnd = ri;
                  else break;
                }
                if (revEnd <= i) continue;
              }
              const x1 = bx(e.beat) + 4.5;
              const x2 = bx(events[revEnd].beat) + 4.5;
              if (isStream && (x2 < gateX - 24 || x1 > portalX + 24)) continue;
              nCtx.strokeStyle = t.fg;
              nCtx.lineWidth = 3;
              nCtx.beginPath();
              nCtx.moveTo(x1, staffY - 24);
              nCtx.lineTo(x2, staffY - 24);
              nCtx.stroke();

              // Secondary (16th-note) beams & partial 16th stubs inside the beamed run
              nCtx.lineWidth = 2.4;
              for (let ri = i; ri <= revEnd; ri++) {
                if (!events[ri].is16) continue;
                const rxA = bx(events[ri].beat) + 4.5;
                if (ri + 1 <= revEnd && events[ri + 1].is16) {
                  const rxB = bx(events[ri + 1].beat) + 4.5;
                  nCtx.beginPath();
                  nCtx.moveTo(rxA, staffY - 19);
                  nCtx.lineTo(rxB, staffY - 19);
                  nCtx.stroke();
                } else if (!(ri - 1 >= i && events[ri - 1].is16)) {
                  const stubDir = ri === revEnd ? -8 : 8;
                  nCtx.beginPath();
                  nCtx.moveTo(rxA, staffY - 19);
                  nCtx.lineTo(rxA + stubDir, staffY - 19);
                  nCtx.stroke();
                }
              }

              if (e.trip && revEnd === endIdx) {
                nCtx.fillStyle = t.muted;
                nCtx.font = 'bold 10px system-ui, sans-serif';
                nCtx.textAlign = 'center';
                nCtx.fillText('3', (x1 + x2) / 2, staffY - 28);
              }
            }
          }

          for (let ei = 0; ei < events.length; ei++) {
            const e = events[ei];
            const x = bx(e.beat);
            if (isStream && (x < gateX - 24 || x > portalX + 24)) continue;
            if (!isEventRevealed(e)) continue;
            let col = t.fg;
            if (e.kind === 'tied') col = t.muted;
            else if (e.result === 'perfect') col = t.success;
            else if (e.result === 'good') col = t.warning;
            else if (e.result === 'miss') col = t.error;
            else if (revealNotationAsPlayed && e.kind === 'rest' && !e.restViolated) col = t.success;
            else if (phase === 'echo_listen' && e.echoFired) col = t.accent;

            if (e.isHold && holdRequired) {
              const hx1 = x + 2;
              const hx2 = Math.max(hx1 + 26, bx(e.beat + e.dur) - 10);
              nCtx.strokeStyle = t.warning;
              nCtx.lineWidth = 2;
              nCtx.beginPath();
              nCtx.moveTo(hx1, 13);
              nCtx.lineTo(hx2, 13);
              nCtx.stroke();
              nCtx.fillStyle = t.warning;
              nCtx.font = 'bold 9px system-ui, sans-serif';
              nCtx.textAlign = 'center';
              nCtx.fillText('HOLD', (hx1 + hx2) / 2, 10);
            }

            if (e.kind === 'note' || e.kind === 'tied') {
              const code = e.durCode || '';
              const isWhole = code === 'w' || (!e.tiedToNext && e.dur >= 3.99);
              const isOpen = isWhole || code === 'h' || code === 'hd' || (!e.tiedToNext && e.dur >= 1.99);
              nCtx.save();
              nCtx.translate(x, staffY);
              nCtx.rotate(isWhole ? 0 : -0.28);
              nCtx.beginPath();
              nCtx.ellipse(0, 0, isWhole ? 6.4 : 5.4, isWhole ? 4.2 : 3.8, 0, 0, Math.PI * 2);
              if (isOpen) {
                nCtx.fillStyle = t.card;
                nCtx.fill();
                nCtx.lineWidth = 1.9;
                nCtx.strokeStyle = col;
                nCtx.stroke();
              } else {
                nCtx.fillStyle = col;
                nCtx.fill();
              }
              nCtx.restore();

              if (e.dot) {
                nCtx.fillStyle = col;
                nCtx.beginPath();
                nCtx.arc(x + 9, staffY - 2, 1.9, 0, Math.PI * 2);
                nCtx.fill();
              }

              if (!isWhole) {
                nCtx.strokeStyle = col;
                nCtx.lineWidth = 1.7;
                nCtx.beginPath();
                nCtx.moveTo(x + 4.5, staffY - 1);
                nCtx.lineTo(x + 4.5, staffY - 24);
                nCtx.stroke();

                if ((code.startsWith('8') || code.startsWith('16') || (!code && e.dur < 0.7)) && !e.beam) {
                  nCtx.beginPath();
                  nCtx.moveTo(x + 4.5, staffY - 24);
                  nCtx.quadraticCurveTo(x + 12, staffY - 18, x + 9.5, staffY - 10);
                  nCtx.stroke();
                  if (e.is16) {
                    nCtx.beginPath();
                    nCtx.moveTo(x + 4.5, staffY - 18);
                    nCtx.quadraticCurveTo(x + 12, staffY - 12, x + 9.5, staffY - 4);
                    nCtx.stroke();
                  }
                }
              }

              if (e.tiedToNext && ei + 1 < events.length) {
                const tx2 = bx(events[ei + 1].beat);
                nCtx.strokeStyle = col;
                nCtx.lineWidth = 1.5;
                nCtx.beginPath();
                nCtx.moveTo(x + 4, staffY + 6);
                nCtx.quadraticCurveTo((x + tx2) / 2, staffY + 16, tx2 - 4, staffY + 6);
                nCtx.stroke();
              }
            } else {
              nCtx.strokeStyle = col;
              nCtx.fillStyle = col;
              if (e.dur >= 1.99) {
                // Half / whole rest rectangle sitting on the line
                nCtx.fillRect(x - 5.5, staffY - 5, 11, 5);
              } else if (e.dur < 0.75) {
                // Eighth rest glyph
                nCtx.beginPath();
                nCtx.arc(x - 2, staffY - 4, 2.2, 0, Math.PI * 2);
                nCtx.fill();
                nCtx.lineWidth = 1.6;
                nCtx.beginPath();
                nCtx.moveTo(x - 1, staffY - 3);
                nCtx.quadraticCurveTo(x + 4, staffY - 3, x + 3, staffY - 6);
                nCtx.lineTo(x - 1, staffY + 9);
                nCtx.stroke();
              } else {
                // Quarter / dotted-quarter rest squiggle
                nCtx.lineWidth = 1.8;
                nCtx.beginPath();
                nCtx.moveTo(x - 2, staffY - 10);
                nCtx.lineTo(x + 3, staffY - 4);
                nCtx.lineTo(x - 3, staffY + 1);
                nCtx.lineTo(x + 3, staffY + 7);
                nCtx.quadraticCurveTo(x - 2, staffY + 9, x + 1, staffY + 12);
                nCtx.stroke();
                if (e.dot) {
                  nCtx.beginPath();
                  nCtx.arc(x + 8, staffY - 2, 1.9, 0, Math.PI * 2);
                  nCtx.fill();
                }
              }
            }

            if (showCounts && e.cnt) {
              nCtx.fillStyle = e.kind === 'rest' ? t.muted : col;
              nCtx.font = '11px ui-monospace, monospace';
              nCtx.textAlign = 'center';
              nCtx.fillText(e.cnt, x, staffY + 32);
            }

            // Micro-Lesson Crash Highlight on the exact missed note/rest
            if (phase === 'crashed' && crashInfo && crashInfo.event && crashInfo.event.id === e.id) {
              nCtx.save();
              nCtx.strokeStyle = '#ff4d6d';
              nCtx.lineWidth = 2.4;
              nCtx.beginPath();
              nCtx.arc(x, staffY, 15, 0, Math.PI * 2);
              nCtx.stroke();
              const lbl = e.cnt ? `COUNT: ${e.cnt}` : (e.kind === 'rest' ? 'REST!' : 'HERE!');
              nCtx.font = 'bold 10px system-ui, sans-serif';
              const lw = nCtx.measureText(lbl).width + 10;
              nCtx.fillStyle = '#ff4d6d';
              nCtx.fillRect(x - lw / 2, 3, lw, 14);
              nCtx.fillStyle = '#ffffff';
              nCtx.textAlign = 'center';
              nCtx.fillText(lbl, x, 13);
              nCtx.restore();
            }

            if (isFinite(e.signedMs)) {
              const dx = Math.max(-9, Math.min(9, (e.signedMs / 140) * 9));
              nCtx.fillStyle = col;
              nCtx.beginPath();
              nCtx.arc(x + dx, staffY + 42, 2.3, 0, Math.PI * 2);
              nCtx.fill();
            }
          }
          nCtx.restore();
        } else {
          nCtx.strokeStyle = t.accent;
          nCtx.setLineDash([5, 4]);
          nCtx.strokeRect(gateX, 12, spanW, h - 24);
          nCtx.setLineDash([]);
          nCtx.fillStyle = t.accent;
          nCtx.font = 'bold 13px system-ui, sans-serif';
          nCtx.textAlign = 'center';
          nCtx.fillText('MEMORY ECHO — PATTERN HIDDEN! JUMP FROM EAR', gateX + spanW / 2, h / 2 + 4);
        }

        if (showPlayhead && (isStream || (['echo_listen', 'live'].includes(phase) && phaseBeat >= 0))) {
          const px = isStream ? headX : bx(Math.max(0, Math.min(totalQ, phaseBeat)));
          nCtx.strokeStyle = isOverdriveRun() && phase === 'live' && overdriveIntensity() > 0.05 ? odHue(0) : activePortalMode === 'turbo' && phase === 'live' ? t.warning : phase === 'echo_listen' ? t.accent : t.primary;
          nCtx.lineWidth = 2.2;
          nCtx.beginPath();
          nCtx.moveTo(px, 6);
          nCtx.lineTo(px, h - 6);
          nCtx.stroke();
        }

        for (const p of popups) {
          const px = bx(p.beat);
          if (isStream && (px < gateX - 20 || px > portalX + 20)) continue;
          nCtx.globalAlpha = Math.max(0, p.life);
          nCtx.fillStyle = p.color;
          nCtx.font = 'bold 10px system-ui, sans-serif';
          nCtx.textAlign = 'center';
          nCtx.fillText(p.text, px, 16);
        }
        nCtx.globalAlpha = 1;
      }

      function drawAll() {
        drawGame();
        drawNotation();
      }

      // ---------- Listeners ----------
      speedSelect.addEventListener('change', () => {
        speedSelect.blur();
        speedPreset = speedSelect.value;
        bpm = SPEED_LEVELS[speedPreset].bpm;
        updateHud();
        drawAll();
      });

      rouletteSelect.addEventListener('change', () => {
        rouletteSelect.blur();
        rouletteSetting = rouletteSelect.value;
        renderWorldsUI();
      renderSkinsUI();
      renderBoardUI();
      resetToIdle();
      });

      readModeBtn.addEventListener('click', () => {
        readModeBtn.blur();
        const t = getTheme();
        readEnforceMode = readEnforceMode === 'tricks' ? 'pure' : readEnforceMode === 'pure' ? 'visual' : 'tricks';
        readModeLabel.textContent = readEnforceMode === 'tricks' ? 'Tricks' : readEnforceMode === 'pure' ? 'Pure Fog' : 'Visual';
        readModeLabel.style.color = readEnforceMode === 'tricks' ? t.primary : readEnforceMode === 'pure' ? t.success : t.muted;
        drawAll();
      });

      playheadBtn.addEventListener('click', () => {
        playheadBtn.blur();
        const t = getTheme();
        showPlayhead = !showPlayhead;
        playheadLabel.textContent = showPlayhead ? 'On' : 'Off (+25%)';
        playheadLabel.style.color = showPlayhead ? t.success : t.warning;
        drawNotation();
      });

      longModeBtn.addEventListener('click', () => {
        longModeBtn.blur();
        const t = getTheme();
        holdRequired = !holdRequired;
        longModeLabel.textContent = holdRequired ? 'Hold' : 'Tap';
        longModeLabel.style.color = holdRequired ? t.warning : t.success;
        drawAll();
      });

      function openDrawer(which) {
        rhythmMenuPanel.classList.toggle('hidden', which !== 'rhythm' || !rhythmMenuPanel.classList.contains('hidden'));
        worldsPanel.classList.toggle('hidden', which !== 'worlds' || !worldsPanel.classList.contains('hidden'));
        boardPanel.classList.toggle('hidden', which !== 'board' || !boardPanel.classList.contains('hidden'));
        menuCaret.textContent = rhythmMenuPanel.classList.contains('hidden') ? '▾' : '▴';
      }

      menuToggleBtn.addEventListener('click', () => {
        menuToggleBtn.blur();
        openDrawer('rhythm');
      });

      worldsToggleBtn.addEventListener('click', () => {
        worldsToggleBtn.blur();
        renderWorldsUI();
        renderSkinsUI();
        openDrawer('worlds');
      });

      boardToggleBtn.addEventListener('click', () => {
        boardToggleBtn.blur();
        boardCatSelect.value = activeBoardCategory();
        renderBoardUI();
        openDrawer('board');
      });

      boardCatSelect.addEventListener('change', () => {
        boardCatSelect.blur();
        renderBoardUI();
      });

      boardPlayCatBtn.addEventListener('click', () => {
        boardPlayCatBtn.blur();
        const cat = boardCatSelect.value;
        if (cat === 'weekly') {
          startWeeklyChallenge();
          return;
        }
        const w = WORLDS.find((x) => x.id === cat);
        if (w) {
          selectWorld(w);
        } else {
          activeWorldId = null;
          weeklyChallengeActive = false;
          srSeed(null);
          resetToIdle();
        }
        boardPanel.classList.add('hidden');
        startRun();
      });

      tabWorldsBtn.addEventListener('click', () => {
        tabWorldsBtn.blur();
        worldsGrid.classList.remove('hidden');
        skinsArea.classList.add('hidden');
        tabWorldsBtn.className = 'px-2 py-0.5 rounded font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] cursor-pointer';
        tabSkinsBtn.className = 'px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer';
      });

      tabSkinsBtn.addEventListener('click', () => {
        tabSkinsBtn.blur();
        worldsGrid.classList.add('hidden');
        skinsArea.classList.remove('hidden');
        tabSkinsBtn.className = 'px-2 py-0.5 rounded font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] cursor-pointer';
        tabWorldsBtn.className = 'px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer';
        renderSkinsUI();
      });

      previewUnlockToggle.addEventListener('change', () => {
        previewUnlockToggle.blur();
        previewUnlockAll = previewUnlockToggle.checked;
        renderSkinsUI();
      });

      weeklyBtn.addEventListener('click', () => {
        weeklyBtn.blur();
        startWeeklyChallenge();
      });

      privacyToggleBtn.addEventListener('click', () => {
        privacyToggleBtn.blur();
        boardPrivacyAnimal = !boardPrivacyAnimal;
        renderBoardUI();
      });

      tsSelect.addEventListener('change', () => {
        tsSelect.blur();
        currentTs = tsSelect.value;
        renderRhythmChips();
        renderWorldsUI();
      renderSkinsUI();
      renderBoardUI();
      resetToIdle();
      });

      rhySysSelect.addEventListener('change', () => {
        rhySysSelect.blur();
        currentRhySys = rhySysSelect.value;
        if (phase === 'idle') {
          if (isStreamMode()) initStream();
          else events = generatePattern(modeBars(), activePortalMode === 'turbo');
        }
        drawAll();
      });

      tiesToggle.addEventListener('change', () => {
        tiesToggle.blur();
        tiesEnabled = tiesToggle.checked;
        if (phase === 'idle') {
          if (isStreamMode()) initStream();
          else events = generatePattern(modeBars(), activePortalMode === 'turbo');
          drawAll();
        }
      });

      presetBar.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-preset]');
        if (!btn) return;
        btn.blur();
        const p = btn.dataset.preset;
        if (p === 'compound') {
          currentTs = '6/8';
          tsSelect.value = '6/8';
          selectedCompound.clear();
          ['dq', 'eee', 'qe', 'dqr', 'dh'].forEach((id) => selectedCompound.add(id));
        } else {
          if (SR_METERS[currentTs][1] === 'compound') {
            currentTs = '4/4';
            tsSelect.value = '4/4';
          }
          selectedSimple.clear();
          const map = {
            basic: ['q', 'h', 'w', 'qr'],
            eighths: ['q', 'h', 'ee', 'qr', 'hr'],
            dotted: ['q', 'h', 'ee', 'qr', 'qde', 'syn', 'er'],
            sixteenths: ['q', 'ee', 'ssss', 'ess', 'sse', 'des', 'trip', 'qr']
          };
          (map[p] || ['q', 'h', 'ee', 'qr']).forEach((id) => selectedSimple.add(id));
        }
        renderRhythmChips();
        renderWorldsUI();
      renderSkinsUI();
      renderBoardUI();
      resetToIdle();
      });

      grooveSelect.addEventListener('change', () => {
        grooveSelect.blur();
        grooveStyle = grooveSelect.value;
      });

      avOffsetSlider.value = String(avOffsetMs);
      avOffsetVal.textContent = `${avOffsetMs > 0 ? '+' : ''}${avOffsetMs} ms`;
      avOffsetSlider.addEventListener('input', () => {
        avOffsetMs = Number(avOffsetSlider.value) || 0;
        avOffsetVal.textContent = `${avOffsetMs > 0 ? '+' : ''}${avOffsetMs} ms`;
        prog.avOffsetMs = avOffsetMs;
        saveProg();
      });

      volSlider.addEventListener('input', () => {
        const pct = Number(volSlider.value) || 0;
        masterVol = pct / 100;
        volVal.textContent = `${pct}%`;
        if (masterGain) masterGain.gain.value = masterVol;
      });

      avCalBtn.addEventListener('click', () => {
        avCalBtn.blur();
        ensureAudio();
        if (calState && calState.timer) clearTimeout(calState.timer);
        if (phase !== 'idle') resetToIdle();
        const base = nowClockSec() + 0.35;
        const step = 60 / 90; // 4 clicks at 90 BPM
        const clicks = [0, 1, 2, 3].map((i) => base + i * step);
        clicks.forEach((at, i) => playClick(i === 0, at));
        calState = { clicks, taps: [], timer: null };
        statusText.textContent = 'Tap Space or Canvas on the 4 clicks to calibrate audio sync...';
        calState.timer = setTimeout(() => {
          const st = calState;
          calState = null;
          if (st && st.taps.length >= 2) {
            const avg = Math.round((st.taps.reduce((a, b) => a + b, 0) / st.taps.length) / 5) * 5;
            avOffsetMs = Math.max(-150, Math.min(250, avg));
            avOffsetSlider.value = String(avOffsetMs);
            avOffsetVal.textContent = `${avOffsetMs > 0 ? '+' : ''}${avOffsetMs} ms`;
            prog.avOffsetMs = avOffsetMs;
            saveProg();
            statusText.textContent = `Audio sync calibrated to ${avOffsetMs > 0 ? '+' : ''}${avOffsetMs} ms!`;
          } else {
            statusText.textContent = 'Calibration cancelled (need at least 2 taps).';
          }
        }, Math.round((0.35 + 4 * step + 0.35) * 1000));
      });

      restartBtn.addEventListener('click', () => {
        restartBtn.blur();
        const t = getTheme();
        autoRestartOnMiss = !autoRestartOnMiss;
        restartLabel.textContent = autoRestartOnMiss ? 'Restart' : 'Keep Going';
        restartLabel.style.color = autoRestartOnMiss ? t.warning : t.muted;
      });

      countsToggle.addEventListener('change', () => {
        countsToggle.blur();
        showCounts = countsToggle.checked;
        drawNotation();
      });

      playBtn.addEventListener('click', () => {
        playBtn.blur();
        if (['echo_listen', 'countin', 'live', 'cooldown'].includes(phase)) {
          renderWorldsUI();
      renderSkinsUI();
      renderBoardUI();
      resetToIdle();
        } else {
          startRun();
        }
      });

      const touchPad = document.getElementById('touchPad');
      let activePointerId = null;
      const setPadDown = (down) => {
        if (touchPad) touchPad.classList.toggle('is-down', !!down);
      };

      [gameCanvas, notationCanvas, touchPad].forEach((c) => {
        if (!c) return;
        c.addEventListener('contextmenu', (e) => e.preventDefault());
        c.addEventListener('pointerdown', (e) => {
          if (e.button && e.button !== 0) return;
          e.preventDefault();
          if (activePointerId !== null) return;
          activePointerId = e.pointerId;
          try { if (c.setPointerCapture) c.setPointerCapture(e.pointerId); } catch {}
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          setPadDown(true);
          handlePress();
        });
        c.addEventListener('pointerup', (e) => {
          if (e.pointerId !== activePointerId) return;
          activePointerId = null;
          setPadDown(false);
          handleRelease();
        });
        c.addEventListener('pointercancel', (e) => {
          if (e.pointerId !== activePointerId) return;
          activePointerId = null;
          setPadDown(false);
          handleRelease();
        });
      });
      window.addEventListener('pointerup', (e) => {
        if (activePointerId === null || e.pointerId !== activePointerId) return;
        activePointerId = null;
        setPadDown(false);
        handleRelease();
      });
      window.addEventListener('blur', () => {
        if (activePointerId !== null || isPointerOrKeyDown) {
          activePointerId = null;
          setPadDown(false);
          handleRelease();
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          if (e.repeat) return;
          e.preventDefault();
          setPadDown(true);
          handlePress();
        }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
          e.preventDefault();
          setPadDown(false);
          handleRelease();
        }
      });

      window.addEventListener('themechange', () => { refreshModeBadge(); renderRhythmChips(); drawAll(); });
      window.addEventListener('resize', drawAll);

      renderWorldsUI();
      renderSkinsUI();
      renderBoardUI();
      resetToIdle();
    })();
  