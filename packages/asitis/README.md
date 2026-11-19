# asitis

The short name for the `asitis` CLI. It checks CLAUDE.md, AGENTS.md, SKILL.md, Cursor rules and other agent steering files for hidden instructions, invisible characters, token budget and files your agent never loads. Read-only: it never writes, runs or fetches anything.

```bash
npx -y asitis@0.4.7 lint
```

This package only points at [@asitis/mcp](https://www.npmjs.com/package/@asitis/mcp), pinned to the same version, where the CLI and the MCP server live. Docs, the rule list, the GitHub Action and the Claude Code plugin are in the [main repo](https://github.com/Katta041/asitis-agent-tools).

In CI on pull requests from people you don't trust, add `--prefix=~/` so npx doesn't run a copy committed in the project's `node_modules`. [docs/ci.md](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/ci.md) explains why.

MIT
