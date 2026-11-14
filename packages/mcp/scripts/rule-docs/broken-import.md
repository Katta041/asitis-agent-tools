## Catches
An `@path` import in a CLAUDE.md, a `.claude/rules/` file, a GEMINI.md, or an AGENTS.md that Claude Code reads directly, where the file does not exist. The import is silent: Claude Code and Gemini CLI load what they can find and say nothing about the rest. A token that looks like an npm package (`@scope/name`, one slash, no extension) is a note with a hint, because it is far more often a package name than a file, and in a heading (`# @scope/name`) it is not reported at all. An `@name` inside double quotes (`"Thanks @user"`) is a mention, not an import.

Also reported:

- An import whose file exists but which still loads nothing. Claude Code and Gemini CLI take the whole word after `@`, punctuation included, so `See @guide.md: for details` asks for a file named `guide.md:`. The same goes for `@guide.md.` at the end of a sentence, `(see @guide.md)`, and `(@guide.md)`, where the `@` does not follow a space. Bold (`**@guide.md**`) and a `#section` anchor are fine in Claude Code.
- A broken import inside an imported file, reported on the import that starts the chain (`"@docs/a.md -> @b.md -> @missing.md"`). Claude Code follows imports 4 hops deep and Gemini CLI 5, so a file further down is reported as not loaded unless a shorter chain reaches it.

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
