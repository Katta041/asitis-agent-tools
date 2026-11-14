# skill-description-person

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | note | one file | no | yes |

## What it catches

Skill description speaks as the skill ("I can help you") instead of in third person.

A skill description in which the skill speaks for itself: "I can help you...", "I will...", "I'm a ... expert", "Let me...", or the "You can use this to..." form Anthropic's guide gives as an example to avoid. Quoted user phrases ("help me write a commit", 'what did I do yesterday') are ignored, and so are descriptions addressed to Claude ("Use when you need...", "You should use this skill when..."), which Anthropic's own published skills use. Non-English descriptions are skipped.

## Why it matters

The description is injected into the system prompt, and Anthropic's skill guide says to always write it in third person because a mixed point of view can cause discovery problems. Descriptions addressed to Claude ("Use when you need...") are fine and not reported.

## Bad example

```markdown
---
name: ts-review
description: TypeScript reviewer. I can help you find type errors, and I will suggest a stricter tsconfig.
---
```

## Good example

```markdown
---
name: ts-review
description: Reviews TypeScript code for type errors and suggests a stricter tsconfig. Use when the user asks for a TypeScript review or a tsconfig change.
---
```

## How to fix

Rewrite the description in third person: say what the skill does ("Reviews...", "Generates...") and when to use it.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line skill-description-person -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file skill-description-person -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "skill-description-person": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude API docs: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), read on 15 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/skill-description-person.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
