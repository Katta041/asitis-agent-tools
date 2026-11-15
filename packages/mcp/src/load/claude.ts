// Claude Code: what loads when a session starts in a folder, and what loads later.
//
// Claude Code memory docs (DOC.claudeMemoryLoad, read 15 November 2026):
// - CLAUDE.md and CLAUDE.local.md in the working folder and every folder above it load at launch,
//   root first; within a folder CLAUDE.local.md comes after CLAUDE.md. .claude/CLAUDE.md counts as a
//   project CLAUDE.md. We cannot see above the --root folder.
// - CLAUDE.md files in subfolders load once Claude reads, writes or edits a file in that subfolder.
// - @imports expand up to four hops, relative to the importing file. Block HTML comments are stripped.
// - .claude/rules/**/*.md without paths load at launch; with paths they load when Claude reads a
//   matching file, patterns relative to the folder that holds .claude. Rules in nested .claude/rules
//   folders load on demand.
// - From v2.1.309 a file that loads on demand (subfolder CLAUDE.md and its imports, nested rules,
//   path-scoped rules) is cut at 40,000 characters on a 200K window (DOC.claudeOnDemandCut). Our
//   canary on 2.1.312 did not see that cut, so we warn instead of cutting.
// - Canary on 2.1.312: @imports in files from folders above the start folder are not expanded
//   (claude-code issue 78697), and @imports in rules are.
// - A file over 4 MiB is skipped (DOC.claudeTooLarge).
// - AGENTS.md (DOC.claudeAgentsMd): read only when no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md
//   sits in the working folder or above; then every AGENTS.md and .claude/AGENTS.md from there up
//   loads at launch, and a subfolder's AGENTS.md when Claude reads a file there and that subfolder
//   has none of the three CLAUDE.md files. AGENTS.override.md, AGENTS.local.md and .agents/ are never read.
// Skills docs (DOC.claudeSkills): .claude/skills in the working folder and every parent load at
// launch (names and descriptions in the listing); nested ones the first time Claude reads or edits a
// file in that folder.

import path from "node:path";
import type { Doc } from "../doc.js";
import { inMemoryFolder } from "../kinds.js";
import { VENDOR } from "../limits.js";
import { importIntent, importTarget } from "../scan.js";
import { approxTokens } from "../tokens.js";
import type { LoadContext } from "./context.js";
import {
  agentListingTokens,
  bodyTokens,
  bringsIn,
  chainTo,
  claudeFilesIn,
  countingFiles,
  dirOf,
  expandImports,
  importsOf,
  join,
  missingImportWarnings,
  scopeOf,
  skillListingTokens,
  stripBlockComments,
  within,
  type ImportHit,
} from "./files.js";
import { patternList } from "./glob.js";
import { countMatches } from "./match.js";
import { behaviour, DOC } from "./sources.js";
import type { Cut, LoadPlan, LoadStep, SkippedFile, Trigger } from "./types.js";

const TOOL = "claude-code";
const fmt = (x: number): string => x.toLocaleString("en-US");
const where = (dir: string): string => dir || "the project root";

/** Where a skill, command or subagent file sits: the folder that holds its .claude, and what it is. */
function claudeItem(rel: string): { holder: string; what: "skill" | "command" | "agent" } | null {
  let m = /^(?:(.*)\/)?\.claude\/skills\/[^/]+\/SKILL\.md$/.exec(rel);
  if (m) return { holder: m[1] ?? "", what: "skill" };
  m = /^(?:(.*)\/)?\.claude\/(commands|agents)\/.+\.md$/i.exec(rel);
  if (m) return { holder: m[1] ?? "", what: m[2]!.toLowerCase() === "agents" ? "agent" : "command" };
  return null;
}

/** Whether Claude Code loads this skill, command or subagent in a session started at the primary root. */
export function claudeCodeLoads(d: Doc): "yes" | "nested" | "no" {
  const it = claudeItem(d.file.rel);
  if (!it) return "no";
  return it.holder === "" ? "yes" : "nested";
}

/**
 * The documented on-demand limit (40,000 characters on a 200K window, from 2.1.309). Canary runs on
 * 2.1.312 (Haiku and Sonnet, 2026-11-14) still saw the end of a 50,000-character subfolder CLAUDE.md,
 * so this is a warning about a documented limit, not a cut we claim happens.
 */
function onDemandLimit(text: string, shown: string): string | null {
  if (text.length <= VENDOR.claudeOnDemandChars) return null;
  return `${shown} is ${fmt(text.length)} characters and loads on demand; Claude Code's docs say such files are cut at ${fmt(VENDOR.claudeOnDemandChars)} characters on a 200K context window (2.1.309 and later), though a canary on 2.1.312 still saw the end. Keep it under ${fmt(VENDOR.claudeOnDemandChars)} characters, or split it into rules`;
}

export async function planClaude(ctx: LoadContext, cwd: string): Promise<LoadPlan> {
  const { sandbox, files, deadline } = ctx;
  const steps: LoadStep[] = [];
  const skipped: SkippedFile[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const chain = chainTo(cwd);
  const atRoot = cwd === "";
  const launchWhen = "at launch";
  const readWhen = (dir: string): string => `when Claude reads or edits a file in ${dir}`;
  const primary = ctx.docs.filter((d) => d.file.root === sandbox.primary);

  const pushImports = (hits: ImportHit[], trigger: Trigger, when: string, scope: string, counted: boolean, onDemand: boolean): void => {
    const b = behaviour(TOOL, "imports", "documented", DOC.claudeImports);
    for (const h of hits) {
      const kind: LoadStep["kind"] = h.overflow ? "overflow" : h.missingFrom || h.tokens === 0 && /not counted/.test(h.note ?? "") ? "missing" : "import";
      const tokens = h.tokens;
      if (onDemand && h.doc) {
        const w = onDemandLimit(stripBlockComments(h.doc), h.path);
        if (w) warnings.push(w);
      }
      steps.push({
        path: h.path,
        kind,
        trigger,
        when,
        ...(h.via ? { via: h.via } : {}),
        ...(h.depth !== undefined ? { depth: h.depth } : {}),
        tokens,
        scope,
        counted,
        ...b,
        ...(h.note ? { note: h.note } : {}),
        ...(h.missingFrom ? { missingFrom: h.missingFrom } : {}),
      });
    }
  };

  // Canary on 2.1.312 (claude-code issue 78697): @imports in a CLAUDE.md, AGENTS.md or rule from a
  // folder above the start folder are not expanded. List each direct import as not loaded.
  const unexpanded = async (d: Doc, dir: string): Promise<void> => {
    for (const im of importsOf(d)) {
      const want = importIntent(im, "claude");
      // Only imports that would load as written: "@guide.md:" or "(@x.md)" load nothing anywhere.
      const read = importTarget(im, "claude");
      if (!want || want.startsWith("~") || read === null || (read !== want && read !== "")) continue;
      const probe = await sandbox.probe(want, path.dirname(d.file.real));
      if (probe.state !== "ok" || !probe.real || seen.has(probe.real)) continue;
      skipped.push({ path: sandbox.display(probe.real), reason: `imported by ${d.path}, but Claude Code does not expand imports in files from ${where(dir)} when it starts in ${where(cwd)}, a folder below it`, ...behaviour(TOOL, "ancestor-imports-not-expanded", "assumed", "https://github.com/anthropics/claude-code/issues/78697") });
    }
  };

  // 1. Instruction files from the root down to the start folder.
  const counting: string[] = [];
  for (const d of chain) counting.push(...(await claudeFilesIn(files, d)));
  const usingClaude = counting.length > 0;
  const instr: Array<{ rel: string; dir: string }> = [];
  if (usingClaude) {
    for (const rel of counting) instr.push({ rel, dir: scopeOf(rel) });
  } else {
    for (const d of chain) {
      for (const name of ["AGENTS.md", ".claude/AGENTS.md"]) if (await files.hasFile(name.includes("/") ? join(d, ".claude") : d, "AGENTS.md")) instr.push({ rel: join(d, name), dir: d });
    }
  }
  for (const it of instr) {
    const d = await files.doc(it.rel);
    if (!d) {
      skipped.push({ path: it.rel, reason: "could not be read", basis: "documented", source: DOC.claudeMemoryLoad });
      continue;
    }
    if (d.file.buf.length > VENDOR.claudeMaxFileBytes) {
      skipped.push({ path: d.path, reason: `over 4 MiB (${fmt(d.file.buf.length)} bytes); Claude Code skips files this large`, basis: "documented", source: DOC.claudeTooLarge });
      seen.add(d.file.real);
      continue;
    }
    if (seen.has(d.file.real)) continue;
    seen.add(d.file.real);
    const t = bodyTokens(d, true);
    const raw = approxTokens(d.text);
    const stripped = raw > t ? `; the file is about ${fmt(raw)} tokens, but Claude Code strips block HTML comments before loading` : "";
    const id = usingClaude ? (it.dir === "" ? "root-claude-md" : "ancestor-claude-md") : it.dir === "" ? "agents-md-fallback" : "ancestor-agents-md";
    const b = behaviour(TOOL, id, "documented", usingClaude ? DOC.claudeMemoryLoad : DOC.claudeAgentsMd);
    const from = it.dir === cwd ? "" : ` (from ${where(it.dir)}, above the start folder)`;
    const note = usingClaude ? `project instructions${from}${stripped}` : `read because there is no CLAUDE.md (Claude Code 2.1.277 and later)${from}${stripped}`;
    steps.push({ path: d.path, kind: "file", trigger: "launch", when: launchWhen, tokens: t, scope: it.dir, counted: true, ...b, note });
    if (d.profile.lines > VENDOR.claudeMdTargetLines) warnings.push(`${d.path} is ${fmt(d.profile.lines)} lines; Claude Code recommends under ${VENDOR.claudeMdTargetLines}`);
    if (it.dir !== cwd) {
      await unexpanded(d, it.dir);
      continue;
    }
    const hits = await expandImports(sandbox, d, seen, 1, deadline);
    pushImports(hits, "launch", launchWhen, it.dir, true, false);
    warnings.push(...missingImportWarnings(hits));
  }
  if (usingClaude) {
    // A CLAUDE.local.md on its own switches the fallback off too; say so instead of "there is a CLAUDE.md".
    const onlyLocal = counting.every((c) => c.endsWith("CLAUDE.local.md"));
    for (const d of chain) {
      const dot = (await files.hasFile(join(d, ".claude"), "AGENTS.md")) ? await files.doc(join(d, ".claude/AGENTS.md")) : null;
      if (dot && !seen.has(dot.file.real)) skipped.push({ path: dot.path, reason: "a CLAUDE.md in the start folder or above switches off the AGENTS.md fallback, and no CLAUDE.md imports it", ...behaviour(TOOL, "agents-md-shadowed", "documented", DOC.claudeAgentsMd) });
      const rel = join(d, "AGENTS.md");
      const agents = (await files.hasFile(d, "AGENTS.md")) ? await files.doc(rel) : null;
      if (!agents || seen.has(agents.file.real)) continue;
      const by = counting.find((c) => scopeOf(c) === d) ?? counting[counting.length - 1];
      const msg = onlyLocal
        ? `Claude Code ignores ${agents.path} here: ${by} switches off the AGENTS.md fallback just as a CLAUDE.md would, and it does not import AGENTS.md. Add the line @AGENTS.md to ${by}, or set Project instructions to claude-md-and-agents-md`
        : d === ""
          ? "Claude Code ignores AGENTS.md here: there is a CLAUDE.md and it does not import AGENTS.md. Add the line @AGENTS.md to CLAUDE.md if both should share instructions"
          : `Claude Code ignores ${agents.path} here: there is a CLAUDE.md in this folder or above and none imports it. Add the line @AGENTS.md to a CLAUDE.md next to it if both should share instructions`;
      warnings.push(msg);
      skipped.push({ path: agents.path, reason: `${by} switches off the AGENTS.md fallback, and ${onlyLocal ? "it does not import AGENTS.md" : "no CLAUDE.md imports it"}`, ...behaviour(TOOL, "agents-md-shadowed", "documented", DOC.claudeAgentsMd) });
    }
  }

  // 2. Rules and the auto memory index, in walk order (as context_budget has always listed them).
  for (const d of ctx.docs) {
    if (d.kind.kind === "claude-rule" && d.file.root === sandbox.primary && !seen.has(d.file.real)) {
      const scope = scopeOf(d.file.rel);
      const data = d.frontmatter.present ? d.frontmatter.data : null;
      const patterns = data ? patternList(data["paths"]) : [];
      const scoped = patterns.length > 0 || d.kind.load === "on-match";
      const onChain = within(cwd, scope);
      const below = !onChain && within(scope, cwd);
      if (!onChain && !below) {
        skipped.push({ path: d.path, reason: `rule for ${where(scope)}, which is not the start folder, above it or below it`, ...behaviour(TOOL, "sibling-rules", "assumed", DOC.claudeRules) });
        continue;
      }
      if (d.file.buf.length > VENDOR.claudeMaxFileBytes) {
        skipped.push({ path: d.path, reason: "over 4 MiB; Claude Code skips files this large", basis: "documented", source: DOC.claudeTooLarge });
        continue;
      }
      if (!scoped && onChain) {
        seen.add(d.file.real);
        const id = scope === "" ? "rules-no-paths-launch" : "ancestor-rules-launch";
        const b = behaviour(TOOL, id, scope === "" ? "documented" : "assumed", DOC.claudeRules);
        steps.push({ path: d.path, kind: "file", trigger: "launch", when: launchWhen, tokens: bodyTokens(d, true), scope, counted: true, ...b, note: "rule without paths, so it loads every session" });
        if (scope !== cwd) {
          await unexpanded(d, scope);
          continue;
        }
        const hits = await expandImports(sandbox, d, seen, 1, deadline);
        pushImports(hits, "launch", launchWhen, scope, true, false);
        warnings.push(...missingImportWarnings(hits));
        continue;
      }
      const limit = onDemandLimit(stripBlockComments(d), d.path);
      if (limit) warnings.push(limit);
      if (!scoped) {
        const b = behaviour(TOOL, "nested-rules-on-read", "documented", DOC.claudeRules);
        steps.push({ path: d.path, kind: "file", trigger: "on-read", when: readWhen(scope), tokens: bodyTokens(d, true), scope, counted: false, ...b, note: "nested rule without paths" });
        seen.add(d.file.real);
        const hits = await expandImports(sandbox, d, seen, 1, deadline);
        pushImports(hits, "on-read", readWhen(scope), scope, false, true);
        warnings.push(...missingImportWarnings(hits));
        continue;
      }
      const m = countMatches(ctx, patterns, scope);
      const b = behaviour(TOOL, "path-rules-on-match", "documented", DOC.claudePathRules);
      const shown = patterns.slice(0, 5).join(", ");
      steps.push({
        path: d.path,
        kind: "file",
        trigger: "on-match",
        when: `when Claude reads or edits a file matching ${shown}${patterns.length > 5 ? ", ..." : ""}${scope ? ` (relative to ${scope})` : ""}`,
        patterns,
        matches: m.count,
        tokens: bodyTokens(d, true),
        scope,
        counted: false,
        ...b,
        note: "rule with paths",
      });
      continue;
    }
    // A MEMORY.md inside the project is linted, but Claude Code loads auto memory only from ~/.claude/projects/<project>/memory/.
    if (d.kind.kind === "memory-index" && inMemoryFolder(d.file.rel, !!d.file.root.extra)) {
      const n = Math.min(d.lines.count, VENDOR.memoryIndexLines);
      const end = n < d.lines.count ? d.lines.start(n) : d.text.length;
      const slice = Buffer.from(d.text.slice(0, end)).subarray(0, VENDOR.memoryIndexBytes).toString("utf8");
      const tokens = approxTokens(slice);
      const whole = approxTokens(d.text);
      const cut: Cut | undefined = tokens < whole ? { at: n < d.lines.count ? VENDOR.memoryIndexLines : VENDOR.memoryIndexBytes, unit: n < d.lines.count ? "lines" : "bytes", reason: "Claude Code loads the first 200 lines or 25 KB of MEMORY.md", tokensWhole: whole } : undefined;
      steps.push({ path: d.path, kind: "file", trigger: "launch", when: launchWhen, tokens, ...(cut ? { cut } : {}), scope: "", counted: true, ...behaviour(TOOL, "memory-index", "documented", DOC.claudeMemory), note: "auto memory index, first 200 lines or 25 KB" });
    }
  }

  // 3. The skill, command and subagent listing.
  let listing = 0;
  let listed = 0;
  let nested = 0;
  let nestedOther = 0;
  let notLoaded = 0;
  const nestedListing = new Map<string, { tokens: number; n: number }>();
  const placeOf = (d: Doc): "yes" | "nested" | "sibling" | "no" => {
    const it = claudeItem(d.file.rel);
    if (!it) return "no";
    if (within(cwd, it.holder)) return "yes";
    if (within(it.holder, cwd)) return "nested";
    return "sibling";
  };
  // A skill reached both through a symlinked .claude/skills and at its real place counts once, as loaded.
  const loadedReal = new Set(ctx.docs.filter((d) => placeOf(d) === "yes").map((d) => d.file.real));
  const counted = new Set<string>();
  for (const d of ctx.docs) {
    const k = d.kind.kind;
    if (k !== "skill" && k !== "claude-command" && k !== "claude-agent") continue;
    const at = placeOf(d);
    if (at === "yes" ? counted.has(d.file.real) : loadedReal.has(d.file.real)) continue;
    counted.add(d.file.real);
    const it = claudeItem(d.file.rel);
    if (at === "nested") {
      if (k === "skill") {
        nested++;
        const t = skillListingTokens(d);
        const g = nestedListing.get(it!.holder) ?? { tokens: 0, n: 0 };
        g.tokens += t;
        g.n++;
        nestedListing.set(it!.holder, g);
      } else {
        nestedOther++;
        skipped.push({ path: d.path, reason: `${it!.what === "agent" ? "subagent" : "command"} in a nested .claude folder (${it!.holder}); Claude Code loads these from the start folder and the folders above it only`, ...behaviour(TOOL, "nested-commands", "assumed", DOC.claudeSkills) });
      }
      continue;
    }
    if (at === "sibling") {
      skipped.push({ path: d.path, reason: `in ${it!.holder}/.claude, which is not the start folder, above it or below it`, ...behaviour(TOOL, "sibling-skills", "documented", DOC.claudeSkills) });
      continue;
    }
    if (at === "no") {
      notLoaded++;
      const rel = d.file.rel;
      const reason = /(^|\/)\.agents\/skills\//.test(rel)
        ? ".agents/skills is a shared skills folder that Copilot and Antigravity read; Claude Code reads skills only from .claude/skills"
        : "SKILL.md outside .claude/skills/ (a plugin, or an Agent Skills repository); Claude Code does not load it from here";
      skipped.push({ path: d.path, reason, ...behaviour(TOOL, /(^|\/)\.agents\/skills\//.test(rel) ? "agents-skills-not-read" : "skill-outside", "documented", /(^|\/)\.agents\/skills\//.test(rel) ? DOC.vscodeSkills : DOC.claudeSkills) });
      continue;
    }
    const t = k === "skill" || k === "claude-command" ? skillListingTokens(d) : agentListingTokens(d);
    if (t > 0) { listing += t; listed++; }
  }
  if (nested) warnings.push(`${nested === 1 ? "1 skill sits" : `${nested} skills sit`} in a nested .claude/skills folder and ${nested === 1 ? "loads" : "load"} only once Claude works in that folder; not counted`);
  if (nestedOther) warnings.push(`${nestedOther === 1 ? "1 command or subagent sits" : `${nestedOther} commands or subagents sit`} in a nested .claude folder; Claude Code does not load ${nestedOther === 1 ? "it" : "them"} in a session started at ${atRoot ? "the project root" : "this folder"}; not counted`);
  if (notLoaded) warnings.push(`${notLoaded === 1 ? "1 SKILL.md is" : `${notLoaded} SKILL.md files are`} outside .claude/skills/, so Claude Code does not load ${notLoaded === 1 ? "it" : "them"} from here (for example a plugin or an Agent Skills repository); not counted`);
  if (listed) {
    const b = behaviour(TOOL, chain.length > 1 ? "ancestor-skills" : "skills-launch", "documented", DOC.claudeSkills);
    steps.push({ path: `Skill listing (${listed} ${listed === 1 ? "entry" : "entries"})`, kind: "listing", trigger: "launch", when: launchWhen, tokens: listing, scope: cwd, counted: true, ...b, note: "names and descriptions of skills, commands and subagents; bodies load on use" });
  }
  for (const [holder, g] of [...nestedListing].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    steps.push({ path: `Skill listing from ${holder}/.claude/skills (${g.n} ${g.n === 1 ? "entry" : "entries"})`, kind: "listing", trigger: "on-read", when: readWhen(holder), tokens: g.tokens, scope: holder, counted: false, ...behaviour(TOOL, "nested-skills-on-read", "documented", DOC.claudeSkills), note: "nested skills join the listing once Claude works in that folder" });
  }

  // 4. Instruction files below the start folder: on demand.
  const belowDirs = new Map<string, Doc[]>();
  for (const d of primary) {
    const base = d.file.rel.slice(d.file.rel.lastIndexOf("/") + 1);
    if (base !== "CLAUDE.md" && base !== "CLAUDE.local.md" && base !== "AGENTS.md") continue;
    const scope = scopeOf(d.file.rel);
    const inDotClaude = dirOf(d.file.rel) !== scope;
    if (base === "CLAUDE.local.md" && inDotClaude) {
      skipped.push({ path: d.path, reason: "Claude Code does not read CLAUDE.local.md inside .claude/; move it next to CLAUDE.md", basis: "documented", source: DOC.claudeMemory });
      continue;
    }
    if (within(cwd, scope)) continue; // in the chain: handled above
    if (!within(scope, cwd)) {
      if (base !== "AGENTS.md" || !seen.has(d.file.real)) skipped.push({ path: d.path, reason: `in ${scope}, which is not the start folder, above it or below it`, ...behaviour(TOOL, "sibling-claude-md", "documented", DOC.claudeMemoryLoad) });
      continue;
    }
    const g = belowDirs.get(scope) ?? [];
    g.push(d);
    belowDirs.set(scope, g);
  }
  const order = (d: Doc): number => {
    const r = d.file.rel;
    return r.endsWith("/.claude/CLAUDE.md") ? 1 : r.endsWith("CLAUDE.local.md") ? 2 : r.endsWith("AGENTS.md") ? 3 : 0;
  };
  for (const scope of [...belowDirs.keys()].sort()) {
    if (deadline?.expired) break;
    const ds = belowDirs.get(scope)!.sort((a, b) => order(a) - order(b));
    const own = ds.some((d) => !d.file.rel.endsWith("AGENTS.md"));
    for (const d of ds) {
      if (seen.has(d.file.real)) continue;
      const isAgents = d.file.rel.endsWith("AGENTS.md");
      if (isAgents && d.file.rel.endsWith(".claude/AGENTS.md") && own) continue;
      if (isAgents) {
        const above = await countingFiles(files, scope);
        if (above.length) {
          let imported = false;
          for (const c of above) if (await bringsIn(files, c, d)) { imported = true; break; }
          if (!imported) skipped.push({ path: d.path, reason: own ? `Claude Code reads the CLAUDE.md in ${scope} instead` : `${above[0]} switches off the AGENTS.md fallback for this folder`, ...behaviour(TOOL, "agents-md-shadowed", "documented", DOC.claudeAgentsMd) });
          continue;
        }
      }
      if (d.file.buf.length > VENDOR.claudeMaxFileBytes) {
        skipped.push({ path: d.path, reason: "over 4 MiB; Claude Code skips files this large", basis: "documented", source: DOC.claudeTooLarge });
        continue;
      }
      seen.add(d.file.real);
      const limit = onDemandLimit(stripBlockComments(d), d.path);
      if (limit) warnings.push(limit);
      const b = behaviour(TOOL, isAgents ? "nested-agents-md-on-read" : "nested-claude-md-on-read", "documented", isAgents ? DOC.claudeAgentsMd : DOC.claudeMemoryLoad);
      steps.push({ path: d.path, kind: "file", trigger: "on-read", when: readWhen(scope), tokens: bodyTokens(d, true), scope, counted: false, ...b, note: isAgents ? "subfolder AGENTS.md, read because that folder has no CLAUDE.md" : "subfolder instructions" });
      const hits = await expandImports(sandbox, d, seen, 1, deadline);
      pushImports(hits, "on-read", readWhen(scope), scope, false, true);
      warnings.push(...missingImportWarnings(hits));
    }
  }

  // 5. Files Claude Code never reads, from the name list (they are not steering files to the walk).
  for (const rel of ctx.names ?? []) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    let reason = "";
    if (base === "AGENTS.override.md") reason = "Claude Code never reads AGENTS.override.md (Codex reads it in place of AGENTS.md)";
    else if (base === "AGENTS.local.md") reason = "Claude Code never reads AGENTS.local.md";
    else if (/(^|\/)\.agents\/rules\/[^/]+\.md$/i.test(rel)) reason = ".agents/rules is Antigravity's rules folder; Claude Code never reads files under .agents/";
    else if (/(^|\/)\.agents\/(?!skills\/)[^/]+\.md$/i.test(rel)) reason = "Claude Code never reads files under .agents/";
    if (reason) skipped.push({ path: rel, reason, ...behaviour(TOOL, "variants-never-read", "documented", /\.agents\/rules/.test(rel) ? DOC.antigravityRules : DOC.claudeAgentsMd) });
  }

  const notes = [
    "Files above the project folder and in your home folder (~/.claude/CLAUDE.md, personal skills, plugins) are not shown.",
    "claudeMdExcludes and the Project instructions setting live in settings files AsItIs does not read; this assumes the defaults.",
  ];
  return { tool: TOOL, cwd, steps, skipped, warnings, notes };
}

/** For tests and the text view: the folder part of a display path. */
export const folderOf = (p: string): string => path.posix.dirname(p);
