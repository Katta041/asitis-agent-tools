## Catches
A steering file that a sync tool (rulesync, Ruler) generates from a source file, where the generated copy no longer matches what the source would produce. Only runs when the whole folder is linted.

## Bad
```text
.rulesync/rules/testing.md     # the source
.cursor/rules/testing.mdc      # generated from it, then edited by hand to add a line
```
The next `rulesync generate` overwrites the hand edit. Nobody notices until Cursor stops following the added line.

## Good
```text
.rulesync/rules/testing.md     # edited here
.cursor/rules/testing.mdc      # regenerated, identical to what the source produces
```

## Fix
Make the edit in the source file and rerun the generator. Run the generator's check mode in CI so a hand edit fails the build instead of disappearing later.
