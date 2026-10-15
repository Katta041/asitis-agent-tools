## Catches
An `AGENTS.md` with a `CLAUDE.md` or `.claude/CLAUDE.md` in the same folder or a folder above it, where none of those files brings the AGENTS.md in (an `@` import up to four hops deep, a symlink, or an identical copy). Claude Code reads AGENTS.md only when no CLAUDE.md sits in the working directory or above it, so here it reads CLAUDE.md alone. When the only file in the way is a `CLAUDE.local.md`, the finding is `claude-local-hides-agents-md` instead. AGENTS.md files under template, example, fixture or temp folders, or inside a skill, are skipped. Linting the AGENTS.md on its own is enough; the check looks at the folders around it.

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
Put `@AGENTS.md` at the top of CLAUDE.md so Claude Code loads the shared file first, then the Claude-specific lines. Or make CLAUDE.md a symlink to AGENTS.md if there is nothing Claude-specific. Or delete CLAUDE.md, in which case Claude Code (2.1.277 and later) reads AGENTS.md on its own. If you only need it working on your machine, type `/config` in Claude Code and set Project instructions to `claude-md-and-agents-md`, which reads both. A sentence such as "read AGENTS.md" in CLAUDE.md does not count: it does not load the file.
