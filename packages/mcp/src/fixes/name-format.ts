// name-format (review): rewrite name as lowercase letters, digits and single hyphens. Agent Skills
// spec, "name field" (https://agentskills.io/specification, read 14 October 2026). When the name has
// any non-ASCII character there is no fix, only a note: transliterating guesses at the name the
// author wants, and agnix issue #1127 showed a fixer silently dropping such characters.

import type { Fixer } from "../fix.js";
import { suggestSkillName } from "../lint.js";
import { setSkillName } from "./skill-name.js";
import { ASCII_SKILL_NAME, noFix, skillFolder, suggestion } from "./util.js";

export const fixNameFormat: Fixer = (doc, issue) => {
  const name = doc.frontmatter.data?.["name"];
  if (typeof name !== "string" && typeof name !== "number") return null;
  const n = String(name);
  if (/[^\x00-\x7f]/.test(n)) {
    return noFix(doc, issue, "review", "No fix: the name has non-ASCII characters, and only you can say which a-z name it should become. Choose one by hand.");
  }
  const guess = suggestSkillName(n);
  if (!guess) return null;
  // When the folder already has the kebab-case form of the name, use it, so one edit fixes both rules.
  const dir = skillFolder(doc);
  const target = dir && ASCII_SKILL_NAME.test(dir) && dir === guess ? dir : guess;
  const e = setSkillName(doc, issue.line, target);
  if (!e) return null;
  return suggestion(doc, issue, "review", `set name to ${JSON.stringify(target)}`, [e], `Claude Code uses name as the slash command, so the command becomes /${target}.`);
};
