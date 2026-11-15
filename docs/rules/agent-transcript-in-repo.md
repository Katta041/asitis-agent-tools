# agent-transcript-in-repo

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning, varies (see below) | several files or the folder layout | no | no (security rule) |

Severity: a note for SpecStory history, which is saved in the repo on purpose; a warning for the rest.

## What it catches

Agent session transcripts or copied agent state are in the repo.

Agent session data committed into the tree, found by file and folder names and, for a bare `<uuid>.jsonl`, by the first 4 KB of the file:

- Claude Code transcripts and state copied from `~/.claude`: `.claude/projects/...`, folders named like `-home-me-app` holding `<uuid>.jsonl` or `memory/*.md`, `history.jsonl`, `file-history/`, `shell-snapshots/`, `todos/`;
- Codex `rollout-<timestamp>-<uuid>.jsonl` sessions and `.codex/history.jsonl`;
- Gemini CLI chats, logs and checkpoints under `.gemini/tmp/<hash>/`;
- Aider's `.aider.chat.history.md` and `.aider.input.history`;
- SpecStory's `.specstory/history/`, as a note, since SpecStory saves chats in the repo on purpose.

Files a `.gitignore` covers are skipped, and findings are grouped by folder. The content is never quoted. Runs only at the top of a git checkout. Needs `--include config`.

## Why it matters

Transcripts keep everything that passed through a tool in plain text: file contents, command output and pasted keys. Apiiro counted transcripts among the agent files that leaked 2,539 secrets on GitHub.

## Bad example

```
notes/
  -home-dev-shop/
    3f2a9c4e-8b1d-4e6f-a2c7-5d9e0b1f4a6c.jsonl
    memory/MEMORY.md
.aider.chat.history.md
```
A transcript holds every file the agent read, every command output and everything pasted into the chat, keys included.

## Good example

```
# .gitignore
.aider*
**/.claude/projects/
```
Share a summary or a cleaned excerpt instead of the raw session.

## How to fix

Read the files for secrets and rotate anything you find, then delete them from the repo and add the pattern from the message to `.gitignore`. Deleting does not remove them from git history, which is why rotating comes first.

## Suppress or configure

`agent-transcript-in-repo` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "agent-transcript-in-repo": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[code.claude.com](https://code.claude.com/docs/en/claude-directory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/agent-transcript-in-repo.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
