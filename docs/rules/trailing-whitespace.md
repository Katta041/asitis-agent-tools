# trailing-whitespace

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | safe | yes |

## What it catches

Lines end in spaces or tabs that change nothing when rendered.

Lines that end in spaces or tabs that do nothing when the markdown is rendered. Exactly two spaces (a hard line break), lines in code blocks and frontmatter are left alone. The finding points at the first such line and counts the rest. It is a note.

## Why it matters

Trailing spaces and tabs are invisible and do nothing outside a hard line break, but editors that trim them on save turn them into diff noise. Two spaces that may be a hard line break, code and frontmatter are left alone.

## Bad example

```text
Run the tests before you commit.···
Use pnpm, not npm.→
```
(`·` is a space, `→` a tab.) Nobody sees them, and the next editor that trims on save turns a one-line change into a diff of every line that had them.

## Good example

```text
Run the tests before you commit.
Use pnpm, not npm.
```

## How to fix

Delete the trailing spaces and tabs. `asitis lint --fix-preview=safe` prints a diff that does only that, and `git apply` takes it. Most editors can trim trailing whitespace on save for markdown files.

asitis can make this edit for you. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule is marked safe: it does not change what the file says.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line trailing-whitespace -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file trailing-whitespace -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "trailing-whitespace": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[spec.commonmark.org](https://spec.commonmark.org/0.31.2/#hard-line-breaks), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/trailing-whitespace.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
