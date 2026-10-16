// frontmatter-not-line-1 (safe): move the blank lines above the frontmatter to just below it, so
// --- is the first line and line numbers below stay the same. Claude Code skills docs
// (https://code.claude.com/docs/en/skills, read 14 October 2026) and the Agent Skills spec read
// frontmatter only at the top of the file. A BOM stays where it is.

import type { Fixer } from "../fix.js";
import { frontmatterAfter, suggestion, textEdit } from "./util.js";

export const fixFrontmatterNotLine1: Fixer = (doc, issue) => {
  const fm = doc.frontmatter;
  if (fm.present || fm.startLine <= 0 || fm.endLine <= fm.startLine) return null;
  for (let i = 0; i < fm.startLine; i++) if (doc.lines.line(i).replace(/^﻿/, "").trim() !== "") return null;
  const bom = doc.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const head = doc.lines.start(fm.startLine);
  const moved = doc.text.slice(bom, head);
  const del = textEdit(doc, bom, head, "");
  if (!del) return null;
  const edits = [del];
  // Put the lines back after the closing --- (when it has a line break after it).
  if (fm.endLine + 1 < doc.lines.count || doc.lines.breakKind(fm.endLine) !== 0) {
    const at = fm.endLine + 1 < doc.lines.count ? doc.lines.start(fm.endLine + 1) : doc.text.length;
    const ins = textEdit(doc, at, at, moved);
    if (!ins) return null;
    edits.push(ins);
  }
  const after = frontmatterAfter(doc, edits);
  if (!after.present || after.problems.some((p) => p.rule === "frontmatter-not-line-1" || p.rule === "frontmatter-unclosed")) return null;
  return suggestion(doc, issue, "safe", `move ${fm.startLine === 1 ? "the blank line" : `${fm.startLine} blank lines`} from above the frontmatter to below it`, edits, after.problems.length ? "The frontmatter is read after this change, and it has other problems lint_steering will report." : undefined);
};
