# Rehearsal UI Convention Guide

A practical reference for building and styling UI across Rehearsal's **web app** (`web/`), **embedded tools** (Sight Reading, Score Practice, Scan & Fix, Homework, PDF/Tuner/Metronome), and **public site** (`site/`).

---

## 1. Design Principles & Voice

- **Teacher-friendly plain language.** Labels are short, concrete, and jargon-free (e.g., *“Open a Music Score”*, *“Choose score file…”*, *“Steps only”*, *“Tap rhythm (Space / Touch)”*). Never expose internal state names, error codes, or developer terms in UI copy.
- **Actionable error & empty-state messages.** Tell the teacher what happened and what to do next (e.g., in `web/score.js`: *“MuseScore (.mscz) files need the desktop app — export MusicXML (.mxl) from MuseScore to use in a browser.”*).
- **Classroom & projector legibility.** The Present stage scales fluidly (`font-size: clamp(14px, 1.25vw, 22px)` on `.present`) with bold hierarchy (`2.6em` clock, `2.1em` class title) and `tabular-nums` on all live numbers so nothing jitters from the back of the room. Music notation canvases (`.sr-staff`, `.sp-score`, `.pq-staff-wrap`) stay crisp white (`#ffffff`) with dark ink (`#1d2330`) regardless of room theme.
- **Mobile-first & iPad touch ergonomics.**
  - Coarse pointers bump tier-1 toolbar height from `34px` to `40px` (`@media (pointer: coarse)` on `.sr-top, .sp-top, .sp-choir`).
  - Interactive pads use `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` (`.gr-tappad`).
  - `web/index.html` locks `viewport-fit=cover`, `apple-mobile-web-app-status-bar-style="black-translucent"`, and `html.web { background: #1b2a3d; overscroll-behavior: none; }` to prevent white status-bar seams and rubber-band overscroll on iPad.
- **Graceful Desktop vs. Browser degradation.** Check `IS_NATIVE` (WKWebView/WebView2 shell) and `HAS_SERVER` (loopback HTTP + `?t=` token) from `web/app.js`. Desktop-only features (External Apps, MuseScore `.mscz` conversion, Google Drive window, dated backups) must hide or show a plain-language browser alternative rather than failing silently.

---

## 2. Color Tokens & Theming

### Setup & Editor (`web/styles.css` `:root`)
Used by Setup tabs, Files browser, Settings, Teacher Homework (`web/hw-teacher.css`), and Scan & Fix (`web/scan.css`):

| Token | Light | Dark (`@media (prefers-color-scheme: dark)`) | Usage |
|---|---|---|---|
| `--e-bg` | `#f5f6f8` | `#15171c` | Page / canvas background |
| `--e-panel` | `#ffffff` | `#1e2128` | Cards, panels, toolbars |
| `--e-text` | `#1d2330` | `#e8eaf0` | Primary text |
| `--e-muted` | `#6b7385` | `#9aa1b2` | Secondary labels, hints |
| `--e-line` | `#e3e6ec` | `#2f333d` | Hairline borders & dividers |
| `--e-accent` | `#3b6cf6` | `#3b6cf6` | Primary buttons, active tabs/pills |
| `--e-accent-ink` | `#fff` | `#fff` | Text on `--e-accent` |
| `--e-danger` | `#d64545` | `#d64545` | Destructive actions |
| `--e-soft` | `#eef2fe` | `#252c40` | Hover, notice, & subtle pill fill |

### Present Stage & Floating Windows (`.present`, `applyTheme()` in `web/app.js`)
Each class picks a Look theme (`THEMES` in `web/app.js`: Ocean, Forest, Berry, Grape, Chalk, Midnight, Paper, Sky, Mint, Sunshine). `applyTheme(el, theme)` sets:
- `--bg`, `--accent`, `--text` (defaults on `.present`: `#0b3954`, `#ffd166`, `#fff`)
- `--card`: `hexA(th.bg, th.panel)` when panel opacity is set, else `color-mix(in srgb, var(--text) 9%, transparent)`
- `--line`: `color-mix(in srgb, var(--text) 16%, transparent)`
- Optional overrides: `--title-text`, `--clock-text`, `--side-fs`, `--side-card`
- Inside `.win`: `--surface: color-mix(in srgb, var(--bg) 86%, var(--text))` gives floating windows a tinted chrome derived from the active class Look, while `.win-body` defaults to `#fff` for embedded content (and `transparent` for `.win.native`).

### Public Site (`site/styles.css`) & Student Homework (`web/hw.css`)
- **Public site (`site/styles.css`)**: `--sky: #e3f2fd`, `--bg: #f6faff`, `--surface: #ffffff`, `--ink: #0d1b2a`, `--muted: #4a5e75`, `--line: #d4e3f2`, `--accent: #1565c0` (`--accent-hover: #0e4f9c`, `--accent-soft: #dcebfb`), `--ok-bg: #e6f5ec` / `--ok-ink: #136139`, `--warn-bg: #fff5dd` / `--warn-ink: #7a4b06`.
- **Student Homework (`web/hw.css`)**: `body.hw-page` sets `--bg: #ffffff`, `--text: #182235`, `--muted: #5a6578`, `--line: #dce2ec`, `--accent: #2563eb` with a `#142238` sticky header.

### Semantic Status & Notation Colors
- **Status badges (`web/hw-teacher.css` `--hwt-*`)**:
  - **OK / Ready**: `#dcfce7` / `#166534` (dark: `rgba(34, 197, 94, 0.16)` / `#86efac`)
  - **Warning**: `#fef3c7` / `#92400e` (dark: `rgba(245, 158, 11, 0.16)` / `#fcd34d`)
  - **Error / Danger**: `#fee2e2` / `#991b1b` (dark: `rgba(239, 68, 68, 0.16)` / `#fca5a5`)
  - **Info**: `#dbeafe` / `#1e40af` | **Pitch**: `#f3e8ff` / `#6b21a8` | **Offline**: `#f1f5f9` / `#334155`
- **Grader marks (`.sr-staff` & Score Practice)**:
  - Correct: `#1b7a2a` (also `#1a9a5a` spot tick, `#22c55e` tap-pad hit)
  - Timing off: `#d9822b` (amber)
  - Missed / Error: `#c62828` (also `#e63946` classroom Silent signal & `.chip.test`)
  - Pitch off: `#7b3fbf` (purple)
- **Selection / Playhead Blue (`#1f6fd1`) vs. Loop / Active Coral (`#e76f51`)**:
  - `#1f6fd1`: note/measure selection (`.sr-sel`), non-looping playhead (`.sp-ph.is-play`), inactive loop range (`.sp-sel.off`), Solo voice toggle (`.sp-vfoc-btn.solo.on`), and empty-state dropzone CTA (`.sp-empty-drop button`).
  - `#e76f51`: active loop range (`.sp-sel i.start` / `i.end`), looping playhead (`.sp-ph`, `.sr-ph`), active note highlight (`.sr-cur`, `.pq-staff .sr-cur`), and Score Practice primary/active buttons (`.sp-top .sp-primary`, `.sp-top button.on`).

---

## 3. Typography & Spacing

- **Font stacks**:
  - App (`web/styles.css`): `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`
  - Public site (`site/styles.css`): `"SF Pro Text", "Segoe UI", Roboto, sans-serif` body (`16px/1.55`), `"SF Pro Display"` for headings (`letter-spacing: -0.02em; line-height: 1.18`), `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for `code`.
- **Tabular numbers (`font-variant-numeric: tabular-nums`)**: Required on all changing numbers—Present clock (`.p-clock .time`, `.p-clock .left`), timers (`.p-timer .tv`, `.tt-presets b`, `.tt-step input`), BPM/tempo steppers (`.sr-tempo`, `.sp-step output`), zoom readouts (`.tb-zpct`), PDF page counters (`.pdfv-num`), scoreboard (`.team .score`), and mini-HUD counters (`.comp-ag-min`).
- **Radii**: `--radius: 10px` (editor cards), `7px–9px` (inputs, buttons, sub-toolbar controls), `14px` (`.win`, `.p-dock`, `site` cards), `16px–18px` (`.p-card`, `.p-stage`), `99px` / `999px` (pills, chips, badges).
- **Compact toolbar density**: Tier-1 bars (`.sp-top`, `.sr-top`) use `--ctl-h: 34px` (`40px` on coarse pointers), `gap: 5px`, `padding: 7px 10px`. Tier-2 display strips (`.sp-sub`, `.sr-sub`) use `--sub-h: 26px`, `padding: 5px 10px`, and `10.5px` uppercase `.tb-lbl` group labels.

---

## 4. Layout & Shell Contracts

### Present Screen Stacking (`z-index`)
Keep layers strictly in order so overlays and toolbars never get trapped behind `.ink` or `.p-wins`:
- `0`: `.p-bg`, `.p-stage`, `.stage-content iframe/video/img.res`
- `1`: `.p-body` (`isolation: isolate`)
- `10` (base `6` overridden at line 2364): `.p-wins` (`isolation: isolate`); each `.win` has `isolation: isolate`
- `20`: `.ink` (annotation layer — its own stacking context)
- `25–30`: `.p-timer`, `.p-signal` (`z-index: 30`)
- `40–46`: `.p-overlay` (`40`), `.tool` (`45`), floating `.p-timer` (`46`)
- `50–58`: `.p-head` & `.p-dock` (`50`), `.sound-chip` (`51`), `.win-menu` (`55`), `.p-dock.floating` (`58`)
- `60–68`: `.confetti` & `.ink-bar.floating` (`60`), `.look-panel` (`62`), `.web-mode-menu` (`68`)
- `230`: `.gr-tappad` | `9500–9502`: `.tour-*` | `9600`: `.bug-backdrop` | `9999`: `.toast`

**Annotate pass-through:** `placeInkBar()` in `web/app.js` moves `#ink-bar` out of `#ink` onto `#present` so it floats above `z-index: 20`. Any new interactive toolbar/button visible while Annotate is active **must** match `INK_UI` in `web/app.js` (or carry `data-action` / `button`) so the ink canvas sets `pointer-events: none` over it.

### Window Chrome & `.win` Hosting
- `.win-bar` has `min-height: 46px`, `padding: 6px 8px 6px 12px`, and `min-width: 34px; min-height: 34px` buttons.
- `.win.native` keeps `.win-body` transparent so native WKWebViews sit underneath (`syncNative()` / `cutHoles()` in `web/app.js`).
- Responsive collapse: `@media (max-width: 900px)` stacks `.p-side` above `.p-stage` (`max-height: min(26vh, 220px)`) and hides `.p-split`.

### Isolated Scrollbars, Pinch-Zoom & Protected Zones
- Score/staff/PDF panes (`.sr-staff`, `.sp-score`, `.pdfv-view`, `.pq-staff`, `.p-side`) own their own `overflow: auto` and thin `7px` scrollbars (`scrollbar-width: thin`).
- Never alter zoom/scroll or stacking rules listed in `tests/protected-zones.json` (`pdf-zoom-scroll`, `unified-pinch-zoom`, `sight-zoom-scroll`, `score-zoom-scroll`, `piano-zoom-scroll`, `present-stacking`, `ipad-shell`) without explicit user approval.

---

## 5. Standard UI Patterns & Components

- **2-Tier Toolbars (`.sp-top` / `.sp-sub`, `.sr-top` / `.sr-sub`)**: Primary actions (mode tabs, Play, Tempo stepper, Metronome, Grade, Settings) live in Tier 1; display toggles (Syllables, Counts, Layout, Playhead, Zoom `− % +`) live in Tier 2, separated by `.tb-div` vertical dividers and `.tb-lbl` section labels.
- **Segmented Toggles**: `.sr-tabs` / `.sf-seg` wrap borderless buttons inside a tinted pill track (`border-radius: 8–11px`); the active button gets `.on`.
- **Pill Badges & Chips**: `.pill` (editor tags), `.chip` (Present header period/test badge), `.hw-badge` / `.hw-chip` (homework status), `.sr-pre-pill` (saved presets), `.sp-sung-badge`.
- **Dropzones (`.sp-empty-drop`)**: Centered dashed/bordered card inside `.sp-score` with heading, plain-language format hint (differentiating `HAS_SERVER` vs. browser), primary `Choose score file…` button, and `.drag` hover highlight.
- **Popovers vs. Mobile Bottom Sheets**: Desktop popovers anchor near their trigger (`position: fixed` / `absolute`). Below `640px` (`@media (max-width: 639px)` and `@container sfroot (max-width: 639px)` in `web/scan.css`), dock popovers to the bottom edge (`bottom: 0; border-radius: 16px 16px 0 0; padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px))`) with `40px` min-height buttons.
- **Toast Feedback**: Use `toast(msg, ms = 2600)` or `undoToast(msg, onUndo, ms = 4500)` from `web/app.js` (renders `.toast` at `z-index: 9999`).
- **Icons (`web/icons.js`)**: Always use `IC('ico:name')` (Lucide inline `<svg class="ico">`) for UI icons—never raw emoji in chrome.
- **HTML Escaping (`web/app.js`)**: Always wrap user-supplied strings in `esc(...)` before interpolating into `innerHTML` templates.

---

## 6. Modularity & Checklist for New Features

Put new features in their own files instead of growing `web/app.js` or `web/styles.css`:

1. **Create dedicated files**: `web/<feature>.css` and `web/<feature>.js` (prefix classes cleanly, e.g., `.sf-*`, `.hwt-*`).
2. **Register assets**:
   - Add `<link rel="stylesheet" href="...">` and `<script src="...">` in `web/index.html` (respecting classic script load order).
   - Add every new static file to `FILES` in `web/sw.js` so offline/PWA mode stays complete.
3. **Respect Protected Zones**: Leave `web/styles.css` protected selectors and `tests/protected-zones.json` zones untouched.
4. **Verify before committing**:
   - Run `tests/run.sh` (JS syntax, `index.html` ↔ `sw.js` parity, invariants, edit-guard, grader tests).
   - Run `tests/check-diff.sh` (verifies no unapproved Protected Zone edits).
   - Run `./build.sh` if any `native/*.swift` files changed.
5. **Update docs**: Add a row to `docs/feature-registry.md` and update the **"What's in it"** section of `README.md`.
