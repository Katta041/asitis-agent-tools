// Project-level linting, shared by the lint_steering tool and the asitis CLI. Owner: WP0.
// Order: load config, walk or take the given paths, lint each markdown file, cross-file checks,
// the project checks registered in checks/index.ts, then applyConfig (config.ts). Findings for the
// CLI formats are built last, sorted by path, line and severity.

import path from "node:path";
import { PROJECT_CHECKS } from "./checks/index.js";
import { applyConfig, loadConfig, type LoadedConfig } from "./config.js";
import { analyse, type Doc } from "./doc.js";
import { Deadline, walk, type WalkResult } from "./discover.js";
import { dp } from "./escape.js";
import { toFindings, type Finding, type FindingSource, type LineText } from "./findings.js";
import { TOOL_NAME, type Kind } from "./kinds.js";
import { CAPS } from "./limits.js";
import { lintDoc, type Issue, type LintResult } from "./lint.js";
import { UserError, type Sandbox } from "./paths.js";
import { categoryOf } from "./rules/registry.js";
import { extractImports } from "./scan.js";

/** Opt-in scans. config-local also reads .claude/settings.local.json and implies config. */
export type Include = "skills" | "config" | "config-local";
export const INCLUDE_VALUES: readonly Include[] = ["skills", "config", "config-local"];

export interface ProjectOptions {
  /** Files to lint. Empty or missing: every steering file under the root (up to CAPS.lintMaxFiles). */
  targets?: string[];
  include?: readonly Include[];
  deadline: Deadline;
  /** --config: a config file other than <root>/.asitisrc.json. */
  configPath?: string;
  /** --baseline: findings whose fingerprint is in this file are marked suppressed. */
  baselinePath?: string;
  /** Files linted when walking the folder. MCP default CAPS.lintMaxFiles; the CLI passes CAPS.walkMaxFiles. */
  maxFiles?: number;
}

export interface ProjectResult {
  /** One per linted file: markdown files first (in lint order), then files added by project checks. */
  results: LintResult[];
  /** The markdown files, parallel to the first docs.length entries of results. */
  docs: Doc[];
  failures: Array<{ path: string; error: string }>;
  discovered: boolean;
  foundCount: number;
  truncated: boolean;
  timedOut: boolean;
  /** Why the walk stopped early, or "". */
  walkNote: string;
  /** One-line notices for the user (an include value that is not available yet, for example). */
  notes: string[];
  include: ReadonlySet<Include>;
  config: LoadedConfig | null;
  /** Findings for the CLI formats, with fingerprints, sorted. Computed on first call. */
  findings(): Finding[];
}

/** A file a project check reports on that is not a linted markdown file (a script, a JSON config). */
export interface ExtraFile {
  kind: Kind;
  /** Text of a 1-based line, for fingerprints and default columns. */
  lineText?: LineText;
}

export interface CheckContext {
  sandbox: Sandbox;
  docs: readonly Doc[];
  results: readonly LintResult[];
  include: ReadonlySet<Include>;
  deadline: Deadline;
  /** True when the whole folder was walked, false when the caller named files. */
  discovered: boolean;
  /**
   * Targets the caller named that are not markdown (a pre-commit run passes changed scripts).
   * Only set when include is not empty. A check that handles one calls claim(); the rest are
   * reported as not linted.
   */
  otherTargets: readonly string[];
  claim(target: string): void;
  /** Adds a finding to a file. path is the display path (sandbox.display). New files get a result of their own. */
  report(path: string, issue: Issue, file?: ExtraFile): void;
  /** A one-line notice shown after the findings. */
  note(text: string): void;
}

export interface ProjectCheck {
  /** Matches the meta file and the owner track: drift, skills, agent-config. */
  id: string;
  /** Runs only when this include value was given. Undefined: runs on every project lint. */
  include?: Include;
  /** False while the check is a stub. Asking for its include then gives a "not available" notice. */
  ready: boolean;
  run(ctx: CheckContext): Promise<void>;
}

/** Why a folder walk stopped early, in one sentence, or "" when it did not. */
export function walkCutNote(found: Pick<WalkResult, "truncated" | "cut">): string {
  if (!found.truncated) return "";
  const parts: string[] = [];
  if (found.cut.size) parts.push(`the search stopped after ${n(CAPS.walkMaxFiles)} steering files or ${n(CAPS.walkMaxEntries)} folder entries`);
  if (found.cut.time) parts.push("the search stopped at the time limit");
  if (found.cut.depth) parts.push(`folders more than ${CAPS.walkMaxDepth} levels deep were not searched`);
  if (!parts.length) return "";
  const t = parts.join("; ");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

const n = (x: number): string => x.toLocaleString("en-US");

const MARKDOWN_TARGET = /\.(md|mdc|markdown|mdx)$|(^|[\\/])\.(cursorrules|windsurfrules|clinerules)$/i;

export async function lintProject(sandbox: Sandbox, opts: ProjectOptions): Promise<ProjectResult> {
  const { deadline } = opts;
  const config = await loadConfig(sandbox, opts.configPath === undefined ? {} : { configPath: opts.configPath });
  const include = new Set<Include>([...(opts.include ?? []), ...(config?.include ?? [])]);
  if (include.has("config-local")) include.add("config");

  let targets: string[] = [...(opts.targets ?? [])];
  const otherTargets: string[] = [];
  let discovered = false;
  let truncated = false;
  let foundCount = 0;
  let walkNote = "";
  if (!targets.length) {
    const found = await walk(sandbox, { deadline });
    discovered = true;
    foundCount = found.files.length;
    walkNote = walkCutNote(found);
    const maxFiles = opts.maxFiles ?? CAPS.lintMaxFiles;
    truncated = found.truncated || found.files.length > maxFiles;
    targets = found.files.slice(0, maxFiles).map((f) => f.abs);
  } else if (include.size) {
    // With an opt-in scan, non-markdown paths go to the project checks instead of failing here.
    otherTargets.push(...targets.filter((t) => !MARKDOWN_TARGET.test(t)));
    targets = targets.filter((t) => MARKDOWN_TARGET.test(t));
  }
  const single = !discovered && targets.length === 1 && !otherTargets.length;

  let timedOut = false;
  const results: LintResult[] = [];
  const failures: Array<{ path: string; error: string }> = [];
  const docs: Doc[] = [];
  for (const t of targets) {
    if (deadline.expired) {
      truncated = true;
      timedOut = true;
      break;
    }
    try {
      const f = await sandbox.open(t);
      const doc = analyse(f, sandbox.displayFile(f));
      const result = await lintDoc(doc, sandbox);
      docs.push(doc);
      results.push(result);
    } catch (e) {
      if (single) throw e;
      failures.push({ path: sandbox.display(t), error: e instanceof UserError ? e.message : String(e) });
    }
  }
  if (docs.length > 1) crossFileChecks(docs, results);

  // Project checks.
  const notes: string[] = [];
  const lineTexts = new Map<string, LineText>();
  const claimed = new Set<string>();
  const ctx: CheckContext = {
    sandbox,
    docs,
    results,
    include,
    deadline,
    discovered,
    otherTargets,
    claim: (t) => void claimed.add(t),
    report: (p, issue, file) => {
      let r = results.find((x) => x.path === p);
      if (!r) {
        r = { path: p, kind: file?.kind ?? "markdown", load: "other", tokens: 0, issues: [] };
        results.push(r);
        if (file?.lineText) lineTexts.set(p, file.lineText);
      }
      r.issues.push(issue);
    },
    note: (text) => void notes.push(text),
  };
  for (const check of PROJECT_CHECKS) {
    if (check.include && !include.has(check.include)) continue;
    if (!check.ready) {
      if (check.include) notes.push(`include "${check.include}" is not available in this build yet, so nothing extra was scanned.`);
      continue;
    }
    if (deadline.expired) {
      timedOut = true;
      truncated = true;
      break;
    }
    await check.run(ctx);
  }
  for (const t of otherTargets) {
    if (claimed.has(t)) continue;
    try {
      await sandbox.open(t); // gives the same refusal a markdown-only lint gives
    } catch (e) {
      failures.push({ path: sandbox.display(t), error: e instanceof UserError ? e.message : String(e) });
    }
  }

  await applyConfig(config, { sandbox, results, docs, include, lineTexts, ...(opts.baselinePath === undefined ? {} : { baselinePath: opts.baselinePath }) });

  let cached: Finding[] | null = null;
  return {
    results,
    docs,
    failures,
    discovered,
    foundCount,
    truncated,
    timedOut,
    walkNote,
    notes,
    include,
    config,
    findings: () => (cached ??= buildFindings(results, docs, lineTexts)),
  };
}

/** Root-relative POSIX path for a finding; files under a second root keep their absolute path. */
export function findingPath(doc: Doc): string {
  return doc.file.root.extra ? (doc.file.lexical ?? doc.file.real).split(path.sep).join("/") : doc.file.rel;
}

function buildFindings(results: LintResult[], docs: Doc[], lineTexts: Map<string, LineText>): Finding[] {
  const sources: FindingSource[] = results.map((result, i) => {
    const doc = i < docs.length ? docs[i]! : undefined;
    if (doc) {
      const lineText: LineText = (line) => (line >= 1 && line <= doc.lines.count ? doc.lines.line(line - 1) : "");
      return { result, path: findingPath(doc), lineText };
    }
    return { result, path: result.path, lineText: lineTexts.get(result.path) ?? (() => "") };
  });
  return toFindings(sources, categoryOf);
}

/** The tool that loads this file at the start of every session from the project root, or null. */
function sessionTool(d: Doc): string | null {
  if (d.kind.load !== "every-session") return null;
  switch (d.kind.kind) {
    case "claude-md":
    case "claude-rule":
      return "claude-code";
    case "gemini-md":
      return "gemini-cli";
    case "cursor-rule":
    case "cursor-legacy":
      return "cursor";
    case "windsurf-rule":
      return "windsurf";
    case "cline-rule":
      return "cline";
    case "copilot-instructions":
      return "copilot";
    default:
      return null; // AGENTS.md is the only file Codex loads at the root
  }
}

/** Cross-file heuristics when several files are linted together. */
function crossFileChecks(docs: Doc[], results: LintResult[]): void {
  // Same rule line in two files that the same tool loads in the same session. Files of different
  // tools (AGENTS.md for Codex, .windsurfrules for Windsurf) are never paid for together.
  const byRel = new Map(docs.map((d) => [d.file.rel, d]));
  const groups = new Map<Doc, string>();
  for (const d of docs) {
    const t = sessionTool(d);
    if (t) groups.set(d, t);
  }
  // A file a CLAUDE.md @-imports loads with it.
  for (const d of docs) {
    if (groups.get(d) !== "claude-code" || d.kind.kind !== "claude-md") continue;
    const dir = path.posix.dirname(d.file.rel);
    for (const im of extractImports(d.lines, d.fence, d.frontmatter.present ? d.frontmatter.endLine : -1)) {
      const target = byRel.get(path.posix.normalize(path.posix.join(dir === "." ? "" : dir, im.path)));
      if (target && !groups.has(target)) groups.set(target, "claude-code");
    }
  }
  const seenByTool = new Map<string, Map<string, { path: string; line: number }>>();
  docs.forEach((d, idx) => {
    const tool = groups.get(d);
    if (!tool) return;
    const seen = seenByTool.get(tool) ?? new Map<string, { path: string; line: number }>();
    seenByTool.set(tool, seen);
    const start = d.frontmatter.present ? d.frontmatter.endLine + 1 : 0;
    for (let i = start; i < d.lines.count; i++) {
      if (d.fence[i]) continue;
      const len = d.lines.end(i) - d.lines.start(i);
      if (len < 20 || len > 400) continue;
      const norm = d.lines.line(i).toLowerCase().replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();
      if (norm.length < 20 || norm.startsWith("#") || norm.startsWith("|")) continue;
      const prev = seen.get(norm);
      if (prev && prev.path !== d.path) {
        results[idx]!.issues.push({ severity: "warning", rule: "duplicate-across-files", message: `Same rule also in ${dp(prev.path)} line ${prev.line}; ${TOOL_NAME[tool] ?? tool} loads both files every session, so it is paid for twice. Keep it in one file`, line: i + 1 });
      } else if (!prev) seen.set(norm, { path: d.path, line: i + 1 });
    }
  });
  // Memory topic files that no MEMORY.md in the same folder links to never load.
  const indexes = docs.filter((d) => d.kind.kind === "memory-index");
  docs.forEach((d, idx) => {
    if (d.kind.kind !== "memory-topic") return;
    const dir = d.file.real.slice(0, d.file.real.length - d.file.rel.split("/").pop()!.length);
    const base = d.file.rel.split("/").pop()!;
    const idxDoc = indexes.find((m) => m.file.real.startsWith(dir) && m.file.real.slice(dir.length) === "MEMORY.md");
    if (idxDoc && !idxDoc.text.includes(`(${base})`) && !idxDoc.text.includes(`(./${base})`)) {
      results[idx]!.issues.push({ severity: "warning", rule: "orphan-memory", message: `Not linked from ${dp(idxDoc.path)}, so it never loads. Link it from the index or delete it`, line: 1 });
    }
  });
}
