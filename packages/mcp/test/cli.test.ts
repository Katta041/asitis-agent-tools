// The asitis CLI: exit codes, --fail-on, one-line errors and the text and JSON formats.
// Most cases run the built bundle (dist/asitis.mjs) as a user would; the cases that need a fault
// inside asitis (exit 3, a config error from WP2's loader) run run() in-process with a mocked module.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { nodeVersionError, run, type CliIO } from "../src/cli/asitis.js";
import { UserError } from "../src/paths.js";
import { VERSION } from "../src/version.js";
import { FIXTURE_REPO, FIXTURES, PKG, REPO } from "./helpers.js";

const hooks = vi.hoisted(() => ({ configError: null as Error | null }));
vi.mock("../src/config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...real,
    loadConfig: async (...args: Parameters<typeof real.loadConfig>) => {
      if (hooks.configError) throw hooks.configError;
      return real.loadConfig(...args);
    },
  };
});
beforeEach(() => {
  hooks.configError = null;
});

const CLI = path.join(PKG, "dist/asitis.mjs");
const CLI_FIX = path.join(FIXTURES, "cli");

interface Ran {
  code: number;
  out: string;
  err: string;
}

/** Runs the bundle with this Node. cwd defaults to the repository root. */
function cli(args: string[], cwd = REPO): Ran {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ASITIS_DEBUG: "" }, timeout: 120_000 });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

/** run() in-process, capturing output. */
async function inProcess(args: string[], over: Partial<CliIO> = {}): Promise<Ran> {
  let out = "";
  let err = "";
  const code = await run(args, { out: (t) => void (out += t), err: (t) => void (err += t), cwd: REPO, nodeVersion: process.versions.node, debug: false, ...over });
  return { code, out, err };
}

const tmpDirs: string[] = [];
function tmp(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "asitis-cli-"));
  tmpDirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** The exit-2 shape: one line on stderr starting "asitis: ", nothing on stdout, no stack, no absolute path. */
function expectUserError(r: Ran, pattern: RegExp, ...absolute: string[]): void {
  expect(r.code, r.err).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toMatch(/^asitis: [^\n]+\n$/);
  expect(r.err).toMatch(pattern);
  expect(r.err).not.toMatch(/\n\s+at /);
  for (const a of [REPO, os.homedir(), ...absolute]) expect(r.err).not.toContain(a);
}

describe("exit codes", () => {
  test("0: a clean file", () => {
    const r = cli(["lint", "--root", path.join(CLI_FIX, "clean")]);
    expect(r).toEqual({ code: 0, out: "Linted 1 file: no issues found.\n", err: "" });
  });
  test("1: errors at the default --fail-on error", () => {
    const r = cli(["lint", "--root", FIXTURE_REPO]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/\nLinted \d+ files: 5 errors, \d+ warnings, \d+ notes\.\n$/);
  });
  test("2: a user error", () => expectUserError(cli(["lint", "missing.md"]), /^asitis: missing\.md: file not found\n$/));
  test("3: a bug in asitis, one line with the issue link and no stack or absolute path", async () => {
    hooks.configError = new Error(`EBADF: bad file descriptor, read '${path.join(REPO, "x", "y.json")}'`);
    const r = await inProcess(["lint", "--root", path.join(CLI_FIX, "clean")]);
    expect(r.code).toBe(3);
    expect(r.out).toBe("");
    expect(r.err).toBe(`asitis: internal error in asitis ${VERSION}: EBADF: bad file descriptor, read '<path>'. Please report it at https://github.com/Katta041/asitis-agent-tools/issues\n`);
  });
  test("3 with ASITIS_DEBUG=1 adds the stack", async () => {
    hooks.configError = new Error("boom");
    const r = await inProcess(["lint", "--root", path.join(CLI_FIX, "clean")], { debug: true });
    expect(r.code).toBe(3);
    expect(r.err.split("\n")[0]).toMatch(/^asitis: internal error in asitis .*: boom\. Please report it/);
    expect(r.err).toMatch(/\n\s+at /);
  });
  test("--version and --help exit 0 on stdout", () => {
    expect(cli(["--version"])).toEqual({ code: 0, out: `${VERSION}\n`, err: "" });
    const h = cli(["--help"]);
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/^asitis \d+\.\d+\.\d+: lint AI agent steering files/);
    for (const flag of ["--root", "--format", "--fail-on", "--config", "--baseline", "--write-baseline", "--include", "--fix-preview", "--max-files", "--max-file-mb", "--quiet", "--annotate-notes", "--allow-broad-root"]) expect(h.out).toContain(flag);
  });
  test("lint --help and budget --help print help for that command", () => {
    const l = cli(["lint", "-h"]);
    expect(l.code).toBe(0);
    expect(l.out).toMatch(/^asitis lint \[paths\.\.\.\] \[options\]\n/);
    for (const flag of ["--root", "--format", "--fail-on", "--include", "--fix-preview", "--annotate-notes"]) expect(l.out).toContain(flag);
    const b = cli(["budget", "--help"]);
    expect(b.code).toBe(0);
    expect(b.out).toMatch(/^asitis budget \[file\] \[options\]\n/);
    expect(b.out).not.toContain("--fail-on");
  });
});

describe("--fail-on", () => {
  // injection/ has one error (its hidden "ignore the rules above" comment) and warnings; note-only/ has one note.
  const warnings = path.join(CLI_FIX, "injection");
  const notes = path.join(CLI_FIX, "note-only");
  test.each([
    ["error", warnings, 1],
    ["warning", warnings, 1],
    ["note", warnings, 1],
    ["never", warnings, 0],
    ["error", notes, 0],
    ["warning", notes, 0],
    ["note", notes, 1],
    ["never", FIXTURE_REPO, 0],
  ])("--fail-on %s on %s exits %i", (level, root, code) => {
    expect(cli(["lint", "--root", root, "--fail-on", level]).code).toBe(code);
  });
  test("a bad level is exit 2", () => expectUserError(cli(["lint", "--fail-on", "warn"]), /^asitis: --fail-on must be error, warning, note or never, not "warn"\n$/));
});

describe("one-line errors (exit 2)", () => {
  test("a missing path", () => expectUserError(cli(["lint", "--root", FIXTURE_REPO, "docs/nope.md"], FIXTURE_REPO), /^asitis: docs\/nope\.md: file not found\n$/));
  test("a path outside the root", () => expectUserError(cli(["lint", "--root", FIXTURE_REPO, path.join(CLI_FIX, "clean", "CLAUDE.md")]), /: outside the root folder; pass a path inside it, or change --root\n$/, CLI_FIX));
  test("a relative path that climbs out of the root", () => expectUserError(cli(["lint", "--root", "test-fixtures/agentic/repo", "README.md"]), /^asitis: README\.md: outside the root folder/));
  test("an absolute path outside the current folder is shown by its name, not as ../../..", () =>
    expectUserError(cli(["lint", "--root", FIXTURE_REPO, path.join(REPO, "README.md")], FIXTURE_REPO), /^asitis: "README\.md \(absolute path\)": outside the root folder; pass a path inside it, or change --root\n$/));
  test("an empty path says so", () => expectUserError(cli(["lint", "--root", FIXTURE_REPO, ""], FIXTURE_REPO), /^asitis: got an empty path; pass a file inside the root, or leave paths out to lint every steering file\n$/));
  test("a named MCP config file without --include config says which flag reads it", () => {
    const dir = tmp({ ".mcp.json": "{}", "CLAUDE.md": "# P\n" });
    expectUserError(cli(["lint", ".mcp.json"], dir), /^asitis: Refused: \.mcp\.json is not a markdown file; asitis only reads markdown .*; to audit agent config files, run asitis lint --include config\n$/);
  });
  test("a folder given as a path", () => expectUserError(cli(["lint", "--root", FIXTURE_REPO, "docs"], FIXTURE_REPO), /^asitis: docs: a folder; pass files, or lint the folder with --root docs\n$/));
  test("a root that does not exist", () => expectUserError(cli(["lint", "--root", "no/such/folder"]), /^asitis: --root no\/such\/folder: folder not found\n$/));
  test("the home folder as the root", () => expectUserError(cli(["lint", "--root", os.homedir()]), /^asitis: refusing to use your home folder as the root; pass your project with --root, or add --allow-broad-root\n$/));
  test("two roots", () => expectUserError(cli(["lint", "--root", "a", "--root", "b"]), /^asitis: --root can be given only once\n$/));
  test("a missing --config file", () => expectUserError(cli(["lint", "--root", FIXTURE_REPO, "--config", "nope.json"], FIXTURE_REPO), /^asitis: --config nope\.json: file not found\n$/));
  test("a missing --baseline file", () => expectUserError(cli(["lint", "--root", FIXTURE_REPO, "--baseline", "base.json"], FIXTURE_REPO), /^asitis: --baseline base\.json: file not found\n$/));
  test("a malformed config: the loader's UserError becomes one line", async () => {
    hooks.configError = new UserError('.asitisrc.json line 3: unknown key "rulez" (did you mean "rules"?)');
    const r = await inProcess(["lint", "--root", path.join(CLI_FIX, "clean")]);
    expectUserError(r, /^asitis: \.asitisrc\.json line 3: unknown key "rulez" \(did you mean "rules"\?\)\n$/);
  });
  test("a config error that names an absolute path has it removed", async () => {
    hooks.configError = new UserError(`Invalid JSON in ${path.join(REPO, "cfg.json")} at line 1.`);
    const r = await inProcess(["lint", "--root", path.join(CLI_FIX, "clean")]);
    expectUserError(r, /^asitis: Invalid JSON in <path> at line 1\n$/);
  });
  test.each(["18.20.8", "20.11.0", "22.12.0", "v22.12.9"])("old Node %s", async (v) => {
    const r = await inProcess(["lint"], { nodeVersion: v });
    expectUserError(r, new RegExp(`^asitis: Node 22\\.13 or later is needed \\(this is ${v.replace(/^v/, "").replace(/\./g, "\\.")}\\)\\n$`));
  });
  test("Node 22.13.0 and later pass the version check", () => {
    for (const v of ["22.13.0", "22.14.1", "23.0.0", "24.1.0", "26.0.0"]) expect(nodeVersionError(v), v).toBeNull();
  });
  test.each([
    [["lint", "--bogus"], /^asitis: unknown option --bogus; run asitis --help for the options\n$/],
    [["lint", "--format"], /^asitis: --format needs a value\n$/],
    [["lint", "--format", "xml"], /^asitis: --format must be text, json, sarif or github, not "xml"\n$/],
    [["lint", "--include", "skills,bogus"], /^asitis: --include takes skills, config or config-local, not "bogus"\n$/],
    [["lint", "--max-file-mb", "0"], /^asitis: --max-file-mb must be a number from 1 to 64, not "0"\n$/],
    [["lint", "--max-file-mb", "lots"], /^asitis: --max-file-mb must be a number from 1 to 64, not "lots"\n$/],
    [["lint", "--max-files", "0"], /^asitis: --max-files must be a whole number from 1 to 1,000, not "0"\n$/],
    [["lint", "--max-files", "2.5"], /^asitis: --max-files must be a whole number from 1 to 1,000, not "2.5"\n$/],
    [["lint", "--write-baseline"], /^asitis: --write-baseline needs --format json\n$/],
    [["lint", "--fix-preview=all-of-it"], /^asitis: --fix-preview takes no value or =safe, not "all-of-it"\n$/],
    [["lint", "--quiet=yes"], /^asitis: --quiet does not take a value\n$/],
    [["frobnicate"], /^asitis: unknown command "frobnicate"; the commands are lint and budget\n$/],
    [[], /^asitis: no command given; run asitis lint, asitis budget or asitis --help\n$/],
    [["budget", "--fail-on", "error"], /^asitis: --fail-on only applies to asitis lint\n$/],
    [["budget", "--format", "sarif"], /^asitis: --format must be text or json, not "sarif"\n$/],
  ])("%j", (args, pattern) => expectUserError(cli(args as string[]), pattern as RegExp));
  test("a file the user named that is not a steering file", () => {
    const dir = tmp({ "package.json": "{}\n" });
    expectUserError(cli(["lint", "--root", dir, "package.json"], dir), /^asitis: [^\n]*package\.json[^\n]*\n$/, dir);
  });
  test("--max-files cut is exit 2: a partial lint never looks clean", () => {
    const dir = tmp({ "CLAUDE.md": "# A\n\nRun the tests.\n", "AGENTS.md": "# B\n\nRun the tests too.\n" });
    expectUserError(cli(["lint", "--root", dir, "--max-files", "1"]), /^asitis: stopped after 1 steering file; pass paths to lint the rest\n$/, dir);
    expect(cli(["lint", "--root", dir, "--max-files", "2"]).code).toBe(0);
  });
});

describe("paths", () => {
  test("relative paths resolve against the current folder", () => {
    const r = cli(["lint", "--root", ".", "CLAUDE.md"], path.join(CLI_FIX, "clean"));
    expect(r).toEqual({ code: 0, out: "Linted 1 file: no issues found.\n", err: "" });
    const sub = cli(["lint", "--root", "..", "CLAUDE.md"], path.join(FIXTURE_REPO, "docs"));
    expect(sub.code, sub.err).toBe(2); // docs/CLAUDE.md does not exist; the path is not read from the root
    expect(sub.err).toBe("asitis: CLAUDE.md: file not found\n");
  });
  test("paths limit the lint to those files", () => {
    const r = cli(["lint", "--root", FIXTURE_REPO, "CLAUDE.md", ".cursor/rules/always.mdc"], FIXTURE_REPO);
    expect(r.code).toBe(1);
    const files = new Set(r.out.split("\n").filter((l) => /^\S+:\d+:\d+ /.test(l)).map((l) => l.split(":")[0]));
    expect([...files].sort()).toEqual([".cursor/rules/always.mdc", "CLAUDE.md"]);
    expect(r.out).toMatch(/Linted 2 files:/);
  });
  test("the folder depth limit is a notice, not a failure", () => {
    const deep = Array.from({ length: 14 }, (_, i) => `d${i}`).join("/");
    const dir = tmp({ "CLAUDE.md": "# Notes\n\nRun the tests before you push.\n", [`${deep}/README.md`]: "x\n" });
    const r = cli(["lint", "--root", dir]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe("Linted 1 file: no issues found.\nFolders more than 12 levels deep were not searched; pass their files as paths to lint them.\n");
    expect(cli(["lint", "--root", dir, "--quiet"]).out).toBe("");
    const j = cli(["lint", "--root", dir, "--format", "json"]);
    expect(j.err).toBe("asitis: Folders more than 12 levels deep were not searched; pass their files as paths to lint them.\n");
  });
});

describe("text format", () => {
  const r = cli(["lint", "--root", FIXTURE_REPO]);
  const lines = r.out.split("\n");
  test("one line per finding, path:line:col severity rule-id message", () => {
    const findingLines = lines.filter((l) => l && !l.startsWith("Linted "));
    expect(findingLines.length).toBeGreaterThan(5);
    for (const l of findingLines) expect(l).toMatch(/^\S.*:\d+:\d+ (error|warning|note) [a-z][A-Za-z0-9-]* \S/);
  });
  test("grouped by file: a blank line between files and never inside one", () => {
    const blocks = r.out.trimEnd().split("\n\n");
    const summary = blocks.pop();
    expect(summary).toMatch(/^Linted \d+ files: /);
    const seen = new Set<string>();
    for (const b of blocks) {
      const paths = new Set(b.split("\n").map((l) => l.replace(/:\d+:\d+ .*$/, "")));
      expect(paths.size, b).toBe(1);
      const p = [...paths][0]!;
      expect(seen.has(p), p).toBe(false);
      seen.add(p);
    }
  });
  test("sorted by path, then line", () => {
    const keys = lines.filter((l) => /:\d+:\d+ /.test(l)).map((l) => {
      const m = /^(.*):(\d+):(\d+) /.exec(l)!;
      return [m[1]!, Number(m[2])] as const;
    });
    const sorted = [...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    expect(keys).toEqual(sorted);
  });
  test("--quiet prints findings only", () => {
    const q = cli(["lint", "--root", FIXTURE_REPO, "--quiet"]);
    expect(q.out).toBe(r.out.replace(/\n\nLinted [^\n]*\n$/, "\n"));
  });
  test("a control character in a quoted line stays on one line", () => {
    const dir = tmp({ "CLAUDE.md": "# Rules\n\n- Always check the output\u001b[2J before merging it\n- Always check the output\u001b[2J before merging it\n" });
    const t = cli(["lint", "--root", dir]);
    const dup = t.out.split("\n").find((l) => l.includes("duplicate-rule"));
    expect(dup).toContain("\\u001B[2J");
    expect(t.out).not.toContain("\u001b");
  });
});

describe("json format", () => {
  const schema = JSON.parse(readFileSync(path.join(PKG, "schema/report-1.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  test("schema/report-1.json is the schema in docs/cli-contract.md", () => {
    const contract = readFileSync(path.join(REPO, "docs/cli-contract.md"), "utf8");
    const block = /JSON Schema \(draft 2020-12\)[\s\S]*?```json\n([\s\S]*?)```/.exec(contract)![1]!;
    expect(schema).toEqual(JSON.parse(block));
  });
  test.each([FIXTURE_REPO, path.join(CLI_FIX, "clean"), path.join(CLI_FIX, "injection")])("valid report for %s", (root) => {
    const r = cli(["lint", "--root", root, "--format", "json", "--fail-on", "never"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(report.tool).toEqual({ name: "asitis", version: VERSION });
    expect(report.root).toBe(root.replace(/\\/g, "/"));
    expect(report.summary.errors + report.summary.warnings + report.summary.notes + report.summary.suppressed).toBe(report.findings.length);
  });
  test("root is shown as given, never made absolute", () => {
    const r = cli(["lint", "--format", "json"], path.join(CLI_FIX, "clean"));
    expect(JSON.parse(r.out).root).toBe(".");
    const rel = cli(["lint", "--root", "test-fixtures/cli/clean", "--format", "json"]);
    expect(JSON.parse(rel.out).root).toBe("test-fixtures/cli/clean");
    expect(rel.out).not.toContain(REPO);
  });
  test("paths are root-relative POSIX and the counts match the text summary", () => {
    const j = JSON.parse(cli(["lint", "--root", FIXTURE_REPO, "--format", "json"]).out);
    for (const f of j.findings) expect(f.path).not.toMatch(/^\/|\\|^[A-Za-z]:/);
    const t = cli(["lint", "--root", FIXTURE_REPO]).out;
    expect(t).toContain(`Linted ${j.summary.files} files: ${j.summary.errors} errors, ${j.summary.warnings} warnings, ${j.summary.notes} notes.`);
  });
  test("--write-baseline prints sorted unique fingerprints and exits 0", () => {
    const r = cli(["lint", "--root", FIXTURE_REPO, "--format", "json", "--write-baseline"]);
    expect(r.code).toBe(0);
    const b = JSON.parse(r.out);
    expect(b.schemaVersion).toBe(1);
    expect(b.fingerprints.length).toBeGreaterThan(5);
    expect([...b.fingerprints].sort()).toEqual(b.fingerprints);
    expect(new Set(b.fingerprints).size).toBe(b.fingerprints.length);
  });
  test("project notes go to stderr, so stdout stays plain JSON", () => {
    const r = cli(["lint", "--root", path.join(CLI_FIX, "clean"), "--format", "json", "--include", "skills"]);
    expect(r.code).toBe(0);
    JSON.parse(r.out);
    expect(r.err).toBe("asitis: Skill scan: no skill folders (folders with a SKILL.md) were found among the linted files.\n");
  });
});

describe(".asitisrc.json", () => {
  // The CLI passes configInclude, so include and extends: strict in the repo config apply here.
  // The MCP server ignores both (config.test.ts covers that side).
  test("include from the config runs the scan without --include", () => {
    const dir = tmp({ "CLAUDE.md": "# A\n\nRun the tests.\n", ".asitisrc.json": '{"include": ["skills"]}' });
    const r = cli(["lint", "--root", dir, "--format", "json"]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("asitis: Skill scan: no skill folders (folders with a SKILL.md) were found among the linted files.\n");
    expect(r.err).not.toContain("pass include to lint_steering");
  });
  test("extends strict raises a note to a warning", () => {
    const files = { "CLAUDE.md": "# Rules\n\n<!-- a note -->\n" };
    expect(cli(["lint", "--root", tmp(files)]).out).toMatch(/note hidden-comment/);
    const r = cli(["lint", "--root", tmp({ ...files, ".asitisrc.json": '{"extends": "strict"}' }), "--fail-on", "never"]);
    expect(r.out).toMatch(/warning hidden-comment/);
  });
});

describe("--fix-preview", () => {
  test("text: prints only the diff, or a note on stderr when there is nothing to fix", () => {
    const r = cli(["lint", "--root", path.join(CLI_FIX, "clean"), "--fix-preview"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toBe("asitis: no fixes to suggest for these findings.\n");
  });
  test("=safe is accepted, and json still validates", () => {
    const r = cli(["lint", "--root", FIXTURE_REPO, "--fix-preview=safe", "--format", "json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).schemaVersion).toBe(1);
  });
});

describe("budget", () => {
  test("whole folder", () => {
    const r = cli(["budget", "--root", FIXTURE_REPO]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^Loaded at the start of every session \(local estimates, largest first\): Claude Code /);
    expect(r.out).toContain("\nClaude Code: about ");
  });
  test("one file, json", () => {
    const r = cli(["budget", "--root", FIXTURE_REPO, "--format", "json", "CLAUDE.md"], FIXTURE_REPO);
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ schemaVersion: 1, path: "CLAUDE.md", kind: "claude-md", approximate: true });
    expect(j.totalWithImports).toBeGreaterThan(j.tokens);
  });
  test("a missing file is exit 2", () => expectUserError(cli(["budget", "--root", FIXTURE_REPO, "NOPE.md"], FIXTURE_REPO), /^asitis: NOPE\.md: file not found\n$/));
});
