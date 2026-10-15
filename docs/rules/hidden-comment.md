# hidden-comment

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | note | one file | no | no (security rule) |

## What it catches

Comments hidden in rendered views.

HTML comments and `[//]: # (...)` link-reference comments that do not read like instructions. The message counts them and points at the first. It is a note: most comments are harmless maintainer notes. The point is that a reviewer reading the rendered file does not see what the agent reads. Claude Code strips block-level HTML comments from CLAUDE.md before loading it, but its Read tool still shows them, and other tools do not strip them.

## Why it matters

Reviewers reading the rendered file do not see comments that the agent reads. Most are harmless, so this is a note.

## Bad example

```markdown
## Deployment

<!-- TODO: rewrite this once the Kubernetes migration lands (ticket OPS-412) -->

Deploy with `make deploy ENV=staging`.
```
Harmless, and reported as a note so the count of hidden text in the file is known.

## Good example

```markdown
## Deployment

Deploy with `make deploy ENV=staging`. This section will change once the Kubernetes migration lands (OPS-412).
```

## How to fix

Nothing is required. If the note is for people, make it visible text so the rendered file and the raw file say the same thing. If the file collects many comments, consider an issue tracker instead. The proposed fix removes the comment and needs review.

## Suppress or configure

`hidden-comment` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "hidden-comment": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[GitHub changelog: Warning about hidden Unicode text](https://github.blog/changelog/2025-05-01-github-now-provides-a-warning-about-hidden-unicode-text/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/hidden-comment.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
