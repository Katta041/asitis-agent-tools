## Catches
A Copilot `*.instructions.md` file with neither `applyTo` nor `description` in its frontmatter, or with no frontmatter at all.

## Bad
```markdown
# Testing conventions

- Use Vitest, not Jest.
- One `describe` per exported function.
```
Saved as `.github/instructions/testing.instructions.md`. VS Code only uses it when a person attaches it to a chat by hand, so the conventions are never applied automatically.

## Good
```markdown
---
applyTo: "**/*.test.ts"
description: Testing conventions for the Vitest suites
---

# Testing conventions

- Use Vitest, not Jest.
- One `describe` per exported function.
```

## Fix
Add `applyTo` with a glob relative to the workspace root (`**` for every file) so the instructions attach when matching files are edited, or `description` so the agent can pick the file up when the task matches. Both is best.
