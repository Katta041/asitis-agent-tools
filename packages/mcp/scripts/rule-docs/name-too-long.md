## Catches
A skill `name` over 64 characters. The Agent Skills spec sets the limit and validators reject longer names.

## Bad
```markdown
---
name: generate-release-notes-from-conventional-commits-and-merged-pull-requests
description: Draft release notes. Use when asked for a changelog or a release summary.
---
```
That name is 77 characters. `skills-ref validate` fails, and clients that enforce the spec will not load the skill.

## Good
```markdown
---
name: release-notes
description: Draft release notes from conventional commits and merged pull requests. Use when asked for a changelog or a release summary.
---
```

## Fix
Shorten the name to the two or three words a user would say, and rename the folder to match. Put the long form in `description`, where it helps the agent choose the skill.
