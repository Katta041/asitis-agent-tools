// asitis lint --format json. Owner: WP1.
// The report as LintReport (findings.ts), schema in schema/report-1.json. Suppressed findings stay
// in, marked, and only the unsuppressed ones are counted in summary.errors, warnings and notes.

import type { LintReport } from "../findings.js";

export function formatJson(report: LintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
