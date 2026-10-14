// JSON parsing that keeps line and column for every key path, for agent config files (F9).
// Owner: WP6. Stub until WP6 lands. Must stay linear and bounded (64 KB nesting bombs finish
// within budget) and must never put a raw value in a message.

export interface JsonLocation {
  line: number;
  column: number;
}

export type JsonMapResult =
  | { ok: true; value: unknown; at(pointer: string): JsonLocation | undefined }
  | { ok: false; message: string; line: number; column: number };

export function parseJsonMap(_text: string): JsonMapResult {
  return { ok: false, message: "JSON parsing with locations is not available in this build", line: 1, column: 1 };
}
