## Catches
An MCP server in `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` or `.gemini/settings.json` started from an unpinned package (`npx -y foo`, `npx foo@latest`, `uvx foo`, `pipx run foo`), a container image with no tag or `:latest`, or a git source with no commit or tag. Also a server reached over plain `http` to a non-local host. Errors for a shell wrapper (`sh -c "..."`) whose command downloads and runs code or decodes base64 and runs it, and for `mcp-remote` pinned below 0.1.16 (CVE-2025-6514). A package that matches one of the repository's own workspace folders is skipped. Needs `--include config`.

## Bad
```json
{
  "mcpServers": {
    "db": { "command": "npx", "args": ["-y", "@example/db-server"] }
  }
}
```
`npx -y` fetches whatever version was published last and runs it on every start. A compromised or typosquatted publish runs on every developer's machine the next morning.

## Good
```json
{
  "mcpServers": {
    "db": { "command": "npx", "args": ["-y", "@example/db-server@1.4.2"] }
  }
}
```
Better still, install the package in the repository (`devDependencies`, lockfile) and run it with `node node_modules/@example/db-server/dist/cli.js`.

## Fix
Pin an exact version (`package@1.2.3`, `package==1.2.3`), an image digest or version tag, or a commit at the end of a git URL. Or vendor the server and start it from a path in the repository. Use https for remote servers. Replace a shell wrapper that downloads code with a direct command and arguments.
