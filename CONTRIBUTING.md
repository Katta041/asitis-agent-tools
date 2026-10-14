# Contributing

Issues and pull requests are welcome, and you do not need to write code to help.

## Ways to help

- **False positives and missed findings.** Use the [issue form](https://github.com/Katta041/asitis-agent-tools/issues/new/choose) and include the smallest file that shows the problem. These are the most useful reports we get, and they are treated as bugs.
- **Rule proposals.** Point to the vendor doc or spec the rule is based on, with one example that should be flagged and one that should not.
- **Vendor limit updates.** When Claude Code, Codex, Cursor, Gemini CLI or the Agent Skills spec changes a limit, update `packages/mcp/src/limits.ts` with the new number and its source link.
- **Code.** Issues labelled [`good first issue`](https://github.com/Katta041/asitis-agent-tools/labels/good%20first%20issue) are small and self-contained; [`help wanted`](https://github.com/Katta041/asitis-agent-tools/labels/help%20wanted) ones are larger. Comment on an issue before starting so two people do not do the same work.
- **Questions and patterns.** Use [Discussions](https://github.com/Katta041/asitis-agent-tools/discussions).

## Where things live

| Path | What it is |
|---|---|
| `packages/mcp/src/lint.ts` | The lint rules |
| `packages/mcp/src/scan.ts` | Linear-time scanners for comments, invisible characters and hidden text |
| `packages/mcp/src/limits.ts` | Vendor limits, each with its source |
| `packages/mcp/src/server.ts` | The MCP tools and their descriptions |
| `packages/mcp/test/` | Unit, adversarial input, security, protocol and packaging tests |
| `plugins/asitis/` | The Claude Code plugin: commands, skill, guard hook and the pinned server build |
| `test-fixtures/` | Byte-exact fixtures (see the rule below) |

## Setup

Node 22.13 or later.

```bash
npm ci
npm test
```

`npm test` typechecks, builds the bundle and runs the full suite (unit, adversarial input, security, stdio protocol, hook and packaging tests).

## Rules

- **Read-only stays read-only.** The server must not gain write, network or child-process code. A test scans `packages/mcp/src` for it.
- **Keep scanners linear.** New checks must pass the 10 MB adversarial inputs in `packages/mcp/test/dos.test.ts`.
- **Pin exact versions.** Dev dependencies use exact versions; there are no runtime dependencies and no install scripts.
- **Keep the plugin pin in sync.** After any change to `packages/mcp/src` or to dependencies, run `npm run sync-plugin` and commit the updated `plugins/asitis/server/` files. A test fails if the vendored bundle differs from a fresh build.
- **Bump versions together.** `packages/mcp/package.json`, `packages/mcp/server.json`, `packages/mcp/src/version.ts`, `plugins/asitis/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and the `@asitis/mcp@x.y.z` pins in both READMEs must agree; tests check them.
- **Fixtures are byte-exact.** Never open and save files under `test-fixtures/` in an editor. Add new fixtures with a script or `printf`, and use simulated content only.
- **Copy style.** No em-dashes and no emoji in code, comments or docs. A test checks every authored file.
- Errors a user can cause must be one clear line and a non-zero exit, not a stack trace.

## Adding a lint rule

1. Add the check in `packages/mcp/src/lint.ts` with a rule name in kebab-case and a message that says what is wrong and how to fix it, in one sentence.
2. Add a test with one input that should be flagged and one that should not. Most false positives come from the second case being missing.
3. If the rule enforces a vendor limit, put the number in `limits.ts` with a link to the docs.
4. Run `npm test`, then `npm run sync-plugin`, and commit the updated plugin server.

## Releasing

Releases are cut by a maintainer with the manual `release` workflow, which publishes `@asitis/mcp` to npm with trusted publishing and provenance.
