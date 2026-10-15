// asitis lint --format text. Owner: WP1.
// One line per unsuppressed finding, "path:line:col severity rule-id message", in report order
// (path, line, column, severity, rule id), with a blank line between files so each file reads as a
// group. Then a blank line and the summary. Paths and messages go through esc(), so a control or
// bidi character in a file name or a quoted line can never start a second line or reorder one.

import { esc } from "../escape.js";
import type { LintReport, LintSummary } from "../findings.js";

const n = (x: number): string => x.toLocaleString("en-US");
const plural = (count: number, word: string): string => `${n(count)} ${count === 1 ? word : `${word}s`}`;

/** "Linted 12 files: 1 error, 3 warnings, 2 notes, 4 suppressed." Same wording as lint_steering. */
export function summaryLine(s: LintSummary): string {
  const head = `Linted ${plural(s.files, "file")}`;
  const sup = s.suppressed > 0 ? `, ${n(s.suppressed)} suppressed` : "";
  if (s.errors + s.warnings + s.notes === 0) return `${head}: no issues found${sup ? ` (${n(s.suppressed)} suppressed)` : ""}.`;
  return `${head}: ${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}, ${plural(s.notes, "note")}${sup}.`;
}

export interface TextOptions {
  /** No summary line and no notes. */
  quiet?: boolean;
  /** One-line notices printed after the summary. */
  notes?: readonly string[];
}

export function formatText(report: LintReport, opts: TextOptions = {}): string {
  const lines: string[] = [];
  let last: string | null = null;
  for (const f of report.findings) {
    if (f.suppressed) continue;
    if (last !== null && f.path !== last) lines.push("");
    last = f.path;
    lines.push(`${esc(f.path, 400)}:${f.line}:${f.column} ${f.severity} ${f.ruleId} ${esc(f.message, 1000)}`);
  }
  if (!opts.quiet) {
    if (lines.length) lines.push("");
    lines.push(summaryLine(report.summary));
    for (const note of opts.notes ?? []) lines.push(esc(note, 400));
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
