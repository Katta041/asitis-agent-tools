// context_budget: approximate tokens per file and per tool for what loads every session. Since
// 0.4.0 this is a view of the load model: for each tool, the counted launch steps of
// plan(ctx, "") (load/index.ts). Only the wording lives here.

import type { Doc } from "./doc.js";
import type { Deadline } from "./discover.js";
import { KIND_LABEL, LOAD_SHORT } from "./kinds.js";
import { CAPS, VENDOR } from "./limits.js";
import { analyse } from "./doc.js";
import type { Sandbox } from "./paths.js";
import { approxTokens } from "./tokens.js";
import { BUDGET_TOOLS, loadContext, plan, type LoadContext, type LoadPlan } from "./load/index.js";
import { bodyTokens, expandImports as expand, missingImportWarnings as missing, type ImportHit } from "./load/files.js";

export { stripBlockComments } from "./load/files.js";
export { claudeCodeLoads } from "./load/claude.js";

export interface BudgetEntry {
  path: string;
  tokens: number;
  note?: string;
  depth?: number;
  /** True on the entry that stands for imports beyond the listing cap: they are neither listed nor counted. */
  overflow?: boolean;
  /** For an @import whose file does not exist: the file that imports it and the line. */
  missingFrom?: { path: string; line: number };
}

export interface ToolBudget {
  tool: string;
  tokens: number;
  entries: BudgetEntry[];
  warnings: string[];
}

const entryOf = (e: ImportHit | BudgetEntry): BudgetEntry => ({
  path: e.path,
  tokens: e.tokens,
  ...(e.note !== undefined ? { note: e.note } : {}),
  ...(e.depth !== undefined ? { depth: e.depth } : {}),
  ...(e.overflow ? { overflow: true } : {}),
  ...(e.missingFrom ? { missingFrom: e.missingFrom } : {}),
});

/** Expands @imports up to four hops (or maxHops), counting each file once. */
export async function expandImports(sandbox: Sandbox, doc: Doc, seen: Set<string>, depth = 1, deadline?: Deadline, maxHops: number = VENDOR.importMaxHops): Promise<BudgetEntry[]> {
  return (await expand(sandbox, doc, seen, depth, deadline, maxHops)).map(entryOf);
}

/** One warning per @import whose file does not exist, so a broken import is not just a quiet "not counted". */
export function missingImportWarnings(entries: BudgetEntry[]): string[] {
  return missing(entries);
}

function walkNote(cut: { depth: boolean; size: boolean; time: boolean }): string {
  const parts: string[] = [];
  if (cut.size) parts.push("the folder walk stopped at the file or entry limit, so some files may be missing");
  if (cut.time) parts.push("the folder walk stopped at the time limit, so some files may be missing");
  if (cut.depth) parts.push(`folders more than ${CAPS.walkMaxDepth} levels deep were not searched`);
  const t = parts.join("; ");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
}

export interface ProjectBudget {
  tools: ToolBudget[];
  files: BudgetEntry[];
  skippedFiles: string[];
  truncated: boolean;
  /** Why the folder walk stopped early, as a sentence, or "". */
  walkNote: string;
}

/** The every-session budget of one tool: its counted launch steps. */
export function budgetOf(p: LoadPlan): ToolBudget | null {
  const entries = p.steps.filter((s) => s.trigger === "launch" && s.counted).map(entryOf);
  if (!entries.length && !p.warnings.length) return null;
  return { tool: p.tool, tokens: entries.reduce((a, e) => a + e.tokens, 0), entries, warnings: [...p.warnings] };
}

export async function budgetFromContext(ctx: LoadContext): Promise<ProjectBudget> {
  const tools: ToolBudget[] = [];
  for (const t of BUDGET_TOOLS) {
    const b = budgetOf(await plan(ctx, "", t));
    if (b) tools.push(b);
  }
  const files = ctx.docs.map((d) => ({ path: d.path, tokens: approxTokens(d.text), note: `${KIND_LABEL[d.kind.kind]}, ${LOAD_SHORT[d.kind.load]}` })).sort((a, b) => b.tokens - a.tokens);
  return { tools, files, skippedFiles: ctx.skippedFiles, truncated: ctx.walk.truncated, walkNote: ctx.walk.truncated ? walkNote(ctx.walk.cut) : "" };
}

export async function projectBudget(sandbox: Sandbox, deadline?: Deadline): Promise<ProjectBudget> {
  return budgetFromContext(await loadContext(sandbox, deadline));
}

export async function fileBudget(sandbox: Sandbox, p: string, deadline?: Deadline): Promise<{ doc: Doc; tokens: number; imports: BudgetEntry[] }> {
  const f = await sandbox.open(p);
  const doc = analyse(f, sandbox.displayFile(f));
  const strip = doc.kind.kind === "claude-md" || doc.kind.kind === "agents-md";
  const hops = doc.kind.kind === "gemini-md" ? VENDOR.geminiImportMaxDepth : VENDOR.importMaxHops;
  const imports = ["claude-md", "agents-md", "gemini-md", "claude-rule"].includes(doc.kind.kind) ? await expandImports(sandbox, doc, new Set([doc.file.real]), 1, deadline, hops) : [];
  return { doc, tokens: bodyTokens(doc, strip), imports };
}
