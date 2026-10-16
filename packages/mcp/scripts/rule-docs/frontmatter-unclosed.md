## Catches
A file whose first line is `---` with no second `---` (or `...`) line after it, so the YAML block never ends.

## Bad
```markdown
---
name: deploy
description: Deploy the current branch to staging. Use when asked to deploy or ship to staging.

# Deploy

1. Run `make build`.
```
The closing `---` was lost in an edit. From the parser's point of view the heading and the steps are part of the YAML, which fails to parse, so the skill has no name and no description.

## Good
```markdown
---
name: deploy
description: Deploy the current branch to staging. Use when asked to deploy or ship to staging.
---

# Deploy

1. Run `make build`.
```

## Fix
Add a line containing only `---` after the last frontmatter field. Check that nothing between the two fences is indented or wrapped in a way that YAML cannot read.
