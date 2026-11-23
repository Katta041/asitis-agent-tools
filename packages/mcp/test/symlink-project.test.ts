// A project folder reached through a symlink: CLAUDE_PROJECT_DIR (or the folder a CLI runs in)
// is a link to the real project. Before 0.4.8 the plugin's server would not start (Node's
// permission model matched the read grant against the link, not the folder it points to), and the
// CLI refused absolute paths built from $PWD as "outside the root folder".
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { logicalCwd } from "../src/paths.js";
import { PKG, PLUGIN, tempDir, toResult } from "./helpers.js";

const CLI = path.join(PKG, "dist/asitis.mjs");
const LAUNCHER = path.join(PLUGIN, "server/launch.mjs");
const MCP_JSON = JSON.parse(readFileSync(path.join(PLUGIN, ".mcp.json"), "utf8")).mcpServers.asitis as { args: string[] };

function put(p: string, content: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** A folder symlink (a junction on Windows, which needs no admin rights). False when the OS refuses. */
function link(target: string, at: string): boolean {
  try {
    symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}

let t: ReturnType<typeof tempDir>;
let real: string; // the project as it is on disk
let via: string; // a symlink to it
let outside: string; // a folder next to the project, never readable
let linked = false;

beforeAll(() => {
  t = tempDir("asitis-symproj-");
  real = path.join(realpathSync(t.dir), "real", "proj");
  outside = path.join(realpathSync(t.dir), "outside");
  put(path.join(real, "CLAUDE.md"), "# Project\n\nRun `npm test` before you push.\n");
  put(path.join(real, ".claude/skills/release/SKILL.md"), "---\nname: release\ndescription: Cuts a release when the user asks for one.\n---\n# Release\n");
  put(path.join(outside, "CLAUDE.md"), "# Not this project\n");
  mkdirSync(path.join(realpathSync(t.dir), "links"));
  via = path.join(realpathSync(t.dir), "links", "proj");
  linked = link(real, via) && link(outside, path.join(real, "elsewhere"));
});
afterAll(() => t.cleanup());

describe("logicalCwd: the current folder as the shell spells it", () => {
  test("$PWD wins only when it is the same folder as process.cwd()", () => {
    if (!linked) return;
    expect(logicalCwd(real, via)).toBe(via);
    expect(logicalCwd(real, real)).toBe(real);
    expect(logicalCwd(real, outside)).toBe(real); // stale $PWD
    expect(logicalCwd(real, "links/proj")).toBe(real); // not absolute
    expect(logicalCwd(real, undefined)).toBe(real);
    expect(logicalCwd(real, path.join(t.dir, "no-such-folder"))).toBe(real);
  });
});

describe("CLI in a project reached through a symlink", () => {
  function cli(args: string[], cwd: string, pwd: string): { code: number; out: string; err: string } {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, PWD: pwd, ASITIS_DEBUG: "" }, timeout: 60_000 });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  test("an absolute path built from $PWD is inside the root", () => {
    if (!linked) return;
    const r = cli(["lint", path.join(via, "CLAUDE.md")], via, via);
    expect(r.err).toBe("");
    expect(r.out).toBe("Linted 1 file: no issues found.\n");
    expect(r.code).toBe(0);
  });

  test("--root given as the real folder accepts a path through the link, and the other way round", () => {
    if (!linked) return;
    const a = cli(["lint", "--root", real, path.join(via, "CLAUDE.md")], t.dir, t.dir);
    expect([a.code, a.out, a.err]).toEqual([0, "Linted 1 file: no issues found.\n", ""]);
    const b = cli(["lint", "--root", via, path.join(real, "CLAUDE.md")], t.dir, t.dir);
    expect([b.code, b.out, b.err]).toEqual([0, "Linted 1 file: no issues found.\n", ""]);
    const walk = cli(["lint", "--root", via], t.dir, t.dir);
    expect(walk.out).toMatch(/^Linted 2 files/);
  });

  test("a missing file through the link is 'file not found', and a link out of the root is still refused", () => {
    if (!linked) return;
    const missing = cli(["lint", "--root", real, path.join(via, "NOPE.md")], t.dir, t.dir);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/file not found/);
    const out = cli(["lint", path.join(via, "elsewhere", "CLAUDE.md")], via, via);
    expect(out.code).toBe(2);
    expect(out.err).toMatch(/points outside the root folder|outside the root folder/);
    expect(out.out).toBe("");
  });

  test("loads accepts the session folder through the link", () => {
    if (!linked) return;
    const r = cli(["loads", "--root", real, via], t.dir, t.dir);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/CLAUDE\.md/);
  });
});

describe("plugin launcher with CLAUDE_PROJECT_DIR as a symlink", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let L: any;
  beforeAll(async () => {
    L = await import(pathToFileURL(LAUNCHER).href);
  });

  test("grants the link and the folder it points to, and keeps --root as given", () => {
    const server = "/p/server/asitis-mcp.mjs";
    expect(L.withProject(["--permission", "--allow-fs-read=/p", server], "/link", "/real/proj")).toEqual(["--permission", "--allow-fs-read=/link", "--allow-fs-read=/real/proj", "--allow-fs-read=/p", server, "--root", "/link"]);
    expect(L.withProject(["--permission", "--allow-fs-read=/p", server], "/proj", "/proj")).toEqual(["--permission", "--allow-fs-read=/proj", "--allow-fs-read=/p", server, "--root", "/proj"]);
  });

  test("dedupe keeps both grants for a link and its target, and still drops nested ones", () => {
    if (!linked) return;
    const plugin = path.join(real, "plugin");
    mkdirSync(plugin, { recursive: true });
    expect(L.dedupeReadGrants(["--permission", `--allow-fs-read=${via}`, `--allow-fs-read=${real}`, `--allow-fs-read=${plugin}`])).toEqual(["--permission", `--allow-fs-read=${via}`, `--allow-fs-read=${real}`]);
  });

  test("the server starts, reads the project in either path form, and nothing outside it", async () => {
    if (!linked) return;
    const args = MCP_JSON.args.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN));
    const transport = new StdioClientTransport({ command: process.execPath, args, stderr: "pipe", env: { ...(process.env as Record<string, string>), CLAUDE_PROJECT_DIR: via }, cwd: t.dir });
    let err = "";
    transport.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    const client = new Client({ name: "asitis-symlink-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const found = await toResult(client, "find_steering_files", {});
      expect(found.isError, found.text + err).toBe(false);
      expect(found.text).toMatch(/CLAUDE\.md/);
      expect(found.text).toMatch(/release\/SKILL\.md/);
      for (const p of ["CLAUDE.md", path.join(via, "CLAUDE.md"), path.join(real, "CLAUDE.md")]) {
        const r = await toResult(client, "read_markdown", { path: p });
        expect(r.isError, `${p}: ${r.text}`).toBe(false);
        expect(r.text).toMatch(/Run `npm test` before you push/);
      }
      const lint = await toResult(client, "lint_steering", {});
      expect(lint.isError, lint.text).toBe(false);
      expect(lint.text).toMatch(/^Linted 2 files/);
      for (const p of [path.join(outside, "CLAUDE.md"), "elsewhere/CLAUDE.md"]) {
        const r = await toResult(client, "read_markdown", { path: p });
        expect(r.isError, p).toBe(true);
        expect(r.text).not.toMatch(/Not this project/);
      }
    } finally {
      await client.close();
    }
  }, 60_000);
});
