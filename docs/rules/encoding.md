# encoding

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

File is not UTF-8.

A file that is not UTF-8: UTF-16 with or without a byte order mark is the usual case. The message names the encoding found.

## Why it matters

Most agent tools expect UTF-8 steering files and may misread UTF-16.

## Bad example

```text
$ xxd CLAUDE.md | head -2
00000000: fffe 2300 2000 5000 7200 6f00 6a00 6500  ..#. .P.r.o.j.e
00000010: 6300 7400 0d00 0a00 0d00 0a00 2d00 2000  c.t.........-. .
```
Windows PowerShell 5 writes UTF-16LE by default (`"..." > CLAUDE.md`), so the file reads fine in Notepad. Agent tools read it as UTF-8 and see a NUL byte after every character, which most of them treat as binary.

## Good example

```text
$ xxd CLAUDE.md | head -1
00000000: 2320 5072 6f6a 6563 740a 0a2d 2052 756e  # Project..- Run
```

## How to fix

Convert once: `iconv -f UTF-16 -t UTF-8 CLAUDE.md > tmp && mv tmp CLAUDE.md`, or in VS Code pick "Save with Encoding" and "UTF-8". In PowerShell write files with `Set-Content -Encoding utf8` or `Out-File -Encoding utf8` so it does not come back.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line encoding -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file encoding -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "encoding": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[RFC 3629: UTF-8](https://www.rfc-editor.org/rfc/rfc3629), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/encoding.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
