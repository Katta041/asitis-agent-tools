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
  return suggestion(doc, issue, "safe", `remove trailing spaces or tabs on ${runs.length === 1 ? "1 line" : `${runs.length} lines`}`, edits);
};
