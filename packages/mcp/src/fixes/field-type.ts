// field-type (review): write a yes/no-style word as a YAML boolean, for Cursor's alwaysApply.
// Cursor rules docs (https://cursor.com/docs/context/rules, read 14 October 2026) show alwaysApply
// as true or false; "yes" or a quoted "true" is a string there. Review, not safe: once it is a real
// boolean the rule may start applying to every chat, which is what the author meant but changes
// behaviour. Other field-type findings (a list where a string belongs) have no mechanical fix.

import type { Fixer } from "../fix.js";
import { frontmatterAfter, noFix, noNewProblems, suggestion, textEdit, valueSpan } from "./util.js";

const TRUE = /^(?:true|yes|on|1)$/i;
const FALSE = /^(?:false|no|off|0)$/i;

export const fixFieldType: Fixer = (doc, issue) => {
  if (doc.kind.kind !== "cursor-rule") return null;
  const span = valueSpan(doc, issue.line - 1);
  if (!span || span.key !== "alwaysApply") return null;
  const v = doc.frontmatter.data?.["alwaysApply"];
  const word = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const target = TRUE.test(word) ? true : FALSE.test(word) ? false : null;
  if (target === null) return noFix(doc, issue, "review", "No fix: the value is not a yes or no word, so set alwaysApply to true or false by hand.");
  const e = textEdit(doc, span.from, span.to, String(target));
  if (!e) return null;
  const after = frontmatterAfter(doc, [e]);
  if (!noNewProblems(doc.frontmatter, after) || after.data?.["alwaysApply"] !== target) return null;
  return suggestion(doc, issue, "review", `write alwaysApply as ${target}`, [e], target ? "Cursor will then apply this rule to every chat." : undefined);
};
