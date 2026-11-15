# nested-duplicate

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | note | several files or the folder layout | no | yes |

## What it catches

A subfolder instruction file repeats rules from the file above it.

A subfolder `CLAUDE.md`, `AGENTS.md` or `GEMINI.md` that repeats rules from the same kind of file in a folder above it. The agent loads both when it works in the subfolder, so the shared rules cost context twice, and the two copies drift apart the first time someone edits one. Needs at least two shared rules of 24 characters or more. When many subfolders copy the same file, you get one note that lists them.

## Why it matters

Subfolder CLAUDE.md, AGENTS.md and GEMINI.md files load together with the ones above them, so repeated rules cost context twice and drift apart over time. Needs at least two shared rules of 24 characters or more.

## Bad example

```text
CLAUDE.md                - Run tests with pnpm test before you commit
                         - Never commit generated files under dist/
packages/api/CLAUDE.md   - Run tests with pnpm test before you commit
                         - Never commit generated files under dist/
                         - API handlers live in src/routes/
```

## Good example

```text
CLAUDE.md                - Run tests with pnpm test before you commit
                         - Never commit generated files under dist/
packages/api/CLAUDE.md   - API handlers live in src/routes/
```

## How to fix

Keep shared rules in the top file and only folder-specific ones in the subfolder file.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line nested-duplicate -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file nested-duplicate -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "nested-duplicate": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/nested-duplicate.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
