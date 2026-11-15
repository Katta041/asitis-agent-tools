// Codex CLI: the AGENTS.md chain from the project root down to the start folder.
//
// Codex AGENTS.md guide (DOC.codexAgentsMd, read 15 November 2026) and codex-rs agents_md.rs:
// - the project root is typically the Git root; Codex walks from there down to the working folder
//   and stops there (files below it do not load);
// - one file per folder: AGENTS.override.md, else AGENTS.md, else a configured fallback name;
// - empty files are skipped; files are joined root first;
// - one project_doc_max_bytes budget (32 KiB) for the whole chain: the file that crosses it is cut
//   and later files are dropped.
// Codex has no @imports. ~/.codex/AGENTS.md and memories are user-level and not shown.

import { VENDOR } from "../limits.js";
import { approxTokens } from "../tokens.js";
import type { LoadContext } from "./context.js";
import { chainTo, codexFile, dirOf, gitRootOf, within } from "./files.js";
import { behaviour, DOC } from "./sources.js";
import type { LoadPlan, LoadStep, SkippedFile } from "./types.js";

const TOOL = "codex";
const fmt = (x: number): string => x.toLocaleString("en-US");

export async function planCodex(ctx: LoadContext, cwd: string): Promise<LoadPlan> {
  const { files } = ctx;
  const steps: LoadStep[] = [];
  const skipped: SkippedFile[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const cap = VENDOR.codexAgentsMdBytes;
  const git = await gitRootOf(files, cwd);
  const top = git ?? "";
  if (git === null) notes.push("No .git folder at or above the start folder inside the project, so this assumes Codex treats the project folder as its root. Outside a Git repository Codex reads only the start folder's file.");
  const rootBasis = behaviour(TOOL, git === null ? "root-assumed" : "git-root", git === null ? "assumed" : "documented", DOC.codexAgentsMd);
  let used = 0;
  const inChain = new Set<string>();
  for (const d of chainTo(cwd)) {
    if (!within(d, top)) continue;
    const f = await codexFile(files, d);
    if (!f) continue;
    inChain.add(f.rel);
    if (f.rel.endsWith("AGENTS.override.md") && (await files.hasFile(d, "AGENTS.md"))) {
      const beside = d ? `${d}/AGENTS.md` : "AGENTS.md";
      inChain.add(beside);
      skipped.push({ path: beside, reason: "Codex reads AGENTS.override.md in this folder instead", ...behaviour(TOOL, "override", "documented", DOC.codexAgentsMd) });
    }
    const shown = f.doc?.path ?? f.rel;
    if (!f.doc) {
      skipped.push({ path: shown, reason: "could not be read", basis: "documented", source: DOC.codexAgentsMd });
      continue;
    }
    if (!f.bytes) {
      skipped.push({ path: shown, reason: "empty; Codex skips empty files", ...behaviour(TOOL, "empty", "documented", DOC.codexAgentsMd) });
      continue;
    }
    if (used >= cap) {
      skipped.push({ path: shown, reason: `dropped: the files above it already use ${fmt(used)} of the ${fmt(cap)}-byte (32 KiB) budget`, ...behaviour(TOOL, "chain-budget", "documented", DOC.codexSource) });
      continue;
    }
    const left = cap - used;
    const isRoot = d === "" && f.rel === "AGENTS.md";
    const whole = approxTokens(f.doc.text);
    const over = f.bytes > left;
    const tokens = over ? approxTokens(f.doc.file.buf.subarray(0, left).toString("utf8")) : approxTokens(f.doc.file.buf.subarray(0, cap).toString("utf8"));
    const label = f.rel.endsWith("AGENTS.override.md") ? `${d === "" ? "root " : ""}AGENTS.override.md, read instead of AGENTS.md` : d === "" ? "root AGENTS.md" : `AGENTS.md for ${d}`;
    const note = over ? `${label}, first ${used ? fmt(left) + " bytes" : "32 KiB"}` : label;
    steps.push({
      path: shown,
      kind: "file",
      trigger: "launch",
      when: "at launch",
      tokens,
      ...(over ? { cut: { at: left, unit: "bytes" as const, reason: used ? `the files above it use ${fmt(used)} of the ${fmt(cap)}-byte (32 KiB) budget Codex shares across the chain` : `Codex reads at most ${fmt(cap)} bytes (32 KiB, project_doc_max_bytes) of AGENTS.md in total`, tokensWhole: whole } } : {}),
      scope: d,
      counted: true,
      ...(d === top ? rootBasis : behaviour(TOOL, "chain", "documented", DOC.codexAgentsMd)),
      note,
    });
    if (over) {
      warnings.push(isRoot
        ? `AGENTS.md is ${fmt(f.bytes)} bytes; Codex reads only the first ${fmt(cap)} bytes (32 KiB), a budget shared with any nested AGENTS.md it loads`
        : `${shown} is cut after ${fmt(left)} bytes: the AGENTS.md files above it use ${fmt(used)} of Codex's ${fmt(cap)}-byte (32 KiB) budget`);
    }
    used += Math.min(f.bytes, left);
  }

  // Files Codex does not read from this folder.
  const seenSkip = new Set(skipped.map((s) => s.path));
  for (const rel of ctx.names ?? ctx.docs.map((d) => d.file.rel)) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    if (base !== "AGENTS.md" && base !== "AGENTS.override.md" && base !== "AGENTS.local.md") continue;
    if (inChain.has(rel) || seenSkip.has(rel)) continue;
    const dir = dirOf(rel);
    let reason: string;
    let b = behaviour(TOOL, "below-cwd", "documented", DOC.codexAgentsMd);
    if (base === "AGENTS.local.md") reason = "Codex does not read AGENTS.local.md";
    else if (dir === ".claude" || dir.endsWith("/.claude")) reason = "Codex reads AGENTS.md in each folder, not .claude/AGENTS.md";
    else if (within(dir, cwd) && dir !== cwd) reason = cwd ? `below the start folder (${cwd}); Codex stops at the folder it starts in` : "below the start folder; Codex stops at the folder it starts in";
    else if (within(cwd, dir) && !within(dir, top)) {
      reason = `above ${top}, the Git root where Codex starts its walk`;
      b = behaviour(TOOL, "git-root", "documented", DOC.codexAgentsMd);
    } else if (!within(cwd, dir)) reason = `in ${dir || "the project root"}, which is not on the path from the project root to the start folder`;
    else continue;
    skipped.push({ path: rel, reason, ...b });
  }
  notes.push("~/.codex/AGENTS.md, project_doc_fallback_filenames and a raised project_doc_max_bytes live in your Codex home folder and are not read.");
  notes.push("Codex 0.165 and later can import other agents' memories into its own; those are user-level files and not shown.");
  return { tool: TOOL, cwd, steps, skipped, warnings, notes };
}
