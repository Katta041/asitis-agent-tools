# Contributing

Issues and pull requests are welcome.

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
- **Bump versions together.** `packages/mcp/package.json`, `packages/mcp/src/version.ts`, `plugins/asitis/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` must agree; a test checks them.
- **Fixtures are byte-exact.** Never open and save files under `test-fixtures/` in an editor. Add new fixtures with a script or `printf`, and use simulated content only.
- **Copy style.** No em-dashes and no emoji in code, comments or docs. A test checks every authored file.
- Errors a user can cause must be one clear line and a non-zero exit, not a stack trace.

## Releasing

Releases are cut by a maintainer with the manual `release` workflow, which publishes `@asitis/mcp` to npm with trusted publishing and provenance.
