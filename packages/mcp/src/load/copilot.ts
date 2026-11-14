// GitHub Copilot (VS Code and the Copilot agents): repository instructions, scoped instruction
// files, AGENTS.md and CLAUDE.md, for the folder opened as the workspace (the start folder).
//
// Sources, read 15 November 2026:
// - GitHub repository instructions (DOC.githubRepoInstructions): .github/copilot-instructions.md
//   applies to every request in the repository.
// - VS Code custom instructions and reference (DOC.vscodeInstructions, DOC.vscodeInstructionsRef):
//   *.instructions.md in .github/instructions; applyTo takes comma-separated globs relative to the
//   workspace root and attaches the file when the agent works with a matching file; with neither
//   applyTo nor description the file is attached by hand only. AGENTS.md in the workspace root is
//   included when chat.useAgentsMdFile is on; nested AGENTS.md needs chat.useNestedAgentsMdFiles
//   too (experimental). Copilot agents discover AGENTS.md at the root, the working folder, the
//   folders between, and along the paths of files they work with. CLAUDE.md, .claude/CLAUDE.md and
//   CLAUDE.local.md are read when chat.useClaudeMdFile is on.

import { approxTokens } from "../tokens.js";
import type { LoadContext } from "./context.js";
import { chainTo, dirOf, join, scopeOf, within } from "./files.js";
import { patternList } from "./glob.js";
import { countMatches } from "./match.js";
import { behaviour, DOC } from "./sources.js";
import type { LoadPlan, LoadStep, SkippedFile } from "./types.js";

const TOOL = "copilot";

export async function planCopilot(ctx: LoadContext, cwd: string): Promise<LoadPlan> {
  const { files } = ctx;
  const steps: LoadStep[] = [];
  const later: LoadStep[] = [];
  const skipped: SkippedFile[] = [];
  const primary = ctx.docs.filter((d) => d.file.root === ctx.sandbox.primary);

  const repo = await files.docIn(join(cwd, ".github"), "copilot-instructions.md");
  if (repo) steps.push({ path: repo.path, kind: "file", trigger: "launch", when: "at launch", tokens: approxTokens(repo.text), scope: cwd, counted: true, ...behaviour(TOOL, "repo-instructions", "documented", DOC.githubRepoInstructions), note: "repository instructions" });
  for (const rel of ctx.names ?? []) {
    if (!rel.endsWith(".github/copilot-instructions.md") || rel === join(cwd, ".github/copilot-instructions.md")) continue;
    skipped.push({ path: rel, reason: "Copilot reads .github/copilot-instructions.md only at the workspace root", ...behaviour(TOOL, "repo-instructions", "documented", DOC.githubRepoInstructions) });
  }

  // AGENTS.md and CLAUDE.md depend on settings whose defaults we cannot see, so they are not counted.
  for (const d of chainTo(cwd)) {
    const a = await files.docIn(d, "AGENTS.md");
    if (a) steps.push({ path: a.path, kind: "file", trigger: "setting", when: d === cwd ? "at launch when chat.useAgentsMdFile is on (Copilot agents read it by default)" : "at launch in Copilot agents started here (VS Code reads only the workspace root's)", tokens: approxTokens(a.text), scope: d, counted: false, ...behaviour(TOOL, "agents-md", "documented", DOC.vscodeInstructionsRef), note: "AGENTS.md" });
  }
  for (const [dir, name] of [[cwd, "CLAUDE.md"], [join(cwd, ".claude"), "CLAUDE.md"], [cwd, "CLAUDE.local.md"]] as const) {
    const c = await files.docIn(dir, name);
    if (c) steps.push({ path: c.path, kind: "file", trigger: "setting", when: "at launch when chat.useClaudeMdFile is on", tokens: approxTokens(c.text), scope: cwd, counted: false, ...behaviour(TOOL, "claude-md", "documented", DOC.vscodeInstructionsRef), note: "Claude instruction file" });
  }
  for (const d of primary) {
    if (!d.file.rel.endsWith("AGENTS.md") || d.file.rel.includes(".claude/")) continue;
    const dir = dirOf(d.file.rel);
    if (within(cwd, dir)) continue;
    if (within(dir, cwd)) later.push({ path: d.path, kind: "file", trigger: "on-read", when: `when the agent works with a file in ${dir} (VS Code needs chat.useNestedAgentsMdFiles)`, tokens: approxTokens(d.text), scope: dir, counted: false, ...behaviour(TOOL, "agents-nested", "documented", DOC.vscodeInstructionsRef), note: "nested AGENTS.md" });
    else skipped.push({ path: d.path, reason: `in ${dir}, which is not the workspace folder, above it or below it`, ...behaviour(TOOL, "agents-nested", "documented", DOC.vscodeInstructionsRef) });
  }

  const instrDir = join(cwd, ".github/instructions");
  for (const d of primary) {
    if (d.kind.kind !== "copilot-scoped") continue;
    if (!within(dirOf(d.file.rel), instrDir)) {
      skipped.push({ path: d.path, reason: `not in ${instrDir}, the default instructions folder (chat.instructionsFilesLocations can add folders)`, ...behaviour(TOOL, "instructions-location", "documented", DOC.vscodeInstructions) });
      continue;
    }
    const data = d.frontmatter.present ? d.frontmatter.data : null;
    const applyTo = data ? patternList(data["applyTo"]) : [];
    const tokens = approxTokens(d.text);
    if (applyTo.length) {
      const m = countMatches(ctx, applyTo, [cwd, scopeOf(d.file.rel)]);
      later.push({ path: d.path, kind: "file", trigger: "on-match", when: `when the agent works with a file matching ${applyTo.slice(0, 5).join(", ")}${applyTo.length > 5 ? ", ..." : ""}`, patterns: applyTo, matches: m.count, tokens, scope: cwd, counted: false, ...behaviour(TOOL, "applyTo", "documented", DOC.vscodeInstructionsRef), note: "instructions with applyTo" });
      continue;
    }
    const desc = data && typeof data["description"] === "string" && data["description"].trim();
    later.push({ path: d.path, kind: "file", trigger: "on-invoke", when: desc ? "when the agent decides it is relevant from its description" : "only when attached by hand", tokens, scope: cwd, counted: false, ...behaviour(TOOL, desc ? "description" : "manual", "documented", DOC.vscodeInstructionsRef), note: desc ? "instructions picked by description" : "instructions attached by hand" });
  }
  steps.push(...later);
  const notes = ["VS Code settings (chat.useAgentsMdFile, chat.useClaudeMdFile, chat.instructionsFilesLocations), personal instructions and organization instructions are not visible here; files that depend on them are listed but not counted."];
  return { tool: TOOL, cwd, steps, skipped, warnings: [], notes };
}
