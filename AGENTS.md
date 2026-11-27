# AGENTS.md

This repository uses [`CLAUDE.md`](CLAUDE.md) as the single source of truth for build commands, architecture, Online Homework data safety, and coding/anti-bloat conventions (shared across Claude Code, Antigravity, and other coding agents).

## Quick Workflow
1. Read `CLAUDE.md` (and `docs/ui-conventions.md` for UI/CSS work) before editing.
2. Check `git status` and `git log -n 5 --oneline` first.
3. Keep new features modular (`web/<feature>.js` + `web/<feature>.css`, registered in `web/index.html` and `web/sw.js`).
4. Run `tests/run.sh` and `tests/check-diff.sh` before committing (and `./build.sh` if `native/*.swift` changed).
5. Run an independent read-only Regression & UI Reviewer pass (`.claude/agents/regression-reviewer.md`) after any multi-file edit, refactor, or UI change to verify zero interference with existing working code and UI.
