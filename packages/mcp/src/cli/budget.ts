// asitis budget [file]: what each agent loads at the start of every session, as context_budget
// reports it. Owner: WP1. The numbers come from budget.ts, the same code the MCP tool uses; only
// the wording differs (no tool names, no notes meant for a model).

import { fileBudget, missingImportWarnings, projectBudget, type BudgetEntry } from "../budget.js";
import type { Deadline } from "../discover.js";
import { esc } from "../escape.js";
import { KIND_LABEL, LOAD_SHORT, TOOL_NAME } from "../kinds.js";
import { CAPS } from "../limits.js";
import type { Sandbox } from "../paths.js";
import { approxTokens, fmtTokens } from "../tokens.js";
import { VERSION } from "../version.js";

const n = (x: number): string => x.toLocaleString("en-US");
const plural = (count: number, word: string, many = `${word}s`): string => `${n(count)} ${count === 1 ? word : many}`;
const toolName = (t: string): string => TOOL_NAME[t] ?? t;

function entry(e: BudgetEntry): string {
  if (e.tokens === 0 && e.note && /not counted|not listed/.test(e.note)) return `  ${esc(e.path, 400)}: ${esc(e.note, 400)}`;
  return `  ${esc(e.path, 400)}: ${fmtTokens(e.tokens)}${e.note ? `, ${esc(e.note, 400)}` : ""}`;
}

export interface BudgetOutput {
  text: string;
  json: Record<string, unknown>;
}

/** Budget of one file and its imports. `target` is the path as the sandbox should open it. */
export async function fileBudgetReport(sandbox: Sandbox, target: string, deadline: Deadline): Promise<BudgetOutput> {
  const { doc, tokens, imports } = await fileBudget(sandbox, target, deadline);
  const total = tokens + imports.reduce((a, e) => a + e.tokens, 0);
  const regular = imports.filter((e) => !e.overflow);
  const shown = [...regular.slice(0, CAPS.listMaxFiles), ...imports.filter((e) => e.overflow)];
  const missing = missingImportWarnings(imports);
  const whole = approxTokens(doc.text);
  const lines = [
    `${esc(doc.path, 400)}: ${fmtTokens(tokens)} on its own (${KIND_LABEL[doc.kind.kind]}, ${LOAD_SHORT[doc.kind.load]}; ${plural(doc.profile.lines, "line")}, ${plural(doc.profile.bytes, "byte")}).`,
  ];
  if (whole > tokens) lines.push(`The whole file is ${fmtTokens(whole)}; block HTML comments are left out because Claude Code strips them before loading.`);
  if (imports.length) {
    lines.push(`With its @imports: ${fmtTokens(total)}.`, ...shown.map(entry));
    if (regular.length > CAPS.listMaxFiles) lines.push(`  and ${plural(regular.length - CAPS.listMaxFiles, "more import")}, counted but not listed`);
  }
  for (const w of missing.slice(0, 20)) lines.push(`warning: ${esc(w, 400)}`);
  lines.push("", "Token counts are local estimates (about 4 characters per token for English).");
  return {
    text: `${lines.join("\n")}\n`,
    json: { schemaVersion: 1, tool: { name: "asitis", version: VERSION }, path: doc.path, kind: doc.kind.kind, load: doc.kind.load, tokens, totalWithImports: total, imports: shown, importCount: imports.length, approximate: true },
  };
}

/** Budget of the whole root folder, per tool. */
export async function projectBudgetReport(sandbox: Sandbox, root: string, deadline: Deadline): Promise<BudgetOutput & { cut: string }> {
  const b = await projectBudget(sandbox, deadline);
  const loading = b.tools.filter((t) => t.tokens > 0).sort((x, y) => y.tokens - x.tokens);
  const silent = b.tools.filter((t) => t.tokens === 0);
  const lines: string[] = [];
  if (loading.length) {
    lines.push(`Loaded at the start of every session (local estimates, largest first): ${loading.map((t) => `${toolName(t.tool)} ${fmtTokens(t.tokens).replace(/^about /, "")}`).join(", ")}.`);
  } else lines.push("Nothing in this folder loads at the start of every session.");
  for (const t of [...loading, ...silent]) {
    lines.push("", `${toolName(t.tool)}: ${t.tokens > 0 ? fmtTokens(t.tokens) : "nothing counted"}`);
    lines.push(...t.entries.slice(0, CAPS.listMaxFiles).map(entry));
    if (t.entries.length > CAPS.listMaxFiles) lines.push(`  and ${plural(t.entries.length - CAPS.listMaxFiles, "more entry", "more entries")}, counted but not listed`);
    for (const w of t.warnings.slice(0, 20)) lines.push(`  warning: ${esc(w, 400)}`);
    if (t.warnings.length > 20) lines.push(`  and ${plural(t.warnings.length - 20, "more warning")}`);
  }
  if (b.files.length) {
    lines.push("", b.files.length > 15 ? `Largest steering files (top 15 of ${n(b.files.length)}, whole file):` : "Steering files by size (whole file):");
    lines.push(...b.files.slice(0, 15).map((e) => `  ${esc(e.path, 400)}: ${fmtTokens(e.tokens)}, ${esc(e.note ?? "", 200)}`));
  }
  if (b.skippedFiles.length) lines.push("", `Not read: ${b.skippedFiles.slice(0, 10).map((x) => esc(x, 400)).join("; ")}`);
  lines.push("", "Project files only: ~/.claude/CLAUDE.md, personal skills and plugins are not counted.");
  return {
    text: `${lines.join("\n")}\n`,
    json: {
      schemaVersion: 1,
      tool: { name: "asitis", version: VERSION },
      root,
      tools: b.tools.map((t) => ({ ...t, entries: t.entries.slice(0, CAPS.listMaxFiles), entryCount: t.entries.length })),
      files: b.files.slice(0, CAPS.listMaxFiles),
      fileCount: b.files.length,
      approximate: true,
    },
    cut: b.truncated ? b.walkNote : "",
  };
}
