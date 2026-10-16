## Catches
The same instruction written twice in one file. Comparison ignores case, list markers, emphasis, backticks and a leading "a", "an" or "the", and joins wrapped lines first, so a rule and its rewrap still match. Short labels that repeat as structure ("Checklist"), bold labels and template lines that are mostly placeholders ("- [Finding] -> [why]") are not counted, and a paragraph gives at most one finding.

Where the two copies sit decides what is reported. In one section, or in a block of text copied from a section with the same heading, it is a warning. Under two unrelated headings it is a note, because a summary section and its detail often repeat a rule on purpose. Under parallel sibling headings or labels (Regular posts and Video posts, Phase 1 and Phase 3, "If using artifacts" and "If using a file") it is not reported: two procedures share steps by design. An AGENTS.md inside a skill, template or example folder is reference material and is not checked.

## Bad
```markdown
## Workflow

- Run `npm test` before every commit.
- Keep commit messages under 72 characters.

## Before you push

- Run `npm test` before every commit.
- Rebase on main.
```
Line 3 and line 8 are the same rule. Both cost context, and when the team changes the command to `npm run test:ci` they will change one of them.

## Good
```markdown
## Workflow

- Run `npm test` before every commit.
- Keep commit messages under 72 characters.
- Rebase on main before you push.
```

## Fix
Delete one copy. If the two sections describe alternatives that never apply together (a release path and a hotfix path, each listing the same step), suppress the finding with a comment that says so.
