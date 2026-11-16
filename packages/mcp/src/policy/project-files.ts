// Read policy for the project files that dead-command and stale-path (refs.ts) read with include
// "config": files named exactly package.json, Makefile, makefile or GNUmakefile, for their script,
// dependency and target names, and files named exactly .gitignore, so a path the build writes
// (dist/, a local config) is not called stale. Without that grant every read is refused, so a
// default run reads markdown only. Up to 1 MB each. Only names are kept, never a script body or any other value,
// and a finding quotes only what the steering file itself says plus script or target names.

import type { ReadPolicy } from "../paths.js";

/** File names this class reads, exactly as written (make and git are case-sensitive about these). */
export const PROJECT_FILE_NAMES: readonly string[] = ["package.json", "Makefile", "makefile", "GNUmakefile", ".gitignore"];

export const PROJECT_FILES_POLICY: ReadPolicy = {
  readClass: "project-files",
  label: "package.json, Makefile and .gitignore files",
  maxBytes: 1024 * 1024,
  refusal: (relPosix, ctx) => {
    const base = relPosix.split("/").pop() ?? "";
    if (!PROJECT_FILE_NAMES.includes(base)) return `${relPosix} is not a package.json, Makefile or .gitignore; this server reads no other project files`;
    if (!ctx.grants.has("config") && !ctx.grants.has("config-local")) return `${relPosix} is read only with include "config"`;
    return null;
  },
};
