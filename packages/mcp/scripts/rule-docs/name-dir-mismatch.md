## Catches
A `SKILL.md` whose `name` differs from the folder it sits in. Only skills that sit directly in a skills folder (`.claude/skills/x/SKILL.md`, `skills/x/SKILL.md`) or at the top of the root are checked: a SKILL.md nested inside another skill's folder (the stages of a pipeline) is often prefixed on purpose, and a `template/` folder is meant to be copied and renamed. SKILL.md files under tests, fixtures or testdata folders are not checked by any skill format rule.

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
