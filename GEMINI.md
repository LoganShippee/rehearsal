# GEMINI.md

This file provides guidance to Antigravity (Gemini) when working in this repository alongside Claude Code (`CLAUDE.md`).

## Shared Project Guide

`CLAUDE.md` is the single source of truth for project commands, architecture, stacking/release gotchas, and coding conventions. Read `CLAUDE.md` before making changes, and update it (rather than duplicating details here) whenever build commands, architecture, or release checks change so both assistants stay in sync.

## Working with Claude Code

Both Antigravity and Claude Code work on this repo on `main`. Follow these handoff habits so neither assistant steps on the other's work:

1. **Check git state first.** Before editing, run `git status` and `git log -n 5 --oneline` to see recent commits or any uncommitted changes left by the other assistant. Do not overwrite or discard uncommitted changes without asking the user.
2. **Keep commits clean and descriptive.** Write clear commit messages explaining *what* changed and *why* (plus any follow-up notes) so the next assistant can pick up context immediately from `git log`. Never force-push or rewrite shared history on `main`.
3. **Verify before handing off.**
   - After editing `web/*.js`, syntax-check the edited files with `jsc` (`new Function(readFile('...'))`) and run `tests/run.sh`.
   - After editing `native/*.swift`, run `./build.sh` to verify the universal macOS app compiles cleanly.
   - If you add static files needed offline in the web version, add them to `FILES` in `web/sw.js`.
   - If you add files that must ship inside the `.app` bundle, check the diff list in `release.sh`.
   - If you add or change a user-facing feature, update the "What's in it" section of `README.md`.
4. **Never rename persistent identifiers.** Keep bundle ID `local.classpilot.app` and data folder `~/Library/Application Support/ClassPilot/` unchanged (macOS permissions, sign-ins, and saved data depend on them).
5. **Respect teacher-friendly conventions.** Keep UI copy plain, short, and jargon-free, and keep browser-only mode degrading gracefully for Mac-only features.

## Save states (rollback points)

Git commits are the save states. Make one before any risky or multi-file change, and another once the change is verified, so the user can always roll back.

- Save: `git add -A && git commit -m "Save: <what's about to change / what just changed>"` (local only; don't push unless the user asks).
- List: `git log --oneline -n 15`
- Look at a save without changing anything: `git show <id> --stat`
- Undo one change but keep later work: `git revert <id>`
- Roll everything back to a save: confirm with the user first, then `git reset --hard <id>`. This throws away later changes, so always make a fresh save before doing it.
