// The public finding shape shared by the CLI formats (text, JSON, SARIF, GitHub), the baseline
// and suppression code, and the fix engine. lint.ts keeps its own Issue type for the MCP tools;
// toFindings() converts at the end of lintProject. docs/cli-contract.md is the spec for this file.

import { createHash, type Hash } from "node:crypto";
import path from "node:path";
import type { Doc } from "./doc.js";
import type { Issue, LintResult, Severity } from "./lint.js";
import { VERSION } from "./version.js";

/** Rule categories. `security` rules can never be suppressed inline (see rules/registry.ts). */
export type Category = "format" | "budget" | "security" | "drift" | "config";
export const CATEGORIES: readonly Category[] = ["format", "budget", "security", "drift", "config"];

/** Severity as users see it in every output format. Internally lint.ts says "info" for "note". */
export type FindingSeverity = "error" | "warning" | "note";

export const toFindingSeverity = (s: Severity): FindingSeverity => (s === "info" ? "note" : s);
export const toIssueSeverity = (s: FindingSeverity): Severity => (s === "note" ? "info" : s);

/** Lower is more severe. Used for sorting and for --fail-on. */
export const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, note: 2 };

export type SuppressionKind = "inSource" | "external";

export interface Suppression {
  /** inSource: an asitis-disable comment. external: .asitisrc.json or the baseline file. */
  kind: SuppressionKind;
  justification?: string;
}

export type FixSafety = "safe" | "review";

export interface FixEdit {
  /** Byte offsets into the original file, end exclusive. */
  startByte: number;
  endByte: number;
  /** Replacement text, encoded the way the file is (UTF-8 for nearly every steering file). */
  replacement: string;
}

/** A fix attached to a finding: the unified diff for people, the byte edits for SARIF fixes[]. */
export interface FindingFix {
  safety: FixSafety;
  diff: string;
  edits: FixEdit[];
}

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  category: Category;
  /** Root-relative POSIX path. Files under a second --root keep their absolute path. */
  path: string;
  /** 1-based. Columns count UTF-16 code units; endColumn is exclusive (as in SARIF). */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  fingerprint?: string;
  suppressed?: Suppression;
  fix?: FindingFix;
}

export interface LintSummary {
  files: number;
  errors: number;
  warnings: number;
  notes: number;
  suppressed: number;
  /**
   * Present only when the repo's .asitisrc.json or baseline hid or lowered security findings:
   * how many, and by what. Those findings are also in findings[], marked suppressed (or lowered).
   */
  hiddenSecurity?: { config: number; baseline: number; rules: string[]; ignoredFiles: string[] };
  /** Present (true) only when the walk stopped at the file, entry or time limit, so some steering files were not linted. */
  partial?: true;
}

/** The JSON report. schemaVersion stays 1 for all of 0.x; fields are only ever added. */
export interface LintReport {
  schemaVersion: 1;
  tool: { name: "asitis"; version: string };
  root: string;
  summary: LintSummary;
  findings: Finding[];
}

/**
 * The text a fingerprint is computed from: CR and LF removed, whitespace runs collapsed to one
 * space, ends trimmed. That makes it identical under CRLF and LF and after re-indenting.
 */
export function normaliseLineText(text: string): string {
  return text.replace(/[\r\n]+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * sha256 of ruleId, path, normalised line text and occurrence index (0 for the first finding of
 * this rule on this exact text in this file, 1 for the next, and so on). It survives lines being
 * inserted above, and a second copy of a baselined line gets a new fingerprint.
 */
export function fingerprint(ruleId: string, path: string, lineText: string, occurrence: number): string {
  return createHash("sha256").update(`${ruleId}\0${path}\0${normaliseLineText(lineText)}\0${occurrence}`).digest("hex");
}

/**
 * Fingerprints for the findings of one file, in the order toFindings() visits them. Gives exactly
 * what fingerprint() gives, but normalises each line once and hashes its text once per rule, so a
 * file that is one 10 MB line with thousands of findings stays linear (it took 70 s in 0.3.0).
 */
export class FingerprintCounter {
  private readonly normByLine = new Map<number, string>();
  private readonly idOfNorm = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private readonly states = new Map<string, Hash>();
  constructor(
    private readonly path: string,
    private readonly lineText: LineText,
  ) {}

  next(i: Pick<Issue, "rule" | "line" | "fingerprintText">): string {
    let norm: string;
    if (i.fingerprintText !== undefined) norm = normaliseLineText(i.fingerprintText);
    else {
      const cached = this.normByLine.get(i.line);
      norm = cached ?? normaliseLineText(this.lineText(i.line));
      if (cached === undefined) this.normByLine.set(i.line, norm);
    }
    let id = this.idOfNorm.get(norm);
    if (id === undefined) {
      id = this.idOfNorm.size;
      this.idOfNorm.set(norm, id);
    }
    const key = `${i.rule}\0${id}`;
    const occurrence = this.seen.get(key) ?? 0;
    this.seen.set(key, occurrence + 1);
    let state = this.states.get(key);
    if (!state) {
      state = createHash("sha256").update(`${i.rule}\0${this.path}\0`).update(norm).update("\0");
      this.states.set(key, state);
    }
    return state.copy().update(String(occurrence)).digest("hex");
  }
}

/** The text a finding's fingerprint is computed from: its fingerprintText, or the text of its line. */
export function fingerprintTextOf(i: Pick<Issue, "line" | "fingerprintText">, lineText: LineText): string {
  return i.fingerprintText ?? lineText(i.line);
}

/** Sort order for every format: path, then line, then column, then severity, then rule id. */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.line - b.line || a.column - b.column || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0);
}

/** Text of a 1-based line, or "" when unknown. Columns default to the whole line. */
export type LineText = (line: number) => string;

export interface FindingSource {
  result: LintResult;
  /** Path for the finding (root-relative POSIX). */
  path: string;
  lineText: LineText;
}

/**
 * Converts the issues of each linted file to findings with fingerprints. `category` comes from the
 * registry; it is a parameter so this file does not import the registry (the registry imports types from here).
 */
export function toFindings(sources: FindingSource[], category: (ruleId: string) => Category): Finding[] {
  const out: Finding[] = [];
  for (const s of sources) {
    const fp = new FingerprintCounter(s.path, s.lineText);
    const ordered = [...s.result.issues].sort((a, b) => a.line - b.line || (a.column ?? 1) - (b.column ?? 1));
    for (const i of ordered) out.push(issueToFinding(i, s.path, s.lineText(i.line), fp.next(i), category(i.rule)));
  }
  return out.sort(compareFindings);
}

function issueToFinding(i: Issue, path: string, text: string, fingerprint: string, category: Category): Finding {
  const f: Finding = {
    ruleId: i.rule,
    severity: toFindingSeverity(i.severity),
    category,
    path,
    line: i.line,
    column: i.column ?? 1,
    endLine: i.endLine ?? i.line,
    endColumn: i.endColumn ?? text.length + 1,
    message: i.message,
    fingerprint,
  };
  if (i.suppressed) f.suppressed = i.suppressed;
  if (i.fix) f.fix = i.fix;
  return f;
}

export function summarise(files: number, findings: Finding[]): LintSummary {
  const s: LintSummary = { files, errors: 0, warnings: 0, notes: 0, suppressed: 0 };
  for (const f of findings) {
    if (f.suppressed) s.suppressed++;
    else if (f.severity === "error") s.errors++;
    else if (f.severity === "warning") s.warnings++;
    else s.notes++;
  }
  return s;
}

/** The parts of config.ts HiddenSecurity the report shows. */
export interface HiddenCounts {
  off: number;
  lowered: number;
  ignored: number;
  baseline: number;
  offRules: string[];
  loweredRules: string[];
  ignoredFiles: string[];
}

export function buildReport(root: string, files: number, findings: Finding[], hidden?: HiddenCounts): LintReport {
  const summary = summarise(files, findings);
  if (hidden && hidden.off + hidden.lowered + hidden.ignored + hidden.baseline > 0) {
    summary.hiddenSecurity = { config: hidden.off + hidden.lowered + hidden.ignored, baseline: hidden.baseline, rules: [...new Set([...hidden.offRules, ...hidden.loweredRules])].sort(), ignoredFiles: hidden.ignoredFiles };
  }
  return { schemaVersion: 1, tool: { name: "asitis", version: VERSION }, root, summary, findings };
}

/** Opt-in scans a lint call can ask for. */
export type Include = "skills" | "config" | "config-local";
export const INCLUDE_VALUES: readonly Include[] = ["skills", "config", "config-local"];

/** The path a finding reports for a linted markdown file: root-relative, or the given path for extra roots. */
export function findingPath(doc: Doc): string {
  return doc.file.root.extra ? (doc.file.lexical ?? doc.file.real).split(path.sep).join("/") : doc.file.rel;
}
