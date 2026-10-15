# sec-mcp-inline-secret

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error | one file | no | no (security rule) |

## What it catches

A key or token is written in plain text in an MCP server or settings env block.

An `env` value or argument in an MCP server entry that looks like an API key or token. The message shows the key type and a redacted preview, never the value. Needs `--include config`.

## Why it matters

Committed keys leak to everyone who can read the repo. Every MCP config format can read the value from an environment variable instead. The message shows the key type and a redacted preview only.

## Bad example

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

Replace the value with a `${VAR}` reference and set the variable in each developer's shell or in a gitignored local settings file. Rotate the key that was committed; removing it from the file does not remove it from history.

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
