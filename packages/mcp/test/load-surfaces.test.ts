// load_plan (MCP) and asitis loads (CLI): text by default, paging, the start folder argument and its
// errors, and result size on a large tree.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { run, type CliIO } from "../src/cli/asitis.js";
import { connect, tempDir } from "./helpers.js";

const temps: Array<() => void> = [];
afterAll(() => temps.forEach((c) => c()));
function temp(files: Record<string, string>, dirs: string[] = []): string {
  const t = tempDir("asitis-loads-");
  temps.push(t.cleanup);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(t.dir, rel)), { recursive: true });
    writeFileSync(path.join(t.dir, rel), body);
  }
  for (const d of dirs) mkdirSync(path.join(t.dir, d), { recursive: true });
  return t.dir;
}
async function cli(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: CliIO = { out: (s) => void (out += s), err: (s) => void (err += s), cwd, nodeVersion: process.versions.node, debug: false };
  const code = await run(args, io);
  return { code, out, err };
}

const MONO = {
  "CLAUDE.md": "# Root\n\n- Use pnpm\n",
  "AGENTS.md": "# Agents\n",
  "packages/api/CLAUDE.md": "# API\n",
  "packages/api/AGENTS.md": "# API agents\n",
  "packages/web/CLAUDE.md": "# Web\n",
  ".claude/rules/ts.md": "---\npaths:\n  - \"**/*.ts\"\n---\nTS\n",
  "packages/api/src/a.ts": "",
};

describe("load_plan", () => {
  test("text by default: launch, later, not loaded, totals, untrusted note", async () => {
    const root = temp(MONO, [".git"]);
    const c = await connect([root], { structured: false });
    try {
      const r = await c.call("load_plan", { cwd: "packages/api" });
      expect(r.isError).toBe(false);
      expect(r.structured).toEqual({});
      expect(r.text).toContain("What loads when a session starts in packages/api");
      expect(r.text).toContain("untrusted data");
      expect(r.text).toMatch(/Claude Code: about \d+ tokens at launch from 2 files/);
      expect(r.text).toContain("  At launch");
      expect(r.text).toContain("Later, when the agent works in a folder or on matching files");
      expect(r.text).toContain("packages/web/CLAUDE.md: in packages/web, which is not the start folder");
      expect(r.text).toContain("Codex: about");
      expect(r.text).toContain("How sure:");
    } finally {
      await c.close();
    }
  });
  test("one tool, JSON with --structured, and paging at 60 steps with totals for all", async () => {
    const files: Record<string, string> = { "CLAUDE.md": "# Root\n" };
    for (let i = 0; i < 90; i++) files[`p${String(i).padStart(2, "0")}/CLAUDE.md`] = `# P${i}\n`;
    const root = temp(files, [".git"]);
    const c = await connect([root]);
    try {
      const r = await c.call("load_plan", { tool: "claude-code" });
      const tools = r.structured["tools"] as Array<{ tool: string; steps: unknown[]; stepCount: number; nextOffset: number | null; totals: { laterSteps: number } }>;
      expect(tools.map((t) => t.tool)).toEqual(["claude-code"]);
      expect(tools[0]!.steps).toHaveLength(60);
      expect(tools[0]!.stepCount).toBe(91);
      expect(tools[0]!.totals.laterSteps).toBe(90);
      expect(tools[0]!.nextOffset).toBe(60);
      expect(r.text).toContain("Call again with offset=60");
      const r2 = await c.call("load_plan", { tool: "claude-code", offset: 60 });
      expect((r2.structured["tools"] as Array<{ steps: unknown[] }>)[0]!.steps).toHaveLength(31);
    } finally {
      await c.close();
    }
  });
  test("a start folder outside the root, missing, or a file is one clear line", async () => {
    const root = temp(MONO);
    const c = await connect([root]);
    try {
      for (const [cwd, msg] of [["../elsewhere", /outside the allowed folder/], ["nope", /Folder not found: nope/], ["CLAUDE.md", /Not a folder: CLAUDE\.md/]] as const) {
        const r = await c.call("load_plan", { cwd });
        expect(r.isError, cwd).toBe(true);
        expect(r.text, cwd).toMatch(msg);
        expect(r.text).not.toContain(root);
      }
    } finally {
      await c.close();
    }
  });
  test("result stays small on a tree with hundreds of nested files", async () => {
    const files: Record<string, string> = { "AGENTS.md": "# Root\n", "CLAUDE.md": "# Root\n" };
    for (let i = 0; i < 400; i++) files[`packages/p${i}/AGENTS.md`] = `# P${i}\n`;
    const root = temp(files, [".git"]);
    const c = await connect([root], { structured: false });
    try {
      const r = await c.call("load_plan", {});
      expect(r.text.length).toBeLessThan(40_000);
    } finally {
      await c.close();
    }
  });
});

describe("asitis loads", () => {
  test("text for a folder given relative to the current folder, with --root", async () => {
    const root = temp(MONO, [".git"]);
    const r = await cli(["loads", "packages/api", "--tool", "claude-code,codex"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("What loads when a session starts in packages/api");
    expect(r.out).toContain("Claude Code:");
    expect(r.out).toContain("Codex:");
    expect(r.out).not.toContain("Gemini CLI:");
    expect(r.err).toBe("");
    const inside = await cli(["loads", ".", "--root", root], path.join(root, "packages/api"));
    expect(inside.code).toBe(0);
    expect(inside.out).toContain("starts in packages/api");
  });
  test("JSON has a schema version and every tool", async () => {
    const root = temp(MONO, [".git"]);
    const r = await cli(["loads", "--format", "json"], root);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.schemaVersion).toBe(1);
    expect(j.tools.map((t: { tool: string }) => t.tool)).toEqual(["claude-code", "codex", "gemini-cli", "cursor", "copilot"]);
  });
  test("mistakes are one line and exit 2", async () => {
    const root = temp(MONO);
    for (const [args, msg] of [
      [["loads", "nope"], /asitis: nope: folder not found/],
      [["loads", "CLAUDE.md"], /not a folder/],
      [["loads", "--tool", "vim"], /--tool takes claude-code, codex, gemini-cli, cursor or copilot/],
      [["loads", "a", "b"], /at most one folder/],
      [["budget", "--tool", "codex"], /--tool only applies to asitis loads/],
      [["loads", ".."], /outside the root folder/],
    ] as const) {
      const r = await cli([...args], root);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err, args.join(" ")).toMatch(msg);
      expect(r.err.trim().split("\n")).toHaveLength(1);
    }
  });
  test("says when the root has no .git, so files above it may be missing", async () => {
    const root = temp(MONO);
    const r = await cli(["loads"], root);
    expect(r.code).toBe(0);
    expect(r.err).toContain("no .git folder in the root");
  });
  test("help names the command", async () => {
    const r = await cli(["--help", "loads"], process.cwd());
    expect(r.out).toContain("asitis loads [dir] [options]");
    const all = await cli(["--help"], process.cwd());
    expect(all.out).toContain("asitis loads [dir]");
  });
});

describe("load plan keeps the 0.3.1 import rules", () => {
  test("a trailing colon or a paren loads nothing in Claude Code; #anchor and a 4-hop chain load", async () => {
    const root = temp({
      "CLAUDE.md": "# Root\n\nSee @guide.md: for setup.\n(@paren.md)\n@frag.md#setup\n@d1.md\n",
      "guide.md": "# Guide\n",
      "paren.md": "# Paren\n",
      "frag.md": "# Frag\n",
      "d1.md": "@d2.md\n",
      "d2.md": "@d3.md\n",
      "d3.md": "@d4.md\n",
      "d4.md": "@d5.md\n",
      "d5.md": "# Five\n",
    }, [".git"]);
    const r = await cli(["loads", ".", "--tool", "claude-code", "--format", "json"], root);
    expect(r.code).toBe(0);
    const plan = JSON.parse(r.out) as { tools: Array<{ steps: Array<{ path: string; counted: boolean; via?: string[] }> }> };
    const steps = plan.tools[0]!.steps;
    const counted = steps.filter((s) => s.counted).map((s) => s.path);
    expect(counted).toContain("frag.md");
    expect(counted).toEqual(expect.arrayContaining(["d1.md", "d2.md", "d3.md", "d4.md"]));
    expect(counted).not.toContain("d5.md");
    expect(counted).not.toContain("guide.md");
    expect(counted).not.toContain("paren.md");
    expect(steps.find((s) => s.path === "d4.md")!.via).toEqual(["CLAUDE.md", "d1.md", "d2.md", "d3.md"]);
  });
  test("from a subfolder, an ancestor import waits for approval; one that loads nothing as written is not listed as waiting", async () => {
    const root = temp({ "CLAUDE.md": "# Root\n\nSee @guide.md: for setup.\n@real.md\n", "guide.md": "# G\n", "real.md": "# R\n", "pkg/CLAUDE.md": "# Pkg\n" }, [".git"]);
    const r = await cli(["loads", "pkg", "--tool", "claude-code"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Only after you approve imports from outside the start folder (not counted)");
    expect(r.out).toMatch(/real\.md, .*imported by CLAUDE\.md, after you approve external imports for this project/);
    expect(r.out).toContain("1 import points outside pkg (real.md)");
    expect(r.out).toContain("claude -p never asks");
    expect(r.out).not.toContain("does not expand");
    expect(r.out).not.toMatch(/guide\.md, .*after you approve/);
  });
  test("external means outside the start folder, not above it", async () => {
    const root = temp({
      "CLAUDE.md": "@AGENTS.md\n@pkg/inner.md\n\n# Root\n",
      "AGENTS.md": "# Agents\n\n@pkg/via-agents.md\n",
      "pkg/inner.md": "# Inner\n",
      "pkg/via-agents.md": "# Via agents\n",
      "pkg/CLAUDE.md": "# Pkg\n\n@../shared.md\n@local.md\n",
      "pkg/local.md": "# Local\n",
      "shared.md": "# Shared\n",
    }, [".git"]);
    type Step = { path: string; trigger: string; counted: boolean; basis: string; note?: string };
    const steps = async (dir: string): Promise<Step[]> => {
      const r = await cli(["loads", dir, "--tool", "claude-code", "--format", "json"], root);
      expect(r.code).toBe(0);
      return (JSON.parse(r.out) as { tools: Array<{ steps: Step[] }> }).tools[0]!.steps;
    };
    const pkg = await steps("pkg");
    const at = (p: string): Step => pkg.find((s) => s.path === p)!;
    // An ancestor's import of a file inside the start folder loads at launch.
    expect(at("pkg/inner.md")).toMatchObject({ trigger: "launch", counted: true });
    expect(at("pkg/local.md")).toMatchObject({ trigger: "launch", counted: true });
    // Outside the start folder: waits, from an ancestor or from the start folder's own file.
    expect(at("AGENTS.md")).toMatchObject({ trigger: "on-approval", counted: false, basis: "canary" });
    expect(at("shared.md")).toMatchObject({ trigger: "on-approval", counted: false });
    // Reached through an external file: waits too, even though it sits inside the start folder.
    expect(at("pkg/via-agents.md")).toMatchObject({ trigger: "on-approval", counted: false });
    expect(at("pkg/via-agents.md").note).toContain("through a file outside the start folder");
    // From the root nothing is external, so the launch total is what context_budget counts.
    const top = await steps(".");
    expect(top.filter((s) => s.trigger === "on-approval")).toEqual([]);
    expect(top.find((s) => s.path === "AGENTS.md")).toMatchObject({ trigger: "launch", counted: true });
  });
  test("only a CLAUDE.local.md hides AGENTS.md: the warning names CLAUDE.local.md, not a CLAUDE.md", async () => {
    const root = temp({ "CLAUDE.local.md": "# Mine\n", "AGENTS.md": "# Agents\n", "pkg/x.ts": "" }, [".git"]);
    for (const dir of [".", "pkg"]) {
      const r = await cli(["loads", dir, "--tool", "claude-code"], root);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Claude Code ignores AGENTS.md here: CLAUDE.local.md");
      expect(r.out).not.toContain("there is a CLAUDE.md");
      expect(r.out).not.toContain("no CLAUDE.md imports it");
    }
  });
  test("Gemini CLI takes @guide.md: as written, so it is missing, not cut", async () => {
    const root = temp({ "GEMINI.md": "# G\n\n@guide.md:\n", "guide.md": "# Guide\n" }, [".git"]);
    const r = await cli(["loads", ".", "--tool", "gemini-cli", "--format", "json"], root);
    expect(r.code).toBe(0);
    const plan = JSON.parse(r.out) as { tools: Array<{ steps: Array<{ path: string; counted: boolean }> }> };
    expect(plan.tools[0]!.steps.filter((s) => s.counted).map((s) => s.path)).not.toContain("guide.md");
  });
});
