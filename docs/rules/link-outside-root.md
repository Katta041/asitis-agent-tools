# link-outside-root

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | no | yes |

## What it catches

Link points outside the project and was not checked.

A relative link that resolves outside the folder asitis was allowed to read, so it could not be checked. It is a note: the link may be fine.

## Why it matters

Files outside the allowed folder are never read, so the link cannot be checked.

## Bad example

```markdown
Follow the [company style guide](../../standards/STYLE.md).
```
The target is two folders above the repository. asitis never reads outside its root, so it cannot say whether the file exists. For an agent working in a clone, or in CI, the file is usually not there either.

## Good example

```markdown
Follow the [company style guide](docs/STYLE.md) (copied from the standards repo, 2026-09).
```

## How to fix

Vendor the file into the repository, or link to a URL everyone can reach. If the layout is a monorepo and the file is always present, run asitis with a `--root` that contains both so the link is checked.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line link-outside-root -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file link-outside-root -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "link-outside-root": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/link-outside-root.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
