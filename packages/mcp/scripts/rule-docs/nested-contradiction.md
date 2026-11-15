## Catches
A subfolder `CLAUDE.md`, `AGENTS.md` or `GEMINI.md` that says the opposite of the same kind of file in a folder above it ("use X" against "never use X"). The agent gets both when it works in the subfolder, the nested one last. That is often a deliberate exception, so this is a note, but a silent exception reads like a mistake to the agent and to the next person.

## Bad
```text
AGENTS.md                - Use npm for installs
packages/web/AGENTS.md   - Never use npm for installs
```

## Good
```text
AGENTS.md                - Use npm for installs
packages/web/AGENTS.md   - This package is the exception: use pnpm here, not npm
```

## Fix
If the exception is intended, say so in the subfolder file and name the rule it replaces. If it is not, keep one of the two.
