# final-newline

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | safe | yes |

## What it catches

File with line breaks does not end with one.

A file that has more than one line but does not end with a line break. It is a note.

## Why it matters

POSIX defines a line as ending with a newline. Text appended later with echo >> or by an agent joins the last line instead of starting a new one.

## Bad example

```text
$ tail -c 20 CLAUDE.md | od -c | tail -2
... u   s   e       p   n   p   m   .
```
`echo "Run the linter." >> CLAUDE.md` now produces `use pnpm.Run the linter.` on one line, and so does an agent that appends a rule the same way.

## Good example

```text
$ tail -c 1 CLAUDE.md | od -c
0000000  \n
```

## How to fix

Add a line break at the end, using the same line ending as the rest of the file. `asitis lint --fix-preview=safe` prints that diff. Most editors have an "insert final newline" setting.

asitis can make this edit for you. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule is marked safe: it does not change what the file says.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line final-newline -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file final-newline -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "final-newline": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap03.html), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/final-newline.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
