# secret-in-steering

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error | one file | no | no (security rule) |

## What it catches

Steering file contains something shaped like an API key or private key.

Text in a steering file shaped like an API key or token (AWS access keys, GitHub, Anthropic, OpenAI, Slack, Stripe, npm and Google API keys) or a PEM private key with key material under its header. Placeholders are skipped: values containing EXAMPLE, xxxx, your, dummy or similar, typed runs such as 123456 or aaaaa, and a PEM header with no key under it (a rule about keys, not a key). The message names the key type, line and column, never any part of the key, and the finding's fingerprint is built from the key type, so a baseline file holds nothing derived from the key. No fix diff is offered for lines next to a key, because the diff would print the line.

## Why it matters

Steering files are committed and sent to a model provider in every session. The message names the key type, line and column only, never any part of the key, and no fix diff is offered for a line that holds one.

## Bad example

```markdown
# Deploys

Use the deploy token ghp_ followed by 36 random letters and digits when calling the API.
```
The file is committed, pushed and mirrored, and it is sent to the model provider in every session.

## Good example

```markdown
# Deploys

The deploy token is in the DEPLOY_TOKEN environment variable; never paste it into files.
```

## How to fix

Revoke the key first: removing it from the file does not remove it from git history. Then delete it and load it from an environment variable or a secret store.

## Suppress or configure

`secret-in-steering` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "secret-in-steering": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[docs.github.com](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning), read on 15 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/secret-in-steering.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
