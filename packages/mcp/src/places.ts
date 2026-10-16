// Where a steering file sits, by its root-relative POSIX path. Several rules only make sense for a
// project's own instruction files: an AGENTS.md inside a skill folder is reference material the
// skill links to, a CLAUDE.md in examples/ belongs to a sample app, and a SKILL.md under tests/ is a
// fixture. These folder names come from the 0.3.0 real-repo review (71 repos, October 2026).

/**
 * Folders whose AGENTS.md or CLAUDE.md is material, not instructions for this repo: project
 * templates copied elsewhere, example and demo apps, test fixtures, generated temp output and
 * embedded assets (a product's own system prompt).
 */
const NOT_PROJECT_DIR = /^(?:templates?|scaffolds?|boilerplates?|starters?|examples?|example[_-]projects?|samples?|demos?|fixtures?|__fixtures__|test-fixtures|testdata|assets|tmp|temp(?:[_-][^/]*)?)$/i;

/** Folders that hold tests and their fixtures. */
const TEST_DIR = /^(?:tests?|__tests__|fixtures?|__fixtures__|test[_-]fixtures|testdata|test[_-]data)$/i;

/** Folders that hold templates meant to be copied and renamed. */
const TEMPLATE_DIR = /^(?:templates?|scaffolds?|boilerplates?|skill[_-]template)$/i;

const folders = (rel: string): string[] => rel.split("/").slice(0, -1);

/**
 * True for a file under a template, example, fixture or similar folder, or inside a skill
 * (skills/<name>/... or skill/<name>/...), where an AGENTS.md or CLAUDE.md is not a project
 * instruction file that an agent loads when it works in this repo.
 */
export function notProjectInstructions(rel: string): boolean {
  const parts = folders(rel);
  for (let i = 0; i < parts.length; i++) {
    if (NOT_PROJECT_DIR.test(parts[i]!)) return true;
    if ((parts[i] === "skills" || parts[i] === "skill") && i + 1 < parts.length) return true;
  }
  return false;
}

/** True for a file under a tests, fixtures or testdata folder. */
export function inTestTree(rel: string): boolean {
  return folders(rel).some((p) => TEST_DIR.test(p));
}

/** True when the file's own folder is a template folder ("template/SKILL.md"). */
export function inTemplateFolder(rel: string): boolean {
  const parts = folders(rel);
  return parts.length > 0 && TEMPLATE_DIR.test(parts[parts.length - 1]!);
}

/**
 * True for a SKILL.md whose folder sits directly in a skills folder (".claude/skills/x/SKILL.md",
 * "skills/x/SKILL.md") or at the top of the root ("x/SKILL.md"). A SKILL.md nested deeper inside
 * another skill's folder is a sub-skill of a pipeline and often named with its parent's prefix on
 * purpose.
 */
export function topLevelSkill(rel: string): boolean {
  const parts = folders(rel);
  if (parts.length <= 1) return true;
  const holder = parts[parts.length - 2]!;
  return holder === "skills" || holder === "skill";
}
