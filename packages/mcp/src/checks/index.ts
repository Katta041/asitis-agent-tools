// The project checks lintProject runs after the per-file lint. Owner: WP0. Tracks fill in their
// own check file and set ready: true there; this list does not change.

import type { ProjectCheck } from "../project.js";
import { AGENT_CONFIG_CHECK } from "./agent-config.js";
import { DRIFT_CHECK } from "./drift.js";
import { SKILLS_CHECK } from "./skills.js";

export const PROJECT_CHECKS: readonly ProjectCheck[] = [DRIFT_CHECK, SKILLS_CHECK, AGENT_CONFIG_CHECK];
