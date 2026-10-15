// WP2: .asitisrc.json. Validation errors (file, line, "did you mean"), thresholds, overrides,
// presets, ignore, the read policy, and lint_steering applying it exactly as lintProject does.
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LENGTH_OPTIONS, loadConfig, matchesAny, parseJsonLines, validateConfig } from "../src/config.js";
import { Deadline } from "../src/discover.js";
import { CAPS } from "../src/limits.js";
import { Sandbox, UserError } from "../src/paths.js";
import { lintProject, type ProjectResult } from "../src/project.js";
import { connect, PKG, tempDir } from "./helpers.js";

const deadline = (): Deadline => new Deadline(CAPS.callBudgetMs);
const DUP = "- Use tabs for indentation in every file.";

let t: ReturnType<typeof tempDir>;
beforeAll(() => {
  t = tempDir("asitis-config-");
});
afterAll(() => t.cleanup());

/** A fresh project folder with the given files. */
function project(name: string, files: Record<string, string>): string {
  const dir = path.join(t.dir, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

async function lint(dir: string, opts: { targets?: string[]; configPath?: string } = {}): Promise<ProjectResult> {
  const sb = await Sandbox.create([dir]);
  return lintProject(sb, { deadline: deadline(), ...opts });
}

/** The error message loadConfig gives for a config text, or "" when it loads. */
async function configError(name: string, text: string): Promise<string> {
  const dir = project(name, { ".asitisrc.json": text });
  const sb = await Sandbox.create([dir]);
  try {
    await loadConfig(sb, {});
    return "";
  } catch (e) {
    expect(e).toBeInstanceOf(UserError); // the CLI turns UserError into exit code 2
    return (e as Error).message;
  }
}

const rules = (p: ProjectResult, file: string): string[] => p.results.find((r) => r.path === file)!.issues.map((i) => i.rule);

describe("validation: every mistake names the file and line, with a suggestion", () => {
  test.each([
    ["unknown top-level key", '{\n  "rulez": {}\n}\n', '.asitisrc.json line 2: unknown key "rulez" (did you mean "rules"?)'],
    ["unknown key, extend", '{\n  "extend": "strict"\n}\n', '.asitisrc.json line 2: unknown key "extend" (did you mean "extends"?)'],
    ["unknown rule id", '{\n  "rules": {\n    "duplicate-rules": "off"\n  }\n}\n', '.asitisrc.json line 3: rules: "duplicate-rules" is not an asitis rule (did you mean "duplicate-rule"?)'],
    ["bad severity", '{\n  "rules": {\n    "length": "warn"\n  }\n}\n', '.asitisrc.json line 3: rules.length must be "error", "warning", "note" or "off", not "warn" (did you mean "warning"?)'],
    ["bad severity in a list", '{"rules": {"length": ["eror", {"claudeMdLines": 3}]}}', '.asitisrc.json line 1: rules.length[0] must be "error", "warning", "note" or "off", not "eror" (did you mean "error"?)'],
    ["unknown length option", '{"rules": {\n"length": ["warning", {"claudeMdLine": 300}]}}', '.asitisrc.json line 2: unknown option "claudeMdLine" for length (did you mean "claudeMdLines"?)'],
    ["bad option type", '{"rules": {"length": ["warning", {\n"claudeMdLines": "300"}]}}', '.asitisrc.json line 2: rules.length[1].claudeMdLines must be a whole number from 1 to 100,000,000, not "300"'],
    ["option on a rule without options", '{"rules": {"duplicate-rule": ["warning", {"x": 1}]}}', '.asitisrc.json line 1: rules.duplicate-rule takes no options; only "length" has options (claudeMdLines, skillMdLines, cursorRuleLines, codexBytes, windsurfChars, memoryIndexLines)'],
    ["bad extends", '{\n\n  "extends": "strct"\n}', '.asitisrc.json line 3: extends must be "recommended" or "strict", not "strct" (did you mean "strict"?)'],
    ["bad include", '{"include": ["skill"]}', '.asitisrc.json line 1: include values are "skills", "config" and "config-local", not "skill" (did you mean "skills"?)'],
    ["unknown override key", '{"overrides": [{"files": ["docs/**"],\n "rule": {}}]}', '.asitisrc.json line 2: unknown key "rule" in overrides[0] (did you mean "rules"?)'],
    ["override without files", '{"overrides": [\n{"rules": {}}]}', '.asitisrc.json line 2: overrides[0] needs "files", a list of glob patterns'],
    ["unknown rule in an override", '{"overrides": [{"files": ["a/**"], "rules": {\n"contradictions": "off"}}]}', '.asitisrc.json line 2: overrides[0].rules: "contradictions" is not an asitis rule (did you mean "contradiction"?)'],
    ["negated glob", '{"ignore": [\n"!docs/**"]}', '.asitisrc.json line 2: ignore[0] starts with "!"; negated patterns are not supported, list the files to match instead'],
    ["glob outside the root", '{"ignore": ["../x/**"]}', '.asitisrc.json line 1: ignore[0] points outside the project folder'],
    ["ignore as a string", '{"ignore": "vendor/**"}', '.asitisrc.json line 1: ignore must be a list of glob patterns such as ["vendor/**"], not "vendor/**"'],
    ["duplicate key", '{\n"rules": {},\n"rules": {}\n}', '.asitisrc.json line 3: key "rules" appears twice; keep one'],
    ["trailing comma", '{\n"rules": {},\n}', ".asitisrc.json line 3: invalid JSON: trailing comma before }"],
    ["comment", '{\n// no\n}', '.asitisrc.json line 2: invalid JSON: expected a key in double quotes, found "/"'],
    ["not an object", "[]", ".asitisrc.json line 1: the config must be a JSON object, not a list"],
    ["empty file", "\n\n", ".asitisrc.json line 3: the file is empty; it must hold a JSON object"],
    ["unclosed", '{\n"rules": {', ".asitisrc.json line 2: invalid JSON: expected a key in double quotes, found the end of the file"],
  ])("%s", async (name, text, message) => {
    expect(await configError(name.replace(/\W+/g, "-"), text)).toBe(message);
  });

  test("a rule reserved for a later version is not accepted yet", async () => {
    expect(await configError("planned", '{"rules": {"sec-image-exfil": "off"}}')).toBe('.asitisrc.json line 1: rules: "sec-image-exfil" is not available in this version of asitis');
  });

  test("values that could be secrets are never echoed", async () => {
    const secret = "ghp_" + "Z".repeat(36);
    const msg = await configError("secret", `{"rules": {"length": "${secret}"}}`);
    expect(msg).not.toContain(secret.slice(4, 12));
    expect(msg).toContain("[redacted, 40 chars]");
  });

  test("lint_steering shows the same error instead of linting", async () => {
    const dir = project("mcp-error", { "CLAUDE.md": "# Hi\n", ".asitisrc.json": '{\n  "rulez": {}\n}\n' });
    const c = await connect([dir], { structured: false });
    const r = await c.call("lint_steering", {});
    await c.close();
    expect(r.isError).toBe(true);
    expect(r.text).toContain('.asitisrc.json line 2: unknown key "rulez" (did you mean "rules"?)');
    expect(r.text).not.toContain(dir);
  });

  test("the example from the contract loads", () => {
    const text = JSON.stringify({
      $schema: "https://asitis.app/schema/asitisrc-1.json",
      extends: "recommended",
      rules: { "duplicate-rule": "off", length: ["warning", { claudeMdLines: 300 }], "hidden-comment": "error" },
      ignore: ["vendor/**", "examples/**"],
      overrides: [{ files: ["docs/**"], rules: { contradiction: "off" } }],
      include: ["skills", "config"],
    }, null, 2);
    const c = validateConfig(parseJsonLines(text, ".asitisrc.json"), ".asitisrc.json");
    expect(c.rules["length"]).toEqual({ severity: "warning", options: { claudeMdLines: 300 } });
    expect(c.overrides).toEqual([{ files: ["docs/**"], rules: { contradiction: { severity: "off" } } }]);
    expect(c.include).toEqual(["skills", "config"]);
  });
});

describe("the JSON schema matches what asitis accepts", () => {
  const schema = JSON.parse(readFileSync(path.join(PKG, "schema/asitisrc-1.json"), "utf8"));
  test("same top-level keys, same length options, same severities", () => {
    expect(schema.$id).toBe("https://asitis.app/schema/asitisrc-1.json");
    expect(Object.keys(schema.properties).sort()).toEqual(["$schema", "extends", "ignore", "include", "overrides", "rules"]);
    expect(Object.keys(schema.$defs.lengthOptions.properties)).toEqual([...LENGTH_OPTIONS]);
    expect(schema.$defs.severity.enum).toEqual(["error", "warning", "note", "off"]);
    expect(schema.properties.extends.enum).toEqual(["recommended", "strict"]);
    expect(schema.properties.include.items.enum).toEqual(["skills", "config", "config-local"]);
  });
});

describe("applying config", () => {
  const long = (n: number): string => ["# Project", ...Array.from({ length: n - 1 }, (_, i) => `Line ${i} of the notes.`)].join("\n") + "\n";

  test("no config file: nothing changes, and nothing extra is read", async () => {
    const dir = project("none", { "CLAUDE.md": long(250) });
    const p = await lint(dir);
    expect(p.config).toBeNull();
    expect(rules(p, "CLAUDE.md")).toContain("length");
  });

  test("thresholds change length findings both ways", async () => {
    const hi = await lint(project("threshold-hi", { "CLAUDE.md": long(250), ".asitisrc.json": '{"rules": {"length": ["warning", {"claudeMdLines": 300}]}}' }));
    expect(rules(hi, "CLAUDE.md")).not.toContain("length");
    const lo = await lint(project("threshold-lo", { "CLAUDE.md": long(150), ".asitisrc.json": '{"rules": {"length": ["error", {"claudeMdLines": 100}]}}' }));
    const f = lo.findings().find((x) => x.ruleId === "length")!;
    expect(f.severity).toBe("error");
    expect(f.message).toBe("150 lines; over the limit of 100 lines this project sets for CLAUDE.md in .asitisrc.json (Claude Code recommends under 200). Shorten it or move detail into files it links to");
  });

  test("a MEMORY.md line threshold moves the finding to the first line that does not load", async () => {
    const lines = ["# Memory", ...Array.from({ length: 79 }, (_, i) => `- [Note ${i}](n${i}.md): a note`)].join("\n") + "\n";
    const dir = project("memory", { "memory/MEMORY.md": lines, ".asitisrc.json": '{"rules": {"length": ["warning", {"memoryIndexLines": 50}]}}' });
    const p = await lint(dir, { targets: ["memory/MEMORY.md"] });
    const f = p.findings().filter((x) => x.ruleId === "length");
    expect(f.map((x) => x.line)).toEqual([51]);
  });

  test("off removes a rule, a severity replaces the one lint chose", async () => {
    const dir = project("off", { "CLAUDE.md": `# Rules\n\n${DUP}\n${DUP}\n<!-- a note -->\n`, ".asitisrc.json": '{"rules": {"duplicate-rule": "off", "hidden-comment": "error"}}' });
    const p = await lint(dir);
    expect(rules(p, "CLAUDE.md")).toEqual(["hidden-comment"]);
    expect(p.findings()[0]!.severity).toBe("error");
  });

  test("security rules can be turned off in config (it shows up in review)", async () => {
    const dir = project("sec-off", { "CLAUDE.md": `# Rules\n\nUse tabs${String.fromCharCode(0x200b)} here.\n`, ".asitisrc.json": '{"rules": {"invisible-char": "off"}}' });
    expect(rules(await lint(dir), "CLAUDE.md")).toEqual([]);
  });

  test("overrides apply by glob, in order, after rules", async () => {
    const body = `# Rules\n\n${DUP}\n${DUP}\n`;
    const dir = project("overrides", {
      "CLAUDE.md": body,
      "docs/CLAUDE.md": body,
      "docs/legacy/CLAUDE.md": body,
      ".asitisrc.json": JSON.stringify({
        rules: { "duplicate-rule": "error" },
        overrides: [
          { files: ["docs/**"], rules: { "duplicate-rule": "note" } },
          { files: ["docs/legacy/"], rules: { "duplicate-rule": "off" } },
        ],
      }),
    });
    const p = await lint(dir);
    const sev = (file: string): string[] => p.findings().filter((f) => f.path === file && f.ruleId === "duplicate-rule").map((f) => f.severity);
    expect(sev("CLAUDE.md")).toEqual(["error"]);
    expect(sev("docs/CLAUDE.md")).toEqual(["note"]);
    expect(sev("docs/legacy/CLAUDE.md")).toEqual([]);
  });

  test("an override can change one threshold and keep the others", async () => {
    const dir = project("override-threshold", {
      "CLAUDE.md": long(150),
      "docs/CLAUDE.md": long(150),
      ".asitisrc.json": JSON.stringify({ rules: { length: ["warning", { claudeMdLines: 100, skillMdLines: 10 }] }, overrides: [{ files: ["docs/**"], rules: { length: ["warning", { claudeMdLines: 1000 }] } }] }),
    });
    const p = await lint(dir);
    expect(rules(p, "CLAUDE.md")).toContain("length");
    expect(rules(p, "docs/CLAUDE.md")).not.toContain("length");
  });

  test("ignore drops files from a folder walk and from named paths", async () => {
    const dir = project("ignore", { "CLAUDE.md": "# A\n", "vendor/x/CLAUDE.md": `${DUP}\n${DUP}\n`, ".asitisrc.json": '{"ignore": ["vendor/**"]}' });
    const p = await lint(dir);
    expect(p.results.map((r) => r.path)).toEqual(["CLAUDE.md"]);
    expect(p.docs.length).toBe(1);
    const named = await lint(dir, { targets: ["CLAUDE.md", "vendor/x/CLAUDE.md"] });
    expect(named.results.map((r) => r.path)).toEqual(["CLAUDE.md"]);
  });

  test("extends strict raises notes to warnings, keeps explicit severities, and turns the sec-* scans on", async () => {
    const dir = project("strict", { "CLAUDE.md": "# Rules\n\n<!-- a note -->\n", "AGENTS.md": "# A\n\n<!-- b -->\n", ".asitisrc.json": '{"extends": "strict", "overrides": [{"files": ["AGENTS.md"], "rules": {"hidden-comment": "note"}}]}' });
    const p = await lint(dir);
    const sev = (file: string): string | undefined => p.findings().find((f) => f.path === file)?.severity;
    expect(sev("CLAUDE.md")).toBe("warning");
    expect(sev("AGENTS.md")).toBe("note");
    expect(p.config?.include).toEqual(["skills", "config"]);
  });

  test("the CLI path (configInclude) honours include and strict from the config", async () => {
    const dir = project("cli-include", { "CLAUDE.md": "# A\n", ".asitisrc.json": '{"extends": "strict"}' });
    const sb = await Sandbox.create([dir]);
    const p = await lintProject(sb, { deadline: deadline(), configInclude: true });
    expect([...p.include].sort()).toEqual(["config", "skills"]);
    expect(p.notes.some((x) => x.includes("asks for"))).toBe(false);
    const dir2 = project("cli-include-key", { "CLAUDE.md": "# A\n", ".asitisrc.json": '{"include": ["config-local"]}' });
    const p2 = await lintProject(await Sandbox.create([dir2]), { deadline: deadline(), configInclude: true });
    expect([...p2.include].sort()).toEqual(["config", "config-local"]);
  });

  describe("a repo's config never widens what the MCP server reads", () => {
    test.each([
      ["strict", '{"extends": "strict"}', "skills/config"],
      ["include", '{"include": ["config"]}', "config"],
      ["include config-local", '{"include": ["skills", "config-local"]}', "skills/config-local"],
    ])("%s: nothing extra is read, and the result says how to opt in", async (name, cfg, scans) => {
      const dir = project(`mcp-include-${name.replace(/\W+/g, "-")}`, { "CLAUDE.md": "# A\n", ".asitisrc.json": cfg });
      const p = await lint(dir);
      expect([...p.include]).toEqual([]);
      const note = `.asitisrc.json asks for the ${scans} scan; pass include to lint_steering to run it.`;
      expect(p.notes).toEqual([note]);
      const c = await connect([dir], { structured: false });
      const r = await c.call("lint_steering", {});
      await c.close();
      expect(r.isError).toBe(false);
      expect(r.text).toContain(note);
      expect(r.text).not.toContain("not available in this build yet");
    });

    test("include from the call is honoured; only what the config adds beyond it is noted", async () => {
      const dir = project("mcp-include-call", { "CLAUDE.md": "# A\n", ".asitisrc.json": '{"extends": "strict"}' });
      const sb = await Sandbox.create([dir]);
      const p = await lintProject(sb, { deadline: deadline(), include: ["skills"] });
      expect([...p.include]).toEqual(["skills"]);
      expect(p.notes.filter((x) => x.includes("asks for"))).toEqual([".asitisrc.json asks for the config scan; pass include to lint_steering to run it."]);
      const all = await lintProject(sb, { deadline: deadline(), include: ["skills", "config-local"] });
      expect(all.notes.filter((x) => x.includes("asks for"))).toEqual([]);
    });

    test("strict still raises notes to warnings in lint_steering", async () => {
      const dir = project("mcp-strict-sev", { "CLAUDE.md": "# Rules\n\n<!-- a note -->\n", ".asitisrc.json": '{"extends": "strict"}' });
      const c = await connect([dir], { structured: false });
      const r = await c.call("lint_steering", {});
      await c.close();
      expect(r.text.split("\n")[0]).toBe("Linted 1 file: 0 errors, 1 warning, 0 notes.");
    });
  });

  test("recommended is the default and changes nothing", async () => {
    const dir = project("recommended", { "CLAUDE.md": "# Rules\n\n<!-- a note -->\n", ".asitisrc.json": '{"extends": "recommended"}' });
    expect((await lint(dir)).findings().map((f) => f.severity)).toEqual(["note"]);
  });

  test("lint_steering applies config the way lintProject does", async () => {
    const dir = project("mcp-same", {
      "CLAUDE.md": `# Rules\n\n${DUP}\n${DUP}\n<!-- a note -->\n`,
      "docs/AGENTS.md": `${DUP}\n${DUP}\n`,
      ".asitisrc.json": '{"rules": {"hidden-comment": "off"}, "overrides": [{"files": ["docs/**"], "rules": {"duplicate-rule": "error"}}]}',
    });
    const p = await lint(dir);
    const c = await connect([dir]);
    const r = await c.call("lint_steering", {});
    await c.close();
    expect(r.structured["files"]).toEqual(JSON.parse(JSON.stringify(p.results)));
    expect(r.text).toMatch(/^Linted 2 files: 1 error, 1 warning, 0 notes\./);
  });
});

describe("globs", () => {
  test.each([
    [["vendor/**"], "vendor/a/CLAUDE.md", true],
    [["vendor/**"], "src/vendor/CLAUDE.md", false],
    [["vendor"], "src/vendor/CLAUDE.md", true],
    [["vendor/"], "vendor/CLAUDE.md", true],
    [["/vendor"], "src/vendor/CLAUDE.md", false],
    [["./docs/*.md"], "docs/a.md", true],
    [["docs/*.md"], "docs/x/a.md", false],
    [["docs/**/*.md"], "docs/x/y/a.md", true],
    [["docs/**/*.md"], "docs/a.md", true],
    [["*.mdc"], ".cursor/rules/a.mdc", true],
    [["CLAUDE.md"], "pkg/CLAUDE.md", true],
    [["a?c/**"], "abc/x.md", true],
    [["a?c/**"], "ac/x.md", false],
    [[], "x.md", false],
  ])("%j against %s is %s", (globs, p, want) => {
    expect(matchesAny(globs, p)).toBe(want);
  });

  test("adversarial patterns stay fast", () => {
    const globs = Array.from({ length: 200 }, (_, i) => `${"*a".repeat(120)}${i}/**/${"**/".repeat(30)}*b`);
    const paths = Array.from({ length: 300 }, (_, i) => `${"a".repeat(200)}/${"x/".repeat(40)}${"a".repeat(200)}${i}.md`);
    const t0 = performance.now();
    for (const p of paths) matchesAny(globs, p);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("read policy", () => {
  test(".asitisrc.json over 64 KB is refused", async () => {
    const dir = project("big", { ".asitisrc.json": `{"$schema": "${"x".repeat(70 * 1024)}"}` });
    const sb = await Sandbox.create([dir]);
    await expect(loadConfig(sb, {})).rejects.toThrow("File too large: .asitisrc.json is 71,695 bytes; the limit is 65,536 bytes for AsItIs config and baseline files.");
  });

  test("a --config file over 64 KB is refused too", async () => {
    const dir = project("big-named", { "ci/lint.json": `{"$schema": "${"x".repeat(70 * 1024)}"}` });
    const sb = await Sandbox.create([dir]);
    await expect(loadConfig(sb, { configPath: "ci/lint.json" })).rejects.toThrow("File too large: ci/lint.json is 71,695 bytes; the limit is 65,536 bytes for AsItIs config files.");
  });

  test("a config outside the root is refused, as given or through a symlink", async () => {
    const outside = project("outside-target", { "x.json": "{}" });
    const dir = project("outside", { "CLAUDE.md": "# A\n" });
    const sb = await Sandbox.create([dir]);
    await expect(loadConfig(sb, { configPath: path.join(outside, "x.json") })).rejects.toThrow(/outside the project folder/);
    await expect(loadConfig(sb, { configPath: "../outside-target/x.json" })).rejects.toThrow(/outside the project folder/);
    try {
      symlinkSync(path.join(outside, "x.json"), path.join(dir, ".asitisrc.json"));
    } catch {
      return; // no symlink permission (Windows without developer mode)
    }
    await expect(loadConfig(sb, {})).rejects.toThrow(/outside the project folder/);
  });

  test("a config under a second root (the memory folder) is refused", async () => {
    const mem = project("second-root", { "lint.json": "{}" });
    const dir = project("first-root", { "CLAUDE.md": "# A\n" });
    const sb = await Sandbox.create([dir, mem]);
    await expect(loadConfig(sb, { configPath: path.join(mem, "lint.json") })).rejects.toThrow(/outside the project folder/);
  });

  test("a missing --config file is an error, a missing default file is not", async () => {
    const dir = project("missing", { "CLAUDE.md": "# A\n" });
    const sb = await Sandbox.create([dir]);
    expect(await loadConfig(sb, {})).toBeNull();
    await expect(loadConfig(sb, { configPath: "nope.json" })).rejects.toThrow(/File not found: nope\.json/);
  });

  test("only JSON, and never agent settings or files that look like credentials", async () => {
    const dir = project("kinds", { "lint.yaml": "x: 1\n", ".claude/settings.json": "{}", ".mcp.json": "{}", "secrets.json": "{}", ".env.json": "{}", "ok.json": "{}" });
    const sb = await Sandbox.create([dir]);
    await expect(sb.openAs("asitisrc", "lint.yaml")).rejects.toThrow(/not a \.json file/);
    await expect(sb.openAs("asitisrc", ".claude/settings.json")).rejects.toThrow(/not an AsItIs config/);
    await expect(sb.openAs("asitisrc", ".mcp.json")).rejects.toThrow(/not an AsItIs config/);
    await expect(sb.openAs("asitisrc", "secrets.json")).rejects.toThrow(/not an AsItIs config/);
    await expect(sb.openAs("asitisrc", ".env.json")).rejects.toThrow(/\.env/);
    expect((await sb.openAs("asitisrc", "ok.json")).buf.toString()).toBe("{}");
  });

  test("a config naming a deeply nested or huge value finishes at once", () => {
    const t0 = performance.now();
    expect(() => parseJsonLines("[".repeat(64 * 1024), "c.json")).toThrow(/nesting is deeper than 32 levels/);
    expect(() => parseJsonLines(`{"a": "${"\\u0041".repeat(10_000)}`, "c.json")).toThrow(/not closed/);
    expect(() => parseJsonLines(`{${'"k": 1,'.repeat(8000)}}`, "c.json")).toThrow(/appears twice/);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
