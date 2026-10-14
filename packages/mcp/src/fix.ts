// Fix suggestions as byte-range edits (F6). Owner: WP7. Stub until WP7 lands: no fixes are offered.
// The engine never writes a file. Fixes leave as a unified diff (diff.ts) on stdout or in the
// suggest_fixes tool result, and the user or the agent applies them.

import type { Doc } from "./doc.js";
import type { Deadline } from "./discover.js";
import type { FixEdit, FixSafety } from "./findings.js";
import type { Issue } from "./lint.js";
import type { Sandbox } from "./paths.js";
import type { ProjectResult } from "./project.js";

export type { FixEdit };

export interface FixSuggestion {
  ruleId: string;
  /** Display path, as in lint results. */
  path: string;
  line: number;
  safety: FixSafety;
  edits: FixEdit[];
  /** Why a review fix needs a look, or why no fix is offered (a non-ASCII skill name). */
  note?: string;
}

/** Returns a fix for one issue in one file, or null when this occurrence cannot be fixed safely. */
export type Fixer = (doc: Doc, issue: Issue) => FixSuggestion | null;

export interface SuggestFixesArgs {
  path?: string | undefined;
  paths?: string[] | undefined;
  /** Only fixes for these rule ids. */
  rules?: string[] | undefined;
  /** safe: only safe fixes. all (default): safe and review fixes. */
  safety?: "safe" | "all" | undefined;
}

/** What the suggest_fixes tool returns. server.ts wraps it; WP7 owns the wording. */
export interface SuggestFixesOutput {
  text: string;
  structured: Record<string, unknown>;
}

/** Fixes for the issues of one linted file. */
export function fixesFor(_doc: Doc, _issues: readonly Issue[], _safety: "safe" | "all" = "all"): FixSuggestion[] {
  return [];
}

/**
 * Sets issue.fix on every fixable issue of the project, for JSON and SARIF output. Call it before
 * project.findings(), which is computed once.
 */
export function attachFixes(_project: ProjectResult, _safety: "safe" | "all" = "all"): void {
  // Stub: WP7 fills this in.
}

/** One combined diff for --fix-preview, ready for git apply. "" when there is nothing to fix. */
export function fixPreview(_project: ProjectResult, _safety: "safe" | "all" = "all"): string {
  return "";
}

/** Body of the suggest_fixes MCP tool. */
export async function suggestFixes(_sandbox: Sandbox, _args: SuggestFixesArgs, _deadline: Deadline): Promise<SuggestFixesOutput> {
  return {
    text: "suggest_fixes is not available in this build yet. lint_steering lists the findings.",
    structured: { available: false, fixes: [], diff: "" },
  };
}
