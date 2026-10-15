## Catches
An `AGENTS.md` where the only CLAUDE-style file in its folder or above is a `CLAUDE.local.md` (no `CLAUDE.md` or `.claude/CLAUDE.md`), and that local file does not import the AGENTS.md. Claude Code counts CLAUDE.local.md as a CLAUDE.md for the "is there a CLAUDE.md" check, so AGENTS.md stops loading for the person who has the local file, and only for them. Linting the AGENTS.md on its own is enough; the check looks at the folders around it.

## Bad
```text
AGENTS.md          # shared instructions, committed
CLAUDE.local.md    # "Use the staging URL https://staging.example.invalid", gitignored
```
On this machine Claude Code reads only the one-line local file. Teammates without a local file get AGENTS.md. The difference is invisible in the repository.

## Good
```markdown
<!-- CLAUDE.md, committed -->
@AGENTS.md
```
```markdown
<!-- CLAUDE.local.md, gitignored -->
Use the staging URL https://staging.example.invalid
```

## Fix
Add a committed CLAUDE.md that imports AGENTS.md, so every CLAUDE.md-style load includes the shared file. The quicker fix the message offers, putting `@AGENTS.md` at the top of your CLAUDE.local.md, works too, but only on your machine. Or type `/config` in Claude Code and set Project instructions to `claude-md-and-agents-md`, which reads both; that is a per-user setting, not something in the repository.
