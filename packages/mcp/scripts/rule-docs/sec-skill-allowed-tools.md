## Catches
A skill whose `allowed-tools` grants `Bash` with no command pattern, every tool (`*`), or `WebFetch` with no host. Those tools then run without a permission prompt for the turn that invokes the skill.

## Bad
```markdown
---
name: changelog
description: Draft the changelog for the next release. Use when asked for release notes.
allowed-tools: Bash WebFetch
---
```
Any shell command and any URL, no prompt, as long as the skill is active. A prompt injection in a PR description the skill reads becomes code execution.

## Good
```markdown
---
name: changelog
description: Draft the changelog for the next release. Use when asked for release notes.
allowed-tools: Bash(git log *) Bash(git tag *) Read
---
```

## Fix
List the commands the skill actually runs, with their prefixes: `Bash(git log *)`, `Bash(pnpm test)`. Leave out tools the skill does not need; Claude asks for the rest as usual.
