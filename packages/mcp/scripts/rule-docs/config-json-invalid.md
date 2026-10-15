## Catches
A `.claude/settings.json` or `.mcp.json` that is not valid JSON (a trailing comma, a comment, a missing quote), or whose top level is not an object. `.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json` are read the way their tools read them, so comments and trailing commas are allowed there; other syntax errors are still reported. Needs `--include config`; `.claude/settings.local.json` is checked only with `--include config-local`.

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
