// Drift and sync checks across AGENTS.md, CLAUDE.md, GEMINI.md and Cursor rules (F7). Owner: WP4.
// Stub until WP4 lands. Runs on every project lint (no include needed); markdown only.
// Report with ctx.report(doc.path, { severity, rule, message, line }) using ids from
// rules/drift.meta.ts, and flip those ids to active in the same commit.

import type { ProjectCheck } from "../project.js";

export const DRIFT_CHECK: ProjectCheck = {
  id: "drift",
  ready: false,
  run: async () => {
    // Stub: WP4 fills this in.
  },
};
