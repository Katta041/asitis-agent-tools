## Catches
An MCP server in `.mcp.json` or settings started from an unpinned package (`npx -y foo`, `npx foo@latest`, `uvx foo`), a container image without a digest, or a shell wrapper (`sh -c "..."`). Needs `--include config`.

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
Pin an exact version or image digest, or vendor the server and start it from a path in the repository. Replace shell wrappers with a direct command and arguments.
