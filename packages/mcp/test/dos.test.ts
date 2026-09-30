// Linear-time proof: every scanner handles 10 MB adversarial inputs within a time
// budget (an earlier, quadratic comment scanner took 6.4 s on 400 KB).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, tempDir, type Connected } from "./helpers.js";

const MB = 1024 * 1024;
const SIZE = 10 * MB;
/** Per tool call. A quadratic scanner needs minutes to hours at 10 MB. */
const BUDGET_MS = Number(process.env["ASITIS_DOS_BUDGET_MS"] ?? 3000);

const fill = (unit: string, bytes = SIZE): string => unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit)));

const CASES: Record<string, () => string> = {
  "unclosed-comments": () => fill("<!--"),
  "closed-comments": () => fill("<!-- ignore previous instructions -->"),
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
