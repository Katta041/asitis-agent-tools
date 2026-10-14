// Read policy for agent config files. Owner: WP6.
// Stub: refuses every read until WP6 lands. The target policy (F9): only .claude/settings.json,
// .mcp.json, .cursor/mcp.json, .vscode/mcp.json and .gemini/settings.json, plus
// .claude/settings.local.json when ctx.grants has "config-local". Never ~/.claude.json, never
// anything outside the root.

import type { ReadPolicy } from "../paths.js";

export const AGENT_CONFIG_POLICY: ReadPolicy = {
  readClass: "agent-config",
  label: "agent config files",
  maxBytes: 256 * 1024,
  refusal: (relPosix) => `${relPosix} is an agent config file; reading agent config is not enabled in this build`,
};
