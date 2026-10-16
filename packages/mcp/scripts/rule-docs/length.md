## Catches
A steering file longer than the tool that reads it recommends or loads. The thresholds come from the vendor docs: CLAUDE.md over 200 lines, SKILL.md over 500 lines, a Cursor rule over 500 lines, AGENTS.md over 32 KiB (Codex's `project_doc_max_bytes`, shared by every AGENTS.md from the root down), a Windsurf rule over 12,000 characters, and MEMORY.md past 200 lines or 25 KB. The message says which limit applies and what the tool does past it.

A CLAUDE.md of 201 to 300 lines is a note; the warning starts above 300, since 200 is a soft target. A SKILL.md that is also over the token guideline is reported once, by [body-tokens](body-tokens.md), with both counts. A CLAUDE.md or AGENTS.md in a template, example, fixture or temp folder, or inside a skill, is skipped: it belongs to a sample project or to the skill's reference material, not to the project being linted.

## Bad
```markdown
# CLAUDE.md

## Build and test
...

## Frontend conventions (src/web)
...120 lines about React, CSS modules and Storybook...

## Backend conventions (src/api)
...110 lines about handlers, migrations and OpenAPI...

## Infra (infra/)
...60 lines about Terraform modules...
```
340 lines, all loaded into every session, including the 120 lines about React when Claude is editing a Terraform module. Claude Code's docs say longer files reduce adherence, and the per-area sections are exactly what they suggest moving out.

## Good
```markdown
# CLAUDE.md

## Build and test
...40 lines that apply everywhere...
```
```markdown
<!-- .claude/rules/frontend.md -->
---
paths:
  - src/web/**
---
# Frontend conventions
...
```
The root file is short, and the React rules load only when Claude works on a file under `src/web/`.

## Fix
For CLAUDE.md, move the parts that matter for one area into `.claude/rules/<area>.md` with a `paths` list. Imports (`@docs/x.md`) organise text but do not reduce the cost, because imported files load too. For SKILL.md, move reference tables and long examples into files next to it and link them. For AGENTS.md, shorten it or link to docs: nested AGENTS.md files share the same 32 KiB budget and are dropped first. For MEMORY.md, keep one line per entry and move detail into topic files.
