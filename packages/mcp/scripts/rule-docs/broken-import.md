## Catches
An `@path` import in a CLAUDE.md, a `.claude/rules/` file, a GEMINI.md, or an AGENTS.md that Claude Code reads directly, where the file does not exist. The import is silent: Claude Code and Gemini CLI load what they can find and say nothing about the rest. A token that looks like an npm package (`@scope/name`, one slash, no extension) is a note with a hint, because it is far more often a package name than a file.

## Bad
```markdown
@AGENTS.md
@docs/conventions.md
@docs/missing-guide.md
```
`docs/missing-guide.md` was renamed to `docs/contributing.md` last quarter. The team believes the contributing rules are loaded in every session; they have not been since the rename.

## Good
```markdown
@AGENTS.md
@docs/conventions.md
@docs/contributing.md

We use `@tanstack/query` for data fetching.
```
The package name is in backticks, so it is not read as an import.

## Fix
Correct the path (relative to the file that contains the import) or remove the line. Wrap package names and handles in backticks when they start a line.
