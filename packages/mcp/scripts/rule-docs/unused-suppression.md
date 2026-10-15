## Catches
An `asitis-disable-next-line` or `asitis-disable-file` comment (or bare `asitis-disable`) for a rule that has no finding on the line after the comment, or anywhere in the file for the file form. A comment for a rule that `.asitisrc.json` turns off for that file is not reported. It is a note: the comment is harmless, but it is now a hidden comment with no purpose.

## Bad
```markdown
<!-- asitis-disable-next-line duplicate-rule -- release and hotfix paths both list this -->
- Rebase on main before you push.
```
The duplicate it covered was removed in a later edit. The comment stayed.

## Good
```markdown
- Rebase on main before you push.
```

## Fix
Delete the comment, or just the rule id in it if the comment names several. If you expected a finding here, check that the comment sits on the line directly above the one it covers: `asitis-disable-next-line` applies only to the line after the comment closes.
