## Catches
Two files that are meant to say the same thing (AGENTS.md and CLAUDE.md, say) and mostly do, but one has rules the other lacks. The check stays silent for files that are not alike enough to be mirrors, so unrelated documents do not alert. Only runs when the whole folder is linted.

## Bad
```markdown
<!-- AGENTS.md: 41 rules -->
...
- Run `pnpm lint` before opening a PR.
```
```markdown
<!-- CLAUDE.md: the same 40 rules, copied in March -->
...
```
The lint rule was added to AGENTS.md in June. Claude Code users never got it.

## Good
```markdown
<!-- CLAUDE.md -->
@AGENTS.md
```
One file, imported by the other, cannot drift.

## Fix
Replace the copy with an `@AGENTS.md` import, a symlink, or a generator such as rulesync that writes every variant from one source. If both files must exist separately, copy the missing rules across now and pick which file is the source for next time.
