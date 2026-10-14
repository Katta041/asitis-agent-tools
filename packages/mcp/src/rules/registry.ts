// The rule registry: one entry per rule id. Owner: WP0. Tracks add rules in their own *.meta.ts
// file and never edit this one. test/registry.test.ts checks that every id emitted in src/ is
// registered and active, and that every security rule is not inline-suppressible.

import type { Category } from "../findings.js";
import { AGENT_CONFIG_RULES } from "./agent-config.meta.js";
import { CORE_RULES } from "./core.meta.js";
import { DRIFT_RULES } from "./drift.meta.js";
import { SECURITY_RULES } from "./security.meta.js";
import { SKILLS_RULES } from "./skills.meta.js";
import { SPEC_RULES } from "./spec.meta.js";
import { SUPPRESS_RULES } from "./suppress.meta.js";
import type { RuleMeta } from "./types.js";

export type { RuleMeta, RuleStatus } from "./types.js";

/** Groups in a fixed order, so listings and SARIF rules[] are stable. */
export const RULE_GROUPS: ReadonlyArray<{ name: string; owner: string; rules: readonly RuleMeta[] }> = [
  { name: "core", owner: "WP0", rules: CORE_RULES },
  { name: "suppress", owner: "WP2", rules: SUPPRESS_RULES },
  { name: "drift", owner: "WP4", rules: DRIFT_RULES },
  { name: "skills", owner: "WP5", rules: SKILLS_RULES },
  { name: "agent-config", owner: "WP6", rules: AGENT_CONFIG_RULES },
  { name: "spec", owner: "unassigned", rules: SPEC_RULES },
  { name: "security", owner: "unassigned", rules: SECURITY_RULES },
];

export const RULES: ReadonlyMap<string, RuleMeta> = (() => {
  const m = new Map<string, RuleMeta>();
  for (const g of RULE_GROUPS) {
    for (const r of g.rules) {
      // A duplicate id is a programming error that a test catches; keep the first.
      if (!m.has(r.id)) m.set(r.id, r);
    }
  }
  return m;
})();

export const getRule = (id: string): RuleMeta | undefined => RULES.get(id);

/** Rules that some code emits today. Outputs (SARIF rules[], docs, config hints) list only these. */
export const activeRules = (): RuleMeta[] => [...RULES.values()].filter((r) => r.status === "active");

/** Category for a rule id. An unregistered id (a bug the registry test catches) counts as format. */
export const categoryOf = (id: string): Category => RULES.get(id)?.category ?? "format";

export const isSuppressibleInline = (id: string): boolean => RULES.get(id)?.suppressibleInline ?? false;
