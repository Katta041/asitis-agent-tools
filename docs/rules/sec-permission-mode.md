# sec-permission-mode

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

Settings turn on bypassPermissions or skip its confirmation.

`permissions.defaultMode` set to `bypassPermissions` in `.claude/settings.json`, or in `.claude/settings.local.json` with `--include config-local`. With `config-local` it also reports `skipDangerousModePermissionPrompt: true` in the local file. Needs `--include config`.

## Why it matters

bypassPermissions runs every tool without asking. Since Claude Code 2.1.257 it has no effect from project or local settings, but older versions honored it, and the line shows what the author wanted.

## Bad example

```json
{ "permissions": { "defaultMode": "bypassPermissions" } }
```
Claude Code 2.1.257 and later ignore this in project and local settings, but older versions honour it, so anyone on an older version runs every tool without a prompt. It also tells a reviewer that somebody wanted prompts off for the whole project.

## Good example

```json
{ "permissions": { "defaultMode": "acceptEdits" } }
```

## How to fix

Remove the line or choose a mode that keeps command prompts. For an unattended run, pass `--permission-mode` for that one session inside a disposable environment, not in the shared settings file.

## Suppress or configure

`sec-permission-mode` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-permission-mode": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Claude Code docs: Settings reference](https://code.claude.com/docs/en/settings-reference), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-permission-mode.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
