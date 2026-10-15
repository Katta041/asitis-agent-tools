## Catches
A skill `name` that contains `anthropic` or `claude`, in any case.

## Bad
```markdown
---
name: claude-code-review
description: Review a pull request against the team checklist. Use when asked to review a PR.
---
```
Claude Code loads this. Uploading the same skill to the Claude API or adding it in claude.ai fails, because both reject names that contain a reserved word.

## Good
```markdown
---
name: code-review
description: Review a pull request against the team checklist. Use when asked to review a PR.
---
```

## Fix
Drop the vendor name. The skill already runs inside the product; the name should say what it does.
