# sec-mcp-launcher

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

MCP server runs an unpinned package or image, a downloaded script, or connects over plain http.

An MCP server in `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` or `.gemini/settings.json` started from an unpinned package (`npx -y foo`, `npx foo@latest`, `uvx foo`, `pipx run foo`), a container image with no tag or `:latest`, or a git source with no commit or tag. Also a server reached over plain `http` to a non-local host. Errors for a shell wrapper (`sh -c "..."`) whose command downloads and runs code or decodes base64 and runs it, and for `mcp-remote` pinned below 0.1.16 (CVE-2025-6514). A package that matches one of the repository's own workspace folders is skipped. Needs `--include config`.

## Why it matters

npx, uvx or docker without an exact version or digest runs whatever was published last, after you approved an earlier one (the postmark-mcp backdoor shipped in version 1.0.16). mcp-remote before 0.1.16 has a command injection bug (CVE-2025-6514).

## Bad example

```json
{
  "mcpServers": {
    "db": { "command": "npx", "args": ["-y", "@example/db-server"] }
  }
}
```
`npx -y` fetches whatever version was published last and runs it on every start. A compromised or typosquatted publish runs on every developer's machine the next morning.

## Good example

```json
{
  "mcpServers": {
    "db": { "command": "npx", "args": ["-y", "@example/db-server@1.4.2"] }
  }
}
```
Better still, install the package in the repository (`devDependencies`, lockfile) and run it with `node node_modules/@example/db-server/dist/cli.js`.

## How to fix

Pin an exact version (`package@1.2.3`, `package==1.2.3`), an image digest or version tag, or a commit at the end of a git URL. Or vendor the server and start it from a path in the repository. Use https for remote servers. Replace a shell wrapper that downloads code with a direct command and arguments.

## Suppress or configure

`sec-mcp-launcher` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-mcp-launcher": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Invariant Labs: MCP tool poisoning attacks](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-mcp-launcher.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).
