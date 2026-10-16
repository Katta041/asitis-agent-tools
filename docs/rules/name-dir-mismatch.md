# name-dir-mismatch

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | review | yes |

## What it catches

Skill name does not match its folder name.

A `SKILL.md` whose `name` differs from the folder it sits in. Only skills that sit directly in a skills folder (`.claude/skills/x/SKILL.md`, `skills/x/SKILL.md`) or at the top of the root are checked: a SKILL.md nested inside another skill's folder (the stages of a pipeline) is often prefixed on purpose, and a `template/` folder is meant to be copied and renamed. SKILL.md files under tests, fixtures or testdata folders are not checked by any skill format rule.

## Why it matters

The Agent Skills spec expects name to match the folder. Tools that key skills by folder show a different name from the one in the file.

## Bad example

```text
.claude/skills/changelog/SKILL.md
```
```markdown
---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog.
---
```
The Agent Skills spec says the name must match the parent directory. Claude Code keys skills by folder, so `/changelog` invokes it, while a user who read the file tries `/release-notes` and gets nothing. Validators report the mismatch.

## Good example

```text
.claude/skills/release-notes/SKILL.md
```
```markdown
---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog.
---
```

## How to fix

Rename one side. If the folder name is the one people already type, change `name` to match it; the suggested fix does exactly that. Otherwise `git mv` the folder.

asitis can propose this edit. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule needs review before you apply it, because it changes or removes content.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line name-dir-mismatch -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file name-dir-mismatch -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "name-dir-mismatch": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Agent Skills specification](https://agentskills.io/specification), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/name-dir-mismatch.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
