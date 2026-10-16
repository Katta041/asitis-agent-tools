// Shared by the name-format and name-dir-mismatch fixers: rewrite the value of `name:` in a SKILL.md
// and check by parsing the frontmatter again that name now reads as the new value.

import type { Doc } from "../doc.js";
import type { FixEdit } from "../findings.js";
import { frontmatterAfter, noNewProblems, textEdit, valueSpan, yamlScalar } from "./util.js";

/** The edit that sets name to `target`, or null when the line cannot be changed safely. */
export function setSkillName(doc: Doc, line: number, target: string): FixEdit | null {
  const li = line - 1;
  const span = li >= 0 ? valueSpan(doc, li) : null;
  if (!span || span.key !== "name") return null;
  const e = textEdit(doc, span.from, span.to, yamlScalar(target, span.quote));
  if (!e) return null;
  const after = frontmatterAfter(doc, [e]);
  if (!noNewProblems(doc.frontmatter, after) || after.data?.["name"] !== target) return null;
  return e;
}
