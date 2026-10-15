# sec-permission-mode

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

Settings turn on bypassPermissions or skip its confirmation.

`permissions.defaultMode` set to `bypassPermissions` in a project settings file. Needs `--include config`.

## Why it matters

bypassPermissions runs every tool without asking. Since Claude Code 2.1.257 it has no effect from project or local settings, but older versions honored it, and the line shows what the author wanted.

## Bad example

```json
{ "permissions": { "defaultMode": "bypassPermissions" } }
```
Claude Code ignores this in project settings (the mode cannot be set from a file others commit), so it does nothing today. It still tells a reviewer that somebody wanted prompts off for the whole project, and a future version or another tool reading the file may honour it.

## Good example

```json
{ "permissions": { "defaultMode": "acceptEdits" } }
```

## How to fix

Remove the line or choose a mode that keeps command prompts. For unattended runs use a disposable environment and the CLI flag there, not the shared settings file.

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
