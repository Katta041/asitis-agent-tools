## Catches
A project with a `.env` file at the top of the folder (templates like `.env.example` do not count) and a `.claude/settings.json` that has no `permissions.deny` or `permissions.ask` rule mentioning `.env` or secrets. It is a note: a hint, not a finding of something wrong. No `.env` file, or no settings file, means no note. Needs `--include config`.

## Bad
```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)"]
  }
}
```
With a `.env` next to it, nothing stops a `Read` of `.env` when a task, or an injected instruction, asks for it.

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
Add deny rules for the files that hold secrets in this project, at least `"Read(./.env)"` and `"Read(./.env.*)"`. The Claude Code settings reference describes deny rules as the way to keep such files out of reach.
