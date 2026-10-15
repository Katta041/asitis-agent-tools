# sec-skill-binary

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

Executable binary inside a skill folder.

An executable binary (ELF, Mach-O or PE, recognised by the first four bytes) inside a skill folder. Needs `--include skills`.

## Why it matters

A binary cannot be reviewed as text. Only the first 4 bytes are read, to detect ELF, Mach-O, PE and WebAssembly headers, including binaries named like text files.

## Bad example

```text
.claude/skills/image-tools/
  SKILL.md
  scripts/convert        # Mach-O 64-bit executable, 2.1 MB
```
`SKILL.md` says "run scripts/convert on the file". Nobody can read what the binary does, and it is committed as if it were a script.

## Good example

```text
.claude/skills/image-tools/
  SKILL.md
  scripts/convert.py     # 60 lines, calls Pillow
```

## How to fix

Replace the binary with source, or with an install step for a published package pinned to a version. If a binary is unavoidable, keep it out of the skill folder, document where it comes from, and record its hash in `SKILL.md`.

## Suppress or configure

`sec-skill-binary` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-skill-binary": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Snyk: ToxicSkills, malicious AI agent skills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-skill-binary.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
