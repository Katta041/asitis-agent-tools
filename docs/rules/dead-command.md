# dead-command

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| format | warning | one file | no | yes |

## What it catches

npm, pnpm, yarn, bun or make command runs a script or target that is not defined.

An `npm run`, `npm test`, `pnpm`, `pnpm run`, `yarn`, `yarn run` or `bun run` command whose script is in no `package.json`, and a `make` target that the Makefile does not define. Commands are read from inline code spans and from shell code blocks (no language, `sh`, `bash`, `shell`, `console`, `zsh` or `fish`). The script is looked up in the nearest `package.json` above the steering file, then in every `package.json` up to three folders below the root, so a workspace script counts. Make targets are looked up in the nearest `Makefile`, `makefile` or `GNUmakefile`.

Off by default. It reads `package.json` and Makefile files, so it runs only with `--include config` (CLI) or `include: ["config"]` (`lint_steering`), like the other checks that read files besides markdown. Only script, dependency and target names are kept from those files, never a script body.

Not reported: commands with workspace or folder flags (`-w`, `--filter`, `--prefix`, `-C`, `-r`), commands after `cd` or `pushd` in the same block, placeholders such as `npm run <script>`, and a folder with no `package.json`. `yarn`, `pnpm` without `run` and `bun run` also start binaries from `node_modules/.bin`, so for them only names that read as scripts (`build`, `lint`, `test:unit`) are checked, and never the name of a dependency. Makefiles with `include` lines, pattern rules or targets built from variables are not checked, because their targets cannot be listed without running make.

## Why it matters

An agent told to run a script that was renamed or removed gets an error, then spends turns hunting for the right command or skips the check altogether.

## Bad example

```markdown
## Commands

- `npm run typecheck` before you push
- `make deploy-staging` to ship a preview
```
`package.json` has `build`, `lint` and `test`; `typecheck` was folded into `lint`. The Makefile target is now `deploy-preview`. An agent following this file gets "Missing script: typecheck" and "No rule to make target", then spends turns looking for the right command.

## Good example

```markdown
## Commands

- `npm run lint` before you push (it also type-checks)
- `make deploy-preview` to ship a preview
```

## How to fix

Change the command to the script or target that exists now, or add the script to `package.json` (or the target to the Makefile) if the command is right and the definition is missing.

## Suppress or configure

For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:

```markdown
<!-- asitis-disable-next-line dead-command -- why this one is fine -->
```

For a whole file:

```markdown
<!-- asitis-disable-file dead-command -- why this file is an exception -->
```

For every file, turn it off or change its severity in `.asitisrc.json`:

```json
{ "rules": { "dead-command": "off" } }
```

A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.

## Source

[Claude Code docs: How Claude remembers your project](https://code.claude.com/docs/en/memory), read on 16 November 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/dead-command.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
