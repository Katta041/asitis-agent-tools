## Catches
A file that is not UTF-8: UTF-16 with or without a byte order mark is the usual case. The message names the encoding found.

## Bad
```text
$ xxd CLAUDE.md | head -2
00000000: fffe 2300 2000 5000 7200 6f00 6a00 6500  ..#. .P.r.o.j.e
00000010: 6300 7400 0d00 0a00 0d00 0a00 2d00 2000  c.t.........-. .
```
Windows PowerShell 5 writes UTF-16LE by default (`"..." > CLAUDE.md`), so the file reads fine in Notepad. Agent tools read it as UTF-8 and see a NUL byte after every character, which most of them treat as binary.

## Good
```text
$ xxd CLAUDE.md | head -1
00000000: 2320 5072 6f6a 6563 740a 0a2d 2052 756e  # Project..- Run
```

## Fix
Convert once: `iconv -f UTF-16 -t UTF-8 CLAUDE.md > tmp && mv tmp CLAUDE.md`, or in VS Code pick "Save with Encoding" and "UTF-8". In PowerShell write files with `Set-Content -Encoding utf8` or `Out-File -Encoding utf8` so it does not come back.
