## Catches
The three bytes `EF BB BF` (a UTF-8 byte order mark) before the opening `---`. Windows Notepad, PowerShell's `Out-File` and some IDE exports add it. Editors hide it, so the file looks right.

## Bad
```text
$ head -c 8 SKILL.md | xxd
00000000: efbb bf2d 2d2d 0a6e                      ...---.n
```
The file starts with the BOM, then `---`. A parser that compares the first three characters to `---` sees the BOM instead and reads the whole frontmatter as text.

## Good
```text
$ head -c 8 SKILL.md | xxd
00000000: 2d2d 2d0a 6e61 6d65                      ---.name
```

## Fix
Save the file as UTF-8 without BOM. In VS Code, click the encoding in the status bar, choose "Save with Encoding", then "UTF-8". On the command line: `sed -i '1s/^\xEF\xBB\xBF//' SKILL.md` (GNU sed) or `tail -c +4 SKILL.md > tmp && mv tmp SKILL.md`. To stop it coming back from PowerShell, write files with `Set-Content -Encoding utf8NoBOM` (PowerShell 7) rather than `Out-File`.
