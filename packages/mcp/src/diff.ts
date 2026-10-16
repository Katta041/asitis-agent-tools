// Unified diffs against the original bytes (F6). Owner: WP7.
// Lines are split at LF only, the way git splits them, so a CR stays part of its line and CRLF,
// lone CR, a BOM, trailing whitespace and a missing final newline all come out exactly as they are.
// "\ No newline at end of file" marks a last line without LF on either side. Paths are a/<path> and
// b/<path>, quoted the way git quotes them, so `git apply` takes the output as is.
//
// A diff is text, so every line it shows must be valid UTF-8. Context lines stop at a line with
// invalid bytes; a changed line with invalid bytes, or a hunk in the middle of the file that would be
// left with no trailing context, cannot be shown exactly and throws DiffUnavailable. The fix engine
// then drops that fix and says why.

import type { FixEdit } from "./findings.js";
import { invalidUtf8Ranges } from "./text.js";

/** Lines of context around each change, as git and diff -u use by default. */
export const CONTEXT_LINES = 3;

export class DiffUnavailable extends Error {}

/** Diff of one file. "" when edits is empty. Throws DiffUnavailable when the change cannot be shown exactly. */
export function unifiedDiff(path: string, original: Buffer, edits: readonly FixEdit[]): string {
  if (!edits.length) return "";
  const sorted = sortEdits(edits);
  const lines = splitLines(original);
  if (!lines.length) throw new DiffUnavailable("the file is empty");
  // Old line range each edit touches, merged into change groups of adjacent or overlapping lines.
  const groups: Array<{ a: number; b: number; edits: FixEdit[] }> = [];
  for (const e of sorted) {
    const a = lineAt(lines, e.startByte, original.length);
    const b = e.endByte > e.startByte ? lineAt(lines, e.endByte - 1, original.length) : a;
    const last = groups[groups.length - 1];
    if (last && a <= last.b + 1) {
      last.b = Math.max(last.b, b);
      last.edits.push(e);
    } else groups.push({ a, b, edits: [e] });
  }
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const valid = (i: number): boolean => {
    const l = lines[i]!;
    return invalidUtf8Ranges(original.subarray(l.start, l.end)).count === 0;
  };
  const show = (bytes: Uint8Array): string => text.decode(bytes);

  // Context per group: up to CONTEXT_LINES on each side, stopping at a line with invalid bytes.
  type Hunk = { a: number; b: number; groups: typeof groups };
  const hunks: Hunk[] = [];
  for (const g of groups) {
    for (let i = g.a; i <= g.b; i++) if (!valid(i)) throw new DiffUnavailable("the changed line has bytes that are not valid UTF-8");
    let a = g.a;
    while (a > 0 && g.a - a < CONTEXT_LINES && valid(a - 1)) a--;
    let b = g.b;
    while (b < lines.length - 1 && b - g.b < CONTEXT_LINES && valid(b + 1)) b++;
    // git apply anchors a hunk without trailing context to the end of the file.
    if (b === g.b && g.b < lines.length - 1) throw new DiffUnavailable("the next line has bytes that are not valid UTF-8");
    const prev = hunks[hunks.length - 1];
    if (prev && a <= prev.b + 1) {
      prev.b = Math.max(prev.b, b);
      prev.groups.push(g);
    } else hunks.push({ a, b, groups: [g] });
  }

  const out: string[] = [];
  const p = quotePath(path);
  out.push(`diff --git ${p.a} ${p.b}\n`, `--- ${p.a}\n`, `+++ ${p.b}\n`);
  let delta = 0; // new line count minus old line count so far
  for (const h of hunks) {
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    const emit = (prefix: string, bytes: Uint8Array): void => {
      const hasLf = bytes.length > 0 && bytes[bytes.length - 1] === 10;
      const content = hasLf ? bytes.subarray(0, bytes.length - 1) : bytes;
      body.push(prefix + show(content) + "\n");
      if (!hasLf) body.push("\\ No newline at end of file\n");
    };
    let i = h.a;
    for (const g of h.groups) {
      for (; i < g.a; i++) {
        emit(" ", original.subarray(lines[i]!.start, lines[i]!.end));
        oldCount++;
        newCount++;
      }
      const from = lines[g.a]!.start;
      const to = lines[g.b]!.end;
      for (let k = g.a; k <= g.b; k++) {
        emit("-", original.subarray(lines[k]!.start, lines[k]!.end));
        oldCount++;
      }
      const replaced = applyEdits(original.subarray(from, to), g.edits.map((e) => ({ ...e, startByte: e.startByte - from, endByte: e.endByte - from })));
      for (const l of splitLines(replaced)) {
        emit("+", replaced.subarray(l.start, l.end));
        newCount++;
      }
      i = g.b + 1;
    }
    for (; i <= h.b; i++) {
      emit(" ", original.subarray(lines[i]!.start, lines[i]!.end));
      oldCount++;
      newCount++;
    }
    const oldStart = oldCount ? h.a + 1 : h.a;
    const newStart = newCount ? h.a + 1 + delta : h.a + delta;
    out.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@\n`);
    for (const l of body) out.push(l);
    delta += newCount - oldCount;
  }
  return out.join("");
}

/** Several per-file diffs as one patch. */
export function combineDiffs(diffs: readonly string[]): string {
  return diffs.filter(Boolean).join("");
}

/** The original bytes with the edits applied. Edits must not overlap. */
export function applyEdits(original: Uint8Array, edits: readonly FixEdit[]): Buffer {
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const e of sortEdits(edits)) {
    if (e.startByte < at || e.endByte < e.startByte || e.endByte > original.length) throw new RangeError("edits overlap or fall outside the file");
    parts.push(original.subarray(at, e.startByte), Buffer.from(e.replacement, "utf8"));
    at = e.endByte;
  }
  parts.push(original.subarray(at));
  return Buffer.concat(parts);
}

export function sortEdits(edits: readonly FixEdit[]): FixEdit[] {
  return [...edits].sort((x, y) => x.startByte - y.startByte || x.endByte - y.endByte);
}

const range = (start: number, count: number): string => (count === 1 ? `${start}` : `${start},${count}`);

interface Line {
  start: number;
  /** Exclusive, after the LF when there is one. */
  end: number;
}

function splitLines(buf: Uint8Array): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (;;) {
    const lf = buf.indexOf(10, start);
    if (lf < 0) break;
    out.push({ start, end: lf + 1 });
    start = lf + 1;
  }
  if (start < buf.length) out.push({ start, end: buf.length });
  return out;
}

/** Index of the line holding byte `pos`; the end of the file belongs to the last line. */
function lineAt(lines: Line[], pos: number, size: number): number {
  const p = Math.min(pos, size - 1);
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lines[mid]!.start <= p) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * a/<path> and b/<path> as git writes them: plain when the path is plain, otherwise in double
 * quotes with C escapes and octal bytes for anything outside printable ASCII (core.quotePath).
 * A path with a space is quoted too, unlike git: in "diff --git a/x.md b/CLAUDE.md b/x.md b/CLAUDE.md"
 * nobody can tell where the first name ends, and patch(1) cuts an unquoted name at the space.
 * git apply reads the quoted form the same way.
 */
export function quotePath(path: string): { a: string; b: string } {
  const plain = /^[\x21-\x7e]*$/.test(path) && !/["\\]/.test(path);
  if (plain) return { a: `a/${path}`, b: `b/${path}` };
  const esc = (s: string): string => {
    let r = "";
    for (const byte of Buffer.from(s, "utf8")) {
      if (byte === 0x22) r += '\\"';
      else if (byte === 0x5c) r += "\\\\";
      else if (byte === 0x09) r += "\\t";
      else if (byte === 0x0a) r += "\\n";
      else if (byte >= 0x20 && byte < 0x7f) r += String.fromCharCode(byte);
      else r += "\\" + byte.toString(8).padStart(3, "0");
    }
    return r;
  };
  return { a: `"a/${esc(path)}"`, b: `"b/${esc(path)}"` };
}
