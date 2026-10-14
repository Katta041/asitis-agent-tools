// Regression tests for 0.2.3: the root folder given in another spelling than the one
// the OS resolves files to. On Windows that is an 8.3 short path (C:\Users\RUNNER~1\...,
// which os.tmpdir() returns on GitHub's runners) or a different case; files resolve to
// the long, on-disk form. Confinement must hold in every form, in process and under
// Node's permission model, which compares paths as plain case-sensitive strings.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BUNDLE, connect, tempDir, toResult, type CallResult } from "./helpers.js";

const WIN = process.platform === "win32";
const SECRET = "SECRET_VALUE_c41d";

function put(p: string, content: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** 8.3 short path of a folder through cmd's %~s, or null when short names are off on the volume. */
function shortPath(dir: string): string | null {
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", "for %I in (.) do @echo %~sI"], { cwd: dir, encoding: "utf8", windowsVerbatimArguments: true, timeout: 30_000 });
  const out = r.stdout?.trim();
  return r.status === 0 && out && out.toLowerCase() !== dir.toLowerCase() && existsSync(out) ? out : null;
}

/** Same path with every letter's case flipped, so it differs from both the given and the on-disk form. */
const flipCase = (p: string): string => p.replace(/[a-z]/gi, (ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()));

// Built at load time so each form is known when the suites are declared.
const t = tempDir("asitis-root-forms-");
const root = path.join(realpathSync.native(t.dir), "project-with-a-long-name"); // long, on-disk form
const outside = path.join(realpathSync.native(t.dir), "outside-with-a-long-name");
put(path.join(root, "CLAUDE.md"), "# Rules\n\n@docs/guide.md\n@.env\n");
put(path.join(root, "docs/guide.md"), "# Guide\n\nUse tabs.\n");
put(path.join(root, ".env"), `TOKEN=${SECRET}\n`);
put(path.join(root, ".claude/settings.json"), `{"x":"${SECRET}"}\n`);
put(path.join(root, ".claude/skills/demo/SKILL.md"), "---\nname: demo\ndescription: A demo skill.\n---\n# Demo\n");
put(path.join(outside, "secret.md"), `# outside\n${SECRET}\n`);
// Junctions need no privilege on Windows; elsewhere use directory symlinks.
symlinkSync(outside, path.join(root, "out-link"), WIN ? "junction" : "dir");
symlinkSync(path.join(root, "docs"), path.join(root, "docs-link"), WIN ? "junction" : "dir");
symlinkSync(path.join(root, ".claude"), path.join(root, "claude-link"), WIN ? "junction" : "dir");
afterAll(() => t.cleanup());

const flipped = flipCase(root);
// A form is tested only where it names the same folder: 8.3 names exist on Windows
// volumes that have them, and a case-varied path resolves on case-insensitive filesystems.
const FORMS = [
  { name: "8.3 short path", rootForm: WIN ? shortPath(root) : null },
  { name: "case-varied path", rootForm: existsSync(flipped) ? flipped : null },
].filter((f): f is { name: string; rootForm: string } => f.rootForm !== null);

test("the root forms differ from the on-disk path", () => {
  for (const f of FORMS) expect(f.rootForm, f.name).not.toBe(root);
  if (WIN) expect(FORMS.map((f) => f.name)).toContain("case-varied path");
});

/** The checks every root form must pass, through any call function. */
function confinementSuite(call: () => (name: string, args?: Record<string, unknown>) => Promise<CallResult>, rootForm: string): void {
  const refused = async (p: string, re: RegExp): Promise<void> => {
    const r = await call()("read_markdown", { path: p });
    expect(r.isError, `${p} should be refused: ${r.text}`).toBe(true);
    expect(r.blocks[0]).toMatch(re);
    expect(r.text).not.toContain(SECRET);
  };
  test("relative, root-form absolute and long-form absolute paths inside the root work", async () => {
    for (const p of ["CLAUDE.md", path.join(rootForm, "CLAUDE.md"), path.join(root, "CLAUDE.md")]) {
      const r = await call()("read_markdown", { path: p });
      expect(r.isError, `${p}: ${r.text}`).toBe(false);
      expect(r.blocks[1]).toBe("# Rules\n\n@docs/guide.md\n@.env\n");
    }
  });
  test("a link that stays inside the root is allowed", async () => {
    const r = await call()("read_markdown", { path: "docs-link/guide.md" });
    expect(r.isError, r.text).toBe(false);
    expect(r.blocks[1]).toBe("# Guide\n\nUse tabs.\n");
  });
  test("a link that resolves outside the root is refused", async () => refused("out-link/secret.md", /symlink that resolves outside/));
  test("an absolute path outside the root is refused", async () => refused(path.join(outside, "secret.md"), /outside the allowed folder/));
  test(".env is refused", async () => refused(".env", /environment file/));
  test(".claude/settings.json is refused, directly and through a link", async () => {
    await refused(".claude/settings.json", /settings file/);
    await refused("claude-link/settings.json", /settings file|not a markdown file/);
  });
  test("discovery and the budget see the project files", async () => {
    const found = await call()("find_steering_files");
    expect(found.isError, found.text).toBe(false);
    expect(found.text).toMatch(/CLAUDE\.md/);
    expect(found.text).toMatch(/\.claude\/skills\/demo\/SKILL\.md/);
    expect(found.text).not.toContain("out-link");
    const b = await call()("context_budget", { path: "CLAUDE.md" });
    expect(b.isError, b.text).toBe(false);
    expect(b.text).toMatch(/docs\/guide\.md/);
    expect(b.text).not.toContain(SECRET);
  });
}

describe.each(FORMS)("root given as an $name", ({ rootForm }) => {
  describe("in process", () => {
    let c: Awaited<ReturnType<typeof connect>>;
    beforeAll(async () => {
      c = await connect([rootForm], { footer: false });
    });
    afterAll(async () => c.close());
    confinementSuite(() => c.call, rootForm);
  });

  describe("under Node's permission model, granted only that form", () => {
    let client: Client;
    beforeAll(async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--permission", `--allow-fs-read=${rootForm}`, `--allow-fs-read=${path.dirname(BUNDLE)}`, BUNDLE, "--root", rootForm, "--no-footer"],
        stderr: "pipe",
      });
      client = new Client({ name: "asitis-root-forms", version: "0.0.0" });
      await client.connect(transport);
    });
    afterAll(async () => client.close());
    confinementSuite(() => (name, args = {}) => toResult(client, name, args), rootForm);
  });
});
