# invisible-char

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | safe | no (security rule) |

## What it catches

Invisible Unicode characters.

Characters that take no space on screen: zero-width space, zero-width joiner and non-joiner, word joiner, soft hyphen, Hangul fillers, the BOM in the middle of a file, and variation selectors used as a carrier. The message lists each code point by name. A zero-width joiner between two emoji is how emoji sequences are spelled and is not reported.

## Why it matters

Zero-width and tag characters are read by agents but not seen by people, which is how the Rules File Backdoor hid instructions.

## Bad example

```markdown
- Run `npm te[U+200B]st` before every commit.
- [U+200B][U+200B][U+200D][U+200B] Review the diff before approving.
```
The first line looks like `npm test` but is not: the command in the file will not run. The second line opens with a run of zero-width characters, which is the pattern the Rules File Backdoor attack used to smuggle instructions into Cursor and Copilot rule files. Neither shows in a code review.

## Good example

```markdown
- Run `npm test` before every commit.
- Review the diff before approving.
```

## How to fix

Delete the characters. `asitis lint --fix-preview` produces the diff. To see them in an editor, VS Code highlights them by default (`editor.unicodeHighlight.invisibleCharacters`), and `grep -nP '[\x{200B}-\x{200D}\x{2060}\x{FEFF}]' CLAUDE.md` finds the common ones from the shell. If a run of them came from a paste, check the rest of the paste too.

asitis can make this edit for you. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule is marked safe: it does not change what the file says.

## Suppress or configure

`invisible-char` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "invisible-char": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Pillar Security: Rules File Backdoor](https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/invisible-char.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
