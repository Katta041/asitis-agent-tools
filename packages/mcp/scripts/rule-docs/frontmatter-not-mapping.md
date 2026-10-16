## Catches
Frontmatter that parses as a list, a number or a plain string instead of `key: value` pairs. Every tool that reads frontmatter expects a mapping at the top level.

## Bad
```markdown
---
- name: lint-fix
- description: Fix lint errors in changed files.
---
```
The leading `-` turns each line into a list item. The YAML is valid, but it is a list of two one-key maps, not a map with `name` and `description`, so the tool finds no fields at all.

## Good
```markdown
---
name: lint-fix
description: Fix lint errors in changed files. Use after a lint failure or when asked to clean up warnings.
---
```

## Fix
Remove the list markers so each field is `key: value` at the left margin. If the block holds a single word or sentence, it was probably meant to be the title; move it below the frontmatter and add real fields.
