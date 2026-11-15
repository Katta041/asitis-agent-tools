# local-agent-file-not-ignored

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning, varies (see below) | several files or the folder layout | no | no (security rule) |

Severity: error for sign-in credential files and ~/.claude.json copies, a warning for the rest.

## What it catches

A local-only agent file is in the repo and no .gitignore covers it.

Local-only agent files that are in the repo tree while no `.gitignore` in the repo covers them:

- `.claude/settings.local.json` at any depth, and hand-made copies such as `settings.local.json.bak` (templates like `.template` or `.example` are fine);
- `CLAUDE.local.md`;
- `.claude/agent-memory-local/` (subagent memory with the local scope);
- sign-in files, reported as errors: `.claude/.credentials.json`, `.codex/auth.json`, `.gemini/oauth_creds.json`, and a copy of `~/.claude.json`.

It reads only files named `.gitignore` to decide, never the local files themselves, and it does not walk folders a `.gitignore` excludes. It runs only when the folder is the top of a git checkout. Without git it cannot see whether a file is tracked, or read `.git/info/exclude` and your global excludes file, so the message says the file is not covered by `.gitignore` rather than that it is committed. Needs `--include config`.

## Why it matters

settings.local.json, CLAUDE.local.md and local subagent memory are personal by design. Claude Code ignores settings.local.json only through each user's global git excludes, so a clone or a second machine commits it. Sign-in files (.claude/.credentials.json, .codex/auth.json) are errors.

## Bad example

```
.gitignore           (node_modules/, dist/)
.claude/settings.json
.claude/settings.local.json
CLAUDE.local.md
```
Claude Code adds `**/.claude/settings.local.json` to your global git excludes the first time it writes the file, so it stays out of your commits on that machine. A clone, a sandbox or a teammate without that line commits it.

## Good example

```
# .gitignore
node_modules/
dist/
**/.claude/settings.local.json
CLAUDE.local.md
.claude/agent-memory-local/
```

## How to fix

Add the patterns to `.gitignore`. If git already tracks the file, run `git rm --cached .claude/settings.local.json` (the file stays on disk) and rotate any password or token it ever held, since history and forks keep the old copies. For a credentials file, sign out or revoke the session first.

## Suppress or configure

`local-agent-file-not-ignored` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "local-agent-file-not-ignored": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Claude Code docs: Settings](https://code.claude.com/docs/en/settings), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/local-agent-file-not-ignored.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
