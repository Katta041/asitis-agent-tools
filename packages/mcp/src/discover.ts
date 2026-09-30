// find_steering_files: walks the allowed folders without following symlinks.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { classify, isSteering } from "./kinds.js";
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
  skippedSymlinks: number;
  truncated: boolean;
  entriesSeen: number;
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
  const out: WalkResult = { files: [], skippedSymlinks: 0, truncated: false, entriesSeen: 0 };
  for (const root of sandbox.roots) {
    const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root.real, rel: "", depth: 0 }];
    while (queue.length) {
      const { dir, rel, depth } = queue.shift()!;
      if (opts.deadline?.expired) { out.truncated = true; return out; }
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        out.entriesSeen++;
        if (out.entriesSeen > CAPS.walkMaxEntries || out.files.length >= CAPS.walkMaxFiles) { out.truncated = true; return out; }
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) { out.skippedSymlinks++; continue; }
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          if (depth + 1 > maxDepth) { out.truncated = true; continue; }
          queue.push({ dir: path.join(dir, e.name), rel: childRel, depth: depth + 1 });
          continue;
        }
        if (!e.isFile()) continue;
        if (policyRefusal(childRel)) continue;
        const c = classify(childRel);
        if (!opts.includeAll && !isSteering(c.kind)) continue;
        const abs = path.join(dir, e.name);
        const st = await fsp.lstat(abs).catch(() => null);
        if (!st || !st.isFile()) continue;
        out.files.push({ path: sandbox.display(abs), rel: childRel, root, abs, size: st.size });
      }
    }
  }
  return out;
}
