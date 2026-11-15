// The inputs every load model shares for one call: the folder walk (steering files plus every file
// name, names only), the parsed steering files, and per-call file access.

import { analyse, type Doc } from "../doc.js";
import { walk, type Deadline, type WalkResult } from "../discover.js";
import { UserError, type Sandbox } from "../paths.js";
import { FileIndex } from "./files.js";

export interface LoadContext {
  sandbox: Sandbox;
  deadline?: Deadline;
  walk: WalkResult;
  /** Steering files the walk found and could read, in walk order (folders breadth first, names sorted). */
  docs: Doc[];
  /** "path: reason" for files the walk found but could not read. */
  skippedFiles: string[];
  files: FileIndex;
  /**
   * Every file name under the primary root, root-relative, or null when the walk stopped early (file,
   * entry or time limit) and the list is incomplete. Folders past the depth limit are listed in
   * walk.skippedDirs, like node_modules.
   */
  names: string[] | null;
}

export async function loadContext(sandbox: Sandbox, deadline?: Deadline): Promise<LoadContext> {
  const found = await walk(sandbox, { collectNames: true, ...(deadline ? { deadline } : {}) });
  const docs: Doc[] = [];
  const skipped: string[] = [];
  for (const f of found.files) {
    if (deadline?.expired) break;
    try {
      const opened = await sandbox.open(f.abs);
      docs.push(analyse(opened, sandbox.displayFile(opened)));
    } catch (e) {
      skipped.push(`${f.path}: ${e instanceof UserError ? e.message : "could not be read"}`);
    }
  }
  const complete = !found.cut.size && !found.cut.time;
  return { sandbox, ...(deadline ? { deadline } : {}), walk: found, docs, skippedFiles: skipped, files: new FileIndex(sandbox, docs), names: complete ? (found.names ?? []) : null };
}

/** Walked docs under the primary root (not extra memory roots). */
export function primaryDocs(ctx: LoadContext): Doc[] {
  return ctx.docs.filter((d) => d.file.root === ctx.sandbox.primary);
}
