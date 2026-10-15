## Catches
An `env` or `headers` value, a URL or an argument in an MCP server entry, or an `env` value in `.claude/settings.json`, that holds a key or token in plain text. A value with a known key shape (a GitHub, Anthropic or AWS key, say) is an error; a long random-looking literal under a name like `TOKEN`, `API_KEY` or `SECRET` is a warning. `${VAR}` references and placeholders are ignored. The message shows the key type and a redacted preview, never the value. Needs `--include config`; `.claude/settings.local.json` is read only with `--include config-local`.

## Bad
```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["servers/github.js"],
      "env": { "GITHUB_TOKEN": "q8Lr2Xv9Tn4Kc7Wm1Zp5Hb3Jd6Fs0Gy" }
    }
  }
}
```
Committed, pushed, mirrored and cached: anyone who can read the repository can use it. A real `ghp_` token here would be an error rather than this warning, and GitHub's secret scanning might revoke it; most providers do not scan.

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
Revoke the key first, then replace the value with a variable reference (`${VAR}` in `.mcp.json`, `${env:VAR}` in Cursor, `${input:...}` in VS Code) and set the variable in each developer's shell environment. Removing it from the file does not remove it from history, which is why the key has to be revoked.
