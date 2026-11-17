// find_steering_files: walks the allowed folders. Symlinks are followed only when they resolve
// inside a root (CLAUDE.md -> AGENTS.md, .claude/skills -> ../.agents/skills), each real folder once.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { classify, inMemoryFolder, isSteering } from "./kinds.js";
import { CAPS } from "./limits.js";
import { dp } from "./escape.js";
import { policyRefusal, type Root, type Sandbox } from "./paths.js";

// Dependency, build and cache folders: large, generated, and never where a project keeps its own
// steering files. Skipping them keeps big monorepos under the walk limits.
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".turbo",
  ".cache", ".venv", "venv", "__pycache__", ".tox", "vendor", ".idea", ".gradle", ".terraform",
  "bower_components", "jspm_packages", ".pnpm-store", ".yarn", ".mypy_cache", ".pytest_cache", ".ruff_cache",
  "site-packages", ".nox", "Pods", "DerivedData", ".svelte-kit", ".parcel-cache", ".angular", ".docusaurus",
  ".output", ".vercel", ".expo", ".dart_tool", ".nyc_output", "bazel-bin", "bazel-out", "bazel-testlogs",
]);

/**
 * Skipped names that are also ordinary source folder names (bun keeps scripts/build/CLAUDE.md). Such
 * a folder is searched when it holds an instruction file of its own; a real build output does not.
 */
const AMBIGUOUS_SKIP = new Set(["build", "out", "dist", "target", "coverage", "vendor"]);
const INSTRUCTION_FILES = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "GEMINI.md"]);

async function holdsInstructions(dir: string): Promise<boolean> {
  try {
    return (await fsp.readdir(dir)).some((n) => INSTRUCTION_FILES.has(n));
  } catch {
    return false;
  }
}

export interface Found {
  /** Display path. */
  path: string;
  /** Path relative to its root, POSIX. */
  rel: string;
  root: Root;
  abs: string;
  size: number;
}

export interface WalkResult {
  files: Found[];
  /** Symlinks not followed: they resolve outside the roots, are broken, or loop. */
  skippedSymlinks: number;
  truncated: boolean;
  /** Why the walk was cut short: folders deeper than the depth limit, or the entry, file or time limit. */
  cut: { depth: boolean; size: boolean; time: boolean };
  entriesSeen: number;
  /**
   * Folders that could not be listed (permission denied), root-relative POSIX ("." for the root).
   * Their files were not searched, so a caller must say so: a partial walk must not look complete.
   */
  unreadable: string[];
  /**
   * With collectNames: every file name the walk listed under the primary root, root-relative POSIX,
   * whatever its type. Names only: nothing is opened. Used to match path globs against the tree.
   */
  names?: string[];
  /** With collectNames: folders under the primary root the walk did not enter (SKIP_DIRS, or past the depth limit), root-relative. */
  skippedDirs?: string[];
  /**
   * Steering files (by name) that are symlinks to something AsItIs does not read: a file outside the
   * roots, or a file the read policy refuses (notes.txt, .env). The agent tools still load them, so
   * the lint reports each one (unlinted-steering-target) instead of skipping it quietly.
   */
  unlinted: UnlintedLink[];
}

export interface UnlintedLink {
  /** Display path of the link. */
  path: string;
  kind: import("./kinds.js").Kind;
  /** Why it was not linted, as the end of a sentence. */
  why: string;
}

/**
 * For a steering file name that is a symlink: why the file it points to is not linted, or null when
 * it is (or the link is broken: a missing file loads nothing). Never reads the target.
 */
export async function unlintedLink(sandbox: Sandbox, abs: string, rel: string, extraRoot: boolean): Promise<UnlintedLink | null> {
  const c = classify(rel, inMemoryFolder(rel, extraRoot));
  if (!isSteering(c.kind) || policyRefusal(rel)) return null;
  const st = await fsp.lstat(abs).catch(() => null);
  if (!st?.isSymbolicLink()) return null;
  const probe = await sandbox.probe(abs, path.dirname(abs)).catch(() => null);
  const shown = sandbox.display(abs);
  if (probe?.state === "outside") return { path: shown, kind: c.kind, why: "it is a symlink to a file outside the project folder, which AsItIs does not read" };
  if (probe?.state !== "ok" || probe.rel === undefined) return null;
  const target = await fsp.stat(probe.real!).catch(() => null);
  if (!target?.isFile()) return null;
  const refused = policyRefusal(probe.rel);
  if (!refused) return null;
  const notMarkdown = refused.includes("is not a markdown file");
  return { path: shown, kind: c.kind, why: `it is a symlink to ${dp(probe.rel)}, which AsItIs does not read (${notMarkdown ? "it only reads markdown" : "it never reads .env files, git internals, dependencies or settings"})` };
}

export class Deadline {
  private readonly end: number;
  constructor(ms: number) {
    this.end = Date.now() + ms;
  }
  get expired(): boolean {
    return Date.now() > this.end;
  }
}

/** Lists steering files (and, with includeAll, every readable markdown file) under the roots. */
export async function walk(sandbox: Sandbox, opts: { maxDepth?: number; includeAll?: boolean; deadline?: Deadline; collectNames?: boolean } = {}): Promise<WalkResult> {
  const maxDepth = Math.min(opts.maxDepth ?? CAPS.walkMaxDepth, CAPS.walkMaxDepth);
  const out: WalkResult = { files: [], skippedSymlinks: 0, truncated: false, cut: { depth: false, size: false, time: false }, entriesSeen: 0, unreadable: [], unlinted: [] };
  const names: string[] | null = opts.collectNames ? (out.names = []) : null;
  const skippedDirs: string[] | null = opts.collectNames ? (out.skippedDirs = []) : null;
  for (const root of sandbox.roots) {
    const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root.real, rel: "", depth: 0 }];
    const visited = new Set<string>([await fsp.realpath(root.real).catch(() => root.real)]);
    while (queue.length) {
      const { dir, rel, depth } = queue.shift()!;
      if (opts.deadline?.expired) { out.truncated = true; out.cut.time = true; return out; }
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | null)?.code;
        // Gone since it was listed (deleted mid-walk, or a file now): nothing to search.
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        // Permission denied: recorded, so the lint can say which folder it could not search.
        if (code === "EACCES" || code === "EPERM") {
          if (out.unreadable.length < 1000) out.unreadable.push(rel || ".");
          continue;
        }
        // Anything else is a bug or a broken system, not a clean folder.
        throw e;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        out.entriesSeen++;
        if (out.entriesSeen > CAPS.walkMaxEntries || out.files.length >= CAPS.walkMaxFiles) { out.truncated = true; out.cut.size = true; return out; }
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        let isDir = e.isDirectory();
        let isFile = e.isFile();
        if (e.isSymbolicLink() && out.unlinted.length < 1000) {
          const bad = await unlintedLink(sandbox, path.join(dir, e.name), childRel, !!root.extra);
          if (bad) {
            out.unlinted.push(bad);
            out.skippedSymlinks++;
            continue;
          }
        }
        if (e.isSymbolicLink()) {
          // Follow it only if it resolves inside a root; never count a folder twice (loops).
          const probe = await sandbox.probe(path.join(dir, e.name), dir).catch(() => null);
          const st = probe?.state === "ok" && probe.real ? await fsp.stat(probe.real).catch(() => null) : null;
          if (!st || !probe?.real) { out.skippedSymlinks++; continue; }
          if (st.isDirectory()) {
            const real = await fsp.realpath(probe.real).catch(() => probe.real!);
            if (visited.has(real)) { out.skippedSymlinks++; continue; }
            visited.add(real);
            isDir = true;
          } else isFile = st.isFile();
        }
        if (isDir) {
          if (SKIP_DIRS.has(e.name) && !(AMBIGUOUS_SKIP.has(e.name) && (await holdsInstructions(path.join(dir, e.name))))) {
            if (skippedDirs && root === sandbox.primary) skippedDirs.push(childRel);
            continue;
          }
          if (depth + 1 > maxDepth) {
            out.truncated = true;
            out.cut.depth = true;
            if (skippedDirs && root === sandbox.primary) skippedDirs.push(childRel);
            continue;
          }
          queue.push({ dir: path.join(dir, e.name), rel: childRel, depth: depth + 1 });
          continue;
        }
        if (!isFile) continue;
        if (names && root === sandbox.primary) names.push(childRel);
        if (policyRefusal(childRel)) continue;
        const c = classify(childRel, inMemoryFolder(childRel, !!root.extra));
        if (!opts.includeAll && !isSteering(c.kind)) continue;
        const abs = path.join(dir, e.name);
        const st = await fsp.stat(abs).catch(() => null);
        if (!st || !st.isFile()) continue;
        out.files.push({ path: sandbox.display(abs), rel: childRel, root, abs, size: st.size });
      }
    }
  }
  return out;
}
