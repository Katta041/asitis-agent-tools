// Inline suppression comments: <!-- asitis-disable-next-line rule-id -- reason --> and
// <!-- asitis-disable-file rule-id -- reason -->. Owner: WP2. Stub until WP2 lands.
// Rules whose registry entry has suppressibleInline false (every security rule) are never
// suppressed by a comment; the comment itself is reported as suppression-not-allowed.

import type { Doc } from "./doc.js";
import type { Issue } from "./lint.js";

export interface InlineSuppression {
  kind: "next-line" | "file";
  ruleIds: string[];
  justification: string;
  /** 1-based line of the comment. */
  line: number;
}

export function parseSuppressions(_doc: Doc): InlineSuppression[] {
  return [];
}

/** Marks suppressed issues and returns issues about the comments themselves (unknown, unused, not allowed). */
export function applyInlineSuppressions(_doc: Doc, _issues: Issue[], _found: InlineSuppression[]): Issue[] {
  return [];
}
