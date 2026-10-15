## Catches
A relative link whose target file does not exist, or whose `#anchor` matches no heading in the target (or in the same file for a bare `#anchor`). Anchors are compared the way GitHub builds them: lowercase, punctuation dropped, spaces to hyphens, with `-1`, `-2` suffixes for repeated headings. Anchors also match with emoji variation selectors (U+FE0F) removed, as VS Code and most renderers build them. External URLs, `/site-absolute` paths, template placeholders such as `${GITHUB_SERVER_URL}` and single words with no dot or slash (`[Smith et al.](url)`) are not checked, and a link into a git submodule named in `.gitmodules` counts as present, since a plain clone leaves the submodule folder empty.

A path that is missing next to the file but exists from the repository root (`docs/x.md` written in `.cursor/rules/a.mdc`) is a note: an agent working from the root finds it, but editors and Markdown viewers do not.

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
