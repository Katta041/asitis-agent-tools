// Linear-time scanners over decoded markdown. Rules for this file:
// - no regular expression runs over unbounded input with nested or lazy
//   quantifiers ([\s\S]*? and friends are banned);
// - every search moves forward (indexOf from the last position);
// - per-match work is bounded by a constant (CAPS.maxTargetChars, comment slices).

import { CAPS } from "./limits.js";
import type { LineIndex } from "./text.js";

/** Marks lines inside fenced code blocks (``` or ~~~, CommonMark rules simplified). */
export function fenceMask(lines: LineIndex, skipUntilLine = -1): Uint8Array {
  const mask = new Uint8Array(lines.count);
  let fenceChar = 0;
  let fenceLen = 0;
  for (let i = 0; i < lines.count; i++) {
    if (i <= skipUntilLine) continue;
    const s = lines.text;
    const a = lines.start(i);
    const e = lines.end(i);
    let p = a;
    let indent = 0;
    while (p < e && s.charCodeAt(p) === 32 && indent < 4) { p++; indent++; }
    const c = s.charCodeAt(p);
    let run = 0;
    if (indent < 4 && (c === 96 || c === 126)) while (p + run < e && s.charCodeAt(p + run) === c) run++;
    if (fenceChar === 0) {
      if (run >= 3) {
        // A backtick fence's info string may not contain backticks; bounded check.
        let ok = true;
        if (c === 96) {
          const limit = Math.min(e, p + run + 256);
          for (let q = p + run; q < limit; q++) if (s.charCodeAt(q) === 96) { ok = false; break; }
        }
        if (ok) {
          fenceChar = c;
          fenceLen = run;
          mask[i] = 1;
        }
      }
    } else {
      mask[i] = 1;
      if (c === fenceChar && run >= fenceLen) {
        let q = p + run;
        while (q < e && (s.charCodeAt(q) === 32 || s.charCodeAt(q) === 9)) q++;
        if (q === e) { fenceChar = 0; fenceLen = 0; }
      }
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Invisible and format characters

const INVISIBLE_NAMES: Record<number, string> = {
  0x00ad: "SOFT HYPHEN",
  0x034f: "COMBINING GRAPHEME JOINER",
  0x061c: "ARABIC LETTER MARK",
  0x115f: "HANGUL CHOSEONG FILLER",
  0x1160: "HANGUL JUNGSEONG FILLER",
  0x180e: "MONGOLIAN VOWEL SEPARATOR",
  0x200b: "ZERO WIDTH SPACE",
  0x200c: "ZERO WIDTH NON-JOINER",
  0x200d: "ZERO WIDTH JOINER",
  0x200e: "LEFT-TO-RIGHT MARK",
  0x200f: "RIGHT-TO-LEFT MARK",
  0x202a: "LEFT-TO-RIGHT EMBEDDING",
  0x202b: "RIGHT-TO-LEFT EMBEDDING",
  0x202c: "POP DIRECTIONAL FORMATTING",
  0x202d: "LEFT-TO-RIGHT OVERRIDE",
  0x202e: "RIGHT-TO-LEFT OVERRIDE",
  0x2060: "WORD JOINER",
  0x2061: "FUNCTION APPLICATION",
  0x2062: "INVISIBLE TIMES",
  0x2063: "INVISIBLE SEPARATOR",
  0x2064: "INVISIBLE PLUS",
  0x2066: "LEFT-TO-RIGHT ISOLATE",
  0x2067: "RIGHT-TO-LEFT ISOLATE",
  0x2068: "FIRST STRONG ISOLATE",
  0x2069: "POP DIRECTIONAL ISOLATE",
  0x3164: "HANGUL FILLER",
  0xfeff: "ZERO WIDTH NO-BREAK SPACE (BOM)",
  0xffa0: "HALFWIDTH HANGUL FILLER",
};

export interface InvisibleFinding {
  line: number; // 1-based
  count: number;
  codepoints: string[]; // e.g. "U+200B ZERO WIDTH SPACE"
  bidi: boolean;
}

const isBidi = (cp: number): boolean => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);

export function scanInvisible(lines: LineIndex): { findings: InvisibleFinding[]; total: number } {
  const s = lines.text;
  const findings: InvisibleFinding[] = [];
  let total = 0;
  let current: InvisibleFinding | null = null;
  let currentLine = -1;
  let seen: Set<number> | null = null;
  let lineIdx = 0;
  let nextLineStart = lines.count > 1 ? lines.start(1) : Infinity;
  for (let i = 0; i < s.length; i++) {
    while (i >= nextLineStart) {
      lineIdx++;
      nextLineStart = lineIdx + 1 < lines.count ? lines.start(lineIdx + 1) : Infinity;
    }
    let cp = s.charCodeAt(i);
    if (cp < 0xad) continue;
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    const tag = cp >= 0xe0000 && cp <= 0xe007f;
    const name = tag ? "TAG CHARACTER" : INVISIBLE_NAMES[cp];
    if (!name) continue;
    if (cp === 0xfeff && i === 0) continue; // a leading BOM is reported by the profile, not here
    total++;
    if (currentLine !== lineIdx) {
      if (findings.length >= CAPS.maxFindingsPerRule) continue;
      current = { line: lineIdx + 1, count: 0, codepoints: [], bidi: false };
      findings.push(current);
      currentLine = lineIdx;
      seen = new Set();
    }
    current!.count++;
    if (isBidi(cp)) current!.bidi = true;
    if (seen && !seen.has(cp) && seen.size < 6) {
      seen.add(cp);
      current!.codepoints.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${name}`);
    }
  }
  return { findings, total };
}

// ---------------------------------------------------------------------------
// HTML comments

export interface CommentFinding {
  line: number; // 1-based start line
  endLine: number;
  closed: boolean;
  instructionLike: boolean;
  matched: string | null;
  preview: string;
}

// Bounded patterns, applied to at most COMMENT_SLICE characters of each comment.
const COMMENT_SLICE = 4096;
const INSTRUCTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override)\b[^\n]{0,40}\b(previous|prior|above|earlier|all|any|other|system)\b/i, "asks to ignore other instructions"],
  [/\b(you are|you must|you should|you will|as an ai|ai assistant|language model|system prompt|the assistant|the agent|the model)\b/i, "addresses the AI directly"],
  [/\b(claude|chatgpt|gpt-?\d|codex|copilot|cursor|gemini|llm)\b/i, "names an AI assistant"],
  [/\b(do not|don't|never)\s+(tell|mention|reveal|show|inform)\b/i, "asks to hide something from the user"],
  [/\b(secretly|silently|quietly|without (telling|asking|mentioning))\b/i, "asks for covert action"],
  [/\b(exfiltrat\w*|curl\s|wget\s|base64|api[_ -]?key|token|password|credential|ssh)\b/i, "mentions commands or secrets"],
  [/\b(run|execute|call|invoke)\s+(the\s+)?(command|script|tool|shell|bash)\b/i, "asks to run a command"],
  [/\b(instructions?|rule|important|note to (the )?(ai|agent|assistant))\s*:/i, "reads like an instruction"],
];

export function classifyInstruction(text: string): string | null {
  const t = text.length > COMMENT_SLICE ? text.slice(0, COMMENT_SLICE) : text;
  for (const [re, label] of INSTRUCTION_PATTERNS) if (re.test(t)) return label;
  return null;
}

export function scanComments(lines: LineIndex, fence: Uint8Array): { findings: CommentFinding[]; total: number } {
  const s = lines.text;
  const findings: CommentFinding[] = [];
  let total = 0;
  let pos = 0;
  for (;;) {
    const open = s.indexOf("<!--", pos);
    if (open < 0) break;
    const startLine = lines.lineOf(open);
    const close = s.indexOf("-->", open + 4);
    const end = close < 0 ? s.length : close + 3;
    pos = end;
    if (fence[startLine]) continue; // visible as code, not hidden
    total++;
    if (findings.length >= CAPS.maxFindingsPerRule) {
      if (close < 0) break;
      continue;
    }
    const body = s.slice(open + 4, close < 0 ? Math.min(s.length, open + 4 + COMMENT_SLICE) : Math.min(close, open + 4 + COMMENT_SLICE));
    const matched = classifyInstruction(body);
    const preview = body.replace(/\s+/g, " ").trim().slice(0, 120);
    findings.push({ line: startLine + 1, endLine: lines.lineOf(Math.max(open, end - 1)) + 1, closed: close >= 0, instructionLike: matched !== null, matched, preview });
    if (close < 0) break;
  }
  return { findings, total };
}

// ---------------------------------------------------------------------------
// Hidden text through inline styles

const HIDDEN_STYLE = /^style\s*=\s*["'][^"'\n]{0,200}?(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0(?![.\d]*[1-9])|color\s*:\s*(?:#fff\b|#ffffff\b|white\b))/i;

export function scanHiddenStyles(lines: LineIndex, fence: Uint8Array): number[] {
  const out: number[] = [];
  const s = lines.text;
  let pos = 0;
  for (;;) {
    const at = s.indexOf("style", pos);
    if (at < 0) break;
    pos = at + 5;
    const li = lines.lineOf(at);
    if (fence[li]) continue;
    // Cheap precheck (style, optional spaces, =) before the anchored, bounded regex.
    let q = at + 5;
    while (q < s.length && q - at < 16 && (s.charCodeAt(q) === 32 || s.charCodeAt(q) === 9)) q++;
    if (s.charCodeAt(q) !== 61) continue;
    const window = s.slice(at, Math.min(s.length, at + 260));
    if (HIDDEN_STYLE.test(window)) {
      if (out[out.length - 1] !== li + 1) out.push(li + 1);
      if (out.length >= CAPS.maxFindingsPerRule) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links and @imports

export interface LinkRef {
  line: number; // 1-based
  target: string;
  kind: "inline" | "reference";
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]{0,31}:/;

export function isExternalTarget(t: string): boolean {
  return t.startsWith("#") || t.startsWith("//") || SCHEME.test(t);
}

/** indexOf that never looks past `limit` (exclusive), so repeated searches stay linear. */
export function boundedIndexOf(s: string, needle: string, from: number, limit: number): number {
  const first = needle.charCodeAt(0);
  const last = limit - needle.length;
  for (let i = from; i <= last; i++) {
    if (s.charCodeAt(i) !== first) continue;
    let k = 1;
    while (k < needle.length && s.charCodeAt(i + k) === needle.charCodeAt(k)) k++;
    if (k === needle.length) return i;
  }
  return -1;
}

/** Tracks whether a position is inside an inline code span, scanning each line forward once. */
class CodeSpanTracker {
  private line = -1;
  private pos = 0;
  private open = 0; // length of the opening backtick run, 0 when outside
  constructor(private readonly lines: LineIndex) {}
  inCode(li: number, at: number): boolean {
    const s = this.lines.text;
    if (li !== this.line) {
      this.line = li;
      this.pos = this.lines.start(li);
      this.open = 0;
    }
    while (this.pos < at) {
      if (s.charCodeAt(this.pos) === 96) {
        let run = 0;
        while (s.charCodeAt(this.pos + run) === 96) run++;
        if (this.open === 0) this.open = run;
        else if (run === this.open) this.open = 0;
        this.pos += run;
      } else this.pos++;
    }
    return this.open > 0;
  }
}

export function extractLinks(lines: LineIndex, fence: Uint8Array): LinkRef[] {
  const s = lines.text;
  const out: LinkRef[] = [];
  const spans = new CodeSpanTracker(lines);
  let pos = 0;
  // Cached position of the next ">" so repeated "](<" openers stay linear.
  let nextGt = -2;
  while (out.length < CAPS.maxLinkChecks) {
    const at = s.indexOf("](", pos);
    if (at < 0) break;
    pos = at + 2;
    const li = lines.lineOf(at);
    if (fence[li] || spans.inCode(li, at)) continue;
    let p = at + 2;
    const lineEnd = lines.end(li);
    while (p < lineEnd && s.charCodeAt(p) === 32) p++;
    let target = "";
    if (s.charCodeAt(p) === 60) {
      if (nextGt !== -1 && nextGt < p + 1) nextGt = s.indexOf(">", p + 1);
      const close = nextGt >= 0 && nextGt < Math.min(lineEnd, p + CAPS.maxTargetChars) ? nextGt : -1;
      if (close < 0) continue;
      target = s.slice(p + 1, close);
    } else {
      const stop = Math.min(lineEnd, p + CAPS.maxTargetChars);
      let q = p;
      let depth = 0;
      for (; q < stop; q++) {
        const c = s.charCodeAt(q);
        if (c === 32 || c === 9) break;
        if (c === 40) depth++;
        else if (c === 41) {
          if (depth === 0) break;
          depth--;
        }
      }
      target = s.slice(p, q);
    }
    if (target) out.push({ line: li + 1, target, kind: "inline" });
  }
  // Reference definitions: [label]: target at line start.
  for (let i = 0; i < lines.count && out.length < CAPS.maxLinkChecks; i++) {
    if (fence[i]) continue;
    const a = lines.start(i);
    const e = lines.end(i);
    let p = a;
    while (p < e && p - a < 3 && s.charCodeAt(p) === 32) p++;
    if (s.charCodeAt(p) !== 91) continue;
    const close = boundedIndexOf(s, "]:", p + 1, Math.min(e, p + 1000));
    if (close < 0) continue;
    let q = close + 2;
    while (q < e && (s.charCodeAt(q) === 32 || s.charCodeAt(q) === 9)) q++;
    let r = q;
    const stop = Math.min(e, q + CAPS.maxTargetChars);
    while (r < stop && s.charCodeAt(r) !== 32 && s.charCodeAt(r) !== 9) r++;
    let target = s.slice(q, r);
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (target && s.charCodeAt(p + 1) !== 94) out.push({ line: i + 1, target, kind: "reference" }); // skip [^footnote]:
  }
  return out;
}

export interface ImportRef {
  line: number; // 1-based
  raw: string;
  path: string;
  looksLikePath: boolean;
}

/**
 * Claude Code style @path imports: an @ at line start or after whitespace,
 * outside code spans and fenced blocks. A backslash escapes a space.
 */
export function extractImports(lines: LineIndex, fence: Uint8Array, skipUntilLine = -1): ImportRef[] {
  const s = lines.text;
  const out: ImportRef[] = [];
  const spans = new CodeSpanTracker(lines);
  let pos = 0;
  while (out.length < CAPS.maxLinkChecks) {
    const at = s.indexOf("@", pos);
    if (at < 0) break;
    pos = at + 1;
    const prev = at === 0 ? 32 : s.charCodeAt(at - 1);
    if (!(prev === 32 || prev === 9 || prev === 10 || prev === 13 || prev === 40 || prev === 0xfeff)) continue;
    const li = lines.lineOf(at);
    if (li <= skipUntilLine || fence[li] || spans.inCode(li, at)) continue;
    const lineEnd = lines.end(li);
    const stop = Math.min(lineEnd, at + 1 + CAPS.maxTargetChars);
    let q = at + 1;
    let raw = "";
    while (q < stop) {
      const c = s.charCodeAt(q);
      if (c === 92 && s.charCodeAt(q + 1) === 32) { raw += " "; q += 2; continue; }
      if (c === 32 || c === 9 || c === 96) break;
      raw += s[q];
      q++;
    }
    pos = q;
    if (!raw || raw.startsWith("@") || raw.startsWith('"') || raw.startsWith("'")) continue;
    let cut = raw.length;
    while (cut > 0 && ".,;:!?)]".includes(raw[cut - 1]!)) cut--;
    const trimmed = raw.slice(0, cut);
    if (!trimmed) continue;
    const looksLikePath = trimmed.includes("/") || /\.[A-Za-z0-9]{1,10}$/.test(trimmed);
    out.push({ line: li + 1, raw, path: trimmed, looksLikePath });
  }
  return out;
}
