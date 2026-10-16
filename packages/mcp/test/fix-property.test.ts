// Property test for WP7: insert invisible characters at random places in clean steering files
// (LF, CRLF, BOM, no final newline), ask for the safe invisible-char fixes, apply them, and the
// file must come back byte for byte. A seeded generator keeps failures reproducible.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { applyEdits } from "../src/diff.js";
import { Deadline } from "../src/discover.js";
import { suggestFixes } from "../src/fix.js";
import type { FixEdit } from "../src/findings.js";
import { Sandbox } from "../src/paths.js";
import { tempDir } from "./helpers.js";

const t = tempDir("asitis-fixprop-");
afterAll(() => t.cleanup());

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const BASES: Record<string, string> = {
  "CLAUDE.md": "# Project\n\n- Run `npm test` before every push.\n- Keep pull requests small.\n\n## Style\n\nUse named exports. Prefer early returns.\n\n```sh\nnpm run build\n```\n",
  ".claude/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: Deploy the app to staging and check health.\n---\n\n# Deploy\n\n1. Run the deploy script.\n2. Watch the health checks.\n",
  ".cursor/rules/style.mdc": "---\ndescription: TypeScript style\nglobs: src/**/*.ts\nalwaysApply: false\n---\n\nUse two spaces.\n",
};

// Characters scanInvisible reports that are never kept between ASCII text.
const INSERTS = ["​", "⁠", "﻿", "‍", "‌", "­", "\u{E0041}", "\u{E0100}", "⁢"];

const shapes: Record<string, (s: string) => string> = {
  lf: (s) => s,
  crlf: (s) => s.replace(/\n/g, "\r\n"),
  bom: (s) => `﻿${s}`,
  "no-final-newline": (s) => s.replace(/\n$/, ""),
};

describe("random invisible characters are removed exactly", () => {
  test.each(Object.keys(shapes))("%s: 40 seeded runs restore every file byte for byte", async (shape) => {
    const random = rng(shape.length * 7919);
    for (let run = 0; run < 40; run++) {
      const dir = path.join(t.dir, `${shape}-${run}`);
      const originals = new Map<string, Buffer>();
      for (const [rel, base] of Object.entries(BASES)) {
        const clean = shapes[shape]!(base);
        originals.set(rel, Buffer.from(clean, "utf8"));
        // Insert 1 to 12 characters at code point boundaries, never inside CR LF and never a
        // U+FEFF at offset 0 (that is a BOM, not hidden text).
        let s = clean;
        const n = 1 + Math.floor(random() * 12);
        for (let k = 0; k < n; k++) {
          let at = Math.floor(random() * (s.length + 1));
          if (s[at - 1] === "\r" && s[at] === "\n") at++;
          if (at > 0 && /[\uDC00-\uDFFF]/.test(s[at] ?? "")) at++;
          const ch = INSERTS[Math.floor(random() * INSERTS.length)]!;
          if (at === 0 && ch === "﻿") continue;
          if (shape === "bom" && at === 0) at = 1;
          s = s.slice(0, at) + ch + s.slice(at);
        }
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), s);
      }
      const sandbox = await Sandbox.create([dir]);
      const out = await suggestFixes(sandbox, { rules: ["invisible-char"], safety: "safe" }, new Deadline(30_000));
      const fixes = out.structured["fixes"] as Array<{ path: string; edits: FixEdit[] }>;
      const byFile = new Map<string, FixEdit[]>();
      for (const f of fixes) byFile.set(f.path, [...(byFile.get(f.path) ?? []), ...f.edits]);
      for (const [rel, orig] of originals) {
        const now = readFileSync(path.join(dir, rel));
        const fixed = applyEdits(now, byFile.get(rel) ?? []);
        expect(fixed.toString("utf8"), `${shape} run ${run} ${rel}: ${JSON.stringify(now.toString("utf8"))}`).toBe(orig.toString("utf8"));
        expect(fixed.equals(orig)).toBe(true);
      }
      // Every fifth run also goes through git apply.
      if (run % 5 === 0 && out.structured["diff"]) {
        const patch = path.join(t.dir, `${shape}-${run}.patch`);
        writeFileSync(patch, out.structured["diff"] as string);
        execFileSync("git", ["-c", "core.autocrlf=false", "apply", "--whitespace=nowarn", patch], { cwd: dir, stdio: "pipe" });
        for (const [rel, orig] of originals) expect(readFileSync(path.join(dir, rel)).equals(orig), `${shape} run ${run} ${rel} via git apply`).toBe(true);
      }
    }
  }, 120_000);
});
