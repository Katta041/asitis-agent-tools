# skill-listing-budget

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| budget | note | several files or the folder layout | no | yes |

## What it catches

Skill descriptions that load together are longer than Claude Code's skill listing budget.

A set of skills Claude Code lists together whose names and descriptions add up to more than about 8,000 characters. A set is a `.claude` folder (its `skills/` and `commands/`) or a plugin folder with `.claude-plugin/plugin.json` and a `skills/` folder. Each entry counts its name plus `description` and `when_to_use`, cut at 1,536 characters as Claude Code cuts them. Skills with `disable-model-invocation: true` are not counted: their description is not in context. Only whole-folder runs report it, since every skill in the set has to be seen. Skill folders for other agents (`.gemini/skills`, `.agents/skills`) are not counted.

## Why it matters

Claude Code fits skill names and descriptions into 1% of the context window (skillListingBudgetFraction 0.01; 8,000 characters is the documented fallback). Over the budget it keeps every name but drops the descriptions of the least-used skills, so Claude stops choosing them on its own.

## Bad example

```text
.claude/skills/  87 skills, 21,260 characters of names and descriptions
```
Claude Code keeps every name but drops the descriptions of the skills you use least, so Claude stops choosing them on its own even when a request matches.

## Good example

```text
.claude/skills/  40 skills, 7,400 characters; release and deploy skills set disable-model-invocation: true
```

## How to fix

Shorten long descriptions (the message names the longest), remove skills you no longer use, and set `disable-model-invocation: true` on skills you only run by hand with `/name`. With a 1M context window the budget is about five times larger; set `budgetChars` to match what your team runs, for example `{ "rules": { "skill-listing-budget": ["note", { "budgetChars": 40000 }] } }`. `maxDescChars` matches Claude Code's `skillListingMaxDescChars` (default 1,536).

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line skill-listing-budget -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file skill-listing-budget -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "skill-listing-budget": "off" } }
```

`skill-listing-budget` also takes options, set under `rules` (they apply to the whole project, not per `overrides` entry):

```json
{ "rules": { "skill-listing-budget": ["note", { "budgetChars": 40000 }] } }
```

The options are `budgetChars` and `maxDescChars`.

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 15 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/skill-listing-budget.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
