// bidi-control (review): delete bidirectional controls, and any other removable invisible
// characters on the same line. Source: Trojan Source, https://trojansource.codes/ (read 14 October
// 2026). A line with right-to-left letters can need these controls to display correctly, so there
// is no fix for it: the user decides by hand.

import type { Fixer } from "../fix.js";
import { keptNote, nameList, planInvisible } from "./invisible.js";
import { lineIndex, noFix, suggestion } from "./util.js";

const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

export const fixBidiControl: Fixer = (doc, issue) => {
  const li = lineIndex(doc, issue.line);
  if (li < 0) return null;
  if (RTL.test(doc.lines.line(li))) {
    return noFix(doc, issue, "review", "No fix: the line has right-to-left text, where these controls can be deliberate. Check how it displays and remove them by hand if they are not needed.");
  }
  const plan = planInvisible(doc, li, { bidi: true });
  if (!plan || !plan.edits.length) return null;
  const note = keptNote(plan.kept);
  return suggestion(
    doc,
    issue,
    "review",
    `remove ${plan.removed.length === 1 ? "1 control character" : `${plan.removed.length} control characters`} (${nameList(plan.removed)})`,
    plan.edits,
    `Check that the line reads the same before and after.${note ? ` ${note}` : ""}`,
  );
};
