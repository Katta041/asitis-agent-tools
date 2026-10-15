// asitis lint --format github: GitHub Actions workflow commands, one annotation per unsuppressed
// finding. Owner: WP1.
//
// Escaping follows the runner's own toCommandValue/escapeProperty (actions/toolkit,
// packages/core/src/command.ts, read 14 October 2026): data escapes % CR LF, properties also
// escape : and ,. Workflow command syntax:
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands (read
// 14 October 2026). The runner only treats a line as a command when the line starts with "::".
// Because CR and LF are escaped, nothing from a file can start a line, so ::set-env, ::add-mask or
// a ::stop-commands:: token inside a steering file stays inert text in a message. Messages also go
// through esc() first, so control and bidi characters show as \u escapes.

import { workspacePath } from "./workspace.js";
import { esc } from "../escape.js";
import type { FindingSeverity, LintReport } from "../findings.js";
import { summaryLine } from "./text.js";

const COMMAND: Record<FindingSeverity, string> = { error: "error", warning: "warning", note: "notice" };

/** Escaping for the message part (after the second "::"). */
export function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escaping for a property value (file=, title=). */
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export interface GithubOptions {
  quiet?: boolean;
  notes?: readonly string[];
  /**
   * Also annotate findings of severity note. Off by default: every annotation shows up on the pull
   * request, and notes (a hidden comment, a missing final newline) are not worth a reviewer's
   * attention there. They still count in the summary line.
   */
  annotateNotes?: boolean;
}


export function formatGithub(report: LintReport, opts: GithubOptions = {}): string {
  const lines: string[] = [];
  let hiddenNotes = 0;
  for (const f of report.findings) {
    if (f.suppressed) continue;
    if (f.severity === "note" && !opts.annotateNotes) {
      hiddenNotes++;
      continue;
    }
    const props = [
      `file=${escapeProperty(esc(workspacePath(report.root, f.path), 400))}`,
      `line=${f.line}`,
      `col=${f.column}`,
      `endLine=${f.endLine}`,
      `endColumn=${f.endColumn}`,
      `title=${escapeProperty(`asitis(${f.ruleId})`)}`,
    ].join(",");
    lines.push(`::${COMMAND[f.severity]} ${props}::${escapeData(esc(f.message, 1000))}`);
  }
  if (!opts.quiet) {
    for (const note of opts.notes ?? []) lines.push(`::notice::${escapeData(esc(note, 400))}`);
    lines.push(`asitis: ${summaryLine(report.summary)}`);
    if (hiddenNotes) lines.push(`asitis: ${hiddenNotes.toLocaleString("en-US")} ${hiddenNotes === 1 ? "note is" : "notes are"} not shown as annotations; add --annotate-notes to show ${hiddenNotes === 1 ? "it" : "them"}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
