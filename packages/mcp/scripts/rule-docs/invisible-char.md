## Catches
Characters that take no space on screen: zero-width space, zero-width joiner and non-joiner, word joiner, soft hyphen, Hangul fillers, the BOM in the middle of a file, and variation selectors used as a carrier. The message lists each code point by name. A zero-width joiner between two emoji is how emoji sequences are spelled and is not reported.

## Bad
```markdown
- Run `npm te[U+200B]st` before every commit.
- [U+200B][U+200B][U+200D][U+200B] Review the diff before approving.
```
The first line looks like `npm test` but is not: the command in the file will not run. The second line opens with a run of zero-width characters, which is the pattern the Rules File Backdoor attack used to smuggle instructions into Cursor and Copilot rule files. Neither shows in a code review.

## Good
```markdown
- Run `npm test` before every commit.
- Review the diff before approving.
```

## Fix
Delete the characters. `asitis lint --fix-preview` produces the diff. To see them in an editor, VS Code highlights them by default (`editor.unicodeHighlight.invisibleCharacters`), and `grep -nP '[\x{200B}-\x{200D}\x{2060}\x{FEFF}]' CLAUDE.md` finds the common ones from the shell. If a run of them came from a paste, check the rest of the paste too.
