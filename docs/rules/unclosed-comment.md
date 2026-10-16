# unclosed-comment

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

HTML comment never closes.

A `<!--` with no matching `-->` anywhere after it. Rendered views hide everything from that point to the end of the file.

## Why it matters

Everything after an unclosed <!-- is hidden in rendered views, so a reviewer sees less than the agent.

## Bad example

```markdown
# Contributing

<!-- draft section, remove before merging

## Release process

1. Tag the commit.
2. Run `make publish`.
```
The comment was never closed, so GitHub shows a file that ends after "Contributing". The agent reads the release process, and the reviewer never sees that `make publish` is in there.

## Good example

```markdown
# Contributing

## Release process

1. Tag the commit.
2. Run `make publish`.
```

## How to fix

Close the comment with `-->` where it was meant to end, or delete the `<!--`. Then reread the part that was hidden.

## Suppress or configure

`unclosed-comment` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "unclosed-comment": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[GitHub changelog: Warning about hidden Unicode text](https://github.blog/changelog/2025-05-01-github-now-provides-a-warning-about-hidden-unicode-text/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/unclosed-comment.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
