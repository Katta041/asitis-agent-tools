// Rules about .asitisrc.json and asitis-disable comments (F5). Owner: WP2. Flip status to active
// (use rule() instead of planned()) in the same commit that makes suppress.ts emit the rule.

import { planned, type RuleMeta } from "./types.js";

const F5 = "https://github.com/Katta041/asitis-agent-tools/blob/main/docs/cli-contract.md#suppression";

export const SUPPRESS_RULES: RuleMeta[] = [
  planned({ id: "suppression-not-allowed", category: "config", defaultSeverity: "warning", summary: "Inline suppression of a security rule", why: "A suppression comment is itself a hidden comment, so an attacker could add one next to a payload. Security rules can only be turned off in .asitisrc.json or the baseline, which show up in review.", source: F5 }),
  planned({ id: "unknown-suppression", category: "config", defaultSeverity: "warning", summary: "asitis-disable names a rule that does not exist", why: "A typo in the rule id means nothing is suppressed.", source: F5 }),
  planned({ id: "unused-suppression", category: "config", defaultSeverity: "note", summary: "asitis-disable comment suppresses nothing", why: "The finding it was for is gone, so the comment can go too.", source: F5 }),
];
