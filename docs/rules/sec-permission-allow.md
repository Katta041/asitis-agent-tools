# sec-permission-allow

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error | one file | no | no (security rule) |

## What it catches

Allow rule or trust flag skips the prompt for any shell command, network tool or interpreter.

A `permissions.allow` entry in `.claude/settings.json` that pre-approves `Bash` with no pattern, a network tool with no host, or a wildcard that covers an interpreter (`Bash(python *)`, `Bash(node *)`, `Bash(sh *)`). Needs `--include config`.

## Why it matters

An allow rule runs the command without asking, so text the agent reads can trigger it. CVE-2025-55284 leaked .env contents through allowlisted ping and nslookup. Bash and Bash(*) allow every command and are errors; network tools, interpreters with a wildcard and an unscoped WebFetch are warnings.

## Bad example

```json
{
  "permissions": {
    "allow": ["Bash", "WebFetch", "Bash(python3 *)"]
  }
}
```
Every shell command and every URL runs without asking, in every session in this project, for everyone who clones it. `Bash(python3 *)` is `Bash` with extra steps: `python3 -c` runs anything.

## Good example

```json
{
  "permissions": {
    "allow": ["Bash(pnpm test)", "Bash(pnpm lint)", "Bash(git status *)", "WebFetch(domain:docs.example.invalid)"]
  }
}
```

## How to fix

Allow the exact commands the project uses, with their prefix. Scope network tools to a domain. Leave interpreters out of the allow list; Claude asks before running them, which is the point.

## Suppress or configure

`sec-permission-allow` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-permission-allow": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[code.claude.com](https://code.claude.com/docs/en/permissions), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-permission-allow.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
