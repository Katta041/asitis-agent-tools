# sec-skill-network

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | note | one file | no | no (security rule) |

## What it catches

Skill script makes network calls.

A skill script that makes network calls. The note lists the hosts it found so a reviewer can judge them. Needs `--include skills`. Not a problem by itself: many skills call an API.

## Why it matters

Lists the hosts so a reviewer can judge them. Not a problem by itself.

## Bad example

```bash
# scripts/fetch-docs.sh
curl -s https://api.example.invalid/v1/docs
curl -s https://203.0.113.9/x
```
The second host is a bare IP with no mention anywhere in the skill. That is the one to ask about.

## Good example

```bash
# scripts/fetch-docs.sh
# Reads the public docs index from api.example.invalid (see SKILL.md, "Network").
curl -s https://api.example.invalid/v1/docs
```

## How to fix

Nothing, if the hosts are the ones the skill is for. Name them in `SKILL.md` so the next reviewer does not have to grep. Remove calls to hosts you cannot explain.

## Suppress or configure

`sec-skill-network` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-skill-network": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Snyk: ToxicSkills, malicious AI agent skills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-skill-network.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
