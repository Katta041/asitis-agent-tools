// Audit of .claude/settings.json and MCP config files (F9). Owner: WP6. Opt-in through
// include: ["config"]. Flip status to active (use rule() instead of planned()) in the same commit
// that makes checks/agent-config.ts emit the rule.

import { planned, SRC, type RuleMeta } from "./types.js";

export const AGENT_CONFIG_RULES: RuleMeta[] = [
  planned({ id: "sec-hook-config", category: "security", defaultSeverity: "error", summary: "Hook fetches remote code, evaluates input or runs an unpinned package", why: "Project hooks run on the developer's machine when Claude Code starts (CVE-2025-59536). Plain hooks are a note.", source: SRC.cve202559536 }),
  planned({ id: "sec-permission-allow", category: "security", defaultSeverity: "error", summary: "permissions.allow grants unscoped Bash, network tools or wildcard interpreters", why: "An allow rule runs the command without asking. CVE-2025-55284 was an allowlist problem.", source: SRC.cve202555284 }),
  planned({ id: "sec-permission-mode", category: "security", defaultSeverity: "warning", summary: "permissions.defaultMode is bypassPermissions", why: "It has no effect from project settings, but it signals intent and is worth a reviewer's look.", source: SRC.settings }),
  planned({ id: "sec-no-secret-deny", category: "security", defaultSeverity: "note", summary: "No permissions.deny rule covers .env or other secret files", why: "The settings reference describes deny rules as the way to keep files that hold secrets out of reach.", source: SRC.settingsRef }),
  planned({ id: "sec-mcp-launcher", category: "security", defaultSeverity: "warning", summary: "MCP server launched from an unpinned package, image or shell wrapper", why: "npx, uvx or docker without an exact version or digest runs whatever was published last.", source: SRC.toolPoisoning }),
  planned({ id: "sec-mcp-inline-secret", category: "security", defaultSeverity: "error", summary: "An MCP env value or argument looks like an API key", why: "Committed keys leak. The message shows the key type and a redacted preview only.", source: SRC.settingsRef }),
  planned({ id: "config-json-invalid", category: "config", defaultSeverity: "error", summary: "Agent config file is not valid JSON", why: "The agent ignores a config file it cannot parse, so its permissions and servers are not what the author thinks.", source: SRC.settings }),
];
