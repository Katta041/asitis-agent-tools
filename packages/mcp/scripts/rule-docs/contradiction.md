## Catches
Two lines in one file that give the same instruction with opposite polarity: "always X" and "never X", "do X" and "do not X", "prefer X" and "avoid X". The action is compared after removing case, punctuation and emphasis, so the rule looks for the same wording, not for every logical conflict. Items under a heading or parent bullet that lists things to avoid ("Don'ts", "Anti-patterns") are read as negative.

## Bad
```markdown
- Always run the full test suite before pushing.
...
- Don't run the full test suite before pushing; CI does it.
```
The second line was added months later when CI got faster. Claude Code's docs say that when two instructions contradict, Claude may pick either one, so sometimes it runs the suite and sometimes it does not.

## Good
```markdown
- Run only the tests for the package you changed before pushing; CI runs the full suite.
```

## Fix
Decide which rule is current, delete the other, and say why if the reason is not obvious. If both are right in different situations, state the condition in one line instead of keeping two rules.
