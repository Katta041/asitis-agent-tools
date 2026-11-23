# Install in other tools

Claude Code, Claude Desktop, Codex, Gemini CLI and VS Code are covered in the [README](../README.md#other-mcp-clients-claude-desktop-cursor-codex-gemini-cli). This page has the rest.

Every config here starts the same server, `npx --prefix=~/ -y @asitis/mcp@0.4.8 --root <project>`. Versions before 0.4.2 need `npx -y -p @asitis/mcp@<version> asitis-mcp` instead, because a bare `npx @asitis/mcp` stops with "could not determine executable to run" there. Two more things matter everywhere:

- **Pin the version.** Never use `@latest` in an agent config.
- **Keep `--prefix=~/`.** Many clients start the server inside the project, and there npx would run a `node_modules/@asitis/mcp` (or read an `.npmrc`) that the repo commits. `--prefix=~/` makes npx look in your home folder instead.
- **Give `--root` the project folder as an absolute path**, unless the tool fills it in for you (Cursor does, with `${workspaceFolder}`). Most clients start servers from somewhere other than your project, and the server refuses your home folder and the filesystem root on purpose.

If the server can't start, it prints one line saying why, for example `Refusing your home folder (/Users/you) as the allowed folder`. Your client's MCP log shows that line.

## Cursor

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=asitis&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyItLXByZWZpeD1+LyIsIi15IiwiQGFzaXRpcy9tY3BAMC40LjgiLCItLXJvb3QiLCIke3dvcmtzcGFjZUZvbGRlcn0iXX0=)

Or put this in `.cursor/mcp.json` in the project:

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "${workspaceFolder}"]
    }
  }
}
```

Cursor sets `${workspaceFolder}` to the folder that contains `.cursor/mcp.json`. If you add the server to your global `~/.cursor/mcp.json` and it says it refused your home folder, move the entry into the project's `.cursor/mcp.json` or put the absolute path in its place.

The Cursor plugin in [`plugins/asitis-cursor`](../plugins/asitis-cursor) adds the same server plus a rule that runs `lint_steering` after the agent edits an AGENTS.md, a Cursor rule or a CLAUDE.md, and `/md-lint`, `/md-loads` and `/md-budget` commands. It hasn't been tested inside Cursor yet, see [its README](../plugins/asitis-cursor/README.md) for what's unconfirmed. The config above is the safer path.

## Devin Desktop (formerly Windsurf)

`.devin/mcp_config.json` in the project, or `~/.config/devin/mcp_config.json` for every project (`%APPDATA%\devin\mcp_config.json` on Windows):

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"]
    }
  }
}
```

Older Windsurf builds read `~/.codeium/windsurf/mcp_config.json`, same format.

## Cline

In the Cline panel: MCP Servers, Configure, Configure MCP Servers. For the Cline CLI the file is `~/.cline/data/settings/cline_mcp_settings.json`.

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

All seven tools only read, so you can list them in `autoApprove` if you'd rather not confirm each call: `read_markdown`, `outline`, `lint_steering`, `context_budget`, `load_plan`, `find_steering_files`, `suggest_fixes`.

## Kiro

`.kiro/settings/mcp.json` in the project, or `~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"]
    }
  }
}
```

## Zed

Settings, AI, MCP Servers, Add Local Server, or add it under `context_servers` in `settings.json`:

```json
{
  "context_servers": {
    "asitis": {
      "command": "npx",
      "args": ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"],
      "env": {}
    }
  }
}
```

## Goose

`goose configure`, Add Extension, Command-line Extension, then paste `npx --prefix=~/ -y @asitis/mcp@0.4.8 --root /absolute/path/to/project` as the command. Or in `~/.config/goose/config.yaml`:

```yaml
extensions:
  asitis:
    name: asitis
    type: stdio
    cmd: npx
    args: ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"]
    enabled: true
    timeout: 300
```

## Continue

A file in `.continue/mcpServers/` in the project, for example `.continue/mcpServers/asitis.yaml`. MCP tools only show up in agent mode.

```yaml
name: asitis
version: 0.4.8
schema: v1
mcpServers:
  - name: asitis
    type: stdio
    command: npx
    args: ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"]
```

## JetBrains AI Assistant

Settings, Tools, AI Assistant, Model Context Protocol (MCP), Add. Paste this JSON, or use Import from Claude if you already set it up in Claude Desktop:

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["--prefix=~/", "-y", "@asitis/mcp@0.4.8", "--root", "/absolute/path/to/project"]
    }
  }
}
```

## Docker

The [Dockerfile](../Dockerfile) runs the same prebuilt server the Claude Code plugin ships, with no dependencies. Mount the project read-only at `/workspace` and turn the network off, since the server never uses it:

From a checkout of this repository:

```bash
docker build -t asitis-mcp .
docker run -i --rm --network none --read-only -v "$PWD":/workspace:ro asitis-mcp
```

In a client config, `command` is `docker` and the rest goes in `args`:

```json
{
  "mcpServers": {
    "asitis": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "none", "--read-only", "-v", "/absolute/path/to/project:/workspace:ro", "asitis-mcp"]
    }
  }
}
```

## Anything else

Any client that can start a stdio MCP server works with `npx --prefix=~/ -y @asitis/mcp@0.4.8 --root /absolute/path/to/project`. The server is also in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Katta041/asitis-mcp) as `io.github.Katta041/asitis-mcp`, which some clients browse directly.
