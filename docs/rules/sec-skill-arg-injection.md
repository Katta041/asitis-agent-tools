# sec-skill-arg-injection

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

Skill argument is pasted into a !`command` that runs when the skill loads.

A `SKILL.md` line where a skill argument (`$ARGUMENTS`, `$0`, `$ARGUMENTS[1]` or a named argument) sits inside a `` !`command` `` or a ` ```! ` block. Claude Code runs those commands when the skill loads, after it has pasted the arguments in. Needs `--include skills`.

## Why it matters

Claude Code substitutes $ARGUMENTS, $0 and named arguments into injected shell commands before running them, so an argument with ; or $( ) runs extra commands, before Claude sees anything.

## Bad example

```markdown
---
name: pr-summary
description: Summarise a pull request. Use when asked about a PR by number.
---
- PR diff: !`gh pr diff $ARGUMENTS`
```
`/pr-summary "12; echo hello"` runs `gh pr diff 12` and then `echo hello`, on the user's machine, before Claude reads anything. Swap `echo hello` for anything and it still runs.

## Good example

```markdown
---
name: pr-summary
description: Summarise a pull request. Use when asked about a PR by number.
---
Summarise pull request $ARGUMENTS. Run `gh pr diff <number>` yourself after checking it is a number.
```

## How to fix

Keep arguments out of `!` commands. Give the argument to Claude in the text and let it run the command through the normal permission prompt. If the command has to run at load time, call a script in the skill folder that checks the value (a number, a known branch name) before it uses it.

## Suppress or configure

`sec-skill-arg-injection` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-skill-arg-injection": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-skill-arg-injection.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
