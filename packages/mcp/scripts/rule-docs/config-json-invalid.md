## Catches
A `.claude/settings.json`, `.mcp.json` or similar agent config file that is not valid JSON: a trailing comma, a comment, a missing quote. Needs `--include config`.

## Bad
```json
{
  "permissions": {
    "deny": ["Read(./.env)"],
  }
}
```
The trailing comma after the array makes the file invalid. Claude Code ignores a settings file it cannot parse, so the deny rule that looks present is not in force.

## Good
```json
{
  "permissions": {
    "deny": ["Read(./.env)"]
  }
}
```

## Fix
Fix the syntax the message points at. JSON has no comments and no trailing commas. `node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))'` confirms the file parses.
