## Catches
An `env` value or argument in an MCP server entry that looks like an API key or token. The message shows the key type and a redacted preview, never the value. Needs `--include config`.

## Bad
```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["servers/github.js"],
      "env": { "GITHUB_TOKEN": "ghp_<36 more characters>" }
    }
  }
}
```
Committed, pushed, mirrored and cached. GitHub's secret scanning will revoke this one; the next provider's may not.

## Good
```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["servers/github.js"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

## Fix
Replace the value with a `${VAR}` reference and set the variable in each developer's shell or in a gitignored local settings file. Rotate the key that was committed; removing it from the file does not remove it from history.
