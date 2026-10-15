// Baseline files: asitis lint --format json --write-baseline prints one to stdout, and
// --baseline <file> marks findings whose fingerprint it lists as suppressed (kind "external").
// Owner: WP2. Read through sandbox.openAs("asitisrc", ...): JSON only, inside the root, up to 4 MB.
//
// Fingerprints (findings.ts) hash the rule, the path, the line's text with whitespace and line
// endings normalised, and an occurrence index. So a baselined finding stays baselined when lines
// are added above it or the file moves between CRLF and LF, and a second copy of the same line
// gets a new fingerprint and is reported.

import { parseJsonLines, readOwnFile, showValue } from "./config.js";
import { q } from "./escape.js";
import type { Finding } from "./findings.js";
import { UserError, type Sandbox } from "./paths.js";

export interface Baseline {
  schemaVersion: 1;
  fingerprints: string[];
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Parses and checks a baseline file. Throws UserError("<file> line N: ...") on any problem. */
export function parseBaseline(text: string, file: string): Baseline {
  const root = parseJsonLines(text, file);
  if (root.type !== "object") throw new UserError(`${file} line ${root.line}: a baseline must be a JSON object with schemaVersion and fingerprints, not ${showValue(root)}`);
  let version = false;
  let fingerprints: string[] | null = null;
  for (const e of root.entries) {
    const v = e.value;
    if (e.key === "schemaVersion") {
      if (v.type !== "number" || v.value !== 1) throw new UserError(`${file} line ${v.line}: schemaVersion must be 1, not ${showValue(v)}; this file was written by a different version of asitis`);
      version = true;
    } else if (e.key === "fingerprints") {
      if (v.type !== "array") throw new UserError(`${file} line ${v.line}: fingerprints must be a list, not ${showValue(v)}`);
      fingerprints = v.items.map((it, k) => {
        if (it.type !== "string" || !HEX64.test(it.value)) throw new UserError(`${file} line ${it.line}: fingerprints[${k}] is not a fingerprint (64 lowercase hex characters); write the file again with --write-baseline`);
        return it.value;
      });
    } else {
      throw new UserError(`${file} line ${e.line}: unknown key ${q(e.key, 60)} in a baseline file; it holds only schemaVersion and fingerprints`);
    }
  }
  if (!version) throw new UserError(`${file} line ${root.line}: schemaVersion is missing; write the file again with --write-baseline`);
  if (!fingerprints) throw new UserError(`${file} line ${root.line}: fingerprints is missing; write the file again with --write-baseline`);
  return { schemaVersion: 1, fingerprints };
}

/** Reads the baseline named by --baseline. It must be inside the project folder. */
export async function loadBaseline(sandbox: Sandbox, p: string): Promise<Set<string>> {
  const { text, display } = await readOwnFile(sandbox, p, "baseline file");
  return new Set(parseBaseline(text, display).fingerprints);
}

/** The baseline for a run: fingerprints of every finding not already suppressed, sorted, no duplicates. */
export function baselineOf(findings: readonly Finding[]): Baseline {
  return { schemaVersion: 1, fingerprints: [...new Set(findings.flatMap((f) => (f.fingerprint && !f.suppressed ? [f.fingerprint] : [])))].sort() };
}
