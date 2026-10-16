# sec-skill-allowed-tools

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

allowed-tools grants unscoped Bash, all tools, any interpreter or unscoped WebFetch.

A skill or Claude Code command whose `allowed-tools` grants `Bash` or `PowerShell` with no command pattern (or `Bash(*)`), every tool (`*`), `WebFetch` with no domain, an interpreter with any arguments (`Bash(python *)`, `Bash(node *)`, `Bash(sudo *)`), or `curl` or `wget` to any host. Those tools then run without a permission prompt during the turn that invokes the skill or command (the grant clears with your next message). Needs `--include skills`. With `extends: strict` in `.asitisrc.json` it also notes subagents that have no `tools` list, since they inherit every tool; that note is not shown by default.

## Why it matters

allowed-tools lets the listed tools run without a prompt during the turn that invokes the skill or command (the grant clears with the next message). A subagent with no tools list inherits every tool; extends: strict reports that too.

## Bad example

```markdown
---
name: changelog
description: Draft the changelog for the next release. Use when asked for release notes.
allowed-tools: Bash WebFetch
---
```
Any shell command and any URL, no prompt, for the whole turn that invokes the skill. A prompt injection in a PR description the skill reads becomes code execution.

## Good example

```markdown
---
name: changelog
description: Draft the changelog for the next release. Use when asked for release notes.
allowed-tools: Bash(git log *) Bash(git tag *) Read
---
```

## How to fix

List the commands the skill actually runs, with their prefixes: `Bash(git log *)`, `Bash(pnpm test)`. Leave out tools the skill does not need; Claude asks for the rest as usual.

## Suppress or configure

`sec-skill-allowed-tools` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-skill-allowed-tools": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-skill-allowed-tools.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
