# frontmatter-not-line-1

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | error | one file | safe | yes |

## What it catches

Frontmatter does not start on line 1.

A `---` block with `key: value` lines that starts after a blank line, a title or a comment. Claude Code, Cursor, Copilot and the Agent Skills validators all look for `---` on line 1 and nowhere else. The block is still in the file, so it looks fine in an editor, but every tool treats it as body text.

## Why it matters

Agent tools only read YAML frontmatter that starts on the first line. Blank lines or text above it turn the whole block into body text, so name, description and paths are lost.

## Bad example

```markdown
# Release notes skill

---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog or release summary.
---

Collect merged PRs since the last tag...
```
The author put a title first. Claude Code lists this skill under its folder name with the first body line as its description, which is the heading, and Codex and Cursor skip it because `name` and `description` are missing.

## Good example

```markdown
---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog or release summary.
---

# Release notes skill

Collect merged PRs since the last tag...
```

## How to fix

Delete everything above the opening `---`, including blank lines, and move the title below the closing `---`. If the first line is a `<!-- comment -->`, move it below too.

asitis can make this edit for you. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule is marked safe: it does not change what the file says.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line frontmatter-not-line-1 -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file frontmatter-not-line-1 -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "frontmatter-not-line-1": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/frontmatter-not-line-1.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
