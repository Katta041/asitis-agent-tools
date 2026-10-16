# compatibility-too-long

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

compatibility is longer than 500 characters.

A `compatibility` value over 500 characters. The Agent Skills spec allows 1 to 500.

## Why it matters

The spec allows 1 to 500 characters for compatibility.

## Bad example

```markdown
---
name: ios-build
description: Build and sign the iOS app. Use when asked for a TestFlight build.
compatibility: Requires macOS 15 or later with Xcode 16.2 installed at /Applications/Xcode.app, the command line tools selected with xcode-select, a valid Apple Developer account logged in, fastlane 2.228 installed through Homebrew, Ruby 3.3 via rbenv, ... (620 characters)
---
```

## Good example

```markdown
---
name: ios-build
description: Build and sign the iOS app. Use when asked for a TestFlight build.
compatibility: Requires macOS 15, Xcode 16.2 and fastlane. See SETUP.md for the full environment.
---
```

## How to fix

Name the hard requirements in one line and link a setup file for the rest. Most skills do not need `compatibility` at all.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line compatibility-too-long -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file compatibility-too-long -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "compatibility-too-long": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/compatibility-too-long.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
