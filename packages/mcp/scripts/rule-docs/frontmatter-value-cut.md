## Catches
An unquoted value that contains a space followed by `#`. YAML reads everything from the ` #` on as a comment, so the stored value is shorter than what the author typed. The message shows the text that was dropped.

## Bad
```markdown
---
name: triage
description: Triage a GitHub issue #123 style reference and label it. Use when given an issue number.
---
```
The description Claude Code reads is `Triage a GitHub issue`. The part that says when to use the skill is gone, and nothing warns the author.

## Good
```markdown
---
name: triage
description: "Triage a GitHub issue #123 style reference and label it. Use when given an issue number."
---
```

## Fix
Put the value in double quotes. The same applies to `argument-hint: [issue #]`, `globs` and any other field whose value contains ` #`.
