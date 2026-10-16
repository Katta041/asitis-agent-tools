// final-newline (safe): end the file with a line break of the kind the file already uses.

import type { Fixer } from "../fix.js";
import { finalNewlineFor } from "./hygiene.js";
import { suggestion, textEdit } from "./util.js";

export const fixFinalNewline: Fixer = (doc, issue) => {
  const eol = finalNewlineFor(doc);
  if (!eol) return null;
  const e = textEdit(doc, doc.text.length, doc.text.length, eol);
  if (!e) return null;
  return suggestion(doc, issue, "safe", `add a final ${eol === "\r\n" ? "CRLF" : eol === "\r" ? "CR" : "LF"} line break`, [e]);
};
