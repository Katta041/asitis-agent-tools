// Precision fixes from the 0.4.0 corpus review (71 public repos, 900 errors and warnings, 69.6%
// worth fixing in 0.3.0). Each false-positive pattern has a negative case here and each kind of
// true finding kept has a positive one. Fixtures are synthetic.

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { Deadline } from "../src/discover.js";
import { fingerprint, FingerprintCounter, type Finding } from "../src/findings.js";
import { CAPS } from "../src/limits.js";
import { Sandbox } from "../src/paths.js";
import { lintProject } from "../src/project.js";
import { tempDir } from "./helpers.js";

const temps: Array<() => void> = [];
afterAll(() => temps.forEach((c) => c()));

function project(files: Record<string, string>): string {
  const t = tempDir("asitis-prec4-");
  temps.push(t.cleanup);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(t.dir, rel)), { recursive: true });
    writeFileSync(path.join(t.dir, rel), body);
  }
  return t.dir;
}

async function lint(root: string): Promise<Finding[]> {
  const sandbox = await Sandbox.create([root]);
  const p = await lintProject(sandbox, { deadline: new Deadline(CAPS.callBudgetMs), maxFiles: CAPS.walkMaxFiles });
  return p.findings();
}
const of = (fs: Finding[], rule: string, sev?: Finding["severity"]): Finding[] => fs.filter((f) => f.ruleId === rule && (!sev || f.severity === sev));
const skill = (name: string, body: string, extra = ""): string => `---\nname: ${name}\ndescription: Does one thing. Use when asked for it.\n${extra}---\n\n${body}\n`;

describe("broken-link", () => {
  test("a target rendered from a template next to it is not broken; a missing one still is", async () => {
    const root = project({
      ".claude/skills/q/SKILL.md": skill("q", "Read [models](./references/models.md), [jinja](references/b.md), [hbs](references/c.md) and [gone](references/gone.md)."),
      ".claude/skills/q/references/models.md.j2": "# x\n",
      ".claude/skills/q/references/b.md.jinja": "# x\n",
      ".claude/skills/q/references/c.md.hbs": "# x\n",
    });
    const f = of(await lint(root), "broken-link", "warning");
    expect(f.map((x) => x.message)).toEqual([expect.stringContaining('"references/gone.md"')]);
  });
  test("{baseDir} is the skill folder: the rest of the path is checked from there", async () => {
    const root = project({
      ".claude/skills/a/SKILL.md": skill("a", "See [x]({baseDir}/references/x.md) and [y](${CLAUDE_SKILL_DIR}/y.md) and [z]({baseDir}/references/z.md)."),
      ".claude/skills/a/references/x.md": "# x\n",
      ".claude/skills/a/y.md": "# y\n",
    });
    const f = of(await lint(root), "broken-link", "warning");
    expect(f.map((x) => x.message)).toEqual([expect.stringContaining('"{baseDir}/references/z.md"')]);
  });
  test("placeholders, an ellipsis and escaped brackets are not links", async () => {
    const root = project({
      "CLAUDE.md": [
        "# Notes",
        "",
        "Write \"See [ADR 1](...) for details\" or \"[PR](…)\" in the reply.",
        "Open [the repo]({repo}/docs/x.md) or [ticket](<ticket url>) or [x](<%= url %>).",
        "Use the \\[forwardPorts property\\](#nowhere) instead.",
        "But [this](#really-missing) is broken.",
        "",
      ].join("\n"),
    });
    const f = of(await lint(root), "broken-link", "warning");
    expect(f.map((x) => x.message)).toEqual([expect.stringContaining('"#really-missing"')]);
  });
  test("../blob/<ref>/path written for a PR comment is checked from the repository root", async () => {
    const root = project({
      "CONTRIBUTING.md": "# Contributing\n",
      ".claude/skills/r/SKILL.md": skill("r", "> Per our [guide](../blob/main/CONTRIBUTING.md) and [old](../blob/main/MISSING.md)."),
    });
    const f = of(await lint(root), "broken-link", "warning");
    expect(f.map((x) => x.message)).toEqual([expect.stringContaining('"../blob/main/MISSING.md"')]);
  });
});

describe("unknown-key", () => {
  test("a spelling variant is a warning in folders Claude Code or a spec reader loads", async () => {
    const root = project({
      ".claude/skills/a/SKILL.md": skill("a", "Body.", "user_invocable: true\n"),
      "skills/b/SKILL.md": skill("b", "Body.", "allowed_tools: Read\n"),
      "plugins/p/skills/c/SKILL.md": skill("c", "Body.", "allowedTools: Read\n"),
      ".agents/skills/d/SKILL.md": skill("d", "Body.", "allowed_tools: Read\n"),
    });
    const f = await lint(root);
    expect(of(f, "unknown-key", "warning").map((x) => x.path).sort()).toEqual([".agents/skills/d/SKILL.md", ".claude/skills/a/SKILL.md", "plugins/p/skills/c/SKILL.md", "skills/b/SKILL.md"]);
  });
  test("elsewhere the repo's own loader reads the file, so it is a note", async () => {
    const root = project({
      ".qwen/skills/a/SKILL.md": skill("a", "Body.", "allowedTools: Read\n"),
      "products/signals/skills/b/SKILL.md": skill("b", "Body.", "allowed_tools: Read\n"),
      "packages/core/src/skills/bundled/c/SKILL.md": skill("c", "Body.", "allowedTools: Read\n"),
    });
    const f = await lint(root);
    expect(of(f, "unknown-key", "warning")).toEqual([]);
    expect(of(f, "unknown-key", "note")).toHaveLength(3);
    expect(of(f, "unknown-key", "note")[0]!.message).toMatch(/outside the folders they load skills from/);
  });
  test("compatibility over 500 characters: a warning in a skill folder, a note outside", async () => {
    const long = `compatibility: ${"x".repeat(520)}\n`;
    const root = project({ ".claude/skills/a/SKILL.md": skill("a", "Body.", long), "products/x/skills/b/SKILL.md": skill("b", "Body.", long) });
    const f = await lint(root);
    expect(of(f, "compatibility-too-long", "warning").map((x) => x.path)).toEqual([".claude/skills/a/SKILL.md"]);
    expect(of(f, "compatibility-too-long", "note").map((x) => x.path)).toEqual(["products/x/skills/b/SKILL.md"]);
  });
});

describe("skill names with a plugin prefix", () => {
  test("plugin:folder is a note and not a folder mismatch; other colons stay errors", async () => {
    const root = project({
      ".claude/plugins/n/skills/setup/SKILL.md": skill("n:setup", "Body."),
      ".claude/skills/other/SKILL.md": skill("n:something-else", "Body."),
      ".claude/skills/bad/SKILL.md": skill("Bad:Name", "Body."),
    });
    const f = await lint(root);
    expect(of(f, "name-format", "note").map((x) => x.path)).toEqual([".claude/plugins/n/skills/setup/SKILL.md"]);
    expect(of(f, "name-format", "error").map((x) => x.path).sort()).toEqual([".claude/skills/bad/SKILL.md", ".claude/skills/other/SKILL.md"]);
    expect(of(f, "name-dir-mismatch").map((x) => x.path).sort()).toEqual([".claude/skills/bad/SKILL.md", ".claude/skills/other/SKILL.md"]);
  });
});

describe("duplicate-rule", () => {
  test("paths in code spans keep their case", async () => {
    const root = project({ "CLAUDE.md": "# PRs\n\n- Check `.github/pull_request_template.md`\n- Check `.github/PULL_REQUEST_TEMPLATE.md`\n- Check `.github/pull_request_template.md`\n" });
    expect(of(await lint(root), "duplicate-rule", "warning").map((x) => x.line)).toEqual([5]);
  });
  test("one sentence shared by two different paragraphs is a note; a repeated paragraph is a warning", async () => {
    const root = project({
      "CLAUDE.md": [
        "# Checks",
        "",
        "The first check covers every scenario that ran. A failed check changes the verdict.",
        "",
        "The second check lists the nodes that ran with their counts. A failed check changes the verdict.",
        "",
        "Run the linter before you push. Fix what it reports.",
        "",
        "Run the linter before you push. Fix what it reports.",
        "",
      ].join("\n"),
    });
    const f = of(await lint(root), "duplicate-rule");
    expect(f.filter((x) => x.severity === "warning").map((x) => x.line)).toEqual([9]);
    expect(f.filter((x) => x.severity === "note").map((x) => [x.line, x.message.startsWith("Same sentence as line 3")])).toEqual([[5, true]]);
  });
  test("steps shared by two procedures are fine; a copied run of steps and repeated bullets are not", async () => {
    const root = project({
      "CLAUDE.md": [
        "# Smoke test",
        "",
        "1. Open the page",
        "2. Wait for execution to complete",
        "3. Check the output",
        "4. Open the other page",
        "5. Wait for execution to complete",
        "",
        "- [ ] Click Submit",
        "- [ ] Wait for the toast to disappear",
        "- [ ] Click Run",
        "- [ ] Wait for the toast to disappear",
        "",
        "- Never commit secrets to the repo",
        "- Never commit secrets to the repo",
        "",
      ].join("\n"),
    });
    expect(of(await lint(root), "duplicate-rule", "warning").map((x) => x.line)).toEqual([15]);
  });
  test("a sub-item under two different parents belongs to each parent", async () => {
    const root = project({
      "CLAUDE.md": [
        "# Docs",
        "",
        "- Use `<param>` to describe method parameters.",
        "  - The description should be a noun phrase that does not name the data type.",
        "- Use `<returns>` to describe what the method returns.",
        "  - The description should be a noun phrase that does not name the data type.",
        "",
      ].join("\n"),
    });
    expect(of(await lint(root), "duplicate-rule", "warning")).toEqual([]);
  });
});

describe("broken-import", () => {
  test("template placeholders and possessives are not imports; a missing file still is", async () => {
    const root = project({ "CLAUDE.md": "# A\n\nSee @<CONTEXT_DIR>/team.md and @{dir}/x.md.\nWe match @babel/parser's output.\nRead @docs/missing.md first.\n" });
    const f = of(await lint(root), "broken-import", "warning");
    expect(f.map((x) => x.message)).toEqual([expect.stringContaining('"@docs/missing.md"')]);
  });
});

describe("length", () => {
  test("a CLAUDE.md that is a symlink to an AGENTS.md reports its size as a note", async () => {
    const body = "# Rules\n\n" + Array.from({ length: 320 }, (_, i) => `- Rule number ${i} says something different`).join("\n") + "\n";
    const root = project({ "pkg/AGENTS.md": body, "other/CLAUDE.md": body });
    try {
      symlinkSync("AGENTS.md", path.join(root, "pkg/CLAUDE.md"));
    } catch {
      return; // no symlinks on this system (Windows without developer mode)
    }
    const f = of(await lint(root), "length");
    expect(f.filter((x) => x.path === "pkg/CLAUDE.md").map((x) => x.severity)).toEqual(["note"]);
    expect(f.filter((x) => x.path === "other/CLAUDE.md").map((x) => x.severity)).toEqual(["warning"]);
  });
});

describe("agents-md-shadowed", () => {
  test("an AGENTS.md under .agents/ is never read by Claude Code, so a CLAUDE.md is not what hides it", async () => {
    const root = project({ "CLAUDE.md": "# A\n\nRun the tests.\n", ".agents/skills/AGENTS.md": "# Skills\n\nKeep skills short.\n", "docs/AGENTS.md": "# Docs\n\nWrite short pages.\n" });
    expect(of(await lint(root), "agents-md-shadowed").map((x) => x.path)).toEqual(["docs/AGENTS.md"]);
  });
});

describe("fingerprints", () => {
  test("FingerprintCounter gives what fingerprint() gives, occurrences included", () => {
    const text = ["  a  b ", "x", "a b", "a\tb\r"];
    const c = new FingerprintCounter("f.md", (l) => text[l - 1] ?? "");
    const seq = [
      { rule: "r", line: 1 },
      { rule: "r", line: 3 },
      { rule: "s", line: 1 },
      { rule: "r", line: 4 },
      { rule: "r", line: 2, fingerprintText: "  x " },
    ];
    expect(seq.map((i) => c.next(i))).toEqual([fingerprint("r", "f.md", "a b", 0), fingerprint("r", "f.md", "a b", 1), fingerprint("s", "f.md", "a b", 0), fingerprint("r", "f.md", "a b", 2), fingerprint("r", "f.md", "x", 0)]);
  });
});
