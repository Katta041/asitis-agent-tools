// 0.2.5: short instructions count as rules, "Use X" against "Never use X" is a contradiction,
// and context_budget explains its two numbers and warns about a missing @import.
// The first fixture is the sample project from a real /asitis:md-lint run where 0.2.4
// reported neither the repeated `pnpm test` rule nor the adjacent "Use named exports" /
// "Never use named exports" pair.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, tempDir, type Connected } from "./helpers.js";

interface Issue {
  severity: string;
  rule: string;
  message: string;
  line: number;
}

function put(p: string, content: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

let t: ReturnType<typeof tempDir>;
let c: Connected;
const lint = async (p: string): Promise<Issue[]> => {
  const r = await c.call("lint_steering", { path: p });
  expect(r.isError, r.text).toBe(false);
  return (r.structured["files"] as Array<{ issues: Issue[] }>)[0]!.issues;
};
const of = (issues: Issue[], rule: string): Issue[] => issues.filter((i) => i.rule === rule);
const lines = (issues: Issue[], rule: string): number[] => of(issues, rule).map((i) => i.line);

/** Writes a CLAUDE.md under its own folder and returns its path. */
let n = 0;
function md(body: string[]): string {
  const rel = `case${++n}/CLAUDE.md`;
  put(path.join(t.dir, rel), body.join("\n") + "\n");
  return rel;
}

const SAMPLE = [
  "# Acme web app", // 1
  "",
  "@docs/missing.md", // 3
  "",
  "## Commands", // 5
  "- Run `pnpm test` before every commit", // 6
  "- Use `pnpm lint` to check style", // 7
  "",
  "## Code style", // 9
  "- Use named exports", // 10
  "- Never use named exports", // 11
  "- Run `pnpm test` before every commit", // 12
  "",
  "<!-- maintainer note: keep this short -->", // 14
  "",
  "## Testing", // 16
  "- Mock Stripe with `test/stripe-mock.ts`", // 17
];

beforeAll(async () => {
  t = tempDir("asitis-025-");
  put(path.join(t.dir, "acme/CLAUDE.md"), SAMPLE.join("\n") + "\n");
  put(path.join(t.dir, "acme/AGENTS.md"), "# Agents\n\nSee CLAUDE.md.\n");
  c = await connect([t.dir]);
});
afterAll(async () => {
  await c.close();
  t.cleanup();
});

describe("the sample project from the real run", () => {
  test("the repeated rule and the contradiction are both reported, naming both lines", async () => {
    const issues = await lint("acme/CLAUDE.md");
    expect(lines(issues, "duplicate-rule")).toEqual([12]);
    // Under two unrelated headings the copy may be a summary and its detail, so it is a note.
    expect(of(issues, "duplicate-rule")[0]!.severity).toBe("info");
    expect(of(issues, "duplicate-rule")[0]!.message).toBe(
      'Same rule as line 6, under another heading: "Run `pnpm test` before every commit". If one section summarises the other, or they never apply together, this can be on purpose; otherwise keep one',
    );
    expect(lines(issues, "contradiction")).toEqual([11]);
    expect(of(issues, "contradiction")[0]!.message).toBe('Contradicts line 10: line 10 says "Use named exports" and line 11 says "Never use named exports". Keep the one you mean');
  });
});

describe("short list items: instructions are rules, labels are not", () => {
  test.each([
    ["an imperative verb", "- Keep PRs small"],
    ["always", "- Always rebase first"],
    ["never", "- Never force-push"],
    ["don't", "- Don't commit .env"],
    ["must", "- Tests must pass"],
    ["should", "- PRs should be small"],
    ["an inline command", "- `pnpm test` before every push"],
    ["a nested imperative", "  - Use pnpm, not npm"],
  ])("%s repeated in another section is a duplicate", async (_why, item) => {
    const issues = await lint(md(["# A", "", "- Parent", item, "", "## B", "", "- Parent", item]));
    expect(lines(issues, "duplicate-rule")).toEqual([9]);
  });

  test.each([
    ["a noun label", "- Quality checklist"],
    ["a bold label", "- **Commands**"],
    ["a label ending with a colon", "- Run the tests:"],
    ["a label that starts with a noun-like verb", "- Commit messages"],
    ["use cases", "- Use cases"],
    ["a file path in code", "- `src/` source code"],
  ])("%s repeated in another section is structure, not a duplicate", async (_why, item) => {
    const issues = await lint(md(["# A", "", item, "", "## B", "", item]));
    expect(lines(issues, "duplicate-rule")).toEqual([]);
  });

  test("the same short instruction under two different parent bullets is a per-parent checklist", async () => {
    const issues = await lint(md(["# Pull requests", "", "- Feature PRs:", "  - Add a changelog entry", "  - Link the design doc", "- Bugfix PRs:", "  - Add a changelog entry", "  - Link the issue"]));
    expect(lines(issues, "duplicate-rule")).toEqual([]);
  });

  test("a long single-line paragraph repeated verbatim is a duplicate", async () => {
    const long = "When you change the public API you must update the schema, " + "regenerate the client and tell the integrations team about it, ".repeat(8) + "then release.";
    expect(long.length).toBeGreaterThan(400);
    const issues = await lint(md(["# API", "", long, "", "# Billing", "", long]));
    expect(lines(issues, "duplicate-rule")).toEqual([7]);
  });

  test("a nested label repeated under two parents is structure", async () => {
    const issues = await lint(md(["# A", "", "- Frontend", "  - Quality checklist", "- Backend", "  - Quality checklist"]));
    expect(lines(issues, "duplicate-rule")).toEqual([]);
  });

  test("headings and markup-only lines are never rules", async () => {
    const issues = await lint(md(["# Use pnpm everywhere", "", "</details>", "", "## Use pnpm everywhere", "", "</details>"]));
    expect(lines(issues, "duplicate-rule")).toEqual([]);
  });

  test("a short instruction that is also a sentence of a paragraph is a duplicate", async () => {
    const issues = await lint(md(["# A", "", "All tests must pass before merging. Run at minimum the unit tests.", "", "## B", "", "- All tests must pass before merging."]));
    expect(lines(issues, "duplicate-rule")).toEqual([7]);
  });
});

describe("contradictions", () => {
  test.each([
    ["Use X / Never use X", "- Use named exports", "- Never use named exports"],
    ["Use X / Don't use X", "- Use `any` in TypeScript", "- Don't use `any` in TypeScript"],
    ["Use X / Do not use X (curly apostrophe, case, backticks, punctuation)", "- use **Prettier** for formatting.", "- Do NOT use `prettier` for formatting!"],
    ["Always X / Never X", "- Always squash merge", "- Never squash merge"],
    ["Do X / Do not X", "- Do run the e2e suite locally", "- Do not run the e2e suite locally"],
    ["Never X first, then Use X", "- Never use default exports", "- Use default exports"],
    ["must / must not", "- You must sign commits", "- You must not sign commits"],
    ["short: Use tabs / Never use tabs", "- Use tabs", "- Never use tabs"],
    ["don’t with a curly apostrophe", "- Use semicolons", "- Don’t use semicolons"],
    ["Prefer X / Avoid X", "- Prefer class components for stateful widgets.", "- Avoid class components for stateful widgets."],
    ["sentences with periods", "- Use tabs.", "- Never use tabs."],
  ])("%s, adjacent lines", async (_why, a, b) => {
    const issues = await lint(md(["# Rules", "", a, b]));
    expect(lines(issues, "contradiction")).toEqual([4]);
    expect(of(issues, "contradiction")[0]!.message).toMatch(/^Contradicts line 3: line 3 says ".+" and line 4 says ".+"\. Keep the one you mean$/);
  });

  test("in different sections, reported on the later line", async () => {
    const issues = await lint(md(["# Style", "", "- Use named exports", "", "## Later", "", "Some text here.", "", "- Never use named exports"]));
    expect(lines(issues, "contradiction")).toEqual([9]);
    expect(of(issues, "contradiction")[0]!.message).toMatch(/^Contradicts line 3:/);
  });

  test("in paragraphs", async () => {
    const issues = await lint(md(["# Rules", "", "Always run the linter before you push. Keep it green.", "", "Never run the linter before you push."]));
    expect(lines(issues, "contradiction")).toEqual([5]);
  });

  test.each([
    ["different objects", "- Use tabs", "- Never use spaces"],
    ["different verbs", "- Use named exports", "- Never write named exports"],
    ["a longer negative", "- Use mocks", "- Never use mocks in integration tests"],
    ["a qualifier on the positive", "- Always use pnpm in CI", "- Never use pnpm"],
    ["two negatives", "- Never use var", "- Don't use var"],
    ["two positives", "- Use pnpm", "- Always use pnpm"],
    ["not an instruction", "- Named exports", "- Never named exports"],
    ["prefer against never", "- Prefer named exports", "- Never named exports"],
    ["use against avoid", "- Use named exports", "- Avoid named exports"],
  ])("not a contradiction: %s", async (_why, a, b) => {
    const issues = await lint(md(["# Rules", "", a, b]));
    expect(lines(issues, "contradiction")).toEqual([]);
  });

  test.each([
    ["a Don'ts heading", ["## Do", "", "- Never use default exports", "", "## Don'ts", "", "- Use default exports"]],
    ["an Avoid heading", ["## Rules", "", "- Never use default exports", "", "## Avoid", "", "- Use default exports"]],
    ["an Anti-patterns heading", ["## Rules", "", "- Never use default exports", "", "## Anti-patterns", "", "- Use default exports"]],
    ["a parent bullet that says avoid", ["## Rules", "", "- Never use default exports", "- Avoid:", "  - Use default exports"]],
    ["a lead-in paragraph that says avoid", ["## Rules", "", "- Never use default exports", "", "Things to avoid:", "", "- Use default exports"]],
  ])("an item in a list of things to avoid is not a 'do' rule: %s", async (_why, body) => {
    const issues = await lint(md(["# Style", "", ...body]));
    expect(lines(issues, "contradiction")).toEqual([]);
  });

  test("the context of a list of things to avoid ends at the next heading", async () => {
    const issues = await lint(md(["# Style", "", "## Avoid", "", "- Use default exports", "", "## Rules", "", "- Never use default exports", "- Use default exports"]));
    expect(lines(issues, "contradiction")).toEqual([10]);
    expect(of(issues, "contradiction")[0]!.message).toMatch(/^Contradicts line 9:/);
  });

  test("fenced code is never compared", async () => {
    const issues = await lint(md(["# Rules", "", "- Use named exports", "", "```md", "- Never use named exports", "```"]));
    expect(lines(issues, "contradiction")).toEqual([]);
  });
});

describe("context_budget", () => {
  let b: Connected;
  beforeAll(async () => {
    b = await connect([path.join(t.dir, "acme")]);
  });
  afterAll(async () => b.close());

  test("the project view explains why CLAUDE.md has two numbers and warns about the missing import", async () => {
    const r = await b.call("context_budget");
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/ {2}- CLAUDE\.md: about \d+ tokens, project instructions; the file is about \d+ tokens, but Claude Code strips block HTML comments before loading/);
    expect(r.text).toMatch(/Steering files by size \(whole file including comments\):/);
    expect(r.text).toContain("  - Warning: @docs/missing.md (CLAUDE.md, line 3) points to a file that does not exist, so nothing from it loads. Fix the path or remove the line");
    const cc = (r.structured["tools"] as Array<{ tool: string; warnings: string[] }>).find((x) => x.tool === "claude-code")!;
    expect(cc.warnings.filter((w) => w.includes("@docs/missing.md"))).toHaveLength(1);
  });

  test("the file view says what 'on its own' means and warns about the missing import", async () => {
    const r = await b.call("context_budget", { path: "CLAUDE.md" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/^CLAUDE\.md: about \d+ tokens on its own, without its @imports \(.*\)\. The whole file is about \d+ tokens; block HTML comments are not counted because Claude Code strips them before loading\./);
    expect(r.text).toContain("Warning: @docs/missing.md (CLAUDE.md, line 3) points to a file that does not exist, so nothing from it loads. Fix the path or remove the line");
  });

  test("a file without comments shows one number, and an npm-looking import gets no warning", async () => {
    const dir = path.join(t.dir, "plain");
    put(path.join(dir, "CLAUDE.md"), "# Plain\n\n- Use pnpm\n\nInstall @next/rspack-core first.\n");
    const p = await connect([dir]);
    try {
      const r = await p.call("context_budget", { path: "CLAUDE.md" });
      expect(r.text).not.toMatch(/whole file/);
      expect(r.text).not.toMatch(/Warning:/);
    } finally {
      await p.close();
    }
  });
});
