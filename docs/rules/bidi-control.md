# bidi-control

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | review | no (security rule) |

## What it catches

Bidirectional control characters.

Unicode bidirectional controls: right-to-left and left-to-right overrides, embeddings, isolates and marks (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C). They change the order in which text is displayed without changing the order in which it is stored, which is the Trojan Source technique.

## Why it matters

Bidi controls make text display in a different order from the one the agent reads (Trojan Source).

## Bad example

```markdown
- Deploy to [U+202E]gnigats[U+202C] only after review.
```
Rendered, the override reverses the following letters, so a reviewer reads "Deploy to staging only after review". The stored text, which the agent reads, is `gnigats`, and more elaborate versions reorder whole clauses so that "never" and "always" swap places.

## Good example

```markdown
- Deploy to staging only after review.
```

## How to fix

Delete the controls and rewrite the line as it was meant to read. The proposed fix removes them but needs a look, because the visible order may have been the intended one. GitHub, VS Code and most modern editors highlight bidi controls; `grep -nP '[\x{202A}-\x{202E}\x{2066}-\x{2069}]'` finds them from the shell. Steering files for projects that genuinely contain right-to-left text should keep that text in its own paragraphs rather than rely on controls.

asitis can propose this edit. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule needs review before you apply it, because it changes or removes content.

## Suppress or configure

`bidi-control` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "bidi-control": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Trojan Source (Boucher and Anderson)](https://trojansource.codes/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/bidi-control.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
