## Catches
A password, token or key inside an entry of `permissions.allow`, `ask` or `deny` in `.claude/settings.json` (and `.claude/settings.local.json` with `--include config-local`), `permissions.allow` or `deny` in `.cursor/cli.json`, or `tools.allowed`, `core` or `exclude` in `.gemini/settings.json`. It looks for known key shapes (GitHub, AWS, OpenAI, Anthropic, Stripe, Slack, GitLab, JWTs and others) and for credentials by position: `Authorization` and key headers, `user:password@` in a URL, `curl -u`, `PGPASSWORD=` and other secret-named assignments, `mysql -p...`, `sshpass -p`, `docker login -p`, `redis-cli -a`, and long flags such as `--password=` or `--api-key`. Variables, placeholders, wildcards and well-known defaults like `postgres` are skipped, and so is a password or token sent only to localhost. The message names the list, the entry index and the kind of secret; it never shows the value or quotes the rule. Needs `--include config`.

Codex saves approvals to `~/.codex/rules/default.rules`, outside the project, so there is no Codex file to check.

## Bad
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

## Good
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

## Fix
Rotate the secret first: removing it from the file does not remove it from git history or from forks. Then delete the rule (Claude Code asks again next time) or rewrite it so the command reads the value from an environment variable. Keep `.claude/settings.local.json` out of git as well (see `local-agent-file-not-ignored`).
