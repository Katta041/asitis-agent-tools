// Text and JSON for load_plan and asitis loads: what loads at launch, what loads later and when,
// what is cut, what is skipped and why, with totals that always count everything.

import { dp, esc } from "../escape.js";
import { TOOL_NAME } from "../kinds.js";
import { UserError, type Sandbox } from "../paths.js";
import { fmtTokens } from "../tokens.js";
import { totals, type LoadPlan, type LoadStep } from "./types.js";

/** Steps listed per tool per call; totals still count all of them. */
export const MAX_STEPS = 60;
/** Skipped files listed per tool. */
const MAX_SKIPPED_TEXT = 15;
const MAX_SKIPPED_JSON = 60;

const n = (x: number): string => x.toLocaleString("en-US");
const plural = (count: number, word: string, many = `${word}s`): string => `${n(count)} ${count === 1 ? word : many}`;
const toolName = (t: string): string => TOOL_NAME[t] ?? t;

/**
 * The start folder as a root-relative POSIX path ("" for the root). Relative paths resolve against
 * the root. A folder outside the root, missing, or not a folder is a UserError.
 */
export async function resolveCwd(sandbox: Sandbox, given: string | undefined, baseDir?: string): Promise<string> {
  if ((given === undefined || given === "" || given === ".") && !baseDir) return "";
  const g = given === undefined || given === "" ? "." : given;
  const lex = sandbox.lexical(g, baseDir);
  if (!lex || lex.root !== sandbox.primary) throw new UserError(`Folder outside the allowed folder: ${g}. Pass a folder inside it, relative to it.`);
  try {
    await sandbox.listDir(lex.abs);
  } catch (e) {
    if (e instanceof UserError && /^Refused/.test(e.message)) throw e;
    if (await sandbox.resolveReal(lex.abs).then(() => true, () => false)) throw new UserError(`Not a folder: ${g}. Pass the folder a session starts in.`);
    throw new UserError(`Folder not found: ${g}.`);
  }
  return lex.rel === "." ? "" : lex.rel;
}

export interface ViewOptions {
  /** Steps to skip per tool (paging). */
  offset?: number;
  /** For the MCP server: names go through dp() and the untrusted-data note is added by the caller. For the CLI: esc(). */
  forModel: boolean;
  /** A sentence about a cut-short folder walk, or "". */
  walkNote?: string;
}

const MARK: Record<string, string> = { assumed: " (assumed)", canary: "", documented: "" };

function stepLine(s: LoadStep, i: number, name: (p: string) => string): string {
  const indent = s.depth ? "   ".repeat(s.depth) : "";
  const label = s.kind === "overflow" || s.kind === "listing" ? esc(s.path, 300) : name(s.path);
  const mark = MARK[s.basis] ?? "";
  if (s.kind === "missing") return `    ${i}. ${indent}${label}: ${esc(s.note ?? "not loaded", 200)}`;
  if (s.kind === "overflow") return `    ${i}. ${indent}${label}`;
  const size = s.cut ? `${fmtTokens(s.tokens)} (cut from ${fmtTokens(s.cut.tokensWhole).replace(/^about /, "")})` : fmtTokens(s.tokens);
  const imp = s.via?.length ? `imported by ${name(s.via[s.via.length - 1]!)}` : "";
  const when = s.trigger === "launch" ? "" : s.when;
  const matches = s.trigger === "on-match" && s.matches !== undefined ? (s.matches === null ? "" : s.matches === 0 ? " (no file matches now)" : ` (${plural(s.matches, "file")} ${s.matches === 1 ? "matches" : "match"} now)`) : "";
  const tail = [imp, when ? `${esc(when, 300)}${matches}` : s.trigger === "launch" && s.note && !imp ? esc(s.note, 200) : ""].filter(Boolean).join(", ");
  return `    ${i}. ${indent}${label}, ${size}${tail ? `, ${tail}` : ""}${mark}`;
}

/** One tool's section of the text view, and its JSON. */
function toolView(p: LoadPlan, opts: ViewOptions): { lines: string[]; json: Record<string, unknown>; next: number | null } {
  const name = (x: string): string => (opts.forModel ? dp(x) : esc(x, 400));
  const t = totals(p);
  const offset = Math.min(opts.offset ?? 0, p.steps.length);
  const page = p.steps.slice(offset, offset + MAX_STEPS);
  const next = offset + page.length < p.steps.length ? offset + page.length : null;
  const head = `${toolName(p.tool)}: ${t.launchSteps ? `${fmtTokens(t.launchTokens)} at launch from ${plural(t.launchSteps, "file")}` : "nothing counted at launch"}${t.laterSteps ? `; ${plural(t.laterSteps, "more file")} can load later (${fmtTokens(t.laterTokens).replace(/^about /, "up to about ")})` : ""}${t.conditionalSteps ? `; ${plural(t.conditionalSteps, "file")} depending on settings or not counted` : ""}${t.cutSteps ? `; ${plural(t.cutSteps, "file")} cut` : ""}${t.skipped ? `; ${n(t.skipped)} not loaded` : ""}`;
  const lines: string[] = ["", head];
  const groups: Array<[string, (s: LoadStep) => boolean]> = [
    ["At launch", (s) => s.trigger === "launch" && s.counted],
    ["At launch, but not counted in the total", (s) => s.trigger === "launch" && !s.counted],
    ["Later, when the agent works in a folder or on matching files", (s) => s.trigger === "on-read" || s.trigger === "on-match"],
    ["Only when picked (by description or by you)", (s) => s.trigger === "on-invoke"],
    ["Only if a setting is on (not counted)", (s) => s.trigger === "setting"],
  ];
  for (const [title, pick] of groups) {
    const rows: string[] = [];
    page.forEach((s, k) => {
      if (pick(s)) rows.push(stepLine(s, offset + k + 1, name));
    });
    if (!rows.length) continue;
    lines.push(`  ${title}`, ...rows);
  }
  if (offset > 0 || next !== null) lines.push(`  Showing steps ${n(offset + 1)} to ${n(offset + page.length)} of ${n(p.steps.length)}.${next !== null ? ` Call again with offset=${next} for the rest.` : ""}`);
  const cut = p.steps.filter((s) => s.cut);
  if (cut.length) {
    lines.push("  Cut");
    for (const s of cut.slice(0, 10)) lines.push(`    - ${name(s.path)}: ${esc(s.cut!.reason, 300)}. About ${fmtTokens(s.tokens).replace(/^about /, "")} of ${fmtTokens(s.cut!.tokensWhole).replace(/^about /, "")} load.`);
    if (cut.length > 10) lines.push(`    - and ${plural(cut.length - 10, "more cut file")}`);
  }
  if (p.skipped.length) {
    lines.push("  Not loaded");
    for (const s of p.skipped.slice(0, MAX_SKIPPED_TEXT)) lines.push(`    - ${name(s.path)}: ${esc(s.reason, 300)}${MARK[s.basis] ?? ""}`);
    if (p.skipped.length > MAX_SKIPPED_TEXT) lines.push(`    - and ${plural(p.skipped.length - MAX_SKIPPED_TEXT, "more file")}`);
  }
  if (p.warnings.length) {
    lines.push("  Warnings");
    for (const w of p.warnings.slice(0, 10)) lines.push(`    - ${esc(w, 400)}`);
    if (p.warnings.length > 10) lines.push(`    - and ${plural(p.warnings.length - 10, "more warning")}`);
  }
  const basis = { documented: 0, canary: 0, assumed: 0 };
  for (const s of p.steps) if (s.kind === "file" || s.kind === "import" || s.kind === "listing") basis[s.basis]++;
  const parts = [basis.documented ? `${n(basis.documented)} from vendor docs` : "", basis.canary ? `${n(basis.canary)} confirmed with a canary run` : "", basis.assumed ? `${n(basis.assumed)} assumed` : ""].filter(Boolean);
  if (parts.length) lines.push(`  How sure: ${parts.join(", ")}.`);
  const json = {
    tool: p.tool,
    cwd: p.cwd,
    totals: t,
    steps: page,
    stepCount: p.steps.length,
    offset,
    nextOffset: next,
    skipped: p.skipped.slice(0, MAX_SKIPPED_JSON),
    skippedCount: p.skipped.length,
    warnings: p.warnings,
    notes: p.notes,
  };
  return { lines, json, next };
}

export function viewPlans(plans: LoadPlan[], opts: ViewOptions): { text: string; json: Record<string, unknown> } {
  const cwd = plans[0]?.cwd ?? "";
  const where = cwd ? (opts.forModel ? dp(cwd) : esc(cwd, 400)) : "the project root";
  const lines: string[] = [`What loads when a session starts in ${where} (local estimates, about 4 characters per token):`];
  const tools: Array<Record<string, unknown>> = [];
  for (const p of plans) {
    const v = toolView(p, opts);
    lines.push(...v.lines);
    tools.push(v.json);
  }
  const notes = [...new Set(plans.flatMap((p) => p.notes))];
  if (notes.length) lines.push("", "Not visible to AsItIs:", ...notes.map((x) => `  - ${esc(x, 400)}`));
  if (opts.walkNote) lines.push("", esc(opts.walkNote, 400));
  return { text: lines.join("\n"), json: { cwd, tools, approximate: true } };
}
