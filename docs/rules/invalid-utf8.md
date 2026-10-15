# invalid-utf8

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

File contains invalid UTF-8 bytes.

Bytes that are not valid UTF-8 in a file that is otherwise UTF-8. The message gives the byte offset of the first bad sequence and the count. The usual cause is a file saved as Latin-1 or Windows-1252 that contains an accented letter, a curly quote or a dash.

## Why it matters

Tools that decode and save the file replace those bytes with U+FFFD, which silently changes it.

## Bad example

```text
$ grep -n -P '[^\x00-\x7F]' AGENTS.md | head -1
14:- Ask Ren� before changing the billing module.
```
The `é` in a name was written as the single byte `E9` by an editor set to Windows-1252. An agent that decodes the file as UTF-8 reads U+FFFD there, and a tool that re-saves it writes the replacement character back, so the name is now wrong in the repository.

## Good example

```text
14:- Ask René before changing the billing module.
```
Saved as UTF-8, `é` is the two bytes `C3 A9`.

## How to fix

Convert the file: `iconv -f WINDOWS-1252 -t UTF-8 AGENTS.md > tmp && mv tmp AGENTS.md`. Then set the editor's default encoding to UTF-8. If only one character is wrong, retype it.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line invalid-utf8 -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file invalid-utf8 -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "invalid-utf8": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[RFC 3629: UTF-8](https://www.rfc-editor.org/rfc/rfc3629), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/invalid-utf8.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
