// Monorepo and nested-folder checks (F11), built on the load model's helpers.
//
// - path-rule-matches-nothing: a Claude Code rule with paths, a Cursor rule with globs or a Copilot
//   instructions file with applyTo whose patterns match no file in the project, so it never loads.
//   Only when the whole folder was walked and the walk was not cut short, and only when a pattern
//   names a folder; patterns we cannot read (negations, absolute paths), patterns into folders the
//   walk skips, and extension-only patterns ("**/*.py") keep it silent.
// - nested-duplicate: a subfolder's CLAUDE.md, AGENTS.md or GEMINI.md repeats rules from the same
//   kind of file in a folder above, which the agent already has when it works there.
// - nested-contradiction: the subfolder file says the opposite of the file above. Often an intended
//   override, so a note.
// - sec-nested-override: a subfolder instruction file tells the agent to ignore the instructions
//   above it. That is how a vendored or contributed folder quietly replaces the project's rules.
//
// Vendor behaviour (read 15 November 2026): Claude Code memory docs (subfolder CLAUDE.md files load
// alongside the ones above, not instead; path-specific rules), Codex AGENTS.md guide (files are
// joined root first, later ones override earlier guidance), Gemini CLI GEMINI.md docs, Cursor rules
// docs (globs), VS Code custom instructions reference (applyTo). Sources are in load/sources.ts.

import type { Doc } from "../doc.js";
import { dp, q } from "../escape.js";
import type { Issue } from "../lint.js";
import { inTestTree, notProjectInstructions } from "../places.js";
import type { CheckContext, ProjectCheck } from "../project.js";
import { preview } from "../redact.js";
import { dirOf, FileIndex, importTargets, parentOf } from "../load/files.js";
import { patternList } from "../load/glob.js";
import { countMatches } from "../load/match.js";
import { emitGroup, lineSimilarity, rulesOf, type Pending, type Rules } from "./drift.js";

const fmt = (x: number): string => x.toLocaleString("en-US");
const quote = (text: string): string => q(preview(text, 80), 80);

/** Shared rules a pair needs before nested-duplicate speaks. */
const MIN_SHARED = 2;
/** Shortest normalised rule that counts as a duplicate: "use pnpm" repeated is not worth a note. */
const MIN_RULE_CHARS = 24;

type Family = "CLAUDE.md" | "AGENTS.md" | "GEMINI.md";
const FAMILY_TOOL: Record<Family, string> = { "CLAUDE.md": "Claude Code", "AGENTS.md": "Codex and other AGENTS.md readers", "GEMINI.md": "Gemini CLI" };

interface Member {
  doc: Doc;
  family: Family;
  /** The folder it applies to. */
  scope: string;
}

function memberOf(doc: Doc): Member | null {
  const rel = doc.file.rel;
  const base = rel.slice(rel.lastIndexOf("/") + 1) as Family;
  if (base !== "CLAUDE.md" && base !== "AGENTS.md" && base !== "GEMINI.md") return null;
  let scope = dirOf(rel);
  if (scope === ".claude" || scope.endsWith("/.claude")) {
    if (base !== "CLAUDE.md") return null;
    scope = dirOf(scope);
  }
  return { doc, family: base, scope };
}

/** Whether a pulls b in with an @import (or they are one file through a symlink). */
function imports(a: Doc, b: Doc, files: FileIndex): boolean {
  if (a.file.real === b.file.real) return true;
  for (const t of importTargets(a)) {
    const d = files.byRel.get(t);
    if (d && d.file.real === b.file.real) return true;
  }
  return false;
}

// "ignore the root instructions", "disregard all parent AGENTS.md rules", "forget the instructions
// above". Bounded: every part is a fixed word list with single spaces between, so matching a line is
// linear in its length.
const OVERRIDE =
  /\b(?:ignore|disregard|forget|override|discard)\s+(?:all\s+|any\s+|every\s+)?(?:of\s+)?(?:the\s+)?(?:root|parent|top-level|repo-wide|repository-wide|global|outer|upstream|higher-level|other)(?:\s+level)?\s+(?:project\s+)?(?:instructions?|rules|guidelines|guidance|AGENTS\.md|CLAUDE\.md|GEMINI\.md)(?:\s+files?)?\b|\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:instructions|rules|guidelines)\s+(?:above|in\s+(?:the\s+)?(?:parent|root)\s+(?:folders?|director(?:y|ies)))\b/i;

export function overridePhrase(line: string): string | null {
  if (line.length > 4000) line = line.slice(0, 4000);
  const m = OVERRIDE.exec(line);
  return m ? m[0] : null;
}

/** The 1-based line of a frontmatter key, or 1. */
const keyLine = (d: Doc, key: string): number => d.frontmatter.keyLines[key] ?? 1;

async function pathRules(ctx: CheckContext, files: FileIndex): Promise<void> {
  const w = ctx.walk;
  if (!ctx.discovered || !w || w.cut.size || w.cut.time || w.unreadable.length) return;
  const source = { names: w.names ?? null, walk: w };
  for (const d of ctx.docs) {
    if (ctx.deadline.expired) return;
    if (d.file.root.extra || !d.frontmatter.present || !d.frontmatter.data) continue;
    const rel = d.file.rel;
    // A template or example rule is written for the project it gets copied into.
    if (notProjectInstructions(rel) || inTestTree(rel) || (await files.inSkill(dirOf(rel)))) continue;
    const data = d.frontmatter.data;
    let key: string;
    let tool: string;
    let base: string[];
    const holder = (marker: string): string => {
      const at = rel.lastIndexOf(`${marker}/`);
      return at <= 0 ? "" : rel.slice(0, at - 1);
    };
    if (d.kind.kind === "claude-rule") {
      key = "paths";
      tool = "Claude Code loads this rule only when it reads a matching file, so it never loads";
      // Claude Code memory docs: patterns are relative to the folder that holds .claude.
      base = [holder(".claude")];
    } else if (d.kind.kind === "cursor-rule") {
      if (data["alwaysApply"] === true || data["alwaysApply"] === "true") continue;
      key = "globs";
      tool = "Cursor attaches this rule only when a matching file is in context, so it never attaches by itself";
      // The Cursor docs do not say what a nested rule's globs are relative to: try both readings.
      base = [holder(".cursor"), ""];
    } else if (d.kind.kind === "copilot-scoped") {
      key = "applyTo";
      tool = "Copilot applies these instructions only to matching files, so they never apply";
      // Relative to the workspace root; a nested .github is its own workspace when that folder is opened.
      base = ["", holder(".github")];
    } else continue;
    const patterns = patternList(data[key]);
    if (!patterns.length) continue;
    const m = countMatches(source, patterns, base);
    if (m.count !== 0 || !m.complete || m.unreadable.length) continue;
    // Only patterns that name a place ("src/legacy/**", ".github/workflows/*.yml"). A language pack
    // copied in ("**/*.py" in a repo with no Python) never loads either, but that is harmless, and the
    // real-repo review found nothing worth fixing among them.
    if (!m.compiled.some((g) => g.prefix)) continue;
    const shown = patterns.slice(0, 3).map((p) => q(p, 80)).join(", ");
    ctx.report(d.path, {
      severity: "warning",
      rule: "path-rule-matches-nothing",
      message: `No file in this project matches ${key} ${shown}${patterns.length > 3 ? ` and ${fmt(patterns.length - 3)} more` : ""}${base[0] ? ` (relative to ${dp(base[0])})` : ""}. ${tool}. Fix the pattern or delete the file`,
      line: keyLine(d, key),
      fingerprintText: `${key}: ${patterns.join(",")}`,
    });
  }
}

async function nestedPairs(ctx: CheckContext, files: FileIndex): Promise<void> {
  const members: Member[] = [];
  for (const d of ctx.docs) {
    if (d.file.root.extra) continue;
    if (notProjectInstructions(d.file.rel) || (await files.inSkill(dirOf(d.file.rel)))) continue;
    const m = memberOf(d);
    if (m) members.push(m);
  }
  const byScope = new Map<string, Member[]>();
  for (const m of members) {
    const k = `${m.family}\0${m.scope}`;
    const g = byScope.get(k) ?? [];
    g.push(m);
    byScope.set(k, g);
  }
  const rules = new Map<Doc, Rules>();
  const rulesFor = (d: Doc): Rules => {
    let r = rules.get(d);
    if (!r) rules.set(d, (r = rulesOf(d)));
    return r;
  };
  const dupGroups = new Map<string, Pending[]>();
  const sorted = members.filter((m) => m.scope !== "").sort((a, b) => (a.doc.path < b.doc.path ? -1 : a.doc.path > b.doc.path ? 1 : 0));
  for (const n of sorted) {
    if (ctx.deadline.expired) return;
    // sec-nested-override: words in the nested file that tell the agent to drop the files above.
    for (let li = 0; li < n.doc.lines.count; li++) {
      if (n.doc.fence[li]) continue;
      const hit = overridePhrase(n.doc.lines.line(li));
      if (!hit) continue;
      ctx.report(n.doc.path, {
        severity: "warning",
        rule: "sec-nested-override",
        message: `This subfolder file tells the agent to ${quote(hit)}. ${FAMILY_TOOL[n.family]} loads it on top of the files above it, so anyone who adds a file here can switch off the project's rules for this folder. If an exception is intended, name the rules it replaces instead`,
        line: li + 1,
      });
      break;
    }
    // The nearest folder above with the same kind of file.
    let anc: Member[] | undefined;
    for (let d = parentOf(n.scope); d !== null; d = parentOf(d)) {
      anc = byScope.get(`${n.family}\0${d}`);
      if (anc?.length) break;
    }
    if (!anc?.length) continue;
    const rn = rulesFor(n.doc);
    for (const a of anc) {
      if (imports(n.doc, a.doc, files) || imports(a.doc, n.doc, files)) continue;
      const ra = rulesFor(a.doc);
      // nested-contradiction: "do X" in one, "never X" in the other.
      let said = 0;
      for (const [mine, theirs, mineOpp, theirsOpp] of [
        [rn.pos, ra.neg, rn.neg, ra.pos],
        [rn.neg, ra.pos, rn.pos, ra.neg],
      ] as const) {
        for (const [core, at] of mine) {
          const other = theirs.get(core);
          if (!other || mineOpp.has(core) || theirsOpp.has(core)) continue;
          if (++said > 5) break;
          ctx.report(n.doc.path, {
            severity: "info",
            rule: "nested-contradiction",
            message: `${dp(a.doc.path)} line ${other.line} says ${quote(other.preview)} and this file says ${quote(at.preview)}. ${FAMILY_TOOL[n.family]} loads both when it works in this folder, this one last. If the exception is intended, say so here ("unlike the root file, ..."); otherwise keep one`,
            line: at.line,
          });
        }
      }
      // nested-duplicate: rules repeated from the file above.
      const shared: Array<{ line: number; preview: string }> = [];
      for (const [k, v] of rn.all) if (k.length >= MIN_RULE_CHARS && ra.all.has(k)) shared.push(v);
      if (shared.length < MIN_SHARED) continue;
      const copy = lineSimilarity(n.doc.text, a.doc.text) > 0.9;
      const examples = shared.slice(0, 2).map((s) => `line ${s.line} ${quote(s.preview)}`).join("; ");
      const issue: Issue = {
        severity: "info",
        rule: "nested-duplicate",
        message: copy
          ? `This file is nearly a copy of ${dp(a.doc.path)}, which ${FAMILY_TOOL[n.family]} already loads when it works here, so the shared rules load twice. Keep only what is specific to this folder`
          : `${fmt(shared.length)} rules here repeat ${dp(a.doc.path)} (${examples}${shared.length > 2 ? ` and ${fmt(shared.length - 2)} more` : ""}), which ${FAMILY_TOOL[n.family]} already loads when it works in this folder. Delete the copies here so they cannot drift apart`,
        line: shared[0]!.line,
      };
      const g = dupGroups.get(a.doc.path) ?? [];
      g.push({ path: n.doc.path, issue });
      dupGroups.set(a.doc.path, g);
    }
  }
  for (const [anc, items] of dupGroups) {
    emitGroup(ctx, items, (others) => `This file and ${others} repeat rules from ${dp(anc)}, which the agent already loads when it works in their folders. Delete the copies so they cannot drift apart`);
  }
}

export const NESTED_CHECK: ProjectCheck = {
  id: "nested",
  ready: true,
  run: async (ctx) => {
    const files = new FileIndex(ctx.sandbox, ctx.docs);
    await pathRules(ctx, files);
    await nestedPairs(ctx, files);
  },
};
