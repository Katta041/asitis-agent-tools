# skill-description-vague

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | no | yes |

## What it catches

Skill description is a placeholder or says nothing specific about what the skill does.

A skill description that is template placeholder text ("TODO", "Replace with description of the skill..."), or a short one made only of words that could describe any skill ("Helps with documents", "Processes data"). Only descriptions of 12 words or fewer are judged, and one word that names a file type, tool, product or concrete task is enough to pass. Skills in template and test folders, skills with `disable-model-invocation: true` (Claude never sees their description) and descriptions that are not in English are skipped.

## Why it matters

Claude picks a skill from its description alone. Anthropic's skill guide names "Helps with documents" and "Processes data" as descriptions to avoid: they give Claude no key terms to match a request against, so the skill rarely triggers.

## Bad example

```markdown
---
name: docs-helper
description: Helps with documents
---
```
Claude sees this line next to every other skill's description and has nothing to match "turn this PDF into a Word file" against.

## Good example

```markdown
---
name: docs-helper
description: Converts PDF and Word files, fills PDF forms and merges documents. Use when the user mentions PDFs, .docx files, forms or merging documents.
---
```

## How to fix

Say what the skill does and when to use it, with the words a user would actually type: file types, tool names, the task. Anthropic's skill guide lists "Helps with documents", "Processes data" and "Does stuff with files" as descriptions to avoid. The word limit is the `maxWords` option, for example `{ "rules": { "skill-description-vague": ["note", { "maxWords": 8 }] } }`.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line skill-description-vague -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file skill-description-vague -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "skill-description-vague": "off" } }
```

`skill-description-vague` also takes options, set under `rules` (they apply to the whole project, not per `overrides` entry):

```json
{ "rules": { "skill-description-vague": ["note", { "maxWords": 8 }] } }
```

The options are `maxWords`.

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude API docs: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), read on 15 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/skill-description-vague.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
