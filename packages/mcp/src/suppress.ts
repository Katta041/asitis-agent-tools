// Inline suppression comments. Owner: WP2. docs/cli-contract.md ("Suppression") is the spec.
//
//   <!-- asitis-disable-next-line duplicate-rule -- the two sections are alternatives -->
//   <!-- asitis-disable-file length -- generated reference, read on demand -->
//
// "asitis-disable" on its own means the same as asitis-disable-file. One or more rule ids are
// required (separated by spaces or commas); there is no bare "disable everything". In agnix issue
// 1640 (read 14 October 2026, https://github.com/agent-sh/agnix/issues/1640) any line containing
// agnix-disable silenced every rule in its file. The reason after " -- " is optional and is
// carried into JSON and SARIF as the justification.
//
// Rules whose registry entry has suppressibleInline false (every security rule) are never
// suppressed by a comment: a suppression comment is itself a hidden HTML comment, so an attacker
// could add one next to a payload. The comment is reported as suppression-not-allowed instead,
// and the finding stays. Those rules can be turned off in .asitisrc.json or the baseline only.

import type { Doc } from "./doc.js";
import { didYouMean } from "./config.js";
import { q } from "./escape.js";
import { CAPS } from "./limits.js";
import type { Issue } from "./lint.js";
import { activeRules, getRule } from "./rules/registry.js";
import { InlineCodeSpans } from "./scan.js";

export interface InlineSuppression {
  kind: "next-line" | "file";
  /** The directive as written: asitis-disable-next-line, asitis-disable-file or asitis-disable. */
  directive: string;
  ruleIds: string[];
  justification: string;
  /** 1-based line of the comment (where it opens). */
  line: number;
  /** 1-based line where the comment closes; next-line applies to the line after it. */
  endLine: number;
  /** The word after asitis- is not a directive (asitis-disable-line, for example). */
  unknown?: boolean;
  /** For a directive written with the wrong separator, the directive it was probably meant to be. */
  meant?: string;
}

/** Rules about the comments themselves. A comment cannot suppress these. */
const OWN_RULES = new Set(["suppression-not-allowed", "unknown-suppression", "unused-suppression"]);
const DIRECTIVES: Record<string, InlineSuppression["kind"]> = {
  "asitis-disable-next-line": "next-line",
  "asitis-disable-file": "file",
  "asitis-disable": "file",
};
/** Comments looked at per file. A real file has a handful. */
const MAX_DIRECTIVES = 500;
/** Longest comment body read as a directive. */
const MAX_BODY = 1000;

/** "asitis disable-next-line", "asitis_disable", "asitis  disable file": a directive with the wrong separator, which would otherwise be ignored. */
const NEAR_DIRECTIVE = /^\s*(asitis[\s_]{1,4}disable(?:[\s_-]{1,4}(?:next[\s_-]{0,4}line|file))?)(?![A-Za-z0-9])/i;

/** True when a comment body (between <!-- and -->) is an asitis directive. lint.ts uses it so these comments do not count as hidden comments. */
export function isSuppressionComment(body: string): boolean {
  return /^\s*asitis-disable(?![A-Za-z0-9_])/.test(body);
}

/** A directive or a misspelt one ("asitis disable-next-line"): reported by unknown-suppression, so lint.ts does not count it as a hidden comment too. */
export function looksLikeSuppression(body: string): boolean {
  return isSuppressionComment(body) || NEAR_DIRECTIVE.test(body);
}

/** Finds asitis-disable comments outside code fences, code spans and frontmatter. Linear: forward indexOf only. */
export function parseSuppressions(doc: Doc): InlineSuppression[] {
  const s = doc.text;
  if (!s.includes("asitis-disable") && !/asitis[\s_]{1,4}disable/i.test(s)) return [];
  const lines = doc.lines;
  const spans = new InlineCodeSpans(lines);
  const fmEnd = doc.frontmatter.present ? doc.frontmatter.endLine : -1;
  const out: InlineSuppression[] = [];
  let pos = 0;
  while (out.length < MAX_DIRECTIVES) {
    const open = s.indexOf("<!--", pos);
    if (open < 0) break;
    const close = s.indexOf("-->", open + 4);
    if (close < 0) break; // unclosed-comment is reported by lint.ts; nothing after it is a directive
    pos = close + 3;
    const startLine = lines.lineOf(open);
    if (startLine <= fmEnd || doc.fence[startLine] || spans.inCode(startLine, open)) continue;
    const body = s.slice(open + 4, Math.min(close, open + 4 + MAX_BODY));
    if (!isSuppressionComment(body)) {
      const near = NEAR_DIRECTIVE.exec(body);
      if (near) {
        const written = near[1]!.replace(/\s+/g, " ");
        const words = written.toLowerCase().replace(/[\s_-]+/g, " ");
        const meant = words.includes("next") ? "asitis-disable-next-line" : words.includes("file") ? "asitis-disable-file" : "asitis-disable";
        out.push({ kind: "file", directive: written, ruleIds: [], justification: "", line: startLine + 1, endLine: lines.lineOf(close) + 1, unknown: true, meant });
      }
      continue;
    }
    const m = /^\s*(asitis-disable[A-Za-z0-9_-]*)/.exec(body)!;
    const directive = m[1]!;
    const rest = body.slice(m[0].length);
    // The reason starts at the first "--" that follows whitespace (or comes first).
    const sep = /(^|\s)--(\s|$)/.exec(rest);
    const idPart = sep ? rest.slice(0, sep.index) : rest;
    const justification = sep ? rest.slice(sep.index + sep[0].length).replace(/\s+/g, " ").trim() : "";
    const ruleIds = idPart.split(/[\s,]+/).filter((x) => x !== "");
    const kind = DIRECTIVES[directive];
    const d: InlineSuppression = { kind: kind ?? "file", directive, ruleIds: kind ? ruleIds : [], justification, line: startLine + 1, endLine: lines.lineOf(close) + 1 };
    if (!kind) d.unknown = true;
    out.push(d);
  }
  return out;
}

const known = (): string[] => activeRules().map((r) => r.id);

/**
 * Marks the issues the comments suppress (kind "inSource") and returns issues about the comments
 * themselves: unknown-suppression, suppression-not-allowed and unused-suppression. `isOff` says
 * whether .asitisrc.json turns a rule off for this file; a comment for such a rule is not unused.
 */
export function applyInlineSuppressions(_doc: Doc, issues: Issue[], found: InlineSuppression[], isOff: (ruleId: string) => boolean = () => false): Issue[] {
  const out: Issue[] = [];
  const counts = new Map<string, number>();
  const add = (i: Issue): void => {
    const n = counts.get(i.rule) ?? 0;
    counts.set(i.rule, n + 1);
    if (n < CAPS.maxFindingsPerRule) out.push(i);
  };
  interface Target {
    s: InlineSuppression;
    id: string;
    used: boolean;
  }
  const fileTargets = new Map<string, Target[]>();
  const lineTargets = new Map<string, Target[]>(); // key: rule id + "\0" + the line it covers
  const push = (m: Map<string, Target[]>, key: string, t: Target): void => {
    const list = m.get(key);
    if (list) list.push(t);
    else m.set(key, [t]);
  };
  const targets: Target[] = [];

  for (const s of found) {
    if (s.unknown) {
      const fix = s.meant ? `Write it with hyphens, as ${s.meant}, followed by a rule id` : "Use asitis-disable-next-line or asitis-disable-file followed by a rule id";
      add({ severity: "warning", rule: "unknown-suppression", message: `${q(s.directive, 60)} is not an asitis directive${s.meant ? ` (did you mean ${s.meant}?)` : ""}, so nothing is suppressed. ${fix}`, line: s.line });
      continue;
    }
    if (!s.ruleIds.length) {
      add({ severity: "warning", rule: "unknown-suppression", message: `${s.directive} needs a rule id, as in <!-- ${s.directive} duplicate-rule -- reason -->; there is no way to turn off every rule at once, so nothing is suppressed`, line: s.line });
      continue;
    }
    for (const id of s.ruleIds) {
      const r = getRule(id);
      if (!r || r.status !== "active" || OWN_RULES.has(id)) {
        const near = didYouMean(id, known());
        const what = OWN_RULES.has(id) ? "is about suppression comments and cannot itself be suppressed by one" : "is not an asitis rule";
        add({ severity: "warning", rule: "unknown-suppression", message: `${s.directive} names ${q(id, 60)}, which ${what}${near && !OWN_RULES.has(id) ? ` (did you mean ${q(near, 60)}?)` : ""}, so nothing is suppressed. Fix the rule id or delete the comment`, line: s.line });
        continue;
      }
      if (!r.suppressibleInline) {
        add({ severity: "warning", rule: "suppression-not-allowed", message: `${s.directive} cannot turn off ${id}: it is a security rule, and a hidden comment like this one could sit next to the text it excuses. Turn it off in .asitisrc.json or the baseline instead, where the change shows up in review`, line: s.line });
        continue;
      }
      const t: Target = { s, id, used: false };
      targets.push(t);
      if (s.kind === "file") push(fileTargets, id, t);
      else push(lineTargets, `${id}\0${s.endLine + 1}`, t);
    }
  }
  if (!targets.length) return out;

  for (const i of issues) {
    if (i.suppressed || OWN_RULES.has(i.rule)) continue;
    const t = lineTargets.get(`${i.rule}\0${i.line}`)?.[0] ?? fileTargets.get(i.rule)?.[0];
    if (!t) continue;
    // Every comment that covers the finding counts as used, so a file-level comment next to a
    // next-line comment for the same rule is not reported as unused.
    for (const x of lineTargets.get(`${i.rule}\0${i.line}`) ?? []) x.used = true;
    for (const x of fileTargets.get(i.rule) ?? []) x.used = true;
    i.suppressed = t.s.justification ? { kind: "inSource", justification: t.s.justification } : { kind: "inSource" };
  }
  for (const t of targets) {
    if (t.used || isOff(t.id)) continue;
    const where = t.s.kind === "file" ? "in this file" : `on line ${t.s.endLine + 1}`;
    add({ severity: "info", rule: "unused-suppression", message: `${t.s.directive} ${t.id} suppresses nothing: there is no ${t.id} finding ${where}. Delete the comment, or the rule id in it`, line: t.s.line });
  }
  return out;
}
