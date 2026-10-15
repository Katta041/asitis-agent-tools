// Read policy for the root .gitmodules file. broken-link reads it so that a link into a git
// submodule that is not checked out (a plain clone leaves the folder empty) is not reported as
// broken. Only the root .gitmodules is allowed, up to 64 KB, and only its "path = ..." lines are
// used; nothing from it is echoed (submodule URLs can carry credentials).

import type { ReadPolicy } from "../paths.js";

export const GITMODULES_FILE = ".gitmodules";

export const GITMODULES_POLICY: ReadPolicy = {
  readClass: "gitmodules",
  label: "the .gitmodules file",
  maxBytes: 64 * 1024,
  refusal: (relPosix) => (relPosix === GITMODULES_FILE ? null : `${relPosix} is not the .gitmodules file at the top of the folder; this server reads no other git files`),
};

/** The submodule folders a .gitmodules file names, root-relative, without a trailing slash. */
export function submodulePaths(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 1000) continue;
    const m = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]!.replace(/^"(.*)"$/, "$1").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""));
  }
  return out.filter(Boolean);
}
