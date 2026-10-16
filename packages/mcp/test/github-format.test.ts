// --format github: workflow-command escaping, and proof that text from a steering file can never
// become a workflow command of its own (::set-env, ::add-mask, ::stop-commands).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildReport, type Finding } from "../src/findings.js";
import { escapeData, escapeProperty, formatGithub } from "../src/format/github.js";
import { FIXTURE_REPO, FIXTURES, PKG, REPO } from "./helpers.js";

const CLI = path.join(PKG, "dist/asitis.mjs");
const INJECTION = path.join(FIXTURES, "cli", "injection");

function github(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, "lint", "--format", "github", ...args], { encoding: "utf8", cwd: REPO });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

/**
 * Splits output into lines the way the Actions runner reads a step's output (CR, LF or CRLF end a
 * line), then parses each line that starts with "::" as the runner does: the command name runs to
 * the first space or "::", properties to the next "::", and the rest is the message.
 */
function commands(out: string): Array<{ line: string; command: string; props: Record<string, string>; data: string }> {
  const found = [];
  for (const line of out.split(/\r\n|\r|\n/)) {
    if (!line.startsWith("::")) continue;
    const end = line.indexOf("::", 2);
    expect(end, line).toBeGreaterThan(2);
    const info = line.slice(2, end);
    const space = info.indexOf(" ");
    const command = space < 0 ? info : info.slice(0, space);
    const props: Record<string, string> = {};
    if (space >= 0) {
      for (const kv of info.slice(space + 1).split(",")) {
        const eq = kv.indexOf("=");
        props[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
    }
    found.push({ line, command, props, data: line.slice(end + 2) });
  }
  return found;
}

const unescapeData = (s: string): string => s.replace(/%0D/g, "\r").replace(/%0A/g, "\n").replace(/%25/g, "%");
const unescapeProperty = (s: string): string => unescapeData(s.replace(/%3A/g, ":").replace(/%2C/g, ","));

describe("escaping", () => {
  test.each([
    ["100%", "100%25"],
    ["a\rb", "a%0Db"],
    ["a\nb", "a%0Ab"],
    ["a\r\nb", "a%0D%0Ab"],
    ["%0A", "%250A"],
    ["x::y, z", "x::y, z"],
  ])("data %j -> %j", (input, expected) => {
    expect(escapeData(input)).toBe(expected);
    expect(unescapeData(escapeData(input))).toBe(input);
  });
  test.each([
    ["a:b", "a%3Ab"],
    ["a,b", "a%2Cb"],
    ["50%,\r\n::x", "50%25%2C%0D%0A%3A%3Ax"],
    ["asitis(duplicate-rule)", "asitis(duplicate-rule)"],
  ])("property %j -> %j", (input, expected) => {
    expect(escapeProperty(input)).toBe(expected);
    expect(unescapeProperty(escapeProperty(input))).toBe(input);
  });
});

describe("annotations", () => {
  test("one command per unsuppressed finding, by severity, and the summary cannot be read as a command", () => {
    const r = github(["--root", FIXTURE_REPO, "--annotate-notes"]);
    expect(r.code).toBe(1);
    const lines = r.out.trimEnd().split("\n");
    const j = JSON.parse(spawnSync(process.execPath, [CLI, "lint", "--root", FIXTURE_REPO, "--format", "json"], { encoding: "utf8" }).stdout);
    const cmds = commands(r.out);
    expect(cmds).toHaveLength(j.findings.length);
    expect(cmds.map((c) => c.command)).toEqual(j.findings.map((f: Finding) => ({ error: "error", warning: "warning", note: "notice" })[f.severity]));
    expect(lines.at(-1)).toMatch(/^asitis: Linted \d+ files: /);
    for (const l of lines.slice(0, -1)) expect(l).toMatch(/^::(error|warning|notice) file=/);
  });
  test("notes are not annotated unless --annotate-notes is given; the summary still counts them and says so", () => {
    const r = github(["--root", FIXTURE_REPO]);
    const j = JSON.parse(spawnSync(process.execPath, [CLI, "lint", "--root", FIXTURE_REPO, "--format", "json"], { encoding: "utf8" }).stdout);
    const notes = j.findings.filter((f: Finding) => f.severity === "note").length;
    expect(notes).toBeGreaterThan(0);
    const cmds = commands(r.out);
    expect(cmds).toHaveLength(j.findings.length - notes);
    expect(cmds.every((c) => c.command !== "notice")).toBe(true);
    const lines = r.out.trimEnd().split("\n");
    expect(lines.at(-2)).toMatch(/^asitis: Linted \d+ files: /);
    expect(lines.at(-1)).toBe(`asitis: ${notes} ${notes === 1 ? "note is" : "notes are"} not shown as annotations; add --annotate-notes to show ${notes === 1 ? "it" : "them"}`);
  });
  test("--annotate-notes is only for --format github", () => {
    const r = spawnSync(process.execPath, [CLI, "lint", "--root", FIXTURE_REPO, "--annotate-notes"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("asitis: --annotate-notes only applies to --format github\n");
  });
  test("properties: file, line, col, endLine, endColumn and title, in that order", () => {
    const c = commands(github(["--root", FIXTURE_REPO]).out)[0]!;
    expect(Object.keys(c.props)).toEqual(["file", "line", "col", "endLine", "endColumn", "title"]);
    expect(c.props["title"]).toMatch(/^asitis\([a-z][a-z0-9-]*\)$/);
  });
  test("file paths are relative to the workspace when --root is a relative subfolder", () => {
    const c = commands(github(["--root", "test-fixtures/agentic/repo"]).out);
    expect(c.every((x) => x.props["file"]!.startsWith("test-fixtures/agentic/repo/"))).toBe(true);
    const dot = spawnSync(process.execPath, [CLI, "lint", "--format", "github"], { encoding: "utf8", cwd: FIXTURE_REPO });
    expect(commands(dot.stdout).every((x) => !x.props["file"]!.startsWith("."))).toBe(false); // .claude/... paths stay as they are
    expect(commands(dot.stdout).some((x) => x.props["file"] === "CLAUDE.md")).toBe(true);
  });
  test("--quiet drops the summary and notices", () => {
    const r = github(["--root", FIXTURE_REPO, "--quiet"]);
    expect(r.out.trimEnd().split("\n").every((l) => /^::(error|warning|notice) /.test(l))).toBe(true);
  });
  test("notes become ::notice:: lines", () => {
    const report = buildReport(".", 0, []);
    expect(formatGithub(report, { notes: ["include \"skills\" is not\navailable"] })).toBe('::notice::include "skills" is not\\u000Aavailable\nasitis: Linted 0 files: no issues found.\n');
  });
});

describe("workflow-command injection", () => {
  const fixture = readFileSync(path.join(INJECTION, "CLAUDE.md"), "utf8");
  const r = github(["--root", INJECTION, "--fail-on", "never"]);

  test("the fixture really carries the payloads, and they reach the messages", () => {
    for (const p of ["::set-env name=", "::add-mask::", "::stop-commands::pwned-token", "::error file=x::owned"]) expect(fixture).toContain(p);
    expect(r.code).toBe(0);
    const data = commands(r.out).map((c) => unescapeData(c.data)).join("\n");
    expect(data).toContain("::set-env name=NODE_OPTIONS::");
    expect(data).toContain("::add-mask::%0A::stop-commands::pwned-token");
    expect(data).toContain("::stop-commands::pwned-token");
  });
  test("every output line is one of our annotations or the summary", () => {
    const lines = r.out.split(/\r\n|\r|\n/).filter((l) => l !== "");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).toMatch(/^(::(error|warning|notice) file=CLAUDE\.md,line=\d+,col=\d+,endLine=\d+,endColumn=\d+,title=asitis\([a-z-]+\)::|asitis: Linted )/);
    for (const c of commands(r.out)) expect(["error", "warning", "notice"]).toContain(c.command);
    expect(r.out).not.toMatch(/(^|[\r\n])::(set-env|add-mask|stop-commands|add-path|set-output|save-state|debug|group|endgroup|echo)/);
  });
  test("a message with raw line breaks and command tokens cannot start a line", () => {
    const evil = "ok\n::set-env name=PATH::/tmp\r::add-mask::secret\r\n::stop-commands::tok\u2028::warning::x\u0085::notice::y";
    const f: Finding = { ruleId: "duplicate-rule", severity: "warning", category: "format", path: "a,b:c%d/CLAUDE.md", line: 1, column: 1, endLine: 1, endColumn: 2, message: evil, fingerprint: "e".repeat(64) };
    const out = formatGithub(buildReport(".", 1, [f]));
    const lines = out.split(/\r\n|\r|\n|\u2028|\u0085/).filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^::warning file=a%2Cb%3Ac%25d\/CLAUDE\.md,line=1,col=1,endLine=1,endColumn=2,title=asitis\(duplicate-rule\)::ok/);
    expect(lines[1]).toBe("asitis: Linted 1 file: 0 errors, 1 warning, 0 notes.");
    const c = commands(out);
    expect(c).toHaveLength(1);
    expect(unescapeProperty(c[0]!.props["file"]!)).toBe("a,b:c%d/CLAUDE.md");
  });
  test("a file name with a comma or colon cannot add a property", () => {
    const f: Finding = { ruleId: "broken-link", severity: "error", category: "format", path: "x,title=pwned,line=999::CLAUDE.md", line: 2, column: 1, endLine: 2, endColumn: 3, message: "m", fingerprint: "f".repeat(64) };
    const c = commands(formatGithub(buildReport(".", 1, [f])))[0]!;
    expect(c.props["title"]).toBe("asitis(broken-link)");
    expect(c.props["line"]).toBe("2");
    expect(unescapeProperty(c.props["file"]!)).toBe(f.path);
  });
  test("suppressed findings are not annotated", () => {
    const f: Finding = { ruleId: "duplicate-rule", severity: "warning", category: "format", path: "CLAUDE.md", line: 1, column: 1, endLine: 1, endColumn: 2, message: "m", fingerprint: "a".repeat(64), suppressed: { kind: "external" } };
    expect(formatGithub(buildReport(".", 1, [f]))).toBe("asitis: Linted 1 file: no issues found, 1 suppressed.\n");
  });
});
