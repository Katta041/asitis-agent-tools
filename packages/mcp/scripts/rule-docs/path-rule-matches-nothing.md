## Catches
A Claude Code rule with `paths`, a Cursor rule with `globs` or a Copilot instructions file with `applyTo` whose patterns match no file in the project. These files load only for matching files, so this one never loads. It usually happens after a folder is renamed. Only runs when the whole folder is linted, and stays quiet when the folder walk was cut short or a pattern points into a folder AsItIs does not walk (such as `node_modules` or `dist`).

## Bad
```markdown
---
paths:
  - "src/legacy-api/**/*.ts"
---
# API rules
```
The API moved to `src/api/` last year. Nothing matches `src/legacy-api/`, so Claude never sees these rules.

## Good
```markdown
---
paths:
  - "src/api/**/*.ts"
---
# API rules
```

## Fix
Point the pattern at the files it is meant for, or delete the rule if the code is gone. A pattern with no slash, like `*.sql`, matches that file name in any folder; one with a slash is relative to the folder that holds `.claude` (Claude Code), `.cursor` (Cursor) or the workspace root (Copilot).
