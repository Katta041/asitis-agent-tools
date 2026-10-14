// Linear-time scanner for scripts and fenced setup blocks in skill folders (F8). Owner: WP5.
// Stub until WP5 lands. Same rules as scan.ts: forward indexOf, bounded slices, no nested or lazy
// quantifiers over unbounded input; test/skills-dos.test.ts holds it to the 3 s budget.

export interface ScriptHit {
  ruleId: string;
  /** 1-based. */
  line: number;
  column: number;
  endColumn: number;
  /** At most 80 characters of file text, already passed through redact.ts preview(). */
  excerpt: string;
}

export type ScriptSource = "script" | "skill-fence" | "readme-fence";

export function scanScript(_text: string, _source: ScriptSource): ScriptHit[] {
  return [];
}
