## Catches
An `asitis-disable-next-line` or `asitis-disable-file` comment that matched no finding. It is a note: the comment is harmless, but it is now a hidden comment with no purpose.

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
Delete the comment. If you expected a finding here and there is none, the rule may now be off in `.asitisrc.json` or covered by the baseline.
