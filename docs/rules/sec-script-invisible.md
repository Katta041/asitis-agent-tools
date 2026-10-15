# sec-script-invisible

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

Invisible or bidirectional characters in a skill script.

Characters in a skill script that do not show up in an editor or a diff: bidirectional controls (U+202A to U+202E, U+2066 to U+2069), zero-width characters, Unicode tag characters and runs of variation selectors. Needs `--include skills`.

## Why it matters

Bidi controls make code read differently than it runs (Trojan Source); variation selectors and tag characters carry hidden payloads (Glassworm).

## Bad example

```javascript
// scripts/check.js, shown as GitHub renders it
const isAdmin = false;
/* end admin check */ if (isAdmin) { console.log("hello"); }
```
The file holds a right-to-left override inside the comment. The line runs differently from how it reads (Trojan Source). A run of variation selectors after a normal character can carry a whole payload that a loader decodes (Glassworm).

## Good example

```javascript
// scripts/check.js
const isAdmin = false;
if (isAdmin) { console.log("hello"); }
```

## How to fix

Delete the characters. `grep -nP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FE00}-\x{FE0F}\x{E0000}-\x{E007F}]' scripts/*` shows where they are. If the script has to print such a character, write it as an escape (`"‮"`) so it is visible.

## Suppress or configure

`sec-script-invisible` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-script-invisible": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[www.aikido.dev](https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-script-invisible.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
