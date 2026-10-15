## Catches
Two files that are meant to say the same thing (AGENTS.md and CLAUDE.md, say) and mostly do, but one has rules the other lacks. Each file of the pair gets one note, on its first rule the other file lacks, with a count and up to three examples. A pair that [agents-md-shadowed](agents-md-shadowed.md) already reports is skipped, since importing AGENTS.md fixes both. The files must sit in the same folder, and the check stays silent unless at least three rules match and the matching rules are at least half of all the rules in the two files, so unrelated documents do not alert. A pair where one file imports the other is skipped. Both files have to be in the same lint run: a whole-folder lint, or both passed as paths.

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
