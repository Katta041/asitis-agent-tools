// Rule metadata types, shared by the registry and the per-track meta files.

import type { Category, FindingSeverity, FixSafety } from "../findings.js";

export type RuleStatus = "active" | "planned";

export interface RuleMeta {
  /** Kebab-case. Security rules from the threat catalogue start with sec-. */
  id: string;
  category: Category;
  /** The usual severity. Some rules pick a lower one for softer cases (an npm name that looks like an import). */
  defaultSeverity: FindingSeverity;
  /** One line, under 100 characters, no trailing period. Goes into SARIF shortDescription. */
  summary: string;
  /** Why it matters, one to three sentences. Goes into SARIF fullDescription and the rule page. */
  why: string;
  /** A URL backing the rule: a vendor doc, a spec, a CVE or an incident write-up. */
  source: string;
  /** false, or the safety of the fix fix.ts can offer. */
  fixable: false | FixSafety;
  /** False for every security rule: a suppression comment is itself a hidden comment an attacker can add. */
  suppressibleInline: boolean;
  /**
   * active: some code in src/ emits it. planned: id reserved for a track that has not landed yet;
   * outputs must not list planned rules (SARIF rules[], docs pages, config validation hints).
   */
  status: RuleStatus;
  /** file: decided from one file. project: needs several files or the folder layout. */
  scope: "file" | "project";
}

export interface RuleInput {
  id: string;
  category: Category;
  defaultSeverity: FindingSeverity;
  summary: string;
  why: string;
  source: string;
  fixable?: false | FixSafety;
  scope?: "file" | "project";
  status?: RuleStatus;
}

/** Fills defaults. suppressibleInline is derived from the category and cannot be set by hand. */
export function rule(r: RuleInput): RuleMeta {
  return {
    id: r.id,
    category: r.category,
    defaultSeverity: r.defaultSeverity,
    summary: r.summary,
    why: r.why,
    source: r.source,
    fixable: r.fixable ?? false,
    suppressibleInline: r.category !== "security",
    status: r.status ?? "active",
    scope: r.scope ?? "file",
  };
}

/** For meta files of tracks that have not landed: same as rule() with status planned. */
export const planned = (r: Omit<RuleInput, "status">): RuleMeta => rule({ ...r, status: "planned" });

/** Doc links used by several rules. */
export const SRC = {
  memory: "https://code.claude.com/docs/en/memory",
  skills: "https://code.claude.com/docs/en/skills",
  subagents: "https://code.claude.com/docs/en/sub-agents",
  hooks: "https://code.claude.com/docs/en/hooks",
  settings: "https://code.claude.com/docs/en/settings",
  settingsRef: "https://code.claude.com/docs/en/settings-reference",
  plugins: "https://code.claude.com/docs/en/plugins-reference",
  outputStyles: "https://code.claude.com/docs/en/output-styles",
  agentSkillsSpec: "https://agentskills.io/specification",
  claudeApiSkills: "https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview",
  cursorRules: "https://cursor.com/docs/context/rules",
  vscodeInstructions: "https://code.visualstudio.com/docs/agent-customization/custom-instructions",
  vscodePromptFiles: "https://code.visualstudio.com/docs/agent-customization/prompt-files",
  vscodeCustomAgents: "https://code.visualstudio.com/docs/agent-customization/custom-agents",
  githubCustomAgents: "https://docs.github.com/en/copilot/reference/custom-agents-configuration",
  githubRepoInstructions: "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions",
  codexAgentsMd: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
  agentsMd: "https://agents.md/",
  geminiMemport: "https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/memport.md",
  windsurf: "https://docs.devin.ai/desktop/cascade/memories",
  cline: "https://docs.cline.bot/customization/cline-rules",
  githubHiddenUnicode: "https://github.blog/changelog/2025-05-01-github-now-provides-a-warning-about-hidden-unicode-text/",
  rulesFileBackdoor: "https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents",
  trojanSource: "https://trojansource.codes/",
  utf8: "https://www.rfc-editor.org/rfc/rfc3629",
  gitattributes: "https://git-scm.com/docs/gitattributes",
  toolPoisoning: "https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks",
  toxicSkills: "https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/",
  cve202559536: "https://nvd.nist.gov/vuln/detail/CVE-2025-59536",
  cve202553773: "https://nvd.nist.gov/vuln/detail/CVE-2025-53773",
  cve202555284: "https://nvd.nist.gov/vuln/detail/CVE-2025-55284",
} as const;
