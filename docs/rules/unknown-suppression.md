# unknown-suppression

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| config | warning | one file | no | yes |

## What it catches

asitis-disable names a rule that does not exist, or no rule at all.

An `asitis-disable` comment that names a rule id not in the registry, or one that is still planned. Nothing is suppressed, and the finding the comment was meant for stays.

## Why it matters

A typo in the rule id means nothing is suppressed, and a comment without a rule id would otherwise silence everything.

## Bad example

```markdown
<!-- asitis-disable-next-line duplicate-rules -- the two paths are alternatives -->
- Run `make release` after tagging.
```
The id is `duplicate-rule`, singular. The duplicate finding is still reported and this warning joins it.

## Good example

```markdown
<!-- asitis-disable-next-line duplicate-rule -- the two paths are alternatives -->
- Run `make release` after tagging.
```

## How to fix

Copy the id from the finding you are suppressing; the [index](README.md) lists every active rule. A rule id is required: there is no comment that disables everything.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line unknown-suppression -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file unknown-suppression -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "unknown-suppression": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[asitis CLI contract: Suppression](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/cli-contract.md#suppression), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/unknown-suppression.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
