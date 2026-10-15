// Fix suggestions as byte-range edits (F6). Owner: WP7.
// The engine never writes a file. Fixes leave as a unified diff (diff.ts) on stdout or in the
// suggest_fixes tool result, and the user or the agent applies them.
//
// Each fixer (fixes/<rule>.ts) turns one finding into edits and checks its own result (it parses the
// frontmatter again, or scans the line again). This file then drops fixes it cannot show as an exact
// diff (UTF-16 files, NUL bytes, lines with invalid UTF-8), resolves overlaps between fixes in one
// file (safe fixes first, then by line), and renders the result.

import type { Doc } from "./doc.js";
import type { Deadline } from "./discover.js";
import { applyEdits, combineDiffs, DiffUnavailable, sortEdits, unifiedDiff } from "./diff.js";
import { dp as plainPath, esc, UNTRUSTED_NOTE, unsafeCodePoint } from "./escape.js";
import type { FixEdit, FixSafety } from "./findings.js";
import { FIXERS } from "./fixes/index.js";
import type { Issue } from "./lint.js";
import { UserError, type Sandbox } from "./paths.js";
import { findingPath, lintProject, type ProjectResult } from "./project.js";
import { getRule, RULES } from "./rules/registry.js";

export type { FixEdit };

export interface FixSuggestion {
  ruleId: string;
  /** Display path, as in lint results. */
  path: string;
  line: number;
  safety: FixSafety;
  /** What the edits do, in a few words ("remove 1 invisible character (U+200B ZERO WIDTH SPACE)"). "" when edits is empty. */
  what: string;
  edits: FixEdit[];
  /** Why a review fix needs a look, or why no fix is offered (a non-ASCII skill name). */
  note?: string;
}

/** Returns a fix for one issue in one file, or null when this occurrence cannot be fixed safely. */
export type Fixer = (doc: Doc, issue: Issue) => FixSuggestion | null;

export interface SuggestFixesArgs {
  path?: string | undefined;
  paths?: string[] | undefined;
  /** Only fixes for these rule ids. */
  rules?: string[] | undefined;
  /** safe: only safe fixes. all (default): safe and review fixes. */
  safety?: "safe" | "all" | undefined;
}

/** What the suggest_fixes tool returns. server.ts wraps it; WP7 owns the wording. */
export interface SuggestFixesOutput {
  text: string;
  structured: Record<string, unknown>;
}

/** Fixes listed one by one in a tool result; the diff still holds all of them when it fits. */
const MAX_LISTED = 60;
/** Largest diff put into a tool result, in characters. */
const MAX_DIFF_CHARS = 60_000;
/** Longest old or new text shown for one Edit. */
const MAX_PAIR_CHARS = 2_000;
/** Most Edit pairs shown for one fix; a fix with more (trailing spaces on many lines) points to the diff. */
const MAX_PAIRS = 20;

/** The path git apply needs: the real file for a symlink inside the root, null for files under a second root. */
function patchPath(doc: Doc): string | null {
  if (doc.file.root.extra) return null;
  return doc.file.linkTarget ?? findingPath(doc);
}

/** Why a file gets no fixes at all, or null. */
function unfixable(doc: Doc): string | null {
  if (doc.profile.encoding !== "utf-8") return "the file is not UTF-8";
  if (doc.profile.nulBytes > 0) return "the file has NUL bytes";
  return null;
}

interface Found {
  issue: Issue;
  fix: FixSuggestion;
}

/** Every fix and every "no fix" note for the live issues of one file. */
function collect(doc: Doc, issues: readonly Issue[], safety: "safe" | "all", rules?: ReadonlySet<string>): Found[] {
  if (unfixable(doc)) return [];
  const path = patchPath(doc);
  const out: Found[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (issue.suppressed) continue;
    if (rules && !rules.has(issue.rule)) continue;
    // The "More <rule> findings in this file were not listed" line is not a finding of its own.
    if (issue.message.startsWith(`More ${issue.rule} findings`)) continue;
    const fixer = FIXERS[issue.rule];
    if (!fixer) continue;
    let fix: FixSuggestion | null;
    try {
      fix = fixer(doc, issue);
    } catch {
      fix = null; // a fixer that cannot handle an odd file offers nothing rather than failing the lint
    }
    if (!fix) continue;
    if (safety === "safe" && fix.safety !== "safe") continue;
    if (fix.edits.length) {
      if (path === null) fix = { ...fix, what: "", edits: [], note: "No fix: the file is outside the project folder, so a diff could not name it." };
      else {
        try {
          unifiedDiff(path, doc.file.buf, fix.edits);
        } catch (e) {
          if (!(e instanceof DiffUnavailable)) throw e;
          fix = { ...fix, what: "", edits: [], note: `No fix: ${e.message}, so a diff cannot show the change exactly. Fix it by hand.` };
        }
      }
    }
    const key = `${fix.ruleId}\0${fix.line}\0${JSON.stringify(fix.edits)}\0${fix.note ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ issue, fix });
  }
  return out;
}

/** Fixes for the issues of one linted file, including "no fix" entries (empty edits, with a note). */
export function fixesFor(doc: Doc, issues: readonly Issue[], safety: "safe" | "all" = "all"): FixSuggestion[] {
  return collect(doc, issues, safety).map((f) => f.fix);
}

interface FilePlan {
  doc: Doc;
  path: string;
  accepted: FixSuggestion[];
  /** Fixes left out because they overlap an accepted one. */
  conflicts: Array<{ fix: FixSuggestion; with: FixSuggestion }>;
  notFixed: FixSuggestion[];
  edits: FixEdit[];
}

const overlaps = (a: FixEdit, b: FixEdit): boolean =>
  a.startByte === b.startByte && a.endByte === b.endByte && a.replacement === b.replacement
    ? false
    : a.startByte < b.endByte && b.startByte < a.endByte
      ? true
      : a.startByte === b.startByte && (a.startByte === a.endByte || b.startByte === b.endByte);

/** Picks a set of fixes that do not overlap: safe ones first, then by line and rule. */
function planFile(doc: Doc, found: readonly Found[]): FilePlan | null {
  const path = patchPath(doc);
  if (path === null) return null;
  const fixes = found.map((f) => f.fix);
  const notFixed = fixes.filter((f) => !f.edits.length);
  const order = fixes
    .filter((f) => f.edits.length)
    .sort((a, b) => (a.safety === b.safety ? 0 : a.safety === "safe" ? -1 : 1) || a.line - b.line || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  const accepted: FixSuggestion[] = [];
  const conflicts: FilePlan["conflicts"] = [];
  // Accepted edits, sorted by start, each with the fix it came from. Edits of one fix never overlap
  // each other, so each new edit is checked against its neighbours by binary search.
  let taken: Array<{ e: FixEdit; f: FixSuggestion }> = [];
  const clashWith = (e: FixEdit): FixSuggestion | null => {
    let lo = 0;
    let hi = taken.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (taken[mid]!.e.startByte < e.startByte) lo = mid + 1;
      else hi = mid;
    }
    for (let k = Math.max(0, lo - 1); k < taken.length && taken[k]!.e.startByte <= e.endByte; k++) {
      if (overlaps(taken[k]!.e, e)) return taken[k]!.f;
    }
    return null;
  };
  const keys = new Set<string>();
  const keyOf = (e: FixEdit): string => `${e.startByte}:${e.endByte}:${e.replacement}`;
  for (const f of order) {
    let clash: FixSuggestion | null = null;
    for (const e of f.edits) if ((clash = clashWith(e))) break;
    if (clash) { conflicts.push({ fix: f, with: clash }); continue; }
    accepted.push(f);
    const fresh = f.edits.filter((e) => !keys.has(keyOf(e)));
    for (const e of fresh) keys.add(keyOf(e));
    taken = [...taken, ...fresh.map((e) => ({ e, f }))].sort((a, b) => a.e.startByte - b.e.startByte || a.e.endByte - b.e.endByte);
  }
  const edits = taken.map((t) => t.e);
  return { doc, path, accepted, conflicts, notFixed, edits };
}

function plans(project: ProjectResult, safety: "safe" | "all", rules?: ReadonlySet<string>): FilePlan[] {
  const out: FilePlan[] = [];
  project.docs.forEach((doc, i) => {
    const found = collect(doc, project.results[i]!.issues, safety, rules);
    if (!found.length) return;
    const p = planFile(doc, found);
    if (p) out.push(p);
  });
  return out;
}

/**
 * Sets issue.fix on every fixable issue of the project, for JSON and SARIF output. Call it before
 * project.findings(), which is computed once. Each fix carries its own diff, made against the file
 * as it is; --fix-preview's combined diff is the one to apply when several fixes touch one file.
 */
export function attachFixes(project: ProjectResult, safety: "safe" | "all" = "all"): void {
  project.docs.forEach((doc, i) => {
    const path = patchPath(doc);
    if (path === null) return;
    for (const { issue, fix } of collect(doc, project.results[i]!.issues, safety)) {
      if (!fix.edits.length) continue;
      issue.fix = { safety: fix.safety, diff: unifiedDiff(path, doc.file.buf, fix.edits), edits: fix.edits };
    }
  });
}

/** One combined diff for --fix-preview, ready for git apply. "" when there is nothing to fix. */
export function fixPreview(project: ProjectResult, safety: "safe" | "all" = "all"): string {
  return combineDiffs(plans(project, safety).filter((p) => p.edits.length).map((p) => unifiedDiff(p.path, p.doc.file.buf, p.edits)));
}

/** Body of the suggest_fixes MCP tool. */
export async function suggestFixes(sandbox: Sandbox, args: SuggestFixesArgs, deadline: Deadline): Promise<SuggestFixesOutput> {
  const safety = args.safety ?? "all";
  let rules: Set<string> | undefined;
  if (args.rules?.length) {
    const unknown = args.rules.filter((r) => !RULES.has(r));
    if (unknown.length) {
      throw new UserError(`Unknown rule id ${JSON.stringify(esc(unknown[0]!, 100))}. Rules with fixes: ${fixableIds().join(", ")}`);
    }
    rules = new Set(args.rules);
  }
  const targets: string[] = [];
  if (args.path) targets.push(args.path);
  if (args.paths) targets.push(...args.paths);
  const project = await lintProject(sandbox, { targets, deadline });
  const ps = plans(project, safety, rules);
  return render(project, ps, safety, rules);
}

/** Rule ids the registry marks fixable and that have a fixer, for messages. */
export function fixableIds(): string[] {
  return [...RULES.values()].filter((r) => r.status === "active" && r.fixable && FIXERS[r.id]).map((r) => r.id);
}

function render(project: ProjectResult, ps: FilePlan[], safety: "safe" | "all", rules?: ReadonlySet<string>): SuggestFixesOutput {
  const files = project.results.length;
  const fixes = ps.flatMap((p) => p.accepted);
  const safeCount = fixes.filter((f) => f.safety === "safe").length;
  const notFixed = ps.flatMap((p) => [...p.notFixed, ...p.conflicts.map((c) => c.fix)]);
  const fileWord = (n: number): string => `${n.toLocaleString("en-US")} ${n === 1 ? "file" : "files"}`;
  const lines: string[] = [];
  const scope = rules ? ` for ${[...rules].join(", ")}` : "";
  const reviewWord = safety === "safe" ? " (safe fixes only)" : "";
  if (!fixes.length) {
    lines.push(`No fixes to suggest${scope} in ${fileWord(files)} linted${reviewWord}.${notFixed.length ? ` ${notFixed.length} ${notFixed.length === 1 ? "finding has" : "findings have"} no automatic fix; see below.` : " Run lint_steering for findings that need a person to decide."}`);
  } else {
    const fixedFiles = ps.filter((p) => p.accepted.length).length;
    lines.push(
      `${fixes.length} ${fixes.length === 1 ? "fix" : "fixes"}${scope} in ${fileWord(fixedFiles)}: ${safeCount} safe, ${fixes.length - safeCount} to review${reviewWord}. Nothing was changed.`,
    );
  }
  if (fixes.length || notFixed.length) lines.push(UNTRUSTED_NOTE);

  let n = 0;
  const shown = new Map<string, number>();
  const structuredFixes: Array<Record<string, unknown>> = [];
  for (const p of ps) {
    if (!p.accepted.length) continue;
    lines.push("", plainPath(p.doc.path));
    for (const f of p.accepted) {
      n++;
      const editKey = JSON.stringify(f.edits);
      const twin = shown.get(editKey);
      if (twin === undefined) shown.set(editKey, n);
      const pairs = twin === undefined ? editPairs(p.doc, f.edits) : null;
      structuredFixes.push({ ruleId: f.ruleId, path: f.path, line: f.line, safety: f.safety, what: f.what, edits: f.edits, ...(f.note ? { note: f.note } : {}), diff: unifiedDiff(p.path, p.doc.file.buf, f.edits) });
      if (n > MAX_LISTED) continue;
      lines.push(`  ${n}. line ${f.line}, ${f.ruleId} (${f.safety}): ${esc(f.what, 300)}.${f.note ? ` ${esc(f.note, 400)}` : ""}`);
      if (twin !== undefined) lines.push(`     The same edit as fix ${twin}; it fixes both.`);
      else if (pairs) {
        for (const pr of pairs) lines.push(`     old: ${jsonLit(pr.old)}`, `     new: ${jsonLit(pr.new)}`);
      } else lines.push("     This change is too long to show as an Edit; use the diff.");
    }
  }
  if (n > MAX_LISTED) lines.push("", `${n - MAX_LISTED} more fixes are not listed one by one; they are in the diff. Pass rules or paths to see them listed.`);
  if (notFixed.length) {
    lines.push("", "Not fixed:");
    for (const f of notFixed.slice(0, MAX_LISTED)) {
      const conflict = ps.flatMap((p) => p.conflicts).find((c) => c.fix === f);
      const why = conflict ? `overlaps the ${conflict.with.ruleId} fix on line ${conflict.with.line}; run suggest_fixes again after applying that one.` : f.note ?? "";
      lines.push(`  - ${plainPath(f.path)} line ${f.line}, ${f.ruleId}: ${esc(why, 400)}`);
    }
    if (notFixed.length > MAX_LISTED) lines.push(`  - and ${notFixed.length - MAX_LISTED} more`);
  }
  const diff = combineDiffs(ps.filter((p) => p.edits.length).map((p) => unifiedDiff(p.path, p.doc.file.buf, p.edits)));
  if (fixes.length) {
    lines.push(
      "",
      "To apply a fix, make one Edit per old/new pair: old is old_string and new is new_string. They are JSON strings, so \\n, \\r, \\t and \\u escapes stand for the exact characters. Change nothing else in the file. Or save the diff below to a file and run git apply on it.",
    );
    if (diff.length <= MAX_DIFF_CHARS) lines.push("", "Diff:", "```diff", diff.replace(/\n$/, ""), "```");
    else lines.push("", `The diff is ${Math.round(diff.length / 1024).toLocaleString("en-US")} KB, too long for this result. Pass rules or paths for a smaller one, or run asitis lint --fix-preview.`);
  }
  if (project.notes.length) lines.push("", ...project.notes.map((t) => esc(t, 400)));
  for (const f of project.failures) lines.push(`${plainPath(f.path)}: not checked (${esc(f.error, 400)})`);
  return {
    text: lines.join("\n"),
    structured: {
      available: true,
      safety,
      summary: { files, fixes: fixes.length, safe: safeCount, review: fixes.length - safeCount, notFixed: notFixed.length },
      fixes: structuredFixes,
      notFixed: notFixed.map((f) => ({ ruleId: f.ruleId, path: f.path, line: f.line, note: f.note ?? "" })),
      diff,
    },
  };
}

/**
 * Old and new text for Edit calls: the whole lines an edit touches, widened by a line at a time
 * until the old text occurs once in the file. Null when that takes more than MAX_PAIR_CHARS.
 */
function editPairs(doc: Doc, edits: readonly FixEdit[]): Array<{ old: string; new: string }> | null {
  const buf = doc.file.buf;
  const sorted = sortEdits(edits);
  // Group edits on the same or neighbouring lines.
  const groups: FixEdit[][] = [];
  let lastEnd = -1;
  for (const e of sorted) {
    const lineStart = lineStartOf(buf, e.startByte);
    if (groups.length && lineStart <= lastEnd + 1) groups[groups.length - 1]!.push(e);
    else groups.push([e]);
    lastEnd = Math.max(lastEnd, lineEndOf(buf, Math.max(e.endByte, e.startByte)));
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const out: Array<{ old: string; new: string }> = [];
  if (groups.length > MAX_PAIRS) return null;
  for (const g of groups) {
    let from = lineStartOf(buf, g[0]!.startByte);
    if (from === 0 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf && g[0]!.startByte >= 3) from = 3; // keep the BOM out of old_string
    let to = g.reduce((m, e) => Math.max(m, contentEndOf(buf, e.endByte > e.startByte ? e.endByte - 1 : e.startByte, e.endByte)), 0);
    for (let tries = 0; ; tries++) {
      if (to - from > MAX_PAIR_CHARS * 4) return null;
      let old: string;
      let neu: string;
      try {
        old = decoder.decode(buf.subarray(from, to));
        neu = decoder.decode(applyEdits(buf.subarray(from, to), g.map((e) => ({ ...e, startByte: e.startByte - from, endByte: e.endByte - from }))));
      } catch {
        return null;
      }
      if (old.length > MAX_PAIR_CHARS) return null;
      const at = doc.text.indexOf(old);
      if (old && at >= 0 && doc.text.indexOf(old, at + 1) < 0) {
        out.push({ old, new: neu });
        break;
      }
      if (tries >= 4 || (from === 0 && to === buf.length)) return null;
      // Widen by one line on each side.
      if (from > 0) from = lineStartOf(buf, from - 1);
      if (to < buf.length) {
        const next = lineEndOf(buf, to);
        to = next >= buf.length ? buf.length : contentEndOf(buf, next, 0);
      }
    }
  }
  return out;
}

const lineStartOf = (buf: Buffer, pos: number): number => {
  const p = Math.min(pos, buf.length);
  const lf = p > 0 ? buf.lastIndexOf(10, p - 1) : -1;
  return lf + 1;
};
/** Index just after the LF that ends the line holding pos, or the file length. */
const lineEndOf = (buf: Buffer, pos: number): number => {
  const lf = buf.indexOf(10, pos);
  return lf < 0 ? buf.length : lf + 1;
};
/**
 * End of the line content holding `pos` (before CR LF or LF), but never before `atLeast`, so an
 * edit that removes a line break keeps that break inside the old text.
 */
function contentEndOf(buf: Buffer, pos: number, atLeast: number): number {
  const lf = buf.indexOf(10, Math.min(pos, buf.length));
  let end = lf < 0 ? buf.length : lf;
  if (end > 0 && buf[end - 1] === 13 && lf >= 0) end--;
  return Math.max(end, Math.min(atLeast, buf.length));
}

/** A JSON string literal with invisible, bidi and control characters as \u escapes. */
export function jsonLit(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (cp === 10) out += "\\n";
    else if (cp === 13) out += "\\r";
    else if (cp === 9) out += "\\t";
    else if (unsafeCodePoint(cp) || (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) {
      for (let k = 0; k < ch.length; k++) out += `\\u${ch.charCodeAt(k).toString(16).toUpperCase().padStart(4, "0")}`;
    } else out += ch;
  }
  return `${out}"`;
}

/** The safety the registry gives a rule's fix, or false. */
export const registeredSafety = (ruleId: string): false | FixSafety => getRule(ruleId)?.fixable ?? false;
