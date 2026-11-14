// The load model: plan(ctx, cwd, tool) says what one tool loads when a session starts in a folder.
// context_budget is the launch part of plan(ctx, "") for each tool; the drift checks use the same
// file helpers (files.ts).

import type { LoadContext } from "./context.js";
import { planClaude } from "./claude.js";
import { planCodex } from "./codex.js";
import { planCopilot } from "./copilot.js";
import { planCursor } from "./cursor.js";
import { planGemini } from "./gemini.js";
import { approxTokens } from "../tokens.js";
import { DOC } from "./sources.js";
import type { LoadPlan, LoadStep, ToolId } from "./types.js";

export { loadContext, type LoadContext } from "./context.js";
export { PLAN_TOOLS, totals, type LoadPlan, type LoadStep, type SkippedFile, type ToolId } from "./types.js";

/** Windsurf and Cline: only what loads every session at the root, as context_budget has counted it since 0.2. */
function planSimple(ctx: LoadContext, tool: "windsurf" | "cline", cwd: string): LoadPlan {
  const pick = tool === "windsurf" ? (k: string, l: string): boolean => k === "windsurf-rule" && l === "every-session" : (k: string, l: string): boolean => k === "cline-rule" && l === "every-session";
  const steps: LoadStep[] = ctx.docs
    .filter((d) => pick(d.kind.kind, d.kind.load))
    .map((d) => ({ path: d.path, kind: "file", trigger: "launch", when: "at launch", tokens: approxTokens(d.text), scope: "", counted: true, basis: "documented", source: tool === "windsurf" ? DOC.windsurf : DOC.cline, note: tool === "windsurf" ? "always-on rule" : "rule" }) as LoadStep);
  return { tool, cwd, steps, skipped: [], warnings: [], notes: [] };
}

export async function plan(ctx: LoadContext, cwd: string, tool: ToolId): Promise<LoadPlan> {
  switch (tool) {
    case "claude-code":
      return planClaude(ctx, cwd);
    case "codex":
      return planCodex(ctx, cwd);
    case "gemini-cli":
      return planGemini(ctx, cwd);
    case "cursor":
      return planCursor(ctx, cwd);
    case "copilot":
      return planCopilot(ctx, cwd);
    case "windsurf":
    case "cline":
      return planSimple(ctx, tool, cwd);
  }
}

export const BUDGET_TOOLS: readonly ToolId[] = ["claude-code", "codex", "gemini-cli", "cursor", "copilot", "windsurf", "cline"];
