// WP4 drift and sync rules (F7): one fixture per rule under test-fixtures/drift, positives and
// negatives, a benign corpus with no findings at all, symlinks and the Codex chain built in a temp
// folder, and a 2,000-file run under the 20 s call budget.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { Deadline } from "../src/discover.js";
import type { Finding } from "../src/findings.js";
import { CAPS } from "../src/limits.js";
import { Sandbox } from "../src/paths.js";
import { lintProject } from "../src/project.js";
import { connect, FIXTURES, tempDir } from "./helpers.js";

const DRIFT = path.join(FIXTURES, "drift");
const DRIFT_IDS = new Set(["agents-md-shadowed", "claude-local-hides-agents-md", "agents-md-unread-variant", "cross-file-contradiction", "instruction-drift", "codex-chain-over-budget"]);

async function lint(root: string, targets: string[] = []): Promise<Finding[]> {
  const sandbox = await Sandbox.create([root]);
  const p = await lintProject(sandbox, { deadline: new Deadline(CAPS.callBudgetMs), targets: targets.map((t) => path.join(root, t)), maxFiles: CAPS.walkMaxFiles });
  return p.findings();
}
const drift = async (name: string, targets: string[] = []): Promise<Finding[]> => (await lint(path.join(DRIFT, name), targets)).filter((f) => DRIFT_IDS.has(f.ruleId));
const short = (fs: Finding[]): string[] => fs.map((f) => `${f.path}:${f.line} ${f.ruleId}`);

const temps: Array<() => void> = [];
afterAll(() => temps.forEach((c) => c()));
function temp(files: Record<string, string>): string {
  const t = tempDir("asitis-drift-");
  temps.push(t.cleanup);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(t.dir, rel)), { recursive: true });
    writeFileSync(path.join(t.dir, rel), body);
  }
  return t.dir;
}
/** Makes a file symlink, or returns false where the OS does not allow it (Windows without developer mode). */
function link(target: string, at: string): boolean {
  try {
    symlinkSync(target, at, "file");
    return true;
  } catch {
    return false;
  }
}

describe("agents-md-shadowed", () => {
  test("a CLAUDE.md that neither imports nor links AGENTS.md shadows it", async () => {
    const fs = await drift("shadowed");
    expect(short(fs)).toEqual(["AGENTS.md:1 agents-md-shadowed"]);
    expect(fs[0]!.severity).toBe("warning");
    expect(fs[0]!.category).toBe("drift");
    expect(fs[0]!.message).toContain("Add the line @AGENTS.md to CLAUDE.md");
    expect(fs[0]!.message).toContain("claude-md-and-agents-md");
  });

  test("a CLAUDE.md that imports @AGENTS.md is not a finding", async () => {
    expect(await drift("imports")).toEqual([]);
  });

  test("a CLAUDE.md symlinked to AGENTS.md is not a finding, either direction", async (ctx) => {
    const body = "# Shared\n\n- Run `pnpm test` before every commit.\n- Use TypeScript strict mode.\n";
    const a = temp({ "AGENTS.md": body });
    const b = temp({ "CLAUDE.md": body });
    if (!link("AGENTS.md", path.join(a, "CLAUDE.md")) || !link("CLAUDE.md", path.join(b, "AGENTS.md"))) return ctx.skip();
    expect(await lint(a).then((f) => f.filter((x) => DRIFT_IDS.has(x.ruleId)))).toEqual([]);
    expect(await lint(b).then((f) => f.filter((x) => DRIFT_IDS.has(x.ruleId)))).toEqual([]);
  });

  test("a CLAUDE.md that is an exact copy of AGENTS.md is not a finding", async () => {
    const body = "# Guide\n\n- Run `make v8-test` after changes here.\n";
    const root = temp({ "AGENTS.md": body, "CLAUDE.md": body });
    expect((await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId))).toEqual([]);
  });

  test("an import through another file (two hops) counts", async () => {
    const root = temp({ "AGENTS.md": "- Run `pnpm test` before every commit.\n", "CLAUDE.md": "@docs/agents.md\n", "docs/agents.md": "@../AGENTS.md\n" });
    expect((await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId))).toEqual([]);
  });

  test("nested folders: a CLAUDE.md below does not shadow the root AGENTS.md; one beside does", async () => {
    const fs = await drift("nested");
    // nested/AGENTS.md: no CLAUDE.md at the root or above, so Claude Code reads it.
    // pkg/AGENTS.md: pkg/CLAUDE.md beside it. pkg2: its CLAUDE.md imports it. .claude-in: .claude/CLAUDE.md imports ../AGENTS.md.
    expect(short(fs)).toEqual(["pkg/AGENTS.md:1 agents-md-shadowed"]);
    expect(fs[0]!.message).toContain("pkg/CLAUDE.md");
  });

  test("a nested AGENTS.md under a root CLAUDE.md gets the nested fix", async () => {
    const root = temp({ "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": "- Run `pnpm test` before every commit.\n", "svc/AGENTS.md": "- Run `make svc-test` for this service.\n" });
    const fs = (await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId));
    expect(short(fs)).toEqual(["svc/AGENTS.md:1 agents-md-shadowed"]);
    expect(fs[0]!.message).toContain("Add a CLAUDE.md next to it with the line @AGENTS.md");
  });

  test("an AGENTS.md shipped inside a skill folder is skill material, not a finding", async () => {
    const root = temp({
      "CLAUDE.md": "- Run `pnpm test` before every commit.\n",
      ".claude/skills/react/SKILL.md": "---\nname: react\ndescription: React rules, used when editing components.\n---\nSee AGENTS.md.\n",
      ".claude/skills/react/AGENTS.md": "- Use function components.\n".repeat(3000),
    });
    expect((await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId))).toEqual([]);
  });

  test("a CLAUDE.md that only mentions AGENTS.md in a sentence still shadows it, and the message says why", async () => {
    const root = temp({ "AGENTS.md": "- Run `pnpm test` before every commit.\n", "CLAUDE.md": "Read `AGENTS.md` for the project rules.\n" });
    const fs = (await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId));
    expect(short(fs)).toEqual(["AGENTS.md:1 agents-md-shadowed"]);
    expect(fs[0]!.message).toContain("mentioning AGENTS.md in a sentence does not load it");
  });

  test("many nested AGENTS.md files shadowed by one CLAUDE.md give one finding that names the rest", async () => {
    const files: Record<string, string> = { "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": "- Run `pnpm test` before every commit.\n" };
    for (const p of ["a", "b", "c", "d", "e"]) files[`packages/${p}/AGENTS.md`] = `- Run \`make ${p}\` here.\n`;
    const fs = (await lint(temp(files))).filter((f) => DRIFT_IDS.has(f.ruleId));
    expect(short(fs)).toEqual(["packages/a/AGENTS.md:1 agents-md-shadowed"]);
    expect(fs[0]!.message).toContain("and 4 more (packages/b/AGENTS.md, packages/c/AGENTS.md and 2 others)");
  });

  test("templates, examples, fixtures and assets are material, not instructions for this repo", async () => {
    const root = temp({
      "CLAUDE.md": "@AGENTS.md\n",
      "AGENTS.md": "- Run `pnpm test` before every commit.\n",
      "templates/app/AGENTS.md": "- Run `npm test` in the new app.\n",
      "example_projects/Weather/AGENTS.md": "- Use the weather skill.\n",
      "internal/assets/AGENTS.md": "You are the product assistant.\n",
      "cli/temp_e2e_test/AGENTS.md": "- Generated.\n",
    });
    expect((await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId))).toEqual([]);
  });

  test("works when only AGENTS.md is named (pre-commit style)", async () => {
    expect(short(await drift("shadowed", ["AGENTS.md"]))).toEqual(["AGENTS.md:1 agents-md-shadowed"]);
  });
});

describe("claude-local-hides-agents-md", () => {
  test("only CLAUDE.local.md switches the fallback off", async () => {
    const fs = await drift("local-only");
    expect(short(fs)).toEqual(["AGENTS.md:1 claude-local-hides-agents-md"]);
    expect(fs[0]!.message).toContain("CLAUDE.local.md switches off");
  });

  test("CLAUDE.local.md that imports AGENTS.md is fine", async () => {
    const root = temp({ "AGENTS.md": "- Run `pnpm test` before every commit.\n", "CLAUDE.local.md": "@AGENTS.md\n- My port is 5433.\n" });
    expect((await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId))).toEqual([]);
  });

  test(".claude/CLAUDE.local.md does not count (Claude Code does not read it)", async () => {
    const root = temp({ "AGENTS.md": "- Run `pnpm test` before every commit.\n", ".claude/CLAUDE.local.md": "- My port is 5433.\n" });
    expect((await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId))).toEqual([]);
  });
});

describe("agents-md-unread-variant", () => {
  test("AGENTS.override.md, AGENTS.local.md and an unlinked .agents/*.md each get a note; a linked one does not", async () => {
    const fs = await drift("variants");
    expect(short(fs)).toEqual([".agents/notes.md:1 agents-md-unread-variant", "AGENTS.local.md:1 agents-md-unread-variant", "AGENTS.override.md:1 agents-md-unread-variant"]);
    expect(fs.every((f) => f.severity === "note")).toBe(true);
    expect(fs.find((f) => f.path === "AGENTS.override.md")!.message).toContain("instead of the AGENTS.md beside it");
    expect(fs.every((f) => /^[0-9a-f]{64}$/.test(f.fingerprint ?? ""))).toBe(true);
  });

  test("an override without an AGENTS.md beside it says only Codex reads it", async () => {
    const root = temp({ "CLAUDE.md": "- Run `pnpm test` before every commit.\n", "AGENTS.override.md": "- Run `make test` instead.\n" });
    const fs = (await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId));
    expect(short(fs)).toEqual(["AGENTS.override.md:1 agents-md-unread-variant"]);
    expect(fs[0]!.message).toMatch(/^Only Codex reads/);
  });

  test(".agents/skills is not flagged (only files directly in .agents/)", async () => {
    const root = temp({ "AGENTS.md": "- Run `pnpm test` before every commit.\n", ".agents/skills/x/SKILL.md": "---\nname: x\ndescription: Does x when asked.\n---\nBody\n" });
    expect((await lint(root)).filter((f) => f.ruleId === "agents-md-unread-variant")).toEqual([]);
  });
});

describe("cross-file-contradiction", () => {
  test("AGENTS.md against GEMINI.md", async () => {
    const fs = await drift("contradiction");
    expect(short(fs)).toEqual(["GEMINI.md:3 cross-file-contradiction"]);
    expect(fs[0]!.message).toContain('that file says "Always use tabs for indentation in Go files"');
  });

  test("two files Claude Code loads together", async () => {
    const fs = await drift("contradiction-same-tool");
    expect(short(fs)).toEqual(["CLAUDE.md:3 cross-file-contradiction"]);
    expect(fs[0]!.message).toContain("Claude Code loads both files");
  });

  test("a nested AGENTS.md that overrides the root one is not a finding (closer files override by design)", async () => {
    expect(await drift("contradiction-nested")).toEqual([]);
  });

  test("not reported when only one of the two files is named", async () => {
    expect(await drift("contradiction", ["GEMINI.md"])).toEqual([]);
  });
});

describe("instruction-drift", () => {
  test("mirrored files with three differing rules list exactly those three", async () => {
    const fs = await drift("mirrored");
    expect(short(fs)).toEqual(["AGENTS.md:8 instruction-drift", "AGENTS.md:13 instruction-drift", "GEMINI.md:12 instruction-drift"]);
    expect(fs[0]!.message).toContain("70% of their rules match");
    expect(fs.every((f) => f.severity === "note")).toBe(true);
  });

  test("unrelated files below the Jaccard threshold stay silent", async () => {
    expect(await drift("unrelated")).toEqual([]);
  });

  test("at most 10 rules per pair, with a count of the rest", async () => {
    const common = Array.from({ length: 30 }, (_, i) => `- Run \`make target-${i}\` before every commit.`).join("\n");
    const onlyA = Array.from({ length: 8 }, (_, i) => `- Use the alpha tool number ${i} for builds.`).join("\n");
    const onlyB = Array.from({ length: 8 }, (_, i) => `- Use the beta tool number ${i} for builds.`).join("\n");
    const root = temp({ "AGENTS.md": `${common}\n${onlyA}\n`, "GEMINI.md": `${common}\n${onlyB}\n` });
    const fs = (await lint(root)).filter((f) => f.ruleId === "instruction-drift");
    expect(fs).toHaveLength(10);
    expect(fs.some((f) => f.message.includes("6 more lines differ"))).toBe(true);
  });
});

describe("codex-chain-over-budget", () => {
  const big = (n: number): string => "- Run the documented checks before every commit, then push.\n".repeat(Math.ceil(n / 60)).slice(0, n);

  test("a nested file that crosses the shared 32 KiB is cut, a deeper one is dropped", async () => {
    const root = temp({ "AGENTS.md": big(20_000), "a/AGENTS.md": big(20_000), "a/b/AGENTS.md": "- Run `make b` here.\n" });
    const fs = (await lint(root)).filter((f) => f.ruleId === "codex-chain-over-budget");
    expect(fs.map((f) => f.path)).toEqual(["a/AGENTS.md", "a/b/AGENTS.md"]);
    expect(fs[0]!.message).toContain("Codex cuts this file at this line");
    expect(fs[0]!.line).toBeGreaterThan(1);
    expect(fs[1]!.message).toContain("Codex never reads this file");
    expect(fs[0]!.category).toBe("budget");
  });

  test("many files cut for the same reason give one finding", async () => {
    const files: Record<string, string> = { "AGENTS.md": big(31_000) };
    for (const p of ["a", "b", "c", "d"]) files[`${p}/AGENTS.md`] = big(3_000);
    const fs = (await lint(temp(files))).filter((f) => f.ruleId === "codex-chain-over-budget");
    expect(fs.map((f) => f.path)).toEqual(["a/AGENTS.md"]);
    expect(fs[0]!.message).toContain("also cuts 3 more");
  });

  test("an override replaces AGENTS.md in its folder, and an empty file uses no budget", async () => {
    const root = temp({ "AGENTS.md": big(30_000), "a/AGENTS.md": big(10_000), "a/AGENTS.override.md": "- Small override.\n", "c/AGENTS.md": "   \n" });
    const fs = (await lint(root)).filter((f) => f.ruleId === "codex-chain-over-budget");
    expect(fs).toEqual([]);
  });

  test("a chain under the budget, and a single large root file, are left to the length rule", async () => {
    const root = temp({ "AGENTS.md": big(40_000) });
    expect((await lint(root)).filter((f) => f.ruleId === "codex-chain-over-budget")).toEqual([]);
  });
});

describe("benign corpus", () => {
  test("a multi-agent repo set up the documented way has no findings at all", async () => {
    expect(short(await lint(path.join(DRIFT, "benign")))).toEqual([]);
  });

  test("the MCP lint_steering tool shows drift findings in its text", async () => {
    const c = await connect([path.join(DRIFT, "contradiction")], { structured: false });
    try {
      const r = await c.call("lint_steering", {});
      expect(r.isError).toBe(false);
      expect(r.text).toContain("cross-file-contradiction");
    } finally {
      await c.close();
    }
  });
});

describe("DoS: 2,000 steering files", () => {
  test("the drift check over 2,000 mirrored files stays under the 20 s call budget", async () => {
    const files: Record<string, string> = {};
    const rules = Array.from({ length: 40 }, (_, i) => `- Run \`make step-${i}\` before every commit.`).join("\n");
    for (let i = 0; i < 1000; i++) {
      files[`p${String(i).padStart(4, "0")}/AGENTS.md`] = `${rules}\n- Always use tabs in package ${i}.\n`;
      files[`p${String(i).padStart(4, "0")}/CLAUDE.md`] = `${rules}\n- Never use tabs in package ${i}.\n- Only Claude rule ${i}.\n`;
    }
    const root = temp(files);
    const sandbox = await Sandbox.create([root]);
    const targets = Object.keys(files).map((f) => path.join(root, f));
    const t0 = performance.now();
    const p = await lintProject(sandbox, { deadline: new Deadline(CAPS.callBudgetMs), targets });
    const ms = performance.now() - t0;
    expect(p.timedOut).toBe(false);
    expect(ms).toBeLessThan(CAPS.callBudgetMs);
    const fs = p.findings();
    expect(fs.filter((f) => f.ruleId === "agents-md-shadowed")).toHaveLength(1000);
    expect(fs.filter((f) => f.ruleId === "cross-file-contradiction")).toHaveLength(1000);
    expect(fs.filter((f) => f.ruleId === "instruction-drift").length).toBeGreaterThanOrEqual(1000);
  }, 120_000);
  test("two 4 MB mirrored files with 100,000 rules each stay linear and capped", async () => {
    const a: string[] = [];
    const b: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      a.push(`- Always run step ${i} before every commit.`);
      b.push(i % 2 ? `- Always run step ${i} before every commit.` : `- Never run step ${i} before every commit.`);
    }
    const root = temp({ "AGENTS.md": a.join("\n"), "GEMINI.md": b.join("\n") });
    const t0 = performance.now();
    const fs = (await lint(root)).filter((f) => DRIFT_IDS.has(f.ruleId));
    expect(performance.now() - t0).toBeLessThan(CAPS.callBudgetMs);
    // Findings stay capped per file and rule.
    expect(fs.filter((f) => f.ruleId === "cross-file-contradiction").length).toBeLessThanOrEqual(CAPS.maxFindingsPerRule);
    expect(fs.filter((f) => f.ruleId === "instruction-drift").length).toBeLessThanOrEqual(10);
  }, 120_000);
});

