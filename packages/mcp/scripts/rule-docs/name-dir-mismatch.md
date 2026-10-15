## Catches
A `SKILL.md` whose `name` differs from the folder it sits in.

## Bad
```text
.claude/skills/changelog/SKILL.md
```
```markdown
---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog.
---
```
The Agent Skills spec says the name must match the parent directory. Claude Code keys skills by folder, so `/changelog` invokes it, while a user who read the file tries `/release-notes` and gets nothing. Validators report the mismatch.

## Good
```text
.claude/skills/release-notes/SKILL.md
```
```markdown
---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog.
---
```

## Fix
Rename one side. If the folder name is the one people already type, change `name` to match it; the suggested fix does exactly that. Otherwise `git mv` the folder.
