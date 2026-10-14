// The rule registry is complete and consistent: every rule id the code emits is registered and
// active, every active rule is emitted somewhere, and security rules cannot be suppressed inline.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CATEGORIES } from "../src/findings.js";
import { activeRules, RULE_GROUPS, RULES } from "../src/rules/registry.js";
import { connect, FIXTURES, PKG, type Connected } from "./helpers.js";

const SRC = path.join(PKG, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

/** The text of a call's arguments, starting just after "(", split at top-level commas. */
function callArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      // Skip a string literal (template literals may nest ${...}; good enough for rule-id positions).
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      cur += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) {
        args.push(cur);
        return args;
      }
      depth--;
    }
    if (ch === "," && depth === 0) {
      args.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  return args;
}

/** The expression after "rule:" or "ruleId:", up to the next top-level , ; or closing bracket. */
function propertyValue(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return src.slice(start, i);
      depth--;
    } else if ((ch === "," || ch === ";" || ch === "\n") && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

const literals = (expr: string): string[] => [...expr.matchAll(/"([A-Za-z][A-Za-z0-9-]*)"/g)].map((m) => m[1]!);

/** Rule ids emitted in src/, found where they are passed: Collector.add(severity, rule, ...) and rule:/ruleId: properties. */
function emittedIds(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel.startsWith("rules/")) continue; // the registry itself
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.add\(/g)) {
      const args = callArgs(src, m.index + m[0].length);
      if (args.length < 3) continue; // Set.add(x) and similar
      for (const id of literals(args[1]!)) found.set(id, rel);
    }
    // A property, not the word in prose: "rule:" right after "{" or "," or at the start of a line.
    for (const m of src.matchAll(/(?:[{,]\s*|^\s*)(?:rule|ruleId)\s*:\s*/gm)) {
      for (const id of literals(propertyValue(src, m.index + m[0].length))) found.set(id, rel);
    }
  }
  return found;
}

describe("rule registry", () => {
  const all = RULE_GROUPS.flatMap((g) => g.rules);

  test("ids are unique across every meta file", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const g of RULE_GROUPS) {
      for (const r of g.rules) {
        if (seen.has(r.id)) dupes.push(`${r.id} in ${seen.get(r.id)} and ${g.name}`);
        seen.set(r.id, g.name);
      }
    }
    expect(dupes).toEqual([]);
    expect(RULES.size).toBe(all.length);
  });

  test("every entry is well formed", () => {
    for (const r of all) {
      expect(r.id, r.id).toMatch(/^[a-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/);
      expect(CATEGORIES, r.id).toContain(r.category);
      expect(["error", "warning", "note"], r.id).toContain(r.defaultSeverity);
      expect(r.summary.length, r.id).toBeGreaterThan(5);
      expect(r.summary.length, r.id).toBeLessThan(100);
      expect(r.summary, r.id).not.toMatch(/\.$/);
      expect(r.why.length, r.id).toBeGreaterThan(10);
      expect(r.source, r.id).toMatch(/^https:\/\/\S+$/);
      expect([false, "safe", "review"], r.id).toContain(r.fixable);
    }
  });

  test("security rules are never suppressible inline, and every other rule is", () => {
    for (const r of all) expect(r.suppressibleInline, r.id).toBe(r.category !== "security");
  });

  test("sec-*, hidden-*, invisible-char and bidi-control are security rules", () => {
    for (const r of all) {
      if (/^(sec-|hidden-)/.test(r.id) || r.id === "invisible-char" || r.id === "bidi-control") expect(r.category, r.id).toBe("security");
    }
  });

  test("ids reserved for the 0.3.0 tracks and the research backlog are registered", () => {
    const expected = [
      // F7 drift
      "agents-md-shadowed", "claude-local-hides-agents-md", "agents-md-unread-variant", "cross-file-contradiction", "instruction-drift", "generated-file-edited",
      // F8 skills
      "sec-remote-exec", "sec-encoded-blob", "sec-secret-egress", "sec-skill-network", "sec-skill-allowed-tools", "sec-skill-binary", "sec-safety-off",
      // F9 agent config
      "sec-hook-config", "sec-permission-allow", "sec-permission-mode", "sec-no-secret-deny", "sec-mcp-launcher", "sec-mcp-inline-secret", "config-json-invalid",
      // F5 suppression
      "suppression-not-allowed", "unknown-suppression", "unused-suppression",
      // threat catalogue and F13
      "sec-covert-instruction", "sec-image-exfil", "sec-invisible-ext", "sec-smuggled-text", "sec-mixed-script", "sec-nested-override", "sec-hidden-markup-ext", "sec-skill-typosquat", "sec-agent-workflow", "sec-config-drift", "secret-in-steering",
      // spec gaps, a sample from each vendor
      "skill-nonstandard-key", "agent-enum", "hook-event-unknown", "codex-chain-over-budget", "cursor-rule-md-ignored", "copilot-exclude-agent", "custom-agent-target", "windsurf-trigger", "cline-paths-empty",
    ];
    expect(expected.filter((id) => !RULES.has(id))).toEqual([]);
  });

  test("every rule id emitted in src/ is registered and active, and every active rule is emitted", () => {
    const emitted = emittedIds();
    // Sanity: the scan finds rules from lint.ts, frontmatter.ts and project.ts.
    for (const id of ["length", "frontmatter-bom", "duplicate-across-files", "bidi-control", "broken-import", "missing-applyTo"]) expect(emitted.has(id), id).toBe(true);
    const unregistered = [...emitted].filter(([id]) => !RULES.has(id)).map(([id, f]) => `${id} (${f})`);
    expect(unregistered).toEqual([]);
    const notActive = [...emitted].filter(([id]) => RULES.get(id)?.status === "planned").map(([id, f]) => `${id} (${f}) is emitted but still planned`);
    expect(notActive).toEqual([]);
    const silent = activeRules().filter((r) => !emitted.has(r.id)).map((r) => r.id);
    expect(silent).toEqual([]);
  });

  describe("at run time", () => {
    let c: Connected;
    beforeAll(async () => {
      c = await connect([FIXTURES]);
    });
    afterAll(async () => c.close());
    test("every rule the fixtures trigger is registered and active", async () => {
      const r = await c.call("lint_steering", {});
      const ids = new Set((r.structured["files"] as Array<{ issues: Array<{ rule: string }> }>).flatMap((f) => f.issues.map((i) => i.rule)));
      expect(ids.size).toBeGreaterThan(10);
      expect([...ids].filter((id) => RULES.get(id)?.status !== "active")).toEqual([]);
    });
  });
});
