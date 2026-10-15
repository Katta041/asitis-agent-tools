## Catches
A relative link whose target file does not exist, or whose `#anchor` matches no heading in the target (or in the same file for a bare `#anchor`). Anchors are compared the way GitHub builds them: lowercase, punctuation dropped, spaces to hyphens, with `-1`, `-2` suffixes for repeated headings. External URLs, `/site-absolute` paths and template placeholders such as `${GITHUB_SERVER_URL}` are not checked.

## Bad
```markdown
See [the architecture notes](docs/architecture.md) and [running tests](docs/testing.md#running).
```
The file is `docs/ARCHITECTURE.md` (case matters on Linux and in git), and `docs/testing.md` has a heading "Running the tests", whose anchor is `#running-the-tests`. An agent told to read the architecture notes before changing a module finds nothing and carries on without them.

## Good
```markdown
See [the architecture notes](docs/ARCHITECTURE.md) and [running tests](docs/testing.md#running-the-tests).
```

## Fix
Fix the path or the anchor, or delete the link if the file is gone. For an anchor, copy the heading text and let the message tell you the slug it expects.
