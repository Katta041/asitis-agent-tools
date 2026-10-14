// Baseline files: asitis lint --format json --write-baseline prints one to stdout, and
// --baseline <file> hides findings whose fingerprint it lists. Owner: WP2. Stub until WP2 lands.
// The file is read through sandbox.openAs("asitisrc", ...) and so is subject to the same 64 KB
// policy unless WP2 gives baselines a policy entry of their own (ask the WP0 owner).

import type { Finding } from "./findings.js";

export interface Baseline {
  schemaVersion: 1;
  fingerprints: string[];
}

export function parseBaseline(_text: string, _file: string): Baseline {
  return { schemaVersion: 1, fingerprints: [] };
}

export function baselineOf(findings: readonly Finding[]): Baseline {
  return { schemaVersion: 1, fingerprints: [...new Set(findings.flatMap((f) => (f.fingerprint ? [f.fingerprint] : [])))].sort() };
}
