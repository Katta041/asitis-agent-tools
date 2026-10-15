## Catches
A folder with both an `AGENTS.md` and a `CLAUDE.md` (or `.claude/CLAUDE.md` or `CLAUDE.local.md`), where the CLAUDE.md does not import the AGENTS.md. Claude Code reads AGENTS.md only when no CLAUDE.md sits in the working directory or above it, so here it reads CLAUDE.md alone. Only runs when the whole folder is linted.

## Bad
```text
AGENTS.md     # the shared instructions, 180 lines, maintained by the team
CLAUDE.md     # "Prefer pnpm." (one line, added by one person)
```
Codex, Cursor and Copilot read AGENTS.md. Claude Code reads the one-line CLAUDE.md and never sees the 180 lines everyone else follows.

## Good
```markdown
<!-- CLAUDE.md -->
@AGENTS.md

Prefer pnpm.
```

## Fix
Put `@AGENTS.md` at the top of CLAUDE.md so Claude Code loads the shared file first, then the Claude-specific lines. Or make CLAUDE.md a symlink to AGENTS.md if there is nothing Claude-specific. Or delete CLAUDE.md, in which case Claude Code (2.1.277 and later) reads AGENTS.md on its own.
