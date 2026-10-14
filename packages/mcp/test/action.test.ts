// WP3: the GitHub Action (action.yml, action/run.sh), the pre-commit hook and the CI docs.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { classify } from "../src/kinds.js";
import { REPO } from "./helpers.js";

const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8");
const pkgVersion = (JSON.parse(read("packages/mcp/package.json")) as { version: string }).version;

interface ActionInput {
  description?: string;
  default?: string;
  required?: boolean;
}
interface ActionStep {
  id?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
  env?: Record<string, string>;
}
interface ActionFile {
  name: string;
  description: string;
  inputs: Record<string, ActionInput>;
  outputs: Record<string, { description?: string; value?: string }>;
  runs: { using: string; steps: ActionStep[] };
}

const action = parse(read("action.yml")) as ActionFile;
const readme = read("action/README.md");
const ciDoc = read("docs/ci.md");

/** ```yaml blocks of a markdown file. */
const yamlBlocks = (md: string): string[] => [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
/** Every `uses:` value in a text. */
const usesIn = (text: string): string[] => [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
/** The README table rows for a heading: first cell of each row, backticks removed. */
function tableNames(md: string, heading: string): string[] {
  const start = md.indexOf(`## ${heading}`);
  expect(start, `README has a ${heading} section`).toBeGreaterThan(-1);
  const end = md.indexOf("\n## ", start + 3);
  const section = md.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
}

describe("action.yml", () => {
  test("is a composite action that runs the bundled CLI through action/run.sh", () => {
    expect(action.runs.using).toBe("composite");
    const lint = action.runs.steps.find((s) => s.id === "lint");
    expect(lint?.run).toBe('bash "$GITHUB_ACTION_PATH/action/run.sh"');
    expect(read("action/run.sh")).toContain('cli="$here/asitis.mjs"');
    expect(existsSync(path.join(REPO, "action/asitis.mjs"))).toBe(true);
  });

  test("has the inputs the roadmap asks for, with their defaults", () => {
    for (const name of ["paths", "fail-on", "format", "include", "config", "baseline", "sarif-file"]) expect(Object.keys(action.inputs)).toContain(name);
    expect(action.inputs["fail-on"]?.default).toBe("error");
    expect(action.inputs["format"]?.default).toBe("github");
    expect(action.inputs["sarif-file"]?.default).toBe("asitis.sarif");
    expect(action.inputs["upload-sarif"]?.default).toBe("false");
    expect(action.inputs["root"]?.default).toBe(".");
  });

  test("every input and output has a description and a row in action/README.md", () => {
    const inputRows = tableNames(readme, "Inputs");
    const outputRows = tableNames(readme, "Outputs");
    for (const [name, i] of Object.entries(action.inputs)) {
      expect(i.description?.length, name).toBeGreaterThan(10);
      expect(inputRows, `input ${name}`).toContain(name);
    }
    for (const [name, o] of Object.entries(action.outputs)) {
      expect(o.description?.length, name).toBeGreaterThan(10);
      expect(outputRows, `output ${name}`).toContain(name);
    }
    // And nothing documented that the action does not have.
    expect(inputRows.sort()).toEqual(Object.keys(action.inputs).sort());
    expect(outputRows.sort()).toEqual(Object.keys(action.outputs).sort());
  });

  test("each input reaches run.sh as an INPUT_ variable", () => {
    const lint = action.runs.steps.find((s) => s.id === "lint")!;
    const script = read("action/run.sh");
    for (const name of Object.keys(action.inputs)) {
      if (name === "upload-sarif") continue; // used by the upload step's if:, not by the script
      const v = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
      expect(lint.env?.[v], v).toBe(`\${{ inputs.${name} }}`);
      expect(script, v).toContain(v);
    }
  });

  test("no run: block interpolates an input or step output, so file names cannot inject shell code", () => {
    for (const s of action.runs.steps) if (s.run) expect(s.run).not.toMatch(/\$\{\{/);
  });

  test("the upload step is optional and pinned", () => {
    const up = action.runs.steps.find((s) => s.uses?.startsWith("github/codeql-action/upload-sarif@"));
    expect(up?.if).toContain("inputs.upload-sarif == 'true'");
  });
});

describe("every uses: is pinned to a full commit SHA", () => {
  const own = /^Katta041\/asitis-agent-tools@v\d+\.\d+\.\d+$/;
  const files = ["action.yml", ".github/workflows/action-selftest.yml", ".github/workflows/ci.yml", "action/README.md", "docs/ci.md"];
  test.each(files)("%s", (rel) => {
    const uses = usesIn(read(rel));
    if (rel === "action.yml" || rel.endsWith("action-selftest.yml")) expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      if (u === "./") continue; // the self-test runs this checkout
      // The docs show this action by its release tag; action/README.md says how to pin its SHA.
      if (own.test(u)) continue;
      expect(u, `${rel}: ${u}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });
});

describe("example workflows ask for the least permission", () => {
  const ALLOWED_JOB = new Set(["contents:read", "security-events:write", "actions:read"]);
  const workflows = [...yamlBlocks(readme), ...yamlBlocks(ciDoc)]
    .map((y) => parse(y) as Record<string, unknown> | null)
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && "jobs" in w);

  test("the docs contain full example workflows", () => expect(workflows.length).toBeGreaterThanOrEqual(3));

  test("workflow-level permissions are contents: read and nothing else", () => {
    for (const w of workflows) expect(w["permissions"]).toEqual({ contents: "read" });
  });

  test("job-level permissions only add security-events: write (and actions: read for private repos)", () => {
    for (const w of workflows) {
      for (const job of Object.values(w["jobs"] as Record<string, { permissions?: Record<string, string> }>)) {
        for (const [k, v] of Object.entries(job.permissions ?? {})) expect(ALLOWED_JOB, `${k}: ${v}`).toContain(`${k}:${v}`);
      }
    }
  });

  test("checkout never keeps the token, and setup-node comes before the action", () => {
    for (const w of workflows) {
      for (const job of Object.values(w["jobs"] as Record<string, { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }>)) {
        const steps = job.steps ?? [];
        const co = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
        if (co) expect(co.with?.["persist-credentials"]).toBe(false);
        const node = steps.findIndex((s) => s.uses?.startsWith("actions/setup-node@"));
        const ours = steps.findIndex((s) => s.uses?.startsWith("Katta041/asitis-agent-tools@"));
        if (ours >= 0) expect(node, "setup-node before the action").toBeGreaterThanOrEqual(0);
        if (ours >= 0) expect(node).toBeLessThan(ours);
      }
    }
  });

  test("the code scanning example only uploads on push, where the token can write", () => {
    const uploads = workflows.flatMap((w) =>
      Object.values(w["jobs"] as Record<string, { steps?: Array<{ with?: Record<string, unknown> }> }>).flatMap((j) => j.steps ?? []),
    ).filter((s) => s.with?.["upload-sarif"] !== undefined);
    expect(uploads.length).toBeGreaterThan(0);
    for (const s of uploads) expect(s.with?.["upload-sarif"]).toBe("${{ github.event_name == 'push' }}");
  });
});

describe("versions in the CI docs agree", () => {
  test("every @asitis/mcp pin and action tag in action/README.md and docs/ci.md is the same release, not older than the package", () => {
    const text = readme + ciDoc;
    const pins = new Set([...text.matchAll(/@asitis\/mcp@(\d+\.\d+\.\d+)/g), ...text.matchAll(/asitis-agent-tools@v(\d+\.\d+\.\d+)/g), ...text.matchAll(/rev: v(\d+\.\d+\.\d+)/g), ...text.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)/g)].map((m) => m[1]!));
    expect(pins.size).toBe(1);
    const [pin] = [...pins];
    const n = (v: string): number[] => v.split(".").map(Number);
    const [a, b] = [n(pin!), n(pkgVersion)];
    expect(a[0]! * 1e6 + a[1]! * 1e3 + a[2]!).toBeGreaterThanOrEqual(b[0]! * 1e6 + b[1]! * 1e3 + b[2]!);
  });

  test("docs/ci.md covers GitHub Actions, pre-commit, GitLab CI and plain npx", () => {
    for (const h of ["## Plain npx", "## GitHub Actions", "## pre-commit", "## GitLab CI"]) expect(ciDoc).toContain(h);
    expect(ciDoc).toMatch(/npx -y -p @asitis\/mcp@\d+\.\d+\.\d+ asitis lint/);
  });
});

interface Hook {
  id: string;
  language: string;
  entry: string;
  args?: string[];
  pass_filenames: boolean;
  files: string;
}

describe(".pre-commit-hooks.yaml", () => {
  const hooks = parse(read(".pre-commit-hooks.yaml")) as Hook[];
  const hook = hooks.find((h) => h.id === "asitis-lint")!;
  // Python verbose regex to JS: drop (?x) and the layout whitespace (the pattern has no literal spaces).
  const files = new RegExp(hook.files.replace("(?x)", "").replace(/\s+/g, ""));

  test("runs the bundled CLI on the changed files and fails on errors by default", () => {
    expect(hook.language).toBe("script");
    expect(hook.entry).toBe("action/asitis.mjs lint");
    expect(hook.args).toEqual(["--fail-on", "error"]);
    expect(hook.pass_filenames).toBe(true);
  });

  test("the bundle starts with a node shebang and is executable in git, as language: script needs", () => {
    expect(read("action/asitis.mjs").startsWith("#!/usr/bin/env node\n")).toBe(true);
    const r = spawnSync("git", ["ls-files", "-s", "action/asitis.mjs", "action/run.sh"], { cwd: REPO, encoding: "utf8" });
    if (r.status !== 0 || !r.stdout.trim()) return; // not a git checkout (a clean export without .git)
    for (const line of r.stdout.trim().split("\n")) expect(line, line).toMatch(/^100755 /);
  });

  // Paths the linter treats as steering files, and paths it does not. The hook's files: pattern
  // must agree with classify() in kinds.ts on each one.
  const steering = [
    "CLAUDE.md", "CLAUDE.local.md", "packages/api/CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md", "web/AGENTS.md", "GEMINI.md",
    ".claude/skills/deploy/SKILL.md", "skills/pdf/SKILL.md", ".claude/agents/reviewer.md", ".claude/commands/ship.md", ".claude/rules/go.md",
    ".cursor/rules/style.mdc", ".cursorrules", ".windsurfrules", ".windsurf/rules/a.md", ".clinerules", ".clinerules/b.md",
    ".github/copilot-instructions.md", ".github/instructions/ts.instructions.md", ".github/prompts/fix.prompt.md", ".github/agents/planner.md",
    "x.agent.md", "old.chatmode.md", "MEMORY.md", "memory/user.md",
  ];
  const plain = ["README.md", "docs/guide.md", ".github/ISSUE_TEMPLATE/bug.md", ".github/PULL_REQUEST_TEMPLATE.md", "src/memory/notes.md", "CHANGELOG.md", "claude.md", "src/index.ts", ".claude/settings.json", ".claude/skills/deploy/reference.md"];

  test.each(steering)("matches steering file %s", (p) => {
    expect(classify(p).kind, "classify agrees it is steering").not.toBe("markdown");
    expect(files.test(p)).toBe(true);
  });
  test.each(plain)("skips %s", (p) => {
    if (/\.(md|mdc)$/.test(p)) expect(classify(p).kind, "classify agrees it is plain markdown").toBe("markdown");
    expect(files.test(p)).toBe(false);
  });
});

// action/run.sh end to end against the CI fixtures. Needs bash, which Windows only has inside
// Git for Windows; the self-test workflow covers Windows on a real runner.
const bash = process.platform === "win32" ? null : spawnSync("bash", ["--version"]).status === 0 ? "bash" : null;

describe.skipIf(!bash)("action/run.sh", () => {
  function runAction(env: Record<string, string>, extraPath?: string): { code: number | null; stdout: string; outputs: Record<string, string> } {
    const dir = mkdtempSync(path.join(os.tmpdir(), "asitis-action-"));
    try {
      const outFile = path.join(dir, "out");
      writeFileSync(outFile, "");
      const r = spawnSync("bash", [path.join(REPO, "action/run.sh")], {
        cwd: REPO,
        encoding: "utf8",
        env: { PATH: (extraPath ? extraPath + path.delimiter : "") + (process.env["PATH"] ?? ""), GITHUB_OUTPUT: outFile, ...env },
      });
      const outputs: Record<string, string> = {};
      for (const line of readFileSync(outFile, "utf8").split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
      }
      return { code: r.status, stdout: r.stdout + r.stderr, outputs };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("clean fixture: exit-code 0, no annotations", () => {
    const r = runAction({ INPUT_ROOT: "test-fixtures/ci/clean" });
    expect(r.code).toBe(0);
    expect(r.outputs).toMatchObject({ "exit-code": "0", errors: "0", warnings: "0", notes: "0", "sarif-file": "" });
    expect(r.stdout.split("\n").filter((l) => l.startsWith("::"))).toEqual([]);
  });

  test("dirty fixture: exit-code 1, one annotation per finding, a SARIF file, and no injected command", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "asitis-sarif-"));
    try {
      const sarif = path.join(dir, "nested", "dirty.sarif");
      const r = runAction({ INPUT_ROOT: "test-fixtures/ci/dirty", INPUT_SARIF_FILE: sarif });
      expect(r.code, r.stdout).toBe(0); // the step itself passes; action.yml's last step fails on exit-code
      expect(r.outputs).toMatchObject({ "exit-code": "1", errors: "2", warnings: "3", notes: "0", "sarif-file": sarif });
      const annotations = r.stdout.split("\n").filter((l) => l.startsWith("::"));
      expect(annotations).toHaveLength(5);
      expect(annotations.filter((l) => l.startsWith("::error "))).toHaveLength(2);
      expect(annotations.some((l) => /^::(set-env|add-mask|stop-commands)/.test(l))).toBe(false);
      const log = JSON.parse(readFileSync(sarif, "utf8")) as { version: string; runs: Array<{ results: unknown[] }> };
      expect(log.version).toBe("2.1.0");
      expect(log.runs[0]!.results).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("named paths, one per line, with fail-on never", () => {
    const r = runAction({ INPUT_PATHS: "test-fixtures/ci/dirty/CLAUDE.md\n  test-fixtures/ci/clean/CLAUDE.md  \n", INPUT_FAIL_ON: "never", INPUT_FORMAT: "text" });
    expect(r.outputs).toMatchObject({ "exit-code": "0", errors: "1", warnings: "3" });
    expect(r.stdout).toContain("test-fixtures/ci/dirty/CLAUDE.md:2:1 error frontmatter-not-line-1");
  });

  test("a CLI usage error is exit 2 with one error annotation", () => {
    const r = runAction({ INPUT_FAIL_ON: "warn" });
    expect(r.code).toBe(2);
    expect(r.outputs["exit-code"]).toBe("2");
    expect(r.stdout.trim().split("\n")).toEqual(['::error title=asitis::asitis: --fail-on must be error, warning, note or never, not "warn"']);
  });

  test("format sarif is refused with a pointer to sarif-file", () => {
    const r = runAction({ INPUT_FORMAT: "sarif" });
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("set the sarif-file input instead");
  });

  test("Node older than 22.13 is one line that says to add actions/setup-node", () => {
    const shim = mkdtempSync(path.join(os.tmpdir(), "asitis-oldnode-"));
    try {
      writeFileSync(path.join(shim, "node"), "#!/bin/sh\necho v20.11.0\n");
      chmodSync(path.join(shim, "node"), 0o755);
      const r = runAction({ INPUT_ROOT: "test-fixtures/ci/clean" }, shim);
      expect(r.code).toBe(2);
      expect(r.outputs["exit-code"]).toBe("2");
      expect(r.stdout.trim().split("\n")).toEqual([
        "::error title=asitis::asitis needs Node 22.13 or later and this runner has v20.11.0. Add actions/setup-node with node-version: 22 (or later) before this step.",
      ]);
    } finally {
      rmSync(shim, { recursive: true, force: true });
    }
  });
});
