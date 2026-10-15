## Catches
A folder with an `AGENTS.md`, no `CLAUDE.md`, and a `CLAUDE.local.md`. Claude Code counts CLAUDE.local.md as a CLAUDE.md for the "is there a CLAUDE.md" check, so AGENTS.md stops loading for the person who has the local file, and only for them. Only runs when the whole folder is linted.

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
Add a committed CLAUDE.md that imports AGENTS.md, so every CLAUDE.md-style load includes the shared file. Alternatively set Claude Code's project instructions setting to `claude-md-and-agents-md`, which reads both; that setting lives in user or managed settings, not in the repository.
