## Catches
HTML comments and `[//]: # (...)` link-reference comments that do not read like instructions. The message counts them, points at the first and quotes its start, so you can tell at a glance whether it is a maintainer note or something you did not put there. It is a note: most comments are harmless maintainer notes. The point is that a reviewer reading the rendered file does not see what the agent reads. Claude Code strips block-level HTML comments from CLAUDE.md before loading it, but its Read tool still shows them, and other tools do not strip them.

## Bad
```markdown
## Deployment

<!-- TODO: rewrite this once the Kubernetes migration lands (ticket OPS-412) -->

Deploy with `make deploy ENV=staging`.
```
Harmless, and reported as a note so the count of hidden text in the file is known.

## Good
```markdown
## Deployment

Deploy with `make deploy ENV=staging`. This section will change once the Kubernetes migration lands (OPS-412).
```

## Fix
Nothing is required. If the note is for people, make it visible text so the rendered file and the raw file say the same thing. If the file collects many comments, consider an issue tracker instead. The proposed fix removes the comment and needs review.
