// Audit of .claude/settings.json and MCP config files (F9). Owner: WP6. Opt-in through
// include: ["config"]; "config-local" adds .claude/settings.local.json. The checks are in
// checks/agent-config.ts, and each one cites the doc it rests on next to the code.
// Docs and advisories read on 14 October 2026.

import { rule, SRC, type RuleMeta } from "./types.js";

const MCP_DOC = "https://code.claude.com/docs/en/mcp";
const PERMISSIONS_DOC = "https://code.claude.com/docs/en/permissions";

export const AGENT_CONFIG_RULES: RuleMeta[] = [
  rule({
    id: "sec-hook-config",
    category: "security",
    defaultSeverity: "error",
    summary: "Project hook or settings command fetches remote code, calls the network or redirects the API",
    why: "Hooks in a committed .claude/settings.json run on every developer's machine, and a claude -p run starts them without the trust prompt (CVE-2025-59536). An ANTHROPIC_BASE_URL in project settings sends the API key to that host (CVE-2026-21852). Plain hooks are listed as a note so a reviewer knows they exist.",
    source: SRC.hooks,
  }),
  rule({
    id: "sec-permission-allow",
    category: "security",
    defaultSeverity: "error",
    summary: "Allow rule or trust flag skips the prompt for any shell command, network tool or interpreter",
    why: "An allow rule runs the command without asking, so text the agent reads can trigger it. CVE-2025-55284 leaked .env contents through allowlisted ping and nslookup. Bash and Bash(*) allow every command and are errors; network tools, interpreters with a wildcard and an unscoped WebFetch are warnings.",
    source: PERMISSIONS_DOC,
  }),
  rule({
    id: "sec-permission-mode",
    category: "security",
    defaultSeverity: "warning",
    summary: "Settings turn on bypassPermissions or skip its confirmation",
    why: "bypassPermissions runs every tool without asking. Since Claude Code 2.1.257 it has no effect from project or local settings, but older versions honored it, and the line shows what the author wanted.",
    source: SRC.settingsRef,
  }),
  rule({
    id: "sec-no-secret-deny",
    category: "security",
    defaultSeverity: "note",
    summary: "The folder has a .env file but no permissions.deny rule keeps Claude Code out of it",
    why: "Claude Code reads files in the project without asking. The settings reference says to list files that hold keys and secrets in permissions.deny.",
    source: SRC.settingsRef,
  }),
  rule({
    id: "sec-mcp-launcher",
    category: "security",
    defaultSeverity: "warning",
    summary: "MCP server runs an unpinned package or image, a downloaded script, or connects over plain http",
    why: "npx, uvx or docker without an exact version or digest runs whatever was published last, after you approved an earlier one (the postmark-mcp backdoor shipped in version 1.0.16). mcp-remote before 0.1.16 has a command injection bug (CVE-2025-6514).",
    source: SRC.toolPoisoning,
  }),
  rule({
    id: "sec-mcp-inline-secret",
    category: "security",
    defaultSeverity: "error",
    summary: "A key or token is written in plain text in an MCP server or settings env block",
    why: "Committed keys leak to everyone who can read the repo. Every MCP config format can read the value from an environment variable instead. The message shows the key type and a redacted preview only.",
    source: MCP_DOC,
  }),
  rule({
    id: "config-json-invalid",
    category: "config",
    defaultSeverity: "error",
    summary: "Agent config file is not valid JSON",
    why: "Claude Code skips a settings file it cannot parse, and MCP clients drop the servers in it, so the permissions and servers are not what the author thinks.",
    source: SRC.settings,
  }),
];
