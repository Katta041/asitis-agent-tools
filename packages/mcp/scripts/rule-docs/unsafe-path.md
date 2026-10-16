## Catches
A file name or folder name that contains control characters, bidirectional controls or invisible characters. The message shows the path with those characters escaped.

## Bad
```text
$ ls .claude/rules | cat -A
security.md$
securM-bM-^@M-^Kity.md$
```
Two files that both display as `security.md`; the second has a zero-width space inside the name. A reviewer sees one rules file. Claude Code loads both, and the second can say anything.

## Good
```text
$ ls .claude/rules | cat -A
security.md$
```

## Fix
Rename the file to plain ASCII: `git mv ".claude/rules/$(printf 'secur​ity.md')" .claude/rules/security-2.md`, then decide whether its contents belong anywhere. `ls | cat -A` or `find . -name '*[^ -~]*'` lists names with non-ASCII bytes.
