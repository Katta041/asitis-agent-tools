## Catches
A file that has more than one line but does not end with a line break. It is a note.

## Bad
```text
$ tail -c 20 CLAUDE.md | od -c | tail -2
... u   s   e       p   n   p   m   .
```
`echo "Run the linter." >> CLAUDE.md` now produces `use pnpm.Run the linter.` on one line, and so does an agent that appends a rule the same way.

## Good
```text
$ tail -c 1 CLAUDE.md | od -c
0000000  \n
```

## Fix
Add a line break at the end, using the same line ending as the rest of the file. `asitis lint --fix-preview=safe` prints that diff. Most editors have an "insert final newline" setting.
