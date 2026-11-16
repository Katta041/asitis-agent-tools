## Catches
An `npm run`, `npm test`, `pnpm`, `pnpm run`, `yarn`, `yarn run` or `bun run` command whose script is in no `package.json`, and a `make` target that the Makefile does not define. Commands are read from inline code spans and from shell code blocks (no language, `sh`, `bash`, `shell`, `console`, `zsh` or `fish`). The script is looked up in the nearest `package.json` above the steering file, then in every `package.json` up to three folders below the root, so a workspace script counts. Make targets are looked up in the nearest `Makefile`, `makefile` or `GNUmakefile`.

Not reported: commands with workspace or folder flags (`-w`, `--filter`, `--prefix`, `-C`, `-r`), commands after `cd` or `pushd` in the same block, placeholders such as `npm run <script>`, and a folder with no `package.json`. `yarn`, `pnpm` without `run` and `bun run` also start binaries from `node_modules/.bin`, so for them only names that read as scripts (`build`, `lint`, `test:unit`) are checked, and never the name of a dependency. Makefiles with `include` lines, pattern rules or targets built from variables are not checked, because their targets cannot be listed without running make.

## Bad
```markdown
## Commands

- `npm run typecheck` before you push
- `make deploy-staging` to ship a preview
```
`package.json` has `build`, `lint` and `test`; `typecheck` was folded into `lint`. The Makefile target is now `deploy-preview`. An agent following this file gets "Missing script: typecheck" and "No rule to make target", then spends turns looking for the right command.

## Good
```markdown
## Commands

- `npm run lint` before you push (it also type-checks)
- `make deploy-preview` to ship a preview
```

## Fix
Change the command to the script or target that exists now, or add the script to `package.json` (or the target to the Makefile) if the command is right and the definition is missing.
