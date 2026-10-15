// SARIF 2.1.0 output: valid against the OASIS schema (vendored from json.schemastore.org, the
// $schema the log points to), file URIs percent-encoded, fingerprints stable across line endings.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ajv } from "ajv";
import { afterAll, describe, expect, test } from "vitest";
import { buildReport, type Finding } from "../src/findings.js";
import { formatSarif, RULE_DOCS, toUri } from "../src/format/sarif.js";
import { activeRules, RULES } from "../src/rules/registry.js";
import { VERSION } from "../src/version.js";
import { FIXTURE_REPO, FIXTURES, HERE, PKG, REPO } from "./helpers.js";

const CLI = path.join(PKG, "dist/asitis.mjs");
const schema = JSON.parse(readFileSync(path.join(HERE, "schemas/sarif-2.1.0.json"), "utf8"));
// The schema uses "format": "uri" and "uri-reference"; URIs are checked by hand below, so the
// format keywords are accepted without a format plugin.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);

interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  level: string;
  message: { text: string };
  locations: Array<{ physicalLocation: { artifactLocation: { uri: string; uriBaseId: string }; region: Record<string, number> } }>;
  partialFingerprints: Record<string, string>;
  suppressions?: Array<{ kind: string; justification?: string }>;
  fixes?: unknown[];
}

function sarif(root: string, extra: string[] = []): { log: { runs: Array<{ tool: { driver: { rules: Array<Record<string, unknown>> } }; results: SarifResult[] }> } & Record<string, unknown>; code: number; text: string } {
  const r = spawnSync(process.execPath, [CLI, "lint", "--root", root, "--format", "sarif", ...extra], { encoding: "utf8", cwd: REPO });
  expect(r.stderr).toBe("");
  return { log: JSON.parse(r.stdout), code: r.status ?? -1, text: r.stdout };
}

function expectValid(log: unknown): void {
  const ok = validate(log);
  expect(ok, JSON.stringify(validate.errors?.slice(0, 5), null, 2)).toBe(true);
}

const tmpDirs: string[] = [];
function tmp(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "asitis-sarif-"));
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

describe("SARIF 2.1.0", () => {
  test("the vendored schema is the 2.1.0 schema", () => {
    expect(schema.$id).toMatch(/sarif-schema-2\.1\.0\.json$/);
    expect(schema.properties.version.const).toBe("2.1.0");
  });
  test("the validator rejects a broken log, so a pass means something", () => {
    const { log } = sarif(FIXTURE_REPO);
    const broken = JSON.parse(JSON.stringify(log));
    broken.runs[0].results[0].level = "fatal";
    expect(validate(broken)).toBe(false);
    delete broken.runs[0].tool;
    expect(validate(broken)).toBe(false);
  });
  test.each([FIXTURE_REPO, path.join(FIXTURES, "cli", "clean"), path.join(FIXTURES, "cli", "injection")])("valid log for %s", (root) => {
    const { log } = sarif(root);
    expectValid(log);
    expect(log["$schema"]).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(log["version"]).toBe("2.1.0");
  });
  test("no absolute path anywhere in the log", () => {
    const { text } = sarif(FIXTURE_REPO);
    expect(text).not.toContain(REPO);
    expect(text).not.toContain("originalUriBaseIds");
  });
  test("driver: name, version, rules[] = active rules in registry order with doc links", () => {
    const { log } = sarif(FIXTURE_REPO);
    const run = log.runs[0]! as unknown as { tool: { driver: Record<string, unknown> & { rules: Array<Record<string, any>> } }; columnKind: string; invocations: unknown[] };
    expect(run.tool.driver).toMatchObject({ name: "AsItIs", version: VERSION, informationUri: "https://asitis.app" });
    expect(run.columnKind).toBe("utf16CodeUnits");
    expect(run.invocations).toEqual([{ executionSuccessful: true }]);
    const rules = run.tool.driver.rules;
    expect(rules.map((r) => r["id"])).toEqual(activeRules().map((r) => r.id));
    for (const r of rules) {
      const meta = RULES.get(r["id"])!;
      expect(meta.status).toBe("active");
      expect(r["helpUri"]).toBe(`https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/${r["id"]}.md`);
      expect(r["shortDescription"]).toEqual({ text: meta.summary });
      expect(r["fullDescription"]).toEqual({ text: meta.why });
      expect(r["defaultConfiguration"]).toEqual({ level: meta.defaultSeverity });
      const tags = r["properties"].tags as string[];
      expect(tags).toEqual({ security: ["security"], format: ["steering"], budget: ["budget"], drift: ["drift"], config: ["steering"] }[meta.category]);
      if (meta.category === "security") expect(r["properties"]["security-severity"]).toBe({ error: "8.0", warning: "5.0", note: "2.0" }[meta.defaultSeverity]);
      else expect(r["properties"]["security-severity"]).toBeUndefined();
    }
    expect(RULE_DOCS).toBe("https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/");
  });
  test("results: ruleIndex points at the rule, region and fingerprint are set", () => {
    const { log } = sarif(FIXTURE_REPO);
    const run = log.runs[0]!;
    expect(run.results.length).toBeGreaterThan(5);
    for (const r of run.results) {
      expect(run.tool.driver.rules[r.ruleIndex!]!["id"]).toBe(r.ruleId);
      const loc = r.locations[0]!.physicalLocation;
      expect(loc.artifactLocation.uriBaseId).toBe("%SRCROOT%");
      expect(loc.region["startLine"]).toBeGreaterThanOrEqual(1);
      expect(loc.region["endColumn"]).toBeGreaterThanOrEqual(1);
      expect(r.partialFingerprints["asitis/v1"]).toMatch(/^[0-9a-f]{64}$/);
      expect(["error", "warning", "note"]).toContain(r.level);
    }
  });
  test("results match the JSON findings one to one", () => {
    const j = JSON.parse(spawnSync(process.execPath, [CLI, "lint", "--root", FIXTURE_REPO, "--format", "json"], { encoding: "utf8" }).stdout);
    const s = sarif(FIXTURE_REPO).log.runs[0]!.results;
    expect(s.map((r) => [r.ruleId, r.partialFingerprints["asitis/v1"], r.level])).toEqual(j.findings.map((f: Finding) => [f.ruleId, f.fingerprint, f.severity]));
  });
});

describe("file URIs", () => {
  test.each([
    ["CLAUDE.md", "CLAUDE.md"],
    ["my notes/CLAUDE.md", "my%20notes/CLAUDE.md"],
    ["a#b/CLAUDE.md", "a%23b/CLAUDE.md"],
    ["100%/CLAUDE.md", "100%25/CLAUDE.md"],
    ["café/日本/CLAUDE.md", "caf%C3%A9/%E6%97%A5%E6%9C%AC/CLAUDE.md"],
    ["q?x=1&y/CLAUDE.md", "q%3Fx%3D1%26y/CLAUDE.md"],
  ])("%s -> %s", (p, uri) => {
    expect(toUri(p)).toBe(uri);
    expect(uri.split("/").map(decodeURIComponent).join("/")).toBe(p);
    expect(new URL(uri, "file:///src/").pathname.startsWith("/src/")).toBe(true);
  });
  test("end to end: a skill folder with a space, #, % and non-ASCII in its name", () => {
    const name = "a b#c%d-é";
    const dir = tmp({ [`.claude/skills/${name}/SKILL.md`]: "---\nname: Bad Name\ndescription: Does a thing when asked to do the thing.\n---\n\n# Thing\n\nDo it.\n" });
    const { log } = sarif(dir);
    expectValid(log);
    const uris = new Set(log.runs[0]!.results.map((r) => r.locations[0]!.physicalLocation.artifactLocation.uri));
    expect([...uris]).toEqual([".claude/skills/a%20b%23c%25d-%C3%A9/SKILL.md"]);
  });
});

describe("--root a subfolder", () => {
  // Code scanning resolves %SRCROOT% to the checkout, so a relative --root must be part of the uri.
  test("uris are relative to the current folder, fingerprints are not", () => {
    const rel = path.relative(REPO, FIXTURE_REPO).split(path.sep).join("/");
    const sub = sarif(rel).log.runs[0]!.results;
    const here = spawnSync(process.execPath, [CLI, "lint", "--format", "sarif"], { encoding: "utf8", cwd: FIXTURE_REPO });
    const top = (JSON.parse(here.stdout) as { runs: Array<{ results: SarifResult[] }> }).runs[0]!.results;
    expect(sub.length).toBe(top.length);
    for (const [i, r] of sub.entries()) {
      expect(r.locations[0]!.physicalLocation.artifactLocation.uri).toBe(`${rel}/${top[i]!.locations[0]!.physicalLocation.artifactLocation.uri}`);
      expect(r.partialFingerprints).toEqual(top[i]!.partialFingerprints);
    }
  });
  test("an absolute root is not prefixed, so no absolute path appears", () => {
    const { text, log } = sarif(FIXTURE_REPO);
    expect(text).not.toContain(REPO);
    const uris = log.runs[0]!.results.map((r) => r.locations[0]!.physicalLocation.artifactLocation.uri);
    expect(uris).toContain("CLAUDE.md");
    for (const u of uris) expect(u).not.toMatch(/^(\/|[A-Za-z]:|\.\.)/);
  });
});

describe("fingerprints", () => {
  const text = "# Rules\n\n- Always run the tests before you push a branch\n- Always run the tests before you push a branch\n\nSee [guide](docs/missing.md).\n<!-- note to self -->\n";
  test("stable across a CRLF to LF conversion", () => {
    const lf = tmp({ "CLAUDE.md": text });
    const crlf = tmp({ "CLAUDE.md": text.replace(/\n/g, "\r\n") });
    const a = sarif(lf).log.runs[0]!.results;
    const b = sarif(crlf).log.runs[0]!.results;
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(b.map((r) => [r.ruleId, r.partialFingerprints["asitis/v1"]])).toEqual(a.map((r) => [r.ruleId, r.partialFingerprints["asitis/v1"]]));
  });
  test("stable when lines are inserted above", () => {
    const a = sarif(tmp({ "CLAUDE.md": text })).log.runs[0]!.results;
    const b = sarif(tmp({ "CLAUDE.md": text.replace("# Rules\n", "# Rules\n\nIntro paragraph added later.\n") })).log.runs[0]!.results;
    expect(b.map((r) => r.partialFingerprints["asitis/v1"]).sort()).toEqual(a.map((r) => r.partialFingerprints["asitis/v1"]).sort());
  });
});

describe("suppressions and fixes", () => {
  const base: Finding = { ruleId: "duplicate-rule", severity: "warning", category: "format", path: "docs/my notes.md", line: 3, column: 1, endLine: 3, endColumn: 20, message: "Same rule as line 1", fingerprint: "a".repeat(64) };
  const findings: Finding[] = [
    base,
    { ...base, line: 5, fingerprint: "b".repeat(64), suppressed: { kind: "inSource", justification: "the two sections are alternatives" } },
    { ...base, line: 7, fingerprint: "c".repeat(64), suppressed: { kind: "external" } },
    {
      ...base,
      ruleId: "invisible-char",
      severity: "error",
      category: "security",
      line: 9,
      fingerprint: "d".repeat(64),
      fix: { safety: "safe", diff: "--- a\n+++ b\n", edits: [{ startByte: 10, endByte: 13, replacement: "" }] },
    },
  ];
  const log = JSON.parse(formatSarif(buildReport(".", 1, findings)));
  const results = log.runs[0].results;
  test("valid against the schema", () => expectValid(log));
  test("suppressed findings stay in the log, marked", () => {
    expect(results).toHaveLength(4);
    expect(results[0].suppressions).toBeUndefined();
    expect(results[1].suppressions).toEqual([{ kind: "inSource", justification: "the two sections are alternatives" }]);
    expect(results[2].suppressions).toEqual([{ kind: "external" }]);
  });
  test("a fix becomes fixes[] with byte regions", () => {
    expect(results[3].fixes).toEqual([
      {
        description: { text: "safe fix for invisible-char" },
        artifactChanges: [{ artifactLocation: { uri: "docs/my%20notes.md", uriBaseId: "%SRCROOT%" }, replacements: [{ deletedRegion: { byteOffset: 10, byteLength: 3 }, insertedContent: { text: "" } }] }],
      },
    ]);
    expect(results[0].fixes).toBeUndefined();
  });
});
