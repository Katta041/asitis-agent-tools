## Catches
Local-only agent files that are in the repo tree while no `.gitignore` in the repo covers them:

- `.claude/settings.local.json` at any depth, and hand-made copies such as `settings.local.json.bak` (templates like `.template` or `.example` are fine);
- `CLAUDE.local.md`;
- `.claude/agent-memory-local/` (subagent memory with the local scope);
- sign-in files, reported as errors: `.claude/.credentials.json`, `.codex/auth.json`, `.gemini/oauth_creds.json`, and a copy of `~/.claude.json`.

It reads only files named `.gitignore` to decide, never the local files themselves, and it does not walk folders a `.gitignore` excludes. It runs only when the folder is the top of a git checkout. Without git it cannot see whether a file is tracked, or read `.git/info/exclude` and your global excludes file, so the message says the file is not covered by `.gitignore` rather than that it is committed. Needs `--include config`.

## Bad
```
.gitignore           (node_modules/, dist/)
.claude/settings.json
.claude/settings.local.json
CLAUDE.local.md
```
Claude Code adds `**/.claude/settings.local.json` to your global git excludes the first time it writes the file, so it stays out of your commits on that machine. A clone, a sandbox or a teammate without that line commits it.

## Good
```
# .gitignore
node_modules/
dist/
**/.claude/settings.local.json
CLAUDE.local.md
.claude/agent-memory-local/
```

## Fix
Add the patterns to `.gitignore`. If git already tracks the file, run `git rm --cached .claude/settings.local.json` (the file stays on disk) and rotate any password or token it ever held, since history and forks keep the old copies. For a credentials file, sign out or revoke the session first.
