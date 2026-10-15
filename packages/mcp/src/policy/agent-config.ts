// Read policy for agent config files (F9). Owner: WP6.
//
// The server's promise is that it never reads settings unless the caller opts in. So this policy
// refuses everything unless the call passed include "config", and even then it allows only these
// files at the top of the root folder:
//   .claude/settings.json, .mcp.json, .cursor/mcp.json, .vscode/mcp.json, .gemini/settings.json
// and, for the project's own name and URLs only, the root package.json and pyproject.toml.
// .claude/settings.local.json is personal and often holds tokens, so it needs "config-local" too.
// ~/.claude.json (Claude Code's own state, with OAuth data and per-project history) is never read,
// whatever the grants and whatever the root. Paths outside the root never reach a policy: the
// sandbox refuses them first.

import type { ReadPolicy } from "../paths.js";

/** Files the audit reads with include "config", root-relative, lower case. */
export const AGENT_CONFIG_FILES: readonly string[] = [".claude/settings.json", ".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json", ".gemini/settings.json"];
/** Root manifests read with include "config" for the project's own name and URLs only. */
export const AGENT_CONFIG_MANIFESTS: readonly string[] = ["package.json", "pyproject.toml"];
/** Read only with include "config-local". */
export const AGENT_CONFIG_LOCAL_FILE = ".claude/settings.local.json";

export const AGENT_CONFIG_POLICY: ReadPolicy = {
  readClass: "agent-config",
  label: "agent config files",
  maxBytes: 256 * 1024,
  refusal: (relPosix, ctx) => {
    const lower = relPosix.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (base === ".claude.json" || base.startsWith(".claude.json.")) {
      return `${relPosix} is Claude Code's own state file (sign-in and per-project history); this server never reads it`;
    }
    if (!ctx.grants.has("config") && !ctx.grants.has("config-local")) {
      return `${relPosix} is an agent config file; reading agent config is not enabled without include "config"`;
    }
    if (lower === AGENT_CONFIG_LOCAL_FILE) {
      return ctx.grants.has("config-local") ? null : `${relPosix} holds personal settings and often tokens; it is read only with include "config-local"`;
    }
    if (AGENT_CONFIG_FILES.includes(lower)) return null;
    // The project's own manifest, read only for its name and URLs (checks/own.ts), so the audit can
    // tell the repo's own MCP server and install script from third-party ones.
    if (AGENT_CONFIG_MANIFESTS.includes(lower)) return null;
    return `${relPosix} is not one of the agent config files this server reads (${AGENT_CONFIG_FILES.join(", ")})`;
  },
};
