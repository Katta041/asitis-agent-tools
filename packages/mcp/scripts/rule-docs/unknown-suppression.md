## Catches
An `asitis-disable` comment that names a rule id not in the registry, one that is still planned, or one of the three suppression rules (which a comment cannot turn off). Also a comment with no rule id at all, and a directive that does not exist, such as `asitis-disable-line`. Nothing is suppressed, and the finding the comment was meant for stays. When the id is close to a real one, the message suggests it.

## Bad
```markdown
<!-- asitis-disable-next-line duplicate-rules -- the two paths are alternatives -->
- Run `make release` after tagging.
```
The id is `duplicate-rule`, singular. The duplicate finding is still reported and this warning joins it.

## Good
```markdown
<!-- asitis-disable-next-line duplicate-rule -- the two paths are alternatives -->
- Run `make release` after tagging.
```

## Fix
Fix the rule id or delete the comment. Copy the id from the finding you are suppressing; the [index](README.md) lists every active rule. The directives are `asitis-disable-next-line` and `asitis-disable-file`, and a rule id is required: there is no comment that disables everything.
