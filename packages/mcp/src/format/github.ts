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
}

/**
 * Annotation file paths are relative to the workspace. When --root names a relative subfolder,
 * prefix it, so `asitis lint --root docs` annotates docs/CLAUDE.md and not CLAUDE.md.
 */
function workspacePath(root: string, p: string): string {
  const r = root.replace(/\/+$/, "");
  if (r === "" || r === "." || r.startsWith("/") || /^[A-Za-z]:/.test(r) || r.startsWith("..")) return p;
  return `${r.replace(/^\.\//, "")}/${p}`;
}

export function formatGithub(report: LintReport, opts: GithubOptions = {}): string {
  const lines: string[] = [];
  for (const f of report.findings) {
    if (f.suppressed) continue;
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
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
