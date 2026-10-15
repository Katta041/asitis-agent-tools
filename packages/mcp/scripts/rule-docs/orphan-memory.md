## Catches
A memory topic file in a folder with a `MEMORY.md` that does not link to it. Claude Code loads the index at session start and reads topic files only by following links from it, so an unlinked file is never read. Only runs when the whole folder is linted.

## Bad
```text
memory/
  MEMORY.md
  debugging.md
```
```markdown
<!-- MEMORY.md -->
# Memory index

- [Release process](release.md): tags, changelog, npm publish steps
```
`debugging.md` holds the notes about the flaky integration test, and nothing points at it.

## Good
```markdown
# Memory index

- [Release process](release.md): tags, changelog, npm publish steps
- [Debugging notes](debugging.md): the flaky integration test and how to reproduce it
```

## Fix
Add one line to `MEMORY.md` with a link to the file and a few words on when it matters, or delete the file if the notes are stale.
