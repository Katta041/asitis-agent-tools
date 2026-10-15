// Read policy for files inside skill folders that are not markdown (F8). Owner: WP5.
// Used only when a call opts in with include "skills". Before this policy runs, Sandbox.openAs has
// already refused .env*, .git, node_modules, Windows streams and devices, and paths that resolve
// outside the allowed folder (a symlink from a skill folder to ~/.ssh is refused there).
//
// What it allows:
// - only files under a folder that contains SKILL.md (checked for the path as asked and again for
//   the real path, so a symlink cannot borrow a skill folder);
// - full reads, up to 1 MB, only for script extensions and for files without an extension (the
//   skill check reads 4 bytes first and reads the rest only after a #! line);
// - any other file in a skill folder only as a head read (headBytes), which skips the size limit:
//   maxBytesFor returns 0 for them, so a full read of a binary, image or archive is refused.

import path from "node:path";
import type { PolicyContext, ReadPolicy } from "../paths.js";

/** Scripts that skills ship. Spec list from F8 plus a few close relatives (.ksh, .fish, .psm1, .php, .mts, .cts). */
export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".sh", ".bash", ".zsh", ".ksh", ".fish", ".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".ps1", ".psm1", ".rb", ".pl", ".php", ".bat", ".cmd",
]);

export const SKILL_SCRIPT_MAX_BYTES = 1024 * 1024;

/** True for a script extension or no extension at all (a possible #! script). */
export function fullReadAllowed(relPosix: string): boolean {
  const name = path.posix.basename(relPosix).toLowerCase();
  const ext = path.posix.extname(name);
  return ext === "" || SCRIPT_EXTENSIONS.has(ext);
}

const MAX_ANCESTORS = 16;

/** The nearest folder at or above the file's folder that holds a SKILL.md, root-relative, or null. */
export async function skillFolderOf(relPosix: string, ctx: Pick<PolicyContext, "sandbox">): Promise<string | null> {
  let dir = path.posix.dirname(relPosix);
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    const candidate = dir === "." || dir === "" ? "SKILL.md" : `${dir}/SKILL.md`;
    for (const root of ctx.sandbox.roots) {
      const p = await ctx.sandbox.probe(candidate, root.real).catch(() => null);
      if (p?.state === "ok") return dir === "" ? "." : dir;
    }
    if (dir === "." || dir === "" || dir === "/") return null;
    dir = path.posix.dirname(dir);
  }
  return null;
}

export const SKILL_SCRIPT_POLICY: ReadPolicy = {
  readClass: "skill-script",
  label: "skill scripts",
  maxBytes: SKILL_SCRIPT_MAX_BYTES,
  maxBytesFor: (relPosix) => (fullReadAllowed(relPosix) ? SKILL_SCRIPT_MAX_BYTES : 0),
  refusal: async (relPosix, ctx) => {
    const lower = path.posix.basename(relPosix).toLowerCase();
    if (lower === "skill.md") return `${relPosix} is a skill file; it is read as markdown, not as a script`;
    if (!(await skillFolderOf(relPosix, ctx))) return `${relPosix} is not inside a skill folder (a folder with a SKILL.md); only files in skill folders are scanned`;
    return null;
  },
};
