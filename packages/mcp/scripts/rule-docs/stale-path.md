## Catches
A repo path in backticks, such as `` `src/api/routes.ts` `` or `` `packages/web/` ``, that does not exist. Only CLAUDE.md, AGENTS.md, GEMINI.md, rules, Copilot instructions and the project's own skills, commands and agents (under `.claude/`, `.github/`, `.agents/` and similar) are checked. A path counts only when it has two or more parts, ends in a file extension or a slash, and its first folder exists next to the file or at the repository root, in the same letter case. The path is looked up from the file's folder and from the root, and anywhere else in the repository with the same ending, since a nested file often writes paths relative to its package.

On by default, and it reads no file besides the steering file: it only checks whether paths exist and lists folders. With `--include config` (or `include: ["config"]`) it also reads `.gitignore` files and skips any path they cover. Without it, paths under folders such as `results/`, `output/`, `tmp/` and `logs/` are skipped instead, since those usually hold ignored run output.

Not reported: paths in fenced code blocks, globs, URLs, placeholders (`<name>`, `{id}`, `$DIR`, `...`, `path/to/x`, `your-app/`), home and absolute paths, `node_modules`, build output folders, dot folders other than `.github` (tool state such as `.claude/worktrees/`), git submodules, a folder that became a module (`src/handlers/` when `src/handlers.py` exists), and link text (`broken-link` checks the target). Lines that talk about creating, moving or removing files, sections headed Example or Template, and paragraphs that name another repository (`` `acme/sdk` ``, a github.com link, "the charts repo") are skipped too, because their paths are often somewhere else.

## Bad
```markdown
## Layout

- API routes live in `src/server/routes/`.
- Shared types: `src/types/api.ts`.
```
The routes moved to `src/api/` and `src/types/api.ts` was split up two months ago. An agent asked to add an endpoint opens the old folder, finds nothing, and either guesses where routes go or creates `src/server/routes/` again.

## Good
```markdown
## Layout

- API routes live in `src/api/`.
- Shared types: `src/types/` (one file per resource).
```
Both paths exist. A path you mean as an example can go in a fenced block or under an "Example" heading.

## Fix
Update the path to where the file or folder is now, or remove the line if it no longer applies. If the path is created at run time, say so on the same line ("created by `make setup`"), or add it to `.gitignore` and lint with `--include config`.
