// File access and loading helpers shared by the load models, context_budget and the drift checks:
// one folder listing and one parse per file per call, @import expansion with cycle detection, and
// the folder-chain helpers (which CLAUDE.md files switch off the AGENTS.md fallback, which file
// Codex reads in a folder, whether a CLAUDE.md brings an AGENTS.md in).

import path from "node:path";
import { analyse, type Doc } from "../doc.js";
import type { Deadline } from "../discover.js";
import { CAPS, VENDOR } from "../limits.js";
import { policyRefusal, UserError, type OpenedFile, type Sandbox } from "../paths.js";
import { extractImports, importIsSurelyFile, type ImportRef } from "../scan.js";
import { approxTokens, tokensFromBytes } from "../tokens.js";

export const dirOf = (rel: string): string => {
  const d = path.posix.dirname(rel);
  return d === "." ? "" : d;
};
export const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
export const parentOf = (dir: string): string | null => (dir === "" ? null : dirOf(dir));
/** True when folder a is b or inside it (root-relative, "" is the root). */
export const within = (a: string, b: string): boolean => b === "" || a === b || a.startsWith(`${b}/`);
/** Folders from the root down to dir, root first: ["", "packages", "packages/api"]. */
export function chainTo(dir: string): string[] {
  const out: string[] = [];
  for (let d: string | null = dir; d !== null; d = parentOf(d)) out.unshift(d);
  return out;
}
/** The folder a file applies to: its own folder, or the folder that holds its .claude/, .cursor/ or .github/. */
export function scopeOf(rel: string): string {
  const parts = rel.split("/").slice(0, -1);
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i] === ".claude" || parts[i] === ".cursor" || parts[i] === ".github") return parts.slice(0, i).join("/");
  return parts.join("/");
}

/** Files opened beyond the walked ones (ancestor CLAUDE.md files, imports, overrides), per call. */
const MAX_EXTRA_OPENS = 400;

export type EntryType = "file" | "dir" | "symlink" | "other";

/** Per-call file access: folder listings and opened files, each done once. */
export class FileIndex {
  private readonly lists = new Map<string, Map<string, EntryType> | null>();
  private readonly opened = new Map<string, Doc | null>();
  private readonly reals = new Map<string, string | null>();
  private readonly skillDirs = new Map<string, boolean>();
  private extra = 0;
  readonly byRel = new Map<string, Doc>();
  readonly byReal = new Map<string, Doc>();

  constructor(
    readonly sandbox: Sandbox,
    docs: readonly Doc[],
  ) {
    for (const d of docs) {
      if (d.file.root.extra) continue;
      this.byRel.set(d.file.rel, d);
      this.byReal.set(d.file.real, d);
    }
  }

  abs(rel: string): string {
    return rel ? path.join(this.sandbox.primary.real, ...rel.split("/")) : this.sandbox.primary.real;
  }

  async list(dir: string): Promise<Map<string, EntryType> | null> {
    if (this.lists.has(dir)) return this.lists.get(dir)!;
    let out: Map<string, EntryType> | null = null;
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

  /** Whether the folder has an entry with this name, of any type (".git" is a folder or, in a submodule, a file). */
  async hasEntry(dir: string, name: string): Promise<boolean> {
    return (await this.list(dir))?.has(name) ?? false;
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

  async isDir(rel: string): Promise<boolean> {
    const parent = dirOf(rel);
    const t = (await this.list(parent))?.get(rel.slice(rel.lastIndexOf("/") + 1));
    if (t === "dir") return true;
    if (t !== "symlink") return false;
    return (await this.list(rel)) !== null;
  }

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

  /** The walked doc for a path, or the file opened and parsed here; null when it cannot be read. */
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

  /** The doc for a file in a folder if it exists there; null otherwise. */
  async docIn(dir: string, name: string): Promise<Doc | null> {
    if (!(await this.hasFile(dir, name))) return null;
    return this.doc(join(dir, name));
  }
}

/** Text without block-level HTML comments (Claude Code strips these from CLAUDE.md before loading). Linear. */
export function stripBlockComments(doc: Doc): string {
  const s = doc.text;
  let out = "";
  let pos = 0;
  let copied = 0;
  for (;;) {
    const open = s.indexOf("<!--", pos);
    if (open < 0) break;
    const li = doc.lines.lineOf(open);
    const close = s.indexOf("-->", open + 4);
    // An unclosed comment is not stripped: Claude Code loads the text after it (checked with a canary).
    if (close < 0) break;
    const end = close + 3;
    pos = end;
    const lineStart = doc.lines.start(li);
    if (!doc.fence[li] && open - lineStart <= 3 && s.slice(lineStart, open).trim() === "") {
      out += s.slice(copied, open);
      copied = end;
    }
  }
  return out + s.slice(copied);
}

export function bodyTokens(doc: Doc, stripComments: boolean): number {
  return approxTokens(stripComments ? stripBlockComments(doc) : doc.text);
}

/** The @imports of a file. One place, so import parsing fixes in scan.ts reach every caller. */
export function importsOf(doc: Doc): ImportRef[] {
  return extractImports(doc.lines, doc.fence, doc.frontmatter.present ? doc.frontmatter.endLine : -1);
}

export interface ImportHit {
  path: string;
  tokens: number;
  note?: string;
  depth?: number;
  /** True on the entry that stands for imports beyond the listing cap: they are neither listed nor counted. */
  overflow?: boolean;
  /** For an @import whose file does not exist: the file that imports it and the line. */
  missingFrom?: { path: string; line: number };
  /** Files from the top-level file down to the importer. */
  via?: string[];
  /** The parsed file, when it was read. */
  doc?: Doc;
}

const MAX_IMPORTS_LISTED = 200;

/**
 * Expands @imports depth first up to maxHops, counting each file once (seen holds real paths and
 * stops cycles). Relative paths resolve from the importing file's folder.
 */
export async function expandImports(sandbox: Sandbox, doc: Doc, seen: Set<string>, depth = 1, deadline?: Deadline, maxHops: number = VENDOR.importMaxHops, via: string[] = [doc.path]): Promise<ImportHit[]> {
  if (depth > maxHops) return [];
  const out: ImportHit[] = [];
  const dir = path.dirname(doc.file.real);
  const imports = importsOf(doc);
  const shown = (p: string): string => (p.length > 200 ? `${p.slice(0, 200)}...` : p);
  let listed = 0;
  for (const im of imports) {
    if (deadline?.expired) break;
    if (++listed > MAX_IMPORTS_LISTED) {
      // extractImports stops at CAPS.maxLinkChecks, so at the cap the real number is higher.
      const more = imports.length - MAX_IMPORTS_LISTED;
      const atCap = imports.length >= CAPS.maxLinkChecks;
      out.push({ path: `${atCap ? "At least " : ""}${more.toLocaleString("en-US")} more imports in ${doc.path}`, note: "not listed or counted", tokens: 0, depth, overflow: true, via });
      break;
    }
    if (im.path.startsWith("~")) {
      out.push({ path: `@${shown(im.path)}`, tokens: 0, note: "outside the allowed folder (home), not counted", depth, via });
      continue;
    }
    const probe = await sandbox.probe(im.path, dir);
    // "@next/rspack-core" or "@user" that names no file is text to the reader, not a broken import: leave it out.
    if (probe.state === "missing" && !importIsSurelyFile(im)) continue;
    if (probe.state !== "ok" || !probe.real || !probe.rel) {
      const missing = probe.state === "missing";
      out.push({
        path: `@${shown(im.path)}`,
        tokens: 0,
        note: missing ? "missing, not counted" : "outside the allowed folder, not counted",
        depth,
        via,
        ...(missing && importIsSurelyFile(im) ? { missingFrom: { path: doc.path, line: im.line } } : {}),
      });
      continue;
    }
    if (seen.has(probe.real)) continue;
    seen.add(probe.real);
    const refusal = policyRefusal(probe.rel);
    if (refusal) {
      const secret = /\.env|settings/i.test(path.basename(probe.rel));
      out.push({
        path: sandbox.display(probe.real),
        tokens: tokensFromBytes(probe.size ?? 0),
        note: secret ? "WARNING: a secrets or settings file is imported into context; estimated from size, not read" : "not markdown; estimated from file size, not read",
        depth,
        via,
      });
      continue;
    }
    try {
      const f = await sandbox.open(probe.real);
      const child = analyse(f, sandbox.displayFile(f));
      out.push({ path: child.path, tokens: bodyTokens(child, true), note: depth === 1 ? "imported" : `imported, ${depth} hops deep`, depth, via, doc: child });
      out.push(...(await expandImports(sandbox, child, seen, depth + 1, deadline, maxHops, [...via, child.path])));
    } catch (e) {
      out.push({ path: sandbox.display(probe.real), tokens: 0, note: e instanceof UserError ? e.message : "could not be read", depth, via });
    }
  }
  return out;
}

/** One warning per @import whose file does not exist, so a broken import is not just a quiet "not counted". */
export function missingImportWarnings(entries: ReadonlyArray<{ path: string; missingFrom?: { path: string; line: number } }>): string[] {
  return entries
    .filter((e) => e.missingFrom)
    .map((e) => `${e.path} (${e.missingFrom!.path}, line ${e.missingFrom!.line}) points to a file that does not exist, so nothing from it loads. Fix the path or remove the line`);
}

/** Root-relative targets of a file's @imports that stay inside the root. */
export function importTargets(doc: Doc): string[] {
  const dir = dirOf(doc.file.rel);
  const out: string[] = [];
  for (const im of importsOf(doc)) {
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
export async function bringsIn(files: FileIndex, claudeRel: string, agents: Doc): Promise<boolean | null> {
  const agentsReal = agents.file.real;
  const start = await files.real(claudeRel);
  if (start === null) return null;
  if (start === agentsReal) return true;
  let frontier = [claudeRel];
  const seen = new Set<string>([start]);
  for (let hop = 0; hop < VENDOR.importMaxHops && frontier.length; hop++) {
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

/** Instruction files Claude Code reads in one folder, in the order it reads them. */
export const CLAUDE_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"] as const;

/** Files in one folder that switch off Claude Code's AGENTS.md fallback (CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md). */
export async function claudeFilesIn(files: FileIndex, d: string): Promise<string[]> {
  const out: string[] = [];
  if (await files.hasFile(d, "CLAUDE.md")) out.push(join(d, "CLAUDE.md"));
  const dotClaude = (await files.list(d))?.get(".claude");
  if ((dotClaude === "dir" || dotClaude === "symlink") && (await files.hasFile(join(d, ".claude"), "CLAUDE.md"))) out.push(join(d, ".claude/CLAUDE.md"));
  if (await files.hasFile(d, "CLAUDE.local.md")) out.push(join(d, "CLAUDE.local.md"));
  return out;
}

/** Files that switch off Claude Code's AGENTS.md fallback, from this folder up to the root, nearest first. */
export async function countingFiles(files: FileIndex, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (let d: string | null = dir; d !== null; d = parentOf(d)) {
    for (const name of ["CLAUDE.md", "CLAUDE.local.md"]) if (await files.hasFile(d, name)) out.push(join(d, name));
    const dotClaude = (await files.list(d))?.get(".claude");
    if ((dotClaude === "dir" || dotClaude === "symlink") && (await files.hasFile(join(d, ".claude"), "CLAUDE.md"))) out.push(join(d, ".claude/CLAUDE.md"));
  }
  return out;
}

export interface CodexFile {
  rel: string;
  /** Bytes Codex takes from it: 0 for an empty file, which Codex skips. */
  bytes: number;
  doc: Doc | null;
}

/** The file Codex reads in this folder (AGENTS.override.md, else AGENTS.md), or null when there is none. */
export async function codexFile(files: FileIndex, dir: string): Promise<CodexFile | null> {
  for (const name of ["AGENTS.override.md", "AGENTS.md"]) {
    if (!(await files.hasFile(dir, name))) continue;
    const d = await files.doc(join(dir, name));
    // Codex picks the first name that exists, then skips it if it is empty (agents_md.rs).
    if (!d) return null;
    return { rel: join(dir, name), bytes: d.text.trim() ? d.file.buf.length : 0, doc: d };
  }
  return null;
}

/**
 * Codex files from the project root down to, but not including, a folder, with their bytes.
 * Cached per call: every folder of a monorepo shares the files above it.
 */
export class CodexChain {
  private readonly cache = new Map<string, Array<{ rel: string; bytes: number }>>();
  constructor(
    private readonly files: FileIndex,
    /** The folder Codex treats as the project root (where the walk starts). */
    private readonly top: string = "",
  ) {}
  async above(dir: string): Promise<Array<{ rel: string; bytes: number }>> {
    const hit = this.cache.get(dir);
    if (hit) return hit;
    let out: Array<{ rel: string; bytes: number }> = [];
    const parent = parentOf(dir);
    if (parent !== null && dir !== this.top && within(parent, this.top)) {
      const up = await this.above(parent);
      const here = await codexFile(this.files, parent);
      out = here && here.bytes ? [...up, { rel: here.rel, bytes: here.bytes }] : up;
    }
    this.cache.set(dir, out);
    return out;
  }
}

/** The nearest folder at or above dir (inside the root) with a .git entry, or null when there is none. */
export async function gitRootOf(files: FileIndex, dir: string): Promise<string | null> {
  for (let d: string | null = dir; d !== null; d = parentOf(d)) if (await files.hasEntry(d, ".git")) return d;
  return null;
}

/** Tokens a skill, command or subagent adds to the listing Claude Code shows the model every session. */
export function skillListingTokens(doc: Doc): number {
  const d = doc.frontmatter.present ? doc.frontmatter.data : null;
  if (!d || d["disable-model-invocation"] === true) return 0;
  const name = String(d["name"] ?? path.posix.basename(path.posix.dirname(doc.file.rel)));
  const listing = `${String(d["description"] ?? "")} ${String(d["when_to_use"] ?? "")}`.slice(0, VENDOR.skillListingChars);
  return approxTokens(`${name}: ${listing}`) + 4;
}

export function agentListingTokens(doc: Doc): number {
  return approxTokens(String(doc.frontmatter.data?.["description"] ?? "")) + 4;
}
