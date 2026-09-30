// Recognises steering files by path and says when each one loads.

export type Kind =
  | "claude-md"
  | "agents-md"
  | "gemini-md"
  | "skill"
  | "claude-agent"
  | "claude-command"
  | "claude-rule"
  | "cursor-rule"
  | "cursor-legacy"
  | "windsurf-rule"
  | "cline-rule"
  | "copilot-instructions"
  | "copilot-scoped"
  | "prompt-file"
  | "custom-agent"
  | "memory-index"
  | "memory-topic"
  | "markdown";

export type LoadGroup = "every-session" | "on-match" | "on-invocation" | "on-demand" | "memory" | "other";

export const LOAD_GROUP_LABEL: Record<LoadGroup, string> = {
  "every-session": "Loads every session",
  "on-match": "Loads on match (paths, globs or applyTo)",
  "on-invocation": "Loads on invocation (skills, commands, agents, prompts)",
  "on-demand": "Loads on demand (nested instruction files, when the agent works in that folder)",
  memory: "Memory",
  other: "Other markdown",
};

export interface Classified {
  kind: Kind;
  tools: string[];
  load: LoadGroup;
  note?: string;
}

/** Classifies a root-relative POSIX path. Content-dependent refinement happens in refineLoad. */
export function classify(rel: string): Classified {
  const parts = rel.split("/");
  const base = parts[parts.length - 1] ?? "";
  const lower = base.toLowerCase();
  const dirs = parts.slice(0, -1);
  const atRoot = dirs.length === 0;
  const inDotClaudeRoot = dirs.length === 1 && dirs[0] === ".claude";
  const has = (seq: string[]): boolean => {
    for (let i = 0; i + seq.length <= dirs.length; i++) if (seq.every((s, k) => dirs[i + k] === s)) return true;
    return false;
  };

  if (base === "CLAUDE.md" || base === "CLAUDE.local.md") {
    return atRoot || inDotClaudeRoot
      ? { kind: "claude-md", tools: ["claude-code"], load: "every-session" }
      : { kind: "claude-md", tools: ["claude-code"], load: "on-demand", note: "Loads when Claude works in this folder" };
  }
  if (base === "AGENTS.md") {
    return atRoot || inDotClaudeRoot
      ? { kind: "agents-md", tools: ["codex", "claude-code (when there is no CLAUDE.md)", "cursor", "copilot", "gemini-cli (if configured)"], load: "every-session" }
      : { kind: "agents-md", tools: ["codex", "claude-code", "cursor", "copilot"], load: "on-demand", note: "The closest AGENTS.md to the edited file applies" };
  }
  if (base === "GEMINI.md") {
    return atRoot
      ? { kind: "gemini-md", tools: ["gemini-cli"], load: "every-session" }
      : { kind: "gemini-md", tools: ["gemini-cli"], load: "on-demand" };
  }
  if (base === "SKILL.md") {
    return { kind: "skill", tools: ["claude-code", "codex", "cursor", "copilot", "gemini-cli"], load: "on-invocation", note: "name and description load every session in the skill listing; the body loads when the skill runs" };
  }
  if (base === "MEMORY.md") {
    return { kind: "memory-index", tools: ["claude-code"], load: "memory", note: "First 200 lines or 25 KB load every session" };
  }
  if (lower.endsWith(".md") && has([".claude", "agents"])) return { kind: "claude-agent", tools: ["claude-code"], load: "on-invocation" };
  if (lower.endsWith(".md") && has([".claude", "commands"])) return { kind: "claude-command", tools: ["claude-code"], load: "on-invocation" };
  if (lower.endsWith(".md") && has([".claude", "rules"])) return { kind: "claude-rule", tools: ["claude-code"], load: "every-session" };
  if (lower.endsWith(".mdc") && has([".cursor", "rules"])) return { kind: "cursor-rule", tools: ["cursor"], load: "on-invocation" };
  if (lower === ".cursorrules") return { kind: "cursor-legacy", tools: ["cursor"], load: "every-session", note: "Legacy format; Cursor recommends .cursor/rules/*.mdc" };
  if (lower === ".windsurfrules" || (lower.endsWith(".md") && has([".windsurf", "rules"]))) return { kind: "windsurf-rule", tools: ["windsurf"], load: "every-session" };
  if (lower === ".clinerules" || (lower.endsWith(".md") && dirs.includes(".clinerules"))) return { kind: "cline-rule", tools: ["cline"], load: "every-session" };
  if (rel === ".github/copilot-instructions.md") return { kind: "copilot-instructions", tools: ["copilot"], load: "every-session" };
  if (lower.endsWith(".instructions.md")) return { kind: "copilot-scoped", tools: ["copilot"], load: "on-match" };
  if (lower.endsWith(".prompt.md")) return { kind: "prompt-file", tools: ["copilot"], load: "on-invocation" };
  if (lower.endsWith(".agent.md") || lower.endsWith(".chatmode.md") || (lower.endsWith(".md") && has([".github", "agents"]))) {
    return { kind: "custom-agent", tools: ["copilot"], load: "on-invocation" };
  }
  if (lower.endsWith(".md") && dirs[dirs.length - 1] === "memory") return { kind: "memory-topic", tools: ["claude-code"], load: "memory", note: "Loads when the agent reads it from the memory index" };
  return { kind: "markdown", tools: [], load: "other" };
}

export function isSteering(kind: Kind): boolean {
  return kind !== "markdown";
}

type Data = Record<string, unknown> | null;

const truthy = (v: unknown): boolean => v === true || v === "true";
const nonEmpty = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null);

/** Refines the load group from frontmatter, for kinds whose load depends on it. */
export function refineLoad(c: Classified, data: Data): Classified {
  if (c.kind === "claude-rule") {
    return data && nonEmpty(data["paths"]) ? { ...c, load: "on-match", note: "Loads when Claude works with files matching paths" } : { ...c, load: "every-session" };
  }
  if (c.kind === "cursor-rule") {
    if (data && truthy(data["alwaysApply"])) return { ...c, load: "every-session", note: "Rule type: Always" };
    if (data && nonEmpty(data["globs"])) return { ...c, load: "on-match", note: "Rule type: Auto Attached" };
    if (data && nonEmpty(data["description"])) return { ...c, load: "on-invocation", note: "Rule type: Agent Requested" };
    return { ...c, load: "on-invocation", note: "Rule type: Manual (only when @-mentioned)" };
  }
  if (c.kind === "windsurf-rule" && data) {
    const t = String(data["trigger"] ?? "");
    if (t === "glob") return { ...c, load: "on-match" };
    if (t === "model_decision" || t === "manual") return { ...c, load: "on-invocation" };
  }
  return c;
}
