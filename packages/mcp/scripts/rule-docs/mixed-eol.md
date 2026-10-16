## Catches
A file that uses more than one line ending: some lines end in CRLF, others in LF (or bare CR). The message gives the counts. It is a note: agents read the file fine. The problem is the next edit.

## Bad
```text
$ file CLAUDE.md
CLAUDE.md: Unicode text, UTF-8 text, with CRLF, LF line terminators
```
One contributor on Windows pasted a section into a file that was LF. The next editor or formatter that normalises line endings turns a one-line change into a diff that touches every line, which hides the real change in review.

## Good
```text
$ file CLAUDE.md
CLAUDE.md: Unicode text, UTF-8 text
```

## Fix
Pick one ending for the repository. Add `* text=auto eol=lf` to `.gitattributes`, run `git add --renormalize .` and commit. Until then, edit minimal ranges so the existing endings stay as they are.
