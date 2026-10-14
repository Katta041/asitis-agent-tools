// One fixer per fixable rule, keyed by rule id. Owner: WP7. Empty until WP7 lands.
// The registry marks which rules are fixable and how safe the fix is; a WP7 test should check
// that every rule with fixable set has an entry here.

import type { Fixer } from "../fix.js";

export const FIXERS: Readonly<Record<string, Fixer>> = {};
