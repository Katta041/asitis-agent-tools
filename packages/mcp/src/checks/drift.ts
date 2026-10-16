// Drift and sync checks across AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules and Copilot
// instructions (F7). Owner: WP4. Markdown only: it reads steering files and lists folders, and
// runs on every project lint (no include needed).
//
// Vendor behaviour these rules rest on (all read 14 October 2026):
// - Claude Code memory docs, "AGENTS.md" (https://code.claude.com/docs/en/memory#agents-md):
//   from v2.1.277 Claude Code reads AGENTS.md "only when you have no CLAUDE.md in your working
//   directory or above it". A CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md there counts;
//   ~/.claude/CLAUDE.md, managed CLAUDE.md and .claude/rules/ do not. A CLAUDE.md that imports
//   AGENTS.md, or is symlinked to it, gives Claude the AGENTS.md content. "Not read:
//   AGENTS.local.md, AGENTS.override.md, or anything under a .agents/ directory". The Project
//   instructions value claude-md-and-agents-md makes Claude read both. Rechecked 15 October 2026:
//   memory, "Choose which instruction files load", says to type /config and set Project
//   instructions to claude-md-and-agents-md, so the messages below can point there.
// - claude-code issue 96117: a CLAUDE.local.md alone switches the AGENTS.md fallback off.
// - Codex AGENTS.md guide (https://learn.chatgpt.com/docs/agent-configuration/agents-md) and
//   codex-rs/core/src/agents_md.rs: from the project root down to the working folder, one file per
//   folder (AGENTS.override.md, else AGENTS.md), joined root first, empty files skipped, and one
//   project_doc_max_bytes budget (32 KiB) for the whole chain: the file that crosses it is cut and
//   deeper files are dropped.

import path from "node:path";
import { analyse, type Doc } from "../doc.js";
import { dp, q } from "../escape.js";
import { CAPS, VENDOR } from "../limits.js";
import { forEachRule, type Issue } from "../lint.js";
import type { OpenedFile, Sandbox } from "../paths.js";
import type { CheckContext, ExtraFile, ProjectCheck } from "../project.js";
import { preview } from "../redact.js";
import { extractImports } from "../scan.js";
import { lineOfByte } from "../text.js";
import { notProjectInstructions } from "../places.js";

export interface DriftOptions {
  /**
   * instruction-drift fires only when two mirrored files share at least this share of their rules
   * (Jaccard: shared rules over all distinct rules in either file). Below it the files are taken as
   * unrelated and stay silent.
   */
  jaccard: number;
  /** Shared rules a pair needs before it counts as mirrored at all, so two tiny files never alert. */
  minShared: number;
  /** Rules listed per mirrored pair. */
  maxPerPair: number;
}

export const DRIFT_DEFAULTS: DriftOptions = { jaccard: 0.5, minShared: 3, maxPerPair: 10 };

/** Claude Code follows @imports up to four hops (memory docs, "Import additional files"). */
const MAX_IMPORT_HOPS = 4;
/** Files the check opens beyond the linted ones (ancestor CLAUDE.md files, imports, overrides). */
const MAX_EXTRA_OPENS = 400;

type Tool = "claude" | "agents" | "gemini" | "copilot" | "cursor";

const TOOL_LABEL: Record<Tool, string> = {
  claude: "Claude Code",
  agents: "Codex",
  gemini: "Gemini CLI",
  copilot: "Copilot",
  cursor: "Cursor",
};

interface Member {
  doc: Doc;
  /** Root-relative POSIX folder the file applies to ("" for the root). */
  scope: string;
  tool: Tool;
  /** A whole instruction file (CLAUDE.md, AGENTS.md, GEMINI.md, copilot-instructions, .cursorrules) rather than one rule file of several. */
  full: boolean;
}

interface Rules {
  /** Normalised rule text to its first line and preview. */
  all: Map<string, { line: number; preview: string }>;
  pos: Map<string, { line: number; preview: string }>;
  neg: Map<string, { line: number; preview: string }>;
}

const dirOf = (rel: string): string => {
  const d = path.posix.dirname(rel);
  return d === "." ? "" : d;
};
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const parentOf = (dir: string): string | null => (dir === "" ? null : dirOf(dir));
const fmt = (x: number): string => x.toLocaleString("en-US");
const quote = (text: string): string => q(preview(text, 80), 80);

/** The folder a steering file applies to and the tool that reads it, or null for kinds drift ignores. */
function memberOf(doc: Doc): Member | null {
  const rel = doc.file.rel;
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  let dir = dirOf(rel);
  const inDotClaude = dir === ".claude" || dir.endsWith("/.claude");
  if (inDotClaude) dir = dirOf(dir);
  // CLAUDE.local.md is personal and meant to differ from the shared files; it is left out of
  // contradiction and drift checks. .claude/CLAUDE.local.md is not a location Claude Code reads.
  if (base === "CLAUDE.md") return { doc, scope: dir, tool: "claude", full: true };
  if (base === "AGENTS.md") return { doc, scope: dir, tool: "agents", full: true };
  if (base === "GEMINI.md" && !inDotClaude) return { doc, scope: dir, tool: "gemini", full: true };
  if (rel === ".github/copilot-instructions.md") return { doc, scope: "", tool: "copilot", full: true };
  if (doc.kind.kind === "cursor-legacy" && doc.kind.load === "every-session") return { doc, scope: "", tool: "cursor", full: true };
  // Always-apply Cursor rules and Claude Code rules without paths load every session at the root.
  if (doc.kind.kind === "cursor-rule" && doc.kind.load === "every-session") return { doc, scope: "", tool: "cursor", full: false };
  if (doc.kind.kind === "claude-rule" && doc.kind.load === "every-session") {
    const at = rel.lastIndexOf(".claude/rules/");
    return { doc, scope: at <= 0 ? "" : rel.slice(0, at - 1), tool: "claude", full: false };
  }
  return null;
}

function rulesOf(doc: Doc): Rules {
  const r: Rules = { all: new Map(), pos: new Map(), neg: new Map() };
  forEachRule(doc, (u) => {
    if (!u.rule && !u.pol) return;
    if (!r.all.has(u.norm)) r.all.set(u.norm, { line: u.line, preview: u.preview });
    const p = u.pol;
    if (!p || p.core.length < 4) return;
    const m = p.neg ? r.neg : r.pos;
    if (!m.has(p.core)) m.set(p.core, { line: u.line, preview: u.preview });
  });
  return r;
}

/** Per-call file access: folder listings and opened files, each done once. */
class Files {
  private readonly lists = new Map<string, Map<string, "file" | "dir" | "symlink" | "other"> | null>();
  private readonly opened = new Map<string, Doc | null>();
  private readonly reals = new Map<string, string | null>();
  private extra = 0;
  readonly byRel = new Map<string, Doc>();
  readonly byReal = new Map<string, Doc>();

  constructor(
    private readonly sandbox: Sandbox,
    docs: readonly Doc[],
  ) {
    for (const d of docs) {
      if (d.file.root.extra) continue;
      this.byRel.set(d.file.rel, d);
      this.byReal.set(d.file.real, d);
    }
  }

  private abs(rel: string): string {
    return rel ? path.join(this.sandbox.primary.real, ...rel.split("/")) : this.sandbox.primary.real;
  }

  async list(dir: string): Promise<Map<string, "file" | "dir" | "symlink" | "other"> | null> {
    if (this.lists.has(dir)) return this.lists.get(dir)!;
    let out: Map<string, "file" | "dir" | "symlink" | "other"> | null = null;
    try {
      const l = await this.sandbox.listDir(this.abs(dir));
      out = new Map(l.entries.map((e) => [e.name, e.type]));
    } catch {
      out = null;
    }
    this.lists.set(dir, out);
    return out;
  }

  /** Whether a regular file (or a symlink to one inside the root) with this exact name is in the folder. */
  async hasFile(dir: string, name: string): Promise<boolean> {
    const t = (await this.list(dir))?.get(name);
    if (t === "file") return true;
    if (t !== "symlink") return false;
    return (await this.real(join(dir, name))) !== null;
  }

  /** The real path of a root-relative file, or null when it is missing, outside the root or not a file. */
  async real(rel: string): Promise<string | null> {
    if (this.reals.has(rel)) return this.reals.get(rel)!;
    const known = this.byRel.get(rel);
    let out: string | null = known ? known.file.real : null;
    if (!known) {
      const p = await this.sandbox.probe(this.abs(rel), this.sandbox.primary.real).catch(() => null);
      out = p?.state === "ok" && p.real && p.size !== undefined && !(await this.isDir(rel)) ? p.real : null;
    }
    this.reals.set(rel, out);
    return out;
  }

  private async isDir(rel: string): Promise<boolean> {
    const parent = dirOf(rel);
    const t = (await this.list(parent))?.get(rel.slice(rel.lastIndexOf("/") + 1));
    if (t === "dir") return true;
    if (t !== "symlink") return false;
    return (await this.list(rel)) !== null;
  }

  private readonly skillDirs = new Map<string, boolean>();

  /**
   * Whether a folder is inside a skill (it or a folder above it holds SKILL.md). Files there, such
   * as the AGENTS.md some published skills ship as their reference, are skill material that loads
   * with the skill, not project instructions.
   */
  async inSkill(dir: string): Promise<boolean> {
    const hit = this.skillDirs.get(dir);
    if (hit !== undefined) return hit;
    const parent = parentOf(dir);
    const out = (await this.hasFile(dir, "SKILL.md")) || (parent !== null && (await this.inSkill(parent)));
    this.skillDirs.set(dir, out);
    return out;
  }

  /** The linted doc for a path, or the file opened and parsed here; null when it cannot be read. */
  async doc(rel: string): Promise<Doc | null> {
    const known = this.byRel.get(rel);
    if (known) return known;
    if (this.opened.has(rel)) return this.opened.get(rel)!;
    let out: Doc | null = null;
    if (this.extra < MAX_EXTRA_OPENS) {
      this.extra++;
      try {
        const f: OpenedFile = await this.sandbox.open(this.abs(rel));
        out = analyse(f, this.sandbox.displayFile(f));
      } catch {
        out = null;
      }
    }
    this.opened.set(rel, out);
    return out;
  }
}

/** Root-relative targets of a file's @imports that stay inside the root. */
function importTargets(doc: Doc): string[] {
  const dir = dirOf(doc.file.rel);
  const out: string[] = [];
  for (const im of extractImports(doc.lines, doc.fence, doc.frontmatter.present ? doc.frontmatter.endLine : -1)) {
    const p = im.path;
    if (p.startsWith("~") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) continue;
    const t = path.posix.normalize(join(dir, p));
    if (t === ".." || t.startsWith("../")) continue;
    out.push(t);
  }
  return out;
}

/**
 * Whether a CLAUDE.md gives Claude Code this AGENTS.md: it is the same file (symlink), a copy with
 * the same text (some repos keep two identical files), or imports it within four hops.
 */
async function bringsIn(files: Files, claudeRel: string, agents: Doc): Promise<boolean | null> {
  const agentsReal = agents.file.real;
  const start = await files.real(claudeRel);
  if (start === null) return null;
  if (start === agentsReal) return true;
  let frontier = [claudeRel];
  const seen = new Set<string>([start]);
  for (let hop = 0; hop < MAX_IMPORT_HOPS && frontier.length; hop++) {
    const next: string[] = [];
    for (const rel of frontier) {
      const d = await files.doc(rel);
      if (!d) {
        if (hop === 0) return null; // the CLAUDE.md itself cannot be read: do not guess
        continue;
      }
      if (hop === 0 && d.text.trim() === agents.text.trim()) return true;
      for (const t of importTargets(d)) {
        const real = await files.real(t);
        if (real === null || seen.has(real)) continue;
        if (real === agentsReal) return true;
        seen.add(real);
        if (/\.md$/i.test(t)) next.push(t);
      }
    }
    frontier = next;
  }
  return false;
}

/** Files that switch off Claude Code's AGENTS.md fallback, from this folder up to the root, nearest first. */
async function countingFiles(files: Files, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (let d: string | null = dir; d !== null; d = parentOf(d)) {
    for (const name of ["CLAUDE.md", "CLAUDE.local.md"]) if (await files.hasFile(d, name)) out.push(join(d, name));
    const dotClaude = (await files.list(d))?.get(".claude");
    if ((dotClaude === "dir" || dotClaude === "symlink") && (await files.hasFile(join(d, ".claude"), "CLAUDE.md"))) out.push(join(d, ".claude/CLAUDE.md"));
  }
  return out;
}

/**
 * One cause often hits many files at once (a root CLAUDE.md shadowing 60 nested AGENTS.md files, or
 * a long root AGENTS.md cutting every package file). Up to GROUP_MAX files of a group get a
 * finding each; a larger group gets one finding, on the first file, that names the others.
 */
const GROUP_MAX = 3;

interface Pending {
  path: string;
  issue: Issue;
  extra?: ExtraFile;
}

function emitGroup(ctx: CheckContext, items: Pending[], groupMessage: (others: string) => string): void {
  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (items.length <= GROUP_MAX) {
    for (const it of items) ctx.report(it.path, it.issue, it.extra);
    return;
  }
  const rest = items.slice(1);
  const shown = rest.slice(0, 2).map((x) => dp(x.path)).join(", ");
  const others = `${fmt(rest.length)} more (${shown}${rest.length > 2 ? ` and ${fmt(rest.length - 2)} ${rest.length - 2 === 1 ? "other" : "others"}` : ""})`;
  const first = items[0]!;
  ctx.report(first.path, { ...first.issue, message: groupMessage(others) }, first.extra);
}

/**
 * Share of lines two files have in common (as a multiset, blank lines ignored), from 0 to 1. Linear
 * in the size of both files.
 */
export function lineSimilarity(a: string, b: string): number {
  const count = (t: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const raw of t.split("\n")) {
      const l = raw.trim();
      if (l) m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  let shared = 0;
  let total = 0;
  for (const [l, n] of ma) {
    shared += Math.min(n, mb.get(l) ?? 0);
    total += n;
  }
  for (const n of mb.values()) total += n;
  return total === 0 ? 1 : (2 * shared) / total;
}

/**
 * Above this line similarity a CLAUDE.md is a near-copy of the AGENTS.md beside it: Claude already
 * gets that content, so "add @AGENTS.md" would load it twice. The 0.3.0 real-repo review found five
 * such pairs, all above 0.95.
 */
const NEAR_COPY = 0.9;

/** What checkShadowed found, for checkPairs: pairs it reported and near-copies it left to the drift check. */
interface ShadowResult {
  /** "agentsRel\0claudeRel" of every pair agents-md-shadowed reported. */
  shadowed: Set<string>;
  /** Same keys, for a CLAUDE.md that is a near-copy of the AGENTS.md beside it. */
  nearCopies: Set<string>;
}

async function checkShadowed(ctx: CheckContext, files: Files, agentsDocs: Doc[]): Promise<ShadowResult> {
  const result: ShadowResult = { shadowed: new Set(), nearCopies: new Set() };
  // Nested AGENTS.md files with no CLAUDE.md of their own, by the CLAUDE.md above that shadows them.
  const nested = new Map<string, Pending[]>();
  for (const doc of agentsDocs) {
    if (ctx.deadline.expired) return result;
    let dir = dirOf(doc.file.rel);
    if (dir === ".claude" || dir.endsWith("/.claude")) dir = dirOf(dir);
    const counting = await countingFiles(files, dir);
    if (!counting.length) continue; // Claude Code reads this AGENTS.md itself
    let unknown = false;
    let covered = false;
    for (const c of counting) {
      const b = await bringsIn(files, c, doc);
      if (b === null) unknown = true;
      if (b) { covered = true; break; }
    }
    if (covered || unknown) continue;
    const onlyLocal = counting.every((c) => c.endsWith("CLAUDE.local.md"));
    const nearest = counting[0]!;
    let nearestDir = dirOf(nearest);
    if (nearestDir === ".claude" || nearestDir.endsWith("/.claude")) nearestDir = dirOf(nearestDir);
    const importLine = `@${path.posix.relative(dirOf(nearest) || ".", doc.file.rel)}`;
    // A CLAUDE.md higher up loads every session; for a nested AGENTS.md the match is a CLAUDE.md
    // in its own folder, which Claude Code loads when it works there.
    const nearestDoc = await files.doc(nearest);
    // A CLAUDE.md that is a near-copy of this AGENTS.md already gives Claude its content; the
    // problem there is the two copies drifting, which checkPairs reports with the right advice.
    if (nearestDir === dir && nearestDoc && !onlyLocal && lineSimilarity(doc.text, nearestDoc.text) > NEAR_COPY) {
      result.nearCopies.add(`${doc.file.rel}\0${nearest}`);
      continue;
    }
    result.shadowed.add(`${doc.file.rel}\0${nearest}`);
    // Claude Code memory docs: a CLAUDE.md that tells Claude in words to read AGENTS.md only works if Claude decides to open it.
    const prose = nearestDir === dir && !!nearestDoc && /\b(?:read|follow|see|refer to|consult|check)\b[^.\n]{0,40}AGENTS\.md/i.test(nearestDoc.text) ? " (mentioning AGENTS.md in a sentence does not load it)" : "";
    const fix = nearestDir === dir ? `Add the line ${importLine} to ${dp(nearest)}${prose}` : `Add a CLAUDE.md next to it with the line @AGENTS.md`;
    const issue: Issue = onlyLocal
      ? {
          severity: "warning",
          rule: "claude-local-hides-agents-md",
          message: `${dp(nearest)} switches off Claude Code's AGENTS.md fallback, so Claude Code skips this AGENTS.md for whoever has that file. ${fix}, or set Project instructions to claude-md-and-agents-md in /config`,
          line: 1,
        }
      : {
          severity: "warning",
          rule: "agents-md-shadowed",
          message: `Claude Code skips this AGENTS.md because ${dp(nearest)} exists, and a CLAUDE.md in this folder or above switches off its AGENTS.md fallback. ${fix}, or set Project instructions to claude-md-and-agents-md in /config`,
          line: 1,
        };
    if (nearestDir === dir) {
      ctx.report(doc.path, issue);
      continue;
    }
    const key = `${issue.rule}\0${nearest}`;
    const g = nested.get(key) ?? [];
    g.push({ path: doc.path, issue });
    nested.set(key, g);
  }
  for (const [key, items] of nested) {
    const nearest = key.slice(key.indexOf("\0") + 1);
    const local = key.startsWith("claude-local-hides-agents-md");
    emitGroup(ctx, items, (others) =>
      local
        ? `${dp(nearest)} switches off Claude Code's AGENTS.md fallback, so Claude Code skips this AGENTS.md and ${others} in subfolders for whoever has that file. Add a CLAUDE.md with the line @AGENTS.md next to each, or set Project instructions to claude-md-and-agents-md in /config`
        : `Claude Code skips this AGENTS.md and ${others} in subfolders, because ${dp(nearest)} exists and a CLAUDE.md above them switches off its AGENTS.md fallback. Add a CLAUDE.md with the line @AGENTS.md next to each, or set Project instructions to claude-md-and-agents-md in /config`,
    );
  }
  return result;
}

interface Variant {
  rel: string;
  name: string;
}

async function checkVariants(ctx: CheckContext, files: Files, dirs: Iterable<string>, docs: readonly Doc[], variantDocs: Doc[]): Promise<void> {
  const found = new Map<string, Variant>();
  for (const d of variantDocs) found.set(d.file.rel, { rel: d.file.rel, name: d.file.rel.slice(d.file.rel.lastIndexOf("/") + 1) });
  if (ctx.discovered) {
    for (const dir of dirs) {
      if (ctx.deadline.expired) return;
      const l = await files.list(dir);
      if (!l) continue;
      for (const name of ["AGENTS.override.md", "AGENTS.local.md"]) if (await files.hasFile(dir, name)) found.set(join(dir, name), { rel: join(dir, name), name });
      const dotAgents = l.get(".agents");
      if (dotAgents === "dir" || dotAgents === "symlink") {
        const inner = await files.list(join(dir, ".agents"));
        for (const [name, type] of inner ?? []) {
          if ((type === "file" || type === "symlink") && /\.md$/i.test(name)) found.set(join(dir, `.agents/${name}`), { rel: join(dir, `.agents/${name}`), name: `.agents/${name}` });
        }
      }
    }
  }
  // A variant that a steering file links to or imports is reference material on purpose.
  const mentioned = (needle: string): boolean => docs.some((d) => d.text.includes(needle));
  for (const v of [...found.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const dir = dirOf(v.rel);
    let message: string;
    if (v.name === "AGENTS.override.md") {
      if (docs.some((d) => d.kind.kind === "claude-md" && d.text.includes("@") && d.text.includes("AGENTS.override.md"))) continue;
      const beside = await files.hasFile(dir, "AGENTS.md");
      message = beside
        ? "Codex reads this file instead of the AGENTS.md beside it, and Claude Code never reads AGENTS.override.md, so the two agents follow different instructions in this folder. Merge it into AGENTS.md if both should see it"
        : "Only Codex reads AGENTS.override.md; Claude Code never reads it. Rename it to AGENTS.md if every agent should see these instructions";
    } else if (v.name === "AGENTS.local.md") {
      if (mentioned("AGENTS.local.md")) continue;
      message = "Neither Claude Code nor Codex reads AGENTS.local.md, so these instructions reach no agent unless a loaded file imports them";
    } else {
      if (mentioned(v.name) || mentioned(v.rel)) continue;
      message = `Claude Code never reads files under .agents/ as instructions, and Codex reads only AGENTS.md or AGENTS.override.md in each folder, so this file loads only if a loaded file links to it`;
    }
    const d = await files.doc(v.rel);
    const p = d ? d.path : v.rel;
    const issue: Issue = { severity: "info", rule: "agents-md-unread-variant", message, line: 1 };
    if (d && files.byRel.has(v.rel)) ctx.report(p, issue);
    else ctx.report(p, issue, { kind: "agents-override", lineText: (n) => (d && n >= 1 && n <= d.lines.count ? d.lines.line(n - 1) : "") });
  }
}

/** Bytes Codex takes from the file it reads in this folder, which file, or null when there is none. */
async function codexFile(files: Files, dir: string): Promise<{ rel: string; bytes: number; doc: Doc | null } | null> {
  for (const name of ["AGENTS.override.md", "AGENTS.md"]) {
    if (!(await files.hasFile(dir, name))) continue;
    const d = await files.doc(join(dir, name));
    // Codex picks the first name that exists, then skips it if it is empty (agents_md.rs).
    if (!d) return null;
    return { rel: join(dir, name), bytes: d.text.trim() ? d.file.buf.length : 0, doc: d };
  }
  return null;
}

async function checkCodexChain(ctx: CheckContext, files: Files, agentsDocs: Doc[]): Promise<void> {
  const budget = VENDOR.codexAgentsMdBytes;
  const chainCache = new Map<string, Array<{ rel: string; bytes: number }>>();
  // Codex files from the root down to (but not including) this folder.
  const above = async (dir: string): Promise<Array<{ rel: string; bytes: number }>> => {
    const hit = chainCache.get(dir);
    if (hit) return hit;
    const parent = parentOf(dir);
    let out: Array<{ rel: string; bytes: number }> = [];
    if (parent !== null) {
      const up = await above(parent);
      const here = await codexFile(files, parent);
      out = here && here.bytes ? [...up, { rel: here.rel, bytes: here.bytes }] : up;
    }
    chainCache.set(dir, out);
    return out;
  };
  const seen = new Set<string>();
  // Files cut or dropped for the same reason: the same files above them.
  const groups = new Map<string, { names: string; used: number; dropped: boolean; items: Pending[] }>();
  for (const doc of agentsDocs) {
    if (ctx.deadline.expired) break;
    const dir = dirOf(doc.file.rel);
    if (dir === ".claude" || dir.endsWith("/.claude")) continue; // not a Codex location
    const mine = await codexFile(files, dir);
    if (!mine || !mine.doc || !mine.bytes || seen.has(mine.rel)) continue;
    seen.add(mine.rel);
    const chain = await above(dir);
    const used = chain.reduce((s, x) => s + x.bytes, 0);
    if (used === 0 || used + mine.bytes <= budget) continue;
    const names = chain.length <= 3 ? chain.map((x) => x.rel).join(", ") : `${chain.slice(0, 2).map((x) => x.rel).join(", ")} and ${chain.length - 2} more`;
    const issue: Issue =
      used >= budget
        ? {
            severity: "warning",
            rule: "codex-chain-over-budget",
            message: `Codex never reads this file when started in this folder or below: the AGENTS.md files above it (${names}) already use ${fmt(used)} bytes of its ${fmt(budget)}-byte (32 KiB) budget, which is shared from the project root down. Shorten those files or raise project_doc_max_bytes`,
            line: 1,
          }
        : {
            severity: "warning",
            rule: "codex-chain-over-budget",
            message: `Codex cuts this file at this line when started in this folder or below: the AGENTS.md files above it (${names}) use ${fmt(used)} of its ${fmt(budget)}-byte (32 KiB) budget, which is shared from the project root down, and this file adds ${fmt(mine.bytes)}. Shorten the chain or raise project_doc_max_bytes`,
            line: lineOfByte(mine.doc.file.buf, budget - used),
          };
    // The line moves with CRLF and with any edit above the cut, so the baseline fingerprint hashes
    // the chain of files instead (path and rule id are hashed anyway).
    issue.fingerprintText = `codex chain: ${chain.map((x) => x.rel).join(" > ")}`;
    const d = mine.doc;
    const extra: ExtraFile | undefined = files.byRel.has(mine.rel) ? undefined : { kind: "agents-override", lineText: (n) => (n >= 1 && n <= d.lines.count ? d.lines.line(n - 1) : "") };
    const key = `${used >= budget ? "dropped" : "cut"}\0${chain.map((x) => x.rel).join("\0")}`;
    const g = groups.get(key) ?? { names, used, dropped: used >= budget, items: [] };
    g.items.push({ path: d.path, issue, ...(extra ? { extra } : {}) });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    emitGroup(ctx, g.items, (others) =>
      g.dropped
        ? `Codex never reads this file or ${others} when started in their folders: the AGENTS.md files above them (${g.names}) already use ${fmt(g.used)} bytes of its ${fmt(budget)}-byte (32 KiB) budget, which is shared from the project root down. Shorten those files or raise project_doc_max_bytes`
        : `Codex cuts this file at this line, and also cuts ${others}, when started in their folders: the AGENTS.md files above them (${g.names}) use ${fmt(g.used)} of its ${fmt(budget)}-byte (32 KiB) budget, which is shared from the project root down. Shorten those files or raise project_doc_max_bytes`,
    );
  }
}

/** Whether a's file pulls b's in through an @import (directly or by symlink); then b's rules are part of a on purpose. */
function imports(a: Doc, b: Doc, files: Files): boolean {
  if (a.file.real === b.file.real) return true;
  if (a.kind.kind !== "claude-md" && a.kind.kind !== "gemini-md") return false;
  for (const t of importTargets(a)) {
    const d = files.byRel.get(t);
    if (d && d.file.real === b.file.real) return true;
  }
  return false;
}

function checkPairs(ctx: CheckContext, files: Files, members: Member[], opts: DriftOptions, shadow: ShadowResult): void {
  const groups = new Map<string, Member[]>();
  for (const m of members) {
    const g = groups.get(m.scope) ?? [];
    g.push(m);
    groups.set(m.scope, g);
  }
  const rules = new Map<Doc, Rules>();
  const rulesFor = (d: Doc): Rules => {
    let r = rules.get(d);
    if (!r) {
      r = rulesOf(d);
      rules.set(d, r);
    }
    return r;
  };
  const counts = new Map<string, number>();
  const room = (p: string, rule: string): boolean => {
    const k = `${rule}\0${p}`;
    const n = counts.get(k) ?? 0;
    counts.set(k, n + 1);
    return n < CAPS.maxFindingsPerRule;
  };

  for (const scope of [...groups.keys()].sort()) {
    const g = groups.get(scope)!.sort((a, b) => (a.doc.path < b.doc.path ? -1 : a.doc.path > b.doc.path ? 1 : 0));
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (ctx.deadline.expired) return;
        const A = g[i]!;
        const B = g[j]!;
        if (A.doc.file.real === B.doc.file.real) continue; // one file reached through a symlink
        const sameTool = A.tool === B.tool;
        const mirrored = !sameTool && A.full && B.full;
        const mirrorSet = (m: Member): boolean => m.full || m.tool === "cursor";
        if (!sameTool && !(mirrorSet(A) && mirrorSet(B))) continue;
        const ra = rulesFor(A.doc);
        const rb = rulesFor(B.doc);

        // cross-file-contradiction: "do X" in one file, "do not X" in the other.
        const sides: Array<{ mine: Rules["pos"]; theirs: Rules["pos"]; mineOpp: Rules["pos"]; theirsOpp: Rules["pos"] }> = [
          { mine: rb.pos, theirs: ra.neg, mineOpp: rb.neg, theirsOpp: ra.pos },
          { mine: rb.neg, theirs: ra.pos, mineOpp: rb.pos, theirsOpp: ra.neg },
        ];
        for (const side of sides) {
          for (const [core, at] of side.mine) {
            const other = side.theirs.get(core);
            if (!other) continue;
            // A file that already says both is reported by the per-file contradiction rule.
            if (side.mineOpp.has(core) || side.theirsOpp.has(core)) continue;
            if (!room(B.doc.path, "cross-file-contradiction")) continue;
            const who = sameTool ? `${TOOL_LABEL[A.tool]} loads both files, so it gets both instructions` : "Agents that read one file will follow a different rule from agents that read the other";
            ctx.report(B.doc.path, {
              severity: "warning",
              rule: "cross-file-contradiction",
              message: `Contradicts ${dp(A.doc.path)} line ${other.line}: that file says ${quote(other.preview)} and this one says ${quote(at.preview)}. ${who}; keep the one you mean in both`,
              line: at.line,
            });
          }
        }

        // instruction-drift: mirrored files that share most rules but not all. Not for a pair that
        // agents-md-shadowed already reported: Claude never reads that AGENTS.md, which is the
        // bigger problem, and its fix (import AGENTS.md) ends the drift too.
        if (!mirrored || imports(A.doc, B.doc, files) || imports(B.doc, A.doc, files)) continue;
        const pairKey = (x: Member, y: Member): string => `${x.doc.file.rel}\0${y.doc.file.rel}`;
        if (shadow.shadowed.has(pairKey(A, B)) || shadow.shadowed.has(pairKey(B, A))) continue;
        const nearCopy = shadow.nearCopies.has(pairKey(A, B)) || shadow.nearCopies.has(pairKey(B, A));
        let shared = 0;
        for (const k of ra.all.keys()) if (rb.all.has(k)) shared++;
        const union = ra.all.size + rb.all.size - shared;
        if (shared < opts.minShared || union === 0 || shared === union || shared / union < opts.jaccard) continue;
        const pct = Math.round((shared / union) * 100);
        const diffs: Array<{ in: Member; notIn: Member; line: number; preview: string }> = [];
        for (const [k, v] of ra.all) if (!rb.all.has(k)) diffs.push({ in: A, notIn: B, line: v.line, preview: v.preview });
        for (const [k, v] of rb.all) if (!ra.all.has(k)) diffs.push({ in: B, notIn: A, line: v.line, preview: v.preview });
        // One note per file of the pair, on its first differing line, with a count and a few
        // examples: ten near-identical notes for one drifted pair is noise. Several sentences of
        // one paragraph differ together, so lines are counted once.
        const claudeSide = A.tool === "claude" ? A : B.tool === "claude" ? B : null;
        const agentsSide = A.tool === "agents" ? A : B.tool === "agents" ? B : null;
        for (const side of [A, B]) {
          const mine = diffs.filter((d) => d.in === side);
          const lines = new Set<number>();
          const unique = mine.filter((d) => (lines.has(d.line) ? false : (lines.add(d.line), true)));
          if (!unique.length) continue;
          const other = side === A ? B : A;
          const examples = unique.slice(0, Math.min(3, opts.maxPerPair)).map((d) => `line ${d.line} ${quote(d.preview)}`).join("; ");
          const more = unique.length > 3 ? ` and ${fmt(unique.length - 3)} more` : "";
          const n = unique.length === 1 ? "1 line here is" : `${fmt(unique.length)} lines here are`;
          const fix =
            nearCopy && claudeSide && agentsSide
              ? `${dp(claudeSide.doc.path)} is a near-copy of ${dp(agentsSide.doc.path)}: replace it with the single line @AGENTS.md (plus anything only Claude needs) or a symlink to AGENTS.md, so there is one file to keep up to date`
              : "Copy them across or delete the stale copies, so every agent gets the same instructions";
          ctx.report(side.doc.path, {
            severity: "info",
            rule: "instruction-drift",
            message: `${n} not in ${dp(other.doc.path)}, although the two files mirror each other (${pct}% of their rules match): ${examples}${more}. ${fix}`,
            line: unique[0]!.line,
          });
        }
      }
    }
  }
}

export function driftCheck(opts: DriftOptions = DRIFT_DEFAULTS): ProjectCheck {
  return {
    id: "drift",
    ready: true,
    run: async (ctx) => {
      const files = new Files(ctx.sandbox, ctx.docs);
      const docs: Doc[] = [];
      for (const d of ctx.docs) if (!d.file.root.extra && !notProjectInstructions(d.file.rel) && !(await files.inSkill(dirOf(d.file.rel)))) docs.push(d);
      const base = (d: Doc): string => d.file.rel.slice(d.file.rel.lastIndexOf("/") + 1);
      const agentsDocs = docs.filter((d) => base(d) === "AGENTS.md");
      const variantDocs = docs.filter((d) => base(d) === "AGENTS.override.md" || base(d) === "AGENTS.local.md" || /(?:^|\/)\.agents\/[^/]+\.md$/i.test(d.file.rel));

      const shadow = await checkShadowed(ctx, files, agentsDocs);

      // Every folder that holds a steering file, and the folders above it.
      const dirs = new Set<string>([""]);
      for (const d of docs) {
        if (ctx.deadline.expired) return;
        for (let dir: string | null = dirOf(d.file.rel); dir !== null && !dirs.has(dir); dir = parentOf(dir)) dirs.add(dir);
      }
      await checkVariants(ctx, files, [...dirs].sort(), docs, variantDocs);
      await checkCodexChain(ctx, files, [...agentsDocs, ...variantDocs.filter((d) => base(d) === "AGENTS.override.md")]);

      // Contradiction and drift compare files with each other: only files of this call.
      const members = docs.map(memberOf).filter((m): m is Member => m !== null);
      if (members.length > 1) checkPairs(ctx, files, members, opts, shadow);
    },
  };
}

export const DRIFT_CHECK: ProjectCheck = driftCheck();
