// unknown-key (review): rename a key that is one or two letters away from a key the tool reads
// ("user-invokable" to "user-invocable"). Only the near misses lint reports as warnings get a fix;
// a key with no close match is left alone. Keys come from the docs cited in lint.ts (Claude Code
// skills and subagents, Agent Skills spec, Cursor rules, VS Code custom instructions).

import type { Fixer } from "../fix.js";
import { frontmatterAfter, noNewProblems, suggestion, textEdit } from "./util.js";

export const fixUnknownKey: Fixer = (doc, issue) => {
  const m = /did you mean "([A-Za-z_][\w.-]{0,59})"\?/.exec(issue.message);
  if (!m) return null;
  const target = m[1]!;
  const li = issue.line - 1;
  const fm = doc.frontmatter;
  if (!fm.present || li <= fm.startLine || li >= fm.endLine) return null;
  const km = /^([A-Za-z_][\w.-]*)[ \t]*:/.exec(doc.lines.line(li));
  if (!km || km[1] === target || fm.data?.[target] !== undefined) return null;
  const key = km[1]!;
  const start = doc.lines.start(li);
  const e = textEdit(doc, start, start + key.length, target);
  if (!e) return null;
  const after = frontmatterAfter(doc, [e]);
  if (!noNewProblems(doc.frontmatter, after) || !after.data || key in after.data || !(target in after.data)) return null;
  return suggestion(doc, issue, "review", `rename ${key} to ${target}`, [e], `${target} is a key the tool reads, so its value takes effect after the change.`);
};
