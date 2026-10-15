# config-json-invalid

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| config | error | one file | no | yes |

## What it catches

Agent config file is not valid JSON.

A `.claude/settings.json`, `.mcp.json` or similar agent config file that is not valid JSON: a trailing comma, a comment, a missing quote. Needs `--include config`.

## Why it matters

Claude Code skips a settings file it cannot parse, and MCP clients drop the servers in it, so the permissions and servers are not what the author thinks.

## Bad example

```json
{
  "permissions": {
    "deny": ["Read(./.env)"],
  }
}
```
The trailing comma after the array makes the file invalid. Claude Code ignores a settings file it cannot parse, so the deny rule that looks present is not in force.

## Good example

```json
{
  "permissions": {
    "deny": ["Read(./.env)"]
  }
}
```

## How to fix

Fix the syntax the message points at. JSON has no comments and no trailing commas. `node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))'` confirms the file parses.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line config-json-invalid -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file config-json-invalid -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "config-json-invalid": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Settings](https://code.claude.com/docs/en/settings), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/config-json-invalid.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
