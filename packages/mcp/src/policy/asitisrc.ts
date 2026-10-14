// Read policy for .asitisrc.json. Owner: WP2.
// Stub: refuses every read until WP2 lands. The target policy (F5): only <root>/.asitisrc.json,
// or the file named by --config inside the root, at most 64 KB, JSON only.

import type { ReadPolicy } from "../paths.js";

export const ASITISRC_POLICY: ReadPolicy = {
  readClass: "asitisrc",
  label: "the AsItIs config file",
  maxBytes: 64 * 1024,
  refusal: (relPosix) => `${relPosix} is an AsItIs config file; reading it is not enabled in this build`,
};
