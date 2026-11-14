# skill-description-overlap

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note, varies (see below) | several files or the folder layout | no | yes |

Severity: a note; a warning when the descriptions are nearly the same (80% or more shared key words).

## What it catches

Two skills that load together have descriptions that share most of their key words.

Two skills in the same skills folder (`.claude/skills`, a plugin's `skills/`, or skill folders at the root) whose descriptions share most of their key words. Key words leave out stop words and plurals, and a word that appears in more than half of a large folder's descriptions is treated as house style. A pair is reported when it shares at least 6 key words and 55% of them (a warning from 80%), once per skill, against the earlier skill it overlaps most.

Pairs that are told apart on purpose are skipped: when one skill's name has a word its own description uses and the other skill never mentions (`mobile-android-design` and `mobile-ios-design`), or when the two do opposite things (enable and disable, add and remove). Skills nested inside another skill, skills with `disable-model-invocation: true` and non-English descriptions are skipped, and the same pair copied into `.claude/skills`, `.agents/skills` and `.gemini/skills` is reported once.

## Why it matters

Claude chooses one skill per request by comparing descriptions. When two say nearly the same thing, it can pick either, so one of them triggers at random or never. A note from 55% shared key words, a warning from 80%.

## Bad example

```markdown
.claude/skills/test-and-lint/SKILL.md
description: Run the test suite and lint and format checks the way CI does. Use before committing, or when tests or ruff fail.

.claude/skills/dev-check/SKILL.md
description: Run the local verification gate (ruff lint, ruff format check and pytest), the same checks CI enforces. Use before committing, or when asked to run the tests.
```
Asked to "run the checks", Claude can pick either one, so one of them never triggers reliably.

## Good example

Merge the two into one skill, or make each description say what only it does:

```markdown
.claude/skills/dev-check/SKILL.md
description: Run ruff and pytest the way CI does. Use before committing, or when asked to check, lint or test.

.claude/skills/release-check/SKILL.md
description: Build the wheel, check the changelog entry and dry-run the publish. Use when preparing a release.
```

## How to fix

Merge skills that do the same job. Otherwise put what sets each one apart in the first sentence of its description. The thresholds are options: `{ "rules": { "skill-description-overlap": ["note", { "notePercent": 60, "warnPercent": 85, "minSharedWords": 6, "maxSkills": 300 }] } }`. Folders with more than `maxSkills` skills are catalogs, not sets that load together, and are skipped with a notice.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line skill-description-overlap -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file skill-description-overlap -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "skill-description-overlap": "off" } }
```

`skill-description-overlap` also takes options, set under `rules` (they apply to the whole project, not per `overrides` entry):

```json
{ "rules": { "skill-description-overlap": ["note", { "notePercent": 60, "warnPercent": 85 }] } }
```

The options are `notePercent`, `warnPercent`, `minSharedWords` and `maxSkills`.

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude API docs: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), read on 15 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/skill-description-overlap.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
