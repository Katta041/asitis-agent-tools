# duplicate-rule

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning | one file | no | yes |

## What it catches

The same rule appears twice in one file.

The same instruction written twice in one file. Comparison ignores case, list markers, emphasis, backticks and a leading "a", "an" or "the", and joins wrapped lines first, so a rule and its rewrap still match. Short labels that repeat as structure ("Checklist") and bold labels are not counted. A copy under a different heading is reported with a note that the two sections may be alternatives.

## Why it matters

Duplicates cost context and drift apart when only one copy is edited.

## Bad example

```markdown
## Workflow

- Run `npm test` before every commit.
- Keep commit messages under 72 characters.

## Before you push

- Run `npm test` before every commit.
- Rebase on main.
```
Line 3 and line 8 are the same rule. Both cost context, and when the team changes the command to `npm run test:ci` they will change one of them.

## Good example

```markdown
## Workflow

- Run `npm test` before every commit.
- Keep commit messages under 72 characters.
- Rebase on main before you push.
```

## How to fix

Delete one copy. If the two sections describe alternatives that never apply together (a release path and a hotfix path, each listing the same step), suppress the finding with a comment that says so.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line duplicate-rule -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file duplicate-rule -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "duplicate-rule": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/duplicate-rule.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
