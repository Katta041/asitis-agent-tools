## Catches
The same instruction written twice in one file. Comparison ignores case, list markers, emphasis, backticks and a leading "a", "an" or "the", and joins wrapped lines first, so a rule and its rewrap still match. Short labels that repeat as structure ("Checklist") and bold labels are not counted. A copy under a different heading is reported with a note that the two sections may be alternatives.

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
