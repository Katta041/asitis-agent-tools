## Catches
A `.claude/settings.json` with no `permissions.deny` rule covering `.env` files or other secret locations. It is a note: a hint, not a finding of something wrong. Needs `--include config`.

## Bad
```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)"]
  }
}
```
Nothing stops a `Read` of `.env` when a task, or an injected instruction, asks for it.

## Good
```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)"],
    "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./secrets/**)"]
  }
}
```

## Fix
Add deny rules for the files that hold secrets in this project. The Claude Code settings reference describes deny rules as the way to keep such files out of reach.
