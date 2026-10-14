// YAML frontmatter detection with the line-1 rule, then a bounded YAML parse.

import { parseDocument } from "yaml";
import { CAPS } from "./limits.js";
import type { LineIndex } from "./text.js";

export type FrontmatterProblem =
  | { rule: "frontmatter-bom"; line: number; message: string }
  | { rule: "frontmatter-not-line-1"; line: number; message: string }
  | { rule: "frontmatter-unclosed"; line: number; message: string }
  | { rule: "frontmatter-yaml"; line: number; message: string }
  | { rule: "frontmatter-not-mapping"; line: number; message: string }
  | { rule: "frontmatter-too-large"; line: number; message: string }
  | { rule: "frontmatter-value-cut"; line: number; message: string };

export interface Frontmatter {
  /** True when a frontmatter block that tools will read starts on line 1. */
  present: boolean;
  /** 0-based first and last line of the block (the fences), when present or misplaced. */
  startLine: number;
  endLine: number;
  data: Record<string, unknown> | null;
  /** Line (1-based) of each top-level key, for messages. */
  keyLines: Record<string, number>;
  problems: FrontmatterProblem[];
}

const isFence = (s: string): boolean => {
  if (!s.startsWith("---")) return false;
  for (let i = 3; i < s.length; i++) if (s.charCodeAt(i) !== 32 && s.charCodeAt(i) !== 9) return false;
  return true;
};

import type { Kind } from "./kinds.js";

/** What goes wrong when a file's frontmatter does not parse, in the words of the tool that reads it. */
function unreadable(kind: Kind | undefined): string {
  switch (kind) {
    case "skill":
      return "Claude Code and other skill readers may not read this skill's name and description, so fix the YAML";
    case "claude-command":
      return "Claude Code may not read this command's fields, so fix the YAML";
    case "claude-agent":
      return "Claude Code may not read this subagent's name and description, so fix the YAML";
    case "claude-rule":
      return "Claude Code may not read this rule's paths, so fix the YAML";
    case "cursor-rule":
      return "Cursor may not read this rule's description, globs or alwaysApply, so fix the YAML";
    case "copilot-scoped":
    case "prompt-file":
      return "VS Code may not read these fields, so fix the YAML";
    case "windsurf-rule":
      return "Windsurf may not read these fields, so fix the YAML";
    case "memory-topic":
      return "Claude Code may not read this memory's name, description or type, so fix the YAML";
    default:
      return "Tools that read this frontmatter may not see these fields, so fix the YAML";
  }
}

/**
 * Cursor writes `globs: *.ts,*.tsx` without quotes and reads it back as a string, but to YAML
 * a leading `*` is an alias. For Cursor rules only, such a value is quoted before parsing.
 */
function cursorGlobLine(line: string): string {
  const m = /^(globs\s*:\s*)([^\s"'[{|>#&!%@`][^\n]*)$/.exec(line);
  if (!m || !/^\*|,/.test(m[2]!)) return line;
  return `${m[1]}${JSON.stringify(m[2]!.trimEnd())}`;
}

export function readFrontmatter(lines: LineIndex, kind?: Kind): Frontmatter {
  const out: Frontmatter = { present: false, startLine: -1, endLine: -1, data: null, keyLines: {}, problems: [] };
  if (lines.count === 0) return out;
  let first = lines.line(0);
  const bom = first.charCodeAt(0) === 0xfeff;
  if (bom) first = first.slice(1);

  let open = -1;
  if (isFence(first)) {
    open = 0;
    if (bom) {
      out.problems.push({
        rule: "frontmatter-bom",
        line: 1,
        message: "A byte order mark (BOM) comes before the opening ---. Some tools will not see this frontmatter; save the file as UTF-8 without BOM if a tool ignores it",
      });
    }
  } else {
    // Frontmatter-looking block after blank lines: tools that apply the line-1 rule ignore it.
    for (let i = 0; i < Math.min(lines.count, 20); i++) {
      const l = i === 0 ? first : lines.line(i);
      if (l.trim() === "") continue;
      if (isFence(l) && i > 0) {
        let close = -1;
        for (let j = i + 1; j < Math.min(lines.count, i + 200); j++) if (isFence(lines.line(j))) { close = j; break; }
        if (close > i + 1 && /^[A-Za-z_][\w-]*\s*:/.test(lines.line(i + 1))) {
          out.startLine = i;
          out.endLine = close;
          out.problems.push({
            rule: "frontmatter-not-line-1",
            line: i + 1,
            message: `Frontmatter starts on line ${i + 1}, not line 1. Claude Code and most tools read frontmatter only when --- is the first line, so these fields are ignored and the block is treated as content`,
          });
        }
      }
      break;
    }
    return out;
  }

  let close = -1;
  let bytes = 0;
  for (let j = open + 1; j < lines.count; j++) {
    const l = lines.line(j);
    bytes += l.length + 1;
    if (bytes > CAPS.maxFrontmatterBytes) break;
    if (isFence(l) || l === "...") { close = j; break; }
  }
  if (close < 0) {
    if (bytes > CAPS.maxFrontmatterBytes) {
      out.problems.push({ rule: "frontmatter-too-large", line: 1, message: `Frontmatter is larger than ${CAPS.maxFrontmatterBytes} bytes or never closes; it was not parsed` });
    } else {
      out.problems.push({ rule: "frontmatter-unclosed", line: 1, message: "Frontmatter opens with --- on line 1 but never closes with ---. Tools will treat the whole file as frontmatter or ignore it" });
    }
    return out;
  }
  out.present = true;
  out.startLine = open;
  out.endLine = close;
  const yamlText: string[] = [];
  for (let j = open + 1; j < close; j++) yamlText.push(kind === "cursor-rule" ? cursorGlobLine(lines.line(j)) : lines.line(j));
  const src = yamlText.join("\n");
  // prettyErrors fills linePos (1-based within the YAML text); without it every error fell back to line 1.
  const doc = parseDocument(src, { uniqueKeys: true, prettyErrors: true, strict: true });
  if (doc.errors.length > 0) {
    const e = doc.errors[0]!;
    const lineInFm = Math.min(Math.max(e.linePos?.[0]?.line ?? 1, 1), Math.max(close - open - 1, 1));
    const msg = (e.message.split("\n")[0] ?? "parse error").replace(/\s+at line \d+, column \d+:?$/, "");
    out.problems.push({
      rule: "frontmatter-yaml",
      line: open + 1 + lineInFm,
      message: `Frontmatter YAML does not parse (${msg}). ${unreadable(kind)}`,
    });
    return out;
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 50 });
  } catch (err) {
    out.problems.push({ rule: "frontmatter-yaml", line: open + 1, message: `Frontmatter YAML could not be evaluated (${(err as Error).message.split("\n")[0]})` });
    return out;
  }
  if (data === null || data === undefined) {
    out.data = {};
    return out;
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    out.problems.push({ rule: "frontmatter-not-mapping", line: open + 2, message: "Frontmatter must be a YAML mapping of key: value pairs" });
    return out;
  }
  out.data = data as Record<string, unknown>;
  for (let j = open + 1; j < close; j++) {
    const raw = lines.line(j);
    const m = /^([A-Za-z_][\w.-]*)\s*:/.exec(raw);
    if (!m || out.keyLines[m[1]!] !== undefined) continue;
    out.keyLines[m[1]!] = j + 1;
    // "description: Use for A #1 and B": YAML reads " #1 and B" as a comment and drops it.
    const value = raw.slice(m[0].length).trim();
    const hash = value.indexOf(" #");
    const parsed = out.data[m[1]!];
    if (hash > 0 && !/^["'[{|>&*!]/.test(value) && typeof parsed === "string" && parsed.length < value.length) {
      const dropped = value.slice(hash + 1).trim();
      out.problems.push({
        rule: "frontmatter-value-cut",
        line: j + 1,
        message: `The value of ${m[1]} stops before " #": YAML reads ${JSON.stringify(dropped.length > 60 ? dropped.slice(0, 60) + "..." : dropped)} as a comment and drops it. Put the value in quotes to keep it`,
      });
    }
  }
  return out;
}
