// Read policy for AsItIs's own JSON files: .asitisrc.json (or the file --config names) and the
// file --baseline names. Owner: WP2.
//
// - JSON only (a .json name), so loading config never runs code.
// - Inside the root only. Sandbox already refuses anything that resolves outside every root;
//   config.ts and baseline.ts also refuse files under a second --root (the memory folder).
// - Size: .asitisrc.json is read only up to 64 KB. A --config or --baseline file may be read up to
//   4 MB here, because a baseline for a large repo can hold tens of thousands of fingerprints
//   (about 70 bytes each); config.ts then refuses any config file over 64 KB by itself.
// - Agent settings and MCP server lists are never read through this class: they belong to the
//   agent-config class, which is opt-in.

import type { ReadPolicy } from "../paths.js";

export const CONFIG_MAX_BYTES = 64 * 1024;
export const BASELINE_MAX_BYTES = 4 * 1024 * 1024;
export const CONFIG_FILE = ".asitisrc.json";

const base = (relPosix: string): string => relPosix.slice(relPosix.lastIndexOf("/") + 1).toLowerCase();

// Names that hold agent settings or credentials. They are JSON, but never AsItIs config.
const NOT_OURS = new Set(["settings.json", "settings.local.json", ".mcp.json", "mcp.json", "mcp_config.json", "package.json", "package-lock.json", "tsconfig.json"]);

export const ASITISRC_POLICY: ReadPolicy = {
  readClass: "asitisrc",
  label: "AsItIs config and baseline files",
  maxBytes: BASELINE_MAX_BYTES,
  maxBytesFor: (relPosix) => (base(relPosix) === CONFIG_FILE ? CONFIG_MAX_BYTES : BASELINE_MAX_BYTES),
  refusal: (relPosix) => {
    const b = base(relPosix);
    if (!b.endsWith(".json")) return `${relPosix} is not a .json file; AsItIs config and baseline files are JSON only`;
    if (NOT_OURS.has(b) || /credential|secret|token/.test(b)) return `${relPosix} is not an AsItIs config or baseline file; this server does not read it as one`;
    return null;
  },
};
