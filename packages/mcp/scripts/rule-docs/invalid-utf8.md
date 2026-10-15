## Catches
Bytes that are not valid UTF-8 in a file that is otherwise UTF-8. The message gives the byte offset of the first bad sequence and the count. The usual cause is a file saved as Latin-1 or Windows-1252 that contains an accented letter, a curly quote or a dash.

## Bad
```text
$ grep -n -P '[^\x00-\x7F]' AGENTS.md | head -1
14:- Ask Ren� before changing the billing module.
```
The `é` in a name was written as the single byte `E9` by an editor set to Windows-1252. An agent that decodes the file as UTF-8 reads U+FFFD there, and a tool that re-saves it writes the replacement character back, so the name is now wrong in the repository.

## Good
```text
14:- Ask René before changing the billing module.
```
Saved as UTF-8, `é` is the two bytes `C3 A9`.

## Fix
Convert the file: `iconv -f WINDOWS-1252 -t UTF-8 AGENTS.md > tmp && mv tmp AGENTS.md`. Then set the editor's default encoding to UTF-8. If only one character is wrong, retype it.
