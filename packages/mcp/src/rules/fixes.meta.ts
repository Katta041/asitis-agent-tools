// Rules added by WP7 so their fixes can be offered. Both are notes and only fire where the fix
// cannot change what the file says; detection is in fixes/hygiene.ts. Sources read 14 October 2026.

import { rule, type RuleMeta } from "./types.js";

export const FIX_RULES: RuleMeta[] = [
  rule({
    id: "trailing-whitespace",
    category: "format",
    defaultSeverity: "note",
    summary: "Lines end in spaces or tabs that change nothing when rendered",
    why: "Trailing spaces and tabs are invisible and do nothing outside a hard line break, but editors that trim them on save turn them into diff noise. Two spaces that may be a hard line break, code and frontmatter are left alone.",
    source: "https://spec.commonmark.org/0.31.2/#hard-line-breaks",
    fixable: "safe",
  }),
  rule({
    id: "final-newline",
    category: "format",
    defaultSeverity: "note",
    summary: "File with line breaks does not end with one",
    why: "POSIX defines a line as ending with a newline. Text appended later with echo >> or by an agent joins the last line instead of starting a new one.",
    source: "https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap03.html",
    fixable: "safe",
  }),
];
