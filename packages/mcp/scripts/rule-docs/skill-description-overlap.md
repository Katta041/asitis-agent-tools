## Catches
Two skills in the same skills folder (`.claude/skills`, a plugin's `skills/`, or skill folders at the root) whose descriptions share most of their key words. Key words leave out stop words and plurals, and a word that appears in more than half of a large folder's descriptions is treated as house style. A pair is reported when it shares at least 6 key words and 55% of them (a warning from 80%), once per skill, against the earlier skill it overlaps most.

Pairs that are told apart on purpose are skipped: when one skill's name has a word its own description uses and the other skill never mentions (`mobile-android-design` and `mobile-ios-design`), or when the two do opposite things (enable and disable, add and remove). Skills nested inside another skill, skills with `disable-model-invocation: true` and non-English descriptions are skipped, and the same pair copied into `.claude/skills`, `.agents/skills` and `.gemini/skills` is reported once.

## Bad
```markdown
.claude/skills/test-and-lint/SKILL.md
description: Run the test suite and lint and format checks the way CI does. Use before committing, or when tests or ruff fail.

.claude/skills/dev-check/SKILL.md
description: Run the local verification gate (ruff lint, ruff format check and pytest), the same checks CI enforces. Use before committing, or when asked to run the tests.
```
Asked to "run the checks", Claude can pick either one, so one of them never triggers reliably.

## Good
Merge the two into one skill, or make each description say what only it does:

```markdown
.claude/skills/dev-check/SKILL.md
description: Run ruff and pytest the way CI does. Use before committing, or when asked to check, lint or test.

.claude/skills/release-check/SKILL.md
description: Build the wheel, check the changelog entry and dry-run the publish. Use when preparing a release.
```

## Fix
Merge skills that do the same job. Otherwise put what sets each one apart in the first sentence of its description. The thresholds are options: `{ "rules": { "skill-description-overlap": ["note", { "notePercent": 60, "warnPercent": 85, "minSharedWords": 6, "maxSkills": 300 }] } }`. Folders with more than `maxSkills` skills are catalogs, not sets that load together, and are skipped with a notice.
