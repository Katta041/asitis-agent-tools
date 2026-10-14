// Drift and sync rules (F7). Owner: WP4. Flip status to active (use rule() instead of planned())
// in the same commit that makes checks/drift.ts emit the rule.

import { planned, SRC, type RuleMeta } from "./types.js";

export const DRIFT_RULES: RuleMeta[] = [
  planned({ id: "agents-md-shadowed", category: "drift", defaultSeverity: "warning", scope: "project", summary: "Claude Code reads CLAUDE.md here and skips AGENTS.md", why: "AGENTS.md is read by Claude Code only when no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md sits in the folder or above. Import it with @AGENTS.md or symlink one to the other.", source: SRC.memory }),
  planned({ id: "claude-local-hides-agents-md", category: "drift", defaultSeverity: "warning", scope: "project", summary: "A CLAUDE.local.md switches off the AGENTS.md fallback", why: "With only CLAUDE.local.md present, Claude Code stops reading AGENTS.md, so the shared instructions silently drop out (claude-code issue 96117).", source: "https://github.com/anthropics/claude-code/issues/96117" }),
  planned({ id: "agents-md-unread-variant", category: "drift", defaultSeverity: "note", scope: "project", summary: "AGENTS.override.md, AGENTS.local.md or .agents/*.md is read by some agents only", why: "Codex reads AGENTS.override.md; Claude Code never reads these variants. The note says which agents load the file.", source: SRC.codexAgentsMd }),
  planned({ id: "cross-file-contradiction", category: "drift", defaultSeverity: "warning", scope: "project", summary: "Two files loaded for the same agent, or mirrored for different agents, contradict", why: "When CLAUDE.md says one thing and AGENTS.md or GEMINI.md the opposite, agents behave differently on the same repo.", source: SRC.memory }),
  planned({ id: "instruction-drift", category: "drift", defaultSeverity: "note", scope: "project", summary: "Mirrored instruction files share most rules but not all", why: "Two files that are meant to say the same thing (AGENTS.md and CLAUDE.md, say) have drifted. Silent below the similarity threshold so unrelated files do not alert.", source: SRC.agentsMd }),
  planned({ id: "generated-file-edited", category: "drift", defaultSeverity: "note", scope: "project", summary: "A rulesync or Ruler output file differs from its source", why: "Hand edits to a generated file are lost on the next sync. Run the generator's check mode instead.", source: "https://github.com/dyoshikawa/rulesync" }),
  planned({ id: "codex-chain-over-budget", category: "budget", defaultSeverity: "warning", scope: "project", summary: "AGENTS.md files from the root down exceed Codex's 32 KiB", why: "The budget is shared root first; the file that crosses it is cut and deeper files are dropped. Same rule as codex-chain-over-cap in the F11 notes.", source: SRC.codexAgentsMd }),
];
