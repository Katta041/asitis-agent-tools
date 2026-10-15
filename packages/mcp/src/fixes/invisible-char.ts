// invisible-char (safe): delete zero-width and other invisible characters on the line.
// Source: Pillar Security, "Rules File Backdoor" (hidden Unicode in rules files),
// https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents
// read 14 October 2026. Characters that carry meaning (a ZWNJ in Persian, a ZWJ in an emoji, an RLM
// in right-to-left text) are left alone; see invisible.ts.

import type { Fixer } from "../fix.js";
import { keptNote, nameList, planInvisible } from "./invisible.js";
import { lineIndex, noFix, suggestion } from "./util.js";

export const fixInvisibleChar: Fixer = (doc, issue) => {
  const li = lineIndex(doc, issue.line);
  if (li < 0) return null;
  const plan = planInvisible(doc, li, { bidi: false });
  if (!plan) return null;
  const note = keptNote(plan.kept);
  if (!plan.edits.length) return note ? noFix(doc, issue, "safe", `No fix: ${note}`) : null;
  return suggestion(doc, issue, "safe", `remove ${plan.removed.length === 1 ? "1 invisible character" : `${plan.removed.length} invisible characters`} (${nameList(plan.removed)})`, plan.edits, note ? `The finding stays: ${note}` : undefined);
};
