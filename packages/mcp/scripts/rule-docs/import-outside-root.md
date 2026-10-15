## Catches
An `@path` import that reaches outside the project: a home-folder path such as `@~/.claude/prefs.md`, or a relative path that climbs above the root.

## Bad
```markdown
# CLAUDE.md

@~/.claude/my-preferences.md
```
Claude Code treats an import outside the working directory as external and shows an approval dialog the first time; if the person declines, the import stays off. Teammates do not have the file at all, so the project instructions differ from one machine to the next.

## Good
```markdown
# CLAUDE.md

@docs/conventions.md
```
Personal preferences go in `~/.claude/CLAUDE.md`, which loads for every project without a dialog, or in `CLAUDE.local.md`, which is gitignored.

## Fix
Move the imported content into the repository, or move the import to a user-scope file (`~/.claude/CLAUDE.md`, `~/.claude/rules/`) where external imports are trusted as your own configuration.
