# contradiction

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| drift | warning | one file | no | yes |

## What it catches

Two lines in one file say opposite things.

Two lines in one file that give the same instruction with opposite polarity: "always X" and "never X", "do X" and "do not X", "prefer X" and "avoid X". The action is compared after removing case, punctuation and emphasis, so the rule looks for the same wording, not for every logical conflict. Items under a heading or parent bullet that lists things to avoid ("Don'ts", "Anti-patterns") are read as negative.

## Why it matters

When rules conflict the agent may follow either one. Keep the one you mean.

## Bad example

```markdown
- Always run the full test suite before pushing.
...
- Don't run the full test suite before pushing; CI does it.
```
The second line was added months later when CI got faster. Claude Code's docs say that when two instructions contradict, Claude may pick either one, so sometimes it runs the suite and sometimes it does not.

## Good example

```markdown
- Run only the tests for the package you changed before pushing; CI runs the full suite.
```

## How to fix

Decide which rule is current, delete the other, and say why if the reason is not obvious. If both are right in different situations, state the condition in one line instead of keeping two rules.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line contradiction -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file contradiction -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "contradiction": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/contradiction.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
