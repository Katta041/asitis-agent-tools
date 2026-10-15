# duplicate-rule

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | warning, varies (see below) | one file | no | yes |

Severity: warning in one section or a block copied under the same heading; a note under unrelated headings; nothing for parallel sibling sections.

## What it catches

The same rule appears twice in one file.

The same instruction written twice in one file. Comparison ignores case, list markers, emphasis, backticks and a leading "a", "an" or "the", and joins wrapped lines first, so a rule and its rewrap still match. Short labels that repeat as structure ("Checklist"), bold labels and template lines that are mostly placeholders ("- [Finding] -> [why]") are not counted, and a paragraph gives at most one finding.

Where the two copies sit decides what is reported. In one section, or in a block of text copied from a section with the same heading, it is a warning. Under two unrelated headings it is a note, because a summary section and its detail often repeat a rule on purpose. Under parallel sibling headings or labels (Regular posts and Video posts, Phase 1 and Phase 3, "If using artifacts" and "If using a file") it is not reported: two procedures share steps by design. An AGENTS.md inside a skill, template or example folder is reference material and is not checked.

## Why it matters

Duplicates cost context and drift apart when only one copy is edited. Two procedures or variants side by side (Regular posts and Video posts, Phase 1 and Phase 3) share steps on purpose, so those are not reported.

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
