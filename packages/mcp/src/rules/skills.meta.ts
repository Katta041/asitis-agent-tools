// Skill folder security scan (F8). Owner: WP5. Flip status to active (use rule() instead of
// planned()) in the same commit that makes checks/skills.ts emit the rule.

import { planned, SRC, type RuleMeta } from "./types.js";

export const SKILLS_RULES: RuleMeta[] = [
  planned({ id: "sec-remote-exec", category: "security", defaultSeverity: "error", summary: "Downloads code and runs it (curl or wget piped to a shell, and similar)", why: "Download-and-run is the most common pattern in malicious skills. The note severity applies to install snippets in README.md.", source: SRC.toxicSkills }),
  planned({ id: "sec-encoded-blob", category: "security", defaultSeverity: "warning", summary: "Decodes base64 or hex and runs the result", why: "Encoding hides a payload from reviewers. Long base64 runs that decode to text matching other sec- rules show a decoded preview.", source: SRC.toxicSkills }),
  planned({ id: "sec-secret-egress", category: "security", defaultSeverity: "error", summary: "Reads a secret and sends data over the network in the same script or block", why: "A secret source (ssh keys, .env, cloud credentials, gh auth token) next to an egress sink is how credential stealers work.", source: SRC.toxicSkills }),
  planned({ id: "sec-skill-network", category: "security", defaultSeverity: "note", summary: "Skill script makes network calls", why: "Lists the hosts so a reviewer can judge them. Not a problem by itself.", source: SRC.toxicSkills }),
  planned({ id: "sec-skill-allowed-tools", category: "security", defaultSeverity: "warning", summary: "allowed-tools grants unscoped Bash, all tools or unscoped WebFetch", why: "A skill that runs with blanket tool access can do anything the user can, without a prompt.", source: SRC.skills }),
  planned({ id: "sec-skill-binary", category: "security", defaultSeverity: "warning", summary: "Executable binary inside a skill folder", why: "A binary cannot be reviewed as text. Only the first 4 bytes are read, to detect ELF, Mach-O or PE headers.", source: SRC.toxicSkills }),
  planned({ id: "sec-safety-off", category: "security", defaultSeverity: "warning", summary: "Turns off the agent's permission checks", why: "--dangerously-skip-permissions, --yolo and bypassPermissions are the step that turns a prompt injection into code execution (CVE-2025-53773). A negated sentence does not fire.", source: SRC.cve202553773 }),
];
