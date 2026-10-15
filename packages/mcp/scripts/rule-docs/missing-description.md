## Catches
A `SKILL.md` or subagent with no `description`, or an empty one. For a memory topic file this is a note, since Claude Code's own memory files carry a description but the docs do not require one.

## Bad
```markdown
---
name: api-client
---

# API client

Regenerate the TypeScript client from `openapi.yaml`...
```
The description is the only text an agent sees before deciding to load a skill. Claude Code substitutes the first non-empty body line, here the heading "API client", which says nothing about when to use it. Other tools skip the skill.

## Good
```markdown
---
name: api-client
description: Regenerate the TypeScript API client from openapi.yaml. Use after the OpenAPI spec changes or when the client is out of date.
---
```

## Fix
Write one or two sentences: what the skill does, then when to use it, with the words a user would say. For a subagent, say what it is good at and when Claude should hand work to it.
