// Audit of .claude/settings.json and MCP config files (F9). Owner: WP6. Opt-in: include "config"
// (and "config-local" for .claude/settings.local.json). Stub until WP6 lands. Read files with
// ctx.sandbox.openAs("agent-config", rel, { grants: ctx.include }); never return values, only key
// paths and redact.ts previews.

import type { ProjectCheck } from "../project.js";

export const AGENT_CONFIG_CHECK: ProjectCheck = {
  id: "agent-config",
  include: "config",
  ready: false,
  run: async () => {
    // Stub: WP6 fills this in.
  },
};
