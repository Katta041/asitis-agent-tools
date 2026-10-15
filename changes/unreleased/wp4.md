### Added

- Drift and sync checks across AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules and Copilot instructions. They run on every whole-folder lint, markdown only:
  - `agents-md-shadowed` (warning): Claude Code skips an AGENTS.md when a CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md sits in the same folder or above. Not reported when that CLAUDE.md imports AGENTS.md (up to four hops), is a symlink to it, or is an exact copy.
  - `claude-local-hides-agents-md` (warning): the only file that switches the fallback off is CLAUDE.local.md (claude-code issue 96117).
  - `agents-md-unread-variant` (note): AGENTS.override.md (Codex only), AGENTS.local.md and files directly in .agents/ (no agent reads them), unless a steering file links to them.
  - `cross-file-contradiction` (warning): "do X" in one file and "do not X" in another, for files in the same folder that one agent loads together or that mirror each other for different agents. Uses the same detector as `contradiction`. Nested files that override their parents are left alone.
  - `instruction-drift` (note): two mirrored files share at least half of their rules (Jaccard) and at least three, but some rules are in only one. Up to 10 per pair.
  - `codex-chain-over-budget` (warning): Codex's 32 KiB budget is shared by every AGENTS.md (or AGENTS.override.md) from the root down; a nested file that crosses it is cut, deeper files are dropped.
- Files inside a skill folder (a folder with SKILL.md, or below one) are skill material and are left out of these checks.

### Changed

- `lint_steering` on a whole folder can now report the rules above, so its output changes on repos that have them. On the bundled agentic fixture, `packages/web/AGENTS.md` now gets `agents-md-shadowed`.
- `codex-chain-over-budget` moved from `spec.meta.ts` to `drift.meta.ts` and is now active.
