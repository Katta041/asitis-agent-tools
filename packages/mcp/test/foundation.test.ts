// The 0.3.0 seams: lintProject, findings and fingerprints, read classes, redaction and the stubs
// later tracks fill in. The stubs are tested for their "off" behaviour, so a track that fills one
// in updates the matching test here.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Deadline } from "../src/discover.js";
import { buildReport, compareFindings, fingerprint, normaliseLineText, type Finding } from "../src/findings.js";
import { CAPS } from "../src/limits.js";
import { commonRefusal, Sandbox, UserError } from "../src/paths.js";
import { lintProject } from "../src/project.js";
import { findSecrets, preview, redact, redactValue } from "../src/redact.js";
import { connect, FIXTURE_REPO, tempDir, type Connected } from "./helpers.js";

const deadline = (): Deadline => new Deadline(CAPS.callBudgetMs);

describe("lintProject", () => {
  test("gives the same issues as lint_steering and sorted findings with fingerprints", async () => {
    const sb = await Sandbox.create([FIXTURE_REPO]);
    const p = await lintProject(sb, { deadline: deadline() });
    expect(p.discovered).toBe(true);
    expect(p.results.length).toBeGreaterThan(5);
    expect(p.notes).toEqual([]);
    const f = p.findings();
    expect(f.length).toBe(p.results.reduce((a, r) => a + r.issues.length, 0));
    expect([...f].sort(compareFindings)).toEqual(f);
    for (const x of f) {
      expect(x.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(x.path).not.toMatch(/^\/|\\|symlink to/);
      expect(x.endLine).toBeGreaterThanOrEqual(x.line);
    }
    expect(new Set(f.map((x) => x.fingerprint)).size).toBe(f.length);
    expect(p.findings()).toBe(f); // computed once
    const c = await connect([FIXTURE_REPO]);
    const r = await c.call("lint_steering", {});
    await c.close();
    expect(r.structured["files"]).toEqual(JSON.parse(JSON.stringify(p.results)));
  });

  test("a single named file that cannot be read throws, as lint_steering always did", async () => {
    const sb = await Sandbox.create([FIXTURE_REPO]);
    await expect(lintProject(sb, { targets: ["missing.md"], deadline: deadline() })).rejects.toBeInstanceOf(UserError);
  });

  test("include asks for a scan that is not available yet: a notice, nothing read", async () => {
    const sb = await Sandbox.create([FIXTURE_REPO]);
    const p = await lintProject(sb, { targets: ["CLAUDE.md", "scripts/setup.sh"], include: ["skills", "config-local"], deadline: deadline() });
    expect(p.include.has("config")).toBe(true); // config-local implies config
    // Both opt-in scans are live: skills (WP5) and config (WP6). The skill scan finds no skill folder and says so.
    expect(p.notes).toEqual([
      "Skill scan: no skill folders (folders with a SKILL.md) were found among the linted files.",
    ]);
    // The script path is not claimed by any check, so it fails as a non-markdown path does today.
    expect(p.failures.map((x) => x.path)).toEqual(["scripts/setup.sh"]);
    expect(p.results.map((x) => x.path)).toEqual(["CLAUDE.md"]);
  });

  test("lint_steering accepts include and shows the scan note; without include the text has none", async () => {
    const c = await connect([FIXTURE_REPO], { structured: false });
    const withInclude = await c.call("lint_steering", { path: "CLAUDE.md", include: ["skills"] });
    const without = await c.call("lint_steering", { path: "CLAUDE.md" });
    const bad = await c.client.callTool({ name: "lint_steering", arguments: { include: ["everything"] } }).catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
    await c.close();
    expect(withInclude.text).toContain("Skill scan: no skill folders (folders with a SKILL.md) were found among the linted files.");
    expect(withInclude.text.startsWith(without.text.split("\n")[0]!)).toBe(true);
    expect(without.text).not.toContain("include");
    expect(without.text).not.toContain("Skill scan");
    expect(bad.isError).toBe(true);
  });
});

describe("fingerprints", () => {
  let dir: string;
  let cleanup: () => void;
  beforeAll(() => {
    ({ dir, cleanup } = tempDir());
    const body = ["# Rules", "", "- Use tabs for indentation in every file.", "- Use tabs for indentation in every file.", ""];
    for (const [name, eol, extra] of [["lf", "\n", 0], ["crlf", "\r\n", 0], ["shifted", "\n", 3]] as const) {
      mkdirSync(path.join(dir, name));
      const lines = [...body.slice(0, 1), ...Array.from({ length: extra }, (_, i) => `Intro line ${i}.`), ...body.slice(1)];
      writeFileSync(path.join(dir, name, "CLAUDE.md"), lines.join(eol));
    }
  });
  afterAll(() => cleanup());

  const fps = async (sub: string): Promise<Finding[]> => {
    const sb = await Sandbox.create([path.join(dir, sub)]);
    return (await lintProject(sb, { targets: ["CLAUDE.md"], deadline: deadline() })).findings();
  };

  test("identical under CRLF and LF, and after lines are inserted above", async () => {
    const lf = await fps("lf");
    const dup = lf.find((f) => f.ruleId === "duplicate-rule");
    expect(dup).toBeDefined();
    const crlf = (await fps("crlf")).find((f) => f.ruleId === "duplicate-rule");
    const shifted = (await fps("shifted")).find((f) => f.ruleId === "duplicate-rule");
    expect(crlf?.fingerprint).toBe(dup!.fingerprint);
    expect(shifted?.line).toBe(dup!.line + 3);
    expect(shifted?.fingerprint).toBe(dup!.fingerprint);
  });

  test("the occurrence index tells two findings on identical lines apart", () => {
    expect(fingerprint("r", "a.md", "x", 0)).not.toBe(fingerprint("r", "a.md", "x", 1));
    expect(fingerprint("r", "a.md", "  x \r", 0)).toBe(fingerprint("r", "a.md", "x", 0));
    expect(normaliseLineText(" a \t b\r\n")).toBe("a b");
  });

  test("buildReport counts suppressed findings apart from the rest", () => {
    const base = { category: "format" as const, path: "a.md", line: 1, column: 1, endLine: 1, endColumn: 2, message: "m" };
    const r = buildReport(".", 1, [
      { ...base, ruleId: "a", severity: "error" },
      { ...base, ruleId: "b", severity: "note" },
      { ...base, ruleId: "c", severity: "warning", suppressed: { kind: "external" } },
    ]);
    expect(r.schemaVersion).toBe(1);
    expect(r.tool.name).toBe("asitis");
    expect(r.summary).toEqual({ files: 1, errors: 1, warnings: 0, notes: 1, suppressed: 1 });
  });
});

describe("read classes", () => {
  let dir: string;
  let cleanup: () => void;
  let sb: Sandbox;
  beforeAll(async () => {
    ({ dir, cleanup } = tempDir());
    mkdirSync(path.join(dir, ".claude/skills/demo"), { recursive: true });
    mkdirSync(path.join(dir, ".git"));
    writeFileSync(path.join(dir, ".claude/skills/demo/SKILL.md"), "---\nname: demo\ndescription: d\n---\n");
    writeFileSync(path.join(dir, ".claude/skills/demo/run.sh"), "#!/bin/sh\necho hello\n");
    writeFileSync(path.join(dir, ".claude/skills/demo/.env"), "TOKEN=x\n");
    writeFileSync(path.join(dir, ".claude/settings.json"), "{}\n");
    writeFileSync(path.join(dir, ".asitisrc.json"), "{}\n");
    sb = await Sandbox.create([dir]);
  });
  afterAll(() => cleanup());

  test("live policies: skill-script (WP5) and asitisrc (WP2) read, agent-config still refuses", async () => {
    // skill-script is live (WP5): a script in a skill folder opens; its own tests are in skills.test.ts.
    expect((await sb.openAs("skill-script", ".claude/skills/demo/run.sh")).buf.toString()).toContain("echo hello");
    await expect(sb.openAs("agent-config", ".claude/settings.json")).rejects.toThrow(/reading agent config is not enabled/);
    expect((await sb.openAs("asitisrc", ".asitisrc.json")).buf.toString()).toBe("{}\n"); // WP2: config is readable now
  });

  test("shared refusals run before any class policy", async () => {
    await expect(sb.openAs("skill-script", ".claude/skills/demo/.env")).rejects.toThrow(/never reads \.env files/);
    expect(commonRefusal("a/.git/config")).toMatch(/inside \.git/);
    expect(commonRefusal("x/node_modules/y.js")).toMatch(/node_modules/);
    expect(commonRefusal("a/b.md:stream", "win32")).toMatch(/alternate data stream/);
    expect(commonRefusal("skills/x/run.sh")).toBeNull();
  });

  test("markdown reads are unchanged: settings are still refused, markdown still opens", async () => {
    await expect(sb.open(".claude/settings.json")).rejects.toThrow(/never reads settings/);
    await expect(sb.openAs("markdown", ".claude/settings.json")).rejects.toThrow(/never reads settings/);
    expect((await sb.openAs("markdown", ".claude/skills/demo/SKILL.md")).buf.length).toBeGreaterThan(0);
  });

  test("listDir lists without reading and refuses .git", async () => {
    const l = await sb.listDir(".claude/skills/demo");
    expect(l.entries.map((e) => e.name).sort()).toEqual([".env", "SKILL.md", "run.sh"]);
    expect(l.entries.every((e) => e.type === "file")).toBe(true);
    await expect(sb.listDir(".git")).rejects.toThrow(/Refused/);
    await expect(sb.listDir("../")).rejects.toThrow(/outside/);
  });
});

describe("redact", () => {
  // Built from parts so this file holds no complete token shape.
  const gh = "ghp_" + "A".repeat(36);
  const ant = "sk-ant-" + "b".repeat(40);
  const aws = "AKIA" + "ABCDEFGHIJKLMNOP";

  test("finds common key shapes and never shows more than 4 characters", () => {
    const text = `token ${gh} and ${ant} and ${aws} end`;
    expect(findSecrets(text).map((s) => s.type)).toEqual(["GitHub token", "Anthropic API key", "AWS access key"]);
    const r = redact(text);
    expect(r).not.toContain(gh);
    expect(r).not.toContain(ant.slice(0, 10));
    expect(r).toContain(`ghp_[redacted, ${gh.length} chars]`);
    expect(redactValue("abcdefgh")).toBe("abcd[redacted, 8 chars]");
  });

  test("preview redacts before cutting to 80 characters", () => {
    const p = preview(`${"x".repeat(70)} ${gh}`);
    expect(p.length).toBeLessThanOrEqual(80);
    expect(p).not.toContain("AAAAA");
    expect(preview("short\r\nline")).toBe("short line");
  });

  test("ordinary text and hashes are left alone", () => {
    const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(redact(`commit ${sha} sk-short`)).toBe(`commit ${sha} sk-short`);
  });

  test("linear on adversarial input", () => {
    const t0 = performance.now();
    findSecrets("sk-".repeat(200_000) + "ghp_".repeat(200_000));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("suggest_fixes registration", () => {
  let c: Connected;
  beforeAll(async () => {
    c = await connect([FIXTURE_REPO]);
  });
  afterAll(async () => c.close());
  test("is registered and read-only; WP7 fills the body (test/fix.test.ts)", async () => {
    const { tools } = await c.client.listTools();
    const t = tools.find((x) => x.name === "suggest_fixes");
    expect(t?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    const r = await c.call("suggest_fixes", { path: "CLAUDE.md" });
    expect(r.isError).toBe(false);
    expect(r.structured).toMatchObject({ available: true });
  });
});
