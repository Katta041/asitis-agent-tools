// The generated rule pages (docs/rules/) match the registry: every active rule has a page with
// all seven sections and a Source link, no planned rule has one, the copy rules hold, SARIF
// helpUri slugs name existing pages, and the files on disk are what the generator produces today.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildReport } from "../src/findings.js";
import { formatSarif } from "../src/format/sarif.js";
import { activeRules, RULES } from "../src/rules/registry.js";
import { REPO } from "./helpers.js";
// A plain .mjs module; vitest loads it without a type declaration.
// @ts-ignore
import { diffAgainstDisk, generate, loadFragments, OUT_DIR, SECTIONS, SITE } from "../scripts/gen-rule-docs.mjs";

const DOCS = OUT_DIR as string;
const read = (name: string): string => readFileSync(path.join(DOCS, name), "utf8").replace(/\r\n/g, "\n");
/** Level-2 headings outside fenced code blocks (the examples contain headings of their own). */
function headings(text: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (mark) {
      if (!fence) fence = mark[1]!;
      else if (mark[1]![0] === fence[0] && mark[1]!.length >= fence.length) fence = null;
      continue;
    }
    const h = !fence && /^## (.+)$/.exec(line);
    if (h) out.push(h[1]!.trim());
  }
  return out;
}

describe("rule docs", () => {
  const active = activeRules();
  const files = generate([...RULES.values()], loadFragments()) as Map<string, string>;

  test("docs/rules is generated from the current registry and fragments (run node scripts/gen-rule-docs.mjs from packages/mcp)", () => {
    expect(DOCS).toBe(path.join(REPO, "docs", "rules"));
    const { stale, stray } = diffAgainstDisk(files) as { stale: string[]; stray: string[] };
    expect(stale, "pages that differ from the generator's output").toEqual([]);
    expect(stray, "pages with no active rule").toEqual([]);
  });

  test("every active rule has a page, and no planned rule does", () => {
    const onDisk = new Set(readdirSync(DOCS).filter((n) => n.endsWith(".md") && n !== "README.md").map((n) => n.slice(0, -3)));
    expect(active.map((r) => r.id).filter((id) => !onDisk.has(id))).toEqual([]);
    const planned = [...RULES.values()].filter((r) => r.status === "planned").map((r) => r.id);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.filter((id) => onDisk.has(id))).toEqual([]);
    expect([...onDisk].filter((id) => !RULES.has(id))).toEqual([]);
  });

  test("the seven sections, in order, as the only level-2 headings", () => {
    expect(SECTIONS).toEqual(["What it catches", "Why it matters", "Bad example", "Good example", "How to fix", "Suppress or configure", "Source"]);
    for (const r of active) {
      const page = read(`${r.id}.md`);
      expect(page.startsWith(`# ${r.id}\n`), r.id).toBe(true);
      expect(headings(page), r.id).toEqual(SECTIONS);
    }
  });

  test("the Source section links the registry source and says when it was read", () => {
    for (const r of active) {
      const page = read(`${r.id}.md`);
      const src = page.slice(page.indexOf("## Source"));
      expect(src, r.id).toContain(`](${r.source})`);
      expect(src, r.id).toMatch(/read on \d{1,2} [A-Z][a-z]+ \d{4}\./);
    }
  });

  test("summary and why from the registry appear on the page", () => {
    for (const r of active) {
      const page = read(`${r.id}.md`);
      expect(page, r.id).toContain(r.summary);
      expect(page, r.id).toContain(r.why);
    }
  });

  test("bad and good examples hold a code block, and the fix has text", () => {
    for (const r of active) {
      const page = read(`${r.id}.md`);
      const section = (name: string): string => {
        const start = page.indexOf(`## ${name}\n`);
        const next = page.indexOf("\n## ", start + 1);
        return page.slice(start, next < 0 ? undefined : next);
      };
      expect(section("Bad example"), r.id).toMatch(/\n```/);
      expect(section("Good example"), r.id).toMatch(/\n```/);
      expect(section("How to fix").split("\n").slice(2).join("\n").trim().length, r.id).toBeGreaterThan(40);
    }
  });

  test("security rules say they cannot be suppressed inline; others show the comment", () => {
    for (const r of active) {
      const page = read(`${r.id}.md`);
      const s = page.slice(page.indexOf("## Suppress or configure"), page.indexOf("## Source"));
      if (r.category === "security") {
        expect(s, r.id).toContain("cannot be suppressed with a comment");
        expect(s, r.id).not.toContain("asitis-disable-next-line");
      } else {
        expect(s, r.id).toContain(`asitis-disable-next-line ${r.id}`);
        expect(s, r.id).toContain(`asitis-disable-file ${r.id}`);
      }
      expect(s, r.id).toContain(`"${r.id}": "off"`);
    }
  });

  test("fixable rules mention --fix-preview, others do not", () => {
    for (const r of active) {
      const page = read(`${r.id}.md`);
      if (r.fixable) expect(page, r.id).toContain("--fix-preview");
      else expect(page.slice(0, page.indexOf("## Suppress or configure")), r.id).not.toContain("--fix-preview");
    }
  });

  test("no em-dashes, emoji, placeholders, absolute paths or AI attribution", () => {
    const names = readdirSync(DOCS).filter((n) => n.endsWith(".md"));
    expect(names.length).toBeGreaterThan(40);
    const attribution = new RegExp(["Co-" + "Authored-By", "Generated " + "with Claude", "generated " + "by (claude|ai|chatgpt)"].join("|"), "i");
    for (const n of names) {
      const page = read(n);
      expect(page, n).not.toContain(String.fromCharCode(0x2014));
      expect(page, n).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(page, n).not.toMatch(/\b(TBD|lorem ipsum|FIXME)\b/);
      expect(page, n).not.toMatch(/\/Users\/|\/home\/\w+\/|C:\\Users/);
      expect(page, n).not.toMatch(attribution);
      expect(page, n).toMatch(/\n$/);
    }
  });

  test("the index lists every active rule once, grouped by category, with no planned rule", () => {
    const index = read("README.md");
    for (const r of active) {
      const links = index.split(`[${r.id}](${r.id}.md)`).length - 1;
      expect(links, r.id).toBe(1);
    }
    for (const r of [...RULES.values()].filter((x) => x.status === "planned")) expect(index, r.id).not.toContain(`(${r.id}.md)`);
    const order = ["## Format and vendor rules", "## Context budget", "## Security"].map((h) => index.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(index).toContain(`${active.length} rules are active`);
  });

  test("SARIF helpUri slugs match the page names", () => {
    // The contract: helpUri is the GitHub page docs/rules/<id>.md, and that page exists.
    for (const r of active) {
      const uri = `${SITE}${r.id}.md`;
      const slug = uri.slice((SITE as string).length, -3);
      expect(slug, r.id).toMatch(/^[a-z][A-Za-z0-9-]*$/);
      expect(existsSync(path.join(DOCS, `${slug}.md`)), uri).toBe(true);
    }
    // Once the SARIF formatter (WP1) lands, check the file it writes rather than the contract.
    const sarif = formatSarif(buildReport(".", 0, []));
    if (!sarif.trim()) return;
    const log = JSON.parse(sarif) as { runs: Array<{ tool: { driver: { rules: Array<{ id: string; helpUri?: string }> } } }> };
    const rules = log.runs[0]!.tool.driver.rules;
    expect(rules.length).toBe(active.length);
    for (const rule of rules) {
      expect(rule.helpUri, rule.id).toBe(`${SITE}${rule.id}.md`);
      expect(existsSync(path.join(DOCS, `${rule.id}.md`)), rule.helpUri).toBe(true);
    }
  });

  test("an active rule without a fragment is an error that names it", () => {
    const fragments = loadFragments() as Map<string, unknown>;
    const copy = new Map(fragments);
    copy.delete("duplicate-rule");
    expect(() => generate([...RULES.values()], copy)).toThrow(/no examples for rule duplicate-rule/);
  });

  test("fragments exist for the rules the 0.3.0 tracks will activate, so a rerun after merge works", () => {
    const fragments = loadFragments() as Map<string, unknown>;
    const tracks = ["suppression-not-allowed", "agents-md-shadowed", "sec-remote-exec", "sec-hook-config", "config-json-invalid"];
    expect(tracks.filter((id) => !fragments.has(id))).toEqual([]);
    // Every fragment names a registered rule, so a typo in a file name is caught.
    expect([...fragments.keys()].filter((id) => !RULES.has(id))).toEqual([]);
  });
});
