# sec-mcp-inline-secret

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error | one file | no | no (security rule) |

## What it catches

A key or token is written in plain text in an MCP server or settings env block.

An `env` or `headers` value, a URL or an argument in an MCP server entry, or an `env` value in `.claude/settings.json`, that holds a key or token in plain text. A value with a known key shape (a GitHub, Anthropic or AWS key, say) is an error; a long random-looking literal under a name like `TOKEN`, `API_KEY` or `SECRET` is a warning. `${VAR}` references and placeholders are ignored. The message shows the key type and a redacted preview, never the value. Needs `--include config`; `.claude/settings.local.json` is read only with `--include config-local`.

## Why it matters

Committed keys leak to everyone who can read the repo. Every MCP config format can read the value from an environment variable instead. The message shows the key type and a redacted preview only.

## Bad example

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

## Good example

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

## How to fix

Revoke the key first, then replace the value with a variable reference (`${VAR}` in `.mcp.json`, `${env:VAR}` in Cursor, `${input:...}` in VS Code) and set the variable in each developer's shell environment. Removing it from the file does not remove it from history, which is why the key has to be revoked.

## Suppress or configure

`sec-mcp-inline-secret` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-mcp-inline-secret": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[code.claude.com](https://code.claude.com/docs/en/mcp), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-mcp-inline-secret.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
