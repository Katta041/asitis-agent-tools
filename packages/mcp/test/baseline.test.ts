// WP2: baselines. Fingerprints survive lines inserted above and a CRLF/LF change, a new copy of a
// baselined finding still fires, and a bad baseline file is a one-line error with its line.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { baselineOf, loadBaseline, parseBaseline } from "../src/baseline.js";
import { Deadline } from "../src/discover.js";
import { buildReport, type Finding } from "../src/findings.js";
import { CAPS } from "../src/limits.js";
import { Sandbox, UserError } from "../src/paths.js";
import { lintProject } from "../src/project.js";
import { tempDir } from "./helpers.js";

const deadline = (): Deadline => new Deadline(CAPS.callBudgetMs);
const DUP = "- Use tabs for indentation in every file.";
const BODY = ["# Rules", "", DUP, DUP, "", "<!-- a note -->", ""];

let t: ReturnType<typeof tempDir>;
let dir: string;
beforeAll(() => {
  t = tempDir("asitis-baseline-");
  dir = t.dir;
  mkdirSync(path.join(dir, "docs"));
});
afterAll(() => t.cleanup());

async function run(lines: string[], eol = "\n", baseline?: string): Promise<Finding[]> {
  writeFileSync(path.join(dir, "CLAUDE.md"), lines.join(eol));
  const sb = await Sandbox.create([dir]);
  // trustRepoConfig as the CLI passes it: hidden-comment is a security rule, and only a trusted
  // run lets the baseline hide one (security-config.test.ts covers the untrusted side).
  return (await lintProject(sb, { targets: ["CLAUDE.md"], deadline: deadline(), trustRepoConfig: true, ...(baseline ? { baselinePath: baseline } : {}) })).findings();
}

/** Lints BODY, writes its baseline to .asitis-baseline.json and returns the findings. */
async function writeBaseline(): Promise<Finding[]> {
  const f = await run(BODY);
  writeFileSync(path.join(dir, ".asitis-baseline.json"), JSON.stringify(baselineOf(f), null, 2) + "\n");
  return f;
}

const live = (f: Finding[]): string[] => f.filter((x) => !x.suppressed).map((x) => `${x.line} ${x.ruleId}`);

describe("baseline", () => {
  test("every finding in the baseline is marked suppressed (external) and counted", async () => {
    const before = await writeBaseline();
    expect(before.map((x) => x.ruleId).sort()).toEqual(["duplicate-rule", "hidden-comment"]);
    const f = await run(BODY, "\n", ".asitis-baseline.json");
    expect(live(f)).toEqual([]);
    expect(f.every((x) => x.suppressed?.kind === "external")).toBe(true);
    expect(buildReport(".", 1, f).summary).toEqual({ files: 1, errors: 0, warnings: 0, notes: 0, suppressed: 2 });
  });

  test("fingerprints survive lines inserted above", async () => {
    await writeBaseline();
    const f = await run(["# Rules", "", "New intro line one.", "New intro line two.", ...BODY.slice(1)], "\n", ".asitis-baseline.json");
    expect(f.find((x) => x.ruleId === "duplicate-rule")!.line).toBe(7); // was 4
    expect(live(f)).toEqual([]);
  });

  test("fingerprints are identical under CRLF and LF", async () => {
    await writeBaseline();
    const crlf = await run(BODY, "\r\n", ".asitis-baseline.json");
    expect(live(crlf)).toEqual([]);
    const lf = await run(BODY);
    expect((await run(BODY, "\r\n")).map((x) => x.fingerprint)).toEqual(lf.map((x) => x.fingerprint));
  });

  test("a new duplicate of a baselined finding still fires", async () => {
    await writeBaseline();
    const f = await run(["# Rules", "", DUP, DUP, DUP, "", "<!-- a note -->", ""], "\n", ".asitis-baseline.json");
    expect(live(f)).toEqual(["5 duplicate-rule"]);
  });

  test("a new finding of another kind fires", async () => {
    await writeBaseline();
    const f = await run([...BODY, "- Always use tabs in Go files.", "- Never use tabs in Go files.", ""], "\n", ".asitis-baseline.json");
    expect(live(f).length).toBeGreaterThan(0);
    expect(live(f).every((x) => !x.endsWith("duplicate-rule") && !x.endsWith("hidden-comment"))).toBe(true);
  });

  test("baselineOf: sorted, unique, and leaves out findings that are already suppressed", () => {
    const base = { ruleId: "r", severity: "warning" as const, category: "format" as const, path: "a.md", line: 1, column: 1, endLine: 1, endColumn: 2, message: "m" };
    const b = baselineOf([
      { ...base, fingerprint: "b".repeat(64) },
      { ...base, fingerprint: "a".repeat(64) },
      { ...base, fingerprint: "a".repeat(64) },
      { ...base, fingerprint: "c".repeat(64), suppressed: { kind: "inSource" } },
    ]);
    expect(b).toEqual({ schemaVersion: 1, fingerprints: ["a".repeat(64), "b".repeat(64)] });
  });
});

describe("baseline files", () => {
  test.each([
    ["not JSON", "{\n  fingerprints: []\n}", 'b.json line 2: invalid JSON: expected a key in double quotes, found "f"'],
    ["wrong version", '{\n"schemaVersion": 2,\n"fingerprints": []}', "b.json line 2: schemaVersion must be 1, not 2; this file was written by a different version of asitis"],
    ["bad fingerprint", `{"schemaVersion": 1, "fingerprints": [\n"${"a".repeat(64)}",\n"xyz"]}`, "b.json line 3: fingerprints[1] is not a fingerprint (64 lowercase hex characters); write the file again with --write-baseline"],
    ["unknown key", '{"schemaVersion": 1, "fingerprints": [],\n"extra": 1}', 'b.json line 2: unknown key "extra" in a baseline file; it holds only schemaVersion and fingerprints'],
    ["missing fingerprints", '{"schemaVersion": 1}', "b.json line 1: fingerprints is missing; write the file again with --write-baseline"],
    ["missing version", '{"fingerprints": []}', "b.json line 1: schemaVersion is missing; write the file again with --write-baseline"],
    ["a list", "[]", "b.json line 1: a baseline must be a JSON object with schemaVersion and fingerprints, not a list"],
  ])("%s", (_name, text, message) => {
    expect(() => parseBaseline(text, "b.json")).toThrow(new UserError(message));
  });

  test("must be inside the project folder, and JSON", async () => {
    const other = tempDir("asitis-baseline-out-");
    try {
      writeFileSync(path.join(other.dir, "b.json"), '{"schemaVersion": 1, "fingerprints": []}');
      writeFileSync(path.join(dir, "b.txt"), "x");
      const sb = await Sandbox.create([dir]);
      await expect(loadBaseline(sb, path.join(other.dir, "b.json"))).rejects.toThrow(/outside the project folder/);
      await expect(loadBaseline(sb, "b.txt")).rejects.toThrow(/not a \.json file/);
      await expect(loadBaseline(sb, "missing.json")).rejects.toThrow(/File not found: missing\.json/);
    } finally {
      other.cleanup();
    }
  });

  test("may be larger than a config file (up to 4 MB), and loads fast", async () => {
    const fps = Array.from({ length: 20_000 }, (_, i) => i.toString(16).padStart(64, "0"));
    writeFileSync(path.join(dir, "docs/big-baseline.json"), JSON.stringify({ schemaVersion: 1, fingerprints: fps }, null, 2));
    const sb = await Sandbox.create([dir]);
    const t0 = performance.now();
    expect((await loadBaseline(sb, "docs/big-baseline.json")).size).toBe(20_000);
    expect(performance.now() - t0).toBeLessThan(2000);
    writeFileSync(path.join(dir, "docs/huge.json"), " ".repeat(4 * 1024 * 1024 + 1));
    await expect(loadBaseline(sb, "docs/huge.json")).rejects.toThrow(/File too large/);
  });
});
