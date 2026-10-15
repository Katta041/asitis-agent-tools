# broken-link

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning, varies (see below) | one file | no | yes |

Severity: warning; a note when the path works from the repository root but not from the file.

## What it catches

Relative link or anchor points to nothing.

A relative link whose target file does not exist, or whose `#anchor` matches no heading in the target (or in the same file for a bare `#anchor`). Anchors are compared the way GitHub builds them: lowercase, punctuation dropped, spaces to hyphens, with `-1`, `-2` suffixes for repeated headings. Anchors also match with emoji variation selectors (U+FE0F) removed, as VS Code and most renderers build them. External URLs, `/site-absolute` paths, template placeholders such as `${GITHUB_SERVER_URL}` and single words with no dot or slash (`[Smith et al.](url)`) are not checked, and a link into a git submodule named in `.gitmodules` counts as present, since a plain clone leaves the submodule folder empty.

A path that is missing next to the file but exists from the repository root (`docs/x.md` written in `.cursor/rules/a.mdc`) is a note: an agent working from the root finds it, but editors and Markdown viewers do not.

## Why it matters

An agent told to read the linked file finds nothing and carries on without it, and a person gets a 404. Renamed files and changed headings break links silently.

## Bad example

```markdown
See [the architecture notes](docs/architecture.md) and [running tests](docs/testing.md#running).
```
The file is `docs/ARCHITECTURE.md` (case matters on Linux and in git), and `docs/testing.md` has a heading "Running the tests", whose anchor is `#running-the-tests`. An agent told to read the architecture notes before changing a module finds nothing and carries on without them.

## Good example

```markdown
See [the architecture notes](docs/ARCHITECTURE.md) and [running tests](docs/testing.md#running-the-tests).
```

## How to fix

Fix the path or the anchor, or delete the link if the file is gone. For an anchor, copy the heading text and let the message tell you the slug it expects.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line broken-link -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file broken-link -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "broken-link": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: Skills](https://code.claude.com/docs/en/skills), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/broken-link.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
