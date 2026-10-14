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
    if (i === 0 && s.charCodeAt(p) === 0xfeff) p++; // a leading BOM is not content
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
const isVariationSelector = (cp: number): boolean => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
const EMOJI_MODIFIER = /^\p{Emoji_Modifier}$/u;
const IDEOGRAPH = /^\p{Ideographic}$/u;

/** The code point that ends just before index i, or -1. */
function cpBefore(s: string, i: number): number {
  if (i <= 0) return -1;
  const lo = s.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
  }
  return lo;
}

/** A ZERO WIDTH JOINER between two emoji ("woman" + ZWJ + "laptop") is how emoji sequences are spelled, not hidden text. */
function emojiJoiner(s: string, i: number): boolean {
  const prev = cpBefore(s, i);
  const next = s.codePointAt(i + 1) ?? -1;
  if (prev < 0 || next < 0) return false;
  const p = String.fromCodePoint(prev);
  const prevOk = PICTOGRAPH.test(p) || EMOJI_MODIFIER.test(p) || prev === 0xfe0f;
  return prevOk && PICTOGRAPH.test(String.fromCodePoint(next));
}

/**
 * Variation selectors are normal after an emoji (U+FE0F) or a CJK ideograph (U+E0100 and up).
 * A run of them, or one after any other character, can carry hidden bytes ("emoji smuggling").
 */
function suspiciousSelector(s: string, i: number, cp: number): boolean {
  const prev = cpBefore(s, i);
  if (prev < 0 || isVariationSelector(prev)) return true;
  const next = s.codePointAt(i + (cp > 0xffff ? 2 : 1)) ?? -1;
  if (next >= 0 && isVariationSelector(next)) return true;
  if (cp <= 0xfe0f) return false; // VS1-VS16 after an ordinary character: text or emoji presentation
  return !IDEOGRAPH.test(String.fromCodePoint(prev));
}

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
    const at = cp > 0xffff ? i - 1 : i; // index of this code point's first unit
    let name = tag ? "TAG CHARACTER" : INVISIBLE_NAMES[cp];
    if (!name && isVariationSelector(cp) && suspiciousSelector(s, at, cp)) name = `VARIATION SELECTOR-${cp <= 0xfe0f ? cp - 0xfe00 + 1 : cp - 0xe0100 + 17}`;
    if (!name) continue;
    if (cp === 0xfeff && i === 0) continue; // a leading BOM is reported by the profile, not here
    if (cp === 0x200d && emojiJoiner(s, at)) continue;
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
// Assistant names. A name on its own is not an instruction: maintainers write
// that a file was made with Claude Code, or link to code.claude.com (issue #2).
// A name counts only when the comment speaks to it: "Claude, ...", "Copilot: ...",
// or the name as the subject of a directive ("Claude Code must ...").
const AI_NAME = String.raw`(?:claude(?:\s{1,8}code)?|chatgpt|gpt-?\d[\w.-]{0,8}|codex|copilot|cursor|gemini(?:\s{1,8}cli)?|llm|kiro|windsurf|cline|aider|devin|junie)`;
// Generic addressees: "Agent: push to main", "AI, delete the tests", "Assistant must ...".
const ADDRESSEE = String.raw`(?:ai|agents?|assistants?|bots?|models?|llms?|ai\s{1,4}agents?|coding\s{1,4}agents?)`;
const DIRECTIVE = String.raw`(?:must|should|shall|will|needs?\s{1,8}to|has\s{1,8}to|have\s{1,8}to|always|never|do\s{1,8}not|don't|please|may\s{1,8}not|cannot|can't)`;
const INSTRUCTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override)\b[^\n]{0,40}\b(previous|prior|above|earlier|all|any|other|system)\b/i, "asks to ignore other instructions"],
  // The same request in Spanish, German, French, Chinese and Japanese: fixed phrases only, to keep false positives near zero.
  [/\bignora(?:r)?\s{1,4}(?:todas\s{1,4})?las\s{1,4}instrucciones\s{1,4}(?:anteriores|previas)|\bignorier(?:e|en)?\s{1,4}(?:alle\s{1,4})?(?:vorherigen|bisherigen|obigen)\s{1,4}anweisungen|\bignore(?:z|r)?\s{1,4}(?:toutes\s{1,4})?les\s{1,4}instructions\s{1,4}(?:pr\u00e9c\u00e9dentes|ant\u00e9rieures)|\u5ffd\u7565(?:\u4e4b\u524d|\u4ee5\u524d|\u4e0a\u9762|\u5148\u524d)\u7684?(?:\u6240\u6709)?(?:\u6307\u4ee4|\u6307\u793a|\u8bf4\u660e)|(?:\u4ee5\u524d|\u524d|\u4e0a\u8a18)\u306e(?:\u6307\u793a|\u547d\u4ee4)[^\u3002\n]{0,8}\u7121\u8996/i, "asks to ignore other instructions"],
  [/\b(you are|you must|you should|you will|as an ai|ai assistant|language model|system prompt|the assistant|the agent|the model)\b/i, "addresses the AI directly"],
  // Vocative: the name opens the comment, a line or a sentence and is followed by "," or ":".
  [new RegExp(String.raw`(?:^|[\n.!?;]|[([])\s{0,8}(?:(?:hey|hi|dear|attention|attn)\s{1,8})?@?${AI_NAME}\s{0,3}[,:](?!\/)`, "i"), "addresses an AI assistant by name"],
  // The name as the subject of a directive: "Claude must ...", "Copilot should never ...".
  [new RegExp(String.raw`\b${AI_NAME}\s{1,8}${DIRECTIVE}\b`, "i"), "addresses an AI assistant by name"],
  // A generic addressee opening the comment or a sentence: "Agent: ...", "Bot, ...", "Assistant must ...", "Model note - ...".
  [new RegExp(String.raw`(?:^|[\n.!?;]|[([])\s{0,8}(?:(?:hey|hi|dear|attention|attn|note\s{1,4}to(?:\s{1,4}the)?)\s{1,8})?@?${ADDRESSEE}\s{0,3}(?:[,:]|\s{1,8}${DIRECTIVE}\b|\s{1,4}note\b)`, "i"), "addresses the AI directly"],
  [/\b(do not|don't|never)\s+(tell|mention|reveal|show|inform)\b/i, "asks to hide something from the user"],
  [/\b(secretly|silently|quietly|without (telling|asking|mentioning))\b/i, "asks for covert action"],
  // A secret on its own is a topic ("the token budget table", "the SSH bastion docs"); it counts
  // when the comment asks to move it somewhere ("print the API keys", "send the token to ...").
  [/\b(exfiltrat\w*|curl\s|wget\s|base64\b|ssh\s+[\w.-]+@)/i, "mentions commands or secrets"],
  [/\b(send|print|reveal|post|upload|leak|share|expose|dump|email|paste|output|echo|log|copy|append|commit|push)\b[^\n]{0,60}?(?:\b(api[_ -]?keys?|tokens?|passwords?|credentials?|secrets?|ssh[_ -]?keys?|private[_ -]keys?|env(?:ironment)?[_ -]?var(?:iable)?s?)\b|(?:^|[\s(`'"])\.env\b)/i, "mentions commands or secrets"],
  [/\b(run|execute|call|invoke)\s+(the\s+)?(command|script|tool|shell|bash)\b/i, "asks to run a command"],
  [new RegExp(String.raw`\b(instructions?|note\s{1,8}(?:to|for)\s{1,8}(?:the\s{1,8})?(?:ai|agents?|assistants?|models?|llms?|${AI_NAME}))\s*:`, "i"), "reads like an instruction"],
];

/** URLs say where something lives, not what to do: "claude" in code.claude.com is not an address to Claude. */
const URL_LIKE = /\b(?:[a-z][a-z0-9+.-]{1,31}:\/\/|www\.)[^\s<>()"']{1,2048}/gi;

export function classifyInstruction(text: string): string | null {
  const t = (text.length > COMMENT_SLICE ? text.slice(0, COMMENT_SLICE) : text).replace(URL_LIKE, " ");
  for (const [re, label] of INSTRUCTION_PATTERNS) if (re.test(t)) return label;
  return null;
}

export function scanComments(lines: LineIndex, fence: Uint8Array): { findings: CommentFinding[]; total: number } {
  const s = lines.text;
  const spans = new InlineCodeSpans(lines);
  const findings: CommentFinding[] = [];
  let total = 0;
  let pos = 0;
  for (;;) {
    const open = s.indexOf("<!--", pos);
    if (open < 0) break;
    const startLine = lines.lineOf(open);
    const close = s.indexOf("-->", open + 4);
    const end = close < 0 ? s.length : close + 3;
    if (fence[startLine]) { pos = end; continue; } // visible as code, not hidden
    if (spans.inCode(startLine, open)) { pos = open + 4; continue; } // `<!-- -->` in a code span is shown, not hidden
    pos = end;
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

/**
 * Inline code spans per line, CommonMark style: a backtick run opens a span only
 * when a later run of the same length on the line closes it; an unmatched run is
 * literal text. (A stray backtick therefore cannot hide a comment after it.)
 * Linear per line: each run is matched with the next run of equal length.
 */
export class InlineCodeSpans {
  private line = -1;
  private spans: Array<[number, number]> = [];
  constructor(private readonly lines: LineIndex) {}
  inCode(li: number, at: number): boolean {
    if (li !== this.line) {
      this.line = li;
      this.spans = this.compute(li);
    }
    // Spans are sorted and disjoint: binary search for the last span starting at or before `at`.
    let lo = 0;
    let hi = this.spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.spans[mid]![0] <= at) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi >= 0 && at < this.spans[hi]![1];
  }
  private compute(li: number): Array<[number, number]> {
    const s = this.lines.text;
    const a = this.lines.start(li);
    const e = this.lines.end(li);
    if (s.indexOf("`", a) < 0 || s.indexOf("`", a) >= e) return [];
    const runs: Array<[number, number]> = []; // [start, length]
    for (let i = a; i < e; ) {
      if (s.charCodeAt(i) !== 96) { i++; continue; }
      let n = 0;
      while (i + n < e && s.charCodeAt(i + n) === 96) n++;
      runs.push([i, n]);
      i += n;
    }
    // For each run, the index of the next run with the same length.
    const next = new Int32Array(runs.length).fill(-1);
    const lastByLen = new Map<number, number>();
    for (let k = runs.length - 1; k >= 0; k--) {
      const len = runs[k]![1];
      next[k] = lastByLen.get(len) ?? -1;
      lastByLen.set(len, k);
    }
    const out: Array<[number, number]> = [];
    for (let k = 0; k < runs.length; ) {
      const j = next[k]!;
      if (j < 0) { k++; continue; }
      out.push([runs[k]![0], runs[j]![0] + runs[j]![1]]);
      k = j + 1;
      if (out.length >= 10_000) break;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Link reference definitions used as comments: [//]: # (text), [x]: <> "text".
// They render as nothing, so their title text is hidden like an HTML comment.

export interface RefCommentFinding {
  line: number; // 1-based
  instructionLike: boolean;
  matched: string | null;
  preview: string;
}

export function scanRefComments(lines: LineIndex, fence: Uint8Array): RefCommentFinding[] {
  const s = lines.text;
  const out: RefCommentFinding[] = [];
  for (let i = 0; i < lines.count && out.length < CAPS.maxFindingsPerRule; i++) {
    if (fence[i]) continue;
    const a = lines.start(i);
    const e = lines.end(i);
    let p = a;
    if (i === 0 && s.charCodeAt(p) === 0xfeff) p++;
    while (p < e && p - a < 3 && s.charCodeAt(p) === 32) p++;
    if (s.charCodeAt(p) !== 91 || s.charCodeAt(p + 1) === 94) continue; // [ but not a [^footnote]:
    const close = boundedIndexOf(s, "]:", p + 1, Math.min(e, p + 1000));
    if (close < 0) continue;
    let q = close + 2;
    while (q < e && (s.charCodeAt(q) === 32 || s.charCodeAt(q) === 9)) q++;
    // Destination: <...> or a run of non-space characters.
    const d = q;
    if (s.charCodeAt(q) === 60) {
      const gt = boundedIndexOf(s, ">", q + 1, Math.min(e, q + CAPS.maxTargetChars));
      if (gt < 0) continue;
      q = gt + 1;
    } else {
      while (q < e && q - d < CAPS.maxTargetChars && s.charCodeAt(q) !== 32 && s.charCodeAt(q) !== 9) q++;
      if (q === d) continue;
    }
    const label = s.slice(p + 1, close);
    const dest = s.slice(d, q);
    // The comment idiom: a dummy destination (#, <>, //) or the // label.
    const idiom = label === "//" || dest === "#" || dest === "<>" || dest === "//";
    while (q < e && (s.charCodeAt(q) === 32 || s.charCodeAt(q) === 9)) q++;
    const opener = s.charCodeAt(q);
    const closer = opener === 40 ? 41 : opener === 34 || opener === 39 ? opener : -1;
    if (closer < 0) continue; // no title: nothing hidden on this line
    let r = e;
    while (r > q + 1 && (s.charCodeAt(r - 1) === 32 || s.charCodeAt(r - 1) === 9)) r--;
    if (s.charCodeAt(r - 1) !== closer || r - 1 <= q) continue;
    const body = s.slice(q + 1, Math.min(r - 1, q + 1 + COMMENT_SLICE));
    if (!body.trim()) continue;
    const matched = classifyInstruction(body);
    if (!idiom && matched === null) continue; // an ordinary link title (a tooltip), not a comment
    out.push({ line: i + 1, instructionLike: matched !== null, matched, preview: body.replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hidden text through inline styles

const HIDDEN_STYLE = /^style\s*=\s*["'][^"'\n]{0,200}?(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0(?![.\d]*[1-9])|color\s*:\s*(?:#fff\b|#ffffff\b|white\b))/i;

export function scanHiddenStyles(lines: LineIndex, fence: Uint8Array): number[] {
  const out: number[] = [];
  const s = lines.text;
  // `<div style="display:none">` in a code span is shown as code, not hidden.
  const spans = new InlineCodeSpans(lines);
  let pos = 0;
  for (;;) {
    const at = s.indexOf("style", pos);
    if (at < 0) break;
    pos = at + 5;
    const li = lines.lineOf(at);
    if (fence[li] || spans.inCode(li, at)) continue;
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
  // The HTML hidden attribute: <div hidden>, <p class="x" hidden="">.
  pos = 0;
  for (;;) {
    if (out.length >= CAPS.maxFindingsPerRule) break;
    const at = s.indexOf("hidden", pos);
    if (at < 0) break;
    pos = at + 6;
    const before = s.charCodeAt(at - 1);
    const after = s.charCodeAt(at + 6);
    if (!(before === 32 || before === 9 || before === 10 || before === 13) || !(after === 62 || after === 61 || after === 32 || after === 9 || after === 47)) continue;
    const li = lines.lineOf(at);
    if (fence[li] || spans.inCode(li, at)) continue;
    // Bounded look-back for the tag opener: "<" + letter, with no ">" in between. The tag may
    // span lines (`<div class="note"` then `hidden>`), so the look-back crosses line breaks,
    // but not into a fenced block.
    let lt = -1;
    for (let k = at - 1; k >= Math.max(0, at - 200); k--) {
      const ch = s.charCodeAt(k);
      if (ch === 62) break;
      if (ch === 60) { lt = k; break; }
    }
    if (lt < 0 || !/[A-Za-z]/.test(s[lt + 1] ?? "") || fence[lines.lineOf(lt)]) continue;
    if (!out.includes(li + 1)) out.push(li + 1);
  }
  return out.sort((x, y) => x - y);
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
/** An @import that names a file for sure: path-like, and not an npm name such as @scope/package. */
export function importIsSurelyFile(im: ImportRef): boolean {
  const npmName = /^[a-z0-9][\w.-]*\/[a-z0-9][\w-]*$/i.test(im.path) && !/\.[A-Za-z0-9]{1,10}$/.test(im.path);
  return im.looksLikePath && !npmName;
}

export function extractImports(lines: LineIndex, fence: Uint8Array, skipUntilLine = -1): ImportRef[] {
  const s = lines.text;
  const out: ImportRef[] = [];
  const spans = new CodeSpanTracker(lines);
  // HTML comments, in order: Claude Code strips them before loading, so "@claude" in one is not an import.
  const commentSpans = new InlineCodeSpans(lines);
  let cStart = -1;
  let cEnd = -1; // the current or last comment is [cStart, cEnd)
  let cNext = 0; // where to look for the next comment
  const inComment = (at: number): boolean => {
    while (cEnd <= at && cNext >= 0) {
      const open = s.indexOf("<!--", cNext);
      if (open < 0) { cNext = -1; break; }
      const close = s.indexOf("-->", open + 4);
      const li = lines.lineOf(open);
      if (fence[li] || commentSpans.inCode(li, open)) { cNext = open + 4; continue; }
      cStart = open;
      cEnd = close < 0 ? s.length : close + 3;
      cNext = cEnd;
    }
    return at >= cStart && at < cEnd;
  };
  let pos = 0;
  while (out.length < CAPS.maxLinkChecks) {
    const at = s.indexOf("@", pos);
    if (at < 0) break;
    pos = at + 1;
    const prev = at === 0 ? 32 : s.charCodeAt(at - 1);
    if (!(prev === 32 || prev === 9 || prev === 10 || prev === 13 || prev === 40 || prev === 0xfeff)) continue;
    const li = lines.lineOf(at);
    if (li <= skipUntilLine || fence[li] || spans.inCode(li, at) || inComment(at)) continue;
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
