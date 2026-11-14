// Where each piece of loading behaviour comes from. Every behaviour a model encodes has an id here
// with the URL of its doc, read 15 November 2026, and, when a canary run confirmed it, the tool version
// and date. Recheck these when a vendor changes its docs; scripts/canary/ has the canary recipe.

import type { Basis } from "./types.js";

export const DOC = {
  claudeMemory: "https://code.claude.com/docs/en/memory",
  claudeMemoryLoad: "https://code.claude.com/docs/en/memory#how-claude-md-files-load",
  claudeImports: "https://code.claude.com/docs/en/memory#import-additional-files",
  claudeRules: "https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/",
  claudePathRules: "https://code.claude.com/docs/en/memory#path-specific-rules",
  claudeAgentsMd: "https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md",
  claudeOnDemandCut: "https://code.claude.com/docs/en/memory#claude-ignores-the-end-of-my-subdirectory-claude-md",
  claudeTooLarge: "https://code.claude.com/docs/en/memory#my-claude-md-is-too-large",
  claudeSkills: "https://code.claude.com/docs/en/skills",
  claudeLargeCodebases: "https://code.claude.com/docs/en/large-codebases",
  claudeSubagents: "https://code.claude.com/docs/en/sub-agents",
  codexAgentsMd: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
  codexSource: "https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs",
  codexReleases: "https://github.com/openai/codex/releases",
  geminiMd: "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md",
  geminiDiscovery: "https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/memoryDiscovery.ts",
  geminiMemport: "https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/memport.md",
  cursorRules: "https://cursor.com/docs/context/rules",
  cursorCliChangelog: "https://cursor.com/docs/cli/changelog",
  vscodeInstructions: "https://code.visualstudio.com/docs/agent-customization/custom-instructions",
  vscodeInstructionsRef: "https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference",
  githubRepoInstructions: "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions",
  vscodeSkills: "https://code.visualstudio.com/docs/copilot/customization/agent-skills",
  antigravityRules: "https://antigravity.google/docs/rules-workflows",
  windsurf: "https://docs.devin.ai/desktop/cascade/memories",
  cline: "https://docs.cline.bot/customization/cline-rules",
} as const;

/** A canary run against a real tool: which behaviours it confirmed or contradicted. */
export interface CanaryRun {
  tool: string;
  version: string;
  date: string;
  confirmed: readonly string[];
}

/**
 * Canary runs recorded so far. Filled from runs of scripts/canary/run.sh. A behaviour
 * listed here gets basis "canary"; everything else keeps its documented or assumed basis.
 */
export const CANARY_RUNS: readonly CanaryRun[] = [
  {
    // 15 claude -p runs from five folders of two planted trees (scripts/canary).
    tool: "claude-code",
    version: "2.1.312",
    date: "2026-11-14",
    confirmed: [
      "root-claude-md", // CLAUDE.md and CLAUDE.local.md at the start folder
      "ancestor-claude-md", // CLAUDE.md files above the start folder
      "imports", // @imports at the start folder, four hops and not five
      "rules-no-paths-launch",
      "ancestor-rules-launch", // .claude/rules of folders above the start folder
      "path-rules-on-match", // including a no-slash pattern matching at any depth
      "nested-rules-on-read",
      "nested-claude-md-on-read", // and the folders between, and their imports
      "nested-agents-md-on-read",
      "agents-md-fallback", // AGENTS.md and .claude/AGENTS.md with no CLAUDE.md, with imports
      "ancestor-agents-md",
      "agents-md-shadowed",
      "skills-launch",
      "ancestor-skills",
      "nested-skills-on-read",
      "sibling-claude-md",
      "variants-never-read", // AGENTS.override.md, AGENTS.local.md, .agents/rules
      "agents-skills-not-read",
      "ancestor-imports-not-expanded",
    ],
  },
];

export interface Behaviour {
  basis: Basis;
  source: string;
}

/** The basis and source for a behaviour id: canary when a run confirmed it, else the given default. */
export function behaviour(tool: string, id: string, fallback: Basis, source: string): Behaviour {
  for (const run of CANARY_RUNS) {
    if (run.tool === tool && run.confirmed.includes(id)) return { basis: "canary", source: `${source} (confirmed with a canary on ${run.tool} ${run.version}, ${run.date})` };
  }
  return { basis: fallback, source };
}
