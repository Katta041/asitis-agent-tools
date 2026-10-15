# instruction-drift

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | note | several files or the folder layout | no | yes |

## What it catches

Mirrored instruction files share most rules but not all.

Two files that are meant to say the same thing (AGENTS.md and CLAUDE.md, say) and mostly do, but one has rules the other lacks. The check stays silent for files that are not alike enough to be mirrors, so unrelated documents do not alert. Only runs when the whole folder is linted.

## Why it matters

Two files that are meant to say the same thing (AGENTS.md and CLAUDE.md, say) have drifted. Fires when at least half of their rules match (Jaccard) and at least three are shared; silent below that so unrelated files do not alert. Lists up to 10 differing rules per pair.

## Bad example

```markdown
<!-- AGENTS.md: 41 rules -->
...
- Run `pnpm lint` before opening a PR.
```
```markdown
<!-- CLAUDE.md: the same 40 rules, copied in March -->
...
```
The lint rule was added to AGENTS.md in June. Claude Code users never got it.

## Good example

```markdown
<!-- CLAUDE.md -->
@AGENTS.md
```
One file, imported by the other, cannot drift.

## How to fix

Replace the copy with an `@AGENTS.md` import, a symlink, or a generator such as rulesync that writes every variant from one source. If both files must exist separately, copy the missing rules across now and pick which file is the source for next time.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line instruction-drift -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file instruction-drift -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "instruction-drift": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[agents.md](https://agents.md/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/instruction-drift.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
