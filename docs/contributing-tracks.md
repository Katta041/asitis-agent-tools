# Working on a 0.3.0 track

0.3.0 is built as one foundation (WP0, already on `main`) and eight tracks that run in parallel, one branch and worktree each. These rules keep the tracks from colliding. The output contract is in [cli-contract.md](cli-contract.md).

## Who owns what

Only the owner edits a file. Every file below exists already, as a stub where the track has not landed, so imports resolve from day one. Paths are under `packages/mcp/` unless they start with `/`.

| Track | Owns |
|---|---|
| WP0 foundation | `src/server.ts`, `src/paths.ts`, `src/kinds.ts`, the types in `src/lint.ts`, `src/findings.ts`, `src/project.ts`, `src/redact.ts`, `src/checks/index.ts`, `src/rules/registry.ts`, `src/rules/types.ts`, `src/rules/core.meta.ts`, `src/rules/spec.meta.ts`, `src/rules/security.meta.ts`, `test/registry.test.ts`, `test/foundation.test.ts`, `/docs/cli-contract.md`, this file |
| WP1 CLI and formats | `src/cli/` (entry `src/cli/asitis.ts`), `src/format/{text,json,sarif,github}.ts`, `scripts/build.mjs`, the `bin` field of `package.json`, the bundle copies `plugins/asitis/server/asitis.mjs` and `/action/asitis.mjs`, `schema/report-1.json` |
| WP2 config, suppression, baseline | `src/config.ts`, `src/suppress.ts`, `src/baseline.ts`, `src/policy/asitisrc.ts`, `src/rules/suppress.meta.ts`, `schema/asitisrc-1.json` |
| WP3 Action and pre-commit | `/action.yml`, `/action/README.md`, `/.pre-commit-hooks.yaml`, `/.github/workflows/action-selftest.yml`, `/docs/ci.md`, `/test-fixtures/ci/` |
| WP4 drift | `src/checks/drift.ts`, `src/rules/drift.meta.ts` |
| WP5 skill scan | `src/checks/skills.ts`, `src/scan-script.ts`, `src/policy/skill-script.ts`, `src/rules/skills.meta.ts` |
| WP6 agent config audit | `src/checks/agent-config.ts`, `src/jsonmap.ts`, `src/policy/agent-config.ts`, `src/rules/agent-config.meta.ts` |
| WP7 fixes | `src/fix.ts`, `src/diff.ts`, `src/fixes/` |
| WP8 rule docs | `scripts/gen-rule-docs.mjs`, `/docs/rules/` |
| WP9 integration and release | version files, READMEs, the CHANGELOGs, plugin commands, `/packages/cli/` |

Each track also owns its own tests (`test/<track>.test.ts`, plus any `test/<track>-*.test.ts`) and fixtures under `/test-fixtures/<track-name>/`.

## Shared files

`server.ts`, `paths.ts`, `kinds.ts`, the public types in `lint.ts`, `findings.ts`, `project.ts`, `rules/registry.ts` and `checks/index.ts` are shared. Nobody but the WP0 owner edits them after day 1. If your track needs a change there (a new field on `CheckContext`, a new file kind in `classify()`, a new read class), open an issue or message the WP0 owner with the exact change; do not patch it on your branch, even temporarily.

`package.json` is shared too: WP1 adds the `bin` entry and nothing else changes there. A track that needs a dev dependency asks WP0. Runtime dependencies are not allowed at all.

## Adding or activating a rule

1. The id is already reserved in your track's `rules/*.meta.ts` with `planned(...)`. Use that id. If you need a new one, add it to your own meta file; never to `core.meta.ts`.
2. In the commit that makes your code emit the rule, change `planned(...)` to `rule(...)` for it. `test/registry.test.ts` fails if code emits a planned or unregistered id, or if an active rule is never emitted.
3. Emit rule ids as string literals where the registry test can see them: the second argument of `Collector.add(severity, "rule-id", ...)` in `lint.ts`, or a `rule: "rule-id"` property in an `Issue` you pass to `ctx.report(...)`.
4. Security rules (category `security`, and every `sec-*` id) are never suppressible inline. That comes from the category; do not try to override it.
5. Each rule needs `summary` (under 100 characters, no final period), `why`, a `source` URL and the right `defaultSeverity`. WP8 turns these into the rule pages.

## Project checks

Drift, skills and agent-config checks run inside `lintProject` (`project.ts`), after the per-file lint and before `applyConfig`. A check gets a `CheckContext`:

- `docs` and `results`: the markdown files linted in this call.
- `include`: the opt-ins of this call. The skills check runs only with `skills`, the agent-config check only with `config`.
- `discovered`: true for a whole-folder run, false when the caller named files. Cross-file drift rules should only fire on whole-folder runs, or when every file they compare was named.
- `otherTargets` and `claim()`: non-markdown paths the caller named (pre-commit passes changed scripts). Claim the ones you handle.
- `report(path, issue, file?)`: add a finding. For a file that is not linted markdown, pass `file: { kind: "skill-script" | "agent-config", lineText }` so fingerprints work.
- `note(text)`: a one-line notice for the user.

Set `ready: true` on your check when it works. While it is `false`, asking for its include value prints "not available in this build yet" and reads nothing.

## Reading files

Only `Sandbox` reads files. Use `sandbox.openAs("skill-script" | "agent-config" | "asitisrc", path, { grants: ctx.include })`; it applies the shared refusals (`.env*`, `.git`, `node_modules`, Windows streams) and then your policy. Use `headBytes: 4` for magic bytes. Use `sandbox.listDir()` to see a folder. Never import `node:fs` in a track file.

Messages never echo secrets or config values: quote file text only through `preview()` from `redact.ts` (redacted, at most 80 characters), and config values only as a key path plus `redactValue()`.

## Invariants every track keeps

- `npm test` is green on your branch, on Node 22 and 24, on Linux, macOS and Windows.
- No write, exec or network code anywhere in `src/`. `test/package.test.ts` scans every file under `src/`, subfolders included, for `child_process`, network modules, `fetch(`, `eval(`, `Function(` and file-writing calls. A detector that looks for those words must build its pattern so the source text does not contain them (`/\beval\s*\(/` is fine; the string `"eval("` is not).
- The bundles import only the Node modules the server bundle already uses.
- MCP tool results stay text-only by default; `structuredContent` only with `--structured`.
- Scanners stay linear: forward `indexOf`, bounded slices, no nested or lazy quantifiers over unbounded input. Add your inputs to the DoS tests.
- Output of the existing tools does not change unless your track is meant to change it, and then the change is listed in your changelog entry.
- Security fixtures are defanged: `example.invalid` hosts, `echo hello` payloads, no executable bits, and no real or real-looking keys in one piece (build them from parts in the test).

## Changelog

Do not edit `CHANGELOG.md`. Write `changes/unreleased/<track>.md` (for example `changes/unreleased/wp4.md`) with Keep a Changelog sections (`### Added`, `### Changed`, `### Fixed`). WP9 merges them.

## Merging

Day 5 merges in this order: WP1, WP2, WP4, WP5, WP6, WP7, WP8, then WP3 against the merged CLI. Rebase on `main` before asking for review. WP9 regenerates the rule pages after WP4 to WP6 land, since they add rules.

## Copy rules

No em-dashes, no emoji and no AI attribution lines in code, comments, docs or commit messages. A test checks every tracked file. Write plainly: say what the code does and why, with the specific file, number or case.
