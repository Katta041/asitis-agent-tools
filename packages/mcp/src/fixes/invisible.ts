// Which invisible characters on a line can be deleted without changing what the text says.
// Shared by the invisible-char and bidi-control fixers. The set of characters is exactly the one
// scanInvisible() in scan.ts looks at, and the decision to keep one comes from InvisibleKeep in
// scan.ts, which the scanner uses too: a character the fixer keeps is never reported by lint.
// The list of kept characters and the sources are in scan.ts.

import type { Doc } from "../doc.js";
import { emojiJoiner, INVISIBLE_NAMES, InvisibleKeep, isBidi, isVariationSelector, scanInvisible, suspiciousSelector } from "../scan.js";
import { LineIndex } from "../text.js";
import { applyEdits } from "../diff.js";
import type { FixEdit } from "../findings.js";
import { ByteIndex, textEdit } from "./util.js";

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

/** The characters of 0-based line `li` that scanInvisible reports, each with whether it must stay. */
export function invisibleOnLine(doc: Doc, li: number): InvisibleChar[] {
  const s = doc.text;
  const from = doc.lines.start(li);
  const to = doc.lines.end(li);
  const judge = new InvisibleKeep(s);
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
    const keep = judge.reason(at, cp, units, from, to);
    out.push({ at, cp, units, name: cpName(cp), keep });
  }
  return out;
}

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
    // Check against the scanner itself: after the edit, it must find nothing on the line except the
    // bidi controls left for the bidi-control fix (characters with a keep reason it skips as well).
    const bi = ByteIndex.of(doc);
    if (!bi) return null;
    const bom = li === 0 && doc.text.charCodeAt(0) === 0xfeff ? 1 : 0; // the BOM is not part of the line
    const ls = bi.byteAt(doc.lines.start(li) + bom);
    const le = bi.byteAt(doc.lines.end(li));
    const fixed = applyEdits(doc.file.buf.subarray(ls, le), edits.map((e) => ({ ...e, startByte: e.startByte - ls, endByte: e.endByte - ls })));
    const lineText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(fixed);
    if (scanInvisible(new LineIndex(`\n${lineText}`)).total !== kept.filter((c) => !c.keep).length) return null;
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
