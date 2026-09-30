// Heading outline (ATX and setext), skipping frontmatter and fenced code.

import { CAPS } from "./limits.js";
import type { LineIndex } from "./text.js";

export interface Heading {
  level: number;
  text: string;
  line: number; // 1-based
}

const MAX_HEADING_TEXT = 200;

function atx(s: string): { level: number; text: string } | null {
  let p = 0;
  while (p < 3 && s.charCodeAt(p) === 32) p++;
  let level = 0;
  while (s.charCodeAt(p + level) === 35 && level < 7) level++;
  if (level === 0 || level > 6) return null;
  const after = s.charCodeAt(p + level);
  if (!(Number.isNaN(after) || after === 32 || after === 9)) return null;
  let text = s.slice(p + level, p + level + MAX_HEADING_TEXT * 2).trim();
  // Optional closing sequence of #s.
  let e = text.length;
  while (e > 0 && text.charCodeAt(e - 1) === 35) e--;
  if (e === 0 || text.charCodeAt(e - 1) === 32 || text.charCodeAt(e - 1) === 9) text = text.slice(0, e).trimEnd();
  return { level, text: text.slice(0, MAX_HEADING_TEXT) };
}

function setextLevel(s: string): number {
  let p = 0;
  while (p < 3 && s.charCodeAt(p) === 32) p++;
  const c = s.charCodeAt(p);
  if (c !== 61 && c !== 45) return 0;
  let q = p;
  while (s.charCodeAt(q) === c) q++;
  while (q < s.length && (s.charCodeAt(q) === 32 || s.charCodeAt(q) === 9)) q++;
  if (q !== s.length) return 0;
  return c === 61 ? 1 : 2;
}

export function outline(lines: LineIndex, fence: Uint8Array, frontmatterEnd: number): { headings: Heading[]; truncated: boolean } {
  const headings: Heading[] = [];
  let truncated = false;
  let prevText: string | null = null;
  let prevLine = -1;
  for (let i = frontmatterEnd + 1; i < lines.count; i++) {
    if (fence[i]) { prevText = null; continue; }
    const len = lines.end(i) - lines.start(i);
    // Only the first few hundred characters of a line matter for headings.
    const s = len > 1024 ? lines.text.slice(lines.start(i), lines.start(i) + 1024) : lines.line(i);
    const h = atx(s);
    if (h) {
      if (headings.length >= CAPS.maxHeadings) { truncated = true; break; }
      headings.push({ level: h.level, text: h.text, line: i + 1 });
      prevText = null;
      continue;
    }
    const lvl = prevText !== null && prevLine === i - 1 ? setextLevel(s) : 0;
    if (lvl && prevText !== null) {
      if (headings.length >= CAPS.maxHeadings) { truncated = true; break; }
      headings.push({ level: lvl, text: prevText.slice(0, MAX_HEADING_TEXT), line: i });
      prevText = null;
      continue;
    }
    const t = s.trim();
    // A paragraph line that could be a setext heading text (not a list item, quote or table rule).
    prevText = t && !/^([-*+>|]|\d+[.)])/.test(t) && len <= 1024 ? t : null;
    prevLine = i;
  }
  return { headings, truncated };
}
