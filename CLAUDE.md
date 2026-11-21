# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rehearsal is a classroom-display and music-rehearsal app for teachers. It ships two ways from the same `web/` folder:
- **Mac app**: a small Swift shell (`native/`) that serves `web/` from a loopback HTTP server and shows it in WKWebView windows.
- **Web version**: the same `web/` folder published to GitHub Pages; it runs in any browser, offline via `web/sw.js`.

Everything uses the Rehearsal name: bundle ID `local.rehearsal.app`, data folder `~/Library/Application Support/Rehearsal/` (with one-time startup migration from the legacy data folder in `native/updater.swift`), the executable, the Info.plist update keys (`RehearsalUpdateRepo`/`RehearsalUpdateKey`), window frame names (`RehearsalMain`, `RehearsalPresent`, `RehearsalDrive`), and the browser's localStorage key `rehearsal`.

## Commands

There is no package manager, bundler or Node: the web code is plain browser JavaScript, and macOS's built-in JavaScriptCore runs the tests.

```bash
./build.sh                 # build build/Rehearsal.app (universal: compiles native/*.swift with swiftc, copies web/)
./build.sh --install       # build and copy into /Applications
tests/run.sh               # grader tests (all of them)
./release.sh "Notes"       # publish to everyone (see Releases); --minor / --major for bigger bumps
```

Run a single test (each test gets the modules it needs passed after `--`, plus its own name):
```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/grader-test.js -- web/music.js web/grade.js grader-test
```
(the others are `grader-test2` and `tap-test`, run the same way).

Syntax-check a JS file (there is no linter):
```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e "new Function(readFile('web/app.js')); print('ok')"
```

Try the web version locally (browser mode: no token, so data goes to localStorage/IndexedDB): `python3 -m http.server 8765 -d web` (also in `.claude/launch.json` as `web`).

## Architecture

### Web side (`web/`)
Classic `<script>` files loaded in order by `index.html` (icons → vexflow → sight → music → grade → pdf.js → pdfview → app → score). They share globals; there are no modules. A function defined in a later file can be *called* from an earlier one at runtime, but not at load time. Third-party code is vendored in `web/vendor/` (VexFlow, OpenSheetMusicDisplay, PDF.js, piano samples) for offline use.

- `app.js`: almost everything (data, schedule, Present screen, toolbar, windows, widgets, annotation, editor, actions). It's split into sections by `// ====… <name>` banner comments; grep the banners to navigate.
- `sight.js`: sight-reading generator, VexFlow notation and playback.
- `score.js`: score practice (OSMD rendering, piano playback, loops).
- `music.js`: Tuner/drone and Metronome windows.
- `grade.js`: grading sung/clapped/tapped performance (pitch/onset detection). This is what the tests cover.
- `pdfview.js`: PDF viewer, including per-file PDF annotations and the "save annotated copy" PDF writer.

**State.** `S` is the persisted document: classes, templates (bell schedules), events, settings, files metadata, windows, etc. It's loaded by `loadData()`, upgraded by `migrate()`, and saved by `save()` (debounced). In the Mac app it goes to `POST /api/data`; in a browser, to localStorage. When adding a new top-level field, default it where it's used (`S.x ||= …`) or in `migrate()`. `P` is in-memory Present-screen state and is never saved. A few per-device settings (music volume, metronome volume, playhead delay) live in localStorage, not `S`.

**Rendering.** There is no framework. HTML is built with template strings (always `esc()` user text) and assigned with `innerHTML`. `tick()` runs about 4× a second on the Present screen. To avoid rebuilding (and killing iframes, focus or scroll), each region compares a signature key before re-rendering: `P.sideKey`, `P.stageKey`, `P.layoutKey`, `WIN.sig`. To force a refresh after changing data, clear the relevant key (`P.sideKey = ''`) rather than calling render directly. Widgets in windows/tabs (`.wg-host[data-wg]`: cal, prog, rec, yt) re-render via `refreshWidgets(kind)` / `refreshWidgetsKeep(kind)`, which keep scroll and focus.

**Events.** These go through global delegation. `data-action="x"` on click runs `A['x'](el, e)`. `data-action-change` and `data-action-input` map to the `CHANGE` and `INPUT` tables. `data-bind="classes.0.name"` writes the value into `S` by path. Widgets and tools often have their own `onclick` with their own data attributes (`data-pg`, `data-yt`, `data-sr`, `data-mu`, `data-pdf`, …).

**Stacking on the Present screen** has bitten before. `.p-head` (which holds the toolbar, `.p-dock`) is `z-index: 50`. The annotation layer `.ink` is `z-index: 20` and is its own stacking context, so nothing inside it can rise above the header. Floating windows (`.p-wins`) sit at 6. The floating drawing bar is therefore moved out of `#ink` onto `#present` (see `placeInkBar`). While Annotate is on, the drawing canvas steps aside (`pointer-events: none`) over anything matching `INK_UI`, so buttons stay clickable.

### Native side (`native/`)
- `main.swift`: `LocalServer` (loopback HTTP; `/api/*` and `/files/*` require the per-launch token passed to the page as `?t=`), the app delegate, and the JS ↔ Swift bridge. The page calls `native(cmd, data)`, which becomes `window.webkit.messageHandlers.native`, and that is handled in a `switch cmd`. Swift calls back into the page through `window.__…` functions. API routes: data load/save, backups, file store/delete, MuseScore→MusicXML conversion (`/api/convert`), YouTube search scraping (`/api/ytsearch`).
- `webwindows.swift`: "Full browser" windows. Real WKWebViews sit *under* the transparent page, and the page cuts holes for them (`syncNative()` / `cutHoles()` in app.js send rectangles, z-order and blockers).
- `appmirror.swift`: live mirror of another app's window (ScreenCaptureKit) with input passthrough.
- `updater.swift`: signed GitHub-release updates (below). `drive.swift`, `bookmarks.swift`, `presentwindow.swift`: Google Drive window, Chrome bookmark import, and cover-the-screen "full screen".

`IS_NATIVE` / `HAS_SERVER` in app.js tell the two modes apart. Mac-only features (other apps' windows, MuseScore files, Drive, YouTube search, dated backups) must degrade gracefully in the browser.

### Releases and updates
`release.sh` runs the tests, bumps `release/VERSION`, commits everything, tags, builds, zips the app and `web/`, writes and signs `latest.json` (Ed25519 key at `~/.rehearsal/release-key`; public key in `release/public-key.txt`), pushes, publishes `web/` to the `gh-pages` branch, and creates the GitHub release. It also bumps `release/NATIVE` when `native/`, `build.sh` or `icon/AppIcon.icns` changed since the last tag. Installed apps download web-only releases quietly; a NATIVE bump makes them prompt "Install and reopen". So anything that must be inside the .app bundle needs that path added to the diff check in `release.sh`.

`web/sw.js` is network-first. New static files the web version needs offline must be added to its `FILES` list.

### Icon
`icon/source-1024.png` is the artwork. `icon/fromimage.swift` renders the macOS rounded-square iconset from it (command in README). The web icons and favicon are the IconKitchen outputs in `web/`. `icon/makeicon.swift` holds older, unused designs.

## Conventions
- User-facing text is for teachers: plain language, short, no jargon. Comments explain *why*, in the same plain style as the existing code.
- The README's "What's in it" section doubles as the feature reference. Update it when adding or changing a feature.

## Working with Antigravity (`GEMINI.md`)
- Antigravity (Gemini) also works in this repository and follows `GEMINI.md`, which treats this file (`CLAUDE.md`) as the single source of truth for commands, architecture, and conventions.
- Check `git status` and `git log -n 5 --oneline` before making edits so neither assistant clobbers the other's uncommitted work, and use clear commit messages for handoffs.
- Keep `CLAUDE.md` up to date when changing commands, architecture, or release checks so both assistants stay in sync.
