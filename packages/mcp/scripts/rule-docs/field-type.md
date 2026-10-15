## Catches
A frontmatter field whose value has the wrong shape for the tool that reads it: a boolean written as a quoted string, a list given as a number, `tools` given as a map, `paths` given as a map. The message names the field and the type it needs.

## Bad
```markdown
---
description: Project conventions
globs: src/**/*.ts
alwaysApply: "true"
---
```
In a Cursor `.mdc` rule, `alwaysApply` must be a YAML boolean. `"true"` in quotes is a string, which Cursor does not treat as true, so the rule only applies to files matching `globs`. In a skill, `disable-model-invocation: "nope"` and `allowed-tools: 3` are the same class of mistake.

## Good
```markdown
---
description: Project conventions
globs: src/**/*.ts
alwaysApply: true
---
```

## Fix
Booleans are unquoted `true` or `false` (Claude Code skills also accept `yes`, `no`, `on`, `off`, `1` and `0`). `allowed-tools`, `disallowed-tools`, `paths`, `globs` and subagent `tools` take a string or a list of strings. `description` is a string.
