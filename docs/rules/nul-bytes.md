# nul-bytes

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

File contains NUL bytes.

One or more `00` bytes in the file. Text never contains NUL; it shows up when a binary is misnamed `.md`, when a UTF-16 file is read as UTF-8, or when a crash or a bad merge left padding behind.

## Why it matters

A NUL byte usually means a binary or wrongly encoded file, and many tools stop reading at it.

## Bad example

```text
$ xxd .cursorrules | tail -2
00000a40: 2074 6865 2074 6573 7473 2e0a 0000 0000   the tests.......
00000a50: 0000 0000 0000 0000 0000 0000 0000 0000  ................
```
An editor crash truncated the file and the filesystem filled the rest with zeros. Many tools stop reading at the first NUL; some refuse the file as binary.

## Good example

```text
$ xxd .cursorrules | tail -1
00000a40: 2074 6865 2074 6573 7473 2e0a             the tests..
```

## How to fix

Check what the file is with `file CLAUDE.md`. If it is UTF-16, see [encoding](encoding.md). If it is text with trailing zeros, restore it from git (`git checkout -- CLAUDE.md`) or delete the padding and re-save.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line nul-bytes -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file nul-bytes -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "nul-bytes": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[git docs: gitattributes](https://git-scm.com/docs/gitattributes), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/nul-bytes.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
