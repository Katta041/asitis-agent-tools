// Cursor: project rules, the legacy .cursorrules and AGENTS.md, for the folder opened as the
// workspace (the start folder).
//
// Cursor rules docs (DOC.cursorRules, read 15 November 2026): alwaysApply: true loads in every chat;
// globs attach the rule when a matching file is in context; a description alone lets the agent pull
// it in when relevant; neither means only when @-mentioned. AGENTS.md is supported in the project
// root and subfolders; a nested one applies when working with files in that folder. The Cursor CLI
// changelog (DOC.cursorCliChangelog, undated) says nested AGENTS.md and nested always-apply rules
// apply when the agent edits a file in that folder.

import { approxTokens } from "../tokens.js";
import type { LoadContext } from "./context.js";
import { dirOf, scopeOf, within } from "./files.js";
import { patternList } from "./glob.js";
import { countMatches } from "./match.js";
import { behaviour, DOC } from "./sources.js";
import type { LoadPlan, LoadStep, SkippedFile } from "./types.js";

const TOOL = "cursor";
const truthy = (v: unknown): boolean => v === true || v === "true";

export async function planCursor(ctx: LoadContext, cwd: string): Promise<LoadPlan> {
  const steps: LoadStep[] = [];
  const skipped: SkippedFile[] = [];
  const primary = ctx.docs.filter((d) => d.file.root === ctx.sandbox.primary);
  const rules = primary.filter((d) => d.kind.kind === "cursor-rule" || d.kind.kind === "cursor-legacy");
  const later: LoadStep[] = [];
  for (const d of rules) {
    const scope = d.kind.kind === "cursor-legacy" ? dirOf(d.file.rel) : scopeOf(d.file.rel);
    const tokens = approxTokens(d.text);
    if (!within(scope, cwd)) {
      skipped.push({ path: d.path, reason: within(cwd, scope) ? `rules in ${scope || "the project root"} apply when that folder is the workspace; this assumes Cursor reads rules from the opened folder and below` : `in ${scope}, which is not the opened folder or below it`, ...behaviour(TOOL, "outside-workspace", "assumed", DOC.cursorRules) });
      continue;
    }
    const nested = scope !== cwd;
    if (d.kind.kind === "cursor-legacy") {
      if (nested) {
        skipped.push({ path: d.path, reason: "legacy .cursorrules below the workspace root; Cursor reads it at the root only (it recommends .cursor/rules)", ...behaviour(TOOL, "legacy", "assumed", DOC.cursorRules) });
        continue;
      }
      steps.push({ path: d.path, kind: "file", trigger: "launch", when: "at launch", tokens, scope, counted: true, ...behaviour(TOOL, "legacy", "assumed", DOC.cursorRules), note: "always-applied rule" });
      continue;
    }
    const data = d.frontmatter.present ? d.frontmatter.data : null;
    const globs = data ? patternList(data["globs"]) : [];
    if (data && truthy(data["alwaysApply"])) {
      if (nested) later.push({ path: d.path, kind: "file", trigger: "on-read", when: `when Cursor edits a file in ${scope}`, tokens, scope, counted: false, ...behaviour(TOOL, "nested-always", "documented", DOC.cursorCliChangelog), note: "nested always-applied rule" });
      else steps.push({ path: d.path, kind: "file", trigger: "launch", when: "at launch", tokens, scope, counted: true, ...behaviour(TOOL, "always", "documented", DOC.cursorRules), note: "always-applied rule" });
      continue;
    }
    if (globs.length) {
      const m = countMatches(ctx, globs, [scope, ""]);
      later.push({ path: d.path, kind: "file", trigger: "on-match", when: `when a file matching ${globs.slice(0, 5).join(", ")}${globs.length > 5 ? ", ..." : ""} is in context${scope ? ` (relative to ${scope})` : ""}`, patterns: globs, matches: m.count, tokens, scope, counted: false, ...behaviour(TOOL, "globs", "documented", DOC.cursorRules), note: "rule with globs" });
      continue;
    }
    const desc = data && typeof data["description"] === "string" && data["description"].trim();
    later.push({ path: d.path, kind: "file", trigger: "on-invoke", when: desc ? "when the agent decides it is relevant from its description" : "only when you @-mention it", tokens, scope, counted: false, ...behaviour(TOOL, desc ? "intelligent" : "manual", "documented", DOC.cursorRules), note: desc ? "rule applied by description" : "manual rule" });
  }
  for (const d of primary) {
    if (!d.file.rel.endsWith("AGENTS.md") || d.file.rel.endsWith("/.claude/AGENTS.md") || d.file.rel === ".claude/AGENTS.md") continue;
    const dir = dirOf(d.file.rel);
    const tokens = approxTokens(d.text);
    if (dir === cwd) {
      // Listed, not counted: the docs say AGENTS.md in the root is supported, not that it is always in context.
      steps.push({ path: d.path, kind: "file", trigger: "launch", when: "at launch", tokens, scope: dir, counted: false, ...behaviour(TOOL, "agents-root", "assumed", DOC.cursorRules), note: "AGENTS.md in the workspace root; the docs do not say it is always in context, so it is not in the total" });
    } else if (within(dir, cwd)) {
      later.push({ path: d.path, kind: "file", trigger: "on-read", when: `when Cursor works with files in ${dir}`, tokens, scope: dir, counted: false, ...behaviour(TOOL, "agents-nested", "documented", DOC.cursorRules), note: "nested AGENTS.md" });
    } else {
      skipped.push({ path: d.path, reason: `in ${dir || "the project root"}, outside the opened folder`, ...behaviour(TOOL, "outside-workspace", "assumed", DOC.cursorRules) });
    }
  }
  steps.push(...later);
  const notes = ["User rules, team rules and Cursor's own settings are not visible here. The opened folder is taken as the workspace root."];
  return { tool: TOOL, cwd, steps, skipped, warnings: [], notes };
}
