## Catches
A steering file AsItIs could not lint although the agent tools load it: a `CLAUDE.md` or `AGENTS.md` (any steering file name) that is a symlink to a file that isn't markdown or that lives outside the project folder, and an `@import` of a text file that isn't markdown, such as `@notes.txt`.

## Bad
```console
$ ls -l
CLAUDE.md -> notes.txt
```
Claude Code follows the link and loads `notes.txt` as the project instructions. AsItIs reads only markdown, so before this rule it skipped the file with a notice and the CI gate passed, whatever `notes.txt` hid.

```markdown
# CLAUDE.md

See @notes.txt
```
Claude Code loads `notes.txt` with the instructions; AsItIs doesn't open it.

## Good
```console
$ ls -l
CLAUDE.md -> AGENTS.md
```
A link to a markdown file inside the project is linted like any other file.

## Fix
Replace the link with the file itself, or point it at a markdown file inside the project. For an import of a text file, rename the file to `.md` so it gets linted, or review it by hand. The symlink case is an error by default so the default `--fail-on error` stops it in CI; the import case is a warning, because `@package.json` and similar imports are common and rarely hide anything.
