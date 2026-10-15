// find_steering_files: walks the allowed folders. Symlinks are followed only when they resolve
// inside a root (CLAUDE.md -> AGENTS.md, .claude/skills -> ../.agents/skills), each real folder once.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { classify, inMemoryFolder, isSteering } from "./kinds.js";
import { CAPS } from "./limits.js";
import { policyRefusal, type Root, type Sandbox } from "./paths.js";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".turbo",
  ".cache", ".venv", "venv", "__pycache__", ".tox", "vendor", ".idea", ".gradle", ".terraform",
]);

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
export async function walk(sandbox: Sandbox, opts: { maxDepth?: number; includeAll?: boolean; deadline?: Deadline } = {}): Promise<WalkResult> {
  const maxDepth = Math.min(opts.maxDepth ?? CAPS.walkMaxDepth, CAPS.walkMaxDepth);
  const out: WalkResult = { files: [], skippedSymlinks: 0, truncated: false, cut: { depth: false, size: false, time: false }, entriesSeen: 0, unreadable: [] };
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
          if (SKIP_DIRS.has(e.name)) continue;
          if (depth + 1 > maxDepth) { out.truncated = true; out.cut.depth = true; continue; }
          queue.push({ dir: path.join(dir, e.name), rel: childRel, depth: depth + 1 });
          continue;
        }
        if (!isFile) continue;
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
