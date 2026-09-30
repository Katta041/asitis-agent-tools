// Regression tests for path traversal, symlink escape, file-type scope, secret-file
// access and oversized input, plus the "no writes at all" guarantee.
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Sandbox } from "../src/paths.js";
import { connect, tempDir, type Connected } from "./helpers.js";

const SECRET = "SECRET_VALUE_7f3a";
let t: ReturnType<typeof tempDir>;
let root: string;
let outside: string;
let c: Connected;

function put(p: string, content: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

beforeAll(async () => {
  t = tempDir();
  root = path.join(t.dir, "project");
  outside = path.join(t.dir, "outside");
  put(path.join(outside, "secret.md"), `# outside\n${SECRET}\n`);
  put(path.join(outside, "CLAUDE.md"), `# outside claude\n${SECRET}\n`);
  put(path.join(root, "README.md"), "# Project\n");
  put(path.join(root, "CLAUDE.md"), "# Instructions\n\n@.env\n@.claude/settings.json\n@../outside/secret.md\n");
  put(path.join(root, ".env"), `TOKEN=${SECRET}\n`);
  put(path.join(root, ".env.local"), `TOKEN=${SECRET}\n`);
  put(path.join(root, ".envrc"), `export TOKEN=${SECRET}\n`);
  put(path.join(root, ".claude/settings.json"), `{"hooks":{"SessionStart":[]},"x":"${SECRET}"}\n`);
  put(path.join(root, ".claude/settings.local.json"), `{"x":"${SECRET}"}\n`);
  put(path.join(root, ".mcp.json"), `{"x":"${SECRET}"}\n`);
  put(path.join(root, "package.json"), `{"x":"${SECRET}"}\n`);
  put(path.join(root, ".git/config"), `[core]\n${SECRET}\n`);
  put(path.join(root, ".git/notes.md"), `${SECRET}\n`);
  put(path.join(root, "node_modules/pkg/README.md"), `${SECRET}\n`);
  put(path.join(root, "big.md"), "x".repeat(4096));
  symlinkSync(path.join(outside, "secret.md"), path.join(root, "link-file.md"));
  symlinkSync(outside, path.join(root, "link-dir"));
  symlinkSync(path.join(root, ".env"), path.join(root, "innocent.md"));
  symlinkSync(path.join(root, ".claude/settings.json"), path.join(root, "settings-alias.md"));
  symlinkSync("/etc/hosts", path.join(root, "hosts.md"));
  symlinkSync(path.join(root, "README.md"), path.join(root, "readme-alias.md"));
  c = await connect([root], { maxFileBytes: 2048 });
});

afterAll(async () => {
  await c.close();
  t.cleanup();
});

const refused = async (p: string, pattern: RegExp): Promise<void> => {
  const r = await c.call("read_markdown", { path: p });
  expect(r.isError, `${p} should be refused`).toBe(true);
  expect(r.blocks[0]).toMatch(pattern);
  expect(r.text).not.toContain(SECRET);
};

describe("path traversal", () => {
  test.each([
    ["../outside/secret.md"],
    ["../../../../../../etc/hosts"],
    ["docs/../../outside/secret.md"],
  ])("%s is refused as outside the folder", async (p) => refused(p, /outside the allowed folder/));

  test("absolute path outside the root is refused", async () => refused(path.join(outside, "secret.md"), /outside the allowed folder/));
  test("absolute /etc/hosts is refused", async () => refused("/etc/hosts", /outside the allowed folder|not a markdown file/));
  test("URL-encoded traversal is just a missing file", async () => refused("..%2foutside%2fsecret.md", /File not found/));
  test("NUL in a path is rejected", async () => refused("README.md\0.md", /NUL/));
  test("an absolute path inside the root works", async () => {
    const r = await c.call("read_markdown", { path: path.join(root, "README.md") });
    expect(r.isError).toBe(false);
  });
});

describe("symlink escape", () => {
  test("symlinked file that resolves outside is refused", async () => refused("link-file.md", /symlink that resolves outside/));
  test("file inside a symlinked directory that resolves outside is refused", async () => refused("link-dir/secret.md", /symlink that resolves outside/));
  test("symlink to /etc/hosts is refused", async () => refused("hosts.md", /outside|not a markdown file/));
  test("markdown-named symlink to .env is refused by the real path", async () => refused("innocent.md", /environment file/));
  test("markdown-named symlink to .claude/settings.json is refused by the real path", async () => refused("settings-alias.md", /settings file/));
  test("a symlink that stays inside the root is allowed", async () => {
    const r = await c.call("read_markdown", { path: "readme-alias.md" });
    expect(r.isError).toBe(false);
    expect(r.blocks[1]).toBe("# Project\n");
  });
  test("discovery never follows symlinked folders", async () => {
    const r = await c.call("find_steering_files", {});
    expect(r.text).not.toContain("link-dir");
    expect(r.structured["skippedSymlinks"]).toBeGreaterThanOrEqual(2);
  });
});

describe("file-type scope: settings, secrets and non-markdown files", () => {
  test.each([
    [".env", /environment file/],
    [".env.local", /environment file/],
    [".envrc", /environment file/],
    [".ENV", /environment file/],
    [".claude/settings.json", /settings file/],
    [".claude/settings.local.json", /settings file/],
    [".mcp.json", /not a markdown file/],
    ["package.json", /not a markdown file/],
    [".git/config", /inside \.git/],
    [".git/notes.md", /inside \.git/],
    ["node_modules/pkg/README.md", /node_modules/],
  ])("%s is refused", async (p, re) => refused(p, re));

  test("refused files are refused by every tool, not only read_markdown", async () => {
    for (const tool of ["outline", "lint_steering", "context_budget"]) {
      const r = await c.call(tool, { path: ".claude/settings.json" });
      expect(r.isError, tool).toBe(true);
      expect(r.text).not.toContain(SECRET);
    }
    const multi = await c.call("lint_steering", { paths: [".env", "README.md"] });
    expect(multi.text).toMatch(/\.env: not linted/);
    expect(multi.text).not.toContain(SECRET);
  });

  test("imports of secrets and settings are estimated from size, never read", async () => {
    const r = await c.call("context_budget", { path: "CLAUDE.md" });
    expect(r.text).not.toContain(SECRET);
    expect(r.text).toMatch(/WARNING: a secrets or settings file is imported/);
    expect(r.text).toMatch(/outside the allowed folder, not counted/);
  });

  test("size cap refuses oversized files with an actionable message", async () => refused("big.md", /File too large: big\.md is 4096 bytes; the limit is 2048/));
});

describe("root confinement at startup", () => {
  test("the filesystem root is refused", async () => {
    await expect(Sandbox.create([path.parse(process.cwd()).root])).rejects.toThrow(/Refusing the filesystem root/);
  });
  test("the home folder is refused", async () => {
    await expect(Sandbox.create([os.homedir()])).rejects.toThrow(/Refusing your home folder/);
  });
  test("broad roots can be allowed explicitly", async () => {
    await expect(Sandbox.create([os.homedir()], { allowBroadRoot: true })).resolves.toBeInstanceOf(Sandbox);
  });
  test("a missing root is an actionable one-liner", async () => {
    await expect(Sandbox.create([path.join(t.dir, "nope")])).rejects.toThrow(/Root folder not found: .*Pass an existing folder with --root\./);
  });
  test("a file is not accepted as a root", async () => {
    await expect(Sandbox.create([path.join(root, "README.md")])).rejects.toThrow(/Root is not a folder/);
  });
});

describe("no writes at all", () => {
  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isSymbolicLink()) out.set(p, "link");
        else {
          const st = statSync(p);
          out.set(p, `${createHash("sha256").update(readFileSync(p)).digest("hex")} ${st.mtimeMs} ${st.mode}`);
        }
      }
      out.set(d, `dir ${readdirSync(d).length}`);
    };
    walk(dir);
    return out;
  }

  test("running every tool leaves the folder byte-identical, with no temp files", async () => {
    const before = snapshot(t.dir);
    for (const [name, args] of [
      ["find_steering_files", {}],
      ["lint_steering", {}],
      ["context_budget", {}],
      ["read_markdown", { path: "README.md" }],
      ["outline", { path: "CLAUDE.md" }],
      ["lint_steering", { path: "CLAUDE.md" }],
    ] as const) {
      await c.call(name, args as Record<string, unknown>);
    }
    expect(snapshot(t.dir)).toEqual(before);
  });

  test("hardlinks inside the root read the same file (documented residual: reads only, never writes)", async () => {
    linkSync(path.join(root, "README.md"), path.join(root, "hard.md"));
    const r = await c.call("read_markdown", { path: "hard.md" });
    expect(r.isError).toBe(false);
  });
});
