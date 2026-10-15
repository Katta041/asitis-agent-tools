// Which invisible characters on a line can be deleted without changing what the text says.
// Shared by the invisible-char and bidi-control fixers. The set of characters is exactly the one
// scanInvisible() in scan.ts reports; this file only decides which of them to keep.
//
// Kept, because removing them changes the text (Unicode 15.1, chapter 23.2 "Layout Controls",
// https://www.unicode.org/versions/Unicode15.1.0/ch23.pdf, read 14 October 2026):
// - ZERO WIDTH NON-JOINER and ZERO WIDTH JOINER between letters of a script that uses them to pick
//   letter forms (Persian, Arabic, Hindi and other Indic scripts). "mi‌raftam" in Persian is a
//   different spelling without it.
// - ZERO WIDTH JOINER next to an emoji: part of an emoji sequence even when scanInvisible flags it.
// - LEFT-TO-RIGHT MARK, RIGHT-TO-LEFT MARK and ARABIC LETTER MARK on a line with right-to-left text,
//   where they fix the display order of numbers and punctuation.
// - COMBINING GRAPHEME JOINER next to a combining mark (Hebrew and other pointed text).
// - MONGOLIAN VOWEL SEPARATOR next to Mongolian letters, and the Hangul fillers next to Hangul.
// - TAG characters that spell a subdivision flag after U+1F3F4 (England, Scotland, Wales).

import type { Doc } from "../doc.js";
import { emojiJoiner, INVISIBLE_NAMES, isBidi, isVariationSelector, scanInvisible, suspiciousSelector } from "../scan.js";
import { LineIndex } from "../text.js";
import { applyEdits } from "../diff.js";
import type { FixEdit } from "../findings.js";
import { ByteIndex, textEdit } from "./util.js";

const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}]/u;
const SIMPLE_SCRIPT = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]$/u;
const EMOJI_NEAR = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u20E3]$/u;
const MARK = /^\p{M}$/u;
const MONGOLIAN = /^\p{Script=Mongolian}$/u;
const HANGUL = /^\p{Script=Hangul}$/u;

export interface InvisibleChar {
  /** Offset in doc.text. */
  at: number;
  cp: number;
  units: number;
  name: string;
  /** Why it stays, or "" when it can be removed. */
  keep: string;
}

const cpName = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${INVISIBLE_NAMES[cp] ?? (cp >= 0xe0000 && cp <= 0xe007f ? "TAG CHARACTER" : "VARIATION SELECTOR")}`;

const charAt = (s: string, i: number): string => (i >= 0 && i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : "");
/** The character that ends at i (handles surrogate pairs). */
function charBefore(s: string, i: number): string {
  if (i <= 0) return "";
  const lo = s.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1]!;
}

const LETTER = /^\p{L}$/u;

/**
 * The nearest letter before (dir -1) or from (dir 1) index i, stepping over combining marks and
 * other invisible characters, at most 8 characters away. "" when the neighbour is not a letter.
 */
function letterNear(s: string, i: number, dir: 1 | -1): string {
  let p = i;
  for (let k = 0; k < 8; k++) {
    const ch = dir < 0 ? charBefore(s, p) : charAt(s, p);
    if (!ch) return "";
    if (LETTER.test(ch)) return ch;
    const cp = ch.codePointAt(0)!;
    if (!MARK.test(ch) && INVISIBLE_NAMES[cp] === undefined && !isVariationSelector(cp) && !(cp >= 0xe0000 && cp <= 0xe007f)) return "";
    p += dir * ch.length;
  }
  return "";
}

/** The characters of 0-based line `li` that scanInvisible reports, each with whether it must stay. */
export function invisibleOnLine(doc: Doc, li: number): InvisibleChar[] {
  const s = doc.text;
  const from = doc.lines.start(li);
  const to = doc.lines.end(li);
  const line = s.slice(from, to);
  const rtlLine = RTL.test(line);
  const out: InvisibleChar[] = [];
  for (let i = from; i < to; i++) {
    let cp = s.charCodeAt(i);
    if (cp < 0xad) continue;
    let units = 1;
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        units = 2;
      }
    }
    const at = i;
    if (units === 2) i++;
    const tag = cp >= 0xe0000 && cp <= 0xe007f;
    const listed = tag || INVISIBLE_NAMES[cp] !== undefined || (isVariationSelector(cp) && suspiciousSelector(s, at, cp));
    if (!listed) continue;
    if (cp === 0xfeff && at === 0) continue; // the BOM
    if (cp === 0x200d && emojiJoiner(s, at)) continue;
    const prev = charBefore(s, at);
    const next = charAt(s, at + units);
    let keep = "";
    if (cp === 0x200c || cp === 0x200d) {
      if (EMOJI_NEAR.test(prev) || EMOJI_NEAR.test(next)) keep = "it is next to an emoji, where it joins an emoji sequence";
      else {
        const before = letterNear(s, at, -1);
        const after = letterNear(s, at + units, 1);
        if (before && after && !(SIMPLE_SCRIPT.test(before) && SIMPLE_SCRIPT.test(after))) {
          keep = "it sits between letters of a script that uses it to choose letter forms (Persian, Arabic, Hindi and others)";
        }
      }
    } else if (cp === 0x200e || cp === 0x200f || cp === 0x061c) {
      if (rtlLine) keep = "the line has right-to-left text, where it sets the display order";
    } else if (cp === 0x034f) {
      if (MARK.test(prev) || MARK.test(next)) keep = "it sits between combining marks";
    } else if (cp === 0x180e) {
      if (MONGOLIAN.test(prev) || MONGOLIAN.test(next)) keep = "it is part of Mongolian text";
    } else if (cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0) {
      if (HANGUL.test(prev) || HANGUL.test(next)) keep = "it is part of Hangul text";
    } else if (tag && tagFlag(s, at)) keep = "it is part of a flag emoji";
    out.push({ at, cp, units, name: cpName(cp), keep });
  }
  return out;
}

/** True when the TAG character at i belongs to U+1F3F4 + tags + CANCEL TAG (a subdivision flag). */
function tagFlag(s: string, i: number): boolean {
  let a = i;
  while (a >= 2 && isTagAt(s, a - 2)) a -= 2;
  let b = i;
  while (isTagAt(s, b + 2)) b += 2;
  return s.codePointAt(a - 2) === 0x1f3f4 && s.codePointAt(b) === 0xe007f;
}
const isTagAt = (s: string, i: number): boolean => {
  const cp = s.codePointAt(i);
  return cp !== undefined && cp >= 0xe0000 && cp <= 0xe007f;
};

export interface InvisiblePlan {
  edits: FixEdit[];
  removed: InvisibleChar[];
  kept: InvisibleChar[];
}

/** Edits that delete every removable invisible character on the line (bidi controls only when `bidi`). */
export function planInvisible(doc: Doc, li: number, opts: { bidi: boolean }): InvisiblePlan | null {
  const chars = invisibleOnLine(doc, li);
  const removed: InvisibleChar[] = [];
  const kept: InvisibleChar[] = [];
  for (const c of chars) {
    if (c.keep || (isBidi(c.cp) && !opts.bidi)) kept.push(c);
    else removed.push(c);
  }
  // Adjacent characters become one edit.
  const edits: FixEdit[] = [];
  let k = 0;
  while (k < removed.length) {
    let end = removed[k]!.at + removed[k]!.units;
    let j = k + 1;
    while (j < removed.length && removed[j]!.at === end) {
      end += removed[j]!.units;
      j++;
    }
    const e = textEdit(doc, removed[k]!.at, end, "");
    if (!e) return null;
    edits.push(e);
    k = j;
  }
  if (edits.length) {
    // Check against the scanner itself: after the edit, the line must hold exactly the kept characters.
    const bi = ByteIndex.of(doc);
    if (!bi) return null;
    const bom = li === 0 && doc.text.charCodeAt(0) === 0xfeff ? 1 : 0; // the BOM is not part of the line
    const ls = bi.byteAt(doc.lines.start(li) + bom);
    const le = bi.byteAt(doc.lines.end(li));
    const fixed = applyEdits(doc.file.buf.subarray(ls, le), edits.map((e) => ({ ...e, startByte: e.startByte - ls, endByte: e.endByte - ls })));
    const lineText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(fixed);
    if (scanInvisible(new LineIndex(`\n${lineText}`)).total !== kept.length) return null;
  }
  return { edits, removed, kept };
}

/** "U+200B ZERO WIDTH SPACE and 2 more" style list of distinct characters. */
export function nameList(chars: readonly InvisibleChar[]): string {
  const names = [...new Set(chars.map((c) => c.name))];
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more kinds`;
}

/** A note on what stays and why, or "". */
export function keptNote(kept: readonly InvisibleChar[]): string {
  if (!kept.length) return "";
  const byReason = new Map<string, InvisibleChar[]>();
  for (const c of kept) {
    const why = c.keep || "it is a bidirectional control";
    byReason.set(why, [...(byReason.get(why) ?? []), c]);
  }
  const parts = [...byReason].map(([why, cs]) => `${nameList(cs)} ${cs.length === 1 || new Set(cs.map((c) => c.name)).size === 1 ? "stays" : "stay"} because ${why}`);
  return `${parts.slice(0, 3).join("; ")}.`;
}
