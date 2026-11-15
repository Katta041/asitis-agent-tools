// Gemini CLI: GEMINI.md from the Git root down to the start folder at launch, and subfolder files
// just in time.
//
// Gemini CLI docs (DOC.geminiMd) and memoryDiscovery.ts (DOC.geminiDiscovery), read 15 November 2026:
// - at launch, GEMINI.md in the workspace folder and each folder above it, stopping at the Git root
//   (the nearest folder with .git; without one, only the workspace folder), root first;
// - just in time: when a tool reads a file, GEMINI.md files from that file's folder up to the Git
//   root that are not loaded yet;
// - @imports (DOC.geminiMemport) up to 5 levels, cycles detected; code spans and blocks are skipped.
// The default context.fileName is GEMINI.md; a setting can add AGENTS.md and others (not read here).

import { VENDOR } from "../limits.js";
import { approxTokens } from "../tokens.js";
import type { LoadContext } from "./context.js";
import { chainTo, dirOf, expandImports, gitRootOf, missingImportWarnings, within, type ImportHit } from "./files.js";
import { behaviour, DOC } from "./sources.js";
import type { LoadPlan, LoadStep, SkippedFile, Trigger } from "./types.js";

const TOOL = "gemini-cli";

export async function planGemini(ctx: LoadContext, cwd: string): Promise<LoadPlan> {
  const { files, sandbox, deadline } = ctx;
  const steps: LoadStep[] = [];
  const skipped: SkippedFile[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const git = await gitRootOf(files, cwd);
  const top = git ?? "";
  if (git === null) notes.push("No .git folder at or above the start folder inside the project, so this assumes Gemini CLI stops at the project folder. Without a Git root it reads only the start folder's GEMINI.md.");
  const seen = new Set<string>();
  const push = (hits: ImportHit[], trigger: Trigger, when: string, scope: string, counted: boolean): void => {
    const b = behaviour(TOOL, "imports", "documented", DOC.geminiMemport);
    for (const h of hits) {
      const kind: LoadStep["kind"] = h.overflow ? "overflow" : h.missingFrom || (h.tokens === 0 && /not counted/.test(h.note ?? "")) ? "missing" : "import";
      steps.push({ path: h.path, kind, trigger, when, ...(h.via ? { via: h.via } : {}), ...(h.depth !== undefined ? { depth: h.depth } : {}), tokens: h.tokens, scope, counted, ...b, ...(h.note ? { note: h.note } : {}), ...(h.missingFrom ? { missingFrom: h.missingFrom } : {}) });
    }
  };
  for (const d of chainTo(cwd)) {
    if (!within(d, top)) continue;
    const doc = await files.docIn(d, "GEMINI.md");
    if (!doc || seen.has(doc.file.real)) continue;
    seen.add(doc.file.real);
    const b = d === top ? behaviour(TOOL, git === null ? "root-assumed" : "launch-chain", git === null ? "assumed" : "documented", DOC.geminiDiscovery) : behaviour(TOOL, "launch-chain", "documented", DOC.geminiDiscovery);
    steps.push({ path: doc.path, kind: "file", trigger: "launch", when: "at launch", tokens: approxTokens(doc.text), scope: d, counted: true, ...b, note: d === "" ? "root GEMINI.md" : `GEMINI.md for ${d}` });
    const hits = await expandImports(sandbox, doc, new Set([...seen]), 1, deadline, VENDOR.geminiImportMaxDepth, "gemini");
    for (const h of hits) if (h.doc) seen.add(h.doc.file.real);
    push(hits, "launch", "at launch", d, true);
    warnings.push(...missingImportWarnings(hits));
  }
  const below = ctx.docs
    .filter((d) => d.file.root === sandbox.primary && d.kind.kind === "gemini-md" && d.file.rel.endsWith("GEMINI.md"))
    .sort((a, b) => (a.file.rel < b.file.rel ? -1 : a.file.rel > b.file.rel ? 1 : 0));
  for (const doc of below) {
    if (seen.has(doc.file.real)) continue;
    const dir = dirOf(doc.file.rel);
    if (dir === ".gemini" || dir.endsWith("/.gemini")) continue; // settings folder, not a context location
    if (within(cwd, dir)) {
      skipped.push({ path: doc.path, reason: `above ${top}, the Git root where Gemini CLI stops looking`, ...behaviour(TOOL, "launch-chain", "documented", DOC.geminiDiscovery) });
      continue;
    }
    if (!within(dir, cwd)) {
      skipped.push({ path: doc.path, reason: `in ${dir}, which is not the start folder, above it or below it`, ...behaviour(TOOL, "jit", "documented", DOC.geminiDiscovery) });
      continue;
    }
    seen.add(doc.file.real);
    const when = `when Gemini CLI reads a file in ${dir}`;
    steps.push({ path: doc.path, kind: "file", trigger: "on-read", when, tokens: approxTokens(doc.text), scope: dir, counted: false, ...behaviour(TOOL, "jit", "documented", DOC.geminiMd), note: "subfolder GEMINI.md, loaded just in time" });
    const hits = await expandImports(sandbox, doc, new Set([...seen]), 1, deadline, VENDOR.geminiImportMaxDepth, "gemini");
    push(hits, "on-read", when, dir, false);
    warnings.push(...missingImportWarnings(hits));
  }
  notes.push("~/.gemini/GEMINI.md and the context.fileName setting (which can make Gemini CLI read AGENTS.md too) are not read; this assumes the default, GEMINI.md only.");
  return { tool: TOOL, cwd, steps, skipped, warnings, notes };
}
