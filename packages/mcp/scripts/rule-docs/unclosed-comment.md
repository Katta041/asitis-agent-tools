## Catches
A `<!--` with no matching `-->` anywhere after it. Rendered views hide everything from that point to the end of the file.

## Bad
```markdown
# Contributing

<!-- draft section, remove before merging

## Release process

1. Tag the commit.
2. Run `make publish`.
```
The comment was never closed, so GitHub shows a file that ends after "Contributing". The agent reads the release process, and the reviewer never sees that `make publish` is in there.

## Good
```markdown
# Contributing

## Release process

1. Tag the commit.
2. Run `make publish`.
```

## Fix
Close the comment with `-->` where it was meant to end, or delete the `<!--`. Then reread the part that was hidden.
