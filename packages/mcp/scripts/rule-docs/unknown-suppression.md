## Catches
An `asitis-disable` comment that names a rule id not in the registry, or one that is still planned. Nothing is suppressed, and the finding the comment was meant for stays.

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
Copy the id from the finding you are suppressing; the [index](README.md) lists every active rule. A rule id is required: there is no comment that disables everything.
