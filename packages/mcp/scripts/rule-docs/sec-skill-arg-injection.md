## Catches
A `SKILL.md` line where a skill argument (`$ARGUMENTS`, `$0`, `$ARGUMENTS[1]` or a named argument) sits inside a `` !`command` `` or a ` ```! ` block. Claude Code runs those commands when the skill loads, after it has pasted the arguments in. Needs `--include skills`.

## Bad
```markdown
---
name: pr-summary
description: Summarise a pull request. Use when asked about a PR by number.
---
- PR diff: !`gh pr diff $ARGUMENTS`
```
`/pr-summary "12; echo hello"` runs `gh pr diff 12` and then `echo hello`, on the user's machine, before Claude reads anything. Swap `echo hello` for anything and it still runs.

## Good
```markdown
---
name: pr-summary
description: Summarise a pull request. Use when asked about a PR by number.
---
Summarise pull request $ARGUMENTS. Run `gh pr diff <number>` yourself after checking it is a number.
```

## Fix
Keep arguments out of `!` commands. Give the argument to Claude in the text and let it run the command through the normal permission prompt. If the command has to run at load time, call a script in the skill folder that checks the value (a number, a known branch name) before it uses it.
