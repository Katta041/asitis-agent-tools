# context-cost

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | note | one file | no | yes |

## What it catches

Over 5,000 tokens load every session from this file.

A file that loads at the start of every session (a root CLAUDE.md, `.claude/rules/*.md` without `paths`, `.cursorrules`, `.github/copilot-instructions.md` and similar) with more than about 5,000 tokens in it. It is a note, not a warning: the file may be worth it. The point is that the cost is paid in every conversation, including ones that never touch the subject.

## Why it matters

Everything in an every-session file is paid for in every conversation, and long instruction files are followed less reliably.

## Bad example

```markdown
# CLAUDE.md

## API reference
<full endpoint-by-endpoint description of the REST API, 6,000 tokens>
```
Every session starts 6,000 tokens shorter, and the docs on which this rule rests say long instruction files are followed less reliably.

## Good example

```markdown
# CLAUDE.md

The REST API is described in [docs/api.md](docs/api.md); read it before changing a handler.
```

## How to fix

Keep rules in the every-session file and move reference material behind a link, so the agent reads it when it needs it. Path-scoped rules (`.claude/rules/` with `paths`, Cursor `globs`, Copilot `applyTo`) load only for matching files.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line context-cost -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file context-cost -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "context-cost": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/context-cost.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
