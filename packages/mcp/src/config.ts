// .asitisrc.json: loading, validation and applying it to findings. Owner: WP2.
// Stub until WP2 lands: no config is read and applyConfig changes nothing.
//
// Contract for WP2 (see docs/cli-contract.md, "Config"):
// - loadConfig reads <root>/.asitisrc.json, or configPath, through sandbox.openAs("asitisrc", ...).
//   A missing default file is not an error (return null). A missing --config file, invalid JSON,
//   an unknown key, rule id or severity throws UserError with the file, line and a "did you mean"
//   hint. The CLI turns UserError into exit code 2; the MCP tools show it as the tool error.
// - applyConfig runs once, after every check. It may change issue severity, remove issues of rules
//   that are "off", and set issue.suppressed (kind "external" for config and baseline, "inSource"
//   for asitis-disable comments via suppress.ts). Suppressed issues stay in results: the MCP text
//   leaves them out of the listing and counts them, JSON and SARIF keep them marked.
// - Security rules (registry suppressibleInline false) are never suppressed by a comment.

import type { Doc } from "./doc.js";
import type { LintResult } from "./lint.js";
import type { Sandbox } from "./paths.js";
import type { Include } from "./project.js";

export interface LoadedConfig {
  /** Root-relative path of the file read. */
  path: string;
  include?: Include[];
}

export interface ConfigRun {
  sandbox: Sandbox;
  results: LintResult[];
  docs: readonly Doc[];
  include: ReadonlySet<Include>;
  baselinePath?: string;
}

export async function loadConfig(_sandbox: Sandbox, _opts: { configPath?: string }): Promise<LoadedConfig | null> {
  return null;
}

export async function applyConfig(_config: LoadedConfig | null, _run: ConfigRun): Promise<void> {
  // Stub: WP2 fills this in.
}
