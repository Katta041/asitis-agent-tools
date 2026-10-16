// trailing-whitespace (safe): delete spaces and tabs at the end of lines where they do nothing.
// Which lines are safe is decided in hygiene.ts, which also reports the finding.

import { MAX_FIX_EDITS, type Fixer } from "../fix.js";
import { safeTrailingRuns } from "./hygiene.js";
import { noFix, suggestion, textEdit } from "./util.js";

export const fixTrailingWhitespace: Fixer = (doc, issue) => {
  const runs = safeTrailingRuns(doc);
  if (!runs.length) return null;
  // Millions of lines with trailing spaces: building that many edits takes far longer than a tool
  // call may, and the diff would be too large to use. Say so instead (fix.ts has the same limit).
  if (runs.length > MAX_FIX_EDITS) return noFix(doc, issue, "safe", `No fix: it would change ${runs.length.toLocaleString("en-US")} lines, more than the ${MAX_FIX_EDITS.toLocaleString("en-US")} a diff here can hold. Fix it with your editor instead.`);
  const edits = [];
  for (const r of runs) {
    const e = textEdit(doc, r.from, r.to, "");
    if (!e) return null;
    edits.push(e);
  }
  // Say which lines and how much goes: on a 1,000-character line the diff alone hides that only the end changes.
  const chars = runs.reduce((n, r) => n + (r.to - r.from), 0);
  const at = runs.slice(0, 3).map((r) => r.line + 1).join(", ") + (runs.length > 3 ? ` and ${runs.length - 3} more` : "");
  return suggestion(doc, issue, "safe", `remove ${chars === 1 ? "1 trailing space or tab" : `${chars} trailing spaces or tabs`} at the end of ${runs.length === 1 ? "line" : "lines"} ${at}; nothing else on ${runs.length === 1 ? "that line" : "those lines"} changes`, edits);
};
