# secret-in-permission-rule

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error | one file | no | no (security rule) |

## What it catches

A password, token or key is written into a permission rule.

A password, token or key inside an entry of `permissions.allow`, `ask` or `deny` in `.claude/settings.json` (and `.claude/settings.local.json` with `--include config-local`), `permissions.allow` or `deny` in `.cursor/cli.json`, or `tools.allowed`, `core` or `exclude` in `.gemini/settings.json`. It looks for known key shapes (GitHub, AWS, OpenAI, Anthropic, Stripe, Slack, GitLab, JWTs and others) and for credentials by position: `Authorization` and key headers, `user:password@` in a URL, `curl -u`, `PGPASSWORD=` and other secret-named assignments, `mysql -p...`, `sshpass -p`, `docker login -p`, `redis-cli -a`, and long flags such as `--password=` or `--api-key`. Variables, placeholders, wildcards and well-known defaults like `postgres` are skipped, and so is a password or token sent only to localhost. The message names the list, the entry index and the kind of secret; it never shows the value or quotes the rule. Needs `--include config`.

Codex saves approvals to `~/.codex/rules/default.rules`, outside the project, so there is no Codex file to check.

## Why it matters

"Yes, and don't ask again" saves the whole approved command, password included, as an allow rule. Apiiro found secrets in 1,122 public settings.local.json files in November 2026, and gitleaks and TruffleHog both missed 19% of them. The message names the list, the entry and the kind of secret, never the value.

## Bad example

```json
{
  "permissions": {
    "allow": [
      "Bash(PGPASSWORD=T4ble-Sp00n psql -h db.internal.example -U app)",
      "Bash(curl -H \"Authorization: Bearer 7f3kQ9xLm2Vt8pRw4Zc6\" https://api.example.com/v1/jobs)"
    ]
  }
}
```
Both commands were approved with "Yes, and don't ask again", which saves the whole command. Anyone who can read the file has the database password and the API token.

## Good example

```json
{
  "permissions": {
    "allow": [
      "Bash(psql -h db.internal.example -U app)",
      "Bash(curl -H \"Authorization: Bearer $JOBS_API_TOKEN\" https://api.example.com/v1/jobs)"
    ]
  }
}
```
The password comes from `~/.pgpass` or the shell, and the token from an environment variable.

## How to fix

Rotate the secret first: removing it from the file does not remove it from git history or from forks. Then delete the rule (Claude Code asks again next time) or rewrite it so the command reads the value from an environment variable. Keep `.claude/settings.local.json` out of git as well (see `local-agent-file-not-ignored`).

## Suppress or configure

`secret-in-permission-rule` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "secret-in-permission-rule": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[apiiro.com](https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/secret-in-permission-rule.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
