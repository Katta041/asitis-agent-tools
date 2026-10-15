// hidden-instruction (review): delete the hidden comment that reads like an instruction to the
// agent. Source: Pillar Security, "Rules File Backdoor"
// (https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents,
// read 14 October 2026). A comment on lines of its own goes with those lines; one that shares a line
// with text is cut out of it. Unclosed comments and comments in code are not touched.

import type { Fixer } from "../fix.js";
import type { FixEdit } from "../findings.js";
import { classifyInstruction, InlineCodeSpans, scanComments, scanRefComments } from "../scan.js";
import { LineIndex } from "../text.js";
import { patched, suggestion, textEdit } from "./util.js";

const MAX_COMMENT = 1_000_000;

export const fixHiddenInstruction: Fixer = (doc, issue) => {
  const li = issue.line - 1;
  if (li < 0 || li >= doc.lines.count || doc.fence[li]) return null;
  const s = doc.text;
  const lineStart = doc.lines.start(li);
  const lineEnd = doc.lines.end(li);
  const edits: FixEdit[] = [];
  let what = "";

  // HTML comments that start on this line.
  const spans = new InlineCodeSpans(doc.lines);
  let pos = lineStart;
  for (;;) {
    const open = s.indexOf("<!--", pos);
    if (open < 0 || open >= lineEnd) break;
    if (spans.inCode(li, open)) { pos = open + 4; continue; }
    const close = s.indexOf("-->", open + 4);
    if (close < 0 || close - open > MAX_COMMENT) break;
    pos = close + 3;
    if (!classifyInstruction(s.slice(open + 4, close))) continue;
    const endLine = doc.lines.lineOf(close + 2);
    const alone = s.slice(lineStart, open).trim() === "" && s.slice(close + 3, doc.lines.end(endLine)).trim() === "";
    const from = alone ? lineStart : open;
    const to = alone ? (endLine + 1 < doc.lines.count ? doc.lines.start(endLine + 1) : doc.text.length) : close + 3;
    const e = textEdit(doc, from, to, "");
    if (!e) return null;
    edits.push(e);
    what = "delete the hidden comment";
  }
  // A [//]: # (...) comment is always a line of its own.
  if (!edits.length && scanRefComments(doc.lines, doc.fence).some((r) => r.line === issue.line && r.instructionLike)) {
    const e = textEdit(doc, lineStart, li + 1 < doc.lines.count ? doc.lines.start(li + 1) : doc.text.length, "");
    if (!e) return null;
    edits.push(e);
    what = "delete the hidden [//]: # comment line";
  }
  if (!edits.length) return null;
  // Check: the patched file has fewer instruction-like hidden comments.
  const count = (lines: LineIndex, fence: Uint8Array): number =>
    scanComments(lines, fence).findings.filter((f) => f.instructionLike).length + scanRefComments(lines, fence).filter((f) => f.instructionLike).length;
  const after = patched(doc, edits);
  if (count(after.lines, new Uint8Array(after.lines.count)) >= count(doc.lines, new Uint8Array(doc.lines.count))) return null;
  return suggestion(doc, issue, "review", what, edits, "Read the comment first: if you wrote it on purpose, keep it.");
};
