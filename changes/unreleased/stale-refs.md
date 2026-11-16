### Added

- `stale-path` (warning): a repo path in backticks, such as `src/api/routes.ts` or `packages/web/`, that is not in the repository. It checks only paths with two or more parts that end in an extension or a slash and whose top folder exists, and skips globs, placeholders, fenced blocks, example sections, gitignored and generated paths, and paragraphs about another repository. A path that exists anywhere in the repo with the same ending is fine.
- `dead-command` (warning): `npm run`, `npm test`, `pnpm`, `yarn` and `bun run` commands whose script is in no `package.json`, and `make` targets the Makefile does not define. Workspace scripts up to three folders deep count; commands with workspace or folder flags, or after `cd`, are not checked.
- A `project-files` read class for `package.json`, Makefile and `.gitignore` files. Only names are kept from them.
