# unlinted-steering-target

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error, varies (see below) | one file | no | no (security rule) |

Severity: error for a symlinked steering file; a warning for an @import of a text file that is not markdown.

## What it catches

A steering file or import loads a file AsItIs could not lint.

A steering file AsItIs could not lint although the agent tools load it: a `CLAUDE.md` or `AGENTS.md` (any steering file name) that is a symlink to a file that isn't markdown or that lives outside the project folder, and an `@import` of a text file that isn't markdown, such as `@notes.txt`.

## Why it matters

A CLAUDE.md that is a symlink to a non-markdown file or to a file outside the project, or an @import of a .txt file, still loads into the agent's context. AsItIs does not read those files, so hidden text in them would pass a CI gate unseen.

## Bad example

```console
$ ls -l
CLAUDE.md -> notes.txt
```
Claude Code follows the link and loads `notes.txt` as the project instructions. AsItIs reads only markdown, so before this rule it skipped the file with a notice and the CI gate passed, whatever `notes.txt` hid.

```markdown
# CLAUDE.md

See @notes.txt
```
Claude Code loads `notes.txt` with the instructions; AsItIs doesn't open it.

## Good example

```console
$ ls -l
CLAUDE.md -> AGENTS.md
```
A link to a markdown file inside the project is linted like any other file.

## How to fix

Replace the link with the file itself, or point it at a markdown file inside the project. For an import of a text file, rename the file to `.md` so it gets linted, or review it by hand. The symlink case is an error by default so the default `--fail-on error` stops it in CI; the import case is a warning, because `@package.json` and similar imports are common and rarely hide anything.

## Suppress or configure

`unlinted-steering-target` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "unlinted-steering-target": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/unlinted-steering-target.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
