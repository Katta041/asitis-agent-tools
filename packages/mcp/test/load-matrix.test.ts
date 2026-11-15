// The load model on a matrix of layouts: golden plans per tool and start folder, and the property
// that context_budget is exactly the counted launch steps of plan(""), and equal to the 0.3.0
// budget code (kept in test/legacy) except where a layout lists the change on purpose.
import { mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { budgetFromContext } from "../src/budget.js";
import { Deadline } from "../src/discover.js";
import { CAPS } from "../src/limits.js";
import { loadContext, plan, PLAN_TOOLS, totals, type LoadPlan } from "../src/load/index.js";
import { Sandbox } from "../src/paths.js";
import { projectBudget as legacyBudget } from "./legacy/budget-0.3.0.js";
import { FIXTURES, HERE, tempDir } from "./helpers.js";

interface Layout {
  files: Record<string, string>;
  /** Start folders to plan from; "" is always included. */
  cwds?: string[];
  /** Folders to create with a .git entry (a Git root for Codex and Gemini CLI). */
  git?: string[];
  /** Symlinks: path -> target (relative). Skipped where the OS refuses them. */
  links?: Record<string, string>;
  /** Why context_budget differs from 0.3.0 here, when it does on purpose. */
  budgetChange?: string;
  /** Same numbers as 0.3.0, but a warning's wording changed on purpose, and why. */
  warningChange?: string;
}

const lines = (n: number, s: string): string => Array.from({ length: n }, (_, i) => `- ${s} ${i}`).join("\n") + "\n";
const fm = (o: string): string => `---\n${o}\n---\n`;

const LAYOUTS: Record<string, Layout> = {
  "empty": { files: { "README.md": "# Nothing\n" } },
  "root-claude": { files: { "CLAUDE.md": "# Rules\n\n- Use pnpm\n" } },
  "import-chain-and-cycle": {
    files: { "CLAUDE.md": "# C\n\n@a.md\n@loop1.md\n@docs/missing.md\n", "a.md": "A\n@b.md\n", "b.md": "B\n@c.md\n", "c.md": "C\n@d.md\n", "d.md": "D\n@e.md\n", "e.md": "E (five hops, not loaded)\n", "loop1.md": "L1\n@loop2.md\n", "loop2.md": "L2\n@loop1.md\n" },
  },
  "agents-only": { files: { "AGENTS.md": "# Agents\n\n@notes.md\n", "notes.md": "Notes\n", "svc/AGENTS.md": "# Svc\n", "svc/x.ts": "" }, git: [""], cwds: ["svc"] },
  "claude-and-agents": { files: { "CLAUDE.md": "# Claude\n\n- Use pnpm\n", "AGENTS.md": "# Agents\n" } },
  "claude-imports-agents": { files: { "CLAUDE.md": "@AGENTS.md\n\n## Claude only\n", "AGENTS.md": "# Agents\n- Use pnpm\n" } },
  "local-hides-agents": { files: { "CLAUDE.local.md": "# Mine\n", "AGENTS.md": "# Agents\n" }, warningChange: "0.4.1: the warning names CLAUDE.local.md instead of saying there is a CLAUDE.md" },
  "dot-claude": { files: { ".claude/CLAUDE.md": "# In .claude\n", ".claude/AGENTS.md": "# Agents in .claude\n" } },
  "dot-claude-agents-fallback": {
    files: { "AGENTS.md": "# Root agents\n", ".claude/AGENTS.md": "# Agents in .claude\n" },
    budgetChange: "Claude Code also reads .claude/AGENTS.md when no CLAUDE.md counts (memory docs, canary 2.1.312)",
  },
  "monorepo-claude": {
    files: {
      "CLAUDE.md": "# Root\n\n@docs/root-guide.md\n",
      "docs/root-guide.md": "Root guide\n",
      "packages/api/CLAUDE.md": "# API\n\n@api-guide.md\n",
      "packages/api/api-guide.md": "API guide\n",
      "packages/api/src/db/CLAUDE.md": "# DB\n",
      "packages/web/CLAUDE.md": "# Web\n",
      "packages/web/src/app.tsx": "",
      "packages/web/AGENTS.md": "# Web agents\n",
    },
    git: [""],
    cwds: ["packages/api", "packages/web/src"],
  },
  "monorepo-codex": {
    files: { "AGENTS.md": "# Root\n", "packages/api/AGENTS.md": "# API\n", "packages/api/sub/AGENTS.md": "# API sub\n", "packages/web/AGENTS.override.md": "# Web override\n", "packages/web/AGENTS.md": "# Web\n", "packages/empty/AGENTS.md": "\n" },
    git: [""],
    cwds: ["packages/api", "packages/web", "packages/empty"],
  },
  "codex-chain-over": { files: { "AGENTS.md": lines(1000, "root rule padding text"), "pkg/AGENTS.md": lines(300, "pkg rule"), "pkg/deep/AGENTS.md": "# Deep\n" }, git: [""], cwds: ["pkg", "pkg/deep"] },
  "codex-root-over": { files: { "AGENTS.md": lines(1500, "a long rule line for padding") }, git: [""] },
  "codex-empty": { files: { "AGENTS.md": "\n\n" }, git: [""], budgetChange: "Codex skips an empty AGENTS.md (codex AGENTS.md guide)" },
  "codex-root-override": { files: { "AGENTS.md": "# Normal\n", "AGENTS.override.md": "# Override\n" }, git: [""], budgetChange: "Codex reads AGENTS.override.md instead of AGENTS.md (codex AGENTS.md guide)" },
  "nested-git": { files: { "AGENTS.md": "# Outer\n", "GEMINI.md": "# Outer gemini\n", "libs/x/AGENTS.md": "# Inner\n", "libs/x/GEMINI.md": "# Inner gemini\n" }, git: ["", "libs/x"], cwds: ["libs/x"] },
  "rules-mixed": {
    files: {
      ".claude/rules/always.md": "# Always\n\n@../../docs/rule-extra.md\n",
      "docs/rule-extra.md": "Extra\n",
      ".claude/rules/scoped.md": `${fm('paths:\n  - "src/**/*.ts"')}# Scoped\n`,
      ".claude/rules/nomatch.md": `${fm('paths:\n  - "legacy/**/*.rb"')}# Gone\n`,
      "src/a.ts": "",
      "pkg/.claude/rules/pkg.md": "# Pkg rule\n",
      "pkg/x.ts": "",
    },
    git: [""],
    cwds: ["pkg"],
    budgetChange: "rules expand their @imports (canary 2.1.312); a nested .claude/rules folder loads on demand, not at launch (memory docs)",
  },
  "skills": {
    files: {
      ".claude/skills/a/SKILL.md": `${fm("name: a\ndescription: Root skill A.")}Body\n`,
      "pkg/.claude/skills/b/SKILL.md": `${fm("name: b\ndescription: Nested skill B.")}Body\n`,
      ".agents/skills/c/SKILL.md": `${fm("name: c\ndescription: Shared skill C.")}Body\n`,
      "skills/d/SKILL.md": `${fm("name: d\ndescription: Repo skill D.")}Body\n`,
      ".claude/commands/x.md": `${fm("description: Command X.")}Body\n`,
      ".claude/agents/r.md": `${fm("name: r\ndescription: Reviewer.")}Body\n`,
      "pkg/.claude/commands/y.md": `${fm("description: Nested command Y.")}Body\n`,
      "other/.claude/skills/e/SKILL.md": `${fm("name: e\ndescription: Sibling skill E.")}Body\n`,
    },
    git: [""],
    cwds: ["pkg"],
  },
  "memory": { files: { ".claude/projects/demo/memory/MEMORY.md": lines(250, "memory line"), "CLAUDE.md": "# C\n" } },
  "big-nested": { files: { "CLAUDE.md": "# Root\n", "pkg/CLAUDE.md": `# Big\n${"x".repeat(45_000)}\n`, "pkg/a.txt": "" }, git: [""], budgetChange: "warns about the documented 40,000-character on-demand limit" },
  "gemini": {
    files: { "GEMINI.md": "# G\n\n@g1.md\n", "g1.md": "1\n@g2.md\n", "g2.md": "2\n@g3.md\n", "g3.md": "3\n@g4.md\n", "g4.md": "4\n@g5.md\n", "g5.md": "5\n@g6.md\n", "g6.md": "6 (past the depth)\n", "pkg/GEMINI.md": "# Pkg\n", "pkg/deep/GEMINI.md": "# Deep\n" },
    git: [""],
    cwds: ["pkg"],
  },
  "gemini-no-git": { files: { "GEMINI.md": "# G\n", "pkg/GEMINI.md": "# Pkg\n" }, cwds: ["pkg"] },
  "cursor": {
    files: {
      ".cursor/rules/always.mdc": `${fm("alwaysApply: true")}Always.\n`,
      ".cursor/rules/ts.mdc": `${fm('globs: "src/**/*.ts"\nalwaysApply: false')}TS.\n`,
      ".cursor/rules/desc.mdc": `${fm("description: When writing SQL\nalwaysApply: false")}SQL.\n`,
      ".cursor/rules/manual.mdc": "Manual.\n",
      ".cursorrules": "Legacy root.\n",
      "pkg/.cursor/rules/n.mdc": `${fm("alwaysApply: true")}Nested always.\n`,
      "pkg/.cursorrules": "Legacy nested.\n",
      "AGENTS.md": "# Agents\n",
      "pkg/AGENTS.md": "# Pkg agents\n",
      "src/a.ts": "",
    },
    git: [""],
    cwds: ["pkg"],
    budgetChange: "a .cursorrules below the workspace root is not counted at launch",
  },
  "copilot": {
    files: {
      ".github/copilot-instructions.md": "# Repo instructions\n",
      ".github/instructions/py.instructions.md": `${fm('applyTo: "**/*.py"')}Python.\n`,
      ".github/instructions/none.instructions.md": `${fm('applyTo: "legacy/**"')}Gone.\n`,
      ".github/instructions/manual.instructions.md": `${fm("description: Release notes")}Manual.\n`,
      "docs/stray.instructions.md": `${fm('applyTo: "**"')}Stray.\n`,
      "AGENTS.md": "# Agents\n",
      "CLAUDE.md": "# Claude\n",
      "pkg/AGENTS.md": "# Pkg\n",
      "tool.py": "",
    },
    git: [""],
    cwds: ["pkg"],
  },
  "variants": { files: { "AGENTS.md": "# A\n", "AGENTS.override.md": "# O\n", "AGENTS.local.md": "# L\n", ".agents/rules/r.md": "# Antigravity rule\n", ".agents/notes.md": "# Notes\n" }, git: [""], budgetChange: "Codex reads AGENTS.override.md instead of AGENTS.md" },
  "siblings": { files: { "a/CLAUDE.md": "# A\n", "b/CLAUDE.md": "# B\n", "b/AGENTS.md": "# B agents\n" }, git: [""], cwds: ["a"] },
  "symlinked-skills": {
    files: { ".agents/skills/s/SKILL.md": `${fm("name: s\ndescription: Linked skill.")}Body\n`, "CLAUDE.md": "# C\n" },
    links: { ".claude/skills": "../.agents/skills" },
  },
  "windsurf-cline": { files: { ".windsurfrules": "- root\n", ".clinerules/a.md": "Always\n", ".clinerules/scoped.md": `${fm("paths:\n  - src/**")}x\n` } },
};

const temps: Array<() => void> = [];
afterAll(() => temps.forEach((c) => c()));

function build(l: Layout): string | null {
  const t = tempDir("asitis-load-");
  temps.push(t.cleanup);
  for (const [rel, body] of Object.entries(l.files)) {
    mkdirSync(path.dirname(path.join(t.dir, rel)), { recursive: true });
    writeFileSync(path.join(t.dir, rel), body);
  }
  for (const g of l.git ?? []) mkdirSync(path.join(t.dir, g, ".git"), { recursive: true });
  for (const [at, target] of Object.entries(l.links ?? {})) {
    mkdirSync(path.dirname(path.join(t.dir, at)), { recursive: true });
    try {
      symlinkSync(target, path.join(t.dir, at), "dir");
    } catch {
      return null;
    }
  }
  return t.dir;
}

/** One line per step and skipped file: the shape of a plan without token counts. */
function shape(p: LoadPlan): string[] {
  const out = p.steps.map((s) => `${s.trigger}${s.counted ? "" : " (not counted)"} ${s.kind} ${s.path}${s.depth ? ` depth ${s.depth}` : ""}${s.matches !== undefined ? ` matches ${s.matches}` : ""}${s.cut ? ` cut at ${s.cut.at} ${s.cut.unit}` : ""} [${s.basis}]`);
  for (const k of p.skipped) out.push(`skipped ${k.path}: ${k.reason} [${k.basis}]`);
  for (const w of p.warnings) out.push(`warning ${w}`);
  return out;
}

const ctxFor = async (dir: string) => loadContext(await Sandbox.create([dir]), new Deadline(CAPS.callBudgetMs));

describe("golden plans", () => {
  for (const [name, l] of Object.entries(LAYOUTS)) {
    test(name, async () => {
      const dir = build(l);
      if (!dir) return; // symlinks not allowed here
      const ctx = await ctxFor(dir);
      const out: string[] = [];
      for (const cwd of ["", ...(l.cwds ?? [])]) {
        for (const tool of PLAN_TOOLS) {
          const p = await plan(ctx, cwd, tool);
          const body = shape(p);
          if (!body.length) continue;
          out.push(`## ${tool} from ${cwd || "(root)"}`, ...body, "");
        }
      }
      await expect(out.join("\n")).toMatchFileSnapshot(path.join(HERE, "golden", "load", `${name}.txt`));
    });
  }
});

/** Every folder under test-fixtures with a steering file at its top, plus the layouts above. */
function fixtureDirs(): string[] {
  const out: string[] = [];
  const visit = (d: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    if (names.some((n) => /^(CLAUDE|AGENTS|GEMINI)\.md$/.test(n) || n === ".claude" || n === ".cursor" || n === ".github")) out.push(d);
    if (depth >= 3) return;
    for (const n of names) {
      const p = path.join(d, n);
      if (n.startsWith(".") || n === "node_modules") continue;
      if (statSync(p).isDirectory()) visit(p, depth + 1);
    }
  };
  visit(FIXTURES, 0);
  return out;
}

describe("context_budget is a view of plan(\"\")", () => {
  const strip = (b: Awaited<ReturnType<typeof legacyBudget>>) => b.tools.map((t) => ({ tool: t.tool, tokens: t.tokens, entries: t.entries, warnings: t.warnings }));
  test("on every layout: totals equal the counted launch steps, and 0.3.0 numbers unless the layout says why not", async () => {
    let compared = 0;
    for (const [name, l] of Object.entries(LAYOUTS)) {
      const dir = build(l);
      if (!dir) continue;
      const sandbox = await Sandbox.create([dir]);
      const ctx = await loadContext(sandbox, new Deadline(CAPS.callBudgetMs));
      const now = await budgetFromContext(ctx);
      for (const t of now.tools) {
        const p = await plan(ctx, "", t.tool as never);
        expect(t.tokens, `${name} ${t.tool}`).toBe(totals(p).launchTokens);
      }
      const old = await legacyBudget(sandbox, new Deadline(CAPS.callBudgetMs));
      if (l.budgetChange) {
        expect(strip(now), `${name}: listed as a budget change (${l.budgetChange}) but nothing changed`).not.toEqual(strip(old));
      } else {
        const keep = (b: ReturnType<typeof strip>) => (l.warningChange ? b.map(({ warnings: _, ...rest }) => rest) : b);
        expect(keep(strip(now)), name).toEqual(keep(strip(old)));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
  test("on every fixture folder in test-fixtures: the same numbers as 0.3.0", async () => {
    const dirs = fixtureDirs();
    expect(dirs.length).toBeGreaterThan(10);
    // Fixture folders whose budget changes on purpose since 0.3.0, and why.
    const changed: Record<string, string> = {
      "drift/variants": "Codex reads AGENTS.override.md instead of AGENTS.md",
    };
    // Same numbers as 0.3.0, but a warning's wording changed on purpose.
    const reworded: Record<string, string> = { "drift/local-only": "0.4.1: the warning names CLAUDE.local.md instead of saying there is a CLAUDE.md" };
    for (const dir of dirs) {
      const sandbox = await Sandbox.create([dir]);
      const now = await budgetFromContext(await loadContext(sandbox, new Deadline(CAPS.callBudgetMs)));
      const old = await legacyBudget(sandbox, new Deadline(CAPS.callBudgetMs));
      const rel = path.relative(FIXTURES, dir).split(path.sep).join("/");
      if (changed[rel]) continue;
      const keep = (b: ReturnType<typeof strip>) => (reworded[rel] ? b.map(({ warnings: _, ...rest }) => rest) : b);
      expect(keep(strip(now)), rel).toEqual(keep(strip(old)));
    }
  }, 60_000);
});
