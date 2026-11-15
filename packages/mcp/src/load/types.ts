// Types for the load model: what each agent loads when it starts in a folder, in order.

/** The tools load_plan reports on, plus the two the session budget also counts. */
export type ToolId = "claude-code" | "codex" | "gemini-cli" | "cursor" | "copilot" | "windsurf" | "cline";

/** The five tools load_plan and asitis loads show. */
export const PLAN_TOOLS: readonly ToolId[] = ["claude-code", "codex", "gemini-cli", "cursor", "copilot"];

/**
 * When a step loads.
 * - launch: at the start of the session.
 * - on-read: the first time the agent reads or edits a file in the step's folder.
 * - on-match: when the agent works with a file matching the step's patterns.
 * - on-invoke: when the agent or the user picks it (a description-only rule, an @-mention).
 * - setting: only when a setting whose default we cannot see is on.
 * - on-approval: only after the user approves it in the tool (Claude Code's dialog for imports from
 *   outside the start folder). The answer is stored per project, so we cannot see it.
 */
export type Trigger = "launch" | "on-read" | "on-match" | "on-invoke" | "setting" | "on-approval";

/**
 * Why we believe it.
 * - documented: the vendor docs or source say so (source has the link).
 * - canary: a planted canary string showed it on a real run of the tool (source has version and date).
 * - assumed: neither; our best reading, to be checked.
 */
export type Basis = "documented" | "canary" | "assumed";

export interface Cut {
  /** Where the tool stops reading the file. */
  at: number;
  unit: "bytes" | "chars" | "lines";
  /** Why, in one sentence. */
  reason: string;
  /** The whole file, before the cut. */
  tokensWhole: number;
}

export interface LoadStep {
  /** Display path, or a label for a step that is not one file ("Skill listing (3 entries)"). */
  path: string;
  kind: "file" | "import" | "listing" | "missing" | "overflow";
  trigger: Trigger;
  /** The trigger in words: "at launch", "when Claude reads a file in packages/api". */
  when: string;
  /** For on-match steps: the patterns, as written. */
  patterns?: string[];
  /** For on-match steps: how many files in the tree match now (null when the tree listing was cut short). */
  matches?: number | null;
  /** For imports: the files from the top-level file down to the one that imports this one. */
  via?: string[];
  /** Import depth, 1 for a direct import. */
  depth?: number;
  /** Tokens that load (after any cut). */
  tokens: number;
  cut?: Cut;
  /** Root-relative folder the step applies to ("" for the root). */
  scope: string;
  /** In the launch total. Launch steps that depend on a setting or a surface we cannot see are listed but not counted. */
  counted: boolean;
  basis: Basis;
  /** A doc URL, or a note ("canary, Claude Code 2.1.312, 2026-11-15"). */
  source: string;
  /** Short note, the same wording context_budget uses for this entry. */
  note?: string;
  /** For a missing import: the file that imports it and the line. */
  missingFrom?: { path: string; line: number };
}

export interface SkippedFile {
  path: string;
  reason: string;
  basis: Basis;
  source: string;
}

export interface LoadPlan {
  tool: ToolId;
  /** Root-relative folder the session starts in ("" for the root). */
  cwd: string;
  steps: LoadStep[];
  skipped: SkippedFile[];
  /** Problems worth fixing, one sentence each (context_budget shows these too). */
  warnings: string[];
  /** Limits of the model for this tool: settings we cannot read, folders above the root. */
  notes: string[];
}

export interface PlanTotals {
  launchTokens: number;
  launchSteps: number;
  laterTokens: number;
  laterSteps: number;
  /** Steps that load only when a setting we cannot see is on or after an approval, or that load at launch but are not counted. */
  conditionalSteps: number;
  cutSteps: number;
  skipped: number;
}

export function totals(p: LoadPlan): PlanTotals {
  let launchTokens = 0;
  let launchSteps = 0;
  let laterTokens = 0;
  let laterSteps = 0;
  let cutSteps = 0;
  let conditionalSteps = 0;
  for (const s of p.steps) {
    if (s.cut) cutSteps++;
    if (s.kind === "missing" || s.kind === "overflow") continue;
    if (s.trigger === "launch" && s.counted) {
      launchTokens += s.tokens;
      launchSteps++;
    } else if (s.trigger === "setting" || s.trigger === "on-approval" || s.trigger === "launch") {
      conditionalSteps++;
    } else {
      laterTokens += s.tokens;
      laterSteps++;
    }
  }
  return { launchTokens, launchSteps, laterTokens, laterSteps, conditionalSteps, cutSteps, skipped: p.skipped.length };
}
