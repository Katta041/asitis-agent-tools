# stale-path

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

A path in backticks names a file or folder that is not in the repository.

A repo path in backticks, such as `` `src/api/routes.ts` `` or `` `packages/web/` ``, that does not exist. Only CLAUDE.md, AGENTS.md, GEMINI.md, rules, Copilot instructions (scoped ones only under `.github/`) and the project's own skills, commands and agents (under `.claude/`, `.github/`, `.agents/` and similar) are checked. A path counts only when it has two or more parts, ends in a file extension or a slash, and its first folder exists next to the file or at the repository root, in the same letter case. The path is looked up from the file's folder and from the root, and anywhere else in the repository with the same ending, since a nested file often writes paths relative to its package.

On by default, and it reads no file besides the steering file: it only checks whether paths exist and lists folders. With `--include config` (or `include: ["config"]`) it also reads `.gitignore` files and skips any path they cover. Either way, paths under folders such as `results/`, `output/`, `tmp/`, `logs/` and `screenshots/` are skipped, since those usually hold run output, and so are per-developer files such as `conf/custom.ini`, `settings.local.json` or `credentials.json`.

Not reported: paths in fenced code blocks, globs, URLs, placeholders (`<name>`, `{id}`, `$DIR`, `...`, `path/to/x`, `your-app/`, `YYYY-MM-DD-topic.md`, `thread-N.md`, `ComponentName/`), home and absolute paths, `node_modules`, build output folders, dot folders other than `.github` at any depth (tool state such as `.claude/worktrees/` or `bench/.results/`), gh-aw's `.github/aw/` prompts and `.github/copilot-instructions.md` (often listed as a file tools look for), git submodules, a folder that became a module (`src/handlers/` when `src/handlers.py` exists), and link text (`broken-link` checks the target). Lines that talk about creating, moving or removing files, or say a path may not be there ("if it exists", "is gone"), lines after a "For example:" lead-in, sections headed Example or Template (and their subsections, also in Chinese), sections that say their files come from elsewhere ("load these files from `owner/repo`", "not available locally", a package's docs under `node_modules/`), and paragraphs that name another repository (`` `acme/sdk` ``, a github.com link, "the charts repo") are skipped too, because their paths are often somewhere else.

## Why it matters

Agents follow the paths a steering file gives them. After a rename the agent looks in the old place, finds nothing and guesses, and the instruction quietly stops working.

## Bad example

```markdown
## Layout

- API routes live in `src/server/routes/`.
- Shared types: `src/types/api.ts`.
```
The routes moved to `src/api/` and `src/types/api.ts` was split up two months ago. An agent asked to add an endpoint opens the old folder, finds nothing, and either guesses where routes go or creates `src/server/routes/` again.

## Good example

```markdown
## Layout

- API routes live in `src/api/`.
- Shared types: `src/types/` (one file per resource).
```
Both paths exist. A path you mean as an example can go in a fenced block or under an "Example" heading.

## How to fix

Update the path to where the file or folder is now, or remove the line if it no longer applies. If the path is created at run time, say so on the same line ("created by `make setup`"), or add it to `.gitignore` and lint with `--include config`.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line stale-path -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file stale-path -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "stale-path": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 16 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/stale-path.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
