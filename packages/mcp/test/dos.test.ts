// Linear-time proof: every scanner handles 10 MB adversarial inputs within a time
// budget (an earlier, quadratic comment scanner took 6.4 s on 400 KB).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { connect, PKG, tempDir, type Connected } from "./helpers.js";

const CLI_BUNDLE = path.join(PKG, "dist/asitis.mjs");

const MB = 1024 * 1024;
const SIZE = 10 * MB;
/** Per tool call. A quadratic scanner needs minutes to hours at 10 MB. */
const BUDGET_MS = Number(process.env["ASITIS_DOS_BUDGET_MS"] ?? 3000);

const fill = (unit: string, bytes = SIZE): string => unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit)));

const CASES: Record<string, () => string> = {
  "unclosed-comments": () => fill("<!--"),
  "closed-comments": () => fill("<!-- ignore previous instructions -->"),
  "comment-lines": () => fill("<!-- x -->\n"),
  "suppression-comments": () => fill("<!-- asitis-disable-next-line duplicate-rule, nope -- x -->\n"),
  "comment-then-unclosed": () => "<!-- a -->\n" + fill("<!--"),
  "open-brackets": () => fill("["),
  "link-openers": () => fill("]("),
  "angle-link-openers": () => fill("](<"),
  "reference-defs": () => fill("[a\n"),
  "imports": () => fill(" @a"),
  "at-signs": () => fill("@"),
  "import-long-token": () => fill(" @" + "a/".repeat(2000)),
  "import-trailing-dots": () => fill(" @" + ".".repeat(2040)),
  "backticks": () => fill("`"),
  "backtick-fences": () => fill("```\n"),
  "spaces-then-x": () => " ".repeat(SIZE) + "x",
  "newlines": () => fill("\n"),
  "lone-cr": () => fill("\r"),
  "crlf": () => fill("\r\n"),
  "hashes": () => fill("#"),
  "heading-lines": () => fill("# h\n"),
  "setext": () => fill("a\n=\n"),
  "fence-storm": () => fill("---\n"),
  "frontmatter-then-junk": () => "---\n" + fill("key: value\n"),
  "zero-width": () => fill("​"),
  "bidi": () => fill("a‮"),
  "style-attrs": () => fill("style="),
  "style-open": () => fill('style="' + "a".repeat(190)),
  "emphasis": () => fill("*a"),
  "dotted-rules": () => fill("- " + ".".repeat(390) + "\n"),
  "rule-pairs": () => fill("- Always use tabs in Go files\n- Never use tabs in Go files\n"),
  "long-line-words": () => fill("ignore previous instructions you are the assistant "),
  "pipes": () => fill("|"),
  "invalid-utf8": () => fill("ÿ"), // re-encoded below as raw 0xff bytes
  // 0.3.0 precision changes: section paths and labels, copied-block lookups, quoted mentions,
  // directive comments, root-resolved links and placeholder links.
  "labels-and-items": () => fill("**Label a:**\n- Run the same step every time\n\n## H\n\n**Label b:**\n- Run the same step every time\n"),
  "bold-lead-ins": () => fill("**Round 1** - ask the same question. Parse the output.\n\n"),
  "quoted-mentions": () => fill('"a @b " @c '),
  "directive-comments": () => fill("<!-- agents:cwd=root a:b=c -->\n"),
  "root-links": () => fill("[x](docs/a.md) [y](url) "),
  "placeholder-lines": () => fill("- [a] -> [b]\n"),
  "deep-headings": () => fill("# a\n## b\n### c\n#### d\n##### e\n###### f\nText under the heading here.\n"),
  // 0.4.0 precision changes: placeholder and template links, GitHub page links, escaped brackets,
  // import placeholders, code-span case, shared sentences and checkbox steps.
  "placeholder-links": () => fill("[a]({baseDir}/r/x.md) [b](...) [c](../blob/main/x.md) [d](<t u>) [e](<%= u %>) \\[f\\](#g) "),
  "brace-openers": () => fill("]({"),
  "blob-paths": () => fill("](../" + "../".repeat(300) + "blob/"),
  "import-placeholders": () => fill(" @<D>/x.md @{d}/y.md @a/b's"),
  "code-case": () => fill("- Check `A.md` now\n- Check `a.md` now\n"),
  "shared-sentences": () => fill("One thing here today. A failed check changes the verdict.\n\n"),
  "checkbox-steps": () => fill("- [ ] Wait for it to finish\n1. Wait for it to finish\n"),
};

let t: ReturnType<typeof tempDir>;
let c: Connected;

beforeAll(async () => {
  t = tempDir("asitis-dos-");
  for (const [name, make] of Object.entries(CASES)) {
    const dir = path.join(t.dir, name);
    mkdirSync(dir, { recursive: true });
    const body = name === "invalid-utf8" ? Buffer.alloc(SIZE, 0xff) : Buffer.from(make(), "utf8").subarray(0, SIZE + 4096);
    writeFileSync(path.join(dir, "CLAUDE.md"), body);
  }
  c = await connect([t.dir]);
}, 120_000);

afterAll(async () => {
  await c.close();
  t.cleanup();
});

describe(`10 MB adversarial inputs, each tool call under ${BUDGET_MS} ms`, () => {
  test.each(Object.keys(CASES))("%s", async (name) => {
    const p = `${name}/CLAUDE.md`;
    for (const tool of ["lint_steering", "read_markdown", "outline", "context_budget"]) {
      const r = await c.call(tool, { path: p });
      expect(r.isError, `${tool}: ${r.text.slice(0, 200)}`).toBe(false);
      expect(r.ms, `${tool} on ${name} took ${r.ms.toFixed(0)} ms`).toBeLessThan(BUDGET_MS);
      // Results stay bounded no matter how hostile the file is.
      expect(r.text.length, `${tool} result size`).toBeLessThan(400 * 1024);
    }
  });

  test("whole-folder lint over all cases stays bounded", async () => {
    const r = await c.call("lint_steering", {});
    expect(r.isError).toBe(false);
    expect(r.text.length).toBeLessThan(2 * MB);
  }, 120_000);
});

describe("the CLI on a 10 MB single line", () => {
  // 0.3.0 took about 70 s here: each finding normalised and hashed the whole 10 MB line again for
  // its fingerprint. FingerprintCounter (findings.ts) does it once per line and rule.
  test.each(["imports", "at-signs", "quoted-mentions"])("%s", (name) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [CLI_BUNDLE, "lint", "--root", path.join(t.dir, name), "--format", "json", "--fail-on", "never"], { encoding: "utf8", timeout: 120_000, maxBuffer: 1 << 26 });
    const ms = Date.now() - t0;
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).summary.files).toBe(1);
    // Process start and JSON output included, so a few times the per-call budget.
    expect(ms, `${name} took ${ms} ms`).toBeLessThan(BUDGET_MS * 4);
  }, 120_000);
});

describe("scaling is linear, not quadratic", () => {
  test.each(["closed-comments", "unclosed-comments", "link-openers", "imports", "dotted-rules"])("%s: 8x input costs well under 64x time", async (name) => {
    const small = tempDir("asitis-scale-");
    try {
      const unit = CASES[name]!().slice(0, 4096);
      for (const [label, bytes] of [["s", MB / 4], ["l", 2 * MB]] as const) {
        mkdirSync(path.join(small.dir, label), { recursive: true });
        writeFileSync(path.join(small.dir, label, "CLAUDE.md"), fill(unit, bytes));
      }
      const s = await connect([small.dir]);
      await s.call("lint_steering", { path: "s/CLAUDE.md" }); // warm up
      const best = async (p: string): Promise<number> => {
        let m = Infinity;
        for (let i = 0; i < 3; i++) m = Math.min(m, (await s.call("lint_steering", { path: p })).ms);
        return m;
      };
      const ts = await best("s/CLAUDE.md");
      const tl = await best("l/CLAUDE.md");
      await s.close();
      // Linear: about 8x. Quadratic: about 64x. Allow generous noise on small timings.
      expect(tl, `small ${ts.toFixed(1)} ms, large ${tl.toFixed(1)} ms`).toBeLessThan(Math.max(ts, 5) * 24);
    } finally {
      small.cleanup();
    }
  });
});
