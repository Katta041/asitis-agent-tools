// Vendor-spec rules from the spec-gap research (sections 2 and 2b). No track owns these in 0.3.0;
// ids are reserved here so .asitisrc.json files and later work agree on them. agents-md-shadowed
// and codex-chain-over-budget are in drift.meta.ts (one id, one owner). Rules that need a new file kind use the kinds already
// added to kinds.ts; classify() itself changes only through the WP0 owner.

import { planned, SRC, type RuleMeta } from "./types.js";

const f = (id: string, defaultSeverity: "error" | "warning" | "note", summary: string, why: string, source: string): RuleMeta =>
  planned({ id, category: "format", defaultSeverity, summary, why, source });

export const SPEC_RULES: RuleMeta[] = [
  // Claude Code and the Agent Skills spec
  f("portable-boolean", "note", "Skill boolean written as yes, no, on, off, 1 or 0", "Claude Code accepts these, but the spec validator and other clients read plain YAML booleans only.", SRC.skills),
  f("skill-nonstandard-key", "note", "SKILL.md key outside the Agent Skills spec", "Works in Claude Code; claude.ai, the Skills API and skills-ref reject the skill.", SRC.agentSkillsSpec),
  f("skill-metadata-type", "warning", "metadata is not a map of strings to strings", "The spec defines metadata as string keys to string values, and Claude Code drops a value that is not a map.", SRC.agentSkillsSpec),
  f("skill-enum", "error", "effort, context or shell has a value Claude Code does not accept", "An unknown value is rejected or ignored.", SRC.skills),
  f("skill-fork-only", "warning", "agent or background set without context: fork", "Those fields only apply with context: fork.", SRC.skills),
  f("skill-arguments-type", "error", "arguments is neither a string nor a list of strings", "Claude Code cannot read arguments of another type.", SRC.skills),
  f("skill-reserved-name", "error", "Skill uses a reserved name", "A skill called synced or anthropic-skills does not load.", SRC.skills),
  f("skill-filename-case", "warning", "SKILL.md is not spelled in upper case", "The file must be named exactly SKILL.md; other spellings are skipped by most tools.", SRC.agentSkillsSpec),
  f("skill-compat-empty", "warning", "compatibility is present but empty", "The spec requires 1 to 500 characters when compatibility is given.", SRC.agentSkillsSpec),
  planned({ id: "skill-shell-injection", category: "security", defaultSeverity: "note", summary: "Skill runs a shell command before the prompt is sent", why: "A !`command` line or a ```! fence runs without a permission prompt when the skill is invoked.", source: SRC.skills }),
  f("skill-nested-reference", "note", "A file SKILL.md links to links to another local file", "The spec recommends keeping file references one level deep.", SRC.agentSkillsSpec),
  planned({ id: "skill-listing-budget", category: "budget", defaultSeverity: "note", scope: "project", summary: "Skill listings exceed the listing budget", why: "Claude Code fits all skill descriptions into about 1% of the context window (8,000 characters by default) and cuts the rest.", source: SRC.skills }),
  planned({ id: "skill-shadowed-command", category: "format", defaultSeverity: "warning", scope: "project", summary: "A command and a skill share a name", why: "The skill wins, so the command never runs.", source: SRC.skills }),
  f("agent-name-format", "error", "Subagent name contains a colon, starts with a hyphen or is too long", "Claude Code skips such a subagent file.", SRC.subagents),
  f("agent-enum", "error", "Subagent permissionMode, memory, isolation, color or effort has an unknown value", "Unknown values are rejected or ignored.", SRC.subagents),
  f("agent-model", "warning", "model is not inherit, a Claude alias or a Claude model id", "An unknown model makes the subagent fail to start.", SRC.subagents),
  f("agent-skills-limit", "warning", "Subagent lists more than 32 skills", "Claude Code loads at most 32.", SRC.subagents),
  f("agent-plugin-ignored-key", "warning", "Plugin subagent uses a field plugins ignore", "permissionMode, hooks, mcpServers and initialPrompt are ignored for plugin agents.", SRC.plugins),
  planned({ id: "bypass-permissions", category: "security", defaultSeverity: "warning", summary: "Subagent sets permissionMode: bypassPermissions", why: "The subagent runs tools without asking. Worth a reviewer's look even where the parent mode makes it a no-op.", source: SRC.subagents }),
  f("hook-event-unknown", "error", "Hook event name is not a documented event", "An unknown event never fires.", SRC.hooks),
  f("hook-type-unknown", "error", "Hook handler type is not command, http, mcp_tool, prompt or agent", "An unknown handler type is rejected.", SRC.hooks),
  f("hook-once-ignored", "note", "once on a subagent hook", "once is honoured only in skill frontmatter.", SRC.hooks),
  f("claude-md-too-large", "error", "CLAUDE.md is larger than 4 MiB", "Claude Code skips a larger file entirely.", SRC.memory),
  f("claude-local-misplaced", "warning", "CLAUDE.local.md inside .claude/", "Only ./CLAUDE.local.md is a documented location; this file is not loaded.", SRC.memory),
  f("rule-paths-budget", "warning", "Rule paths expand to more than 1,000 patterns", "Claude Code caps brace expansion of paths.", SRC.memory),
  f("rule-paths-bracket", "note", "Rule paths glob has an unescaped [", "Square brackets are a character class; escape them as \\[ to match a literal bracket.", SRC.memory),
  // codex-override-shadow was reserved here and retired in 0.3.0: agents-md-unread-variant (drift)
  // already reports an AGENTS.override.md that hides its AGENTS.md from Codex.
  f("empty-instructions", "note", "Instruction file is empty or whitespace", "Codex skips empty files and Claude Code adds nothing.", SRC.codexAgentsMd),
  f("gemini-import-depth", "warning", "GEMINI.md import chain deeper than 5", "Gemini CLI stops importing at depth 5.", SRC.geminiMemport),
  f("gemini-import-outside", "warning", "GEMINI.md import resolves outside the project", "Gemini CLI rejects it without asking.", SRC.geminiMemport),
  f("output-style-field", "error", "Output style keep-coding-instructions or force-for-plugin is not a boolean", "Non-boolean values are not read.", SRC.outputStyles),
  f("plugin-claude-md-ignored", "warning", "CLAUDE.md at a plugin root", "Claude Code never loads a plugin's own CLAUDE.md.", SRC.plugins),
  f("memory-modified-format", "note", "Memory file modified is not an ISO 8601 timestamp", "The memory docs define modified as ISO 8601.", SRC.memory),

  // Cursor, Copilot, Windsurf and Cline
  f("cursor-rule-md-ignored", "error", "Plain .md file under .cursor/rules", "Cursor reads only .mdc files there; a .md file is ignored.", SRC.cursorRules),
  f("cursor-ignored-fields", "note", "alwaysApply: true together with globs or description", "With alwaysApply, Cursor ignores globs and description.", SRC.cursorRules),
  f("cursor-legacy-deprecated", "note", ".cursorrules is the legacy format", "Cursor says .cursorrules will be deprecated; move to .cursor/rules/*.mdc.", "https://cursor.com/help/customization/rules"),
  f("copilot-exclude-agent", "error", "excludeAgent is not code-review or cloud-agent", "Other values are not recognised; coding-agent was renamed to cloud-agent.", SRC.githubRepoInstructions),
  f("copilot-instructions-location", "warning", "*.instructions.md outside .github/instructions/", "VS Code looks for scoped instructions in .github/instructions/.", SRC.vscodeInstructions),
  planned({ id: "copilot-review-length", category: "budget", defaultSeverity: "note", summary: "Copilot instructions longer than 1,000 lines", why: "Copilot code review reads only part of a long instructions file.", source: "https://docs.github.com/en/copilot/tutorials/customize-code-review" }),
  f("prompt-agent-value", "warning", "Prompt file agent is not ask, agent, plan or a custom agent in the repo", "VS Code cannot route the prompt to an unknown agent.", SRC.vscodePromptFiles),
  f("prompt-mode-deprecated", "warning", "Prompt file uses mode", "mode is no longer documented; use agent.", SRC.vscodePromptFiles),
  f("chatmode-renamed", "warning", "*.chatmode.md file", "Chat modes are now custom agents; rename to .agent.md.", SRC.vscodeCustomAgents),
  f("custom-agent-description", "error", "Custom agent has no description", "GitHub.com requires a description.", SRC.githubCustomAgents),
  f("custom-agent-target", "error", "Custom agent target is not vscode or github-copilot", "Other targets are not recognised.", SRC.githubCustomAgents),
  f("custom-agent-infer", "warning", "Custom agent uses infer", "infer is retired; use disable-model-invocation or user-invocable.", SRC.githubCustomAgents),
  planned({ id: "custom-agent-prompt-size", category: "budget", defaultSeverity: "error", summary: "Custom agent body longer than 30,000 characters", why: "GitHub.com rejects a longer prompt.", source: SRC.githubCustomAgents }),
  f("custom-agent-github-ignored", "note", "argument-hint or handoffs on an agent GitHub.com runs", "GitHub.com ignores these fields.", SRC.githubCustomAgents),
  f("windsurf-trigger", "error", "Windsurf trigger is not always_on, model_decision, glob or manual", "An unknown trigger means the rule never applies as intended.", SRC.windsurf),
  f("windsurf-trigger-incomplete", "warning", "glob trigger without globs, or model_decision without description", "The rule has nothing to match on.", SRC.windsurf),
  f("windsurf-legacy-file", "note", ".windsurfrules is the legacy single file", "Still read, but .devin/rules/*.md is the documented place.", SRC.windsurf),
  f("cline-paths-type", "error", "Cline rule paths is not a list of strings", "Cline expects an array of glob patterns.", SRC.cline),
  f("cline-paths-empty", "warning", "Cline rule has paths: []", "An empty list never activates the rule.", SRC.cline),
];
