// @imports inside an HTML block (anthropics/claude-code#110857). Each case below was run in Claude
// Code 2.1.328 with `claude -p --tools ""` and a canary file holding "Marker: ALPHA-31"; "loads" is
// whether the marker reached the model. A line holding only a tag starts a CommonMark HTML block
// that runs to the next blank line, and Claude Code does not expand an @import inside one.
// Consecutive @import lines (#111064) loaded fine in a project CLAUDE.md on macOS, so they are not
// treated specially.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { extractImports, fenceMask, htmlBlockMask } from "../src/scan.js";
import { LineIndex } from "../src/text.js";
import { PKG, tempDir } from "./helpers.js";

const CLI = path.join(PKG, "dist/asitis.mjs");

/** Whether "@./a.md" in this CLAUDE.md text counts as an import for Claude Code. */
function loads(text: string): boolean {
  const lines = new LineIndex(text);
  const fence = fenceMask(lines);
  return extractImports(lines, fence, -1, htmlBlockMask(lines, fence)).some((im) => im.path === "./a.md");
}

// [name, CLAUDE.md, what Claude Code 2.1.328 did]
const CASES: Array<[string, string, boolean]> = [
  ["a tag line right above", "<role>\n@./a.md\nFirst paragraph.\n", false],
  ["after a blank line inside the tag", "<role>\nIntro.\n\n@./a.md\n</role>\n", true],
  ["no tag at all", "@./a.md\nFirst paragraph.\n", true],
  ["paragraph text, then the tag line", "Some text.\n<role>\n@./a.md\n", true],
  ["paragraph text, then <div>", "Some text.\n<div>\n@./a.md\n", false],
  ["a comment line above", "<!-- note -->\n@./a.md\n", true],
  ["an indented tag line", "   <role>\n@./a.md\n", false],
  ["a closing tag line", "</role>\n@./a.md\n", false],
  ["a tag with an attribute", '<role name="x">\n@./a.md\n', false],
  ["<div> right above", "<div>\n@./a.md\n", false],
  ["a text line between tag and import", "<role>\nIntro line.\n@./a.md\n", false],
  ["inline tags with text", "<b>Bold</b>\n@./a.md\n", true],
  ["a heading, then the tag line", "# Title\n<role>\n@./a.md\n", false],
  ["<details> then a blank line", "<details>\n\n@./a.md\n", true],
];

describe("htmlBlockMask matches what Claude Code loads", () => {
  test.each(CASES)("%s", (_name, text, cc) => {
    expect(loads(text)).toBe(cc);
  });

  test("a fenced block is not an HTML block, and a <pre> block ends at </pre>", () => {
    expect(loads("```\n<role>\n```\n@./a.md\n")).toBe(true);
    expect(loads("<pre>\n@./a.md\n</pre>\n")).toBe(false);
    expect(loads("<pre>\nx\n</pre>\n@./a.md\n")).toBe(true);
  });

  test("linear on a long run of tag-like lines", () => {
    const text = "<role>\n" + "<a b c d e f g h i j k l m n o p q r s t u v w x y z\n".repeat(20_000) + "@./a.md\n";
    const t0 = performance.now();
    loads(text);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe("lint and loads in a project", () => {
  const t = tempDir("asitis-imports-html-");
  afterAll(() => t.cleanup());
  const put = (rel: string, text: string): void => {
    mkdirSync(path.dirname(path.join(t.dir, rel)), { recursive: true });
    writeFileSync(path.join(t.dir, rel), text);
  };
  put("a.md", "Marker: ALPHA-31\n");
  put("b.md", "Marker: BRAVO-47\n");
  put("c.md", "Marker: CHARLIE-59\n");
  put("CLAUDE.md", "<role>\n@./a.md\nFirst paragraph of the role.\n\n@./b.md\n</role>\n\n@./c.md\n");
  put("gemini/a.md", "Marker: ALPHA-31\n");
  put("gemini/GEMINI.md", "<role>\n@./a.md\n</role>\n");
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: t.dir, encoding: "utf8", env: { ...process.env, ASITIS_DEBUG: "" } });

  test("lint warns on the skipped import only", () => {
    const r = run("lint", "--format", "json", "--fail-on", "never");
    const found = (JSON.parse(r.stdout).findings as Array<{ ruleId: string; path: string; line: number; message: string }>).filter((f) => f.ruleId === "broken-import");
    expect(found.map((f) => [f.path, f.line])).toEqual([["CLAUDE.md", 2]]);
    expect(found[0]!.message).toMatch(/is not loaded: Claude Code does not expand an @import inside an HTML block/);
    expect(found[0]!.message).toMatch(/line 1/);
  });

  test("loads lists b.md and c.md for Claude Code, not a.md", () => {
    const r = run("loads", "--tool", "claude-code");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/b\.md/);
    expect(r.stdout).toMatch(/c\.md/);
    expect(r.stdout).not.toMatch(/\ba\.md/);
  });
});
