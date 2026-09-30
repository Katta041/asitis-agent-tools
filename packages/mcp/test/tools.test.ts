// Tool behaviour on the agentic fixtures (test-fixtures/agentic), through the MCP client.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AGENTIC, connect, FIXTURE_REPO, FIXTURES, FOOTER, type Connected } from "./helpers.js";

interface Issue { severity: string; rule: string; line: number; message: string }
interface FileLint { path: string; kind: string; load: string; issues: Issue[] }

let c: Connected;
beforeAll(async () => {
  c = await connect([FIXTURE_REPO]);
});
afterAll(async () => c.close());

const lintOne = async (p: string): Promise<FileLint> => {
  const r = await c.call("lint_steering", { path: p });
  expect(r.isError, r.text).toBe(false);
  return (r.structured["files"] as FileLint[])[0]!;
};
const rules = (f: FileLint): string[] => f.issues.map((i) => i.rule);

describe("tool list", () => {
  test("exactly five read-only tools, no write or patch tool", async () => {
    const { tools } = await c.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["context_budget", "find_steering_files", "lint_steering", "outline", "read_markdown"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
      expect(t.name).not.toMatch(/patch|write|edit|delete|exec|open_in_app/);
    }
  });
});

describe("read_markdown", () => {
  test("returns the exact text and a byte profile for a CRLF + BOM steering file", async () => {
    const r = await c.call("read_markdown", { path: ".cursor/rules/windows-crlf-bom.mdc" });
    const raw = readFileSync(path.join(FIXTURE_REPO, ".cursor/rules/windows-crlf-bom.mdc"));
    expect(r.blocks[1]).toBe(raw.toString("utf8"));
    const prof = r.structured["profile"] as Record<string, any>;
    expect(prof["bom"]).toBe(true);
    expect(prof["eol"]).toMatchObject({ crlf: 6, lf: 0, cr: 0, style: "crlf" });
    expect(prof["trailingWhitespaceLines"]).toBe(1);
    expect(prof["bytes"]).toBe(raw.length);
    expect(r.structured["untrusted"]).toBe(true);
    expect(r.blocks[0]).toMatch(/^UNTRUSTED FILE CONTENT/);
  });

  test("base64 mode returns byte-exact content", async () => {
    const r = await c.call("read_markdown", { path: ".cursor/rules/windows-crlf-bom.mdc", as: "base64" });
    const raw = readFileSync(path.join(FIXTURE_REPO, ".cursor/rules/windows-crlf-bom.mdc"));
    expect(Buffer.from(r.blocks[1]!, "base64").equals(raw)).toBe(true);
  });

  test("reports invalid UTF-8 byte ranges", async () => {
    const e = await connect([path.join(FIXTURES, "encodings")]);
    const r = await e.call("read_markdown", { path: "invalid-utf8.md" });
    const raw = readFileSync(path.join(FIXTURES, "encodings/invalid-utf8.md"));
    const inv = (r.structured["profile"] as any).invalidUtf8;
    expect(inv.count).toBeGreaterThan(0);
    for (const range of inv.ranges) {
      expect(range.end).toBeGreaterThan(range.start);
      expect(range.end).toBeLessThanOrEqual(raw.length);
    }
    expect(r.blocks[0]).toMatch(/invalid UTF-8 range/);
    const b64 = await e.call("read_markdown", { path: "invalid-utf8.md", as: "base64" });
    expect(Buffer.from(b64.blocks[1]!, "base64").equals(raw)).toBe(true);
    await e.close();
  });

  test("pages large files on UTF-8 character boundaries", async () => {
    const r1 = await c.call("read_markdown", { path: "CLAUDE.md", max_bytes: 100 });
    const slice = r1.structured["slice"] as Record<string, any>;
    expect(slice["complete"]).toBe(false);
    expect(slice["nextOffset"]).toBe(100);
    const r2 = await c.call("read_markdown", { path: "CLAUDE.md", offset_bytes: 100, max_bytes: 1_000_000 });
    expect(r1.blocks[1]! + r2.blocks[1]!).toBe(readFileSync(path.join(FIXTURE_REPO, "CLAUDE.md"), "utf8"));
  });

  test("flags invisible characters and a hidden instruction comment", async () => {
    const r = await c.call("read_markdown", { path: "notes/hidden.md" });
    const safety = r.structured["safety"] as Record<string, any>;
    expect(safety["invisibleCharacters"]).toBe(4);
    expect(safety["instructionLikeComments"]).toHaveLength(1);
    expect(r.blocks[0]).toMatch(/hidden HTML comment/);
  });
});

describe("outline", () => {
  test("headings with line numbers; fenced code is skipped", async () => {
    const r = await c.call("outline", { path: "CLAUDE.md" });
    expect(r.structured["headings"]).toEqual([
      { level: 1, text: "Northwind API: agent instructions", line: 1 },
      { level: 2, text: "Rules", line: 10 },
    ]);
  });
  test("frontmatter is reported and not read as a heading", async () => {
    const r = await c.call("outline", { path: ".claude/skills/pdf-export/SKILL.md" });
    expect(r.structured["frontmatter"]).toEqual({ startLine: 1, endLine: 5 });
    expect((r.structured["headings"] as any[])[0]).toMatchObject({ text: "PDF export", line: 6 });
  });
});

describe("lint_steering", () => {
  test("valid SKILL.md has no errors or warnings", async () => {
    const f = await lintOne(".claude/skills/pdf-export/SKILL.md");
    expect(f.kind).toBe("skill");
    expect(f.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  test("broken SKILL.md: name format, missing description, unknown key", async () => {
    const f = await lintOne(".claude/skills/Bad_Skill/SKILL.md");
    expect(rules(f)).toEqual(expect.arrayContaining(["name-format", "missing-description", "unknown-key"]));
    expect(f.issues.find((i) => i.rule === "unknown-key")!.line).toBe(4);
  });

  test("SKILL.md whose YAML does not parse", async () => {
    const f = await lintOne(".claude/skills/yaml-broken/SKILL.md");
    expect(f.issues[0]).toMatchObject({ severity: "error", rule: "frontmatter-yaml" });
  });

  test("line-1 rule: frontmatter after a blank line is ignored by tools", async () => {
    const f = await lintOne(".claude/skills/late-frontmatter/SKILL.md");
    expect(f.issues[0]).toMatchObject({ severity: "error", rule: "frontmatter-not-line-1", line: 2 });
  });

  test("CLAUDE.md: missing @import, broken link, duplicate and contradictory rules; code spans, fences and emails are not imports", async () => {
    const f = await lintOne("CLAUDE.md");
    const byRule = (r: string) => f.issues.filter((i) => i.rule === r);
    expect(byRule("broken-import").map((i) => [i.line, i.message.slice(0, 22)])).toEqual([[5, "@docs/missing-guide.md"]]);
    expect(byRule("broken-link").map((i) => i.line)).toEqual([7]);
    expect(byRule("duplicate-rule").map((i) => i.line)).toEqual([15]);
    expect(byRule("contradiction").map((i) => i.line)).toEqual([14]);
    expect(byRule("hidden-comment")).toHaveLength(1);
    expect(f.issues.some((i) => i.message.includes("not-an-import") || i.message.includes("in-a-fence") || i.message.includes("example.com"))).toBe(false);
  });

  test(".mdc: alwaysApply must be a boolean", async () => {
    const f = await lintOne(".cursor/rules/always.mdc");
    expect(f.issues[0]).toMatchObject({ severity: "error", rule: "field-type", line: 2 });
  });

  test(".mdc with frontmatter is classified by rule type", async () => {
    const f = await lintOne(".cursor/rules/typescript.mdc");
    expect(f.load).toBe("on-match");
    expect(f.issues).toEqual([]);
  });

  test("CRLF + BOM steering file: frontmatter still parsed, BOM warned", async () => {
    const f = await lintOne(".cursor/rules/windows-crlf-bom.mdc");
    expect(f.load).toBe("every-session");
    expect(rules(f)).toEqual(["frontmatter-bom"]);
    const s = await connect([path.join(AGENTIC, "crlf-bom-skill")]);
    const r = await s.call("lint_steering", { path: "SKILL.md" });
    const sf = (r.structured["files"] as FileLint[])[0]!;
    expect(rules(sf)).toContain("frontmatter-bom");
    expect(rules(sf)).not.toContain("missing-name");
    await s.close();
  });

  test("zero-width characters, bidi control, hidden instruction comment and hidden styled text", async () => {
    const f = await lintOne("notes/hidden.md");
    expect(rules(f)).toEqual(expect.arrayContaining(["invisible-char", "bidi-control", "hidden-instruction", "hidden-styled-text"]));
    expect(f.issues.find((i) => i.rule === "invisible-char")!.message).toMatch(/U\+200B ZERO WIDTH SPACE/);
    expect(f.issues.find((i) => i.rule === "hidden-instruction")!.line).toBe(5);
  });

  test("memory index: broken entry, and an orphan topic file when linting the folder", async () => {
    const f = await lintOne("memory/MEMORY.md");
    expect(f.issues.map((i) => [i.rule, i.line])).toEqual([["broken-link", 2]]);
    const all = await c.call("lint_steering", {});
    const orphan = (all.structured["files"] as FileLint[]).find((x) => x.path === "memory/user_role.md")!;
    expect(rules(orphan)).toContain("orphan-memory");
  });

  test("whole-project lint covers every steering file and counts issues", async () => {
    const r = await c.call("lint_steering", {});
    const summary = r.structured["summary"] as Record<string, number>;
    expect(summary["files"]).toBe(20);
    expect(summary["errors"]).toBe(5);
    expect(r.text).toMatch(/^Linted 20 file\(s\): 5 error\(s\)/);
  });
});

describe("context_budget", () => {
  test("CLAUDE.md with imports expanded up to the hop limit, missing import reported", async () => {
    const r = await c.call("context_budget", { path: "CLAUDE.md" });
    const imports = r.structured["imports"] as Array<{ path: string; note: string; depth: number }>;
    expect(imports.map((i) => i.path)).toEqual(["AGENTS.md", "docs/conventions.md", "docs/style.md", "@docs/missing-guide.md"]);
    expect(imports.find((i) => i.path === "docs/style.md")!.depth).toBe(2);
    expect(imports.at(-1)!.note).toMatch(/missing/);
    expect(r.structured["totalWithImports"] as number).toBeGreaterThan(r.structured["tokens"] as number);
  });

  test("project budget per tool: what loads every session", async () => {
    const r = await c.call("context_budget", {});
    const tools = r.structured["tools"] as Array<{ tool: string; entries: Array<{ path: string }> }>;
    expect(tools.map((t) => t.tool)).toEqual(["claude-code", "codex", "gemini-cli", "cursor", "copilot"]);
    const cc = tools[0]!.entries.map((e) => e.path);
    expect(cc).toEqual(expect.arrayContaining(["CLAUDE.md", "AGENTS.md", "docs/conventions.md", ".claude/rules/style.md", "memory/MEMORY.md"]));
    expect(cc).not.toContain(".claude/rules/testing.md"); // has paths: loads on match only
    expect(tools.find((t) => t.tool === "cursor")!.entries.map((e) => e.path)).toEqual([".cursor/rules/windows-crlf-bom.mdc"]);
  });

  test("block HTML comments in CLAUDE.md are not counted", async () => {
    const r = await c.call("context_budget", { path: "CLAUDE.md" });
    const plain = await c.call("read_markdown", { path: "CLAUDE.md" });
    const total = (plain.structured["profile"] as any).bytes as number;
    expect(r.structured["tokens"] as number).toBeLessThan(Math.ceil(total / 4));
  });
});

describe("find_steering_files", () => {
  test("groups by load behaviour and never lists refused files", async () => {
    const r = await c.call("find_steering_files", {});
    const groups = r.structured["groups"] as Record<string, Array<{ path: string }>>;
    const names = (g: string) => groups[g]!.map((e) => e.path).sort();
    expect(names("every-session")).toEqual([".claude/rules/style.md", ".cursor/rules/windows-crlf-bom.mdc", ".github/copilot-instructions.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
    expect(names("on-match")).toEqual([".claude/rules/testing.md", ".cursor/rules/typescript.mdc", ".github/instructions/api.instructions.md"]);
    expect(names("on-invocation")).toEqual(expect.arrayContaining([".claude/agents/reviewer.md", ".claude/commands/release.md", ".claude/skills/pdf-export/SKILL.md"]));
    expect(names("on-demand")).toEqual(["packages/web/AGENTS.md"]);
    expect(names("memory")).toEqual(["memory/MEMORY.md", "memory/feedback_testing.md", "memory/user_role.md"]);
    expect(r.text).not.toMatch(/\.env|settings\.json/);
  });
});

describe("footer", () => {
  test("every result ends with one asitis.app line, including errors", async () => {
    for (const [name, args] of [["outline", { path: "CLAUDE.md" }], ["read_markdown", { path: "nope.md" }], ["find_steering_files", {}]] as const) {
      const r = await c.call(name, args as Record<string, unknown>);
      expect(r.blocks.at(-1)).toBe(FOOTER);
      expect(r.blocks.filter((b) => b.includes("asitis.app"))).toHaveLength(1);
    }
  });
  test("can be turned off", async () => {
    const q = await connect([FIXTURE_REPO], { footer: false });
    const r = await q.call("outline", { path: "CLAUDE.md" });
    expect(r.text).not.toMatch(/asitis\.app/);
    await q.close();
  });
});
