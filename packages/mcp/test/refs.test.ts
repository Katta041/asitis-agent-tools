// stale-path and dead-command (src/refs.ts). Each skip in refs.ts has a negative case here, and
// each kind of finding the real-repo review kept has a positive one. Fixtures are synthetic.

import { mkdirSync, promises as fsp, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Deadline } from "../src/discover.js";
import type { Finding, Include } from "../src/findings.js";
import { CAPS } from "../src/limits.js";
import { Sandbox } from "../src/paths.js";
import { lintProject } from "../src/project.js";
import { codeSpans, commandsIn, makeTargets, pathCandidate } from "../src/refs.js";
import { tempDir } from "./helpers.js";

const temps: Array<() => void> = [];
afterAll(() => temps.forEach((c) => c()));

/** A project in a temp folder. A key ending in "/" makes an empty folder. */
function project(files: Record<string, string>): string {
  const t = tempDir("asitis-refs-");
  temps.push(t.cleanup);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(t.dir, rel);
    if (rel.endsWith("/")) mkdirSync(p, { recursive: true });
    else {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
  }
  return t.dir;
}

async function lint(root: string, include: Include[] = []): Promise<Finding[]> {
  const sandbox = await Sandbox.create([root]);
  const p = await lintProject(sandbox, { deadline: new Deadline(CAPS.callBudgetMs), include, maxFiles: CAPS.walkMaxFiles });
  return p.findings();
}
/** dead-command, and the .gitignore lookups of stale-path, run only with include "config". */
const lintConfig = (root: string): Promise<Finding[]> => lint(root, ["config"]);
const of = (fs: Finding[], rule: string): Finding[] => fs.filter((f) => f.ruleId === rule);
const at = (fs: Finding[], rule: string): Array<[string, number]> => of(fs, rule).map((f) => [f.path, f.line]);

/** A small repo: src/ with an api folder, a package, a Makefile and a .gitignore. */
const BASE: Record<string, string> = {
  "src/api/routes.ts": "export {};\n",
  "src/types/index.ts": "export {};\n",
  "packages/web/src/app.ts": "export {};\n",
  "packages/web/package.json": '{ "scripts": { "storybook": "storybook dev" } }\n',
  "package.json": '{ "scripts": { "build": "tsc", "test": "vitest", "lint": "eslint ." }, "devDependencies": { "eslint": "9.0.0" } }\n',
  ".gitignore": "dist/\n/coverage\n.env.local\nsrc/generated/\n",
};

describe("pathCandidate", () => {
  test("keeps repo-looking paths and strips line and symbol suffixes", () => {
    expect(pathCandidate("src/api/routes.ts")).toBe("src/api/routes.ts");
    expect(pathCandidate("./packages/web/")).toBe("packages/web/");
    expect(pathCandidate("src/api/routes.ts:42")).toBe("src/api/routes.ts");
    expect(pathCandidate("src/api/routes.ts#L10-L20")).toBe("src/api/routes.ts");
    expect(pathCandidate("backend/api.py:emit_signal")).toBe("backend/api.py");
    expect(pathCandidate(".github/workflows/ci.yml")).toBe(".github/workflows/ci.yml");
  });
  test.each([
    ["src/**/*.ts", "glob"],
    ["https://example.invalid/a/b.md", "URL"],
    ["src/<name>.ts", "placeholder"],
    ["src/{id}/page.tsx", "placeholder"],
    ["$HOME/notes/a.md", "variable"],
    ["src/.../a.ts", "ellipsis"],
    ["~/notes/a.md", "home path"],
    ["/etc/app/config.yml", "absolute path"],
    ["node_modules/pkg/index.js", "dependencies"],
    ["dist/index.js", "build output"],
    ["path/to/file.ts", "placeholder segments"],
    ["src/your-feature/index.ts", "placeholder segment"],
    ["src/FEATURE/index.ts", "all-caps placeholder"],
    ["next/navigation", "import specifier without an extension"],
    ["tools/list", "RPC method"],
    ["routes.ts", "a single name"],
    ["github.com/acme/sdk/", "host"],
    [".claude/worktrees/", "tool state folder"],
    ["npm run build", "a command"],
    ["@acme/ui/button.tsx", "scoped package"],
  ])("%s is not a path candidate (%s)", (raw) => {
    expect(pathCandidate(raw)).toBeNull();
  });
});

describe("stale-path", () => {
  test("a missing file and a missing folder under an existing top folder are warnings", async () => {
    const fs = await lint(
      project({
        ...BASE,
        "CLAUDE.md": "# Project\n\n- API routes live in `src/server/routes/`.\n- Shared types: `src/types/api.ts`.\n- Routes: `src/api/routes.ts` (exists).\n",
      }),
    );
    const s = of(fs, "stale-path");
    expect(s.map((f) => [f.line, f.severity])).toEqual([
      [3, "warning"],
      [4, "warning"],
    ]);
    expect(s[0]!.message).toBe('"src/server/routes/" is not in the repository: "src/" exists but has no "server/routes". Update the path or remove it');
  });

  test("a path resolves from the file's folder, from the root, and from anywhere with the same ending", async () => {
    const fs = await lint(
      project({
        ...BASE,
        "packages/web/AGENTS.md": "# Web\n\nThe entry is `src/app.ts`, routes are in `src/api/routes.ts`.\n",
        "CLAUDE.md": "# Project\n\nWeb tests sit in `web/src/app.ts` style paths.\n",
      }),
    );
    expect(of(fs, "stale-path")).toEqual([]);
  });

  test("paths in fences, example sections, example lines and link text are not checked", async () => {
    const fs = await lint(
      project({
        ...BASE,
        "CLAUDE.md": [
          "# Project",
          "",
          "```",
          "src/missing/a.ts",
          "`src/missing/b.ts`",
          "```",
          "",
          "For example, `src/missing/c.ts` would hold a helper.",
          "Create `src/missing/d.ts` for each new route.",
          "See [`src/missing/e.ts`](src/api/routes.ts).",
          "",
          "## Example layout",
          "",
          "- `src/missing/f.ts`",
          "",
        ].join("\n"),
      }),
    );
    expect(of(fs, "stale-path")).toEqual([]);
  });

  test("gitignored paths (with include config), submodules and a folder that became a module are not stale", async () => {
    const fs = await lintConfig(
      project({
        ...BASE,
        "src/handlers.py": "\n",
        ".gitmodules": '[submodule "src/vendor-lib"]\n\tpath = src/vendor-lib\n\turl = https://example.invalid/lib.git\n',
        "CLAUDE.md": "# Project\n\n- Generated client: `src/generated/client.ts`.\n- Vendored: `src/vendor-lib/README.md`.\n- Handlers: `src/handlers/`.\n",
      }),
    );
    expect(of(fs, "stale-path")).toEqual([]);
  });

  test("a top folder that is missing, or only in another letter case, is not checked", async () => {
    const fs = await lint(project({ ...BASE, "CLAUDE.md": "# Project\n\nUpstream keeps it in `lib/core/index.ts` and `Src/api/other.ts`.\n" }));
    expect(of(fs, "stale-path")).toEqual([]);
  });

  test("paragraphs about another repository and possessive paths are skipped", async () => {
    const fs = await lint(
      project({
        ...BASE,
        "CLAUDE.md": [
          "# Project",
          "",
          "The SDK lives in `acme/sdk`:",
          "its source is in `src/client/index.ts`.",
          "",
          "Read the compiler's `src/checker/rules.md` first.",
          "",
          "The deploy config is in the charts repo under `src/charts/values.yaml`.",
          "",
          "- `internal/httpapi/routes.go` for routing",
          "- `src/product.md` for contracts",
          "",
        ].join("\n"),
      }),
    );
    expect(of(fs, "stale-path")).toEqual([]);
  });

  test("skills are checked in the project's own tool folders only, and example folders never", async () => {
    const skill = "---\nname: deploy\ndescription: Deploys the web app to staging when asked to ship a preview.\n---\n\nRead `src/deploy/config.ts` first.\n";
    const fs = await lint(
      project({
        ...BASE,
        ".claude/skills/deploy/SKILL.md": skill,
        "skills/deploy/SKILL.md": skill,
        "examples/shop/CLAUDE.md": "# Shop\n\nSee `src/deploy/config.ts`.\n",
      }),
    );
    expect(at(fs, "stale-path")).toEqual([[".claude/skills/deploy/SKILL.md", 6]]);
  });

  test("the same path is reported once per file", async () => {
    const fs = await lint(project({ ...BASE, "CLAUDE.md": "# Project\n\n`src/server/a.ts` here.\n\nAnd `src/server/a.ts` again.\n" }));
    expect(at(fs, "stale-path")).toEqual([["CLAUDE.md", 3]]);
  });
});

describe("commandsIn and makeTargets", () => {
  test("script runs, tests and make targets", () => {
    expect(commandsIn("npm run typecheck").map((c) => [c.tool, c.name, c.binOk])).toEqual([["npm", "typecheck", false]]);
    expect(commandsIn("npm test").map((c) => c.name)).toEqual(["test"]);
    expect(commandsIn("pnpm build && pnpm run lint:fix").map((c) => [c.name, c.binOk])).toEqual([
      ["build", true],
      ["lint:fix", false],
    ]);
    expect(commandsIn("FOO=1 yarn run e2e").map((c) => c.name)).toEqual(["e2e"]);
    expect(commandsIn("make -j4 deploy").map((c) => c.name)).toEqual(["deploy"]);
  });
  test.each([
    ["npm install"],
    ["npm run build -w packages/web"],
    ["pnpm --filter web dev"],
    ["cd packages/web && npm run dev"],
    ["pushd app && npm run dev"],
    ["npm run <script>"],
    ["bun run src/index.ts"],
    ["make -C docs html"],
    ["make out.o"],
    ["pnpm add -D vitest"],
    ["yarn workspace web build"],
  ])("%s yields nothing to check", (s) => {
    expect(commandsIn(s)).toEqual([]);
  });
  test("makeTargets lists targets and .PHONY names, and gives up on include and pattern rules", () => {
    expect([...makeTargets("build test: deps\n\tgo build\n.PHONY: lint\nVAR := x\nrun:: \n")!].sort()).toEqual([".PHONY", "build", "lint", "run", "test"]);
    expect(makeTargets("include common.mk\nbuild:\n")).toBeNull();
    expect(makeTargets("%: \n\t@echo $@\n")).toBeNull();
    expect(makeTargets("$(BIN): main.go\n")).toBeNull();
  });
  test("codeSpans pairs backtick runs of the same length", () => {
    const s = "a `x` b ``y`z`` c `open";
    expect(codeSpans(s).map(([a, b]) => s.slice(a, b))).toEqual(["x", "y`z"]);
  });
});

describe("dead-command", () => {
  test("is off by default: without include config nothing is reported", async () => {
    const fs = await lint(project({ ...BASE, Makefile: "build:\n", "CLAUDE.md": "# Project\n\nRun `npm run typecheck` and `make deploy`.\n" }));
    expect(of(fs, "dead-command")).toEqual([]);
  });

  test("a missing npm script and a missing make target are warnings", async () => {
    const fs = await lintConfig(
      project({
        ...BASE,
        Makefile: "build:\n\tnpm run build\n.PHONY: build\n",
        "CLAUDE.md": "# Project\n\nRun `npm run typecheck` before you push.\n\n```bash\nnpm run build\nmake deploy\nmake build\n```\n",
      }),
    );
    const d = of(fs, "dead-command");
    expect(d.map((f) => [f.line, f.severity])).toEqual([
      [3, "warning"],
      [7, "warning"],
    ]);
    expect(d[0]!.message).toBe('"npm run typecheck" runs a script that package.json does not define (it has build, test, lint). Fix the command or add the script');
    expect(d[1]!.message).toBe('"make deploy" names a target that Makefile does not define. Fix the command or add the target');
  });

  test("script-like names run through yarn or pnpm are checked, binaries and dependencies are not", async () => {
    const fs = await lintConfig(project({ ...BASE, "AGENTS.md": "# Agents\n\n- `pnpm typecheck` checks types.\n- `pnpm eslint .` and `yarn tsc` run tools.\n- `yarn lint` lints.\n" }));
    expect(at(fs, "dead-command")).toEqual([["AGENTS.md", 3]]);
  });

  test("workspace scripts, flags, cd, placeholders and other fences are not reported", async () => {
    const fs = await lintConfig(
      project({
        ...BASE,
        "CLAUDE.md": [
          "# Project",
          "",
          "- `npm run storybook` opens the web stories.",
          "- `npm run dev -w packages/web`",
          "- `npm run <script>` runs any script.",
          "",
          "```bash",
          "cd packages/web",
          "npm run start-server",
          "```",
          "",
          "```json",
          '{ "cmd": "npm run nothing" }',
          "```",
          "",
          "## Example",
          "",
          "- `npm run deploy`",
          "",
        ].join("\n"),
      }),
    );
    expect(of(fs, "dead-command")).toEqual([]);
  });

  test("no package.json, no Makefile, or a Makefile with include: nothing is checked", async () => {
    const fs = await lintConfig(
      project({
        "CLAUDE.md": "# Project\n\nRun `npm run build` and `make release`.\n",
        "tools/Makefile": "include ../common.mk\n",
        "tools/CLAUDE.md": "# Tools\n\nRun `make anything`.\n",
      }),
    );
    expect(of(fs, "dead-command")).toEqual([]);
  });

  test("a nested steering file uses the nearest package.json", async () => {
    const fs = await lintConfig(project({ ...BASE, "packages/web/CLAUDE.md": "# Web\n\n`npm run storybook` and `npm run e2e`.\n" }));
    const d = of(fs, "dead-command");
    expect(d.map((f) => f.path)).toEqual(["packages/web/CLAUDE.md"]);
    expect(d[0]!.message).toContain("packages/web/package.json does not define");
  });
});

describe("project-files read class", () => {
  test("reads package.json, Makefiles and .gitignore files only, and only with include config", async () => {
    const root = project({ ...BASE, "tsconfig.json": "{}\n", Makefile: "build:\n" });
    const sb = await Sandbox.create([root]);
    const grants = new Set(["config"]);
    expect((await sb.openAs("project-files", "packages/web/package.json", { grants })).buf.length).toBeGreaterThan(0);
    expect((await sb.openAs("project-files", "Makefile", { grants })).buf.length).toBeGreaterThan(0);
    expect((await sb.openAs("project-files", ".gitignore", { grants })).buf.length).toBeGreaterThan(0);
    await expect(sb.openAs("project-files", "tsconfig.json", { grants })).rejects.toThrow(/not a package\.json, Makefile or \.gitignore/);
    await expect(sb.openAs("project-files", "src/api/routes.ts", { grants })).rejects.toThrow(/not a package\.json/);
    await expect(sb.openAs("project-files", "package.json")).rejects.toThrow(/only with include "config"/);
    await expect(sb.openAs("project-files", "Makefile")).rejects.toThrow(/only with include "config"/);
  });

  test("a default run opens markdown and .asitisrc.json only, never package.json, a Makefile or .gitignore", async () => {
    const root = project({
      ...BASE,
      Makefile: "build:\n",
      // src/results/ looks like run output: without .gitignore it is skipped, not reported.
      "CLAUDE.md": "# Project\n\nRun `npm run typecheck` and `make deploy`. Routes: `src/server/routes.ts`.\n\nRead `src/results/index.md` after a run.\n",
    });
    const spy = vi.spyOn(fsp, "open");
    try {
      const fs = await lint(root);
      expect(of(fs, "dead-command")).toEqual([]);
      expect(at(fs, "stale-path")).toEqual([["CLAUDE.md", 3]]);
      const opened = spy.mock.calls.map((c) => path.basename(String(c[0])));
      expect(opened).toContain("CLAUDE.md");
      expect(opened.filter((n) => !/\.md$/.test(n) && n !== ".asitisrc.json")).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    // The same repo with include config reads them, and reports both commands.
    const spy2 = vi.spyOn(fsp, "open");
    try {
      const fs = await lintConfig(root);
      expect(of(fs, "dead-command").map((f) => f.line)).toEqual([3, 3]);
      // With .gitignore read, the run-output guess is not needed: src/results/ is not ignored here.
      expect(at(fs, "stale-path")).toEqual([
        ["CLAUDE.md", 3],
        ["CLAUDE.md", 5],
      ]);
      const opened = spy2.mock.calls.map((c) => path.basename(String(c[0])));
      expect(opened).toEqual(expect.arrayContaining(["package.json", "Makefile", ".gitignore"]));
    } finally {
      spy2.mockRestore();
    }
  });
});
