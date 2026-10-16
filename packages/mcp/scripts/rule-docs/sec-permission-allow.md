## Catches
A `permissions.allow` entry in `.claude/settings.json` that pre-approves `Bash` or `PowerShell` with no pattern or `(*)` (error), or, as warnings: `WebFetch` with no domain, a network tool with a wildcard (`Bash(curl *)`, `Bash(nslookup *)`), `Bash(git push *)` or `Bash(gh api *)`, or a wildcard that covers an interpreter or package runner (`Bash(python *)`, `Bash(node *)`, `Bash(sh *)`, `Bash(npx *)`, `Bash(uv run *)`). A Gemini CLI MCP server with `trust: true` is reported here too. Needs `--include config`; `.claude/settings.local.json` is read only with `--include config-local`.

## Bad
```json
{
  "permissions": {
    "allow": ["Bash", "WebFetch", "Bash(python3 *)"]
  }
}
```
Every shell command and every URL runs without asking, in every session in this project, for everyone who clones it. `Bash(python3 *)` is `Bash` with extra steps: `python3 -c` runs anything.

## Good
```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)", "Bash(pnpm lint)", "Bash(git status *)", "WebFetch(domain:docs.example.invalid)"]
  }
}
```

## Fix
Allow the exact commands the project uses, with their prefix. Scope network tools to a domain. Leave interpreters out of the allow list; Claude asks before running them, which is the point.
