# frontmatter-bom

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

A byte order mark comes before the frontmatter.

The three bytes `EF BB BF` (a UTF-8 byte order mark) before the opening `---`. Windows Notepad, PowerShell's `Out-File` and some IDE exports add it. Editors hide it, so the file looks right.

## Why it matters

Some parsers do not skip a UTF-8 BOM, so the opening --- is not recognised and the frontmatter is read as text.

## Bad example

```text
$ head -c 8 SKILL.md | xxd
00000000: efbb bf2d 2d2d 0a6e                      ...---.n
```
The file starts with the BOM, then `---`. A parser that compares the first three characters to `---` sees the BOM instead and reads the whole frontmatter as text.

## Good example

```text
$ head -c 8 SKILL.md | xxd
00000000: 2d2d 2d0a 6e61 6d65                      ---.name
```

## How to fix

Save the file as UTF-8 without BOM. In VS Code, click the encoding in the status bar, choose "Save with Encoding", then "UTF-8". On the command line: `sed -i '1s/^\xEF\xBB\xBF//' SKILL.md` (GNU sed) or `tail -c +4 SKILL.md > tmp && mv tmp SKILL.md`. To stop it coming back from PowerShell, write files with `Set-Content -Encoding utf8NoBOM` (PowerShell 7) rather than `Out-File`.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-bom -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-bom -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-bom": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[RFC 3629: UTF-8](https://www.rfc-editor.org/rfc/rfc3629), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-bom.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
