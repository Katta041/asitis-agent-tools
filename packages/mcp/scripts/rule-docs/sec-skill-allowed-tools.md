## Catches
A skill or Claude Code command whose `allowed-tools` grants `Bash` or `PowerShell` with no command pattern (or `Bash(*)`), every tool (`*`), `WebFetch` with no domain, an interpreter with any arguments (`Bash(python *)`, `Bash(node *)`, `Bash(sudo *)`), or `curl` or `wget` to any host. Those tools then run without a permission prompt while the skill or command runs. Needs `--include skills`. With `extends: strict` in `.asitisrc.json` it also notes subagents that have no `tools` list, since they inherit every tool; that note is not shown by default.

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
