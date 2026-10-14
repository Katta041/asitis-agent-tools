// Read policy for files inside skill folders that are not markdown. Owner: WP5.
// Stub: refuses every read until WP5 lands. The target policy (F8): only files in a folder that
// contains SKILL.md, with an allowlisted script extension or a #! shebang, at most 1 MB, never
// .env* or .git (those are refused before this policy runs). Binaries: headBytes 4 only.

import type { ReadPolicy } from "../paths.js";

export const SKILL_SCRIPT_POLICY: ReadPolicy = {
  readClass: "skill-script",
  label: "skill scripts",
  maxBytes: 1024 * 1024,
  refusal: (relPosix) => `${relPosix} is a skill script; scanning skill scripts is not enabled in this build`,
};
