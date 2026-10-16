# unsafe-path

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

File path contains control, bidi or invisible characters.

A file name or folder name that contains control characters, bidirectional controls or invisible characters. The message shows the path with those characters escaped.

## Why it matters

A path that displays differently from how it is stored can disguise which file an agent loads.

## Bad example

```text
$ ls .claude/rules | cat -A
security.md$
securM-bM-^@M-^Kity.md$
```
Two files that both display as `security.md`; the second has a zero-width space inside the name. A reviewer sees one rules file. Claude Code loads both, and the second can say anything.

## Good example

```text
$ ls .claude/rules | cat -A
security.md$
```

## How to fix

Rename the file to plain ASCII: `git mv ".claude/rules/$(printf 'secur​ity.md')" .claude/rules/security-2.md`, then decide whether its contents belong anywhere. `ls | cat -A` or `find . -name '*[^ -~]*'` lists names with non-ASCII bytes.

## Suppress or configure

`unsafe-path` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "unsafe-path": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Trojan Source (Boucher and Anderson)](https://trojansource.codes/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/unsafe-path.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
