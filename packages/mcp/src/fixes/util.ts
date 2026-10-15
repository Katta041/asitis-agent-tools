// Helpers shared by the fixers: text offsets to byte offsets, frontmatter value spans, and a
// re-parse of the frontmatter after an edit so a fixer can check that its edit does what it says.

import type { Doc } from "../doc.js";
import { applyEdits } from "../diff.js";
import type { FixEdit, FixSafety } from "../findings.js";
import type { FixSuggestion } from "../fix.js";
import type { Issue } from "../lint.js";
import { readFrontmatter, type Frontmatter } from "../frontmatter.js";
import { decode, LineIndex } from "../text.js";

const CHECKPOINT = 4096;

/**
 * Maps offsets in doc.text (UTF-16 code units, as decoded) to byte offsets in the file. It walks the
 * bytes the way the WHATWG UTF-8 decoder does: one code unit per byte sequence below U+10000, two
 * above, and one U+FFFD per maximal invalid subpart (Unicode 3.9), which is what TextDecoder emits.
 * Built once per file in one pass, with a checkpoint every 4,096 code units.
 */
export class ByteIndex {
  private readonly units: number[] = [0];
  private readonly bytes: number[] = [0];
  readonly ok: boolean;

  private constructor(private readonly buf: Uint8Array, textLength: number) {
    let u = 0;
    let i = 0;
    while (i < buf.length) {
      const step = seq(buf, i);
      i += step.bytes;
      u += step.units;
      if (u - this.units[this.units.length - 1]! >= CHECKPOINT) {
        this.units.push(u);
        this.bytes.push(i);
      }
    }
    this.ok = u === textLength;
  }

  private static cache = new WeakMap<Doc, ByteIndex | null>();

  /** The index for a UTF-8 file, or null for UTF-16 files and files whose decoding does not line up. */
  static of(doc: Doc): ByteIndex | null {
    let x = ByteIndex.cache.get(doc);
    if (x === undefined) {
      x = doc.profile.encoding === "utf-8" ? new ByteIndex(doc.file.buf, doc.text.length) : null;
      if (x && !x.ok) x = null;
      ByteIndex.cache.set(doc, x);
    }
    return x;
  }

  /** Byte offset of text offset `pos`, which must be at a code point boundary. */
  byteAt(pos: number): number {
    let lo = 0;
    let hi = this.units.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.units[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    let u = this.units[lo]!;
    let i = this.bytes[lo]!;
    while (u < pos && i < this.buf.length) {
      const step = seq(this.buf, i);
      i += step.bytes;
      u += step.units;
    }
    if (u !== pos) throw new RangeError("offset splits a character");
    return i;
  }
}

/** Length in bytes and UTF-16 units of the sequence at i, as TextDecoder reads it. */
function seq(buf: Uint8Array, i: number): { bytes: number; units: number } {
  const b0 = buf[i]!;
  if (b0 < 0x80) return { bytes: 1, units: 1 };
  let need = 0;
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) need = 1;
  else if (b0 === 0xe0) { need = 2; lo = 0xa0; }
  else if (b0 >= 0xe1 && b0 <= 0xec) need = 2;
  else if (b0 === 0xed) { need = 2; hi = 0x9f; }
  else if (b0 >= 0xee && b0 <= 0xef) need = 2;
  else if (b0 === 0xf0) { need = 3; lo = 0x90; }
  else if (b0 >= 0xf1 && b0 <= 0xf3) need = 3;
  else if (b0 === 0xf4) { need = 3; hi = 0x8f; }
  else return { bytes: 1, units: 1 };
  for (let j = 1; j <= need; j++) {
    const b = buf[i + j];
    const l = j === 1 ? lo : 0x80;
    const h = j === 1 ? hi : 0xbf;
    if (b === undefined || b < l || b > h) return { bytes: j, units: 1 };
  }
  return { bytes: need + 1, units: need === 3 ? 2 : 1 };
}

/** A text range of doc.text as a byte edit, or null when the file cannot be mapped. */
export function textEdit(doc: Doc, from: number, to: number, replacement: string): FixEdit | null {
  const bi = ByteIndex.of(doc);
  if (!bi) return null;
  try {
    return { startByte: bi.byteAt(from), endByte: bi.byteAt(to), replacement };
  } catch {
    return null;
  }
}

/** The file as text after the edits, with its line index. */
export function patched(doc: Doc, edits: readonly FixEdit[]): { buf: Buffer; text: string; lines: LineIndex } {
  const buf = applyEdits(doc.file.buf, edits);
  const { text } = decode(buf);
  return { buf, text, lines: new LineIndex(text) };
}

/** Frontmatter as it reads after the edits. */
export function frontmatterAfter(doc: Doc, edits: readonly FixEdit[]): Frontmatter {
  return readFrontmatter(patched(doc, edits).lines, doc.kind.kind);
}

/** The top-level key and the span of its value on a frontmatter line. */
export interface ValueSpan {
  key: string;
  /** Text offsets of the key name. */
  keyFrom: number;
  keyTo: number;
  /** Text offsets of the value token (quotes included), without a trailing comment or spaces. */
  from: number;
  to: number;
  quote: '"' | "'" | "";
  /** The value token as written. */
  raw: string;
}

/** Key and value span of 0-based line `li`, when it is a one-line `key: value` inside the frontmatter. */
export function valueSpan(doc: Doc, li: number): ValueSpan | null {
  const fm = doc.frontmatter;
  if (!fm.present || li <= fm.startLine || li >= fm.endLine) return null;
  const start = doc.lines.start(li);
  const line = doc.lines.line(li);
  const m = /^([A-Za-z_][\w.-]*)([ \t]*):([ \t]*)/.exec(line);
  if (!m) return null;
  const key = m[1]!;
  const vStart = m[0].length;
  const rest = line.slice(vStart);
  if (!rest || /^[|>&*!%@`[{]/.test(rest)) return null; // block scalars, anchors, flow collections: not touched
  // A value continued on the next line (an indented plain scalar) is not a one-line value.
  if (li + 1 < fm.endLine && /^[ \t]+\S/.test(doc.lines.line(li + 1))) return null;
  let len: number;
  let quote: ValueSpan["quote"] = "";
  if (rest[0] === '"') {
    quote = '"';
    let j = 1;
    while (j < rest.length && rest[j] !== '"') j += rest[j] === "\\" ? 2 : 1;
    if (j >= rest.length) return null;
    len = j + 1;
  } else if (rest[0] === "'") {
    quote = "'";
    let j = 1;
    for (;;) {
      const k = rest.indexOf("'", j);
      if (k < 0) return null;
      if (rest[k + 1] === "'") { j = k + 2; continue; }
      len = k + 1;
      break;
    }
  } else {
    const hash = rest.search(/[ \t]#/);
    let v = hash >= 0 ? rest.slice(0, hash) : rest;
    v = v.replace(/[ \t]+$/, "");
    len = v.length;
  }
  if (!len) return null;
  return { key, keyFrom: start, keyTo: start + key.length, from: start + vStart, to: start + vStart + len, quote, raw: rest.slice(0, len) };
}

/** A string written as a YAML scalar in the same quoting style as `like`, quoted when plain would change its type. */
export function yamlScalar(value: string, like: ValueSpan["quote"]): string {
  if (like === "'") return `'${value.replace(/'/g, "''")}'`;
  if (like === '"' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || looksTyped(value)) return JSON.stringify(value);
  return value;
}

/** Plain scalars YAML reads as something other than a string. */
function looksTyped(v: string): boolean {
  return /^(?:true|false|yes|no|on|off|null|y|n)$/i.test(v) || /^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:e[-+]?\d+)?|0x[\da-f]+|0o[0-7]+|\.inf|\.nan)$/i.test(v);
}

/** Skill name rule from the Agent Skills spec (lowercase a-z, 0-9, single hyphens, at most 64 characters). */
export const ASCII_SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The folder a SKILL.md sits in, or "" when it is at the root. */
export function skillFolder(doc: Doc): string {
  const parts = doc.file.rel.split("/");
  return parts.length >= 2 ? parts[parts.length - 2]! : "";
}

/** The 0-based line of a 1-based issue line, or -1 when it is out of range. */
export function lineIndex(doc: Doc, line: number): number {
  return line >= 1 && line <= doc.lines.count ? line - 1 : -1;
}

/** A fix for one issue. `what` says in a few words what the edit does ("remove U+200B ZERO WIDTH SPACE"). */
export function suggestion(doc: Doc, issue: Issue, safety: FixSafety, what: string, edits: FixEdit[], note?: string): FixSuggestion {
  return { ruleId: issue.rule, path: doc.path, line: issue.line, safety, what, edits, ...(note ? { note } : {}) };
}

/** No fix for this issue, with the reason shown to the user. */
export function noFix(doc: Doc, issue: Issue, safety: FixSafety, note: string): FixSuggestion {
  return { ruleId: issue.rule, path: doc.path, line: issue.line, safety, what: "", edits: [], note };
}

/** True when the frontmatter after an edit has no problem of a kind it did not have before, and fewer of `fixed`. */
export function noNewProblems(before: Frontmatter, after: Frontmatter, fixed?: string): boolean {
  if (!after.present) return false;
  const count = (fm: Frontmatter): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of fm.problems) m.set(p.rule, (m.get(p.rule) ?? 0) + 1);
    return m;
  };
  const b = count(before);
  const a = count(after);
  for (const [rule, n] of a) if (n > (b.get(rule) ?? 0)) return false;
  if (fixed && (a.get(fixed) ?? 0) >= (b.get(fixed) ?? 0)) return false;
  return true;
}
