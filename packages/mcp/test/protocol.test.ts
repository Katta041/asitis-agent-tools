// Protocol-level tests: spawn the bundled server over real stdio and drive it with the SDK client,
// the same way Claude Code, Claude Desktop, Cursor or Codex would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BUNDLE, FIXTURE_REPO, FOOTER, PLUGIN, toResult } from "./helpers.js";

async function spawnClient(args: string[], nodeFlags: string[] = []): Promise<{ client: Client; stderr: () => string; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [...nodeFlags, ...args], stderr: "pipe" });
  let err = "";
  transport.stderr?.on("data", (d: Buffer) => (err += d.toString()));
  const client = new Client({ name: "asitis-protocol-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, stderr: () => err, close: () => client.close() };
}

describe("stdio server (bundled dist/asitis-mcp.mjs)", () => {
  let s: Awaited<ReturnType<typeof spawnClient>>;
  beforeAll(async () => {
    s = await spawnClient([BUNDLE, "--root", FIXTURE_REPO]);
  });
  afterAll(async () => s.close());

  test("initialize: name, version, instructions", async () => {
    const info = s.client.getServerVersion();
    expect(info).toMatchObject({ name: "asitis", version: JSON.parse(readFileSync(path.resolve(BUNDLE, "../../package.json"), "utf8")).version });
    expect(s.client.getInstructions()).toMatch(/cannot write, execute or reach the network/);
  });

  test("lists the five read-only tools with input schemas", async () => {
    const { tools } = await s.client.listTools();
    expect(tools).toHaveLength(5);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
  });

  test("calls every tool", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["read_markdown", { path: "CLAUDE.md" }],
      ["outline", { path: "CLAUDE.md" }],
      ["lint_steering", { path: ".claude/skills/Bad_Skill/SKILL.md" }],
      ["context_budget", {}],
      ["find_steering_files", {}],
    ];
    for (const [name, args] of calls) {
      const r = await toResult(s.client, name, args);
      expect(r.isError, `${name}: ${r.text}`).toBe(false);
      expect(r.blocks.at(-1)).toBe(FOOTER);
    }
  });

  test("a tool that does not exist is rejected", async () => {
    const r = await s.client.callTool({ name: "patch_markdown", arguments: { path: "CLAUDE.md" } }).catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
    expect(r.isError).toBe(true);
  });

  test("invalid arguments are rejected with a message, not a crash", async () => {
    const r = await s.client.callTool({ name: "read_markdown", arguments: { path: 42 } }).catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
    expect(r.isError).toBe(true);
    const ok = await toResult(s.client, "outline", { path: "CLAUDE.md" });
    expect(ok.isError).toBe(false);
  });

  test("stderr carries only the ready line, never file content", () => {
    expect(s.stderr()).toMatch(/asitis-mcp \d+\.\d+\.\d+ ready: read-only/);
    expect(s.stderr()).not.toMatch(/Northwind|agent instructions/);
  });
});

describe("runs inside Node's permission model with no write, network or child-process rights", () => {
  test("the flags used by the plugin deny net, fs.write and child processes", () => {
    const r = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${FIXTURE_REPO}`, "-p", "[process.permission.has('net'), process.permission.has('fs.write'), process.permission.has('child')].join()"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe("false,false,false");
  });

  test("the plugin's .mcp.json command starts and serves every tool", async () => {
    const cfg = JSON.parse(readFileSync(path.join(PLUGIN, ".mcp.json"), "utf8")).mcpServers.asitis as { command: string; args: string[] };
    expect(cfg.command).toBe("node");
    const sub = (a: string): string => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN).replaceAll("${CLAUDE_PROJECT_DIR}", FIXTURE_REPO).replaceAll("${user_config.footer}", "true");
    const args = cfg.args.map(sub);
    expect(args).toContain("--permission");
    expect(args.some((a) => a.startsWith("--allow-fs-write") || a.startsWith("--allow-net") || a.startsWith("--allow-child"))).toBe(false);
    const s = await spawnClient(args);
    try {
      for (const [name, a] of [["find_steering_files", {}], ["lint_steering", {}], ["context_budget", {}], ["read_markdown", { path: "notes/hidden.md" }], ["outline", { path: "CLAUDE.md" }]] as const) {
        const r = await toResult(s.client, name, a as Record<string, unknown>);
        expect(r.isError, `${name}: ${r.text.slice(0, 300)}`).toBe(false);
      }
      const denied = await toResult(s.client, "read_markdown", { path: "../crlf-bom-skill/SKILL.md" });
      expect(denied.isError).toBe(true);
    } finally {
      await s.close();
    }
  });

  test("footer can be turned off through the plugin option", async () => {
    const s = await spawnClient([BUNDLE, "--root", FIXTURE_REPO, "--footer", "false"]);
    const r = await toResult(s.client, "outline", { path: "CLAUDE.md" });
    expect(r.text).not.toMatch(/asitis\.app/);
    await s.close();
  });
});

describe("CLI errors are one actionable line, exit code 2, no stack trace", () => {
  const run = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8", input: "", env: { ...process.env, ...env }, timeout: 10_000 });
  test.each([
    [["--root", "/definitely/not/here"], /Root folder not found: \/definitely\/not\/here\. Pass an existing folder with --root\./],
    [["--root", "${CLAUDE_PROJECT_DIR}"], /unexpanded variable/],
    [["--root", "/"], /Refusing the filesystem root/],
    [["--bogus"], /Unknown option '--bogus'.*--help/],
    [["--root", FIXTURE_REPO, "--max-file-mb", "999"], /--max-file-mb must be a number between 1 and 64/],
  ])("%j", (args, re) => {
    const r = run(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(re);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
  test("--help and --version exit 0", () => {
    expect(run(["--help"]).status).toBe(0);
    expect(run(["--version"]).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  test("ASITIS_MCP_ROOT is honoured", () => {
    const r = run([], { ASITIS_MCP_ROOT: "/definitely/not/here" });
    expect(r.stderr).toMatch(/Root folder not found/);
  });
});
