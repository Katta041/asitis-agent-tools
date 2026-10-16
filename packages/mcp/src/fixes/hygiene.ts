// Two byte-hygiene rules that exist so their fixes can be offered: trailing-whitespace and
// final-newline. Both are notes, and both only fire where the fix cannot change what the file says.
// In a sample of 230 real steering files (CLAUDE.md, AGENTS.md, SKILL.md, .mdc) 6 had trailing
// whitespace and 4 had no final newline, so they stay rare.
//
// trailing-whitespace. CommonMark 0.31.2, "Hard line breaks" and "Soft line breaks",
// https://spec.commonmark.org/0.31.2/#hard-line-breaks (read 14 October 2026): two or more spaces
// before a line ending inside a paragraph make a <br>; other spaces or tabs at the end of a line are
// stripped. So a run is left alone, and not reported, when it could be a hard break (two or more
// spaces with a non-blank line after it), when it follows a backslash, inside fenced code, inside
// frontmatter (YAML block scalars keep trailing spaces), inside <pre>, <textarea>, <script> and
// <style>, and on lines indented four or more columns (they can be code).
//
// final-newline. POSIX.1-2024, 3.185 "Line": a line ends with a newline; text after the last one is
// an incomplete line (https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap03.html,
// read 14 October 2026). Reported only when the file already has line breaks, so a one-line file
// without one is not flagged. The message says only what POSIX says; no agent behaviour is claimed.

import type { Doc } from "../doc.js";
import type { Issue } from "../lint.js";

export interface TrailingRun {
  /** 0-based line. */
  line: number;
  /** Text offsets of the run. */
  from: number;
  to: number;
}

const RAW_HTML_OPEN = /<(pre|textarea|script|style)\b/i;

const isBlank = (s: string): boolean => /^[ \t]*$/.test(s);
const indented = (s: string): boolean => /^(?: {4}|\t| {0,3}\t)/.test(s);

/** Trailing spaces and tabs that can be deleted without changing how the markdown renders. */
export function safeTrailingRuns(doc: Doc): TrailingRun[] {
  if (doc.profile.encoding !== "utf-8" || doc.profile.trailingWhitespaceLines === 0) return [];
  const out: TrailingRun[] = [];
  const { lines, fence } = doc;
  const fm = doc.frontmatter;
  let rawClose: RegExp | null = null;
  let prevNonBlank = "";
  for (let i = 0; i < lines.count; i++) {
    const line = lines.line(i);
    if (fm.startLine >= 0 && i >= fm.startLine && i <= fm.endLine) continue; // frontmatter, also when misplaced
    if (rawClose) {
      if (rawClose.test(line)) rawClose = null;
      continue;
    }
    const open = line.length <= 4000 ? RAW_HTML_OPEN.exec(line) : null;
    if (open && !new RegExp(`</${open[1]}\\s*>`, "i").test(line.slice(open.index))) {
      rawClose = new RegExp(`</${open[1]}\\s*>`, "i");
      continue;
    }
    if (fence[i]) {
      prevNonBlank = line;
      continue;
    }
    const end = line.length;
    let t = end;
    while (t > 0 && (line.charCodeAt(t - 1) === 32 || line.charCodeAt(t - 1) === 9)) t--;
    if (t === end) {
      if (!isBlank(line)) prevNonBlank = line;
      continue;
    }
    const start = lines.start(i);
    if (t === 0) {
      // A whitespace-only line is blank either way, unless it sits in an indented code block.
      if (!indented(prevNonBlank)) out.push({ line: i, from: start, to: start + end });
      continue;
    }
    prevNonBlank = line;
    if (indented(line)) continue;
    if (line.charCodeAt(t - 1) === 92) continue; // "\" then spaces: deleting them would make a hard break
    const run = line.slice(t);
    const next = i + 1 < lines.count ? lines.line(i + 1) : "";
    if (/ {2}/.test(run) && i + 1 < lines.count && !isBlank(next)) continue; // could be a hard line break
    out.push({ line: i, from: start + t, to: start + end });
  }
  return out;
}

/** The line break to add at the end of the file, or "" when the rule does not apply. */
export function finalNewlineFor(doc: Doc): string {
  const p = doc.profile;
  if (p.encoding !== "utf-8" || p.finalNewline || !doc.text.length || p.eol.style === "none") return "";
  if (p.eol.style === "crlf") return "\r\n";
  if (p.eol.style === "cr") return "\r";
  if (p.eol.style === "lf") return "\n";
  // Mixed: the kind most lines use, ties going to the last break in the file.
  const { lf, crlf, cr } = p.eol;
  const max = Math.max(lf, crlf, cr);
  const lastKind = doc.lines.count >= 2 ? doc.lines.breakKind(doc.lines.count - 2) : 1;
  const byKind: Record<number, string> = { 1: "\n", 2: "\r\n", 3: "\r" };
  const counts: Record<number, number> = { 1: lf, 2: crlf, 3: cr };
  if (counts[lastKind] === max) return byKind[lastKind]!;
  return lf === max ? "\n" : crlf === max ? "\r\n" : "\r";
}

/** The trailing-whitespace and final-newline findings of one file. */
export function hygieneIssues(doc: Doc): Issue[] {
  const out: Issue[] = [];
  const runs = safeTrailingRuns(doc);
  if (runs.length) {
    const first = runs[0]!.line + 1;
    out.push({
      severity: "info",
      rule: "trailing-whitespace",
      message: `${runs.length === 1 ? `Line ${first} ends` : `${runs.length} lines end, starting at line ${first},`} in spaces or tabs that change nothing when rendered; delete them so they do not turn up as noise in diffs`,
      line: first,
    });
  }
  if (finalNewlineFor(doc)) {
    out.push({
      severity: "info",
      rule: "final-newline",
      message: "The last line has no line break at the end, so by the POSIX definition it is an incomplete line, and diffs show \"No newline at end of file\"; add one",
      line: doc.lines.count,
    });
  }
  return out;
}
