// Unified diffs against the original bytes (F6). Owner: WP7. Stub until WP7 lands.
// Contract: keep CRLF, BOM, trailing whitespace and the final newline exactly as they are, emit
// "\ No newline at end of file" when needed, paths as a/<path> and b/<path> so git apply takes it.

import type { FixEdit } from "./findings.js";

/** Diff of one file. "" when edits is empty. */
export function unifiedDiff(_path: string, _original: Buffer, _edits: readonly FixEdit[]): string {
  return "";
}

/** Several per-file diffs as one patch. */
export function combineDiffs(diffs: readonly string[]): string {
  return diffs.filter(Boolean).join("");
}
