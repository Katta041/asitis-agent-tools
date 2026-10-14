// Byte-level facts about a file and a line index over its decoded text.
// Every function here is a single forward pass (linear time); none uses
// backtracking regular expressions over the whole input.

import { createHash } from "node:crypto";

export type Encoding = "utf-8" | "utf-16le" | "utf-16be";
export type EolKind = "lf" | "crlf" | "cr" | "none" | "mixed";

export interface ByteRange {
  /** Byte offset of the first invalid byte. */
  start: number;
  /** Byte offset after the last invalid byte (exclusive). */
  end: number;
}

export interface Profile {
  bytes: number;
  sha256: string;
  encoding: Encoding;
  bom: boolean;
  eol: { lf: number; crlf: number; cr: number; style: EolKind };
  finalNewline: boolean;
  lines: number;
  trailingWhitespaceLines: number;
  nulBytes: number;
  invalidUtf8: { count: number; ranges: ByteRange[]; truncated: boolean };
}

export const MAX_REPORTED_RANGES = 200;

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function detectEncoding(buf: Uint8Array): { encoding: Encoding; bom: boolean; bomBytes: number } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { encoding: "utf-8", bom: true, bomBytes: 3 };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { encoding: "utf-16le", bom: true, bomBytes: 2 };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { encoding: "utf-16be", bom: true, bomBytes: 2 };
  const guess = guessUtf16(buf);
  if (guess) return { encoding: guess, bom: false, bomBytes: 0 };
  return { encoding: "utf-8", bom: false, bomBytes: 0 };
}

/**
 * UTF-16 without a byte order mark, as some Windows editors and PowerShell's `Out-File` write it.
 * Mostly-ASCII text then has a zero in every other byte: the high byte of each code unit.
 * Only the first 4 KiB is sampled; a file needs an even length, at least 8 code units, a zero
 * high byte in 70% of them and almost never a zero low byte. Binary files rarely look like that,
 * and UTF-8 text never has NUL bytes in that pattern.
 */
function guessUtf16(buf: Uint8Array): Encoding | null {
  if (buf.length < 16 || buf.length % 2 !== 0) return null;
  const units = Math.min(buf.length, 4096) >> 1;
  let evenZero = 0;
  let oddZero = 0;
  for (let k = 0; k < units; k++) {
    if (buf[2 * k] === 0) evenZero++;
    if (buf[2 * k + 1] === 0) oddZero++;
  }
  if (oddZero >= units * 0.7 && evenZero <= units * 0.05) return "utf-16le";
  if (evenZero >= units * 0.7 && oddZero <= units * 0.05) return "utf-16be";
  return null;
}

/** 1-based line of a byte offset, with the same line breaks as LineIndex (LF, CRLF, lone CR). Only for UTF-8. */
export function lineOfByte(buf: Uint8Array, offset: number): number {
  let line = 1;
  const end = Math.min(offset, buf.length);
  for (let i = 0; i < end; i++) {
    const b = buf[i];
    if (b === 10) line++;
    else if (b === 13 && buf[i + 1] !== 10) line++;
  }
  return line;
}

/**
 * Finds byte ranges that are not valid UTF-8 (RFC 3629: no overlongs, no
 * surrogates, nothing above U+10FFFF). Adjacent invalid bytes merge into one range.
 */
export function invalidUtf8Ranges(buf: Uint8Array, start = 0): { count: number; ranges: ByteRange[]; truncated: boolean } {
  const ranges: ByteRange[] = [];
  let count = 0;
  let truncated = false;
  const mark = (a: number, b: number): void => {
    const last = ranges[ranges.length - 1];
    if (last && last.end === a) {
      last.end = b;
      return;
    }
    count++;
    if (ranges.length < MAX_REPORTED_RANGES) ranges.push({ start: a, end: b });
    else truncated = true;
  };
  const n = buf.length;
  let i = start;
  while (i < n) {
    const b0 = buf[i]!;
    if (b0 < 0x80) {
      i++;
      continue;
    }
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
    else {
      mark(i, i + 1);
      i++;
      continue;
    }
    let j = 1;
    let ok = true;
    for (; j <= need; j++) {
      const b = buf[i + j];
      const l = j === 1 ? lo : 0x80;
      const h = j === 1 ? hi : 0xbf;
      if (b === undefined || b < l || b > h) {
        ok = false;
        break;
      }
    }
    if (ok) i += need + 1;
    else {
      // Maximal subpart of an ill-formed sequence counts as one error (Unicode 3.9).
      mark(i, i + j);
      i += j;
    }
  }
  return { count, ranges, truncated };
}

export function decode(buf: Uint8Array): { text: string; encoding: Encoding; bom: boolean; bomBytes: number } {
  const enc = detectEncoding(buf);
  // ignoreBOM keeps a UTF-8 BOM as U+FEFF at index 0 so callers can see it.
  const text = new TextDecoder(enc.encoding, { fatal: false, ignoreBOM: true }).decode(buf);
  return { text, ...enc };
}

/**
 * Line index over decoded text. Line breaks are CRLF, LF or a lone CR, the
 * same set CommonMark recognises. Stored in typed arrays so a 10 MB file of
 * newlines stays cheap.
 */
export class LineIndex {
  readonly count: number;
  private readonly starts: Uint32Array;
  private readonly ends: Uint32Array; // end of content, before the break
  private readonly breaks: Uint8Array; // 0 none, 1 lf, 2 crlf, 3 cr

  constructor(readonly text: string) {
    let cap = 1024;
    let starts = new Uint32Array(cap);
    let ends = new Uint32Array(cap);
    let breaks = new Uint8Array(cap);
    let n = 0;
    let lineStart = 0;
    const push = (end: number, kind: number, next: number): void => {
      if (n === cap) {
        cap *= 2;
        const s = new Uint32Array(cap); s.set(starts); starts = s;
        const e = new Uint32Array(cap); e.set(ends); ends = e;
        const b = new Uint8Array(cap); b.set(breaks); breaks = b;
      }
      starts[n] = lineStart;
      ends[n] = end;
      breaks[n] = kind;
      n++;
      lineStart = next;
    };
    const len = text.length;
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) push(i, 1, i + 1);
      else if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) { push(i, 2, i + 2); i++; }
        else push(i, 3, i + 1);
      }
    }
    // The last line exists only if it has content (a final newline ends the file).
    if (lineStart < len || n === 0) push(len, 0, len);
    this.count = n;
    this.starts = starts;
    this.ends = ends;
    this.breaks = breaks;
  }

  /** Content of line i (0-based), without its line break. */
  line(i: number): string {
    return this.text.slice(this.starts[i]!, this.ends[i]!);
  }
  start(i: number): number {
    return this.starts[i]!;
  }
  end(i: number): number {
    return this.ends[i]!;
  }
  breakKind(i: number): number {
    return this.breaks[i]!;
  }
  /** 0-based line containing character offset `pos` (binary search). */
  lineOf(pos: number): number {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

export function profile(buf: Uint8Array, text: string, lines: LineIndex): Profile {
  const enc = detectEncoding(buf);
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  let trailing = 0;
  for (let i = 0; i < lines.count; i++) {
    const k = lines.breakKind(i);
    if (k === 1) lf++;
    else if (k === 2) crlf++;
    else if (k === 3) cr++;
    const e = lines.end(i);
    if (e > lines.start(i)) {
      const c = text.charCodeAt(e - 1);
      if (c === 32 || c === 9) trailing++;
    }
  }
  const kinds = [lf > 0, crlf > 0, cr > 0].filter(Boolean).length;
  const style: EolKind = kinds === 0 ? "none" : kinds > 1 ? "mixed" : lf ? "lf" : crlf ? "crlf" : "cr";
  // In UTF-16 every ASCII character has a zero byte, so count NUL characters, not bytes.
  let nul = 0;
  if (enc.encoding === "utf-8") for (let i = 0; i < buf.length; i++) { if (buf[i] === 0) nul++; }
  else for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 0) nul++; }
  const last = text.charCodeAt(text.length - 1);
  return {
    bytes: buf.length,
    sha256: sha256(buf),
    encoding: enc.encoding,
    bom: enc.bom,
    eol: { lf, crlf, cr, style },
    finalNewline: last === 10 || last === 13,
    lines: text.length === 0 ? 0 : lines.count,
    trailingWhitespaceLines: trailing,
    nulBytes: nul,
    invalidUtf8: enc.encoding === "utf-8" ? invalidUtf8Ranges(buf, enc.bomBytes) : { count: 0, ranges: [], truncated: false },
  };
}

/** Moves a byte offset forward to the start of a UTF-8 character. */
export function alignUtf8Start(buf: Uint8Array, pos: number): number {
  let p = pos;
  for (let k = 0; k < 3 && p < buf.length && (buf[p]! & 0xc0) === 0x80; k++) p++;
  return p;
}

/** Moves an exclusive end offset back so it does not split a UTF-8 character. */
export function alignUtf8End(buf: Uint8Array, end: number): number {
  if (end >= buf.length) return buf.length;
  let p = end;
  for (let k = 0; k < 3 && p > 0 && (buf[p]! & 0xc0) === 0x80; k++) p--;
  return p;
}
