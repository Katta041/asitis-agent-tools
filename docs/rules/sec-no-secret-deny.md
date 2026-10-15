# sec-no-secret-deny

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | note | one file | no | no (security rule) |

## What it catches

The folder has a .env file but no permissions.deny rule keeps Claude Code out of it.

A project with a `.env` file at the top of the folder (templates like `.env.example` do not count) and a `.claude/settings.json` that has no `permissions.deny` or `permissions.ask` rule mentioning `.env` or secrets. It is a note: a hint, not a finding of something wrong. No `.env` file, or no settings file, means no note. Needs `--include config`.

## Why it matters

Claude Code reads files in the project without asking. The settings reference says to list files that hold keys and secrets in permissions.deny.

## Bad example

```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)"]
  }
}
```
With a `.env` next to it, nothing stops a `Read` of `.env` when a task, or an injected instruction, asks for it.

## Good example

```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)"],
    "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./secrets/**)"]
  }
}
```

## How to fix

Add deny rules for the files that hold secrets in this project, at least `"Read(./.env)"` and `"Read(./.env.*)"`. The Claude Code settings reference describes deny rules as the way to keep such files out of reach.

## Suppress or configure

`sec-no-secret-deny` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-no-secret-deny": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Claude Code docs: Settings reference](https://code.claude.com/docs/en/settings-reference), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-no-secret-deny.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
