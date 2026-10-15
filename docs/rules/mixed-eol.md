# mixed-eol

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | no | yes |

## What it catches

File mixes CRLF, LF or CR line endings.

A file that uses more than one line ending: some lines end in CRLF, others in LF (or bare CR). The message gives the counts. It is a note: agents read the file fine. The problem is the next edit.

## Why it matters

Mixed endings are easy to normalise by accident in an edit, which turns a small change into a whole-file diff.

## Bad example

```text
$ file CLAUDE.md
CLAUDE.md: Unicode text, UTF-8 text, with CRLF, LF line terminators
```
One contributor on Windows pasted a section into a file that was LF. The next editor or formatter that normalises line endings turns a one-line change into a diff that touches every line, which hides the real change in review.

## Good example

```text
$ file CLAUDE.md
CLAUDE.md: Unicode text, UTF-8 text
```

## How to fix

Pick one ending for the repository. Add `* text=auto eol=lf` to `.gitattributes`, run `git add --renormalize .` and commit. Until then, edit minimal ranges so the existing endings stay as they are.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line mixed-eol -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file mixed-eol -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "mixed-eol": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[git docs: gitattributes](https://git-scm.com/docs/gitattributes), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/mixed-eol.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
