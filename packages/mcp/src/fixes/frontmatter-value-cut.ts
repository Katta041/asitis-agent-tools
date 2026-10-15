// frontmatter-value-cut (review): put the value in single quotes so " #" is kept as text. YAML 1.2.2,
// "Comments" (https://yaml.org/spec/1.2.2/#comments, read 14 October 2026): in a plain scalar a "#"
// after a space starts a comment. Review: it changes the parsed value to the full text, which is the
// point, but the author may have meant the comment.

import type { Fixer } from "../fix.js";
import { frontmatterAfter, noNewProblems, suggestion, textEdit, valueSpan } from "./util.js";

export const fixFrontmatterValueCut: Fixer = (doc, issue) => {
  const li = issue.line - 1;
  if (li < 0 || li >= doc.lines.count) return null;
  const span = valueSpan(doc, li);
  if (!span || span.quote) return null;
  // The whole rest of the line, comment included, is the value the author wrote.
  const line = doc.lines.line(li);
  const lineStart = doc.lines.start(li);
  const full = line.slice(span.from - lineStart).replace(/[ \t]+$/, "");
  const quoted = `'${full.replace(/'/g, "''")}'`;
  const e = textEdit(doc, span.from, span.from + full.length, quoted);
  if (!e) return null;
  const after = frontmatterAfter(doc, [e]);
  if (!noNewProblems(doc.frontmatter, after, "frontmatter-value-cut") || after.data?.[span.key] !== full) return null;
  return suggestion(doc, issue, "review", `quote the value of ${span.key} so the text after " #" is kept`, [e]);
};
