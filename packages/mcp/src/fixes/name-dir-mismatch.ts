// name-dir-mismatch (review): set name to the folder name. Agent Skills spec, "name field": it
// "must match the parent directory name" (https://agentskills.io/specification, read 14 October
// 2026). Review, not safe: in Claude Code the name field sets the slash command
// (https://code.claude.com/docs/en/skills, "How a skill gets its command name", read 14 October
// 2026), so the rename changes what people type. Renaming the folder instead is just as valid.

import type { Fixer } from "../fix.js";
import { setSkillName } from "./skill-name.js";
import { ASCII_SKILL_NAME, noFix, skillFolder, suggestion } from "./util.js";

export const fixNameDirMismatch: Fixer = (doc, issue) => {
  const dir = skillFolder(doc);
  if (!dir) return null;
  const name = doc.frontmatter.data?.["name"];
  if (typeof name === "string" && /[^\x00-\x7f]/.test(name)) {
    return noFix(doc, issue, "review", "No fix: the name has non-ASCII characters, so choose whether the folder or the name changes by hand.");
  }
  if (!ASCII_SKILL_NAME.test(dir)) {
    return noFix(doc, issue, "review", `No fix: the folder name ${JSON.stringify(dir)} is not a valid skill name itself, so rename the folder or the name by hand.`);
  }
  const e = setSkillName(doc, issue.line, dir);
  if (!e) return null;
  return suggestion(doc, issue, "review", `set name to ${JSON.stringify(dir)} to match its folder`, [e], `Claude Code uses name as the slash command, so the command becomes /${dir}. Rename the folder instead if you want to keep the current name.`);
};
