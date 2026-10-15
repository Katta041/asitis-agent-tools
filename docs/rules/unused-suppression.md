# unused-suppression

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| config | note | one file | no | yes |

## What it catches

asitis-disable comment suppresses nothing.

An `asitis-disable-next-line` or `asitis-disable-file` comment that matched no finding. It is a note: the comment is harmless, but it is now a hidden comment with no purpose.

## Why it matters

The finding it was for is gone, so the comment can go too.

## Bad example

```markdown
<!-- asitis-disable-next-line duplicate-rule -- release and hotfix paths both list this -->
- Rebase on main before you push.
```
The duplicate it covered was removed in a later edit. The comment stayed.

## Good example

```markdown
- Rebase on main before you push.
```

## How to fix

Delete the comment. If you expected a finding here and there is none, the rule may now be off in `.asitisrc.json` or covered by the baseline.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line unused-suppression -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file unused-suppression -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "unused-suppression": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[asitis CLI contract: Suppression](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/cli-contract.md#suppression), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/unused-suppression.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
