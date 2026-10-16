// One fixer per fixable rule, keyed by rule id. Owner: WP7. The registry's fixable field says how
// safe each fix is; test/fix.test.ts checks that the two agree.

import type { Fixer } from "../fix.js";
import { fixBidiControl } from "./bidi-control.js";
import { fixFieldType } from "./field-type.js";
import { fixFinalNewline } from "./final-newline.js";
import { fixFrontmatterNotLine1 } from "./frontmatter-not-line-1.js";
import { fixFrontmatterValueCut } from "./frontmatter-value-cut.js";
import { fixHiddenInstruction } from "./hidden-instruction.js";
import { fixInvisibleChar } from "./invisible-char.js";
import { fixNameDirMismatch } from "./name-dir-mismatch.js";
import { fixNameFormat } from "./name-format.js";
import { fixTrailingWhitespace } from "./trailing-whitespace.js";
import { fixUnknownKey } from "./unknown-key.js";

export const FIXERS: Readonly<Record<string, Fixer>> = {
  "invisible-char": fixInvisibleChar,
  "bidi-control": fixBidiControl,
  "frontmatter-not-line-1": fixFrontmatterNotLine1,
  "frontmatter-value-cut": fixFrontmatterValueCut,
  "field-type": fixFieldType,
  "unknown-key": fixUnknownKey,
  "name-dir-mismatch": fixNameDirMismatch,
  "name-format": fixNameFormat,
  "hidden-instruction": fixHiddenInstruction,
  "trailing-whitespace": fixTrailingWhitespace,
  "final-newline": fixFinalNewline,
};
