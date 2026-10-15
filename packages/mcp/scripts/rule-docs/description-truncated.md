## Catches
A skill whose `description` plus `when_to_use` is over 1,536 characters. Claude Code cuts the combined text at that length in the skill listing, so whatever comes after is never seen when Claude decides which skill to use.

## Bad
```markdown
---
name: data-export
description: Export data from the warehouse to CSV, Parquet or Excel with the column mapping in docs/columns.md. Supports incremental exports by watermark column, full snapshots, partitioned output by date, ... (900 characters)
when_to_use: Use when the user asks for an export, a dump, a report file, a spreadsheet, a CSV, a Parquet file, ... (800 characters)
---
```
Everything past character 1,536 is cut, which here removes most of `when_to_use`, the part that tells Claude when to pick the skill.

## Good
```markdown
---
name: data-export
description: Export warehouse data to CSV, Parquet or Excel. Use when asked for an export, a dump, a spreadsheet or a report file.
---
```

## Fix
Put the key use case in the first sentence and cut the rest. Format options and edge cases belong in the body.
