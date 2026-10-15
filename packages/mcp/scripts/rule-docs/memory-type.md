## Catches
A memory topic file whose `type` is not one of the four values Claude Code records: `user`, `feedback`, `project` or `reference`.

## Bad
```markdown
---
name: Prefers pnpm
description: The user prefers pnpm over npm in every project
type: preference
---
```

## Good
```markdown
---
name: Prefers pnpm
description: The user prefers pnpm over npm in every project
type: user
---
```

## Fix
Pick the type that matches: `user` for who the person is and how they work, `feedback` for corrections and preferences about Claude's work, `project` for facts about the project that are not in the code, `reference` for pointers to external systems.
