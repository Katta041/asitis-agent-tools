// trailing-whitespace (safe): delete spaces and tabs at the end of lines where they do nothing.
// Which lines are safe is decided in hygiene.ts, which also reports the finding.

import type { Fixer } from "../fix.js";
import { safeTrailingRuns } from "./hygiene.js";
import { suggestion, textEdit } from "./util.js";

export const fixTrailingWhitespace: Fixer = (doc, issue) => {
  const runs = safeTrailingRuns(doc);
  if (!runs.length) return null;
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
