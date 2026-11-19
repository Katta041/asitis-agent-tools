// Linear-time scanners over decoded markdown. Rules for this file:
// - no regular expression runs over unbounded input with nested or lazy
//   quantifiers ([\s\S]*? and friends are banned);
// - every search moves forward (indexOf from the last position);
// - per-match work is bounded by a constant (CAPS.maxTargetChars, comment slices).

import { HIDDEN_PHRASES, LANG_SCRIPTS, scriptsIn } from "./lang/hidden-phrases.js";
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

export const INVISIBLE_NAMES: Record<number, string> = {
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

export const isBidi = (cp: number): boolean => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
export const isVariationSelector = (cp: number): boolean => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
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
export function emojiJoiner(s: string, i: number): boolean {
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
export function suspiciousSelector(s: string, i: number, cp: number): boolean {
  const prev = cpBefore(s, i);
  if (prev < 0 || isVariationSelector(prev)) return true;
  const next = s.codePointAt(i + (cp > 0xffff ? 2 : 1)) ?? -1;
  if (next >= 0 && isVariationSelector(next)) return true;
  if (cp <= 0xfe0f) return false; // VS1-VS16 after an ordinary character: text or emoji presentation
  return !IDEOGRAPH.test(String.fromCodePoint(prev));
}

// Invisible characters that are part of the text, not hidden in it. scanInvisible does not report
// them, and the invisible-char and bidi-control fixers (fixes/invisible.ts) never delete them; both
// use InvisibleKeep so the two cannot disagree. Unicode 15.1, chapter 23.2 "Layout Controls",
// https://www.unicode.org/versions/Unicode15.1.0/ch23.pdf, and UTS #51 section 2.8 "Emoji Tag
// Sequences", https://www.unicode.org/reports/tr51/#Emoji_Tag_Sequences (both read 14 October 2026):
// - ZERO WIDTH NON-JOINER and ZERO WIDTH JOINER between letters of a script that uses them to pick
//   letter forms (Persian, Arabic, Hindi and other Indic scripts), or next to an emoji. Also one on
//   its own at the end of a word in such a script: Malayalam chillu letters are spelled virama + ZWJ,
//   and translated docs often end Kannada and Telugu words with a ZWNJ.
// - ZERO WIDTH SPACE on its own between letters of a script written without spaces (Khmer, Thai,
//   Lao, Myanmar and others), where it marks the word break.
// - LEFT-TO-RIGHT MARK, RIGHT-TO-LEFT MARK and ARABIC LETTER MARK on a line with right-to-left text,
//   or on its own in a document with a lot of right-to-left text (a Hebrew doc puts one after an
//   inline code span on an otherwise Latin line), where they fix the display order of numbers and
//   punctuation. They are not overrides.
// "On its own" means neither neighbour is another invisible character: a run of them is how text is
// hidden, so a run is still reported.
// Found in the 18 November 2026 scan of 300 popular repos: 92 of 94 invisible-char findings were
// these characters in translated docs.
// - COMBINING GRAPHEME JOINER next to a combining mark (Hebrew and other pointed text).
// - MONGOLIAN VOWEL SEPARATOR next to Mongolian letters, and the Hangul fillers next to Hangul.
// - TAG characters that spell a subdivision flag: U+1F3F4, 2 to 7 tags from 0-9 and a-z, then
//   CANCEL TAG (England, Scotland, Wales). Longer runs or other tags are still reported, because
//   tag characters are how ASCII text is smuggled past a reader.

const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}]/u;
const SIMPLE_SCRIPT = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]$/u;
const EMOJI_NEAR = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}️⃣]$/u;
const MARK = /^\p{M}$/u;
const LETTER = /^\p{L}$/u;
const MONGOLIAN = /^\p{Script=Mongolian}$/u;
const NO_SPACES = /^[\p{Script=Khmer}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Tai_Tham}\p{Script=New_Tai_Lue}\p{Script=Balinese}\p{Script=Javanese}]$/u;
const RTL_LETTERS = new RegExp(RTL.source, "gu");
/** Right-to-left letters a document needs before a lone direction mark on a Latin line counts as part of it. */
const RTL_DOC_MIN = 200;
const HANGUL = /^\p{Script=Hangul}$/u;
const isTag = (cp: number | undefined): boolean => cp !== undefined && cp >= 0xe0000 && cp <= 0xe007f;

const charAt = (s: string, i: number): string => (i >= 0 && i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : "");
const charBefore = (s: string, i: number): string => {
  const cp = cpBefore(s, i);
  return cp < 0 ? "" : String.fromCodePoint(cp);
};

/**
 * The nearest letter before (dir -1) or from (dir 1) index i, stepping over combining marks and
 * other invisible characters, at most 8 characters away. "" when the neighbour is not a letter.
 */
const invisibleCp = (cp: number): boolean => INVISIBLE_NAMES[cp] !== undefined || isVariationSelector(cp) || isTag(cp);

/** Neither neighbour of the character at `at` is another invisible character. */
function alone(s: string, at: number, units: number): boolean {
  const before = cpBefore(s, at);
  const after = s.codePointAt(at + units);
  return !(before >= 0 && invisibleCp(before)) && !(after !== undefined && invisibleCp(after));
}

function letterNear(s: string, i: number, dir: 1 | -1): string {
  let p = i;
  for (let k = 0; k < 8; k++) {
    const ch = dir < 0 ? charBefore(s, p) : charAt(s, p);
    if (!ch) return "";
    if (LETTER.test(ch)) return ch;
    const cp = ch.codePointAt(0)!;
    if (!MARK.test(ch) && INVISIBLE_NAMES[cp] === undefined && !isVariationSelector(cp) && !isTag(cp)) return "";
    p += dir * ch.length;
  }
  return "";
}

/**
 * Decides whether an invisible character belongs to the text. Keeps per-line and per-tag-run state,
 * so a caller that walks forward does linear work: the right-to-left test runs once per line and a
 * run of tag characters is measured once.
 */
export class InvisibleKeep {
  private rtlLine = -1;
  private rtl = false;
  private tagEnd = -1;
  private tagFlag = false;
  private rtlDoc: boolean | undefined;
  constructor(private readonly s: string) {}

  /** Why the character at `at` stays, or "" when it is hidden text. lineStart/lineEnd bound its line. */
  reason(at: number, cp: number, units: number, lineStart: number, lineEnd: number): string {
    const s = this.s;
    if (cp === 0x200c || cp === 0x200d) {
      if (EMOJI_NEAR.test(charBefore(s, at)) || EMOJI_NEAR.test(charAt(s, at + units))) return "it is next to an emoji, where it joins an emoji sequence";
      const before = letterNear(s, at, -1);
      const after = letterNear(s, at + units, 1);
      if (before && after && !(SIMPLE_SCRIPT.test(before) && SIMPLE_SCRIPT.test(after))) return "it sits between letters of a script that uses it to choose letter forms (Persian, Arabic, Hindi and others)";
      if (before && !SIMPLE_SCRIPT.test(before) && !after && alone(s, at, units)) return "it ends a word in a script that uses it to choose letter forms (Malayalam, Kannada, Telugu and others)";
      return "";
    }
    if (cp === 0x200b) {
      // alone() first: it is two code point lookups, and a file of nothing but ZWSPs fails it at once.
      if (!alone(s, at, units) || !NO_SPACES.test(letterNear(s, at, -1))) return "";
      return NO_SPACES.test(letterNear(s, at + units, 1)) ? "it marks a word break in a script written without spaces (Khmer, Thai, Lao, Myanmar and others)" : "";
    }
    if (cp === 0x200e || cp === 0x200f || cp === 0x061c) {
      if (this.rtlLine !== lineStart) {
        this.rtlLine = lineStart;
        this.rtl = RTL.test(s.slice(lineStart, lineEnd));
      }
      if (this.rtl) return "the line has right-to-left text, where it sets the display order";
      if (!alone(s, at, units)) return "";
      if (this.rtlDoc === undefined) {
        let n = 0;
        RTL_LETTERS.lastIndex = 0;
        while (n < RTL_DOC_MIN && RTL_LETTERS.exec(s)) n++;
        this.rtlDoc = n >= RTL_DOC_MIN;
      }
      return this.rtlDoc ? "the document is mostly right-to-left text, where it sets the display order" : "";
    }
    if (cp === 0x034f) return MARK.test(charBefore(s, at)) || MARK.test(charAt(s, at + units)) ? "it sits between combining marks" : "";
    if (cp === 0x180e) return MONGOLIAN.test(charBefore(s, at)) || MONGOLIAN.test(charAt(s, at + units)) ? "it is part of Mongolian text" : "";
    if (cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0) return HANGUL.test(charBefore(s, at)) || HANGUL.test(charAt(s, at + units)) ? "it is part of Hangul text" : "";
    if (isTag(cp)) {
      if (at >= this.tagEnd) {
        let a = at;
        while (a >= 2 && isTag(s.codePointAt(a - 2))) a -= 2;
        let e = at;
        while (isTag(s.codePointAt(e))) e += 2;
        this.tagEnd = e;
        // Tags spelling the subdivision: digits and lower-case letters, then CANCEL TAG.
        let spec = 0;
        let ok = s.codePointAt(e - 2) === 0xe007f && cpBefore(s, a) === 0x1f3f4;
        for (let p = a; ok && p < e - 2; p += 2) {
          const t = s.codePointAt(p)!;
          if (!((t >= 0xe0030 && t <= 0xe0039) || (t >= 0xe0061 && t <= 0xe007a))) ok = false;
          spec++;
        }
        this.tagFlag = ok && spec >= 2 && spec <= 7;
      }
      return this.tagFlag ? "it is part of a flag emoji" : "";
    }
    return "";
  }
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
  const keep = new InvisibleKeep(s);
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
    if (keep.reason(at, cp, cp > 0xffff ? 2 : 1, lines.start(lineIdx), lines.end(lineIdx))) continue;
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
const COVERT = String.raw`(?:secretly|silently|quietly|without\s{1,8}(?:telling|asking|mentioning|notifying|informing))`;
const COVERT_ACT = String.raw`(?:push|delete|remove|send|upload|post|run|execute|install|uninstall|commit|merge|modify|change|add|append|write|overwrite|replace|rewrite|disable|enable|approve|deploy|update|create|copy|move|download|edit|insert|drop|force-push|rename|publish|exfiltrate|collect|log|record|forward|email|transfer|grant|revoke|bypass|skip|alter|patch|inject|fetch|call)`;
const INSTRUCTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override)\b[^\n]{0,40}\b(previous|prior|above|earlier|all|any|other|system)\b/i, "asks to ignore other instructions"],
  [/\b(you are|you must|you should|you will|as an ai|ai assistant|language model|system prompt|the assistant|the agent|the model)\b/i, "addresses the AI directly"],
  // Vocative: the name opens the comment, a line or a sentence and is followed by "," or ":".
  [new RegExp(String.raw`(?:^|[\n.!?;]|[([])\s{0,8}(?:(?:hey|hi|dear|attention|attn)\s{1,8})?@?${AI_NAME}\s{0,3}[,:](?!\/)`, "i"), "addresses an AI assistant by name"],
  // The name as the subject of a directive: "Claude must ...", "Copilot should never ...".
  [new RegExp(String.raw`\b${AI_NAME}\s{1,8}${DIRECTIVE}\b`, "i"), "addresses an AI assistant by name"],
  // A generic addressee opening the comment or a sentence: "Agent: ...", "Bot, ...", "Assistant must ...", "Model note - ...".
  [new RegExp(String.raw`(?:^|[\n.!?;]|[([])\s{0,8}(?:(?:hey|hi|dear|attention|attn|note\s{1,4}to(?:\s{1,4}the)?)\s{1,8})?@?${ADDRESSEE}\s{0,3}(?:[,:]|\s{1,8}${DIRECTIVE}\b|\s{1,4}note\b)`, "i"), "addresses the AI directly"],
  [/\b(do not|don't|never)\s+(tell|mention|reveal|show|inform)\b/i, "asks to hide something from the user"],
  // A covert word counts only next to an imperative action in the same sentence, as in the other
  // languages (lang/hidden-phrases.ts): "silently push to main", "delete it without telling anyone".
  // A template line like "things that break silently" describes code, it doesn't ask for anything.
  [new RegExp(String.raw`(?:\b${COVERT_ACT}\b(?:(?![.!?;\n])[^\n]){0,60}\b${COVERT}\b|\b${COVERT},?\s{1,8}${COVERT_ACT}\b)`, "i"), "asks for covert action"],
  // A secret on its own is a topic ("the token budget table", "the SSH bastion docs"); it counts
  // when the comment asks to move it somewhere ("print the API keys", "send the token to ...").
  [/\b(exfiltrat\w*|curl\s|wget\s|base64\b|ssh\s+[\w.-]+@)/i, "mentions commands or secrets"],
  [/\b(send|print|reveal|post|upload|leak|share|expose|dump|email|paste|output|echo|log|copy|append|commit|push)\b[^\n]{0,60}?(?:\b(api[_ -]?keys?|tokens?|passwords?|credentials?|secrets?|ssh[_ -]?keys?|private[_ -]keys?|env(?:ironment)?[_ -]?var(?:iable)?s?)\b|(?:^|[\s(`'"])\.env\b)/i, "mentions commands or secrets"],
  [/\b(run|execute|call|invoke)\s+(the\s+)?(command|script|tool|shell|bash)\b/i, "asks to run a command"],
  [new RegExp(String.raw`\b(instructions?|note\s{1,8}(?:to|for)\s{1,8}(?:the\s{1,8})?(?:ai|agents?|assistants?|models?|llms?|${AI_NAME}))\s*:`, "i"), "reads like an instruction"],
];

/** URLs say where something lives, not what to do: "claude" in code.claude.com is not an address to Claude. */
const URL_LIKE = /\b(?:[a-z][a-z0-9+.-]{1,31}:\/\/|www\.)[^\s<>()"']{1,2048}/gi;

/**
 * A machine-readable directive such as "agents:cwd=root" or "prettier-ignore key=value": words
 * joined by ":" or "=" with no spaces inside them, and no sentence. Tools read these, not models.
 */
const DIRECTIVE_COMMENT = /^[\w.@/-]{1,60}[:=][\w.@/,:=-]{0,200}(?:\s{1,4}[\w.@/-]{1,60}[:=][\w.@/,:=-]{0,200}){0,7}$/;
/** Words that make a directive comment ask for an action, so it is still checked as an instruction. */
const DIRECTIVE_ACTION = /\b(?:send|upload|post|leak|share|expose|dump|email|exfiltrat\w*|run|exec\w*|eval|curl|wget|push|commit|delete|remove|ignore|disregard|forget|override|bypass|skip|disable|secrets?|tokens?|passwords?|credentials?|keys?|env)\b|\.env\b/i;
/** Labels that only say a comment speaks to an AI; the others ask for something harmful. */
const ADDRESS_ONLY = new Set(["addresses the AI directly", "addresses an AI assistant by name", "reads like an instruction"]);

/**
 * Why a hidden comment reads like an instruction to an AI, or null. `otherLanguages` is false for
 * an ordinary link title (a visible tooltip): the phrase tables in lang/hidden-phrases.ts apply to
 * hidden comments only, which also keeps a file of many titled links cheap to scan.
 */
export function classifyInstruction(text: string, otherLanguages = true): string | null {
  const t = (text.length > COMMENT_SLICE ? text.slice(0, COMMENT_SLICE) : text).replace(URL_LIKE, " ");
  // A key:value=value directive comment is written for a tool; it is flagged only when it asks
  // for something harmful (ignore instructions, hide, run, send secrets), never just for naming the AI.
  const directive = t.trim().length <= 300 && DIRECTIVE_COMMENT.test(t.trim()) && !DIRECTIVE_ACTION.test(t);
  let english: string | null = null;
  for (const [re, label] of INSTRUCTION_PATTERNS) {
    if (!re.test(t)) continue;
    if (ADDRESS_ONLY.has(label) && directive) continue;
    english = label;
    break;
  }
  if (!otherLanguages || (english !== null && !ADDRESS_ONLY.has(english))) return english;
  const scripts = scriptsIn(t);
  const lower = t.toLowerCase();
  // Other languages (lang/hidden-phrases.ts, issue #6). They run after English, and a harmful match
  // there wins over an English one that only addresses the AI ("Claude: 忽略之前的所有指令").
  for (const p of HIDDEN_PHRASES) {
    const label = p.label;
    if (english !== null && ADDRESS_ONLY.has(label)) break;
    const need = LANG_SCRIPTS[p.lang];
    if (need !== 0 && (scripts & need) === 0) continue;
    // p.regex compiles on first use, after the script check, so Han or Cyrillic phrases cost nothing until such a comment shows up.
    if (!p.regex.test(lower)) continue;
    if (ADDRESS_ONLY.has(label) && directive) continue;
    return label;
  }
  return english;
}

/**
 * Where the "-->" that closes the comment opened at `open` starts, or -1. "<!-->" and "<!--->" are
 * complete, empty comments (CommonMark 0.31.2, 6.6, and the HTML spec), so their "-->" overlaps
 * the opener; looking only from open + 4 read the rest of the file as hidden (issue #28).
 */
export function commentClose(s: string, open: number): number {
  if (s.startsWith(">", open + 4)) return open + 2;
  if (s.startsWith("->", open + 4)) return open + 3;
  return s.indexOf("-->", open + 4);
}

/**
 * commentClose for a scan that meets openers in order. It remembers the last "-->" search, so a
 * run of openers that are skipped (in a code span or a fence) shares one search instead of each
 * scanning to the end of the file. That was quadratic: 1 MB of "`<!--<!--..." took over 90 s.
 */
export class CommentCloser {
  private from = -1;
  private found = -1;
  constructor(private readonly s: string) {}
  close(open: number): number {
    const s = this.s;
    if (s.startsWith(">", open + 4)) return open + 2;
    if (s.startsWith("->", open + 4)) return open + 3;
    const start = open + 4;
    // The first "-->" at or after `from` is `found`, so it is also the first one at or after any
    // start between the two. With none after `from`, there is none after a later start either.
    if (this.from >= 0 && start >= this.from && (this.found < 0 || start <= this.found)) return this.found;
    this.from = start;
    this.found = s.indexOf("-->", start);
    return this.found;
  }
}

export function scanComments(lines: LineIndex, fence: Uint8Array): { findings: CommentFinding[]; total: number } {
  const s = lines.text;
  const spans = new InlineCodeSpans(lines);
  const closer = new CommentCloser(s);
  const findings: CommentFinding[] = [];
  let total = 0;
  let pos = 0;
  for (;;) {
    const open = s.indexOf("<!--", pos);
    if (open < 0) break;
    const startLine = lines.lineOf(open);
    const close = closer.close(open);
    const end = close < 0 ? s.length : close + 3;
    if (fence[startLine]) { pos = end; continue; } // visible as code, not hidden
    if (spans.inCode(startLine, open)) { pos = open + 4; continue; } // `<!-- -->` in a code span is shown, not hidden
    pos = end;
    total++;
    if (findings.length >= CAPS.maxFindingsPerRule) {
      if (close < 0) break;
      continue;
    }
    const body = close >= 0 && close < open + 4 ? "" : s.slice(open + 4, close < 0 ? Math.min(s.length, open + 4 + COMMENT_SLICE) : Math.min(close, open + 4 + COMMENT_SLICE));
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
    // Search this line only: indexOf from a scans to the end of the file, which made a file of
    // many backtick-free comment lines quadratic.
    if (!s.slice(a, e).includes("`")) return [];
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
    const matched = classifyInstruction(body, idiom);
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
    // "\[text\](...)": an escaped bracket is literal text, not a link.
    if (at > 0 && s.charCodeAt(at - 1) === 92 && (at < 2 || s.charCodeAt(at - 2) !== 92)) continue;
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
  /** The word after @ as written, up to a space or backtick. */
  raw: string;
  /** raw without the punctuation that ends a sentence around it: what the author meant. */
  path: string;
  looksLikePath: boolean;
  /** Written right after "(", where neither Claude Code nor Gemini CLI reads an import. */
  afterParen: boolean;
}

/**
 * The path the tool itself resolves for an import, or null when it does not read one there.
 * Claude Code 2.1.312 matches /(?:^|\s)@((?:[^\s\\]|\\ )+)/ in markdown text tokens and cuts the
 * match at "#"; emphasis markers are gone by then, punctuation is not. Gemini CLI's findImports takes
 * the word up to whitespace and keeps everything. Both need whitespace before the @. Checked with
 * canary files in Claude Code: "@guide.md:", "@guide.md." and "(see @guide.md)" load nothing,
 * "**@guide.md**", "_@guide.md_" and "@guide.md#setup" load guide.md.
 */
export function importTarget(im: ImportRef, tool: "claude" | "gemini"): string | null {
  if (im.afterParen) return null;
  if (tool === "gemini") return im.raw;
  const h = im.raw.indexOf("#");
  const p = h >= 0 ? im.raw.slice(0, h) : im.raw;
  // "**@x.md**:" and "_@x.md_": the closing emphasis, and punctuation after it, are outside the
  // text token. Scanned from the end, so a long run of "*" stays linear.
  let end = p.length;
  while (end > 0 && SENTENCE_END.includes(p[end - 1]!)) end--;
  let mark = end;
  while (mark > 0 && (p[mark - 1] === "*" || p[mark - 1] === "_")) mark--;
  return mark < end ? p.slice(0, mark) : p;
}

const SENTENCE_END = ".,;:!?)]\"'\u201c\u201d\u2018\u2019";

/** What the author meant, for the tool: Claude Code drops a #fragment, Gemini CLI does not. */
export function importIntent(im: ImportRef, tool: "claude" | "gemini"): string {
  if (tool === "gemini") return im.path;
  const h = im.path.indexOf("#");
  return h >= 0 ? im.path.slice(0, h) : im.path;
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

/** Counts straight and curly double quotes from the start of a line, moving forward only, so repeated calls stay linear. */
class QuoteCounter {
  private line = -1;
  private pos = 0;
  private n = 0;
  constructor(private readonly lines: LineIndex) {}
  before(li: number, at: number): number {
    const s = this.lines.text;
    if (li !== this.line) {
      this.line = li;
      this.pos = this.lines.start(li);
      this.n = 0;
    }
    for (; this.pos < at; this.pos++) {
      const c = s.charCodeAt(this.pos);
      if (c === 34 || c === 0x201c || c === 0x201d) this.n++;
    }
    return this.n;
  }
}

export function extractImports(lines: LineIndex, fence: Uint8Array, skipUntilLine = -1): ImportRef[] {
  const s = lines.text;
  const out: ImportRef[] = [];
  const spans = new CodeSpanTracker(lines);
  // HTML comments, in order: Claude Code strips them before loading, so "@claude" in one is not an import.
  const commentSpans = new InlineCodeSpans(lines);
  const closer = new CommentCloser(s);
  let cStart = -1;
  let cEnd = -1; // the current or last comment is [cStart, cEnd)
  let cNext = 0; // where to look for the next comment
  const inComment = (at: number): boolean => {
    while (cEnd <= at && cNext >= 0) {
      const open = s.indexOf("<!--", cNext);
      if (open < 0) { cNext = -1; break; }
      const close = closer.close(open);
      const li = lines.lineOf(open);
      if (fence[li] || commentSpans.inCode(li, open)) { cNext = open + 4; continue; }
      cStart = open;
      cEnd = close < 0 ? s.length : close + 3;
      cNext = cEnd;
    }
    return at >= cStart && at < cEnd;
  };
  const quotes = new QuoteCounter(lines);
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
    // Inside a quotation ("Thanks @user" in a style guide) an @ is a mention, not an import:
    // an odd number of double quotes before it on the line means it is inside one.
    if (quotes.before(li, at) % 2 === 1) continue;
    let cut = raw.length;
    // "*" closes **bold** around an import; quotes and punctuation end a sentence around it.
    while (cut > 0 && ".,;:!?)]*\"'\u201c\u201d\u2018\u2019".includes(raw[cut - 1]!)) cut--;
    const trimmed = raw.slice(0, cut);
    if (!trimmed) continue;
    const looksLikePath = trimmed.includes("/") || /\.[A-Za-z0-9]{1,10}$/.test(trimmed);
    out.push({ line: li + 1, raw, path: trimmed, looksLikePath, afterParen: prev === 40 });
  }
  return out;
}
