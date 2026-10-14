// Skill folder security scan (F8). Owner: WP5. Opt-in: include "skills".
// Stub until WP5 lands. List skill folders with ctx.sandbox.listDir, read scripts with
// ctx.sandbox.openAs("skill-script", ...), quote file text only through redact.ts preview().

import type { ProjectCheck } from "../project.js";

export const SKILLS_CHECK: ProjectCheck = {
  id: "skills",
  include: "skills",
  ready: false,
  run: async () => {
    // Stub: WP5 fills this in.
  },
};
