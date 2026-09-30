// A parsed view of one opened file, shared by every tool.

import { classify, refineLoad, type Classified } from "./kinds.js";
import { readFrontmatter, type Frontmatter } from "./frontmatter.js";
import type { OpenedFile } from "./paths.js";
import { fenceMask } from "./scan.js";
import { decode, LineIndex, profile, type Profile } from "./text.js";

export interface Doc {
  file: OpenedFile;
  /** Display path (root-relative). */
  path: string;
  text: string;
  lines: LineIndex;
  profile: Profile;
  frontmatter: Frontmatter;
  fence: Uint8Array;
  kind: Classified;
}

export function analyse(file: OpenedFile, displayPath: string): Doc {
  const { text } = decode(file.buf);
  const lines = new LineIndex(text);
  const prof = profile(file.buf, text, lines);
  const frontmatter = readFrontmatter(lines);
  const fence = fenceMask(lines, frontmatter.present ? frontmatter.endLine : -1);
  const kind = refineLoad(classify(file.rel), frontmatter.present ? frontmatter.data : null);
  return { file, path: displayPath, text, lines, profile: prof, frontmatter, fence, kind };
}
