## Catches
A skill `name` with uppercase letters, spaces, underscores, dots, or a hyphen at the start, end or doubled. The Agent Skills spec allows lowercase letters, digits and single hyphens. Lowercase letters outside ASCII (such as `é`) are a warning rather than an error: the spec accepts them, the Claude API and claude.ai do not. The message suggests a valid name when it can.

## Bad
```markdown
---
name: PDF_Processing
description: Extract text and tables from PDF files. Use when working with PDFs or forms.
---
```
`skills-ref validate` rejects this, and an upload to the Claude API or claude.ai fails. Claude Code loads it, so the author does not notice until the skill is shared.

## Good
```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files. Use when working with PDFs or forms.
---
```

## Fix
Use the name from the message (`pdf-processing` for `PDF_Processing`) and rename the folder to match. Lowercase everything, replace spaces, underscores and dots with one hyphen, and trim hyphens from the ends.
