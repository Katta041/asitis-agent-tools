// Vendor limits and server caps. Each vendor number cites where it comes from so
// it can be re-checked when a vendor changes its docs.

export const VENDOR = {
  /** Claude Code memory docs: "target under 200 lines per CLAUDE.md file". */
  claudeMdTargetLines: 200,
  /** Claude Code memory docs: imports recurse "with a maximum depth of four hops". */
  importMaxHops: 4,
  /** Claude Code skills docs: "Keep SKILL.md under 500 lines". */
  skillMaxLines: 500,
  /** Claude Code skills docs: description plus when_to_use "truncated at 1,536 characters in the skill listing". */
  skillListingChars: 1536,
  /** Agent Skills spec (agentskills.io): name 1-64 characters. */
  skillNameMax: 64,
  /** Agent Skills spec (agentskills.io): description up to 1,024 characters. */
  skillDescriptionMax: 1024,
  /** Claude Code skills docs: compatibility "a string of up to 500 characters". */
  skillCompatibilityMax: 500,
  /** Claude Code memory docs: auto memory loads "first 200 lines or 25KB" of MEMORY.md. */
  memoryIndexLines: 200,
  memoryIndexBytes: 25 * 1024,
  /** Codex AGENTS.md docs: project_doc_max_bytes default 32 KiB. */
  codexAgentsMdBytes: 32 * 1024,
  /** Cursor rules docs: keep rules under 500 lines. */
  cursorRuleLines: 500,
  /** Windsurf (Devin Desktop) memories docs: rule files limited to 12,000 characters. */
  windsurfRuleChars: 12000,
} as const;

export const CAPS = {
  /** Largest file any tool will analyse. */
  maxFileBytes: 16 * 1024 * 1024,
  /** Default and hard maximum bytes returned by one read_markdown call. */
  readDefaultBytes: 256 * 1024,
  readMaxBytes: 1024 * 1024,
  /** Frontmatter larger than this is not parsed. */
  maxFrontmatterBytes: 64 * 1024,
  /** Directory walk limits for find_steering_files, lint_steering and context_budget. */
  walkMaxDepth: 12,
  walkMaxEntries: 50000,
  walkMaxFiles: 1000,
  /** Files linted in one call when no path is given. */
  lintMaxFiles: 300,
  /** Explicit paths accepted in one lint call. */
  lintMaxPaths: 50,
  /** Findings kept per rule per file, so a hostile file cannot flood the agent's context. */
  maxFindingsPerRule: 50,
  /** Links and imports checked per file. */
  maxLinkChecks: 2000,
  /** Longest link target or import token considered. */
  maxTargetChars: 2048,
  /** Longest path argument accepted. */
  maxPathChars: 4096,
  /** Wall-clock budget for one tool call. */
  callBudgetMs: 20000,
  /** Headings returned by outline. */
  maxHeadings: 5000,
} as const;
