## Catches
A relative link that resolves outside the folder asitis was allowed to read, so it could not be checked. It is a note: the link may be fine.

## Bad
```markdown
Follow the [company style guide](../../standards/STYLE.md).
```
The target is two folders above the repository. asitis never reads outside its root, so it cannot say whether the file exists. For an agent working in a clone, or in CI, the file is usually not there either.

## Good
```markdown
Follow the [company style guide](docs/STYLE.md) (copied from the standards repo, 2026-09).
```

## Fix
Vendor the file into the repository, or link to a URL everyone can reach. If the layout is a monorepo and the file is always present, run asitis with a `--root` that contains both so the link is checked.
